// index.js - VERSIÓN CON SOLUCIÓN FINAL PARA PLANTILLAS ESTÁTicas Y DINÁMICAS

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
const { v4: uuidv4 } = require('uuid'); // Necesario para nombres de archivo únicos

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
    process.exit(1); // Detiene la aplicación si Firebase no puede inicializar
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const bucket = getStorage().bucket();

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


// =================================================================
// === INICIO: LÓGICA DE MAYOREO (CÓDIGO FUSIONADO) ================
// =================================================================

// Estado por conversación (guárdalo en tu store por chatId)
const wsState = new Map(); // chatId -> { lastIds: {askQty:'', hold:'',}, awaitingAgent:false, lastTime:0 }

const askQtyVariants = [
  "¡Súper! 🙌 ¿Cuántas piezas estás pensando?",
  "Claro, te apoyo con precio por volumen 🙌 ¿Cuántas unidades te interesan?",
  "Perfecto 👌 Para cotizar mejor, ¿qué cantidad tienes en mente?",
  "Sí manejamos precio por cantidad 😉 ¿Cuántas piezas buscas?",
  "De lujo ✨ ¿Sobre cuántas piezas estaríamos hablando?",
  "Con gusto 💬 ¿Cuántas unidades te gustaría pedir?"
];

const holdVariants = [
  "¡Perfecto! 🙌 Dame un momento para checar el costo 💻.",
  "Genial, lo reviso y te confirmo en un momento ⏳.",
  "Gracias, verifico el precio y te escribo enseguida 🧮.",
  "Excelente, déjame consultar el costo y regreso contigo ✍️."
];

function chooseVariant(list, avoid) {
  const pool = list.filter(v => v !== avoid);
  return pool[Math.floor(Math.random() * pool.length)];
}

function hasWholesaleIntent(text) {
  const t = text.toLowerCase();
  return /(mayoreo|precio de mayoreo|al por mayor|varias piezas|precio por cantidad|descuento por volumen)/i.test(t);
}

function extractQuantity(text) {
  // números como “50”, “120”, “2”, “20-30”
  const m = text.match(/\b(\d{1,5})(?:\s*-\s*\d{1,5})?\b/);
  return m ? m[0] : null;
}

function handleWholesaleMessage(chatId, userText, isAgentMessage=false) {
  const now = Date.now();
  const state = wsState.get(chatId) || { lastIds:{askQty:'', hold:''}, awaitingAgent:false, lastTime:0 };

  // Si escribe un agente, desbloquear
  if (isAgentMessage) {
    state.awaitingAgent = false;
    wsState.set(chatId, state);
    return null; // la IA no responde; sigue el agente
  }

  // Si estamos en pausa, no responder
  if (state.awaitingAgent) return null;

  // 1) Detectar intención de mayoreo
  if (hasWholesaleIntent(userText)) {
    const qty = extractQuantity(userText);

    // Caso: preguntan “¿cuántas piezas es mayoreo?”
    if (/cu[aá]ntas piezas.*mayoreo/i.test(userText)) {
      const msg = chooseVariant(askQtyVariants, state.lastIds.askQty);
      state.lastIds.askQty = msg;
      wsState.set(chatId, state);
      return msg.replace("¿Cuántas piezas estás pensando?", "¿Cuántas piezas tienes en mente?");
    }

    // 2) Si no hay cantidad aún → preguntar cantidad (con variación)
    if (!qty) {
      const msg = chooseVariant(askQtyVariants, state.lastIds.askQty);
      state.lastIds.askQty = msg;
      wsState.set(chatId, state);
      return msg;
    }

    // 3) Si ya hay cantidad → mandar “hold” y pausar
    const hold = chooseVariant(holdVariants, state.lastIds.hold);
    state.lastIds.hold = hold;
    state.awaitingAgent = true;
    state.lastTime = now;
    wsState.set(chatId, state);
    return hold;
  }

  // Si no es mayoreo, deja que el flujo normal (tu LLM) responda
  wsState.set(chatId, state);
  return undefined; // continúa con tu lógica estándar
}

// =================================================================
// === FIN: LÓGICA DE MAYOREO ======================================
// =================================================================


