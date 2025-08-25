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
// Lee las credenciales desde una variable de entorno en lugar de un archivo JSON
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'pedidos-con-gemini.firebasestorage.app'
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); 

const bucket = getStorage().bucket();
console.log('Conexión con Firebase (Firestore y Storage) establecida.');

// --- CONFIGURACIÓN DEL SERVIDOR EXPRESS ---
const app = express();
app.use(cors());
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
        // Lee las credenciales desde una variable de entorno
        const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS_JSON);
        
        const auth = new google.auth.GoogleAuth({
            credentials, // Usa el objeto de credenciales directamente
            scopes: SHEETS_SCOPES,
        });
        const client = await auth.getClient();
        return google.sheets({ version: 'v4', auth: client });
    } catch (error) {
        console.error("❌ Error al autenticar con Google Sheets. Asegúrate de que la variable de entorno 'GOOGLE_SHEETS_CREDENTIALS_JSON' esté configurada correctamente.", error.message);
        return null;
    }
}

// --- FUNCIÓN PARA VERIFICAR COBERTURA ---
async function checkCoverage(postalCode) {
    if (!postalCode) return null;

    const sheets = await getGoogleSheetsClient();
    if (!sheets) return "No se pudo verificar la cobertura en este momento.";

    try {
        const settingsDoc = await db.collection('crm_settings').doc('general').get();
        const sheetId = settingsDoc.exists ? settingsDoc.data().googleSheetId : null;

        if (!sheetId) {
            console.warn("Advertencia: No se ha configurado un ID de Google Sheet en los ajustes.");
            return "La herramienta de cobertura no está configurada.";
        }

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            // --- CAMBIO REALIZADO AQUÍ ---
            range: 'M:M', // Lee los códigos postales de la columna M
        });

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
        console.error(`❌ Error al leer la hoja de Google Sheets (ID: ${sheetId})`, error.message);
        if (error.code === 404) {
             return "Error: No se encontró la hoja de cálculo. Verifica el ID en los ajustes.";
        }
        return "Hubo un problema al verificar la cobertura. Por favor, inténtalo más tarde.";
    }
}


// --- CONFIGURACIÓN DE HORARIO DE ATENCIÓN Y MENSAJE DE AUSENCIA ---
const BUSINESS_HOURS = {
    1: [7, 19], // Lunes
    2: [7, 19], // Martes
    3: [7, 19], // Miércoles
    4: [7, 19], // Jueves
    5: [7, 19], // Viernes
    6: [7, 14], // Sábado
};
const TIMEZONE = 'America/Mexico_City';
const AWAY_MESSAGE = `📩 ¡Hola! Gracias por tu mensaje.

🕑 Nuestro horario de atención es:

🗓 Lunes a Viernes: 7:00 am - 7:00 pm

🗓 Sábado: 7:00 am - 2:00 pm
Te responderemos tan pronto como regresemos.

🙏 ¡Gracias por tu paciencia!`;

// --- CONFIGURACIÓN DE MENSAJES DE BIENVENida ---
const GENERAL_WELCOME_MESSAGE = '¡Hola! 👋 Gracias por comunicarte. ¿Cómo podemos ayudarte hoy? 😊';


// --- FUNCIÓN PARA VERIFICAR HORARIO DE ATENCIÓN ---
function isWithinBusinessHours() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const day = now.getDay();
    const hour = now.getHours();
    const hoursToday = BUSINESS_HOURS[day];
    if (!hoursToday) return false;
    const [startHour, endHour] = hoursToday;
    return hour >= startHour && hour < endHour;
}

// --- FUNCIÓN PARA HASHEAR DATOS ---
function sha256(data) {
    if (!data) return null;
    const normalizedData = typeof data === 'string' ? data.toLowerCase().replace(/\s/g, '') : data.toString();
    return crypto.createHash('sha256').update(normalizedData).digest('hex');
}

