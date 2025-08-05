// index.js - VERSIÓN CON RESPUESTAS RÁPIDAS DINÁMICAS

require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

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

    const finalCustomData = {
        lead_source: referralInfo ? 'WhatsApp Ad' : 'WhatsApp Organic',
        ad_headline: referralInfo?.headline,
        ad_id: referralInfo?.source_id,
        ...customData
    };

    const payload = {
        data: [{
            event_name: eventName,
            event_time: eventTime,
            event_id: eventId,
            action_source: actionSource,
            user_data: userData,
            custom_data: finalCustomData,
            event_source_url: referralInfo?.source_url, 
            fbc: referralInfo?.fbc,
        }],
    };
    
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
            // ... (código existente para procesar mensajes entrantes)
        }
        if (value.statuses) {
            // ... (código existente para procesar estados)
        }
    }
    res.sendStatus(200);
});

// --- ENDPOINT PARA ENVIAR MENSAJES ---
app.post('/api/contacts/:contactId/messages', async (req, res) => {
    // ... (código existente para enviar mensajes)
});

// --- ENDPOINTS PARA ACCIONES MANUALES ---
app.post('/api/contacts/:contactId/mark-as-registration', async (req, res) => {
    // ... (código existente)
});

app.post('/api/contacts/:contactId/mark-as-purchase', async (req, res) => {
    // ... (código existente)
});

app.post('/api/contacts/:contactId/send-view-content', async (req, res) => {
    // ... (código existente)
});

// --- ENDPOINTS PARA NOTAS INTERNAS ---
app.post('/api/contacts/:contactId/notes', async (req, res) => {
    // ... (código existente)
});

app.put('/api/contacts/:contactId/notes/:noteId', async (req, res) => {
    // ... (código existente)
});

app.delete('/api/contacts/:contactId/notes/:noteId', async (req, res) => {
    // ... (código existente)
});

// --- INICIO: ENDPOINTS PARA RESPUESTAS RÁPIDAS ---
app.get('/api/quick-replies', async (req, res) => {
    try {
        const repliesSnapshot = await db.collection('quick_replies').orderBy('shortcut').get();
        const replies = repliesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(replies);
    } catch (error) {
        console.error('Error al obtener respuestas rápidas:', error);
        res.status(500).json({ success: false, message: 'Error al obtener respuestas rápidas.' });
    }
});

app.post('/api/quick-replies', async (req, res) => {
    const { shortcut, message } = req.body;
    if (!shortcut || !message) {
        return res.status(400).json({ success: false, message: 'El atajo y el mensaje son requeridos.' });
    }
    try {
        const newReplyRef = await db.collection('quick_replies').add({
            shortcut: shortcut.toLowerCase(),
            message: message,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(201).json({ success: true, id: newReplyRef.id });
    } catch (error) {
        console.error('Error al crear respuesta rápida:', error);
        res.status(500).json({ success: false, message: 'Error al crear la respuesta rápida.' });
    }
});
// --- FIN: ENDPOINTS PARA RESPUESTAS RÁPIDAS ---

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
