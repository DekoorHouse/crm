// indexconc.js — Versión con atribución robusta para CTWA

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
🔐 *Más de 500 referencias en Facebook* ✅❤️
💰 *Pago en Oxxo o por transferencia*

✨ El regalo que le recordará tu amor todos los días ✨
📷 *SIN ANTICIPO* paga hasta que este terminado antes de enviar

*¿Qué nombres quieres que lleve la suya?* 😃`,
};

// --- HELPERS ---
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
  const normalizedData = typeof data === 'string' ? data.toLowerCase().replace(/\s/g, '') : data.toString();
  return crypto.createHash('sha256').update(normalizedData).digest('hex');
}

// --- Envío de eventos CAPI ---
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
    if (contactInfo.profile?.name) userData.fn = sha256(contactInfo.profile.name);
  } catch (hashError) {
    console.error(`❌ Error al hashear los datos del usuario para el evento '${eventName}':`, hashError);
    throw new Error(`Falló la preparación de datos para el evento '${eventName}'.`);
  }

  // ✅ ATRIBUCIÓN ROBUSTA:
  // Consideramos anuncio si hay source_type === 'ad' o existe source_id.
  const isAdReferral = !!(referralInfo && (referralInfo.source_type === 'ad' || referralInfo.source_id));

  // Añadimos ctwa_clid si lo tenemos, pero NO lo exigimos para la atribución.
  if (referralInfo?.ctwa_clid) userData.ctwa_clid = referralInfo.ctwa_clid;

  const finalCustomData = {
    lead_source: isAdReferral ? 'WhatsApp Ad' : 'WhatsApp Organic',
    ad_headline: isAdReferral ? referralInfo?.headline : undefined,
    ad_id: isAdReferral ? referralInfo?.source_id : undefined,
    ...customData
  };
  Object.keys(finalCustomData).forEach(k => finalCustomData[k] === undefined && delete finalCustomData[k]);

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

  if (isAdReferral && referralInfo?.fbc) {
    payload.data[0].fbc = referralInfo.fbc;
  }

  try {
    console.log(`Enviando evento '${eventName}' para ${contactInfo.wa_id}. Payload:`, JSON.stringify(payload, null, 2));
    await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${META_CAPI_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } });
    console.log(`✅ Evento '${eventName}' enviado a Meta.`);
  } catch (error) {
    console.error(`❌ Error al enviar evento '${eventName}' a Meta.`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    throw new Error(`Falló el envío del evento '${eventName}' a Meta.`);
  }
};

// --- WhatsApp helpers ---
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
  const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
  try {
    const response = await axios.post(url, payload, { headers });
    return response.data.messages[0].id;
  } catch (error) {
    console.error(`Error al enviar mensaje de WhatsApp a ${to}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    throw error;
  }
}

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
    await file.save(imageBuffer, { metadata: { contentType: mimeType } });

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

      // =================== NUEVO BLOQUE: Guardado/actualización de adReferral ===================
      // Extrae ctwa_clid si viene directo o como query param en source_url
      let adReferral = null;
      if (message.referral) {
        const ref = message.referral;
        let parsedCtwa = null;
        try {
          const u = new URL(ref.source_url || '');
          parsedCtwa = u.searchParams.get('ctwa_clid');
        } catch { /* noop */ }

        adReferral = {
          source_id: ref.source_id ?? null,
          headline: ref.headline ?? null,
          source_type: ref.source_type ?? null,
          source_url: ref.source_url ?? null,
          // En WhatsApp muchas veces no aplica fbc; lo conservamos por compatibilidad si algún día llega
          fbc: ref.ref ?? null,
          // Preferimos el campo directo si existe; si no, el de la URL; si no, null
          ctwa_clid: ref.ctwa_clid ?? parsedCtwa ?? null,
          receivedAt: timestamp
        };
      }
      // ============================================================================================

      // Datos del contacto + mensaje
      const contactData = {
        lastMessageTimestamp: timestamp,
        name: contactInfo.profile.name,
        wa_id: contactInfo.wa_id,
        unreadCount: admin.firestore.FieldValue.increment(1),
        ...(adReferral ? { adReferral } : {})
      };

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
      } catch (error) {
        console.error("Error procesando contenido del mensaje:", error.message);
      }

      await contactRef.collection('messages').add(messageData);
      contactData.lastMessage = lastMessageText;
      // 🔁 Merge: esto actualiza adReferral también para contactos existentes
      await contactRef.set(contactData, { merge: true });
      console.log(`Mensaje (${message.type}) de ${from} guardado.`);

      // Evento Lead solo al primer contacto que llega con referral de anuncio
      if (isNewContact && adReferral) {
        try {
          await sendConversionEvent('Lead', contactInfo, adReferral);
          await contactRef.update({ leadEventSent: true });
        } catch (error) {
          console.error(`Fallo al enviar evento Lead para ${from}:`, error.message);
        }
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
      } catch (error) {
        console.error(`Error al actualizar estado del mensaje ${statusUpdate.id}:`, error);
      }
    }
  }
  res.sendStatus(200);
});

// --- Helpers para plantillas ---
async function buildTemplatePayload(contactId, template) {
  const contactRef = db.collection('contacts_whatsapp').doc(contactId);
  let messageToSaveText = `📄 Plantilla: ${template.name}`;

  const payload = {
    messaging_product: 'whatsapp',
    to: contactId,
    type: 'template',
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
    const templates = response.data.data
      .filter(t => t.status !== 'REJECTED')
      .map(t => ({ name: t.name, language: t.language, status: t.status, category: t.category, components: t.components.map(c => ({ type: c.type, text: c.text })) }));
    res.status(200).json({ success: true, templates });
  } catch (error) {
    console.error('Error al obtener plantillas de WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    res.status(500).json({ success: false, message: 'Error al obtener las plantillas de WhatsApp.' });
  }
});

// --- ENDPOINT PARA GENERAR RESPUESTA (IA) ---
app.post('/api/contacts/:contactId/generate-reply', async (req, res) => {
  const { contactId } = req.params;
  if (!GEMINI_API_KEY) return res.status(500).json({ success: false, message: 'La API Key de Gemini no está configurada.' });
  try {
    const messagesSnapshot = await db.collection('contacts_whatsapp').doc(contactId).collection('messages').orderBy('timestamp', 'desc').limit(10).get();
    if (messagesSnapshot.empty) return res.status(400).json({ success: false, message: 'No hay mensajes en esta conversación.' });

    const conversationHistory = messagesSnapshot.docs.map(doc => {
      const d = doc.data();
      return `${d.from === contactId ? 'Cliente' : 'Asistente'}: ${d.text}`;
    }).reverse().join('\n');

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

// --- RUTA PARA SERVIR EL FRONT ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
