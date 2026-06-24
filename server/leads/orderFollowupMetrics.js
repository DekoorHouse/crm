/**
 * Métricas y atribución del seguimiento de "pedido en proceso".
 *
 * Mide el embudo de rescate sobre una colección durable (no se pierde al re-armar
 * el seguimiento): `order_followup_sends/{wa_id}` con 1 registro por cliente contactado.
 *
 *   contactado  -> recibió al menos un mensaje del sistema
 *   respondió   -> el cliente escribió de vuelta tras ser contactado
 *   recuperado  -> registró pedido dentro de la ventana de atribución (default 7 días)
 *
 * Estado: 'contacted' -> 'replied' -> 'converted' (no se degrada).
 */
const { db, admin } = require('../config');
const { toMillis } = require('./orderFollowupLogic');

const COLLECTION = 'order_followup_sends';
const DAY_MS = 24 * 60 * 60 * 1000;
const ATTRIBUTION_DAYS = Number(process.env.ORDER_FOLLOWUP_ATTRIBUTION_DAYS) || 7;

// Registra/actualiza un envío hacia un contacto (upsert por wa_id). Se llama tras
// cada mensaje enviado por el sweep. No degrada un estado ya avanzado.
async function recordOrderFollowupSend(waId, { name, stage, pendiente, datosDados, text } = {}) {
    if (!waId) return;
    const ref = db.collection(COLLECTION).doc(waId);
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() : null;
    const nowTs = admin.firestore.FieldValue.serverTimestamp();

    const update = {
        waId,
        name: name || (prev && prev.name) || null,
        pendiente: pendiente || (prev && prev.pendiente) || null,
        datosDados: (Array.isArray(datosDados) && datosDados.length) ? datosDados : (prev && prev.datosDados) || [],
        lastText: text || (prev && prev.lastText) || null,
        lastStage: typeof stage === 'number' ? stage : (prev && prev.lastStage) || 0,
        lastContactedAt: nowTs,
        messagesSent: admin.firestore.FieldValue.increment(1),
        updatedAt: nowTs
    };
    if (!prev) {
        update.firstContactedAt = nowTs;
        update.status = 'contacted';
    } else if (!prev.status || prev.status === 'contacted') {
        update.status = 'contacted';
    }
    await ref.set(update, { merge: true });
}

