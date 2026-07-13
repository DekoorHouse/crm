const express = require('express');
const axios = require('axios');
// SE ACTUALIZÓ LA IMPORTACIÓN PARA INCLUIR sendConversionEvent
const { db, admin, bucket } = require('./config');
const { handleWholesaleMessage, checkCoverage, triggerAutoReplyAI, sendAdvancedWhatsAppMessage, sendMessengerMessage, sendConversionEvent, transcribeIncomingAudioMessage, markOrderCorregirForContact } = require('./services');
const { armLeadFollowup } = require('./leads/leadReactivationScheduler');
const { armOrderFollowup } = require('./leads/orderFollowupScheduler');
const { markOrderFollowupReplied } = require('./leads/orderFollowupMetrics');

const router = express.Router();

// --- CONSTANTES ---
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// --- HORARIO Y MENSAJES AUTOMÁTICOS ---
const BUSINESS_HOURS = { 1: [7, 19], 2: [7, 19], 3: [7, 19], 4: [7, 19], 5: [7, 19], 6: [7, 14] }; // Lunes a Sábado
const TIMEZONE = 'America/Mexico_City';
// Si es true, la IA responde a CUALQUIER hora y NO se envía el mensaje de ausencia fuera de horario.
// Cambiar a false para reactivar el horario de atención (BUSINESS_HOURS) + aviso de ausencia.
const AI_ALWAYS_ON = true;
const AWAY_MESSAGE = `📩 ¡Hola! Gracias por tu mensaje.\n\n🕑 Nuestro horario de atención es:\n\n🗓 Lunes a Viernes: 7:00 am - 7:00 pm\n\n🗓 Sábado: 7:00 am - 2:00 pm\nTe responderemos tan pronto como regresemos.\n\n🙏 ¡Gracias por tu paciencia!`;
const GENERAL_WELCOME_MESSAGE = '¡Hola! 👋 Gracias por comunicarte. ¿Cómo podemos ayudarte hoy? 😊';

// =============================================================
// TEMPLATE METRICS (Fase 2) - actualiza template_sends segun webhook
// =============================================================
// Meta error codes que tratamos como "bloqueo" del destinatario:
//  - 131026: Message Undeliverable (recurrentemente significa block o no-WhatsApp)
//  - 131047: Re-engagement message (suele ser ventana 24h, no block — no marcamos)
// Si se descubren nuevos codigos, agregar aqui.
const TEMPLATE_BLOCK_CODES = new Set([131026]);
const TEMPLATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7d para asociar respuesta a la tanda

async function updateTemplateSendStatus(wamid, newStatus, errors) {
    try {
        if (!wamid || !newStatus) return;
        const snap = await db.collection('template_sends').where('wamid', '==', wamid).limit(1).get();
        if (snap.empty) return; // no era un envio de plantilla trackeado, OK
        const docRef = snap.docs[0].ref;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const update = { status: newStatus };
        if (newStatus === 'delivered') update.deliveredAt = now;
        else if (newStatus === 'read') update.readAt = now;
        else if (newStatus === 'failed') {
            update.failedAt = now;
            const err = Array.isArray(errors) ? errors[0] : errors;
            if (err) {
                update.failureReason = err.message || err.title || null;
                update.failureCode = err.code || null;
                if (err.code && TEMPLATE_BLOCK_CODES.has(err.code)) {
                    update.blocked = true;
                }
            }
        }
        await docRef.update(update);

        // Si fue bloqueo, marcar el contacto tambien para excluirlo de envios futuros
        if (update.blocked) {
            const contactId = snap.docs[0].data().contactId;
            if (contactId) {
                await db.collection('contacts_whatsapp').doc(contactId).set({
                    templateBlocked: true,
                    templateBlockedAt: now
                }, { merge: true }).catch(() => {});
            }
        }
    } catch (e) {
        console.error('[template-metrics] Error actualizando status:', e.message);
    }
}

