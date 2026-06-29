const { google } = require('googleapis');
const fetch = require('node-fetch');
const axios = require('axios');
const fs = require('fs');
const tmp = require('tmp');
const crypto = require('crypto');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const { db, admin, bucket } = require('./config');

// El path de ffmpeg ya suele configurarlo apiRoutes.js sobre el mismo módulo
// (fluent-ffmpeg es singleton), pero lo fijamos aquí también por si services.js
// ejecuta la compresión antes de que apiRoutes termine de cargar. Es idempotente.
try {
    ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);
} catch (_) { /* ya configurado en otro módulo */ }

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
// === ETAPA 2: POST-VENTA (cobro / pedido listo / entrega) ========
// =================================================================
// Prompt GLOBAL por defecto para la "etapa 2" de la IA. Se usa cuando el
// contacto ya cerró su venta (aiStage === 'postventa') y no hay un prompt
// personalizado en crm_settings/postventa.instructions. Editable desde
// Ajustes → Entrenamiento de IA.
const DEFAULT_POSTVENTA_INSTRUCTIONS = `Eres el asistente de POST-VENTA de DekoorHouse. El cliente YA cerró su pedido; tu trabajo es acompañarlo después de la compra: confirmar datos, gestionar el pago (cobro), avisar cuando su pedido esté listo y coordinar la entrega o envío.

TONO: cálido, cercano y breve, en español de México. Usa emojis con mesura. Si necesitas mandar varios mensajes cortos, sepáralos con [SPLIT].

QUÉ SÍ HACES:
- Confirmar con amabilidad que su pedido quedó registrado y resolver dudas sobre tiempos, pago y entrega.
- Cobro: cuando el cliente pregunte cómo pagar o pida los datos, comparte el método de pago y pídele que envíe su comprobante. Cuando mande comprobante, agradécele y dile que validamos el pago y le confirmamos.
- Pedido listo / envío: si el cliente pregunta por el estatus, dale una respuesta tranquilizadora; si ya te consta que está listo o en camino, avísale y comparte la guía/seguimiento si la tienes.
- Entrega: coordina dirección, horario o punto de recolección según lo que aplique.

NUEVO PEDIDO:
- Si el cliente quiere comprar otra cosa o hacer OTRO pedido, salúdalo con entusiasmo (ej. "¡Claro que sí! 🎉 Con gusto te ayudo con tu nuevo pedido") y escribe al final de tu mensaje el comando /nuevopedido. Ese comando regresa la conversación al área de ventas y NO lo ve el cliente. A partir de ahí, ventas se encarga de tomar el nuevo pedido.

QUÉ NO HACES:
- No inventes datos de pago, montos, fechas exactas, números de guía ni estatus que no tengas confirmados. Si no estás seguro, dile que lo confirmas con el equipo en breve.
- No proceses devoluciones, cancelaciones ni reembolsos por tu cuenta: para esos casos di que un agente lo atenderá enseguida.

Si la situación se sale de lo anterior o el cliente está molesto, responde con empatía e indica que un agente humano lo atenderá pronto.`;

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

// =================================================================
// === MEDIA SALIENTE MESSENGER / INSTAGRAM ========================
// =================================================================
// Messenger e Instagram entregan adjuntos DESCARGANDO la URL que les pasamos
// (a diferencia de WhatsApp, donde subimos los bytes). Como nuestro bucket es
// privado (Uniform Bucket-Level Access), las URLs storage.googleapis.com dan 403
// a Meta: el adjunto "se envía" (devuelve message_id) pero NUNCA llega al cliente.
// Por eso aquí firmamos una URL de lectura temporal que Meta sí puede descargar.
// Límite de adjunto del Send API: 25 MB. Para VIDEO no basta con firmar la URL:
// el chat sube los archivos con el SDK de Firebase (getDownloadURL), que ya es una
// URL pública; el problema real es que Messenger entrega el adjunto "roto" (círculo
// gris con play) cuando el video pesa > 25 MB o viene en un contenedor que no procesa
// por URL (típico .mov de iPhone, o mp4 sin el moov atom al frente). Por eso SIEMPRE
// transcodificamos el video a un mp4 limpio (H.264 + AAC, yuv420p, faststart) acotado
// por debajo del límite, y lo entregamos por una URL firmada — igual de robusto que
// el camino de WhatsApp, que descarga + re-sube los bytes.
const MESSENGER_MEDIA_LIMIT_MB = 24;
const MESSENGER_MEDIA_LIMIT_BYTES = MESSENGER_MEDIA_LIMIT_MB * 1024 * 1024;

/** Extrae la ruta del objeto si la URL apunta a nuestro bucket; si no, null. */
function getBucketObjectPath(fileUrl) {
    if (!fileUrl || !bucket || !bucket.name) return null;
    const marker = `storage.googleapis.com/${bucket.name}/`;
    const idx = fileUrl.indexOf(marker);
    if (idx < 0) return null;
    return decodeURIComponent(fileUrl.slice(idx + marker.length).split('?')[0]).replace(/^\/+/, '');
}

