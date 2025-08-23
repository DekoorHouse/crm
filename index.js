// index.js - VERSIÓN FINAL CORREGIDA PARA EVENTOS DE WHATSAPP EN META (SIN ERRORES)

require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const fetch = require('node-fetch');
const path = require('path');

// --- CONFIGURACIÓN DE FIREBASE ---
const serviceAccount = require('./serviceAccountKey.json');
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

🕒 Nuestro horario de atención es:

🗓 Lunes a Viernes: 7:00 am - 7:00 pm

🗓 Sábado: 7:00 am - 2:00 pm
Te responderemos tan pronto como regresemos.

🙏 ¡Gracias por tu paciencia!`;

// --- CONFIGURACIÓN DE MENSAJES DE BIENVENIDA ---
const GENERAL_WELCOME_MESSAGE = '¡Hola! 👋 Gracias por comunicarte con nosotros. ¿En qué podemos ayudarte hoy?';
const CAMPAIGN_WELCOME_MESSAGES = {
    "120229247610060637": `¡Hola! 👋 El Envío Gratis está a punto de terminar. ¡No te lo pierdas! 🔥

Por solo $650 pesos, obtienes:

🚀 *Envío GRATIS en todo México*
🏡 *Entrega a domicilio segura*
🔒 *Garantía de durabilidad*
📝 *Más de 500 referencias en Facebook* ✅❤️
💰 *Pago en Oxxo o por transferencia*

✨ El regalo que le recordará tu amor todos los días ✨
📷 *SIN ANTICIPO* paga hasta que este terminado antes de enviar

*¿Qué nombres quieres que lleve la suya?* 😃`,
};

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

// --- ✅ FUNCIÓN PRINCIPAL CORREGIDA PARA EVENTOS DE WHATSAPP (SIN ERRORES) ---
const sendConversionEvent = async (eventName, contactInfo, referralInfo, customData = {}) => {
    if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
        console.warn('Advertencia: Faltan credenciales de Meta (PIXEL_ID o CAPI_ACCESS_TOKEN). No se enviará el evento.');
        return;
    }
    
    if (!contactInfo || !contactInfo.wa_id) {
        console.error(`❌ Error Crítico: No se puede enviar el evento '${eventName}' porque falta el 'wa_id' del contacto.`);
        throw new Error(`No se pudo enviar el evento '${eventName}' a Meta: falta el ID de WhatsApp del contacto.`);
    }

    // ✅ USAR EL ENDPOINT DEL PIXEL CON CONFIGURACIÓN ESPECÍFICA PARA WHATSAPP
    const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events`;
    const eventTime = Math.floor(Date.now() / 1000);
    const eventId = `wa_${eventName}_${contactInfo.wa_id}_${eventTime}`;
    
    // Preparar datos del usuario hasheados
    const userData = { 
        ph: [sha256(contactInfo.wa_id)] // ✅ Número de WhatsApp hasheado
    };
    
    // Agregar nombre si existe
    if (contactInfo.profile?.name) {
        userData.fn = sha256(contactInfo.profile.name);
    }

    // ✅ CLAVE: Detectar si es un evento proveniente de anuncio y agregar ctwa_clid
    const isAdReferral = referralInfo && referralInfo.ctwa_clid;
    if (isAdReferral) {
        userData.ctwa_clid = referralInfo.ctwa_clid; // ✅ Este parámetro es CRÍTICO para la atribución de WhatsApp
    }

    // ✅ IMPORTANTE: Agregar WhatsApp Business Account ID en user_data
    if (WHATSAPP_BUSINESS_ACCOUNT_ID) {
        userData.whatsapp_business_account_id = WHATSAPP_BUSINESS_ACCOUNT_ID;
    }

    // Preparar datos personalizados del evento
    const finalCustomData = {
        lead_source: isAdReferral ? 'WhatsApp Ad' : 'WhatsApp Organic',
        platform: 'whatsapp',
        messaging_channel: 'whatsapp',
        business_account_id: WHATSAPP_BUSINESS_ACCOUNT_ID,
        ...customData
    };

    // Solo agregar información del anuncio si existe
    if (isAdReferral) {
        if (referralInfo.headline) finalCustomData.ad_headline = referralInfo.headline;
        if (referralInfo.source_id) finalCustomData.ad_id = referralInfo.source_id;
        if (referralInfo.source_url) finalCustomData.ad_source_url = referralInfo.source_url;
    }

    // Limpiar valores undefined
    Object.keys(finalCustomData).forEach(key => 
        finalCustomData[key] === undefined && delete finalCustomData[key]
    );

    // ✅ ESTRUCTURA OPTIMIZADA PARA WHATSAPP CON PIXEL ENDPOINT
    const payload = {
        data: [{
            event_name: eventName,
            event_time: eventTime,
            event_id: eventId,
            action_source: 'business_messaging', // ✅ Indica que viene de mensajería empresarial
            messaging_channel: 'whatsapp', // ✅ Especifica WhatsApp
            user_data: userData, // ✅ Incluye ctwa_clid y WABA ID
            custom_data: finalCustomData
        }]
    };

    try {
        console.log(`📤 Enviando evento '${eventName}' para ${contactInfo.wa_id} como evento de WhatsApp...`);
        console.log('Payload:', JSON.stringify(payload, null, 2));
        
        const response = await axios.post(url, payload, { 
            headers: { 
                'Authorization': `Bearer ${META_CAPI_ACCESS_TOKEN}`, 
                'Content-Type': 'application/json' 
            } 
        });
        
        console.log(`✅ Evento '${eventName}' enviado exitosamente como evento de WhatsApp a Meta.`);
        
        // Log de respuesta para depuración
        if (response.data) {
            console.log('✅ Respuesta exitosa de Meta:', JSON.stringify(response.data, null, 2));
        }
        
    } catch (error) {
        console.error(`❌ Error al enviar evento '${eventName}' de WhatsApp a Meta.`);
        
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Detalles del error:', JSON.stringify(error.response.data, null, 2));
            
            // Si hay error de permissions o dataset, intentar método alternativo
            const errorCode = error.response.data?.error?.code;
            const errorSubcode = error.response.data?.error?.error_subcode;
            
            if (errorCode === 100 && (errorSubcode === 33 || errorSubcode === 2804132)) {
                console.log('🔄 Error de permisos/dataset, intentando método web alternativo...');
                return await sendConversionEventWebFallback(eventName, contactInfo, referralInfo, customData);
            }
        } else {
            console.error('Error de red:', error.message);
        }
        
        throw new Error(`Falló el envío del evento '${eventName}' de WhatsApp: ${error.response?.data?.error?.message || error.message}`);
    }
};

