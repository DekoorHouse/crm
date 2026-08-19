/**
 * Alerta por WhatsApp cuando el SALDO de OpenRouter (los créditos prepagados con los que
 * Andrea contesta) está por agotarse. Si se acaban, Andrea deja de responder a los clientes.
 *
 * Cada 3 horas consulta el saldo en la API de OpenRouter (GET /api/v1/credits →
 * total_credits, total_usage) y, al cruzar HACIA ABAJO un umbral de dólares restantes
 * (20, 10, 5, 2 por default), manda UN WhatsApp al admin con el disponible y una estimación
 * de cuántos días quedan al ritmo de gasto reciente.
 *
 * Solo corre cuando el proveedor activo del chat es 'openrouter' (crm_settings/general.
 * aiChatProvider); si se usa Gemini u OpenAI, no tiene caso vigilar este saldo y el barrido
 * se salta en silencio. Hermano de spendCapAlertScheduler.js (misma mecánica, invertida:
 * aquel avisa al SUBIR el % gastado; este al BAJAR los dólares disponibles).
 *
 * Anti-spam: en crm_settings/openrouter_credit_alert se guarda el último umbral avisado.
 * Solo se vuelve a avisar al cruzar un umbral MENOR (más grave). Si detecta una RECARGA
 * (subió total_credits o el disponible creció), limpia el estado y rearma los avisos.
 *
 * Variables de entorno:
 *  - OPENROUTER_ALERT_PHONE      (default ADMIN_ALERT_PHONE → '5216182297167')
 *  - OPENROUTER_ALERT_THRESHOLDS (default '20,10,5,2', dólares restantes)
 *  - OPENROUTER_ALERT_CRON       (default: cada 3 horas en punto)
 *  - OPENROUTER_ALERT_TEMPLATE   (opcional: plantilla aprobada; si no, texto libre)
 *  - OPENROUTER_API_KEY          (la misma que usa el chat)
 */
const cron = require('node-cron');
const { db, admin } = require('../config');
const { sendAdvancedWhatsAppMessage, sendApprovedTemplateMessage } = require('../services');

const CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
const TOPUP_URL = 'https://openrouter.ai/settings/credits';
const ALERT_PHONE = process.env.OPENROUTER_ALERT_PHONE || process.env.ADMIN_ALERT_PHONE || '5216182297167';
const ALERT_TEMPLATE = process.env.OPENROUTER_ALERT_TEMPLATE || '';
const STATE_DOC = 'openrouter_credit_alert';
const TIMEZONE = 'America/Mexico_City';

// Un cron inválido en la env tira cron.schedule (y el proceso) en el arranque.
const RAW_CRON = process.env.OPENROUTER_ALERT_CRON || '0 */3 * * *';
const CRON_SCHEDULE = cron.validate(RAW_CRON) ? RAW_CRON : '0 */3 * * *';
if (CRON_SCHEDULE !== RAW_CRON) {
    console.warn(`[OR-CREDIT] OPENROUTER_ALERT_CRON inválido ("${RAW_CRON}"); usando "0 */3 * * *"`);
}

function parseThresholds() {
    const raw = process.env.OPENROUTER_ALERT_THRESHOLDS || '20,10,5,2';
    const nums = raw.split(',')
        .map(s => Number(s.trim()))
        .filter(n => Number.isFinite(n) && n > 0);
    if (!nums.length) return [20, 10, 5, 2];
    // Descendente: el primero es el aviso más temprano, el último el más grave.
    return [...new Set(nums)].sort((a, b) => b - a);
}
const THRESHOLDS = parseThresholds();

let scheduledTask = null;
let sweepStartedAt = 0;
const SWEEP_LOCK_MS = 5 * 60 * 1000;

async function getActiveProvider() {
    try {
        const g = await db.collection('crm_settings').doc('general').get();
        return g.exists ? String(g.data().aiChatProvider || 'gemini').toLowerCase() : 'gemini';
    } catch (_) {
        return 'gemini';
    }
}

