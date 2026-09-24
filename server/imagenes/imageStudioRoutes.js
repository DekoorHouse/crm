'use strict';
const express = require('express');
const multer = require('multer');
const { requireApiUser } = require('../apiAuth');
const service = require('./imageStudioService');
const qwenPod = require('./qwenPod');
const router = express.Router();
router.use(requireApiUser);
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 4, fileSize: 6 * 1024 * 1024, fields: 8, fieldSize: 30000 } });
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.get('/models', handle(async (req, res) => res.json({ success: true, ...await service.getModels() })));
router.post('/models', handle(async (req, res) => res.json({ success: true, ...await service.linkModel(req.body.model, req.body.action) })));
router.get('/qwen', handle(async (req, res) => res.json({ success: true, qwen: await qwenPod.getStatus() })));
router.post('/qwen/power', handle(async (req, res) => {
    if (!['start', 'stop'].includes(req.body.action)) return res.status(400).json({ success: false, error: 'Acción no válida.' });
    if (req.body.action === 'start') await qwenPod.startPod(`manual: ${req.apiAuth?.email || req.apiAuth?.uid || 'usuario'}`);
    else await qwenPod.stopPod(`manual: ${req.apiAuth?.email || req.apiAuth?.uid || 'usuario'}`);
    res.json({ success: true, qwen: await qwenPod.getStatus() });
}));
router.get('/generations', handle(async (req, res) => res.json({ success: true, ...await service.getGallery(req.query.before) })));
router.get('/generations/:id', handle(async (req, res) => res.json({ success: true, job: await service.getJob(req.params.id) })));
router.post('/generations', upload.array('references', 4), handle(async (req, res) => {
    res.status(202).json({ success: true, job: await service.createGeneration(req.body, req.files || [], req.apiAuth) });
}));
router.use((err, req, res, next) => {
    const uploadError = err instanceof multer.MulterError;
    if (!err.status && !uploadError) console.warn('[IMAGENES] Error de API:', err.code || 'internal_error');
    res.status(uploadError ? 400 : err.status || 500).json({ success: false, error: uploadError
        ? 'Sube hasta 4 referencias PNG, JPG o WebP de máximo 6 MB cada una.'
        : err.status ? err.message : 'No se pudo completar la operación. Intenta de nuevo.' });
});
module.exports = router;