async function markTemplateRepliedForContact(contactId) {
    try {
        if (!contactId) return;
        const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - TEMPLATE_REPLY_WINDOW_MS);
        // Tomar el envio mas reciente sin respuesta a este contacto, dentro de la ventana
        const snap = await db.collection('template_sends')
            .where('contactId', '==', contactId)
            .where('repliedAt', '==', null)
            .where('sentAt', '>=', cutoff)
            .orderBy('sentAt', 'desc')
            .limit(1)
            .get();
        if (snap.empty) return;
        await snap.docs[0].ref.update({
            repliedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        // Errores comunes: indice compuesto faltante. No es critico, el envio funciona.
        console.error('[template-metrics] Error marcando respuesta:', e.message);
    }
}

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
                    try {
                        let publicUrl;
                        try {
                            // El bucket usa Uniform Bucket-Level Access y bloquea el acceso
                            // anónimo, así que las URLs públicas clásicas (storage.googleapis.com)
                            // dan 403. Usamos un token de descarga de Firebase: URL permanente
                            // y compatible con UBLA (no depende de ACLs por objeto).
                            const downloadToken = require('crypto').randomUUID();
                            await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
                            publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;
                        } catch (tokenErr) {
                            // Respaldo para buckets sin UBLA: ACL pública clásica.
                            console.warn(`[MEDIA] token de descarga falló, intentando makePublic(). ${tokenErr.message}`);
                            await file.makePublic();
                            publicUrl = file.publicUrl();
                        }
                        console.log(`[MEDIA] URL pública generada: ${publicUrl}`);
                        resolve({ publicUrl, mimeType });
                    } catch (finalErr) {
                        // Si ni el token ni makePublic funcionan, el caller usa el
                        // proxy (/webhook/wa/media/:id) como último respaldo.
                        console.error(`[MEDIA] No se pudo generar URL pública para ${filePath}:`, finalErr);
                        reject(finalErr);
                    }
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
// Una cola más vieja que esto ya no es relevante: el cliente pudo pagar por otro lado,
// comprar de nuevo o cambiar de intención. Se marca 'expired' en vez de enviarse tarde.
const QUEUED_MESSAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

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

            // No disparar colas vencidas (contexto perdido). Marcar 'expired' y seguir.
            const qTs = queuedMessage.timestamp && queuedMessage.timestamp.toMillis ? queuedMessage.timestamp.toMillis() : 0;
            if (qTs && (Date.now() - qTs) > QUEUED_MESSAGE_MAX_AGE_MS) {
                console.warn(`[QUEUE] Mensaje en cola vencido (~${Math.round((Date.now() - qTs) / 86400000)} días) omitido para ${contactId}: ${doc.id}`);
                batch.update(doc.ref, { status: 'expired' });
                continue;
            }

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
        // Solo detener el flujo si REALMENTE se envió algo. Si la cola solo tenía mensajes
        // vencidos o fallidos, devolver false para que el webhook siga al flujo normal
        // (anuncio/IA) en vez de dejar al cliente sin respuesta.
        return !!lastMessageText;

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
        // Detect channel
        const contactDoc = await contactRef.get();
        const channel = contactDoc.exists ? (contactDoc.data().channel || 'whatsapp') : 'whatsapp';

        if (channel === 'messenger') {
            // --- Messenger send ---
            const psid = contactDoc.data().psid;
            const sentData = await sendMessengerMessage(psid, { text, fileUrl, fileType });

            for (const msg of sentData.messages) {
                const messageToSave = {
                    from: 'page', status: 'sent',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: msg.id, text: msg.textForDb, isAutoReply: true
                };
                if (msg.fileUrlForDb) messageToSave.fileUrl = msg.fileUrlForDb;
                if (msg.fileTypeForDb) messageToSave.fileType = msg.fileTypeForDb;
                await contactRef.collection('messages').add(messageToSave);
            }

            await contactRef.update({
                lastMessage: sentData.lastTextForDb,
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`[AUTO] Mensaje automático (Messenger) enviado a ${contactRef.id}.`);
        } else {
            // --- WhatsApp send (original logic) ---
            const sentMessageData = await sendAdvancedWhatsAppMessage(contactRef.id, { text, fileUrl, fileType });

            await contactRef.collection('messages').add({
                from: PHONE_NUMBER_ID,
                status: 'sent',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: sentMessageData.id,
                text: sentMessageData.textForDb,
                fileUrl: sentMessageData.fileUrlForDb,
                fileType: sentMessageData.fileTypeForDb,
                isAutoReply: true
            });

            await contactRef.update({
                lastMessage: sentMessageData.textForDb,
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`[AUTO] Mensaje automático (WhatsApp) enviado a ${contactRef.id}.`);
        }
        return true; // enviado con éxito
    } catch (error) {
        console.error(`❌ Fallo al enviar mensaje automático a ${contactRef.id}:`, error.message);
        return false; // el caller decide si necesita un fallback (ej. dejar que la IA responda)
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

            // --- INICIO DE PREVENCIÓN DE DUPLICADOS ---
            // Revisar si ya procesamos este mensaje verificando su wamid
            if (message.id) {
                const isDuplicate = await contactRef.collection('messages').where('id', '==', message.id).limit(1).get();
                if (!isDuplicate.empty) {
                    console.log(`[WEBHOOK] Mensaje duplicado detectado (wamid ${message.id}). Meta reenvió el webhook. Ignorando.`);
                    return res.sendStatus(200);
                }
            }
            // --- FIN DE PREVENCIÓN DE DUPLICADOS ---

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
                    messageData.mediaProxyUrl = `/webhook/wa/media/${message.image.id}`; // Store proxy URL for frontend
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
                    messageData.mediaProxyUrl = `/webhook/wa/media/${message.video.id}`;
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
                    messageData.mediaProxyUrl = `/webhook/wa/media/${message.audio.id}`;
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
                    messageData.mediaProxyUrl = `/webhook/wa/media/${message.document.id}`;
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
                    console.error(`[STICKER] FALLBACK: No se pudo guardar el sticker ${message.sticker.id}. Usando proxy. Error: ${uploadError.message}`);
                    messageData.mediaProxyUrl = `/webhook/wa/media/${message.sticker.id}`; // Proxy para mostrarlo igual
                    messageData.fileType = message.sticker.mime_type || 'image/webp';
                    messageData.text = 'Sticker';
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
            } else if (message.type === 'contacts' && message.contacts) {
                const contact = message.contacts[0];
                const name = contact?.name?.formatted_name || 'Contacto';
                const phone = contact?.phones?.[0]?.phone || '';
                messageData.text = `👤 Contacto: ${name}${phone ? ' (' + phone + ')' : ''}`;
            } else if (message.type === 'unsupported') {
                const errorDetail = message.errors?.[0];
                const errorTitle = errorDetail?.title || '';
                const errorMsg = errorDetail?.message || '';
                const detail = errorTitle || errorMsg || '';
                messageData.text = `⚠️ Mensaje no soportado${detail ? ': ' + detail : ''}`;
                console.log(`[WEBHOOK] Mensaje unsupported de ${from}. Errors:`, JSON.stringify(message.errors || {}), 'Full:', JSON.stringify(message));
            } else {
                console.warn(`[WEBHOOK] Tipo de mensaje no manejado completamente: ${message.type}. Payload:`, JSON.stringify(message));
                messageData.text = `Mensaje multimedia (${message.type})`;
            }
             // --- Remove null/undefined fields before saving ---
            Object.keys(messageData).forEach(key => messageData[key] == null && delete messageData[key]);

            // Save the message to the 'messages' subcollection of the contact.
            // Se usa el wamid como ID del documento con create(): así el guardado es
            // ATÓMICO frente a reintentos de Meta (el chequeo de duplicados de arriba
            // tiene una ventana de carrera durante las descargas de multimedia, y un
            // mensaje duplicado en el historial hace que la IA "vea" al cliente repetir
            // y vuelva a dar la misma información).
            const msgDocId = message.id ? String(message.id).replace(/\//g, '_').slice(0, 900) : null;
            let savedMsgRef = null;
            if (msgDocId) {
                try {
                    await contactRef.collection('messages').doc(msgDocId).create(messageData);
                    savedMsgRef = contactRef.collection('messages').doc(msgDocId);
                } catch (createErr) {
                    if (createErr.code === 6 || /already exists/i.test(String(createErr.message))) {
                        console.log(`[WEBHOOK] Mensaje duplicado detectado al guardar (wamid ${message.id}). Ignorando reintento de Meta.`);
                        return res.sendStatus(200);
                    }
                    throw createErr;
                }
            } else {
                savedMsgRef = await contactRef.collection('messages').add(messageData);
            }
            console.log(`[LOG] Mensaje de ${from} guardado en Firestore.`);

            // Transcripción automática de notas de voz: nota INTERNA para el operador (campo transcription
            // del mensaje). NO se envía al cliente. Fire-and-forget para no bloquear el webhook.
            if (savedMsgRef && messageData.fileUrl && messageData.fileType && messageData.fileType.startsWith('audio/')) {
                transcribeIncomingAudioMessage(savedMsgRef, messageData.fileUrl, messageData.fileType)
                    .catch(err => console.warn('[TRANSCRIBE] fallo async (wa):', err.message));
            }

            // Tracking de plantilla (Fase 2): marcar como "respondida" la tanda mas reciente sin respuesta
            markTemplateRepliedForContact(from).catch(err => console.error('[template-metrics] reply tracking falló:', err.message));

            // --- Incrementar métricas diarias pre-agregadas ---
            const contactDoc = await contactRef.get();
            const contactTag = (contactDoc.exists && contactDoc.data().status) || 'sin_etiqueta';
            const metricsDateKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const dailyMetricRef = db.collection('daily_metrics').doc(metricsDateKey);
            const dailyMetricUpdate = {
                totalMessages: admin.firestore.FieldValue.increment(1),
                [`tags.${contactTag}`]: admin.firestore.FieldValue.increment(1)
            };
            // "Lead WA" por anuncio: cada mensaje que llega con referral de anuncio cuenta como lead,
            // exista o no el contacto (clic de anuncio -> WhatsApp). Pre-agregado por dia en daily_metrics.adLeads.
            if (message.referral && message.referral.source_type === 'ad') {
                dailyMetricUpdate.adLeads = admin.firestore.FieldValue.increment(1);
            }
            dailyMetricRef.set(dailyMetricUpdate, { merge: true }).catch(err => console.error('[METRICS] Error incrementando métrica diaria:', err));

            // --- Update contact document ---
            const isNewContact = !contactDoc.exists;
            let isAiRuleEnabled = false; // Nueva bandera para saber si la regla tiene IA
            // ¿El mensaje llega desde un anuncio que este contacto NO había usado antes?
            // Permite enviar la respuesta configurada también a contactos EXISTENTES que escriben
            // desde un anuncio distinto al original (antes solo se respondía a contactos nuevos).
            let isNewAdForContact = false;

            const contactUpdateData = {
                name: contactInfo.profile?.name || (contactDoc.exists ? contactDoc.data().name : from), // Use existing name if available
                name_lowercase: (contactInfo.profile?.name || (contactDoc.exists ? contactDoc.data().name : from)).toLowerCase(),
                wa_id: contactInfo.wa_id, // WhatsApp ID
                lastMessage: messageData.text, // Preview text
                lastMessageTimestamp: messageData.timestamp, // Use message timestamp
                unreadCount: admin.firestore.FieldValue.increment(1) // Increment unread count
            };

            // Si el chat está en revisión de diseño, también incrementar designUnreadCount
            if (contactDoc.exists && contactDoc.data().inDesignReview) {
                contactUpdateData.designUnreadCount = admin.firestore.FieldValue.increment(1);
            }

            // --- Ad Referral: registrar TODOS los anuncios de los que vino el contacto, en orden cronológico ---
            // Antes solo se guardaba el primer anuncio (adReferral). Ahora mantenemos también un historial
            // (adReferralHistory): un arreglo con cada anuncio DISTINTO (por source_id) y la fecha en que se vio
            // por primera vez, ordenado del más antiguo al más reciente.
            if (message.referral && message.referral.source_id) {
                const existingData = contactDoc.exists ? contactDoc.data() : {};
                let adHistory = Array.isArray(existingData.adReferralHistory) ? [...existingData.adReferralHistory] : [];

                // Migración suave: si el contacto ya tenía un adReferral previo pero aún no historial, lo sembramos como el primero.
                if (adHistory.length === 0 && existingData.adReferral && existingData.adReferral.source_id) {
                    adHistory.push(existingData.adReferral);
                }

                // Solo registrar si este anuncio (source_id) aún no está en el historial.
                const alreadyTracked = adHistory.some(entry => entry && entry.source_id === message.referral.source_id);

                if (!alreadyTracked) {
                    // Anuncio distinto a los del historial: habilita el envío de su respuesta configurada
                    // aunque el contacto ya exista (lo evalúa el bloque 6 de automatización).
                    isNewAdForContact = true;
                    let adName = message.referral.headline || message.referral.body || `ID: ${message.referral.source_id}`;

                    // Intentar obtener el nombre interno del anuncio vía Graph API
                    if (message.referral.source_type === 'ad' && process.env.META_GRAPH_TOKEN) {
                        try {
                            console.log(`[META GRAPH] Consultando nombre del anuncio para ID: ${message.referral.source_id}`);
                            const metaResponse = await axios.get(`https://graph.facebook.com/v18.0/${message.referral.source_id}`, {
                                params: {
                                    fields: 'name',
                                    access_token: process.env.META_GRAPH_TOKEN
                                }
                            });

                            if (metaResponse.data && metaResponse.data.name) {
                                adName = metaResponse.data.name;
                                console.log(`[META GRAPH] Nombre obtenido: ${adName}`);
                            }
                        } catch (error) {
                            console.error(`[META GRAPH] Error al consultar nombre de anuncio: ${error.message}`);
                            // Fallback ya está en adName (headline o body)
                        }
                    }

                    const referralEntry = {
                        ...message.referral,
                        ad_name: adName,
                        firstSeenAt: messageData.timestamp // Fecha del primer mensaje recibido desde este anuncio
                    };

                    adHistory.push(referralEntry);
                    contactUpdateData.adReferralHistory = adHistory;

                    // Mantener adReferral apuntando al PRIMER anuncio (retrocompatibilidad con atribución y banner anterior).
                    contactUpdateData.adReferral = adHistory[0];

                    // Lista PLANA de IDs de anuncio (todos los del historial). Firestore no puede hacer
                    // array-contains sobre objetos dentro de un arreglo, así que mantenemos este arreglo de
                    // strings para poder filtrar conversaciones por "vino de este anuncio en algún momento".
                    contactUpdateData.adSourceIds = adHistory.map(e => e && e.source_id).filter(Boolean);

                    console.log(`[AD] Anuncio registrado para ${from}. Ad ID: ${message.referral.source_id}, Nombre: ${adName}. Total anuncios distintos: ${adHistory.length}`);
                }
            }

            // Set or merge contact data
            await contactRef.set(contactUpdateData, { merge: true });
            console.log(`[LOG] Contacto ${from} actualizado/creado en Firestore.`);

            // Reactivación de leads: cada mensaje entrante (re)inicia la secuencia de
            // seguimiento. Si no registra pedido, el scheduler le enviará recordatorios.
            armLeadFollowup(from, contactUpdateData.name).catch(err =>
                console.error('[LEAD_REACT] Error armando seguimiento:', err.message));

            // Seguimiento de "pedido en proceso": (re)inicia la secuencia que, al vencer,
            // clasifica con IA si el cliente empezó a dar datos y no terminó, y le recuerda
            // dentro de las 24h y en horario laboral. La ventana se reinicia con cada mensaje.
            armOrderFollowup(from, contactUpdateData.name).catch(err =>
                console.error('[ORDER_FOLLOWUP] Error armando seguimiento:', err.message));

            // Métrica de rescate: si el cliente fue contactado por el sistema y ahora
            // responde, contabilizamos el re-enganche.
            markOrderFollowupReplied(from).catch(err =>
                console.error('[ORDER_FOLLOWUP] Error marcando respuesta:', err.message));

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
                    
                    // --- SINCRONIZAR IA CON EL DEPARTAMENTO DEL ANUNCIO ---
                    // La IA del contacto se alinea con el departamento al que enruta el anuncio entrante
                    // (incluido un anuncio NUEVO/distinto al original): si la regla activa IA, se prende el
                    // bot; si la regla NO tiene IA, se apaga. Así, al escribir desde otro anuncio cuyo
                    // departamento no usa IA, la IA se desactiva sola, y viceversa.
                    if (ruleData.enableAi) {
                        console.log(`[ROUTING-AI] Anuncio ${adId} con IA: activando bot para ${from}`);
                        // Un anuncio nuevo es una venta nueva: reiniciar a etapa 1 (venta) por si
                        // el contacto venía de una compra anterior en etapa 2 (post-venta).
                        await contactRef.update({ botActive: true, aiStage: 'venta' });
                        isAiRuleEnabled = true;
                    } else {
                        console.log(`[ROUTING-AI] Anuncio ${adId} sin IA: desactivando bot para ${from}`);
                        await contactRef.update({ botActive: false });
                    }
                } else {
                     // Fallback: el anuncio no tiene regla → cae a "General". Como General no usa IA,
                     // también se desactiva el bot del contacto (mismo criterio que una regla sin IA).
                    console.log(`[ROUTING] No se encontraron reglas para Ad ID: ${adId}. Asignando a General y desactivando IA.`);
                    const generalDeptQuery = await db.collection('departments').where('name', '==', 'General').limit(1).get();
                    if (!generalDeptQuery.empty) {
                        const generalDeptId = generalDeptQuery.docs[0].id;
                        await contactRef.update({ assignedDepartmentId: generalDeptId, botActive: false });
                        console.log(`[ROUTING] Contacto ${from} asignado al departamento General por falta de regla específica.`);
                    } else {
                        await contactRef.update({ botActive: false });
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
                    
                    // Meta requiere 'LeadSubmitted' (no 'Lead') cuando action_source = business_messaging
                    await sendConversionEvent('LeadSubmitted', eventInfo, message.referral, {});
                    console.log(`[META EVENT] Evento 'LeadSubmitted' enviado a Meta CAPI para ${from}.`);

                } catch (eventError) {
                    console.error(`[META EVENT] Error al enviar evento 'LeadSubmitted' a Meta CAPI para ${from}:`, eventError.message);
                    // No bloquear el resto del flujo, solo registrar el error
                }
            }
            // --- FIN: Enviar evento a Meta Ads ---

            // Get potentially updated contact data for automation logic
            const updatedContactData = (await contactRef.get()).data();

            // --- Automation Logic ---

            // 1. Send Queued Messages (if user replied)
            // Los mensajes MUY viejos en cola ya no se envían (vencen a los 7 días dentro de
            // sendQueuedMessages): un agente pudo dejar en cola un recordatorio de pago que, si
            // el cliente vuelve semanas después con una consulta nueva, ya no aplica (caso real
            // 522214381255: volvió por un anuncio nuevo pidiendo informes y le llegó la info de
            // pago de su pedido de junio). Si la cola solo tenía mensajes vencidos, sendQueuedMessages
            // devuelve false y el flujo sigue al anuncio/IA para atender la consulta nueva.
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

            // --- Cliente PIDE VIDEO de su producto (post-venta) → pasar el pedido a "Corregir" ---
            // Si el cliente, ya en post-venta (pedido terminado, /cuatro enviado), pide un video de su
            // producto, movemos su pedido a "Corregir" (el tablero donde el equipo atiende pendientes de
            // un pedido ya terminado) y avisamos al admin para que lo grabe y se lo mande. Va aquí en el
            // webhook —no dentro de la IA— para que funcione AUNQUE un humano lleve el chat (IA apagada).
            // Idempotente (no re-avisa si ya está en Corregir) y fire-and-forget: no toca el flujo normal.
            // Se excluyen los mensajes que solo agradecen/confirman un video ya recibido. Kill-switch:
            // crm_settings/general.videoRequestToCorregirActive = false lo apaga.
            if (message.type === 'text' && updatedContactData.aiStage === 'postventa') {
                const videoToCorregirActive = !(generalSettingsDoc.exists && generalSettingsDoc.data().videoRequestToCorregirActive === false);
                const body = message.text?.body || '';
                const mentionsVideo = /\b(v[ií]deos?|videito)\b/i.test(body);
                const alreadyGotVideo = /(gracias por (el |tu )?v[ií]deo|ya (lo )?vi (el )?v[ií]deo|recib[ií] (el |tu )?v[ií]deo)/i.test(body);
                if (videoToCorregirActive && mentionsVideo && !alreadyGotVideo) {
                    console.log(`[POSTVENTA] ${from} pide video de su producto → marcando su pedido a "Corregir".`);
                    markOrderCorregirForContact(from, updatedContactData, body, 'video')
                        .catch(e => console.warn('[POSTVENTA] markOrderCorregirForContact (video) falló:', e.message));
                }
            }

            if (!AI_ALWAYS_ON && !isWithinBusinessHours() && awayMessageActive) {
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

            // 6. Respuesta de bienvenida / anuncio
            // - Contacto NUEVO: respuesta del anuncio de origen (si lo hay) o bienvenida general.
            // - Contacto EXISTENTE que escribe desde un anuncio DISTINTO a los que ya había usado
            //   (isNewAdForContact === true): se le envía la respuesta configurada de ese nuevo anuncio.
            //   Antes esto se omitía porque el bloque estaba gateado solo por isNewContact, así que
            //   quien ya había escrito desde un anuncio NO recibía la respuesta del siguiente.
            let adResponseSent = false;
            const fromAd = message.referral?.source_type === 'ad' && message.referral.source_id;
            if (fromAd && (isNewContact || isNewAdForContact)) {
                const adId = message.referral.source_id;
                console.log(`[AD] ${isNewContact ? 'Nuevo contacto' : 'Contacto existente'} desde Ad ID: ${adId} (anuncio nuevo para el contacto: ${isNewAdForContact}).`);
                // Query using 'array-contains' for the adId within the 'adIds' array
                const snapshot = await db.collection('ad_responses').where('adIds', 'array-contains', adId).limit(1).get();
                if (!snapshot.empty) {
                    const adResponseData = snapshot.docs[0].data();
                    console.log(`[AD] Mensaje encontrado para Ad ID ${adId}: "${adResponseData.message || 'Archivo adjunto'}"`);
                    // Solo cuenta como "respondido" si el envío a Meta tuvo éxito: si falla,
                    // adResponseSent queda false y la IA responde como red de seguridad.
                    adResponseSent = (await sendAutoMessage(contactRef, { text: adResponseData.message, fileUrl: adResponseData.fileUrl, fileType: adResponseData.fileType })) === true;
                } else {
                    console.log(`[AD] No se encontró mensaje específico para Ad ID ${adId}.`);
                }
            }
            // Bienvenida SOLO para contactos nuevos que no recibieron respuesta de anuncio.
            // Comportamiento: se les manda la quick reply /corazon (bienvenida) y se ENCIENDE la IA, para
            // que atienda desde el PRÓXIMO mensaje del cliente (el primero ya recibió el /corazon). Los
            // contactos de anuncio NO entran aquí: su IA la gobierna la regla del anuncio (enableAi).
            // Kill-switch: crm_settings/general.autoCorazonOnFirstMessage=false lo apaga (default: encendido).
            if (isNewContact && !adResponseSent) {
                // /corazon + IA SOLO para contactos que NO vienen de anuncio (los de anuncio los gobierna la
                // regla del anuncio, enableAi). Un contacto de anuncio sin respuesta configurada cae aquí con
                // la bienvenida genérica, pero SIN /corazon y SIN pisar el botActive que dejó su regla.
                const autoCorazon = !fromAd && !(generalSettingsDoc.exists && generalSettingsDoc.data().autoCorazonOnFirstMessage === false);
                let corazonSent = false;
                if (autoCorazon) {
                    const qrSnap = await db.collection('quick_replies').where('shortcut', '==', 'corazon').limit(1).get();
                    if (!qrSnap.empty) {
                        const qr = qrSnap.docs[0].data();
                        corazonSent = (await sendAutoMessage(contactRef, { text: qr.message || '', fileUrl: qr.fileUrl || null, fileType: qr.fileType || null })) === true;
                    } else {
                        console.warn('[CORAZON] Quick reply "corazon" no existe en Firestore; se usa la bienvenida genérica.');
                    }
                }
                if (!corazonSent) {
                    await sendAutoMessage(contactRef, { text: GENERAL_WELCOME_MESSAGE });
                }
                const welcomeUpdate = { welcomed: true };
                if (autoCorazon) { welcomeUpdate.botActive = true; welcomeUpdate.aiStage = 'venta'; } // encender IA (solo no-anuncio)
                await contactRef.update(welcomeUpdate);
            }

            // Auto-marcar como LEÍDA la conversación cuando el mensaje entrante solo disparó la
            // bienvenida automática (RI del anuncio, o bienvenida de contacto nuevo): son leads que
            // todavía no requieren atención humana, así no saturan la lista con "1 sin leer". Si el
            // cliente responde algo DESPUÉS, ese mensaje sí vuelve a marcar la conversación como no
            // leída (ya es un contacto existente, sin bienvenida).
            if (adResponseSent || isNewContact) {
                await contactRef.update({ unreadCount: 0 })
                    .catch(e => console.warn('[UNREAD] No se pudo marcar leída la bienvenida:', e.message));
            }

            // 7. Trigger AI Reply if applicable
            // Lanzamos la IA pero no hacemos un AWAIT de modo que podamos responder el 200 rápido a Meta
            // MODIFICACIÓN: No disparamos la IA si es un contacto nuevo, para que NO responda al mensaje inicial del Ad.
            // Tampoco si este mensaje YA recibió la respuesta enlatada del anuncio (adResponseSent):
            // antes el contacto existente que escribía desde un anuncio nuevo recibía la respuesta
            // del anuncio Y 20s después la de la IA al MISMO mensaje (doble respuesta).
            if (updatedContactData.botActive && !isNewContact && !adResponseSent) {
                let delay = 20000; // Delay estándar de 20s para conversaciones en curso
                // Si la IA ya pidió los datos de envío (awaitingShippingData), damos 10 min a que el
                // cliente termine de mandarlos en partes antes de que la IA le pida lo que falte —
                // EXCEPTO si el cliente pregunta qué falta / si ya está completo: ahí respondemos rápido.
                if (updatedContactData.awaitingShippingData) {
                    const incomingText = (message.text?.body || '').toLowerCase();
                    const asksWhatsMissing = /(falta|faltan|qu[eé] m[aá]s|qu[eé] datos|cu[aá]l|es todo|eso es todo|ya (?:te )?(?:lo|los|las|le)?\s*(?:di|mand|envi|env[ií]|pas)|ya est|ya qued|list[oa]|complet|algo m[aá]s)/i.test(incomingText);
                    if (!asksWhatsMissing) {
                        delay = 10 * 60 * 1000; // 10 min: esperar a que el cliente complete sus datos
                    }
                }
                console.log(`[AI] Programando respuesta de IA para ${from} en ${delay/1000}s (Bot activo: ${updatedContactData.botActive}${updatedContactData.awaitingShippingData ? ', esperando datos de envío' : ''})`);
                triggerAutoReplyAI(message, contactRef, updatedContactData, delay).catch(err => {
                    console.error('[WEBHOOK] Error asíncrono en respuesta de IA:', err);
                });
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
                // --- INICIO DE LA CORRECCIÓN: RETRY LOGIC PARA STATUS UPDATES ---
                // Función helper para esperar
                const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                let messageDoc = null;
                let attempts = 0;
                const maxAttempts = 3;
                
                // Intentar buscar el mensaje varias veces (para manejar condiciones de carrera con medios pesados)
                while (attempts < maxAttempts && !messageDoc) {
                    // Búsqueda global por ID (wamid) para mayor robustez
                    const snap = await db.collectionGroup('messages').where('id', '==', messageId).limit(1).get();
                    if (!snap.empty) {
                        messageDoc = snap.docs[0];
                    } else {
                        attempts++;
                        if (attempts < maxAttempts) {
                            const delay = attempts * 1000; // 1s, 2s...
                            console.log(`[STATUS RETRY] Mensaje ${messageId} no encontrado aún. Reintentando en ${delay}ms... (${attempts}/${maxAttempts})`);
                            await wait(delay);
                        }
                    }
                }
                
                if (messageDoc) {
                    // Update only if the new status is "later" than the current one (sent -> delivered -> read)
                    const order = { sent: 1, delivered: 2, read: 3, failed: 4, queued: 0, pending: 0 }; // Define status order
                    // Asegurarse de que el status actual existe (fallback a 0)
                    const currentStatusValue = order[messageDoc.data().status] || 0;
                    const newStatusValue = order[newStatus] || 0;

                    if (newStatusValue > currentStatusValue) {
                        const updateData = { status: newStatus };
                        // Guardar el momento exacto del cambio de estado (timestamp de WhatsApp, epoch en segundos)
                        const tsSeconds = Number(statusUpdate.timestamp);
                        if (!isNaN(tsSeconds) && tsSeconds > 0) {
                            const fsTs = admin.firestore.Timestamp.fromMillis(tsSeconds * 1000);
                            if (newStatus === 'read') updateData.readAt = fsTs;
                            else if (newStatus === 'delivered') updateData.deliveredAt = fsTs;
                        }
                        // Persistir la razón del fallo (Meta la manda solo en este webhook;
                        // sin esto el error queda únicamente en los logs del servidor)
                        if (newStatus === 'failed' && Array.isArray(errors) && errors.length) {
                            const e = errors[0] || {};
                            updateData.error = {
                                code: typeof e.code === 'number' ? e.code : null,
                                title: e.title || null,
                                detail: e.error_data?.details || e.message || null
                            };
                        }
                        await messageDoc.ref.update(updateData);
                        console.log(`[LOG] Estado del mensaje ${messageId} actualizado a '${newStatus}' en Firestore.`);
                    } else {
                         console.log(`[LOG] Estado ${newStatus} para ${messageId} es anterior o igual al actual (${messageDoc.data().status}). No se actualiza.`);
                    }
                } else {
                    console.warn(`[LOG] No se encontró el mensaje ${messageId} en Firestore (búsqueda global) después de ${attempts} intentos. Es posible que el guardado inicial haya fallado.`);
                }
                // --- FIN DE LA CORRECCIÓN ---

                // Tracking de plantilla (Fase 2): replicar el cambio en template_sends si aplica
                await updateTemplateSendStatus(messageId, newStatus, errors);

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
