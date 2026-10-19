'use strict';
// Lámpara de personaje hecha por el SISTEMA con el editor v2 (primer caso: DH17220, Broly).
// Sigue los mismos pasos que hace una persona en el editor, sin nadie frente a la pantalla:
//   1. toma el pedido (nombre) y la imagen del personaje que mandó el cliente por WhatsApp (la IA
//      descarta la imagen del anuncio, comprobantes de pago y capturas);
//   2. la convierte a grabado con "Convertir a raster" (mismo modelo y prompt que el editor), cuadrada
//      para que el personaje quepa completo en el círculo;
//   3. arma el proyecto del editor (composeLamp.mjs): marco con base blanca, grabado en el PowerClip,
//      nombre en Rows of Sunflowers con su silueta negra;
//   4. lo guarda en "Proyectos en Firebase" (se abre y corrige en /editor-v2), más la vista previa PNG y
//      el SVG de corte en Storage, y deja el resultado en el pedido (campo autoLamp).
// De inicio NO se manda nada al cliente: una persona lo revisa en el editor y decide.
//
// BETA "Diseño IA" (oct-2026): el mismo armado para CUALQUIER pedido que hoy se diseña a mano (foto del
// cliente, personaje sin plantilla, especiales). Antes de todo, la IA lee el pedido y el chat (designBrief)
// y decide qué grabar: una imagen que mandó el cliente o una ilustración nueva que se pide al estudio de
// /imagenes. Candado: NADA sube a Drive (ni a corte) sin que una persona apruebe (approve); se dispara a
// mano, pedido por pedido, desde Pendientes de Diseño.
const crypto = require('crypto');
const sharp = require('sharp');
const { db, bucket, admin } = require('../../config');
const imageStudio = require('../../imagenes/imageStudioService');

const RASTER_MODEL = 'openai/gpt-image-2.5-sunburst';
// BETA: el diseño IA usa Qwen Image 2.1 (GPU propia de /imagenes, mucho más barata). La GPU solo está prendida
// en su horario (qwenPod); si está apagada se usa gpt-image para que el diseño no se quede sin hacer.
const BETA_MODEL = 'dekoor/qwen-image-2.1';
// Sube cuando cambia cómo se ve el previo para el cliente: los ya guardados se vuelven a armar.
const CLIENT_PREVIEW_STYLE = 3;
const RASTER_PROMPT = 'dame el diseño de la imagen con rellenos blancos y fondos negros. En raster engrave con degradado en trama';
// Último paso del equipo: "Convertir a mapa de bits" en difuminado (1 bit, Floyd–Steinberg) a la
// resolución de la láser, al tamaño real que la imagen tiene en el marco.
const BITMAP = { dpi: 254, method: 'diffusion', threshold: 128 };
let bitmapModule = null;
const bitmapTools = () => (bitmapModule ||= import('../../../public/editor-v2/bitmap.mjs'));
const FONT_PATH = 'editor-v2/fonts/rows-of-sunflowers.ttf';
const VISION_MODEL = 'gemini-3-flash-preview';
const BRIEF_FALLBACK_MODELS = ['gemini-3.1-pro-preview'];
const ACTOR = { uid: 'auto-lamp' };
const STORAGE_DIR = 'auto-lamp';

const now = () => admin.firestore.FieldValue.serverTimestamp();
let composer = null;
const composerModule = () => (composer ||= import('./composeLamp.mjs'));
let fontCache = null;

async function findOrder(dh) {
    const snapshot = await db.collection('pedidos').where('consecutiveOrderNumber', '==', Number(dh)).limit(1).get();
    if (snapshot.empty) throw Object.assign(new Error(`No encontré el pedido DH${dh}.`), { status: 404 });
    return snapshot.docs[0];
}

// El nombre a grabar: "Nombre: MAURICIO | Personaje: Broly | ...".
function orderName(order) {
    const datos = (Array.isArray(order.items) ? order.items.map(item => item.datosProducto).filter(Boolean).join(' | ') : '') || order.datosProducto || '';
    const match = datos.match(/nombres?\s*:\s*([^|\n]+)/i);
    const name = (match ? match[1] : '').trim();
    if (!name) throw Object.assign(new Error('El pedido no trae "Nombre:" en sus datos.'), { status: 422 });
    return { name, datos };
}

