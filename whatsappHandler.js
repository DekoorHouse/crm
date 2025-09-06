const express = require('express');
const axios = require('axios');
const { db, admin, bucket } = require('./config');
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

/**
 * Descarga un archivo multimedia desde la URL temporal de Meta y lo sube a Firebase Storage.
 * @param {string} mediaId El ID del medio de WhatsApp.
 * @param {string} from El número de teléfono del remitente, para organizar el almacenamiento.
 * @returns {Promise<{publicUrl: string, mimeType: string}>} Una promesa que resuelve con la URL pública y el tipo MIME.
 */
async function downloadAndUploadMedia(mediaId, from) {
    try {
        console.log(`[MEDIA] Iniciando descarga para mediaId: ${mediaId}`);
        // 1. Obtener URL temporal de Meta
        const metaUrlResponse = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        });

        const mediaUrl = metaUrlResponse.data?.url;
        if (!mediaUrl) {
            throw new Error(`No se pudo obtener la URL del medio para el ID: ${mediaId}`);
        }
        const mimeType = metaUrlResponse.data?.mime_type || 'application/octet-stream';
        const fileExtension = mimeType.split('/')[1] || 'bin';

        // 2. Descargar el archivo como stream desde Meta
        const mediaResponse = await axios.get(mediaUrl, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
            responseType: "stream",
        });

        // 3. Subir el stream a Firebase Storage
        const filePath = `whatsapp_media/${from}/${mediaId}.${fileExtension}`;
        const file = bucket.file(filePath);
        const stream = file.createWriteStream({
            metadata: {
                contentType: mimeType,
            },
        });

        return new Promise((resolve, reject) => {
            mediaResponse.data.pipe(stream)
                .on('finish', async () => {
                    console.log(`[MEDIA] Archivo ${filePath} subido a Firebase Storage.`);
                    await file.makePublic();
                    const publicUrl = file.publicUrl();
                    console.log(`[MEDIA] URL pública generada: ${publicUrl}`);
                    resolve({ publicUrl, mimeType });
                })
                .on('error', (error) => {
                    console.error(`[MEDIA] Error al subir el archivo a Firebase Storage:`, error);
                    reject(error);
                });
        });

    } catch (error) {
        console.error(`[MEDIA] Falló el proceso de descarga y subida para mediaId ${mediaId}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}


async function sendAdvancedWhatsAppMessage(to, { text, fileUrl, fileType, reply_to_wamid }) {
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let messagePayload;
    let messageToSaveText;

    const contactRef = db.collection('contacts_whatsapp').doc(to);
    const contactDoc = await contactRef.get();
    if (!contactDoc.exists) {
        console.log(`[LOG] El contacto ${to} no existe. Creando uno nuevo antes de enviar el mensaje.`);
        const contactUpdateData = {
            name: `Nuevo Contacto (${to.slice(-4)})`,
            name_lowercase: `nuevo contacto (${to.slice(-4)})`,
            wa_id: to,
            lastMessage: "Contacto creado por envío saliente.",
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            unreadCount: 0
        };
        await contactRef.set(contactUpdateData, { merge: true });
    }

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

async function handleContingentSend(contactId) {
    const contingentQuery = db.collection('contingentSends')
        .where('contactId', '==', contactId)
        .where('status', '==', 'pending')
        .limit(1);

    const snapshot = await contingentQuery.get();
    if (snapshot.empty) {
        return false;
    }

    const contingentDoc = snapshot.docs[0];
    const contingentData = contingentDoc.data();
    const { payload } = contingentData;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);

    console.log(`[CONTINGENT] Envío pendiente encontrado para ${contactId}. Ejecutando ahora.`);

    try {
        let lastMessageText = '';

        if (payload.messageSequence && payload.messageSequence.length > 0) {
            for (const qr of payload.messageSequence) {
                const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text: qr.message, fileUrl: qr.fileUrl, fileType: qr.fileType });
                
                const messageToSave = {
                    from: PHONE_NUMBER_ID,
                    status: 'sent',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: sentMessageData.id,
                    text: sentMessageData.textForDb,
                    fileUrl: sentMessageData.fileUrlForDb,
                    fileType: sentMessageData.fileTypeForDb,
                    isAutoReply: true
                };
                Object.keys(messageToSave).forEach(key => messageToSave[key] == null && delete messageToSave[key]);
                await contactRef.collection('messages').add(messageToSave);
                lastMessageText = sentMessageData.textForDb;

                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        const sentPhotoData = await sendAdvancedWhatsAppMessage(contactId, {
            text: null,
            fileUrl: payload.photoUrl,
            fileType: 'image/jpeg'
        });

        const photoMessageToSave = {
            from: PHONE_NUMBER_ID,
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: sentPhotoData.id,
            text: sentPhotoData.textForDb,
            fileUrl: sentPhotoData.fileUrlForDb,
            fileType: sentPhotoData.fileTypeForDb,
            isAutoReply: true
        };
        await contactRef.collection('messages').add(photoMessageToSave);
        lastMessageText = sentPhotoData.textForDb;

        await contingentDoc.ref.update({ status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() });
        
        await contactRef.update({
            lastMessage: lastMessageText,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`[CONTINGENT] Envío pendiente para ${contactId} completado exitosamente.`);
        return true;

    } catch (error) {
        console.error(`[CONTINGENT] Error al ejecutar el envío pendiente para ${contactId}:`, error);
        await contingentDoc.ref.update({ status: 'failed', error: error.message });
        return false;
    }
}

function isWithinBusinessHours() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const day = now.getDay();
    const hour = now.getHours();
    const hoursToday = BUSINESS_HOURS[day];
    if (!hoursToday) return false;
    const [startHour, endHour] = hoursToday;
    return hour >= startHour && hour < endHour;
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

            if (message.type === 'text') {
                messageData.text = message.text.body;
            } else if (message.type === 'image' && message.image?.id) {
                messageData.fileUrl = `/api/wa/media/${message.image.id}`;
                messageData.fileType = message.image.mime_type || 'image/jpeg';
                messageData.text = message.image.caption || '📷 Imagen';
            } else if (message.type === 'video' && message.video?.id) {
                messageData.fileUrl = `/api/wa/media/${message.video.id}`;
                messageData.fileType = message.video.mime_type || 'video/mp4';
                messageData.text = message.video.caption || '🎥 Video';
            } else if (message.type === 'audio' && message.audio?.id) {
                try {
                    const { publicUrl, mimeType } = await downloadAndUploadMedia(message.audio.id, from);
                    messageData.fileUrl = publicUrl;
                    messageData.fileType = mimeType;
                    console.log(`[AUDIO] Audio ${message.audio.id} guardado en Storage. URL: ${publicUrl}`);
                } catch (uploadError) {
                    console.error(`[AUDIO] FALLBACK: No se pudo guardar el audio ${message.audio.id} en Storage. Usando proxy. Error: ${uploadError.message}`);
                    messageData.mediaProxyUrl = `/api/wa/media/${message.audio.id}`;
                    messageData.fileType = message.audio.mime_type || 'audio/ogg';
                }
                messageData.text = message.audio.voice ? "🎤 Mensaje de voz" : "🎵 Audio";
            } else if (message.type === 'document' && message.document?.id) {
                try {
                    const { publicUrl, mimeType } = await downloadAndUploadMedia(message.document.id, from);
                    messageData.fileUrl = publicUrl;
                    messageData.fileType = mimeType;
                    messageData.document = { filename: message.document.filename };
                    console.log(`[DOCUMENT] Documento ${message.document.id} guardado en Storage. URL: ${publicUrl}`);
                } catch (uploadError) {
                    console.error(`[DOCUMENT] FALLBACK: No se pudo guardar el documento ${message.document.id}. Usando proxy. Error: ${uploadError.message}`);
                    messageData.mediaProxyUrl = `/api/wa/media/${message.document.id}`;
                    messageData.fileType = message.document.mime_type || 'application/pdf';
                    messageData.document = { filename: message.document.filename };
                }
                messageData.text = message.document.caption || message.document.filename || '📄 Documento';
            } else if (message.type === 'sticker' && message.sticker?.id) { // --- INICIO DE LA CORRECCIÓN ---
                try {
                    const { publicUrl, mimeType } = await downloadAndUploadMedia(message.sticker.id, from);
                    messageData.fileUrl = publicUrl;
                    messageData.fileType = mimeType;
                    messageData.text = 'Sticker'; // Texto descriptivo para la base de datos
                    console.log(`[STICKER] Sticker ${message.sticker.id} guardado en Storage. URL: ${publicUrl}`);
                } catch (uploadError) {
                    console.error(`[STICKER] FALLBACK: No se pudo guardar el sticker ${message.sticker.id}. Error: ${uploadError.message}`);
                    messageData.text = 'Mensaje multimedia (sticker)';
                } // --- FIN DE LA CORRECCIÓN ---
            } else if (message.type === 'location') {
                messageData.location = message.location;
                messageData.text = `📍 Ubicación: ${message.location.name || 'Ver en mapa'}`;
            } else if (message.type === 'button' && message.button) {
                messageData.text = message.button.text;
            } else if (message.type === 'interactive' && message.interactive) {
                if (message.interactive.type === 'button_reply') {
                    messageData.text = message.interactive.button_reply.title;
                } else {
                    messageData.text = `Respuesta interactiva (${message.interactive.type})`;
                }
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
            
            const contingentSent = await handleContingentSend(from);
            if (contingentSent) {
                console.log(`[LOGIC] Envío de contingencia manejado para ${from}. El flujo regular se detiene aquí.`);
                return res.sendStatus(200);
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

router.get("/wa/media/:mediaId", async (req, res) => {
    try {
        const { mediaId } = req.params;
        if (!WHATSAPP_TOKEN) {
            return res.status(500).json({ error: "WhatsApp Token no configurado." });
        }

        const metaUrlResponse = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        });

        const mediaUrl = metaUrlResponse.data?.url;
        if (!mediaUrl) {
            return res.status(404).json({ error: "URL del medio no encontrada." });
        }

        const range = req.headers.range;
        const axiosConfig = {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
            responseType: "stream",
        };

        if (range) {
            axiosConfig.headers['Range'] = range;
            console.log(`[PROXY] Solicitud de rango detectada: ${range}`);
        }

        const mediaResponse = await axios.get(mediaUrl, axiosConfig);

        const headers = mediaResponse.headers;
        const status = mediaResponse.status;

        if (status === 206) {
            res.writeHead(206, {
                "Content-Range": headers["content-range"],
                "Accept-Ranges": "bytes",
                "Content-Length": headers["content-length"],
                "Content-Type": headers["content-type"],
            });
        } else {
            res.setHeader("Content-Type", headers["content-type"]);
            res.setHeader("Content-Length", headers["content-length"]);
            res.setHeader("Accept-Ranges", "bytes");
        }

        mediaResponse.data.pipe(res);

    } catch (err) {
        if (err.response) {
            console.error("ERROR EN PROXY DE MEDIOS (Respuesta del servidor):", err.response.status, err.response.data);
            res.status(err.response.status).json({ error: "No se pudo obtener el medio desde el origen.", details: err.response.data });
        } else if (err.request) {
            console.error("ERROR EN PROXY DE MEDIOS (Sin respuesta):", err.request);
            res.status(504).json({ error: "No se recibió respuesta del servidor de medios." });
        } else {
            console.error("ERROR EN PROXY DE MEDIOS (Configuración):", err.message);
            res.status(500).json({ error: "Error al configurar la solicitud del medio." });
        }
    }
});


module.exports = { router, sendAdvancedWhatsAppMessage };
