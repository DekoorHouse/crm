const makeDb = require('./helpers/paymentFirestore');
const { reminderEligibility } = require('../server/leads/reminderEligibility');
let db;
beforeEach(() => { db = makeDb(); db.seed('contacts_whatsapp/c', {}); });
const order = data => db.seed('pedidos/o', { contactId: 'c', createdAt: new Date('2026-09-18'), ...data });
test.each([
    { paymentReceivedCents: 120000 }, { paymentReceivedCents: 30000 },
    { comprobanteValidadoAt: new Date() }, { paymentReportedComplete: true },
    { guiaEnvio: { guia: '2167287835' } }, { shippingDataReceivedAt: new Date() },
    { estatus: 'Pagado' }, { estatus: 'Enviado' }, { estatus: 'Entregado' },
])('blocks advanced order even when reminder was armed after purchase: %j', async data => {
    order(data);
    expect(await reminderEligibility(db, 'c', { createdAt: new Date('2026-09-23') })).toMatchObject({ allowed: false });
});
test('allows a lead and an unpaid order', async () => {
    expect((await reminderEligibility(db, 'c')).allowed).toBe(true);
    order({ estatus: 'Esperando anticipo', paymentReceivedCents: 0 });
    expect((await reminderEligibility(db, 'c')).allowed).toBe(true);
});
test('new explicit purchase is not blocked by an old paid order', async () => {
    order({ estatus: 'Pagado' });
    db.seed('contacts_whatsapp/c', { activePurchaseSessionId: 'new', activePurchaseStartedAt: new Date('2026-09-23') });
    expect(await reminderEligibility(db, 'c')).toEqual({ allowed: true, purchaseSessionId: 'new' });
    expect((await reminderEligibility(db, 'c', { purchaseSessionId: 'new' })).allowed).toBe(true);
    expect((await reminderEligibility(db, 'c', {})).allowed).toBe(false);
});
test('blocks after the new purchase receives an advance', async () => {
    db.seed('contacts_whatsapp/c', { activePurchaseSessionId: 'new' });
    order({ purchaseSessionId: 'new', paymentReceivedCents: 30000 });
    expect((await reminderEligibility(db, 'c', { purchaseSessionId: 'new' })).allowed).toBe(false);
});
test('read failures never return permission to send', async () => {
    db.failNext('get', 'pedidos');
    await expect(reminderEligibility(db, 'c')).rejects.toThrow();
});