// --- ✅ MÉTODO ALTERNATIVO COMO WEB EVENT (MANTIENE ATRIBUCIÓN DE WHATSAPP) ---
const sendConversionEventWebFallback = async (eventName, contactInfo, referralInfo, customData = {}) => {
    if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
        console.warn('Advertencia: Faltan credenciales de Pixel. No se puede enviar evento alternativo.');
        return;
    }

    console.log('🔄 Usando método web alternativo manteniendo atribución de WhatsApp...');
    
    const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events`;
    const eventTime = Math.floor(Date.now() / 1000);
    const eventId = `web_wa_${eventName}_${contactInfo.wa_id}_${eventTime}`;
    
    const userData = { 
        ph: [sha256(contactInfo.wa_id)]
    };
    
    if (contactInfo.profile?.name) {
        userData.fn = sha256(contactInfo.profile.name);
    }

    // ✅ CRÍTICO: Mantener ctwa_clid para preservar la atribución de WhatsApp
    const isAdReferral = referralInfo && referralInfo.ctwa_clid;
    if (isAdReferral) {
        userData.ctwa_clid = referralInfo.ctwa_clid;
    }

    // ✅ IMPORTANTE: Agregar WABA ID para identificar como WhatsApp
    if (WHATSAPP_BUSINESS_ACCOUNT_ID) {
        userData.whatsapp_business_account_id = WHATSAPP_BUSINESS_ACCOUNT_ID;
    }

    const finalCustomData = {
        lead_source: isAdReferral ? 'WhatsApp Ad (Web Tracking)' : 'WhatsApp Organic (Web Tracking)',
        platform: 'whatsapp',
        method: 'web_fallback',
        messaging_channel: 'whatsapp',
        original_source: 'whatsapp_business_messaging',
        whatsapp_business_account_id: WHATSAPP_BUSINESS_ACCOUNT_ID,
        ...customData
    };

    if (isAdReferral) {
        if (referralInfo.headline) finalCustomData.ad_headline = referralInfo.headline;
        if (referralInfo.source_id) finalCustomData.ad_id = referralInfo.source_id;
        if (referralInfo.source_url) finalCustomData.ad_source_url = referralInfo.source_url;
    }

    Object.keys(finalCustomData).forEach(key => 
        finalCustomData[key] === undefined && delete finalCustomData[key]
    );

    const payload = {
        data: [{
            event_name: eventName,
            event_time: eventTime,
            event_id: eventId,
            action_source: 'website', // ✅ Usar website para evitar errores de permisos
            user_data: userData, // ✅ Incluye ctwa_clid para mantener atribución de WhatsApp
            custom_data: finalCustomData
        }]
    };

    try {
        const response = await axios.post(url, payload, { 
            headers: { 
                'Authorization': `Bearer ${META_CAPI_ACCESS_TOKEN}`, 
                'Content-Type': 'application/json' 
            } 
        });
        
        console.log(`✅ Evento '${eventName}' enviado como fallback web (atribución de WhatsApp preservada).`);
        
        if (response.data) {
            console.log('✅ Respuesta exitosa del método fallback:', JSON.stringify(response.data, null, 2));
        }
        
    } catch (fallbackError) {
        console.error(`❌ Error en método fallback web:`, fallbackError.response?.data || fallbackError.message);
        throw new Error(`Ambos métodos fallaron para el evento '${eventName}'.`);
    }
};

// --- ✅ FUNCIÓN PARA VERIFICAR CONFIGURACIÓN DE WHATSAPP ---
const verifyWhatsAppConfiguration = async () => {
    console.log('🔍 Verificando configuración de WhatsApp...');
    
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID) {
        console.error('❌ WHATSAPP_BUSINESS_ACCOUNT_ID no está configurado');
        return false;
    }
    
    if (!META_CAPI_ACCESS_TOKEN) {
        console.error('❌ META_CAPI_ACCESS_TOKEN no está configurado');
        return false;
    }
    
    if (!META_PIXEL_ID) {
        console.error('❌ META_PIXEL_ID no está configurado');
        return false;
    }
    
    // Verificar acceso al WhatsApp Business Account
    try {
        const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}`;
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${META_CAPI_ACCESS_TOKEN}` }
        });
        
        console.log('✅ WhatsApp Business Account accesible:', response.data.name || 'Sin nombre');
        return true;
        
    } catch (error) {
        console.error('❌ No se puede acceder al WhatsApp Business Account:', error.response?.data?.error?.message || error.message);
        console.log('ℹ️ Se usará el método fallback automáticamente');
        return true; // Continuar con fallback
    }
};

// --- FUNCIÓN AUXILIAR PARA ENVIAR MENSAJES DE WHATSAPP ---
async function sendWhatsAppMessage(to, text) {
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    const payload = { messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } };
    try {
        const response = await axios.post(url, payload, { headers });
        return response.data.messages[0].id;
    } catch (error) {
        console.error(`Error al enviar mensaje de WhatsApp a ${to}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}

