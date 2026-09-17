'use strict';
const { randomUUID } = require('crypto');
const { revision, lampsForOrder, planSheets, ms, currentCut } = require('./svgCutQueue');
const { autoBlocked, isVideoCorregir, ESTATUS_TERMINAL } = require('./svgAuto');
const ENGINE = 'server-svg-v1';
const LEASE_MS = 10 * 60000;

// Dependencies are injected so recovery and concurrency can be tested without live orders.
function createCutWorker({ db, admin, render, storage, upload, recompute = async () => {}, now = Date.now }) {
    const settings = db.collection('svg_corte_config').doc('settings');
    const leaseRef = db.collection('svg_corte_config').doc('server-lease');
    const jobs = db.collection('svg_cut_jobs');
    const orders = db.collection('pedidos');
    const del = () => admin.firestore.FieldValue.delete();
    const stamp = () => admin.firestore.FieldValue.serverTimestamp();
    let owner = null;

    async function acquire() {
        const token = randomUUID();
        const ok = await db.runTransaction(async tx => {
            const [config, lock] = await Promise.all([tx.get(settings), tx.get(leaseRef)]);
            const cfg = config.data() || {}, lease = lock.data() || {};
            if (cfg.engine !== ENGINE || cfg.serverEnabled !== true || ms(cfg.serverStartAfter) > now()) return false;
            if (lease.owner && lease.expiresAt > now()) return false;
            tx.set(leaseRef, { owner: token, expiresAt: now() + LEASE_MS }); return true;
        });
        if (ok) owner = token;
        return ok;
    }

    async function assertLease() {
        await db.runTransaction(async tx => {
            const [lock, config] = await Promise.all([tx.get(leaseRef), tx.get(settings)]);
            const lease = lock.data() || {}, cfg = config.data() || {};
            if (!owner || lease.owner !== owner || lease.expiresAt <= now() || cfg.engine !== ENGINE || !cfg.serverEnabled)
                throw Object.assign(new Error('El servidor perdió el turno de corte o fue pausado.'), { code: 'LEASE_LOST' });
            tx.update(leaseRef, { expiresAt: now() + LEASE_MS });
        });
    }

    async function release() {
        const token = owner; owner = null;
        await db.runTransaction(async tx => {
            const lock = await tx.get(leaseRef);
            if (lock.data()?.owner === token) tx.set(leaseRef, { owner: null, expiresAt: 0 });
        });
    }

    async function previewsFor(id) {
        const d = await db.collection('mockup_previews').doc(id).get();
        return d.data()?.previews || [];
    }

    async function collect(cfg) {
        const snapshots = await Promise.all([
            orders.where('svgServerRequest.status', '==', 'queued').limit(20).get(),
            orders.where('estatus', '==', 'Fabricar').limit(1000).get(),
            orders.where('estatus', '==', 'Corregir').limit(300).get(),
            orders.orderBy('comprobanteValidadoAt', 'desc').limit(400).get()
        ]);
        const docs = new Map(); snapshots.forEach(s => s.docs.forEach(d => docs.set(d.id, d)));
        const lamps = [], errors = [];
        for (const d of docs.values()) {
            const o = { ...d.data(), id: d.id };
            // Avoid a Storage/Firestore read for orders known to be finished or owned by a job.
            if (o.svgServerJob || o.svgCorteReviewRequired || o.ocultoDeEnvios) continue;
            const forced = o.svgServerRequest?.status === 'queued';
            if (currentCut(o)) continue;
            if (!forced && (cfg.serverAutoGenerate === false || (!isVideoCorregir(o) &&
                (autoBlocked(o) || ESTATUS_TERMINAL.has(String(o.estatus || '').trim().toLowerCase()))))) continue;
            try { lamps.push(...lampsForOrder(o, await previewsFor(d.id), cfg, now())); }
            catch (e) { errors.push({ id: d.id, message: e.message }); }
        }
        return { lamps, errors };
    }

    async function createJob(block) {
        await assertLease();
        const id = randomUUID(), ref = jobs.doc(id);
        const metas = [...new Map(block.flat().map(l => [l.orderId, {
            id: l.orderId, dh: l.dh, revision: l.revision, video: l.video, forced: l.forced, contactId: l.contactId
        }])).values()];
        const job = { id, engine: ENGINE, state: 'active', createdAt: now(), orders: metas,
            sheets: block.map((sheet, index) => ({ model: sheet[0].model, lamps: sheet.map(l => l.fields),
                orderIds: sheet.map(l => l.orderId), status: 'planned',
                name: `${[...new Set(sheet.map(l => l.dh))].join('-')}-${sheet[0].model}-${id.slice(0, 8)}-${index + 1}.svg` })) };
        await db.runTransaction(async tx => {
            const docs = await Promise.all(metas.map(m => tx.get(orders.doc(m.id))));
            const prevs = await Promise.all(metas.map(m => tx.get(db.collection('mockup_previews').doc(m.id))));
            for (let i = 0; i < metas.length; i++) {
                const o = docs[i].data();
                if (!o || o.svgServerJob || revision(o, prevs[i].data()?.previews || []) !== metas[i].revision)
                    throw Object.assign(new Error('El pedido cambió mientras esperaba diseño.'), { code: 'STALE_PLAN' });
            }
            tx.create(ref, job);
            metas.forEach(m => tx.update(orders.doc(m.id), { svgServerJob: id, svgCorteStartedAt: stamp() }));
        });
        return job;
    }

    async function checkOrders(job) {
        for (const m of job.orders) {
            const d = await orders.doc(m.id).get(), o = d.data();
            if (!o || o.svgServerJob !== job.id || revision(o, await previewsFor(m.id)) !== m.revision)
                throw Object.assign(new Error('Cambió un pedido o su mockup durante el diseño.'), { code: 'STALE_PLAN' });
        }
    }

    async function closeJob(job, state, error, culpableIds = []) {
        await assertLease();
        await db.runTransaction(async tx => {
            const docs = await Promise.all(job.orders.map(m => tx.get(orders.doc(m.id))));
            tx.update(jobs.doc(job.id), { state, error: String(error).slice(0, 500), finishedAt: now() });
            docs.forEach((d, i) => {
                const o = d.data(), m = job.orders[i]; if (!o || o.svgServerJob !== job.id) return;
                const upd = { svgServerJob: del(), svgCorteStartedAt: del() };
                if (state === 'needs_review') {
                    upd.svgCorteReviewRequired = { jobId: job.id, message: String(error).slice(0, 300) };
                    upd.designForce = true;
                    if (o.svgServerRequest) upd.svgServerRequest = { ...o.svgServerRequest, status: 'error', error: upd.svgCorteReviewRequired.message };
                } else if (culpableIds.includes(m.id)) {
                    upd.svgCorteServerFails = (Number(o.svgCorteServerFails) || 0) + 1;
                    if (upd.svgCorteServerFails >= 3) upd.designForce = true;
                    if (o.svgServerRequest) upd.svgServerRequest = { ...o.svgServerRequest, status: 'error', error: String(error).slice(0, 300) };
                }
                tx.update(d.ref, upd);
            });
        });
        await Promise.all(job.orders.map(m => recompute(m.contactId).catch(() => {})));
    }

    async function finish(job) {
        await assertLease();
        await db.runTransaction(async tx => {
            const docs = await Promise.all(job.orders.map(m => tx.get(orders.doc(m.id))));
            const prevs = await Promise.all(job.orders.map(m => tx.get(db.collection('mockup_previews').doc(m.id))));
            for (let i = 0; i < docs.length; i++) {
                const o = docs[i].data(), m = job.orders[i];
                if (!o || o.svgServerJob !== job.id || revision(o, prevs[i].data()?.previews || []) !== m.revision)
                    throw Object.assign(new Error('El pedido cambió antes de registrar el corte.'), { code: 'STALE_PLAN' });
            }
            job.orders.forEach(m => {
                const sheets = job.sheets.filter(s => s.orderIds.includes(m.id));
                if (!sheets.length || sheets.some(s => s.status !== 'uploaded')) throw new Error('Faltan hojas confirmadas.');
                const first = sheets[0], others = [...new Set(sheets.flatMap(s => s.orderIds))].filter(id => id !== m.id);
                const upd = {
                    svgCorteAt: stamp(), svgCorteBy: ENGINE, svgCorteUrl: first.upload.webViewLink,
                    svgCorteUrls: sheets.length > 1 ? sheets.map(s => s.upload.webViewLink).join(',') : null,
                    svgCorteFileName: first.upload.name, svgCortePreviewUrl: first.artifacts.preview.url,
                    svgCorteStorageUrl: first.artifacts.svg.url, svgCorteNaturalUrl: first.artifacts.natural.url,
                    svgCorteFiles: sheets.map(s => ({ name: s.name, url: s.upload.webViewLink, svg: s.artifacts.svg.url,
                        preview: s.artifacts.preview.url, natural: s.artifacts.natural.url })),
                    svgCorteSheetWith: others.map(id => job.orders.find(o => o.id === id).dh).join(',') || null,
                    svgCorteJobId: job.id, svgServerJob: del(), svgCorteStartedAt: del(),
                    svgCorteCdrLocal: del(), svgCorteServerFails: del(), svgCortePersonajeFails: del(), designForce: del()
                };
                if (m.forced) upd.svgServerRequest = del();
                if (!m.video) upd.estatus = 'Diseñado por IA';
                tx.update(orders.doc(m.id), upd);
            });
            tx.update(jobs.doc(job.id), { state: 'completed', finishedAt: now() });
        });
        await Promise.all(job.orders.map(m => recompute(m.contactId).catch(() => {})));
    }

    async function processJob(job) {
        let sheet = null;
        try {
            await assertLease();
            // A process may have died after Drive accepted a POST but before its acknowledgement
            // reached Firestore. Such an upload must NEVER be repeated automatically.
            if (job.sheets.some(s => s.status === 'uploading')) {
                await closeJob(job, 'needs_review', 'Drive pudo recibir una hoja antes del reinicio. Revisar los archivos del trabajo antes de reintentar.');
                return 'needs_review';
            }
            await checkOrders(job);
            for (let i = 0; i < job.sheets.length; i++) {
                sheet = job.sheets[i];
                if (sheet.status !== 'planned') continue;
                await assertLease();
                const result = await render({ model: sheet.model, lamps: sheet.lamps });
                sheet.artifacts = await storage.saveSheet(job.id, i, result);
                sheet.status = 'generated'; sheet.meta = result.meta;
                await jobs.doc(job.id).update({ sheets: job.sheets });
            }
            // All pieces have passed geometry checks before the first file reaches the cutter.
            for (const s of job.sheets) {
                sheet = s;
                if (s.status === 'uploaded') continue;
                await assertLease(); await checkOrders(job);
                const bytes = await storage.read(s.artifacts.svg.path);
                await assertLease();
                s.status = 'uploading';
                await jobs.doc(job.id).update({ sheets: job.sheets });
                const uploaded = await upload(s.name, bytes);
                // If this write fails, the persisted state is still 'uploading', safely held.
                await jobs.doc(job.id).update({ sheets: job.sheets.map(x => x === s ? { ...s, status: 'uploaded', upload: uploaded } : x) });
                s.status = 'uploaded'; s.upload = uploaded;
            }
            await finish(job); return 'completed';
        } catch (e) {
            if (e.code === 'LEASE_LOST') throw e;
            if (job.sheets.some(s => s.status === 'uploading')) {
                await closeJob(job, 'needs_review', 'No se pudo confirmar la subida a Drive: ' + e.message); return 'needs_review';
            }
            if (e.code === 'STALE_PLAN' || e.code === 'DESIGN_LAYOUT') {
                const sent = job.sheets.some(s => s.status === 'uploaded');
                const ids = e.code === 'DESIGN_LAYOUT' && sheet
                    ? [...new Set((e.lampIndices?.length ? e.lampIndices : sheet.orderIds.map((_, i) => i)).map(i => sheet.orderIds[i]))] : [];
                await closeJob(job, sent ? 'needs_review' : 'cancelled', e.message, ids); return sent ? 'needs_review' : 'cancelled';
            }
            // Generation/Storage/Firestore failure before an uncertain POST: keep the durable
            // job and its claims; the next run resumes it, including already confirmed uploads.
            throw e;
        }
    }

    async function run({ dry = false, maxSheets = 2, single = false } = {}) {
        if (owner) return { skipped: 'running' };
        if (dry) {
            const cfg = (await settings.get()).data() || {};
            const { lamps, errors } = await collect({ ...cfg, serverAutoGenerate: cfg.serverAutoGenerate ?? cfg.autoGenerate });
            return { engine: ENGINE, dry: true, blocks: planSheets(lamps, { now: now(), maxSheets, single }), errors };
        }
        if (!await acquire()) return { skipped: 'disabled_or_locked' };
        const summary = { engine: ENGINE, completed: 0, needs_review: 0, cancelled: 0 };
        try {
            await settings.set({ serverLastStartedAt: stamp() }, { merge: true });
            const active = await jobs.where('state', '==', 'active').limit(20).get();
            for (const d of active.docs) summary[await processJob(d.data())]++;
            const cfg = (await settings.get()).data() || {};
            const { lamps, errors } = await collect(cfg);
            for (const e of errors) {
                await assertLease();
                await orders.doc(e.id).update({ 'svgServerRequest.status': 'error', 'svgServerRequest.error': e.message.slice(0, 300) });
            }
            for (const block of planSheets(lamps, { now: now(), maxSheets, single })) {
                let job;
                try { job = await createJob(block); } catch (e) { if (e.code === 'STALE_PLAN') continue; throw e; }
                summary[await processJob(job)]++;
            }
            await settings.set({ serverLastFinishedAt: stamp(), serverLastResult: summary, serverLastError: del() }, { merge: true });
            return summary;
        } catch (e) {
            await settings.set({ serverLastError: String(e.message).slice(0, 400), serverLastErrorAt: stamp() }, { merge: true }).catch(() => {});
            throw e;
        } finally { await release(); }
    }
    return { run, collect, acquire, release, createJob, processJob };
}

let singleton;
function productionWorker() {
    if (!singleton) {
        const { db, admin, bucket } = require('../config');
        const { renderSheet } = require('./svgRenderService');
        const { storageService, uploadDrive } = require('./svgCutStorage');
        singleton = createCutWorker({ db, admin, render: renderSheet, storage: storageService(bucket), upload: uploadDrive,
            recompute: require('./designPending').recomputeForContact });
    }
    return singleton;
}
module.exports = { ENGINE, createCutWorker, productionWorker };
