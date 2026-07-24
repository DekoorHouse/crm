const fetch = require('node-fetch');
const sharp = require('sharp');
const { db, bucket } = require('../config');

// Llave de imágenes: la dedicada si existe, si no la general de Gemini (la misma que ya usa
// toda la IA del CRM). Así el módulo funciona sin configurar nada extra en Render.
const API_KEY = () => process.env.GOOGLE_AI_IMAGE_KEY || process.env.GEMINI_API_KEY;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_ID = 'gemini-3-pro-image-preview';   // Nano Banana Pro (el mejor de Gemini escribiendo texto)
const COST_PER_IMAGE = 0.134;   // 1K y 2K cuestan igual; 4K sube a $0.24
const INPUT_PER_1M = 2.00;
const COLLECTION = 'mockups_gallery';
const STORAGE_DIR = 'mockups';
const THUMB_WIDTH = 400;

// ===================== IMAGE GENERATION =====================

// Gemini solo acepta '1K' | '2K' | '4K'. Los llamadores viejos mandaban '1k' (formato WaveSpeed).
function normResolution(r) {
    const s = String(r || '').trim().toUpperCase();
    return ['1K', '2K', '4K'].includes(s) ? s : '2K';
}

// `maxRefSize` = lado máximo al que se encogen las imágenes de referencia antes de mandarlas.
// 1024 basta para la foto base de la lámpara y el diseño a grabar; el GRABADO de una foto del
// cliente sube a 2048 porque ahí sí importa el detalle fino de los rostros.
async function generateImage(prompt, aspectRatio = '1:1', refImages = [], resolution = '2K', maxRefSize = 1024) {
    const apiKey = API_KEY();
    if (!apiKey) throw new Error('Falta GOOGLE_AI_IMAGE_KEY (o GEMINI_API_KEY) para generar imágenes.');

    const url = `${BASE_URL}/models/${MODEL_ID}:generateContent?key=${apiKey}`;

    const parts = [{ text: prompt }];
    for (const img of refImages) {
        // Resize para reducir tokens de entrada (nunca agranda).
        const resized = await sharp(Buffer.from(img.base64, 'base64'))
            .resize(maxRefSize, maxRefSize, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
        parts.push({
            inlineData: {
                mimeType: 'image/webp',
                data: resized.toString('base64'),
            },
        });
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: { aspectRatio, imageSize: normResolution(resolution) },
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini Image API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('No se recibió respuesta del modelo.');

    // Extraer imágenes y texto
    const images = []; // { mimeType, base64 }
    let textResponse = '';
    for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
            images.push({ mimeType: part.inlineData.mimeType, base64: part.inlineData.data });
        }
        if (part.text) {
            textResponse += part.text;
        }
    }

    if (images.length === 0) {
        throw new Error(textResponse || 'El modelo no generó imágenes. Intenta reformular el prompt.');
    }

    const usage = data.usageMetadata || {};
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const inputTokenCost = (inputTokens / 1_000_000) * INPUT_PER_1M;
    const imagesCost = COST_PER_IMAGE * images.length;

    return {
        images,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        cost: { perImage: COST_PER_IMAGE, imagesCost, inputTokenCost, total: inputTokenCost + imagesCost },
    };
}

// ===================== FIREBASE STORAGE =====================

