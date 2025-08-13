// index.js - VERSIÓN CON PLANTILLAS, RESPUESTAS, REACCIONES Y BOT DE IA

require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const fetch = require('node-fetch');

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

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- FUNCIÓN PARA HASHEAR DATOS ---
function sha256(data) {
    if (!data) return null;
    const normalizedData = typeof data === 'string' ? data.toLowerCase().replace(/\s/g, '') : data.toString();
    return crypto.createHash('sha256').update(normalizedData).digest('hex');
}

// --- FUNCIÓN GENÉRICA PARA ENVIAR EVENTOS DE CONVERSIÓN ---
const sendConversionEvent = async (eventName, actionSource, contactInfo, referralInfo, customData = {}) => {
    if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
        console.warn('Advertencia: Faltan credenciales de Meta. No se enviará el evento.');
        return;
    }
    const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events`;
    const eventTime = Math.floor(Date.now() / 1000);
    const eventId = `${eventName}_${contactInfo.wa_id}_${eventTime}`; 
    const userData = { ph: [] };
    if (contactInfo.wa_id) userData.ph.push(sha256(contactInfo.wa_id));
    if (contactInfo.profile?.name) userData.fn = sha256(contactInfo.profile.name);
    if (userData.ph.length === 0) {
        console.error(`No se puede enviar el evento '${eventName}' porque falta el identificador de teléfono.`);
        return;
    }
    const finalCustomData = { lead_source: referralInfo ? 'WhatsApp Ad' : 'WhatsApp Organic', ad_headline: referralInfo?.headline, ad_id: referralInfo?.source_id, ...customData };
    const payload = { data: [{ event_name: eventName, event_time: eventTime, event_id: eventId, action_source: actionSource, user_data: userData, custom_data: finalCustomData, event_source_url: referralInfo?.source_url, fbc: referralInfo?.fbc, }], };
    if (!payload.data[0].event_source_url) delete payload.data[0].event_source_url;
    if (!payload.data[0].fbc) delete payload.data[0].fbc;
    try {
        console.log(`Enviando evento de PRODUCCIÓN '${eventName}' para ${contactInfo.wa_id}. Payload:`, JSON.stringify(payload, null, 2));
        await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${META_CAPI_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } });
        console.log(`✅ Evento de PRODUCCIÓN '${eventName}' enviado a Meta.`);
    } catch (error) {
        console.error(`❌ Error al enviar evento de PRODUCCIÓN '${eventName}' a Meta.`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw new Error(`Falló el envío del evento de PRODUCCIÓN '${eventName}' a Meta.`);
    }
};

// --- WEBHOOK DE WHATSAPP ---
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
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
            
            let contactData = { lastMessageTimestamp: timestamp, name: contactInfo.profile.name, wa_id: contactInfo.wa_id, unreadCount: admin.firestore.FieldValue.increment(1) };
            
            let isNewAdContact = false;
            if (message.referral && message.referral.source_type === 'ad') {
                const contactDoc = await contactRef.get();
                if (!contactDoc.exists || !contactDoc.data().adReferral) { isNewAdContact = true; }
                contactData.adReferral = { source_id: message.referral.source_id ?? null, headline: message.referral.headline ?? null, source_type: message.referral.source_type ?? null, source_url: message.referral.source_url ?? null, fbc: message.referral.ref ?? null, receivedAt: timestamp };
            }

            let messageData = { timestamp: timestamp, from: from, status: 'received', id: message.id };
            let lastMessageText = '';
            try {
                if (message.context) {
                    messageData.context = { id: message.context.id };
                }
                switch (message.type) {
                    case 'text': messageData.text = message.text.body; lastMessageText = message.text.body; break;
                    case 'image': lastMessageText = '📷 Imagen'; messageData.text = lastMessageText; break;
                    case 'video': lastMessageText = '🎥 Video'; messageData.text = lastMessageText; break;
                    default: lastMessageText = `Mensaje no soportado: ${message.type}`; messageData.text = lastMessageText; break;
                }
            } catch (error) { console.error("Error procesando contenido del mensaje:", error.message); }

            await contactRef.collection('messages').add(messageData);
            contactData.lastMessage = lastMessageText;
            await contactRef.set(contactData, { merge: true });
            console.log(`Mensaje (${message.type}) de ${from} guardado.`);

            if (isNewAdContact) {
                try {
                    await sendConversionEvent('ViewContent', 'website', contactInfo, contactData.adReferral);
                    await sendConversionEvent('Lead', 'website', contactInfo, contactData.adReferral);
                    await contactRef.update({ viewContentSent: true, leadEventSent: true });
                } catch (error) { console.error(`Fallo al enviar eventos iniciales para ${from}:`, error.message); }
            }
        }

        if (value.statuses) {
            const statusUpdate = value.statuses[0];
            const wamid = statusUpdate.id;
            const newStatus = statusUpdate.status;
            const recipientId = statusUpdate.recipient_id;
            console.log(`Recibido estado '${newStatus}' para el mensaje ${wamid} del contacto ${recipientId}`);
            const messagesRef = db.collection('contacts_whatsapp').doc(recipientId).collection('messages');
            const query = messagesRef.where('id', '==', wamid).limit(1);
            try {
                const snapshot = await query.get();
                if (!snapshot.empty) {
                    const messageDoc = snapshot.docs[0];
                    const currentStatus = messageDoc.data().status;
                    const statusOrder = { sent: 1, delivered: 2, read: 3 };
                    if (!currentStatus || statusOrder[newStatus] > statusOrder[currentStatus]) {
                        await messageDoc.ref.update({ status: newStatus });
                        console.log(`Estado del mensaje ${wamid} actualizado a '${newStatus}' en Firestore.`);
                    } else {
                        console.log(`Se ignoró la actualización de estado de '${currentStatus}' a '${newStatus}' para el mensaje ${wamid}.`);
                    }
                } else {
                    console.warn(`No se encontró el mensaje con WAMID ${wamid} para actualizar el estado.`);
                }
            } catch (error) { console.error(`Error al actualizar el estado del mensaje ${wamid}:`, error); }
        }
    }
    res.sendStatus(200);
});

// --- ENDPOINT PARA ENVIAR MENSAJES (DENTRO DE 24H) ---
app.post('/api/contacts/:contactId/messages', async (req, res) => {
    // ... (Este código no cambia)
});

// --- ENDPOINT PARA ENVIAR PLANTILLAS DE MENSAJES (CON MANEJO DE ERRORES MEJORADO) ---
app.post('/api/contacts/:contactId/send-template', async (req, res) => {
    const { contactId } = req.params;
    const { templateName, params } = req.body;

    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        return res.status(500).json({ success: false, message: 'Faltan las credenciales de WhatsApp en el servidor.' });
    }
    if (!templateName || !params) {
        return res.status(400).json({ success: false, message: 'Faltan el nombre de la plantilla y los parámetros.' });
    }

    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };

    const components = params.length > 0 ? [{
        type: 'body',
        parameters: params.map(p => ({ type: 'text', text: p }))
    }] : [];

    const messagePayload = {
        messaging_product: 'whatsapp',
        to: contactId,
        type: 'template',
        template: {
            name: templateName,
            language: { code: 'es_MX' },
            components: components
        }
    };

    try {
        const response = await axios.post(url, messagePayload, { headers });
        const messageId = response.data.messages[0].id;
        
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        
        const messageToSave = {
            from: PHONE_NUMBER_ID,
            status: 'sent',
            timestamp: timestamp,
            id: messageId,
            text: `Plantilla '${templateName}' enviada.`,
            isTemplate: true,
            templateInfo: { name: templateName, params: params }
        };
        
        await contactRef.collection('messages').add(messageToSave);
        await contactRef.update({ 
            lastMessage: `Plantilla: ${templateName}`, 
            lastMessageTimestamp: timestamp, 
            unreadCount: 0 
        });

        res.status(200).json({ success: true, message: 'Plantilla enviada correctamente.' });
    } catch (error) {
        console.error('Error al enviar plantilla vía WhatsApp API:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        
        // --- INICIO DE LA MEJORA EN EL MANEJO DE ERRORES ---
        if (error.response && error.response.data && error.response.data.error) {
            const metaError = error.response.data.error;
            const errorMessage = `Meta API Error: ${metaError.message} (Code: ${metaError.code}, Type: ${metaError.type}). ${metaError.error_user_title || ''} ${metaError.error_user_msg || ''}`;
            // Devolvemos un mensaje de error más detallado al frontend
            return res.status(500).json({ success: false, message: errorMessage });
        }
        // --- FIN DE LA MEJORA ---

        res.status(500).json({ success: false, message: 'Error al enviar la plantilla a través de WhatsApp.' });
    }
});


// --- OTROS ENDPOINTS (REACCIONES, NOTAS, IA, ETC.) ---
// ... (El resto de tu código no cambia)

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
