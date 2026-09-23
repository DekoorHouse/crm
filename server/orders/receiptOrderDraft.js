const { db, admin } = require('../config');
const { ms, cancelled, terminal } = require('../payments/paymentPolicy');
const stamp = () => admin.firestore.FieldValue.serverTimestamp();

async function suggest(contactId) {
    const ref = db.collection('contacts_whatsapp').doc(contactId);
    const contact = (await ref.get()).data() || {};
    const ai = require('./aiOrderRegistration');
    const history = await require('./registrationHistory').loadRegistrationHistory(ref, contactId, '');
    const config = await ai.getAiOrderConfig();
    const { extraction } = await ai.extractOrderDetailed({ conversationText: history, name: contact.name || '', catalogText: config.catalogText });
    return extraction || { items: [], total: null, faltante: 'Productos, personalización y total por confirmar', listo: false };
}

async function createDraft(receiptRef, input) {
    const description = String(input.description || '').trim().slice(0, 4000);
    const missing = String(input.missing || '').trim().slice(0, 1000);
    const total = input.total === '' || input.total == null ? null : Number(input.total);
    const requiredDeposit = Number(input.requiredDeposit || 0);
    if (!Number.isFinite(requiredDeposit) || requiredDeposit < 0 || requiredDeposit > 100000) throw new Error('Revisa el anticipo mínimo acordado.');
    if (!description || (total !== null && (!Number.isFinite(total) || total <= 0 || total > 100000))) throw new Error('Revisa la descripción y el total del pedido.');
    const orderRef = db.collection('pedidos').doc('receipt-' + receiptRef.id);
    return db.runTransaction(async tx => {
        const receipt = (await tx.get(receiptRef)).data();
        if (!receipt?.open || ms(receipt.leaseUntil) > Date.now()) throw new Error('El comprobante cambió o se está procesando.');
        if (receipt.orderId) return { orderId: receipt.orderId };
        const contactRef = db.collection('contacts_whatsapp').doc(receipt.contactId);
        const contact = (await tx.get(contactRef)).data();
        const orders = await tx.get(db.collection('pedidos').where('contactId', '==', receipt.contactId));
        const candidates = orders.docs.filter(d => !cancelled(d.data()) && !terminal(d.data()) && !d.data().guiaEnvio?.guia
            && (!contact?.activePurchaseSessionId || d.data().purchaseSessionId === contact.activePurchaseSessionId));
        if (candidates.length) throw new Error('Este contacto ya tiene un pedido abierto. Selecciona su DH para evitar duplicarlo.');
        const counterRef = db.collection('counters').doc('orders');
        const counter = (await tx.get(counterRef)).data();
        const number = Math.max(1000, Number(counter?.lastOrderNumber) || 0) + 1;
        const missingData = [missing, total === null ? 'Confirmar el total acordado' : ''].filter(Boolean).join('. ');
        tx.create(orderRef, { contactId: receipt.contactId, telefono: receipt.contactId, consecutiveOrderNumber: number,
            producto: 'Pedido por completar', items: [{ producto: 'Pedido por completar', cantidad: 1, precio: total || 0, datosProducto: description }],
            datosProducto: description, precio: total || 0, totalPending: total === null,
            missingOrderData: missingData, orderDataPending: true, estatus: 'Pendiente de datos',
            requiredDepositCents: Math.round(requiredDeposit * 100),
            registeredByAI: true, aiReviewStatus: 'pending', receiptDraft: true,
            purchaseSessionId: receipt.purchaseSessionId || contact?.activePurchaseSessionId || null,
            createdAt: stamp(), paymentReceiptDiscoveryPending: true, departmentId: contact?.assignedDepartmentId || null,
            comentarios: 'Creado por el operador al revisar un comprobante. Completar datos en este mismo DH.' });
        tx.set(counterRef, { lastOrderNumber: number }, { merge: true });
        tx.update(receiptRef, { orderId: orderRef.id, orderNumber: `DH${number}`, updatedAt: stamp() });
        tx.update(contactRef, { receiptOrderDraftId: orderRef.id, lastOrderNumber: number, lastOrderDate: stamp(), purchaseStatus: 'registered', aiStage: 'venta' });
        return { orderId: orderRef.id, orderNumber: `DH${number}` };
    });
}