// Marca que el cliente respondió tras ser contactado (desde el webhook entrante).
// No degrada 'converted'. Fire-and-forget.
async function markOrderFollowupReplied(waId) {
    if (!waId) return;
    try {
        const ref = db.collection(COLLECTION).doc(waId);
        const snap = await ref.get();
        if (!snap.exists) return;
        if (snap.data().status === 'contacted') {
            await ref.update({
                status: 'replied',
                repliedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (e) {
        console.warn('[ORDER_FOLLOWUP] markReplied falló:', e.message);
    }
}

// Marca recuperación cuando se registra un pedido del contacto, si fue contactado
// dentro de la ventana de atribución. Devuelve true si atribuyó. Fire-and-forget.
async function markOrderFollowupConverted(waId, { orderNumber, value } = {}) {
    if (!waId) return false;
    try {
        const ref = db.collection(COLLECTION).doc(waId);
        const snap = await ref.get();
        if (!snap.exists) return false;
        const d = snap.data();
        const lastMs = toMillis(d.lastContactedAt);
        if (!lastMs || (Date.now() - lastMs) > ATTRIBUTION_DAYS * DAY_MS) return false; // fuera de ventana
        if (d.status !== 'converted') {
            await ref.update({
                status: 'converted',
                convertedAt: admin.firestore.FieldValue.serverTimestamp(),
                orderNumber: orderNumber || null,
                purchaseValue: Number(value) || 0,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        return true;
    } catch (e) {
        console.warn('[ORDER_FOLLOWUP] markConverted falló:', e.message);
        return false;
    }
}

// Consulta cruda por rango de fecha de último contacto (cota razonable de tamaño).
async function queryByRange(fromMs, toMs, limit = 1000) {
    const from = admin.firestore.Timestamp.fromMillis(fromMs);
    const to = admin.firestore.Timestamp.fromMillis(toMs);
    const snap = await db.collection(COLLECTION)
        .where('lastContactedAt', '>=', from)
        .where('lastContactedAt', '<=', to)
        .orderBy('lastContactedAt', 'desc')
        .limit(limit)
        .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// KPIs del embudo en un rango [fromMs, toMs].
async function getOrderFollowupMetrics(fromMs, toMs) {
    const rows = await queryByRange(fromMs, toMs);
    const contacted = rows.length;
    const replied = rows.filter(r => r.status === 'replied' || r.status === 'converted').length;
    const converted = rows.filter(r => r.status === 'converted').length;
    const value = rows.reduce((s, r) => s + (Number(r.purchaseValue) || 0), 0);
    const messages = rows.reduce((s, r) => s + (Number(r.messagesSent) || 0), 0);

    const byPendiente = {};
    for (const r of rows) {
        const k = r.pendiente || 'sin dato';
        if (!byPendiente[k]) byPendiente[k] = { contacted: 0, converted: 0 };
        byPendiente[k].contacted++;
        if (r.status === 'converted') byPendiente[k].converted++;
    }

    const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
    return {
        contacted, replied, converted,
        messages,
        valueRecovered: value,
        replyRate: pct(replied, contacted),
        conversionRate: pct(converted, contacted),
        byPendiente,
        attributionDays: ATTRIBUTION_DAYS
    };
}

// Lista para el panel (rango + filtro opcional por estado).
async function listOrderFollowupSends(fromMs, toMs, { status, limit = 500 } = {}) {
    let rows = await queryByRange(fromMs, toMs, limit);
    if (status) rows = rows.filter(r => r.status === status);
    return rows.map(r => ({
        waId: r.waId,
        name: r.name || null,
        pendiente: r.pendiente || null,
        messagesSent: r.messagesSent || 0,
        status: r.status || 'contacted',
        firstContactedAt: toMillis(r.firstContactedAt),
        lastContactedAt: toMillis(r.lastContactedAt),
        repliedAt: toMillis(r.repliedAt),
        convertedAt: toMillis(r.convertedAt),
        orderNumber: r.orderNumber || null,
        purchaseValue: Number(r.purchaseValue) || 0
    }));
}

// Migración única: reconstruye order_followup_sends desde los order_followups que ya
// enviaron mensajes (para medir a los contactados antes de existir esta colección).
// Detecta de una vez si ya respondieron o ya compraron. Devuelve cuántos migró.
async function migrateSendsFromFollowups() {
    const snap = await db.collection('order_followups').get();
    let migrated = 0;
    for (const doc of snap.docs) {
        const d = doc.data();
        if (!((d.totalSent || 0) > 0)) continue;
        const waId = doc.id;
        const log = Array.isArray(d.sentLog) ? d.sentLog : [];
        const times = log.map(l => toMillis(l.at)).filter(Boolean);
        const firstMs = times.length ? Math.min(...times) : toMillis(d.lastSentAt);
        const lastMs = times.length ? Math.max(...times) : toMillis(d.lastSentAt);
        const T = admin.firestore.Timestamp;

        const rec = {
            waId,
            name: d.name || null,
            pendiente: d.pendiente || null,
            datosDados: d.datosDados || [],
            lastText: log.length ? log[log.length - 1].text : null,
            lastStage: d.stage || 0,
            messagesSent: d.totalSent || log.length || 1,
            firstContactedAt: firstMs ? T.fromMillis(firstMs) : admin.firestore.FieldValue.serverTimestamp(),
            lastContactedAt: lastMs ? T.fromMillis(lastMs) : admin.firestore.FieldValue.serverTimestamp(),
            status: 'contacted',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        let contact = null;
        try { const cs = await db.collection('contacts_whatsapp').doc(waId).get(); contact = cs.exists ? cs.data() : null; } catch (_) {}

        const orderMs = toMillis(contact && contact.lastOrderDate);
        if (orderMs && firstMs && orderMs >= firstMs && (orderMs - firstMs) <= ATTRIBUTION_DAYS * DAY_MS) {
            rec.status = 'converted';
            rec.convertedAt = T.fromMillis(orderMs);
            rec.orderNumber = contact.lastOrderNumber ? `DH${contact.lastOrderNumber}` : null;
            rec.purchaseValue = Number(contact.purchaseValue) || 0;
        } else if (lastMs) {
            try {
                const inb = await db.collection('contacts_whatsapp').doc(waId).collection('messages')
                    .where('from', '==', waId).orderBy('timestamp', 'desc').limit(1).get();
                const lastInbMs = inb.empty ? null : toMillis(inb.docs[0].data().timestamp);
                if (lastInbMs && lastInbMs > lastMs) { rec.status = 'replied'; rec.repliedAt = T.fromMillis(lastInbMs); }
            } catch (_) {}
        }

        await db.collection(COLLECTION).doc(waId).set(rec, { merge: true });
        migrated++;
    }
    return migrated;
}

module.exports = {
    COLLECTION,
    migrateSendsFromFollowups,
    recordOrderFollowupSend,
    markOrderFollowupReplied,
    markOrderFollowupConverted,
    getOrderFollowupMetrics,
    listOrderFollowupSends
};
