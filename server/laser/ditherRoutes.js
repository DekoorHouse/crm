'use strict';
const express = require('express');
const multer = require('multer');
const { createSession, processSession, finalizeSession, deleteSession } = require('./ditherService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// POST /api/laser/dither/upload — Upload image, create session, return initial preview
router.post('/dither/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image file' });
        const opts = {
            dpi: parseInt(req.body.dpi) || 1000,
            lineSpacing: parseInt(req.body.lineSpacing) || 1,
            algorithm: req.body.algorithm || 'atkinson',
        };
        // SVG bbox (optional)
        if (req.body.bboxMmX != null) {
            opts.bboxMmX = parseFloat(req.body.bboxMmX);
            opts.bboxMmY = parseFloat(req.body.bboxMmY);
            opts.bboxMmW = parseFloat(req.body.bboxMmW);
            opts.bboxMmH = parseFloat(req.body.bboxMmH);
        }
        const result = await createSession(req.file.buffer, req.file.originalname, opts);
        res.json(result);
    } catch (err) {
        console.error('Dither upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/laser/dither/process — Re-process with new parameters (preview)
router.post('/dither/process', express.json(), async (req, res) => {
    try {
        const { sessionId, algorithm, brightness, contrast, gamma, invert, clahe, unsharp, threshold } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
        const result = await processSession(sessionId, {
            algorithm: algorithm || 'atkinson',
            brightness: parseInt(brightness) || 0,
            contrast: parseInt(contrast) || 0,
            gamma: parseFloat(gamma) || 1.0,
            invert: !!invert,
            clahe: !!clahe,
            unsharp: !!unsharp,
            threshold: parseInt(threshold) || 128,
        });
        res.json(result);
    } catch (err) {
        if (err.message === 'Session not found') return res.status(404).json({ error: err.message });
        console.error('Dither process error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/laser/dither/finalize — Get 1-bit packed bitmap
router.post('/dither/finalize', express.json(), async (req, res) => {
    try {
        const { sessionId, algorithm, brightness, contrast, gamma, invert, clahe, unsharp, threshold } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
        const result = await finalizeSession(sessionId, {
            algorithm: algorithm || 'atkinson',
            brightness: parseInt(brightness) || 0,
            contrast: parseInt(contrast) || 0,
            gamma: parseFloat(gamma) || 1.0,
            invert: !!invert,
            clahe: !!clahe,
            unsharp: !!unsharp,
            threshold: parseInt(threshold) || 128,
        });
        res.set({
            'Content-Type': 'application/octet-stream',
            'X-Bitmap-Width': result.width,
            'X-Bitmap-Height': result.height,
            'X-Offset-X': result.offsetX,
            'X-Offset-Y': result.offsetY,
        });
        res.send(result.bitmap);
    } catch (err) {
        if (err.message === 'Session not found') return res.status(404).json({ error: err.message });
        console.error('Dither finalize error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/laser/dither/session/:id — Cleanup
router.delete('/dither/session/:id', (req, res) => {
    deleteSession(req.params.id);
    res.json({ ok: true });
});

module.exports = router;
