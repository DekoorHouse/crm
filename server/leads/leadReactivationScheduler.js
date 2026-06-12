/**
 * Reactivación de leads - Scheduler automático
 *
 * Cuando un cliente escribe por WhatsApp y NO registra pedido, se le envía
 * una secuencia de mensajes de seguimiento (default: a los 15 min y a las 4h
 * del último mensaje). La secuencia:
 *   - se REINICIA con cada mensaje nuevo del cliente (armLeadFollowup, hook
 *     en whatsappHandler)
 *   - se CANCELA si registra pedido (contacts_whatsapp.lastOrderDate >= último
 *     mensaje entrante)
 *   - NO aplica a clientes con pedido reciente (minDaysSinceLastOrder)
 *   - respeta la ventana de 24h de WhatsApp (después solo aplicaría plantilla,
 *     aquí simplemente expira)
 *
 * Config editable en Firestore: crm_settings/lead_reactivation
 * (ver DEFAULT_CONFIG en leadReactivationLogic.js). API en /api/leads.
 * Los envíos quedan reflejados en el chat del CRM (source: 'lead_reactivation').
 *
 * Collection: lead_followups (docId = wa_id)
 *   { waId, name, lastInboundAt, stage, status, attempts, totalSent, sentLog }
 *   status: pending | done | cancelled | expired | skipped_recent_customer | failed
 */
const cron = require('node-cron');
const { db, admin } = require('../config');
const { sendAdvancedWhatsAppMessage } = require('../services');
const { normalizeConfig, evaluateFollowup, toMillis } = require('./leadReactivationLogic');

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const CRON_SCHEDULE = process.env.LEAD_REACTIVATION_CRON || '*/2 * * * *'; // cada 2 min
const MAX_SEND_ATTEMPTS = 3;
const CONFIG_CACHE_MS = 60 * 1000;

let cachedConfig = null;
let cachedConfigAt = 0;
let scheduledTask = null;
let sweepRunning = false;

async function getReactivationConfig(fresh = false) {
    const now = Date.now();
    if (!fresh && cachedConfig && (now - cachedConfigAt) < CONFIG_CACHE_MS) return cachedConfig;
    let raw = null;
    try {
        const doc = await db.collection('crm_settings').doc('lead_reactivation').get();
        raw = doc.exists ? doc.data() : null;
    } catch (e) {
        console.warn('[LEAD_REACT] No se pudo leer config, usando defaults:', e.message);
    }
    cachedConfig = normalizeConfig(raw);
    cachedConfigAt = now;
    return cachedConfig;
}

