'use strict';
const router = require('express').Router();
const { db, admin } = require('../config');
const { ENGINE, productionWorker } = require('./svgCutWorker');
const { ms } = require('./svgCutQueue');
const config = db.collection('svg_corte_config').doc('settings');

router.get('/status', async (_req, res) => {
    try {
        const [snapshot, active, review, legacy] = await Promise.all([
            config.get(), db.collection('svg_cut_jobs').where('state', '==', 'active').limit(30).get(),
            db.collection('svg_cut_jobs').where('state', '==', 'needs_review').limit(30).get(),
            db.collection('pedidos').where('iaForce.status', 'in', ['queued', 'approved', 'staged']).limit(50).get()
        ]);
        const cfg = snapshot.data() || {};
        res.json({ engine: ENGINE, commit: process.env.RENDER_GIT_COMMIT || null, platform: process.platform,
            enabled: cfg.engine === ENGINE && cfg.serverEnabled === true,
            autoGenerate: cfg.serverAutoGenerate ?? cfg.autoGenerate ?? true,
            legacyAutoGenerate: cfg.autoGenerate ?? true, startAfter: ms(cfg.serverStartAfter),
            lastStartedAt: ms(cfg.serverLastStartedAt), lastFinishedAt: ms(cfg.serverLastFinishedAt),
            lastResult: cfg.serverLastResult || null, lastError: cfg.serverLastError || null,
            activeJobs: active.docs.map(d => ({ id: d.id, orders: d.data().orders.map(o => o.dh) })),
            reviewJobs: review.docs.map(d => ({ id: d.id, orders: d.data().orders.map(o => o.dh), error: d.data().error })),
            legacyRequests: legacy.docs.map(d => ({ id: d.id, dh: 'DH' + d.data().consecutiveOrderNumber, status: d.data().iaForce.status })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// A single migration switch disables the original PC's automatic queue before enabling ours.
// Unless its scheduler is known to be stopped, allow an hour for an old run to drain.
router.post('/activate', async (req, res) => {
    if (req.body?.engine !== ENGINE) return res.status(400).json({ error: 'Motor inválido.' });
    try {
        const stopped = req.body.legacyWorkerStopped === true;
        await db.runTransaction(async tx => {
            const d = await tx.get(config), cfg = d.data() || {};
            const already = cfg.engine === ENGINE;
            tx.set(config, { engine: ENGINE, autoGenerate: false, serverEnabled: true,
                serverAutoGenerate: already ? cfg.serverAutoGenerate !== false : cfg.autoGenerate !== false,
                serverStartAfter: already && !stopped ? cfg.serverStartAfter || Date.now() : Date.now() + (stopped ? 0 : 60 * 60000),
                serverMigratedAt: cfg.serverMigratedAt || admin.firestore.FieldValue.serverTimestamp(),
                legacyWorkerStopped: stopped || cfg.legacyWorkerStopped === true,
                legacyAutoGenerateBeforeMigration: cfg.legacyAutoGenerateBeforeMigration ?? cfg.autoGenerate ?? true
            }, { merge: true });
        });
        res.json({ success: true, engine: ENGINE, config: (await config.get()).data() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pause', async (_req, res) => {
    try { await config.set({ serverEnabled: false }, { merge: true }); res.json({ success: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// Read-only queue inspection: no claims, uploads or order changes.
router.get('/queue', async (_req, res) => {
    try { res.json(await productionWorker().run({ dry: true, maxSheets: 20 })); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

let previewBusy = false;
router.post('/preview', async (req, res) => {
    if (previewBusy) return res.status(429).json({ error: 'Hay un diseño de prueba en curso.' });
    const { model, lamps } = req.body || {};
    if (!['infinito', 'spiderman', 'rex'].includes(model) || !Array.isArray(lamps) || lamps.length < 1 || lamps.length > 2
        || lamps.some(l => !l || typeof l !== 'object' || Object.values(l).some(v => typeof v !== 'string' || v.length > 160)))
        return res.status(400).json({ error: 'Se requieren un modelo y una o dos lámparas con textos de hasta 160 caracteres.' });
    previewBusy = true;
    try {
        const r = await require('./svgRenderService').renderSheet({ model, lamps });
        res.json({ svg: r.svg, naturalSvg: r.naturalSvg, meta: r.meta });
    } catch (e) { res.status(e.code === 'DESIGN_LAYOUT' ? 400 : 500).json({ error: e.message }); }
    finally { previewBusy = false; }
});
module.exports = router;