// === INICIO: Proxy de Medios para audios, videos y documentos de WhatsApp ===
app.get("/api/wa/media/:mediaId", async (req, res) => {
  try {
    const { mediaId } = req.params;
    if (!WHATSAPP_TOKEN) {
        return res.status(500).json({ error: "WhatsApp Token no configurado en el servidor." });
    }
    // 1. Obtener la URL temporal del medio desde la API de Meta
    const metaResponse = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });

    const mediaUrl = metaResponse.data?.url;
    if (!mediaUrl) {
      return res.status(404).json({ error: "URL del medio no encontrada." });
    }

    // 2. Hacer streaming del contenido del medio al cliente
    const mediaContentResponse = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      responseType: "stream",
    });

    // Establecer los encabezados de la respuesta para el cliente
    res.setHeader("Content-Type", mediaContentResponse.headers["content-type"] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store"); // No guardar en caché estos medios

    // Enviar el stream de datos al cliente
    mediaContentResponse.data.pipe(res);

  } catch (err) {
    console.error("ERROR EN PROXY DE MEDIOS:", err?.response?.data || err.message);
    res.status(500).json({ error: "No se pudo obtener el medio." });
  }
});
// === FIN: Proxy de Medios ===


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
                return `✅ _¡Excelente!_ 🎉

✅ *¡Ya hemos enviado varias veces a tu zona!* 📦✨

Mañana te enviaremos la foto de tu pedido personalizado para que puedas realizar tu pago y enviarlo.✨

El ENVIO ES GRATIS y *tu pedido llegará entre 5 y 7 días hábiles* (sin contar sábados ni domingos) después de que recibamos tu pago  y enviemos la guia de envio. 🚛💨 ${postalCode}.`;
            } else {
                console.log(`[LOG] Cobertura NO encontrada para ${postalCode}.`);
                return `Disculpa ya has recibido pedidos por paqueteria antes alli? ${postalCode}.

Por cual pauqteria?`;
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


// --- LÓGICA CENTRAL DEL BOT DE IA (MODIFICADA) ---
async function triggerAutoReplyAI(message, contactRef, contactData) {
    const contactId = contactRef.id;
    console.log(`[AI] Iniciando proceso de IA para ${contactId}.`);

    try {
        // 1. Verificar si el bot debe actuar
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

        // 2. Determinar qué instrucciones usar (específicas del anuncio o generales)
        let botInstructions = 'Eres un asistente virtual amigable y servicial.'; // Default
        const adId = contactData.adReferral?.source_id;

        if (adId) {
            const adPromptSnapshot = await db.collection('ai_ad_prompts').where('adId', '==', adId).limit(1).get();
            if (!adPromptSnapshot.empty) {
                botInstructions = adPromptSnapshot.docs[0].data().prompt;
                console.log(`[AI] Usando prompt específico para Ad ID: ${adId}`);
            } else {
                console.log(`[AI] No se encontró prompt para Ad ID: ${adId}. Usando instrucciones generales.`);
                const botSettingsDoc = await db.collection('crm_settings').doc('bot').get();
                if (botSettingsDoc.exists) {
                    botInstructions = botSettingsDoc.data().instructions;
                }
            }
        } else {
            const botSettingsDoc = await db.collection('crm_settings').doc('bot').get();
            if (botSettingsDoc.exists) {
                botInstructions = botSettingsDoc.data().instructions;
            }
        }

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

// --- FUNCIÓN GENÉRICA PARA ENVIAR EVENTOS DE CONVERSIÓN (CORREGIDA) ---
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


// --- FUNCIÓN DE ENVÍO AVANZADO DE MENSAJES A WHATSAPP ---
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
        if (text) {
            mediaObject.caption = text;
        }

        messagePayload = { messaging_product: 'whatsapp', to, type, [type]: mediaObject };
        messageToSaveText = text || (type === 'image' ? '📷 Imagen' :
                                     type === 'video' ? '🎥 Video' :
                                     type === 'audio' ? '🎵 Audio' : '📄 Documento');

    } else if (text) {
        messagePayload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
        messageToSaveText = text;
    } else {
        throw new Error("Se requiere texto o un archivo (fileUrl y fileType) para enviar un mensaje.");
    }

    if (reply_to_wamid) {
        messagePayload.context = { message_id: reply_to_wamid };
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


// --- WEBHOOK DE WHATSAPP (VERIFICACIÓN) ---
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


// --- FUNCIÓN PARA MANEJAR CÓDIGOS POSTALES ---
async function handlePostalCodeAuto(message, contactRef, from) {
    if (message.type !== 'text') return false;

    const postalCodeRegex = /(?:cp|código postal|codigo postal|cp:)\s*(\d{5})|(\d{5})/i;
    const match = message.text.body.match(postalCodeRegex);

    const postalCode = match ? (match[1] || match[2]) : null;

    if (postalCode) {
        console.log(`[CP] Código postal detectado: ${postalCode} para ${from}.`);
        try {
            const coverageResponse = await checkCoverage(postalCode);
            if (coverageResponse) {
                await sendAutoMessage(contactRef, { text: coverageResponse });
                return true; // Indica que el mensaje fue manejado
            }
        } catch (error) {
            console.error(`❌ Fallo al procesar CP para ${from}:`, error.message);
        }
    }
    return false; // No se encontró o no se pudo manejar un CP
}

// --- FUNCIÓN AUXILIAR PARA ENVIAR Y GUARDAR MENSAJES AUTOMÁTICOS ---
async function sendAutoMessage(contactRef, { text, fileUrl, fileType }) {
    const sentMessageData = await sendAdvancedWhatsAppMessage(contactRef.id, { text, fileUrl, fileType });
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
    console.log(`[AUTO] Mensaje automático enviado a ${contactRef.id}.`);
}

// --- LÓGICA DEL WEBHOOK PRINCIPAL (CORREGIDA Y CON UBICACIÓN) ---
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (value && value.messages && value.contacts) {
        const message = value.messages[0];
        const contactInfo = value.contacts[0];
        const from = message.from;
        const contactRef = db.collection('contacts_whatsapp').doc(from);

        if (from === PHONE_NUMBER_ID) {
            return res.sendStatus(200);
        }

        if (message.type === 'reaction') {
            const originalMessageId = message.reaction.message_id;
            const reactionEmoji = message.reaction.emoji || null;
            const messagesQuery = await contactRef.collection('messages').where('id', '==', originalMessageId).limit(1).get();

            if (!messagesQuery.empty) {
                const messageDocRef = messagesQuery.docs[0].ref;
                await messageDocRef.update({ reaction: reactionEmoji || admin.firestore.FieldValue.delete() });
            }
            return res.sendStatus(200);
        }

        const messageData = {
            timestamp: admin.firestore.Timestamp.fromMillis(parseInt(message.timestamp) * 1000),
            from,
            status: 'received',
            id: message.id,
            type: message.type,
            context: message.context || null
        };

        if (message.type === 'text') {
            messageData.text = message.text.body;
        } else if (message.type === 'image' && message.image?.id) {
            messageData.fileUrl = `/api/wa/media/${message.image.id}`;
            messageData.fileType = message.image.mime_type || 'image/jpeg';
            messageData.text = message.image.caption || '📷 Imagen';
        } else if (message.type === 'video' && message.video?.id) {
            messageData.fileUrl = `/api/wa/media/${message.video.id}`;
            messageData.fileType = message.video.mime_type || 'video/mp4';
            messageData.text = message.video.caption || '🎥 Video';
        } else if (message.type === 'audio' && message.audio?.id) {
            messageData.mediaProxyUrl = `/api/wa/media/${message.audio.id}`;
            messageData.text = message.audio.voice ? "🎤 Mensaje de voz" : "🎵 Audio";
        } else if (message.type === 'location') {
            messageData.location = message.location;
            messageData.text = `📍 Ubicación: ${message.location.name || 'Ver en mapa'}`;
        } else {
            messageData.text = `Mensaje multimedia (${message.type})`;
        }

        await contactRef.collection('messages').add(messageData);

        const contactUpdateData = {
            name: contactInfo.profile?.name || from,
            wa_id: contactInfo.wa_id,
            lastMessage: messageData.text,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            unreadCount: admin.firestore.FieldValue.increment(1)
        };
        if (message.referral) {
            contactUpdateData.adReferral = message.referral;
        }

        const previousDoc = await contactRef.get();
        const isNewContact = !previousDoc.exists;

        await contactRef.set(contactUpdateData, { merge: true });
        console.log(`[LOG] Contacto y mensaje de ${from} guardados.`);

        const updatedContactData = (await contactRef.get()).data(); // Get the merged data

        // --- INICIO: INTEGRACIÓN DE LÓGICA DE MAYOREO ---
        if (message.type === 'text') {
            const wholesaleResponse = handleWholesaleMessage(from, message.text.body);
            if (wholesaleResponse) {
                console.log(`[MAYOREO] Respuesta generada para ${from}: "${wholesaleResponse}"`);
                await sendAutoMessage(contactRef, { text: wholesaleResponse });
                return res.sendStatus(200); // Detiene el flujo aquí
            }
        }
        // --- FIN: INTEGRACIÓN DE LÓGICA DE MAYOREO ---


        const cpHandled = await handlePostalCodeAuto(message, contactRef, from);
        if (cpHandled) {
            return res.sendStatus(200);
        }

        if (isNewContact) {
            let adResponseSent = false;
            if (message.referral?.source_type === 'ad' && message.referral.source_id) {
                const adId = message.referral.source_id;
                const snapshot = await db.collection('ad_responses').where('adId', '==', adId).limit(1).get();
                if (!snapshot.empty) {
                    const adResponseData = snapshot.docs[0].data();
                    await sendAutoMessage(contactRef, { text: adResponseData.message, fileUrl: adResponseData.fileUrl, fileType: adResponseData.fileType });
                    adResponseSent = true;
                }
            }

            if (!adResponseSent) {
                await sendAutoMessage(contactRef, { text: GENERAL_WELCOME_MESSAGE });
                await contactRef.update({ welcomed: true });
            }
        } else {
             await triggerAutoReplyAI(message, contactRef, updatedContactData);
        }

    } else if (value && value.statuses) {
      const statusUpdate = value.statuses[0];
      const messageId = statusUpdate.id;
      const recipientId = statusUpdate.recipient_id;
      const newStatus = statusUpdate.status;

      try {
        const messagesRef = db.collection('contacts_whatsapp').doc(recipientId).collection('messages');
        const snap = await messagesRef.where('id', '==', messageId).limit(1).get();
        if (!snap.empty) {
          const messageDoc = snap.docs[0];
          const currentStatus = messageDoc.data().status;
          const order = { sent: 1, delivered: 2, read: 3 };
          if ((order[newStatus] || 0) > (order[currentStatus] || 0)) {
            await messageDoc.ref.update({ status: newStatus });
            console.log(`[LOG] Estado del mensaje ${messageId} -> '${newStatus}' para ${recipientId}.`);
          }
        }
      } catch (error) { console.error(`❌ Error al actualizar estado ${messageId}:`, error.message); }
    }
  } catch (error) {
    console.error('❌ ERROR CRÍTICO EN EL WEBHOOK:', error);
  } finally {
    res.sendStatus(200);
  }
});


