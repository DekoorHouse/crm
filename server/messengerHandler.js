const express = require('express');
const axios = require('axios');
const { db, admin, bucket } = require('./config');
const { triggerAutoReplyAI, sendMessengerMessage, cancelPendingAiTimer, transcribeIncomingAudioMessage, sendConversionEvent } = require('./services');

const router = express.Router();

// --- CONSTANTES ---
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const FB_PAGE_ID = process.env.FB_PAGE_ID;

// --- HORARIO Y MENSAJES AUTOMÁTICOS (reutilizados de WhatsApp) ---
const BUSINESS_HOURS = { 1: [7, 19], 2: [7, 19], 3: [7, 19], 4: [7, 19], 5: [7, 19], 6: [7, 14] };
const TIMEZONE = 'America/Mexico_City';
// Si es true, la IA responde a CUALQUIER hora y NO se envía el mensaje de ausencia fuera de horario.
// Cambiar a false para reactivar el horario de atención (BUSINESS_HOURS) + aviso de ausencia.
const AI_ALWAYS_ON = true;
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
 * Obtiene el nombre del usuario vía la Conversations API de la página.
 * Necesario porque Meta restringió la User Profile API (GET /{psid}), que ahora
 * responde "Object does not exist" aunque el token y pages_messaging sean correctos.
 * @param {string} userId PSID (Messenger) o IGSID (Instagram).
 * @param {string} channel 'messenger' | 'instagram'
 * @returns {Promise<{name: string|null, username: string|null}>}
 */
async function getNameFromConversations(userId, channel) {
    const token = channel === 'instagram' ? (IG_ACCESS_TOKEN || FB_PAGE_ACCESS_TOKEN) : FB_PAGE_ACCESS_TOKEN;
    const platform = channel === 'instagram' ? 'instagram' : 'messenger';
    if (!FB_PAGE_ID) return { name: null, username: null };
    try {
        const res = await axios.get(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/conversations`, {
            params: { platform, user_id: userId, fields: 'participants', access_token: token }
        });
        const convs = res.data?.data || [];
        for (const c of convs) {
            const parts = c.participants?.data || [];
            const user = parts.find(p => String(p.id) !== String(FB_PAGE_ID));
            const name = (user?.name || '').trim();
            if (name) return { name, username: user.username || null };
        }
    } catch (error) {
        const apiErr = error.response?.data?.error;
        console.warn(`[${channel.toUpperCase()}] Conversations lookup falló para ${userId}: ${apiErr ? apiErr.message : error.message}`);
    }
    return { name: null, username: null };
}

/**
 * Fetches user profile info (Messenger). Usa primero la Conversations API porque la
 * User Profile API (GET /{psid}) está restringida por Meta; deja un fallback por si acaso.
 * @param {string} psid The Page-Scoped User ID.
 * @returns {Promise<{name: string, profileImageUrl: string|null}>}
 */
async function getUserProfile(psid) {
    // 1) Vía moderna: Conversations API
    const conv = await getNameFromConversations(psid, 'messenger');
    if (conv.name) {
        return { name: conv.name, profileImageUrl: null };
    }
    // 2) Fallback: User Profile API (por si en algún caso sí responde)
    try {
        const response = await axios.get(`https://graph.facebook.com/v19.0/${psid}`, {
            params: { fields: 'name,first_name,last_name,profile_pic', access_token: FB_PAGE_ACCESS_TOKEN }
        });
        const data = response.data || {};
        const name = (data.name || [data.first_name, data.last_name].filter(Boolean).join(' ')).trim();
        return {
            name: name || `Facebook User (${psid.slice(-4)})`,
            profileImageUrl: data.profile_pic || null
        };
    } catch (error) {
        const apiErr = error.response?.data?.error;
        console.warn(`[MESSENGER] Sin nombre para ${psid} (conversations y user-profile fallaron): ${apiErr ? apiErr.message : error.message}`);
        return { name: `Facebook User (${psid.slice(-4)})`, profileImageUrl: null };
    }
}

/**
 * Fetches user profile info (Instagram). Igual que Messenger: Conversations API primero.
 * @param {string} igsid The Instagram-Scoped User ID.
 * @returns {Promise<{name: string, username: string|null, profileImageUrl: string|null}>}
 */
