/**
 * Registro de "llegó un mensaje desde un anuncio" (pestaña Mensajes de /desglose).
 *
 * El adId vive dentro de cada mensaje (contacts_whatsapp/{id}/messages) y contarlos por rango de
 * fechas obligaba a recorrer todos los chats. Aquí queda un documento por contacto + anuncio + día
 * (México), así que una conversación que manda 5 mensajes desde el mismo anuncio cuenta UNA vez,
 * igual que Meta cuenta "conversaciones iniciadas". La consulta por rango usa solo `at`.
 */
const { db, admin } = require('../config');

const COLLECTION = 'ad_message_events';

const diaMx = date => date.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
const toDate = t => (t && typeof t.toDate === 'function') ? t.toDate() : (t instanceof Date ? t : new Date());

/**
 * Nunca lanza: es telemetría, no puede tumbar el webhook.
 * @param {{adId:string, contactId:string, channel?:string, at?:any}} ev
 */
async function recordAdMessage({ adId, contactId, channel = 'whatsapp', at = null }) {
    try {
        if (!adId || !contactId) return;
        const fecha = toDate(at);
        const id = `${String(contactId).replace(/\//g, '_')}_${String(adId)}_${diaMx(fecha)}`;
        await db.collection(COLLECTION).doc(id).create({
            adId: String(adId), contactId: String(contactId), channel,
            at: admin.firestore.Timestamp.fromDate(fecha), dia: diaMx(fecha),
        });
    } catch (e) {
        if (e.code === 6 || /already exists/i.test(String(e.message))) return; // ya contado hoy
        console.warn('[AD EVENTS] No se pudo registrar el mensaje de anuncio:', e.message);
    }
}

/** Eventos en [start, end). */
async function adMessagesInRange(start, end) {
    const snap = await db.collection(COLLECTION)
        .where('at', '>=', admin.firestore.Timestamp.fromDate(start))
        .where('at', '<', admin.firestore.Timestamp.fromDate(end))
        .get();
    return snap.docs.map(d => d.data());
}

module.exports = { recordAdMessage, adMessagesInRange, COLLECTION, diaMx };
