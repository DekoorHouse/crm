const crypto = require('crypto');
const mockDocs = new Map();
const mockFetch = jest.fn();
function mockRef(key) {
    return {
        get: async () => ({ exists: mockDocs.has(key), data: () => mockDocs.get(key) }),
        set: async (data, options) => { mockDocs.set(key, options?.merge ? { ...mockDocs.get(key), ...data } : data); },
    };
}
jest.mock('../server/config', () => ({
    db: {
        collection: collection => ({ doc: id => mockRef(`${collection}/${id}`) }),
        runTransaction: async fn => fn({ get: ref => ref.get(), set: (ref, data, options) => ref.set(data, options) }),
    },
}));
jest.mock('node-fetch', () => (...args) => mockFetch(...args));
const pod = require('../server/imagenes/qwenPod');
const qwen = require('../server/imagenes/qwenImage');

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => Buffer.from('png-bytes') });
const podState = () => mockDocs.get('crm_settings/qwen_pod');
beforeEach(() => { mockDocs.clear(); mockFetch.mockReset(); process.env.RUNPOD_API_KEY = 'rp-secret'; });

test('calcula tamaños nativos en múltiplos de 32', () => {
    expect(qwen.outputSize('1:1', '1K')).toEqual({ width: 1024, height: 1024 });
    expect(qwen.outputSize('16:9', '1K')).toEqual({ width: 1376, height: 768 });
    expect(qwen.outputSize('3:4', '2K')).toEqual({ width: 1760, height: 2368 });
});

test('sin referencias crea desde texto con el grafo de la plantilla t2i', () => {
    const graph = qwen.buildWorkflow({ prompt: 'una lámpara', aspect_ratio: '16:9', resolution: '1K', seed: 7 });
    expect(graph.latent.inputs).toMatchObject({ width: 1376, height: 768 });
    expect(graph.sampler.inputs).toMatchObject({ model: ['unet', 0], latent_image: ['latent', 0], seed: 7, steps: 25, cfg: 2.5 });
    expect(graph.cache).toBeUndefined();
    expect(graph.encode.inputs.vae).toBeUndefined();
});

test('con referencias edita y conserva el tamaño de la primera imagen', () => {
    const graph = qwen.buildWorkflow({ prompt: 'cambia el personaje', images: ['a.png', 'b.png'], aspect_ratio: '16:9', resolution: '2K', seed: 1 });
    expect(graph.ref1.inputs.image).toBe('a.png');
    expect(graph.encode.inputs).toMatchObject({ 'images.image_1': ['ref1', 0], 'images.image_2': ['ref2', 0], vae: ['vae', 0], resolution: 2048 });
    expect(graph.sampler.inputs).toMatchObject({ model: ['cache', 0], latent_image: ['encode', 2], cfg: 1 });
    expect(graph.latent).toBeUndefined();
});

test('el horario usa la hora de Ciudad de México', () => {
    expect(pod.inSchedule(new Date('2026-09-24T15:00:00Z'))).toBe(true); // jueves 9:00
    expect(pod.inSchedule(new Date('2026-09-24T14:59:00Z'))).toBe(false); // jueves 8:59
    expect(pod.inSchedule(new Date('2026-09-24T23:00:00Z'))).toBe(false); // jueves 17:00
    expect(pod.inSchedule(new Date('2026-09-26T17:00:00Z'))).toBe(false); // sábado 11:00
});

test('crea el pod con el script de arranque y guarda solo el nonce del token', async () => {
    mockFetch.mockImplementation(async (url, options = {}) => {
        if (url.endsWith('/pods') && options.method === 'POST') return reply({ id: 'pod123', costPerHr: 0.74, gpu: { displayName: 'RTX 4090' } });
        if (url.endsWith('/dekoor/health')) return reply({ ready: false, stage: 'descargando modelos' });
        throw new Error(`fetch inesperado ${url}`);
    });
    const status = await pod.startPod('prueba');
    const [, options] = mockFetch.mock.calls.find(([url]) => url.endsWith('/pods'));
    const body = JSON.parse(options.body);
    expect(options.headers.Authorization).toBe('Bearer rp-secret');
    expect(body).toMatchObject({ gpuTypeIds: expect.arrayContaining(['NVIDIA GeForce RTX 4090']), containerDiskInGb: 80, ports: ['3000/http'], dockerEntrypoint: ['bash', '-c'] });
    expect(body.dockerStartCmd[0]).toContain('dekoor_proxy.py');
    const { nonce } = podState();
    expect(body.env.DEKOOR_TOKEN).toBe(crypto.createHmac('sha256', 'rp-secret').update(`qwen-pod:${nonce}`).digest('hex'));
    expect(JSON.stringify(podState())).not.toContain(body.env.DEKOOR_TOKEN);
    expect(status).toMatchObject({ status: 'starting', message: expect.stringContaining('descargando modelos') });
    const [, healthOptions] = mockFetch.mock.calls.find(([url]) => url === 'https://pod123-3000.proxy.runpod.net/dekoor/health');
    expect(healthOptions.headers['X-Dekoor-Token']).toBe(body.env.DEKOOR_TOKEN);
});

test('no crea un segundo pod si ya hay uno', async () => {
    mockDocs.set('crm_settings/qwen_pod', { podId: 'pod456', nonce: 'n', status: 'ready', createdAt: new Date().toISOString() });
    mockFetch.mockResolvedValue(reply({ ready: true, stage: 'cargando ComfyUI' }));
    await expect(pod.startPod('otra vez')).resolves.toMatchObject({ status: 'ready' });
    expect(mockFetch.mock.calls.some(([url]) => url.endsWith('/pods'))).toBe(false);
});

