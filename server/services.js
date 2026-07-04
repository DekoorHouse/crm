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
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID; // para enviar plantillas aprobadas

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
const DEFAULT_POSTVENTA_INSTRUCTIONS = `Eres el asistente de POST-VENTA de DekoorHouse. El pedido del cliente YA ESTÁ LISTO: el equipo le envió la foto del trabajo terminado junto con los datos de pago (/cuatro). Tu trabajo es acompañarlo desde ahí: gestionar el pago (cobro), validar comprobantes y coordinar la entrega o envío.

TONO: cálido, cercano y breve, en español de México. Usa emojis con mesura. Si necesitas mandar varios mensajes cortos, sepáralos con [SPLIT].

DATOS DE PAGO (compártelos cuando el cliente pregunte cómo pagar — solo los que apliquen — y pídele que te envíe su comprobante al pagar):
- Transferencia BBVA, a nombre de Christian Morales: cuenta terminación 3262 o tarjeta terminación 0670.
- Pago en OXXO: depósito a tarjeta terminación 9250.

VALIDACIÓN DE COMPROBANTES (cuando el cliente envíe una imagen o PDF de su pago):
Analízalo y extrae: monto, fecha y hora, banco, folio o clave de rastreo, y la cuenta/tarjeta DESTINO (a quién se le pagó, NO la del cliente). Luego verifica:
1) DESTINO correcto:
   - Si es TRANSFERENCIA: debe ir a Christian Morales y la cuenta terminar en 3262 o la tarjeta en 0670.
   - Si es TICKET DE OXXO: la tarjeta/cuenta destino debe terminar en 9250.
   - Si el destino NO coincide (otro nombre u otra terminación), NO confirmes el pago: dile con amabilidad que el comprobante no coincide con nuestros datos y que un agente lo revisará. No acuses ni regañes, solo escala.
2) MONTO: compáralo con el total acordado en la conversación. Si es menor, indícale cuánto falta. Si no hay un total claro, no lo inventes.
3) FOLIO y FECHA: deben estar presentes y la fecha ser reciente/coherente. Si falta el folio, la imagen está ilegible, o el PDF viene protegido y no puedes leerlo, pide amablemente que reenvíe el comprobante como captura clara.

- Si TODO coincide (destino correcto y monto correcto): agradece y dile que RECIBIMOS su comprobante, que lo validamos y le confirmamos en breve. NO afirmes por tu cuenta "pago confirmado/acreditado"; un agente concilia el depósito.
- Si algo NO cuadra o no puedes leerlo: no confirmes, explica con tacto qué falta o avísale que un agente lo revisará.
- NUNCA des por recibido un pago que no puedas verificar en el comprobante.

PEDIDO LISTO / ENVÍO: si el cliente pregunta por el estatus, dale una respuesta tranquilizadora; si te consta que ya está listo o en camino, avísale y comparte la guía/seguimiento si la tienes. No inventes fechas ni números de guía.

ENTREGA: coordina dirección, horario o punto de recolección según aplique.

NUEVO PEDIDO: si el cliente quiere comprar otra cosa o hacer OTRO pedido, salúdalo con entusiasmo (ej. "¡Claro que sí! 🎉 Con gusto te ayudo con tu nuevo pedido") y escribe al final de tu mensaje el comando /nuevopedido. Ese comando regresa la conversación al área de ventas y NO lo ve el cliente.

QUÉ NO HACES:
- No inventes montos, fechas, folios, números de guía ni estatus que no tengas confirmados.
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
// Un caché por prompt (hash del contenido). Los prompts varían por anuncio, por
// departamento y por etapa (post-venta); con un slot único, cada alternancia de
// contactos con prompts distintos borraba y recreaba el caché (thrashing) y una
// petición podía borrar el caché que otra estaba usando (404 → fallback degradado).
const GEMINI_CACHE_TTL_MS = 30 * 60 * 1000; // debe coincidir con CACHE_TTL
const GEMINI_CACHE_MAX_ENTRIES = 20;
const geminiCaches = new Map();         // contentHash -> { name, createdAt }
const geminiCacheCreations = new Map(); // contentHash -> Promise (creación en vuelo)

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
async function buildStaticContext(botInstructions, isPostVenta = false) {
    const knowledgeBaseSnapshot = await db.collection('ai_knowledge_base').get();
    const knowledgeBase = knowledgeBaseSnapshot.docs.map(doc => `- ${doc.data().topic}: ${doc.data().answer}`).join('\n');

    const quickRepliesSnapshot = await db.collection('quick_replies').get();
    const quickReplies = quickRepliesSnapshot.docs
        .filter(doc => doc.data().message)
        .map(doc => `- ${doc.data().shortcut}: ${doc.data().message}`)
        .join('\n');

    // La regla de cierre SOLO aplica en etapa de venta: en post-venta el pedido ya cerró
    // y esta regla hacía que el modelo repitiera "Ya registramos tu pedido" en cada mensaje.
    // Con el registro automático por IA activo (crm_settings/ai_order_registration), la regla
    // se REEMPLAZA por el protocolo de validación + /registrar (ver orders/aiOrderRegistration.js):
    // la IA valida el resumen con el cliente y, al confirmar, el sistema registra el pedido solo.
    // El texto entra al hash del Context Cache, así que encender/apagar el flag renueva el caché.
    let closingRule = '';
    if (!isPostVenta) {
        let aiOrderCfg = null;
        try {
            const aiOrderReg = require('./orders/aiOrderRegistration');
            aiOrderCfg = await aiOrderReg.getAiOrderConfig();
            if (aiOrderCfg.enabled) closingRule = aiOrderReg.buildRegistrationRule(aiOrderCfg);
        } catch (e) {
            console.warn('[AI_ORDER] No se pudo leer la config del registro automático; se usa la regla de cierre clásica:', e.message);
        }
        if (!closingRule) {
            closingRule = `\n\n**Regla Especial de Cierre de Pedido:** Cuando el usuario haya proporcionado todos los datos necesarios y el pedido esté listo para ser procesado por un humano, debes responder ÚNICAMENTE incluyendo la frase exacta "Ya registramos tu pedido" seguido de cualquier instrucción adicional de despedida. Esta frase es un comando interno para el sistema.`;
        }
    }

    // Instrucciones van en systemInstruction, no en contents
    const systemText = `${botInstructions}${closingRule}\n\n**Regla Especial de Mensajes Múltiples:** SOLO usa la etiqueta [SPLIT] si tus instrucciones EXPLÍCITAMENTE dicen enviar algo "en otro mensaje", "seguido de" otro mensaje, o "en dos mensajes separados". Si NO hay una instrucción explícita de separar en varios mensajes, responde TODO en un ÚNICO mensaje. NUNCA dividas una respuesta en múltiples mensajes por tu cuenta. (Ejemplo de uso correcto: Hola, este es mi primer mensaje [SPLIT] y este es mi segundo mensaje). NO escribas "Mensaje 1:" ni cosas similares, solo la etiqueta [SPLIT].\n\n**Regla de Citar Mensajes:** Si por la naturaleza de la conversación crees que es estrictamente necesario "citar" o "responder directamente" al mensaje del cliente para que no se pierda el contexto (por ejemplo, si responde a una pregunta vieja), agerga la etiqueta [CITA] al INICIO de tu respuesta. Usa esta opción con moderación. Si el flujo es normal, simplemente responde de forma natural sin la etiqueta.`;

    // Material de referencia va en contents (como contexto, no como instrucciones)
    const referenceText = `**Base de Conocimiento (Usa esta información para responder preguntas frecuentes):**\n${knowledgeBase || 'No hay información adicional.'}\n\n**Respuestas Rápidas del Equipo:** Si una de estas respuestas aplica perfectamente, puedes enviarla respondiendo ÚNICAMENTE con su atajo (ejemplo: responde exactamente "/ttt" y nada más); el sistema lo reemplazará automáticamente por su contenido completo, incluida cualquier imagen. También puedes escribir el contenido directamente si lo prefieres. NUNCA combines un atajo con más texto en el mismo mensaje.\n${quickReplies || 'No hay respuestas rápidas.'}`;

    return { systemText, referenceText };
}

/**
 * Busca una respuesta rápida por su atajo. Normaliza (sin "/" inicial, minúsculas) para
 * tolerar que el atajo venga con o sin barra. Devuelve los datos de la quick reply o null.
 */
async function findQuickReplyByShortcut(shortcut) {
    if (!shortcut) return null;
    try {
        // Normaliza: sin "/" inicial, sin espacios extra (colapsa múltiples), minúsculas.
        // Así "/mas modelos", "mas  modelos", "Mas Modelos" hacen match con el atajo guardado.
        const normalize = s => String(s || '').replace(/^\/+/, '').trim().replace(/\s+/g, ' ').toLowerCase();
        const norm = normalize(shortcut);
        const snap = await db.collection('quick_replies').get();
        const doc = snap.docs.find(d => normalize(d.data().shortcut) === norm);
        return doc ? doc.data() : null;
    } catch (e) {
        console.warn('[AI] No se pudo leer quick_replies para expandir atajo:', e.message);
        return null;
    }
}

// Número del admin que verifica comprobantes sospechosos (formato internacional, 52 + 1 + 10 díg.)
const ADMIN_VERIFY_PHONE = process.env.ADMIN_VERIFY_PHONE || '5216182297167';

/**
 * Devuelve el número del último pedido registrado del contacto en formato "DH####",
 * o null si no tiene pedidos. Se usa para rellenar el atajo /DatosEstafeta.
 */
async function getLastOrderNumberForContact(contactId) {
    try {
        const snap = await db.collection('pedidos').where('telefono', '==', contactId).get();
        if (snap.empty) return null;
        let bestNum = null, bestMs = -1;
        snap.forEach(doc => {
            const d = doc.data();
            if (d.consecutiveOrderNumber == null) return;
            const ms = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0;
            if (ms >= bestMs) { bestMs = ms; bestNum = d.consecutiveOrderNumber; }
        });
        return bestNum != null ? `DH${bestNum}` : null;
    } catch (e) {
        console.warn('[AI] No se pudo obtener el último pedido para', contactId, e.message);
        return null;
    }
}

/**
 * Reenvía un comprobante sospechoso al admin por WhatsApp (texto + imagen) para que lo
 * verifique manualmente. Fire-and-forget: cualquier error solo se loguea. OJO: si el admin
 * no tiene ventana de 24h abierta con el número del negocio, el envío libre puede fallar
 * (pendiente: plantilla aprobada para garantizar la entrega).
 */
async function alertAdminSuspiciousReceipt(contactId, contactData, comprobante) {
    try {
        const name = (contactData && contactData.name) || contactId;
        const text = `⚠️ *Comprobante a verificar*\n\n*Cliente:* ${name}\n*Tel:* ${contactId}\n\nLa IA detectó que este comprobante NO coincide con nuestros datos. Revísalo y confirma si el pago es válido. (Al cliente solo se le dijo que estamos validando su pago.)`;
        const opts = { text };
        if (comprobante && comprobante.fileUrl) {
            opts.fileUrl = comprobante.fileUrl;
            opts.fileType = comprobante.fileType || 'image/jpeg';
        }
        await sendAdvancedWhatsAppMessage(ADMIN_VERIFY_PHONE, opts);
        console.log(`[AI] Alerta de comprobante sospechoso enviada al admin (${ADMIN_VERIFY_PHONE}) por ${contactId}.`);
    } catch (e) {
        console.warn('[AI] No se pudo alertar al admin del comprobante sospechoso:', e.message);
    }
}

/**
 * Avisa al admin que la IA necesita apoyo humano en un chat (comando interno /equipo).
 * Caso típico: el cliente pide una foto/video de su pedido que la IA no tiene y no puede
 * generar. Fire-and-forget: cualquier error solo se loguea.
 */
async function alertAdminHumanNeeded(contactId, contactData, clientRequest) {
    try {
        const name = (contactData && contactData.name) || contactId;
        const request = String(clientRequest || '').trim().slice(0, 300);
        const text = `🙋 *La IA pide apoyo humano*\n\n*Cliente:* ${name}\n*Tel:* ${contactId}\n\nLa IA necesita que un humano atienda este chat (p. ej. el cliente pide una foto/video del pedido, o dio sus datos de envío por texto y hay que capturarlos)${request ? `:\n_"${request}"_` : '.'}\n\nRevisa la conversación y entra a atenderlo.`;
        await sendAdvancedWhatsAppMessage(ADMIN_VERIFY_PHONE, { text });
        console.log(`[AI] Alerta de apoyo humano (/equipo) enviada al admin (${ADMIN_VERIFY_PHONE}) por ${contactId}.`);
    } catch (e) {
        console.warn('[AI] No se pudo alertar al admin del apoyo humano:', e.message);
    }
}

// Base pública del sitio para armar enlaces (formulario de datos de envío, etc.). Sin barra final.
const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://app.dekoormx.com').replace(/\/+$/, '');

/**
 * Cuando la IA valida un comprobante de pago GENUINO (comando /comprobante) —o el operador lo
 * dispara manualmente desde el CRM— marca el pedido MÁS RECIENTE del contacto como "comprobante
 * validado" (campo comprobanteValidadoAt, para que aparezca en la sección "Envíos" del CRM) y le
 * envía al cliente el enlace del formulario de datos de envío con su número de pedido precargado.
 * Devuelve el número de pedido (DHxxxx), o null si el contacto no tiene pedido registrado.
 * Nunca lanza: atrapa y loguea sus errores.
 */
async function markComprobanteValidadoAndSendForm(contactId, contactData = {}, { force = false } = {}) {
    const orderDoc = await getLatestOrderForContact(contactId);
    if (!orderDoc) {
        console.warn(`[ENVIOS] ${contactId} validó comprobante pero no tiene pedido registrado; no se envía el formulario.`);
        return null;
    }
    const orderData = orderDoc.data();
    const orderNumber = orderData.consecutiveOrderNumber != null ? `DH${orderData.consecutiveOrderNumber}` : null;
    if (!orderNumber) {
        console.warn(`[ENVIOS] Pedido ${orderDoc.id} sin consecutiveOrderNumber; no se envía el formulario.`);
        return null;
    }
    // Guard de estatus: NO mandar el formulario de un pedido CANCELADO o ya ENTREGADO/DEVUELTO
    // (defensa por si la IA emite /comprobante contra el pedido equivocado — p. ej. un comprador
    // recurrente cuyo pedido más reciente aún es uno viejo). El botón manual (force) sí procede.
    const estatusPedido = String(orderData.estatus || '').toLowerCase();
    if (!force && /cancel|entregad|devol/.test(estatusPedido)) {
        console.log(`[ENVIOS] Pedido ${orderNumber} está "${orderData.estatus}"; no se envía el formulario automáticamente.`);
        return null;
    }
    // Idempotencia: si el formulario YA se envió para este pedido (comprobanteValidadoAt existe)
    // y NO es un reenvío deliberado del agente, NO reenvíes el bloque completo del formulario. La
    // IA re-emite /comprobante en turnos siguientes porque el comprobante sigue en su ventana de
    // contexto (24h), lo que reenviaba el formulario 3-4 veces (caso real fb_27538335665785398 /
    // DH13041). En ese caso mandamos un recordatorio CORTO en vez del bloque completo (y sin
    // re-marcar el pedido), para no saturar pero tampoco dejar al cliente sin respuesta. El botón
    // "Formulario de envío" del CRM pasa force=true y sí reenvía el formulario completo.
    const alreadySent = !force && !!orderData.comprobanteValidadoAt;
    if (!alreadySent) {
        // Marcar el pedido para la sección Envíos (refresca la fecha si ya estaba marcado).
        try {
            await orderDoc.ref.update({ comprobanteValidadoAt: admin.firestore.FieldValue.serverTimestamp() });
        } catch (e) {
            console.warn(`[ENVIOS] No se pudo marcar comprobanteValidadoAt en ${orderDoc.id}:`, e.message);
        }
    } else {
        console.log(`[ENVIOS] Formulario ya enviado antes para ${orderNumber} (${contactId}); se manda solo un recordatorio corto.`);
    }
    // Enviar al cliente el enlace del formulario (por su canal) y reflejarlo en el chat del CRM.
    const formUrl = `${APP_BASE_URL}/datos-estafeta/${orderNumber}`;
    const text = alreadySent
        ? `Quedamos al pendiente de tus datos de envío en el formulario que te compartimos 👆✨ (si no te llegó, avísame y te lo reenvío).`
        : `¡Gracias! 🙌 Ya validamos tu comprobante de pago ✅\n\nAhora llena tus datos de envío en este formulario 👇 (tu número de pedido ya viene cargado):\n${formUrl}\n\nEn cuanto lo completes preparamos tu envío 📦✨`;
    try {
        const channel = contactData.channel || 'whatsapp';
        let sent;
        if (channel === 'messenger' || channel === 'instagram') {
            const recipientId = contactData.psid || contactData.igsid || contactId.replace(/^(fb_|ig_)/, '');
            const r = await sendMessengerMessage(recipientId, { text, channel });
            sent = { id: r.messages?.[0]?.id || null, textForDb: text };
        } else {
            sent = await sendAdvancedWhatsAppMessage(contactId, { text });
        }
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        await contactRef.collection('messages').add({
            from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: sent.id || null, text: sent.textForDb || text, isAutoReply: true, channel
        });
        await contactRef.update({
            lastMessage: (sent.textForDb || text).substring(0, 100),
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[ENVIOS] Formulario de envío enviado a ${contactId} para ${orderNumber}.`);
    } catch (e) {
        console.warn(`[ENVIOS] No se pudo enviar el formulario a ${contactId}:`, e.message);
    }
    return orderNumber;
}

