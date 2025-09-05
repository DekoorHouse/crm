const express = require('express');
const axios = require('axios');
const { db, admin } = require('./config');
const { handleWholesaleMessage, checkCoverage, triggerAutoReplyAI } = require('./services');

const router = express.Router();

// --- CONSTANTES ---
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// --- HORARIO Y MENSAJES AUTOMÁTICOS ---
const BUSINESS_HOURS = { 1: [7, 19], 2: [7, 19], 3: [7, 19], 4: [7, 19], 5: [7, 19], 6: [7, 14] };
const TIMEZONE = 'America/Mexico_City';
const AWAY_MESSAGE = `📩 ¡Hola! Gracias por tu mensaje.\n\n🕑 Nuestro horario de atención es:\n\n🗓 Lunes a Viernes: 7:00 am - 7:00 pm\n\n🗓 Sábado: 7:00 am - 2:00 pm\nTe responderemos tan pronto como regresemos.\n\n🙏 ¡Gracias por tu paciencia!`;
const GENERAL_WELCOME_MESSAGE = '¡Hola! 👋 Gracias por comunicarte. ¿Cómo podemos ayudarte hoy? 😊';

// --- NUEVA FUNCIÓN: MANEJAR ENVÍOS DE CONTINGENCIA ---
async function handleContingentSend(contactId) {
    const contingentQuery = db.collection('contingentSends')
        .where('contactId', '==', contactId)
        .where('status', '==', 'pending')
        .limit(1);

    const snapshot = await contingentQuery.get();
    if (snapshot.empty) {
        return false; // No hay envío pendiente para este contacto
    }

    const contingentDoc = snapshot.docs[0];
    const contingentData = contingentDoc.data();
    const { payload } = contingentData;

    console.log(`[CONTINGENT] Envío pendiente encontrado para ${contactId}. Ejecutando ahora.`);

    try {
        // Enviar la secuencia de mensajes primero
        if (payload.messageSequence && payload.messageSequence.length > 0) {
            for (const qr of payload.messageSequence) {
                await sendAdvancedWhatsAppMessage(contactId, { text: qr.message, fileUrl: qr.fileUrl, fileType: qr.fileType });
                await new Promise(resolve => setTimeout(resolve, 500)); // Pequeño retraso entre mensajes
            }
        }

        // Enviar el mensaje final con la foto
        await sendAdvancedWhatsAppMessage(contactId, {
            text: `¡Tu pedido ${payload.orderId} está listo! ✨`,
            fileUrl: payload.photoUrl,
            fileType: 'image/jpeg' // Asumimos jpeg, se podría mejorar
        });

        // Marcar como completado
        await contingentDoc.ref.update({ status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() });
        console.log(`[CONTINGENT] Envío pendiente para ${contactId} completado exitosamente.`);
        return true;

    } catch (error) {
        console.error(`[CONTINGENT] Error al ejecutar el envío pendiente para ${contactId}:`, error);
        await contingentDoc.ref.update({ status: 'failed', error: error.message });
        return false;
    }
}


// --- FUNCIONES AUXILIARES DEL WEBHOOK ---

function isWithinBusinessHours() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const day = now.getDay();
    const hour = now.getHours();
    const hoursToday = BUSINESS_HOURS[day];
    if (!hoursToday) return false;
    const [startHour, endHour] = hoursToday;
    return hour >= startHour && hour < endHour;
}

