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
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// Skydropx
const SKYDROPX_CLIENT_ID = process.env.SKYDROPX_CLIENT_ID;
const SKYDROPX_CLIENT_SECRET = process.env.SKYDROPX_CLIENT_SECRET;
const SKYDROPX_ZIP_ORIGIN = process.env.SKYDROPX_ZIP_ORIGIN || '34188';
const SKYDROPX_BASE_URL = 'https://pro.skydropx.com';

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

// =================================================================
// === SERVICIOS DE SKYDROPX (COTIZACIÓN DE ENVÍOS) =================
// =================================================================
let skydropxTokenCache = { token: null, expiresAt: 0 };

async function getSkydropxToken() {
    if (!SKYDROPX_CLIENT_ID || !SKYDROPX_CLIENT_SECRET) return null;
    // Usar token cacheado si aún es válido (con 5 min de margen)
    if (skydropxTokenCache.token && Date.now() < skydropxTokenCache.expiresAt - 300000) {
        return skydropxTokenCache.token;
    }
    try {
        const res = await fetch(`${SKYDROPX_BASE_URL}/api/v1/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grant_type: 'client_credentials', client_id: SKYDROPX_CLIENT_ID, client_secret: SKYDROPX_CLIENT_SECRET })
        });
        if (!res.ok) throw new Error(`Skydropx OAuth error: ${res.status}`);
        const data = await res.json();
        skydropxTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in * 1000) };
        console.log('[Skydropx] Token obtenido exitosamente.');
        return data.access_token;
    } catch (error) {
        console.error('[Skydropx] Error al obtener token:', error.message);
        return null;
    }
}

async function getShippingQuote(zipTo) {
    const token = await getSkydropxToken();
    if (!token) return null;
    try {
        // Crear cotización
        const createRes = await fetch(`${SKYDROPX_BASE_URL}/api/v1/quotations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                quotation: {
                    address_from: { country_code: 'MX', postal_code: SKYDROPX_ZIP_ORIGIN, area_level1: '-', area_level2: '-', area_level3: '-' },
                    address_to: { country_code: 'MX', postal_code: zipTo, area_level1: '-', area_level2: '-', area_level3: '-' },
                    parcel: { weight: 0.1, height: 10, width: 10, length: 10 }
                }
            })
        });
        if (!createRes.ok) throw new Error(`Skydropx quotation error: ${createRes.status}`);
        const quotation = await createRes.json();
        const quotationId = quotation.id;
        console.log(`[Skydropx] Cotización creada: ${quotationId}`);

        // Esperar y consultar resultados (máx 4 intentos, 2s entre cada uno)
        let result = quotation;
        for (let i = 0; i < 4 && !result.is_completed; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const getRes = await fetch(`${SKYDROPX_BASE_URL}/api/v1/quotations/${quotationId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            result = await getRes.json();
        }

        // Filtrar tarifas con precio
        const rates = (result.rates || []).filter(r => r.total !== null && r.status && r.status.includes('price_found'))
            .sort((a, b) => parseFloat(a.total) - parseFloat(b.total))
            .slice(0, 5); // Top 5 opciones más baratas

        if (rates.length === 0) return 'No se encontraron opciones de envío para ese código postal.';

        const ratesText = rates.map(r => `- ${r.provider_display_name} (${r.provider_service_name}): $${parseFloat(r.total).toFixed(2)} MXN, ${r.days || '?'} día(s)`).join('\n');
        console.log(`[Skydropx] ${rates.length} tarifas encontradas para CP ${zipTo}.`);
        return ratesText;
    } catch (error) {
        console.error('[Skydropx] Error al cotizar envío:', error.message);
        return null;
    }
}

// =================================================================
// === SERVICIOS DE GEMINI (IA) con Context Caching ================
// =================================================================

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const CACHE_TTL = '1800s'; // 30 minutos de TTL para el caché

// --- Estado en memoria del caché ---
let geminiCache = {
    name: null,          // Nombre del recurso del caché en Gemini (ej: "cachedContents/abc123")
    contentHash: null,   // Hash del contenido cacheado para detectar cambios
    createdAt: 0,        // Timestamp de creación
    ttlMs: 30 * 60 * 1000 // 30 minutos en ms
};

/**
 * Genera un hash simple de un string para detectar cambios en el contenido.
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convertir a entero de 32 bits
    }
    return hash.toString();
}

/**
 * Construye el texto estático del sistema (instrucciones + conocimiento + respuestas rápidas).
 * Este es el contenido que se cachea.
 */
async function buildStaticContext(botInstructions) {
    const knowledgeBaseSnapshot = await db.collection('ai_knowledge_base').get();
    const knowledgeBase = knowledgeBaseSnapshot.docs.map(doc => `- ${doc.data().topic}: ${doc.data().answer}`).join('\n');

    const quickRepliesSnapshot = await db.collection('quick_replies').get();
    const quickReplies = quickRepliesSnapshot.docs
        .filter(doc => doc.data().message)
        .map(doc => `- ${doc.data().shortcut}: ${doc.data().message}`)
        .join('\n');

    const staticText = `**Instrucciones Generales:**\n${botInstructions}\n\n**Regla Especial de Mensajes Múltiples:** SOLO usa la etiqueta [SPLIT] si tus instrucciones EXPLÍCITAMENTE dicen enviar algo "en otro mensaje", "seguido de" otro mensaje, o "en dos mensajes separados". Si NO hay una instrucción explícita de separar en varios mensajes, responde TODO en un ÚNICO mensaje. NUNCA dividas una respuesta en múltiples mensajes por tu cuenta. (Ejemplo de uso correcto: Hola, este es mi primer mensaje [SPLIT] y este es mi segundo mensaje). NO escribas "Mensaje 1:" ni cosas similares, solo la etiqueta [SPLIT].\n\n**Regla de Citar Mensajes:** Si por la naturaleza de la conversación crees que es estrictamente necesario "citar" o "responder directamente" al mensaje del cliente para que no se pierda el contexto (por ejemplo, si responde a una pregunta vieja), agerga la etiqueta [CITA] al INICIO de tu respuesta. Usa esta opción con moderación. Si el flujo es normal, simplemente responde de forma natural sin la etiqueta.\n\n**Base de Conocimiento (Usa esta información para responder preguntas frecuentes):**\n${knowledgeBase || 'No hay información adicional.'}\n\n**Respuestas Rápidas del Equipo (Respuestas que los agentes humanos usan frecuentemente, úsalas como referencia):**\n${quickReplies || 'No hay respuestas rápidas.'}`;

    return staticText;
}

/**
 * Crea o renueva el caché de contexto en la API de Gemini.
 * Solo se recrea si el contenido cambió o el TTL ha expirado.
 */
async function getOrCreateCache(botInstructions) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');

    const staticText = await buildStaticContext(botInstructions);
    const currentHash = simpleHash(staticText);
    const now = Date.now();
    const cacheExpired = (now - geminiCache.createdAt) > geminiCache.ttlMs;

    // Si el caché es válido y el contenido no cambió, reutilizarlo
    if (geminiCache.name && geminiCache.contentHash === currentHash && !cacheExpired) {
        console.log(`[CACHE] Reutilizando caché existente: ${geminiCache.name}`);
        return geminiCache.name;
    }

    // Si hay un caché viejo, intentar borrarlo (best effort)
    if (geminiCache.name) {
        try {
            await fetch(`${GEMINI_BASE_URL}/${geminiCache.name}?key=${GEMINI_API_KEY}`, { method: 'DELETE' });
            console.log(`[CACHE] Caché anterior eliminado: ${geminiCache.name}`);
        } catch (e) {
            console.warn(`[CACHE] No se pudo eliminar el caché anterior: ${e.message}`);
        }
    }

    // Crear un nuevo caché
    console.log(`[CACHE] Creando nuevo caché de contexto (hash: ${currentHash})...`);
    const cachePayload = {
        model: `models/${GEMINI_MODEL}`,
        contents: [{
            parts: [{ text: staticText }],
            role: 'user'
        }],
        systemInstruction: {
            parts: [{ text: 'Eres un asistente virtual de atención al cliente por WhatsApp. Responde de forma concisa, amigable y útil. Usa la información proporcionada en el contexto para responder.' }]
        },
        ttl: CACHE_TTL
    };

    const response = await fetch(`${GEMINI_BASE_URL}/cachedContents?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cachePayload)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`[CACHE] Error al crear caché:`, JSON.stringify(errorData));
        // Si falla el caching (ej: contenido muy corto), devolver null para usar fallback
        return null;
    }

    const cacheData = await response.json();
    geminiCache.name = cacheData.name;
    geminiCache.contentHash = currentHash;
    geminiCache.createdAt = now;

    const cachedTokens = cacheData.usageMetadata?.totalTokenCount || 'desconocido';
    console.log(`[CACHE] ✅ Caché creado exitosamente: ${cacheData.name} (${cachedTokens} tokens cacheados)`);

    return cacheData.name;
}