// Número de Rosario (encargada de generar las guías de envío). Formato internacional 52 + 1 + 10 díg.
const SHIPPING_NOTIFY_PHONE = process.env.ROSARIO_PHONE || '5216181441382';
// Plantilla aprobada en Meta para avisar a Rosario (funciona aunque la ventana de 24h esté cerrada).
// {{1}}=nº de pedido, {{2}}=nombre del cliente, {{3}}=datos de envío (aplanados a una línea).
const SHIPPING_READY_TEMPLATE = process.env.SHIPPING_READY_TEMPLATE || 'datos_envio_listos';

// Lee de crm_settings/general cuándo enviar el evento Purchase a Meta: 'registration'
// (al registrar el pedido) o 'fabricar' (al pasar a estatus "Fabricar", valor por defecto).
// Movido desde apiRoutes.js para poder reutilizarlo también en la IA de post-venta. Nunca lanza.
async function getPurchaseEventTrigger() {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        return (doc.exists && doc.data().purchaseEventTrigger === 'registration') ? 'registration' : 'fabricar';
    } catch (e) {
        return 'fabricar';
    }
}

// Envía el evento Purchase a Meta CAPI cuando un pedido entra a "Fabricar" por primera vez.
// Idempotente vía pedido.metaPurchaseSentAt para no duplicar el evento aunque el estatus
// rebote o se edite el pedido varias veces. Nunca lanza (atrapa sus errores).
// Movido desde apiRoutes.js para compartirlo con markOrderFabricarForContact.
async function sendPurchaseEventOnFabricar(orderId, orderData, oldStatusLower) {
    try {
        if (!orderData || orderData.estatus !== 'Fabricar') return; // solo al entrar a Fabricar
        if ((oldStatusLower || '').includes('fabricar')) return;    // ya estaba en Fabricar
        if (orderData.metaPurchaseSentAt) return;                   // idempotencia: ya se envió
        if (!orderData.contactId) return;
        if ((await getPurchaseEventTrigger()) !== 'fabricar') return; // el ajuste lo cambió a "registro"

        const contactSnap = await db.collection('contacts_whatsapp').doc(orderData.contactId).get();
        const contactData = contactSnap.exists ? contactSnap.data() : null;
        if (!contactData?.wa_id) {
            console.warn(`[META EVENT] Contacto ${orderData.contactId} sin wa_id. No se envió Purchase (pedido ${orderId}).`);
            return;
        }

        const eventInfo = { wa_id: contactData.wa_id, profile: { name: contactData.name } };
        const customData = { value: Number(orderData.precio) || 0, currency: 'MXN' };
        console.log(`[META EVENT] Enviando Purchase por cambio a Fabricar, pedido ${orderId}, contacto ${orderData.contactId}`);
        await sendConversionEvent('Purchase', eventInfo, contactData.adReferral || {}, customData);
        await db.collection('pedidos').doc(orderId).update({ metaPurchaseSentAt: admin.firestore.FieldValue.serverTimestamp() });
        console.log(`[META EVENT] ✅ Evento Purchase enviado por Fabricar, pedido ${orderId}, valor $${Number(orderData.precio) || 0}`);
    } catch (metaError) {
        console.error(`[META EVENT] Error al enviar Purchase por Fabricar (pedido ${orderId}):`, metaError.message);
        if (metaError.response) console.error('[META EVENT] Respuesta:', JSON.stringify(metaError.response.data));
        // No fallar el request principal por un error en Meta
    }
}

/**
 * Devuelve el pedido MÁS RECIENTE del contacto (doc snapshot) o null. Los pedidos guardan
 * el teléfono tanto en `telefono` como en `contactId`; se consultan ambos por seguridad.
 */
async function getLatestOrderForContact(contactId) {
    try {
        const seen = new Map();
        for (const field of ['telefono', 'contactId']) {
            const snap = await db.collection('pedidos').where(field, '==', contactId).get();
            snap.forEach(doc => seen.set(doc.id, doc));
        }
        if (seen.size === 0) return null;
        let best = null, bestMs = -1;
        for (const doc of seen.values()) {
            const d = doc.data();
            const ms = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0;
            if (ms >= bestMs) { bestMs = ms; best = doc; }
        }
        return best;
    } catch (e) {
        console.warn('[POSTVENTA] No se pudo obtener el último pedido para', contactId, e.message);
        return null;
    }
}

// Sanitiza el texto de un parámetro de plantilla de Meta: sin saltos de línea/tabs ni espacios
// corridos (Meta los rechaza), recortado a un largo prudente.
function sanitizeTemplateParam(text) {
    return String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 700);
}

/**
 * Envía un mensaje de PLANTILLA aprobada de Meta (patrón carritos/recordatorios). A diferencia
 * del envío libre, funciona AUNQUE la ventana de 24h esté cerrada. Busca la plantilla aprobada
 * por nombre, rellena sus {{n}} con `params` en orden, la manda y refleja el texto renderizado en
 * el chat del CRM. Lanza si faltan credenciales o la plantilla no está aprobada (para que el
 * llamador pueda hacer fallback a envío libre).
 */
