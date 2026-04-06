const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
    executeWhatsAppGroupPost,
    previewWhatsAppPost,
    getWhatsAppLog,
    getWhatsAppStatus,
    getAvailablePhotos,
    closeBrowser,
    markPhotoAsPublished
} = require('./whatsappGroupService');

const PHOTOS_FOLDER = process.env.WA_PHOTOS_FOLDER || 'C:/Users/chris/Pictures/IA Dekoor/Grupo';

// Multer para guardar fotos directo a la carpeta local
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(PHOTOS_FOLDER)) fs.mkdirSync(PHOTOS_FOLDER, { recursive: true });
        cb(null, PHOTOS_FOLDER);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
        cb(null, name);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Solo se permiten imagenes.'));
    }
});

// Estado del servicio
router.get('/status', (req, res) => {
    res.json(getWhatsAppStatus());
});

// Listar fotos disponibles en la carpeta local
router.get('/photos', (req, res) => {
    try {
        const photos = getAvailablePhotos();
        res.json({ photos, count: photos.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Subir fotos a la carpeta local
router.post('/photos/upload', upload.array('photos', 20), (req, res) => {
    try {
        if (!req.files?.length) return res.status(400).json({ error: 'No se enviaron fotos.' });
        const uploaded = req.files.map(f => ({ filename: f.filename, size: f.size }));
        res.json({ uploaded, count: uploaded.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Eliminar foto de la carpeta
router.delete('/photos/:filename', (req, res) => {
    try {
        const filePath = path.join(PHOTOS_FOLDER, req.params.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Foto no encontrada.' });
        fs.unlinkSync(filePath);
        res.json({ deleted: req.params.filename });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Servir imagen para thumbnail
router.get('/photos/file/:filename', (req, res) => {
    const filePath = path.join(PHOTOS_FOLDER, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('No encontrada');
    res.sendFile(filePath);
});

// Preview del proximo post (genera caption sin enviar)
router.post('/preview', async (req, res) => {
    try {
        const preview = await previewWhatsAppPost();
        res.json(preview);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Disparar publicacion manualmente (espera resultado para mostrarlo en UI)
router.post('/trigger', async (req, res) => {
    try {
        const result = await executeWhatsAppGroupPost();
        if (result.status === 'success') {
            res.json({ message: `Publicado en ${result.groupName}!`, status: 'success', photo: result.photoFilename });
        } else {
            res.json({ message: `Error: ${result.error || 'Fallo desconocido'}`, status: result.status });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Disparar y esperar resultado
router.post('/trigger-sync', async (req, res) => {
    try {
        const result = await executeWhatsAppGroupPost();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Historial de publicaciones
router.get('/log', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const log = await getWhatsAppLog(limit);
        res.json({ log });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generar caption para una imagen enviada como base64 (llamado desde script local)
router.post('/generate-caption', async (req, res) => {
    try {
        const { image, mimeType } = req.body;
        if (!image) return res.status(400).json({ error: 'image (base64) es requerido' });
        const { generateGeminiResponse } = require('../services');
        const CAPTION_PROMPT = `Eres el community manager de Dekoor, una tienda mexicana de decoracion y hogar con grabado laser personalizado.
Analiza esta imagen de producto y genera un mensaje para publicar en un grupo de WhatsApp de clientes.

Reglas:
- Escribe en espanol mexicano, tono amigable, calido y cercano (como hablando con amigos)
- Usa emojis relevantes (5-8 emojis)
- Maximo 250 caracteres
- Incluye un llamado a la accion directo (ej: "Escribenos para personalizar el tuyo", "Pide el tuyo por inbox", "Pregunta por precios")
- La marca SIEMPRE se escribe "Dekoor" (con doble o, k minuscula)
- NO incluyas hashtags
- NO uses formato de redes sociales, esto es WhatsApp - se casual y directo
- Si el producto tiene grabado laser, mencionalo como ventaja
- Si no identificas el producto, genera un mensaje generico sobre novedades de Dekoor

Responde SOLO con el mensaje, sin explicaciones adicionales.`;
        const imageParts = [{ inlineData: { mimeType: mimeType || 'image/jpeg', data: image } }];
        const result = await generateGeminiResponse(CAPTION_PROMPT, imageParts);
        const caption = result.text.replace(/^["']|["']$/g, '').trim();
        res.json({ caption });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Marcar foto como publicada (llamado desde script local)
router.post('/mark-published', async (req, res) => {
    try {
        const { filename, caption } = req.body;
        if (!filename) return res.status(400).json({ error: 'filename es requerido' });
        const result = await markPhotoAsPublished(filename, caption || '');
        res.json({ status: 'success', result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cerrar browser manualmente
router.post('/close-browser', async (req, res) => {
    try {
        await closeBrowser();
        res.json({ message: 'Browser cerrado.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