test('apaga fuera de horario un pod sin uso y limpia el estado', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-26T02:00:00Z'), doNotFake: ['setTimeout', 'setImmediate', 'nextTick'] }); // viernes 20:00
    try {
        const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        mockDocs.set('crm_settings/qwen_pod', { podId: 'pod123', nonce: 'n', status: 'ready', createdAt: old, lastUsedAt: old });
        mockFetch.mockImplementation(async (url, options = {}) => options.method === 'GET' ? reply({ id: 'pod123', desiredStatus: 'RUNNING' }) : reply(null));
        await pod.reconcile();
        expect(mockFetch.mock.calls.some(([url, options]) => url.endsWith('/pods/pod123') && options.method === 'DELETE')).toBe(true);
        expect(podState()).toMatchObject({ podId: null, nonce: null, status: 'off' });
    } finally { jest.useRealTimers(); }
});

test('no apaga dentro del horario un pod recién usado', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-24T18:00:00Z'), doNotFake: ['setTimeout', 'setImmediate', 'nextTick'] }); // jueves 12:00
    try {
        const recent = new Date(Date.now() - 60 * 1000).toISOString();
        mockDocs.set('crm_settings/qwen_pod', { podId: 'pod123', nonce: 'n', status: 'ready', createdAt: recent, lastUsedAt: recent });
        mockFetch.mockResolvedValue(reply({ id: 'pod123', desiredStatus: 'RUNNING' }));
        await pod.reconcile();
        expect(mockFetch.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(false);
    } finally { jest.useRealTimers(); }
});

test('genera a través del pod y devuelve la imagen en base64', async () => {
    mockDocs.set('crm_settings/qwen_pod', { podId: 'pod123', nonce: 'n', status: 'ready', createdAt: new Date().toISOString() });
    let workflow;
    mockFetch.mockImplementation(async (url, options = {}) => {
        if (url.endsWith('/dekoor/health')) return reply({ ready: true });
        if (url.endsWith('/upload/image')) return reply({ name: 'crm_job_1.png', subfolder: '' });
        if (url.endsWith('/prompt')) { workflow = JSON.parse(options.body).prompt; return reply({ prompt_id: 'p1' }); }
        if (url.endsWith('/history/p1')) return reply({ p1: { status: { completed: true, status_str: 'success' }, outputs: { save: { images: [{ filename: 'crm_00001_.png', subfolder: '', type: 'output' }] } } } });
        if (url.includes('/view?')) return reply(null);
        throw new Error(`fetch inesperado ${url}`);
    });
    const result = await qwen.generate({ model: qwen.MODEL_ID, prompt: 'edita', resolution: '1K',
        input_references: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from('ref').toString('base64')}` } }] }, 'job');
    expect(Buffer.from(result.data[0].b64_json, 'base64').toString()).toBe('png-bytes');
    expect(workflow.ref1.inputs.image).toBe('crm_job_1.png');
    expect(workflow.encode.inputs.prompt).toBe('edita');
}, 15000);

test('rechaza generar con la GPU apagada', async () => {
    await expect(qwen.generate({ model: qwen.MODEL_ID, prompt: 'x' }, 'job')).rejects.toMatchObject({ status: 503 });
    expect(mockFetch).not.toHaveBeenCalled();
});

test('mejora la descripción antes de generar y la reporta con su costo', async () => {
    mockDocs.set('crm_settings/qwen_pod', { podId: 'pod789', nonce: 'n', status: 'ready', createdAt: new Date().toISOString() });
    process.env.OPENROUTER_API_KEY = 'or-key';
    let workflow;
    mockFetch.mockImplementation(async (url, options = {}) => {
        if (url.includes('openrouter.ai')) return reply({ choices: [{ message: { content: '{"rewritten_prompt": "A detailed English description of Spider-Man running.", "wh_ratio": "1:1"}' } }], usage: { cost: 0.002 } });
        if (url.endsWith('/dekoor/health')) return reply({ ready: true });
        if (url.endsWith('/prompt')) { workflow = JSON.parse(options.body).prompt; return reply({ prompt_id: 'p2' }); }
        if (url.endsWith('/history/p2')) return reply({ p2: { status: { completed: true, status_str: 'success' }, outputs: { save: { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } } } });
        if (url.includes('/view?')) return reply(null);
        throw new Error(`fetch inesperado ${url}`);
    });
    try {
        const result = await qwen.generate({ model: qwen.MODEL_ID, prompt: 'Spiderman corriendo', aspect_ratio: '1:1', resolution: '1K', enhance: true }, 'job');
        expect(workflow.encode.inputs.prompt).toBe('A detailed English description of Spider-Man running.');
        expect(result).toMatchObject({ usage: { cost: 0.002 }, enhancedPrompt: 'A detailed English description of Spider-Man running.' });
        mockFetch.mockClear();
        const plain = await qwen.generate({ model: qwen.MODEL_ID, prompt: 'Spiderman corriendo', resolution: '1K', enhance: false }, 'job');
        expect(workflow.encode.inputs.prompt).toBe('Spiderman corriendo');
        expect(plain.enhancedPrompt).toBeNull();
        expect(mockFetch.mock.calls.some(([url]) => url.includes('openrouter.ai'))).toBe(false);
    } finally { delete process.env.OPENROUTER_API_KEY; }
}, 20000);