async function sendApprovedTemplateMessage(waId, templateName, params = [], { source } = {}) {
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        throw new Error('Faltan credenciales de WhatsApp Business (WHATSAPP_BUSINESS_ACCOUNT_ID/WHATSAPP_TOKEN/PHONE_NUMBER_ID)');
    }
    // 1) Buscar la plantilla APROBADA por nombre
    const listUrl = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?limit=200`;
    const listRes = await axios.get(listUrl, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
    const approved = (listRes.data?.data || []).filter(t => t.status === 'APPROVED');
    const template = approved.find(t => t.name === templateName);
    if (!template) {
        const names = approved.map(t => t.name).join(', ') || '(ninguna)';
        throw new Error(`Plantilla "${templateName}" no encontrada o no aprobada. Aprobadas: ${names}`);
    }
    // 2) Rellenar los {{n}} del BODY con params en orden (Meta rechaza parámetros vacíos → '—')
    const bodyComp = (template.components || []).find(c => c.type === 'BODY');
    const placeholders = (bodyComp?.text || '').match(/\{\{\d+\}\}/g) || [];
    const langCode = template.language || 'es_MX';
    const cleanParams = placeholders.map((_, i) => sanitizeTemplateParam(params[i] != null ? params[i] : '') || '—');
    const components = placeholders.length > 0
        ? [{ type: 'body', parameters: cleanParams.map(text => ({ type: 'text', text })) }]
        : [];
    const payload = {
        messaging_product: 'whatsapp',
        to: waId,
        type: 'template',
        template: { name: template.name, language: { code: langCode } }
    };
    if (components.length > 0) payload.template.components = components;

    // 3) Enviar
    const sendUrl = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const sendRes = await axios.post(sendUrl, payload, {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
    });
    const messageId = sendRes.data?.messages?.[0]?.id || null;

    // 4) Reflejar el mensaje renderizado en el chat del CRM (para que se vea el envío)
    let renderedText = bodyComp?.text || '';
    cleanParams.forEach((val, i) => { renderedText = renderedText.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), val); });
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(waId);
        await contactRef.collection('messages').add({
            from: PHONE_NUMBER_ID, status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: messageId, text: renderedText, templateName: template.name,
            source: source || 'template'
        });
        await contactRef.update({
            lastMessage: renderedText.substring(0, 100),
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('[TEMPLATE] No se pudo reflejar el mensaje en el CRM:', e.message);
    }
    return { messageId, renderedText };
}

/**
 * Registra que un pedido ya tiene sus datos de envío completos para que Rosario genere la guía.
 * Ya NO manda un mensaje por pedido: encola el número en `shipping_digest_queue` y el resumen
 * diario (shippingDigestScheduler, 1:30 pm MX) manda UN solo mensaje con todos los números del
 * día — Rosario solo ocupa el número de pedido, no el nombre ni los datos de envío.
 * Si el encolado falla (Firestore caído), cae al aviso inmediato de antes como respaldo.
 */
async function notifyShippingDataReady(orderNumber, contactData, addressText) {
    const name = (contactData && contactData.name) || 'Cliente';

    // 1) Encolar para el resumen diario de la 1:30 pm.
    try {
        const docId = String(orderNumber || '').replace(/[^\w-]/g, '') || `pedido_${Date.now()}`;
        const ref = db.collection('shipping_digest_queue').doc(docId);
        const existing = await ref.get();
        if (existing.exists && !existing.data().sentAt) {
            console.log(`[POSTVENTA] Pedido ${orderNumber} ya estaba en la cola del resumen de guías.`);
            return;
        }
        await ref.set({
            orderNumber: String(orderNumber || ''),
            clientName: name,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            sentAt: null
        });
        console.log(`[POSTVENTA] Pedido ${orderNumber} encolado para el resumen diario de guías (1:30 pm MX).`);
        return;
    } catch (queueErr) {
        console.warn(`[POSTVENTA] No se pudo encolar ${orderNumber} para el resumen (${queueErr.message}). Respaldo: aviso inmediato.`);
    }

    // 2) Respaldo: aviso inmediato por PLANTILLA (no depende de la ventana de 24h).
    const flatAddress = (addressText || '').replace(/\n+/g, ' · ').trim();
    try {
        await sendApprovedTemplateMessage(
            SHIPPING_NOTIFY_PHONE,
            SHIPPING_READY_TEMPLATE,
            [orderNumber, name, flatAddress || 'Ver datos en el chat del cliente'],
            { source: 'datos_envio_listos' }
        );
        console.log(`[POSTVENTA] Aviso a Rosario (${SHIPPING_NOTIFY_PHONE}) enviado por PLANTILLA "${SHIPPING_READY_TEMPLATE}" para ${orderNumber}.`);
        return;
    } catch (tplErr) {
        console.warn(`[POSTVENTA] No se pudo enviar la plantilla a Rosario (${tplErr.message}). Fallback a texto libre (requiere ventana 24h).`);
    }

    // 3) Último respaldo: envío libre (solo llega dentro de la ventana de 24h).
    const text = `📦 *Pedido listo para guía*\n\n*${orderNumber}* — ${name}\nYa mandó sus datos de envío completos. Por favor genera su guía. 🙌`;
    await sendAdvancedWhatsAppMessage(SHIPPING_NOTIFY_PHONE, { text });
    console.log(`[POSTVENTA] Aviso a Rosario (${SHIPPING_NOTIFY_PHONE}) enviado por TEXTO LIBRE para ${orderNumber}.`);
}

/**
 * Cuando la IA de post-venta confirma que el cliente ya mandó TODOS sus datos de envío (comando
 * interno /datoscompletos), marca su pedido más reciente como "Fabricar" — con los mismos efectos
 * que el cambio manual: confirmedAt, descuento de inventario, corona de compra completada y evento
 * Purchase a Meta — y avisa a Rosario para que genere la guía. Idempotente (no repite si ya estaba
 * en Fabricar). Devuelve el número de pedido marcado, o null si no había pedido / ya estaba.
 */
async function markOrderFabricarForContact(contactId, contactData, addressText) {
    const orderDoc = await getLatestOrderForContact(contactId);
    if (!orderDoc) {
        console.warn(`[POSTVENTA] ${contactId} confirmó datos pero no tiene pedido registrado; no se cambia estatus ni se avisa a Rosario.`);
        return null;
    }
    const orderId = orderDoc.id;
    const orderData = orderDoc.data();
    const orderNumber = orderData.consecutiveOrderNumber != null ? `DH${orderData.consecutiveOrderNumber}` : `(pedido ${orderId})`;
    const oldStatus = (orderData.estatus || 'Sin estatus').toLowerCase();

    if (oldStatus.includes('fabricar')) {
        console.log(`[POSTVENTA] Pedido ${orderNumber} ya estaba en Fabricar; no se repite el aviso a Rosario.`);
        return null;
    }

    // 1) Cambiar estatus a Fabricar (+ confirmedAt la primera vez)
    const updatePayload = { estatus: 'Fabricar' };
    if (!orderData.confirmedAt) updatePayload.confirmedAt = admin.firestore.FieldValue.serverTimestamp();
    await orderDoc.ref.update(updatePayload);
    console.log(`[POSTVENTA] Pedido ${orderNumber} (${orderId}) → Fabricar por datos de envío completos (${contactId}).`);

    // 2) Descuento de inventario (idempotente)
    try {
        const { descontarInventarioPorPedido } = require('./inventario/inventarioService');
        const result = await descontarInventarioPorPedido(orderId, orderData, 'Fabricar');
        if (result && result.ok && result.descontado) console.log(`[INVENTARIO] Pedido ${orderId} descontó ${result.movimientos} materiales (Fabricar por IA).`);
    } catch (invErr) {
        console.error(`[INVENTARIO] Error descontando pedido ${orderId} (Fabricar por IA):`, invErr.message);
    }

    // 3) Corona de compra completada en el contacto
    try {
        await db.collection('contacts_whatsapp').doc(contactId).update({
            purchaseStatus: 'completed',
            purchaseDate: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (crownErr) {
        console.error('[CROWN] Error al marcar compra completada (Fabricar por IA):', crownErr.message);
    }

    // 4) Evento Purchase a Meta (idempotente por metaPurchaseSentAt)
    await sendPurchaseEventOnFabricar(orderId, { ...orderData, estatus: 'Fabricar' }, oldStatus);

    // 5) Avisar a Rosario para que haga la guía
    await notifyShippingDataReady(orderNumber, contactData, addressText)
        .catch(e => console.warn('[POSTVENTA] Aviso a Rosario falló:', e.message));

    return orderNumber;
}

/**
 * Crea o renueva el caché de contexto en la API de Gemini.
 * Solo se recrea si el contenido cambió o el TTL ha expirado.
 * @param {string} botInstructions - Instrucciones del bot (personalizadas por dept/ad o generales)
 * @param {Array<{inlineData: {data: string, mimeType: string}}>} departmentImageParts - Imágenes estáticas a cachear como parte del contexto
 * @param {string} imagesHashInput - String determinista con identificadores de las imágenes (para el hash del caché)
 */
async function getOrCreateCache(botInstructions, departmentImageParts = [], imagesHashInput = '', isPostVenta = false) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');

    const { systemText, referenceText } = await buildStaticContext(botInstructions, isPostVenta);
    const currentHash = simpleHash(systemText + referenceText + '|imgs:' + imagesHashInput);
    const now = Date.now();

    // Si ya hay un caché vigente para ESTE contenido, reutilizarlo. Los cachés de otros
    // prompts no se tocan: expiran solos por TTL (Gemini los borra del lado del servidor).
    const existing = geminiCaches.get(currentHash);
    if (existing && (now - existing.createdAt) <= GEMINI_CACHE_TTL_MS) {
        return existing.name;
    }
    if (existing) geminiCaches.delete(currentHash);

    // Si otra petición ya está creando el caché de este mismo contenido, esperarla
    // en vez de crear un duplicado (evita cachés huérfanos con tráfico concurrente).
    if (geminiCacheCreations.has(currentHash)) {
        return geminiCacheCreations.get(currentHash);
    }

    // Crear un nuevo caché
    // Las instrucciones del bot van en systemInstruction para que Gemini las trate como directivas,
    // no como un mensaje del usuario al que debe "responder".
    // El material de referencia (knowledge base, quick replies) va en contents.
    const creation = (async () => {
        console.log(`[CACHE] Creando caché de contexto (hash: ${currentHash}, ${departmentImageParts.length} imgs).`);
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
        geminiCaches.set(currentHash, { name: cacheData.name, createdAt: Date.now() });

        // Acotar el número de cachés vivos: si nos pasamos, desalojar el más viejo (best effort).
        if (geminiCaches.size > GEMINI_CACHE_MAX_ENTRIES) {
            let oldestKey = null, oldestAt = Infinity;
            for (const [key, value] of geminiCaches) {
                if (value.createdAt < oldestAt) { oldestAt = value.createdAt; oldestKey = key; }
            }
            if (oldestKey) {
                const evicted = geminiCaches.get(oldestKey);
                geminiCaches.delete(oldestKey);
                geminiHttp(`${GEMINI_BASE_URL}/${evicted.name}?key=${GEMINI_API_KEY}`, { method: 'DELETE' })
                    .catch(e => console.warn(`[CACHE] No se pudo eliminar el caché desalojado: ${e.message}`));
            }
        }

        const cachedTokens = cacheData.usageMetadata?.totalTokenCount || 'desconocido';
        console.log(`[CACHE] ✅ Caché creado exitosamente: ${cacheData.name} (${cachedTokens} tokens cacheados)`);

        return cacheData.name;
    })();

    geminiCacheCreations.set(currentHash, creation);
    try {
        return await creation;
    } finally {
        geminiCacheCreations.delete(currentHash);
    }
}

/**
 * Invalida el caché para que se reconstruya en la próxima petición.
 * Con nombre: invalida solo ese caché (ej. cuando Gemini devuelve 404 sobre él).
 * Sin nombre: invalida todos (ej. al actualizar conocimiento o respuestas rápidas).
 */
function invalidateGeminiCache(cacheName = null) {
    if (cacheName) {
        for (const [key, value] of geminiCaches) {
            if (value.name === cacheName) geminiCaches.delete(key);
        }
        console.log(`[CACHE] Caché ${cacheName} invalidado. Se recreará en la próxima petición.`);
        return;
    }
    console.log('[CACHE] Caché invalidado manualmente. Se recreará en la próxima petición.');
    geminiCaches.clear();
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

/**
 * Normaliza el contenido a enviar a Gemini. Acepta:
 *  - un string (prompt plano, comportamiento histórico), o
 *  - un array de turnos [{ role: 'user'|'model', parts: [{text}] }] (conversación multi-turno).
 * Los imageParts se anexan al ÚLTIMO turno user. Turnos consecutivos del mismo rol se
 * fusionan (la API espera turnos alternados) y el resultado siempre termina en rol user.
 */
function buildGeminiContents(promptOrContents, imageParts = []) {
    if (!Array.isArray(promptOrContents)) {
        return [{ parts: [{ text: promptOrContents }, ...imageParts], role: 'user' }];
    }
    const contents = [];
    for (const turn of promptOrContents) {
        if (!turn || !Array.isArray(turn.parts) || turn.parts.length === 0) continue;
        // Copia superficial de cada part: la fusión muta el texto y no debe tocar
        // los objetos del llamador (el historial se reutiliza en el fallback).
        const parts = turn.parts.map(p => ({ ...p }));
        const prev = contents[contents.length - 1];
        if (prev && prev.role === turn.role) {
            // Fusionar: si ambos terminan/empiezan con texto, unirlos con salto de línea.
            const lastPart = prev.parts[prev.parts.length - 1];
            const firstPart = parts[0];
            if (lastPart.text !== undefined && firstPart.text !== undefined) {
                lastPart.text += `\n${firstPart.text}`;
                prev.parts.push(...parts.slice(1));
            } else {
                prev.parts.push(...parts);
            }
        } else {
            contents.push({ role: turn.role, parts });
        }
    }
    if (imageParts.length > 0) {
        const last = contents[contents.length - 1];
        if (last && last.role === 'user') last.parts.push(...imageParts);
        else contents.push({ role: 'user', parts: [...imageParts] });
    }
    if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: '' }] });
    // La API rechaza conversaciones que empiezan con rol "model" (p. ej. cuando el
    // primer mensaje del historial es la bienvenida del bot): anteponer un turno user mínimo.
    if (contents[0].role === 'model') {
        contents.unshift({ role: 'user', parts: [{ text: '(inicio de la conversación)' }] });
    }
    return contents;
}

async function generateGeminiResponse(prompt, imageParts = [], systemInstruction = null) {
    if (!GEMINI_API_KEY) throw new Error('La API Key de Gemini no está configurada.');
    const apiUrl = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: buildGeminiContents(prompt, imageParts) };
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
            const retriable = /premature close|terminated|econnreset|fetch failed|network|aborted|timeout/i.test(String(e && e.message));
            if (attempt < 2 && retriable) { console.warn(`[AI] Gemini falló (${e.message}), reintentando...`); await new Promise(r => setTimeout(r, 800)); continue; }
            throw e;
        }
    }
    let generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!generatedText) {
        const blockReason = result.promptFeedback?.blockReason;
        throw new Error(`No se recibió una respuesta válida de la IA${blockReason ? ` (bloqueada por: ${blockReason})` : ''}.`);
    }
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

    // dynamicPrompt puede ser un string (prompt plano) o un array de turnos user/model.
    const payload = {
        contents: buildGeminiContents(dynamicPrompt, imageParts),
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
            const retriable = /premature close|terminated|econnreset|fetch failed|network|aborted|timeout/i.test(String(e && e.message));
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
                invalidateGeminiCache(cacheName);
            }
            throw new Error(`Gemini API con caché respondió ${geminiResponse.status}: ${errBody}`);
        }

        result = await geminiResponse.json();
        break;
    }
    let generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!generatedText) {
        const blockReason = result.promptFeedback?.blockReason;
        throw new Error(`No se recibió una respuesta válida de la IA (cached)${blockReason ? ` — bloqueada por: ${blockReason}` : ''}.`);
    }
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

// Candado por contacto mientras processAutoReplyAI está generando/enviando: evita que
// dos generaciones corran a la vez (la segunda no vería lo que la primera aún no guarda
// y el cliente recibiría dos respuestas encimadas). Guarda el timestamp de inicio; si
// una generación se cuelga, el candado caduca solo (AI_GENERATION_LOCK_MS).
const aiGenerationInFlight = new Map();
const AI_GENERATION_LOCK_MS = 3 * 60 * 1000;

/**
 * Cancela el temporizador de IA pendiente de un contacto (si existe) SIN procesar la
 * respuesta. Usar cuando un humano interviene en el chat: su mensaje ya atendió al
 * cliente y la IA no debe responder encima.
 */
function cancelPendingAiTimer(contactId) {
    if (pendingAiRequests.has(contactId)) {
        clearTimeout(pendingAiRequests.get(contactId));
        pendingAiRequests.delete(contactId);
        console.log(`[AI] Temporizador de IA cancelado para ${contactId} (intervino un humano).`);
        return true;
    }
    return false;
}

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
const GEMINI_MAX_PDF_BYTES = 8 * 1024 * 1024;            // 8 MB por PDF (comprobantes son chicos)
const GEMINI_MAX_TOTAL_MEDIA_BYTES = 12 * 1024 * 1024;   // 12 MB en total por request

// Ventana de contexto de la IA: cuántos mensajes del historial ve y qué tan viejos
// pueden ser los archivos que se le re-adjuntan. Mandar el historial completo hacía
// que el modelo "re-resumiera" información ya dada; adjuntar multimedia vieja hacía
// que volviera a comentar fotos/comprobantes de días atrás.
const AI_HISTORY_MESSAGE_LIMIT = 50;
const AI_MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

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
        if (type === 'document') {
            // Gemini 3 lee PDFs nativamente (clave para comprobantes de pago en PDF).
            if (cleanMime === 'application/pdf') {
                if (buffer.length > GEMINI_MAX_PDF_BYTES) return { skipped: 'PDF demasiado grande' };
                return { part: { inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } }, bytes: buffer.length };
            }
            // A veces mandan una imagen (jpg/png) como "documento": tratarla como imagen.
            if (cleanMime.startsWith('image/')) {
                return await buildSafeGeminiMediaPart(buffer, cleanMime, 'image');
            }
            // Word/Excel/etc. no se soportan inline en Gemini.
            return { skipped: 'documento no soportado (solo PDF o imagen)' };
        }
        return { skipped: 'tipo no soportado' };
    } catch (e) {
        return { skipped: 'error al procesar: ' + e.message };
    }
}

// Wrapper con candado: si ya hay una generación en curso para el contacto, NO arranca
// otra en paralelo — reprograma el intento para dentro de 8s (con el historial ya fresco,
// que incluirá lo que la primera generación haya respondido). El candado caduca solo
// (AI_GENERATION_LOCK_MS) por si una generación queda colgada.
async function processAutoReplyAI(contactId, message, contactRef, passedContactData) {
    const inFlight = aiGenerationInFlight.get(contactId);
    if (inFlight && (Date.now() - inFlight.since) < AI_GENERATION_LOCK_MS) {
        console.log(`[AI] Ya hay una generación en curso para ${contactId}; reintentando en 8s.`);
        await triggerAutoReplyAI(message, contactRef, passedContactData || {}, 8000);
        return;
    }
    // Token propio por ejecución: si este candado caducó y otra generación lo expropió,
    // el finally NO debe borrar el candado de la otra (liberación no reentrante).
    const lockToken = { since: Date.now() };
    aiGenerationInFlight.set(contactId, lockToken);
    try {
        await processAutoReplyAIInner(contactId, message, contactRef, passedContactData);
    } finally {
        if (aiGenerationInFlight.get(contactId) === lockToken) {
            aiGenerationInFlight.delete(contactId);
        }
    }
}

// Lógica principal movida a otra función
async function processAutoReplyAIInner(contactId, message, contactRef, passedContactData) {
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
        // Solo los últimos N mensajes: el historial completo inflaba el prompt con
        // información vieja ya dada y empujaba al modelo a repetirla.
        const messagesSnapshot = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(AI_HISTORY_MESSAGE_LIMIT).get();
        const downloadedMedia = [];
        let mediaCount = 0;

        // Tipo efectivo de un mensaje. Los mensajes SALIENTES (agente/CRM) se guardan sin
        // `type`: se infiere del fileType para que el historial muestre explícitamente que
        // el Asistente envió una imagen/archivo. Sin esto, la foto del pedido terminado que
        // mandaba el agente aparecía como un opaco "📷 Imagen" y la IA, sin saber que ya se
        // había enviado, le decía al cliente "le pido la foto al equipo".
        const effectiveType = (d) => {
            if (d.type) return d.type;
            if (d.fileUrl && typeof d.fileType === 'string') {
                if (d.fileType.startsWith('image/')) return 'image';
                if (d.fileType.startsWith('video/')) return 'video';
                if (d.fileType.startsWith('audio/')) return 'audio';
                if (d.fileType.includes('pdf')) return 'document';
            }
            return null;
        };

        // Etiqueta legible de un mensaje. Las imágenes, audios y PDF se marcan como tales
        // (con su caption si lo tienen) para que la IA sepa que hubo un archivo, no texto vacío.
        const GENERIC_MEDIA_TEXTS = /^(📷 Imagen|🎥 Video|🎵 Audio|📄 Documento|🎤 Mensaje de voz)$/;
        const msgDisplayText = (d) => {
            let t = (d.text || '').trim();
            if (GENERIC_MEDIA_TEXTS.test(t)) t = ''; // texto de relleno, no caption real
            switch (effectiveType(d)) {
                case 'image': return t ? `[imagen: ${t}]` : '[imagen]';
                case 'audio': return t ? `[audio: ${t}]` : '[audio/nota de voz]';
                case 'video': return t ? `[video: ${t}]` : '[video]';
                case 'document': return t ? `[PDF/documento: ${t}]` : '[PDF/documento]';
                case 'sticker': return '[sticker]';
                default: return (d.text || '').trim();
            }
        };

        // Mapa wamid -> mensaje, para resolver respuestas/citas (context.id apunta al wamid citado).
        const byWamid = {};
        for (const doc of messagesSnapshot.docs) {
            const d = doc.data();
            if (d.id) byWamid[d.id] = d;
        }

        // Si el ÚLTIMO mensaje del cliente cita un mensaje que quedó fuera de la ventana
        // de mensajes (byWamid solo cubre los últimos AI_HISTORY_MESSAGE_LIMIT), resolver
        // el citado con una consulta puntual para no perder la referencia (la decoración
        // del historial y la FASE 2 dependen de byWamid).
        for (const doc of messagesSnapshot.docs) { // desc: el primer match es el último msg del cliente
            const d = doc.data();
            if (d.from !== contactId) continue;
            const qId = d.context && d.context.id;
            if (qId && !byWamid[qId]) {
                try {
                    const quotedSnap = await contactRef.collection('messages').where('id', '==', qId).limit(1).get();
                    if (!quotedSnap.empty) byWamid[qId] = quotedSnap.docs[0].data();
                } catch (e) {
                    console.warn('[AI] No se pudo resolver el mensaje citado fuera de ventana:', e.message);
                }
            }
            break; // solo evaluamos el último mensaje del cliente
        }

        // Recolectar hasta 2 archivos multimedia RECIENTES y DEL CLIENTE (imágenes, audios,
        // videos o documentos/PDF — p. ej. comprobantes de pago que mandan en PDF). Antes se
        // tomaban los 2 más recientes de todo el historial sin importar antigüedad ni remitente,
        // y el modelo volvía a comentar archivos viejos en cada turno.
        for (const doc of messagesSnapshot.docs) { // desc: primero los más recientes
            if (mediaCount >= 2) break;
            const d = doc.data();
            if (d.from !== contactId) continue;
            if (!((d.type === 'image' || d.type === 'audio' || d.type === 'video' || d.type === 'document') && d.fileUrl)) continue;
            const ts = (d.timestamp && typeof d.timestamp.toMillis === 'function') ? d.timestamp.toMillis() : 0;
            if (!ts || (Date.now() - ts) > AI_MEDIA_MAX_AGE_MS) continue;
            const mimeType = d.fileType || (d.type === 'image' ? 'image/jpeg' : (d.type === 'audio' ? 'audio/mpeg' : (d.type === 'video' ? 'video/mp4' : 'application/pdf')));
            downloadedMedia.push({ url: d.fileUrl, mimeType: mimeType, type: d.type });
            mediaCount++;
        }

        // Historial en dos formatos:
        //  - historyTurns: turnos reales user/model para Gemini. Mandar la conversación
        //    aplanada como texto en un solo turno hacía que el modelo "continuara el
        //    documento" (respuestas acartonadas, prefijo "Asistente:", re-resúmenes).
        //  - conversationHistory: transcript plano que reutilizan los clasificadores
        //    (tagOrderInProgress, detectAndArmReminder).
        const historyTurns = [];
        const historyLines = [];
        let prevMsgMs = null;
        for (const doc of [...messagesSnapshot.docs].reverse()) { // cronológico
            const d = doc.data();
            if (d.status === 'scheduled') continue; // programado aún NO enviado: el cliente no lo ha visto
            const isClient = d.from === contactId;
            let text = msgDisplayText(d);

            // Marcador de salto de tiempo: sin esto el modelo trata mensajes de hace meses
            // como si fueran de hace un momento (ej. responder a "está lloviendo" de enero).
            // En pausas GRANDES (>=30 días) el marcador además instruye qué hacer: decir
            // solo "(7 meses después)" no bastó — la IA reutilizaba nombres de noviembre
            // como si fueran de ayer ("Ya anoté los nombres de...").
            const msgMs = (d.timestamp && typeof d.timestamp.toMillis === 'function') ? d.timestamp.toMillis() : null;
            let gapNote = '';
            if (msgMs && prevMsgMs && (msgMs - prevMsgMs) >= 6 * 60 * 60 * 1000) {
                const hours = Math.round((msgMs - prevMsgMs) / (60 * 60 * 1000));
                const days = Math.round(hours / 24);
                if (days >= 30) {
                    const lapso = days >= 60 ? `${Math.round(days / 30)} meses` : `${days} días`;
                    gapNote = `(⚠️ pasaron ${lapso} sin conversación: todo lo anterior a esta marca es ANTIGUO. Nombres, fechas, cantidades y datos de arriba pueden ya no ser válidos — confírmalos con el cliente antes de usarlos, y los precios/promociones son SIEMPRE los actuales, no los de arriba) `;
                } else {
                    gapNote = hours >= 48 ? `(${days} días después) ` : `(${hours} horas después) `;
                }
            }
            if (msgMs) prevMsgMs = msgMs;

            // Si el CLIENTE responde/cita otro mensaje (context.id), indicar a cuál, para que
            // la IA entienda referencias como "este no?", "el segundo", "ese sí", etc. Las
            // respuestas del bot no llevan esta decoración: duplicaba el texto del cliente
            // en cada línea del Asistente y engordaba el prompt con repeticiones.
            if (isClient) {
                const quotedId = d.context && d.context.id;
                const quoted = quotedId ? byWamid[quotedId] : null;
                if (quoted) {
                    const quotedWho = quoted.from === contactId ? 'suyo anterior' : 'tuyo (Asistente)';
                    text = `(respondiendo a un mensaje ${quotedWho}: "${msgDisplayText(quoted)}") ${text}`;
                }
            }
            if (!text) continue;
            // El marcador de tiempo va SOLO a los turnos de Gemini. El transcript plano
            // (conversationHistory) queda limpio: lo leen los clasificadores de
            // recordatorios y las palabras "después"/"meses" disparaban su pre-filtro
            // (una llamada extra a Gemini por turno) en toda conversación multi-día.
            const turnText = gapNote + text;

            // Sangría en las líneas de continuación: un mensaje multilínea del cliente no puede
            // "fabricar" renglones que empiecen con "Asistente:" en el transcript plano (inyección
            // de prompt hacia los clasificadores/extractores que leen conversationHistory).
            historyLines.push(`${isClient ? 'Cliente' : 'Asistente'}: ${text.replace(/\r?\n/g, '\n    ')}`);
            const role = isClient ? 'user' : 'model';
            const lastTurn = historyTurns[historyTurns.length - 1];
            if (lastTurn && lastTurn.role === role) {
                lastTurn.parts[0].text += `\n${turnText}`;
            } else {
                historyTurns.push({ role, parts: [{ text: turnText }] });
            }
        }
        const conversationHistory = historyLines.join('\n');

        // --- FASE 2: incluir la imagen/archivo CITADO por el cliente ---
        // Si el ÚLTIMO mensaje del cliente responde (cita) a una imagen o PDF anterior, incluir
        // ESE archivo entre los que se mandan al modelo (aunque sea viejo y no esté en los
        // últimos 2), para que la IA lo compare visualmente ("este no?", "el segundo", etc.).
        let quotedMediaNote = '';
        for (const doc of messagesSnapshot.docs) { // desc: el primer match es el último msg del cliente
            const d = doc.data();
            if (d.from !== contactId) continue;
            const qId = d.context && d.context.id;
            const q = qId ? byWamid[qId] : null;
            const qType = q ? effectiveType(q) : null;
            if (q && (qType === 'image' || qType === 'document') && q.fileUrl) {
                if (!downloadedMedia.some(m => m.url === q.fileUrl)) {
                    const qMime = q.fileType || (qType === 'image' ? 'image/jpeg' : 'application/pdf');
                    downloadedMedia.push({ url: q.fileUrl, mimeType: qMime, type: qType });
                    console.log(`[AI] Incluyendo ${qType} citado por el cliente para ${contactId}.`);
                }
                quotedMediaNote = `\n\n**Importante:** El cliente está respondiendo/citando ${qType === 'image' ? 'una imagen' : 'un archivo'} anterior${q.text ? ` ("${q.text}")` : ''} que está incluido entre los archivos adjuntos. Úsalo para entender su mensaje (ej.: "este no?", "ese sí", "el segundo").`;
            }
            break; // solo evaluamos el último mensaje del cliente
        }

        // --- Descargar imágenes de referencia del departamento ---
        // Se adjuntan al request (redimensionadas/acotadas) para que la IA pueda describir y
        // comparar el producto. NO van al caché (requests grandes causaban "Premature close").
        // Antes se descargaban pero nunca se enviaban, y una nota le decía al modelo que las
        // imágenes "venían adjuntas": el modelo confundía las fotos del cliente con el catálogo.
        const departmentImageParts = [];
        let departmentImagesBytes = 0;
        for (const refImage of departmentReferenceImages) {
            if (!(refImage && refImage.url && typeof refImage.url === 'string' && refImage.url.startsWith('http'))) continue;
            try {
                const response = await fetch(refImage.url, { signal: AbortSignal.timeout(15000) });
                if (!response.ok) {
                    // Con Uniform Bucket-Level Access, las URLs storage.googleapis.com dan 403.
                    // NO metemos el cuerpo del error como "imagen" (eso cuelga/atraganta a Gemini): la omitimos.
                    console.warn(`[AI] Imagen de referencia del departamento no disponible (HTTP ${response.status}). Se omite.`);
                    continue;
                }
                const buffer = Buffer.from(await response.arrayBuffer());
                if (buffer.length === 0) continue;
                const prepared = await buildSafeGeminiMediaPart(buffer, refImage.mimeType || 'image/jpeg', 'image');
                if (prepared.skipped) {
                    console.warn(`[AI] Imagen de referencia del departamento omitida: ${prepared.skipped}.`);
                    continue;
                }
                // Las imágenes de referencia usan como máximo la mitad del presupuesto total,
                // para que los archivos del cliente (comprobantes, fotos) siempre quepan.
                if (departmentImagesBytes + prepared.bytes > GEMINI_MAX_TOTAL_MEDIA_BYTES / 2) {
                    console.warn('[AI] Imagen de referencia del departamento omitida: excede el presupuesto de tamaño.');
                    continue;
                }
                departmentImageParts.push(prepared.part);
                departmentImagesBytes += prepared.bytes;
                console.log(`[AI] Imagen de referencia del departamento lista (${Math.round(prepared.bytes / 1024)} KB).`);
            } catch (e) {
                console.warn('[AI] Error descargando imagen de referencia del departamento:', e.message);
            }
        }

        // --- Descargar y preparar multimedia de la conversación (dinámico) ---
        // Se redimensiona/acota cada archivo para evitar "Premature close" por requests
        // grandes (ver buildSafeGeminiMediaPart). Lo que no se pueda procesar se omite con aviso.
        // Las imágenes de referencia del departamento van PRIMERO (la nota del prompt lo indica).
        const mediaParts = [...departmentImageParts];
        const skippedMediaTypes = [];
        let totalMediaBytes = departmentImagesBytes;
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
        const esTipoMedia = (t) => t === 'image' ? 'imagen' : t === 'audio' ? 'audio' : t === 'video' ? 'video' : t === 'document' ? 'documento/PDF' : 'archivo';
        const skippedMediaNote = skippedMediaTypes.length > 0
            ? `\n\n**Nota:** El cliente envió ${skippedMediaTypes.length} archivo(s) (${skippedMediaTypes.map(esTipoMedia).join(', ')}) que no se pudieron procesar (probablemente muy grandes). Pídele amablemente que te describa por texto su contenido o que lo reenvíe más corto.`
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

        // Cobertura/cotización T1: cuando la IA revisa cobertura de un C.P. (labor de venta), cotizar
        // en T1 (DHL/FedEx, precios reales) para saber si hay envío y a qué costo. Reemplaza el scraping
        // de Estafeta. El envío al cliente es GRATIS; los montos son referencia interna de costo.
        let coberturaNote = '';
        if (postalCodeMatch) {
            try {
                const t1 = require('./t1/t1Client');
                const q = await t1.cotizar({ cpDestino: postalCodeMatch[1] });
                const result = Array.isArray(q && q.result) ? q.result : [];
                const ops = [];
                result.forEach((r) => {
                    const svc = (r.cotizacion && r.cotizacion.servicios) || {};
                    Object.keys(svc).forEach((k) => {
                        const s = svc[k] || {};
                        if (s.costo_total != null) ops.push({ paq: r.clave, serv: s.servicio, dias: s.dias_entrega, costo: Number(s.costo_total) });
                    });
                });
                ops.sort((a, b) => a.costo - b.costo);
                if (ops.length) {
                    const top = ops.slice(0, 4).map(o => `${o.paq} ${o.serv} $${o.costo.toFixed(2)}${o.dias ? ` (~${o.dias}d)` : ''}`).join(' · ');
                    console.log(`[AI] Cobertura T1 CP ${postalCodeMatch[1]}: ${ops.length} ops, más barata ${ops[0].paq} $${ops[0].costo}`);
                    coberturaNote = `\n\n**Cobertura de envío para el C.P. ${postalCodeMatch[1]} (cotización real de paqueterías vía T1, desde Durango):** SÍ hay cobertura a domicilio. Opciones (referencia interna de costo, NO para el cliente): ${top}. El envío al cliente es GRATIS (nosotros pagamos la guía) — NO le cobres envío ni le menciones estos montos; úsalos solo para saber que sí llegamos y a qué costo. Usa esta info SOLO si el cliente pregunta por cobertura/envío o está dando su C.P./dirección. Si el número de 5 dígitos NO es un código postal (es un pedido, monto, teléfono, etc.), ignora esta nota.`;
                } else {
                    console.log(`[AI] Cobertura T1 CP ${postalCodeMatch[1]}: sin tarifas (posible zona sin cobertura o CP inválido)`);
                    coberturaNote = `\n\n**Cobertura de envío para el C.P. ${postalCodeMatch[1]}:** ninguna paquetería (DHL/FedEx) devolvió tarifa para ese C.P. — posible zona sin cobertura o C.P. inválido. Si el cliente pregunta por envío a esa zona, avísale con amabilidad que lo confirmarás y escribe /equipo (en su propio renglón) antes de prometer la entrega. Si el número de 5 dígitos NO es un código postal, ignora esta nota.`;
                }
            } catch (e) {
                console.warn('[AI] Cotización de cobertura T1 falló:', e.message);
            }
        }

        // Solo se menciona lo que REALMENTE va adjunto (departmentImageParts, no la lista
        // configurada): prometer imágenes que no llegan hacía alucinar al modelo.
        const deptImagesNote = departmentImageParts.length > 0
            ? `\n\n**Imágenes de referencia del producto/departamento:**\nLas primeras ${departmentImageParts.length} ${departmentImageParts.length === 1 ? 'imagen adjunta es una referencia visual' : 'imágenes adjuntas son referencias visuales'} del producto o catálogo del departamento. Úsalas para describir, comparar o responder preguntas del cliente. Los archivos posteriores (si los hay) son los que el cliente envió en la conversación.`
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

        // Fase de PAGO activa: post-venta (pedido listo tras /cuatro) O venta con el pedido actual
        // YA REGISTRADO (purchaseStatus === 'registered'). Un cliente puede pagar por su cuenta
        // ANTES de que el equipo mande /cuatro (caso real Gloria/5216461170910: pagó en venta y la
        // IA recolectó los datos por texto porque las notas del formulario solo se inyectaban en
        // post-venta). SOLO 'registered' (NO 'completed'): 'registered' se re-pone al registrar el
        // pedido NUEVO (así el pedido más reciente ES el actual), mientras que 'completed' es
        // permanente y en un comprador recurrente apuntaría al pedido VIEJO (ver revisión). No
        // implica cobrar antes: /cuatro sigue gateando el cobro PROACTIVO; esto solo maneja un pago
        // que el cliente ya hizo. El guard de markComprobanteValidadoAndSendForm evita mandar el
        // formulario de un pedido cancelado/entregado.
        const paymentPhaseActive = isPostVenta || contactData.purchaseStatus === 'registered';

        // Protocolo de recolección de datos de envío por FORMULARIO. Se agrega SIEMPRE por código
        // —aunque el prompt esté personalizado en la UI— para que la IA use el formulario y no
        // recopile los datos por texto.
        const postventaProtocolNote = paymentPhaseActive ? `\n\n**PROTOCOLO DE DATOS DE ENVÍO:**
