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
    saveOrderFollowupConfig,
    setOrderFollowupOptOut
} = require('./orderFollowupScheduler');
const { getOrderFollowupMetrics, listOrderFollowupSends, getContactFollowup } = require('./orderFollowupMetrics');

const DAY_MS = 24 * 60 * 60 * 1000;
// Parsea ?from/?to (YYYY-MM-DD o ms). Default: últimos 30 días.
function parseRange(q) {
    const toMs = q.to ? (/^\d+$/.test(q.to) ? Number(q.to) : Date.parse(q.to + 'T23:59:59')) : Date.now();
    const fromMs = q.from ? (/^\d+$/.test(q.from) ? Number(q.from) : Date.parse(q.from + 'T00:00:00')) : (toMs - 30 * DAY_MS);
    return { fromMs: Number.isFinite(fromMs) ? fromMs : Date.now() - 30 * DAY_MS, toMs: Number.isFinite(toMs) ? toMs : Date.now() };
}

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

// KPIs del embudo de rescate
router.get('/metrics', async (req, res) => {
    try {
        const { fromMs, toMs } = parseRange(req.query);
        const metrics = await getOrderFollowupMetrics(fromMs, toMs);
        res.json({ from: fromMs, to: toMs, ...metrics });
    } catch (e) {
        console.error('[ORDER_FOLLOWUP] Error en métricas:', e.message);
        res.status(500).json({ error: 'Error al calcular métricas' });
    }
});

// Lista de clientes contactados (para el panel). ?status=contacted|replied|converted
router.get('/sends', async (req, res) => {
    try {
        const { fromMs, toMs } = parseRange(req.query);
        const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
        const items = await listOrderFollowupSends(fromMs, toMs, { status: req.query.status, limit });
        res.json({ from: fromMs, to: toMs, count: items.length, items });
    } catch (e) {
        console.error('[ORDER_FOLLOWUP] Error listando envíos:', e.message);
        res.status(500).json({ error: 'Error al listar envíos' });
    }
});

// Estado de seguimiento de un contacto (badge "pendiente" en el chat)
router.get('/contact/:waId', async (req, res) => {
    try {
        res.json(await getContactFollowup(req.params.waId));
    } catch (e) {
        console.error('[ORDER_FOLLOWUP] Error en contact:', e.message);
        res.status(500).json({ exists: false, error: 'Error' });
    }
});

// Apagar / reactivar el seguimiento para UN contacto (control manual del operador).
// POST /api/order-followup/contact/:waId/opt-out  { optOut: true|false }  (default true)
router.post('/contact/:waId/opt-out', async (req, res) => {
    try {
        const optOut = !(req.body && req.body.optOut === false);
        const result = await setOrderFollowupOptOut(req.params.waId, optOut);
        res.json(result);
    } catch (e) {
        console.error('[ORDER_FOLLOWUP] Error en opt-out:', e.message);
        res.status(500).json({ error: 'Error al actualizar el seguimiento' });
    }
});

module.exports = router;