async function sendAdvancedWhatsAppMessage(to, { text, fileUrl, fileType, reply_to_wamid }) {
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let messagePayload;
    let messageToSaveText;

    if (fileUrl && fileType) {
        const type = fileType.startsWith('image/') ? 'image' :
                     fileType.startsWith('video/') ? 'video' :
                     fileType.startsWith('audio/') ? 'audio' : 'document';

        const mediaObject = { link: fileUrl };
        if (text) mediaObject.caption = text;

        messagePayload = { messaging_product: 'whatsapp', to, type, [type]: mediaObject };
        messageToSaveText = text || (type === 'image' ? '📷 Imagen' :
                                     type === 'video' ? '🎥 Video' :
                                     type === 'audio' ? '🎵 Audio' : '📄 Documento');
    } else if (text) {
        messagePayload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
        messageToSaveText = text;
    } else {
        throw new Error("Se requiere texto o un archivo para enviar un mensaje.");
    }

    if (reply_to_wamid) {
        messagePayload.context = { message_id: reply_to_wamid };
    }

    try {
        console.log(`[LOG] Intentando enviar mensaje a ${to} con payload:`, JSON.stringify(messagePayload));
        const response = await axios.post(url, messagePayload, { headers });
        console.log(`[LOG] Mensaje enviado a la API de WhatsApp con éxito para ${to}.`);
        const messageId = response.data.messages[0].id;
        return { id: messageId, textForDb: messageToSaveText, fileUrlForDb: fileUrl || null, fileTypeForDb: fileType || null };
    } catch (error) {
        console.error(`❌ Error al enviar mensaje avanzado de WhatsApp a ${to}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}

async function sendAutoMessage(contactRef, { text, fileUrl, fileType }) {
    const sentMessageData = await sendAdvancedWhatsAppMessage(contactRef.id, { text, fileUrl, fileType });
    await contactRef.collection('messages').add({
        from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
        id: sentMessageData.id, text: sentMessageData.textForDb, fileUrl: sentMessageData.fileUrlForDb,
        fileType: sentMessageData.fileTypeForDb, isAutoReply: true
    });
    await contactRef.update({ lastMessage: sentMessageData.textForDb, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`[AUTO] Mensaje automático enviado a ${contactRef.id}.`);
}

async function handlePostalCodeAuto(message, contactRef, from) {
    if (message.type !== 'text') return false;
    const postalCodeRegex = /(?:cp|código postal|codigo postal|cp:)\s*(\d{5})|(\d{5})/i;
    const match = message.text.body.match(postalCodeRegex);
    const postalCode = match ? (match[1] || match[2]) : null;
    if (postalCode) {
        console.log(`[CP] Código postal detectado: ${postalCode} para ${from}.`);
        try {
            const coverageResponse = await checkCoverage(postalCode);
            if (coverageResponse) {
                await sendAutoMessage(contactRef, { text: coverageResponse });
                return true;
            }
        } catch (error) {
            console.error(`❌ Fallo al procesar CP para ${from}:`, error.message);
        }
    }
    return false;
}

// --- RUTAS DEL WEBHOOK ---

// Verificación del Webhook
router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Manejador principal de eventos de WhatsApp
router.post('/', async (req, res) => {
    try {
        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;

        if (value && value.messages && value.contacts) {
            const message = value.messages[0];
            const contactInfo = value.contacts[0];
            const from = message.from;
            const contactRef = db.collection('contacts_whatsapp').doc(from);
            if (from === PHONE_NUMBER_ID) return res.sendStatus(200);

            if (message.type === 'reaction') {
                const originalMessageId = message.reaction.message_id;
                const reactionEmoji = message.reaction.emoji || null;
                const messagesQuery = await contactRef.collection('messages').where('id', '==', originalMessageId).limit(1).get();
                if (!messagesQuery.empty) {
                    await messagesQuery.docs[0].ref.update({ reaction: reactionEmoji || admin.firestore.FieldValue.delete() });
                }
                return res.sendStatus(200);
            }

            const messageData = {
                timestamp: admin.firestore.Timestamp.fromMillis(parseInt(message.timestamp) * 1000),
                from, status: 'received', id: message.id, type: message.type, context: message.context || null
            };

            if (message.type === 'text') messageData.text = message.text.body;
            else if (message.type === 'image' && message.image?.id) {
                messageData.fileUrl = `/api/wa/media/${message.image.id}`;
                messageData.fileType = message.image.mime_type || 'image/jpeg';
                messageData.text = message.image.caption || '📷 Imagen';
            } else if (message.type === 'video' && message.video?.id) {
                messageData.fileUrl = `/api/wa/media/${message.video.id}`;
                messageData.fileType = message.video.mime_type || 'video/mp4';
                messageData.text = message.video.caption || '🎥 Video';
            } else if (message.type === 'audio' && message.audio?.id) {
                messageData.mediaProxyUrl = `/api/wa/media/${message.audio.id}`;
                messageData.text = message.audio.voice ? "🎤 Mensaje de voz" : "🎵 Audio";
            } else if (message.type === 'location') {
                messageData.location = message.location;
                messageData.text = `📍 Ubicación: ${message.location.name || 'Ver en mapa'}`;
            } else {
                messageData.text = `Mensaje multimedia (${message.type})`;
            }

            await contactRef.collection('messages').add(messageData);

            const contactUpdateData = {
                name: contactInfo.profile?.name || from,
                name_lowercase: (contactInfo.profile?.name || from).toLowerCase(),
                wa_id: contactInfo.wa_id,
                lastMessage: messageData.text,
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                unreadCount: admin.firestore.FieldValue.increment(1)
            };
            if (message.referral) contactUpdateData.adReferral = message.referral;

            const isNewContact = !(await contactRef.get()).exists;
            await contactRef.set(contactUpdateData, { merge: true });
            console.log(`[LOG] Contacto y mensaje de ${from} guardados.`);
            const updatedContactData = (await contactRef.get()).data();
            
            // --- NUEVA LÓGICA: Comprobar envíos de contingencia ANTES de otras automatizaciones ---
            const contingentSent = await handleContingentSend(from);
            if (contingentSent) {
                console.log(`[LOGIC] Envío de contingencia manejado para ${from}. El flujo regular continúa.`);
            }

            if (message.type === 'text') {
                const wholesaleResponse = handleWholesaleMessage(from, message.text.body);
                if (wholesaleResponse) {
                    console.log(`[MAYOREO] Respuesta generada para ${from}: "${wholesaleResponse}"`);
                    await sendAutoMessage(contactRef, { text: wholesaleResponse });
                    return res.sendStatus(200);
                }
            }

            if (await handlePostalCodeAuto(message, contactRef, from)) return res.sendStatus(200);

            if (isNewContact) {
                let adResponseSent = false;
                if (message.referral?.source_type === 'ad' && message.referral.source_id) {
                    const adId = message.referral.source_id;
                    const snapshot = await db.collection('ad_responses').where('adId', '==', adId).limit(1).get();
                    if (!snapshot.empty) {
                        const adResponseData = snapshot.docs[0].data();
                        await sendAutoMessage(contactRef, { text: adResponseData.message, fileUrl: adResponseData.fileUrl, fileType: adResponseData.fileType });
                        adResponseSent = true;
                    }
                }
                if (!adResponseSent) {
                    await sendAutoMessage(contactRef, { text: GENERAL_WELCOME_MESSAGE });
                    await contactRef.update({ welcomed: true });
                }
            } else {
                await triggerAutoReplyAI(message, contactRef, updatedContactData);
            }
        } else if (value && value.statuses) {
            const statusUpdate = value.statuses[0];
            const { id: messageId, recipient_id: recipientId, status: newStatus, errors } = statusUpdate;
            console.log(`[WEBHOOK STATUS] Notificación para mensaje ${messageId} a ${recipientId}. Nuevo estado: ${newStatus.toUpperCase()}`);
            if (newStatus === 'failed') {
                console.error(`❌ FALLO EN LA ENTREGA DEL MENSAJE ${messageId}. Razón de Meta:`, JSON.stringify(errors, null, 2));
            }
            try {
                const snap = await db.collection('contacts_whatsapp').doc(recipientId).collection('messages').where('id', '==', messageId).limit(1).get();
                if (!snap.empty) {
                    const messageDoc = snap.docs[0];
                    const order = { sent: 1, delivered: 2, read: 3 };
                    if ((order[newStatus] || 0) > (order[messageDoc.data().status] || 0)) {
                        await messageDoc.ref.update({ status: newStatus });
                        console.log(`[LOG] Estado del mensaje ${messageId} actualizado a '${newStatus}' en Firestore.`);
                    }
                }
            } catch (error) { console.error(`❌ Error al actualizar estado ${messageId} en Firestore:`, error.message); }
        }
    } catch (error) {
        console.error('❌ ERROR CRÍTICO EN EL WEBHOOK:', error);
    } finally {
        res.sendStatus(200);
    }
});

// Proxy de Medios para audios, videos y documentos de WhatsApp
router.get("/wa/media/:mediaId", async (req, res) => {
    try {
        const { mediaId } = req.params;
        if (!WHATSAPP_TOKEN) return res.status(500).json({ error: "WhatsApp Token no configurado." });
        
        const metaResponse = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        });

        const mediaUrl = metaResponse.data?.url;
        if (!mediaUrl) return res.status(404).json({ error: "URL del medio no encontrada." });

        const mediaContentResponse = await axios.get(mediaUrl, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
            responseType: "stream",
        });

        res.setHeader("Content-Type", mediaContentResponse.headers["content-type"] || "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        mediaContentResponse.data.pipe(res);

    } catch (err) {
        console.error("ERROR EN PROXY DE MEDIOS:", err?.response?.data || err.message);
        res.status(500).json({ error: "No se pudo obtener el medio." });
    }
});


module.exports = { router, sendAdvancedWhatsAppMessage };
