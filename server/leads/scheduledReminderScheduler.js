/**
 * Recordatorios programados a fecha futura — Scheduler + envío.
 *
 * Flujo:
 *   1) DETECCIÓN (en vivo): cuando el bot responde, si el cliente pidió que lo
 *      contacten más adelante ("en un mes", "cuando sepa el sexo del bebé"), se
 *      agenda un recordatorio en `scheduled_reminders/{waId}` con la fecha objetivo
 *      y el texto personalizado que redactó la IA. El operador puede ajustarlo/cancelarlo.
 *   2) ENVÍO (sweep): un cron revisa los recordatorios cuya fecha ya llegó y, como la
 *      ventana de 24h de WhatsApp está cerrada, los manda con una PLANTILLA APROBADA
 *      de Meta (nombre en cfg.templateName). {{1}}=nombre, {{2}}=texto personalizado.
 *   3) Cuando el cliente responde, el webhook normal reabre la ventana de 24h y el
 *      bot de venta / un humano retoma.
 *
 * Requiere (igual que carritos abandonados):
 *   WHATSAPP_TOKEN, PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID
 * y una plantilla aprobada en Meta. Si falta algo, el sweep solo loguea y no envía.
 *
 * Config editable: crm_settings/scheduled_reminders (ver DEFAULT_REMINDER_CONFIG).
 * Collection: scheduled_reminders (docId = wa_id)
 *   status: scheduled | sent | cancelled | expired | failed
 */
const cron = require('node-cron');
const axios = require('axios');
const { db, admin } = require('../config');
const { sendAdvancedWhatsAppMessage } = require('../services');
const { classifyDeferral } = require('./scheduledReminderClassifier');
const {
    normalizeReminderConfig,
    computeSendAtMs,
    sanitizeTemplateParam,
    hasDeferralHint,
    renderText,
    localHourOf,
    toMillis,
    HOUR_MS,
    DAY_MS
} = require('./scheduledReminderLogic');

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const CRON_SCHEDULE = process.env.SCHEDULED_REMINDER_CRON || '*/15 * * * *'; // cada 15 min
const MAX_ATTEMPTS = 3;
const CONFIG_CACHE_MS = 60 * 1000;

let cachedConfig = null;
let cachedConfigAt = 0;
let cachedTemplate = null;
let cachedTemplateAt = 0;
const TEMPLATE_CACHE_MS = 10 * 60 * 1000;
let scheduledTask = null;
let sweepRunning = false;

// --- Config -------------------------------------------------------------------
async function getReminderConfig(fresh = false) {
    const now = Date.now();
    if (!fresh && cachedConfig && (now - cachedConfigAt) < CONFIG_CACHE_MS) return cachedConfig;
    let raw = null;
    try {
        const doc = await db.collection('crm_settings').doc('scheduled_reminders').get();
        raw = doc.exists ? doc.data() : null;
    } catch (e) {
        console.warn('[REMINDER] No se pudo leer config, usando defaults:', e.message);
    }
    cachedConfig = normalizeReminderConfig(raw);
    cachedConfigAt = now;
    return cachedConfig;
}