// Imágenes que mandó el CLIENTE (no las nuestras: anuncios, respuestas automáticas).
async function customerImages(contactId) {
    const ours = process.env.PHONE_NUMBER_ID;
    const snapshot = await db.collection('contacts_whatsapp').doc(String(contactId)).collection('messages').orderBy('timestamp', 'asc').get();
    return snapshot.docs.map(doc => doc.data())
        .filter(m => m.fileUrl && /^image\//.test(m.fileType || '') && m.status !== 'sent' && (!ours || m.from !== ours))
        .map(m => ({ url: m.fileUrl, text: m.text || '', at: m.timestamp?.toDate?.() || null }));
}

// Conversación reciente (texto de los dos lados) para que la IA entienda qué pidió el cliente.
async function chatHistory(contactId, limit = 200) {
    const ours = process.env.PHONE_NUMBER_ID;
    const snapshot = await db.collection('contacts_whatsapp').doc(String(contactId)).collection('messages').orderBy('timestamp', 'desc').limit(limit).get();
    return snapshot.docs.reverse().map(doc => doc.data()).filter(m => !m.internal && (m.text || m.fileUrl)).map(m => {
        const client = m.status !== 'sent' && (!ours || m.from !== ours);
        const media = m.fileUrl ? `[${/^image\//.test(m.fileType || '') ? 'imagen' : 'archivo'}] ` : '';
        return `${client ? 'CLIENTE' : 'NOSOTROS'}: ${media}${String(m.text || '').replace(/\s+/g, ' ').slice(0, 400)}`;
    }).join('\n').slice(-20000);
}

async function geminiJson(parts) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_IMAGE_KEY;
    if (!apiKey) throw new Error('Falta GEMINI_API_KEY para leer el pedido.');
    // Gemini a veces responde 429/500/503 (saturado): reintenta y luego prueba un modelo de respaldo.
    const body = JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } });
    let response, lastStatus = 0;
    attempts: for (const model of [VISION_MODEL, VISION_MODEL, VISION_MODEL, ...BRIEF_FALLBACK_MODELS]) {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(120000),
        }).catch(() => null);
        lastStatus = response?.status || 0;
        if (response?.ok) break attempts;
        if (response && ![429, 500, 502, 503, 504].includes(response.status)) break attempts;
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (!response?.ok) throw new Error(`La IA no pudo leer el pedido (${lastStatus || 'sin respuesta'}). Intenta de nuevo en unos minutos.`);
    const data = await response.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    try { return JSON.parse(text); } catch (_) { throw new Error('La IA no respondió en el formato esperado.'); }
}

async function imagePart(url) {
    const { buffer } = await download(url);
    const small = await sharp(buffer).rotate().resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { inlineData: { mimeType: 'image/jpeg', data: small.toString('base64') } };
}

/**
 * BETA: la IA lee el pedido + el chat + las imágenes del cliente y decide el diseño.
 * note: indicación del equipo al regenerar ("usa la segunda foto", "sin nombre", …); manda sobre todo.
 */
