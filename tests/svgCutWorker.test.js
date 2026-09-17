'use strict';
const makeDb = require('./helpers/svgCutFirestore');
const { createCutWorker, ENGINE } = require('../server/design/svgCutWorker');
const { revision } = require('../server/design/svgCutQueue');
let db, render, storage, upload, worker, clock;
const admin = { firestore: { FieldValue: { delete: () => undefined, serverTimestamp: () => Date.now() } } };
const fields = { nombre1: 'Ana', nombre2: 'Luis', fecha: '17-09-2026' };
const previews = [{ fields }];
function seed(id = 'a', extra = {}) {
    db.seed('pedidos/' + id, { estatus: 'Fabricar', producto: 'Lámpara de corazones', createdAt: clock - 24 * 36e5,
        consecutiveOrderNumber: id, datosProducto: 'Nombres: Ana y Luis | Fecha: 17-09-2026', ...extra });
    db.seed('mockup_previews/' + id, { previews });
}
function lamp(id, piece = 0, total = 1) {
    return { orderId: id, dh: 'DH' + id, revision: revision(db.read('pedidos/' + id), previews),
        fields, piece, total, model: 'infinito', video: db.read('pedidos/' + id).corregirMotivo === 'video', forced: false, contactId: id };
}
function another() { return createCutWorker({ db, admin, render, storage, upload, now: () => clock }); }
const order = id => db.read('pedidos/' + id);
const getJob = id => db.read('svg_cut_jobs/' + id);
beforeEach(() => {
    clock = Date.parse('2026-09-17T12:00:00Z'); db = makeDb();
    db.seed('svg_corte_config/settings', { engine: ENGINE, serverEnabled: true, autoGenerate: false, serverAutoGenerate: true });
    render = jest.fn().mockResolvedValue({ svg: '<svg/>', naturalSvg: '<svg/>', preview: Buffer.from('png'), meta: {} });
    storage = { saveSheet: jest.fn(async (job, i) => ({
        svg: { path: `${job}/${i}.svg`, url: 'svg-' + i }, natural: { path: `${job}/${i}-natural.svg`, url: 'natural-' + i },
        preview: { path: `${job}/${i}.png`, url: 'preview-' + i }
    })), read: jest.fn().mockResolvedValue(Buffer.from('<svg/>')) };
    upload = jest.fn(async name => ({ name, id: name, webViewLink: 'drive-' + name }));
    worker = another(); seed();
});

test('a transaction permits only one server instance, and another can recover an expired lease', async () => {
    const other = another();
    expect(await Promise.all([worker.acquire(), other.acquire()])).toEqual([true, false]);
    clock += 11 * 60000;
    expect(await other.acquire()).toBe(true);
    await expect(worker.createJob([[lamp('a')]])).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(upload).not.toHaveBeenCalled();
});

test('dry run is read-only and the disabled server never claims orders', async () => {
    expect((await worker.run({ dry: true })).blocks).toHaveLength(1);
    expect(db.all('svg_cut_jobs')).toHaveLength(0); expect(order('a').svgServerJob).toBeUndefined();
    db.seed('svg_corte_config/settings', { engine: ENGINE, serverEnabled: false });
    expect(await worker.run()).toMatchObject({ skipped: 'disabled_or_locked' });
    expect(render).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
});

test('the scheduler designs an eligible order and a second run cannot duplicate it', async () => {
    expect(await worker.run()).toMatchObject({ completed: 1 });
    expect(order('a')).toMatchObject({ estatus: 'Diseñado por IA', svgCorteBy: ENGINE, svgCortePreviewUrl: 'preview-0' });
    expect(order('a').svgServerJob).toBeUndefined();
    await worker.run(); expect(upload).toHaveBeenCalledTimes(1);
});

test('all pieces render before uploading and a whole order can exceed the sheet budget', async () => {
    seed('a', { items: [{ producto: 'Lámpara de corazones', cantidad: 3 }] });
    upload.mockImplementation(async name => {
        expect(render).toHaveBeenCalledTimes(2); expect(order('a').svgCorteAt).toBeUndefined();
        return { name, id: name, webViewLink: name };
    });
    await worker.run({ maxSheets: 1 });
    expect(order('a').svgCorteFiles).toHaveLength(2); expect(upload).toHaveBeenCalledTimes(2);
});

test('a layout failure uploads nothing and penalizes only the failing lamp', async () => {
    seed('b'); await worker.acquire();
    const job = await worker.createJob([[lamp('a'), lamp('b')]]);
    render.mockRejectedValue(Object.assign(new Error('nombre no cabe'), { code: 'DESIGN_LAYOUT', lampIndices: [1] }));
    expect(await worker.processJob(job)).toBe('cancelled');
    expect(order('a').svgCorteServerFails).toBeUndefined(); expect(order('b').svgCorteServerFails).toBe(1);
    expect(order('a').svgServerJob).toBeUndefined(); expect(order('b').svgServerJob).toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
});

