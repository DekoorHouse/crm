// index.js - VERSIÓN CORREGIDA Y MEJORADA
// Gestión completa de mensajes de anuncios, multimedia, y bot automático.

require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const { google } = require('googleapis');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const fetch = require('node-fetch');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- CONFIGURACIÓN DE FIREBASE ---
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET // Usar variable de entorno para el bucket
    });
    console.log('✅ Conexión con Firebase (Firestore y Storage) establecida.');
} catch (error) {
    console.error('❌ ERROR CRÍTICO: No se pudo inicializar Firebase. Revisa la variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON.', error.message);
    process.exit(1); // Detener la aplicación si Firebase no inicia
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); 
const bucket = getStorage().bucket();

// --- CONFIGURACIÓN DEL SERVIDOR EXPRESS ---
const app = express();
const whitelist = process.env.CORS_WHITELIST ? process.env.CORS_WHITELIST.split(',') : [];
const corsOptions = {
  origin: function (origin, callback) {
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- VARIABLES DE ENTORNO ---
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- CONFIGURACIÓN DE GOOGLE SHEETS ---
const SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
async function getGoogleSheetsClient() {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS_JSON);
        const auth = new google.auth.GoogleAuth({ credentials, scopes: SHEETS_SCOPES });
        const client = await auth.getClient();
        return google.sheets({ version: 'v4', auth: client });
    } catch (error) {
        console.error("❌ Error al autenticar con Google Sheets. Revisa la variable de entorno 'GOOGLE_SHEETS_CREDENTIALS_JSON'.", error.message);
        return null;
    }
}

// --- FUNCIÓN PARA VERIFICAR COBERTURA ---
async function checkCoverage(postalCode) {
    if (!postalCode) return null;
    console.log(`[LOG] Verificando cobertura para CP: ${postalCode}`);
    const sheets = await getGoogleSheetsClient();
    if (!sheets) return "No se pudo verificar la cobertura en este momento.";

    try {
        const settingsDoc = await db.collection('crm_settings').doc('general').get();
        const sheetId = settingsDoc.exists ? settingsDoc.data().googleSheetId : null;
        if (!sheetId) return "La herramienta de cobertura no está configurada.";

        const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'M:M' });
        const rows = response.data.values;
        if (rows && rows.length) {
            const coverageZips = rows.flat();
            if (coverageZips.includes(postalCode.toString())) {
                return `✅ ¡Buenas noticias! Sí tenemos cobertura en el código postal ${postalCode}.`;
            } else {
                return `❌ Lo sentimos, por el momento no tenemos cobertura en el código postal ${postalCode}.`;
            }
        }
        return `No se encontraron datos de cobertura para verificar el código postal ${postalCode}.`;
    } catch (error) {
        console.error(`❌ [LOG] Error al leer Google Sheets:`, error.message);
        if (error.code === 404) return "Error: No se encontró la hoja de cálculo. Verifica el ID.";
        if (error.code === 403) return "Error de permisos. Asegúrate de haber compartido la hoja con el correo de servicio.";
        return "Hubo un problema al verificar la cobertura. Inténtalo más tarde.";
    }
}

// --- FUNCIÓN AUXILIAR PARA GEMINI ---
async function generateGeminiResponse(prompt) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const geminiResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!geminiResponse.ok) throw new Error(`La API de Gemini respondió con el estado: ${geminiResponse.status}`);
    const result = await geminiResponse.json();
    let generatedText = result.candidates[0]?.content?.parts[0]?.text?.trim();
    if (!generatedText) throw new Error('No se recibió una respuesta válida de la IA.');
    if (generatedText.startsWith('Asistente:')) {
        generatedText = generatedText.substring('Asistente:'.length).trim();
    }
    return generatedText;
}