async function designBrief({ order, datos, history, images, note }) {
    const candidates = images.slice(-6);
    const parts = [{ text: `Eres el diseñador de DekoorHouse. Hacemos lámparas LED de acrílico grabado con láser: un marco redondo con base, y dentro se GRABA una imagen en blanco y negro (raster con trama) y, si el cliente lo pidió, un NOMBRE/TEXTO abajo.
Tu trabajo: entender qué pidió el cliente para su lámpara y decidir el diseño.

Producto: "${order.producto || order.items?.[0]?.producto || ''}"
Datos del pedido (lo que registró el equipo): "${datos}"
${note ? `INDICACIÓN DEL EQUIPO (tiene prioridad sobre todo lo demás): "${note}"\n` : ''}
Conversación reciente (lo más nuevo al final):
${history || '(sin mensajes)'}

Abajo van, numeradas desde 0, las imágenes que mandó el cliente.
Decide:
- "tipo": "foto" (grabar una foto/imagen que mandó el cliente), "personaje" (un personaje/caricatura/dibujo que hay que ilustrar) o "especial" (otra cosa: logo, frase, escena…).
- "imageIndex": la imagen del cliente que hay que convertir a grabado, o -1 si ninguna sirve y hay que ILUSTRAR desde cero. NUNCA elijas comprobantes de pago, capturas de transferencias, tickets, capturas de chat, fotos de una lámpara nuestra ya hecha ni la imagen del anuncio.
- "prompt": si imageIndex es -1, describe en español la ilustración a generar (personaje, pose, estilo, elementos), SIN texto ni letras en la imagen. Si hay imagen, indica qué conservar o ajustar de ella (ej. "solo las dos personas, sin el fondo"), o "" si va tal cual.
- "nombre": el texto EXACTO a grabar abajo (nombre(s), fecha, frase) tal como lo pidió, respetando mayúsculas y acentos; "" si no pidió texto. Varias líneas sepáralas con " · ".
- "resumen": una línea para el equipo con lo que entendiste que quiere.
- "advertencias": dudas o cosas que no puedes resolver (ej. "pidió 2 lámparas distintas", "la foto es muy oscura", "no queda claro el nombre"); [] si nada.
Responde SOLO este JSON: {"tipo": "...", "imageIndex": 0, "prompt": "...", "nombre": "...", "resumen": "...", "advertencias": []}` }];
    for (const [i, image] of candidates.entries()) {
        try { parts.push({ text: `Imagen ${i}${image.text ? ` (mensaje: "${image.text.slice(0, 200)}")` : ''}:` }, await imagePart(image.url)); }
        catch (_) { parts.push({ text: `Imagen ${i}: (no se pudo descargar)` }); }
    }
    const brief = await geminiJson(parts);
    const index = Number.isInteger(Number(brief.imageIndex)) ? Number(brief.imageIndex) : -1;
    return {
        tipo: ['foto', 'personaje', 'especial'].includes(brief.tipo) ? brief.tipo : 'especial',
        nombre: String(brief.nombre || '').trim().slice(0, 80),
        reference: index >= 0 ? candidates[index] || null : null,
        prompt: String(brief.prompt || '').trim().slice(0, 1500),
        resumen: String(brief.resumen || '').trim().slice(0, 400),
        advertencias: (Array.isArray(brief.advertencias) ? brief.advertencias : []).map(String).slice(0, 6),
    };
}

