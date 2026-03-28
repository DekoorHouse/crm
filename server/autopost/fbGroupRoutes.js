const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
    getAvailablePhotos,
    previewFbGroupPost,
    markPhotoAsPublished,
    getFbGroupLog,
    getFbGroupStatus
} = require('./fbGroupService');

const PHOTOS_FOLDER = process.env.FBG_PHOTOS_FOLDER || 'C:/Users/chris/Pictures/IA AQ/Grupo';

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

router.get('/status', (req, res) => {
    res.json(getFbGroupStatus());
});

router.get('/photos', (req, res) => {
    try {
        const photos = getAvailablePhotos();
        res.json({ photos, count: photos.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/photos/upload', upload.array('photos', 20), (req, res) => {
    try {
        if (!req.files?.length) return res.status(400).json({ error: 'No se enviaron fotos.' });
        const uploaded = req.files.map(f => ({ filename: f.filename, size: f.size }));
        res.json({ uploaded, count: uploaded.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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

router.get('/photos/file/:filename', (req, res) => {
    const filePath = path.join(PHOTOS_FOLDER, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('No encontrada');
    res.sendFile(filePath);
});

router.post('/preview', async (req, res) => {
    try {
        const preview = await previewFbGroupPost();
        res.json(preview);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generar caption para imagen enviada como base64 (desde script local)
router.post('/generate-caption', async (req, res) => {
    try {
        const { image, mimeType } = req.body;
        if (!image) return res.status(400).json({ error: 'image (base64) es requerido' });
        const { generateGeminiResponse } = require('../services');
        const PROMPT = `Eres el community manager de AQ Decoraciones, una tienda mexicana de regalos personalizados y decoracion para eventos y fiestas.
Analiza esta imagen de producto y genera un mensaje para publicar en un grupo de Facebook de mujeres emprendedoras.

Reglas:
- Escribe en espanol mexicano, tono amigable, calido y emprendedor
- Usa emojis relevantes (5-8 emojis)
- Maximo 300 caracteres
- Incluye un llamado a la accion directo
- La marca se escribe "AQ Decoraciones"
- NO incluyas hashtags
- Menciona que los productos son personalizados si aplica

Responde SOLO con el mensaje, sin explicaciones adicionales.`;
        const imageParts = [{ inlineData: { mimeType: mimeType || 'image/jpeg', data: image } }];
        const result = await generateGeminiResponse(PROMPT, imageParts);
        const caption = result.text.replace(/^["']|["']$/g, '').trim();
        res.json({ caption });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Disparar publicacion (placeholder - requiere script local con Chrome)
router.post('/trigger', async (req, res) => {
    res.json({ status: 'info', message: 'Ejecuta en tu PC: node scripts/fb-group-publish.js' });
});

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

router.get('/log', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const log = await getFbGroupLog(limit);
        res.json({ log });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
