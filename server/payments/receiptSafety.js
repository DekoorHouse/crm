const { cents, hash, ms, possibleSamePayment, receiptFolios } = require('./paymentPolicy');

function receiptReviewState(order, receipt, related, amount) {
    const amountCents = cents(amount), receivedCents = Number(order.paymentReceivedCents) || 0;
    const totalCents = cents(order.precio);
    const siblings = related.filter(r => r.id !== receipt.id).sort((a, b) => a.id.localeCompare(b.id));
    const similar = siblings.filter(r => (r.status === 'applied' || (['pending', 'processing', 'review'].includes(r.status) && r.ocr?.pagoRealizado !== false && r.ocr?.esComprobante !== false)) &&
        possibleSamePayment({ ...receipt, amountCents }, r));
    const risks = [];
    if (similar.length) risks.push({ code: 'possible_duplicate', message: 'Hay otro comprobante que podría corresponder al mismo pago. Una segunda imagen no demuestra un nuevo ingreso.' });
    if (!receipt.verifiedProvider && (receipt.ocr?.pagoRealizado !== true || receipt.ocr?.esComprobante !== true)) risks.push({ code: 'unconfirmed_payment', message: 'La operación aparece fallida, en proceso o sin confirmación. No la apruebes sin comprobar el ingreso en el banco.' });
    if (!receipt.verifiedProvider && (!receiptFolios(receipt.ocr || {}).length || !receipt.ocr?.fecha)) risks.push({ code: 'missing_identity', message: 'Falta el folio o la fecha: no se puede identificar esta transferencia con certeza.' });
    if (amountCents + receivedCents > totalCents) risks.push({ code: 'over_total', message: 'Este abono haría que el importe recibido supere el total del pedido.' });
    if (!receipt.verifiedProvider && amountCents !== cents(receipt.ocr?.monto)) risks.push({ code: 'amount_changed', message: 'El importe indicado es distinto al leído en la imagen. Comprueba cuánto ingresó realmente en el banco.' });
    const identity = r => ({ id: r.id, orderId: r.orderId, status: ['pending', 'processing'].includes(r.status) ? 'open' : r.status, amountCents: r.amountCents,
        ocr: r.ocr, receivedAt: ms(r.receivedAt), verifiedProvider: r.verifiedProvider, providerPaymentId: r.providerPaymentId });
    // Vincula la confirmación al saldo y comprobantes que realmente se mostraron.
    // No incluye el lease de procesamiento, que cambia al iniciar la aprobación.
    const safetyToken = hash(JSON.stringify({ orderId: receipt.orderId, totalCents, receivedCents,
        status: order.estatus, validatedAt: ms(order.comprobanteValidadoAt), amountCents,
        receipt: { ...identity(receipt), status: undefined }, siblings: siblings.map(identity) }, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value));
    const summarize = r => ({ id: r.id, orderNumber: r.orderNumber, amountCents: r.amountCents ?? cents(r.ocr?.monto),
        receivedAt: ms(r.receivedAt), appliedAt: ms(r.updatedAt), status: r.status, imageUrl: r.fileUrl || null });
    return { safetyToken, orderNumber: `DH${order.consecutiveOrderNumber}`, amountCents, receivedCents, totalCents,
        afterCents: receivedCents + amountCents, remainingCents: Math.max(0, totalCents - receivedCents - amountCents),
        risks, similarReceipts: similar.map(summarize),
        previousPayments: siblings.filter(r => r.orderId === receipt.orderId && r.status === 'applied').map(summarize) };
}

function checkManualReview(state, verification = {}) {
    if (!verification.safetyToken || verification.safetyToken !== state.safetyToken) return 'El saldo o los comprobantes cambiaron. Abre de nuevo la revisión para comprobar el saldo actual.';
    const confirmed = Array.isArray(verification.confirmedRisks) ? verification.confirmedRisks : [];
    if (state.risks.some(r => !confirmed.includes(r.code))) return 'Confirma cada alerta antes de registrar este abono.';
    if (state.risks.length && (verification.bankVerified !== true || String(verification.bankEvidence || '').trim().length < 8)) {
        return 'Verifica el ingreso en el banco e indica el folio o la evidencia de un pago distinto antes de aprobar.';
    }
    return null;
}

module.exports = { receiptReviewState, checkManualReview };
