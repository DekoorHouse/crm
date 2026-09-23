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
    service.generate(dh).catch(error => console.warn(`[AUTO-LAMP] DH${dh}:`, error.message)).finally(() => running.delete(dh));
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

module.exports = router;