test('an uncertain Drive response is held for review without marking the order completed or retrying', async () => {
    await worker.acquire(); const job = await worker.createJob([[lamp('a')]]);
    upload.mockRejectedValue(new Error('timeout after POST'));
    expect(await worker.processJob(job)).toBe('needs_review');
    expect(order('a').svgCorteAt).toBeUndefined(); expect(order('a').svgCorteReviewRequired.jobId).toBe(job.id);
    await worker.release(); await worker.run(); expect(upload).toHaveBeenCalledTimes(1);
});

test('a crash with an uploading journal entry is never retried after restart', async () => {
    await worker.acquire(); const job = await worker.createJob([[lamp('a')]]);
    job.sheets[0].status = 'uploading'; await db.collection('svg_cut_jobs').doc(job.id).update({ sheets: job.sheets });
    await worker.release(); expect(await another().run()).toMatchObject({ needs_review: 1 });
    expect(upload).not.toHaveBeenCalled(); expect(order('a').svgCorteAt).toBeUndefined();
});

test('uploaded sheets survive a Firestore finalization failure; recovery does not upload again', async () => {
    await worker.acquire(); const job = await worker.createJob([[lamp('a')]]);
    upload.mockImplementation(async name => {
        // Applies only to the final atomic order write, not the upload journal acknowledgement.
        db.failNext('commit', 'pedidos/a');
        return { name, id: 'drive-id', webViewLink: 'drive-url' };
    });
    await expect(worker.processJob(job)).rejects.toThrow('storage unavailable');
    expect(getJob(job.id).sheets[0].status).toBe('uploaded'); expect(order('a').svgCorteAt).toBeUndefined();
    expect(await worker.processJob(getJob(job.id))).toBe('completed');
    expect(upload).toHaveBeenCalledTimes(1); expect(order('a').svgCorteAt).toBeDefined();
});

test('failure to persist the Drive acknowledgement holds the job instead of resubmitting', async () => {
    await worker.acquire(); const job = await worker.createJob([[lamp('a')]]);
    upload.mockImplementation(async name => {
        db.failNext('update', 'svg_cut_jobs/' + job.id);
        return { name, id: 'drive-id', webViewLink: 'drive-url' };
    });
    expect(await worker.processJob(job)).toBe('needs_review');
    expect(getJob(job.id).sheets[0].status).toBe('uploading');
    await worker.release(); await another().run(); expect(upload).toHaveBeenCalledTimes(1);
});

test('the order stays pending if the second of multiple sheets has an uncertain upload', async () => {
    await worker.acquire(); const job = await worker.createJob([[lamp('a', 0, 3), lamp('a', 1, 3)], [lamp('a', 2, 3)]]);
    upload.mockResolvedValueOnce({ name: 'one', id: '1', webViewLink: 'drive-one' }).mockRejectedValueOnce(new Error('lost connection'));
    expect(await worker.processJob(job)).toBe('needs_review');
    expect(getJob(job.id).sheets[0].status).toBe('uploaded'); expect(order('a').svgCorteAt).toBeUndefined();
    expect(order('a').estatus).toBe('Fabricar');
});

test('changed mockups and cancelled orders invalidate the plan before any upload', async () => {
    await worker.acquire(); const job = await worker.createJob([[lamp('a')]]);
    await db.collection('pedidos').doc('a').update({ estatus: 'Cancelado' });
    expect(await worker.processJob(job)).toBe('cancelled'); expect(upload).not.toHaveBeenCalled();
    expect(order('a').estatus).toBe('Cancelado');
});

test('pause during rendering prevents publication', async () => {
    await worker.acquire(); const job = await worker.createJob([[lamp('a')]]);
    storage.saveSheet.mockImplementation(async () => {
        await db.collection('svg_corte_config').doc('settings').update({ serverEnabled: false });
        return { svg: { path: 'svg' }, preview: { url: 'png' }, natural: { url: 'natural' } };
    });
    await expect(worker.processJob(job)).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(upload).not.toHaveBeenCalled();
});

test('sharing a sheet preserves video status only for the order requesting video', async () => {
    seed('a', { estatus: 'Corregir', corregirMotivo: 'video' }); seed('b');
    await worker.acquire(); const job = await worker.createJob([[lamp('a'), lamp('b')]]);
    expect(await worker.processJob(job)).toBe('completed');
    expect(order('a').estatus).toBe('Corregir'); expect(order('b').estatus).toBe('Diseñado por IA');
    expect(order('a').svgCorteSheetWith).toBe('DHb');
});