async function download(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo descargar una imagen (${response.status}).`);
    return { buffer: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') || '' };
}

// La IA elige cuál imagen del cliente es la del diseño a grabar.
async function pickReference(images, datos) {
    if (!images.length) throw Object.assign(new Error('El cliente no ha mandado ninguna imagen.'), { status: 422 });
    const candidates = images.slice(-6);
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_IMAGE_KEY;
    if (!apiKey) throw new Error('Falta GEMINI_API_KEY para elegir la imagen.');
    const parts = [{ text: `Un cliente pidió una lámpara grabada con un personaje o imagen. Datos del pedido: "${datos}".
Abajo van, numeradas desde 0, las imágenes que mandó por WhatsApp. Elige la que muestra el personaje/diseño que quiere grabar.
NO elijas comprobantes de pago, capturas de transferencias, tickets, capturas de chat ni fotos de otra lámpara ya hecha.
Responde SOLO este JSON: {"index": <número o -1 si ninguna sirve>, "motivo": "<breve>"}` }];
    for (const [i, image] of candidates.entries()) {
        const { buffer } = await download(image.url);
        const small = await sharp(buffer).rotate().resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        parts.push({ text: `Imagen ${i}${image.text ? ` (mensaje: "${image.text.slice(0, 200)}")` : ''}:` }, { inlineData: { mimeType: 'image/jpeg', data: small.toString('base64') } });
    }
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } }),
    });
    if (!response.ok) throw new Error(`La IA no pudo revisar las imágenes (${response.status}).`);
    const data = await response.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    let choice;
    try { choice = JSON.parse(text); } catch (_) { throw new Error('La IA no respondió cuál imagen usar.'); }
    const picked = candidates[Number(choice.index)];
    if (!picked) throw Object.assign(new Error(`Ninguna imagen del chat sirve para grabar: ${choice.motivo || 'sin motivo'}.`), { status: 422 });
    return { ...picked, motivo: choice.motivo || '' };
}

// "Convertir a raster" del editor, desde el servidor. Cuadrada si el modelo lo permite.
// Sin referencia (BETA, personaje sin imagen) el estudio de /imagenes ILUSTRA desde la descripción con el
// mismo acabado de grabado. extra: lo que la IA pidió conservar o ajustar de la foto.
async function rasterize(reference, { description = '', extra = '', model = RASTER_MODEL } = {}) {
    const files = [];
    if (reference) {
        const { buffer } = await download(reference.url);
        // Qwen entrega la imagen con la forma de la referencia: se manda cuadrada (relleno blanco) para que el
        // diseño salga cuadrado y quepa completo en el círculo.
        const fit = model === BETA_MODEL ? { fit: 'contain', background: '#ffffff' } : { fit: 'inside', withoutEnlargement: true };
        const jpeg = await sharp(buffer).rotate().resize(2048, 2048, fit).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
        files.push({ buffer: jpeg, mimetype: 'image/jpeg', originalname: 'referencia.jpg' });
    }
    const prompt = reference
        ? (extra ? `${RASTER_PROMPT}. ${extra}` : RASTER_PROMPT)
        : `Ilustración para grabar con láser en una lámpara redonda: ${description}. Centrada, completa dentro de un círculo, sin texto ni letras. Diseño con rellenos blancos y fondo negro. En raster engrave con degradado en trama.`;
    const fields = { requestId: crypto.randomUUID(), model, prompt, aspect_ratio: '1:1' };
    let job;
    try { job = await imageStudio.createGeneration(fields, files, ACTOR); }
    catch (error) {
        if (!/aspect_ratio/.test(error.message)) throw error;
        job = await imageStudio.createGeneration({ ...fields, requestId: crypto.randomUUID(), aspect_ratio: undefined }, files, ACTOR);
    }
    const started = Date.now();
    while (job.status === 'generating') {
        if (Date.now() - started > 6 * 60 * 1000) throw new Error('La conversión a grabado tardó demasiado.');
        await new Promise(resolve => setTimeout(resolve, 4000));
        job = await imageStudio.getJob(job.id);
    }
    const url = job.images?.[0]?.fullUrl;
    if (job.status !== 'completed' || !url) throw new Error(job.error || 'La IA no devolvió el grabado.');
    return { url, jobId: job.id, model };
}

// Qwen si la GPU está lista; si no (fuera de horario o falla la GPU), el modelo de siempre.
async function rasterizeBeta(reference, options) {
    try { return await rasterize(reference, { ...options, model: BETA_MODEL }); }
    catch (error) {
        if (error.status !== 503 && !/Qwen|GPU/i.test(error.message || '')) throw error;
        console.warn('[AUTO-LAMP] Qwen no disponible, uso gpt-image:', error.message);
        return { ...(await rasterize(reference, { ...options, model: RASTER_MODEL })), fallback: error.message };
    }
}

async function loadFont() {
    if (!fontCache) {
        const [bytes] = await bucket.file(FONT_PATH).download();
        fontCache = (await composerModule()).loadFont(bytes);
    }
    return fontCache;
}

// Sube un archivo con URL de descarga (la misma forma que usa el editor para sus imágenes).
async function saveFile(path, buffer, contentType) {
    const token = crypto.randomUUID();
    await bucket.file(path).save(buffer, { resumable: false, metadata: { contentType, cacheControl: 'private, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } } });
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function setStatus(orderRef, patch) {
    await orderRef.set({ autoLamp: { ...patch, updatedAt: now() } }, { merge: true });
}

/**
 * Genera la lámpara de un pedido. Devuelve { projectId, previewUrl, svgUrl, ... }.
 * options.rasterUrl: usar un grabado ya hecho (pruebas) en vez de generar uno nuevo.
 */
async function generate(dh, options = {}) {
    const started = Date.now();
    const orderDoc = await findOrder(dh);
    const order = orderDoc.data(), ref = orderDoc.ref;
    const beta = !!options.beta;
    if (['uploading', 'approved'].includes(order.autoLamp?.status)) throw Object.assign(new Error('Este diseño ya se aprobó o se está subiendo a Drive.'), { status: 409 });
    const datos = (Array.isArray(order.items) ? order.items.map(item => item.datosProducto).filter(Boolean).join(' | ') : '') || order.datosProducto || '';
    let name = beta ? '' : orderName(order).name;
    const contactId = order.contactId || order.telefono;
    // Cada intento empieza limpio: nada del anterior (error, brief, rechazo, resultado) se arrastra.
    await ref.update({ autoLamp: { status: 'working', step: beta ? 'Leyendo el pedido y el chat' : 'Eligiendo la imagen del chat', beta,
        ...(options.note ? { note: String(options.note).slice(0, 500) } : {}), startedAt: now(), updatedAt: now() } });
    try {
        let reference, brief = null;
        if (options.referenceUrl) reference = { url: options.referenceUrl, motivo: 'indicada a mano' };
        else if (beta) {
            brief = await designBrief({ order, datos, history: await chatHistory(contactId), images: await customerImages(contactId), note: options.note });
            reference = brief.reference ? { ...brief.reference, motivo: brief.resumen } : null;
            name = brief.nombre;
            await setStatus(ref, { status: 'working', step: reference ? 'Convirtiendo la imagen del cliente a grabado' : 'Ilustrando con el estudio de imágenes',
                brief: { tipo: brief.tipo, nombre: brief.nombre, prompt: brief.prompt, resumen: brief.resumen, advertencias: brief.advertencias, referenceUrl: reference?.url || null } });
            if (!reference && !brief.prompt) throw Object.assign(new Error('La IA no encontró imagen ni descripción para el diseño.'), { status: 422 });
        } else reference = await pickReference(await customerImages(contactId), datos);
        if (!beta) await setStatus(ref, { status: 'working', step: 'Convirtiendo a grabado', referenceUrl: reference.url, referenceReason: reference.motivo });
        const raster = options.rasterUrl ? { url: options.rasterUrl, jobId: null }
            : brief ? await rasterizeBeta(reference, { description: brief.prompt, extra: reference ? brief.prompt : '' }) : await rasterize(reference);

        const { buffer } = await download(raster.url);
        const meta = await sharp(buffer).metadata();
        const font = await loadFont();
        const { composeLamp, renderPreview, exportLampSvg, pictureSizeMm } = await composerModule();

        await setStatus(ref, { status: 'working', step: 'Convirtiendo a mapa de bits' });
        const { bitmapSize, toBitmap, pngWithDpi } = await bitmapTools();
        const mm = pictureSizeMm({ width: meta.width, height: meta.height });
        const size = bitmapSize(mm.width, mm.height, BITMAP.dpi);
        const rgba = await sharp(buffer).flatten({ background: '#ffffff' }).resize(size.width, size.height, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
        const bits = toBitmap(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), size.width, size.height, BITMAP);
        const png = Buffer.from(pngWithDpi(await sharp(Buffer.from(bits.buffer), { raw: { width: size.width, height: size.height, channels: 4 } }).png({ palette: true, colours: 2 }).toBuffer(), BITMAP.dpi));

        await setStatus(ref, { status: 'working', step: 'Armando el diseño' });
        const title = name ? `DH${dh} · ${name}` : `DH${dh}`;
        const dataUrl = 'data:image/png;base64,' + png.toString('base64');
        const { document } = composeLamp({ image: { dataUrl, width: size.width, height: size.height, pixelated: true }, name, font, title });

        const folder = `${STORAGE_DIR}/DH${dh}`;
        const imageHash = crypto.createHash('sha256').update(dataUrl).digest('hex');
        const imageUrl = await saveFile(`editor-v2/images/${ACTOR.uid}/${imageHash}`, png, 'image/png');
        const previewUrl = await saveFile(`${folder}/vista-previa.png`, renderPreview(document, font), 'image/png');
        const svgUrl = await saveFile(`${folder}/corte.svg`, Buffer.from(exportLampSvg(document, font)), 'image/svg+xml');

        // Proyecto del editor: la imagen va por URL (como guarda el editor), no incrustada.
        const documentJson = JSON.stringify(document, (key, value) => key === 'src' && value === dataUrl ? imageUrl : value);
        const project = await db.collection('editor_v2_projects').add({
            name: title, documentJson, revision: 1, objectCount: document.objects.length,
            createdAt: now(), createdBy: ACTOR.uid, updatedAt: now(), updatedBy: ACTOR.uid, orderNumber: Number(dh),
        });
        const result = { status: 'ready', step: 'Listo para revisar', name, projectId: project.id, projectRevision: 1, previewUrl, svgUrl, svgPath: `${folder}/corte.svg`,
            rasterUrl: raster.url, rasterJobId: raster.jobId, rasterModel: raster.model || null, ...(raster.fallback ? { rasterFallback: raster.fallback } : {}), finishedAt: now(), durationMs: Date.now() - started };
        await setStatus(ref, result);
        return { ...result, referenceUrl: reference?.url || null };
    } catch (error) {
        await setStatus(ref, { status: 'error', error: error.message || String(error) }).catch(() => {});
        throw error;
    }
}

async function status(dh) {
    const orderDoc = await findOrder(dh);
    return orderDoc.data().autoLamp || null;
}

// Las imágenes del proyecto se guardan por URL (como el editor); para pintarlas en el servidor se incrustan.
async function hydrateImages(objects) {
    for (const item of objects) {
        if (item.powerClip?.objects) await hydrateImages(item.powerClip.objects);
        if (item.type === 'image' && /^https?:/.test(item.src || '')) {
            const { buffer, type } = await download(item.src);
            item.src = `data:${/^image\//.test(type) ? type.split(';')[0] : 'image/png'};base64,${buffer.toString('base64')}`;
        }
    }
}

