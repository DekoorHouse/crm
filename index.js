// index.js - VERSIÓN CON GESTIÓN DE MENSAJES DE ANUNCIOS, MULTIMEDIA Y BOT AUTOMÁTICO

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

// --- CONFIGURACIÓN DE FIREBASE ---
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: 'pedidos-con-gemini.firebasestorage.app'
    });
    console.log('✅ Conexión con Firebase (Firestore y Storage) establecida.');
} catch (error) {
    console.error('❌ ERROR CRÍTICO: No se pudo inicializar Firebase. Revisa la variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON.', error.message);
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); 
const bucket = getStorage().bucket();

// --- CONFIGURACIÓN DEL SERVIDOR EXPRESS ---
const app = express();

// --- INICIO: CORRECCIÓN DE CORS ---
// Configura CORS para permitir solicitudes desde tu dominio de Render y para desarrollo local.
const whitelist = ['https://crm-rzon.onrender.com', 'http://localhost:3000'];
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
// --- FIN: CORRECCIÓN DE CORS ---

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


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
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: SHEETS_SCOPES,
        });
        const client = await auth.getClient();
        console.log('✅ Autenticación con Google Sheets exitosa.');
        return google.sheets({ version: 'v4', auth: client });
    } catch (error) {
        console.error("❌ Error al autenticar con Google Sheets. Revisa la variable de entorno 'GOOGLE_SHEETS_CREDENTIALS_JSON'.", error.message);
        return null;
    }
}

// --- FUNCIÓN PARA VERIFICAR COBERTURA ---
async function checkCoverage(postalCode) {
    if (!postalCode) return null;
    console.log(`[LOG] Iniciando verificación de cobertura para CP: ${postalCode}`);

    const sheets = await getGoogleSheetsClient();
    if (!sheets) return "No se pudo verificar la cobertura en este momento.";

    try {
        const settingsDoc = await db.collection('crm_settings').doc('general').get();
        const sheetId = settingsDoc.exists ? settingsDoc.data().googleSheetId : null;

        if (!sheetId) {
            console.warn("[LOG] Advertencia: No se ha configurado un ID de Google Sheet en los ajustes.");
            return "La herramienta de cobertura no está configurada.";
        }
        console.log(`[LOG] Usando Google Sheet ID: ${sheetId}`);

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: 'M:M',
        });
        console.log('[LOG] Respuesta de Google Sheets API recibida.');

        const rows = response.data.values;
        if (rows && rows.length) {
            const coverageZips = rows.flat();
            if (coverageZips.includes(postalCode.toString())) {
                console.log(`[LOG] Cobertura ENCONTRADA para ${postalCode}.`);
                return `✅ ¡Buenas noticias! Sí tenemos cobertura en el código postal ${postalCode}.`;
            } else {
                console.log(`[LOG] Cobertura NO encontrada para ${postalCode}.`);
                return `❌ Lo sentimos, por el momento no tenemos cobertura en el código postal ${postalCode}.`;
            }
        }
        console.log(`[LOG] No se encontraron datos en la hoja para el CP ${postalCode}.`);
        return `No se encontraron datos de cobertura para verificar el código postal ${postalCode}.`;
    } catch (error) {
        console.error(`❌ [LOG] Error al leer la hoja de Google Sheets. DETALLE:`, error.message);
        if (error.code === 404) {
             return "Error: No se encontró la hoja de cálculo. Verifica el ID en los ajustes.";
        }
        if (error.code === 403) {
            return "Error de permisos. Asegúrate de haber compartido la hoja con el correo de servicio y de haber habilitado la API de Google Sheets.";
        }
        return "Hubo un problema al verificar la cobertura. Por favor, inténtalo más tarde.";
    }
}