/**
 * Invalida el caché para que se reconstruya en la próxima petición.
 * Llamar cuando se actualicen instrucciones, conocimiento o respuestas rápidas.
 */
function invalidateGeminiCache() {
    console.log('[CACHE] Caché invalidado manualmente. Se recreará en la próxima petición.');
    geminiCache.name = null;
    geminiCache.contentHash = null;
    geminiCache.createdAt = 0;
}

/**
 * Genera una respuesta de Gemini usando el prompt completo (sin caché).
 * Usado como fallback y para el simulador.
 */
async function generateGeminiResponse(prompt) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');
    const apiUrl = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const geminiResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!geminiResponse.ok) throw new Error(`La API de Gemini respondió con el estado: ${geminiResponse.status}`);
    const result = await geminiResponse.json();
    let generatedText = result.candidates[0]?.content?.parts[0]?.text?.trim();
    if (!generatedText) throw new Error('No se recibió una respuesta válida de la IA.');
    if (generatedText.startsWith('Asistente:')) {
        generatedText = generatedText.substring('Asistente:'.length).trim();
    }
    const usage = result.usageMetadata || {};
    return {
        text: generatedText,
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
        cachedTokens: usage.cachedContentTokenCount || 0
    };
}

/**
 * Genera una respuesta de Gemini usando Context Caching.
 * El contenido estático (instrucciones, conocimiento, respuestas rápidas) viene del caché.
 * Solo el prompt dinámico (historial + mensaje actual) se envía como tokens nuevos.
 */
