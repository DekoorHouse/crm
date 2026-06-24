/**
 * Seguimiento de "pedido en proceso" — API
 *
 * GET  /api/order-followup/config        -> config actual (defaults + Firestore)
 * PUT  /api/order-followup/config        -> guardar config (parcial)
 * GET  /api/order-followup/seguimientos  -> lista por status (?status=pending&limit=100)
 * POST /api/order-followup/sweep         -> dispara sweep manual ({ dryRun: true } para simular)
 */
const express = require('express');
const router = express.Router();
const { db } = require('../config');
const {
    runOrderFollowupSweep,
    getOrderFollowupConfig,
    saveOrderFollowupConfig
} = require('./orderFollowupScheduler');

router.get('/config', async (_req, res) => {
    try {
        res.json(await getOrderFollowupConfig(true));
    } catch (e) {
        console.error('[ORDER_FOLLOWUP] Error leyendo config:', e.message);
        res.status(500).json({ error: 'Error al leer la configuración' });
    }
});

router.put('/config', async (req, res) => {
    try {
        const b = req.body || {};
        const partial = {};
        if (b.enabled !== undefined) partial.enabled = !!b.enabled;
        if (b.delaysHours !== undefined) {
            if (!Array.isArray(b.delaysHours)) return res.status(400).json({ error: 'delaysHours debe ser una lista de horas' });
            partial.delaysHours = b.delaysHours;
        }
        if (b.businessHours !== undefined) partial.businessHours = b.businessHours;
        if (b.utcOffsetHours !== undefined) partial.utcOffsetHours = Number(b.utcOffsetHours);
        if (b.windowHours !== undefined) partial.windowHours = Number(b.windowHours);
        if (b.minGapHours !== undefined) partial.minGapHours = Number(b.minGapHours);
        if (b.minDaysSinceLastOrder !== undefined) partial.minDaysSinceLastOrder = Number(b.minDaysSinceLastOrder);
        if (b.cooldownHours !== undefined) partial.cooldownHours = Number(b.cooldownHours);
        if (b.classifyMinMessages !== undefined) partial.classifyMinMessages = Number(b.classifyMinMessages);
        if (b.liveTagging !== undefined) partial.liveTagging = !!b.liveTagging;
        if (b.maxPerSweep !== undefined) partial.maxPerSweep = Number(b.maxPerSweep);
        if (b.messageFallbacks !== undefined) {
            if (!Array.isArray(b.messageFallbacks)) return res.status(400).json({ error: 'messageFallbacks debe ser una lista de textos' });
            partial.messageFallbacks = b.messageFallbacks;
        }

        const saved = await saveOrderFollowupConfig(partial);
        res.json(saved);
    } catch (e) {
        console.error('[ORDER_FOLLOWUP] Error guardando config:', e.message);
        res.status(500).json({ error: 'Error al guardar la configuración' });
    }
});

router.get('/seguimientos', async (req, res) => {
    try {
        const status = req.query.status || 'pending';
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const snap = await db.collection('order_followups')
            .where('status', '==', status)
            .limit(limit)
            .get();
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ items, count: items.length });
    } catch (e) {
        console.error('[ORDER_FOLLOWUP] Error listando seguimientos:', e.message);
        res.status(500).json({ error: 'Error al listar seguimientos' });
    }
});

router.post('/sweep', async (req, res) => {
    try {
        const dryRun = !!(req.body && req.body.dryRun);
        const summary = await runOrderFollowupSweep({ dryRun });
        res.json(summary);
    } catch (e) {
        console.error('[ORDER_FOLLOWUP] Error en sweep manual:', e.message);
        res.status(500).json({ error: 'Error al ejecutar el sweep' });
    }
});

module.exports = router;
