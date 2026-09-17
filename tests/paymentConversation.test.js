const { paymentReply, fullPaymentClaim, blocksProductionForBalance, requestsPaymentAgain, paymentComplaint, orderNumberInMessage } = require('../server/payments/paymentConversation');
const deposit = { partialCents: 50000, totalCents: 150000, productionStatus: 'Fabricar' };

test.each(['Gracias', 'ok', 'muchas gracias', 'Perfecto'])('DH16814: acknowledgment %s never repeats collection instructions', customerText => {
    expect(paymentReply(deposit, { customerText, aiText: 'Gracias por tu pago, faltan $1000 para registrar el pedido.' })).toEqual(['¡Con gusto! ✨']);
});
test('photo agreement is respected without demanding balance before manufacturing', () => {
    expect(paymentReply(deposit, { customerText: 'Me dijeron que el resto cuando me manden la foto', aiText: 'Liquida tu saldo para fabricar.' })[0]).toContain('después de ver la foto');
});
test('explicit balance question gives the amount and agreed payment moment', () => {
    const reply = paymentReply(deposit, { customerText: '¿Cuánto me falta?', aiText: 'Déjame revisar.' })[0];
    expect(reply).toContain('$1,000'); expect(reply).toContain('al ver la foto');
});
test('contextual reply is preserved instead of injecting the same payment notice', () => {
    expect(paymentReply(deposit, { customerText: 'Será de Homero', aiText: 'Sí, el diseño será de Homero.' })).toBeNull();
});
test('new deposit receipt confirms manufacturing without unsolicited amount collection', () => {
    const reply = paymentReply(deposit, { receiptPresent: true })[0];
    expect(reply).toContain('$500'); expect(reply).toContain('Fabricar'); expect(reply).not.toContain('$1,000');
});
test('duplicate unsafe response cannot leak a full payment claim', () => {
    const aiText = 'Tu pago completo ya está registrado.';
    const first = paymentReply(deposit, { aiText })[0];
    const second = paymentReply(deposit, { aiText, recentReplies: [first] });
    expect(second).not.toBeNull(); expect(second[0]).not.toBe(first); expect(second[0]).not.toContain('pago completo');
});
test('reported full payment does not imply bank approval', () => {
    const reply = paymentReply({ reportedComplete: true, formSent: true }, { aiText: 'Tu pago completo está validado.' });
    expect(reply[0]).toContain('en revisión');
});
test.each(['Tu pago completo ya está registrado', 'Tu pedido está liquidado'])('recognizes unsupported full-payment claim: %s', text => expect(fullPaymentClaim(text)).toBe(true));
test.each(['Faltan $1000 para registrar tu pedido', 'Liquida el saldo antes de fabricar', 'Necesitamos el pago completo para empezar'])('recognizes a premature collection demand: %s', text => expect(blocksProductionForBalance(text)).toBe(true));

const paid = { hasPaid: true, partialCents: 120000, totalCents: 120000, formSent: true, orderNumber: 'DH16809' };
test.each([
    'Para registrar el pago necesitamos la foto o el PDF del comprobante. ¿Nos lo compartes por aquí, por favor?',
    '¿Me compartes tu comprobante en PDF?', 'Envíame una captura de tu transferencia.',
    'Realiza el pago para preparar tu envío.', 'Falta tu comprobante para continuar.',
    'Tu comprobante está pendiente.', 'Debes pagar para que podamos enviarlo.',
])('a validated payment blocks another request: %s', aiText => {
    expect(requestsPaymentAgain(aiText)).toBe(true);
    expect(paymentReply(paid, { aiText })[0]).toContain('Tu pago completo de DH16809 ya está registrado');
});

test.each(['Hola ya page', 'Ya pagué', 'Esque ya no entiedo me mandan y me mandar que page', '¿Por qué me siguen cobrando otra vez?'])('paid customer complaint is answered from the registered payment: %s', customerText => {
    expect(paymentComplaint(customerText)).toBe(true);
    expect(paymentReply(paid, { customerText, receiptPresent: true })[0]).toContain('Disculpa la confusión');
});

test('a paid shipping question keeps the relevant reply instead of injecting payment instructions', () => {
    expect(paymentReply(paid, { customerText: '¿Cuándo sale mi pedido?', aiText: 'El equipo te compartirá la guía cuando esté lista.' })).toBeNull();
});

test('an unapproved full receipt is not described as validated when rejecting a duplicate request', () => {
    const reply = paymentReply({ reportedComplete: true, formSent: true, orderNumber: 'DH16809' }, { aiText: 'Manda otra vez el comprobante.' })[0];
    expect(reply).toContain('revisando su acreditación'); expect(reply).not.toContain('ya está registrado');
});

test('only an explicit unique order number selects a paid order; arbitrary amounts and multiple orders do not', () => {
    expect(orderNumberInMessage('Mi pedido es dh 16809 y ya pagué 1200')).toBe('DH16809');
    expect(orderNumberInMessage('Pagué 1200 de DH16809, DH16809')).toBe('DH16809');
    expect(orderNumberInMessage('DH16809 y DH16821')).toBeNull();
    expect(orderNumberInMessage('Ya pagué 16809')).toBeNull();
});

test('requesting another order does not assert a receipt was received when there is no image', () => {
    expect(paymentReply({ registrationPending: true }, { customerText: 'Quiero otro pedido' })[0]).not.toContain('Recibimos tu comprobante');
});

test.each([{ hasPaid: false }, deposit])('legitimate payment instructions remain available for an unpaid balance', context => {
    expect(paymentReply(context, { aiText: 'Realiza el pago a la cuenta que te compartimos.', onlyPreventRepeatRequest: true })).toBeNull();
});

test('a received receipt pending review is not requested again even before approval', () => {
    expect(paymentReply({ pending: 1 }, { aiText: 'Envía el comprobante.', onlyPreventRepeatRequest: true })[0]).toContain('No necesitas volver a mandar la misma imagen');
});