// --- HELPER FUNCTION FOR GEMINI ---
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
        // 1. Verificar si el bot debe actuar
        const contactDoc = await contactRef.get();
        const contactData = contactDoc.data();
        const generalSettingsDoc = await db.collection('crm_settings').doc('general').get();
        const globalBotActive = generalSettingsDoc.exists && generalSettingsDoc.data().globalBotActive === true;

        if (!globalBotActive) {
            console.log(`[AI] Bot global desactivado. No se enviará respuesta.`);
            return;
        }
        if (contactData.botActive === false) {
            console.log(`[AI] Bot desactivado para el contacto ${contactId}. No se enviará respuesta.`);
            return;
        }

        // 2. Lógica especial para Códigos Postales
        if (message.type === 'text') {
            const postalCodeRegex = /(?:cp|código postal|codigo postal)\s*:?\s*(\d{5})/i;
            const match = message.text.body.match(postalCodeRegex);
            if (match && match[1]) {
                const postalCode = match[1];
                console.log(`[AI] Código postal detectado: ${postalCode}. Verificando cobertura.`);
                const coverageResponse = await checkCoverage(postalCode);
                if (coverageResponse) {
                    const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text: coverageResponse });
                    await contactRef.collection('messages').add({
                        from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        id: sentMessageData.id, text: sentMessageData.textForDb, isAutoReply: true
                    });
                    await contactRef.update({ lastMessage: sentMessageData.textForDb, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() });
                    console.log(`[AI] Respuesta de cobertura enviada a ${contactId}.`);
                    return; // Termina el proceso aquí
                }
            }
        }

        // 3. Preparar el prompt para Gemini
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
            **Instrucciones Generales:**
            ${botInstructions}

            **Base de Conocimiento (Usa esta información para responder preguntas frecuentes):**
            ${knowledgeBase || 'No hay información adicional.'}

            **Historial de la Conversación Reciente:**
            ${conversationHistory}

            **Tarea:**
            Basado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.
        `;
        
        console.log(`[AI] Generando respuesta para ${contactId}.`);
        const aiResponse = await generateGeminiResponse(prompt);

        // 4. Enviar respuesta y guardar en la base de datos
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


// --- CONFIGURACIÓN DE HORARIO DE ATENCIÓN Y MENSAJE DE AUSENCIA ---
const BUSINESS_HOURS = { 1: [7, 19], 2: [7, 19], 3: [7, 19], 4: [7, 19], 5: [7, 19], 6: [7, 14] };
const TIMEZONE = 'America/Mexico_City';
const AWAY_MESSAGE = `📩 ¡Hola! Gracias por tu mensaje.\n\n🕑 Nuestro horario de atención es:\n\n🗓 Lunes a Viernes: 7:00 am - 7:00 pm\n\n🗓 Sábado: 7:00 am - 2:00 pm\nTe responderemos tan pronto como regresemos.\n\n🙏 ¡Gracias por tu paciencia!`;
const GENERAL_WELCOME_MESSAGE = '¡Hola! 👋 Gracias por comunicarte. ¿Cómo podemos ayudarte hoy? 😊';

function isWithinBusinessHours() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const day = now.getDay();
    const hour = now.getHours();
    const hoursToday = BUSINESS_HOURS[day];
    if (!hoursToday) return false;
    const [startHour, endHour] = hoursToday;
    return hour >= startHour && hour < endHour;
}

function sha256(data) {
    if (!data) return null;
    return crypto.createHash('sha256').update(data.toString().toLowerCase().replace(/\s/g, '')).digest('hex');
}

// --- INICIO: CORRECCIÓN DE BUG CRÍTICO (FUNCIÓN FALTANTE) ---
async function sendConversionEvent(eventName, contactInfo, referral, customData = {}) {
    if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
        console.log('[CAPI] Pixel ID or Access Token not configured. Skipping event.');
        return;
    }

    const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events`;
    const event_time = Math.floor(new Date().getTime() / 1000);
    const event_id = `${eventName}_${contactInfo.wa_id}_${event_time}`;

    const userData = {
        "ph": [sha256(contactInfo.wa_id)],
        "fn": [sha256(contactInfo.profile.name.split(' ')[0])], // First name
        "ln": [sha256(contactInfo.profile.name.split(' ').slice(1).join(' '))] // Last name
    };

    const eventData = {
        "event_name": eventName,
        "event_time": event_time,
        "event_id": event_id,
        "user_data": userData,
        "action_source": "whatsapp",
        "custom_data": customData
    };
    
    if (referral && referral.source_type === 'ad') {
        eventData.data_processing_options = [];
        eventData.data_processing_options_country = 0;
        eventData.data_processing_options_state = 0;
    }

    const payload = {
        "data": [eventData],
        "access_token": META_CAPI_ACCESS_TOKEN
    };

    try {
        console.log(`[CAPI] Sending event '${eventName}' for ${contactInfo.wa_id}`);
        const response = await axios.post(url, payload);
        console.log('[CAPI] Event sent successfully:', response.data);
    } catch (error) {
        console.error('[CAPI] Error sending conversion event:', error.response ? JSON.stringify(error.response.data) : error.message);
    }
}
// --- FIN: CORRECCIÓN DE BUG CRÍTICO ---

