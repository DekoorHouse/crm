// Offline comparison only. This module has no CRM, messaging or order dependencies.
const crypto = require('crypto');
const zlib = require('zlib');

const MODELS = ['google/gemini-3.8-flash', 'google/gemini-3.1-flash-lite'];
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT = 4096;

function encryptionKey(env = process.env) {
    const supplied = env.AI_SHADOW_ENCRYPTION_KEY;
    if (supplied) {
        if (!/^[a-f0-9]{64}$/i.test(supplied)) throw new Error('Invalid shadow encryption key');
        return Buffer.from(supplied, 'hex');
    }
    // Reuse a server-only high-entropy secret, with domain separation. No new credential.
    const privateKey = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}').private_key;
    if (!privateKey) throw new Error('No server encryption secret');
    return crypto.createHash('sha256').update('dekoor:ai-shadow:v1\0').update(privateKey).digest();
}

function seal(value, key, aad) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad));
    const data = zlib.gzipSync(Buffer.from(JSON.stringify(value)));
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([Buffer.from('LSE1'), iv, cipher.getAuthTag(), encrypted]);
}

function unseal(data, key, aad) {
    if (data.subarray(0, 4).toString() !== 'LSE1') throw new Error('Unknown snapshot format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(4, 16));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(data.subarray(16, 32));
    return JSON.parse(zlib.gunzipSync(Buffer.concat([decipher.update(data.subarray(32)), decipher.final()])));
}

function fingerprint(key, value) {
    return crypto.createHmac('sha256', key).update(value).digest('hex');
}

function validRun(run, now = Date.now()) {
    return run && run.enabled === true && /^[a-z0-9-]{1,70}$/.test(run.id || '')
        && Number.isFinite(run.endsAtMs) && run.endsAtMs > now
        && Number.isFinite(run.budgetUsd) && run.budgetUsd > 0 && run.budgetUsd <= 15
        && Number.isInteger(run.dailyLimit) && run.dailyLimit > 0 && run.dailyLimit <= 50
        && run.quotas?.representative === 200 && run.quotas?.challenge === 100
        && run.representativeRate > 0 && run.representativeRate <= 1
        && run.challengeRate > 0 && run.challengeRate <= 1;
}

function chooseCohort(run, hash, context) {
    const draw = parseInt(hash.slice(0, 8), 16) / 0x100000000;
    if (draw < run.representativeRate) return 'representative';
    const hard = context.hasMedia || context.paymentPhaseActive
        || /pago|anticipo|saldo|comprobante|cancel|cambi|correg|reclamo|\bdos\b|\bvarias\b|\b[2-9]\b/i.test(context.customerText || '');
    const challengeDraw = parseInt(hash.slice(8, 16), 16) / 0x100000000;
    return hard && challengeDraw < run.challengeRate ? 'challenge' : null;
}

function replayPayload(payload, model) {
    if (!MODELS.includes(model)) throw new Error('Unapproved shadow model');
    if (payload.tools?.length || payload.functions?.length || payload.stream) throw new Error('Unsupported production payload');
    if (!Number.isInteger(payload.max_tokens) || payload.max_tokens <= 0 || payload.max_tokens > MAX_OUTPUT) {
        throw new Error('Unsupported production output limit');
    }
    // Preserve every production setting, cache marker and media byte. Only the model changes.
    return { ...payload, model };
}

function maxPrice(pricing, field) {
    const values = [pricing, ...(pricing?.overrides || [])].map(p => Number(p?.[field] || 0));
    if (values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid model pricing');
    return Math.max(...values);
}

function reservationFor(payload, models) {
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    if (bytes > MAX_BYTES) throw new Error('Snapshot exceeds size limit');
    const perModel = {};
    for (const id of MODELS) {
        replayPayload(payload, id);
        const p = models.find(m => m.id === id)?.pricing;
        if (!p || !Number(p.prompt) || !Number(p.completion)) throw new Error('Missing current pricing');
        const input = Math.max(...['prompt', 'image', 'audio', 'input_cache_read', 'input_cache_write'].map(k => maxPrice(p, k)));
        const output = Math.max(maxPrice(p, 'completion'), maxPrice(p, 'internal_reasoning'));
        // Conservative byte-as-token bound, no cache discount; two attempts plus 2x margin.
        // Embedded base64 media are included. Unknown charges are never refunded as zero.
        perModel[id] = 4 * (bytes * input + payload.max_tokens * output + maxPrice(p, 'request'));
    }
    return { bytes, perModel, total: Object.values(perModel).reduce((a, b) => a + b, 0) };
}

function responseSummary(data = {}, elapsedMs = 0) {
    const choice = data.choices?.[0];
    const text = choice?.message?.content;
    return {
        returnedModel: data.model || null,
        finish: choice?.finish_reason || null,
        complete: choice?.finish_reason === 'stop' && typeof text === 'string' && text.trim().length > 0,
        elapsedMs,
        costUsd: Number.isFinite(data.usage?.cost) && data.usage.cost >= 0 ? data.usage.cost : null,
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
        cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? null,
        reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? null,
        // Proposed command NAMES only, not arguments or customer data. Never execute them.
        commands: [...new Set((typeof text === 'string' ? text.match(/(?:^|\s)\/[a-záéíóú_]+\b/gi) : null) || [])].map(s => s.trim()),
    };
}

async function compare(payload, { fetchImpl = fetch, apiKey, timeoutMs = 60000, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    const attempts = [];
    const start = Date.now();
    let last;
    for (let i = 0; i < 2; i++) {
        try {
            const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://app.dekoormx.com', 'X-Title': 'Dekoor CRM shadow evaluation' },
                body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
            });
            last = await res.json().catch(() => null);
            attempts.push({ http: res.status, data: last });
            if (i === 0 && (res.status === 429 || res.status >= 500)) { await sleep(900); continue; }
            break;
        } catch (e) {
            attempts.push({ http: null, error: e.name || 'Error' });
            if (i === 0 && /timeout|aborted|fetch failed|network|econnreset|terminated/i.test(String(e.message))) { await sleep(900); continue; }
            break;
        }
    }
    const summary = responseSummary(last || {}, Date.now() - start);
    const lastHttp = attempts.at(-1)?.http;
    summary.complete = summary.complete && lastHttp >= 200 && lastHttp < 300;
    // Even a timeout can have been billed; retain the reservation if any cost is unknown.
    const knownCosts = attempts.map(a => a.data?.usage?.cost);
    summary.costUsd = knownCosts.every(v => Number.isFinite(v) && v >= 0) ? knownCosts.reduce((a, b) => a + b, 0) : null;
    return { attempts, summary };
}

module.exports = { MODELS, MAX_BYTES, encryptionKey, seal, unseal, fingerprint, validRun, chooseCohort, replayPayload, reservationFor, responseSummary, compare };