// --- START: SIMULATOR ENDPOINT ---
app.post('/api/test/simulate-ad-message', async (req, res) => {
    const { from, adId, text } = req.body;

    if (!from || !adId || !text) {
        return res.status(400).json({ success: false, message: 'Faltan los parámetros: from, adId, text.' });
    }

    const fakePayload = {
        object: 'whatsapp_business_account',
        entry: [{
            id: WHATSAPP_BUSINESS_ACCOUNT_ID,
            changes: [{
                value: {
                    messaging_product: 'whatsapp',
                    metadata: {
                        display_phone_number: PHONE_NUMBER_ID.slice(2),
                        phone_number_id: PHONE_NUMBER_ID
                    },
                    contacts: [{
                        profile: {
                            name: `Test User ${from.slice(-4)}`
                        },
                        wa_id: from
                    }],
                    messages: [{
                        from: from,
                        id: `wamid.TEST_${uuidv4()}`,
                        timestamp: Math.floor(Date.now() / 1000).toString(),
                        text: {
                            body: text
                        },
                        type: 'text',
                        referral: {
                            source_url: `https://fb.me/xxxxxxxx`,
                            source_type: 'ad',
                            source_id: adId,
                            headline: 'Anuncio de Prueba'
                        }
                    }]
                },
                field: 'messages'
            }]
        }]
    };

    try {
        console.log(`[SIMULATOR] Recibida simulación para ${from} desde Ad ID ${adId}.`);
        await axios.post(`http://localhost:${PORT}/webhook`, fakePayload, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log(`[SIMULATOR] Simulación para ${from} enviada al webhook con éxito.`);
        res.status(200).json({ success: true, message: 'Simulación procesada correctamente.' });

    } catch (error) {
        console.error('❌ ERROR EN EL SIMULADOR AL ENVIAR AL WEBHOOK:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Error interno al procesar la simulación.' });
    }
});
// --- END: SIMULATOR ENDPOINT ---


