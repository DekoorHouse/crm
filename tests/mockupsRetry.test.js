jest.mock('../server/config', () => ({
    db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ aiImageProvider: 'openrouter' }) }) }) }) },
    bucket: {},
}));
jest.mock('node-fetch', () => jest.fn());
const fetch = require('node-fetch');
const svc = require('../server/mockups/mockupsService');

beforeAll(() => { process.env.OPENROUTER_API_KEY = 'test'; svc.IMAGE_RETRY_DELAYS_MS.splice(0, 2, 1, 1); });
beforeEach(() => fetch.mockReset());

const ok = { ok: true, json: async () => ({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,AAAA' } }] } }], usage: { cost: 0.13 } }) };
const saturado = { ok: true, json: async () => ({ error: { code: 503, message: 'Retry limit exceeded - status: 503' } }) };

test('un 503 momentáneo se reintenta y la imagen sale', async () => {
    fetch.mockResolvedValueOnce(saturado).mockResolvedValueOnce(ok);
    const r = await svc.generateImage('prompt', '1:1', [], '2K', 1024);
    expect(r.images).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
});

test('si sigue saturado tras los reintentos, el mensaje lo explica', async () => {
    fetch.mockResolvedValue(saturado);
    await expect(svc.generateImage('prompt', '1:1', [], '2K', 1024)).rejects.toThrow(/saturado/);
    expect(fetch).toHaveBeenCalledTimes(3);
});

test('un rechazo del prompt no se reintenta', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'No puedo generar eso.' } }] }) });
    await expect(svc.generateImage('prompt', '1:1', [], '2K', 1024)).rejects.toThrow(/No puedo/);
    expect(fetch).toHaveBeenCalledTimes(1);
});
