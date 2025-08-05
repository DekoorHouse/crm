// index.js - VERSIÓN CON VALIDACIÓN DE 24 HORAS

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

    const userData = { ph: [] }; // Solo se usará el teléfono
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
        // test_event_code: "YOUR_TEST_CODE_HERE",
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

    if (value && value.messages) {
        const message = value.messages[0];
        const contactInfo = value.contacts[0];
        const from = message.from;
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        const contactRef = db.collection('contacts_whatsapp').doc(from);
        
        let contactData = {
            lastMessageTimestamp: timestamp,
            name: contactInfo.profile.name,
            wa_id: contactInfo.wa_id,
            unreadCount: admin.firestore.FieldValue.increment(1)
        };
        
        let isNewAdContact = false;
        if (message.referral && message.referral.source_type === 'ad') {
            const contactDoc = await contactRef.get();
            if (!contactDoc.exists || !contactDoc.data().adReferral) {
                isNewAdContact = true;
            }
            contactData.adReferral = {
                source_id: message.referral.source_id ?? null,
                headline: message.referral.headline ?? null,
                source_type: message.referral.source_type ?? null,
                source_url: message.referral.source_url ?? null,
                fbc: message.referral.ref ?? null,
                receivedAt: timestamp
            };
        }

        let messageData = { timestamp: timestamp, from: from, status: 'received' };
        let lastMessageText = '';
        try {
            switch (message.type) {
                case 'text': messageData.text = message.text.body; lastMessageText = message.text.body; break;
                case 'image': case 'video': lastMessageText = message.type === 'image' ? '📷 Imagen' : '🎥 Video'; messageData.text = lastMessageText; break;
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
            } catch (error) {
                console.error(`Fallo al enviar eventos iniciales para ${from}:`, error.message);
            }
        }
    }
    res.sendStatus(200);
});

// --- ENDPOINT PARA ENVIAR MENSAJES ---
app.post('/api/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType } = req.body;

    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        return res.status(500).json({ success: false, message: 'Faltan las credenciales de WhatsApp en el servidor.' });
    }

    if (!text && !fileUrl) {
        return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    }

    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    
    let messagePayload;

    try {
        // --- INICIO: VALIDACIÓN DE 24 HORAS ---
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();

        if (!contactDoc.exists) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        }

        const contactData = contactDoc.data();
        const lastTimestamp = contactData.lastMessageTimestamp;

        if (lastTimestamp) {
            const now = new Date();
            const lastMessageDate = lastTimestamp.toDate();
            const diffHours = (now.getTime() - lastMessageDate.getTime()) / (1000 * 60 * 60);

            if (diffHours > 24) {
                return res.status(403).json({ success: false, message: 'Han pasado más de 24 horas desde el último mensaje. No se puede enviar una respuesta.' });
            }
        }
        // --- FIN: VALIDACIÓN DE 24 HORAS ---


        if (text) {
            messagePayload = { messaging_product: 'whatsapp', to: contactId, type: 'text', text: { body: text } };
        } else if (fileUrl && fileType) {
            const type = fileType.startsWith('image/') ? 'image' : 'video';
            messagePayload = { messaging_product: 'whatsapp', to: contactId, type: type, [type]: { link: fileUrl } };
        }

        const response = await axios.post(url, messagePayload, { headers });
        const messageId = response.data.messages[0].id;
        
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        let messageToSave = {
            from: PHONE_NUMBER_ID, 
            status: 'sent', 
            timestamp: timestamp, 
            id: messageId 
        };

        if (text) {
            messageToSave.text = text;
        } else if (fileUrl) {
            messageToSave.fileUrl = fileUrl;
            messageToSave.fileType = fileType;
            messageToSave.text = fileType.startsWith('image/') ? '📷 Imagen' : '🎥 Video';
        }
        
        await contactRef.collection('messages').add(messageToSave);
        await contactRef.update({
            lastMessage: messageToSave.text,
            lastMessageTimestamp: timestamp,
            unreadCount: 0 
        });

        res.status(200).json({ success: true, message: 'Mensaje enviado correctamente.' });
    } catch (error) {
        console.error('Error al enviar mensaje vía WhatsApp API:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al enviar el mensaje a través de WhatsApp.' });
    }
});


// --- ENDPOINTS PARA ACCIONES MANUALES ---
app.post('/api/contacts/:contactId/mark-as-registration', async (req, res) => {
    const { contactId } = req.params;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        
        const contactData = contactDoc.data();
        if (contactData.registrationStatus === 'completed') return res.status(400).json({ success: false, message: 'Este contacto ya fue registrado.' });
        
        const contactInfoForEvent = {
            wa_id: contactData.wa_id,
            profile: { name: contactData.name }
        };

        await sendConversionEvent('CompleteRegistration', 'chat', contactInfoForEvent, contactData.adReferral);
        await contactRef.update({ registrationStatus: 'completed', registrationSource: contactData.adReferral ? 'meta_ad' : 'manual_organic', registrationDate: admin.firestore.FieldValue.serverTimestamp() });
        res.status(200).json({ success: true, message: 'Contacto marcado como "Registro Completado".' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al procesar la solicitud.' });
    }
});

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
        
        const contactInfoForEvent = {
            wa_id: contactData.wa_id,
            profile: { name: contactData.name }
        };

        await sendConversionEvent('Purchase', 'chat', contactInfoForEvent, contactData.adReferral, { value: parseFloat(value), currency });
        await contactRef.update({ purchaseStatus: 'completed', purchaseValue: parseFloat(value), purchaseCurrency: currency, purchaseDate: admin.firestore.FieldValue.serverTimestamp() });
        res.status(200).json({ success: true, message: 'Compra registrada y evento enviado a Meta.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al procesar la compra.' });
    }
});

app.post('/api/contacts/:contactId/send-view-content', async (req, res) => {
    const { contactId } = req.params;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        const contactData = contactDoc.data();

        const contactInfoForEvent = {
            wa_id: contactData.wa_id,
            profile: { name: contactData.name }
        };

        await sendConversionEvent('ViewContent', 'website', contactInfoForEvent, contactData.adReferral);
        res.status(200).json({ success: true, message: 'Evento ViewContent enviado manualmente.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al procesar el envío de ViewContent.' });
    }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