/**
 * PREVIO PARA EL CLIENTE: el círculo con fondo blanco y el diseño en negro. Se arma desde la versión ACTUAL
 * del proyecto del editor (incluye lo que alguien haya corregido) y queda en autoLamp.clientPreviewUrl.
 */
async function clientPreview(dh) {
    const orderDoc = await findOrder(dh);
    const lamp = orderDoc.data().autoLamp;
    if (!lamp?.projectId) throw Object.assign(new Error('Este pedido no tiene diseño de la IA.'), { status: 404 });
    const project = (await db.collection('editor_v2_projects').doc(lamp.projectId).get()).data();
    if (!project) throw Object.assign(new Error('No encontré el proyecto del diseño.'), { status: 404 });
    if (lamp.clientPreviewUrl && Number(lamp.clientPreviewRevision) === Number(project.revision) && lamp.clientPreviewStyle === CLIENT_PREVIEW_STYLE) return { url: lamp.clientPreviewUrl, revision: project.revision };
    const document = JSON.parse(project.documentJson);
    await hydrateImages(document.objects);
    const { renderClientPreview } = await composerModule();
    const { raw, width, height } = renderClientPreview(document, await loadFont());
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const url = await saveFile(`${STORAGE_DIR}/DH${dh}/previo-cliente-r${project.revision}-v${CLIENT_PREVIEW_STYLE}.png`, png, 'image/png');
    await orderDoc.ref.update({ 'autoLamp.clientPreviewUrl': url, 'autoLamp.clientPreviewRevision': project.revision, 'autoLamp.clientPreviewStyle': CLIENT_PREVIEW_STYLE });
    return { url, revision: project.revision };
}