// --- FUNCIÓN DE ENVÍO AVANZADO MODIFICADA ---
async function sendAdvancedWhatsAppMessage(to, { text, fileUrl, fileType }) {
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let messagePayload;
    let messageToSaveText;

    if (fileUrl && fileType) { // Mensaje multimedia (puede tener subtítulo o no)
        const type = fileType.startsWith('image/') ? 'image' : 
                     fileType.startsWith('video/') ? 'video' : 
                     fileType.startsWith('audio/') ? 'audio' : 'document';
        
        const mediaObject = { link: fileUrl };
        if (text) { // Usamos el 'text' como subtítulo
            mediaObject.caption = text;
        }
        
        messagePayload = { messaging_product: 'whatsapp', to, type, [type]: mediaObject };
        
        // El texto para la BD es el subtítulo, o el placeholder si no hay subtítulo.
        messageToSaveText = text || (type === 'image' ? '📷 Imagen' : 
                                     type === 'video' ? '🎥 Video' :
                                     type === 'audio' ? '🎵 Audio' : '📄 Documento');

    } else if (text) { // Mensaje de solo texto
        messagePayload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
        messageToSaveText = text;
    } else {
        throw new Error("Se requiere texto o un archivo (fileUrl y fileType) para enviar un mensaje.");
    }

    try {
        console.log(`[LOG] Intentando enviar mensaje a ${to} con payload:`, JSON.stringify(messagePayload));
        const response = await axios.post(url, messagePayload, { headers });
        console.log(`[LOG] Mensaje enviado a la API de WhatsApp con éxito para ${to}.`);
        const messageId = response.data.messages[0].id;
        
        return {
            id: messageId,
            textForDb: messageToSaveText,
            fileUrlForDb: fileUrl || null,
            fileTypeForDb: fileType || null
        };
    } catch (error) {
        console.error(`❌ Error al enviar mensaje avanzado de WhatsApp a ${to}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}


// --- WEBHOOK DE WHATSAPP ---
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

// --- INICIO DE LA CORRECCIÓN ---
async function getMediaUrl(mediaId) {
    if (!mediaId) return null;
    try {
        const url = `https://graph.facebook.com/v19.0/${mediaId}`;
        const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` };
        const response = await axios.get(url, { headers });
        return response.data.url; // Devuelve la URL temporal del archivo
    } catch (error) {
        console.error(`❌ Error al obtener la URL del medio ${mediaId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
        return null;
    }
}

app.post('/webhook', async (req, res) => {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (value && value.messages && value.contacts) {
        const message = value.messages[0];
        console.log('[DEBUG] Objeto de mensaje completo recibido de Meta:', JSON.stringify(message, null, 2));
        const contactInfo = value.contacts[0];
        const from = message.from;
        const contactRef = db.collection('contacts_whatsapp').doc(from);
        
        if (message.from === PHONE_NUMBER_ID) {
            console.log("[LOG] Mensaje saliente ignorado.");
            return res.sendStatus(200);
        }

        const contactDoc = await contactRef.get();
        const isNewContact = !contactDoc.exists;

        // 1. Crear el objeto base del mensaje
        let messageData = { 
            timestamp: admin.firestore.FieldValue.serverTimestamp(), 
            from, 
            status: 'received', 
            id: message.id,
            type: message.type,
        };

        // 2. Procesar el contenido del mensaje
        if (message.type === 'text') {
            messageData.text = message.text.body;
        } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(message.type)) {
            const mediaObject = message[message.type];
            const mediaUrl = await getMediaUrl(mediaObject.id);
            
            if (mediaUrl) {
                const tempUrlResponse = await axios.get(mediaUrl, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
                messageData.fileUrl = tempUrlResponse.data.url;
                messageData.fileType = mediaObject.mime_type;
            }
            
            messageData.text = mediaObject.caption || `Mensaje multimedia (${message.type})`;
        } else {
            messageData.text = `Tipo de mensaje no soportado: ${message.type}`;
        }
        
        // 3. Guardar el mensaje y actualizar el contacto
        await contactRef.collection('messages').add(messageData);
        
        let contactUpdateData = {
            name: contactInfo.profile.name,
            wa_id: contactInfo.wa_id,
            lastMessage: messageData.text,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            unreadCount: admin.firestore.FieldValue.increment(1)
        };
        if (message.referral) {
            contactUpdateData.adReferral = message.referral;
        }
        await contactRef.set(contactUpdateData, { merge: true });
        console.log(`[LOG] Mensaje de ${from} guardado.`);

        // 4. Lógica de Respuesta Automática (Bienvenida o IA)
        if (isNewContact) {
            let adResponseSent = false;
            if (message.referral && message.referral.source_type === 'ad' && message.referral.source_id) {
                const adId = message.referral.source_id;
                console.log(`[LOG] Mensaje de nuevo contacto con referencia de anuncio. Ad ID: ${adId}`);
                const adResponsesRef = db.collection('ad_responses');
                const snapshot = await adResponsesRef.where('adId', '==', adId).limit(1).get();

                if (!snapshot.empty) {
                    const adResponseData = snapshot.docs[0].data();
                    try {
                        const sentMessageData = await sendAdvancedWhatsAppMessage(from, {
                            text: adResponseData.message,
                            fileUrl: adResponseData.fileUrl,
                            fileType: adResponseData.fileType
                        });
                        await contactRef.collection('messages').add({
                            from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                            id: sentMessageData.id, text: sentMessageData.textForDb,
                            fileUrl: sentMessageData.fileUrlForDb, fileType: sentMessageData.fileTypeForDb
                        });
                        await contactRef.update({ lastMessage: sentMessageData.textForDb, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() });
                        adResponseSent = true;
                    } catch (error) {
                        console.error(`❌ Fallo al enviar mensaje de anuncio a ${from}.`, error.message);
                    }
                } else {
                    console.log(`[LOG] No se encontró respuesta para Ad ID: ${adId}.`);
                }
            }
            if (!adResponseSent) {
                try {
                    const sentMessageData = await sendAdvancedWhatsAppMessage(from, { text: GENERAL_WELCOME_MESSAGE });
                    await contactRef.collection('messages').add({
                        from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        id: sentMessageData.id, text: sentMessageData.textForDb
                    });
                    await contactRef.update({ lastMessage: sentMessageData.textForDb, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() });
                } catch (error) {
                    console.error(`❌ Fallo al enviar mensaje de bienvenida a ${from}.`, error.message);
                }
            }
        } else {
            await triggerAutoReplyAI(message, contactRef);
        }
    } else if (value && value.statuses) {
        const statusUpdate = value.statuses[0];
        const messageId = statusUpdate.id;
        const recipientId = statusUpdate.recipient_id;
        const newStatus = statusUpdate.status;

        try {
            const messagesRef = db.collection('contacts_whatsapp').doc(recipientId).collection('messages');
            const querySnapshot = await messagesRef.where('id', '==', messageId).limit(1).get();
            
            if (!querySnapshot.empty) {
                const messageDoc = querySnapshot.docs[0];
                const currentStatus = messageDoc.data().status;
                const statusOrder = { sent: 1, delivered: 2, read: 3 };
                if ((statusOrder[newStatus] || 0) > (statusOrder[currentStatus] || 0)) {
                    await messageDoc.ref.update({ status: newStatus });
                    console.log(`[LOG] Estado del mensaje ${messageId} actualizado a '${newStatus}' para ${recipientId}.`);
                }
            }
        } catch (error) {
            console.error(`❌ Error al actualizar estado del mensaje ${messageId}:`, error.message);
        }
    }
    
    res.sendStatus(200);
});
// --- FIN DE LA CORRECCIÓN ---


// --- HELPER FUNCTION TO BUILD TEMPLATE PAYLOAD AND TEXT ---
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
        const contactName = contactDoc.exists && contactDoc.data().name ? contactDoc.data().name : 'Cliente';
        payload.template.components.push({ type: 'body', parameters: [{ type: 'text', text: contactName }] });
        messageToSaveText = bodyComponent.text.replace('{{1}}', contactName);
    } else if (bodyComponent?.text) {
        messageToSaveText = bodyComponent.text;
    }
    
    if (payload.template.components.length === 0) delete payload.template.components;
    return { payload, messageToSaveText };
}