// --- LÓGICA CENTRAL DEL BOT DE IA ---
async function triggerAutoReplyAI(message, contactRef) {
    const contactId = contactRef.id;
    console.log(`[AI] Iniciando proceso de IA para ${contactId}.`);
    try {
        const contactDoc = await contactRef.get();
        const contactData = contactDoc.data();
        const generalSettingsDoc = await db.collection('crm_settings').doc('general').get();
        const globalBotActive = generalSettingsDoc.exists && generalSettingsDoc.data().globalBotActive === true;

        if (!globalBotActive || contactData.botActive === false) {
            console.log(`[AI] Bot desactivado (global o para el contacto). No se enviará respuesta.`);
            return;
        }

        // CORRECCIÓN: La lógica de CP se eliminó de aquí para evitar redundancia. Se maneja en el webhook principal.

        const botSettingsDoc = await db.collection('crm_settings').doc('bot').get();
        const botInstructions = botSettingsDoc.exists ? botSettingsDoc.data().instructions : 'Eres un asistente virtual amigable y servicial.';
        const knowledgeBaseSnapshot = await db.collection('ai_knowledge_base').get();
        const knowledgeBase = knowledgeBaseSnapshot.docs.map(doc => `- ${doc.data().topic}: ${doc.data().answer}`).join('\n');
        const messagesSnapshot = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(10).get();
        const conversationHistory = messagesSnapshot.docs.map(doc => {
            const d = doc.data();
            return `${d.from === contactId ? 'Cliente' : 'Asistente'}: ${d.text}`;
        }).reverse().join('\n');

        const prompt = `
            **Instrucciones Generales:**\n${botInstructions}\n
            **Base de Conocimiento:**\n${knowledgeBase || 'No hay información adicional.'}\n
            **Historial de la Conversación:**\n${conversationHistory}\n
            **Tarea:** Responde al ÚLTIMO mensaje del cliente de manera concisa y útil. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;
        
        console.log(`[AI] Generando respuesta para ${contactId}.`);
        const aiResponse = await generateGeminiResponse(prompt);

        const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text: aiResponse });
        await contactRef.collection('messages').add({
            from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: sentMessageData.id, text: sentMessageData.textForDb, isAutoReply: true
        });
        await contactRef.update({ lastMessage: sentMessageData.textForDb, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() });
        console.log(`[AI] Respuesta de IA enviada a ${contactId}.`);
    } catch (error) {
        console.error(`❌ [AI] Error en el proceso de IA para ${contactId}:`, error.message);
    }
}

// --- FUNCIÓN AUXILIAR PARA EVENTOS DE CONVERSIÓN ---
function sha256(data) {
    if (!data) return null;
    return crypto.createHash('sha256').update(data.toString().toLowerCase().replace(/\s/g, '')).digest('hex');
}

async function sendConversionEvent(eventName, contactInfo, referral, customData = {}) {
    if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
        console.log('[CAPI] Pixel ID o Access Token no configurado. Omitiendo evento.');
        return;
    }
    const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events`;
    const event_time = Math.floor(new Date().getTime() / 1000);
    const event_id = `${eventName}_${contactInfo.wa_id}_${event_time}`;
    const userData = {
        "ph": [sha256(contactInfo.wa_id)],
        "fn": [sha256(contactInfo.profile.name.split(' ')[0])],
        "ln": [sha256(contactInfo.profile.name.split(' ').slice(1).join(' '))]
    };
    const eventData = {
        "event_name": eventName, "event_time": event_time, "event_id": event_id,
        "user_data": userData, "action_source": "whatsapp", "custom_data": customData
    };
    if (referral && referral.source_type === 'ad') {
        eventData.data_processing_options = [];
        eventData.data_processing_options_country = 0;
        eventData.data_processing_options_state = 0;
    }
    const payload = { "data": [eventData], "access_token": META_CAPI_ACCESS_TOKEN };
    try {
        console.log(`[CAPI] Enviando evento '${eventName}' para ${contactInfo.wa_id}`);
        const response = await axios.post(url, payload);
        console.log('[CAPI] Evento enviado con éxito:', response.data);
    } catch (error) {
        console.error('[CAPI] Error al enviar evento de conversión:', error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

// --- FUNCIÓN DE ENVÍO AVANZADO DE MENSAJES ---
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
        messageToSaveText = text || (type === 'image' ? '📷 Imagen' : type === 'video' ? '🎥 Video' : type === 'audio' ? '🎵 Audio' : '📄 Documento');
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
        console.log(`[LOG] Enviando mensaje a ${to}. Payload:`, JSON.stringify(messagePayload));
        const response = await axios.post(url, messagePayload, { headers });
        const messageId = response.data.messages[0].id;
        return { id: messageId, textForDb: messageToSaveText, fileUrlForDb: fileUrl || null, fileTypeForDb: fileType || null };
    } catch (error) {
        console.error(`❌ Error al enviar mensaje avanzado a ${to}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}

// --- GESTIÓN DE CÓDIGOS POSTALES ---
async function handlePostalCodeAuto(message, contactRef, contactId) {
  if (message?.type !== 'text') return false;
  const match = message.text.body.match(/\b(\d{5})\b/);
  if (!match) return false;

  const postalCode = match[1];
  console.log(`[CP] Código postal detectado: ${postalCode}`);
  const coverageResponse = await checkCoverage(postalCode);
  if (!coverageResponse) return false;

  try {
    const sent = await sendAdvancedWhatsAppMessage(contactId, { text: coverageResponse });
    await contactRef.collection('messages').add({
      from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
      id: sent.id, text: sent.textForDb, isAutoReply: true
    });
    await contactRef.update({ lastMessage: sent.textForDb, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`[CP] Respuesta de cobertura enviada para ${postalCode}.`);
    return true;
  } catch (e) {
    console.error('[CP] Error al manejar CP automático:', e.message);
    return false;
  }
}

// --- **NUEVA FUNCIÓN** PARA GESTIONAR MENSAJES AUTOMÁTICOS ---
const GENERAL_WELCOME_MESSAGE = '¡Hola! 👋 Gracias por comunicarte. ¿Cómo podemos ayudarte hoy? 😊';

async function sendAutoMessage(contactRef, { text, fileUrl, fileType }) {
    const contactId = contactRef.id;
    try {
        console.log(`[AUTO] Enviando mensaje automático a ${contactId}.`);
        const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text, fileUrl, fileType });
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
        console.log(`[AUTO] Mensaje automático enviado y guardado para ${contactId}.`);
    } catch (error) {
        console.error(`❌ [AUTO] Fallo al enviar mensaje automático a ${contactId}:`, error.message);
        throw error; // Propagar el error para que el llamador lo sepa
    }
}


// --- WEBHOOK DE VERIFICACIÓN ---
app.get('/webhook', (req, res) => {
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

// --- FUNCIONES DE GESTIÓN DE ARCHIVOS MULTIMEDIA ---
async function getMediaUrl(mediaId) {
    try {
        const url = `https://graph.facebook.com/v19.0/${mediaId}`;
        const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` };
        const response = await axios.get(url, { headers });
        return { url: response.data.url, mimeType: response.data.mime_type };
    } catch (error) {
        console.error(`❌ Error al obtener la URL del medio ${mediaId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
        return null;
    }
}

async function uploadMediaToStorage(mediaUrl, mimeType) {
    if (!mediaUrl || !mimeType) return null;
    try {
        const response = await axios({ method: 'get', url: mediaUrl, responseType: 'arraybuffer', headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
        const buffer = Buffer.from(response.data, 'binary');
        const extension = mimeType.split('/')[1] || 'bin';
        const fileName = `whatsapp_media/${uuidv4()}.${extension}`;
        const file = bucket.file(fileName);
        await file.save(buffer, { metadata: { contentType: mimeType } });
        await file.makePublic();
        return file.publicUrl();
    } catch (error) {
        console.error(`❌ Error al descargar o subir el medio:`, error.message);
        return null;
    }
}

// --- LÓGICA PRINCIPAL DEL WEBHOOK ---
app.post('/webhook', async (req, res) => {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Procesa mensajes de usuarios
    if (value && value.messages && value.contacts) {
        const message = value.messages[0];
        const contactInfo = value.contacts[0];
        const from = message.from;
        const contactRef = db.collection('contacts_whatsapp').doc(from);

        if (message.from === PHONE_NUMBER_ID) return res.sendStatus(200); // Ignorar eco

        console.log('[LOG] Mensaje recibido de:', from, 'Tipo:', message.type);

        // --- 1. PROCESAR Y GUARDAR MENSAJE ENTRANTE ---
        const messageData = {
            timestamp: admin.firestore.Timestamp.fromMillis(message.timestamp * 1000),
            from, status: 'received', id: message.id, type: message.type,
        };

        // Extraer contenido según el tipo de mensaje
        if (message.type === 'text') {
            messageData.text = message.text.body;
        } else if (['image', 'video', 'audio', 'document'].includes(message.type)) {
            const mediaType = message.type;
            const mediaId = message[mediaType].id;
            const caption = message[mediaType].caption;
            
            messageData.text = caption || `[${mediaType}]`; // Usar caption o placeholder
            
            const mediaInfo = await getMediaUrl(mediaId);
            if (mediaInfo) {
                const publicUrl = await uploadMediaToStorage(mediaInfo.url, mediaInfo.mimeType);
                if (publicUrl) {
                    messageData.fileUrl = publicUrl;
                    messageData.fileType = mediaInfo.mimeType;
                }
            }
        } else {
            messageData.text = `[Mensaje de tipo '${message.type}' no soportado]`;
        }
        
        await contactRef.collection('messages').add(messageData);

        // --- 2. ACTUALIZAR DATOS DEL CONTACTO ---
        const contactUpdateData = {
            name: contactInfo.profile?.name, wa_id: contactInfo.wa_id,
            lastMessage: messageData.text,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            unreadCount: admin.firestore.FieldValue.increment(1)
        };
        if (message.referral) contactUpdateData.adReferral = message.referral;

        const previousDoc = await contactRef.get();
        const isNewContact = !previousDoc.exists;
        await contactRef.set(contactUpdateData, { merge: true });
        console.log(`[LOG] Contacto y mensaje de ${from} guardados.`);

        // --- 3. LÓGICA DE RESPUESTAS AUTOMÁTICAS ---
        // Prioridad 1: Código Postal
        const cpHandled = await handlePostalCodeAuto(message, contactRef, from);
        if (cpHandled) return res.sendStatus(200);

        // Prioridad 2: Contacto nuevo
        if (isNewContact) {
            let adResponseSent = false;
            if (message.referral?.source_type === 'ad' && message.referral.source_id) {
                const adId = message.referral.source_id;
                const snapshot = await db.collection('ad_responses').where('adId', '==', adId).limit(1).get();
                if (!snapshot.empty) {
                    const adResponseData = snapshot.docs[0].data();
                    await sendAutoMessage(contactRef, adResponseData);
                    adResponseSent = true;
                }
            }
            if (!adResponseSent) {
                await sendAutoMessage(contactRef, { text: GENERAL_WELCOME_MESSAGE });
                await contactRef.update({ welcomed: true });
            }
        } else {
            // Prioridad 3: Contacto existente -> IA
            await triggerAutoReplyAI(message, contactRef);
        }
    } 
    // Procesa actualizaciones de estado (enviado, entregado, leído)
    else if (value && value.statuses) {
        const statusUpdate = value.statuses[0];
        const messageId = statusUpdate.id;
        const recipientId = statusUpdate.recipient_id;
        const newStatus = statusUpdate.status;

        try {
            const messagesRef = db.collection('contacts_whatsapp').doc(recipientId).collection('messages');
            const snap = await messagesRef.where('id', '==', messageId).limit(1).get();
            if (!snap.empty) {
                const messageDoc = snap.docs[0];
                const order = { sent: 1, delivered: 2, read: 3 };
                if ((order[newStatus] || 0) > (order[messageDoc.data().status] || 0)) {
                    await messageDoc.ref.update({ status: newStatus });
                    console.log(`[LOG] Estado del mensaje ${messageId} -> '${newStatus}' para ${recipientId}.`);
                }
            }
        } catch (error) {
            console.error(`❌ Error al actualizar estado ${messageId}:`, error.message);
        }
    }

    res.sendStatus(200);
});

// --- ENDPOINT PARA ENVIAR MENSAJES MANUALES DESDE EL CRM ---
app.post('/api/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid, template } = req.body;

    if (!text && !fileUrl && !template) return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        let sentMessageData;
        let messageToSaveText;

        if (template) {
            // Lógica para plantillas
            const { payload, messageToSaveText: templateText } = await buildTemplatePayload(contactId, template);
            if (reply_to_wamid) payload.context = { message_id: reply_to_wamid };

            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, { 
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } 
            });
            sentMessageData = { id: response.data.messages[0].id };
            messageToSaveText = templateText;
        } else {
            // Lógica para mensajes de texto o multimedia
            sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text, fileUrl, fileType, reply_to_wamid });
            messageToSaveText = sentMessageData.textForDb;
        }

        const messageToSave = {
            from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: sentMessageData.id, text: messageToSaveText,
            fileUrl: sentMessageData.fileUrlForDb, fileType: sentMessageData.fileTypeForDb
        };
        if (reply_to_wamid) messageToSave.context = { message_id: reply_to_wamid };
        Object.keys(messageToSave).forEach(key => messageToSave[key] == null && delete messageToSave[key]);
        
        await contactRef.collection('messages').add(messageToSave);
        await contactRef.update({ 
            lastMessage: messageToSaveText, 
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), 
            unreadCount: 0 
        });

        res.status(200).json({ success: true, message: 'Mensaje enviado.' });
    } catch (error) {
        console.error('Error al enviar mensaje vía API:', error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(500).json({ success: false, message: 'Error al enviar el mensaje.' });
    }
});


