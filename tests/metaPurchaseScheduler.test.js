let mockOrders = [];
let mockManual = [];
let mockReadError = null;
const mockSend = jest.fn();
const mockSchedule = jest.fn(() => ({}));
let mockSubscriptions = [];

jest.mock('node-cron', () => ({ schedule: (...args) => mockSchedule(...args) }));
jest.mock('../server/config', () => ({
    db: { collection: name => {
        const makeQuery = (size = Infinity, after = null, filters = []) => ({
            orderBy: () => makeQuery(size, after, filters), select: () => makeQuery(size, after, filters),
            where: (field, op, value) => makeQuery(size, after, [...filters, [field, value]]),
            limit: n => makeQuery(n, after, filters), startAfter: cursor => makeQuery(size, cursor.id, filters),
            onSnapshot: (next, error) => { mockSubscriptions.push({ name, filters, next, error }); return () => {}; },
            get: async () => {
                if (mockReadError) throw mockReadError;
                const rows = (name === 'pedidos' ? mockOrders : mockManual)
                    .filter(d => filters.every(([key, value]) => d.data()[key] === value));
                const start = after ? rows.findIndex(d => d.id === after) + 1 : 0;
                const docs = rows.slice(start, start + size);
                return { docs, size: docs.length, empty: !docs.length };
            },
        });
        return makeQuery();
    } },
    admin: {},
}));
jest.mock('../server/orders/metaPurchase', () => ({
    ...jest.requireActual('../server/orders/metaPurchase'),
    sendOrderPurchase: (...args) => mockSend(...args),
}));

const snapshot = (id, data) => ({ id, data: () => data });
const paid = (id, extra = {}) => snapshot(id, { comprobanteValidadoAt: '2026-09-14T12:00:00Z', estatus: 'Pagado', ...extra });
const originalEnv = { ...process.env };
let scheduler;

beforeEach(() => {
    jest.resetModules();
    mockOrders = [];
    mockManual = [];
    mockReadError = null;
    mockSubscriptions = [];
    mockSend.mockReset().mockImplementation(async id => {
        const doc = mockOrders.find(d => d.id === id);
        if (doc) doc.data().metaPurchaseSentAt = new Date().toISOString();
        return { success: true };
    });
    mockSchedule.mockClear();
    process.env.META_PIXEL_ID = 'test-pixel';
    process.env.META_CAPI_ACCESS_TOKEN = 'test-token';
    scheduler = require('../server/orders/metaPurchaseScheduler');
    for (const method of ['log', 'warn', 'error']) jest.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => { process.env = { ...originalEnv }; jest.restoreAllMocks(); });

test('el arranque y el cron envían pedidos sin navegador ni peticiones HTTP', async () => {
    mockOrders = [paid('arranque')];
    scheduler.startMetaPurchaseScheduler();
    scheduler.startMetaPurchaseScheduler();
    await new Promise(setImmediate);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule.mock.calls[0][0]).toBe('*/5 * * * *');
    expect(mockSend).toHaveBeenCalledWith('arranque', { source: 'envios_scheduler' });
    mockOrders.unshift(paid('nuevo'));
    await mockSchedule.mock.calls[0][1]();
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenLastCalledWith('nuevo', { source: 'envios_scheduler' });
    expect(scheduler.getMetaPurchaseSchedulerStatus()).toMatchObject({
        started: true, running: false, intervalMinutes: 5, lastResult: { sent: 1 }, lastError: null,
    });
});

test('incluye pendientes después de varias páginas y respeta el historial despachado', async () => {
    mockOrders = Array.from({ length: 620 }, (_, i) => paid(`enviado-${i}`, { metaPurchaseSentAt: '2026-09-14T12:00:00Z' }));
    mockOrders[0] = paid('reciente-con-guia', { guiaEnvio: { guia: '1' } });
    mockOrders.push(paid('antiguo-sin-guia'));
    mockOrders.push(paid('historial-con-guia', { guiaEnvio: { guia: '2' } }));
    mockOrders.push(paid('manual-enlazado', { consecutiveOrderNumber: 123, guiaEnvio: { guia: '3' } }));
    mockOrders.push(paid('reposicion', { estatus: 'Reenvio', guiaEnvio: { guia: '4' } }));
    mockManual = [snapshot('m1', { orderNumber: 'DH123' }), snapshot('m2', { orderNumber: 'DH123' })];
    const result = await scheduler.runMetaPurchaseSweep();
    expect(result).toMatchObject({ scanned: 624, attempted: 4, sent: 4 });
    expect(mockSend.mock.calls.map(args => args[0])).toEqual(['reciente-con-guia', 'antiguo-sin-guia', 'manual-enlazado', 'reposicion']);
});