Los datos de envío se recopilan por un FORMULARIO (un enlace con el número de pedido ya cargado), NO por texto. El sistema le envía ese formulario al cliente automáticamente cuando se valida su pago.
Reglas:
- NUNCA pidas los datos de envío por texto ni por partes (no pidas campos sueltos como calle, colonia, CP, etc.).
- Si el cliente ESCRIBE su dirección o datos por texto, NO los tomes campo por campo:
   · Si su pago YA está validado (ya se le envió el formulario), agradécele con calidez y pídele que por favor los ponga en el FORMULARIO que le enviamos, porque así su pedido queda cargado correcto y sacamos la guía enseguida. Si dice que no le llegó el enlace o lo perdió, dile que se lo reenviamos y NO tomes los datos por texto.
   · Si su pago AÚN no está validado, enfócate primero en el pago; dile que en cuanto se valide le llega el formulario para capturar sus datos de envío. NO tomes los datos por texto todavía.
- EXCEPCIÓN (única forma de tomarlos por texto): SOLO si el cliente dice claramente que NO PUEDE abrir o llenar el formulario (ej. "no me abre el link", "no me deja", "no puedo llenarlo", "desde aquí no puedo"). Entonces recíbelos por texto: 1) Nombre completo, 2) Calle y número (int/ext), 3) Colonia/Fraccionamiento, 4) C.P., 5) Entre calles, 6) Referencia del domicilio, 7) Estado y Municipio, 8) Teléfono. Junta lo que haya escrito en varios mensajes. Si faltan, pídele SOLO los que falten. Cuando los tengas TODOS, confírmaselos ordenados, dile que un compañero del equipo termina de registrar su envío enseguida, y al FINAL de tu mensaje escribe el comando /equipo (el cliente NO lo ve; avisa a un humano para que capture sus datos y genere la guía). Emítelo UNA sola vez.` : '';

        // Comando interno de cancelación (venta y post-venta). Se inyecta SIEMPRE por código
        // —aunque el prompt esté personalizado en la UI— para que la IA sepa avisar cuando el
        // cliente decide NO seguir con el pedido; el sistema quita la etiqueta "Pendientes de
        // revisión IA" si todavía no hay un pedido registrado (ver más abajo).
        const cancelCommandNote = `\n\n**Cancelación de pedido:** Si el cliente te dice claramente que YA NO quiere el pedido, que lo CANCELA o que NO podrá continuar con él (por ejemplo: "ya no lo quiero", "mejor cancélalo", "ya no voy a poder con el pedido"), respóndele con empatía y escribe al FINAL de tu mensaje el comando /cancelado (el cliente NO lo ve; es una señal para el equipo). NO lo emitas por una simple demora o aplazamiento del pago (por ejemplo "mañana te pago", "dame unos días"): en esos casos NO se cancela. Emítelo UNA sola vez.`;

        // Comando interno de comprobante validado + formulario de envío. Se inyecta por código para
        // que funcione con cualquier prompt personalizado, y en fase de pago (post-venta O venta con
        // pedido ya registrado): un cliente puede pagar antes de que se mande /cuatro. Cuando la IA
        // valida un comprobante GENUINO emite /comprobante: el sistema marca el pedido para la
        // sección "Envíos" del CRM y le manda al cliente el enlace del formulario de datos de envío.
        const comprobanteCommandNote = paymentPhaseActive ? `\n\n**Comprobante de pago y formulario de envío:**
