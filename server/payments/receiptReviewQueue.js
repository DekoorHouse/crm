const { db, admin } = require('../config');
const { hash, ms } = require('./paymentPolicy');
const stamp = () => admin.firestore.FieldValue.serverTimestamp();
const resolved = r => ['applied', 'duplicate', 'rejected'].includes(r.status);

// La identidad es la imagen concreta, nunca sólo el contacto o el número de pedido.
const sameReceipt = (a, b) => {
    if (a.contactId !== b.contactId) return false;
    if (a.ocr?.imageHash && b.ocr?.imageHash) return a.ocr.imageHash === b.ocr.imageHash;
    return !!a.fileUrl && a.fileUrl === b.fileUrl;
};
const alertToken = sr => hash([sr.imageUrl || '', ms(sr.at), sr.orderNumber || ''].join('|'));
const matchesAlert = (contact, receipt) => contact?.suspiciousReceiptPending && (
    sameReceipt({ contactId: receipt.contactId, fileUrl: contact.suspiciousReceipt?.imageUrl }, receipt) ||
    (!!receipt.reviewAlertToken && receipt.reviewAlertToken === alertToken(contact.suspiciousReceipt || {}))
);
const resolution = result => ({ suspiciousReceiptPending: false, suspiciousReceiptResolvedAt: stamp(), suspiciousReceiptResolvedBy: 'manual', suspiciousReceiptResolution: result });
const changed = message => Object.assign(new Error(message), { status: 409 });

async function mergeReviewRows(rows, suspiciousDocs) {
    const jobs = [];
    // También consultar los ya resueltos evita resucitar una alerta antigua de la IA.
    for (let i = 0; i < suspiciousDocs.length; i += 30) {
        const found = await db.collection('payment_receipts').where('contactId', 'in', suspiciousDocs.slice(i, i + 30).map(d => d.id)).get();
        jobs.push(...found.docs.map(d => ({ id: d.id, ...d.data() })));
    }
    const merged = new Map();
    for (const row of rows) {
        const key = row.imageHash ? hash(row.contactId + '|image|' + row.imageHash) : row.imageUrl ? hash(row.contactId + '|' + row.imageUrl) : row.id;
        if (!merged.has(key)) merged.set(key, { ...row });
    }
    for (const doc of suspiciousDocs) {
        const contact = doc.data(), sr = contact.suspiciousReceipt || {};
        const identity = { contactId: doc.id, fileUrl: sr.imageUrl };
        const matches = jobs.filter(r => sameReceipt(identity, r) || (r.reviewAlertToken && r.reviewAlertToken === alertToken(sr)));
        const existingKey = [...merged].find(([, r]) => r.contactId === doc.id && sr.imageUrl && r.imageUrl === sr.imageUrl)?.[0];
        const key = existingKey || (sr.imageUrl ? hash(doc.id + '|' + sr.imageUrl) : 'alert:' + doc.id);
        if (matches.some(resolved)) { merged.delete(key); continue; }
        let row = merged.get(key);
        if (!row) {
            // Las alertas anteriores al registro de recibos se conservan. Sólo se materializan
            // al revisarlas a mano; leer el tablero no acredita dinero ni lanza el worker.
            row = { id: 'alert:' + doc.id, contactId: doc.id, name: sr.orderNumber || contact.name || doc.id,
                orderNumber: sr.orderNumber || null, orderId: null, at: ms(sr.at), imageUrl: sr.imageUrl || null,
                status: 'review', amount: matches.find(r => r.ocr?.monto)?.ocr.monto || sr.cotejoOcr?.monto || null,
                reviewToken: alertToken(sr), reason: 'Revisar el comprobante y confirmar el importe recibido.' };
            merged.set(key, row);
        }
        Object.assign(row, { flagged: true, alertReason: sr.reason || 'La IA no pudo validar este comprobante.',
            suspiciousContactId: doc.id, channel: contact.channel || 'whatsapp', unreadCount: contact.unreadCount || 0,
            cotejo: sr.cotejo || null });
    }
    return [...merged.values()].sort((a, b) => (a.at || 0) - (b.at || 0));
}

// Adapta una alerta antigua al mismo recibo que usa la validación por importe.
// El token impide aprobar otra imagen si el cliente envió un comprobante mientras el diálogo estaba abierto.
async function resolveReviewRef(id, token) {
    if (!id.startsWith('alert:')) return db.collection('payment_receipts').doc(id);
    const contactId = id.slice(6), contactRef = db.collection('contacts_whatsapp').doc(contactId);
    return db.runTransaction(async tx => {
        const contact = (await tx.get(contactRef)).data(), sr = contact?.suspiciousReceipt || {};
        if (!contact?.suspiciousReceiptPending || !token || token !== alertToken(sr)) throw changed('El comprobante cambió o ya se resolvió. Actualiza la lista antes de revisarlo.');
        const rs = await tx.get(db.collection('payment_receipts').where('contactId', '==', contactId));
        const matches = rs.docs.filter(d => sameReceipt({ contactId, fileUrl: sr.imageUrl }, d.data()) || d.data().reviewAlertToken === token);
        if (matches.some(d => resolved(d.data()))) throw changed('El comprobante ya está resuelto. Actualiza la lista.');
        const existing = matches.find(d => d.data().open) || matches[0];
        if (existing) {
            if (existing.data().status === 'ignored') tx.update(existing.ref, { status: 'review', open: true, reviewAlertToken: token, updatedAt: stamp() });
            return existing.ref;
        }
        const ref = db.collection('payment_receipts').doc(hash('alert|' + contactId + '|' + token));
        tx.create(ref, { contactId, orderId: null, orderNumber: sr.orderNumber || null, fileUrl: sr.imageUrl || null,
            fileType: sr.fileType || null, receivedAt: sr.at || stamp(), createdAt: stamp(), updatedAt: stamp(),
            status: 'review', open: true, attempts: 0, reviewAlertToken: token, reason: sr.reason || 'Revisión manual pendiente.' });
        return ref;
    });
}

module.exports = { sameReceipt, matchesAlert, resolution, mergeReviewRows, resolveReviewRef, alertToken };
