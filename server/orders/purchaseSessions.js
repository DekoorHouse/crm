const { db, admin } = require('../config');
const { ms, hash } = require('../payments/paymentPolicy');
const clean = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const clarification = '¿Te refieres al pedido anterior o quieres hacer una compra nueva?';

function purchaseIntent(text, pending = false) {
    const t = clean(text);
    if (/\b(?:no quiero|no necesito|no voy a)\b/.test(t)) return 'existing';
    if (pending && /\b(?:nuevo|nueva|otra compra)\b/.test(t)) return 'new';
    if (/\b(?:reembolso|garantia|reposicion)\b/.test(t)) return 'existing';
    if (/\b(?:quiero|quisiera|necesito|gustaria|comprar|pedir|encargar)\b.{0,45}\b(?:otr[oa]s?\s+(?:lamparas?|pedidos?)|(?:nuevo pedido|otra compra))\b/.test(t)) return 'new';
    if (/\b(?:guia|rastreo|paquete)\b/.test(t)) return 'existing';
    if (/\b(?:otra|otro|tendras|tienen|venden)\b|\b(?:quiero|interesa|gustaria|puedes hacer)\b.{0,50}\blampara\b/.test(t)) return 'ambiguous';
    return 'existing';
}

async function scopeIncomingMessage(contactId, messageId, message) {
    const ref = db.collection('contacts_whatsapp').doc(contactId);
    return db.runTransaction(async tx => {
        const c = (await tx.get(ref)).data();
        if (!c) return {};
        const orders = (await tx.get(db.collection('pedidos').where('contactId', '==', contactId))).docs;
        const explicit = String(message.text || '').match(/\bDH\s*(\d{4,6})\b/i);
        const named = explicit && orders.find(d => Number(d.data().consecutiveOrderNumber) === Number(explicit[1]));
        if (named) return { purchaseOrderId: named.id, ...(named.data().purchaseSessionId ? { purchaseSessionId: named.data().purchaseSessionId } : {}) };
        const previous = orders.some(d => d.data().guiaEnvio?.guia || /^(Enviado|Entregado|Pagado)$/.test(d.data().estatus || ''));
        const activeOrder = orders.find(d => d.data().purchaseSessionId === c.activePurchaseSessionId && c.activePurchaseSessionId);
        const intent = purchaseIntent(message.text, c.purchaseClarificationPending);
        const start = ms(message.timestamp);
        const canStart = previous && (!c.activePurchaseSessionId || (activeOrder && (activeOrder.data().guiaEnvio?.guia || /^(Enviado|Entregado|Pagado)$/.test(activeOrder.data().estatus || ''))));
        if (intent === 'new' && canStart && start > ms(c.activePurchaseStartedAt)) {
            const sessionId = hash(contactId + '|' + messageId);
            const startedAt = admin.firestore.Timestamp.fromMillis(start);
            tx.set(ref.collection('purchase_sessions').doc(sessionId), { startedAt, sourceMessageId: messageId, status: 'collecting', previousOrderIds: orders.map(d => d.id) });
            tx.update(ref, { activePurchaseSessionId: sessionId, activePurchaseStartedAt: startedAt,
                activePurchaseOrderId: null, paymentNewOrderRequestedAt: startedAt, purchaseClarificationPending: false, aiStage: 'venta', awaitingShippingData: false });
            return { purchaseSessionId: sessionId };
        }
        if (previous && intent === 'ambiguous' && canStart) {
            tx.update(ref, { purchaseClarificationPending: true });
            return { purchaseNeedsClarification: true };
        }
        if (c.purchaseClarificationPending && /\b(?:anterior|rastreo|guia)\b/.test(clean(message.text))) tx.update(ref, { purchaseClarificationPending: false });
        return c.activePurchaseSessionId ? { purchaseSessionId: c.activePurchaseSessionId } : {};
    });
}

function inPurchase(message, contact) {
    if (!contact.activePurchaseSessionId) return true;
    if (message.purchaseOrderId && message.purchaseOrderId !== contact.activePurchaseOrderId) return false;
    return message.purchaseSessionId ? message.purchaseSessionId === contact.activePurchaseSessionId
        : ms(message.timestamp) >= ms(contact.activePurchaseStartedAt);
}

module.exports = { purchaseIntent, scopeIncomingMessage, inPurchase, clarification };