/** Una pasada de ffmpeg a mp4 compatible con Messenger, con bitrate acotado (maxrateK kbps). */
function ffmpegToMessengerMp4(inputPath, outputPath, maxrateK) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
                '-c:v libx264',
                '-preset ultrafast',     // prioriza velocidad (el envío espera este paso)
                '-crf 28',
                `-maxrate ${maxrateK}k`,
                `-bufsize ${maxrateK * 2}k`,
                '-pix_fmt yuv420p',      // compatibilidad amplia de reproductores
                '-movflags +faststart',  // moov atom al frente -> reproducible por streaming
                '-c:a aac',
                '-b:a 128k',
            ])
            .on('end', () => resolve())
            .on('error', (e) => reject(new Error('ffmpeg: ' + e.message)))
            .save(outputPath);
    });
}

/**
 * Convierte CUALQUIER video a un mp4 limpio y ligero para Messenger/Instagram.
 * Arregla videos pesados (>25 MB), .mov de iPhone y mp4 sin faststart, que llegaban rotos.
 */
async function transcodeVideoForMessenger(inputBuffer) {
    const tempInput = tmp.fileSync({ postfix: '.bin' });
    const tempOutput = tmp.fileSync({ postfix: '.mp4' });
    try {
        await fs.promises.writeFile(tempInput.name, inputBuffer);
        // 1er intento: buena calidad acotada (~2.2 Mbps).
        await ffmpegToMessengerMp4(tempInput.name, tempOutput.name, 2200);
        let out = await fs.promises.readFile(tempOutput.name);
        // Si aun así pasa del límite (video largo), reintenta más comprimido.
        if (out.length > MESSENGER_MEDIA_LIMIT_BYTES) {
            console.log(`[MESSENGER MEDIA] mp4 ${(out.length / 1024 / 1024).toFixed(2)} MB sigue > ${MESSENGER_MEDIA_LIMIT_MB} MB; reintentando más comprimido.`);
            await ffmpegToMessengerMp4(tempInput.name, tempOutput.name, 900);
            out = await fs.promises.readFile(tempOutput.name);
        }
        return out;
    } finally {
        tempInput.removeCallback();
        tempOutput.removeCallback();
    }
}

/** Descarga el video (bucket o URL pública) y lo transcodifica a mp4 limpio. Devuelve los bytes. */
async function getTranscodedVideoBytes(fileUrl, objectPath) {
    const inputBuffer = objectPath
        ? (await bucket.file(objectPath).download())[0]
        : Buffer.from((await axios.get(fileUrl, {
              responseType: 'arraybuffer',
              maxContentLength: Infinity,
              maxBodyLength: Infinity,
              timeout: 120000,
          })).data);
    console.log(`[MESSENGER MEDIA] Video recibido ${(inputBuffer.length / 1024 / 1024).toFixed(2)} MB; normalizando a mp4.`);
    return await transcodeVideoForMessenger(inputBuffer);
}

/**
 * Sube los BYTES del adjunto a Meta (Attachment Upload API) y devuelve un attachment_id
 * reusable. Subir los bytes (en vez de pasar una URL) hace que Meta procese el video de
 * forma nativa y le genere la miniatura/poster — que por URL a veces no aparece. Solo
 * Messenger (Facebook); Instagram no soporta este endpoint.
 */