// --- ENDPOINT PARA ENVIAR MENSAJES MODIFICADO ---
app.post('/api/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid, template } = req.body;

    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
    if (!text && !fileUrl && !template) return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);

        if (template) {
            const { payload, messageToSaveText } = await buildTemplatePayload(contactId, template);
            if (reply_to_wamid) payload.context = { message_id: reply_to_wamid };

            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, { 
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } 
            });
            const messageId = response.data.messages[0].id;
            
            const messageToSave = { from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(), id: messageId, text: messageToSaveText };
            await contactRef.collection('messages').add(messageToSave);
            await contactRef.update({ lastMessage: messageToSaveText, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), unreadCount: 0 });

        } else {
            // Lógica unificada para mensajes manuales y respuestas rápidas
            // 'text' puede ser un mensaje de texto o el subtítulo de un archivo.
            const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text, fileUrl, fileType });
    
            const messageToSave = {
                from: PHONE_NUMBER_ID, 
                status: 'sent', 
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: sentMessageData.id, 
                text: sentMessageData.textForDb,
                fileUrl: sentMessageData.fileUrlForDb, 
                fileType: sentMessageData.fileTypeForDb
            };
        
            if (reply_to_wamid) messageToSave.context = { message_id: reply_to_wamid };
            Object.keys(messageToSave).forEach(key => messageToSave[key] == null && delete messageToSave[key]);
            
            await contactRef.collection('messages').add(messageToSave);
            await contactRef.update({ 
                lastMessage: sentMessageData.textForDb, 
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), 
                unreadCount: 0 
            });
        }

        res.status(200).json({ success: true, message: 'Mensaje(s) enviado(s).' });

    } catch (error) {
        console.error('Error al enviar mensaje vía WhatsApp API:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al enviar el mensaje a través de WhatsApp.' });
    }
});


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
    // MODIFIED: Accept 'order' field
    const { label, color, key, order } = req.body;
    if (!label || !color || !key || order === undefined) return res.status(400).json({ success: false, message: 'Faltan datos.' });
    try {
        await db.collection('crm_tags').add({ label, color, key, order });
        res.status(201).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al crear la etiqueta.' }); }
});