// --- FUNCIÓN AUXILIAR PARA CONSTRUIR PAYLOAD DE PLANTILLAS ---
async function buildTemplatePayload(contactId, template) {
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    let messageToSaveText = `📄 Plantilla: ${template.name}`; 
    const payload = {
        messaging_product: 'whatsapp', to: contactId, type: 'template',
        template: { name: template.name, language: { code: template.language }, components: [] }
    };
    const bodyComponent = template.components?.find(c => c.type === 'BODY');
    if (bodyComponent?.text?.includes('{{1}}')) {
        const contactDoc = await contactRef.get();
        const contactName = contactDoc.exists && contactDoc.data().name ? contactDoc.data().name.split(' ')[0] : 'Cliente';
        payload.template.components.push({ type: 'body', parameters: [{ type: 'text', text: contactName }] });
        messageToSaveText = bodyComponent.text.replace('{{1}}', contactName);
    } else if (bodyComponent?.text) {
        messageToSaveText = bodyComponent.text;
    }
    if (payload.template.components.length === 0) delete payload.template.components;
    return { payload, messageToSaveText };
}

// --- ENDPOINTS DE CAMPAÑAS, PLANTILLAS, REACCIONES, ETC. (Sin cambios, se omiten por brevedad) ---
// ... (El resto de tus endpoints: /api/campaigns/send-template, /api/whatsapp-templates, etc. van aquí)
// --- PEGA AQUÍ EL RESTO DE TUS ENDPOINTS DESDE /api/campaigns/send-template HASTA EL FINAL ---

