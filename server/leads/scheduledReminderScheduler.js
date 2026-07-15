/**
 * Recordatorios programados — Scheduler + envío. Dos tipos (campo `kind`):
 *
 *   - 'date': el cliente difiere a otro día ("en un mes", "cuando sepa el sexo del bebé",
 *     "te pago el 15"). Para entonces la ventana de 24h de WhatsApp ya cerró, así que se
 *     manda con una PLANTILLA APROBADA de Meta (cfg.templateName).
 *   - 'short': el cliente se fue por unos minutos/horas HOY ("deme unos minutos", "ahorita
 *     te deposito"). La ventana sigue ABIERTA, así que se manda como mensaje normal (texto
 *     libre, sin costo de plantilla). El tono es de acompañar, NO de cobrar: la idea es que
 *     el cliente se acuerde de nosotros. Ver shortEnabled/shortDefaultHours en la config.
 *
 * Flujo:
 *   1) DETECCIÓN (en vivo): cuando el bot responde, si el cliente pidió tiempo, se agenda
 *      un recordatorio en `scheduled_reminders/{waId}` con el instante objetivo y el texto
 *      que redactó la IA. El operador puede ajustarlo/cancelarlo.
 *   2) ENVÍO (sweep): un cron revisa los recordatorios que ya vencieron y los manda.
 *   3) Si el cliente PAGA, el recordatorio se cancela solo (cancelReminderForContact, que
 *      se llama desde la validación del comprobante en services.js).
 *   4) Cuando el cliente responde, el webhook normal reabre la ventana de 24h y el
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
const { sendAdvancedWhatsAppMessage, sendMessengerMessage } = require('../services');
const { classifyDeferral } = require('./scheduledReminderClassifier');
const {
    normalizeReminderConfig,
    computeSendAtMs,
    computeShortSendAtMs,
    sanitizeTemplateParam,
    hasDeferralHint,
    isWhatsAppContact,
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

/**
 * Envío de un recordatorio CORTO: como la ventana de 24h sigue abierta, va como mensaje
 * NORMAL (texto libre) — sin plantilla, sin costo de Meta y sin el "¡Hola! 👋" de la
 * plantilla. Por eso mismo SÍ sirve en Messenger/Instagram (las plantillas no: son
 * exclusivas de WhatsApp). sendAdvancedWhatsAppMessage NO persiste en Firestore (devuelve
 * el texto para que lo guarde quien llama), así que aquí lo reflejamos en el chat del CRM.
 */
