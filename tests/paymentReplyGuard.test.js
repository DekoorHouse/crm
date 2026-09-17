const mockDb = require('./helpers/paymentFirestore')();
jest.mock('../server/config', () => ({ db: mockDb, admin: { firestore: { FieldValue: { serverTimestamp: () => new Date() } } } }));
const { protectPaymentReply, paymentReplyCategory, waitingForPaymentHelp, HANDOFF } = require('../server/payments/paymentReplyGuard');
const { evaluateFollowup } = require('../server/leads/leadReactivationLogic');
const { evaluateOrderFollowup } = require('../server/leads/orderFollowupLogic');
const request = 'Para confirmar tu pago necesitamos revisar la foto o el PDF del comprobante. ¿Nos lo compartes por aquí, por favor?';
const contact = () => mockDb.read('contacts_whatsapp/c1');
const run = extra => protectPaymentReply({ contactRef: mockDb.collection('contacts_whatsapp').doc('c1'), contactId: 'c1', text: request, ...extra });
beforeEach(() => { mockDb.reset(); mockDb.seed('contacts_whatsapp/c1', { botActive: true }); });

test('once intentos sólo permiten una solicitud y una derivación; después permanece en Atención', async () => {
    const replies = [];
    for (let i = 0; i < 11; i++) { const result = await run(); if (result.text) replies.push(result.text); }
    expect(replies).toEqual([request, HANDOFF]);
    expect(contact()).toMatchObject({ botActive: false, needsAttention: true, needsAttentionReason: 'payment_reply_loop' });
});

test('detecta el ciclo antiguo aunque no exista todavía el contador persistente', async () => {
    expect(await run({ history: [{ from: 'business', text: request, timestamp: new Date() }] })).toEqual({ text: HANDOFF, stop: true });
});

test('si el cliente dice que ya lo envió y hay imagen, no solicita otra copia ni confirma dinero', async () => {
    expect(await run({ customerText: 'Ya te lo compartí', history: [{ from: 'c1', type: 'image', timestamp: new Date() }] })).toEqual({ text: HANDOFF, stop: true });
    expect(contact().comprobanteValidadoAt).toBeUndefined();
});

test('un comprobante pendiente tampoco vuelve a solicitarse', async () => {
    expect((await run({ context: { pending: 1 } })).stop).toBe(true);
});

test('transacciones simultáneas no mandan once respuestas', async () => {
    const replies = await Promise.all(Array.from({ length: 11 }, () => run()));
    expect(replies.filter(x => x.text).map(x => x.text)).toEqual([request, HANDOFF]);
});

test('la espera de revisión no sustituye la solicitud por otro bucle de mensajes iguales', async () => {
    const text = 'Recibimos tu comprobante y el equipo está revisando que el importe se haya acreditado. No necesitas volver a mandar la misma imagen.';
    expect((await run({ text })).stop).toBe(false);
    expect(await run({ text })).toEqual({ text: HANDOFF, stop: true });
    expect((await run({ text })).text).toBeNull();
});

test('un fallo de registro deriva de inmediato y los recordatorios automáticos respetan la pausa', async () => {
    const { REGISTRATION_PENDING } = require('../server/orders/registrationTurn');
    expect((await run({ text: REGISTRATION_PENDING })).stop).toBe(true);
    expect(waitingForPaymentHelp(contact())).toBe(true);
    expect(evaluateFollowup({}, contact(), {}, Date.now()).action).toBe('wait');
    expect(evaluateOrderFollowup({}, contact(), {}, Date.now()).action).toBe('wait');
    // Un nuevo mensaje con la IA apagada cambia la etiqueta a ai_off; la pausa sigue vigente.
    expect(waitingForPaymentHelp({ ...contact(), needsAttentionReason: 'ai_off' })).toBe(true);
});

test('no bloquea la confirmación de un pago validado ni preguntas ajenas al pago', async () => {
    expect(paymentReplyCategory('El equipo está revisando tu diseño.')).toBeNull();
    expect(paymentReplyCategory('No necesitas volver a llenar el formulario de envío.')).toBeNull();
    expect(paymentReplyCategory('Tu pago completo de DH16809 ya está registrado. No necesitas volver a pagar ni reenviar el comprobante.')).toBeNull();
    expect(await run({ text: 'El equipo te compartirá la guía de envío.' })).toEqual({ text: 'El equipo te compartirá la guía de envío.', stop: false });
    const result = await run({ context: { hasPaid: true, orderNumber: 'DH16809' } });
    expect(result.text).toContain('DH16809 ya está registrado');
    expect(result.stop).toBe(false);
});

test('el pago o pedido nuevo inicia su propio control sin heredar solicitudes anteriores', async () => {
    await run(); await run();
    const old = new Date(Date.now() - 10000), current = Date.now();
    const result = await run({ context: { orderId: 'nuevo', contextSince: current }, history: [{ from: 'business', text: request, timestamp: old }] });
    expect(result).toEqual({ text: request, stop: false });
});