- Cuando el cliente te MANDE su comprobante de pago (imagen o PDF) y verifiques que es GENUINO (el destino y el monto coinciden con lo esperado), responde ÚNICAMENTE con el comando /comprobante (SOLO eso, sin ningún otro texto ni saludo). NO escribas tú la confirmación, NO le pidas los datos de envío por texto y NO le mandes ningún enlace: al recibir /comprobante, el SISTEMA le manda automáticamente el mensaje de confirmación ("ya validamos tu pago") junto con el formulario de envío. Emítelo UNA sola vez por pedido.
- MUY IMPORTANTE: si YA validaste el comprobante antes en esta conversación (ya se le envió el formulario de envío, aunque el comprobante siga viéndose en el chat), NO vuelvas a emitir /comprobante. En los turnos siguientes responde NORMALMENTE a lo que el cliente diga (dudas, datos, etc.); reenviar el formulario en cada turno lo satura.
- Si el comprobante es sospechoso o NO coincide, usa /sospechoso (NO /comprobante). Si el cliente solo dice que "ya pagó" pero todavía NO ha mandado el comprobante, pídeselo con amabilidad (NO emitas /comprobante).
- Cuando el cliente te confirme que YA LLENÓ su formulario de envío (por ejemplo: "ya llené el formulario", "listo, ya mandé mis datos"), responde ÚNICAMENTE con /pagado (solo eso, sin ningún otro texto).` : '';

        // --- Pedido REGISTRADO en el CRM: fuente de verdad para el TOTAL ---
        // Sin esto la IA contestaba precios con la promoción general (ej. "2 x $1,000")
        // aunque el pedido registrado fuera de otro monto (ej. Corazón 2 pzas = $1,500):
        // la IA nunca veía los pedidos del CRM, solo el texto del chat.
        let orderInfoNote = '';
        try {
            const lastOrderDoc = await getLatestOrderForContact(contactId);
            if (lastOrderDoc) {
                const o = lastOrderDoc.data();
                const createdMs = o.createdAt && o.createdAt.toMillis ? o.createdAt.toMillis() : 0;
                // Solo pedidos recientes: uno viejo ya no aplica a la conversación actual.
                if (createdMs && (Date.now() - createdMs) <= 45 * 24 * 60 * 60 * 1000) {
                    const num = o.consecutiveOrderNumber != null ? `DH${o.consecutiveOrderNumber}` : '(sin número)';
                    const datos = String(o.datosProducto || '').replace(/\s+/g, ' ').trim().slice(0, 200);
                    orderInfoNote = `\n\n**Pedido REGISTRADO en el sistema:**\n${num} — Producto: ${o.producto || '-'} — TOTAL registrado: ${o.precio != null ? `$${o.precio}` : 'no registrado'} — Estatus: ${o.estatus || '-'}${datos ? ` — Datos: ${datos}` : ''}.\nPara el precio/total del pedido usa este ORDEN DE PRIORIDAD: 1) si un humano del equipo acordó en la conversación un total DISTINTO (descuento o ajuste), ese acuerdo MANDA — respétalo y no lo "corrijas" al del sistema; 2) si no hay un acuerdo distinto en el chat, usa el TOTAL registrado de arriba; 3) NUNCA lo calcules con promociones generales. Si hay conflicto y no queda claro cuál aplica, no afirmes ninguno: di que lo confirmas y escribe /equipo en su propio mensaje. Si el cliente quiere algo distinto a lo registrado (otra cantidad u otro modelo), aclara antes de dar totales. El estatus del pedido es SOLO informativo: NUNCA anuncies por tu cuenta que el pedido "ya está listo" ni inicies el cobro — eso lo hace el equipo humano cuando manda la foto del trabajo terminado.`;
                }
            }
        } catch (e) {
            console.warn('[AI] No se pudo leer el pedido registrado para', contactId, e.message);
        }

        // Cliente RECURRENTE en etapa de venta: ya le hemos enviado antes (purchaseStatus
        // 'completed' se pone cuando su pedido anterior pasó a Fabricar tras pagar). En una
        // segunda compra NO se vuelve a checar cobertura de entrada: se pregunta si va a la
        // misma dirección, y solo si es OTRA se pide el CP (pedido del dueño, 02-jul-2026).
        let repeatBuyerNote = '';
        if (!isPostVenta && contactData.purchaseStatus === 'completed') {
            repeatBuyerNote = `\n\n**Cliente RECURRENTE (ya le hemos enviado pedidos antes):**\nNO le pidas código postal ni cheques cobertura de entrada. Pregúntale si su nuevo pedido va a la MISMA dirección de la vez pasada. Si dice que SÍ: la cobertura ya está comprobada (cuenta como cumplido el requisito de CP) — continúa el cierre normal sin pedir CP. Solo si dice que es OTRA dirección, pide el código postal de 5 dígitos y checa cobertura como siempre.`;
        }

        // Notas dinámicas + tarea: van como el ÚLTIMO turno user de la conversación.
        // La tarea es solo mecánica; el tono y el estilo salen únicamente de las
        // instrucciones configuradas (el "concisa y útil" y el "indica que un agente
        // humano lo atenderá" hardcodeados pisaban el tono y contradecían post-venta).
        const shippingTaskNote = shippingInfo
            ? ' Si el cliente pregunta por envío, paquetería o entrega y tienes cotización disponible, comparte las mejores opciones; si el número de 5 dígitos NO parece un código postal (es un pedido, monto, etc.), no menciones envíos.'
            : '';
        // Solo si hay archivos DEL CLIENTE (mediaParts arranca con las imágenes de
        // referencia del departamento; contarlas aquí afirmaría archivos inexistentes).
        const mediaTaskNote = mediaParts.length > departmentImageParts.length
            ? ' Vienen adjuntos archivos de la conversación (fotos, audios, videos o documentos/PDF, p. ej. comprobantes de pago): analízalos con cuidado cuando sean relevantes para el último mensaje del cliente; si ya los atendiste en un turno anterior, no los vuelvas a comentar.'
            : '';
        const finalUserText = `${fechaActualNote}${orderInfoNote}${repeatBuyerNote}${postventaProtocolNote}${cancelCommandNote}${comprobanteCommandNote}${shippingInfo}${coberturaNote}${deptImagesNote}${skippedMediaNote}${quotedMediaNote}\n\n**Tarea:**\nSiguiendo tus instrucciones, responde al ÚLTIMO mensaje del cliente. No repitas información que ya se haya dado en la conversación (ni parafraseada), a menos que el cliente la pida de nuevo.${shippingTaskNote}${mediaTaskNote} Si no tienes un dato, no lo inventes.`.trim();

        // La conversación se manda como turnos reales user/model + un turno final con las
        // notas y la tarea (la multimedia se anexa a ese turno final dentro de buildGeminiContents).
        const dynamicContents = [...historyTurns, { role: 'user', parts: [{ text: finalUserText }] }];

        // --- Intentar usar Context Caching ---
        let aiResult;
        try {
            // El caché guarda SOLO texto (instrucciones + conocimiento + respuestas rápidas).
            // La multimedia (del cliente y de referencia del departamento) va en mediaParts,
            // ya redimensionada/acotada por buildSafeGeminiMediaPart.
            const cacheName = await getOrCreateCache(botInstructions, [], '', isPostVenta);
            if (cacheName) {
                console.log(`[AI] Generando respuesta con Context Caching para ${contactId}. (${historyTurns.length} turnos + ${mediaParts.length} archivo(s) multimedia, ${departmentImageParts.length} de referencia del depto)`);
                aiResult = await generateGeminiResponseWithCache(cacheName, dynamicContents, mediaParts);
                console.log(`[AI] 💰 Tokens cacheados: ${aiResult.cachedTokens}, Tokens nuevos de entrada: ${aiResult.inputTokens}, Salida: ${aiResult.outputTokens}`);
            } else {
                throw new Error('Caché no disponible, usando fallback.');
            }
        } catch (cacheError) {
            // Fallback: si el caching falla por cualquier razón, usar el método tradicional con
            // systemInstruction. Se manda la MISMA conversación y la MISMA multimedia (antes el
            // fallback iba solo texto y le pedía al cliente re-describir archivos ya enviados).
            console.warn(`[AI] ⚠️ Caché falló (${cacheError.message}). Usando método sin caché.`);
            const { systemText: fallbackSystem, referenceText: fallbackRef } = await buildStaticContext(botInstructions, isPostVenta);
            const fallbackContents = [
                { role: 'user', parts: [{ text: fallbackRef }] },
                ...historyTurns,
                { role: 'user', parts: [{ text: finalUserText }] }
            ];
            aiResult = await generateGeminiResponse(fallbackContents, mediaParts, fallbackSystem);
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

        // ¿El último mensaje del cliente YA fue respondido mientras generábamos? (otra
        // generación solapada, un agente humano o un auto-sender). Si el último mensaje
        // real de la conversación ya no es del cliente, no mandar OTRA respuesta encima:
        // era la causa de las respuestas dobles ("$750... ¿así lo grabamos? ✅" dos veces).
        const lastMsgsSnap = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(3).get();
        const lastRealMsg = lastMsgsSnap.docs.map(x => x.data()).find(m => m.status !== 'scheduled');
        if (lastRealMsg && lastRealMsg.from !== contactId) {
            console.log(`[AI] El último mensaje de ${contactId} ya fue respondido (${lastRealMsg.isAutoReply ? 'por la IA' : 'por un humano/auto-sender'}). Omitiendo envío duplicado.`);
            await contactRef.update({ aiStatus: admin.firestore.FieldValue.delete() });
            return;
        }

        // Separar la respuesta en múltiples mensajes si contiene [SPLIT]
        let aiMessages = aiResponse.split(/\[SPLIT\]/i).map(m => m.trim()).filter(m => m.length > 0);
        let lastText = "";
        // Se activa si en este turno la IA envió el atajo de datos de envío (/DatosEstafeta):
        // marca al contacto en "esperando datos" para que el webhook le dé 10 min a que los
        // termine de escribir en partes antes de que la IA le pida lo que falte.
        let shippingDataRequested = false;

        // Detectar cierre de venta (/final o frase de pedido) de forma insensible a mayúsculas.
        // En ETAPA 1 esto NO apaga el bot: lo hace pasar a ETAPA 2 (post-venta) para que la
        // IA siga atendiendo (cobro, pedido listo, entrega). En etapa 2 ya no aplica.
        // OJO: `saleClosed` puede volverse true DENTRO del loop si la IA mandó la frase a través
        // de un ATAJO de respuesta rápida (ej. /confirmar → "Ya registramos tu pedido..."); el
        // check inicial solo ve "/confirmar". Por eso es `let` y la decisión se calcula tras el loop.
        let saleClosed = /\/final/i.test(aiResponse) || /ya registramos tu pedido/i.test(aiResponse);
        // /cuatro (pedido LISTO → post-venta) es EXCLUSIVO del equipo humano: solo ellos
        // saben cuándo el pedido físico está terminado. La transición a post-venta vive
        // únicamente en los envíos manuales (apiRoutes). Si la IA lo emitiera, se descarta
        // (caso real 5213323939511: la IA alucinó "ya quedó lista tu lámpara", se mandó el
        // /cuatro sola con los datos de pago y se auto-transicionó a post-venta).
        // En ETAPA 2, si el cliente quiere otro pedido la IA emite /nuevopedido para
        // regresar a la etapa de venta (etapa 1); el siguiente turno lo atiende ventas.
        const wantsNewOrder = isPostVenta && /\/nuevopedido/i.test(aiResponse);
        // Si la IA detecta un comprobante sospechoso emite /sospechoso: se reenvía la imagen al
        // admin para verificación; al cliente solo se le dice que estamos validando. Aplica en
        // fase de pago (post-venta O venta con pedido registrado), igual que /comprobante.
        const suspiciousReceipt = paymentPhaseActive && /\/sospechoso/i.test(aiResponse);
        // La IA emite /equipo cuando el cliente pide algo que ella no puede hacer (ej. foto o
        // video de su pedido): se avisa al admin para que un humano lo mande por el chat.
        const humanHelpNeeded = /\/equipo/i.test(aiResponse);
        // En ETAPA 2, si el cliente ya mandó TODOS sus datos de envío la IA emite /datoscompletos:
        // el pedido pasa a "Fabricar" y se avisa a Rosario para que genere la guía (ver más abajo).
        // Se exige que ANTES se le hubieran pedido los datos (awaitingShippingData) para no fabricar
        // por error si la IA emitiera el comando fuera del flujo de recolección de datos de envío.
        const shippingDataComplete = isPostVenta && contactData.awaitingShippingData === true && /\/datoscompletos/i.test(aiResponse);
        // La IA emite /cancelado cuando el cliente decide CANCELAR / no continuar con el pedido.
        // Si aún no hay un pedido registrado, se quita la etiqueta "Pendientes de revisión IA"
        // (no hay nada que un humano deba registrar). Ver el manejo después del loop.
        const orderCancelled = /\/cancelado/i.test(aiResponse);
        // La IA emite /comprobante cuando el cliente manda su comprobante de pago y la IA verifica
        // que es GENUINO. El sistema marca el pedido para la sección "Envíos" y le manda al cliente
        // el enlace del formulario de datos de envío (ver el manejo después del loop). Si en el mismo
        // turno también salió /sospechoso, MANDA la sospecha (no validamos): son excluyentes.
        const comprobanteValidado = !suspiciousReceipt && /\/comprobante/i.test(aiResponse);
        // En ETAPA 1, la IA emite /registrar cuando el cliente CONFIRMÓ el resumen de su pedido:
        // el sistema extrae los datos de la conversación y registra el pedido en el CRM
        // (orders/aiOrderRegistration.js). Si algo falla, cae al flujo manual (pendientes_ia).
        const registerOrderCmd = !isPostVenta && /\/registrar\b/i.test(aiResponse);

        // Limpiar los comandos internos (/final, /nuevopedido, /sospechoso, /datoscompletos, /equipo, /cancelado, /comprobante, /registrar) de los mensajes antes de enviar.
        // /cuatro también se elimina pero por otra razón: es EXCLUSIVO del equipo humano
        // (anuncia pedido LISTO + datos de pago); la IA no puede saber si el pedido físico
        // ya está terminado, así que jamás debe enviarlo ni expandirlo.
        aiMessages = aiMessages.map(m => m.replace(/\/final/ig, '').replace(/\/nuevopedido/ig, '').replace(/\/sospechoso/ig, '').replace(/\/datoscompletos/ig, '').replace(/\/equipo/ig, '').replace(/\/cancelado/ig, '').replace(/\/comprobante/ig, '').replace(/\/registrar\b/ig, '').replace(/\/cuatro\b/ig, '').trim()).filter(m => m.length > 0);

        // Si dentro de una burbuja viene una línea que es SOLO un atajo (ej. el modelo puso
        // "/ttt\n/qqq" sin [SPLIT]), separar esa línea en su propia burbuja para que se
        // expanda como respuesta rápida; antes el texto crudo "/ttt /qqq" llegaba al cliente.
        aiMessages = aiMessages.flatMap(m => {
            const parts = [];
            let buffer = [];
            for (const line of m.split('\n')) {
                if (/^\/.+$/.test(line.trim())) { // atajo solo (permite espacios: "/mas modelos")
                    if (buffer.length) { parts.push(buffer.join('\n').trim()); buffer = []; }
                    parts.push(line.trim());
                } else {
                    buffer.push(line);
                }
            }
            if (buffer.length) parts.push(buffer.join('\n').trim());
            return parts.filter(p => p.length > 0);
        });

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

            // Si la IA respondió SOLO con un atajo de respuesta rápida (ej. "/ttt"), expandirlo
            // a su contenido real (texto + archivo) en vez de mandar el atajo crudo al cliente.
            let qrFileUrl = null, qrFileType = null;
            const shortcutMatch = msgText.match(/^\/(.+)$/); // permite atajos con espacios ("/mas modelos")
            if (shortcutMatch) {
                const qr = await findQuickReplyByShortcut(shortcutMatch[1]);
                if (qr) {
                    msgText = qr.message || '';
                    qrFileUrl = qr.fileUrl || null;
                    qrFileType = qr.fileType || null;
                    // Si la respuesta rápida trae el marcador ** (ej. /DatosEstafeta:
                    // "Numero de pedido:**"), insertar el número del último pedido del cliente
                    // entre los asteriscos (queda en negrita en WhatsApp). Si no hay pedido, se omite.
                    if (msgText.includes('**')) {
                        const lastOrder = await getLastOrderNumberForContact(contactId);
                        msgText = msgText.replace(/\*\*/, lastOrder ? `*${lastOrder}*` : '');
                        if (lastOrder) console.log(`[AI] /DatosEstafeta: insertado número de pedido ${lastOrder} para ${contactId}.`);
                        else console.warn(`[AI] /DatosEstafeta: ${contactId} no tiene pedido registrado; se deja el número en blanco.`);
                        // La IA acaba de pedir los datos de envío → esperar a que el cliente los complete.
                        shippingDataRequested = true;
                    }
                    // Si el atajo expandido contiene la frase de cierre de venta, marcar la
                    // transición a post-venta (el check sobre aiResponse solo veía el "/atajo").
                    if (/ya registramos tu pedido/i.test(msgText)) saleClosed = true;
                    console.log(`[AI] Atajo "${shortcutMatch[0]}" expandido a respuesta rápida para ${contactId}.`);
                } else if (shortcutMatch[1].toLowerCase() === 'pagado') {
                    // /pagado es parte del flujo de Envíos (el cliente confirmó que llenó el formulario).
                    // Si por algún motivo NO existe la respuesta rápida "pagado", mandamos un texto por
                    // defecto para no dejar al cliente sin respuesta (evita el silencio total).
                    msgText = 'Llenaste correctamente el formulario ✅ Ahora preparamos tu envío y en cuanto tenga tu guía te la comparto para que rastrees tu paquete 📦😊';
                    console.warn(`[AI] Atajo "pagado" sin respuesta rápida configurada; usando texto por defecto para ${contactId}.`);
                } else {
                    // Atajo inexistente: no mandar el "/xxx" crudo al cliente.
                    console.warn(`[AI] La IA usó un atajo desconocido "${shortcutMatch[0]}" para ${contactId}; se omite.`);
                    continue;
                }
            }
            if (!msgText && !qrFileUrl) continue; // nada que enviar

            const contactChannel = contactData.channel || 'whatsapp';
            let sentMessageData;

            if (contactChannel === 'messenger' || contactChannel === 'instagram') {
                const recipientId = contactData.psid || contactData.igsid || contactId.replace(/^(fb_|ig_)/, '');
                const result = await sendMessengerMessage(recipientId, { text: msgText, fileUrl: qrFileUrl, fileType: qrFileType, channel: contactChannel });
                sentMessageData = { id: result.messages?.[0]?.id || null, textForDb: msgText || result.lastTextForDb || '' };
            } else {
                const sendOptions = { text: msgText, fileUrl: qrFileUrl, fileType: qrFileType };
                if (shouldQuote && message.id) {
                    sendOptions.reply_to_wamid = message.id;
                }
                sentMessageData = await sendAdvancedWhatsAppMessage(contactId, sendOptions);
            }

            const fromId = (contactChannel === 'messenger' || contactChannel === 'instagram') ? FB_PAGE_ID : PHONE_NUMBER_ID;
            const aiMsgToSave = {
                from: fromId, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: sentMessageData.id, text: sentMessageData.textForDb, isAutoReply: true,
                channel: contactChannel,
            };
            // Guardar la cita SOLO cuando la IA citó de verdad ([CITA] → reply_to_wamid).
            // Antes se guardaba siempre y el historial re-imprimía el texto del cliente en
            // cada línea del Asistente, inflando el prompt con repeticiones.
            if (shouldQuote && message.id) aiMsgToSave.context = { id: message.id };
            if (qrFileUrl) { aiMsgToSave.fileUrl = qrFileUrl; aiMsgToSave.fileType = qrFileType; }
            await contactRef.collection('messages').add(aiMsgToSave);
            lastText = sentMessageData.textForDb;

            if (i < aiMessages.length - 1) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        // Decisión de transición DESPUÉS del loop, para que cuente también la frase que pudo
        // venir expandida desde un atajo. El cierre de venta (/final) manda el pedido a
        // Pendientes IA para que el equipo lo registre, pero NO arranca la post-venta:
        // la etapa 2 (cobro) arranca ÚNICAMENTE cuando el EQUIPO manda /cuatro desde el CRM
        // (detección en apiRoutes); la IA no puede transicionar por sí misma. Con el
        // kill-switch de etapa 2 apagado, /final conserva el comportamiento viejo (bot off).
        const shouldDeactivate = !postSaleStageActive && saleClosed;

        const updateData = {
            lastMessage: lastText,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            aiStatus: admin.firestore.FieldValue.delete()
        };

        if (postSaleStageActive && !isPostVenta && saleClosed) {
            // Venta cerrada: a Pendientes IA para que el equipo registre el pedido. La IA
            // sigue en etapa de VENTA acompañando al cliente mientras se fabrica su pedido.
            updateData.status = 'pendientes_ia';
            console.log(`[AI] Venta cerrada para ${contactId}. Moviendo a Pendientes IA; la IA sigue en etapa de venta (la post-venta arranca con /cuatro).`);
        }

        if (wantsNewOrder) {
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

        // Bandera "esperando datos de envío": el webhook la usa para darle 10 min al cliente a que
        // termine de mandar sus datos en partes. Se enciende cuando la IA los pide (/DatosEstafeta)
        // y se apaga cuando ya están completos (/datoscompletos) o si se abre un pedido nuevo.
        if (shippingDataComplete || wantsNewOrder) {
            updateData.awaitingShippingData = admin.firestore.FieldValue.delete();
        } else if (shippingDataRequested) {
            updateData.awaitingShippingData = true;
        }

        // Cancelación de pedido antes de registrarlo: quitar la etiqueta "Pendientes de
        // revisión IA". Que el contacto TENGA esa etiqueta ya significa que su pedido AÚN no
        // se ha registrado (registrar un pedido en POST /api/orders la quita), así que
        // "tiene pendientes_ia" == "antes de tener un pedido registrado". Si el pedido ya
        // estuviera registrado, no habría etiqueta que quitar y esto no corre. updateData ya
        // bumpea lastMessageTimestamp, así que el cambio se ve en vivo en el CRM.
        const hadOrWillHavePendienteIa = updateData.status === 'pendientes_ia'
            || (updateData.status === undefined && contactData.status === 'pendientes_ia');
        if (orderCancelled && hadOrWillHavePendienteIa) {
            updateData.status = null;
            console.log(`[AI] Cliente ${contactId} canceló su pedido (aún sin registrar). Quitando etiqueta Pendientes IA.`);
        }

        await contactRef.update(updateData);
        console.log(`[AI] Respuesta de IA enviada a ${contactId}. (Burbujas enviadas: ${aiMessages.length})`);

        // Registro automático del pedido (/registrar): el extractor lee la conversación (incluye
        // el resumen que el cliente confirmó) y crea el pedido en el CRM con el mismo núcleo que
        // el modal. Si tiene éxito, createOrder quita solo la etiqueta pendientes_ia que acaba de
        // poner el cierre; si falla, el contacto queda en Pendientes IA (flujo manual de siempre)
        // y se avisa al admin. Fire-and-forget: nunca debe tumbar la respuesta al cliente.
        // require perezoso para evitar ciclo de módulos (aiOrderRegistration requiere services).
        if (registerOrderCmd) {
            // Anexar la respuesta del TURNO ACTUAL al transcript: conversationHistory se arma
            // ANTES de generar, así que sin esto el extractor no vería un resumen/cierre emitido
            // en este mismo turno (y las confirmaciones por nota de voz perderían su contexto).
            const currentTurnText = aiMessages
                .map(m => `Asistente: ${m.replace(/\r?\n/g, '\n    ')}`)
                .join('\n');
            const fullTranscript = currentTurnText ? `${conversationHistory}\n${currentTurnText}` : conversationHistory;
            require('./orders/aiOrderRegistration')
                .registerOrderFromAI({ contactId, contactData, conversationText: fullTranscript })
                .catch(e => console.warn('[AI_ORDER] registro automático falló:', e.message));
        }

        // Comprobante sospechoso: reenviar al admin la última imagen/PDF que mandó el cliente
        // (el comprobante) para verificación manual. Fire-and-forget. Al cliente ya se le dijo
        // que estamos validando su pago (lo escribió la IA).
        if (suspiciousReceipt) {
            let comprobante = null;
            for (const mdoc of messagesSnapshot.docs) { // orden desc: el más reciente primero
                const md = mdoc.data();
                if (md.from === contactId && (md.type === 'image' || md.type === 'document') && md.fileUrl) {
                    comprobante = { fileUrl: md.fileUrl, fileType: md.fileType };
                    break;
                }
            }
            alertAdminSuspiciousReceipt(contactId, contactData, comprobante)
                .catch(e => console.warn('[AI] alertAdminSuspiciousReceipt falló:', e.message));
        }

        // Apoyo humano solicitado (/equipo): avisar al admin con lo que pidió el cliente
        // (ej. foto/video del pedido que la IA no tiene). Fire-and-forget.
        if (humanHelpNeeded) {
            alertAdminHumanNeeded(contactId, contactData, messageText)
                .catch(e => console.warn('[AI] alertAdminHumanNeeded falló:', e.message));
        }

        // Datos de envío completos (/datoscompletos): pasar el pedido a "Fabricar" y avisar a Rosario
        // para que genere la guía. Se juntan los mensajes de texto del cliente (sus datos) para
        // incluirlos en el aviso. Fire-and-forget: nunca debe tumbar la respuesta al cliente.
        if (shippingDataComplete) {
            const addressLines = [];
            for (const mdoc of messagesSnapshot.docs) { // desc: del más reciente al más viejo
                const md = mdoc.data();
                if (md.from === contactId) {
                    const t = (md.text || '').trim();
                    if (t) addressLines.push(t);
                }
                if (addressLines.length >= 12) break;
            }
            const addressText = addressLines.reverse().join('\n');
            markOrderFabricarForContact(contactId, contactData, addressText)
                .catch(e => console.warn('[POSTVENTA] markOrderFabricarForContact falló:', e.message));
        }

        // Comprobante validado (/comprobante): marcar el pedido para la sección "Envíos" y mandarle
        // al cliente el enlace del formulario de datos de envío. Fire-and-forget.
        if (comprobanteValidado) {
            markComprobanteValidadoAndSendForm(contactId, contactData)
                .catch(e => console.warn('[ENVIOS] markComprobanteValidadoAndSendForm falló:', e.message));
        }

        // Híbrido: si el pedido NO se acaba de registrar, etiquetar "en vivo" el estado
        // del pedido (pendiente de foto, etc.) reutilizando el historial ya armado. El
        // scheduler de order_followup leerá esta etiqueta y se ahorrará una clasificación.
        // Fire-and-forget: nunca debe afectar la respuesta principal. En post-venta el
        // pedido ya está tomado, así que no se etiqueta.
        if (!saleClosed && !shouldDeactivate && !isPostVenta && !registerOrderCmd) {
            tagOrderInProgress(contactId, contactRef, conversationHistory, contactData.name)
                .catch(e => console.warn('[ORDER_FOLLOWUP] live-tag falló:', e.message));
        }

        // Detección en vivo de aplazamientos -> agenda un recordatorio a fecha futura (plantilla).
        // Corre en TODAS las conversaciones, INCLUYENDO post-venta: ahí sirve para recordatorios de
        // PAGO ("te pago el día 15"). Solo se salta si el bot se está apagando en este turno.
        // require perezoso para evitar ciclo de módulos (scheduledReminderScheduler requiere services).
        if (!shouldDeactivate) {
            require('./leads/scheduledReminderScheduler')
                .detectAndArmReminder(contactId, contactRef, conversationHistory, contactData.name)
                .catch(e => console.warn('[REMINDER] detección en vivo falló:', e.message));
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
    cancelPendingAiTimer,
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
    askGeminiPro,
    getPurchaseEventTrigger,
    sendPurchaseEventOnFabricar,
    sendApprovedTemplateMessage,
    markComprobanteValidadoAndSendForm
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
