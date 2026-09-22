// Built-in runner: node --test tests/shadowEvaluation.node-test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../server/ai/shadowEvaluationCore');
const { reserve, settle } = require('../server/ai/shadowEvaluation');

const run = () => ({ id: 'test-run', enabled: true, endsAtMs: Date.now() + 60000, budgetUsd: 15, dailyLimit: 50,
    quotas: { representative: 200, challenge: 100 }, representativeRate: .1, challengeRate: .35 });
function memoryDb(config = run()) {
    const values = new Map([
        ['crm_settings/ai_shadow_evaluation', config],
        ['ai_shadow_runs/test-run', { ...config, status: 'running', counts: {}, completed: 0, spentUsd: 0, reservedUsd: 0 }],
    ]);
    const ref = p => ({ path: p, collection: n => ({ doc: id => ref(p + '/' + n + '/' + id) }) });
    let lock = Promise.resolve();
    return { values, collection: n => ({ doc: id => ref(n + '/' + id) }), runTransaction(fn) {
        const pending = lock.then(() => fn({
            get: async r => ({ exists: values.has(r.path), data: () => structuredClone(values.get(r.path)) }),
            update: (r, data) => { assert.ok(values.has(r.path)); values.set(r.path, { ...values.get(r.path), ...data }); },
            create: (r, data) => { assert.ok(!values.has(r.path)); values.set(r.path, data); },
        })); lock = pending.catch(() => {}); return pending;
    } };
}
const quote = { total: 2, perModel: Object.fromEntries(core.MODELS.map(m => [m, 1])) };

test('snapshot encryption authenticates content and storage path; no plaintext leaks', () => {
    const key = core.encryptionKey({ AI_SHADOW_ENCRYPTION_KEY: 'ab'.repeat(32) });
    const value = { messages: [{ content: 'comprobante privado' }], image: 'data:image/png;base64,AAA' };
    const encrypted = core.seal(value, key, 'run/case');
    assert.equal(encrypted.includes(Buffer.from('comprobante privado')), false);
    assert.deepEqual(core.unseal(encrypted, key, 'run/case'), value);
    assert.throws(() => core.unseal(encrypted, key, 'other/case'));
    encrypted[encrypted.length - 1] ^= 1;
    assert.throws(() => core.unseal(encrypted, key, 'run/case'));
    assert.throws(() => core.encryptionKey({}));
});

test('candidate receives exact production settings, all media and cache markers; only model differs', () => {
    const payload = { model: 'original', max_tokens: 2048, temperature: .3, reasoning: { effort: 'low' }, messages: [
        { role: 'system', content: 'payment state at response time' },
        { role: 'user', content: [{ type: 'text', text: 'history', cache_control: { type: 'ephemeral' } }, { type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } }] },
    ] };
    const before = structuredClone(payload);
    const replay = core.replayPayload(payload, core.MODELS[0]);
    assert.deepEqual({ ...replay, model: 'original' }, before);
    assert.deepEqual(payload, before);
    assert.throws(() => core.replayPayload({ ...payload, tools: [{}] }, core.MODELS[0]));
    assert.throws(() => core.replayPayload({ ...payload, max_tokens: 65536 }, core.MODELS[0]));
    assert.throws(() => core.replayPayload(payload, 'unapproved/model'));
});

test('unknown pricing fails closed and conservative reservation covers retries without cache discounts', () => {
    const payload = { messages: [{ role: 'user', content: 'á'.repeat(100) }], max_tokens: 2048 };
    const pricing = core.MODELS.map(id => ({ id, pricing: { prompt: '0.0000005', completion: '0.000003', overrides: [{ prompt: '0.000001' }] } }));
    const r = core.reservationFor(payload, pricing);
    assert.ok(r.perModel[core.MODELS[0]] >= 4 * (r.bytes * .000001 + 2048 * .000003));
    assert.throws(() => core.reservationFor(payload, []));
    assert.throws(() => core.reservationFor({ ...payload, messages: [{ content: 'a'.repeat(core.MAX_BYTES) }] }, pricing));
});

test('concurrent instances cannot exceed quota or sample the same contact twice', async () => {
    const db = memoryDb(), cfg = run();
    const results = await Promise.all([reserve(db, cfg, 'case1', 'same-contact', 'representative', quote, {}), reserve(db, cfg, 'case2', 'same-contact', 'challenge', quote, {})]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(db.values.get('ai_shadow_runs/test-run').reservedUsd, 2);
});

test('fresh kill switch, expiry, daily cap, cohort cap and budget prevent reservations', async () => {
    for (const change of [
        (db) => { db.values.get('crm_settings/ai_shadow_evaluation').enabled = false; },
        (db) => { db.values.get('crm_settings/ai_shadow_evaluation').endsAtMs = 1; },
        (db) => { db.values.get('ai_shadow_runs/test-run').spentUsd = 14; },
        (db) => { db.values.get('ai_shadow_runs/test-run').counts = { representative: 200 }; },
        (db) => { Object.assign(db.values.get('ai_shadow_runs/test-run'), { day: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }), dayCount: 50 }); },
    ]) {
        const db = memoryDb(); change(db);
        assert.equal(await reserve(db, run(), 'case', 'contact', 'representative', quote, {}), null);
    }
});