// --- FIX: Reordered the routes. The specific route must come before the general one. ---
// --- NEW ENDPOINT TO HANDLE TAG REORDERING ---
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
        // Note: We don't update 'order' here, it's handled by a separate endpoint
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

app.delete('/api/tags', async (req, res) => {
    try {
        const snapshot = await db.collection('crm_tags').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al eliminar todas las etiquetas.' }); }
});

// --- ENDPOINTS PARA RESPUESTAS DE ANUNCIOS (CON SOPORTE MULTIMEDIA) ---
app.post('/api/ad-responses', async (req, res) => {
    const { adName, adId, message, fileUrl, fileType } = req.body;
    if (!adName || !adId || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'Nombre del anuncio, ID del anuncio y un mensaje de texto o archivo multimedia son obligatorios.' });
    }
    if (fileUrl && !fileType) {
        return res.status(400).json({ success: false, message: 'Si se incluye un archivo multimedia, se debe especificar su tipo (fileType).' });
    }

    try {
        const existing = await db.collection('ad_responses').where('adId', '==', adId).limit(1).get();
        if (!existing.empty) {
            return res.status(409).json({ success: false, message: `El ID de anuncio '${adId}' ya tiene un mensaje configurado.` });
        }
        
        const responseData = {
            adName,
            adId,
            message: message || null,
            fileUrl: fileUrl || null,
            fileType: fileType || null
        };

        const newResponse = await db.collection('ad_responses').add(responseData);
        res.status(201).json({ success: true, id: newResponse.id, data: responseData });
    } catch (error) {
        console.error("Error creating ad response:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al crear el mensaje.' });
    }
});