async function saveReminderConfig(partial) {
    await db.collection('crm_settings').doc('scheduled_reminders').set({
        ...partial,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    cachedConfig = null;
    return getReminderConfig(true);
}

// Fecha local de hoy (YYYY-MM-DD) según el offset fijo, para dársela a la IA.
function todayLocalISO(cfg) {
    return new Date(Date.now() + cfg.utcOffsetHours * HOUR_MS).toISOString().slice(0, 10);
}

// --- Plantilla de Meta (patrón carritos abandonados) --------------------------
async function fetchApprovedTemplate(name) {
    const now = Date.now();
    if (cachedTemplate && cachedTemplate.name === name && (now - cachedTemplateAt) < TEMPLATE_CACHE_MS) {
        return cachedTemplate;
    }
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) {
        throw new Error('Faltan credenciales de WhatsApp Business (WHATSAPP_BUSINESS_ACCOUNT_ID/WHATSAPP_TOKEN)');
    }
    const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
    const approved = (res.data?.data || []).filter(t => t.status === 'APPROVED');
    const tpl = approved.find(t => t.name === name);
    if (!tpl) {
        const names = approved.map(t => t.name).join(', ') || '(ninguna)';
        throw new Error(`Plantilla "${name}" no encontrada o no aprobada. Aprobadas: ${names}`);
    }
    cachedTemplate = tpl;
    cachedTemplateAt = now;
    return tpl;
}

// Rellena los {{n}} del BODY con params en orden. Meta rechaza parámetros vacíos,
// así que garantizamos texto no vacío en cada uno.
function buildTemplatePayload(waId, template, params, cfg) {
    const body = (template.components || []).find(c => c.type === 'BODY');
    const matches = (body?.text || '').match(/\{\{\d+\}\}/g) || [];
    const components = [];
    if (matches.length > 0) {
        const parameters = [];
        for (let i = 0; i < matches.length; i++) {
            const val = sanitizeTemplateParam(params[i] != null ? params[i] : '') || '—';
            parameters.push({ type: 'text', text: val });
        }
        components.push({ type: 'body', parameters });
    }
    const payload = {
        messaging_product: 'whatsapp',
        to: waId,
        type: 'template',
        template: { name: template.name, language: { code: template.language || cfg.langCode } }
    };
    if (components.length > 0) payload.template.components = components;
    return payload;
}

// Reconstruye el texto renderizado (para reflejarlo en el chat del CRM).
function renderTemplateBody(template, params) {
    let text = (template.components || []).find(c => c.type === 'BODY')?.text || '';
    params.forEach((p, i) => { text = text.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), p); });
    return text;
}

async function sendReminderTemplate(waId, messageParam, cfg) {
    const template = await fetchApprovedTemplate(cfg.templateName);
    // La plantilla lleva UNA sola variable {{1}} = el mensaje. Sin nombre a propósito:
    // muchos contactos tienen nombres "raros" (no el suyo) y saludarlos así se siente mal.
    const params = [messageParam];
    const payload = buildTemplatePayload(waId, template, params, cfg);
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const res = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
    });
    const messageId = res.data?.messages?.[0]?.id || null;
    const renderedText = renderTemplateBody(template, params);

    // Reflejar en el chat del CRM para que el operador vea el envío
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(waId);
        await contactRef.collection('messages').add({
            from: PHONE_NUMBER_ID,
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: messageId,
            text: renderedText,
            templateName: template.name,
            source: 'scheduled_reminder'
        });
        await contactRef.update({
            lastMessage: renderedText.substring(0, 100),
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('[REMINDER] No se pudo reflejar el mensaje en el CRM:', e.message);
    }
    return { messageId, renderedText };
}

// --- Historial para el clasificador (paths sin historial prearmado) -----------
async function fetchRecentMessages(waId, limit) {
    const snap = await db.collection('contacts_whatsapp').doc(waId).collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();
    return snap.docs.map(d => d.data()).reverse();
}

function buildConvText(messageDocs, contactId) {
    return (messageDocs || []).map(d => {
        const who = d.from === contactId ? 'Cliente' : 'Asistente';
        let body = d.text;
        if (!body && d.type && d.type !== 'text') body = `[${d.type}]`;
        return `${who}: ${body || ''}`;
    }).join('\n');
}

// --- Armado del recordatorio --------------------------------------------------
/**
 * Crea/actualiza un recordatorio programado. Fuente 'ai' (detección) u 'operator'.
 * remindAt puede ser 'YYYY-MM-DD' o millis; se snapa a la hora de envío y se acota.
 */