async function saveReactivationConfig(partial) {
    await db.collection('crm_settings').doc('lead_reactivation').set({
        ...partial,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    cachedConfig = null; // invalidar caché
    return getReactivationConfig(true);
}

/**
 * (Re)arma la secuencia de seguimiento para un contacto. Se llama con cada
 * mensaje entrante de WhatsApp: el timer se reinicia porque el cliente acaba
 * de escribir. Fire-and-forget desde el webhook.
 */
async function armLeadFollowup(waId, name) {
    if (!waId) return;
    const config = await getReactivationConfig();
    if (!config.enabled) return;

    const ref = db.collection('lead_followups').doc(waId);
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() : null;

    // Cooldown anti-spam: si una secuencia ya terminó (envió mensajes) hace
    // poco, no iniciar otra solo porque el cliente volvió a escribir.
    if (prev && prev.status !== 'pending') {
        const lastSentMs = toMillis(prev.lastSentAt);
        if (lastSentMs && (Date.now() - lastSentMs) < config.cooldownHours * 60 * 60 * 1000) return;
    }

    const now = admin.firestore.Timestamp.now();
    await ref.set({
        waId,
        name: name || (prev && prev.name) || null,
        lastInboundAt: now,
        stage: 0,
        status: 'pending',
        attempts: 0,
        totalSent: (prev && prev.totalSent) || 0,
        sentLog: (prev && prev.sentLog) || [],
        createdAt: (prev && prev.createdAt) || now,
        updatedAt: now
    });
}

// Envía el mensaje y lo refleja en el chat del CRM para que el operador lo vea
async function sendFollowupMessage(waId, text) {
    const result = await sendAdvancedWhatsAppMessage(waId, { text });
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(waId);
        await contactRef.collection('messages').add({
            from: PHONE_NUMBER_ID,
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: result.id,
            text: result.textForDb,
            source: 'lead_reactivation'
        });
        await contactRef.update({
            lastMessage: (result.textForDb || '').substring(0, 100),
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('[LEAD_REACT] No se pudo reflejar el mensaje en el CRM:', e.message);
    }
    return result.id;
}

const TERMINAL_STATUS = {
    done: 'done',
    expire: 'expired',
    cancel: 'cancelled',
    skip_recent: 'skipped_recent_customer'
};

async function runLeadReactivationSweep({ dryRun = false } = {}) {
    if (sweepRunning) return { skipped: true, reason: 'sweep_en_curso' };
    sweepRunning = true;
    try {
        const config = await getReactivationConfig();
        const summary = { evaluated: 0, sent: 0, waiting: 0, finished: 0, errors: 0, dryRun, wouldSend: [] };
        if (!config.enabled) return { ...summary, disabled: true };
        if (!process.env.WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
            console.warn('[LEAD_REACT] Saltando: faltan credenciales de WhatsApp.');
            return summary;
        }

        let snap;
        try {
            snap = await db.collection('lead_followups')
                .where('status', '==', 'pending')
                .limit(config.maxPerSweep)
                .get();
        } catch (e) {
            console.error('[LEAD_REACT] Error consultando seguimientos:', e.message);
            return { ...summary, errors: 1 };
        }
        if (snap.empty) return summary;

        const nowMs = Date.now();
        for (const doc of snap.docs) {
            const followup = { id: doc.id, ...doc.data() };
            summary.evaluated++;

            let contact = null;
            try {
                const contactSnap = await db.collection('contacts_whatsapp').doc(doc.id).get();
                contact = contactSnap.exists ? contactSnap.data() : null;
            } catch (e) {
                console.error(`[LEAD_REACT] Error leyendo contacto ${doc.id}:`, e.message);
                summary.errors++;
                continue;
            }

            const verdict = evaluateFollowup(followup, contact, config, nowMs);

            if (verdict.action === 'wait' || verdict.action === 'none') {
                summary.waiting++;
                continue;
            }

            if (verdict.action !== 'send') {
                await doc.ref.update({
                    status: TERMINAL_STATUS[verdict.action] || 'cancelled',
                    cancelReason: verdict.reason || null,
                    updatedAt: new Date()
                }).catch(() => {});
                summary.finished++;
                continue;
            }

            if (dryRun) {
                summary.wouldSend.push({ waId: doc.id, stage: verdict.stage, text: verdict.text });
                continue;
            }

            try {
                const messageId = await sendFollowupMessage(doc.id, verdict.text);
                const newStage = verdict.stage + 1;
                const isLast = newStage >= config.followups.length;
                await doc.ref.update({
                    stage: newStage,
                    status: isLast ? 'done' : 'pending',
                    lastSentAt: new Date(),
                    totalSent: admin.firestore.FieldValue.increment(1),
                    attempts: 0,
                    sentLog: admin.firestore.FieldValue.arrayUnion({ stage: verdict.stage, at: new Date(), messageId }),
                    updatedAt: new Date()
                });
                summary.sent++;
                console.log(`[LEAD_REACT] ✓ Seguimiento ${verdict.stage + 1}/${config.followups.length} enviado a ${doc.id}`);
            } catch (e) {
                const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                const attempts = (followup.attempts || 0) + 1;
                const update = { attempts, lastError: detail.substring(0, 500), updatedAt: new Date() };
                if (attempts >= MAX_SEND_ATTEMPTS) update.status = 'failed';
                await doc.ref.update(update).catch(() => {});
                summary.errors++;
                console.error(`[LEAD_REACT] ✗ ${doc.id}: ${detail}`);
            }

            // Pequeña pausa entre envíos para no rozar rate limits
            await new Promise(r => setTimeout(r, 400));
        }
        return summary;
    } finally {
        sweepRunning = false;
    }
}

function startLeadReactivationScheduler() {
    if (scheduledTask) {
        console.log('[LEAD_REACT] Scheduler ya iniciado');
        return;
    }
    console.log(`[LEAD_REACT] Scheduler iniciado. Cron: ${CRON_SCHEDULE}`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        runLeadReactivationSweep().catch(e => console.error('[LEAD_REACT] Sweep error:', e.message));
    });
}

module.exports = {
    startLeadReactivationScheduler,
    runLeadReactivationSweep,
    armLeadFollowup,
    getReactivationConfig,
    saveReactivationConfig
};
