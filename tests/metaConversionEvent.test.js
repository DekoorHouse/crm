jest.mock('../server/config', () => ({ db: {}, admin: {}, bucket: {} }));
jest.mock('../server/aiUsage', () => ({ logAiUsage: jest.fn() }));
jest.mock('googleapis', () => ({ google: {} }));
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

const savedEnv = { ...process.env };
let sendConversionEvent, axios;

beforeEach(() => {
    jest.resetModules();
    process.env.META_PIXEL_ID = 'test-dataset';
    process.env.META_CAPI_ACCESS_TOKEN = 'test-token';
    process.env.FB_PAGE_ID = 'test-page';
    process.env.IG_BUSINESS_ID = 'test-ig-business';
    ({ sendConversionEvent } = require('../server/services'));
    axios = require('axios');
    axios.post.mockResolvedValue({ data: { events_received: 1 } });
    for (const method of ['log', 'warn', 'error']) jest.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => { process.env = { ...savedEnv }; jest.restoreAllMocks(); });

test('el payload usa el ID estable y exige confirmación de recepción', async () => {
    const args = ['Purchase', { wa_id: '5211234567890' }, { ctwa_clid: 'clid' }, { value: 750, currency: 'MXN' }, { eventId: 'Purchase_pedido_p1' }];
    expect(await sendConversionEvent(...args)).toEqual({ sent: true });
    const [, payload, options] = axios.post.mock.calls[0];
    expect(payload.data[0]).toMatchObject({ event_name: 'Purchase', event_id: 'Purchase_pedido_p1',
        action_source: 'business_messaging', messaging_channel: 'whatsapp', custom_data: { value: 750, currency: 'MXN' } });
    expect(options.timeout).toBe(30000);
    axios.post.mockResolvedValueOnce({ data: { events_received: 0 } });
    expect(await sendConversionEvent(...args)).toMatchObject({ sent: false });
});

test('sin credenciales no comunica éxito ni hace peticiones', async () => {
    delete process.env.META_CAPI_ACCESS_TOKEN;
    jest.resetModules();
    const service = require('../server/services');
    expect(await service.sendConversionEvent('Purchase', {}, {})).toMatchObject({ sent: false, needsReview: true });
    expect(require('axios').post).not.toHaveBeenCalled();
});

test('un contacto orgánico no comunica éxito ni hace peticiones', async () => {
    expect(await sendConversionEvent('Purchase', { wa_id: '5211234567890' }, {})).toMatchObject({ sent: false });
    expect(axios.post).not.toHaveBeenCalled();
});

test.each([
    [400, { code: 100, message: 'Página no conectada' }, true],
    [429, { message: 'Rate limit' }, false],
    [500, { message: 'Internal error' }, false],
    [400, { code: 2, is_transient: true, message: 'Temporal' }, false],
])('distingue rechazo de una falla transitoria HTTP %s', async (status, error, rejected) => {
    axios.post.mockRejectedValue({ response: { status, data: { error } } });
    await expect(sendConversionEvent('Purchase', { wa_id: '5211234567890' }, { ctwa_clid: 'clid' }))
        .rejects.toMatchObject({ metaRejected: rejected });
});
