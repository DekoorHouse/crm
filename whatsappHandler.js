const express = require('express');
const axios = require('axios');
// SE ACTUALIZÓ LA IMPORTACIÓN PARA INCLUIR sendConversionEvent
const { db, admin, bucket } = require('./config');
const { handleWholesaleMessage, checkCoverage, triggerAutoReplyAI, sendAdvancedWhatsAppMessage, sendConversionEvent } = require('./services');

const router = express.Router();

// --- CONSTANTES ---
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// --- HORARIO Y MENSAJES AUTOMÁTICOS ---
const BUSINESS_HOURS = { 1: [7, 19], 2: [7, 19], 3: [7, 19], 4: [7, 19], 5: [7, 19], 6: [7, 14] }; // Lunes a Sábado
const TIMEZONE = 'America/Mexico_City';
const AWAY_MESSAGE = `📩 ¡Hola! Gracias por tu mensaje.\n\n🕑 Nuestro horario de atención es:\n\n🗓 Lunes a Viernes: 7:00 am - 7:00 pm\n\n🗓 Sábado: 7:00 am - 2:00 pm\nTe responderemos tan pronto como regresemos.\n\n🙏 ¡Gracias por tu paciencia!`;
const GENERAL_WELCOME_MESSAGE = '¡Hola! 👋 Gracias por comunicarte. ¿Cómo podemos ayudarte hoy? 😊';

/**
 * Downloads media from Meta's temporary URL and uploads it to Firebase Storage.
 * @param {string} mediaId The WhatsApp media ID.
 * @param {string} from The sender's phone number, used for storage organization.
 * @returns {Promise<{publicUrl: string, mimeType: string}>} A promise resolving with the public URL and mime type.
 */
async function downloadAndUploadMedia(mediaId, from) {
    try {
        console.log(`[MEDIA] Iniciando descarga para mediaId: ${mediaId}`);
        // 1. Get temporary URL from Meta
        const metaUrlResponse = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        });

        const mediaUrl = metaUrlResponse.data?.url;
        if (!mediaUrl) {
            throw new Error(`No se pudo obtener la URL del medio para el ID: ${mediaId}`);
        }
        const mimeType = metaUrlResponse.data?.mime_type || 'application/octet-stream';
        const fileExtension = mimeType.split('/')[1] || 'bin';

        // 2. Download file stream from Meta
        const mediaResponse = await axios.get(mediaUrl, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
            responseType: "stream",
        });

        // 3. Upload stream to Firebase Storage
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

/**
 * Sends queued messages for a contact.
 * @param {string} contactId The contact's ID (phone number).
 * @returns {Promise<boolean>} True if messages were processed, false otherwise.
 */