app.put('/api/ad-responses/:id', async (req, res) => {
    const { id } = req.params;
    const { adName, adId, message, fileUrl, fileType } = req.body;
    if (!adName || !adId || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'Nombre del anuncio, ID del anuncio y un mensaje de texto o archivo multimedia son obligatorios.' });
    }
    if (fileUrl && !fileType) {
        return res.status(400).json({ success: false, message: 'Si se incluye un archivo multimedia, se debe especificar su tipo (fileType).' });
    }
    try {
        const existing = await db.collection('ad_responses').where('adId', '==', adId).limit(1).get();
        if (!existing.empty && existing.docs[0].id !== id) {
            return res.status(409).json({ success: false, message: `El ID de anuncio '${adId}' ya está en uso.` });
        }
        
        const updateData = {
            adName,
            adId,
            message: message || null,
            fileUrl: fileUrl || null,
            fileType: fileType || null
        };

        await db.collection('ad_responses').doc(id).update(updateData);
        res.status(200).json({ success: true, message: 'Mensaje de anuncio actualizado.' });
    } catch (error) {
        console.error("Error updating ad response:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar.' });
    }
});


app.delete('/api/ad-responses/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('ad_responses').doc(id).delete();
        res.status(200).json({ success: true, message: 'Mensaje de anuncio eliminado.' });
    } catch (error) {
        console.error("Error deleting ad response:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar.' });
    }
});

// --- START: BOT & SETTINGS ENDPOINTS ---
app.get('/api/bot/settings', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('bot').get();
        if (!doc.exists) {
            return res.status(200).json({ success: true, settings: { instructions: '' } });
        }
        res.status(200).json({ success: true, settings: doc.data() });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener la configuración del bot.' });
    }
});

app.post('/api/bot/settings', async (req, res) => {
    const { instructions } = req.body;
    try {
        await db.collection('crm_settings').doc('bot').set({ instructions });
        res.status(200).json({ success: true, message: 'Configuración del bot guardada.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar la configuración del bot.' });
    }
});