// --- FUNCIÓN GENÉRICA PARA ENVIAR EVENTOS DE CONVERSIÓN ---
const sendConversionEvent = async (eventName, contactInfo, referralInfo, customData = {}) => {
    if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
        console.warn('Advertencia: Faltan credenciales de Meta (PIXEL_ID o CAPI_ACCESS_TOKEN). No se enviará el evento.');
        return;
    }
    if (!contactInfo || !contactInfo.wa_id) {
        console.error(`❌ Error Crítico: No se puede enviar el evento '${eventName}' porque falta el 'wa_id' del contacto.`);
        throw new Error(`No se pudo enviar el evento '${eventName}' a Meta: falta el ID de WhatsApp del contacto.`);
    }

    const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events`;
    const eventTime = Math.floor(Date.now() / 1000);
    const eventId = `${eventName}_${contactInfo.wa_id}_${eventTime}`;
    
    const userData = { ph: [] };
    try {
        userData.ph.push(sha256(contactInfo.wa_id));
        if (contactInfo.profile?.name) {
            userData.fn = sha256(contactInfo.profile.name);
        }
    } catch (hashError) {
        console.error(`❌ Error al hashear los datos del usuario para el evento '${eventName}':`, hashError);
        throw new Error(`Falló la preparación de datos para el evento '${eventName}'.`);
    }

    if (WHATSAPP_BUSINESS_ACCOUNT_ID) {
        userData.whatsapp_business_account_id = WHATSAPP_BUSINESS_ACCOUNT_ID;
    }

    const isAdReferral = referralInfo && referralInfo.ctwa_clid;

    if (isAdReferral) {
        userData.ctwa_clid = referralInfo.ctwa_clid;
    }

    const finalCustomData = {
        lead_source: isAdReferral ? 'WhatsApp Ad' : 'WhatsApp Organic',
        ad_headline: isAdReferral ? referralInfo.headline : undefined,
        ad_id: isAdReferral ? referralInfo.source_id : undefined,
        ...customData
    };

    Object.keys(finalCustomData).forEach(key => finalCustomData[key] === undefined && delete finalCustomData[key]);

    const payload = {
        data: [{
            event_name: eventName,
            event_time: eventTime,
            event_id: eventId,
            action_source: 'business_messaging',
            messaging_channel: 'whatsapp', 
            user_data: userData,
            custom_data: finalCustomData,
        }],
    };

    try {
        console.log(`Enviando evento '${eventName}' para ${contactInfo.wa_id}. Payload:`, JSON.stringify(payload, null, 2));
        await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${META_CAPI_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } });
        console.log(`✅ Evento '${eventName}' enviado a Meta.`);
    } catch (error) {
        console.error(`❌ Error al enviar evento '${eventName}' a Meta.`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw new Error(`Falló el envío del evento '${eventName}' a Meta.`);
    }
};


// --- NUEVO: FUNCIÓN AVANZADA PARA ENVIAR MENSAJES DE WHATSAPP (TEXTO Y MULTIMEDIA) ---
async function sendAdvancedWhatsAppMessage(to, { text, fileUrl, fileType }) {
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let messagePayload;
    let messageToSaveText;

    if (text) {
        messagePayload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
        messageToSaveText = text;
    } else if (fileUrl && fileType) {
        const type = fileType.startsWith('image/') ? 'image' : 
                     fileType.startsWith('video/') ? 'video' : 
                     fileType.startsWith('audio/') ? 'audio' : 'document';
        
        messagePayload = { messaging_product: 'whatsapp', to, type, [type]: { link: fileUrl } };
        
        if (type === 'image') messageToSaveText = '📷 Imagen';
        else if (type === 'video') messageToSaveText = '🎥 Video';
        else if (type === 'audio') messageToSaveText = '🎵 Audio';
        else messageToSaveText = '📄 Documento';

    } else {
        throw new Error("Se requiere texto o un archivo (fileUrl y fileType) para enviar un mensaje.");
    }

    try {
        const response = await axios.post(url, messagePayload, { headers });
        const messageId = response.data.messages[0].id;
        
        // Devuelve los datos necesarios para guardar el mensaje en Firestore
        return {
            id: messageId,
            textForDb: messageToSaveText,
            fileUrlForDb: fileUrl || null,
            fileTypeForDb: fileType || null
        };
    } catch (error) {
        console.error(`Error al enviar mensaje avanzado de WhatsApp a ${to}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}


