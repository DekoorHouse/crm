const mockDb = require('./helpers/paymentFirestore')();
const mockExtract = jest.fn();
jest.mock('../server/config', () => ({ db: mockDb, admin: { firestore: { FieldValue: { serverTimestamp: () => new Date() } } } }));
jest.mock('../server/orders/aiOrderRegistration', () => ({ getAiOrderConfig: async () => ({ catalogText: '' }), extractOrderDetailed: (...args) => mockExtract(...args) }));
const draft = require('../server/orders/receiptOrderDraft');
const { paymentDecision, canRequestShippingForm } = require('../server/payments/paymentPolicy');
const ref = () => mockDb.collection('payment_receipts').doc('receipt');
beforeEach(() => {
    mockDb.reset(); mockExtract.mockReset().mockResolvedValue({ extraction: { listo: false, items: [], faltante: 'Nombre' } });
    mockDb.seed('contacts_whatsapp/c', { name: 'Cliente' });
    mockDb.seed('payment_receipts/receipt', { contactId: 'c', open: true, status: 'review' });
});
test('concurrent creation binds one order and never applies the receipt before validation', async () => {
    const results = await Promise.all([draft.createDraft(ref(), { description: 'Lámpara', total: '', missing: 'Nombre y modelo' }), draft.createDraft(ref(), { description: 'Lámpara', total: '', missing: 'Nombre y modelo' })]);
    expect(results[0].orderId).toBe(results[1].orderId);
    expect(mockDb.all('pedidos')).toHaveLength(1);
    expect(mockDb.read('payment_receipts/receipt').status).toBe('review');
    const order = mockDb.read('pedidos/' + results[0].orderId);
    expect(order).toMatchObject({ totalPending: true, orderDataPending: true, estatus: 'Pendiente de datos' });
    expect(paymentDecision(order, 30000, true)).toMatchObject({ status: 'partial', receivedCents: 30000, remainingCents: null });
    expect(canRequestShippingForm({ ...order, comprobanteValidadoAt: new Date() })).toBe(false);
});
test('an existing order prevents another draft', async () => {
    mockDb.seed('pedidos/existing', { contactId: 'c', estatus: 'Sin estatus' });
    await expect(draft.createDraft(ref(), { description: 'Lámpara', total: 750 })).rejects.toThrow('ya tiene');
    expect(mockDb.all('pedidos')).toHaveLength(1);
});
test('failed transaction cannot leave a receipt linked to a missing order', async () => {
    mockDb.failNext('commit', 'pedidos');
    await expect(draft.createDraft(ref(), { description: 'Lámpara', total: 750 })).rejects.toThrow();
    expect(mockDb.all('pedidos')).toHaveLength(0);
    expect(mockDb.read('payment_receipts/receipt').orderId).toBeUndefined();
});
test('follow-up asks missing information once and completion updates the same paid draft', async () => {
    const { orderId } = await draft.createDraft(ref(), { description: 'Lámpara', total: 750, missing: 'Nombre y personaje' });
    mockDb.seed('pedidos/' + orderId, { ...mockDb.read('pedidos/' + orderId), paymentReceivedCents: 30000, orderDataFollowupPending: true });
    await draft.followupDrafts(); await draft.followupDrafts();
    expect(mockDb.all('contacts_whatsapp/c/messages')).toHaveLength(1);
    expect(mockDb.all('contacts_whatsapp/c/messages')[0].text).toContain('Nombre y personaje');
    mockExtract.mockResolvedValue({ extraction: { listo: true, confianza: 95, total: 750, items: [{ producto: 'Lámpara infantil', precio: 750, cantidad: 1, datosProducto: 'Kuromi, Renata' }] } });
    mockDb.seed('contacts_whatsapp/c', { ...mockDb.read('contacts_whatsapp/c'), lastClientMsgAt: new Date(Date.now() + 1000) });
    await draft.completeDraft('c');
    expect(mockDb.all('pedidos')).toHaveLength(1);
    expect(mockDb.read('pedidos/' + orderId)).toMatchObject({ orderDataPending: false, paymentReceivedCents: 30000, paymentProductionPending: true });
});
test('uncertain extraction cannot release production', async () => {
    const { orderId } = await draft.createDraft(ref(), { description: 'Lámpara', total: 750, missing: 'Nombre' });
    await draft.completeDraft('c');
    expect(mockDb.read('pedidos/' + orderId).orderDataPending).toBe(true);
});

test('approved money cannot release manufacturing while information or deposit is missing', async () => {
    const { orderId } = await draft.createDraft(ref(), { description: 'Lámpara', total: 750, missing: 'Nombre', requiredDeposit: 300 });
    const production = require('../server/payments/paymentProduction');
    mockDb.seed('pedidos/' + orderId, { ...mockDb.read('pedidos/' + orderId), paymentReceivedCents: 10000, paymentProductionPending: true });
    await production.reconcilePaymentProduction(orderId);
    expect(mockDb.read('pedidos/' + orderId).paymentProductionStatus).toBe('pending_data');
    mockDb.seed('pedidos/' + orderId, { ...mockDb.read('pedidos/' + orderId), orderDataPending: false, estatus: 'Sin estatus' });
    await production.reconcilePaymentProduction(orderId);
    expect(mockDb.read('pedidos/' + orderId)).toMatchObject({ estatus: 'Sin estatus', paymentProductionStatus: 'pending_deposit' });
});