async function generateGeminiResponseWithCache(cacheName, dynamicPrompt) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');
    const apiUrl = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    const payload = {
        contents: [{ parts: [{ text: dynamicPrompt }], role: 'user' }],
        cachedContent: cacheName
    };

    const geminiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!geminiResponse.ok) {
        const errBody = await geminiResponse.text();
        throw new Error(`Gemini API con caché respondió ${geminiResponse.status}: ${errBody}`);
    }

    const result = await geminiResponse.json();
    let generatedText = result.candidates[0]?.content?.parts[0]?.text?.trim();
    if (!generatedText) throw new Error('No se recibió una respuesta válida de la IA (cached).');
    if (generatedText.startsWith('Asistente:')) {
        generatedText = generatedText.substring('Asistente:'.length).trim();
    }
    const usage = result.usageMetadata || {};
    return {
        text: generatedText,
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
        cachedTokens: usage.cachedContentTokenCount || 0
    };
}

// Cola de temporizadores para esperar a que el usuario termine de escribir varios mensajes
const pendingAiRequests = new Map();

async function triggerAutoReplyAI(message, contactRef, contactData) {
    const contactId = contactRef.id;

    // Si ya había un temporizador corriendo para este contacto, lo cancelamos
    if (pendingAiRequests.has(contactId)) {
        clearTimeout(pendingAiRequests.get(contactId));
        console.log(`[AI] Usuario ${contactId} envió otro mensaje rápidamente. Reiniciando temporizador...`);
    }

    // Creamos un nuevo temporizador de 20 segundos
    const timerId = setTimeout(async () => {
        pendingAiRequests.delete(contactId);
        await processAutoReplyAI(contactId, message, contactRef, contactData);
    }, 20000);

    pendingAiRequests.set(contactId, timerId);
}