// --- FUNCIÓN PARA DESCARGAR Y SUBIR IMÁGENES ---
async function downloadAndUploadImage(mediaId, from) {
    try {
        const mediaUrlResponse = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
        });
        const mediaUrl = mediaUrlResponse.data.url;
        const mimeType = mediaUrlResponse.data.mime_type;
        const fileExtension = mimeType.split('/')[1] || 'jpg';

        const imageResponse = await axios.get(mediaUrl, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
            responseType: 'arraybuffer'
        });
        const imageBuffer = Buffer.from(imageResponse.data, 'binary');

        const fileName = `whatsapp_media/${from}/${mediaId}.${fileExtension}`;
        const file = bucket.file(fileName);
        await file.save(imageBuffer, {
            metadata: { contentType: mimeType }
        });

        await file.makePublic();
        const publicUrl = file.publicUrl();
        
        console.log(`Imagen ${mediaId} subida y disponible en: ${publicUrl}`);
        return { publicUrl, mimeType };

    } catch (error) {
        console.error(`❌ Error al procesar la imagen ${mediaId}:`, error.response ? error.response.data : error.message);
        return null;
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

app.post('/webhook', async (req, res) => {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (value) {
        if (value.messages) {
            const message = value.messages[0];
            const contactInfo = value.contacts[0];
            const from = message.from;
            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            const contactRef = db.collection('contacts_whatsapp').doc(from);
            
            const contactDoc = await contactRef.get();
            const isNewContact = !contactDoc.exists;
            const contactData = contactDoc.exists ? contactDoc.data() : {};
            
            // --- START: SAVE INCOMING MESSAGE FIRST ---
            let messageData = { timestamp, from, status: 'received', id: message.id };
            let lastMessageText = '';
            
            try {
                if (message.context) messageData.context = { id: message.context.id };
                switch (message.type) {
                    case 'text':
                        messageData.text = message.text.body;
                        lastMessageText = message.text.body;
                        break;
                    case 'image':
                        lastMessageText = '📷 Imagen';
                        messageData.text = lastMessageText;
                        const imageData = await downloadAndUploadImage(message.image.id, from);
                        if (imageData) {
                            messageData.fileUrl = imageData.publicUrl;
                            messageData.fileType = imageData.mimeType;
                        }
                        break;
                    case 'video':
                        lastMessageText = '🎥 Video';
                        messageData.text = lastMessageText;
                        break;
                    default:
                        lastMessageText = `Mensaje no soportado: ${message.type}`;
                        messageData.text = lastMessageText;
                        break;
                }
            } catch (error) { console.error("Error procesando contenido del mensaje:", error.message); }

            await contactRef.collection('messages').add(messageData);
            
            let newContactData = { lastMessageTimestamp: timestamp, name: contactInfo.profile.name, wa_id: contactInfo.wa_id, unreadCount: admin.firestore.FieldValue.increment(1) };
            newContactData.lastMessage = lastMessageText;
            
            if (isNewContact && message.referral?.source_type === 'ad') {
                newContactData.adReferral = { 
                    source_id: message.referral.source_id ?? null, 
                    headline: message.referral.headline ?? null, 
                    source_type: message.referral.source_type ?? null, 
                    source_url: message.referral.source_url ?? null,
                    ctwa_clid: message.referral.ctwa_clid ?? null,
                    receivedAt: timestamp 
                };
                console.log('🔍 Datos del referral completo:', JSON.stringify(message.referral, null, 2));
            }
            
            await contactRef.set(newContactData, { merge: true });
            console.log(`Mensaje (${message.type}) de ${from} guardado.`);
            // --- END: SAVE INCOMING MESSAGE FIRST ---

            // --- START: BOT & AUTOMATION LOGIC ---
            // Fetch global settings to determine bot and away message behavior
            const generalSettingsDoc = await db.collection('crm_settings').doc('general').get();
            const globalBotActive = generalSettingsDoc.exists ? generalSettingsDoc.data().globalBotActive : false;
            const awayMessageActive = generalSettingsDoc.exists ? generalSettingsDoc.data().awayMessageActive !== false : true; // Default to true

            // The bot replies if the global toggle is ON, the individual contact toggle is not explicitly OFF, AND it's NOT a new contact.
            const shouldBotReply = globalBotActive && (contactData.botActive !== false) && !isNewContact;

            if (shouldBotReply) {
                console.log(`🤖 Bot is active for ${from}. Generating response...`);
                try {
                    const randomDelay = Math.floor(Math.random() * 3000) + 2000;
                    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
                    await delay(randomDelay);

                    const botSettingsDoc = await db.collection('crm_settings').doc('bot').get();
                    let botInstructions = botSettingsDoc.exists ? botSettingsDoc.data().instructions : 'Eres un asistente virtual.';
                    
                    // --- MODIFICADO: Lógica de Cobertura y Prompt ---
                    let coverageInfo = '';
                    const postalCodeMatch = messageData.text.match(/\b\d{5}\b/); // Busca un código postal de 5 dígitos
                    if (postalCodeMatch) {
                        const postalCode = postalCodeMatch[0];
                        coverageInfo = await checkCoverage(postalCode);
                    }

                    botInstructions += "\n\nSi el cliente pregunta por cobertura o proporciona un código postal, usa la 'Información de Cobertura' para responder. Si no hay información de cobertura, amablemente pide al cliente su código postal de 5 dígitos para verificar.";

                    const messagesSnapshot = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(10).get();
                    const conversationHistory = messagesSnapshot.docs.map(doc => {
                        const d = doc.data();
                        return `${d.from === from ? 'Cliente' : 'Asistente'}: ${d.text}`;
                    }).reverse().join('\n');
                    
                    let adContext = '';
                    const finalContactData = (await contactRef.get()).data();
                    if (finalContactData.adReferral && finalContactData.adReferral.source_id) {
                        const adResponseRef = db.collection('ad_responses').where('adId', '==', finalContactData.adReferral.source_id).limit(1);
                        const adResponseSnapshot = await adResponseRef.get();
                        if (!adResponseSnapshot.empty) {
                            const adResponseData = adResponseSnapshot.docs[0].data();
                            if (adResponseData.message) {
                                adContext = `--- Información Clave de la Campaña (Contexto Inicial) ---\n${adResponseData.message}\n\n`;
                                console.log(`🤖 Added ad context for Ad ID: ${finalContactData.adReferral.source_id}`);
                            }
                        }
                    }

                    const prompt = `${botInstructions}\n\n${adContext}--- Información de Cobertura ---\n${coverageInfo || 'No se ha verificado ninguna cobertura aún.'}\n\n--- Historial de Conversación ---\n${conversationHistory}\n\n--- Tu Respuesta ---\nAsistente:`;
                    
                    const generatedText = await generateGeminiResponse(prompt);
                    const sentMessageData = await sendAdvancedWhatsAppMessage(from, { text: generatedText });

                    await contactRef.collection('messages').add({
                        from: PHONE_NUMBER_ID,
                        status: 'sent',
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        id: sentMessageData.id,
                        text: sentMessageData.textForDb
                    });
                    await contactRef.update({ lastMessage: sentMessageData.textForDb, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() });
                    console.log(`🤖 Bot response sent to ${from}.`);

                } catch (error) {
                    console.error(`❌ Error in bot logic for ${from}:`, error);
                }
            }

            if (isNewContact) {
                const adId = message.referral?.source_id;
                let adResponseData = null;

                if (adId) {
                    const adResponseRef = db.collection('ad_responses').where('adId', '==', adId).limit(1);
                    const adResponseSnapshot = await adResponseRef.get();
                    if (!adResponseSnapshot.empty) {
                        adResponseData = adResponseSnapshot.docs[0].data();
                        console.log(`Mensaje de bienvenida encontrado para el Ad ID: ${adId}`);
                    } else {
                        console.log(`No se encontró mensaje de bienvenida para el Ad ID: ${adId}. Usando mensaje general.`);
                    }
                }

                // Send media first if it exists
                if (adResponseData && adResponseData.fileUrl) {
                    try {
                        const sentMediaData = await sendAdvancedWhatsAppMessage(from, { fileUrl: adResponseData.fileUrl, fileType: adResponseData.fileType });
                        const mediaMessageToSave = {
                            from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                            id: sentMediaData.id, text: sentMediaData.textForDb, fileUrl: sentMediaData.fileUrlForDb, fileType: sentMediaData.fileTypeForDb
                        };
                        Object.keys(mediaMessageToSave).forEach(key => mediaMessageToSave[key] == null && delete mediaMessageToSave[key]);
                        await contactRef.collection('messages').add(mediaMessageToSave);
                        console.log(`Archivo multimedia de bienvenida enviado a ${from}.`);
                    } catch (error) {
                        console.error(`Fallo al enviar archivo multimedia de bienvenida a ${from}:`, error);
                    }
                }

                // Send text message (either from ad or general welcome)
                const textToSend = adResponseData?.message || GENERAL_WELCOME_MESSAGE;
                if (textToSend) {
                    try {
                         // Optional delay to ensure messages arrive in order
                        if (adResponseData && adResponseData.fileUrl) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                        const sentTextData = await sendAdvancedWhatsAppMessage(from, { text: textToSend });
                        const textMessageToSave = {
                            from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                            id: sentTextData.id, text: sentTextData.textForDb
                        };
                        await contactRef.collection('messages').add(textMessageToSave);
                        console.log(`Mensaje de texto de bienvenida enviado a ${from}.`);
                    } catch (error) {
                        console.error(`Fallo al enviar mensaje de texto de bienvenida a ${from}:`, error);
                    }
                }

            } else if (awayMessageActive && !isWithinBusinessHours() && !shouldBotReply) {
                const now = new Date();
                const lastAwayMessageSent = contactData?.lastAwayMessageSent?.toDate();
                const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

                if (!lastAwayMessageSent || lastAwayMessageSent < twelveHoursAgo) {
                    try {
                        const sentMessageData = await sendAdvancedWhatsAppMessage(from, { text: AWAY_MESSAGE });
                        await contactRef.collection('messages').add({ from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(), id: sentMessageData.id, text: AWAY_MESSAGE });
                        await contactRef.set({ lastAwayMessageSent: admin.firestore.FieldValue.serverTimestamp(), lastMessage: AWAY_MESSAGE, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                        console.log(`Mensaje de ausencia enviado a ${from}.`);
                    } catch (error) {
                        console.error(`Fallo al enviar mensaje de ausencia a ${from}:`, error);
                    }
                }
            }

            if (isNewContact && newContactData.adReferral) {
                try {
                    await sendConversionEvent('Lead', contactInfo, newContactData.adReferral);
                    await contactRef.update({ leadEventSent: true });
                } catch (error) { console.error(`Fallo al enviar evento Lead para ${from}:`, error.message); }
            }
        }

        if (value.statuses) {
            const statusUpdate = value.statuses[0];
            const messagesRef = db.collection('contacts_whatsapp').doc(statusUpdate.recipient_id).collection('messages');
            const query = messagesRef.where('id', '==', statusUpdate.id).limit(1);
            try {
                const snapshot = await query.get();
                if (!snapshot.empty) {
                    await snapshot.docs[0].ref.update({ status: statusUpdate.status });
                    console.log(`Estado del mensaje ${statusUpdate.id} actualizado a '${statusUpdate.status}'.`);
                }
            } catch (error) { console.error(`Error al actualizar estado del mensaje ${statusUpdate.id}:`, error); }
        }
    }
    res.sendStatus(200);
});

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

// --- ENDPOINT PARA ENVIAR MENSAJES ---
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
            // Lógica para mensajes manuales y respuestas rápidas
            if (fileUrl && fileType) {
                const sentMediaData = await sendAdvancedWhatsAppMessage(contactId, { fileUrl, fileType });
                const mediaMessageToSave = {
                    from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: sentMediaData.id, text: sentMediaData.textForDb,
                    fileUrl: sentMediaData.fileUrlForDb, fileType: sentMediaData.fileTypeForDb
                };
                if (reply_to_wamid) mediaMessageToSave.context = { id: reply_to_wamid };
                Object.keys(mediaMessageToSave).forEach(key => mediaMessageToSave[key] == null && delete mediaMessageToSave[key]);
                await contactRef.collection('messages').add(mediaMessageToSave);
                await contactRef.update({ lastMessage: sentMediaData.textForDb, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), unreadCount: 0 });
            }

            if (text) {
                if (fileUrl) await new Promise(resolve => setTimeout(resolve, 500)); // Pequeña pausa
                
                const sentTextData = await sendAdvancedWhatsAppMessage(contactId, { text });
                const textMessageToSave = {
                    from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: sentTextData.id, text: sentTextData.textForDb,
                };
                // No añadir contexto de respuesta al segundo mensaje para evitar confusión
                await contactRef.collection('messages').add(textMessageToSave);
                await contactRef.update({ lastMessage: sentTextData.textForDb, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), unreadCount: 0 });
            }
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
    
    // **FIX:** Remove "Asistente:" prefix if present
    if (generatedText.startsWith('Asistente:')) {
        generatedText = generatedText.substring('Asistente:'.length).trim();
    }
    
    return generatedText;
}

// --- ENDPOINT PARA BOT DE IA (MANUAL) ---
app.post('/api/contacts/:contactId/generate-reply', async (req, res) => {
    const { contactId } = req.params;
    try {
        const messagesSnapshot = await db.collection('contacts_whatsapp').doc(contactId).collection('messages').orderBy('timestamp', 'desc').limit(10).get();
        if (messagesSnapshot.empty) return res.status(400).json({ success: false, message: 'No hay mensajes en esta conversación.' });
        
        const conversationHistory = messagesSnapshot.docs.map(doc => { const d = doc.data(); return `${d.from === contactId ? 'Cliente' : 'Asistente'}: ${d.text}`; }).reverse().join('\\n');
        const prompt = `Eres un asistente virtual amigable y servicial para un CRM de ventas. Tu objetivo es ayudar a cerrar ventas y resolver dudas de los clientes. A continuación se presenta el historial de una conversación. Responde al último mensaje del cliente de manera concisa, profesional y útil.\\n\\n--- Historial ---\\n${conversationHistory}\\n\\n--- Tu Respuesta ---\\nAsistente:`;
        
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
