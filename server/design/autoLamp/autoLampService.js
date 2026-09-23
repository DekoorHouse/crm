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
const crypto = require('crypto');
const sharp = require('sharp');
const { db, bucket, admin } = require('../../config');
const imageStudio = require('../../imagenes/imageStudioService');

const RASTER_MODEL = 'openai/gpt-image-2.5-sunburst';
const RASTER_PROMPT = 'dame el diseño de la imagen con rellenos blancos y fondos negros. En raster engrave con degradado en trama';
// Último paso del equipo: "Convertir a mapa de bits" en difuminado (1 bit, Floyd–Steinberg) a la
// resolución de la láser, al tamaño real que la imagen tiene en el marco.
const BITMAP = { dpi: 254, method: 'diffusion', threshold: 128 };
let bitmapModule = null;
const bitmapTools = () => (bitmapModule ||= import('../../../public/editor-v2/bitmap.mjs'));
const FONT_PATH = 'editor-v2/fonts/rows-of-sunflowers.ttf';
const VISION_MODEL = 'gemini-3-flash-preview';
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
async function rasterize(reference) {
    const { buffer } = await download(reference.url);
    const jpeg = await sharp(buffer).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    const files = [{ buffer: jpeg, mimetype: 'image/jpeg', originalname: 'referencia.jpg' }];
    const fields = { requestId: crypto.randomUUID(), model: RASTER_MODEL, prompt: RASTER_PROMPT, aspect_ratio: '1:1' };
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
    return { url, jobId: job.id };
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
    const { name, datos } = orderName(order);
    await setStatus(ref, { status: 'working', step: 'Eligiendo la imagen del chat', startedAt: now(), error: admin.firestore.FieldValue.delete() });
    try {
        const reference = options.referenceUrl ? { url: options.referenceUrl, motivo: 'indicada a mano' } : await pickReference(await customerImages(order.contactId || order.telefono), datos);
        await setStatus(ref, { status: 'working', step: 'Convirtiendo a grabado', referenceUrl: reference.url, referenceReason: reference.motivo });
        const raster = options.rasterUrl ? { url: options.rasterUrl, jobId: null } : await rasterize(reference);

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
        const title = `DH${dh} · ${name}`;
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
        const result = { status: 'ready', step: 'Listo para revisar', name, projectId: project.id, previewUrl, svgUrl, rasterUrl: raster.url, rasterJobId: raster.jobId, finishedAt: now(), durationMs: Date.now() - started };
        await setStatus(ref, result);
        return { ...result, referenceUrl: reference.url };
    } catch (error) {
        await setStatus(ref, { status: 'error', error: error.message || String(error) }).catch(() => {});
        throw error;
    }
}

async function status(dh) {
    const orderDoc = await findOrder(dh);
    return orderDoc.data().autoLamp || null;
}

module.exports = { generate, status, orderName, pickReference, customerImages };
