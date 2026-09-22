const { db, admin } = require('./config');
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[*_`]/g, '');
const MEDIA = /\b(?:foto|imagen|video|diseno|previo|captura|archivo|adjunto)s?\b/;

function unsupportedMediaClaim(text, fileUrl) {
    const value = normalize(text);
    // Un marcador escrito por el modelo nunca es un archivo, ni siquiera junto
    // a otro adjunto real procedente de una respuesta rápida.
    if (/\[(?:imagen|foto|video|archivo adjunto|adjunto)\b[^\]]*\]/.test(value)) return true;
    if (!MEDIA.test(value)) return false;
    const hasAttachment = typeof fileUrl === 'string' && /^https?:\/\/\S+$/i.test(fileUrl);
    if (hasAttachment) return false;
    return /\b(?:aqui|ahi)\s+(?:(?:te|le|les|lo|la)\s+){0,2}(?:tienes?|esta|va|mando|envio|comparto|dejo|adjunto)\b/.test(value)
        || /\b(?:te|le|les)\s+(?:(?:lo|la)\s+)?(?:mando|envio|comparto|adjunto|enviare|mandare|enviaremos|mandaremos|compartire|compartiremos)\b/.test(value)
        || /\b(?:te|le|les)\s+(?:voy|vamos)\s+a\s+(?:enviar|mandar|compartir)\b/.test(value)
        || /\b(?:ya\s+)?(?:tengo|tenemos)\b[^.!?\n]{0,70}\b(?:list[oa]|aqui|diseno|imagen|foto|previo)\b/.test(value.replace(/\bno\s+(?:tengo|tenemos)\b/g, 'no dispongo'))
        || /\b(?:ya\s+)?esta(?:n)?\s+list[oa]s?\b[^.!?\n]{0,70}\b(?:diseno|imagen|foto|previo)s?\b/.test(value)
        || /\b(?:ya|aqui)\b[^.!?\n]{0,35}\b(?:adjunte|envie|mande|enviamos|mandamos)\b/.test(value)
        || /\b(?:ya\s+)?(?:pedi|solicite|avise|hable|reporte)\b[^.!?\n]{0,100}\b(?:equipo|companero|disenador|humano)s?\b/.test(value)
        || /\b(?:equipo|companeros|disenadores)\b[^.!?\n]{0,65}\b(?:enviaran|mandaran|compartiran|enviara|mandara|compartira|revisando)\b/.test(value);
}

async function protectMediaReply({ contactId, text, fileUrl = null, source = 'ai' }) {
    if (!unsupportedMediaClaim(text, fileUrl)) return { text, blocked: false };
    const ref = db.collection('contacts_whatsapp').doc(contactId);
    const first = await db.runTransaction(async tx => {
        const contact = (await tx.get(ref)).data();
        if (!contact) throw new Error('No se encontró el contacto para solicitar la imagen.');
        const pending = contact.needsAttention === true && contact.needsAttentionReason === 'equipo' && contact.mediaRequestPending === true;
        tx.update(ref, {
            needsAttention: true, needsAttentionReason: 'equipo',
            needsAttentionAt: admin.firestore.FieldValue.serverTimestamp(),
            mediaRequestPending: true,
            mediaRequest: { reason: 'La IA prometió una imagen o diseño sin adjuntar un archivo real.',
                requestedText: String(text).slice(0, 1500), source,
                at: admin.firestore.FieldValue.serverTimestamp() },
        });
        return !pending;
    });
    // Los seguimientos no vuelven a contactar al cliente para repetir la promesa.
    return { blocked: true, text: source === 'ai' && first
        ? 'Todavía no tengo un archivo del diseño para adjuntarte. Dejé tu solicitud pendiente para que una persona del equipo la revise y te ayude por aquí.'
        : null };
}

module.exports = { unsupportedMediaClaim, protectMediaReply };
