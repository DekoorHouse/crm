const mockDocs = new Map();
let mockTransactions = Promise.resolve();
let mockFailStamp = false;
const mockTimestamp = ms => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const mockSnapshot = path => ({ exists: mockDocs.has(path), data: () => ({ ...mockDocs.get(path) }) });

jest.mock('../server/config', () => ({
    db: {
        collection: col => ({ doc: id => ({ id, path: `${col}/${id}`, get: async () => mockSnapshot(`${col}/${id}`) }) }),
        // Transacciones serializadas: representa la exclusión entre instancias/pestañas.
        runTransaction: callback => {
            const run = mockTransactions.then(async () => {
                const writes = [];
                const result = await callback({
                    get: async ref => mockSnapshot(ref.path),
                    update: (ref, fields) => writes.push([ref.path, fields]),
                });
                for (const [path, fields] of writes) {
                    if (mockFailStamp && fields.metaPurchaseSentAt) {
                        mockFailStamp = false;
                        throw new Error('Firestore temporalmente no disponible');
                    }
                    const doc = mockDocs.get(path);
                    for (const [key, value] of Object.entries(fields)) {
                        if (value === '__DELETE__') delete doc[key];
                        else doc[key] = value;
                    }
                }
                return result;
            });
            mockTransactions = run.catch(() => {});
            return run;
        },
    },
    admin: { firestore: {
        Timestamp: { fromMillis: ms => mockTimestamp(ms) },
        FieldValue: { delete: () => '__DELETE__', serverTimestamp: () => mockTimestamp(Date.now()) },
    } },
}));

jest.mock('../server/services', () => ({
    messagingContactInfo: jest.fn(contact => ({ wa_id: contact.wa_id })),
    pickAdReferralForConversion: jest.fn(() => ({ source_id: 'ad-correcto', ctwa_clid: 'clid' })),
    resolveMessagingIdentity: jest.fn(() => ({ messagingChannel: 'whatsapp' })),
    sendConversionEvent: jest.fn(),
}));

const { sendOrderPurchase } = require('../server/orders/metaPurchase');
const services = require('../server/services');
const automatic = { source: 'envios_auto' };
const order = () => mockDocs.get('pedidos/p1');

beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T12:00:00Z'));
    mockDocs.clear();
    mockTransactions = Promise.resolve();
    mockFailStamp = false;
    mockDocs.set('pedidos/p1', {
        contactId: 'c1', precio: 750, consecutiveOrderNumber: 123, estatus: 'Foto enviada',
        comprobanteValidadoAt: mockTimestamp(Date.now()), createdAt: mockTimestamp(Date.now() - 86400000),
        attributedAdId: 'ad-correcto',
    });
    mockDocs.set('contacts_whatsapp/c1', { wa_id: '5211234567890' });
    jest.clearAllMocks();
    services.sendConversionEvent.mockReset().mockResolvedValue({ sent: true });
    services.resolveMessagingIdentity.mockReturnValue({ messagingChannel: 'whatsapp' });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('recupera un pagado sin exigir Fabricar, usando importe y atribución del pedido', async () => {
    const result = await sendOrderPurchase('p1', automatic);
    expect(result).toMatchObject({ success: true, valor: 750 });
    expect(order().metaPurchaseSentAt).toBeTruthy();
    expect(order().metaPurchaseSource).toBe('envios_auto');
    expect(order().metaPurchaseManual).toBe(false);
    expect(order().metaPurchaseLeaseToken).toBeUndefined();
    expect(services.pickAdReferralForConversion).toHaveBeenCalledWith(mockDocs.get('contacts_whatsapp/c1'), {
        attributedAdId: 'ad-correcto', before: order().createdAt,
    });
    expect(services.sendConversionEvent).toHaveBeenCalledWith('Purchase', expect.any(Object), expect.any(Object),
        { value: 750, currency: 'MXN' }, { eventId: 'Purchase_pedido_p1' });
});

test.each([true, 'no_aplica_organico', 'no_aplica_rechazado'])('no repite un pedido sellado (%s)', async manual => {
    order().metaPurchaseSentAt = mockTimestamp(Date.now());
    order().metaPurchaseManual = manual;
    const result = await sendOrderPurchase('p1', automatic);
    expect(result).toMatchObject({ success: true, already: true, metaPurchaseNoAplica: typeof manual === 'string' });
    expect(services.sendConversionEvent).not.toHaveBeenCalled();
});