async function uploadMessengerAttachment(buffer, contentType, attachmentType, accessToken, pageId) {
    const url = `https://graph.facebook.com/v19.0/${pageId}/message_attachments`;
    const form = new FormData();
    form.append('access_token', accessToken);
    form.append('message', JSON.stringify({ attachment: { type: attachmentType, payload: { is_reusable: true } } }));
    form.append('filedata', buffer, { filename: `media.${contentType.split('/')[1] || 'bin'}`, contentType });
    const resp = await axios.post(url, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    if (!resp.data || !resp.data.attachment_id) {
        throw new Error('Meta no devolvió attachment_id: ' + JSON.stringify(resp.data));
    }
    return resp.data.attachment_id;
}

// Entregamos la media por URL de descarga estilo Firebase (token público en la
// metadata del objeto). Es exactamente el tipo de URL que genera getDownloadURL en
// el frontend (la que YA funcionaba al mandar a uno mismo) y NO depende de getSignedUrl
// (que en varios entornos de GCP falla si la cuenta de servicio no puede signBlob).
function firebaseDownloadUrl(objectPath, token) {
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

/** Sube un buffer y devuelve una URL pública estilo Firebase (token en metadata). */
async function uploadAndGetPublicUrl(objectPath, buffer, contentType) {
    const token = crypto.randomUUID();
    await bucket.file(objectPath).save(buffer, {
        contentType,
        resumable: false,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });
    return firebaseDownloadUrl(objectPath, token);
}

/** Garantiza un token de descarga en un objeto existente y devuelve su URL pública estilo Firebase. */
async function ensurePublicUrlForObject(objectPath) {
    const file = bucket.file(objectPath);
    const [meta] = await file.getMetadata();
    let token = meta.metadata && meta.metadata.firebaseStorageDownloadTokens;
    if (token) {
        token = String(token).split(',')[0];
    } else {
        token = crypto.randomUUID();
        await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    }
    return firebaseDownloadUrl(objectPath, token);
}

/**
 * Devuelve una URL que Meta SÍ puede descargar y procesar para entregar el adjunto.
 * - VIDEO: lo descarga (venga de Firebase, de storage.googleapis.com o externo),
 *   lo transcodifica a mp4 limpio (<25 MB, faststart) y lo entrega por URL pública (token).
 * - IMAGEN/AUDIO/DOC de nuestro bucket privado: garantiza token y devuelve URL pública.
 * - Cualquier otra URL (ya pública): se devuelve igual.
 * @returns {Promise<string>} URL accesible por Meta.
 */
async function resolveMetaAccessibleMediaUrl(fileUrl, fileType) {
    if (!fileUrl) return fileUrl;
    const objectPath = getBucketObjectPath(fileUrl);
    const isVideo = (fileType || '').startsWith('video/');

    if (isVideo) {
        try {
            const mp4 = await getTranscodedVideoBytes(fileUrl, objectPath);

            const baseName = objectPath ? (objectPath.split('/').pop() || 'video') : 'video';
            const cleanName = baseName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'video';
            const outPath = `messenger_media/outbound/${Date.now()}_${cleanName}.mp4`;
            const url = await uploadAndGetPublicUrl(outPath, mp4, 'video/mp4');
            console.log(`[MESSENGER MEDIA] mp4 listo ${(mp4.length / 1024 / 1024).toFixed(2)} MB -> ${outPath}`);
            return url;
        } catch (err) {
            console.error(`[MESSENGER MEDIA] No se pudo normalizar el video; se intenta entregar el original:`, err.message);
            // Fallback: si es objeto de bucket privado, al menos publícalo por token; si no, deja la URL original.
            if (objectPath) {
                try { return await ensurePublicUrlForObject(objectPath); } catch (_) { /* cae a original */ }
            }
            return fileUrl;
        }
    }

    // No-video: si es objeto de nuestro bucket privado, publícalo por token; si no, dejar igual.
    if (objectPath) {
        try { return await ensurePublicUrlForObject(objectPath); }
        catch (e) { console.error('[MESSENGER MEDIA] No se pudo publicar el objeto:', e.message); return fileUrl; }
    }
    return fileUrl;
}

/**
 * Autodiagnóstico accesible desde el navegador: genera un video de prueba con ffmpeg,
 * lo sube + publica por token, y lo descarga del lado servidor (simulando a Meta).
 * Sirve para confirmar, sin pelear con los logs, que ffmpeg corre y que la URL de
 * entrega es alcanzable. NO usa datos de ningún cliente.
 */
async function messengerMediaSelfTest() {
    const report = { ok: false, steps: {} };
    const tmpOut = tmp.fileSync({ postfix: '.mp4' });
    try {
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input('testsrc=duration=2:size=320x240:rate=15').inputFormat('lavfi')
                .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-movflags +faststart', '-t 2'])
                .on('end', resolve)
                .on('error', (e) => reject(new Error('ffmpeg: ' + e.message)))
                .save(tmpOut.name);
        });
        const buf = await fs.promises.readFile(tmpOut.name);
        report.steps.ffmpeg = { ok: true, bytes: buf.length };

        const outPath = `messenger_media/outbound/selftest_${Date.now()}.mp4`;
        const url = await uploadAndGetPublicUrl(outPath, buf, 'video/mp4');
        report.steps.upload = { ok: true, path: outPath };
        report.deliveryUrl = url;

        const resp = await axios.get(url, { responseType: 'arraybuffer', maxContentLength: Infinity });
        report.steps.fetch = {
            ok: true,
            status: resp.status,
            contentType: resp.headers['content-type'],
            contentLength: resp.headers['content-length'],
        };

        // Prueba la subida de BYTES a Meta (el método que ahora usa el video de Facebook).
        try {
            const attachmentId = await uploadMessengerAttachment(buf, 'video/mp4', 'video', FB_PAGE_ACCESS_TOKEN, process.env.FB_PAGE_ID);
            report.steps.metaUpload = { ok: true, attachmentId };
        } catch (e) {
            report.steps.metaUpload = { ok: false, error: e.response ? JSON.stringify(e.response.data) : e.message };
        }

        report.ok = true;
    } catch (e) {
        report.error = e.message;
    } finally {
        tmpOut.removeCallback();
    }
    return report;
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

        // Estrategia de adjunto:
        // - Video por Messenger (FB): subimos los BYTES transcodificados a Meta (attachment_id).
        //   Meta lo procesa nativo y le genera la miniatura/poster, que por URL no siempre aparece.
        //   Si falla, caemos al método por URL.
        // - Resto (Instagram, imagen/audio/doc): URL accesible por Meta.
        let mediaPayload = null;
        if (!isInstagram && attachmentType === 'video') {
            try {
                const objectPath = getBucketObjectPath(fileUrl);
                const mp4 = await getTranscodedVideoBytes(fileUrl, objectPath);
                const attachmentId = await uploadMessengerAttachment(mp4, 'video/mp4', 'video', accessToken, FB_PAGE_ID_LOCAL);
                console.log(`[${logPrefix}] Video subido a Meta (attachment_id=${attachmentId}).`);
                mediaPayload = { recipient: { id: recipientId }, message: { attachment: { type: 'video', payload: { attachment_id: attachmentId } } } };
            } catch (upErr) {
                console.error(`❌ [${logPrefix}] Falló la subida de bytes a Meta; uso método por URL:`, upErr.response ? JSON.stringify(upErr.response.data) : upErr.message);
            }
        }
        if (!mediaPayload) {
            let mediaUrl = fileUrl;
            try {
                mediaUrl = await resolveMetaAccessibleMediaUrl(fileUrl, fileType);
            } catch (prepErr) {
                console.error(`❌ [${logPrefix}] No se pudo preparar la URL accesible para Meta; se usa la original:`, prepErr.message);
            }
            mediaPayload = isInstagram
                ? { recipient: { id: recipientId }, message: { attachment: { type: attachmentType, payload: { url: mediaUrl } } } }
                : { recipient: { id: recipientId }, message: { attachment: { type: attachmentType, payload: { url: mediaUrl, is_reusable: true } } } };
        }

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

        // Delay entre el adjunto y el texto: Meta procesa el video de forma asíncrona y
        // enviar el texto demasiado pronto hacía que el segundo envío se perdiera. Damos más margen.
        if (text) {
            await new Promise(resolve => setTimeout(resolve, 800));
        }
    }

    // Send text if present.
    // El texto va en un segundo envío (Messenger no permite texto + adjunto juntos). Ese
    // segundo envío a veces fallaba de forma transitoria (sobre todo justo después de un
    // video) y el texto se perdía. Reintentamos con backoff; si aun así falla pero el
    // adjunto sí se envió, no descartamos el adjunto.
    if (text) {
        const textPayload = {
            recipient: { id: recipientId },
            message: { text: text }
        };

        const maxAttempts = 3;
        let textSent = false;
        for (let attempt = 1; attempt <= maxAttempts && !textSent; attempt++) {
            try {
                console.log(`[${logPrefix}] Enviando texto a ${recipientId} (intento ${attempt}/${maxAttempts})`);
                const response = await axios.post(url, textPayload, { params });
                sentMessages.push({
                    id: response.data.message_id,
                    textForDb: text,
                    fileUrlForDb: null,
                    fileTypeForDb: null
                });
                textSent = true;
            } catch (error) {
                const errData = error.response ? JSON.stringify(error.response.data) : error.message;
                console.error(`❌ [${logPrefix}] Intento ${attempt}/${maxAttempts} falló al enviar texto a ${recipientId}: ${errData}`);
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 700)); // backoff: 700ms, 1400ms
                } else if (sentMessages.length === 0) {
                    // Mensaje de solo texto: no se envió nada, propagar el error.
                    throw error;
                } else {
                    // El adjunto sí se envió: no lo perdemos. El texto queda sin enviar.
                    console.error(`❌ [${logPrefix}] El texto no se pudo enviar tras ${maxAttempts} intentos; el adjunto sí se envió y se registrará.`);
                }
            }
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