async function saveToGallery(prompt, aspectRatio, generatedImages, usage, cost) {
    const saved = [];

    for (const img of generatedImages) {
        const ts = Date.now();
        const id = ts + '_' + Math.random().toString(36).slice(2, 8);
        const buffer = Buffer.from(img.base64, 'base64');

        // Subir imagen completa como webp
        const fullWebp = await sharp(buffer).webp({ quality: 85 }).toBuffer();
        const fullPath = `${STORAGE_DIR}/${id}_full.webp`;
        const fullFile = bucket.file(fullPath);
        await fullFile.save(fullWebp, { metadata: { contentType: 'image/webp' }, public: true });
        const fullUrl = `https://storage.googleapis.com/${bucket.name}/${fullPath}`;

        // Generar y subir thumbnail
        const thumbWebp = await sharp(buffer).resize(THUMB_WIDTH, THUMB_WIDTH, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 60 }).toBuffer();
        const thumbPath = `${STORAGE_DIR}/${id}_thumb.webp`;
        const thumbFile = bucket.file(thumbPath);
        await thumbFile.save(thumbWebp, { metadata: { contentType: 'image/webp' }, public: true });
        const thumbUrl = `https://storage.googleapis.com/${bucket.name}/${thumbPath}`;

        // Guardar metadata en Firestore
        const doc = {
            prompt,
            aspectRatio,
            fullUrl,
            thumbUrl,
            fullPath,
            thumbPath,
            usage,
            cost,
            createdAt: new Date().toISOString(),
        };
        const ref = await db.collection(COLLECTION).add(doc);
        saved.push({ id: ref.id, ...doc });
    }

    return saved;
}

// ===================== GALLERY =====================