// --- ENDPOINT PARA CAMPAÑAS ---
app.post('/api/campaigns/send-template', async (req, res) => {
    const { contactIds, template } = req.body;
    if (!contactIds?.length || !template) return res.status(400).json({ success: false, message: 'Se requieren IDs y una plantilla.' });

    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    const results = { successful: [], failed: [] };

    const promises = contactIds.map(contactId => (async () => {
        try {
            const { payload, messageToSaveText } = await buildTemplatePayload(contactId, template);
            const response = await axios.post(url, payload, { headers });
            const messageId = response.data.messages[0].id;
            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            const contactRef = db.collection('contacts_whatsapp').doc(contactId);
            await contactRef.collection('messages').add({ from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId, text: messageToSaveText });
            await contactRef.update({ lastMessage: messageToSaveText, lastMessageTimestamp: timestamp, unreadCount: 0 });
            return { status: 'fulfilled', value: contactId };
        } catch (error) {
            return { status: 'rejected', reason: { contactId, error: error.response ? JSON.stringify(error.response.data) : error.message } };
        }
    })());

    const outcomes = await Promise.all(promises);
    outcomes.forEach(o => o.status === 'fulfilled' ? results.successful.push(o.value) : results.failed.push(o.reason));
    res.status(200).json({ success: true, message: `Campaña procesada. Enviados: ${results.successful.length}. Fallidos: ${results.failed.length}.`, results });
});

