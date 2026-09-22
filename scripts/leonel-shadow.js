// Run in the authenticated server shell. No messaging imports or public routes.
const fs = require('fs');
const path = require('path');
const { db, bucket } = require('../server/config');
const core = require('../server/ai/shadowEvaluationCore');

async function main() {
    const [command = 'status', runId, outputDir] = process.argv.slice(2);
    const configRef = db.collection('crm_settings').doc('ai_shadow_evaluation');
    if (command === 'start') {
        if (!/^[a-z0-9-]{1,70}$/.test(runId || '')) throw new Error('Usage: start <run-id>');
        core.encryptionKey();
        if (!process.env.OPENROUTER_API_KEY) throw new Error('Missing OpenRouter credential');
        const general = (await db.collection('crm_settings').doc('general').get()).data() || {};
        if ((general.aiChatProvider || process.env.AI_CHAT_PROVIDER || 'gemini') !== 'openrouter') throw new Error('Live provider must be OpenRouter');
        const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Pricing unavailable');
        const models = (await response.json()).data.filter(m => core.MODELS.includes(m.id));
        core.reservationFor({ model: 'baseline', messages: [{ role: 'user', content: 'preflight' }], max_tokens: 2048 }, models);
        const config = {
            id: runId, enabled: true, endsAtMs: Date.now() + 7 * 86400000,
            quotas: { representative: 200, challenge: 100 }, dailyLimit: 50,
            representativeRate: 0.10, challengeRate: 0.35, budgetUsd: 15,
        };
        const runRef = db.collection('ai_shadow_runs').doc(runId);
        await db.runTransaction(async tx => {
            const [oldConfig, oldRun] = await Promise.all([tx.get(configRef), tx.get(runRef)]);
            if (oldRun.exists) throw new Error('Run id already exists; never reset counters');
            if (core.validRun(oldConfig.data())) throw new Error('Another run is active; stop it first');
            tx.create(runRef, {
                ...config, status: 'running', createdAt: new Date(), retentionPending: true,
                counts: { representative: 0, challenge: 0 }, completed: 0,
                spentUsd: 0, reservedUsd: 0, actualKnownUsd: 0, unknownCostCases: 0,
                candidateModels: core.MODELS, initialPricing: models.map(m => ({ id: m.id, pricing: m.pricing })),
                productionModel: process.env.OPENROUTER_CHAT_MODEL || 'google/gemini-3-flash-preview',
                codeVersion: process.env.RENDER_GIT_COMMIT || null,
            });
            tx.set(configRef, config);
        });
        console.log(JSON.stringify({ started: true, ...config }));
        return;
    }
    const config = (await configRef.get()).data();
    const id = runId || config?.id;
    if (!id || !/^[a-z0-9-]{1,70}$/.test(id)) { console.log('No configured run'); return; }
    const runRef = db.collection('ai_shadow_runs').doc(id);
    if (command === 'stop') {
        await db.runTransaction(async tx => {
            const sw = await tx.get(configRef);
            if (sw.data()?.id === id) tx.update(configRef, { enabled: false });
            tx.update(runRef, { enabled: false, status: 'stopped', stoppedAt: new Date() });
        });
        console.log('Stopped ' + id + '; in-flight request may finish, no new candidates start.');
        return;
    }
    const state = (await runRef.get()).data();
    if (!state) throw new Error('Run not found');
    const docs = await runRef.collection('cases').get();
    const statuses = {};
    const metrics = {};
    for (const d of docs.docs) {
        const c = d.data();
        statuses[c.status] = (statuses[c.status] || 0) + 1;
        for (const m of [{ model: c.primaryModel, ...c.primary }, ...(c.candidates || [])]) {
            if (!m.model) continue;
            const key = `${c.cohort}:${m.model}`;
            const v = metrics[key] ||= { count: 0, complete: 0, knownUsd: 0, unknownCosts: 0, latencies: [] };
            v.count++; v.complete += m.complete ? 1 : 0;
            if (m.costUsd === null || m.costUsd === undefined) v.unknownCosts++;
            else v.knownUsd += m.costUsd;
            if (Number.isFinite(m.elapsedMs)) v.latencies.push(m.elapsedMs);
        }
    }
    const report = { run: state, statuses, metrics };
    if (command === 'status') { console.log(JSON.stringify(report, null, 2)); return; }
    if (command !== 'export' || !outputDir) throw new Error('Usage: status [id] | stop [id] | export <id> <private-output-directory>');
    const key = core.encryptionKey();
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const blind = [], answerKey = [];
    for (const doc of docs.docs) {
        const c = doc.data();
        if (c.snapshotExpired || !c.objectPath) continue;
        if (c.objectPath !== `ai-shadow-private/${id}/${doc.id}.bin`) throw new Error('Invalid snapshot path');
        const [encrypted] = await bucket.file(c.objectPath).download();
        const snap = core.unseal(encrypted, key, c.objectPath);
        const candidates = [
            { model: snap.event.payload.model, data: snap.event.data },
            ...snap.candidates.map(x => ({ model: x.model, data: x.attempts.at(-1)?.data })),
        ].sort((a, b) => core.fingerprint(key, doc.id + a.model).localeCompare(core.fingerprint(key, doc.id + b.model)));
        const responses = candidates.map((x, i) => ({ label: String.fromCharCode(65 + i), text: x.data?.choices?.[0]?.message?.content || '', finish: x.data?.choices?.[0]?.finish_reason || null }));
        blind.push({ caseId: doc.id, cohort: c.cohort, messages: snap.event.payload.messages, responses,
            review: { answersQuestion: null, groundedFacts: null, correctPaymentAndOrderActions: null, instructionFollowing: null, concise: null, notes: '' } });
        answerKey.push({ caseId: doc.id, mapping: candidates.map((x, i) => ({ label: String.fromCharCode(65 + i), model: x.model })), metadata: c });
    }
    for (const [name, value] of [['blinded.private.json', blind], ['answer-key.private.json', answerKey], ['metrics.json', report]]) {
        fs.writeFileSync(path.join(outputDir, name), JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    }
    console.log(JSON.stringify({ exported: blind.length, directory: path.resolve(outputDir) }));
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
