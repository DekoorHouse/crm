const { db, admin } = require('../config');
const { ms, terminal, cancelled } = require('./paymentPolicy');
const stamp = () => admin.firestore.FieldValue.serverTimestamp();
const initialStatus = order => ['sin estatus', 'esperando anticipo', 'esperando pago', 'pagado'].includes(String(order.estatus || 'Sin estatus').trim().toLowerCase());
const approvedPayment = order => !!order.comprobanteValidadoAt || Number(order.paymentReceivedCents) > 0;

// Se ejecuta al registrar/aprobar cada abono y en recuperación. La transición
// pertenece al pedido exacto, independientemente de lo que responda el modelo.
async function reconcilePaymentProduction(orderId) {
    const ref = db.collection('pedidos').doc(orderId);
    const claimed = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const order = snap.data();
        if (terminal(order) || cancelled(order)) {
            if (order.paymentProductionPending) tx.update(ref, { paymentProductionPending: false });
            return null;
        }
        if (!approvedPayment(order)) {
            const rs = await tx.get(db.collection('payment_receipts').where('orderId', '==', orderId));
            const pending = rs.docs.map(d => d.data()).find(r => r.contactId === order.contactId && r.open && r.ocr?.esComprobante === true && Number(r.ocr.monto) > 0);
            if (pending && initialStatus(order)) tx.update(ref, {
                estatus: 'Esperando anticipo', paymentProductionStatus: 'review', paymentProductionPending: false,
                paymentProductionReason: 'Comprobante recibido; falta aprobar el pago para iniciar fabricación.',
            });
            else if (order.paymentProductionPending) tx.update(ref, { paymentProductionPending: false });
            return null;
        }
        const advance = initialStatus(order) && !order.svgCorteAt && !order.disenoListoAt && !order.guiaEnvio?.guia;
        const resume = order.estatus === 'Fabricar' && (order.paymentProductionPending || order.fabricarSinVenta);
        if (!advance && !resume) {
            if (order.paymentProductionPending) tx.update(ref, { paymentProductionPending: false });
            return null;
        }
        if (ms(order.paymentProductionLeaseUntil) > Date.now()) return null;
        if (ms(order.paymentProductionNextAttemptAt) > Date.now()) return null;
        tx.update(ref, {
            ...(advance ? { estatus: 'Fabricar', confirmedAt: order.confirmedAt || stamp(), paymentProductionStartedAt: stamp(), paymentProductionPreviousStatus: order.estatus || 'Sin estatus' } : {}),
            paymentProductionPending: true, paymentProductionStatus: 'processing', paymentProductionReason: '',
            paymentProductionLeaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 180000),
        });
        return { ...order, estatus: 'Fabricar', advance };
    });
    if (!claimed) return { status: 'unchanged' };
    try {
        // Estos efectos ya son idempotentes por pedido; una caída conserva la cola.
        const inventory = await require('../inventario/inventarioService').descontarInventarioPorPedido(orderId, claimed, 'Fabricar');
        if (inventory?.ok === false) throw new Error(inventory.motivo || 'Inventario pendiente.');
        let departmentId = claimed.departmentId;
        if (claimed.contactId) {
            const contactRef = db.collection('contacts_whatsapp').doc(claimed.contactId);
            await db.runTransaction(async tx => {
                const contact = (await tx.get(contactRef)).data();
                departmentId = departmentId || contact?.assignedDepartmentId;
                if (contact && (!contact.lastOrderNumber || Number(String(contact.lastOrderNumber).replace(/\D/g, '')) === Number(claimed.consecutiveOrderNumber))) {
                    tx.update(contactRef, { purchaseStatus: 'completed', purchaseDate: stamp() });
                }
            });
            await require('../leads/scheduledReminderScheduler').cancelReminderForContact(claimed.contactId, 'ya_pago');
            await require('../design/designPending').recomputeForContact(claimed.contactId);
        }
        if (departmentId !== 'r6VSzBKpxDxygazz1qdr') {
            await require('../services').sendPurchaseEventOnFabricar(orderId, claimed, claimed.paymentProductionPreviousStatus || '');
        }
        await ref.update({ fabricarSinVenta: false, paymentProductionPending: false, paymentProductionStatus: 'done', paymentProductionReason: '', paymentProductionLeaseUntil: null, paymentProductionNextAttemptAt: null });
        return { status: 'fabricar', orderNumber: `DH${claimed.consecutiveOrderNumber}` };
    } catch (error) {
        await ref.update({ paymentProductionPending: true, paymentProductionStatus: 'retry', paymentProductionReason: error.message.slice(0, 180), paymentProductionLeaseUntil: null,
            paymentProductionNextAttemptAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60000) });
        return { status: 'retry', reason: error.message };
    }
}

module.exports = { reconcilePaymentProduction, approvedPayment, initialStatus };