// Lógica principal movida a otra función
async function processAutoReplyAI(contactId, message, contactRef, contactData) {
    console.log(`[AI] Iniciando proceso de IA para ${contactId} tras esperar que deje de escribir.`);
    try {
        const generalSettingsDoc = await db.collection('crm_settings').doc('general').get();
        const globalBotActive = generalSettingsDoc.exists && generalSettingsDoc.data().globalBotActive === true;

        const isIndividuallyActive = contactData.botActive === true;
        const shouldRun = isIndividuallyActive;

        if (!shouldRun) {
            console.log(`[AI] El bot no está activo para ${contactId} (Global: ${globalBotActive}, Individual: ${contactData.botActive}). No se enviará respuesta.`);
            return;
        }

        // --- Obtener instrucciones del bot ---
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

        // --- Contenido dinámico (cambia en cada petición) ---
        const messagesSnapshot = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(10).get();
        const conversationHistory = messagesSnapshot.docs.map(doc => {
            const d = doc.data();
            return `${d.from === contactId ? 'Cliente' : 'Asistente'}: ${d.text}`;
        }).reverse().join('\n');

        // Detectar código postal y cotizar envío
        let shippingInfo = '';
        const messageText = message.text?.body || message.text || '';
        const postalCodeMatch = messageText.match(/\b(\d{5})\b/);
        if (postalCodeMatch && SKYDROPX_CLIENT_ID) {
            console.log(`[AI] Código postal detectado: ${postalCodeMatch[1]}. Cotizando envío...`);
            const quote = await getShippingQuote(postalCodeMatch[1]);
            if (quote) {
                shippingInfo = `\n\n**Cotización de Envío disponible para CP ${postalCodeMatch[1]} (datos reales de paquetería):**\n${quote}\nIMPORTANTE: Solo menciona estas tarifas si el cliente está preguntando sobre envío, costo de envío, paquetería o entrega. Si el número de 5 dígitos es un pedido, monto, teléfono u otro dato que NO es un código postal, ignora esta cotización por completo.`;
            }
        }

        const dynamicPrompt = `${shippingInfo}\n\n**Historial de la Conversación Reciente:**\n${conversationHistory}\n\n**Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si detectas que el cliente pregunta por envío o paquetería y tienes cotización disponible, comparte las mejores opciones. Si el número de 5 dígitos NO parece un código postal (es un pedido, monto, etc.), no menciones envíos. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;

        // --- Intentar usar Context Caching ---
        let aiResult;
        try {
            const cacheName = await getOrCreateCache(botInstructions);
            if (cacheName) {
                console.log(`[AI] Generando respuesta con Context Caching para ${contactId}.`);
                aiResult = await generateGeminiResponseWithCache(cacheName, dynamicPrompt);
                console.log(`[AI] 💰 Tokens cacheados: ${aiResult.cachedTokens}, Tokens nuevos de entrada: ${aiResult.inputTokens}, Salida: ${aiResult.outputTokens}`);
            } else {
                throw new Error('Caché no disponible, usando fallback.');
            }
        } catch (cacheError) {
            // Fallback: si el caching falla por cualquier razón, usar el método tradicional
            console.warn(`[AI] ⚠️ Caché falló (${cacheError.message}). Usando método sin caché.`);
            const fullPrompt = `
            **Instrucciones Generales:**\n${botInstructions}\n\n
            **Regla Especial de Mensajes Múltiples:** SOLO usa la etiqueta [SPLIT] si tus instrucciones EXPLÍCITAMENTE dicen enviar algo "en otro mensaje", "seguido de" otro mensaje, o "en dos mensajes separados". Si NO hay una instrucción explícita de separar en varios mensajes, responde TODO en un ÚNICO mensaje. NUNCA dividas una respuesta en múltiples mensajes por tu cuenta.\n\n
            ${await buildStaticContext(botInstructions)}${shippingInfo}\n\n
            **Historial de la Conversación Reciente:**\n${conversationHistory}\n\n
            **Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;
            aiResult = await generateGeminiResponse(fullPrompt);
        }

        const aiResponse = aiResult.text;
        
        // Registrar uso de tokens en Firestore (incluyendo tokens cacheados)
        const today = new Date().toISOString().split('T')[0];
        const usageRef = db.collection('ai_usage_logs').doc(today);
        await usageRef.set({
            inputTokens: admin.firestore.FieldValue.increment(aiResult.inputTokens),
            outputTokens: admin.firestore.FieldValue.increment(aiResult.outputTokens),
            cachedTokens: admin.firestore.FieldValue.increment(aiResult.cachedTokens || 0),
            requestCount: admin.firestore.FieldValue.increment(1),
            date: today
        }, { merge: true });
        console.log(`[AI] Tokens usados - Entrada: ${aiResult.inputTokens}, Salida: ${aiResult.outputTokens}, Cacheados: ${aiResult.cachedTokens || 0}`);
        
        // Separar la respuesta en múltiples mensajes si contiene [SPLIT]
        const aiMessages = aiResponse.split(/\[SPLIT\]/i).map(m => m.trim()).filter(m => m.length > 0);
        let lastText = "";

        for (let i = 0; i < aiMessages.length; i++) {
            let msgText = aiMessages[i];
            let shouldQuote = false;
            
            if (/\[CITA\]/i.test(msgText)) {
                shouldQuote = true;
                msgText = msgText.replace(/\[CITA\]/ig, '').trim();
            }

            const sendOptions = { text: msgText };
            if (shouldQuote && message.id) {
                sendOptions.reply_to_wamid = message.id;
            }

            const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, sendOptions);
            
            await contactRef.collection('messages').add({
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: sentMessageData.id, text: sentMessageData.textForDb, isAutoReply: true,
                context: { id: message.id }
            });
            lastText = sentMessageData.textForDb;

            if (i < aiMessages.length - 1) {
                await new Promise(r => setTimeout(r, 1500)); 
            }
        }
        
        await contactRef.update({ lastMessage: lastText, lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() });
        console.log(`[AI] Respuesta de IA enviada a ${contactId}. (Burbujas: ${aiMessages.length})`);
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
    generateGeminiResponseWithCache,
    getOrCreateCache,
    triggerAutoReplyAI,
    getShippingQuote,
    sendConversionEvent,
    sendAdvancedWhatsAppMessage,
    invalidateGeminiCache
};