// --- ENDPOINT PARA OBTENER PLANTILLAS DE WHATSAPP ---
app.get('/api/whatsapp-templates', async (req, res) => {
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp Business.' });
    const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    try {
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
        const templates = response.data.data.filter(t => t.status !== 'REJECTED').map(t => ({ name: t.name, language: t.language, status: t.status, category: t.category, components: t.components.map(c => ({ type: c.type, text: c.text })) }));
        res.status(200).json({ success: true, templates });
    } catch (error) {
        console.error('Error al obtener plantillas de WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al obtener las plantillas de WhatsApp.' });
    }
});

// --- ENDPOINT PARA REACCIONES ---
app.post('/api/contacts/:contactId/messages/:messageDocId/react', async (req, res) => {
    const { contactId, messageDocId } = req.params;
    const { reaction } = req.body;
    try {
        const messageRef = db.collection('contacts_whatsapp').doc(contactId).collection('messages').doc(messageDocId);
        await messageRef.update({ reaction: reaction || admin.firestore.FieldValue.delete() });
        res.status(200).json({ success: true, message: 'Reacción actualizada.' });
    } catch (error) {
        console.error('Error al actualizar la reacción:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar la reacción.' });
    }
});

// --- ENDPOINTS PARA ACCIONES MANUALES Y DATOS DE CONTACTO ---
app.put('/api/contacts/:contactId', async (req, res) => {
    const { contactId } = req.params;
    const { name, email, nickname } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
    try {
        await db.collection('contacts_whatsapp').doc(contactId).update({ name, email: email || null, nickname: nickname || null });
        res.status(200).json({ success: true, message: 'Contacto actualizado.' });
    } catch (error) {
        console.error('Error al actualizar el contacto:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el contacto.' });
    }
});

