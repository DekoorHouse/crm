const path = require('path');
const fs = require('fs');
const { generateGeminiResponse } = require('../services');
const { db } = require('../config');

// --- Configuracion ---
const PHOTOS_FOLDER = process.env.FBG_PHOTOS_FOLDER || 'C:/Users/chris/Pictures/IA AQ/Grupo';
const GROUP_NAME = process.env.FBG_GROUP_NAME || 'Mujer-ON';
const PAGE_NAME = process.env.FBG_PAGE_NAME || 'AQ Decoraciones';
const LOG_COLLECTION = 'fb_group_post_log';

const CAPTION_PROMPT = `Eres el community manager de AQ Decoraciones, una tienda mexicana de regalos personalizados y decoracion para eventos y fiestas.
Analiza esta imagen de producto y genera un mensaje para publicar en un grupo de Facebook de mujeres emprendedoras.

Reglas:
- Escribe en espanol mexicano, tono amigable, calido y emprendedor
- Usa emojis relevantes (5-8 emojis)
- Maximo 300 caracteres
- Incluye un llamado a la accion directo (ej: "Visita nuestra pagina", "Envianos mensaje", "Pregunta por precios")
- La marca se escribe "AQ Decoraciones"
- NO incluyas hashtags
- Menciona que los productos son personalizados/personalizables si aplica
- Si no identificas el producto, genera un mensaje generico sobre regalos personalizados de AQ Decoraciones

Responde SOLO con el mensaje, sin explicaciones adicionales.`;

// --- Gestion de fotos locales ---

function getAvailablePhotos() {
    if (!fs.existsSync(PHOTOS_FOLDER)) return [];
    return fs.readdirSync(PHOTOS_FOLDER)
        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .map(f => ({
            filename: f,
            fullPath: path.join(PHOTOS_FOLDER, f),
            size: fs.statSync(path.join(PHOTOS_FOLDER, f)).size
        }));
}

async function pickUnpostedLocalPhoto() {
    const photos = getAvailablePhotos();
    if (!photos.length) return null;

    const logSnapshot = await db.collection(LOG_COLLECTION)
        .where('status', '==', 'success')
        .select('photoFilename')
        .get();
    const postedFiles = new Set(logSnapshot.docs.map(d => d.data().photoFilename));
    const unposted = photos.filter(p => !postedFiles.has(p.filename));
    return unposted.length ? unposted[0] : null;
}

async function generateFbGroupCaption(imagePath) {
    const imageBuffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    const base64Image = imageBuffer.toString('base64');
    const imageParts = [{ inlineData: { mimeType: mimeMap[ext] || 'image/jpeg', data: base64Image } }];

    const result = await generateGeminiResponse(CAPTION_PROMPT, imageParts);
    let caption = result.text.replace(/^["']|["']$/g, '').trim();
    console.log(`[FB-GROUP] Caption generado (${result.inputTokens} in / ${result.outputTokens} out): ${caption}`);
    return caption;
}

async function previewFbGroupPost() {
    const photo = await pickUnpostedLocalPhoto();
    if (!photo) return { message: 'No hay fotos disponibles. Agrega fotos a la carpeta.' };

    const caption = await generateFbGroupCaption(photo.fullPath);
    const imageBuffer = fs.readFileSync(photo.fullPath);
    const ext = path.extname(photo.fullPath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    const base64Image = imageBuffer.toString('base64');

    return {
        filename: photo.filename,
        caption,
        imagePreview: `data:${mimeMap[ext] || 'image/jpeg'};base64,${base64Image}`,
        totalPhotos: getAvailablePhotos().length
    };
}

async function markPhotoAsPublished(filename, caption) {
    const logEntry = {
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'success',
        groupName: GROUP_NAME,
        pageName: PAGE_NAME,
        photoFilename: filename,
        caption,
        source: 'local-script'
    };
    await saveLog(logEntry);

    const srcPath = path.join(PHOTOS_FOLDER, filename);
    const publishedDir = path.join(PHOTOS_FOLDER, 'publicados');
    if (!fs.existsSync(publishedDir)) fs.mkdirSync(publishedDir, { recursive: true });
    if (fs.existsSync(srcPath)) fs.renameSync(srcPath, path.join(publishedDir, filename));
    return logEntry;
}

async function saveLog(entry) {
    try {
        await db.collection(LOG_COLLECTION).add(entry);
    } catch (err) {
        console.error('[FB-GROUP] Error guardando log:', err.message);
    }
}

async function getFbGroupLog(limit = 20) {
    const snapshot = await db.collection(LOG_COLLECTION)
        .orderBy('startedAt', 'desc')
        .limit(limit)
        .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function getFbGroupStatus() {
    const photos = getAvailablePhotos();
    return {
        photosFolder: PHOTOS_FOLDER,
        photosAvailable: photos.length,
        groupName: GROUP_NAME,
        pageName: PAGE_NAME
    };
}

module.exports = {
    getAvailablePhotos,
    previewFbGroupPost,
    markPhotoAsPublished,
    getFbGroupLog,
    getFbGroupStatus
};