app.post('/api/bot/toggle', async (req, res) => {
    const { contactId, isActive } = req.body;
    try {
        await db.collection('contacts_whatsapp').doc(contactId).update({ botActive: isActive });
        res.status(200).json({ success: true, message: `Bot ${isActive ? 'activado' : 'desactivado'} para ${contactId}.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al actualizar el estado del bot.' });
    }
});

// --- START: NEW GENERAL SETTINGS ENDPOINTS ---
app.get('/api/settings/away-message', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        if (!doc.exists) {
            return res.status(200).json({ success: true, settings: { isActive: true } }); // Default to active
        }
        res.status(200).json({ success: true, settings: { isActive: doc.data().awayMessageActive } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener la configuración del mensaje de ausencia.' });
    }
});

app.post('/api/settings/away-message', async (req, res) => {
    const { isActive } = req.body;
    try {
        await db.collection('crm_settings').doc('general').set({ awayMessageActive: isActive }, { merge: true });
        res.status(200).json({ success: true, message: 'Configuración del mensaje de ausencia guardada.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar la configuración.' });
    }
});

app.get('/api/settings/global-bot', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        if (!doc.exists) {
            return res.status(200).json({ success: true, settings: { isActive: false } }); // Default to inactive
        }
        res.status(200).json({ success: true, settings: { isActive: doc.data().globalBotActive } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener la configuración del bot global.' });
    }
});

app.post('/api/settings/global-bot', async (req, res) => {
    const { isActive } = req.body;
    try {
        await db.collection('crm_settings').doc('general').set({ globalBotActive: isActive }, { merge: true });
        res.status(200).json({ success: true, message: 'Configuración del bot global guardada.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar el ajuste del bot global.' });
    }
});

// --- AÑADIDO: ENDPOINT PARA GUARDAR GOOGLE SHEET ID ---
app.get('/api/settings/google-sheet', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        if (!doc.exists || !doc.data().googleSheetId) {
            return res.status(200).json({ success: true, settings: { googleSheetId: '' } });
        }
        res.status(200).json({ success: true, settings: { googleSheetId: doc.data().googleSheetId } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener la configuración de Google Sheet.' });
    }
});

app.post('/api/settings/google-sheet', async (req, res) => {
    const { googleSheetId } = req.body;
    try {
        await db.collection('crm_settings').doc('general').set({ googleSheetId }, { merge: true });
        res.status(200).json({ success: true, message: 'ID de Google Sheet guardado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar la configuración de Google Sheet.' });
    }
});
// --- END: NEW GENERAL SETTINGS ENDPOINTS ---

// --- END: BOT & SETTINGS ENDPOINTS ---

// --- START: KNOWLEDGE BASE ENDPOINTS (CORRECCIÓN) ---
app.post('/api/knowledge-base', async (req, res) => {
    const { topic, answer, fileUrl, fileType } = req.body;
    if (!topic || !answer) {
        return res.status(400).json({ success: false, message: 'El tema y la respuesta son obligatorios.' });
    }
    try {
        const entryData = { 
            topic, 
            answer,
            fileUrl: fileUrl || null,
            fileType: fileType || null 
        };
        const newEntry = await db.collection('ai_knowledge_base').add(entryData);
        res.status(201).json({ success: true, id: newEntry.id, data: entryData });
    } catch (error) { 
        console.error("Error creating knowledge base entry:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al crear la entrada.' }); 
    }
});

app.put('/api/knowledge-base/:id', async (req, res) => {
    const { id } = req.params;
    const { topic, answer, fileUrl, fileType } = req.body;
    if (!topic || !answer) {
        return res.status(400).json({ success: false, message: 'El tema y la respuesta son obligatorios.' });
    }
    try {
        const updateData = {
            topic,
            answer,
            fileUrl: fileUrl || null,
            fileType: fileType || null
        };
        await db.collection('ai_knowledge_base').doc(id).update(updateData);
        res.status(200).json({ success: true, message: 'Entrada actualizada.' });
    } catch (error) { 
        console.error("Error updating knowledge base entry:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar la entrada.' }); 
    }
});

app.delete('/api/knowledge-base/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('ai_knowledge_base').doc(id).delete();
        res.status(200).json({ success: true, message: 'Entrada eliminada.' });
    } catch (error) { 
        console.error("Error deleting knowledge base entry:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar la entrada.' }); 
    }
});
// --- END: KNOWLEDGE BASE ENDPOINTS ---

// --- ENDPOINT PARA BOT DE IA (MANUAL) ---
app.post('/api/contacts/:contactId/generate-reply', async (req, res) => {
    const { contactId } = req.params;
    try {
        const messagesSnapshot = await db.collection('contacts_whatsapp').doc(contactId).collection('messages').orderBy('timestamp', 'desc').limit(10).get();
        if (messagesSnapshot.empty) return res.status(400).json({ success: false, message: 'No hay mensajes en esta conversación.' });
        
        const conversationHistory = messagesSnapshot.docs.map(doc => { const d = doc.data(); return `${d.from === contactId ? 'Cliente' : 'Asistente'}: ${d.text}`; }).reverse().join('\\n');
        const prompt = `Eres un asistente virtual amigable y servicial para un CRM de ventas. Tu objetivo es ayudar a cerrar ventas y resolver dudas de los clientes. A continuación se presenta el historial de una conversación. Responde al último mensaje del cliente de manera concisa, profesional y útil.\\n\\n--- Historial ---\\\\n${conversationHistory}\\n\\n--- Tu Respuesta ---\\\\nAsistente:`;
        
        const suggestion = await generateGeminiResponse(prompt);
        res.status(200).json({ success: true, message: 'Respuesta generada.', suggestion });
    } catch (error) {
        console.error('Error al generar respuesta con IA:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al generar la respuesta.' });
    }
});


// --- AÑADIDO: Ruta para servir la aplicación frontend ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
