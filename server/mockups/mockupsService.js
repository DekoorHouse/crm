const fetch = require('node-fetch');
const sharp = require('sharp');
const { db, bucket } = require('../config');

const API_KEY = () => process.env.GOOGLE_AI_IMAGE_KEY;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_ID = 'gemini-3-pro-image-preview';
const COST_PER_IMAGE = 0.134;   // 2K resolution
const INPUT_PER_1M = 2.00;
const COLLECTION = 'mockups_gallery';
const STORAGE_DIR = 'mockups';
const THUMB_WIDTH = 400;

// ===================== IMAGE GENERATION =====================

async function generateImage(prompt, aspectRatio = '1:1', refImages = [], resolution = '2K') {
    const apiKey = API_KEY();
    if (!apiKey) throw new Error('GOOGLE_AI_IMAGE_KEY no está configurada.');

    const url = `${BASE_URL}/models/${MODEL_ID}:generateContent?key=${apiKey}`;

    const parts = [{ text: prompt }];
    for (const img of refImages) {
        // Resize a 1024px max para reducir tokens de entrada
        const resized = await sharp(Buffer.from(img.base64, 'base64'))
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
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
                imageConfig: { aspectRatio, imageSize: resolution },
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

async function createTemplate({ nombre, baseImagePath, baseImageUrl, promptTemplate, productMatch, aspectRatio }) {
    const doc = {
        nombre: (nombre || '').toString().trim() || 'Sin nombre',
        baseImagePath: baseImagePath || null,
        baseImageUrl: baseImageUrl || null,
        promptTemplate: (promptTemplate || '').toString(),
        productMatch: Array.isArray(productMatch) ? productMatch : [],
        aspectRatio: aspectRatio || '1:1',
        createdAt: new Date().toISOString(),
    };
    const ref = await db.collection(TEMPLATES_COLLECTION).add(doc);
    return { id: ref.id, ...doc };
}

async function updateTemplate(id, patch = {}) {
    const allowed = {};
    for (const k of ['nombre', 'baseImagePath', 'baseImageUrl', 'promptTemplate', 'productMatch', 'aspectRatio']) {
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

// Sube la foto base a Storage como webp PÚBLICO (WaveSpeed y WhatsApp la
// descargan por URL, así que NO puede ser una URL firmada/privada).
async function uploadTemplateBaseImage(buffer) {
    const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const webp = await sharp(buffer)
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer();
    const baseImagePath = `${STORAGE_DIR}/templates/${id}_base.webp`;
    const file = bucket.file(baseImagePath);
    await file.save(webp, { metadata: { contentType: 'image/webp' }, public: true, resumable: false });
    const baseImageUrl = `https://storage.googleapis.com/${bucket.name}/${baseImagePath}`;
    return { baseImagePath, baseImageUrl };
}

// Reemplaza los placeholders del prompt con los campos del pedido.
// Los placeholders no provistos se eliminan para no ensuciar la instrucción.
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPromptFromTemplate(promptTemplate, fields = {}) {
    let out = String(promptTemplate || '');
    let hasMultiline = false;
    for (const [k, v] of Object.entries(fields)) {
        let val = (v === undefined || v === null) ? '' : String(v);
        // Quita separadores sueltos de los bordes (barra "|", comas, &, +) pero CONSERVA
        // los saltos de línea internos (ej. dos fechas apiladas que quiere el cliente).
        val = val.replace(/^[\s|,&+]+|[\s|,&+]+$/g, '').trim();
        if (val.includes('\n')) hasMultiline = true;
        out = out.replace(new RegExp('\\{' + escapeRegExp(k) + '\\}', 'g'), val);
    }
    out = out.replace(/\{[a-zA-Z0-9_]+\}/g, '').replace(/[ \t]{2,}/g, ' ').trim();
    // Si algún campo trae varios renglones (p. ej. dos fechas), instruir a la IA para que
    // los grabe apilados (uno debajo del otro), no en una sola línea.
    if (hasMultiline) {
        out += '\nIMPORTANTE: algún texto (por ejemplo la fecha) viene en varios renglones; grábalo en líneas separadas, una debajo de la otra, respetando los saltos de línea.';
    }
    return out;
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

module.exports = {
    generateImage, saveToGallery, getGallery, deleteFromGallery, saveBatch, getBatch,
    listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate,
    uploadTemplateBaseImage, buildPromptFromTemplate, fetchImageAsBase64, ensureJpeg,
};