/**
 * Envía o quita una reacción a un mensaje de Instagram via Send API.
 * Nota: el Send API de Messenger (Facebook) NO permite que la página
 * reaccione a los mensajes del usuario, así que esto solo aplica a Instagram.
 * @param {string} recipientId IGSID del destinatario
 * @param {string} messageId ID del mensaje (mid) al que se reacciona
 * @param {string|null} emoji Emoji de la reacción, o null/'' para quitarla
 */
async function sendInstagramReaction(recipientId, messageId, emoji) {
    const FB_PAGE_ID_LOCAL = process.env.FB_PAGE_ID;
    const url = `https://graph.facebook.com/v19.0/${FB_PAGE_ID_LOCAL}/messages`;
    const accessToken = IG_ACCESS_TOKEN || FB_PAGE_ACCESS_TOKEN;
    const payload = emoji
        ? { recipient: { id: recipientId }, sender_action: 'react', payload: { message_id: messageId, reaction: emoji } }
        : { recipient: { id: recipientId }, sender_action: 'unreact', payload: { message_id: messageId } };
    console.log(`[INSTAGRAM REACT] ${emoji ? 'react ' + emoji : 'unreact'} a mensaje ${messageId} de ${recipientId}`);
    const response = await axios.post(url, payload, { params: { access_token: accessToken } });
    return response.data;
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

// Cliente HTTP para Gemini vía axios con conexiones NUEVAS (keepAlive:false).
// El fetch global (undici) reutiliza conexiones del pool que el servidor ya
// cerró y lanza "Premature close" en Render (aun con texto). axios + un agente
// sin keep-alive abre una conexión limpia por petición y elimina ese error.
const https = require('https');
const geminiAgent = new https.Agent({ keepAlive: false });
async function geminiHttp(url, { method = 'GET', body } = {}) {
    const resp = await axios.request({
        url,
        method,
        data: body,
        headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
        httpsAgent: geminiAgent,
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        responseType: 'json',
        validateStatus: () => true,
    });
    return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        json: async () => resp.data,
        text: async () => (typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data ?? '')),
    };
}

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
            await geminiHttp(`${GEMINI_BASE_URL}/${geminiCache.name}?key=${GEMINI_API_KEY}`, { method: 'DELETE' });
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

    const response = await geminiHttp(`${GEMINI_BASE_URL}/cachedContents?key=${GEMINI_API_KEY}`, {
        method: 'POST',
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
/**
 * Genera respuesta usando un modelo Pro (más potente, más lento). Modelo
 * configurable vía GEMINI_PRO_MODEL (default: gemini-3-pro).
 * Sin caching ni imágenes — pensado para análisis puntual.
 */
async function askGeminiPro(prompt, systemInstruction = null) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');
    const model = process.env.GEMINI_PRO_MODEL || 'gemini-3.1-pro-preview';
    const apiUrl = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    if (systemInstruction) {
        payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    const response = await geminiHttp(apiUrl, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Gemini Pro (${model}) respondió ${response.status}: ${errText.slice(0, 300)}`);
    }
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Gemini Pro no devolvió respuesta.');
    return {
        text,
        model,
        inputTokens: result.usageMetadata?.promptTokenCount || 0,
        outputTokens: result.usageMetadata?.candidatesTokenCount || 0
    };
}

async function generateGeminiResponse(prompt, imageParts = [], systemInstruction = null) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');
    const apiUrl = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ parts: [{ text: prompt }, ...imageParts] }] };
    if (systemInstruction) {
        payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const geminiResponse = await geminiHttp(apiUrl, { method: 'POST', body: JSON.stringify(payload) });
            if (!geminiResponse.ok) throw new Error(`La API de Gemini respondió con el estado: ${geminiResponse.status}`);
            result = await geminiResponse.json();
            break;
        } catch (e) {
            const retriable = /premature close|terminated|econnreset|fetch failed|network|aborted/i.test(String(e && e.message));
            if (attempt < 2 && retriable) { console.warn(`[AI] Gemini falló (${e.message}), reintentando...`); await new Promise(r => setTimeout(r, 800)); continue; }
            throw e;
        }
    }
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

    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
        let geminiResponse;
        try {
            geminiResponse = await geminiHttp(apiUrl, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        } catch (e) {
            const retriable = /premature close|terminated|econnreset|fetch failed|network|aborted/i.test(String(e && e.message));
            if (attempt < 2 && retriable) {
                console.warn(`[AI] Gemini con caché falló (${e.message}), reintentando...`);
                await new Promise(r => setTimeout(r, 800));
                continue;
            }
            throw e;
        }

        if (!geminiResponse.ok) {
            const errBody = await geminiResponse.text();
            if (geminiResponse.status === 404) {
                console.warn(`[AI] Cache 404 detectado (${cacheName}). Invalidando...`);
                invalidateGeminiCache();
            }
            throw new Error(`Gemini API con caché respondió ${geminiResponse.status}: ${errBody}`);
        }

        result = await geminiResponse.json();
        break;
    }
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

// --- Preparación segura de multimedia para Gemini -------------------------------
// Re-habilita el envío de imágenes/audios/videos del cliente al modelo, acotando el
// tamaño del request para NO reintroducir el "Premature close" que se daba con
// requests grandes en Render. Imágenes se redimensionan/comprimen; audio y video se
// incluyen solo si están por debajo del tope (si no, se omiten con aviso al modelo).
const GEMINI_MAX_IMAGE_DIM = 1024;                       // px (lado mayor) tras redimensionar
const GEMINI_IMAGE_QUALITY = 80;                         // calidad JPEG de salida
const GEMINI_MAX_IMAGE_FALLBACK_BYTES = 4 * 1024 * 1024; // tope si sharp no está disponible
const GEMINI_MAX_AUDIO_BYTES = 8 * 1024 * 1024;          // 8 MB por audio
const GEMINI_MAX_VIDEO_BYTES = 8 * 1024 * 1024;          // 8 MB por video
const GEMINI_MAX_TOTAL_MEDIA_BYTES = 12 * 1024 * 1024;   // 12 MB en total por request

/**
 * Convierte un archivo multimedia (imagen/audio/video) en una "part" inline segura
 * para Gemini. Devuelve { part, bytes } si se puede enviar, o { skipped: motivo } si no.
 */
async function buildSafeGeminiMediaPart(buffer, mimeType, type) {
    const cleanMime = String(mimeType || '').split(';')[0].trim();
    try {
        if (type === 'image') {
            try {
                const sharp = require('sharp');
                const out = await sharp(buffer)
                    .rotate() // respeta la orientación EXIF
                    .resize({ width: GEMINI_MAX_IMAGE_DIM, height: GEMINI_MAX_IMAGE_DIM, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: GEMINI_IMAGE_QUALITY })
                    .toBuffer();
                return { part: { inlineData: { data: out.toString('base64'), mimeType: 'image/jpeg' } }, bytes: out.length };
            } catch (e) {
                // Si sharp falla o no está disponible, mandar la imagen original solo si es chica.
                if (buffer.length > GEMINI_MAX_IMAGE_FALLBACK_BYTES) return { skipped: 'imagen grande sin redimensionar' };
                return { part: { inlineData: { data: buffer.toString('base64'), mimeType: cleanMime || 'image/jpeg' } }, bytes: buffer.length };
            }
        }
        if (type === 'audio') {
            if (buffer.length > GEMINI_MAX_AUDIO_BYTES) return { skipped: 'audio demasiado grande' };
            return { part: { inlineData: { data: buffer.toString('base64'), mimeType: cleanMime || 'audio/ogg' } }, bytes: buffer.length };
        }
        if (type === 'video') {
            if (buffer.length > GEMINI_MAX_VIDEO_BYTES) return { skipped: 'video demasiado grande' };
            return { part: { inlineData: { data: buffer.toString('base64'), mimeType: cleanMime || 'video/mp4' } }, bytes: buffer.length };
        }
        return { skipped: 'tipo no soportado' };
    } catch (e) {
        return { skipped: 'error al procesar: ' + e.message };
    }
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
        const generalSettings = generalSettingsDoc.exists ? generalSettingsDoc.data() : {};
        const globalBotActive = generalSettings.globalBotActive === true;
        // Kill-switch de la etapa 2 (post-venta). Activa por defecto; se apaga poniendo
        // crm_settings/general.postSaleStageActive = false desde Ajustes.
        const postSaleStageActive = generalSettings.postSaleStageActive !== false;

        const isIndividuallyActive = contactData.botActive === true;
        const shouldRun = isIndividuallyActive;

        if (!shouldRun) {
            console.log(`[AI] El bot ya no está activo para ${contactId} (Global: ${globalBotActive}, Individual: ${contactData.botActive}). Abortando respuesta.`);
            await contactRef.update({ aiStatus: admin.firestore.FieldValue.delete() }); // no dejar el estado 'generating' huérfano
            return;
        }

        // --- Obtener instrucciones del bot ---
        let botInstructions = 'Eres un asistente virtual amigable y servicial.';
        let departmentReferenceImages = []; // Imágenes estáticas del departamento como contexto

        // ¿El contacto ya cerró su venta y está en etapa 2 (post-venta)?
        const isPostVenta = postSaleStageActive && contactData.aiStage === 'postventa';

        if (isPostVenta) {
            // === ETAPA 2: prompt GLOBAL de post-venta (cobro / pedido listo / entrega) ===
            const postSettingsDoc = await db.collection('crm_settings').doc('postventa').get();
            const customPost = postSettingsDoc.exists ? (postSettingsDoc.data().instructions || '').trim() : '';
            botInstructions = customPost || DEFAULT_POSTVENTA_INSTRUCTIONS;
            console.log(`[AI] Contacto ${contactId} en ETAPA 2 (post-venta). Usando prompt global de post-venta${customPost ? ' personalizado' : ' por defecto'}.`);
        } else {
            // === ETAPA 1: prompt por anuncio → por departamento → general ===
            let promptResolved = false;

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
                    const response = await fetch(refImage.url, { signal: AbortSignal.timeout(15000) });
                    if (!response.ok) {
                        // Con Uniform Bucket-Level Access, las URLs storage.googleapis.com dan 403.
                        // NO metemos el cuerpo del error como "imagen" (eso cuelga/atraganta a Gemini): la omitimos.
                        console.warn(`[AI] Imagen de referencia del departamento no disponible (HTTP ${response.status}). Se omite.`);
                        continue;
                    }
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

        // --- Descargar y preparar multimedia de la conversación (dinámico) ---
        // Se redimensiona/acota cada archivo para evitar "Premature close" por requests
        // grandes (ver buildSafeGeminiMediaPart). Lo que no se pueda procesar se omite con aviso.
        const mediaParts = [];
        const skippedMediaTypes = [];
        let totalMediaBytes = 0;
        for (const media of downloadedMedia.reverse()) { // Voltear para mantener orden cronológico
            if (!media.url || !media.url.startsWith('http')) continue;
            try {
                const response = await fetch(media.url, { signal: AbortSignal.timeout(15000) });
                if (!response.ok) {
                    console.warn(`[AI] Multimedia de conversación no disponible (HTTP ${response.status}). Se omite.`);
                    skippedMediaTypes.push(media.type);
                    continue;
                }
                const buffer = Buffer.from(await response.arrayBuffer());
                if (buffer.length === 0) continue;
                const prepared = await buildSafeGeminiMediaPart(buffer, media.mimeType, media.type);
                if (prepared.skipped) {
                    console.warn(`[AI] Multimedia (${media.type}) omitida: ${prepared.skipped}.`);
                    skippedMediaTypes.push(media.type);
                    continue;
                }
                if (totalMediaBytes + prepared.bytes > GEMINI_MAX_TOTAL_MEDIA_BYTES) {
                    console.warn(`[AI] Multimedia (${media.type}) omitida: excede el total permitido por request.`);
                    skippedMediaTypes.push(media.type);
                    continue;
                }
                mediaParts.push(prepared.part);
                totalMediaBytes += prepared.bytes;
                console.log(`[AI] Multimedia (${media.type}) lista para Gemini: ${Math.round(prepared.bytes / 1024)} KB${media.type === 'image' ? ' (redimensionada)' : ''}.`);
            } catch (e) {
                console.warn('[AI] Error preparando multimedia para contexto:', e.message);
                skippedMediaTypes.push(media.type);
            }
        }
        const esTipoMedia = (t) => t === 'image' ? 'imagen' : t === 'audio' ? 'audio' : t === 'video' ? 'video' : 'archivo';
        const skippedMediaNote = skippedMediaTypes.length > 0
            ? `\n\n**Nota:** El cliente envió ${skippedMediaTypes.length} archivo(s) (${skippedMediaTypes.map(esTipoMedia).join(', ')}) que no se pudieron procesar (probablemente muy grandes). Pídele amablemente que te describa por texto su contenido o que lo reenvíe más corto.`
            : '';
        const fallbackMediaNote = downloadedMedia.length > 0
            ? `\n\n**Nota:** El cliente envió archivo(s) multimedia (${downloadedMedia.map(m => esTipoMedia(m.type)).join(', ')}) que no pudiste analizar en este momento. Pídele amablemente que te describa por texto su contenido.`
            : '';

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

        // Fecha/hora actual de México para que la IA calcule bien los tiempos de entrega.
        // Sin esto el modelo no sabe qué día es "hoy" (su conocimiento es de ene-2025) y su
        // regla de fechas límite no funciona.
        const nowMx = new Date().toLocaleString('es-MX', {
            timeZone: 'America/Mexico_City',
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
        const fechaActualNote = `\n\n**Fecha y hora actual en México:** ${nowMx}. Usa SIEMPRE esta fecha como "hoy" para calcular tiempos de entrega cuando el cliente mencione una fecha límite; nunca la inventes.`;

        const dynamicPrompt = `${fechaActualNote}${shippingInfo}${deptImagesNote}${skippedMediaNote}\n\n**Historial de la Conversación Reciente:**\n${conversationHistory}\n\n**Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si detectas que el cliente pregunta por envío o paquetería y tienes cotización disponible, comparte las mejores opciones. Si el número de 5 dígitos NO parece un código postal (es un pedido, monto, etc.), no menciones envíos. Si el cliente envió fotos, audios o videos, analízalos cuidadosamente para ayudarle en lo que necesita. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;

        // --- Intentar usar Context Caching ---
        let aiResult;
        try {
            // El caché guarda SOLO texto (instrucciones). Las imágenes de referencia del
            // departamento NO se cachean (podían ser grandes y causaban "Premature close").
            // La multimedia que envía el CLIENTE sí se manda al modelo, ya acotada, en mediaParts.
            const cacheName = await getOrCreateCache(botInstructions, [], '');
            if (cacheName) {
                console.log(`[AI] Generando respuesta con Context Caching para ${contactId}. (texto + ${mediaParts.length} archivo(s) multimedia; ${departmentImageParts.length} imgs dept cacheadas)`);
                // Enviamos la multimedia de la conversación (mediaParts) ya redimensionada/acotada
                // por buildSafeGeminiMediaPart. El tope de tamaño evita el "Premature close" que
                // antes provocaban los requests grandes; el reintento interno cubre fallos transitorios.
                aiResult = await generateGeminiResponseWithCache(cacheName, dynamicPrompt, mediaParts);
                console.log(`[AI] 💰 Tokens cacheados: ${aiResult.cachedTokens}, Tokens nuevos de entrada: ${aiResult.inputTokens}, Salida: ${aiResult.outputTokens}`);
            } else {
                throw new Error('Caché no disponible, usando fallback.');
            }
        } catch (cacheError) {
            // Fallback: si el caching falla por cualquier razón, usar el método tradicional con systemInstruction.
            // Aquí vamos SOLO con texto (sin multimedia) para garantizar que el cliente reciba respuesta
            // aunque el caché o la multimedia estén fallando; avisamos a la IA que hubo archivos sin analizar.
            console.warn(`[AI] ⚠️ Caché falló (${cacheError.message}). Usando método sin caché (solo texto).`);
            const { systemText: fallbackSystem, referenceText: fallbackRef } = await buildStaticContext(botInstructions);
            const fullPrompt = `${fallbackRef}${fechaActualNote}${shippingInfo}${deptImagesNote}${fallbackMediaNote}\n\n**Historial de la Conversación Reciente:**\n${conversationHistory}\n\n**Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;
            aiResult = await generateGeminiResponse(fullPrompt, [], fallbackSystem);
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

        // Detectar cierre de venta (/final o frase de pedido) de forma insensible a mayúsculas.
        // En ETAPA 1 esto NO apaga el bot: lo hace pasar a ETAPA 2 (post-venta) para que la
        // IA siga atendiendo (cobro, pedido listo, entrega). En etapa 2 ya no aplica.
        const saleClosed = /\/final/i.test(aiResponse) || /ya registramos tu pedido/i.test(aiResponse);
        const shouldTransitionToPostVenta = postSaleStageActive && !isPostVenta && saleClosed;
        // Compat: si la etapa 2 está apagada (kill-switch), /final conserva el comportamiento
        // anterior de desactivar el bot y mandar a Pendientes IA.
        const shouldDeactivate = !postSaleStageActive && saleClosed;
        // En ETAPA 2, si el cliente quiere otro pedido la IA emite /nuevopedido para
        // regresar a la etapa de venta (etapa 1); el siguiente turno lo atiende ventas.
        const wantsNewOrder = isPostVenta && /\/nuevopedido/i.test(aiResponse);

        // Limpiar los comandos (/final, /nuevopedido) de los mensajes antes de enviar
        aiMessages = aiMessages.map(m => m.replace(/\/final/ig, '').replace(/\/nuevopedido/ig, '').trim()).filter(m => m.length > 0);

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

        if (shouldTransitionToPostVenta) {
            // Cierre de venta con etapa 2 activa: la IA NO se apaga, pasa a post-venta y
            // sigue atendiendo. Se mantiene el envío a Pendientes IA para que un humano
            // registre/procese el pedido mientras la IA gestiona cobro y entrega.
            updateData.aiStage = 'postventa';
            updateData.status = 'pendientes_ia';
            console.log(`[AI] Venta cerrada para ${contactId}. Pasando a ETAPA 2 (post-venta); la IA sigue activa. Moviendo a Pendientes IA.`);
        } else if (wantsNewOrder) {
            // El cliente quiere otro pedido: regresar a ETAPA 1 (venta). El bot sigue
            // activo y el próximo turno lo atiende la IA de ventas (prompt por anuncio/depto).
            updateData.aiStage = 'venta';
            console.log(`[AI] Cliente ${contactId} quiere un nuevo pedido. Regresando a ETAPA 1 (venta).`);
        } else if (shouldDeactivate) {
            // Etapa 2 apagada (kill-switch): comportamiento anterior, se desactiva el bot.
            updateData.botActive = false;
            updateData.status = 'pendientes_ia';
            console.log(`[AI] Desactivación automática activada para ${contactId} por comando o frase clave. Moviendo a Pendientes IA.`);
        }

        await contactRef.update(updateData);
        console.log(`[AI] Respuesta de IA enviada a ${contactId}. (Burbujas enviadas: ${aiMessages.length})`);

        // Híbrido: si el pedido NO se acaba de registrar, etiquetar "en vivo" el estado
        // del pedido (pendiente de foto, etc.) reutilizando el historial ya armado. El
        // scheduler de order_followup leerá esta etiqueta y se ahorrará una clasificación.
        // Fire-and-forget: nunca debe afectar la respuesta principal. En post-venta el
        // pedido ya está tomado, así que no se etiqueta.
        if (!shouldTransitionToPostVenta && !shouldDeactivate && !isPostVenta) {
            tagOrderInProgress(contactId, contactRef, conversationHistory, contactData.name)
                .catch(e => console.warn('[ORDER_FOLLOWUP] live-tag falló:', e.message));
        }
    } catch (error) {
        console.error(`❌ [AI] Error en el proceso de IA para ${contactId}:`, error.message);
        // Asegurarse de limpiar el estado incluso en error. Guardamos el último
        // error para diagnóstico (visible en Firestore sin depender de los logs).
        await contactRef.update({
            aiStatus: admin.firestore.FieldValue.delete(),
            aiLastError: String(error && error.message || error).slice(0, 600),
            aiLastErrorAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
}

/**
 * Etiqueta "en vivo" el estado de pedido del contacto (parte de escritura del híbrido
 * de order_followup). Reutiliza el historial ya construido por la IA, clasifica una
 * sola vez y deja la etiqueta en contacts_whatsapp/{id}.orderTag para que el scheduler
 * de seguimiento la aproveche. Es fire-and-forget: cualquier error solo se loguea.
 */
async function tagOrderInProgress(contactId, contactRef, conversationHistory, name) {
    if (!conversationHistory) return;
    // require perezoso para evitar ciclo de módulos en carga
    const { getOrderFollowupConfig } = require('./leads/orderFollowupScheduler');
    const { classifyOrderIntent } = require('./leads/orderIntentClassifier');

    const cfg = await getOrderFollowupConfig();
    if (!cfg.enabled || !cfg.liveTagging) return;

    const cls = await classifyOrderIntent({ conversationText: conversationHistory, name });
    if (!cls) return;

    await contactRef.update({
        orderTag: {
            enProceso: cls.enProceso,
            datosDados: cls.datosDados,
            pendiente: cls.pendiente,
            mensajes: cls.mensajes,
            at: admin.firestore.FieldValue.serverTimestamp()
        }
    });
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

/**
 * Resuelve la atribución de un pedido al ad más reciente del contacto antes de cierta fecha.
 * Busca en la subcolección messages del contacto el último mensaje con adId <= beforeTimestamp.
 * Si no hay ad reciente, cae al adReferral del contacto. Si tampoco, marca como 'organic'.
 *
 * @param {string} contactId - ID del contacto (contacts_whatsapp).
 * @param {FirebaseFirestore.Timestamp|Date} beforeTimestamp - Cota superior para el ad referral.
 * @returns {Promise<{ leadDate: FirebaseFirestore.Timestamp|null, attributedAdId: string|null, leadSource: 'ad'|'organic' }>}
 */
async function getPedidoAttribution(contactId, beforeTimestamp) {
    const fallback = { leadDate: null, attributedAdId: null, leadSource: 'organic' };
    if (!contactId) return fallback;

    const beforeTs = beforeTimestamp instanceof admin.firestore.Timestamp
        ? beforeTimestamp
        : admin.firestore.Timestamp.fromDate(beforeTimestamp instanceof Date ? beforeTimestamp : new Date(beforeTimestamp));

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);

        // Buscar últimos 200 mensajes <= beforeTimestamp y encontrar el primero con adId.
        // No usamos where('adId', '!=', null) para no requerir índice compuesto adicional.
        const msgSnap = await contactRef.collection('messages')
            .where('timestamp', '<=', beforeTs)
            .orderBy('timestamp', 'desc')
            .limit(200)
            .get();

        for (const doc of msgSnap.docs) {
            const data = doc.data();
            if (data.adId) {
                return {
                    leadDate: data.timestamp || null,
                    attributedAdId: String(data.adId),
                    leadSource: 'ad'
                };
            }
        }

        // Fallback: usar adReferral del contacto si existe (suele ser el primer ad que lo trajo).
        const contactDoc = await contactRef.get();
        if (contactDoc.exists) {
            const ref = contactDoc.data().adReferral;
            if (ref && ref.source_id) {
                return {
                    leadDate: contactDoc.data().createdAt || null,
                    attributedAdId: String(ref.source_id),
                    leadSource: 'ad'
                };
            }
        }
    } catch (err) {
        console.error(`[ATTRIBUTION] Error resolviendo atribución para ${contactId}:`, err.message);
    }

    return fallback;
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
    processAutoReplyAI,
    cancelAiResponse,
    getShippingQuote,
    sendConversionEvent,
    sendAdvancedWhatsAppMessage,
    sendMessengerMessage,
    messengerMediaSelfTest,
    sendMessengerUtilityMessage,
    sendInstagramReaction,
    invalidateGeminiCache,
    getMetaSpend,
    getPedidoAttribution,
    askGeminiPro
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
