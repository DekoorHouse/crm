/**
 * Recordatorios programados a fecha futura — API
 *
 * GET    /api/reminders/config          -> config actual
 * PUT    /api/reminders/config          -> guardar config (parcial)
 * GET    /api/reminders/list            -> lista por status (?status=scheduled&limit=200)
 * GET    /api/reminders/contact/:waId   -> recordatorio de un contacto (badge/botón)
 * POST   /api/reminders/contact/:waId   -> crear/actualizar (operador) { remindAt, message, context, reason }
 * DELETE /api/reminders/contact/:waId   -> cancelar el recordatorio de un contacto
 * POST   /api/reminders/suggest/:waId   -> la IA sugiere fecha + mensaje (sin guardar)
 * POST   /api/reminders/sweep           -> dispara el sweep ({ dryRun: true } para simular)
 */
const express = require('express');
const router = express.Router();
const { db } = require('../config');
const {
    runReminderSweep,
    armReminder,
    suggestReminderForContact,
    getReminderConfig,
    saveReminderConfig
} = require('./scheduledReminderScheduler');
const { toMillis } = require('./scheduledReminderLogic');

router.get('/config', async (_req, res) => {
    try {
        res.json(await getReminderConfig(true));
    } catch (e) {
        console.error('[REMINDER] Error leyendo config:', e.message);
        res.status(500).json({ error: 'Error al leer la configuración' });
    }
});

router.put('/config', async (req, res) => {
    try {
        const b = req.body || {};
        const partial = {};
        if (b.enabled !== undefined) partial.enabled = !!b.enabled;
        if (b.templateName !== undefined) partial.templateName = String(b.templateName);
        if (b.langCode !== undefined) partial.langCode = String(b.langCode);
        if (b.utcOffsetHours !== undefined) partial.utcOffsetHours = Number(b.utcOffsetHours);
        if (b.sendHourLocal !== undefined) partial.sendHourLocal = Number(b.sendHourLocal);
        if (b.businessHours !== undefined) partial.businessHours = b.businessHours;
        if (b.minFutureHours !== undefined) partial.minFutureHours = Number(b.minFutureHours);
        if (b.maxFutureDays !== undefined) partial.maxFutureDays = Number(b.maxFutureDays);
        if (b.graceDays !== undefined) partial.graceDays = Number(b.graceDays);
        if (b.maxPerSweep !== undefined) partial.maxPerSweep = Number(b.maxPerSweep);
        if (b.liveDetect !== undefined) partial.liveDetect = !!b.liveDetect;
        if (b.fallbackMessage !== undefined) partial.fallbackMessage = String(b.fallbackMessage);
        res.json(await saveReminderConfig(partial));
    } catch (e) {
        console.error('[REMINDER] Error guardando config:', e.message);
        res.status(500).json({ error: 'Error al guardar la configuración' });
    }
});

router.get('/list', async (req, res) => {
    try {
        const status = req.query.status || 'scheduled';
        const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
        const snap = await db.collection('scheduled_reminders')
            .where('status', '==', status)
            .limit(limit)
            .get();
        const items = snap.docs.map(d => {
            const x = d.data();
            return { id: d.id, ...x, remindAtMs: toMillis(x.remindAt) };
        }).sort((a, b) => (a.remindAtMs || 0) - (b.remindAtMs || 0));
        res.json({ items, count: items.length });
    } catch (e) {
        console.error('[REMINDER] Error listando:', e.message);
        res.status(500).json({ error: 'Error al listar recordatorios' });
    }
});

router.get('/contact/:waId', async (req, res) => {
    try {
        const doc = await db.collection('scheduled_reminders').doc(req.params.waId).get();
        if (!doc.exists) return res.json({ exists: false });
        const x = doc.data();
        const ms = toMillis(x.remindAt);
        res.json({
            exists: true,
            status: x.status || null,
            remindAtMs: ms,
            remindDate: ms ? new Date(ms).toISOString().slice(0, 10) : null,
            message: x.message || '',
            reason: x.reason || '',
            context: x.context || '',
            source: x.source || null
        });
    } catch (e) {
        console.error('[REMINDER] Error en contact GET:', e.message);
        res.status(500).json({ exists: false, error: 'Error' });
    }
});

router.post('/contact/:waId', async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.remindAt) return res.status(400).json({ error: 'Falta remindAt (YYYY-MM-DD)' });
        let name = b.name;
        if (!name) {
            try {
                const cs = await db.collection('contacts_whatsapp').doc(req.params.waId).get();
                name = cs.exists ? cs.data().name : null;
            } catch (_) {}
        }
        const result = await armReminder(req.params.waId, {
            name,
            remindAt: b.remindAt,
            message: b.message || '',
            context: b.context || '',
            reason: b.reason || '',
            source: 'operator'
        });
        if (!result.ok) return res.status(400).json({ error: result.reason || 'No se pudo agendar' });
        res.json({ ok: true, remindAtMs: result.sendMs, remindDate: new Date(result.sendMs).toISOString().slice(0, 10) });
    } catch (e) {
        console.error('[REMINDER] Error en contact POST:', e.message);
        res.status(500).json({ error: 'Error al agendar el recordatorio' });
    }
});

router.delete('/contact/:waId', async (req, res) => {
    try {
        const ref = db.collection('scheduled_reminders').doc(req.params.waId);
        const doc = await ref.get();
        if (!doc.exists) return res.json({ ok: true, alreadyGone: true });
        await ref.update({ status: 'cancelled', cancelReason: 'operador', updatedAt: new Date() });
        res.json({ ok: true });
    } catch (e) {
        console.error('[REMINDER] Error en contact DELETE:', e.message);
        res.status(500).json({ error: 'Error al cancelar el recordatorio' });
    }
});

router.post('/suggest/:waId', async (req, res) => {
    try {
        res.json(await suggestReminderForContact(req.params.waId));
    } catch (e) {
        console.error('[REMINDER] Error en suggest:', e.message);
        res.status(500).json({ error: 'Error al generar la sugerencia' });
    }
});

router.post('/sweep', async (req, res) => {
    try {
        const dryRun = !!(req.body && req.body.dryRun);
        res.json(await runReminderSweep({ dryRun }));
    } catch (e) {
        console.error('[REMINDER] Error en sweep manual:', e.message);
        res.status(500).json({ error: 'Error al ejecutar el sweep' });
    }
});

module.exports = router;