async function getGallery(limit = 50, startAfter = null) {
    let query = db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(limit);
    if (startAfter) {
        query = query.startAfter(startAfter);
    }
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function deleteFromGallery(docId) {
    const doc = await db.collection(COLLECTION).doc(docId).get();
    if (!doc.exists) throw new Error('Imagen no encontrada.');
    const data = doc.data();

    // Eliminar archivos de Storage
    try { await bucket.file(data.fullPath).delete(); } catch (e) { /* ignore */ }
    try { await bucket.file(data.thumbPath).delete(); } catch (e) { /* ignore */ }

    // Eliminar documento
    await db.collection(COLLECTION).doc(docId).delete();
}

// ===================== BATCH JOBS =====================

const BATCH_COLLECTION = 'mockup_batches';

async function saveBatch(names, nameImageUrls) {
    const doc = { names, nameImageUrls, createdAt: new Date().toISOString() };
    const ref = await db.collection(BATCH_COLLECTION).add(doc);
    return ref.id;
}

async function getBatch(id) {
    const doc = await db.collection(BATCH_COLLECTION).doc(id).get();
    if (!doc.exists) throw new Error('Batch no encontrado.');
    return { id: doc.id, ...doc.data() };
}

// ===================== PLANTILLAS DE MOCKUP =====================
// Cada plantilla = un diseño de lámpara con su foto base (URL pública) y un
// prompt con placeholders {nombre1} {nombre2} {fecha} {personalizacion}.
const TEMPLATES_COLLECTION = 'mockup_templates';

async function listTemplates() {
    const snap = await db.collection(TEMPLATES_COLLECTION).orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getTemplate(id) {
    const doc = await db.collection(TEMPLATES_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
}

async function createTemplate({ nombre, baseImagePath, baseImageUrl, promptTemplate, productMatch, aspectRatio, designSvg, designId }) {
    const doc = {
        nombre: (nombre || '').toString().trim() || 'Sin nombre',
        baseImagePath: baseImagePath || null,
        baseImageUrl: baseImageUrl || null,
        promptTemplate: (promptTemplate || '').toString(),
        productMatch: Array.isArray(productMatch) ? productMatch : [],
        aspectRatio: aspectRatio || '1:1',
        // SVG del diseño de referencia (2ª imagen). Usa los mismos placeholders que el
        // prompt ({nombre1} {nombre2} {fecha}); el frontend lo rellena, lo rasteriza a PNG
        // y lo sube como 2ª referencia para que la IA grabe ese diseño en la lámpara.
        designSvg: (designSvg || '').toString(),
        // Diseño del lienzo (mockup_designs) que usa esta plantilla por defecto: el bloque de
        // preview lo pre-selecciona y genera la 2ª referencia con los datos del pedido.
        designId: designId || null,
        createdAt: new Date().toISOString(),
    };
    const ref = await db.collection(TEMPLATES_COLLECTION).add(doc);
    return { id: ref.id, ...doc };
}

async function updateTemplate(id, patch = {}) {
    const allowed = {};
    for (const k of ['nombre', 'baseImagePath', 'baseImageUrl', 'promptTemplate', 'productMatch', 'aspectRatio', 'designSvg', 'designId']) {
        if (patch[k] !== undefined) allowed[k] = patch[k];
    }
    await db.collection(TEMPLATES_COLLECTION).doc(id).set(allowed, { merge: true });
    return getTemplate(id);
}

async function deleteTemplate(id) {
    const tpl = await getTemplate(id);
    if (tpl?.baseImagePath) {
        try { await bucket.file(tpl.baseImagePath).delete(); } catch (e) { /* ignore */ }
    }
    await db.collection(TEMPLATES_COLLECTION).doc(id).delete();
}

// Sube la foto base a Storage como webp PÚBLICO (WhatsApp la descarga por URL,
// así que NO puede ser una URL firmada/privada).
async function uploadTemplateBaseImage(buffer) {
    const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const webp = await sharp(buffer)
        .rotate()   // auto-orienta según EXIF (las fotos de celular vienen giradas 90°); debe ir ANTES del resize
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer();
    const baseImagePath = `${STORAGE_DIR}/templates/${id}_base.webp`;
    const file = bucket.file(baseImagePath);
    await file.save(webp, { metadata: { contentType: 'image/webp' }, public: true, resumable: false });
    const baseImageUrl = `https://storage.googleapis.com/${bucket.name}/${baseImagePath}`;
    return { baseImagePath, baseImageUrl };
}

// Sube una imagen cualquiera (buffer) como webp PÚBLICO y devuelve su URL. La usa la 2ª
// referencia del preview (diseño generado por código o imagen subida a mano); debe ser
// pública porque se vuelve a descargar por URL para mandarla a la IA (una firmada daría 403).
async function uploadPublicImage(buffer, subdir = 'refs') {
    const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const webp = await sharp(buffer)
        .rotate()   // auto-orienta según EXIF (fotos de celular giradas 90°); debe ir ANTES del resize
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer();
    const path = `${STORAGE_DIR}/${subdir}/${id}.webp`;
    const file = bucket.file(path);
    await file.save(webp, { metadata: { contentType: 'image/webp' }, public: true, resumable: false });
    const url = `https://storage.googleapis.com/${bucket.name}/${path}`;
    return { path, url };
}

// ===================== DISEÑOS DEL LIENZO (banco de pruebas) =====================
// Un "diseño" = los elementos del lienzo 864×1152 (textos/vectores/imágenes) con nombre,
// para guardarlo y recargarlo. Las imágenes pesadas se suben a Storage desde el front y
// aquí solo llega su URL, para no acercarse al límite de 1MB por documento.
const DESIGNS_COLLECTION = 'mockup_designs';

function validateDesign({ nombre, items }) {
    const n = (nombre || '').toString().trim();
    if (!n) throw Object.assign(new Error('Ponle nombre al diseño.'), { status: 400 });
    if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('El diseño no tiene elementos.'), { status: 400 });
    if (JSON.stringify(items).length > 900000) throw Object.assign(new Error('El diseño es demasiado grande para guardarse (imágenes muy pesadas).'), { status: 400 });
    return { nombre: n, items };
}

async function listDesigns() {
    const snap = await db.collection(DESIGNS_COLLECTION).orderBy('updatedAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function createDesign(data) {
    const clean = validateDesign(data);
    const now = new Date().toISOString();
    const doc = { ...clean, createdAt: now, updatedAt: now };
    const ref = await db.collection(DESIGNS_COLLECTION).add(doc);
    return { id: ref.id, ...doc };
}

async function updateDesign(id, data) {
    const clean = validateDesign(data);
    await db.collection(DESIGNS_COLLECTION).doc(id).set({ ...clean, updatedAt: new Date().toISOString() }, { merge: true });
    const doc = await db.collection(DESIGNS_COLLECTION).doc(id).get();
    return { id, ...doc.data() };
}

async function deleteDesign(id) {
    await db.collection(DESIGNS_COLLECTION).doc(id).delete();
}

// Descarga a base64 SOLO imágenes de NUESTRO bucket (rehidratar diseños del lienzo: para
// rasterizar, los <image> del SVG deben ser data URIs). El prefijo fijo evita SSRF.
async function fetchOwnImageAsBase64(url) {
    const prefix = `https://storage.googleapis.com/${bucket.name}/`;
    if (typeof url !== 'string' || !url.startsWith(prefix)) {
        throw Object.assign(new Error('URL no permitida.'), { status: 400 });
    }
    return fetchImageAsBase64(url);
}

// Reemplaza los placeholders del prompt con los campos del pedido.
// Los placeholders no provistos se eliminan para no ensuciar la instrucción.
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPromptFromTemplate(promptTemplate, fields = {}) {
    let out = String(promptTemplate || '');
    let hasMultiline = false;
    let fechaVacia = false;
    for (const [k, v] of Object.entries(fields)) {
        let val = (v === undefined || v === null) ? '' : String(v);
        // Quita separadores sueltos de los bordes (barra "|", comas, &, +) pero CONSERVA
        // los saltos de línea internos (ej. dos fechas apiladas que quiere el cliente).
        val = val.replace(/^[\s|,&+]+|[\s|,&+]+$/g, '').trim();
        if (k === 'fecha' && esSinFecha(val)) val = '';   // "Sin Fecha" -> vacío (no se graba)
        if (k === 'fecha' && !val) fechaVacia = true;
        if (val.includes('\n')) hasMultiline = true;
        out = out.replace(new RegExp('\\{' + escapeRegExp(k) + '\\}', 'g'), val);
    }
    out = out.replace(/\{[a-zA-Z0-9_]+\}/g, '').replace(/[ \t]{2,}/g, ' ').trim();
    // Si algún campo trae varios renglones (p. ej. dos fechas), instruir a la IA para que
    // los grabe apilados (uno debajo del otro), no en una sola línea.
    if (hasMultiline) {
        out += '\nIMPORTANTE: algún texto (por ejemplo la fecha) viene en varios renglones; grábalo en líneas separadas, una debajo de la otra, respetando los saltos de línea.';
    }
    // Pedido SIN fecha: que la IA NO grabe ninguna fecha (antes dejaba "Sin Fecha" o inventaba una).
    if (fechaVacia && /\{fecha\}/.test(String(promptTemplate || ''))) {
        out += '\nIMPORTANTE: este pedido va SIN FECHA. NO grabes ninguna fecha ni ningún texto en el lugar de la fecha; deja ese espacio vacío.';
    }
    return out;
}

// Parseo backend de los datos del pedido (espejo de mkParseDatos del frontend): separa
// nombre1/nombre2 y la fecha (por la etiqueta "Fecha:" o por fecha numérica). Lo usa el
// scheduler de auto-generación.
// Inicial mayúscula + espacio tras punto. Delega en la regla COMPARTIDA con el corte (nameLayout),
// para que el mockup y la lámpara salgan con el mismo nombre (ver titleCaseName).
function mkTitleCase(s) {
    return require('./nameLayout').titleCaseName(s);
}
// ¿El valor de fecha es en realidad "sin fecha" (el cliente NO quiere fecha)? -> tratarlo como VACÍO
// para que el mockup NO grabe "Sin Fecha" ni nada en el lugar de la fecha; la casilla queda en blanco.
function esSinFecha(v) {
    const s = String(v || '').toLowerCase().trim();
    if (!s) return false;
    return /sin\s*fecha/.test(s) || /\bno\b[^]*\bfecha\b/.test(s) || /^(ninguna?|n\s*\/\s*a|s\s*\/\s*f|-{1,}|—{1,})$/.test(s);
}
function extractFecha(raw) {
    const labeled = raw.match(/fecha\s*:\s*([^|\n]+)/i);
    if (labeled) {
        const v = labeled[1].trim().replace(/[\s|,]+$/, '').trim();
        return esSinFecha(v) ? '' : v;
    }
    const numeric = raw.match(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/);
    return numeric ? numeric[0] : '';
}
function parseDatos(text) {
    const raw = (text || '').trim();
    const fecha = extractFecha(raw);
    const clean = s => s.replace(/^[\s|,&+]+|[\s|,&+]+$/g, '').trim();
    const rest = raw
        .replace(/fecha\s*:\s*[^|\n]*/ig, ' ')
        .replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, ' ')
        .replace(/nombres?\s*:/ig, ' ').replace(/para\s*:/ig, ' ').replace(/personajes?\s*:/ig, ' ');
    const parts = rest.split(/\s+y\s+|\s*&\s*|\s*\+\s*|\s*\|\s*|,|\n|\s+and\s+/i).map(clean).filter(Boolean);
    return { nombre1: mkTitleCase(parts[0] || ''), nombre2: mkTitleCase(parts[1] || ''), fecha: clean(fecha), personalizacion: raw };
}

// Descarga una imagen (URL pública) a { mimeType, base64 } para la ruta Gemini.
async function fetchImageAsBase64(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo descargar la imagen base (${res.status}).`);
    const mimeType = res.headers.get('content-type') || 'image/webp';
    const buf = Buffer.from(await res.arrayBuffer());
    return { mimeType, base64: buf.toString('base64') };
}

// Devuelve una versión JPEG pública de una imagen del bucket (WhatsApp no soporta WebP).
// Convierte una sola vez y cachea con un path determinista (.wa.jpg) para reusar.
async function ensureJpeg(url) {
    const prefix = `https://storage.googleapis.com/${bucket.name}/`;
    if (typeof url === 'string' && url.startsWith(prefix)) {
        const srcPath = decodeURIComponent(url.slice(prefix.length).split('?')[0]);
        if (/\.jpe?g$/i.test(srcPath)) return url; // ya es jpg
        const jpgPath = srcPath.replace(/\.[a-z0-9]+$/i, '') + '.wa.jpg';
        const jpgFile = bucket.file(jpgPath);
        const [exists] = await jpgFile.exists();
        if (!exists) {
            const [buf] = await bucket.file(srcPath).download();
            const jpg = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
            await jpgFile.save(jpg, { metadata: { contentType: 'image/jpeg' }, public: true, resumable: false });
        }
        return prefix + jpgPath;
    }
    // URL externa: descargar, convertir y subir con nombre nuevo.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status}).`);
    const jpg = await sharp(Buffer.from(await res.arrayBuffer())).jpeg({ quality: 90 }).toBuffer();
    const jpgPath = `${STORAGE_DIR}/wa/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    await bucket.file(jpgPath).save(jpg, { metadata: { contentType: 'image/jpeg' }, public: true, resumable: false });
    return prefix + jpgPath;
}

// ===================== VERIFICACIÓN DE LAYOUT (visión) =====================
// Lee el mockup GENERADO y reporta cómo quedó cada texto grabado, renglón por renglón.
// Esa lectura es la "verdad" de lo que el cliente vio/aprobó: el diseño de corte
// (svg-corte-worker) la usa para reproducir el producto EXACTAMENTE como el mockup —
// incluido el caso "Rosa María" partido por la IA en dos renglones.
// Falla suave: sin llave o con error de visión, todo sigue como antes (el operador revisa a ojo).
// Kill-switch: mockup_config/settings.verifyLayout = false.
const VISION_MODEL = 'gemini-3-flash-preview';
const { decideNameLines, sameLines } = require('./nameLayout');

async function verifyMockupLayout(imageUrl, fields = {}) {
    const apiKey = process.env.GEMINI_API_KEY || API_KEY();
    if (!apiKey) throw new Error('Sin GEMINI_API_KEY ni GOOGLE_AI_IMAGE_KEY para visión.');

    const img = await fetchImageAsBase64(imageUrl);
    const resized = await sharp(Buffer.from(img.base64, 'base64'))
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

    const prompt = `Esta imagen es el mockup de una lámpara personalizada con textos grabados (normalmente dos nombres dentro de un símbolo de infinito y una fecha).
Reporta EXACTAMENTE cómo aparece cada texto grabado, renglón por renglón, tal cual está escrito (respeta acentos y mayúsculas).
Responde SOLO este JSON, sin explicaciones ni markdown:
{"nombreIzquierdo":{"renglones":["..."]},"nombreDerecho":{"renglones":["..."]},"fecha":{"renglones":["..."]}}
Si un texto ocupa dos renglones, pon dos elementos en "renglones" (en orden de arriba a abajo). Si un texto no existe en la imagen, deja su arreglo vacío.`;

    const res = await fetch(`${BASE_URL}/models/${VISION_MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: 'image/webp', data: resized.toString('base64') } }] }],
        }),
    });
    if (!res.ok) throw new Error(`Visión HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text = (((data.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch (_) { throw new Error('Visión no regresó JSON: ' + clean.slice(0, 150)); }

    const izquierdo = ((parsed.nombreIzquierdo || {}).renglones || []).map(s => String(s).trim()).filter(Boolean);
    const derecho = ((parsed.nombreDerecho || {}).renglones || []).map(s => String(s).trim()).filter(Boolean);
    const fecha = ((parsed.fecha || {}).renglones || []).map(s => String(s).trim()).filter(Boolean);

    // Comparación contra lo pedido (los fields ya traen '\n' si la regla decidió 2 renglones).
    const okNombre1 = sameLines(decideNameLines(fields.nombre1 || ''), izquierdo);
    const okNombre2 = sameLines(decideNameLines(fields.nombre2 || ''), derecho);
    const okFecha = sameLines(String(fields.fecha || '').split('\n').map(s => s.trim()).filter(Boolean), fecha);
    return { izquierdo, derecho, fecha, okNombre1, okNombre2, okFecha, ok: okNombre1 && okNombre2 && okFecha };
}

// Verifica el layout de UN preview guardado (por blockId; sin blockId toma el último) y persiste
// el resultado en el entry como `layout` + `layoutVerifiedAt`. Nunca lanza.
async function verifyAndStoreLayout(orderId, blockId) {
    try {
        if (!orderId) return null;
        try {
            const cfg = await db.collection('mockup_config').doc('settings').get();
            if (cfg.exists && cfg.data().verifyLayout === false) return null;   // kill-switch
        } catch (_) {}
        const ref = db.collection('mockup_previews').doc(String(orderId));
        const doc = await ref.get();
        if (!doc.exists) return null;
        const previews = Array.isArray(doc.data().previews) ? doc.data().previews : [];
        const i = blockId ? previews.findIndex(p => p.blockId === blockId) : previews.length - 1;
        if (i < 0 || !previews[i] || !previews[i].imageUrl) return null;
        const v = await verifyMockupLayout(previews[i].imageUrl, previews[i].fields || {});
        previews[i] = { ...previews[i], layout: v, layoutVerifiedAt: new Date().toISOString() };
        await ref.set({ orderId: String(orderId), previews }, { merge: true });
        console.log(`[mockups] layout verificado ${orderId}/${previews[i].blockId}: ok=${v.ok} izq=${JSON.stringify(v.izquierdo)} der=${JSON.stringify(v.derecho)} fecha=${JSON.stringify(v.fecha)}`);
        return v;
    } catch (e) {
        console.warn('[mockups] verifyAndStoreLayout falló para', orderId, ':', e.message);
        return null;
    }
}

module.exports = {
    generateImage, saveToGallery, getGallery, deleteFromGallery, saveBatch, getBatch,
    listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate,
    listDesigns, createDesign, updateDesign, deleteDesign, fetchOwnImageAsBase64,
    uploadTemplateBaseImage, uploadPublicImage, buildPromptFromTemplate, fetchImageAsBase64, ensureJpeg, parseDatos,
    verifyMockupLayout, verifyAndStoreLayout,
};