// --- NUEVA FUNCIÓN PARA DESCARGAR Y SUBIR IMÁGENES ---
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

            if (isNewContact) {
                let welcomeMessage = GENERAL_WELCOME_MESSAGE;
                if (message.referral?.source_type === 'ad') {
                    const adId = message.referral.source_id;
                    if (CAMPAIGN_WELCOME_MESSAGES[adId]) {
                        welcomeMessage = CAMPAIGN_WELCOME_MESSAGES[adId];
                    }
                }
                try {
                    const messageId = await sendWhatsAppMessage(from, welcomeMessage);
                    await contactRef.collection('messages').add({ from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId, text: welcomeMessage });
                    console.log(`Mensaje de bienvenida enviado a ${from}.`);
                } catch (error) {
                    console.error(`Fallo al enviar mensaje de bienvenida a ${from}:`, error);
                }
            } else if (!isWithinBusinessHours()) {
                const now = new Date();
                const lastAwayMessageSent = contactDoc.data()?.lastAwayMessageSent?.toDate();
                const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

                if (!lastAwayMessageSent || lastAwayMessageSent < twelveHoursAgo) {
                    try {
                        const messageId = await sendWhatsAppMessage(from, AWAY_MESSAGE);
                        await contactRef.collection('messages').add({ from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId, text: AWAY_MESSAGE });
                        await contactRef.set({ lastAwayMessageSent: timestamp, lastMessage: AWAY_MESSAGE, lastMessageTimestamp: timestamp }, { merge: true });
                        console.log(`Mensaje de ausencia enviado a ${from}.`);
                    } catch (error) {
                        console.error(`Fallo al enviar mensaje de ausencia a ${from}:`, error);
                    }
                }
            }

            let contactData = { lastMessageTimestamp: timestamp, name: contactInfo.profile.name, wa_id: contactInfo.wa_id, unreadCount: admin.firestore.FieldValue.increment(1) };
            
            // ✅ CORRECCIÓN: Guardar ctwa_clid correctamente desde message.referral
            if (isNewContact && message.referral?.source_type === 'ad') {
                contactData.adReferral = { 
                    source_id: message.referral.source_id ?? null, 
                    headline: message.referral.headline ?? null, 
                    source_type: message.referral.source_type ?? null, 
                    source_url: message.referral.source_url ?? null,
                    // NO guardamos fbc - Meta no lo acepta para WhatsApp Business
                    ctwa_clid: message.referral.ctwa_clid ?? null,  // ✅ Solo necesitamos ctwa_clid
                    receivedAt: timestamp 
                };
                
                // DEBUG: Para ver qué está llegando
                console.log('🔍 Datos del referral completo:', JSON.stringify(message.referral, null, 2));
            }

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
            contactData.lastMessage = lastMessageText;
            await contactRef.set(contactData, { merge: true });
            console.log(`Mensaje (${message.type}) de ${from} guardado.`);

            if (isNewContact && contactData.adReferral) {
                try {
                    await sendConversionEvent('Lead', contactInfo, contactData.adReferral);
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
    
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let messagePayload, messageToSaveText;

    try {
        if (text) {
            messagePayload = { messaging_product: 'whatsapp', to: contactId, type: 'text', text: { body: text } };
            messageToSaveText = text;
        } else if (fileUrl && fileType) {
            const type = fileType.startsWith('image/') ? 'image' : 'video';
            messagePayload = { messaging_product: 'whatsapp', to: contactId, type, [type]: { link: fileUrl } };
            messageToSaveText = type === 'image' ? '📷 Imagen' : '🎥 Video';
        } else if (template) {
            const { payload, messageToSaveText: TplText } = await buildTemplatePayload(contactId, template);
            messagePayload = payload;
            messageToSaveText = TplText;
        } else {
             return res.status(400).json({ success: false, message: 'Formato de mensaje no válido.' });
        }

        if (reply_to_wamid && !template) messagePayload.context = { message_id: reply_to_wamid };

        const response = await axios.post(url, messagePayload, { headers });
        const messageId = response.data.messages[0].id;
        
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        let messageToSave = { from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId, text: messageToSaveText };
        
        if (fileUrl) { messageToSave.fileUrl = fileUrl; messageToSave.fileType = fileType; }
        if (reply_to_wamid) messageToSave.context = { id: reply_to_wamid };
        
        await contactRef.collection('messages').add(messageToSave);
        await contactRef.update({ lastMessage: messageToSaveText, lastMessageTimestamp: timestamp, unreadCount: 0 });

        res.status(200).json({ success: true, message: 'Mensaje enviado.' });
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

// --- ENDPOINTS PARA RESPUESTAS RÁPIDAS ---
app.post('/api/quick-replies', async (req, res) => {
    const { shortcut, message } = req.body;
    if (!shortcut || !message) return res.status(400).json({ success: false, message: 'El atajo y el mensaje son obligatorios.' });
    try {
        const existing = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existing.empty) return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya existe.` });
        const newReply = await db.collection('quick_replies').add({ shortcut, message });
        res.status(201).json({ success: true, id: newReply.id });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
});

app.put('/api/quick-replies/:id', async (req, res) => {
    const { id } = req.params;
    const { shortcut, message } = req.body;
    if (!shortcut || !message) return res.status(400).json({ success: false, message: 'El atajo y el mensaje son obligatorios.' });
    try {
        const existing = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existing.empty && existing.docs[0].id !== id) return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya existe.` });
        await db.collection('quick_replies').doc(id).update({ shortcut, message });
        res.status(200).json({ success: true, message: 'Respuesta rápida actualizada.' });
    } catch (error) { res.status(500).json({ success: false, message: 'Error del servidor.' }); }
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
    const { label, color, key } = req.body;
    if (!label || !color || !key) return res.status(400).json({ success: false, message: 'Faltan datos.' });
    try {
        await db.collection('crm_tags').add({ label, color, key });
        res.status(201).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al crear la etiqueta.' }); }
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

app.delete('/api/tags', async (req, res) => {
    try {
        const snapshot = await db.collection('crm_tags').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al eliminar todas las etiquetas.' }); }
});

// --- ENDPOINT PARA BOT DE IA ---
app.post('/api/contacts/:contactId/generate-reply', async (req, res) => {
    const { contactId } = req.params;
    if (!GEMINI_API_KEY) return res.status(500).json({ success: false, message: 'La API Key de Gemini no está configurada.' });
    try {
        const messagesSnapshot = await db.collection('contacts_whatsapp').doc(contactId).collection('messages').orderBy('timestamp', 'desc').limit(10).get();
        if (messagesSnapshot.empty) return res.status(400).json({ success: false, message: 'No hay mensajes en esta conversación.' });
        
        const conversationHistory = messagesSnapshot.docs.map(doc => { const d = doc.data(); return `${d.from === contactId ? 'Cliente' : 'Asistente'}: ${d.text}`; }).reverse().join('\n');
        const prompt = `Eres un asistente virtual amigable y servicial para un CRM de ventas. Tu objetivo es ayudar a cerrar ventas y resolver dudas de los clientes. A continuación se presenta el historial de una conversación. Responde al último mensaje del cliente de manera concisa, profesional y útil.\n\n--- Historial ---\n${conversationHistory}\n\n--- Tu Respuesta ---\nAsistente:`;
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
        const payload = { contents: [{ parts: [{ text: prompt }] }] };
        
        const geminiResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!geminiResponse.ok) throw new Error(`La API de Gemini respondió con el estado: ${geminiResponse.status}`);
        
        const result = await geminiResponse.json();
        const generatedText = result.candidates[0]?.content?.parts[0]?.text?.trim();
        if (!generatedText) throw new Error('No se recibió una respuesta válida de la IA.');
        
        res.status(200).json({ success: true, message: 'Respuesta generada.', suggestion: generatedText });
    } catch (error) {
        console.error('Error al generar respuesta con IA:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al generar la respuesta.' });
    }
});

// --- AÑADIDO: Ruta para servir la aplicación frontend ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- ✅ INICIO DEL SERVIDOR CON VERIFICACIÓN ---
app.listen(PORT, async () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
  console.log(`✅ Configuración de eventos WhatsApp para Meta activa`);
  console.log(`📱 WhatsApp Business Account ID: ${WHATSAPP_BUSINESS_ACCOUNT_ID ? 'Configurado ✅' : 'Falta configurar ❌'}`);
  console.log(`🎯 Meta CAPI Access Token: ${META_CAPI_ACCESS_TOKEN ? 'Configurado ✅' : 'Falta configurar ❌'}`);
  console.log(`📊 Meta Pixel ID: ${META_PIXEL_ID ? 'Configurado ✅' : 'Falta configurar ❌'}`);
  
  // Verificar configuración de WhatsApp
  try {
    await verifyWhatsAppConfiguration();
  } catch (error) {
    console.error('⚠️ Error verificando configuración:', error.message);
  }
});
