const { db, admin } = require('./config');
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[*_`]/g, '');
const MEDIA = /\b(?:foto|imagen|video|diseno|previo|captura|archivo|adjunto)s?\b/;

// Only a future photo of the finished product belongs to the production flow.
// Arbitrary promises of custom designs still require a real attachment/handoff.
function productionPhotoNotice(text) {
    const value = normalize(text);
    return /\b(?:foto|imagen)s?\b/.test(value)
        && /\b(?:producto|pedido|trabajo)\s+(?:terminado|personalizado)\b|\b(?:cuando|en cuanto)\s+este\s+(?:terminado|listo)\b|\ben cuanto\b.{0,100}\b(?:ajuste|correccion)\b/.test(value)
        && /\bte\s+(?:enviaremos|mandaremos|compartiremos|enviare|mandare)\b|\b(?:cuando|en cuanto)\b.{0,180}\bte\s+(?:envio|mando|comparto)\b/.test(value)
        && !/\b(?:aqui|ahora|adjunto)\b|\[/.test(value);
}

const productionClaim = text => /\b(?:esta|estan|entro|entraron|paso|pasaron)\s+(?:ya\s+)?(?:en|a)\s+fabricacion\b|\b(?:arrancamos|iniciamos|comenzamos)\s+(?:la\s+)?fabricacion\b/.test(normalize(text));
const latestOrder = docs => [...docs].sort((a, b) => {
    const ms = v => v?.toMillis ? v.toMillis() : new Date(v || 0).getTime();
    return ms(b.data().createdAt) - ms(a.data().createdAt);
})[0];

async function truthfulProductionReply(contactId, text) {
    const parts = String(text || '').split(/(?<=[.!?])\s+|\n+/);
    if (!parts.some(p => productionPhotoNotice(p) || productionClaim(p))) return text;
    const orders = await db.collection('pedidos').where('contactId', '==', contactId).get();
    const contact = (await db.collection('contacts_whatsapp').doc(contactId).get()).data();
    const order = latestOrder(orders.docs.filter(d => !contact?.activePurchaseSessionId || d.data().purchaseSessionId === contact.activePurchaseSessionId))?.data();
    return parts.map(part => {
        if (productionPhotoNotice(part)) {
            if (/\b(?:ajuste|correccion)\b/.test(normalize(part))) {
                return 'La solicitud de cambio debe revisarla el equipo. Si se realiza el ajuste, recibirás una foto actualizada.';
            }
            // No generated deadline is treated as a verified production date.
            if (order && ['Sin estatus', 'Fabricar', 'Esperando anticipo'].includes(order.estatus)) {
                return 'Cuando tu pedido esté terminado, recibirás la foto para continuar con el proceso.';
            }
            return order ? 'El envío de la foto depende del avance del pedido; todavía no puedo confirmar una fecha.'
                : 'Si confirmas tu pedido, recibirás la foto cuando esté terminado; todavía no puedo confirmar una fecha.';
        }
        if (productionClaim(part) && order?.estatus !== 'Fabricar') {
            return order ? 'Tu pedido está registrado. Todavía no puedo confirmar que esté en fabricación.'
                : 'Todavía no puedo confirmar el registro ni el inicio de fabricación de tu pedido.';
        }
        return part;
    }).join('\n');
}

function unsupportedMediaClaim(text, fileUrl) {
    const value = normalize(text);
    // Un marcador escrito por el modelo nunca es un archivo, ni siquiera junto
    // a otro adjunto real procedente de una respuesta rápida.
    if (/\[(?:imagen|foto|video|archivo adjunto|adjunto)\b[^\]]*\]/.test(value)) return true;
    if (!MEDIA.test(value)) return false;
    const hasAttachment = typeof fileUrl === 'string' && /^https?:\/\/\S+$/i.test(fileUrl);
    if (hasAttachment) return false;
    // La acción y el archivo deben pertenecer a la misma oración. "El equipo
    // revisa tu pago. No reenvíes la imagen" no es una promesa de adjuntar nada.
    return value.split(/[.!?\n]+/).some(sentence => {
        if (!MEDIA.test(sentence)) {
            // Pronombre que retoma la foto en la oración anterior.
            return /\bte (?:la|lo) (?:envio|mando|comparto|adjunto)\b/.test(sentence) && !/\bno\s+te\b/.test(sentence);
        }
        const affirmative = sentence.replace(/\b(?:no|nunca)\s+(?:(?:te|le|les)\s+)?(?:(?:lo|la)\s+)?(?:tengo|tenemos|envio|mando|comparto|adjunto|enviare|mandare)\b/g, 'negado');
        return /\b(?:aqui|ahi)\s+(?:(?:te|le|les|lo|la)\s+){0,2}(?:tienes?|esta|va|mando|envio|comparto|dejo|adjunto)\b/.test(affirmative)
            || /\b(?:te|le|les)\s+(?:(?:lo|la)\s+)?(?:mando|envio|comparto|adjunto|enviare|mandare|enviaremos|mandaremos|compartire|compartiremos)\b/.test(affirmative)
            || /\b(?:te|le|les)\s+(?:voy|vamos)\s+a\s+(?:enviar|mandar|compartir)\b/.test(affirmative)
            || /\b(?:tengo|tenemos)\b.{0,70}\b(?:list[oa]|aqui)\b/.test(affirmative)
            || /\besta(?:n)?\s+list[oa]s?\b.{0,70}\b(?:diseno|imagen|foto|previo)s?\b/.test(affirmative)
            || /\b(?:aqui|ahora)\b.{0,35}\b(?:adjunte|envie|mande|enviamos|mandamos)\b/.test(affirmative)
            || /\b(?:equipo|companeros|disenadores)\b.{0,65}\b(?:enviaran|mandaran|compartiran|enviara|mandara|compartira|manden|envien)\b/.test(affirmative);
    });
}

async function protectMediaReply({ contactId, text, fileUrl = null, source = 'ai' }) {
    // Never normalize away a fake attachment or an immediate delivery claim.
    if (!/\[(?:imagen|foto|video|archivo adjunto|adjunto)\b/i.test(normalize(text))) {
        text = await truthfulProductionReply(contactId, text);
    }
    if (!unsupportedMediaClaim(text, fileUrl)) return { text, blocked: false };
    const ref = db.collection('contacts_whatsapp').doc(contactId);
    const first = await db.runTransaction(async tx => {
        const contact = (await tx.get(ref)).data();
        if (!contact) throw new Error('No se encontró el contacto para solicitar la imagen.');
        const messages = await tx.get(ref.collection('messages').orderBy('timestamp', 'desc').limit(40));
        const priorAttachments = messages.docs.filter(d => {
            const m = d.data();
            return m.from && m.from !== contactId && m.fileUrl && m.status !== 'failed' && m.status !== 'scheduled';
        }).map(d => d.id).slice(0, 10);
        const orders = await tx.get(db.collection('pedidos').where('contactId', '==', contactId));
        const latest = orders.docs.sort((a, b) => {
            const ms = v => v?.toMillis ? v.toMillis() : new Date(v || 0).getTime();
            return ms(b.data().createdAt) - ms(a.data().createdAt);
        })[0];
        const pending = contact.needsAttention === true && contact.needsAttentionReason === 'equipo' && contact.mediaRequestPending === true;
        tx.update(ref, {
            needsAttention: true, needsAttentionReason: 'equipo',
            needsAttentionAt: admin.firestore.FieldValue.serverTimestamp(),
            mediaRequestPending: true,
            mediaRequest: { reason: priorAttachments.length
                ? 'La respuesta anuncia un adjunto que no incluye. Ya hay archivos enviados en el historial; revisar cuál corresponde, sin asumir que falta el diseño.'
                : 'La respuesta anuncia un adjunto que no incluye; revisar el archivo solicitado.',
                priorAttachmentIds: priorAttachments, orderId: latest?.id || null,
                orderStatus: latest?.data().estatus || null,
                requestedText: String(text).slice(0, 1500), source,
                at: admin.firestore.FieldValue.serverTimestamp() },
        });
        return !pending;
    });
    // Los seguimientos no vuelven a contactar al cliente para repetir la promesa.
    return { blocked: true, text: source === 'ai' && first
        ? 'Este mensaje no incluye un archivo adjunto. Dejé el caso al equipo para que revise lo que necesitas y los archivos que ya están en la conversación.'
        : null };
}

module.exports = { unsupportedMediaClaim, protectMediaReply };