// --- BETA: compuerta de aprobación. Es el ÚNICO camino por el que algo de aquí sube a Drive. ---------

/**
 * Aprueba el diseño de un pedido y sube el SVG a la carpeta de corte de Drive.
 * svg: el que exporta el editor (si la persona lo corrigió ahí). Sin él se usa el SVG que armó el sistema,
 * solo si el proyecto no se tocó en el editor; si se tocó, hay que aprobar desde el editor para no subir
 * una versión vieja.
 */
async function approve(dh, { svg = null, actor = null } = {}) {
    const { uploadDrive } = require('../svgCutStorage');
    const orderDoc = await findOrder(dh);
    const ref = orderDoc.ref;
    // Candado contra doble subida: solo un 'ready' pasa a 'uploading'. Un 'uploading' que quedó colgado
    // (reinicio a media subida) NO se reintenta solo: Drive pudo haberlo recibido.
    const lamp = await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data()?.autoLamp;
        if (!current || current.status !== 'ready') {
            const why = current?.status === 'uploading' ? 'Ya se está subiendo (o se cortó a media subida: revisa Drive antes de reintentar).'
                : current?.status === 'approved' ? 'Ya se aprobó y subió a Drive.' : 'No hay un diseño listo para aprobar.';
            throw Object.assign(new Error(why), { status: 409 });
        }
        tx.update(ref, { 'autoLamp.status': 'uploading', 'autoLamp.step': 'Subiendo a Drive', 'autoLamp.updatedAt': now() });
        return current;
    });
    let sent = false;
    try {
        let bytes;
        if (svg) {
            if (typeof svg !== 'string' || !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg)) throw Object.assign(new Error('El SVG del editor no es válido.'), { status: 400 });
            bytes = Buffer.from(svg);
        } else {
            const project = lamp.projectId ? (await db.collection('editor_v2_projects').doc(lamp.projectId).get()).data() : null;
            if (project && Number(project.revision) !== Number(lamp.projectRevision || 1))
                throw Object.assign(new Error('El diseño se corrigió en el editor: apruébalo desde el editor («Aprobar y subir a Drive») para subir la versión corregida.'), { status: 409 });
            [bytes] = await bucket.file(lamp.svgPath || `${STORAGE_DIR}/DH${dh}/corte.svg`).download();
        }
        const folder = `${STORAGE_DIR}/DH${dh}`, stamp = Date.now().toString(36);
        const approvedSvgUrl = await saveFile(`${folder}/aprobado-${stamp}.svg`, bytes, 'image/svg+xml');
        let previewUrl = lamp.previewUrl || null;
        if (svg) {
            try {
                const { Resvg } = require('@resvg/resvg-js');
                previewUrl = await saveFile(`${folder}/aprobado-${stamp}.png`, new Resvg(bytes.toString(), { fitTo: { mode: 'width', value: 1400 }, background: '#ffffff' }).render().asPng(), 'image/png');
            } catch (_) { /* sin vista previa nueva: se queda la del sistema */ }
        }
        sent = true;
        const upload = await uploadDrive(`DH${dh}-ia-beta-${stamp}.svg`, bytes);
        await ref.update({
            svgCorteAt: admin.firestore.Timestamp.now(), svgCorteBy: 'auto-lamp-beta', svgCorteUrl: upload.webViewLink,
            svgCorteFileName: upload.name, svgCortePreviewUrl: previewUrl, svgCorteStorageUrl: approvedSvgUrl,
            svgCorteFiles: [{ name: upload.name, url: upload.webViewLink, svg: approvedSvgUrl, preview: previewUrl }],
            'autoLamp.status': 'approved', 'autoLamp.step': 'Aprobado y en Drive', 'autoLamp.driveUrl': upload.webViewLink,
            'autoLamp.approvedAt': now(), 'autoLamp.approvedBy': actor?.email || actor?.uid || null,
            'autoLamp.approvedFromEditor': !!svg, 'autoLamp.error': admin.firestore.FieldValue.delete(), 'autoLamp.updatedAt': now(),
        });
        try { await require('../designPending').recomputeForContact(orderDoc.data().contactId || orderDoc.data().telefono); } catch (_) {}
        return { driveUrl: upload.webViewLink, fileName: upload.name };
    } catch (error) {
        // Antes de mandar a Drive (o si Drive rechazó con error claro) vuelve a 'ready' para reintentar. Si
        // ya se mandó y no hubo confirmación, es ambiguo: se queda en 'uploading' para revisar Drive a mano.
        const ambiguous = sent && (error.name === 'TimeoutError' || /no confirmó/.test(error.message || ''));
        await ref.update(ambiguous
            ? { 'autoLamp.step': 'Revisar Drive: no se confirmó la subida', 'autoLamp.error': error.message, 'autoLamp.updatedAt': now() }
            : { 'autoLamp.status': 'ready', 'autoLamp.step': 'Listo para revisar', 'autoLamp.error': error.message, 'autoLamp.updatedAt': now() }).catch(() => {});
        throw error;
    }
}

// Descarta el diseño (no sube nada). Después se puede regenerar con una indicación.
async function reject(dh, { reason = '', actor = null } = {}) {
    const orderDoc = await findOrder(dh);
    const lamp = orderDoc.data().autoLamp;
    if (!lamp || !['ready', 'error'].includes(lamp.status)) throw Object.assign(new Error('No hay un diseño para descartar.'), { status: 409 });
    await orderDoc.ref.update({ 'autoLamp.status': 'rejected', 'autoLamp.step': 'Descartado', 'autoLamp.rejectedAt': now(),
        'autoLamp.rejectReason': String(reason).slice(0, 500), 'autoLamp.rejectedBy': actor?.email || actor?.uid || null, 'autoLamp.updatedAt': now() });
}

module.exports = { generate, status, approve, reject, clientPreview, orderName, pickReference, customerImages, designBrief, chatHistory };