// --- ENDPOINT PARA REGISTRO ---
app.post('/api/contacts/:contactId/mark-as-registration', async (req, res) => {
    const { contactId } = req.params;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        
        const contactData = contactDoc.data();
        if (contactData.registrationStatus === 'completed') return res.status(400).json({ success: false, message: 'Este contacto ya fue registrado.' });
        if (!contactData.wa_id) return res.status(500).json({ success: false, message: "Error: El contacto no tiene un ID de WhatsApp guardado." });

        const contactInfoForEvent = { wa_id: contactData.wa_id, profile: { name: contactData.name } };
        await sendConversionEvent('CompleteRegistration', contactInfoForEvent, contactData.adReferral || {});
        
        await contactRef.update({ registrationStatus: 'completed', registrationDate: admin.firestore.FieldValue.serverTimestamp() });
        res.status(200).json({ success: true, message: 'Contacto marcado como "Registro Completado".' });
    } catch (error) {
        console.error(`Error en mark-as-registration para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar la solicitud.' });
    }
});

// --- ENDPOINT PARA COMPRA ---
app.post('/api/contacts/:contactId/mark-as-purchase', async (req, res) => {
    const { contactId } = req.params;
    const { value } = req.body;
    const currency = 'MXN';
    if (!value || isNaN(parseFloat(value))) return res.status(400).json({ success: false, message: 'Se requiere un valor numérico válido.' });

    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        
        const contactData = contactDoc.data();
        if (contactData.purchaseStatus === 'completed') return res.status(400).json({ success: false, message: 'Este contacto ya realizó una compra.' });
        if (!contactData.wa_id) return res.status(500).json({ success: false, message: "Error: El contacto no tiene un ID de WhatsApp guardado." });

        const contactInfoForEvent = { wa_id: contactData.wa_id, profile: { name: contactData.name } };
        const customPurchaseData = { value: parseFloat(value), currency };
        
        await sendConversionEvent('Purchase', contactInfoForEvent, contactData.adReferral || {}, customPurchaseData);
        
        await contactRef.update({ purchaseStatus: 'completed', purchaseValue: parseFloat(value), purchaseCurrency: currency, purchaseDate: admin.firestore.FieldValue.serverTimestamp() });
        res.status(200).json({ success: true, message: 'Compra registrada y evento enviado a Meta.' });
    } catch (error) {
        console.error(`Error en mark-as-purchase para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar la compra.' });
    }
});

// --- ENDPOINT PARA VER CONTENIDO ---
app.post('/api/contacts/:contactId/send-view-content', async (req, res) => {
    const { contactId } = req.params;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        
        const contactData = contactDoc.data();
        if (!contactData.wa_id) return res.status(500).json({ success: false, message: "Error: El contacto no tiene un ID de WhatsApp guardado." });

        const contactInfoForEvent = { wa_id: contactData.wa_id, profile: { name: contactData.name } };
        await sendConversionEvent('ViewContent', contactInfoForEvent, contactData.adReferral || {});

        res.status(200).json({ success: true, message: 'Evento ViewContent enviado.' });
    } catch (error) {
        console.error(`Error en send-view-content para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar el envío de ViewContent.' });
    }
});


// --- ENDPOINTS PARA NOTAS INTERNAS ---
app.post('/api/contacts/:contactId/notes', async (req, res) => {
    const { contactId } = req.params;
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'El texto de la nota no puede estar vacío.' });
    try {
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').add({ text, timestamp: admin.firestore.FieldValue.serverTimestamp() });
        res.status(201).json({ success: true, message: 'Nota guardada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al guardar la nota.' }); }
});

app.put('/api/contacts/:contactId/notes/:noteId', async (req, res) => {
    const { contactId, noteId } = req.params;
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'El texto de la nota no puede estar vacío.' });
    try {
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').doc(noteId).update({ text });
        res.status(200).json({ success: true, message: 'Nota actualizada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al actualizar la nota.' }); }
});

app.delete('/api/contacts/:contactId/notes/:noteId', async (req, res) => {
    const { contactId, noteId } = req.params;
    try {
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').doc(noteId).delete();
        res.status(200).json({ success: true, message: 'Nota eliminada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al eliminar la nota.' }); }
});

// --- ENDPOINTS PARA RESPUESTAS RÁPIDAS (CON SOPORTE MULTIMEDIA) ---
app.post('/api/quick-replies', async (req, res) => {
    const { shortcut, message, fileUrl, fileType } = req.body;
    if (!shortcut || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'El atajo y un mensaje de texto o un archivo multimedia son obligatorios.' });
    }
    if (fileUrl && !fileType) {
        return res.status(400).json({ success: false, message: 'Si se incluye un archivo multimedia, se debe especificar su tipo (fileType).' });
    }

    try {
        const existing = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existing.empty) {
            return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya existe.` });
        }
        
        const replyData = { 
            shortcut, 
            message: message || null,
            fileUrl: fileUrl || null,
            fileType: fileType || null 
        };

        const newReply = await db.collection('quick_replies').add(replyData);
        res.status(201).json({ success: true, id: newReply.id, data: replyData });
    } catch (error) { 
        console.error("Error creating quick reply:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al crear la respuesta rápida.' }); 
    }
});