test('omite enviados, no aplica, ocultos, cancelados, anticipos sin pago y reservas vigentes', async () => {
    const future = { toMillis: () => Date.now() + 60000 };
    mockOrders = [
        paid('enviado', { metaPurchaseSentAt: '2026-09-14T12:00:00Z' }),
        paid('no-aplica', { metaPurchaseSentAt: '2026-09-14T12:00:00Z', metaPurchaseManual: 'no_aplica_organico' }),
        paid('organico', { metaPurchaseResolvedAt: '2026-09-14T12:00:00Z', metaPurchaseResolution: 'organico' }),
        paid('revisado', { metaPurchaseResolvedAt: '2026-09-14T12:00:00Z', metaPurchaseResolution: 'revisado' }),
        paid('rechazado', { metaPurchaseRejectedAt: '2026-09-14T12:00:00Z' }),
        paid('oculto', { ocultoDeEnvios: true }), paid('cancelado', { estatus: 'Cancelado' }),
        paid('sin-pago', { comprobanteValidadoAt: null }), paid('devuelto', { estatus: 'Devuelto' }),
        paid('reservado', { metaPurchaseLeaseUntil: future }), paid('en-espera', { metaPurchaseNextAttemptAt: future }),
        paid('listo'),
    ];
    await scheduler.runMetaPurchaseSweep();
    expect(mockSend.mock.calls.map(args => args[0])).toEqual(['listo']);
});

test('un error por pedido no bloquea el resto y vuelve a intentarse en otra corrida', async () => {
    mockOrders = [paid('falla'), paid('bien')];
    mockSend.mockRejectedValueOnce(new Error('Firestore no disponible'));
    expect(await scheduler.runMetaPurchaseSweep()).toMatchObject({ sent: 1, pending: 1 });
    expect(await scheduler.runMetaPurchaseSweep()).toMatchObject({ sent: 1, pending: 0 });
    expect(mockSend.mock.calls.map(args => args[0])).toEqual(['falla', 'bien', 'falla']);
});