async function fetchOpenRouterBalance() {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('Falta OPENROUTER_API_KEY');
    const res = await fetch(CREDITS_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) {
        const msg = (j && j.error && (j.error.message || j.error)) || `HTTP ${res.status}`;
        throw new Error(`API de créditos de OpenRouter: ${msg}`);
    }
    const d = (j && j.data) || j || {};
    const credits = Number(d.total_credits || 0);
    const usage = Number(d.total_usage || 0);
    return { credits, usage, remaining: Math.max(0, credits - usage) };
}

/** El umbral más grave (menor) que el disponible YA cruzó hacia abajo. */
function currentTier(remaining) {
    const crossed = THRESHOLDS.filter(t => remaining <= t);
    return crossed.length ? Math.min(...crossed) : null;
}

function fmtUsd(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildAlertText({ remaining, burnPerDay, daysLeft }) {
    const sinSaldo = remaining < 0.5;
    const header = sinSaldo
        ? '🚨 *OpenRouter SIN saldo*'
        : '⚠️ *Saldo de OpenRouter bajo*';
    const cta = sinSaldo
        ? 'Andrea puede dejar de contestar a los clientes. Recarga cuanto antes:'
        : 'Recarga para que Andrea no deje de contestar:';
    const lines = [header, '', `*Disponible:* ${fmtUsd(remaining)} USD`];
    if (burnPerDay > 0) {
        const dias = daysLeft != null && isFinite(daysLeft)
            ? (daysLeft < 1 ? 'menos de 1 día' : `~${Math.round(daysLeft)} día(s)`)
            : '';
        lines.push(`*Ritmo:* ~${fmtUsd(burnPerDay)}/día${dias ? ` (${dias})` : ''}`);
    }
    lines.push('', cta, TOPUP_URL);
    return lines.join('\n');
}

async function sendAlert(info) {
    if (ALERT_TEMPLATE) {
        try {
            await sendApprovedTemplateMessage(ALERT_PHONE, ALERT_TEMPLATE, [
                fmtUsd(info.remaining),
                info.burnPerDay > 0 ? `${fmtUsd(info.burnPerDay)}/día` : 'n/d',
                TOPUP_URL,
            ], { source: 'openrouter_credit_alert' });
            return 'template';
        } catch (tplErr) {
            console.warn(`[OR-CREDIT] Plantilla "${ALERT_TEMPLATE}" falló (${tplErr.message}). Fallback a texto libre.`);
        }
    }
    await sendAdvancedWhatsAppMessage(ALERT_PHONE, { text: buildAlertText(info) });
    return 'texto_libre';
}

/**
 * Un barrido: consulta el saldo, estima el ritmo de gasto y decide si avisar.
 * `dryRun` no envía ni escribe estado. `force` reenvía el umbral actual aunque ya se haya avisado.
 */
async function runOpenRouterCreditAlertSweep({ force = false, dryRun = false } = {}) {
    if (sweepStartedAt && Date.now() - sweepStartedAt < SWEEP_LOCK_MS) {
        return { skipped: true, reason: 'sweep_en_curso' };
    }
    sweepStartedAt = Date.now();
    try {
        const provider = await getActiveProvider();
        if (provider !== 'openrouter' && !force) {
            return { skipped: true, reason: `proveedor_activo=${provider}` };
        }
        if (!process.env.OPENROUTER_API_KEY) {
            return { skipped: true, reason: 'sin_OPENROUTER_API_KEY' };
        }

        const { credits, usage, remaining } = await fetchOpenRouterBalance();

        const stateRef = db.collection('crm_settings').doc(STATE_DOC);
        const snap = await stateRef.get();
        const prev = (snap.exists && snap.data()) || {};

        // Ritmo de gasto: cuánto subió total_usage desde el último barrido, por día.
        let burnPerDay = 0;
        if (prev.lastUsage != null && prev.lastAt) {
            const hrs = (Date.now() - new Date(prev.lastAt).getTime()) / 36e5;
            const delta = usage - Number(prev.lastUsage);
            if (hrs > 0.05 && delta > 0) burnPerDay = (delta / hrs) * 24;
        }
        const daysLeft = burnPerDay > 0 ? remaining / burnPerDay : null;

        // ¿Recarga? Subió el total abonado, o el disponible creció de forma notable → rearmar.
        const recharged = prev.lastCredits != null &&
            (credits > Number(prev.lastCredits) + 0.01 || remaining > Number(prev.lastRemaining || 0) + 1);
        let lastTier = recharged ? null : (prev.lastTier != null ? Number(prev.lastTier) : null);

        const tier = currentTier(remaining);
        const shouldAlert = tier !== null && (force || lastTier == null || tier < lastTier);

        const info = { remaining, burnPerDay, daysLeft, tier, credits, usage };
        let via = null;
        if (shouldAlert && !dryRun) {
            try {
                via = await sendAlert(info);
                console.log(`[OR-CREDIT] ⚠️ Alerta enviada a ${ALERT_PHONE} vía ${via}: disponible ${fmtUsd(remaining)} (umbral $${tier})`);
                lastTier = tier;
            } catch (sendErr) {
                console.error(`[OR-CREDIT] No se pudo enviar la alerta:`, sendErr.message);
                info.error = sendErr.message;
            }
        }

        if (!dryRun) {
            await stateRef.set({
                lastCredits: credits,
                lastUsage: usage,
                lastRemaining: remaining,
                lastTier: lastTier,
                burnPerDay: Number(burnPerDay.toFixed(4)),
                thresholds: THRESHOLDS,
                alertPhone: ALERT_PHONE,
                lastAt: new Date().toISOString(),
                lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }

        return {
            dryRun, force, provider,
            remaining: Number(remaining.toFixed(4)),
            credits, usage: Number(usage.toFixed(4)),
            burnPerDay: Number(burnPerDay.toFixed(4)),
            daysLeft: daysLeft != null ? Number(daysLeft.toFixed(1)) : null,
            tier, alerted: shouldAlert, via, recharged,
        };
    } finally {
        sweepStartedAt = 0;
    }
}

/** Manda un mensaje de prueba al teléfono de alertas (verifica la entrega end-to-end). */
async function sendOpenRouterCreditTestAlert() {
    let saldo = '';
    try {
        const { remaining } = await fetchOpenRouterBalance();
        saldo = `\n\nAhora mismo tienes *${fmtUsd(remaining)} USD* disponibles.`;
    } catch (_) { /* la prueba de entrega no debe fallar por el saldo */ }
    await sendAdvancedWhatsAppMessage(ALERT_PHONE, {
        text: `🔔 *Prueba de alerta de saldo OpenRouter*\n\nAsí te avisaré cuando el saldo con el que Andrea contesta esté por agotarse, para que puedas recargar antes de que se quede sin responder. ✅${saldo}`,
    });
    return { sent: true, to: ALERT_PHONE };
}

function startOpenRouterCreditAlertScheduler() {
    if (scheduledTask) {
        console.log('[OR-CREDIT] Scheduler ya iniciado');
        return;
    }
    console.log(`[OR-CREDIT] Scheduler iniciado. Cron: "${CRON_SCHEDULE}". Umbrales: $${THRESHOLDS.join(', $')} USD. Aviso a: ${ALERT_PHONE}`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        runOpenRouterCreditAlertSweep().catch(e => console.error('[OR-CREDIT] Error en barrido:', e.message));
    }, { timezone: TIMEZONE });
}

module.exports = {
    startOpenRouterCreditAlertScheduler,
    runOpenRouterCreditAlertSweep,
    sendOpenRouterCreditTestAlert,
    fetchOpenRouterBalance,
};