async function armReminder(waId, { name, remindAt, context, reason, message, source, templateName, langCode }) {
    if (!waId) return { ok: false, reason: 'sin_waId' };
    const cfg = await getReminderConfig();
    const sendMs = computeSendAtMs(remindAt, Date.now(), cfg);
    if (!sendMs) return { ok: false, reason: 'fecha_invalida' };

    const ref = db.collection('scheduled_reminders').doc(waId);
    const prev = await ref.get();
    const nowTs = admin.firestore.Timestamp.now();

    await ref.set({
        waId,
        name: name || (prev.exists ? prev.data().name : null) || null,
        remindAt: admin.firestore.Timestamp.fromMillis(sendMs),
        context: context != null ? String(context).slice(0, 500) : (prev.exists ? prev.data().context : '') || '',
        reason: reason != null ? String(reason).slice(0, 200) : (prev.exists ? prev.data().reason : '') || '',
        message: sanitizeTemplateParam(message || ''),
        status: 'scheduled',
        source: source || 'operator',
        templateName: templateName || cfg.templateName,
        langCode: langCode || cfg.langCode,
        attempts: 0,
        lastError: null,
        // createdAt = momento de ESTE agendado (el guard "ya compró" del sweep compara
        // la fecha de compra contra createdAt; preservar uno viejo cancelaría de más).
        createdAt: nowTs,
        updatedAt: nowTs
    });
    return { ok: true, sendMs };
}

/**
 * Hook en vivo desde el bot (fire-and-forget). Detecta aplazamientos y agenda.
 * Barato: solo llama a Gemini si (a) la feature está activa, (b) hay pista de
 * aplazamiento en el historial y (c) NO hay ya un recordatorio agendado.
 */
async function detectAndArmReminder(contactId, contactRef, conversationHistory, name) {
    if (!conversationHistory) return;
    const cfg = await getReminderConfig();
    if (!cfg.enabled || !cfg.liveDetect) return;
    if (!hasDeferralHint(conversationHistory)) return;

    // Si ya hay un recordatorio agendado, el operador es dueño de él: no re-armar.
    const existing = await db.collection('scheduled_reminders').doc(contactId).get();
    if (existing.exists && existing.data().status === 'scheduled') return;

    const cls = await classifyDeferral({ conversationText: conversationHistory, name, todayISO: todayLocalISO(cfg) });
    if (!cls || !cls.defer || !cls.remindAt) return;

    const r = await armReminder(contactId, {
        name, remindAt: cls.remindAt, context: cls.context, reason: cls.reason,
        message: cls.message, source: 'ai'
    });
    if (r.ok) {
        console.log(`[REMINDER] ✓ Agendado (IA) para ${contactId} el ${new Date(r.sendMs).toISOString()} (${cls.reason || 's/motivo'})`);
    }
}

/**
 * Sugerencia para el botón del operador: analiza el chat y propone fecha + mensaje,
 * SIN guardar nada. Si la IA no detecta aplazamiento, devuelve un default editable.
 */
async function suggestReminderForContact(waId) {
    const cfg = await getReminderConfig();
    const msgs = await fetchRecentMessages(waId, 14);
    let contactName = null;
    try {
        const cs = await db.collection('contacts_whatsapp').doc(waId).get();
        contactName = cs.exists ? cs.data().name : null;
    } catch (_) {}

    const convText = buildConvText(msgs, waId);
    const cls = await classifyDeferral({ conversationText: convText, name: contactName, todayISO: todayLocalISO(cfg) });

    // Default editable: dentro de 30 días.
    const defaultDate = new Date(Date.now() + 30 * DAY_MS + cfg.utcOffsetHours * HOUR_MS).toISOString().slice(0, 10);
    if (!cls) {
        return { defer: false, remindDate: defaultDate, message: '', reason: '', context: '' };
    }
    return {
        defer: cls.defer,
        remindDate: cls.remindAt || defaultDate,
        message: cls.message || '',
        reason: cls.reason || '',
        context: cls.context || ''
    };
}