test('una corrida lenta no se solapa con el siguiente disparo', async () => {
    let release, notify;
    const started = new Promise(resolve => { notify = resolve; });
    mockOrders = [paid('p1')];
    mockSend.mockImplementation(() => { notify(); return new Promise(resolve => { release = resolve; }); });
    const first = scheduler.runMetaPurchaseSweep();
    await started;
    expect(await scheduler.runMetaPurchaseSweep()).toEqual({ skipped: 'already_running' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    release({ success: true });
    await first;
    expect(scheduler.getMetaPurchaseSchedulerStatus().running).toBe(false);
});

test('el siguiente ciclo se recupera tras una falla al leer Firestore', async () => {
    mockReadError = new Error('Firestore no disponible');
    expect(await scheduler.runMetaPurchaseSweep()).toMatchObject({ error: 'Firestore no disponible' });
    expect(scheduler.getMetaPurchaseSchedulerStatus().running).toBe(false);
    mockReadError = null;
    mockOrders = [paid('p1')];
    expect(await scheduler.runMetaPurchaseSweep()).toMatchObject({ sent: 1 });
    expect(scheduler.getMetaPurchaseSchedulerStatus().lastError).toBeNull();
});

test('puede resolver orgánicos sin credenciales de Meta y no los cuenta como enviados', async () => {
    delete process.env.META_CAPI_ACCESS_TOKEN;
    mockOrders = [paid('p1')];
    mockSend.mockImplementation(async () => {
        mockOrders[0].data().metaPurchaseResolvedAt = new Date().toISOString();
        return { success: true, metaPurchaseNoAplica: true, metaPurchaseMotivo: 'organico' };
    });
    expect(await scheduler.runMetaPurchaseSweep()).toMatchObject({ attempted: 1, sent: 0, organic: 1 });
    expect(await scheduler.runMetaPurchaseSweep()).toMatchObject({ attempted: 0 });
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('un pago nuevo dispara el envío desde Firestore sin esperar el cron', async () => {
    scheduler.startMetaPurchaseScheduler();
    await new Promise(setImmediate);
    const doc = paid('nuevo-pago');
    mockOrders.push(doc);
    const listener = mockSubscriptions.find(s => s.name === 'pedidos' && !s.filters.length);
    listener.next({ docChanges: () => [{ type: 'added', doc }] });
    await new Promise(setImmediate);
    expect(mockSend).toHaveBeenCalledWith('nuevo-pago', { source: 'envios_scheduler' });
    expect(scheduler.getMetaPurchaseSchedulerStatus().realtime).toMatchObject({ listeners: { pedidos: true }, sent: 1 });
});

test('el listener distingue orgánicos y no reenvía rechazos ni revisados', async () => {
    scheduler.startMetaPurchaseScheduler();
    await new Promise(setImmediate);
    mockSend.mockResolvedValue({ success: true, metaPurchaseNoAplica: true, metaPurchaseMotivo: 'organico' });
    const listener = mockSubscriptions.find(s => s.name === 'pedidos' && !s.filters.length);
    const stamp = new Date().toISOString();
    listener.next({ docChanges: () => [paid('organico'), paid('rechazado', { metaPurchaseRejectedAt: stamp }),
        paid('revisado', { metaPurchaseResolvedAt: stamp })].map(doc => ({ type: 'added', doc })) });
    await new Promise(setImmediate);
    expect(mockSend.mock.calls.map(args => args[0])).toEqual(['organico']);
    expect(scheduler.getMetaPurchaseSchedulerStatus().realtime).toMatchObject({ sent: 0, organic: 1 });
});

test('los avisos duplicados y los cambios del propio envío no vuelven a mandar el evento', async () => {
    scheduler.startMetaPurchaseScheduler();
    await new Promise(setImmediate);
    let release;
    mockSend.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const doc = paid('p1');
    const listener = mockSubscriptions.find(s => s.name === 'pedidos' && !s.filters.length);
    const changes = { docChanges: () => [{ type: 'added', doc }, { type: 'modified', doc }] };
    listener.next(changes);
    await new Promise(setImmediate);
    listener.next(changes);
    await new Promise(setImmediate);
    expect(mockSend).toHaveBeenCalledTimes(1);
    release({ success: true });
    await new Promise(setImmediate);
    doc.data().metaPurchaseSentAt = new Date().toISOString();
    listener.next(changes);
    await new Promise(setImmediate);
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('una línea manual nueva enlazada a un pedido pagado antiguo también dispara el envío', async () => {
    scheduler.startMetaPurchaseScheduler();
    await new Promise(setImmediate);
    mockOrders = [paid('pedido-antiguo', { consecutiveOrderNumber: 777, guiaEnvio: { guia: 'ya-generada' } })];
    const doc = snapshot('manual', { orderNumber: 'DH777' });
    const listener = mockSubscriptions.find(s => s.name === 'envios_manuales');
    listener.next({ docChanges: () => [{ type: 'added', doc }] });
    await new Promise(setImmediate);
    expect(mockSend).toHaveBeenCalledWith('pedido-antiguo', { source: 'envios_scheduler' });
    listener.next({ docChanges: () => [{ type: 'modified', doc }] });
    await new Promise(setImmediate);
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test('una reposición pagada que entra en Envíos se procesa en tiempo real', async () => {
    scheduler.startMetaPurchaseScheduler();
    await new Promise(setImmediate);
    const doc = paid('reposicion-antigua', { estatus: 'Reenvio' });
    const listener = mockSubscriptions.find(s => s.filters.some(([field]) => field === 'estatus'));
    listener.next({ docChanges: () => [{ type: 'added', doc }] });
    await new Promise(setImmediate);
    expect(mockSend).toHaveBeenCalledWith('reposicion-antigua', { source: 'envios_scheduler' });
});

test('si un listener termina con error, se conecta otra vez automáticamente', async () => {
    jest.useFakeTimers();
    try {
        scheduler.startMetaPurchaseScheduler();
        await jest.advanceTimersByTimeAsync(0);
        mockSubscriptions[0].error(new Error('conexión interrumpida'));
        expect(scheduler.getMetaPurchaseSchedulerStatus().realtime.listeners.pedidos).toBe(false);
        await jest.advanceTimersByTimeAsync(30000);
        expect(mockSubscriptions).toHaveLength(4);
        mockSubscriptions[3].next({ docChanges: () => [] });
        await jest.advanceTimersByTimeAsync(0);
        expect(scheduler.getMetaPurchaseSchedulerStatus().realtime).toMatchObject({ listeners: { pedidos: true }, errors: {} });
    } finally { jest.useRealTimers(); }
});
