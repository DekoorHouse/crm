const router = require('express').Router();
const { db, admin } = require('../config');
const { processReceipt, deliverForm, discoverReceipts, refreshReportedPayment } = require('./paymentWorkflow');
const { ms, canRequestShippingForm } = require('./paymentPolicy');
const { resolveReviewRef, sameReceipt, matchesAlert, resolution } = require('./receiptReviewQueue');

router.post('/receipts/:id/review', async (req, res) => {
    try {
        const { amount, reactivate, action } = req.body || {};
        if (action !== 'reject' && (!(Number(amount) > 0) || !Number.isFinite(Number(amount)))) return res.status(400).json({ success: false, message: 'Confirma el importe que aparece en el comprobante.' });
        let { orderId } = req.body || {};
        const ref = await resolveReviewRef(req.params.id, req.body?.reviewToken);
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
                const contactRef = db.collection('contacts_whatsapp').doc(r.contactId);
                const contact = (await tx.get(contactRef)).data();
                const related = await tx.get(db.collection('payment_receipts').where('contactId', '==', r.contactId));
                const copies = related.docs.filter(other => other.id !== ref.id && other.data().open && sameReceipt(r, other.data()));
                const affectedOrders = [];
                for (const id of new Set(copies.map(d => d.data().orderId).filter(id => id && id !== r.orderId))) {
                    affectedOrders.push(await tx.get(db.collection('pedidos').doc(id)));
                }
                for (const other of copies) {
                    tx.update(other.ref, {
                        status: 'rejected', open: false, reason: 'Este mismo comprobante fue descartado por el operador.', reviewedBy: 'manual', leaseUntil: null, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                for (const other of affectedOrders) if (other.exists) tx.update(other.ref, { paymentFormNeedsAssessment: true });
                if (matchesAlert(contact, r)) tx.update(contactRef, resolution('rejected'));
                tx.update(ref, { status: 'rejected', open: false, reason: 'Comprobante descartado por el operador.', reviewedBy: 'manual', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                if (order?.exists) tx.update(orderRef, { paymentFormNeedsAssessment: true });
            });
            if (receipt.orderId) await refreshReportedPayment(receipt.orderId);
            return res.json({ success: true });
        }
        if (req.body.orderNumber) {
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
    } catch (error) { res.status(error.status || 500).json({ success: false, message: error.message }); }
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

// Recuperación del pedido exacto: usa los importes ya aprobados; no aprueba recibos.
router.post('/orders/:id/reconcile', async (req, res) => {
    try {
        const ref = db.collection('pedidos').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        const p = snap.data();
        await ref.update({ paymentProductionPending: true, paymentFormNeedsAssessment: true,
            ...(p.comprobanteValidadoAt && !p.shippingFormStatus && !p.shippingFormSentAt ? { shippingFormStatus: 'pending', shippingFormNextAttemptAt: admin.firestore.FieldValue.serverTimestamp() } : {}) });
        const form = await refreshReportedPayment(ref.id);
        const order = (await ref.get()).data();
        res.json({ success: true, form, orderNumber: `DH${order.consecutiveOrderNumber}`, status: order.estatus, productionStatus: order.paymentProductionStatus, reason: order.paymentProductionReason || '' });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
module.exports = router;
