// Only explicit live-chat captures enter here. No dispatcher, send or order modules imported.
const core = require('./shadowEvaluationCore');
let active = false;
let runCache = { at: 0, value: null };
let priceCache = { at: 0, value: null };
let lastCleanup = 0;
const counters = {};
const count = key => { counters[key] = (counters[key] || 0) + 1; };

async function loadRun(db) {
    if (Date.now() - runCache.at > 30000) {
        const d = await db.collection('crm_settings').doc('ai_shadow_evaluation').get();
        runCache = { at: Date.now(), value: d.exists ? d.data() : null };
    }
    return runCache.value;
}

async function prices() {
    if (Date.now() - priceCache.at > 3600000) {
        const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error('Pricing unavailable');
        priceCache = { at: Date.now(), value: (await r.json()).data };
    }
    return priceCache.value;
}

async function reserve(db, run, caseId, contactHash, cohort, reservation, metadata) {
    const runRef = db.collection('ai_shadow_runs').doc(run.id);
    const caseRef = runRef.collection('cases').doc(caseId);
    const contactRef = runRef.collection('participants').doc(contactHash);
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    return db.runTransaction(async tx => {
        const [state, oldCase, participant, switchDoc] = await Promise.all([
            tx.get(runRef), tx.get(caseRef), tx.get(contactRef), tx.get(db.collection('crm_settings').doc('ai_shadow_evaluation')),
        ]);
        const current = switchDoc.data();
        if (!core.validRun(current) || current.id !== run.id || !state.exists) return null;
        const s = state.data();
        if (s.status !== 'running' || oldCase.exists || participant.exists) return null;
        if ((s.counts?.[cohort] || 0) >= current.quotas[cohort]) return null;
        const dailyCount = s.day === day ? s.dayCount || 0 : 0;
        if (dailyCount >= current.dailyLimit) return null;
        if ((s.spentUsd || 0) + (s.reservedUsd || 0) + reservation.total > current.budgetUsd) return null;
        tx.update(runRef, {
            counts: { ...s.counts, [cohort]: (s.counts?.[cohort] || 0) + 1 },
            reservedUsd: (s.reservedUsd || 0) + reservation.total,
            day, dayCount: dailyCount + 1,
        });
        tx.create(contactRef, { caseId });
        tx.create(caseRef, { ...metadata, cohort, status: 'reserved', reservationUsd: reservation.total, capturedAt: new Date(), expiresAt: new Date(Date.now() + 14 * 86400000) });
        return { runRef, caseRef };
    });
}

async function settle(db, refs, reservation, results, status) {
    const known = results.filter(r => r.summary.costUsd !== null).reduce((n, r) => n + r.summary.costUsd, 0);
    const unknown = results.filter(r => r.summary.costUsd === null).reduce((n, r) => n + reservation.perModel[r.model], 0);
    await db.runTransaction(async tx => {
        const [doc, caseDoc] = await Promise.all([tx.get(refs.runRef), tx.get(refs.caseRef)]);
        if (caseDoc.data()?.status !== 'reserved') return;
        const s = doc.data();
        const completed = (s.completed || 0) + 1;
        const spentUsd = (s.spentUsd || 0) + known + unknown;
        tx.update(refs.runRef, {
            spentUsd, actualKnownUsd: (s.actualKnownUsd || 0) + known,
            unknownCostCases: (s.unknownCostCases || 0) + (unknown > 0 ? 1 : 0),
            reservedUsd: Math.max(0, (s.reservedUsd || 0) - reservation.total), completed,
            status: spentUsd >= s.budgetUsd ? 'budget_exhausted' : completed >= 300 ? 'complete' : s.status,
        });
        tx.update(refs.caseRef, { status, completedAt: new Date(), chargedOrReservedUsd: known + unknown, candidates: results.map(r => ({ model: r.model, ...r.summary })) });
    });
}