app.put('/api/quick-replies/:id', async (req, res) => {
    const { id } = req.params;
    const { shortcut, message, fileUrl, fileType } = req.body;

    if (!shortcut || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'El atajo y un mensaje de texto o un archivo multimedia son obligatorios.' });
    }
    if (fileUrl && !fileType) {
        return res.status(400).json({ success: false, message: 'Si se incluye un archivo multimedia, se debe especificar su tipo (fileType).' });
    }

    try {
        const existing = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existing.empty && existing.docs[0].id !== id) {
            return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya existe.` });
        }

        const updateData = {
            shortcut,
            message: message || null,
            fileUrl: fileUrl || null,
            fileType: fileType || null
        };

        await db.collection('quick_replies').doc(id).update(updateData);
        res.status(200).json({ success: true, message: 'Respuesta rápida actualizada.' });
    } catch (error) { 
        console.error("Error updating quick reply:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar la respuesta rápida.' }); 
    }
});


app.delete('/api/quick-replies/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('quick_replies').doc(id).delete();
        res.status(200).json({ success: true, message: 'Respuesta rápida eliminada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

// --- ENDPOINTS PARA ETIQUETAS ---
app.post('/api/tags', async (req, res) => {
    const { label, color, key, order } = req.body;
    if (!label || !color || !key || order === undefined) return res.status(400).json({ success: false, message: 'Faltan datos.' });
    try {
        await db.collection('crm_tags').add({ label, color, key, order });
        res.status(201).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al crear la etiqueta.' }); }
});

app.put('/api/tags/order', async (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ success: false, message: 'Se esperaba un array de IDs.' });
    }
    try {
        const batch = db.batch();
        orderedIds.forEach((id, index) => {
            const tagRef = db.collection('crm_tags').doc(id);
            batch.update(tagRef, { order: index });
        });
        await batch.commit();
        res.status(200).json({ success: true, message: 'Orden de etiquetas actualizado.' });
    } catch (error) {
        console.error("Error updating tag order:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el orden.' });
    }
});

app.put('/api/tags/:id', async (req, res) => {
    const { id } = req.params;
    const { label, color, key } = req.body;
    if (!label || !color || !key) return res.status(400).json({ success: false, message: 'Faltan datos.' });
    try {
        await db.collection('crm_tags').doc(id).update({ label, color, key });
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al actualizar la etiqueta.' }); }
});

app.delete('/api/tags/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('crm_tags').doc(id).delete();
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al eliminar la etiqueta.' }); }
});

// --- ENDPOINTS PARA RESPUESTAS DE ANUNCIOS ---
app.post('/api/ad-responses', async (req, res) => {
    const { adName, adId, message, fileUrl, fileType } = req.body;
    if (!adName || !adId || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'Nombre, ID del anuncio y un mensaje o archivo son obligatorios.' });
    }
    try {
        const existing = await db.collection('ad_responses').where('adId', '==', adId).limit(1).get();
        if (!existing.empty) {
            return res.status(409).json({ success: false, message: `El ID de anuncio '${adId}' ya tiene un mensaje configurado.` });
        }
        const responseData = { adName, adId, message: message || null, fileUrl: fileUrl || null, fileType: fileType || null };
        const newResponse = await db.collection('ad_responses').add(responseData);
        res.status(201).json({ success: true, id: newResponse.id, data: responseData });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al crear el mensaje.' });
    }
});

app.put('/api/ad-responses/:id', async (req, res) => {
    const { id } = req.params;
    const { adName, adId, message, fileUrl, fileType } = req.body;
    if (!adName || !adId || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'Nombre, ID del anuncio y un mensaje o archivo son obligatorios.' });
    }
    try {
        const existing = await db.collection('ad_responses').where('adId', '==', adId).limit(1).get();
        if (!existing.empty && existing.docs[0].id !== id) {
            return res.status(409).json({ success: false, message: `El ID de anuncio '${adId}' ya está en uso.` });
        }
        const updateData = { adName, adId, message: message || null, fileUrl: fileUrl || null, fileType: fileType || null };
        await db.collection('ad_responses').doc(id).update(updateData);
        res.status(200).json({ success: true, message: 'Mensaje de anuncio actualizado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar.' });
    }
});

app.delete('/api/ad-responses/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('ad_responses').doc(id).delete();
        res.status(200).json({ success: true, message: 'Mensaje de anuncio eliminado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar.' });
    }
});

// --- ENDPOINTS DE CONFIGURACIÓN DEL BOT Y GENERALES ---
app.get('/api/bot/settings', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('bot').get();
        res.status(200).json({ success: true, settings: doc.exists ? doc.data() : { instructions: '' } });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al obtener la configuración del bot.' }); }
});

app.post('/api/bot/settings', async (req, res) => {
    try {
        await db.collection('crm_settings').doc('bot').set({ instructions: req.body.instructions });
        res.status(200).json({ success: true, message: 'Configuración del bot guardada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al guardar la configuración del bot.' }); }
});

app.post('/api/bot/toggle', async (req, res) => {
    try {
        await db.collection('contacts_whatsapp').doc(req.body.contactId).update({ botActive: req.body.isActive });
        res.status(200).json({ success: true, message: `Bot ${req.body.isActive ? 'activado' : 'desactivado'}.` });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al actualizar el estado del bot.' }); }
});

app.get('/api/settings/general', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        const defaults = { globalBotActive: false, googleSheetId: '' };
        res.status(200).json({ success: true, settings: doc.exists ? { ...defaults, ...doc.data() } : defaults });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener la configuración general.' });
    }
});

app.post('/api/settings/general', async (req, res) => {
    try {
        const { globalBotActive, googleSheetId } = req.body;
        await db.collection('crm_settings').doc('general').set({ globalBotActive, googleSheetId }, { merge: true });
        res.status(200).json({ success: true, message: 'Configuración general guardada.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar la configuración general.' });
    }
});

// --- ENDPOINTS DE BASE DE CONOCIMIENTO (KNOWLEDGE BASE) ---
app.post('/api/knowledge-base', async (req, res) => {
    const { topic, answer, fileUrl, fileType } = req.body;
    if (!topic || !answer) return res.status(400).json({ success: false, message: 'El tema y la respuesta son obligatorios.' });
    try {
        const entryData = { topic, answer, fileUrl: fileUrl || null, fileType: fileType || null };
        const newEntry = await db.collection('ai_knowledge_base').add(entryData);
        res.status(201).json({ success: true, id: newEntry.id, data: entryData });
    } catch (error) { 
        res.status(500).json({ success: false, message: 'Error del servidor al crear la entrada.' }); 
    }
});

app.put('/api/knowledge-base/:id', async (req, res) => {
    const { id } = req.params;
    const { topic, answer, fileUrl, fileType } = req.body;
    if (!topic || !answer) return res.status(400).json({ success: false, message: 'El tema y la respuesta son obligatorios.' });
    try {
        const updateData = { topic, answer, fileUrl: fileUrl || null, fileType: fileType || null };
        await db.collection('ai_knowledge_base').doc(id).update(updateData);
        res.status(200).json({ success: true, message: 'Entrada actualizada.' });
    } catch (error) { 
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar la entrada.' }); 
    }
});

app.delete('/api/knowledge-base/:id', async (req, res) => {
    try {
        await db.collection('ai_knowledge_base').doc(req.params.id).delete();
        res.status(200).json({ success: true, message: 'Entrada eliminada.' });
    } catch (error) { 
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar la entrada.' }); 
    }
});

// --- ENDPOINT PARA GENERAR RESPUESTA MANUAL CON IA ---
app.post('/api/contacts/:contactId/generate-reply', async (req, res) => {
    const { contactId } = req.params;
    try {
        const messagesSnapshot = await db.collection('contacts_whatsapp').doc(contactId).collection('messages').orderBy('timestamp', 'desc').limit(10).get();
        if (messagesSnapshot.empty) return res.status(400).json({ success: false, message: 'No hay mensajes en esta conversación.' });
        
        const conversationHistory = messagesSnapshot.docs.map(doc => { const d = doc.data(); return `${d.from === contactId ? 'Cliente' : 'Asistente'}: ${d.text}`; }).reverse().join('\n');
        const prompt = `Eres un asistente de ventas para un CRM. Responde al último mensaje del cliente de manera concisa y profesional.\n\n--- Historial ---\n${conversationHistory}\n\n--- Tu Respuesta ---\nAsistente:`;
        
        const suggestion = await generateGeminiResponse(prompt);
        res.status(200).json({ success: true, message: 'Respuesta generada.', suggestion });
    } catch (error) {
        console.error('Error al generar respuesta con IA:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al generar la respuesta.' });
    }
});

// --- RUTA PARA SERVIR LA APLICACIÓN FRONTEND ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