test('dos pestañas y Fabricar comparten reserva; solo sale un Purchase', async () => {
    let release, started;
    const sending = new Promise(resolve => { started = resolve; });
    services.sendConversionEvent.mockImplementation(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const first = sendOrderPurchase('p1', automatic);
    await sending;
    const rest = await Promise.all([
        sendOrderPurchase('p1', automatic), sendOrderPurchase('p1', { source: 'fabricar' }),
        sendOrderPurchase('p1', { source: 'registration' }), sendOrderPurchase('p1'),
        sendOrderPurchase('p1', { source: 'envios_scheduler' }),
    ]);
    expect(rest.every(r => r.inProgress && !r.success)).toBe(true);
    expect(services.sendConversionEvent).toHaveBeenCalledTimes(1);
    release({ sent: true });
    await first;
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ already: true });
});

test('un fallo mantiene pendiente, aplica espera compartida y reintenta con el mismo identificador', async () => {
    services.sendConversionEvent.mockRejectedValueOnce(new Error('timeout'));
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ success: false, rechazado: false, retryAfterMs: 300000 });
    expect(order().metaPurchaseSentAt).toBeUndefined();
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ deferred: true });
    expect(services.sendConversionEvent).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(300001);
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ success: true });
    expect(services.sendConversionEvent.mock.calls.map(args => args[4].eventId)).toEqual(['Purchase_pedido_p1', 'Purchase_pedido_p1']);
});

test('si Meta recibió pero falla guardar el sello, el reintento conserva el event_id', async () => {
    mockFailStamp = true;
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ success: false });
    expect(order().metaPurchaseSentAt).toBeUndefined();
    jest.advanceTimersByTime(300001);
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ success: true });
    expect(services.sendConversionEvent.mock.calls[0][4]).toEqual(services.sendConversionEvent.mock.calls[1][4]);
});

test.each([undefined, { sent: false, reason: 'faltan credenciales' }])('sin confirmación de Meta no sella la compra (%j)', async result => {
    services.sendConversionEvent.mockResolvedValue(result);
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ success: false, status: 503 });
    expect(order().metaPurchaseSentAt).toBeUndefined();
});

test('orgánicos y rechazos quedan pendientes; jamás se marcan no aplica automáticamente', async () => {
    services.resolveMessagingIdentity.mockReturnValue(null);
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ organico: true, success: false });
    expect(order().metaPurchaseSentAt).toBeUndefined();
    expect(services.sendConversionEvent).not.toHaveBeenCalled();
    expect(await sendOrderPurchase('p1', { ...automatic, force: true })).toMatchObject({ status: 400 });
    expect(order().metaPurchaseSentAt).toBeUndefined();
    expect(await sendOrderPurchase('p1', { force: true })).toMatchObject({ success: true, metaPurchaseNoAplica: true, metaPurchaseMotivo: 'organico' });
});

test('un rechazo de Meta conserva el motivo y permite la acción manual existente', async () => {
    services.sendConversionEvent.mockRejectedValue(Object.assign(new Error('página no conectada'), { metaRejected: true }));
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ status: 409, rechazado: true, success: false });
    expect(order().metaPurchaseSentAt).toBeUndefined();
    expect(await sendOrderPurchase('p1', { force: true })).toMatchObject({ metaPurchaseNoAplica: true, metaPurchaseMotivo: 'rechazado' });
    expect(services.sendConversionEvent).toHaveBeenCalledTimes(1);
});

test.each([
    { comprobanteValidadoAt: null }, { estatus: 'Cancelado' }, { estatus: 'Devuelto' }, { ocultoDeEnvios: true },
    { precio: 0 }, { precio: 'NaN' }, { contactId: null },
])('no envía compras sin datos válidos: %j', async fields => {
    Object.assign(order(), fields);
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ success: false });
    expect(services.sendConversionEvent).not.toHaveBeenCalled();
    expect(order().metaPurchaseSentAt).toBeUndefined();
});

test('la reserva expira si un proceso muere antes de enviar', async () => {
    order().metaPurchaseLeaseToken = 'proceso-anterior';
    order().metaPurchaseLeaseUntil = mockTimestamp(Date.now() - 1);
    expect(await sendOrderPurchase('p1', automatic)).toMatchObject({ success: true });
});

test('el scheduler respeta la validación de pago y la espera entre reintentos', async () => {
    const background = { source: 'envios_scheduler' };
    order().comprobanteValidadoAt = null;
    expect(await sendOrderPurchase('p1', background)).toMatchObject({ skipped: true });
    expect(services.sendConversionEvent).not.toHaveBeenCalled();
    order().comprobanteValidadoAt = mockTimestamp(Date.now());
    services.sendConversionEvent.mockRejectedValueOnce(new Error('timeout'));
    expect(await sendOrderPurchase('p1', background)).toMatchObject({ success: false });
    expect(await sendOrderPurchase('p1', background)).toMatchObject({ deferred: true });
    expect(await sendOrderPurchase('p1', { ...background, force: true })).toMatchObject({ status: 400 });
    jest.advanceTimersByTime(300001);
    expect(await sendOrderPurchase('p1', background)).toMatchObject({ success: true });
    expect(order().metaPurchaseSource).toBe('envios_scheduler');
});
