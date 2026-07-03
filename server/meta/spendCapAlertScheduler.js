/**
 * Alerta por WhatsApp cuando el límite publicitario de Meta Ads está por topar.
 *
 * Cada 30 minutos consulta en la Graph API el límite de gasto de la cuenta
 * (spend_cap) y lo gastado contra ese límite (amount_spent) de cada cuenta
 * publicitaria monitoreada. Al cruzar un umbral (80%, 90%, 100% por default)
 * manda UN WhatsApp al admin por umbral: "límite de $8,000, gastado $7,000,
 * abona para que los anuncios no se detengan".
 *
 * Cuentas monitoreadas: las cuentas KPI (meta_ads_config/settings.kpiAccountIds,
 * las mismas que suman al costo_publicidad diario); si no hay, la cuenta activa;
 * si tampoco, la DEFAULT_ACCOUNT_ID. Cuentas sin límite configurado se ignoran.
 *
 * Anti-spam: en crm_settings/meta_spend_cap_alert se guarda el último umbral
 * avisado por cuenta. Solo se vuelve a avisar al cruzar un umbral MAYOR. Cuando
 * Meta reinicia el ciclo (cambia el spend_cap, o amount_spent cae de forma
 * significativa porque se abonó/reseteó el límite) el estado se limpia y los
 * avisos se rearman. Bajadas chicas de amount_spent (créditos por clics
 * inválidos, jitter de la Graph API) NO rearman.
 *
 * Variables de entorno:
 *  - SPEND_CAP_ALERT_PHONE      (default ADMIN_ALERT_PHONE → '5216182297167')
 *  - SPEND_CAP_ALERT_THRESHOLDS (default '80,90,100', porcentajes)
 *  - SPEND_CAP_ALERT_CRON       (default cada 30 min)
 *  - SPEND_CAP_ALERT_TEMPLATE   (opcional: plantilla aprobada de Meta; si no
 *    está o falla, se manda texto libre como el aviso de pagos OXXO)
 */
const cron = require('node-cron');
const axios = require('axios');
const { db, admin } = require('../config');
const { META_API_BASE, DEFAULT_ACCOUNT_ID, resolveToken } = require('./metaAdsHelpers');
const { getKpiAccountIds, getActiveAccount } = require('./metaAdsService');
const { sendAdvancedWhatsAppMessage, sendApprovedTemplateMessage } = require('../services');

const ALERT_PHONE = process.env.SPEND_CAP_ALERT_PHONE || process.env.ADMIN_ALERT_PHONE || '5216182297167';
const ALERT_TEMPLATE = process.env.SPEND_CAP_ALERT_TEMPLATE || '';
// Un cron inválido en la env tira cron.schedule (y el proceso) en el arranque.
const RAW_CRON = process.env.SPEND_CAP_ALERT_CRON || '*/30 * * * *';
const CRON_SCHEDULE = cron.validate(RAW_CRON) ? RAW_CRON : '*/30 * * * *';
if (CRON_SCHEDULE !== RAW_CRON) {
    console.warn(`[SPEND-CAP] SPEND_CAP_ALERT_CRON inválido ("${RAW_CRON}"); usando "*/30 * * * *"`);
}
const TIMEZONE = 'America/Mexico_City';
const STATE_DOC = 'meta_spend_cap_alert';

