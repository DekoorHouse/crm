const express = require('express');
const router = express.Router();
const { getAuthUrl, handleAuthCallback, getStoredTokenInfo, listAlbums } = require('./googlePhotosService');
const { verifyPageToken } = require('./facebookPostService');
const { executeAutoPost, previewNextPost, getLog, getSchedulerStatus } = require('./autoPostScheduler');

// --- Google Photos OAuth2 ---

// Paso 1: Obtener URL de autorizacion
router.get('/google/auth', (req, res) => {
    try {
        const url = getAuthUrl();
        res.json({ authUrl: url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Paso 2: Callback de OAuth2
router.get('/google/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.status(400).json({ error: 'Falta el parametro code.' });

        await handleAuthCallback(code);
        res.send('<html><body><h2>Google Photos autorizado correctamente!</h2><p>Puedes cerrar esta ventana.</p><script>setTimeout(()=>window.close(),3000)</script></body></html>');
    } catch (error) {
        console.error('[AUTOPOST] Error en OAuth callback:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Listar albumes de Google Photos
router.get('/google/albums', async (req, res) => {
    try {
        const albums = await listAlbums();
        res.json({ albums });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Facebook ---

// Verificar token de Facebook
router.get('/facebook/verify', async (req, res) => {
    try {
        const result = await verifyPageToken();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Debug: ver tokens almacenados y probar refresh manual
router.get('/debug/tokens', async (req, res) => {
    try {
        const info = await getStoredTokenInfo();

        // Intentar refresh manual del token
        const { db } = require('../config');
        const doc = await db.doc('crm_settings/autopost_google').get();
        const data = doc.data();

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_PHOTOS_CLIENT_ID,
                client_secret: process.env.GOOGLE_PHOTOS_CLIENT_SECRET,
                refresh_token: data.refreshToken,
                grant_type: 'refresh_token'
            })
        });
        const tokenData = await tokenResponse.json();

        // Probar el token contra la API de Photos
        let photosTest = 'no intentado';
        if (tokenData.access_token) {
            const photosResponse = await fetch('https://photoslibrary.googleapis.com/v1/albums?pageSize=1', {
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            });
            photosTest = photosResponse.ok
                ? 'OK - ' + (await photosResponse.text()).substring(0, 200)
                : 'ERROR ' + photosResponse.status + ' - ' + await photosResponse.text();
        }

        res.json({
            stored: info,
            refreshResult: {
                scope: tokenData.scope,
                hasAccessToken: !!tokenData.access_token,
                error: tokenData.error,
                errorDescription: tokenData.error_description
            },
            photosApiTest: photosTest
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Auto Post ---

// Estado del scheduler
router.get('/status', (req, res) => {
    res.json(getSchedulerStatus());
});

// Historial de publicaciones
router.get('/log', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const log = await getLog(limit);
        res.json({ log });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Preview: ver que se publicaria sin publicar
router.post('/preview', async (req, res) => {
    try {
        const preview = await previewNextPost();
        res.json(preview);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Publicar ahora manualmente
router.post('/trigger', async (req, res) => {
    try {
        const result = await executeAutoPost();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