async function capture(event) {
    const { db, bucket } = require('../config');
    const run = await loadRun(db);
    if (!core.validRun(run)) return;
    count('observed');
    if (active) { count('busy'); return; }
    active = true;
    try {
        const key = core.encryptionKey();
        const contactHash = core.fingerprint(key, `${run.id}:${event.context.contactId}`);
        const caseId = core.fingerprint(key, `${run.id}:${event.context.contactId}:${event.context.messageId}`);
        const cohort = core.chooseCohort(run, caseId, event.context);
        if (!cohort) { count('notSampled'); return; }
        if (event.provider !== 'openrouter' || !event.context.messageId) { count('unsupported'); return; }
        const reservation = core.reservationFor(event.payload, await prices());
        const objectPath = `ai-shadow-private/${run.id}/${caseId}.bin`;
        const refs = await reserve(db, run, caseId, contactHash, cohort, reservation, {
            objectPath, bytes: reservation.bytes, hasMedia: !!event.context.hasMedia,
            stage: event.context.stage, primaryModel: event.payload.model,
            primary: core.responseSummary(event.data || {}, event.elapsedMs),
        });
        if (!refs) { count('quotaOrDuplicate'); return; }
        const snapshot = { schema: 1, runId: run.id, caseId, cohort, event, candidates: [], capturedAt: new Date().toISOString() };
        const save = () => bucket.file(objectPath).save(core.seal(snapshot, key, objectPath), {
            resumable: false, contentType: 'application/octet-stream',
            metadata: { cacheControl: 'private, no-store' },
        });
        // Persist the EXACT production payload before calling any candidate. No live reads to rebuild it.
        await save();
        for (const model of core.MODELS) {
            const sw = (await db.collection('crm_settings').doc('ai_shadow_evaluation').get()).data();
            if (!core.validRun(sw) || sw.id !== run.id) break;
            const result = await core.compare(core.replayPayload(event.payload, model), {
                apiKey: process.env.OPENROUTER_API_KEY,
                timeoutMs: Math.min(90000, Math.max(1000, Number(process.env.OPENAI_TIMEOUT_MS) || 60000)),
            });
            snapshot.candidates.push({ model, ...result });
            await save();
        }
        await settle(db, refs, reservation, snapshot.candidates, snapshot.candidates.length === core.MODELS.length ? 'evaluated' : 'stopped');
        count('evaluated');
    } finally { active = false; }
}

function schedule(event) {
    // Local tests and developer servers never capture production data unless explicitly enabled.
    const enabled = process.env.AI_SHADOW_ENABLED === 'true'
        || (process.env.AI_SHADOW_ENABLED !== 'false' && Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID));
    if (!enabled) return;
    setImmediate(() => capture(event).catch(() => { count('failures'); console.warn('[AI_SHADOW] Evaluation failed; live response unaffected.'); }));
}

async function maintenance() {
    const { db, bucket, admin } = require('../config');
    const run = await loadRun(db);
    if (run?.id && /^[a-z0-9-]{1,70}$/.test(run.id)) {
        const runRef = db.collection('ai_shadow_runs').doc(run.id);
        const pendingCounters = { ...counters };
        const increments = Object.fromEntries(Object.entries(pendingCounters).map(([k, v]) => [k, admin.firestore.FieldValue.increment(v)]));
        await runRef.set({ observations: increments, lastHeartbeatAt: new Date() }, { merge: true });
        for (const [key, value] of Object.entries(pendingCounters)) counters[key] = Math.max(0, (counters[key] || 0) - value);
        const d = await runRef.get();
        if (d.exists && d.data().status === 'running' && Date.now() >= run.endsAtMs) await runRef.update({ status: 'ended' });
        const pending = await runRef.collection('cases').where('status', '==', 'reserved').get();
        const stalled = pending.docs.filter(d => Date.now() - d.data().capturedAt.toMillis() > 15 * 60000).length;
        // Retain reservations after crashes. Never automatically resend potentially billed requests.
        await runRef.update({ stalledCases: stalled });
    }
    if (Date.now() - lastCleanup < 3600000) return;
    // Include stopped/previous runs so changing the active run does not strand private snapshots.
    const retained = await db.collection('ai_shadow_runs').where('retentionPending', '==', true).limit(25).get();
    for (const runDoc of retained.docs) {
        const expired = await runDoc.ref.collection('cases').where('expiresAt', '<=', new Date()).limit(100).get();
        for (const doc of expired.docs) {
            const p = doc.data().objectPath;
            if (p !== `ai-shadow-private/${runDoc.id}/${doc.id}.bin`) continue;
            await bucket.file(p).delete({ ignoreNotFound: true });
            await doc.ref.update({ snapshotExpired: true, expiresAt: admin.firestore.FieldValue.delete() });
        }
        if (Date.now() > runDoc.data().endsAtMs + 14 * 86400000) {
            const remaining = await runDoc.ref.collection('cases').orderBy('expiresAt').limit(1).get();
            if (remaining.empty) await runDoc.ref.update({ retentionPending: false });
        }
    }
    lastCleanup = Date.now();
}

let timer;
function startMaintenance() {
    if (timer) return;
    timer = setInterval(() => maintenance().catch(() => console.warn('[AI_SHADOW] Maintenance unavailable.')), 60000);
    timer.unref();
}

module.exports = { schedule, startMaintenance, reserve, settle };
