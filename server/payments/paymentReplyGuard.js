const { ms } = require('./paymentPolicy');
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f*_]/g, '').toLowerCase();
const HANDOFF = 'Disculpa la confusión. Voy a dejar tu caso con una persona del equipo para que revise lo que nos compartiste y te ayude a continuar. No necesitas reenviar la misma imagen.';
const waitingForPaymentHelp = contact => contact?.botActive === false && (contact?.paymentReplyGuard?.stopped === true
    || (contact?.needsAttention === true && ['payment_reply_loop', 'registro_pedido'].includes(contact.needsAttentionReason)));

function paymentReplyCategory(text) {
    const t = normalize(text);
    if (/pago completo[^.!?\n]{0,45}registrado/.test(t)) return null;
    if (/registro de tu pedido necesita revision|equipo dara seguimiento al registro/.test(t)) return 'registration_review';
    if (/(?:comprobante|pago|acreditacion)[^.!?\n]{0,65}(?:revision|revisando|verificando)|(?:revisando|revisara|verificando)[^.!?\n]{0,65}(?:comprobante|pago|acreditacion|importe)/.test(t)) return 'payment_review';
    if (/(?:envia|manda|comparte|compartir|adjunta|necesit|requier|proporcion)[^.!?\n]{0,100}(?:comprobante|foto.{0,15}pago|captura.{0,15}(?:pago|transferencia))/.test(t)) return 'receipt_request';
    return null;
}

// La comprobación se aplica al texto FINAL, incluidos fallbacks y respuestas rápidas.
// Una transacción conserva el límite aunque Render reinicie o dos turnos se solapen.
async function protectPaymentReply({ contactRef, contactId, text, customerText = '', context = {}, history = [] }) {
    const category = paymentReplyCategory(text);
    if (!category) return { text, stop: false };
    if (category === 'receipt_request' && context.hasPaid) return {
        text: `Tu pago completo${context.orderNumber ? ' de ' + context.orderNumber : ''} ya está registrado. No necesitas reenviar el comprobante.`, stop: false,
    };
    const { db, admin } = require('../config');
    const scope = `${context.orderId || 'sin-pedido'}:${context.partialCents || 0}:${!!context.hasPaid}`;
    return db.runTransaction(async tx => {
        const contact = (await tx.get(contactRef)).data() || {};
        const since = Math.max(ms(contact.paymentNewOrderRequestedAt), ms(contact.paymentReplyGuardResetAt), context.contextSince || 0);
        const key = scope + ':' + since;
        const previous = contact.paymentReplyGuard;
        if (previous?.scope === key && previous.stopped && contact.botActive === false) return { text: null, stop: true };
        const recent = history.filter(m => m.from !== contactId && ms(m.timestamp) >= Math.max(since, Date.now() - 48 * 3600000));
        const askedBefore = recent.some(m => paymentReplyCategory(m.text) === category);
        const stateRepeat = previous?.scope === key && previous.category === category;
        const hasImage = history.some(m => m.from === contactId && ['image', 'document'].includes(m.type)
            && ms(m.timestamp) >= Math.max(since, Date.now() - 48 * 3600000));
        const alreadySent = /ya[^.!?\n]{0,35}(?:envi|mand|comparti)|revisen|(?:robaron|fraude|mi dinero)/.test(normalize(customerText));
        const requestReceived = category === 'receipt_request' && (context.pending > 0 || context.hasPaid || context.reportedComplete || (hasImage && alreadySent));
        const stop = askedBefore || stateRepeat || requestReceived || category === 'registration_review';
        const fields = { paymentReplyGuard: { scope: key, category, stopped: stop, at: admin.firestore.FieldValue.serverTimestamp() } };
        if (stop) Object.assign(fields, { botActive: false, needsAttention: true,
            needsAttentionReason: category === 'registration_review' ? 'registro_pedido' : 'payment_reply_loop',
            needsAttentionAt: admin.firestore.FieldValue.serverTimestamp() });
        tx.update(contactRef, fields);
        return { text: stop && category !== 'registration_review' ? HANDOFF : text, stop };
    });
}

module.exports = { paymentReplyCategory, protectPaymentReply, waitingForPaymentHelp, HANDOFF };