// ====================================================================================
// === INICIO: FUNCIÓN UNIFICADA PARA CONSTRUIR PAYLOADS DE PLANTILLAS (CORREGIDA) ===
// ====================================================================================
async function buildAdvancedTemplatePayload(contactId, templateObject, imageUrl = null) {
    console.log('[DIAGNÓSTICO] Objeto de plantilla recibido por buildAdvancedTemplatePayload:', JSON.stringify(templateObject, null, 2));

    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    const contactDoc = await contactRef.get();
    const contactName = contactDoc.exists && contactDoc.data().name ? contactDoc.data().name : 'Cliente';
    const templateName = templateObject.name;

    const payloadComponents = [];
    let messageToSaveText = `📄 Plantilla: ${templateName}`;

    // Find components from the template definition
    const headerDef = templateObject.components?.find(c => c.type === 'HEADER');
    const bodyDef = templateObject.components?.find(c => c.type === 'BODY');
    const buttonsDef = templateObject.components?.find(c => c.type === 'BUTTONS');

    // 1. Process HEADER
    if (headerDef && headerDef.format === 'IMAGE') {
        if (imageUrl) {
            payloadComponents.push({
                type: 'header',
                parameters: [{ type: 'image', image: { link: imageUrl } }]
            });
            messageToSaveText = `🖼️ Plantilla con imagen: ${templateName}`;
        } else {
            console.warn(`[Advertencia] La plantilla '${templateName}' requiere una imagen, pero no se proporcionó una URL. La cabecera no se enviará, lo que probablemente causará un fallo.`);
        }
    }
    // Add logic for TEXT header with variable if needed
    if (headerDef && headerDef.format === 'TEXT' && headerDef.text?.includes('{{1}}')) {
         payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'text', text: "Valor de cabecera" }] // NOTE: Needs a value source
        });
    }


    // 2. Process BODY
   if (bodyDef) {
    const bodyVars = bodyDef.text?.match(/\{\{\d\}\}/g) || [];
    if (bodyVars.length > 0) {
        payloadComponents.push({
            type: 'body',
            parameters: [{ type: 'text', text: contactName }]
        });
        messageToSaveText = bodyDef.text.replace(/\{\{1\}\}/g, contactName);
    } else {
        // CORRECCIÓN: Agregar el componente body incluso sin variables
        payloadComponents.push({
            type: 'body',
            parameters: []
        });
        messageToSaveText = bodyDef.text || messageToSaveText;
    }
}

    // 3. Process BUTTONS
    if (buttonsDef && buttonsDef.buttons) {
        buttonsDef.buttons.forEach((button, index) => {
            if (button.type === 'URL' && button.url?.includes('{{1}}')) {
                payloadComponents.push({
                    type: 'button',
                    sub_type: 'url',
                    index: index.toString(),
                    parameters: [{ type: 'text', text: contactId }] // Assumes button variable is contactId
                });
            }
        });
    }

    // Final payload assembly
    const payload = {
        messaging_product: 'whatsapp',
        to: contactId,
        type: 'template',
        template: {
            name: templateName,
            language: { code: templateObject.language },
        }
    };

    if (payloadComponents.length > 0) {
        payload.template.components = payloadComponents;
    }

    return { payload, messageToSaveText };
}
// ====================================================================================
// === FIN: FUNCIÓN UNIFICADA =======================================================
// ====================================================================================