// Monedas que Meta maneja sin subdivisión (offset 1); el resto viene en centavos.
const ZERO_DECIMAL_CURRENCIES = new Set(['CLP', 'COP', 'CRC', 'HUF', 'IDR', 'ISK', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']);

function parseThresholds() {
    const raw = process.env.SPEND_CAP_ALERT_THRESHOLDS || '80,90,100';
    const nums = raw.split(',')
        .map(s => Number(s.trim()))
        .filter(n => Number.isFinite(n) && n > 0 && n <= 200);
    if (!nums.length) return [80, 90, 100];
    return [...new Set(nums)].sort((a, b) => a - b);
}
const THRESHOLDS = parseThresholds();

let scheduledTask = null;
// Candado con expiración: si una request a Meta queda colgada, el candado se
// libera solo a los 10 min en vez de deshabilitar el scheduler hasta el reinicio.
let sweepStartedAt = 0;
const SWEEP_LOCK_MS = 10 * 60 * 1000;

function toMoney(rawUnits, currency) {
    const divisor = ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
    return rawUnits / divisor;
}

function fmtMoney(amount, currency) {
    return `$${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/**
 * Cuentas a monitorear, en cascada:
 * 1. crm_settings/meta_spend_cap_alert.monitorAccountIds (lista propia de la alerta,
 *    para vigilar cuentas que no están en las KPI sin afectar el costo_publicidad)
 * 2. Cuentas KPI  3. Cuenta activa  4. DEFAULT_ACCOUNT_ID
 */
async function getMonitoredAccountIds() {
    const stateSnap = await db.collection('crm_settings').doc(STATE_DOC).get();
    const custom = stateSnap.exists ? stateSnap.data().monitorAccountIds : null;
    if (Array.isArray(custom) && custom.length) {
        return custom.map(id => String(id).replace('act_', '').trim()).filter(Boolean);
    }
    const kpiIds = await getKpiAccountIds();
    if (kpiIds.length) return kpiIds;
    const settings = await getActiveAccount();
    const active = settings?.activeAccountId ? String(settings.activeAccountId).replace('act_', '') : null;
    return [active || DEFAULT_ACCOUNT_ID];
}

async function fetchAccountSpendStatus(accountId) {
    const token = await resolveToken(accountId);
    const r = await axios.get(`${META_API_BASE}/act_${accountId}`, {
        params: { fields: 'name,currency,spend_cap,amount_spent,account_status', access_token: token },
        timeout: 15000
    });
    return r.data;
}

function buildAlertText({ name, accountId, currency, cap, spent, pct, tier }) {
    const remaining = Math.max(0, cap - spent);
    const billingUrl = `https://www.facebook.com/ads/manager/account_settings/account_billing/?act=${accountId}`;
    const header = tier >= 100
        ? '🚨 *Límite publicitario ALCANZADO*'
        : '⚠️ *Límite publicitario por agotarse*';
    const cta = tier >= 100
        ? 'Los anuncios de esta cuenta ya se detuvieron. Abona o sube el límite para reactivarlos:'
        : 'Abona o sube el límite para que los anuncios no se detengan:';
    return [
        header,
        '',
        `*Cuenta:* ${name || accountId}`,
        `*Límite:* ${fmtMoney(cap, currency)}`,
        `*Gastado:* ${fmtMoney(spent, currency)} (${pct.toFixed(1)}%)`,
        `*Disponible:* ${fmtMoney(remaining, currency)}`,
        '',
        cta,
        billingUrl
    ].join('\n');
}

async function sendAlert(info) {
    if (ALERT_TEMPLATE) {
        try {
            await sendApprovedTemplateMessage(ALERT_PHONE, ALERT_TEMPLATE, [
                info.name || info.accountId,
                fmtMoney(info.cap, info.currency),
                `${fmtMoney(info.spent, info.currency)} (${info.pct.toFixed(1)}%)`,
                fmtMoney(Math.max(0, info.cap - info.spent), info.currency)
            ], { source: 'spend_cap_alert' });
            return 'template';
        } catch (tplErr) {
            console.warn(`[SPEND-CAP] Plantilla "${ALERT_TEMPLATE}" falló (${tplErr.message}). Fallback a texto libre.`);
        }
    }
    await sendAdvancedWhatsAppMessage(ALERT_PHONE, { text: buildAlertText(info) });
    return 'texto_libre';
}

/**
 * Un barrido: consulta cada cuenta, decide si toca avisar y actualiza el estado.
 * `dryRun` no envía ni escribe estado, solo reporta qué haría. `force` reenvía
 * el umbral actual aunque ya se haya avisado (para pruebas).
 */
async function runSpendCapAlertSweep({ force = false, dryRun = false, accountIdsOverride = null } = {}) {
    if (sweepStartedAt && Date.now() - sweepStartedAt < SWEEP_LOCK_MS) {
        return { skipped: true, reason: 'sweep_en_curso' };
    }
    sweepStartedAt = Date.now();
    try {
        // El override es solo diagnóstico (?accounts= en la ruta): fuerza dryRun para
        // que un sondeo manual jamás envíe alertas ni pise el estado anti-spam.
        if (accountIdsOverride) dryRun = true;
        const accountIds = accountIdsOverride || await getMonitoredAccountIds();
        const stateRef = db.collection('crm_settings').doc(STATE_DOC);
        const stateSnap = await stateRef.get();
        const state = (stateSnap.exists && stateSnap.data().accounts) || {};
        // El set() final reemplaza el doc completo: conservar el estado de cuentas
        // fuera del barrido actual (p. ej. quitadas temporalmente de kpiAccountIds)
        // para no rearmar sus alertas si vuelven a la lista.
        const newState = {};
        for (const [id, entry] of Object.entries(state)) {
            if (!accountIds.includes(id)) newState[id] = entry;
        }
        const results = [];
        const alertsSent = [];

        for (const accountId of accountIds) {
            let data;
            try {
                data = await fetchAccountSpendStatus(accountId);
            } catch (err) {
                results.push({ accountId, error: err.response?.data?.error?.message || err.message });
                // Conservar el estado previo para no rearmar alertas por un error transitorio.
                if (state[accountId]) newState[accountId] = state[accountId];
                continue;
            }

            const currency = data.currency || 'MXN';
            const capRaw = Number(data.spend_cap || 0);
            const spentRaw = Number(data.amount_spent || 0);

            if (!capRaw) {
                results.push({ accountId, name: data.name, status: 'sin_limite_configurado' });
                // Una lectura transitoria sin spend_cap no debe rearmar alertas ya
                // enviadas; si el límite reaparece distinto o el gastado cayó, la
                // detección de "nuevo ciclo" rearma sola.
                if (state[accountId]) newState[accountId] = state[accountId];
                continue;
            }

            const cap = toMoney(capRaw, currency);
            const spent = toMoney(spentRaw, currency);
            const pct = (spentRaw / capRaw) * 100;

            let prev = state[accountId] || null;
            // Nuevo ciclo: cambió el límite o el gastado cayó de forma significativa
            // (abonó / Meta reseteó el contador, que lo deja en ~0). amount_spent NO es
            // monotónico: Meta acredita clics inválidos y esas bajadas chicas no rearman.
            const significantDrop = prev && (prev.spentRaw - spentRaw) >= capRaw * 0.2;
            if (prev && (prev.capRaw !== capRaw || significantDrop)) prev = null;

            // Umbral más alto ya cruzado con el % actual.
            const crossed = THRESHOLDS.filter(t => pct >= t).pop() || null;
            const lastTier = prev?.lastTier || null;
            const shouldAlert = crossed !== null && (force || !lastTier || crossed > lastTier);

            const info = { accountId, name: data.name, currency, cap, spent, pct, tier: crossed };
            let via = null;
            if (shouldAlert && !dryRun) {
                try {
                    via = await sendAlert(info);
                    console.log(`[SPEND-CAP] ⚠️ Alerta enviada a ${ALERT_PHONE} vía ${via}: ${data.name} al ${pct.toFixed(1)}% (umbral ${crossed}%)`);
                } catch (sendErr) {
                    console.error(`[SPEND-CAP] No se pudo enviar la alerta de ${accountId}:`, sendErr.message);
                    results.push({ accountId, name: data.name, pct: Number(pct.toFixed(1)), error: `envio_fallido: ${sendErr.message}` });
                    // No marcar el umbral como avisado: el siguiente barrido reintenta.
                    if (prev) newState[accountId] = prev;
                    continue;
                }
            }

            newState[accountId] = {
                capRaw,
                spentRaw,
                pct: Number(pct.toFixed(1)),
                name: data.name || null,
                lastTier: shouldAlert ? crossed : lastTier,
                ...(shouldAlert ? { alertedAt: new Date().toISOString() } : (prev?.alertedAt ? { alertedAt: prev.alertedAt } : {}))
            };

            if (via) {
                // Persistir de inmediato: un reinicio de Render (auto-deploy) o un fallo
                // del set final no debe reenviar esta alerta en el siguiente barrido.
                try {
                    await stateRef.set({ accounts: { [accountId]: newState[accountId] } }, { merge: true });
                } catch (persistErr) {
                    console.error(`[SPEND-CAP] No se pudo persistir el estado de ${accountId}:`, persistErr.message);
                }
            }

            const row = {
                accountId, name: data.name, status: data.account_status,
                cap, spent, pct: Number(pct.toFixed(1)),
                crossedTier: crossed, alerted: shouldAlert, via
            };
            results.push(row);
            if (shouldAlert) alertsSent.push(row);
        }

        if (!dryRun) {
            await stateRef.set({
                accounts: newState,
                lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
                thresholds: THRESHOLDS,
                alertPhone: ALERT_PHONE
            });
        }

        return { dryRun, force, thresholds: THRESHOLDS, alertPhone: ALERT_PHONE, alerts: alertsSent.length, results };
    } finally {
        sweepStartedAt = 0;
    }
}

/**
 * Manda un mensaje de prueba al teléfono de alertas (verifica la entrega
 * end-to-end sin depender de que un límite esté realmente por topar).
 */
async function sendSpendCapTestAlert() {
    await sendAdvancedWhatsAppMessage(ALERT_PHONE, {
        text: '🔔 *Prueba de alerta de límite publicitario*\n\nAsí te avisaré cuando el límite de gasto de una cuenta de Meta Ads esté por topar. ✅'
    });
    return { sent: true, to: ALERT_PHONE };
}

function startSpendCapAlertScheduler() {
    if (scheduledTask) {
        console.log('[SPEND-CAP] Scheduler ya iniciado');
        return;
    }
    console.log(`[SPEND-CAP] Scheduler iniciado. Cron: "${CRON_SCHEDULE}". Umbrales: ${THRESHOLDS.join('%, ')}%. Aviso a: ${ALERT_PHONE}`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        runSpendCapAlertSweep().catch(e => console.error('[SPEND-CAP] Error en barrido:', e.message));
    }, { timezone: TIMEZONE });
}

module.exports = {
    startSpendCapAlertScheduler,
    runSpendCapAlertSweep,
    sendSpendCapTestAlert
};
