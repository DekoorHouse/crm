// Importa Express y las funciones del handler
const express = require('express');
const webWhatsappHandler = require('./webWhatsappHandler'); // Asegúrate que el nombre coincida

const router = express.Router();

// --- Rutas de la API para WhatsApp Web ---

/**
 * POST /api/web/connect
 * Inicia el proceso de conexión con WhatsApp Web.
 * Intenta inicializar el cliente de Baileys, lo que puede generar un QR.
 */
router.post('/connect', async (req, res) => {
    console.log('[API /web/connect] Solicitud para iniciar conexión...');
    try {
        // Llama a la función que inicializa Baileys (puede ser async)
        await webWhatsappHandler.initializeWhatsAppWebClient();
        // Devuelve el estado actual después de intentar inicializar
        const status = webWhatsappHandler.getClientStatus();
        const qr = webWhatsappHandler.getQrCode();
        console.log(`[API /web/connect] Estado después de init: ${status}`);
        res.status(200).json({ success: true, status: status, qr: qr });
    } catch (error) {
        console.error('[API /web/connect] Error al iniciar cliente:', error);
        res.status(500).json({ success: false, message: 'Error al iniciar la conexión con WhatsApp Web.', status: 'disconnected' });
    }
});

/**
 * GET /api/web/status
 * Devuelve el estado actual de la conexión de WhatsApp Web.
 * Estados posibles: 'disconnected', 'connecting', 'connected', 'requires_scan'
 */
router.get('/status', (req, res) => {
    const status = webWhatsappHandler.getClientStatus();
    // console.log(`[API /web/status] Estado actual: ${status}`); // Loguear puede ser útil para debugging
    res.status(200).json({ success: true, status: status });
});

/**
 * GET /api/web/qr
 * Devuelve el código QR actual en formato base64 si está disponible.
 * Solo hay QR cuando el estado es 'requires_scan'.
 */
router.get('/qr', (req, res) => {
    const qr = webWhatsappHandler.getQrCode();
    const status = webWhatsappHandler.getClientStatus();
    if (status === 'requires_scan' && qr) {
        // console.log('[API /web/qr] Enviando código QR.'); // Loguear puede ser útil
        res.status(200).json({ success: true, qr: qr, status: status });
    } else {
        // console.log(`[API /web/qr] No hay QR disponible. Estado: ${status}`);
        res.status(200).json({ success: true, qr: null, status: status }); // Devuelve null si no hay QR
    }
});

/**
 * POST /api/web/send
 * Envía un mensaje de texto a través de la conexión de WhatsApp Web activa.
 * Body: { "recipientId": "xxxxxxxxxx", "text": "Mensaje de prueba" }
 */
router.post('/send', async (req, res) => {
    const { recipientId, text } = req.body;
    const status = webWhatsappHandler.getClientStatus();

    console.log(`[API /web/send] Solicitud para enviar a ${recipientId}`);

    // Validación básica
    if (status !== 'connected') {
        console.warn(`[API /web/send] Intento de envío fallido. Estado: ${status}`);
        return res.status(400).json({ success: false, message: 'El cliente de WhatsApp Web no está conectado.' });
    }
    if (!recipientId || !text) {
        return res.status(400).json({ success: false, message: 'Faltan recipientId o text en la solicitud.' });
    }

    try {
        // Llama a la función del handler para enviar el mensaje
        const result = await webWhatsappHandler.sendWebWhatsAppMessage(recipientId, text);
        console.log(`[API /web/send] Mensaje enviado a ${recipientId} via Web.`);
        res.status(200).json({ success: true, message: 'Mensaje enviado.', details: result });
    } catch (error) {
        console.error(`[API /web/send] Error al enviar mensaje a ${recipientId}:`, error);
        res.status(500).json({ success: false, message: error.message || 'Error interno al enviar el mensaje.' });
    }
});

/**
 * POST /api/web/disconnect
 * Cierra la sesión activa de WhatsApp Web y elimina los archivos de sesión guardados.
 */
router.post('/disconnect', async (req, res) => {
    console.log('[API /web/disconnect] Solicitud para desconectar...');
    try {
        await webWhatsappHandler.disconnectWhatsAppWeb();
        console.log('[API /web/disconnect] Desconexión completada.');
        res.status(200).json({ success: true, message: 'Desconectado correctamente.', status: 'disconnected' });
    } catch (error) {
        console.error('[API /web/disconnect] Error al desconectar:', error);
        res.status(500).json({ success: false, message: 'Error al intentar desconectar.', status: webWhatsappHandler.getClientStatus() });
    }
});

module.exports = router; // Exporta el router para usarlo en index.js
