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

module.exports = { generateImage, saveToGallery, getGallery, deleteFromGallery, saveBatch, getBatch };