// --- ENDPOINT PARA ENVIAR MENSAJES MANUALMENTE (MODIFICADO) ---
app.post('/api/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid, template } = req.body;

    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
    if (!text && !fileUrl && !template) return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);

        if (template) {
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template);
            
            if (reply_to_wamid) payload.context = { message_id: reply_to_wamid };
            
            console.log(`[LOG DETALLADO] Enviando plantilla individual a ${contactId}. Payload:`, JSON.stringify(payload, null, 2));

            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
            });
            const messageId = response.data.messages[0].id;

            const messageToSave = { from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(), id: messageId, text: messageToSaveText };
            if (reply_to_wamid) messageToSave.context = { id: reply_to_wamid };
            await contactRef.collection('messages').add(messageToSave);
            await contactRef.update({ lastMessage: messageToSaveText, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), unreadCount: 0 });

        } else { 
            const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text, fileUrl, fileType, reply_to_wamid });

            const messageToSave = {
                from: PHONE_NUMBER_ID,
                status: 'sent',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: sentMessageData.id,
                text: sentMessageData.textForDb,
                fileUrl: sentMessageData.fileUrlForDb,
                fileType: sentMessageData.fileTypeForDb
            };

            if (reply_to_wamid) messageToSave.context = { id: reply_to_wamid };
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


