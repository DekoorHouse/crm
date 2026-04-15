const { google } = require('googleapis');
const fetch = require('node-fetch');
const axios = require('axios');
const { db, admin } = require('./config');

const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const IG_BUSINESS_ID = process.env.IG_BUSINESS_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// Skydropx
const SKYDROPX_CLIENT_ID = process.env.SKYDROPX_CLIENT_ID;
const SKYDROPX_CLIENT_SECRET = process.env.SKYDROPX_CLIENT_SECRET;
const SKYDROPX_ZIP_ORIGIN = process.env.SKYDROPX_ZIP_ORIGIN || '34188';
const SKYDROPX_BASE_URL = 'https://pro.skydropx.com';
const META_GRAPH_TOKEN = process.env.META_GRAPH_TOKEN;

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

    let cleanedText = text;
    let isFinalCommand = false;
    if (text && text.toLowerCase().includes('/final')) {
        isFinalCommand = true;
        cleanedText = text.replace(/\/final/gi, '').trim();
    }

    if (fileUrl && fileType) {
        const type = fileType.startsWith('image/') ? 'image' :
                     fileType.startsWith('video/') ? 'video' :
                     fileType.startsWith('audio/') ? 'audio' : 'document';

        // --- INICIO DE LA CORRECCIÓN ---
        const mediaObject = { link: fileUrl };
        // La API de WhatsApp no permite 'caption' para audios.
        if (type !== 'audio' && cleanedText) {
            mediaObject.caption = cleanedText;
        }
        // --- FIN DE LA CORRECCIÓN ---

        messagePayload = { messaging_product: 'whatsapp', to, type, [type]: mediaObject };
        messageToSaveText = cleanedText || (type === 'image' ? '📷 Imagen' :
                                      type === 'video' ? '🎥 Video' :
                                      type === 'audio' ? '🎵 Audio' : '📄 Documento');
    } else if (cleanedText) {
        messagePayload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: cleanedText } };
        messageToSaveText = cleanedText;
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
        return { id: messageId, textForDb: messageToSaveText, fileUrlForDb: fileUrl || null, fileTypeForDb: fileType || null, isFinalCommand };
    } catch (error) {
        console.error(`❌ Error al enviar mensaje avanzado de WhatsApp a ${to}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}

/**
 * Envía un mensaje de texto o multimedia a través de la API de Messenger.
 * Messenger no soporta captions en adjuntos, así que si hay texto + media,
 * se envían como mensajes separados.
 * @param {string} psid El Page-Scoped User ID del destinatario.
 * @param {object} options { text, fileUrl, fileType }
 * @returns {Promise<{messages: Array<{id, textForDb, fileUrlForDb, fileTypeForDb}>, lastTextForDb: string}>}
 */
async function sendMessengerMessage(recipientId, { text, fileUrl, fileType, channel }) {
    // Instagram y Messenger usan el mismo endpoint /{PAGE_ID}/messages via Messenger Platform
    // Usamos FB_PAGE_ID directamente en vez de /me porque system user tokens no resuelven /me
    const isInstagram = channel === 'instagram';
    const accessToken = isInstagram ? (IG_ACCESS_TOKEN || FB_PAGE_ACCESS_TOKEN) : FB_PAGE_ACCESS_TOKEN;
    const FB_PAGE_ID_LOCAL = process.env.FB_PAGE_ID;
    const url = `https://graph.facebook.com/v19.0/${FB_PAGE_ID_LOCAL}/messages`;
    const params = { access_token: accessToken };
    const logPrefix = isInstagram ? 'INSTAGRAM SEND' : 'MESSENGER SEND';
    const sentMessages = [];

    // Send media first if present
    if (fileUrl && fileType) {
        const attachmentType = fileType.startsWith('image/') ? 'image' :
                               fileType.startsWith('video/') ? 'video' :
                               fileType.startsWith('audio/') ? 'audio' : 'file';

        const mediaPayload = isInstagram
            ? { recipient: { id: recipientId }, message: { attachment: { type: attachmentType, payload: { url: fileUrl } } } }
            : { recipient: { id: recipientId }, message: { attachment: { type: attachmentType, payload: { url: fileUrl, is_reusable: true } } } };

        try {
            console.log(`[${logPrefix}] Enviando ${attachmentType} a ${recipientId}`);
            const response = await axios.post(url, mediaPayload, { params });
            const fallbackTexts = { image: '📷 Imagen', video: '🎥 Video', audio: '🎵 Audio', file: '📄 Documento' };
            sentMessages.push({
                id: response.data.message_id,
                textForDb: fallbackTexts[attachmentType] || 'Archivo adjunto',
                fileUrlForDb: fileUrl,
                fileTypeForDb: fileType
            });
        } catch (error) {
            console.error(`❌ [${logPrefix}] Error al enviar media a ${recipientId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
            throw error;
        }

        // Small delay between media and text
        if (text) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    // Send text if present
    if (text) {
        const textPayload = {
            recipient: { id: recipientId },
            message: { text: text }
        };

        try {
            console.log(`[${logPrefix}] Enviando texto a ${recipientId}`);
            const response = await axios.post(url, textPayload, { params });
            sentMessages.push({
                id: response.data.message_id,
                textForDb: text,
                fileUrlForDb: null,
                fileTypeForDb: null
            });
        } catch (error) {
            console.error(`❌ [${logPrefix}] Error al enviar texto a ${recipientId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
            throw error;
        }
    }

    if (sentMessages.length === 0) {
        throw new Error("Se requiere texto o un archivo para enviar un mensaje.");
    }

    const lastMessage = sentMessages[sentMessages.length - 1];
    return { messages: sentMessages, lastTextForDb: lastMessage.textForDb };
}

/**
 * Envia un mensaje de utilidad fuera de la ventana de 24h usando
 * message tags (pages_utility_messaging + MESSAGE_TAG).
 * Casos de uso validos por Meta: actualizaciones post-compra, confirmaciones
 * de cita/evento, actualizaciones de cuenta.
 * @param {string} recipientId PSID del cliente
 * @param {string} text Texto a enviar
 * @param {string} tag Tag de Messenger: POST_PURCHASE_UPDATE | CONFIRMED_EVENT_UPDATE | ACCOUNT_UPDATE
 */
async function sendMessengerUtilityMessage(recipientId, text, tag = 'POST_PURCHASE_UPDATE') {
    const FB_PAGE_ID_LOCAL = process.env.FB_PAGE_ID;
    const url = `https://graph.facebook.com/v19.0/${FB_PAGE_ID_LOCAL}/messages`;
    const payload = {
        recipient: { id: recipientId },
        message: { text },
        messaging_type: 'MESSAGE_TAG',
        tag,
    };
    console.log(`[MESSENGER UTILITY] Enviando ${tag} a ${recipientId}`);
    const response = await axios.post(url, payload, {
        params: { access_token: FB_PAGE_ACCESS_TOKEN },
    });
    return { messageId: response.data.message_id };
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

    // Instrucciones van en systemInstruction, no en contents
    const systemText = `${botInstructions}\n\n**Regla Especial de Cierre de Pedido:** Cuando el usuario haya proporcionado todos los datos necesarios y el pedido esté listo para ser procesado por un humano, debes responder ÚNICAMENTE incluyendo la frase exacta "Ya registramos tu pedido" seguido de cualquier instrucción adicional de despedida. Esta frase es un comando interno para el sistema.\n\n**Regla Especial de Mensajes Múltiples:** SOLO usa la etiqueta [SPLIT] si tus instrucciones EXPLÍCITAMENTE dicen enviar algo "en otro mensaje", "seguido de" otro mensaje, o "en dos mensajes separados". Si NO hay una instrucción explícita de separar en varios mensajes, responde TODO en un ÚNICO mensaje. NUNCA dividas una respuesta en múltiples mensajes por tu cuenta. (Ejemplo de uso correcto: Hola, este es mi primer mensaje [SPLIT] y este es mi segundo mensaje). NO escribas "Mensaje 1:" ni cosas similares, solo la etiqueta [SPLIT].\n\n**Regla de Citar Mensajes:** Si por la naturaleza de la conversación crees que es estrictamente necesario "citar" o "responder directamente" al mensaje del cliente para que no se pierda el contexto (por ejemplo, si responde a una pregunta vieja), agerga la etiqueta [CITA] al INICIO de tu respuesta. Usa esta opción con moderación. Si el flujo es normal, simplemente responde de forma natural sin la etiqueta.`;

    // Material de referencia va en contents (como contexto, no como instrucciones)
    const referenceText = `**Base de Conocimiento (Usa esta información para responder preguntas frecuentes):**\n${knowledgeBase || 'No hay información adicional.'}\n\n**Respuestas Rápidas del Equipo (Respuestas que los agentes humanos usan frecuentemente, úsalas como referencia):**\n${quickReplies || 'No hay respuestas rápidas.'}`;

    return { systemText, referenceText };
}

/**
 * Crea o renueva el caché de contexto en la API de Gemini.
 * Solo se recrea si el contenido cambió o el TTL ha expirado.
 * @param {string} botInstructions - Instrucciones del bot (personalizadas por dept/ad o generales)
 * @param {Array<{inlineData: {data: string, mimeType: string}}>} departmentImageParts - Imágenes estáticas a cachear como parte del contexto
 * @param {string} imagesHashInput - String determinista con identificadores de las imágenes (para el hash del caché)
 */
async function getOrCreateCache(botInstructions, departmentImageParts = [], imagesHashInput = '') {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');

    const { systemText, referenceText } = await buildStaticContext(botInstructions);
    const currentHash = simpleHash(systemText + referenceText + '|imgs:' + imagesHashInput);
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
    // Las instrucciones del bot van en systemInstruction para que Gemini las trate como directivas,
    // no como un mensaje del usuario al que debe "responder".
    // El material de referencia (knowledge base, quick replies) va en contents, junto con las imágenes
    // estáticas del departamento (si las hay).
    console.log(`[CACHE] Creando nuevo caché de contexto (hash: ${currentHash}, ${departmentImageParts.length} imgs).`);
    const contentParts = [{ text: referenceText }, ...departmentImageParts];
    const cachePayload = {
        model: `models/${GEMINI_MODEL}`,
        contents: [{
            parts: contentParts,
            role: 'user'
        }],
        systemInstruction: {
            parts: [{ text: systemText }]
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
async function generateGeminiResponse(prompt, imageParts = [], systemInstruction = null) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');
    const apiUrl = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ parts: [{ text: prompt }, ...imageParts] }] };
    if (systemInstruction) {
        payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
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
async function generateGeminiResponseWithCache(cacheName, dynamicPrompt, imageParts = []) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');
    const apiUrl = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    const payload = {
        contents: [{ parts: [{ text: dynamicPrompt }, ...imageParts], role: 'user' }],
        cachedContent: cacheName
    };

    const geminiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!geminiResponse.ok) {
        const errBody = await geminiResponse.text();
        if (geminiResponse.status === 404) {
            console.warn(`[AI] Cache 404 detectado (${cacheName}). Invalidando...`);
            invalidateGeminiCache();
        }
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

async function triggerAutoReplyAI(message, contactRef, contactData, delay = 20000) {
    const contactId = contactRef.id;

    // Si ya había un temporizador corriendo para este contacto, lo cancelamos
    if (pendingAiRequests.has(contactId)) {
        clearTimeout(pendingAiRequests.get(contactId));
        console.log(`[AI] Usuario ${contactId} envió otro mensaje rápidamente. Reiniciando temporizador...`);
    }

    // Usamos el delay especificado (por defecto 20s)
    const aiNextRun = Date.now() + delay;
    const timerId = setTimeout(async () => {
        pendingAiRequests.delete(contactId);
        await processAutoReplyAI(contactId, message, contactRef, contactData);
    }, delay);

    pendingAiRequests.set(contactId, timerId);
    
    // Guardar el tiempo de la próxima ejecución en Firestore para que el frontend pueda mostrarlo
    await contactRef.update({ aiNextRun: admin.firestore.Timestamp.fromMillis(aiNextRun) });
}

/**
 * Salta el temporizador de la IA para un contacto y procesa la respuesta inmediatamente.
 */
async function skipAiTimer(contactId) {
    if (pendingAiRequests.has(contactId)) {
        console.log(`[AI] Saltando temporizador para ${contactId} a petición del usuario...`);
        clearTimeout(pendingAiRequests.get(contactId));
        pendingAiRequests.delete(contactId);
        
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();
        if (contactDoc.exists) {
            // Intentar recuperar el último mensaje del cliente para procesarlo
            const lastMsgSnap = await contactRef.collection('messages')
                .where('from', '==', contactId)
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();
            
            if (!lastMsgSnap.empty) {
                await processAutoReplyAI(contactId, lastMsgSnap.docs[0].data(), contactRef, contactDoc.data());
            } else {
                console.warn(`[AI] No se encontró el último mensaje para procesar el salto del bot para ${contactId}.`);
            }
        }
        return true;
    }
    return false;
}

// Lógica principal movida a otra función
async function processAutoReplyAI(contactId, message, contactRef, passedContactData) {
    console.log(`[AI] Iniciando proceso de IA para ${contactId} tras esperar que deje de escribir.`);
    
    // Obtener los datos más frescos del contacto justo ahora
    const freshContactSnap = await contactRef.get();
    if (!freshContactSnap.exists) return;
    const contactData = freshContactSnap.data();

    // Limpiar el campo aiNextRun al empezar el procesamiento y poner estado de generación
    await contactRef.update({ 
        aiNextRun: admin.firestore.FieldValue.delete(),
        aiStatus: 'generating'
    });
    try {
        const generalSettingsDoc = await db.collection('crm_settings').doc('general').get();
        const globalBotActive = generalSettingsDoc.exists && generalSettingsDoc.data().globalBotActive === true;

        const isIndividuallyActive = contactData.botActive === true;
        const shouldRun = isIndividuallyActive;

        if (!shouldRun) {
            console.log(`[AI] El bot ya no está activo para ${contactId} (Global: ${globalBotActive}, Individual: ${contactData.botActive}). Abortando respuesta.`);
            return;
        }

        // --- Obtener instrucciones del bot ---
        // Prioridad: prompt por anuncio → prompt por departamento → prompt general
        let botInstructions = 'Eres un asistente virtual amigable y servicial.';
        let promptResolved = false;
        let departmentReferenceImages = []; // Imágenes estáticas del departamento como contexto

        // 1) Prompt por Ad ID
        const adId = contactData.adReferral?.source_id;
        if (adId) {
            const adPromptSnapshot = await db.collection('ai_ad_prompts').where('adId', '==', adId).limit(1).get();
            if (!adPromptSnapshot.empty) {
                botInstructions = adPromptSnapshot.docs[0].data().prompt;
                console.log(`[AI] Usando prompt específico para Ad ID: ${adId}`);
                promptResolved = true;
            } else {
                console.log(`[AI] No se encontró prompt para Ad ID: ${adId}. Intentando por departamento.`);
            }
        }

        // 2) Prompt por departamento (producto) + imágenes de referencia
        if (!promptResolved) {
            const departmentId = contactData.assignedDepartmentId;
            if (departmentId) {
                const deptPromptDoc = await db.collection('ai_department_prompts').doc(departmentId).get();
                if (deptPromptDoc.exists) {
                    const deptData = deptPromptDoc.data();
                    if (deptData.prompt) {
                        botInstructions = deptData.prompt;
                        console.log(`[AI] Usando prompt específico para Departamento: ${departmentId}`);
                        promptResolved = true;
                    }
                    if (Array.isArray(deptData.images) && deptData.images.length > 0) {
                        departmentReferenceImages = deptData.images;
                        console.log(`[AI] Departamento ${departmentId} tiene ${deptData.images.length} imágenes de referencia.`);
                    }
                } else {
                    console.log(`[AI] No se encontró prompt para Departamento: ${departmentId}. Usando instrucciones generales.`);
                }
            }
        }

        // 3) Fallback: prompt general
        if (!promptResolved) {
            const botSettingsDoc = await db.collection('crm_settings').doc('bot').get();
            if (botSettingsDoc.exists) botInstructions = botSettingsDoc.data().instructions;
        }

        // --- Contenido dinámico (cambia en cada petición) ---
        const messagesSnapshot = await contactRef.collection('messages').orderBy('timestamp', 'desc').get();
        const downloadedMedia = [];
        let mediaCount = 0;

        const conversationHistory = messagesSnapshot.docs.map(doc => {
            const d = doc.data();
            const fromLabel = d.from === contactId ? 'Cliente' : 'Asistente';
            
            // Recolectar hasta los últimos 2 archivos multimedia (imágenes, audios o videos)
            if ((d.type === 'image' || d.type === 'audio' || d.type === 'video') && d.fileUrl && mediaCount < 2) {
                let mimeType = d.fileType || (d.type === 'image' ? 'image/jpeg' : (d.type === 'audio' ? 'audio/mpeg' : 'video/mp4'));
                downloadedMedia.push({ url: d.fileUrl, mimeType: mimeType, type: d.type });
                mediaCount++;
            }
            return `${fromLabel}: ${d.text}`;
        }).reverse().join('\n');

        // --- Descargar imágenes de referencia del departamento (contexto estático → van al caché) ---
        const departmentImageParts = [];
        const departmentImageIds = []; // Para el hash del caché
        for (const refImage of departmentReferenceImages) {
            if (refImage && refImage.url && typeof refImage.url === 'string' && refImage.url.startsWith('http')) {
                try {
                    const response = await fetch(refImage.url);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    if (buffer.length > 0) {
                        departmentImageParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: refImage.mimeType || 'image/jpeg' } });
                        departmentImageIds.push(refImage.path || refImage.url);
                        console.log(`[AI] Imagen de referencia del departamento cargada (${refImage.mimeType || 'image/jpeg'}).`);
                    }
                } catch (e) {
                    console.warn('[AI] Error descargando imagen de referencia del departamento:', e.message);
                }
            }
        }
        const departmentImagesHashInput = departmentImageIds.sort().join(';');

        // --- Descargar multimedia de la conversación (dinámico) ---
        const mediaParts = [];
        for (const media of downloadedMedia.reverse()) { // Voltear para mantener orden cronológico
            if (media.url.startsWith('http')) {
                try {
                    const response = await fetch(media.url);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    if (buffer.length > 0) {
                        mediaParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: media.mimeType } });
                        console.log(`[AI] Archivo multimedia leído y convertido a Base64 para contexto (${media.mimeType}).`);
                    }
                } catch (e) {
                    console.warn('[AI] Error descargando multimedia para contexto:', e.message);
                }
            }
        }

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

        const deptImagesNote = departmentReferenceImages.length > 0
            ? `\n\n**Imágenes de referencia del producto/departamento:**\nLas primeras ${departmentReferenceImages.length} ${departmentReferenceImages.length === 1 ? 'imagen adjunta es una referencia visual' : 'imágenes adjuntas son referencias visuales'} del producto o catálogo del departamento. Úsalas para describir, comparar o responder preguntas del cliente. Las imágenes posteriores (si las hay) son las que el cliente envió en la conversación.`
            : '';

        const dynamicPrompt = `${shippingInfo}${deptImagesNote}\n\n**Historial de la Conversación Reciente:**\n${conversationHistory}\n\n**Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si detectas que el cliente pregunta por envío o paquetería y tienes cotización disponible, comparte las mejores opciones. Si el número de 5 dígitos NO parece un código postal (es un pedido, monto, etc.), no menciones envíos. Si el cliente envió fotos o audios, analízalos cuidadosamente para ayudarle en lo que necesita. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;

        // --- Intentar usar Context Caching ---
        let aiResult;
        try {
            // Las imágenes del departamento van al caché (contexto estático)
            const cacheName = await getOrCreateCache(botInstructions, departmentImageParts, departmentImagesHashInput);
            if (cacheName) {
                console.log(`[AI] Generando respuesta con Context Caching para ${contactId}. (${mediaParts.length} multimedia de conversación + ${departmentImageParts.length} imgs dept cacheadas)`);
                // Solo se envían en cada petición los mediaParts dinámicos (conversación)
                aiResult = await generateGeminiResponseWithCache(cacheName, dynamicPrompt, mediaParts);
                console.log(`[AI] 💰 Tokens cacheados: ${aiResult.cachedTokens}, Tokens nuevos de entrada: ${aiResult.inputTokens}, Salida: ${aiResult.outputTokens}`);
            } else {
                throw new Error('Caché no disponible, usando fallback.');
            }
        } catch (cacheError) {
            // Fallback: si el caching falla por cualquier razón, usar el método tradicional con systemInstruction.
            // En este caso las imágenes del departamento NO están cacheadas, así que las incluimos en mediaParts.
            console.warn(`[AI] ⚠️ Caché falló (${cacheError.message}). Usando método sin caché.`);
            const { systemText: fallbackSystem, referenceText: fallbackRef } = await buildStaticContext(botInstructions);
            const fullPrompt = `${fallbackRef}${shippingInfo}${deptImagesNote}\n\n**Historial de la Conversación Reciente:**\n${conversationHistory}\n\n**Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si el cliente envió archivos multimedia, estúdialos. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;
            // Prepend dept images a mediaParts solo en el fallback
            const fallbackMediaParts = [...departmentImageParts, ...mediaParts];
            aiResult = await generateGeminiResponse(fullPrompt, fallbackMediaParts, fallbackSystem);
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
        
        // Antes de enviar mensajes, verificar si el usuario canceló
        const currentContactDoc = await contactRef.get();
        if (currentContactDoc.exists && currentContactDoc.data().aiStatus === 'cancelled') {
            console.log(`[AI] Generación cancelada por el usuario para ${contactId}. Omitiendo envío.`);
            await contactRef.update({ aiStatus: admin.firestore.FieldValue.delete() });
            return;
        }

        // Separar la respuesta en múltiples mensajes si contiene [SPLIT]
        let aiMessages = aiResponse.split(/\[SPLIT\]/i).map(m => m.trim()).filter(m => m.length > 0);
        let lastText = "";

        // Detectar si el bot debe desactivarse (/final o frase de pedido) de forma insensible a mayúsculas
        const shouldDeactivate = /\/final/i.test(aiResponse) || /ya registramos tu pedido/i.test(aiResponse);

        // Limpiar el comando /final de los mensajes individuales antes de enviar
        aiMessages = aiMessages.map(m => m.replace(/\/final/ig, '').trim()).filter(m => m.length > 0);

        for (let i = 0; i < aiMessages.length; i++) {
            // Verificar cancelación entre mensajes si hay SPLIT
            if (i > 0) {
                const checkDoc = await contactRef.get();
                if (checkDoc.exists && checkDoc.data().aiStatus === 'cancelled') {
                    console.log(`[AI] Generación cancelada por el usuario entre mensajes SPLIT para ${contactId}.`);
                    await contactRef.update({ aiStatus: admin.firestore.FieldValue.delete() });
                    return;
                }
            }
            let msgText = aiMessages[i];
            let shouldQuote = false;
            
            if (/\[CITA\]/i.test(msgText)) {
                shouldQuote = true;
                msgText = msgText.replace(/\[CITA\]/ig, '').trim();
            }

            const contactChannel = contactData.channel || 'whatsapp';
            let sentMessageData;

            if (contactChannel === 'messenger' || contactChannel === 'instagram') {
                const recipientId = contactData.psid || contactData.igsid || contactId.replace(/^(fb_|ig_)/, '');
                const result = await sendMessengerMessage(recipientId, { text: msgText, channel: contactChannel });
                sentMessageData = { id: result.messages?.[0]?.id || null, textForDb: msgText };
            } else {
                const sendOptions = { text: msgText };
                if (shouldQuote && message.id) {
                    sendOptions.reply_to_wamid = message.id;
                }
                sentMessageData = await sendAdvancedWhatsAppMessage(contactId, sendOptions);
            }

            const fromId = (contactChannel === 'messenger' || contactChannel === 'instagram') ? FB_PAGE_ID : PHONE_NUMBER_ID;
            await contactRef.collection('messages').add({
                from: fromId, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: sentMessageData.id, text: sentMessageData.textForDb, isAutoReply: true,
                context: { id: message.id }, channel: contactChannel,
            });
            lastText = sentMessageData.textForDb;

            if (i < aiMessages.length - 1) {
                await new Promise(r => setTimeout(r, 1500)); 
            }
        }
        
        const updateData = { 
            lastMessage: lastText, 
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            aiStatus: admin.firestore.FieldValue.delete()
        };

        // Si se detectó /final o la frase de registro de pedido, desactivar bot y mover a Pendientes IA
        if (shouldDeactivate) {
            updateData.botActive = false;
            updateData.status = 'pendientes_ia';
            console.log(`[AI] Desactivación automática activada para ${contactId} por comando o frase clave. Moviendo a Pendientes IA.`);
        }

        await contactRef.update(updateData);
        console.log(`[AI] Respuesta de IA enviada a ${contactId}. (Burbujas enviadas: ${aiMessages.length})`);
    } catch (error) {
        console.error(`❌ [AI] Error en el proceso de IA para ${contactId}:`, error.message);
        // Asegurarse de limpiar el estado incluso en error
        await contactRef.update({ aiStatus: admin.firestore.FieldValue.delete() });
    }
}

