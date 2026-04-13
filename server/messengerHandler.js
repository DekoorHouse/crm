const express = require('express');
const axios = require('axios');
const { db, admin, bucket } = require('./config');
const { triggerAutoReplyAI, sendMessengerMessage } = require('./services');

const router = express.Router();

// --- CONSTANTES ---
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const FB_PAGE_ID = process.env.FB_PAGE_ID;

// --- HORARIO Y MENSAJES AUTOMÁTICOS (reutilizados de WhatsApp) ---
const BUSINESS_HOURS = { 1: [7, 19], 2: [7, 19], 3: [7, 19], 4: [7, 19], 5: [7, 19], 6: [7, 14] };
const TIMEZONE = 'America/Mexico_City';
const AWAY_MESSAGE = `📩 ¡Hola! Gracias por tu mensaje.\n\n🕑 Nuestro horario de atención es:\n\n🗓 Lunes a Viernes: 7:00 am - 7:00 pm\n\n🗓 Sábado: 7:00 am - 2:00 pm\nTe responderemos tan pronto como regresemos.\n\n🙏 ¡Gracias por tu paciencia!`;
const GENERAL_WELCOME_MESSAGE = '¡Hola! 👋 Gracias por comunicarte. ¿Cómo podemos ayudarte hoy? 😊';

/**
 * Checks if the current time is within defined business hours.
 */
function isWithinBusinessHours() {
    try {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
        const day = now.getDay();
        const hour = now.getHours();
        const hoursToday = BUSINESS_HOURS[day];
        if (!hoursToday) return false;
        const [startHour, endHour] = hoursToday;
        return hour >= startHour && hour < endHour;
    } catch (error) {
        console.error("[MESSENGER] Error checking business hours:", error);
        return true;
    }
}

/**
 * Fetches user profile info from Facebook Graph API (Messenger).
 * @param {string} psid The Page-Scoped User ID.
 * @returns {Promise<{name: string, profileImageUrl: string|null}>}
 */
async function getUserProfile(psid) {
    try {
        const response = await axios.get(`https://graph.facebook.com/v19.0/${psid}`, {
            params: {
                fields: 'name,profile_pic',
                access_token: FB_PAGE_ACCESS_TOKEN
            }
        });
        return {
            name: response.data.name || `Facebook User (${psid.slice(-4)})`,
            profileImageUrl: response.data.profile_pic || null
        };
    } catch (error) {
        console.error(`[MESSENGER] Error al obtener perfil de ${psid}:`, error.message);
        return { name: `Facebook User (${psid.slice(-4)})`, profileImageUrl: null };
    }
}

/**
 * Fetches user profile info from Instagram Graph API.
 * @param {string} igsid The Instagram-Scoped User ID.
 * @returns {Promise<{name: string, profileImageUrl: string|null}>}
 */
async function getInstagramUserProfile(igsid) {
    try {
        const response = await axios.get(`https://graph.facebook.com/v19.0/${igsid}`, {
            params: {
                fields: 'name,username,profile_pic',
                access_token: IG_ACCESS_TOKEN || FB_PAGE_ACCESS_TOKEN
            }
        });
        const name = response.data.name || response.data.username || `IG User (${igsid.slice(-4)})`;
        return {
            name,
            username: response.data.username || null,
            profileImageUrl: response.data.profile_pic || null
        };
    } catch (error) {
        console.error(`[INSTAGRAM] Error al obtener perfil de ${igsid}:`, error.message);
        return { name: `IG User (${igsid.slice(-4)})`, username: null, profileImageUrl: null };
    }
}

/**
 * Downloads media from a Messenger attachment URL and uploads to Firebase Storage.
 * @param {string} url The direct attachment URL from Messenger.
 * @param {string} psid The sender's PSID.
 * @param {string} messageId The message ID for file naming.
 * @returns {Promise<{publicUrl: string, mimeType: string}>}
 */
async function downloadAndUploadMessengerMedia(url, psid, messageId) {
    try {
        console.log(`[MESSENGER MEDIA] Descargando media para ${psid}, mid: ${messageId}`);
        const mediaResponse = await axios.get(url, { responseType: 'stream' });
        const mimeType = mediaResponse.headers['content-type'] || 'application/octet-stream';
        const fileExtension = mimeType.split('/')[1]?.split(';')[0] || 'bin';
        const filePath = `messenger_media/${psid}/${messageId}.${fileExtension}`;
        const file = bucket.file(filePath);
        const stream = file.createWriteStream({ metadata: { contentType: mimeType } });

        return new Promise((resolve, reject) => {
            mediaResponse.data.pipe(stream)
                .on('finish', async () => {
                    console.log(`[MESSENGER MEDIA] Archivo ${filePath} subido a Firebase Storage.`);
                    await file.makePublic();
                    const publicUrl = file.publicUrl();
                    resolve({ publicUrl, mimeType });
                })
                .on('error', (error) => {
                    console.error(`[MESSENGER MEDIA] Error al subir archivo:`, error);
                    reject(error);
                });
        });
    } catch (error) {
        console.error(`[MESSENGER MEDIA] Falló descarga/subida para mid ${messageId}:`, error.message);
        throw error;
    }
}