async function sendQueuedMessages(contactId) {
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    const queuedMessagesQuery = contactRef.collection('messages')
        .where('status', '==', 'queued')
        .orderBy('timestamp', 'asc');

    try {
        const snapshot = await queuedMessagesQuery.get();
        if (snapshot.empty) {
            return false;
        }

        console.log(`[QUEUE] Se encontraron ${snapshot.docs.length} mensajes en cola para ${contactId}. Enviando...`);

        const batch = db.batch();
        let lastMessageText = '';

        for (const doc of snapshot.docs) {
            const queuedMessage = doc.data();

            if (!queuedMessage.text && !queuedMessage.fileUrl) {
                console.warn(`[QUEUE] Omitiendo mensaje en cola vacío: ${doc.id}`);
                batch.update(doc.ref, { status: 'failed', error: 'Contenido del mensaje vacío' });
                continue;
            }

            try {
                // Use the shared send function
                const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, {
                    text: queuedMessage.text,
                    fileUrl: queuedMessage.fileUrl,
                    fileType: queuedMessage.fileType,
                    reply_to_wamid: queuedMessage.context?.id
                });

                batch.update(doc.ref, {
                    status: 'sent',
                    id: sentMessageData.id,
                    timestamp: admin.firestore.FieldValue.serverTimestamp() // Update timestamp to when it was actually sent
                });
                lastMessageText = sentMessageData.textForDb; // Track last successfully sent message text
            } catch (sendError) {
                console.error(`[QUEUE] Falló el envío del mensaje ${doc.id} para ${contactId}:`, sendError.message);
                batch.update(doc.ref, { status: 'failed', error: sendError.message });
            }

            // Small delay between messages to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Update contact's last message only if at least one message was sent successfully
        if (lastMessageText) {
            batch.update(contactRef, {
                lastMessage: lastMessageText,
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        await batch.commit();
        console.log(`[QUEUE] Cola de mensajes para ${contactId} procesada.`);
        return true; // Indicates queue processing happened

    } catch (error) {
        console.error(`[QUEUE] Error crítico al procesar la cola de mensajes para ${contactId}:`, error);
        return false;
    }
}

/**
 * Handles pending contingent sends for a contact.
 * @param {string} contactId The contact's ID.
 * @returns {Promise<boolean>} True if a contingent send was handled, false otherwise.
 */
async function handleContingentSend(contactId) {
    const contingentQuery = db.collection('contingentSends')
        .where('contactId', '==', contactId)
        .where('status', '==', 'pending')
        .limit(1);

    const snapshot = await contingentQuery.get();
    if (snapshot.empty) {
        return false; // No pending sends for this contact
    }

    const contingentDoc = snapshot.docs[0];
    const contingentData = contingentDoc.data();
    const { payload } = contingentData;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);

    console.log(`[CONTINGENT] Envío pendiente encontrado para ${contactId}. Ejecutando ahora.`);

    try {
        let lastMessageText = '';

        // 1. Send the message sequence (if any)
        if (payload.messageSequence && payload.messageSequence.length > 0) {
            for (const qr of payload.messageSequence) {
                const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text: qr.message, fileUrl: qr.fileUrl, fileType: qr.fileType });

                // Save sent message to Firestore
                const messageToSave = {
                    from: PHONE_NUMBER_ID,
                    status: 'sent',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: sentMessageData.id,
                    text: sentMessageData.textForDb,
                    fileUrl: sentMessageData.fileUrlForDb,
                    fileType: sentMessageData.fileTypeForDb,
                    isAutoReply: true // Mark as automatic
                };
                // Remove null/undefined fields before saving
                Object.keys(messageToSave).forEach(key => messageToSave[key] == null && delete messageToSave[key]);
                await contactRef.collection('messages').add(messageToSave);
                lastMessageText = sentMessageData.textForDb; // Update last message text

                await new Promise(resolve => setTimeout(resolve, 500)); // Delay between messages
            }
        }

        // 2. Send the main photo
        const sentPhotoData = await sendAdvancedWhatsAppMessage(contactId, {
            text: null, // No caption needed here, sequence handled above
            fileUrl: payload.photoUrl,
            fileType: 'image/jpeg' // Assume JPEG, adjust if needed
        });

        // Save sent photo message to Firestore
        const photoMessageToSave = {
            from: PHONE_NUMBER_ID,
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: sentPhotoData.id,
            text: sentPhotoData.textForDb, // Will be '📷 Imagen'
            fileUrl: sentPhotoData.fileUrlForDb,
            fileType: sentPhotoData.fileTypeForDb,
            isAutoReply: true
        };
        await contactRef.collection('messages').add(photoMessageToSave);
        lastMessageText = sentPhotoData.textForDb;

        // 3. Mark contingent send as completed
        await contingentDoc.ref.update({ status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() });

        // 4. Update contact's last message
        await contactRef.update({
            lastMessage: lastMessageText,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[CONTINGENT] Envío pendiente para ${contactId} completado exitosamente.`);
        return true; // Indicates contingent send was handled

    } catch (error) {
        console.error(`[CONTINGENT] Error al ejecutar el envío pendiente para ${contactId}:`, error);
        // Mark as failed to prevent retries
        await contingentDoc.ref.update({ status: 'failed', error: error.message });
        return false;
    }
}

/**
 * Checks if the current time is within defined business hours.
 * @returns {boolean} True if within business hours, false otherwise.
 */
function isWithinBusinessHours() {
    try {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
        const day = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        const hour = now.getHours();

        const hoursToday = BUSINESS_HOURS[day];
        if (!hoursToday) return false; // Not open on this day

        const [startHour, endHour] = hoursToday;
        return hour >= startHour && hour < endHour;
    } catch (error) {
        console.error("Error checking business hours:", error);
        return true; // Default to 'open' if time zone check fails
    }
}

/**
 * Sends an automated message (welcome, away, ad response, etc.) and saves it.
 * @param {FirebaseFirestore.DocumentReference} contactRef Reference to the contact document.
 * @param {object} messageContent Content of the message { text, fileUrl, fileType }.
 */
async function sendAutoMessage(contactRef, { text, fileUrl, fileType }) {
    try {
        // Use the shared send function
        const sentMessageData = await sendAdvancedWhatsAppMessage(contactRef.id, { text, fileUrl, fileType });

        // Save the sent message to Firestore
        await contactRef.collection('messages').add({
            from: PHONE_NUMBER_ID, // Mark as sent from the business
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: sentMessageData.id,
            text: sentMessageData.textForDb,
            fileUrl: sentMessageData.fileUrlForDb, // Save URL if media was sent
            fileType: sentMessageData.fileTypeForDb, // Save type if media was sent
            isAutoReply: true // Mark as automatic
        });

        // Update the contact's last message preview
        await contactRef.update({
            lastMessage: sentMessageData.textForDb,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
            // Do not reset unreadCount here, user hasn't seen it yet
        });
        console.log(`[AUTO] Mensaje automático enviado a ${contactRef.id}.`);
    } catch (error) {
        console.error(`❌ Fallo al enviar mensaje automático a ${contactRef.id}:`, error.message);
        // Optionally, save a failed message attempt to Firestore for tracking
    }
}

/**
 * Checks for postal code in message and sends coverage response if found.
 * @param {object} message The incoming message object.
 * @param {FirebaseFirestore.DocumentReference} contactRef Reference to the contact document.
 * @param {string} from Sender's phone number.
 * @returns {Promise<boolean>} True if postal code was handled, false otherwise.
 */
async function handlePostalCodeAuto(message, contactRef, from) {
    if (message.type !== 'text') return false; // Only check text messages

    // Regex to find "cp", "código postal", "codigo postal" followed by 5 digits, or just 5 digits
    const postalCodeRegex = /(?:cp|código postal|codigo postal|cp:)\s*(\d{5})|(\d{5})/i;
    const match = message.text.body.match(postalCodeRegex);
    const postalCode = match ? (match[1] || match[2]) : null; // Extract the 5 digits

    if (postalCode) {
        console.log(`[CP] Código postal detectado: ${postalCode} para ${from}.`);
        try {
            const coverageResponse = await checkCoverage(postalCode);
            if (coverageResponse) {
                await sendAutoMessage(contactRef, { text: coverageResponse });
                return true; // Indicate that postal code was handled
            }
        } catch (error) {
            console.error(`❌ Fallo al procesar CP para ${from}:`, error.message);
            // Don't automatically reply if the coverage check itself failed
        }
    }
    return false; // No postal code found or handled
}

// --- WEBHOOK ENDPOINTS ---

// Verification endpoint
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

// Message handling endpoint
router.post('/', async (req, res) => {
    try {
        console.log('[WEBHOOK] Payload recibido:', JSON.stringify(req.body, null, 2)); // Log incoming payload

        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;

        // Handle incoming messages
        if (value && value.messages && value.contacts) {
            const message = value.messages[0];
            const contactInfo = value.contacts[0];
            const from = message.from; // Sender's phone number
            const contactRef = db.collection('contacts_whatsapp').doc(from);

            // Ignore messages sent *by* the business number itself
            if (from === PHONE_NUMBER_ID) {
                console.log('[WEBHOOK] Mensaje saliente ignorado (enviado por el bot).');
                return res.sendStatus(200);
            }

            // Handle reactions separately
            if (message.type === 'reaction') {
                const originalMessageId = message.reaction.message_id;
                const reactionEmoji = message.reaction.emoji || null; // Null if reaction removed
                console.log(`[REACTION] Recibida reacción '${reactionEmoji || 'eliminada'}' para mensaje ${originalMessageId} de ${from}`);
                // Find the original message in Firestore and update its reaction field
                const messagesQuery = await contactRef.collection('messages').where('id', '==', originalMessageId).limit(1).get();
                if (!messagesQuery.empty) {
                    await messagesQuery.docs[0].ref.update({
                        reaction: reactionEmoji || admin.firestore.FieldValue.delete() // Store emoji or remove field if null
                    });
                    console.log(`[REACTION] Reacción actualizada en Firestore para ${originalMessageId}.`);
                } else {
                    console.warn(`[REACTION] Mensaje original ${originalMessageId} no encontrado para actualizar reacción.`);
                }
                return res.sendStatus(200); // Acknowledge reaction webhook
            }

            // --- Build message data object for Firestore ---
            const messageData = {
                timestamp: admin.firestore.Timestamp.fromMillis(parseInt(message.timestamp) * 1000),
                from: from, // Who sent the message
                status: 'received', // Incoming messages are always 'received' initially
                id: message.id, // WhatsApp Message ID (wamid)
                type: message.type,
                context: message.context || null, // For replies
                // --- Store Ad ID if present ---
                adId: message.referral?.source_id || null
            };

            // --- Process different message types ---
            if (message.type === 'text') {
                messageData.text = message.text.body;
            } else if (message.type === 'image' && message.image?.id) {
                try {
                    const { publicUrl, mimeType } = await downloadAndUploadMedia(message.image.id, from);
                    messageData.fileUrl = publicUrl;
                    messageData.fileType = mimeType;
                    console.log(`[IMAGE] Imagen ${message.image.id} guardada en Storage. URL: ${publicUrl}`);
                } catch (uploadError) {
                    console.error(`[IMAGE] FALLBACK: No se pudo guardar la imagen ${message.image.id} en Storage. Usando proxy. Error: ${uploadError.message}`);
                    messageData.mediaProxyUrl = `/api/wa/media/${message.image.id}`; // Store proxy URL for frontend
                    messageData.fileType = message.image.mime_type || 'image/jpeg';
                }
                messageData.text = message.image.caption || '📷 Imagen'; // Use caption or default text
            } else if (message.type === 'video' && message.video?.id) {
                try {
                    const { publicUrl, mimeType } = await downloadAndUploadMedia(message.video.id, from);
                    messageData.fileUrl = publicUrl;
                    messageData.fileType = mimeType;
                    console.log(`[VIDEO] Video ${message.video.id} guardado en Storage. URL: ${publicUrl}`);
                } catch (uploadError) {
                    console.error(`[VIDEO] FALLBACK: No se pudo guardar el video ${message.video.id} en Storage. Usando proxy. Error: ${uploadError.message}`);
                    messageData.mediaProxyUrl = `/api/wa/media/${message.video.id}`;
                    messageData.fileType = message.video.mime_type || 'video/mp4';
                }
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
                    messageData.fileType = message.audio.mime_type || 'audio/ogg'; // Default to ogg
                }
                messageData.text = message.audio.voice ? "🎤 Mensaje de voz" : "🎵 Audio"; // Check if it's a voice note
            } else if (message.type === 'document' && message.document?.id) {
                try {
                    const { publicUrl, mimeType } = await downloadAndUploadMedia(message.document.id, from);
                    messageData.fileUrl = publicUrl;
                    messageData.fileType = mimeType;
                    messageData.document = { filename: message.document.filename }; // Store filename
                    console.log(`[DOCUMENT] Documento ${message.document.id} guardado en Storage. URL: ${publicUrl}`);
                } catch (uploadError) {
                    console.error(`[DOCUMENT] FALLBACK: No se pudo guardar el documento ${message.document.id}. Usando proxy. Error: ${uploadError.message}`);
                    messageData.mediaProxyUrl = `/api/wa/media/${message.document.id}`;
                    messageData.fileType = message.document.mime_type || 'application/pdf'; // Default to pdf
                    messageData.document = { filename: message.document.filename };
                }
                messageData.text = message.document.caption || message.document.filename || '📄 Documento';
            } else if (message.type === 'sticker' && message.sticker?.id) {
                 try {
                    // Attempt to save sticker, but use fallback text if it fails
                    const { publicUrl, mimeType } = await downloadAndUploadMedia(message.sticker.id, from);
                    messageData.fileUrl = publicUrl;
                    messageData.fileType = mimeType; // Usually image/webp
                    messageData.text = 'Sticker';
                    console.log(`[STICKER] Sticker ${message.sticker.id} guardado en Storage. URL: ${publicUrl}`);
                } catch (uploadError) {
                    console.error(`[STICKER] FALLBACK: No se pudo guardar el sticker ${message.sticker.id}. Error: ${uploadError.message}`);
                    messageData.text = 'Mensaje multimedia (sticker)'; // Fallback text
                }
            } else if (message.type === 'location') {
                messageData.location = message.location; // Store location object
                messageData.text = `📍 Ubicación: ${message.location.name || 'Ver en mapa'}`;
            } else if (message.type === 'button' && message.button) {
                 messageData.text = message.button.text; // Text from the button clicked
            } else if (message.type === 'interactive' && message.interactive) {
                // Handle different interactive types if needed
                if (message.interactive.type === 'button_reply') {
                     messageData.text = message.interactive.button_reply.title; // Text from the button reply
                } else if (message.interactive.type === 'list_reply') {
                    messageData.text = message.interactive.list_reply.title; // Text from the list item selected
                } else {
                     messageData.text = `Respuesta interactiva (${message.interactive.type})`; // Generic text
                }
            } else {
                console.warn(`[WEBHOOK] Tipo de mensaje no manejado completamente: ${message.type}. Payload:`, JSON.stringify(message));
                messageData.text = `Mensaje multimedia (${message.type})`; // Generic fallback
            }
             // --- Remove null/undefined fields before saving ---
            Object.keys(messageData).forEach(key => messageData[key] == null && delete messageData[key]);

            // Save the message to the 'messages' subcollection of the contact
            await contactRef.collection('messages').add(messageData);
            console.log(`[LOG] Mensaje de ${from} guardado en Firestore.`);

            // --- Update contact document ---
            const contactDoc = await contactRef.get();
            const isNewContact = !contactDoc.exists;

            const contactUpdateData = {
                name: contactInfo.profile?.name || (contactDoc.exists ? contactDoc.data().name : from), // Use existing name if available
                name_lowercase: (contactInfo.profile?.name || (contactDoc.exists ? contactDoc.data().name : from)).toLowerCase(),
                wa_id: contactInfo.wa_id, // WhatsApp ID
                lastMessage: messageData.text, // Preview text
                lastMessageTimestamp: messageData.timestamp, // Use message timestamp
                unreadCount: admin.firestore.FieldValue.increment(1) // Increment unread count
            };

            // Only add adReferral if it exists in the incoming message AND the contact doesn't already have it (first ad message)
            if (message.referral && (!contactDoc.exists || !contactDoc.data().adReferral)) {
                contactUpdateData.adReferral = message.referral;
                console.log(`[AD] Información de Ad Referral guardada para ${from}. Ad ID: ${message.referral.source_id}`);
            }

            // Set or merge contact data
            await contactRef.set(contactUpdateData, { merge: true });
            console.log(`[LOG] Contacto ${from} actualizado/creado en Firestore.`);

            // --- INICIO: ENRUTAMIENTO POR DEPARTAMENTO (AD ID) ---
            // Verifica si el mensaje trae referral para asignar el departamento
            if (message.referral?.source_type === 'ad' && message.referral.source_id) {
                const adId = message.referral.source_id;
                console.log(`[ROUTING] Verificando reglas para Ad ID: ${adId}`);
                
                // Buscar si existe una regla para este Ad ID
                const ruleSnapshot = await db.collection('ad_routing_rules')
                    .where('adIds', 'array-contains', adId)
                    .limit(1)
                    .get();

                if (!ruleSnapshot.empty) {
                    const ruleData = ruleSnapshot.docs[0].data();
                    if (ruleData.targetDepartmentId) {
                        // Asignar al departamento correspondiente
                        await contactRef.update({ assignedDepartmentId: ruleData.targetDepartmentId });
                        console.log(`[ROUTING] Contacto ${from} asignado al departamento '${ruleData.targetDepartmentId}' por regla: ${ruleData.ruleName || 'Sin nombre'}`);
                    }
                } else {
                     // Fallback: Si el anuncio no tiene regla, asignar a "General"
                    console.log(`[ROUTING] No se encontraron reglas para Ad ID: ${adId}. Asignando a General.`);
                    const generalDeptQuery = await db.collection('departments').where('name', '==', 'General').limit(1).get();
                    if (!generalDeptQuery.empty) {
                        const generalDeptId = generalDeptQuery.docs[0].id;
                        await contactRef.update({ assignedDepartmentId: generalDeptId });
                        console.log(`[ROUTING] Contacto ${from} asignado al departamento General por falta de regla específica.`);
                    } else {
                        console.warn(`[ROUTING] No se encontró el departamento "General" para la asignación de fallback.`);
                    }
                }
            } else {
                // Fallback: si el mensaje NO viene de un anuncio y el contacto aún no tiene departamento, se le asigna a "General"
                const contactData = (await contactRef.get()).data();
                if (!contactData.assignedDepartmentId) {
                    console.log(`[ROUTING] Fallback: El contacto ${from} no tiene departamento. Asignando a General.`);
                    const generalDeptQuery = await db.collection('departments').where('name', '==', 'General').limit(1).get();
                    if (!generalDeptQuery.empty) {
                        const generalDeptId = generalDeptQuery.docs[0].id;
                        await contactRef.update({ assignedDepartmentId: generalDeptId });
                        console.log(`[ROUTING] Contacto ${from} asignado al departamento General.`);
                    } else {
                        console.warn(`[ROUTING] No se encontró el departamento "General" para la asignación de fallback.`);
                    }
                }
            }
            // --- FIN: ENRUTAMIENTO POR DEPARTAMENTO ---

            // --- INICIO: Enviar evento a Meta Ads si el mensaje proviene de un anuncio ---
            if (message.referral?.source_type === 'ad' && message.referral.source_id) {
                console.log(`[META EVENT] Mensaje de Ad ${message.referral.source_id} detectado para ${from}.`);
                try {
                    // Construir la información del contacto para el evento
                    const eventInfo = {
                        wa_id: from, // 'from' es el wa_id
                        profile: { name: contactInfo.profile?.name || from }
                    };
                    
                    // Enviar el evento "Lead" (o el evento estándar para una conversación iniciada)
                    // Usamos "Lead" como un evento estándar de CAPI.
                    // El usuario mencionó "conversación con mensajes iniciada", que es similar a "MessagedConversationStarted"
                    // o "Lead". Usaremos "Lead".
                    await sendConversionEvent('Lead', eventInfo, message.referral, {});
                    console.log(`[META EVENT] Evento 'Lead' enviado a Meta CAPI para ${from}.`);

                } catch (eventError) {
                    console.error(`[META EVENT] Error al enviar evento 'Lead' a Meta CAPI para ${from}:`, eventError.message);
                    // No bloquear el resto del flujo, solo registrar el error
                }
            }
            // --- FIN: Enviar evento a Meta Ads ---

            // Get potentially updated contact data for automation logic
            const updatedContactData = (await contactRef.get()).data();

            // --- Automation Logic ---

            // 1. Send Queued Messages (if user replied)
            const queuedSent = await sendQueuedMessages(from);
            if (queuedSent) {
                console.log(`[LOGIC] Mensajes en cola enviados para ${from}. El flujo de respuestas automáticas se detiene aquí.`);
                return res.sendStatus(200); // Stop further processing if queue was handled
            }

            // 2. Handle Contingent Sends (if user replied)
            const contingentSent = await handleContingentSend(from);
            if (contingentSent) {
                console.log(`[LOGIC] Envío de contingencia manejado para ${from}. El flujo regular se detiene aquí.`);
                return res.sendStatus(200); // Stop further processing
            }

            // 3. Handle Postal Code (only for text messages)
            // --- INICIO DE LA MODIFICACIÓN: Comentar el chequeo de CP ---
            /*
            const postalCodeHandled = await handlePostalCodeAuto(message, contactRef, from);
            if (postalCodeHandled) {
                 console.log(`[LOGIC] Código postal manejado para ${from}. El flujo posterior se detiene aquí.`);
                 return res.sendStatus(200); // Stop if CP response was sent
            }
            */
            // --- FIN DE LA MODIFICACIÓN ---

            // 4. Handle Wholesale Logic (only for text messages)
            if (message.type === 'text') {
                const wholesaleResponse = handleWholesaleMessage(from, message.text.body);
                if (wholesaleResponse) {
                    console.log(`[MAYOREO] Respuesta generada para ${from}: "${wholesaleResponse}"`);
                    await sendAutoMessage(contactRef, { text: wholesaleResponse });
                    return res.sendStatus(200); // Stop if wholesale response was sent
                }
            }

            // 5. Handle Away Message (if outside business hours)
            const generalSettingsDoc = await db.collection('crm_settings').doc('general').get();
            const awayMessageActive = generalSettingsDoc.exists ? generalSettingsDoc.data().awayMessageActive : true; // Default to active

            if (!isWithinBusinessHours() && awayMessageActive) {
                // Check if an away message was sent recently to avoid spamming
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
                    if (hoursSinceLastAway < 6) { // Don't send if sent within last 6 hours
                        shouldSendAway = false;
                        console.log(`[AWAY] Mensaje de ausencia omitido para ${from} (enviado recientemente).`);
                    }
                }

                if (shouldSendAway) {
                    await sendAutoMessage(contactRef, { text: AWAY_MESSAGE });
                    console.log(`[AWAY] Mensaje de ausencia enviado a ${from}.`);
                    return res.sendStatus(200); // Stop after sending away message
                }
            }

            // 6. Handle Welcome/Ad Response for NEW contacts OR Trigger AI
            if (isNewContact) {
                let adResponseSent = false;
                if (message.referral?.source_type === 'ad' && message.referral.source_id) {
                    const adId = message.referral.source_id;
                    console.log(`[AD] Nuevo contacto desde Ad ID: ${adId}`);
                    // Query using 'array-contains' for the adId within the 'adIds' array
                    const snapshot = await db.collection('ad_responses').where('adIds', 'array-contains', adId).limit(1).get();
                    if (!snapshot.empty) {
                        const adResponseData = snapshot.docs[0].data();
                        console.log(`[AD] Mensaje encontrado para Ad ID ${adId}: "${adResponseData.message || 'Archivo adjunto'}"`);
                        await sendAutoMessage(contactRef, { text: adResponseData.message, fileUrl: adResponseData.fileUrl, fileType: adResponseData.fileType });
                        adResponseSent = true;
                    } else {
                        console.log(`[AD] No se encontró mensaje específico para Ad ID ${adId}. Se enviará mensaje general de bienvenida.`);
                    }
                }
                // Send general welcome message ONLY if no specific ad response was sent
                if (!adResponseSent) {
                    await sendAutoMessage(contactRef, { text: GENERAL_WELCOME_MESSAGE });
                    await contactRef.update({ welcomed: true }); // Mark as welcomed
                }
            } else {
                // If it's not a new contact and none of the above automations triggered, consider AI reply
                await triggerAutoReplyAI(message, contactRef, updatedContactData);
            }

        // Handle status updates (message sent, delivered, read)
        } else if (value && value.statuses) {
            const statusUpdate = value.statuses[0];
            const { id: messageId, recipient_id: recipientId, status: newStatus, errors } = statusUpdate;

            console.log(`[WEBHOOK STATUS] Notificación para mensaje ${messageId} a ${recipientId}. Nuevo estado: ${newStatus.toUpperCase()}`);

            if (newStatus === 'failed') {
                console.error(`❌ FALLO EN LA ENTREGA DEL MENSAJE ${messageId}. Razón de Meta:`, JSON.stringify(errors, null, 2));
            }

            // Update message status in Firestore
            try {
                // Find the message by its WhatsApp ID (wamid) in the recipient's messages subcollection
                const snap = await db.collection('contacts_whatsapp').doc(recipientId).collection('messages')
                                   .where('id', '==', messageId).limit(1).get();
                if (!snap.empty) {
                    const messageDoc = snap.docs[0];
                    // Update only if the new status is "later" than the current one (sent -> delivered -> read)
                    const order = { sent: 1, delivered: 2, read: 3, failed: 4, queued: 0, pending: 0 }; // Define status order
                    if ((order[newStatus] || 0) > (order[messageDoc.data().status] || 0)) {
                        await messageDoc.ref.update({ status: newStatus });
                        console.log(`[LOG] Estado del mensaje ${messageId} actualizado a '${newStatus}' en Firestore.`);
                    } else {
                         console.log(`[LOG] Estado ${newStatus} para ${messageId} es anterior o igual al actual (${messageDoc.data().status}). No se actualiza.`);
                    }
                } else {
                    console.warn(`[LOG] No se encontró el mensaje ${messageId} en Firestore para actualizar el estado a ${newStatus}.`);
                }
            } catch (error) {
                console.error(`❌ Error al actualizar estado ${messageId} en Firestore:`, error.message);
            }
        } else {
            console.log('[WEBHOOK] Evento recibido no es mensaje ni estado:', JSON.stringify(value));
        }

    } catch (error) {
        console.error('❌ ERROR CRÍTICO EN EL WEBHOOK:', error);
    } finally {
        // CORRECCIÓN APLICADA: Verificar si los headers ya fueron enviados antes de intentar responder
        if (!res.headersSent) {
            res.sendStatus(200);
        }
    }
});

/**
 * Endpoint Proxy for fetching WhatsApp media for frontend display when direct GCS fails.
 * Handles range requests for streaming audio/video.
 */
router.get("/wa/media/:mediaId", async (req, res) => {
    try {
        const { mediaId } = req.params;
        if (!WHATSAPP_TOKEN) {
            return res.status(500).json({ error: "WhatsApp Token no configurado." });
        }

        // 1. Get the temporary media URL from Meta
        const metaUrlResponse = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        });

        const mediaUrl = metaUrlResponse.data?.url;
        if (!mediaUrl) {
            return res.status(404).json({ error: "URL del medio no encontrada." });
        }

        // 2. Forward the request to Meta, including Range header if present
        const range = req.headers.range;
        const axiosConfig = {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
            responseType: "stream", // Important for piping
        };

        if (range) {
            axiosConfig.headers['Range'] = range;
            console.log(`[PROXY] Solicitud de rango detectada: ${range}`);
        }

        const mediaResponse = await axios.get(mediaUrl, axiosConfig);

        // 3. Pipe the response from Meta back to the client
        const headers = mediaResponse.headers;
        const status = mediaResponse.status;

        // Handle partial content (206) for range requests
        if (status === 206) {
            console.log('[PROXY] Respondiendo con 206 Partial Content.');
            res.writeHead(206, {
                "Content-Range": headers["content-range"],
                "Accept-Ranges": "bytes", // Inform client that ranges are supported
                "Content-Length": headers["content-length"],
                "Content-Type": headers["content-type"],
            });
        } else {
            // Standard response (200 OK)
            console.log(`[PROXY] Respondiendo con ${status} OK.`);
            res.setHeader("Content-Type", headers["content-type"]);
            res.setHeader("Content-Length", headers["content-length"]);
            res.setHeader("Accept-Ranges", "bytes"); // Always indicate range support
        }

        // Pipe the stream from Meta's response to the client's response
        mediaResponse.data.pipe(res);

    } catch (err) {
        // --- Error Handling ---
        if (err.response) {
            // Error from Meta API
            console.error("ERROR EN PROXY DE MEDIOS (Respuesta del servidor):", err.response.status, err.response.data);
            res.status(err.response.status).json({ error: "No se pudo obtener el medio desde el origen.", details: err.response.data });
        } else if (err.request) {
            // Request made but no response received
            console.error("ERROR EN PROXY DE MEDIOS (Sin respuesta):", err.request);
            res.status(504).json({ error: "No se recibió respuesta del servidor de medios." });
        } else {
            // Setup error
            console.error("ERROR EN PROXY DE MEDIOS (Configuración):", err.message);
            res.status(500).json({ error: "Error al configurar la solicitud del medio." });
        }
    }
});


module.exports = { router };
