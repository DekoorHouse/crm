const { paymentReply, fullPaymentClaim, blocksProductionForBalance } = require('../server/payments/paymentConversation');
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
