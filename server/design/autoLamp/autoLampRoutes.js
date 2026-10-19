'use strict';
// /api/auto-lamp/:dh — el sistema arma la lámpara de personaje de un pedido como proyecto del editor v2.
// POST la empieza (tarda ~1 min: elegir imagen, grabado con IA, armado); GET consulta cómo va.
const express = require('express');
const { requireApiUser } = require('../../apiAuth');
const service = require('./autoLampService');
const router = express.Router();
router.use(requireApiUser);

const dhOf = value => { const n = parseInt(String(value).replace(/\D/g, ''), 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const running = new Set();

router.post('/:dh', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Ya se está generando esta lámpara.' });
    running.add(dh);
    // Responde de inmediato y trabaja en segundo plano; el avance queda en el pedido (autoLamp).
    // BETA (?beta=1, desde Pendientes de Diseño): la IA lee el pedido y el chat y decide el diseño;
    // note = indicación del equipo al regenerar.
    const beta = req.query.beta === '1' || req.body?.beta === true;
    service.generate(dh, { beta, note: beta ? String(req.body?.note || '').trim() : '' }).catch(error => console.warn(`[AUTO-LAMP] DH${dh}:`, error.message)).finally(() => running.delete(dh));
    res.status(202).json({ success: true, status: 'working' });
});

router.get('/:dh', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try {
        const state = await service.status(dh);
        res.json({ success: true, autoLamp: state && { ...state, running: running.has(dh), updatedAt: state.updatedAt?.toDate?.() || null } });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.status ? error.message : 'No se pudo consultar el pedido.' }); }
});

// Aprobación humana: el único paso que sube el diseño a Drive (body.svg = versión corregida en el editor).
router.post('/:dh/approve', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Todavía se está generando este diseño.' });
    try { res.json({ success: true, ...(await service.approve(dh, { svg: req.body?.fromEditor ? 'editor' : null, actor: req.apiAuth })) }); }
    catch (error) { console.warn(`[AUTO-LAMP] aprobar DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo subir a Drive.' }); }
});

// Manda el previo al CLIENTE (solo cuando una persona aprieta el botón) y deja el chat esperando su
// respuesta (designApproval). El envío reutiliza /api/contacts/:id/messages con la sesión de quien aprieta.
router.post('/:dh/send-client', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Todavía se está generando este diseño.' });
    const auth = {};
    if (req.headers.authorization) auth.Authorization = req.headers.authorization;
    if (req.headers.cookie) auth.Cookie = req.headers.cookie;
    try { res.json({ success: true, ...(await service.sendToClient(dh, { auth, actor: req.apiAuth })) }); }
    catch (error) { console.warn(`[AUTO-LAMP] mandar previo DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo mandar al cliente.' }); }
});

// Previo para el cliente (círculo con fondo blanco), desde la versión actual del proyecto. No manda nada.
router.post('/:dh/client-preview', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { res.json({ success: true, ...(await service.clientPreview(dh)) }); }
    catch (error) { console.warn(`[AUTO-LAMP] previo DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo armar el previo.' }); }
});

router.post('/:dh/reject', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { await service.reject(dh, { reason: req.body?.reason || '', actor: req.apiAuth }); res.json({ success: true }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo descartar.' }); }
});

module.exports = router;
