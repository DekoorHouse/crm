const { db, admin } = require('../config');
const { ms } = require('./paymentPolicy');
const { OUTCOME_VERSION, isDefinitivelyFailed } = require('./receiptOutcome');
const { sameReceipt, matchesAlert, resolution } = require('./receiptReviewQueue');
const stamp = () => admin.firestore.FieldValue.serverTimestamp();
const date = n => admin.firestore.Timestamp.fromMillis(n);

// Cierra sólo intentos fallidos: nunca revierte pagos ya aplicados ni toca saldos.
async function rejectFailedReceipt(ref, ocr, { processing = false, expectedFileUrl } = {}) {
    return db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (!current?.open || ['applied', 'duplicate', 'ignored', 'rejected'].includes(current.status)) return null;
        if (!processing && ms(current.leaseUntil) > Date.now()) return null;
        if (expectedFileUrl && current.fileUrl !== expectedFileUrl) return null;
        if (current.ocr?.imageHash && ocr.imageHash && current.ocr.imageHash !== ocr.imageHash) return null;
        const related = await tx.get(db.collection('payment_receipts').where('contactId', '==', current.contactId));
        const identity = { ...current, ocr };
        const failure = isDefinitivelyFailed(ocr) ? ocr : related.docs.find(d =>
            d.data().status === 'rejected' && isDefinitivelyFailed(d.data().ocr) && sameReceipt(identity, d.data()))?.data().ocr;
        if (!failure) return null;
        const copies = related.docs.filter(d => d.id !== ref.id && d.data().open && sameReceipt(identity, d.data()));
        const contactRef = db.collection('contacts_whatsapp').doc(current.contactId);
        const contact = (await tx.get(contactRef)).data();
        const orders = [];
        for (const id of new Set([current.orderId, ...copies.map(d => d.data().orderId)].filter(Boolean))) {
            orders.push(await tx.get(db.collection('pedidos').doc(id)));
        }
        const reason = `Intento de pago fallido: ${failure.evidenciaEstado}. No se registró ningún abono.`;
        for (const receipt of [{ ref, data: () => current }, ...copies]) tx.update(receipt.ref, {
            status: 'rejected', open: false, rejectionKind: 'failed_operation', reason, reviewedBy: 'automatic',
            leaseUntil: null, updatedAt: stamp(), failureReviewVersion: OUTCOME_VERSION,
            ocr: { ...(receipt.data().ocr || ocr), pagoRealizado: false, estadoOperacion: 'rechazado',
                evidenciaEstado: failure.evidenciaEstado, outcomeVersion: OUTCOME_VERSION },
        });
        for (const order of orders) if (order.exists) tx.update(order.ref, { paymentFormNeedsAssessment: true });
        if ([current, ...copies.map(d => d.data())].some(r => matchesAlert(contact, r))) tx.update(contactRef, { ...resolution('failed_operation'), suspiciousReceiptResolvedBy: 'automatic' });
        return { status: 'rejected', reason };
    });
}

// Los OCR antiguos sólo decían false: volver a leerlos una vez sin aprobar pagos.
// El lote y los intentos son acotados; una lectura fallida conserva la tarjeta.
async function reassessFailedReceipts(limit = 3) {
    const reviews = await db.collection('payment_receipts').where('status', '==', 'review').get();
    const eligible = r => r?.open && !r.verifiedProvider && r.ocr?.pagoRealizado === false && r.fileUrl
        && r.failureReviewVersion !== OUTCOME_VERSION && !(r.ocr.outcomeVersion === OUTCOME_VERSION && !isDefinitivelyFailed(r.ocr))
        && (r.failureReviewAttempts || 0) < 3 && ms(r.leaseUntil) <= Date.now()
        && ms(r.failureReviewLeaseUntil) <= Date.now() && ms(r.failureReviewNextAt) <= Date.now();
    for (const doc of reviews.docs.filter(d => eligible(d.data())).slice(0, limit)) {
        const claimed = await db.runTransaction(async tx => {
            const current = (await tx.get(doc.ref)).data();
            if (!current || current.status !== 'review' || !eligible(current)) return null;
            tx.update(doc.ref, { failureReviewAttempts: (current.failureReviewAttempts || 0) + 1, failureReviewLeaseUntil: date(Date.now() + 180000) });
            return current;
        });
        if (!claimed) continue;
        try {
            const reading = isDefinitivelyFailed(claimed.ocr) ? claimed.ocr : await require('../services').extractReceiptData(claimed.fileUrl, claimed.fileType);
            if (isDefinitivelyFailed(reading)) await rejectFailedReceipt(doc.ref, reading, { expectedFileUrl: claimed.fileUrl });
            await db.runTransaction(async tx => {
                const current = (await tx.get(doc.ref)).data();
                if (!current || current.status !== 'review' || !current.open || ms(current.leaseUntil) > Date.now()) return;
                if (current.fileUrl !== claimed.fileUrl || current.ocr?.imageHash !== claimed.ocr?.imageHash) return;
                tx.update(doc.ref, { failureReviewVersion: OUTCOME_VERSION, failureReviewLeaseUntil: null, failureReviewAt: stamp(),
                    // Conservar el importe y false originales: una relectura nunca aprueba.
                    ocr: { ...current.ocr, estadoOperacion: reading.estadoOperacion === 'realizado' ? 'desconocido' : (reading.estadoOperacion || 'desconocido'),
                        evidenciaEstado: reading.evidenciaEstado || '', outcomeVersion: OUTCOME_VERSION } });
            });
        } catch (error) {
            await doc.ref.update({ failureReviewLeaseUntil: null, failureReviewNextAt: date(Date.now() + 300000), failureReviewError: error.message.slice(0, 180) });
        }
    }
}

module.exports = { rejectFailedReceipt, reassessFailedReceipts };
