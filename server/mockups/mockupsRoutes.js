const express = require('express');
const router = express.Router();
const { generateImage, MODELS } = require('./mockupsService');

function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(err => {
            console.error('[MOCKUPS ERROR]', err.message);
            res.status(err.status || 500).json({
                success: false,
                error: err.message || 'Error interno del servidor',
            });
        });
    };
}

// GET /api/mockups/models — Lista de modelos disponibles con precios
router.get('/models', (req, res) => {
    const models = Object.entries(MODELS).map(([key, m]) => ({
        key,
        name: m.name,
        type: m.type,
        costPerImage: m.costPerImage,
        inputPer1M: m.inputPer1M || null,
        speed: m.speed,
    }));
    res.json({ success: true, models });
});

// POST /api/mockups/generate — Generar imagen
router.post('/generate', asyncHandler(async (req, res) => {
    const { prompt, model, aspectRatio, sampleCount, image } = req.body;

    if (!prompt || !prompt.trim()) {
        return res.status(400).json({ success: false, error: 'Se requiere un prompt.' });
    }
    if (!model) {
        return res.status(400).json({ success: false, error: 'Se requiere seleccionar un modelo.' });
    }
    if (!MODELS[model]) {
        return res.status(400).json({ success: false, error: `Modelo no soportado: ${model}` });
    }

    // image: { mimeType, base64 } o null
    const imageData = image?.base64 ? { mimeType: image.mimeType, base64: image.base64 } : null;

    const result = await generateImage(model, prompt.trim(), aspectRatio || '1:1', sampleCount || 1, imageData);
    res.json({ success: true, ...result });
}));

module.exports = router;
