const { db, admin } = require('../config');
const { ms } = require('./paymentPolicy');
const stamp = () => admin.firestore.FieldValue.serverTimestamp();
const closed = r => !r?.open || ['applied', 'ignored', 'rejected', 'duplicate'].includes(r.status);
const mediaId = r => /^\d+$/.test(String(r?.whatsappMediaId || '')) ? String(r.whatsappMediaId)
    : /^\/webhook\/wa\/media\/(\d+)$/.exec(r?.mediaProxyUrl || '')?.[1];

async function recoverReceiptMedia(ref) {
    const claim = await db.runTransaction(async tx => {
        const r = (await tx.get(ref)).data();
        if (closed(r) || r.fileUrl) return null;
        if (ms(r.mediaRecoveryLeaseUntil) > Date.now()) throw new Error('Recuperando comprobante. Intenta de nuevo en unos momentos.');
        if ((r.mediaRecoveryAttempts || 0) >= 5) throw new Error('No se pudo recuperar el archivo tras cinco intentos. Solicita que reenvíen el comprobante.');
        if (ms(r.mediaRecoveryNextAt) > Date.now()) throw new Error('Recuperando comprobante. El siguiente intento ya está programado.');
        const messageRef = db.collection('contacts_whatsapp').doc(r.contactId).collection('messages').doc(r.messageId);
        const m = (await tx.get(messageRef)).data();
        if (m?.fileUrl) {
            tx.update(ref, { fileUrl: m.fileUrl, fileType: m.fileType || r.fileType || null, mediaRecoveryStatus: 'recovered', updatedAt: stamp() });
            return null;
        }
        const id = mediaId(r) || mediaId(m);
        if (!id) {
            tx.update(ref, { mediaRecoveryStatus: 'unavailable', reason: 'No hay archivo ni identificador de WhatsApp para recuperarlo. Solicita que reenvíen el comprobante.', updatedAt: stamp() });
            return null;
        }
        tx.update(ref, { whatsappMediaId: id, mediaRecoveryStatus: 'recovering', mediaRecoveryAttempts: (r.mediaRecoveryAttempts || 0) + 1,
            mediaRecoveryLeaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 180000), reason: 'Recuperando comprobante desde WhatsApp.', updatedAt: stamp() });
        return { r, id, messageRef };
    });
    if (!claim) return (await ref.get()).data();
    try {
        const { publicUrl, mimeType } = await require('../whatsappMedia').downloadAndUploadMedia(claim.id, claim.r.contactId);
        if (!publicUrl || !/^(image\/|application\/pdf)/i.test(mimeType || '')) throw new Error('Formato de comprobante no válido');
        await db.runTransaction(async tx => {
            const fresh = (await tx.get(ref)).data();
            const message = (await tx.get(claim.messageRef)).data();
            if (closed(fresh) || fresh.fileUrl || fresh.messageId !== claim.r.messageId) return;
            tx.update(ref, { fileUrl: publicUrl, fileType: mimeType, mediaRecoveryStatus: 'recovered', mediaRecoveryLeaseUntil: null, updatedAt: stamp() });
            if (message && !message.fileUrl) tx.update(claim.messageRef, { fileUrl: publicUrl, fileType: mimeType, whatsappMediaId: claim.id });
        });
        return (await ref.get()).data();
    } catch (e) {
        await db.runTransaction(async tx => {
            const fresh = (await tx.get(ref)).data();
            if (closed(fresh) || fresh.fileUrl) return;
            const exhausted = fresh.mediaRecoveryAttempts >= 5;
            tx.update(ref, { mediaRecoveryStatus: exhausted ? 'unavailable' : 'retry', mediaRecoveryLeaseUntil: null,
                mediaRecoveryNextAt: admin.firestore.Timestamp.fromMillis(Date.now() + fresh.mediaRecoveryAttempts * 60000),
                reason: exhausted ? 'No se pudo recuperar el archivo tras cinco intentos. Solicita que reenvíen el comprobante.' : 'Recuperando comprobante: falló la descarga o el guardado. Se reintentará automáticamente.', updatedAt: stamp() });
        });
        throw new Error('No se pudo recuperar la imagen del comprobante. Consulta su estado e inténtalo más tarde.');
    }
}

async function recoverMissingReceiptMedia() {
    const snap = await db.collection('payment_receipts').where('status', '==', 'review').get();
    const due = snap.docs.filter(d => { const r = d.data(); return r.open && !r.fileUrl && !r.ocr && r.mediaRecoveryStatus !== 'unavailable'
        && (r.mediaRecoveryAttempts || 0) < 5 && ms(r.leaseUntil) <= Date.now() && ms(r.mediaRecoveryLeaseUntil) <= Date.now() && ms(r.mediaRecoveryNextAt) <= Date.now(); });
    for (const doc of due.slice(0, 3)) {
        try {
            const recovered = await recoverReceiptMedia(doc.ref);
            if (!recovered?.fileUrl) continue;
            await db.runTransaction(async tx => {
                const r = (await tx.get(doc.ref)).data();
                if (closed(r) || r.status !== 'review' || !r.fileUrl || ms(r.leaseUntil) > Date.now()) return;
                tx.update(doc.ref, { status: 'pending', nextAttemptAt: stamp(), reason: 'Imagen recuperada; comprobante pendiente de validación.', updatedAt: stamp() });
            });
        } catch (_) { /* El estado y el siguiente intento quedan guardados. */ }
    }
}

module.exports = { recoverReceiptMedia, recoverMissingReceiptMedia, mediaId };
