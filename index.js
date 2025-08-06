// index.js - VERSIÓN CON BOT DE IA (GEMINI)

require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const fetch = require('node-fetch'); // Asegúrate de tener node-fetch instalado: npm install node-fetch

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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // <-- AÑADE TU API KEY DE GEMINI EN .env

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
        // Procesa mensajes entrantes
        if (value.messages) {
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

        // Procesa actualizaciones de estado (sent, delivered, read)
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
            } catch (error) {
                console.error(`Error al actualizar el estado del mensaje ${wamid}:`, error);
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


// --- ENDPOINTS PARA ACCIONES MANUALES Y DATOS DE CONTACTO ---
app.put('/api/contacts/:contactId', async (req, res) => {
    const { contactId } = req.params;
    const { name, email, nickname } = req.body;

    if (!name) {
        return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();

        if (!contactDoc.exists) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        }

        const updateData = {
            name: name,
            email: email || null,
            nickname: nickname || null,
        };

        await contactRef.update(updateData);
        res.status(200).json({ success: true, message: 'Contacto actualizado correctamente.' });

    } catch (error) {
        console.error('Error al actualizar el contacto:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el contacto.' });
    }
});

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

// --- ENDPOINTS PARA NOTAS INTERNAS ---
app.post('/api/contacts/:contactId/notes', async (req, res) => {
    const { contactId } = req.params;
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ success: false, message: 'El texto de la nota no puede estar vacío.' });
    }

    try {
        const noteRef = db.collection('contacts_whatsapp').doc(contactId).collection('notes');
        await noteRef.add({
            text: text,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.status(201).json({ success: true, message: 'Nota guardada correctamente.' });
    } catch (error) {
        console.error('Error al guardar la nota:', error);
        res.status(500).json({ success: false, message: 'Error al guardar la nota.' });
    }
});

app.put('/api/contacts/:contactId/notes/:noteId', async (req, res) => {
    const { contactId, noteId } = req.params;
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ success: false, message: 'El texto de la nota no puede estar vacío.' });
    }

    try {
        const noteRef = db.collection('contacts_whatsapp').doc(contactId).collection('notes').doc(noteId);
        await noteRef.update({ text: text });
        res.status(200).json({ success: true, message: 'Nota actualizada correctamente.' });
    } catch (error) {
        console.error('Error al actualizar la nota:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar la nota.' });
    }
});

app.delete('/api/contacts/:contactId/notes/:noteId', async (req, res) => {
    const { contactId, noteId } = req.params;

    try {
        const noteRef = db.collection('contacts_whatsapp').doc(contactId).collection('notes').doc(noteId);
        await noteRef.delete();
        res.status(200).json({ success: true, message: 'Nota eliminada correctamente.' });
    } catch (error) {
        console.error('Error al eliminar la nota:', error);
        res.status(500).json({ success: false, message: 'Error al eliminar la nota.' });
    }
});

// --- ENDPOINTS PARA RESPUESTAS RÁPIDAS ---
app.get('/api/quick-replies', async (req, res) => {
    try {
        const snapshot = await db.collection('quick_replies').orderBy('shortcut').get();
        const replies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(replies);
    } catch (error) {
        console.error('Error al obtener respuestas rápidas:', error);
        res.status(500).json({ success: false, message: 'Error del servidor.' });
    }
});

app.post('/api/quick-replies', async (req, res) => {
    const { shortcut, message } = req.body;

    if (!shortcut || !message) {
        return res.status(400).json({ success: false, message: 'El atajo y el mensaje son obligatorios.' });
    }

    try {
        const existingReply = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existingReply.empty) {
            return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya existe.` });
        }

        const newReply = await db.collection('quick_replies').add({
            shortcut: shortcut,
            message: message,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(201).json({ success: true, id: newReply.id });
    } catch (error) {
        console.error('Error al crear respuesta rápida:', error);
        res.status(500).json({ success: false, message: 'Error del servidor.' });
    }
});

// --- ENDPOINT PARA BOT DE IA ---
app.post('/api/contacts/:contactId/generate-reply', async (req, res) => {
    const { contactId } = req.params;

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ success: false, message: 'La API Key de Gemini no está configurada en el servidor.' });
    }

    try {
        // 1. Obtener historial de la conversación
        const messagesRef = db.collection('contacts_whatsapp').doc(contactId).collection('messages');
        const messagesSnapshot = await messagesRef.orderBy('timestamp', 'desc').limit(10).get();
        
        if (messagesSnapshot.empty) {
            return res.status(400).json({ success: false, message: 'No hay mensajes en esta conversación.' });
        }

        const conversationHistory = messagesSnapshot.docs
            .map(doc => {
                const data = doc.data();
                const sender = data.from === contactId ? 'Cliente' : 'Asistente';
                return `${sender}: ${data.text}`;
            })
            .reverse() // Ordenar de más antiguo a más reciente
            .join('\n');

        // 2. Construir el prompt para Gemini
        const prompt = `Eres un asistente virtual amigable y servicial para un CRM de ventas. Tu objetivo es ayudar a cerrar ventas y resolver dudas de los clientes. A continuación se presenta el historial de una conversación. Responde al último mensaje del cliente de manera concisa, profesional y útil.\n\n--- Historial de la Conversación ---\n${conversationHistory}\n\n--- Tu Respuesta ---\nAsistente:`;

        // 3. Llamar a la API de Gemini
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
        
        const payload = {
            contents: [{
                parts: [{ text: prompt }]
            }]
        };

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.text();
            console.error('Error de la API de Gemini:', errorBody);
            throw new Error(`La API de Gemini respondió con el estado: ${geminiResponse.status}`);
        }

        const result = await geminiResponse.json();
        const generatedText = result.candidates[0]?.content?.parts[0]?.text?.trim();

        if (!generatedText) {
            throw new Error('No se recibió una respuesta válida de la IA.');
        }

        // 4. Enviar la respuesta generada vía WhatsApp
        const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
        const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
        const messagePayload = { messaging_product: 'whatsapp', to: contactId, type: 'text', text: { body: generatedText } };

        const response = await axios.post(url, messagePayload, { headers });
        const messageId = response.data.messages[0].id;
        
        // 5. Guardar el mensaje enviado en Firestore
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        const messageToSave = {
            from: PHONE_NUMBER_ID, 
            status: 'sent', 
            timestamp: timestamp, 
            id: messageId,
            text: generatedText
        };
        
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        await contactRef.collection('messages').add(messageToSave);
        await contactRef.update({
            lastMessage: generatedText,
            lastMessageTimestamp: timestamp,
            unreadCount: 0 
        });

        res.status(200).json({ success: true, message: 'Respuesta generada y enviada con éxito.' });

    } catch (error) {
        console.error('Error al generar respuesta con IA:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al generar la respuesta.' });
    }
});


app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
