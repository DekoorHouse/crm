const { ms } = require('../payments/paymentPolicy');

function advancedOrder(order) {
    return Number(order.paymentReceivedCents) > 0 || !!order.comprobanteValidadoAt
        || order.paymentReportedComplete === true || !!order.shippingDataReceivedAt
        || !!order.guiaEnvio?.guia
        || /^(pagado|enviado|entregado|devuelto|cancelado)$/i.test(String(order.estatus || '').trim());
}

// Commercial reminders belong to a purchase, never to parcel/delivery follow-up.
async function reminderEligibility(db, contactId, reminder = null) {
    const contact = (await db.collection('contacts_whatsapp').doc(contactId).get()).data() || {};
    const sessionId = contact.activePurchaseSessionId || null;
    if (reminder && (reminder.purchaseSessionId || null) !== sessionId) {
        return { allowed: false, reason: 'compra_distinta' };
    }
    const snap = await db.collection('pedidos').where('contactId', '==', contactId).get();
    let orders = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    if (sessionId) {
        orders = orders.filter(o => o.purchaseSessionId === sessionId || o.id === contact.activePurchaseOrderId
            || (!o.purchaseSessionId && ms(o.createdAt) >= ms(contact.activePurchaseStartedAt) && ms(contact.activePurchaseStartedAt) > 0));
    }
    if (orders.some(advancedOrder)) return { allowed: false, reason: 'pedido_con_pago_o_envio' };
    return { allowed: true, purchaseSessionId: sessionId };
}

module.exports = { advancedOrder, reminderEligibility };