async function getInstagramUserProfile(igsid) {
    // 1) Conversations API (platform=instagram)
    const conv = await getNameFromConversations(igsid, 'instagram');
    if (conv.name) {
        return { name: conv.name, username: conv.username || null, profileImageUrl: null };
    }
    // 2) Fallback: User Profile API
    try {
        const response = await axios.get(`https://graph.facebook.com/v19.0/${igsid}`, {
            params: { fields: 'name,username,profile_pic', access_token: IG_ACCESS_TOKEN || FB_PAGE_ACCESS_TOKEN }
        });
        const data = response.data || {};
        const name = (data.name || data.username || '').trim();
        return {
            name: name || `IG User (${igsid.slice(-4)})`,
            username: data.username || null,
            profileImageUrl: data.profile_pic || null
        };
    } catch (error) {
        const apiErr = error.response?.data?.error;
        console.warn(`[INSTAGRAM] Sin nombre para ${igsid} (conversations y user-profile fallaron): ${apiErr ? apiErr.message : error.message}`);
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
                    try {
                        let publicUrl;
                        try {
                            // Bucket con Uniform Bucket-Level Access: el acceso anónimo está
                            // bloqueado (storage.googleapis.com da 403). Usamos un token de
                            // descarga de Firebase, que es permanente y compatible con UBLA.
                            const downloadToken = require('crypto').randomUUID();
                            await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
                            publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;
                        } catch (tokenErr) {
                            // Respaldo para buckets sin UBLA: ACL pública clásica.
                            console.warn(`[MESSENGER MEDIA] token de descarga falló, intentando makePublic(). ${tokenErr.message}`);
                            await file.makePublic();
                            publicUrl = file.publicUrl();
                        }
                        resolve({ publicUrl, mimeType });
                    } catch (finalErr) {
                        // Último respaldo: la URL CDN de origen de Meta (suele cargar
                        // directo en <img>), en vez de dejar el mensaje sin imagen.
                        console.warn(`[MESSENGER MEDIA] No se pudo generar URL de Storage, usando URL de origen. ${finalErr.message}`);
                        resolve({ publicUrl: url, mimeType });
                    }
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

                // Respuestas del equipo desde la app de Meta/Business Suite llegan como
                // "echo" (message.is_echo, con sender = la página). Antes se descartaban:
                // la IA no veía lo que el humano ya contestó (repetía la misma info) y
                // respondía encima. Ahora se registran en el historial y cancelan la IA.
                if (event.message && event.message.is_echo) {
                    // try/catch propio: un error procesando el echo NO debe abortar los
                    // demás eventos del batch (mensajes entrantes de otros clientes).
                    try {
                        await handleEchoMessage(event, channel);
                    } catch (echoErr) {
                        console.error(`[${logPrefix} ECHO] Error procesando echo:`, echoErr.message);
                    }
                    continue;
                }

                // Ignore other events sent by the page itself
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

                // Handle standalone referral (messaging_referral sin mensaje): un cliente recurrente
                // que hace clic en un anuncio, o un clic en un link ig.me. El referral de un anuncio al
                // PRIMER mensaje llega dentro de event.message (abajo); este cubre el caso SIN mensaje.
                if (event.referral && !event.message) {
                    await handleReferralEvent(senderId, event.referral, event.timestamp, channel);
                    continue;
                }

                // Handle incoming messages
                if (event.message) {
                    // Anuncios Click-to-Messenger/Instagram: Meta entrega el anuncio de origen en referral
                    // (a nivel del evento o dentro del postback). Lo pasamos para el mensaje de bienvenida por anuncio.
                    const referral = event.referral || event.postback?.referral || event.message.referral || null;
                    if (referral) console.log(`[${logPrefix} REFERRAL] Referral recibido:`, JSON.stringify(referral));
                    await handleIncomingMessage(senderId, event.message, event.timestamp, channel, referral);
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
 * Normaliza el referral de un anuncio Click-to-Messenger/Instagram al formato que usan el banner de
 * origen (AdReferralBannerTemplate) y la atribución. El título del anuncio viene en
 * ads_context_data.ad_title (no en headline/body como WhatsApp). Meta no manda source_url aquí.
 */
function buildAdReferralData(referral, channel, firstSeenAt) {
    const adId = referral.ad_id || referral.source_id;
    const adCtx = referral.ads_context_data || {};
    const adTitle = adCtx.ad_title || referral.headline || referral.ref || '';
    return {
        ...referral,
        source_id: adId,
        source_type: referral.source_type || 'ad',
        ad_id: adId,
        ad_name: adTitle,
        headline: adTitle,
        firstSeenAt: firstSeenAt || admin.firestore.FieldValue.serverTimestamp(),
        channel
    };
}

/**
 * Reporta el Lead del anuncio a Meta CAPI (business_messaging). Fire-and-forget: no bloquea el flujo.
 */
function reportAdLead(contactId, channel, senderId, contactName, adReferral, logPrefix) {
    const leadInfo = {
        channel,
        psid: channel === 'instagram' ? null : senderId,
        igsid: channel === 'instagram' ? senderId : null,
        profile: { name: contactName || null }
    };
    sendConversionEvent('LeadSubmitted', leadInfo, adReferral, {})
        .then(() => console.log(`[${logPrefix} META EVENT] LeadSubmitted enviado para ${contactId} (ad ${adReferral.ad_id}).`))
        .catch(err => console.error(`[${logPrefix} META EVENT] Error al enviar LeadSubmitted para ${contactId}:`, err.message));
}

/**
 * Enruta el contacto a su departamento según ad_routing_rules (adIds -> targetDepartmentId), las
 * MISMAS reglas que WhatsApp. Devuelve true si se asignó por una regla de anuncio.
 */
async function routeContactByAd(contactRef, contactId, adReferralId, logPrefix) {
    try {
        const ruleSnap = await db.collection('ad_routing_rules')
            .where('adIds', 'array-contains', String(adReferralId))
            .limit(1).get();
        const ruleData = !ruleSnap.empty ? ruleSnap.docs[0].data() : null;
        if (ruleData && ruleData.targetDepartmentId) {
            await contactRef.update({ assignedDepartmentId: ruleData.targetDepartmentId });
            console.log(`[${logPrefix} ROUTING] Contacto ${contactId} asignado a '${ruleData.targetDepartmentId}' por regla de anuncio ${adReferralId} (${ruleData.ruleName || 'sin nombre'}).`);
            return true;
        }
        console.log(`[${logPrefix} ROUTING] Anuncio ${adReferralId} sin regla de departamento.`);
    } catch (e) {
        console.error(`[${logPrefix} ROUTING] Error consultando ad_routing_rules para ${adReferralId}:`, e.message);
    }
    return false;
}

/**
 * Procesa un messaging_referral "suelto" (event.referral SIN event.message): un cliente que hace
 * clic en un anuncio o en un link ig.me sin mandar mensaje. Si el contacto YA existe y el referral
 * trae anuncio (ad_id), actualiza su origen, reporta el Lead y lo re-enruta por departamento (igual
 * que cuando el referral llega con el primer mensaje). No crea contactos nuevos: si aún no existe, se
 * ignora (su primer mensaje lo creará, con el referral del anuncio adjunto). Los ig.me sin anuncio
 * solo guardan el ref para referencia.
 */
async function handleReferralEvent(senderId, referral, eventTimestamp, channel = 'messenger') {
    const prefix = channel === 'instagram' ? 'ig' : 'fb';
    const logPrefix = channel === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';
    const contactId = `${prefix}_${senderId}`;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);

    const contactDoc = await contactRef.get();
    if (!contactDoc.exists) {
        console.log(`[${logPrefix} REFERRAL] messaging_referral de ${contactId} sin conversación previa; se ignora hasta que escriba.`);
        return;
    }

    const adReferralId = referral && (referral.ad_id || referral.source_id);
    const ts = admin.firestore.Timestamp.fromMillis(eventTimestamp || Date.now());

    // Link ig.me sin anuncio: guardar el ref para referencia; no dispara eventos de anuncios.
    if (!adReferralId) {
        if (referral && referral.ref) {
            await contactRef.update({ igmeRef: referral.ref, igmeRefAt: ts });
            console.log(`[${logPrefix} REFERRAL] ig.me ref='${referral.ref}' guardado para ${contactId}.`);
        }
        return;
    }

    const adReferral = buildAdReferralData(referral, channel, ts);
    await contactRef.update({
        adReferral,
        adSourceIds: admin.firestore.FieldValue.arrayUnion(String(adReferralId))
    });
    console.log(`[${logPrefix} REFERRAL] Anuncio ${adReferralId} registrado para ${contactId} (messaging_referral suelto).`);

    reportAdLead(contactId, channel, senderId, contactDoc.data().name, adReferral, logPrefix);
    await routeContactByAd(contactRef, contactId, adReferralId, logPrefix);
}

/**
 * Handles an incoming Messenger or Instagram DM message.
 * @param {string} senderId PSID (Messenger) or IGSID (Instagram)
 * @param {object} message The message payload from Meta
 * @param {number} eventTimestamp
 * @param {'messenger'|'instagram'} channel
 */
async function handleIncomingMessage(senderId, message, eventTimestamp, channel = 'messenger', referral = null) {
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
                // Guardar el tipo con la misma nomenclatura que WhatsApp: la IA depende de
                // este campo para ADJUNTAR el archivo a Gemini (services.js exige d.type).
                // Sin él, la IA nunca veía las imágenes/audios/PDF de FB/IG y respondía a ciegas.
                messageData.type = attachType === 'file' ? 'document' : attachType;

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

    // Save message to Firestore.
    // Usamos el mid como ID del documento con create() para que la escritura sea idempotente:
    // si Meta entrega el webhook dos veces de forma concurrente (Instagram lo hace con frecuencia),
    // el segundo create() falla con ALREADY_EXISTS en lugar de crear un mensaje duplicado.
    // Esto cierra la race condition que la verificación query-then-add de arriba no alcanza a cubrir.
    try {
        let savedMsgRef = null;
        if (message.mid) {
            const msgDocId = message.mid.replace(/\//g, '_'); // '/' no es válido en IDs de documento de Firestore
            await contactRef.collection('messages').doc(msgDocId).create(messageData);
            savedMsgRef = contactRef.collection('messages').doc(msgDocId);
        } else {
            savedMsgRef = await contactRef.collection('messages').add(messageData);
        }
        // Transcripción automática de notas de voz: nota INTERNA para el operador; no se envía al cliente.
        if (savedMsgRef && messageData.fileUrl && messageData.fileType && messageData.fileType.startsWith('audio/')) {
            transcribeIncomingAudioMessage(savedMsgRef, messageData.fileUrl, messageData.fileType)
                .catch(err => console.warn('[TRANSCRIBE] fallo async (msgr):', err.message));
        }
    } catch (saveErr) {
        if (saveErr.code === 6 || /already exist/i.test(saveErr.message || '')) { // ALREADY_EXISTS: webhook duplicado
            console.log(`[${logPrefix}] Mensaje duplicado (mid ${message.mid}) atrapado por create(). Ignorando.`);
            return;
        }
        throw saveErr;
    }
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

        // Auto-reparación de nombre: si el contacto se creó cuando faltaban permisos,
        // su nombre quedó como marcador genérico ("Facebook User (1234)"). Al llegar un
        // mensaje nuevo reintentamos obtener el nombre real; si ya está disponible, se corrige.
        const currentName = (contactDoc.data().name || '');
        if (/^(Facebook User|IG User) \(/.test(currentName)) {
            const profile = channel === 'instagram'
                ? await getInstagramUserProfile(senderId)
                : await getUserProfile(senderId);
            const stillPlaceholder = /^(Facebook User|IG User) \(/.test(profile.name);
            if (!stillPlaceholder) {
                contactUpdateData.name = profile.name;
                contactUpdateData.name_lowercase = profile.name.toLowerCase();
                if (profile.profileImageUrl) contactUpdateData.profileImageUrl = profile.profileImageUrl;
                if (profile.username) contactUpdateData.igUsername = profile.username;
                console.log(`[${logPrefix}] Nombre real recuperado para ${contactId}: ${profile.name}`);
            }
        }

        // Si el chat está en revisión de diseño, también incrementar designUnreadCount
        if (contactDoc.exists && contactDoc.data().inDesignReview) {
            contactUpdateData.designUnreadCount = admin.firestore.FieldValue.increment(1);
        }
    }

    // Anuncios Click-to-Messenger/Instagram: persistir el anuncio de origen. La Conversions API
    // de Meta atribuye el Purchase por el PSID/IGSID, pero necesitamos guardar esta señal para
    // saber DESPUÉS (al registrar/fabricar el pedido) que el contacto vino de un anuncio y así
    // reportar la conversión. Antes el referral se usaba solo para la bienvenida y se descartaba.
    const adReferralId = referral && (referral.ad_id || referral.source_id);
    if (adReferralId) {
        // Persistir el anuncio de origen (para el banner, la atribución del Purchase y el enrutamiento).
        contactUpdateData.adReferral = buildAdReferralData(referral, channel, messageData.timestamp);
        contactUpdateData.adSourceIds = admin.firestore.FieldValue.arrayUnion(String(adReferralId));
    }

    await contactRef.set(contactUpdateData, { merge: true });
    console.log(`[${logPrefix}] Contacto ${contactId} actualizado/creado.`);

    // Paridad con WhatsApp: si el contacto viene de un anuncio, reportar el Lead a Meta CAPI.
    if (adReferralId) {
        reportAdLead(contactId, channel, senderId, contactUpdateData.name, contactUpdateData.adReferral, logPrefix);
    }

    // --- Asignación de departamento (paridad con WhatsApp) ---
    // Si el contacto viene de un anuncio, se enruta por ad_id con las MISMAS reglas que WhatsApp
    // (ad_routing_rules). Sin regla, o sin anuncio, cae a "General" solo si es nuevo (para no
    // repisar una asignación manual previa de un contacto existente).
    let assignedByRule = false;
    if (adReferralId) {
        assignedByRule = await routeContactByAd(contactRef, contactId, adReferralId, logPrefix);
    }
    if (!assignedByRule && isNewContact) {
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

    if (!AI_ALWAYS_ON && !isWithinBusinessHours() && awayMessageActive) {
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

    // Welcome message / Ad response for new contacts
    if (isNewContact) {
        let adResponseSent = false;
        // Click-to-Messenger ads: Meta entrega el Ad ID en referral.ad_id (Messenger/Instagram).
        // Se usa la MISMA colección 'ad_responses' que WhatsApp para reutilizar los mensajes configurados.
        const adId = referral && (referral.ad_id || referral.source_id);
        if (adId) {
            console.log(`[${logPrefix} AD] Nuevo contacto desde Ad ID: ${adId}`);
            const snapshot = await db.collection('ad_responses').where('adIds', 'array-contains', adId).limit(1).get();
            if (!snapshot.empty) {
                const adResponseData = snapshot.docs[0].data();
                console.log(`[${logPrefix} AD] Mensaje de anuncio encontrado para Ad ID ${adId}.`);
                await sendAutoMessage(contactRef, { text: adResponseData.message, fileUrl: adResponseData.fileUrl, fileType: adResponseData.fileType });
                adResponseSent = true;
            } else {
                console.log(`[${logPrefix} AD] No hay mensaje específico para Ad ID ${adId}. Se envía bienvenida general.`);
            }
        }
        // Bienvenida general SOLO si no se envió un mensaje específico de anuncio.
        // Nuevo: si autoCorazon está activo, se manda la quick reply /corazon y se ENCIENDE la IA para
        // que atienda desde el PRÓXIMO mensaje del cliente. Kill-switch:
        // crm_settings/general.autoCorazonOnFirstMessage=false (default: encendido).
        // /corazon + IA SOLO para contactos que NO vienen de anuncio (adId). Un contacto de anuncio sin
        // ad_response configurado cae al fallback de bienvenida genérica/configurada, sin /corazon y sin IA.
        const autoCorazon = !adId && !(generalSettingsDoc.exists && generalSettingsDoc.data().autoCorazonOnFirstMessage === false);
        if (!adResponseSent) {
            let welcomePayload = null;
            // Preferir /corazon si autoCorazon está activo y la quick reply existe.
            if (autoCorazon) {
                const corSnap = await db.collection('quick_replies').where('shortcut', '==', 'corazon').limit(1).get();
                if (!corSnap.empty) {
                    const cor = corSnap.docs[0].data();
                    welcomePayload = { text: cor.message || '', fileUrl: cor.fileUrl || null, fileType: cor.fileType || null };
                    console.log(`[${logPrefix}] [CORAZON] Bienvenida con /corazon + IA para ${contactId}.`);
                } else {
                    console.warn(`[${logPrefix}] [CORAZON] Quick reply "corazon" no existe; se usa la bienvenida configurada/genérica.`);
                }
            }
            // Fallback: bienvenida configurable de Messenger (messengerWelcomeShortcut) o genérica.
            if (!welcomePayload) {
                welcomePayload = { text: GENERAL_WELCOME_MESSAGE };
                if (channel === 'messenger') {
                    try {
                        const cfg = await db.collection('crm_settings').doc('general').get();
                        const shortcut = cfg.exists ? (cfg.data().messengerWelcomeShortcut || '') : '';
                        if (shortcut) {
                            const qrSnap = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
                            if (!qrSnap.empty) {
                                const qr = qrSnap.docs[0].data();
                                welcomePayload = { text: qr.message || '', fileUrl: qr.fileUrl || null, fileType: qr.fileType || null };
                                console.log(`[${logPrefix}] Bienvenida de FB: usando respuesta rápida '/${shortcut}'.`);
                            } else {
                                console.warn(`[${logPrefix}] La respuesta rápida '/${shortcut}' configurada para la bienvenida de FB no existe. Se usa la genérica.`);
                            }
                        }
                    } catch (e) {
                        console.warn(`[${logPrefix}] No se pudo leer la bienvenida de FB configurada: ${e.message}`);
                    }
                }
            }
            await sendAutoMessage(contactRef, welcomePayload);
        }
        // Encender la IA para contactos nuevos que no vinieron de anuncio (gobernado por autoCorazon).
        const welcomeUpdate = { welcomed: true };
        if (autoCorazon && !adResponseSent) { welcomeUpdate.botActive = true; welcomeUpdate.aiStage = 'venta'; }
        await contactRef.update(welcomeUpdate);
        return;
    }

    // AI auto-reply
    if (updatedContactData.botActive) {
        const incomingMsg = { type: 'text', text: { body: messageData.text } };
        let delay = 20000;
        // Igual que WhatsApp: si la IA ya pidió los datos de envío (awaitingShippingData),
        // dar 10 min a que el cliente los mande en partes antes de pedirle lo que falta —
        // EXCEPTO si pregunta qué falta / si ya está completo: ahí se responde rápido.
        if (updatedContactData.awaitingShippingData) {
            const incomingText = (messageData.text || '').toLowerCase();
            const asksWhatsMissing = /(falta|faltan|qu[eé] m[aá]s|qu[eé] datos|cu[aá]l|es todo|eso es todo|ya (?:te )?(?:lo|los|las|le)?\s*(?:di|mand|envi|env[ií]|pas)|ya est|ya qued|list[oa]|complet|algo m[aá]s)/i.test(incomingText);
            if (!asksWhatsMissing) {
                delay = 10 * 60 * 1000;
            }
        }
        console.log(`[${logPrefix} AI] Programando respuesta de IA para ${contactId} en ${delay/1000}s${updatedContactData.awaitingShippingData ? ' (esperando datos de envío)' : ''}`);
        triggerAutoReplyAI(incomingMsg, contactRef, updatedContactData, delay).catch(err => {
            console.error(`[${logPrefix}] Error asíncrono en respuesta de IA:`, err);
        });
    }
}

/**
 * Registra un "echo": mensaje enviado por la página desde FUERA del CRM (un humano
 * respondiendo en la app de Messenger/Instagram o Business Suite). Los envíos hechos
 * por el propio CRM/IA ya se guardaron con su mid al enviarse, así que aquí el
 * create() con el mismo mid falla con ALREADY_EXISTS y se ignoran solos: únicamente
 * quedan los mensajes tecleados por un humano en la app de Meta. Además se cancela
 * la respuesta pendiente de la IA para que no conteste encima del humano.
 */
async function handleEchoMessage(event, channel = 'messenger') {
    const prefix = channel === 'instagram' ? 'ig' : 'fb';
    const logPrefix = channel === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';
    const recipientId = event.recipient?.id; // en un echo, el cliente es el destinatario
    const message = event.message || {};
    if (!recipientId) return;

    // FILTRO 1 — echoes de la PROPIA app (envíos del CRM/IA vía Send API traen nuestro
    // app_id): descartarlos SIEMPRE. Sin esto, cada mensaje saliente se duplicaría como
    // "humanEcho" y el bloque de cancelación de abajo abortaría a la propia IA (p. ej.
    // el echo de la burbuja 1 de un [SPLIT] cancelaría las burbujas restantes).
    const ownAppId = process.env.FB_APP_ID || '';
    if (message.app_id && ownAppId && String(message.app_id) === ownAppId) {
        return;
    }

    const contactId = `${prefix}_${recipientId}`;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    const contactDoc = await contactRef.get();
    if (!contactDoc.exists) return; // chat que no seguimos en el CRM

    // FILTRO 2 — respaldo: si ya existe un mensaje con este mid (las rutas de envío del
    // CRM/IA guardan el mid en el CAMPO 'id', no como ID de documento), es un envío
    // propio: no duplicar ni cancelar nada.
    if (message.mid) {
        const dup = await contactRef.collection('messages').where('id', '==', message.mid).limit(1).get();
        if (!dup.empty) return;
    }

    // Texto legible del echo + media adjunta (p. ej. una foto que el equipo manda
    // desde la app de Meta): se sube a Storage para que se vea en el CRM.
    let text = message.text || '';
    let fileUrl = null, fileType = null;
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
        const attachment = message.attachments[0];
        const fallbackTexts = { image: '📷 Imagen', video: '🎥 Video', audio: '🎵 Audio', file: '📄 Documento' };
        if (!text) text = fallbackTexts[attachment.type] || 'Archivo adjunto';
        if (['image', 'video', 'audio', 'file'].includes(attachment.type) && attachment.payload?.url) {
            try {
                const uploaded = await downloadAndUploadMessengerMedia(attachment.payload.url, recipientId, message.mid || `echo_${event.timestamp}`);
                fileUrl = uploaded.publicUrl;
                fileType = uploaded.mimeType;
            } catch (mediaErr) {
                console.warn(`[${logPrefix} ECHO] No se pudo guardar la media del echo:`, mediaErr.message);
            }
        }
    }
    if (!text) text = 'Mensaje enviado desde la app de Meta';

    const messageData = {
        timestamp: admin.firestore.Timestamp.fromMillis(event.timestamp || Date.now()),
        from: 'page',
        status: 'sent',
        id: message.mid || null,
        text,
        fileUrl,
        fileType,
        humanEcho: true, // lo escribió un humano fuera del CRM
        channel
    };
    Object.keys(messageData).forEach(key => messageData[key] == null && delete messageData[key]);

    try {
        if (message.mid) {
            const msgDocId = message.mid.replace(/\//g, '_');
            // create() con el mid como doc ID: idempotente frente a webhooks repetidos.
            await contactRef.collection('messages').doc(msgDocId).create(messageData);
        } else {
            await contactRef.collection('messages').add(messageData);
        }
    } catch (saveErr) {
        if (saveErr.code === 6 || /already exist/i.test(saveErr.message || '')) {
            return; // webhook repetido
        }
        throw saveErr;
    }
    console.log(`[${logPrefix} ECHO] Respuesta humana desde la app de Meta registrada para ${contactId}.`);

    // Un humano ya está atendiendo este chat: cancelar la respuesta pendiente de la IA
    // y abortar la generación en vuelo si la hay.
    cancelPendingAiTimer(contactId);
    const contactUpdate = {
        lastMessage: text,
        lastMessageTimestamp: messageData.timestamp,
        aiNextRun: admin.firestore.FieldValue.delete()
    };
    if (contactDoc.data().aiStatus === 'generating') {
        contactUpdate.aiStatus = 'cancelled';
    }
    await contactRef.update(contactUpdate);
}

/**
 * Handles postback events (button clicks in templates).
 */
async function handlePostback(senderPsid, postback, eventTimestamp) {
    const contactId = `fb_${senderPsid}`;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);

    // No escribir mensajes bajo contactos que no existen (quedaba un doc "fantasma"
    // invisible en el CRM); el primer mensaje real del cliente creará el contacto.
    const contactDoc = await contactRef.get();
    if (!contactDoc.exists) {
        console.log(`[MESSENGER POSTBACK] de ${contactId} ignorado: el contacto aún no existe.`);
        return;
    }

    const messageData = {
        timestamp: admin.firestore.Timestamp.fromMillis(eventTimestamp),
        from: contactId,
        status: 'received',
        id: `postback_${eventTimestamp}`,
        text: postback.title || postback.payload || 'Botón presionado',
        channel: 'messenger'
    };

    // ID determinista + create(): un reintento de Meta (mismo timestamp) no duplica el clic.
    try {
        await contactRef.collection('messages').doc(`postback_${eventTimestamp}`).create(messageData);
    } catch (saveErr) {
        if (saveErr.code === 6 || /already exist/i.test(saveErr.message || '')) {
            console.log(`[MESSENGER POSTBACK] Duplicado (postback_${eventTimestamp}). Ignorando reintento.`);
            return;
        }
        throw saveErr;
    }
    console.log(`[MESSENGER POSTBACK] de fb_${senderPsid}: "${messageData.text}"`);

    // Reflejar el clic en el chat y responder: antes el postback solo se guardaba y el
    // bot se quedaba callado hasta que el cliente escribiera texto.
    await contactRef.update({
        lastMessage: messageData.text,
        lastMessageTimestamp: messageData.timestamp,
        unreadCount: admin.firestore.FieldValue.increment(1)
    });
    const contactData = contactDoc.data();
    if (contactData.botActive) {
        console.log(`[MESSENGER AI] Programando respuesta de IA para ${contactId} (clic de botón).`);
        triggerAutoReplyAI({ type: 'text', text: { body: messageData.text } }, contactRef, contactData, 20000).catch(err => {
            console.error('[MESSENGER] Error asíncrono en respuesta de IA (postback):', err);
        });
    }
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
 * Handles read receipts from Messenger (evento `read` con watermark) e Instagram
 * (evento `messaging_seen`, que NO manda watermark sino el `mid` del mensaje leído).
 */
async function handleReadReceipt(senderId, readEvent, channel = 'messenger') {
    const prefix = channel === 'instagram' ? 'ig' : 'fb';
    const contactId = `${prefix}_${senderId}`;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);

    try {
        // Messenger manda `watermark` (marca de tiempo hasta la que se leyó todo). Instagram
        // (messaging_seen) NO manda watermark: manda el `mid` del mensaje leído. En ese caso
        // derivamos el watermark del timestamp de ese mensaje para marcar también los anteriores.
        let watermarkMs = readEvent.watermark;
        if (!watermarkMs && readEvent.mid) {
            const seenSnap = await contactRef.collection('messages').where('id', '==', readEvent.mid).limit(1).get();
            if (!seenSnap.empty) {
                const ts = seenSnap.docs[0].data().timestamp;
                watermarkMs = ts && ts.toMillis ? ts.toMillis() : null;
            }
        }
        if (!watermarkMs) {
            console.warn(`[${channel.toUpperCase()} STATUS] Read sin watermark ni mid resoluble para ${contactId} (mid=${readEvent.mid || 'n/a'}).`);
            return;
        }

        // Mark all sent messages before watermark as read
        const messagesQuery = await contactRef.collection('messages')
            .where('from', '==', 'page')
            .where('status', 'in', ['sent', 'delivered'])
            .where('timestamp', '<=', admin.firestore.Timestamp.fromMillis(watermarkMs))
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
