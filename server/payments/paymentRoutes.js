const router = require('express').Router();
const { db, admin } = require('../config');
const { processReceipt, deliverForm, discoverReceipts, refreshReportedPayment } = require('./paymentWorkflow');
const { ms, canRequestShippingForm } = require('./paymentPolicy');

router.post('/receipts/:id/review', async (req, res) => {
    try {
        const { amount, reactivate, action } = req.body || {};
        let { orderId } = req.body || {};
        const ref = db.collection('payment_receipts').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: 'Comprobante no encontrado.' });
        const receipt = snap.data();
        if (!receipt.open) return res.status(409).json({ success: false, message: 'El comprobante ya está resuelto.' });
        if (ms(receipt.leaseUntil) > Date.now()) return res.status(409).json({ success: false, message: 'El comprobante se está procesando. Actualiza en unos segundos.' });
        if (action === 'reject') {
            await db.runTransaction(async tx => {
                const r = (await tx.get(ref)).data();
                if (!r?.open || ms(r.leaseUntil) > Date.now()) throw new Error('El comprobante ya se resolvió o se está procesando. Actualiza la lista.');
                const orderRef = r.orderId ? db.collection('pedidos').doc(r.orderId) : null;
                const order = orderRef ? await tx.get(orderRef) : null;
                tx.update(ref, { status: 'rejected', open: false, reason: 'Comprobante descartado por el operador.', reviewedBy: 'manual', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                if (order?.exists) tx.update(orderRef, { paymentFormNeedsAssessment: true });
            });
            if (receipt.orderId) await refreshReportedPayment(receipt.orderId);
            return res.json({ success: true });
        }
        if (!(Number(amount) > 0) || !Number.isFinite(Number(amount))) return res.status(400).json({ success: false, message: 'Confirma el importe que aparece en el comprobante.' });
        if (!receipt.orderId && req.body.orderNumber) {
            const number = Number(String(req.body.orderNumber).replace(/\D/g, ''));
            const matches = await db.collection('pedidos').where('consecutiveOrderNumber', '==', number).get();
            const selected = matches.docs.filter(d => d.data().contactId === receipt.contactId);
            if (selected.length !== 1) return res.status(400).json({ success: false, message: 'No hay un pedido único con ese número para el contacto.' });
            orderId = selected[0].id;
        }
        let orderNumber;
        if (orderId) {
            const order = await db.collection('pedidos').doc(String(orderId)).get();
            if (!order.exists || order.data().contactId !== receipt.contactId) return res.status(400).json({ success: false, message: 'El pedido no corresponde al contacto.' });
            if (receipt.orderId && receipt.orderId !== orderId) return res.status(409).json({ success: false, message: 'El comprobante ya está vinculado a otro pedido.' });
            orderNumber = `DH${order.data().consecutiveOrderNumber}`;
        }
        const result = await processReceipt(ref.id, { manual: true, amount: Number(amount), reactivate: reactivate === true, ...(orderId ? { orderId, orderNumber } : {}) });
        res.status(['review', 'unchanged'].includes(result.status) ? 409 : 200).json({ success: !['review', 'unchanged'].includes(result.status), message: result.reason || 'Comprobante registrado.', result });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

router.post('/forms/:id/retry', async (req, res) => {
    try {
        const result = await deliverForm(req.params.id, { force: true });
        res.status(result.status === 'sent' ? 200 : 409).json({ success: result.status === 'sent', result, message: result.status === 'sent' ? 'Formulario enviado.' : 'El formulario sigue pendiente; revisa el motivo.' });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

router.post('/forms/:id/confirm-sent', async (req, res) => {
    try {
        const ref = db.collection('pedidos').doc(req.params.id);
        await db.runTransaction(async tx => {
            const order = (await tx.get(ref)).data();
            if (!canRequestShippingForm(order)) throw new Error('Los comprobantes todavía no cubren el total del pedido.');
            if (ms(order.shippingFormLeaseUntil) > Date.now()) throw new Error('El formulario se está enviando. Actualiza en unos segundos.');
            tx.update(ref, { shippingFormStatus: 'sent', shippingFormSentAt: order.shippingFormSentAt || admin.firestore.FieldValue.serverTimestamp(), shippingFormReviewedBy: 'manual', shippingFormReason: 'El operador confirmó en el chat que el cliente recibió el formulario.', shippingFormLeaseUntil: null });
        });
        res.json({ success: true });
    } catch (error) { res.status(409).json({ success: false, message: error.message }); }
});

router.post('/contacts/:id/recover', async (req, res) => {
    try { res.json({ success: true, receipts: await discoverReceipts(req.params.id) }); }
    catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
module.exports = router;
