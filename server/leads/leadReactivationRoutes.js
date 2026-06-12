/**
 * Reactivación de leads - API
 *
 * GET  /api/leads/reactivacion/config        -> config actual (defaults + Firestore)
 * PUT  /api/leads/reactivacion/config        -> guardar config (parcial)
 * GET  /api/leads/reactivacion/seguimientos  -> lista por status (?status=pending&limit=100)
 * POST /api/leads/reactivacion/sweep         -> dispara sweep manual ({ dryRun: true } para simular)
 */
const express = require('express');
const router = express.Router();
const { db } = require('../config');
const {
    runLeadReactivationSweep,
    getReactivationConfig,
    saveReactivationConfig
} = require('./leadReactivationScheduler');

router.get('/reactivacion/config', async (_req, res) => {
    try {
        res.json(await getReactivationConfig(true));
    } catch (e) {
        console.error('[LEAD_REACT] Error leyendo config:', e.message);
        res.status(500).json({ error: 'Error al leer la configuración' });
    }
});

router.put('/reactivacion/config', async (req, res) => {
    try {
        const { enabled, followups, minDaysSinceLastOrder, cooldownHours, maxPerSweep } = req.body || {};
        const partial = {};
        if (enabled !== undefined) partial.enabled = !!enabled;
        if (followups !== undefined) {
            if (!Array.isArray(followups)) {
                return res.status(400).json({ error: 'followups debe ser una lista de { delayMinutes, text }' });
            }
            partial.followups = followups;
        }
        if (minDaysSinceLastOrder !== undefined) partial.minDaysSinceLastOrder = Number(minDaysSinceLastOrder);
        if (cooldownHours !== undefined) partial.cooldownHours = Number(cooldownHours);
        if (maxPerSweep !== undefined) partial.maxPerSweep = Number(maxPerSweep);

        const saved = await saveReactivationConfig(partial);
        res.json(saved);
    } catch (e) {
        console.error('[LEAD_REACT] Error guardando config:', e.message);
        res.status(500).json({ error: 'Error al guardar la configuración' });
    }
});

router.get('/reactivacion/seguimientos', async (req, res) => {
    try {
        const status = req.query.status || 'pending';
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const snap = await db.collection('lead_followups')
            .where('status', '==', status)
            .limit(limit)
            .get();
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ items, count: items.length });
    } catch (e) {
        console.error('[LEAD_REACT] Error listando seguimientos:', e.message);
        res.status(500).json({ error: 'Error al listar seguimientos' });
    }
});

router.post('/reactivacion/sweep', async (req, res) => {
    try {
        const dryRun = !!(req.body && req.body.dryRun);
        const summary = await runLeadReactivationSweep({ dryRun });
        res.json(summary);
    } catch (e) {
        console.error('[LEAD_REACT] Error en sweep manual:', e.message);
        res.status(500).json({ error: 'Error al ejecutar el sweep' });
    }
});

module.exports = router;
