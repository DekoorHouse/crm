const mockDb = require('./helpers/paymentFirestore')();
jest.mock('../server/config', () => ({ db: mockDb, admin: { firestore: { FieldValue: { serverTimestamp: () => new Date() } } } }));
const { protectPaymentReply, paymentReplyCategory, waitingForPaymentHelp } = require('../server/payments/paymentReplyGuard');
const { evaluateFollowup } = require('../server/leads/leadReactivationLogic');
const { evaluateOrderFollowup } = require('../server/leads/orderFollowupLogic');
const request = 'Para confirmar tu pago necesitamos revisar la foto o el PDF del comprobante. ¿Nos lo compartes por aquí, por favor?';
const contact = () => mockDb.read('contacts_whatsapp/c1');
const run = extra => protectPaymentReply({ contactRef: mockDb.collection('contacts_whatsapp').doc('c1'), contactId: 'c1', text: request, ...extra });
beforeEach(() => { mockDb.reset(); mockDb.seed('contacts_whatsapp/c1', { botActive: true }); });

test('once intentos sólo permiten una solicitud sin apagar la IA ni derivar al cliente', async () => {
    const replies = [];
    for (let i = 0; i < 11; i++) { const result = await run(); if (result.text) replies.push(result.text); }
    expect(replies).toEqual([request]);
    expect(contact()).toMatchObject({ botActive: true, paymentReplyGuard: { stopped: false } });
    expect(contact().needsAttention).toBeUndefined();
});

test('detecta el ciclo antiguo aunque no exista todavía el contador persistente', async () => {
    expect(await run({ history: [{ from: 'business', text: request, timestamp: new Date() }] })).toEqual({ text: null, stop: false });
});

test('si el cliente dice que ya lo envió y hay imagen, no solicita otra copia ni confirma dinero', async () => {
    const result = await run({ customerText: 'Ya te lo compartí', context: { pending: 1 }, history: [{ from: 'c1', type: 'image', timestamp: new Date() }] });
    expect(result.stop).toBe(false);
    expect(result.text).toContain('revisando');
    expect(result.text).not.toContain('¿Nos lo compartes');
    expect(contact().comprobanteValidadoAt).toBeUndefined();
});

test('un comprobante pendiente tampoco vuelve a solicitarse', async () => {
    const result = await run({ context: { pending: 1 } });
    expect(result.stop).toBe(false);
    expect(result.text).toContain('Recibimos tu comprobante');
    expect(result.text).not.toContain('¿Nos lo compartes');
});

test('transacciones simultáneas no mandan once respuestas', async () => {
    const replies = await Promise.all(Array.from({ length: 11 }, () => run()));
    expect(replies.filter(x => x.text).map(x => x.text)).toEqual([request]);
    expect(contact().botActive).toBe(true);
});

test('la espera de revisión no sustituye la solicitud por otro bucle de mensajes iguales', async () => {
    const text = 'Recibimos tu comprobante y el equipo está revisando que el importe se haya acreditado. No necesitas volver a mandar la misma imagen.';
    expect((await run({ text })).stop).toBe(false);
    expect(await run({ text })).toEqual({ text: null, stop: false });
    expect((await run({ text })).text).toBeNull();
    expect(contact().botActive).toBe(true);
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

test.each(['Sí claro.', 'Ok deme unos minutos por fa', 'Ahorita lo mando'])('un cliente que dice %s sigue acompañado sin asumir que ya mandó una imagen', async customerText => {
    await run();
    const result = await run({ customerText });
    expect(result.stop).toBe(false);
    expect(result.text).toMatch(/Con gusto|tómate tu tiempo/);
    expect(result.text).not.toMatch(/reenviar|Recibimos|equipo/);
    expect(contact().botActive).toBe(true);
});

test('DH16978: conserva la respuesta sobre otro WhatsApp y omite sólo el aviso repetido', async () => {
    const notice = 'Recibimos tu comprobante y el equipo está revisando que el importe se haya acreditado. No necesitas volver a mandar la misma imagen.';
    await run({ text: notice, context: { pending: 1 }, customerMessageId: 'recibo' });
    const answer = 'Para continuar en el otro WhatsApp, escríbenos desde ese número.';
    const result = await run({ text: notice + '\n\n' + answer, customerText: 'Me puedes mandar la información a otro WhatsApp', customerMessageId: 'telefono', context: { pending: 1 } });
    expect(result).toEqual({ text: answer, stop: false });
    expect(contact().botActive).toBe(true);
});

test('responde una pregunta explícita sobre el pago aunque ya haya dado su estado', async () => {
    const text = 'El equipo está revisando tu comprobante.';
    await run({ text, customerMessageId: 'primero' });
    const input = { text, customerText: '¿Ya revisaron mi comprobante?', customerMessageId: 'segundo' };
    expect(await run(input)).toEqual({ text, stop: false });
    expect(await run(input)).toEqual({ text: null, stop: false });
});

test('alternar revisión y solicitud no reinicia el límite ni permite pedir una imagen pendiente', async () => {
    const text = 'El equipo está revisando tu comprobante.';
    await run({ text, context: { pending: 1 } });
    expect(await run({ context: { pending: 1 } })).toEqual({ text: null, stop: false });
    expect(await run({ text, context: { pending: 1 } })).toEqual({ text: null, stop: false });
});

test('una foto de diseño no demuestra que se recibió un comprobante', async () => {
    expect(await run({ customerText: 'Ya mandé el diseño', history: [{ from: 'c1', type: 'image', timestamp: new Date() }] })).toEqual({ text: request, stop: false });
});

test('no reactiva una conversación previamente pausada', async () => {
    mockDb.seed('contacts_whatsapp/c1', { botActive: false, paymentReplyGuard: { scope: 'sin-pedido:0:false:0', category: 'receipt_request', stopped: true } });
    expect(await run({ customerText: 'Sí claro.' })).toEqual({ text: null, stop: true });
    expect(contact().botActive).toBe(false);
});

test('aceptar los datos de pago no se sustituye por un agradecimiento sin la cuenta', async () => {
    const text = 'Puedes transferir a la cuenta que te compartimos. Envíame el comprobante después de pagar.';
    expect(await run({ text, customerText: 'Sí, por favor.' })).toEqual({ text, stop: false });
});

test('permite enviar archivos sin texto; omitir una repetición sí devuelve null explícito', async () => {
    expect(await run({ text: '' })).toEqual({ text: '', stop: false });
    await run();
    expect(await run()).toEqual({ text: null, stop: false });
});
