const { google } = require('googleapis');
const crypto = require('crypto');
const fetch = require('node-fetch');
const axios = require('axios');
const { db, admin } = require('./config');

const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // SE AÑADIÓ ESTA LÍNEA

// =================================================================
// === LÓGICA DE MAYOREO ===========================================
// =================================================================

const wsState = new Map();
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
  const m = text.match(/\b(\d{1,5})(?:\s*-\s*\d{1,5})?\b/);
  return m ? m[0] : null;
}

function handleWholesaleMessage(chatId, userText, isAgentMessage = false) {
  const now = Date.now();
  const state = wsState.get(chatId) || { lastIds: { askQty: '', hold: '' }, awaitingAgent: false, lastTime: 0 };
  if (isAgentMessage) {
    state.awaitingAgent = false;
    wsState.set(chatId, state);
    return null;
  }
  if (state.awaitingAgent) return null;
  if (hasWholesaleIntent(userText)) {
    const qty = extractQuantity(userText);
    if (/cu[aá]ntas piezas.*mayoreo/i.test(userText)) {
      const msg = chooseVariant(askQtyVariants, state.lastIds.askQty);
      state.lastIds.askQty = msg;
      wsState.set(chatId, state);
      return msg.replace("¿Cuántas piezas estás pensando?", "¿Cuántas piezas tienes en mente?");
    }
    if (!qty) {
      const msg = chooseVariant(askQtyVariants, state.lastIds.askQty);
      state.lastIds.askQty = msg;
      wsState.set(chatId, state);
      return msg;
    }
    const hold = chooseVariant(holdVariants, state.lastIds.hold);
    state.lastIds.hold = hold;
    state.awaitingAgent = true;
    state.lastTime = now;
    wsState.set(chatId, state);
    return hold;
  }
  wsState.set(chatId, state);
  return undefined;
}

// =================================================================
// === SERVICIOS DE GOOGLE SHEETS ==================================
// =================================================================

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
                return `✅ _¡Excelente!_ 🎉\n\n✅ *¡Ya hemos enviado varias veces a tu zona!* 📦✨\n\nMañana te enviaremos la foto de tu pedido personalizado para que puedas realizar tu pago y enviarlo.✨\n\nEl ENVIO ES GRATIS y *tu pedido llegará entre 5 y 7 días hábiles* (sin contar sábados ni domingos) después de que recibamos tu pago  y enviemos la guia de envio. 🚛💨 ${postalCode}.`;
            } else {
                console.log(`[LOG] Cobertura NO encontrada para ${postalCode}.`);
                return `Disculpa ya has recibido pedidos por paqueteria antes alli? ${postalCode}.\n\nPor cual pauqteria?`;
            }
        }
        console.log(`[LOG] No se encontraron datos en la hoja para el CP ${postalCode}.`);
        return `No se encontraron datos de cobertura para verificar el código postal ${postalCode}.`;
    } catch (error) {
        console.error(`❌ [LOG] Error al leer la hoja de Google Sheets. DETALLE:`, error.message);
        if (error.code === 404) return "Error: No se encontró la hoja de cálculo. Verifica el ID en los ajustes.";
        if (error.code === 403) return "Error de permisos. Asegúrate de haber compartido la hoja con el correo de servicio y de haber habilitado la API de Google Sheets.";
        return "Hubo un problema al verificar la cobertura. Por favor, inténtalo más tarde.";
    }
}

// =================================================================
// === SERVICIOS DE IA (GEMINI) y MENSAJERÍA =======================
// =================================================================

/**
 * Función movida desde whatsappHandler.js para romper la dependencia circular.
 * Envía un mensaje de texto o multimedia a través de la API de WhatsApp.
 */