// --- ENDPOINT PARA CAMPAÑAS (MODIFICADO PARA USAR LA NUEVA FUNCIÓN) ---
app.post('/api/campaigns/send-template', async (req, res) => {
    const { contactIds, template } = req.body;
    if (!contactIds?.length || !template) return res.status(400).json({ success: false, message: 'Se requieren IDs y una plantilla.' });

    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    const results = { successful: [], failed: [] };

    const promises = contactIds.map(contactId => (async () => {
        try {
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template);
            
            console.log(`[LOG DETALLADO] Enviando plantilla de campaña (solo texto) a ${contactId}. Payload:`, JSON.stringify(payload, null, 2));

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

// =================================================================
// === ENDPOINT PARA PLANTILLAS CON IMAGEN (MODIFICADO)         ===
// =================================================================
app.post('/api/campaigns/send-template-with-image', async (req, res) => {
    const { contactIds, templateObject, imageUrl, phoneNumber } = req.body;

    console.log('\n--- INICIANDO ENVÍO DE CAMPAÑA CON IMAGEN ---');
    console.log('Contacto(s) objetivo:', phoneNumber ? [phoneNumber] : contactIds);
    console.log('Objeto de plantilla recibido:', JSON.stringify(templateObject, null, 2));
    console.log('URL de imagen recibida:', imageUrl);
    console.log('--------------------------------------------\n');


    if ((!contactIds || !contactIds.length) && !phoneNumber) {
        return res.status(400).json({ success: false, message: 'Se requiere una lista de IDs de contacto o un número de teléfono.' });
    }
    if (!templateObject || !templateObject.name) {
        return res.status(400).json({ success: false, message: 'Se requiere el objeto de la plantilla.' });
    }
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp en el servidor.' });
    }

    const targets = phoneNumber ? [phoneNumber] : contactIds;
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    const results = { successful: [], failed: [] };

    const promises = targets.map(async (contactId) => {
        let payload; 
        try {
            const { payload: generatedPayload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, templateObject, imageUrl);
            payload = generatedPayload;
            
            console.log(`[LOG DETALLADO] Payload final para ${contactId}:`, JSON.stringify(payload, null, 2));
            
            const response = await axios.post(url, payload, { headers });
            const messageId = response.data.messages[0].id;
            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            
            const contactRef = db.collection('contacts_whatsapp').doc(contactId);
            const contactDoc = await contactRef.get();
            if (!contactDoc.exists) {
                await contactRef.set({ 
                    name: 'Nuevo Contacto (Campaña)',
                    wa_id: contactId,
                    lastMessage: messageToSaveText,
                    lastMessageTimestamp: timestamp,
                    unreadCount: 0
                }, { merge: true });
            }

            await contactRef.collection('messages').add({
                from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId,
                text: messageToSaveText, fileUrl: imageUrl, fileType: 'image/external'
            });

            await contactRef.update({
                lastMessage: messageToSaveText, lastMessageTimestamp: timestamp, unreadCount: 0
            });

            return { status: 'fulfilled', value: contactId };
        } catch (error) {
            console.error(`❌ [FALLO DETALLADO] Fallo al enviar plantilla a ${contactId}.`);
            if(payload) {
                console.error('Payload que falló:', JSON.stringify(payload, null, 2));
            }
            console.error('Respuesta de Meta:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
            return { status: 'rejected', reason: { contactId, error: error.response ? JSON.stringify(error.response.data) : error.message } };
        }
    });

    const outcomes = await Promise.all(promises);
    outcomes.forEach(o => o.status === 'fulfilled' ? results.successful.push(o.value) : results.failed.push(o.reason));
    
    res.status(200).json({ 
        success: true, 
        message: `Campaña con imagen procesada. Enviados: ${results.successful.length}. Fallidos: ${results.failed.length}.`, 
        results 
    });
});
// =================================================================
// === FIN: ENDPOINT CORREGIDO =====================================
// =================================================================


// --- ENDPOINT PARA OBTENER PLANTILLAS DE WHATSAPP (CORREGIDO) ---
app.get('/api/whatsapp-templates', async (req, res) => {
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp Business.' });
    const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    try {
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
        const templates = response.data.data
            .filter(t => t.status === 'APPROVED') // Solo plantillas aprobadas
            .map(t => ({ 
                name: t.name, 
                language: t.language, 
                status: t.status, 
                category: t.category, 
                // CORRECCIÓN: Mapear correctamente los componentes incluyendo el 'format'
                components: t.components.map(c => ({ 
                    type: c.type, 
                    text: c.text,
                    format: c.format, // Esta línea es la corrección clave
                    buttons: c.buttons // Se añade para poder inspeccionar los botones
                })) 
            }));
        res.status(200).json({ success: true, templates });
    } catch (error) {
        console.error('Error al obtener plantillas de WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al obtener las plantillas de WhatsApp.' });
    }
});

// --- INICIO DE LA MODIFICACIÓN DE REACCIONES ---
app.post('/api/contacts/:contactId/messages/:messageDocId/react', async (req, res) => {
    const { contactId, messageDocId } = req.params;
    const { reaction } = req.body; // reaction puede ser un emoji o null para quitarla

    try {
        const messageRef = db.collection('contacts_whatsapp').doc(contactId).collection('messages').doc(messageDocId);
        const messageDoc = await messageRef.get();

        if (!messageDoc.exists) {
            return res.status(404).json({ success: false, message: 'Mensaje no encontrado.' });
        }

        const messageData = messageDoc.data();
        const wamid = messageData.id; // ID del mensaje de WhatsApp

        const payload = {
            messaging_product: 'whatsapp',
            to: contactId,
            type: 'reaction',
            reaction: {
                message_id: wamid,
                emoji: reaction || "" // Envía un string vacío para eliminar la reacción
            }
        };

        await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
        });

        await messageRef.update({ reaction: reaction || admin.firestore.FieldValue.delete() });

        res.status(200).json({ success: true, message: 'Reacción enviada y actualizada.' });

    } catch (error) {
        console.error('Error al enviar o actualizar la reacción:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Error del servidor al procesar la reacción.' });
    }
});
// --- FIN DE LA MODIFICACIÓN DE REACCIONES ---


// --- ENDPOINTS PARA DATOS DE CONTACTO ---
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

// --- ENDPOINTS PARA EVENTOS DE CONVERSIÓN ---
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

        await contactRef.update({
            registrationStatus: 'completed',
            registrationDate: admin.firestore.FieldValue.serverTimestamp(),
            status: 'venta'
        });

        res.status(200).json({ success: true, message: 'Contacto marcado como "Registro Completado" y etiquetado como Venta.' });
    } catch (error) {
        console.error(`Error en mark-as-registration para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar la solicitud.' });
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

app.delete('/api/tags', async (req, res) => {
    try {
        const snapshot = await db.collection('crm_tags').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: 'Error al eliminar todas las etiquetas.' }); }
});

// --- ENDPOINTS PARA RESPUESTAS DE ANUNCIOS ---
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

// --- START: ENDPOINTS PARA PROMPTS DE IA POR ANUNCIO ---
app.post('/api/ai-ad-prompts', async (req, res) => {
    const { adName, adId, prompt } = req.body;
    if (!adName || !adId || !prompt) {
        return res.status(400).json({ success: false, message: 'Nombre del anuncio, ID y prompt son obligatorios.' });
    }
    try {
        const existing = await db.collection('ai_ad_prompts').where('adId', '==', adId).limit(1).get();
        if (!existing.empty) {
            return res.status(409).json({ success: false, message: `El Ad ID '${adId}' ya tiene un prompt configurado.` });
        }
        const newPrompt = await db.collection('ai_ad_prompts').add({ adName, adId, prompt });
        res.status(201).json({ success: true, id: newPrompt.id });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor.' });
    }
});

app.put('/api/ai-ad-prompts/:id', async (req, res) => {
    const { id } = req.params;
    const { adName, adId, prompt } = req.body;
    if (!adName || !adId || !prompt) {
        return res.status(400).json({ success: false, message: 'Nombre del anuncio, ID y prompt son obligatorios.' });
    }
    try {
        const existing = await db.collection('ai_ad_prompts').where('adId', '==', adId).limit(1).get();
        if (!existing.empty && existing.docs[0].id !== id) {
            return res.status(409).json({ success: false, message: `El Ad ID '${adId}' ya está en uso.` });
        }
        await db.collection('ai_ad_prompts').doc(id).update({ adName, adId, prompt });
        res.status(200).json({ success: true, message: 'Prompt actualizado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor.' });
    }
});

app.delete('/api/ai-ad-prompts/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('ai_ad_prompts').doc(id).delete();
        res.status(200).json({ success: true, message: 'Prompt eliminado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor.' });
    }
});
// --- END: ENDPOINTS PARA PROMPTS DE IA POR ANUNCIO ---

// --- ENDPOINTS PARA AJUSTES DEL BOT Y GENERALES ---
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

// --- ENDPOINTS PARA BASE DE CONOCIMIENTO (IA) ---
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

// --- ENDPOINT PARA GENERAR RESPUESTA CON IA (MANUAL) ---
app.post('/api/contacts/:contactId/generate-reply', async (req, res) => {
    const { contactId } = req.params;
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });

        const messagesSnapshot = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(10).get();
        if (messagesSnapshot.empty) return res.status(400).json({ success: false, message: 'No hay mensajes en esta conversación.' });

        const conversationHistory = messagesSnapshot.docs.map(doc => { const d = doc.data(); return `${d.from === contactId ? 'Cliente' : 'Asistente'}: ${d.text}`; }).reverse().join('\\n');
        const prompt = `Eres un asistente virtual amigable y servicial para un CRM de ventas. Tu objetivo es ayudar a cerrar ventas y resolver dudas de los clientes. A continuación se presenta el historial de una conversación. Responde al último mensaje del cliente de manera concisa, profesional y útil.\\n\\n--- Historial ---\\n${conversationHistory}\\n\\n--- Tu Respuesta ---\\\nAsistente:`;

        const suggestion = await generateGeminiResponse(prompt);
        res.status(200).json({ success: true, message: 'Respuesta generada.', suggestion });
    } catch (error) {
        console.error('Error al generar respuesta con IA:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al generar la respuesta.' });
    }
});

// --- NUEVO ENDPOINT PARA MÉTRICAS ---
app.get('/api/metrics', async (req, res) => {
    try {
        // 1. Definir el rango de fechas (últimos 30 días)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);

        const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endDate);

        // 2. Obtener todos los contactos para mapear ID a etiqueta (status)
        const contactsSnapshot = await db.collection('contacts_whatsapp').get();
        const contactTags = {};
        contactsSnapshot.forEach(doc => {
            contactTags[doc.id] = doc.data().status || 'sin_etiqueta';
        });

        // 3. Query de grupo para obtener todos los mensajes entrantes en el rango de fechas
        const messagesSnapshot = await db.collectionGroup('messages')
            .where('timestamp', '>=', startTimestamp)
            .where('timestamp', '<=', endTimestamp)
            .where('from', '!=', PHONE_NUMBER_ID) // CORRECCIÓN: Usar '!=' para filtrar mensajes entrantes
            .get();

        // 4. Procesar los mensajes para agruparlos por día y etiqueta
        const metricsByDate = {};

        messagesSnapshot.forEach(doc => {
            const message = doc.data();
            const timestamp = message.timestamp.toDate();
            const dateKey = timestamp.toISOString().split('T')[0]; // 'YYYY-MM-DD'

            // Inicializar el objeto para la fecha si no existe
            if (!metricsByDate[dateKey]) {
                metricsByDate[dateKey] = {
                    totalMessages: 0,
                    tags: {}
                };
            }

            // Incrementar el total de mensajes para la fecha
            metricsByDate[dateKey].totalMessages++;

            // Obtener la etiqueta del contacto que envió el mensaje
            const contactId = doc.ref.parent.parent.id;
            const tag = contactTags[contactId] || 'sin_etiqueta';

            // Incrementar el contador para esa etiqueta en esa fecha
            if (!metricsByDate[dateKey].tags[tag]) {
                metricsByDate[dateKey].tags[tag] = 0;
            }
            metricsByDate[dateKey].tags[tag]++;
        });

        // 5. Formatear la salida al formato de array deseado
        const formattedMetrics = Object.keys(metricsByDate)
            .map(date => ({
                date: date,
                totalMessages: metricsByDate[date].totalMessages,
                tags: metricsByDate[date].tags
            }))
            .sort((a, b) => new Date(a.date) - new Date(b.date)); // Ordenar por fecha

        res.status(200).json({ success: true, data: formattedMetrics });

    } catch (error) {
        console.error('❌ Error al obtener las métricas:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener las métricas.' });
    }
});


// --- RUTA PARA SERVIR LA APLICACIÓN FRONTEND ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
