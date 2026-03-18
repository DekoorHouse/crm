const express = require('express');
const router = express.Router();
const multer = require('multer');
const { fetchAvailablePhotos, uploadPhoto, deletePhoto } = require('./photoService');
const { verifyPageToken } = require('./facebookPostService');
const { executeAutoPost, previewNextPost, getLog, getSchedulerStatus } = require('./autoPostScheduler');

// Multer para subir archivos en memoria
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Solo se permiten imagenes.'));
    }
});

// --- Fotos (Firebase Storage) ---

// Listar fotos disponibles
router.get('/photos', async (req, res) => {
    try {
        const photos = await fetchAvailablePhotos();
        res.json({ photos, count: photos.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Subir foto(s)
router.post('/photos/upload', upload.array('photos', 20), async (req, res) => {
    try {
        if (!req.files?.length) return res.status(400).json({ error: 'No se enviaron fotos.' });

        const uploaded = [];
        for (const file of req.files) {
            const path = await uploadPhoto(file.buffer, file.originalname, file.mimetype);
            uploaded.push({ filename: file.originalname, path });
        }

        res.json({ uploaded, count: uploaded.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Eliminar foto
router.delete('/photos/:filename', async (req, res) => {
    try {
        await deletePhoto(`autopost/${req.params.filename}`);
        res.json({ deleted: req.params.filename });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Facebook ---

router.get('/facebook/verify', async (req, res) => {
    try {
        const result = await verifyPageToken();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Auto Post ---

router.get('/status', (req, res) => {
    res.json(getSchedulerStatus());
});

router.get('/log', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const log = await getLog(limit);
        res.json({ log });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/preview', async (req, res) => {
    try {
        const preview = await previewNextPost();
        res.json(preview);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/trigger', async (req, res) => {
    try {
        const result = await executeAutoPost();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