async function sendAdvancedWhatsAppMessage(to, { text, fileUrl, fileType, reply_to_wamid }) {
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let messagePayload;
    let messageToSaveText;

    const contactRef = db.collection('contacts_whatsapp').doc(to);
    const contactDoc = await contactRef.get();
    if (!contactDoc.exists) {
        console.log(`[LOG] El contacto ${to} no existe. Creando uno nuevo antes de enviar el mensaje.`);
        const contactUpdateData = {
            name: `Nuevo Contacto (${to.slice(-4)})`,
            name_lowercase: `nuevo contacto (${to.slice(-4)})`,
            wa_id: to,
            lastMessage: "Contacto creado por envío saliente.",
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            unreadCount: 0
        };
        await contactRef.set(contactUpdateData, { merge: true });
    }

    if (fileUrl && fileType) {
        const type = fileType.startsWith('image/') ? 'image' :
                     fileType.startsWith('video/') ? 'video' :
                     fileType.startsWith('audio/') ? 'audio' : 'document';

        // --- INICIO DE LA CORRECCIÓN ---
        const mediaObject = { link: fileUrl };
        // La API de WhatsApp no permite 'caption' para audios.
        if (type !== 'audio' && text) {
            mediaObject.caption = text;
        }
        // --- FIN DE LA CORRECCIÓN ---

        messagePayload = { messaging_product: 'whatsapp', to, type, [type]: mediaObject };
        messageToSaveText = text || (type === 'image' ? '📷 Imagen' :
                                     type === 'video' ? '🎥 Video' :
                                     type === 'audio' ? '🎵 Audio' : '📄 Documento');
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
        console.log(`[LOG] Intentando enviar mensaje a ${to} con payload:`, JSON.stringify(messagePayload));
        const response = await axios.post(url, messagePayload, { headers });
        console.log(`[LOG] Mensaje enviado a la API de WhatsApp con éxito para ${to}.`);
        const messageId = response.data.messages[0].id;
        return { id: messageId, textForDb: messageToSaveText, fileUrlForDb: fileUrl || null, fileTypeForDb: fileType || null };
    } catch (error) {
        console.error(`❌ Error al enviar mensaje avanzado de WhatsApp a ${to}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}

async function generateGeminiResponse(prompt) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const geminiResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!geminiResponse.ok) throw new Error(`La API de Gemini respondió con el estado: ${geminiResponse.status}`);
    const result = await geminiResponse.json();
    let generatedText = result.candidates[0]?.content?.parts[0]?.text?.trim();
    if (!generatedText) throw new Error('No se recibió una respuesta válida de la IA.');
    if (generatedText.startsWith('Asistente:')) {
        generatedText = generatedText.substring('Asistente:'.length).trim();
    }
    // Extraer metadata de uso de tokens
    const usage = result.usageMetadata || {};
    return {
        text: generatedText,
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0
    };
}

async function triggerAutoReplyAI(message, contactRef, contactData) {
    const contactId = contactRef.id;
    console.log(`[AI] Iniciando proceso de IA para ${contactId}.`);
    try {
        const generalSettingsDoc = await db.collection('crm_settings').doc('general').get();
        const globalBotActive = generalSettingsDoc.exists && generalSettingsDoc.data().globalBotActive === true;

        // --- INICIO DE MODIFICACIÓN: Lógica de activación del Bot ---
        // El bot se activa si el interruptor global está encendido (y no está anulado para este contacto),
        // O si está activado individualmente para este contacto específico.
        const isIndividuallyActive = contactData.botActive === true;
        
        const shouldRun = isIndividuallyActive;

        if (!shouldRun) {
            console.log(`[AI] El bot no está activo para ${contactId} (Global: ${globalBotActive}, Individual: ${contactData.botActive}). No se enviará respuesta.`);
            return;
        }
        // --- FIN DE MODIFICACIÓN ---

        let botInstructions = 'Eres un asistente virtual amigable y servicial.';
        const adId = contactData.adReferral?.source_id;
        if (adId) {
            const adPromptSnapshot = await db.collection('ai_ad_prompts').where('adId', '==', adId).limit(1).get();
            if (!adPromptSnapshot.empty) {
                botInstructions = adPromptSnapshot.docs[0].data().prompt;
                console.log(`[AI] Usando prompt específico para Ad ID: ${adId}`);
            } else {
                console.log(`[AI] No se encontró prompt para Ad ID: ${adId}. Usando instrucciones generales.`);
                const botSettingsDoc = await db.collection('crm_settings').doc('bot').get();
                if (botSettingsDoc.exists) botInstructions = botSettingsDoc.data().instructions;
            }
        } else {
            const botSettingsDoc = await db.collection('crm_settings').doc('bot').get();
            if (botSettingsDoc.exists) botInstructions = botSettingsDoc.data().instructions;
        }
        const knowledgeBaseSnapshot = await db.collection('ai_knowledge_base').get();
        const knowledgeBase = knowledgeBaseSnapshot.docs.map(doc => `- ${doc.data().topic}: ${doc.data().answer}`).join('\n');
        // Cargar respuestas rápidas como conocimiento adicional
        const quickRepliesSnapshot = await db.collection('quick_replies').get();
        const quickReplies = quickRepliesSnapshot.docs
            .filter(doc => doc.data().message) // Solo las que tienen texto
            .map(doc => `- ${doc.data().shortcut}: ${doc.data().message}`)
            .join('\n');
        const messagesSnapshot = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(10).get();
        const conversationHistory = messagesSnapshot.docs.map(doc => {
            const d = doc.data();
            return `${d.from === contactId ? 'Cliente' : 'Asistente'}: ${d.text}`;
        }).reverse().join('\n');
        const prompt = `
            **Instrucciones Generales:**\n${botInstructions}\n\n
            **Base de Conocimiento (Usa esta información para responder preguntas frecuentes):**\n${knowledgeBase || 'No hay información adicional.'}\n\n
            **Respuestas Rápidas del Equipo (Respuestas que los agentes humanos usan frecuentemente, úsalas como referencia):**\n${quickReplies || 'No hay respuestas rápidas.'}\n\n
            **Historial de la Conversación Reciente:**\n${conversationHistory}\n\n
            **Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;
        console.log(`[AI] Generando respuesta para ${contactId}.`);
        const aiResult = await generateGeminiResponse(prompt);
        const aiResponse = aiResult.text;
        
        // Registrar uso de tokens en Firestore (agregación diaria)
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const usageRef = db.collection('ai_usage_logs').doc(today);
        await usageRef.set({
            inputTokens: admin.firestore.FieldValue.increment(aiResult.inputTokens),
            outputTokens: admin.firestore.FieldValue.increment(aiResult.outputTokens),
            requestCount: admin.firestore.FieldValue.increment(1),
            date: today
        }, { merge: true });
        console.log(`[AI] Tokens usados - Entrada: ${aiResult.inputTokens}, Salida: ${aiResult.outputTokens}`);
        
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

// =================================================================
// === SERVICIOS DE META (API DE CONVERSIONES) =====================
// =================================================================

function sha256(data) {
    if (!data) return null;
    return crypto.createHash('sha256').update(data.toString().toLowerCase().replace(/\s/g, '')).digest('hex');
}

async function sendConversionEvent(eventName, contactInfo, referralInfo, customData = {}) {
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
    if (WHATSAPP_BUSINESS_ACCOUNT_ID) {
        userData.whatsapp_business_account_id = WHATSAPP_BUSINESS_ACCOUNT_ID;
    }
    const isAdReferral = referralInfo && referralInfo.ctwa_clid;
    if (isAdReferral) userData.ctwa_clid = referralInfo.ctwa_clid;
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
}

// SE ACTUALIZÓ LA EXPORTACIÓN
module.exports = {
    handleWholesaleMessage,
    checkCoverage,
    generateGeminiResponse,
    triggerAutoReplyAI,
    sendConversionEvent,
    sendAdvancedWhatsAppMessage
};