async function completeDraft(contactId) {
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    const contact = (await contactRef.get()).data();
    if (!contact?.receiptOrderDraftId) return null;
    const ref = db.collection('pedidos').doc(contact.receiptOrderDraftId);
    const before = (await ref.get()).data();
    if (!before?.orderDataPending || before.contactId !== contactId
        || (contact.activePurchaseSessionId && before.purchaseSessionId !== contact.activePurchaseSessionId)) return null;
    // Preserve the operator's reviewed draft until the customer actually adds information.
    if (ms(contact.lastClientMsgAt) <= ms(before.createdAt)) return before;
    const x = await suggest(contactId);
    if (!x.listo || x.confianza < 80 || !x.items?.length || !(x.total > 0)
        || x.items.some(i => !(i.precio > 0) || !(i.cantidad > 0))
        || Math.abs(x.items.reduce((n, i) => n + i.precio * i.cantidad, 0) - x.total) > 0.01
        || (!before.totalPending && x.total !== before.precio)) return before;
    await db.runTransaction(async tx => {
        const fresh = (await tx.get(ref)).data();
        if (!fresh?.orderDataPending || fresh.precio !== before.precio) return;
        const paid = (fresh.paymentReceivedCents || 0) >= Math.round(x.total * 100);
        tx.update(ref, { items: x.items, producto: x.items[0].producto, datosProducto: x.items.map(i => i.datosProducto).join('\n'),
            precio: x.total, totalPending: false, orderDataPending: false, missingOrderData: '', estatus: 'Sin estatus',
            paymentProductionPending: true, paymentFormNeedsAssessment: true,
            ...(paid ? { comprobanteValidadoAt: stamp(), shippingFormStatus: 'pending', shippingFormNextAttemptAt: stamp() } : {}) });
        tx.update(contactRef, { receiptOrderDraftId: null, purchaseValue: x.total });
    });
    return (await ref.get()).data();
}

async function followupDrafts() {
    const pending = await db.collection('pedidos').where('orderDataFollowupPending', '==', true).get();
    for (const doc of pending.docs.slice(0, 10)) {
        const data = doc.data();
        if (ms(data.orderDataFollowupNextAt) > Date.now()) continue;
        try {
        await completeDraft(data.contactId);
        await db.runTransaction(async tx => {
            const order = (await tx.get(doc.ref)).data();
            const messageRef = db.collection('contacts_whatsapp').doc(order.contactId).collection('messages').doc('order-data-' + doc.id);
            const previous = await tx.get(messageRef);
            if (order.orderDataPending && !previous.exists && order.paymentReceivedCents > 0) {
                tx.create(messageRef, { from: process.env.PHONE_NUMBER_ID || 'business', channel: 'whatsapp', source: 'scheduled',
                    status: 'scheduled', scheduledAt: stamp(), timestamp: stamp(), createdAt: stamp(), attempts: 0,
                    text: `Ya registramos tu abono de $${order.paymentReceivedCents / 100} en el pedido DH${order.consecutiveOrderNumber}. Para completar tu pedido, ¿nos confirmas lo siguiente? ${order.missingOrderData || order.datosProducto}` });
            }
            tx.update(doc.ref, { orderDataFollowupPending: false });
        });
        } catch (e) {
            await doc.ref.update({ orderDataFollowupError: e.message.slice(0, 300), orderDataFollowupNextAt: new Date(Date.now() + 300000) });
        }
    }
}

module.exports = { suggest, createDraft, completeDraft, followupDrafts };