// --- Sweep de envío -----------------------------------------------------------
async function runReminderSweep({ dryRun = false } = {}) {
    if (sweepRunning) return { skipped: true, reason: 'sweep_en_curso' };
    sweepRunning = true;
    try {
        const cfg = await getReminderConfig();
        const summary = { evaluated: 0, sent: 0, waiting: 0, expired: 0, cancelled: 0, failed: 0, dryRun, wouldSend: [] };
        if (!cfg.enabled && !dryRun) return { ...summary, disabled: true };
        if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !WHATSAPP_BUSINESS_ACCOUNT_ID) {
            console.warn('[REMINDER] Saltando: faltan credenciales de WhatsApp.');
            return summary;
        }

        let snap;
        try {
            snap = await db.collection('scheduled_reminders')
                .where('status', '==', 'scheduled')
                .limit(cfg.maxPerSweep)
                .get();
        } catch (e) {
            console.error('[REMINDER] Error consultando recordatorios:', e.message);
            return { ...summary, error: e.message };
        }
        if (snap.empty) return summary;

        const nowMs = Date.now();
        for (const doc of snap.docs) {
            const rem = { id: doc.id, ...doc.data() };
            summary.evaluated++;

            const remindMs = toMillis(rem.remindAt);
            if (!remindMs) {
                if (!dryRun) await doc.ref.update({ status: 'failed', lastError: 'sin_fecha', updatedAt: new Date() }).catch(() => {});
                summary.failed++;
                continue;
            }
            if (nowMs < remindMs) { summary.waiting++; continue; } // aún no toca

            // Demasiado tarde (el sweep no corrió a tiempo): expira en vez de mandar viejo.
            if (nowMs - remindMs > cfg.graceDays * DAY_MS) {
                if (!dryRun) await doc.ref.update({ status: 'expired', updatedAt: new Date() }).catch(() => {});
                summary.expired++;
                continue;
            }
            // Solo dentro de horario laboral (defensa ante retrasos).
            const h = localHourOf(nowMs, cfg.utcOffsetHours);
            if (h < cfg.businessHours.start || h > cfg.businessHours.end) { summary.waiting++; continue; }

            // Leer contacto para nombre y para no molestar si ya compró después de agendar.
            let contact = null;
            try {
                const cs = await db.collection('contacts_whatsapp').doc(doc.id).get();
                contact = cs.exists ? cs.data() : null;
            } catch (_) {}
            const createdMs = toMillis(rem.createdAt) || 0;
            const orderMs = toMillis(contact && contact.lastOrderDate);
            if (orderMs && orderMs >= createdMs) {
                if (!dryRun) await doc.ref.update({ status: 'cancelled', cancelReason: 'ya_compro', updatedAt: new Date() }).catch(() => {});
                summary.cancelled++;
                continue;
            }

            const messageParam = sanitizeTemplateParam(rem.message) || renderText(cfg.fallbackMessage, (contact && contact.name) || rem.name);

            if (dryRun) {
                summary.wouldSend.push({ waId: doc.id, remindAt: new Date(remindMs).toISOString(), messageParam });
                continue;
            }

            try {
                const { messageId, renderedText } = await sendReminderTemplate(doc.id, messageParam, cfg);
                await doc.ref.update({
                    status: 'sent', sentAt: new Date(), messageId,
                    sentText: renderedText.slice(0, 300), attempts: 0, updatedAt: new Date()
                });
                summary.sent++;
                console.log(`[REMINDER] ✓ Enviado a ${doc.id} (msg: ${messageId})`);
            } catch (e) {
                const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                const attempts = (rem.attempts || 0) + 1;
                const upd = { attempts, lastError: String(detail).substring(0, 500), updatedAt: new Date() };
                if (attempts >= MAX_ATTEMPTS) upd.status = 'failed';
                await doc.ref.update(upd).catch(() => {});
                summary.failed++;
                console.error(`[REMINDER] ✗ ${doc.id}: ${detail}`);
            }
            await new Promise(r => setTimeout(r, 400)); // respiro anti rate-limit
        }
        return summary;
    } finally {
        sweepRunning = false;
    }
}

function startScheduledReminderScheduler() {
    if (scheduledTask) {
        console.log('[REMINDER] Scheduler ya iniciado');
        return;
    }
    console.log(`[REMINDER] Scheduler iniciado. Cron: ${CRON_SCHEDULE}`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        runReminderSweep().catch(e => console.error('[REMINDER] Sweep error:', e.message));
    });
}

module.exports = {
    startScheduledReminderScheduler,
    runReminderSweep,
    armReminder,
    detectAndArmReminder,
    suggestReminderForContact,
    getReminderConfig,
    saveReminderConfig
};