// =================================================================
// === SERVICIOS DE META (API DE CONVERSIONES) =====================
// =================================================================

async function sendConversionEvent(eventName, contactInfo, referralInfo, customData = {}) {
    if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
        console.warn(`[META CAPI] Faltan credenciales. PIXEL_ID=${!!META_PIXEL_ID}, TOKEN=${!!META_CAPI_ACCESS_TOKEN}. No se enviará evento '${eventName}'.`);
        return;
    }
    if (!referralInfo?.ctwa_clid) {
        console.log(`[META CAPI] Contacto ${contactInfo?.wa_id || 'desconocido'} sin ctwa_clid (orgánico). Se omite evento '${eventName}'.`);
        return;
    }

    const url = `https://graph.facebook.com/v22.0/${META_PIXEL_ID}/events`;
    const eventTime = Math.floor(Date.now() / 1000);

    const eventData = {
        event_name: eventName,
        event_time: eventTime,
        event_id: `${eventName}_${contactInfo?.wa_id || 'unknown'}_${eventTime}`,
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: {
            page_id: '110927358587213',
            ctwa_clid: referralInfo.ctwa_clid
        },
    };

    if (customData && Object.keys(customData).length > 0) {
        eventData.custom_data = { ...customData };
    }

    const payload = { data: [eventData] };
    const headers = { 'Authorization': `Bearer ${META_CAPI_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };

    try {
        console.log(`[META CAPI] Enviando evento '${eventName}' al dataset ${META_PIXEL_ID}. ctwa_clid=${referralInfo.ctwa_clid}`);
        const response = await axios.post(url, payload, { headers });
        console.log(`[META CAPI] ✅ Evento '${eventName}' enviado. Respuesta:`, JSON.stringify(response.data));
    } catch (error) {
        console.error(`[META CAPI] ❌ Error al enviar evento '${eventName}'. HTTP ${error.response?.status || 'N/A'}`,
            error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
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
    skipAiTimer,
    cancelAiResponse,
    getShippingQuote,
    sendConversionEvent,
    sendAdvancedWhatsAppMessage,
    sendMessengerMessage,
    sendMessengerUtilityMessage,
    invalidateGeminiCache,
    getMetaSpend
};

/**
 * Cancela la generación de respuesta de IA activa.
 */
async function cancelAiResponse(contactId) {
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    await contactRef.update({ aiStatus: 'cancelled' });
    
    // Si todavía está en el temporizador de espera (antes de generar),
    // llamar a skips manuales no sirve, pero podemos limpiar el temporizador si existe
    const { skipAiTimer } = require('./services'); // Auto-referencia para limpiar
    // Nota: El temporizador de triggerAutoReplyAI se limpia solo si llega mensaje nuevo, 
    // pero aquí lo forzamos a 'cancelled' para que processAutoReplyAI se detenga al iniciar.
    
    return true;
}

/**
 * Obtiene el gasto publicitario de una cuenta de Meta para una fecha específica.
 * @param {string} date Fecha en formato YYYY-MM-DD.
 * @param {string} accountId ID de la cuenta publicitaria (sin o con prefijo act_).
 * @returns {Promise<number|null>} Gasto en formato numérico o null si hubo error.
 */
async function getMetaSpend(date, accountId = '1890131678412987') {
    const token = META_GRAPH_TOKEN || process.env.WHATSAPP_TOKEN; // Usar token de WA como fallback si es el mismo
    if (!token) {
        console.warn('[META SPEND] No se encontró un token válido para Meta Graph API.');
        return null;
    }

    try {
        const actId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
        const url = `https://graph.facebook.com/v19.0/${actId}/insights`;
        
        console.log(`[META SPEND] Consultando Meta para ${actId} en fecha ${date}...`);
        
        const response = await axios.get(url, {
            params: {
                fields: 'spend',
                time_range: JSON.stringify({ since: date, until: date }),
                access_token: token
            }
        });

        const data = response.data;
        if (data && data.data && data.data.length > 0) {
            const spend = parseFloat(data.data[0].spend) || 0;
            console.log(`[META SPEND] Gasto encontrado: ${spend}`);
            return spend;
        }

        console.log(`[META SPEND] No se encontró gasto para la fecha ${date}.`);
        return 0;
    } catch (error) {
        console.error(`[META SPEND] Error en la API de Meta:`, error.response ? JSON.stringify(error.response.data) : error.message);
        return null;
    }
}
