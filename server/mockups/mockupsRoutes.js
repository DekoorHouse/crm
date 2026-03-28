const express = require('express');
const router = express.Router();
const svc = require('./mockupsService');

function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(err => {
            console.error('[MOCKUPS ERROR]', err.message);
            res.status(err.status || 500).json({ success: false, error: err.message || 'Error interno del servidor' });
        });
    };
}

// POST /api/mockups/generate — Generar imagen y guardar en galería
router.post('/generate', asyncHandler(async (req, res) => {
    const { prompt, aspectRatio, images: refImages } = req.body;

    if (!prompt || !prompt.trim()) {
        return res.status(400).json({ success: false, error: 'Se requiere un prompt.' });
    }

    // refImages: array de { mimeType, base64 }
    const validImages = (refImages || []).filter(i => i?.base64);
    const result = await svc.generateImage(prompt.trim(), aspectRatio || '1:1', validImages);

    // Guardar en Firebase Storage + Firestore
    const saved = await svc.saveToGallery(prompt.trim(), aspectRatio || '1:1', result.images, result.usage, result.cost);

    res.json({
        success: true,
        images: saved.map(s => ({ id: s.id, fullUrl: s.fullUrl, thumbUrl: s.thumbUrl })),
        usage: result.usage,
        cost: result.cost,
    });
}));

// GET /api/mockups/gallery — Listar galería
router.get('/gallery', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const items = await svc.getGallery(limit);
    res.json({ success: true, items });
}));

// DELETE /api/mockups/gallery/:id — Eliminar imagen
router.delete('/gallery/:id', asyncHandler(async (req, res) => {
    await svc.deleteFromGallery(req.params.id);
    res.json({ success: true });
}));

module.exports = router;