test('unknown billable outcome keeps its budget reservation; settlement is idempotent', async () => {
    const db = memoryDb(), cfg = run();
    const refs = await reserve(db, cfg, 'case', 'contact', 'representative', quote, {});
    const results = [{ model: core.MODELS[0], summary: { costUsd: null } }, { model: core.MODELS[1], summary: { costUsd: .1 } }];
    await settle(db, refs, quote, results, 'evaluated');
    await settle(db, refs, quote, results, 'evaluated');
    const s = db.values.get('ai_shadow_runs/test-run');
    assert.equal(s.spentUsd, 1.1); assert.equal(s.reservedUsd, 0); assert.equal(s.completed, 1); assert.equal(s.unknownCostCases, 1);
});

test('filtered and length-limited HTTP successes are incomplete; action commands stay proposals', () => {
    for (const finish_reason of ['content_filter', 'length']) {
        const s = core.responseSummary({ choices: [{ finish_reason, message: { content: '/registrar\n/comprobante' } }] });
        assert.equal(s.complete, false); assert.deepEqual(s.commands, ['/registrar', '/comprobante']);
    }
});

test('transport retries transient faults but never runs returned commands or calls CRM', async () => {
    const urls = [], bodies = [];
    const data = { model: core.MODELS[0], choices: [{ finish_reason: 'stop', message: { content: '/registrar\n/cancelado' } }], usage: { cost: .01 } };
    const result = await core.compare({ model: core.MODELS[0], messages: [], max_tokens: 2048 }, {
        apiKey: 'test-only', sleep: async () => {}, fetchImpl: async (url, opts) => {
            urls.push(url); bodies.push(JSON.parse(opts.body));
            return urls.length === 1 ? { status: 503, json: async () => ({ error: { message: 'temporary' } }) } : { status: 200, json: async () => data };
        },
    });
    assert.equal(urls.length, 2); assert.equal(new Set(urls).size, 1);
    assert.equal(urls[0], 'https://openrouter.ai/api/v1/chat/completions');
    assert.deepEqual(bodies[0], bodies[1]); assert.equal(result.summary.complete, true);
    assert.equal(result.summary.costUsd, null); // first attempt may have consumed credit
});

test('cohorts are deterministic and deliberately enriched cases remain separate', () => {
    const cfg = run();
    assert.equal(core.chooseCohort(cfg, '00000000ffffffff', {}), 'representative');
    assert.equal(core.chooseCohort(cfg, 'ffffffff00000000', { paymentPhaseActive: true }), 'challenge');
    assert.equal(core.chooseCohort(cfg, 'ffffffff00000000', {}), null);
    for (const customerText of ['mis pedidos', 'todos listos', 'fueron enviados']) {
        assert.equal(core.chooseCohort(cfg, 'ffffffff00000000', { customerText }), null);
    }
    for (const customerText of ['quiero dos productos', 'varias piezas', 'quiero 2 piezas']) {
        assert.equal(core.chooseCohort(cfg, 'ffffffff00000000', { customerText }), 'challenge');
    }
    assert.equal(core.validRun({ ...cfg, budgetUsd: 100 }), false);
});

test('live provider result stays unchanged when capture scheduling throws; classifiers do not capture', async () => {
    const fs = require('fs'), vm = require('vm');
    const code = fs.readFileSync(require.resolve('../server/ai/openaiProvider'), 'utf8');
    let calls = 0, scheduled;
    const sandbox = { module: { exports: {} }, process: { env: { OPENROUTER_API_KEY: 'test-only' } }, console,
        AbortSignal, setTimeout, Date,
        require(name) { assert.equal(name, './shadowEvaluation'); return { schedule(event) { calls++; scheduled = event; throw Error('storage unavailable'); } }; },
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Respuesta real' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }) }),
    };
    vm.runInNewContext(code, sandbox);
    const fn = sandbox.module.exports.generateChatCompletion;
    const result = await fn('Pregunta', [], 'Reglas', 'openrouter', { contactId: 'c', messageId: 'm' });
    assert.equal(result.text, 'Respuesta real'); assert.equal(calls, 1);
    assert.equal(scheduled.payload.messages[0].content, 'Reglas');
    await fn('Clasificador', [], 'Reglas', 'openrouter'); assert.equal(calls, 1);
});
