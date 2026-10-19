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
    try { res.json({ success: true, ...(await service.approve(dh, { svg: req.body?.svg || null, actor: req.apiAuth })) }); }
    catch (error) { console.warn(`[AUTO-LAMP] aprobar DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo subir a Drive.' }); }
});

router.post('/:dh/reject', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { await service.reject(dh, { reason: req.body?.reason || '', actor: req.apiAuth }); res.json({ success: true }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo descartar.' }); }
});

module.exports = router;
