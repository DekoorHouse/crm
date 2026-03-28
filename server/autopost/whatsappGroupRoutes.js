const express = require('express');
const router = express.Router();
const {
    executeWhatsAppGroupPost,
    previewWhatsAppPost,
    getWhatsAppLog,
    getWhatsAppStatus,
    getAvailablePhotos,
    closeBrowser
} = require('./whatsappGroupService');

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

// Preview del proximo post (genera caption sin enviar)
router.post('/preview', async (req, res) => {
    try {
        const preview = await previewWhatsAppPost();
        res.json(preview);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Disparar publicacion manualmente
router.post('/trigger', async (req, res) => {
    try {
        res.json({ message: 'Publicacion iniciada. El navegador se abrira en tu computadora...' });
        // Ejecutar en background para no bloquear la respuesta
        executeWhatsAppGroupPost().then(result => {
            console.log('[WA-GROUP] Resultado:', result.status);
        }).catch(err => {
            console.error('[WA-GROUP] Error en trigger:', err.message);
        });
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
