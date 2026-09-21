const { db, admin } = require('../config');
const { DAY, ms } = require('./paymentPolicy');
const stamp = () => admin.firestore.FieldValue.serverTimestamp();
const date = n => admin.firestore.Timestamp.fromMillis(n);
const orders = () => db.collection('pedidos');
const services = () => require('../services');
const PREFIX = 'shippingDataConfirmation';
const fields = value => Object.fromEntries(Object.entries(value).map(([k, v]) => [PREFIX + k, v]));

// El formulario y la obligación de confirmar se guardan juntos. No depende de
// que el navegador siga abierto ni de que la IA esté encendida.
async function saveShippingData(data) {
    const num = Number(String(data.numeroPedido).replace(/\D/g, ''));
    const addressRef = db.collection('datos_envio').doc();
    const orderId = await db.runTransaction(async tx => {
        const found = await tx.get(orders().where('consecutiveOrderNumber', '==', num).limit(1));
        const doc = found.docs[0], order = doc?.data();
        tx.set(addressRef, { ...data, numeroPedido: `DH${num}`, createdAt: stamp() });
        if (order) tx.update(doc.ref, { shippingDataReceivedAt: stamp(), paymentProductionPending: true,
            ...(!order.shippingDataConfirmationStatus ? fields({ Status: 'pending', NextAttemptAt: stamp() }) : {}) });
        return doc?.id;
    });
    if (orderId) {
        // Ambas tareas tienen recuperación persistente; el fallo de una no impide la otra.
        await deliverShippingConfirmation(orderId).catch(e => console.warn('[ENVIOS] Confirmación pendiente:', e.message));
        await require('./paymentProduction').reconcilePaymentProduction(orderId).catch(e => console.warn('[ENVIOS] Producción pendiente:', e.message));
    }
    return addressRef.id;
}

async function deliverShippingConfirmation(orderId) {
    const ref = orders().doc(orderId);
    const claim = await db.runTransaction(async tx => {
        const order = (await tx.get(ref)).data();
        if (!order?.shippingDataReceivedAt || !['pending', 'retry', 'sending'].includes(order.shippingDataConfirmationStatus)) return null;
        if (order.shippingDataConfirmationStatus === 'sending') {
            if (ms(order.shippingDataConfirmationLeaseUntil) <= Date.now()) {
                tx.update(ref, fields({ Status: 'review', Reason: 'El envío pudo completarse antes del reinicio. Revisar el chat.', LeaseUntil: null }));
            }
            return null;
        }
        const contactId = order.contactId || order.telefono;
        const contactRef = contactId ? db.collection('contacts_whatsapp').doc(contactId) : null;
        const contact = contactRef ? (await tx.get(contactRef)).data() : null;
        if (!contact) {
            tx.update(ref, fields({ Status: 'review', Reason: 'No se encontró el contacto para confirmar los datos.' }));
            return null;
        }
        const messageRef = contactRef.collection('messages').doc('shipping_data_' + orderId);
        const previous = await tx.get(messageRef);
        if (previous.exists) {
            tx.update(ref, fields({ Status: 'sent', SentAt: previous.data().timestamp, LeaseUntil: null }));
            return null;
        }
        const windowOpen = ms(contact.lastClientMsgAt) > 0 && Date.now() - ms(contact.lastClientMsgAt) < DAY;
        if (!windowOpen) {
            tx.update(ref, fields({ Status: 'retry', WaitingForCustomer: true, Reason: 'Esperando un mensaje del cliente para confirmar sus datos.' }));
            return null;
        }
        if (!order.shippingDataConfirmationWaitingForCustomer && ms(order.shippingDataConfirmationNextAttemptAt) > Date.now()) return null;
        tx.update(ref, fields({ Status: 'sending', WaitingForCustomer: false, LeaseUntil: date(Date.now() + 180000) }));
        return { order, contact, contactId, contactRef, messageRef };
    });
    if (!claim) return { status: 'unchanged' };
    const { order, contact, contactId, contactRef, messageRef } = claim;
    const text = `¡Gracias! 🙌 Tus datos de envío del pedido DH${order.consecutiveOrderNumber} quedaron registrados correctamente ✅`;
    const channel = contact.channel || 'whatsapp';
    let acknowledged = false;
    try {
        const sent = ['messenger', 'instagram'].includes(channel)
            ? await services().sendMessengerMessage(contact.psid || contact.igsid || contactId.replace(/^(fb_|ig_)/, ''), { text, channel })
            : await services().sendAdvancedWhatsAppMessage(contactId, { text });
        const id = sent?.id || sent?.messages?.[0]?.id;
        if (!id) throw new Error('El canal no confirmó el identificador del mensaje.');
        acknowledged = true;
        const batch = db.batch();
        batch.set(messageRef, { id, text, channel, from: process.env.PHONE_NUMBER_ID || 'system', timestamp: stamp(), status: 'sent', isAutoReply: true, shippingDataOrderId: orderId });
        batch.update(ref, fields({ Status: 'sent', SentAt: stamp(), MessageId: id, Reason: '', LeaseUntil: null }));
        batch.update(contactRef, { lastMessage: text.slice(0, 100), lastMessageTimestamp: stamp() });
        await batch.commit();
        return { status: 'sent' };
    } catch (error) {
        const attempts = (order.shippingDataConfirmationAttempts || 0) + 1;
        // Sin respuesta del proveedor no sabemos si alcanzó a enviar: no repetir.
        const ambiguous = acknowledged || !error.response;
        const status = ambiguous || attempts >= 5 ? 'review' : 'retry';
        await ref.update(fields({ Status: status, Attempts: attempts, LeaseUntil: null,
            NextAttemptAt: date(Date.now() + attempts * 60000),
            Reason: ambiguous ? 'El envío pudo completarse. Revisar el chat antes de reintentar.' : 'El canal rechazó el envío de la confirmación.' }));
        return { status };
    }
}

async function recoverShippingConfirmations() {
    const pending = await orders().where('shippingDataConfirmationStatus', 'in', ['pending', 'retry', 'sending']).get();
    for (const doc of pending.docs) {
        await deliverShippingConfirmation(doc.id).catch(e => console.warn('[ENVIOS] Recuperar confirmación:', e.message));
    }
}

module.exports = { saveShippingData, deliverShippingConfirmation, recoverShippingConfirmations };
