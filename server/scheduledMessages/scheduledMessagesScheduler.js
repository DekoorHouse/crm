/**
 * Mensajes programados - Scheduler automático
 *
 * Cuando un operador activa el "modo programar" en una conversación y manda
 * mensajes, estos se guardan en la subcolección messages del contacto con
 * status:'scheduled' y scheduledAt (el momento objetivo, igual para todos los
 * mensajes mandados con el modo activo). Este scheduler barre cada minuto los
 * programados vencidos (scheduledAt <= ahora) y los envía reutilizando las
 * MISMAS funciones de servicio que el envío normal, luego actualiza el MISMO
 * documento a status:'sent' (transición natural en el chat, sin duplicados).
 *
 * El doc lo crea el endpoint POST /api/contacts/:id/schedule-message.
 * Query: collectionGroup('messages') donde status=='scheduled' y scheduledAt<=now.
 * Requiere índice COLLECTION_GROUP (status, scheduledAt) en firestore.indexes.json.
 *
 * Config por env: SCHEDULED_MSG_CRON (default cada minuto), SCHEDULED_MSG_MAX_PER_SWEEP.
 */
const cron = require('node-cron');
const { db, admin } = require('../config');
const { sendAdvancedWhatsAppMessage, sendMessengerMessage } = require('../services');

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const CRON_SCHEDULE = process.env.SCHEDULED_MSG_CRON || '* * * * *'; // cada minuto
const MAX_SEND_ATTEMPTS = 3;
const MAX_PER_SWEEP = Number(process.env.SCHEDULED_MSG_MAX_PER_SWEEP || 50);

let scheduledTask = null;
let sweepRunning = false;

/**
 * Envía un mensaje programado por el canal correcto, reutilizando los servicios
 * existentes (que ya manejan texto + media; sendMessengerMessage además
 * transcodifica el video para Messenger/Instagram).
 * @returns {Promise<{id: string|null, textForDb: string}>}
 */
async function deliverScheduledMessage(contactId, data) {
    const channel = data.channel || 'whatsapp';
    const { text, fileUrl, fileType } = data;

    if (channel === 'messenger' || channel === 'instagram') {
        // Para Messenger/Instagram necesitamos el PSID/IGSID del destinatario.
        let recipientId = contactId.replace(/^(fb_|ig_)/, '');
        try {
            const cdoc = await db.collection('contacts_whatsapp').doc(contactId).get();
            if (cdoc.exists) {
                recipientId = cdoc.data().psid || cdoc.data().igsid || recipientId;
            }
        } catch (_) { /* usar el fallback derivado del id */ }

        const sent = await sendMessengerMessage(recipientId, { text, fileUrl, fileType, channel });
        const last = sent.messages && sent.messages.length ? sent.messages[sent.messages.length - 1] : null;
        return {
            id: last ? last.id : null,
            textForDb: sent.lastTextForDb || (last ? last.textForDb : (text || '')),
        };
    }

    // WhatsApp: sendAdvancedWhatsAppMessage entrega texto y media (por URL/link).
    const result = await sendAdvancedWhatsAppMessage(contactId, { text, fileUrl, fileType });
    return { id: result.id, textForDb: result.textForDb };
}

async function runScheduledMessagesSweep({ dryRun = false } = {}) {
    if (sweepRunning) return { skipped: true, reason: 'sweep_en_curso' };
    sweepRunning = true;
    const summary = { evaluated: 0, sent: 0, errors: 0, dryRun, wouldSend: [] };
    try {
        if (!process.env.WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
            console.warn('[SCHED_MSG] Saltando: faltan credenciales de WhatsApp.');
            return summary;
        }

        const nowTs = admin.firestore.Timestamp.now();
        let snap;
        try {
            snap = await db.collectionGroup('messages')
                .where('status', '==', 'scheduled')
                .where('scheduledAt', '<=', nowTs)
                .limit(MAX_PER_SWEEP)
                .get();
        } catch (e) {
            console.error('[SCHED_MSG] Error consultando programados (¿falta el índice COLLECTION_GROUP?):', e.message);
            return { ...summary, errors: 1 };
        }
        if (snap.empty) return summary;

        for (const doc of snap.docs) {
            summary.evaluated++;
            const data = doc.data();

            // contactId = id del doc padre: contacts_whatsapp/{contactId}/messages/{msgId}
            const contactRef = doc.ref.parent.parent;
            if (!contactRef) {
                await doc.ref.update({ status: 'failed', lastError: 'sin_contacto', updatedAt: new Date() }).catch(() => {});
                summary.errors++;
                continue;
            }
            const contactId = contactRef.id;

            if (dryRun) {
                summary.wouldSend.push({ contactId, messageId: doc.id, text: data.text || null });
                continue;
            }

            try {
                const result = await deliverScheduledMessage(contactId, data);
                // Transición en el MISMO doc: programado -> enviado.
                await doc.ref.update({
                    status: 'sent',
                    id: result.id || doc.id,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    sentAt: admin.firestore.FieldValue.serverTimestamp(),
                    scheduledAt: admin.firestore.FieldValue.delete(),
                });
                await contactRef.update({
                    lastMessage: (result.textForDb || data.text || '').substring(0, 100),
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                }).catch(() => {});
                summary.sent++;
                console.log(`[SCHED_MSG] ✓ Programado enviado a ${contactId} (msg ${doc.id})`);
            } catch (e) {
                const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                const attempts = (data.attempts || 0) + 1;
                const update = { attempts, lastError: (detail || '').substring(0, 500), updatedAt: new Date() };
                if (attempts >= MAX_SEND_ATTEMPTS) update.status = 'failed'; // deja de reintentar
                await doc.ref.update(update).catch(() => {});
                summary.errors++;
                console.error(`[SCHED_MSG] ✗ ${contactId} (msg ${doc.id}): ${detail}`);
            }

            // Pequeña pausa entre envíos para no rozar rate limits
            await new Promise(r => setTimeout(r, 400));
        }
        return summary;
    } finally {
        sweepRunning = false;
    }
}

function startScheduledMessagesScheduler() {
    if (scheduledTask) {
        console.log('[SCHED_MSG] Scheduler ya iniciado');
        return;
    }
    console.log(`[SCHED_MSG] Scheduler de mensajes programados iniciado. Cron: ${CRON_SCHEDULE}`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        runScheduledMessagesSweep().catch(e => console.error('[SCHED_MSG] Sweep error:', e.message));
    });
}

module.exports = {
    startScheduledMessagesScheduler,
    runScheduledMessagesSweep,
};
