const mockDb = require('./helpers/paymentFirestore')();
jest.mock('../server/config', () => ({ db: mockDb, admin: { firestore: { Timestamp: { fromMillis: n => new Date(n) } } } }));
const { purchaseIntent, scopeIncomingMessage, inPurchase } = require('../server/orders/purchaseSessions');
beforeEach(() => {
    mockDb.reset();
    mockDb.seed('contacts_whatsapp/c', { aiStage: 'postventa' });
    mockDb.seed('pedidos/old', { contactId: 'c', consecutiveOrderNumber: 1001, estatus: 'Enviado', guiaEnvio: { guia: '123' } });
});
test.each(['¿Dónde está mi guía?', 'Necesito otra guía', 'Quiero una reposición', 'No quiero otro pedido'])('does not open a purchase for support: %s', text => {
    expect(purchaseIntent(text)).toBe('existing');
});
test('starts at customer intent, preserves old order, and retries keep one session', async () => {
    const m = { text: 'Quiero otra lámpara de corazones', timestamp: new Date(1000) };
    const first = await scopeIncomingMessage('c', 'm1', m);
    expect(first.purchaseSessionId).toBeTruthy();
    expect(await scopeIncomingMessage('c', 'm1', m)).toEqual(first);
    expect(mockDb.all('contacts_whatsapp/c/purchase_sessions')).toHaveLength(1);
    expect(mockDb.read('contacts_whatsapp/c')).toMatchObject({ aiStage: 'venta', activePurchaseStartedAt: new Date(1000), paymentNewOrderRequestedAt: new Date(1000) });
    expect(mockDb.read('pedidos/old').estatus).toBe('Enviado');
    expect(await scopeIncomingMessage('c', 'deposit', { type: 'image', timestamp: new Date(1100) })).toEqual(first);
});
test('ambiguous request asks before separating and accepts explicit clarification', async () => {
    expect(await scopeIncomingMessage('c', 'm1', { text: 'Quiero otra', timestamp: new Date(1000) })).toEqual({ purchaseNeedsClarification: true });
    expect(mockDb.read('contacts_whatsapp/c').activePurchaseSessionId).toBeUndefined();
    const reply = await scopeIncomingMessage('c', 'm2', { text: 'Una compra nueva', timestamp: new Date(2000) });
    expect(reply.purchaseSessionId).toBeTruthy();
    expect(mockDb.read('contacts_whatsapp/c').purchaseClarificationPending).toBe(false);
});
test('explicit old DH does not switch the active purchase', async () => {
    const first = await scopeIncomingMessage('c', 'new', { text: 'Quiero otro pedido', timestamp: new Date(1000) });
    expect(await scopeIncomingMessage('c', 'old', { text: 'La guía de DH1001', timestamp: new Date(2000) })).toEqual({ purchaseOrderId: 'old' });
    expect(mockDb.read('contacts_whatsapp/c').activePurchaseSessionId).toBe(first.purchaseSessionId);
});
test('history isolates old names, photos and payments but keeps the opening message', () => {
    const contact = { activePurchaseSessionId: 'new', activePurchaseStartedAt: new Date(1000) };
    expect(inPurchase({ timestamp: new Date(999) }, contact)).toBe(false);
    expect(inPurchase({ timestamp: new Date(1000) }, contact)).toBe(true);
    expect(inPurchase({ timestamp: new Date(2000), purchaseSessionId: 'old' }, contact)).toBe(false);
});
test('DH17006: a delivered customer asking for a new lamp is asked once, then the lamp opens the purchase', async () => {
    expect(await scopeIncomingMessage('c', 'q', { text: '¿Tendrán más variedad? Como otros estilos?', timestamp: new Date(1000) })).toEqual({ purchaseNeedsClarification: true });
    const reply = await scopeIncomingMessage('c', 'lamp', { text: 'Si yo soy transportista y quisiera una lámpara con un trailer', timestamp: new Date(2000) });
    expect(reply.purchaseSessionId).toBeTruthy();
    expect(mockDb.read('contacts_whatsapp/c').purchaseClarificationPending).toBe(false);
});
test('the clarification is asked only once: a vague answer returns to the previous order', async () => {
    await scopeIncomingMessage('c', 'q', { text: 'Quiero otra', timestamp: new Date(1000) });
    expect(await scopeIncomingMessage('c', 'yes', { text: 'Sí', timestamp: new Date(2000) })).toEqual({});
    expect(mockDb.read('contacts_whatsapp/c').purchaseClarificationPending).toBe(false);
    expect(mockDb.read('contacts_whatsapp/c').activePurchaseSessionId).toBeUndefined();
});
