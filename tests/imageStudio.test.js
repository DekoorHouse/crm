const mockDocs = new Map();
const mockWrites = [];
const mockFetch = jest.fn();
const mockSave = jest.fn().mockResolvedValue();
const mockDelete = Symbol('delete');
function mockRef(collection, id) {
    const key = `${collection}/${id}`;
    return { id, key,
        get: async () => ({ exists: mockDocs.has(key), data: () => mockDocs.get(key) }),
        update: async data => { mockDocs.set(key, { ...mockDocs.get(key), ...data }); mockWrites.push({ key, data }); },
    };
}
let mockTransactions = Promise.resolve();
jest.mock('../server/config', () => ({
    db: {
        collection: collection => ({ doc: id => mockRef(collection, id) }),
        runTransaction: fn => {
            const run = mockTransactions.then(async () => {
                const writes = [];
                const result = await fn({
                    get: ref => ref.get(), set: (ref, data, options) => writes.push({ ref, data, merge: options?.merge }),
                    delete: ref => writes.push({ ref, data: mockDelete }),
                });
                for (const { ref, data, merge } of writes) {
                    if (data === mockDelete) mockDocs.delete(ref.key);
                    else mockDocs.set(ref.key, merge ? { ...mockDocs.get(ref.key), ...data } : data);
                }
                return result;
            });
            mockTransactions = run.catch(() => {});
            return run;
        },
    },
    bucket: { name: 'test-bucket', file: () => ({ save: (...args) => mockSave(...args) }) },
}));
jest.mock('node-fetch', () => (...args) => mockFetch(...args));
const sharp = require('sharp');
const service = require('../server/imagenes/imageStudioService');
const model = { id: 'google/gemini-3-pro-image-preview', name: 'Nano Banana Pro', parameters: {
    aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] }, resolution: { type: 'enum', values: ['1K', '2K'] },
    input_references: { type: 'range', min: 0, max: 14 },
} };
const actor = { uid: 'tester' };
const requestId = 'a2e6caa5-21d1-4f39-b44c-98b46ad1cb9b';
const fields = (overrides = {}) => ({ requestId, model: model.id, prompt: 'Una lámpara de prueba', aspect_ratio: '1:1', resolution: '1K', ...overrides });
const current = () => mockDocs.get(`image_studio_generations/${requestId}`);
let finishGeneration;
let imageBuffer;
beforeAll(async () => { imageBuffer = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#88bb55' } }).png().toBuffer(); });
beforeEach(() => {
    mockDocs.clear(); mockWrites.length = 0; mockTransactions = Promise.resolve(); jest.clearAllMocks();
    process.env.OPENROUTER_API_KEY = 'test-secret';
    mockFetch.mockImplementation(async url => {
        if (url.endsWith('/images/models')) return { ok: true, json: async () => ({ data: [
            { ...model, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, supported_parameters: model.parameters },
            { id: 'text-only', architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
            { id: 'vector-only', architecture: { input_modalities: ['text'], output_modalities: ['image'] }, supported_parameters: { output_format: { values: ['svg'] } } },
        ] }) };
        return new Promise(resolve => { finishGeneration = resolve; });
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
async function finish(response) {
    finishGeneration(response || { ok: true, json: async () => ({ data: [{ b64_json: imageBuffer.toString('base64'), media_type: 'image/png' }], usage: { cost: 0.05 } }) });
    for (let i = 0; i < 100 && current()?.status === 'generating'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    await mockTransactions;
}

test('catálogo filtra texto y vector y no expone la llave', async () => {
    const result = await service.getModels();
    expect(result.models.map(m => m.id)).toEqual([model.id]);
    expect(result.linkedIds).toEqual([model.id]);
    expect(JSON.stringify(result)).not.toContain('test-secret');
});
test('vincular y quitar modelos persiste entre lecturas', async () => {
    expect((await service.linkModel(model.id, 'unlink')).linkedIds).toEqual([]);
    expect((await service.getModels()).linkedIds).toEqual([]);
    expect((await service.linkModel(model.id, 'link')).linkedIds).toEqual([model.id]);
    await expect(service.linkModel('inexistente', 'link')).rejects.toMatchObject({ status: 400 });
});
test.each([
    { prompt: ' ' }, { prompt: 'a'.repeat(6001) }, { aspect_ratio: '999:1' }, { quality: 'high' }, { resolution: '8K' },
])('rechaza opciones inválidas antes de gastar créditos: %j', options => {
    expect(() => service.validateGeneration(fields(options), model)).toThrow();
});
test('referencias requeridas y límites específicos del modelo', () => {
    expect(() => service.validateGeneration(fields(), { ...model, parameters: { input_references: { min: 1, max: 1 } } }, [])).toThrow(/necesita/);
    expect(() => service.validateGeneration(fields(), model, new Array(5))).toThrow(/hasta 4/);
});
test('valida y normaliza una referencia sin aceptar URLs externas ni archivos falsos', async () => {
    const refs = await service.prepareReferences([{ mimetype: 'image/png', buffer: imageBuffer }]);
    expect(refs[0].image_url.url).toMatch(/^data:image\/png;base64,/);
    await expect(service.prepareReferences([{ mimetype: 'image/png', buffer: Buffer.from('not an image') }])).rejects.toThrow(/no se puede leer/);
    await expect(service.prepareReferences([{ mimetype: 'image/svg+xml', buffer: imageBuffer }])).rejects.toThrow(/PNG/);
});
test('solicitud completa usa el modelo, formato y resolución elegidos y guarda galería', async () => {
    const job = await service.createGeneration(fields(), [], actor);
    expect(job.status).toBe('generating');
    const generationCall = mockFetch.mock.calls.find(([url]) => url.endsWith('/images'));
    expect(JSON.parse(generationCall[1].body)).toMatchObject({ model: model.id, prompt: fields().prompt, aspect_ratio: '1:1', resolution: '1K', n: 1 });
    await finish();
    expect(current()).toMatchObject({ status: 'completed', cost: 0.05 });
    expect(current().images[0]).toMatchObject({ width: 4, height: 3 });
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(mockSave.mock.calls[0][1].public).toBeUndefined();
    expect((await service.getJob(requestId)).images[0].fullUrl).toContain('alt=media&token=');
    expect([...mockDocs.keys()].filter(key => key.startsWith('image_studio_locks/'))).toEqual([]);
});
test('dos solicitudes con el mismo ID generan una sola imagen', async () => {
    const jobs = await Promise.all([service.createGeneration(fields(), [], actor), service.createGeneration(fields(), [], actor)]);
    expect(jobs.every(job => job.id === requestId)).toBe(true);
    expect(mockFetch.mock.calls.filter(([url]) => url.endsWith('/images'))).toHaveLength(1);
    await finish();
    expect((await service.createGeneration(fields(), [], actor)).status).toBe('completed');
    expect(mockFetch.mock.calls.filter(([url]) => url.endsWith('/images'))).toHaveLength(1);
});
test('un ID repetido no puede cambiar prompt ni propietario', async () => {
    await service.createGeneration(fields(), [], actor);
    await expect(service.createGeneration(fields({ prompt: 'Otro prompt' }), [], actor)).rejects.toMatchObject({ status: 409 });
    await expect(service.createGeneration(fields(), [], { uid: 'otro' })).rejects.toMatchObject({ status: 409 });
    await finish();
});
test('limita a una generación simultánea por usuario', async () => {
    await service.createGeneration(fields(), [], actor);
    await expect(service.createGeneration(fields({ requestId: 'b2e6caa5-21d1-4f39-b44c-98b46ad1cb9b' }), [], actor)).rejects.toMatchObject({ status: 409 });
    await finish();
});
test('no genera con modelos sin vincular o sin conexión', async () => {
    await service.linkModel(model.id, 'unlink');
    await expect(service.createGeneration(fields(), [], actor)).rejects.toMatchObject({ status: 400 });
    delete process.env.OPENROUTER_API_KEY;
    await expect(service.createGeneration(fields(), [], actor)).rejects.toMatchObject({ status: 503 });
    expect(mockFetch.mock.calls.some(([url]) => url.endsWith('/images'))).toBe(false);
});
test.each([402, 429, 500])('error del proveedor %s se guarda sin reintentar ni marcar completado', async status => {
    await service.createGeneration(fields(), [], actor);
    await finish({ ok: false, status });
    expect(current().status).toBe('failed');
    expect(current().images).toBeUndefined();
    expect(mockFetch.mock.calls.filter(([url]) => url.endsWith('/images'))).toHaveLength(1);
});
test('una respuesta sin imagen no es éxito', async () => {
    await service.createGeneration(fields(), [], actor);
    await finish({ ok: true, json: async () => ({ data: [] }) });
    expect(current()).toMatchObject({ status: 'failed', error: expect.stringContaining('no devolvió') });
});
test('un trabajo interrumpido no queda eternamente en progreso ni se reenvía', () => {
    const job = service.publicJob(requestId, { status: 'generating', createdAt: new Date(Date.now() - 11 * 60000).toISOString(), fingerprint: 'private', owner: 'private' });
    expect(job.status).toBe('interrupted');
    expect(job).not.toHaveProperty('owner');
    expect(job).not.toHaveProperty('fingerprint');
    expect(mockFetch).not.toHaveBeenCalled();
});