async function sendReminderFreeText(contactId, message, contact = null) {
    const channel = (contact && contact.channel) || 'whatsapp';
    let sent;
    if (channel === 'messenger' || channel === 'instagram') {
        const recipientId = (contact && (contact.psid || contact.igsid)) || contactId.replace(/^(fb_|ig_)/, '');
        const r = await sendMessengerMessage(recipientId, { text: message, channel });
        sent = { id: r.messages?.[0]?.id || null, textForDb: message };
    } else {
        sent = await sendAdvancedWhatsAppMessage(contactId, { text: message });
    }
    const renderedText = sent.textForDb || message;
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        await contactRef.collection('messages').add({
            from: PHONE_NUMBER_ID,
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: sent.id || null,
            text: renderedText,
            isAutoReply: true,
            channel,
            source: 'scheduled_reminder'
        });
        await contactRef.update({
            lastMessage: renderedText.substring(0, 100),
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('[REMINDER] No se pudo reflejar el recordatorio corto en el CRM:', e.message);
    }
    return { messageId: sent.id || null, renderedText };
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
 * Dos tipos (`kind`):
 *   - 'date' (default): remindAt 'YYYY-MM-DD' o millis; se snapa a la hora de envío y se acota.
 *     La ventana de 24h ya habrá cerrado, así que se manda con plantilla aprobada.
 *   - 'short': remindInHours (horas desde ahora, mismo día). Se manda con texto libre porque
 *     la ventana de 24h sigue abierta; `windowEndsAt` marca hasta cuándo se puede.
 */
async function armReminder(waId, { name, remindAt, remindInHours, kind, context, reason, message, source, templateName, langCode }) {
    if (!waId) return { ok: false, reason: 'sin_waId' };
    const cfg = await getReminderConfig();
    const isShort = kind === 'short';
    const nowMs = Date.now();
    const sendMs = isShort
        ? computeShortSendAtMs(remindInHours, nowMs, cfg)
        : computeSendAtMs(remindAt, nowMs, cfg);
    if (!sendMs) return { ok: false, reason: isShort ? 'horas_invalidas' : 'fecha_invalida' };

    const ref = db.collection('scheduled_reminders').doc(waId);
    const prev = await ref.get();
    const nowTs = admin.firestore.Timestamp.now();

    await ref.set({
        waId,
        name: name || (prev.exists ? prev.data().name : null) || null,
        remindAt: admin.firestore.Timestamp.fromMillis(sendMs),
        kind: isShort ? 'short' : 'date',
        // Solo 'short': hasta aquí la ventana de 24h de WhatsApp permite texto libre.
        windowEndsAt: isShort ? admin.firestore.Timestamp.fromMillis(nowMs + cfg.shortWindowHours * HOUR_MS) : null,
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
    return { ok: true, sendMs, kind: isShort ? 'short' : 'date' };
}

/**
 * Cancela el recordatorio agendado de un contacto (si tiene uno). Se llama cuando el motivo
 * del recordatorio desapareció — típicamente porque el cliente YA PAGÓ (ver la validación
 * del comprobante en services.js). Idempotente: si no hay recordatorio activo, no hace nada.
 */
async function cancelReminderForContact(waId, reason = 'ya_pago') {
    if (!waId) return { ok: false, reason: 'sin_waId' };
    const ref = db.collection('scheduled_reminders').doc(waId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== 'scheduled') return { ok: false, reason: 'sin_recordatorio' };
    await ref.update({
        status: 'cancelled',
        cancelReason: reason,
        updatedAt: admin.firestore.Timestamp.now()
    });
    console.log(`[REMINDER] ✓ Recordatorio de ${waId} cancelado (${reason}).`);
    return { ok: true };
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

    // Si el recordatorio agendado lo puso el OPERADOR, él es dueño de él: no re-armar.
    // Si lo agendó la IA, SÍ lo re-evaluamos: el cliente puede dar una fecha NUEVA más
    // adelante (ej. estaba para el 16 y hoy dice "sin falta el sábado") y hay que
    // REPROGRAMARLO; antes se salía aquí y el recordatorio quedaba con la fecha vieja.
    const existing = await db.collection('scheduled_reminders').doc(contactId).get();
    const prev = existing.exists ? existing.data() : null;
    const prevScheduled = !!(prev && prev.status === 'scheduled');
    if (prevScheduled && prev.source === 'operator') return;

    const cls = await classifyDeferral({ conversationText: conversationHistory, name, todayISO: todayLocalISO(cfg) });
    if (!cls || !cls.defer) return;

    // 'short' = el cliente se fue por unos minutos/horas (hoy): recordatorio dentro de la
    // ventana de 24h, con texto libre. 'date' = otro día: se agenda con plantilla.
    const isShort = cls.horizon === 'short';
    if (isShort && !cfg.shortEnabled) return;
    if (!isShort && !cls.remindAt) return;

    // Un recordatorio a fecha se manda con PLANTILLA, y las plantillas solo existen en
    // WhatsApp: agendarlo para un contacto de Messenger/Instagram es basura que solo va a
    // fallar en el sweep. El corto sí procede (texto libre dentro de la ventana de 24h).
    if (!isShort && !isWhatsAppContact(contactId)) {
        console.log(`[REMINDER] ${contactId} no es de WhatsApp: no se agenda recordatorio a fecha (requiere plantilla).`);
        return;
    }

    const nowMs = Date.now();
    const newMs = isShort
        ? computeShortSendAtMs(cls.remindInHours, nowMs, cfg)
        : computeSendAtMs(cls.remindAt, nowMs, cfg);
    if (!newMs) return;

    // Ya había uno de la IA: re-armar SOLO si de verdad cambió. Re-armar resetea createdAt
    // (del que depende el guard "ya compró" del sweep), así que no lo tocamos de más.
    // En los cortos el objetivo se recalcula desde AHORA, así que un mensaje nuevo del cliente
    // legítimamente empuja el recordatorio: el reloj arranca desde la última interacción.
    if (prevScheduled) {
        const prevKind = prev.kind === 'short' ? 'short' : 'date';
        const prevMs = toMillis(prev.remindAt) || 0;
        if (prevKind === (isShort ? 'short' : 'date') && Math.abs(newMs - prevMs) < 5 * 60 * 1000) return;
        console.log(`[REMINDER] Reprogramando ${contactId}: ${new Date(prevMs).toISOString()} → ${new Date(newMs).toISOString()} (${isShort ? 'corto' : 'fecha'}; el cliente dio un tiempo nuevo).`);
    }

    const r = await armReminder(contactId, {
        name, remindAt: cls.remindAt, remindInHours: cls.remindInHours,
        kind: isShort ? 'short' : 'date',
        context: cls.context, reason: cls.reason,
        message: cls.message, source: 'ai'
    });
    if (r.ok) {
        console.log(`[REMINDER] ✓ Agendado (IA, ${r.kind}) para ${contactId} el ${new Date(r.sendMs).toISOString()} (${cls.reason || 's/motivo'})`);
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
    // El modal del operador agenda por FECHA; un aplazamiento CORTO (de horas) no se representa
    // ahí, así que no lo proponemos como agendado — la IA ya lo maneja sola por su lado.
    const isShort = cls.horizon === 'short';
    return {
        defer: cls.defer && !isShort,
        remindDate: (!isShort && cls.remindAt) || defaultDate,
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

        const nowMs = Date.now();

        // Solo los que YA vencieron (remindAt <= ahora), del más viejo al más nuevo (FIFO).
        // Antes esto era where(status==scheduled).limit(40) SIN orden: Firestore devolvía los
        // primeros 40 por ID de documento y, como casi todos eran a futuro, se iban por 'waiting'
        // y ocupaban el cupo en cada barrido. Con 277 agendados el sweep quedó BLOQUEADO: los 40
        // que veía eran todos futuros, así que no hacía nada y 174 recordatorios ya vencidos
        // nunca se evaluaban (mismo bug que ya se había corregido en order_followup).
        // Requiere índice compuesto (status ASC, remindAt ASC) — ver firestore.indexes.json.
        let snap;
        try {
            snap = await db.collection('scheduled_reminders')
                .where('status', '==', 'scheduled')
                .where('remindAt', '<=', admin.firestore.Timestamp.fromMillis(nowMs))
                .orderBy('remindAt', 'asc')
                .limit(cfg.maxPerSweep)
                .get();
        } catch (e) {
            console.error('[REMINDER] Error consultando recordatorios:', e.message);
            return { ...summary, error: e.message };
        }
        if (snap.empty) return summary;
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

            const isShort = rem.kind === 'short';

            // Demasiado tarde (el sweep no corrió a tiempo): expira en vez de mandar viejo.
            // Los cortos caducan mucho antes: un "¿cómo vas?" de hace 2 días no tiene sentido.
            if (nowMs - remindMs > (isShort ? cfg.shortGraceHours * HOUR_MS : cfg.graceDays * DAY_MS)) {
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

            const fallback = isShort ? cfg.shortFallbackMessage : cfg.fallbackMessage;
            const messageParam = sanitizeTemplateParam(rem.message) || renderText(fallback, (contact && contact.name) || rem.name);

            // Los cortos van con texto libre mientras la ventana de 24h siga abierta. Si el sweep
            // se atrasó tanto que ya cerró, caemos a la plantilla en vez de dejarlo sin nada.
            const windowEndsMs = toMillis(rem.windowEndsAt) || (createdMs + cfg.shortWindowHours * HOUR_MS);
            const asFreeText = isShort && nowMs < windowEndsMs;

            if (dryRun) {
                summary.wouldSend.push({ waId: doc.id, remindAt: new Date(remindMs).toISOString(), messageParam, via: asFreeText ? 'texto_libre' : 'plantilla' });
                continue;
            }

            try {
                const { messageId, renderedText } = asFreeText
                    ? await sendReminderFreeText(doc.id, messageParam, contact)
                    : await sendReminderTemplate(doc.id, messageParam, cfg);
                await doc.ref.update({
                    status: 'sent', sentAt: new Date(), messageId,
                    sentText: renderedText.slice(0, 300), attempts: 0, updatedAt: new Date()
                });
                summary.sent++;
                console.log(`[REMINDER] ✓ Enviado a ${doc.id} vía ${asFreeText ? 'texto libre' : 'plantilla'} (msg: ${messageId})`);
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
    cancelReminderForContact,
    detectAndArmReminder,
    suggestReminderForContact,
    getReminderConfig,
    saveReminderConfig
};