/**
 * Sends an automated message via Messenger and saves it to Firestore.
 * @param {FirebaseFirestore.DocumentReference} contactRef Reference to the contact document.
 * @param {object} messageContent Content of the message { text, fileUrl, fileType }.
 */
async function sendAutoMessage(contactRef, { text, fileUrl, fileType }) {
    try {
        const contactDoc = await contactRef.get();
        const data = contactDoc.data();
        const recipientId = data.psid || data.igsid;
        const channel = data.channel || 'messenger';
        const sentMessageData = await sendMessengerMessage(recipientId, { text, fileUrl, fileType, channel });

        // Save sent message(s) to Firestore
        for (const msg of sentMessageData.messages) {
            const messageToSave = {
                from: 'page',
                status: 'sent',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: msg.id,
                text: msg.textForDb,
                isAutoReply: true
            };
            if (msg.fileUrlForDb) messageToSave.fileUrl = msg.fileUrlForDb;
            if (msg.fileTypeForDb) messageToSave.fileType = msg.fileTypeForDb;
            await contactRef.collection('messages').add(messageToSave);
        }

        await contactRef.update({
            lastMessage: sentMessageData.lastTextForDb,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[MESSENGER AUTO] Mensaje automático enviado a ${contactRef.id}.`);
    } catch (error) {
        console.error(`❌ [MESSENGER AUTO] Fallo al enviar mensaje automático a ${contactRef.id}:`, error.message);
    }
}

// --- WEBHOOK ENDPOINTS ---

// Verification endpoint (same pattern as WhatsApp)
router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('[MESSENGER] WEBHOOK_VERIFIED');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Message handling endpoint (handles both Messenger and Instagram DMs)
router.post('/', async (req, res) => {
    try {
        const objectType = req.body.object; // 'page' for Messenger, 'instagram' for IG DMs
        const channel = objectType === 'instagram' ? 'instagram' : 'messenger';
        const logPrefix = channel === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';

        console.log(`[${logPrefix} WEBHOOK] Payload recibido:`, JSON.stringify(req.body, null, 2));

        if (objectType !== 'page' && objectType !== 'instagram') {
            console.log(`[${logPrefix}] Objeto no es page ni instagram, ignorando.`);
            return res.sendStatus(404);
        }

        const entries = req.body.entry || [];

        for (const entry of entries) {
            const messagingEvents = entry.messaging || [];

            for (const event of messagingEvents) {
                const senderId = event.sender?.id;

                // Ignore messages sent by the page itself
                if (!senderId || senderId === FB_PAGE_ID) {
                    continue;
                }

                // Handle delivery receipts
                if (event.delivery) {
                    await handleDeliveryReceipt(event.delivery, channel);
                    continue;
                }

                // Handle read receipts
                if (event.read) {
                    await handleReadReceipt(senderId, event.read, channel);
                    continue;
                }

                // Handle incoming messages
                if (event.message) {
                    await handleIncomingMessage(senderId, event.message, event.timestamp, channel);
                }

                // Handle postbacks (Messenger only, IG doesn't support them)
                if (event.postback && channel === 'messenger') {
                    await handlePostback(senderId, event.postback, event.timestamp);
                }
            }
        }
    } catch (error) {
        console.error('❌ [WEBHOOK] ERROR CRÍTICO:', error);
    } finally {
        if (!res.headersSent) {
            res.sendStatus(200);
        }
    }
});

/**
 * Handles an incoming Messenger or Instagram DM message.
 * @param {string} senderId PSID (Messenger) or IGSID (Instagram)
 * @param {object} message The message payload from Meta
 * @param {number} eventTimestamp
 * @param {'messenger'|'instagram'} channel
 */
async function handleIncomingMessage(senderId, message, eventTimestamp, channel = 'messenger') {
    const prefix = channel === 'instagram' ? 'ig' : 'fb';
    const logPrefix = channel === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';
    const contactId = `${prefix}_${senderId}`;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);

    // Duplicate prevention
    if (message.mid) {
        const isDuplicate = await contactRef.collection('messages').where('id', '==', message.mid).limit(1).get();
        if (!isDuplicate.empty) {
            console.log(`[MESSENGER] Mensaje duplicado detectado (mid ${message.mid}). Ignorando.`);
            return;
        }
    }

    // Ignore echo messages (messages sent by the page)
    if (message.is_echo) {
        console.log('[MESSENGER] Echo message ignorado.');
        return;
    }

    // --- Build message data ---
    const messageData = {
        timestamp: admin.firestore.Timestamp.fromMillis(eventTimestamp),
        from: contactId,
        status: 'received',
        id: message.mid,
        channel
    };

    // Instagram story replies and mentions
    if (channel === 'instagram' && message.reply_to?.story) {
        messageData.storyReply = {
            url: message.reply_to.story.url,
            id: message.reply_to.story.id
        };
    }

    // Process text
    if (message.text) {
        messageData.text = message.text;
    }

    // Process attachments
    if (message.attachments && message.attachments.length > 0) {
        const attachment = message.attachments[0]; // Process first attachment
        const attachType = attachment.type; // image, video, audio, file, location, fallback

        if (attachType === 'location' && attachment.payload?.coordinates) {
            messageData.location = {
                latitude: attachment.payload.coordinates.lat,
                longitude: attachment.payload.coordinates.long
            };
            messageData.text = messageData.text || `📍 Ubicación compartida`;
        } else if (['image', 'video', 'audio', 'file'].includes(attachType) && attachment.payload?.url) {
            try {
                const { publicUrl, mimeType } = await downloadAndUploadMessengerMedia(
                    attachment.payload.url, senderId, message.mid
                );
                messageData.fileUrl = publicUrl;
                messageData.fileType = mimeType;

                if (!messageData.text) {
                    const fallbackTexts = {
                        image: '📷 Imagen', video: '🎥 Video',
                        audio: '🎵 Audio', file: '📄 Documento'
                    };
                    messageData.text = fallbackTexts[attachType] || 'Archivo adjunto';
                }
            } catch (uploadError) {
                console.error(`[MESSENGER] Error al descargar media:`, uploadError.message);
                messageData.text = messageData.text || `Mensaje multimedia (${attachType})`;
            }
        } else if (attachType === 'fallback') {
            messageData.text = messageData.text || 'Mensaje no soportado';
        }
    }

    // Fallback text
    if (!messageData.text) {
        messageData.text = 'Mensaje multimedia';
    }

    // Remove null/undefined fields
    Object.keys(messageData).forEach(key => messageData[key] == null && delete messageData[key]);

    // Save message to Firestore
    await contactRef.collection('messages').add(messageData);
    console.log(`[${logPrefix}] Mensaje de ${contactId} guardado en Firestore.`);

    // --- Incrementar métricas diarias pre-agregadas ---
    const contactDoc = await contactRef.get();
    const contactTag = (contactDoc.exists && contactDoc.data().status) || 'sin_etiqueta';
    const metricsDateKey = new Date().toISOString().split('T')[0];
    const dailyMetricRef = db.collection('daily_metrics').doc(metricsDateKey);
    dailyMetricRef.set({
        totalMessages: admin.firestore.FieldValue.increment(1),
        [`tags.${contactTag}`]: admin.firestore.FieldValue.increment(1)
    }, { merge: true }).catch(err => console.error('[METRICS] Error incrementando métrica diaria:', err));

    // --- Update/Create contact ---
    const isNewContact = !contactDoc.exists;

    let contactUpdateData;
    if (isNewContact) {
        // Fetch profile — different API for Instagram vs Messenger
        const profile = channel === 'instagram'
            ? await getInstagramUserProfile(senderId)
            : await getUserProfile(senderId);

        contactUpdateData = {
            name: profile.name,
            name_lowercase: profile.name.toLowerCase(),
            channel,
            [channel === 'instagram' ? 'igsid' : 'psid']: senderId,
            profileImageUrl: profile.profileImageUrl,
            lastMessage: messageData.text,
            lastMessageTimestamp: messageData.timestamp,
            unreadCount: 1
        };
        if (profile.username) contactUpdateData.igUsername = profile.username;
    } else {
        contactUpdateData = {
            lastMessage: messageData.text,
            lastMessageTimestamp: messageData.timestamp,
            unreadCount: admin.firestore.FieldValue.increment(1)
        };

        // Si el chat está en revisión de diseño, también incrementar designUnreadCount
        if (contactDoc.exists && contactDoc.data().inDesignReview) {
            contactUpdateData.designUnreadCount = admin.firestore.FieldValue.increment(1);
        }
    }

    await contactRef.set(contactUpdateData, { merge: true });
    console.log(`[${logPrefix}] Contacto ${contactId} actualizado/creado.`);

    // --- Department assignment for new contacts ---
    if (isNewContact) {
        const generalDeptQuery = await db.collection('departments').where('name', '==', 'General').limit(1).get();
        if (!generalDeptQuery.empty) {
            await contactRef.update({ assignedDepartmentId: generalDeptQuery.docs[0].id });
            console.log(`[${logPrefix} ROUTING] Contacto ${contactId} asignado al departamento General.`);
        }
    }

    // --- Automation Logic ---
    const updatedContactData = (await contactRef.get()).data();

    // Away message
    const generalSettingsDoc = await db.collection('crm_settings').doc('general').get();
    const awayMessageActive = generalSettingsDoc.exists ? generalSettingsDoc.data().awayMessageActive : true;

    if (!isWithinBusinessHours() && awayMessageActive) {
        const recentMessages = await contactRef.collection('messages')
            .where('isAutoReply', '==', true)
            .where('text', '==', AWAY_MESSAGE)
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

        let shouldSendAway = true;
        if (!recentMessages.empty) {
            const lastAwayTime = recentMessages.docs[0].data().timestamp.toMillis();
            const hoursSinceLastAway = (Date.now() - lastAwayTime) / (1000 * 60 * 60);
            if (hoursSinceLastAway < 6) {
                shouldSendAway = false;
            }
        }

        if (shouldSendAway) {
            await sendAutoMessage(contactRef, { text: AWAY_MESSAGE });
            console.log(`[${logPrefix} AWAY] Mensaje de ausencia enviado a ${contactId}.`);
            return;
        }
    }

    // Welcome message for new contacts
    if (isNewContact) {
        await sendAutoMessage(contactRef, { text: GENERAL_WELCOME_MESSAGE });
        await contactRef.update({ welcomed: true });
        return;
    }

    // AI auto-reply
    if (updatedContactData.botActive) {
        const incomingMsg = { type: 'text', text: { body: messageData.text } };
        const delay = 20000;
        console.log(`[${logPrefix} AI] Programando respuesta de IA para ${contactId} en ${delay/1000}s`);
        triggerAutoReplyAI(incomingMsg, contactRef, updatedContactData, delay).catch(err => {
            console.error(`[${logPrefix}] Error asíncrono en respuesta de IA:`, err);
        });
    }
}

/**
 * Handles postback events (button clicks in templates).
 */
async function handlePostback(senderPsid, postback, eventTimestamp) {
    const contactId = `fb_${senderPsid}`;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);

    const messageData = {
        timestamp: admin.firestore.Timestamp.fromMillis(eventTimestamp),
        from: contactId,
        status: 'received',
        id: `postback_${eventTimestamp}`,
        text: postback.title || postback.payload || 'Botón presionado',
        channel: 'messenger'
    };

    await contactRef.collection('messages').add(messageData);
    console.log(`[MESSENGER POSTBACK] de fb_${senderPsid}: "${messageData.text}"`);
}

/**
 * Handles delivery receipts from Messenger.
 */
async function handleDeliveryReceipt(delivery, channel = 'messenger') {
    if (!delivery.mids || delivery.mids.length === 0) return;

    for (const mid of delivery.mids) {
        try {
            const snap = await db.collectionGroup('messages').where('id', '==', mid).limit(1).get();
            if (!snap.empty) {
                const doc = snap.docs[0];
                const order = { sent: 1, delivered: 2, read: 3 };
                if ((order[doc.data().status] || 0) < 2) {
                    await doc.ref.update({ status: 'delivered' });
                    console.log(`[MESSENGER STATUS] Mensaje ${mid} marcado como delivered.`);
                }
            }
        } catch (error) {
            console.error(`[MESSENGER STATUS] Error actualizando delivery para ${mid}:`, error.message);
        }
    }
}

/**
 * Handles read receipts from Messenger.
 */
async function handleReadReceipt(senderId, readEvent, channel = 'messenger') {
    const watermark = readEvent.watermark;
    const prefix = channel === 'instagram' ? 'ig' : 'fb';
    const contactId = `${prefix}_${senderId}`;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);

    try {
        // Mark all sent messages before watermark as read
        const messagesQuery = await contactRef.collection('messages')
            .where('from', '==', 'page')
            .where('status', 'in', ['sent', 'delivered'])
            .where('timestamp', '<=', admin.firestore.Timestamp.fromMillis(watermark))
            .limit(20)
            .get();

        const batch = db.batch();
        messagesQuery.docs.forEach(doc => {
            batch.update(doc.ref, { status: 'read' });
        });
        await batch.commit();

        if (!messagesQuery.empty) {
            console.log(`[${channel.toUpperCase()} STATUS] ${messagesQuery.docs.length} mensajes marcados como read para ${contactId}.`);
        }
    } catch (error) {
        console.error(`[${channel.toUpperCase()} STATUS] Error actualizando read receipts para ${contactId}:`, error.message);
    }
}

module.exports = { router };
