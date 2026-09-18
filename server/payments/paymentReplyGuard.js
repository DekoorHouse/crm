const { ms } = require('./paymentPolicy');
const { paymentCourtesyReply } = require('./paymentConversation');
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f*_]/g, '').toLowerCase();
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

function withoutPaymentNotice(text) {
    return String(text || '').split(/(?<=[.!?])\s+|\n+/).filter(part => {
        const t = normalize(part);
        return part.trim() && !paymentReplyCategory(part) && !paymentCourtesyReply(part)
            && !/^(?:[¿¡]\s*)?(?:(?:nos|me|se)\s+)?(?:lo|la)\s+(?:compartes|compartirias|envias|mandas|adjuntas)\b/.test(t)
            && !/no (?:necesitas|hace falta)[^.!?\n]{0,65}(?:reenviar|mandar|enviar|compartir)[^.!?\n]{0,30}(?:imagen|comprobante|foto)|(?:quedo|quedamos|seguimos|estamos)\s+(?:al\s+)?(?:pendiente|espera)/.test(t);
    }).join('\n').trim();
}

const asksPaymentStatus = text => /(?:ya|si)[^.!?\n]{0,25}(?:recibieron|recibiste|revisaron|validaron|aprobaron|acredito)|(?:estado|estatus|que paso|como va)[^.!?\n]{0,45}(?:pago|comprobante|anticipo|transferencia)|(?:pago|comprobante|anticipo)[^.!?\n]{0,35}(?:acreditado|aprobado|validado)|(?:puedes|pueden)[^.!?\n]{0,20}(?:confirmar|revisar)[^.!?\n]{0,25}(?:pago|comprobante|anticipo)/.test(normalize(text));

// Omitir un aviso repetido no es una derivación a humanos. Sólo un fallo real de
// registro detiene este flujo; la revisión del comprobante conserva su propia cola.
// La transacción conserva el límite aunque Render reinicie o dos turnos se solapen.
async function protectPaymentReply({ contactRef, contactId, text, customerText = '', customerMessageId = null, receiptPresent = false, context = {}, history = [] }) {
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
        const sameScope = previous?.scope === key;
        const seenCategories = new Set(sameScope ? previous.seenCategories || [previous.category].filter(Boolean) : []);
        const courtesy = category !== 'registration_review' && !receiptPresent && paymentCourtesyReply(customerText);
        const requestReceived = category === 'receipt_request' && (context.pending > 0 || context.reportedComplete);
        const effectiveCategory = requestReceived ? 'payment_review' : category;
        const askedBefore = recent.some(m => paymentReplyCategory(m.text) === effectiveCategory);
        const repeated = askedBefore || seenCategories.has(effectiveCategory);
        const sameMessage = customerMessageId && sameScope && previous.lastCustomerMessageId === customerMessageId;
        let reply = text;
        if (requestReceived) reply = [context.reportedComplete
            ? 'Ya recibimos los comprobantes que cubren el total. El equipo está revisando su acreditación.'
            : 'Recibimos tu comprobante y el equipo está revisando que el importe se haya acreditado.',
            withoutPaymentNotice(text)].filter(Boolean).join('\n');
        // Un "sí" también puede aceptar que le compartamos los datos para pagar.
        // Conservamos esa primera instrucción; pedir tiempo sí se respeta de inmediato.
        const useCourtesy = courtesy && (repeated || requestReceived || courtesy !== '¡Con gusto! ✨');
        if (useCourtesy) reply = courtesy;
        else if (repeated && effectiveCategory !== 'registration_review' && !(asksPaymentStatus(customerText) && !sameMessage)) {
            reply = withoutPaymentNotice(text) || null;
        }
        if (category !== 'registration_review' && sameScope && reply === previous.lastReply && (!asksPaymentStatus(customerText) || sameMessage)) reply = null;
        const stop = category === 'registration_review';
        if (reply && !useCourtesy) seenCategories.add(effectiveCategory);
        const fields = { paymentReplyGuard: { scope: key, category: effectiveCategory, stopped: stop,
            version: 2, seenCategories: [...seenCategories],
            lastReply: reply || (sameScope ? previous.lastReply || null : null),
            lastCustomerMessageId: customerMessageId,
            at: admin.firestore.FieldValue.serverTimestamp() } };
        if (stop) Object.assign(fields, { botActive: false, needsAttention: true,
            needsAttentionReason: 'registro_pedido',
            needsAttentionAt: admin.firestore.FieldValue.serverTimestamp() });
        tx.update(contactRef, fields);
        return { text: reply, stop };
    });
}

module.exports = { paymentReplyCategory, protectPaymentReply, waitingForPaymentHelp };
