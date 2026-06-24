/**
 * Seguimiento de "pedido en proceso" — Scheduler.
 *
 * Flujo:
 *   1) Cada mensaje entrante (re)arma un seguimiento en `order_followups/{wa_id}`,
 *      planeando hasta 2 envíos dentro de las 24h y en horario laboral (planSends).
 *      El timer se REINICIA con cada mensaje del cliente.
 *   2) Un sweep periódico evalúa los pendientes. Cuando vence el 1er envío:
 *        - lee una etiqueta "en vivo" del contacto si el bot ya clasificó (híbrido), o
 *        - clasifica con IA la conversación (orderIntentClassifier).
 *      Si la IA dice que NO es un pedido en proceso -> se cancela (no se molesta).
 *      Si dice que SÍ -> se envían los mensajes personalizados en su horario.
 *   3) Se CANCELA si el cliente registra pedido (contacts_whatsapp.lastOrderDate).
 *
 * Config editable en Firestore: crm_settings/order_followup (ver DEFAULT_ORDER_CONFIG).
 * Los envíos se reflejan en el chat del CRM (source: 'order_followup').
 *
 * Collection: order_followups (docId = wa_id)
 *   { waId, track:'order_in_progress', name, lastInboundAt, scheduledSends:[ms,...],
 *     stage, status, classified, enProceso, pendiente, datosDados, mensajes, attempts,
 *     totalSent, sentLog, lastSentAt, createdAt, updatedAt }
 *   status: pending | done | cancelled | expired | skipped_recent_customer | failed
 */
const cron = require('node-cron');
const { db, admin } = require('../config');
const { sendAdvancedWhatsAppMessage } = require('../services');
const { classifyOrderIntent } = require('./orderIntentClassifier');
const { recordOrderFollowupSend } = require('./orderFollowupMetrics');
const {
    normalizeOrderConfig,
    planSends,
    evaluateOrderFollowup,
    resolveStageText,
    buildConversationText,
    toMillis
} = require('./orderFollowupLogic');

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const CRON_SCHEDULE = process.env.ORDER_FOLLOWUP_CRON || '*/2 * * * *'; // cada 2 min
const MAX_ATTEMPTS = 3;
const CONFIG_CACHE_MS = 60 * 1000;

let cachedConfig = null;
let cachedConfigAt = 0;
let scheduledTask = null;
let sweepRunning = false;

async function getOrderFollowupConfig(fresh = false) {
    const now = Date.now();
    if (!fresh && cachedConfig && (now - cachedConfigAt) < CONFIG_CACHE_MS) return cachedConfig;
    let raw = null;
    try {
        const doc = await db.collection('crm_settings').doc('order_followup').get();
        raw = doc.exists ? doc.data() : null;
    } catch (e) {
        console.warn('[ORDER_FOLLOWUP] No se pudo leer config, usando defaults:', e.message);
    }
    cachedConfig = normalizeOrderConfig(raw);
    cachedConfigAt = now;
    return cachedConfig;
}

async function saveOrderFollowupConfig(partial) {
    await db.collection('crm_settings').doc('order_followup').set({
        ...partial,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    cachedConfig = null;
    return getOrderFollowupConfig(true);
}

/**
 * (Re)arma la secuencia de seguimiento de pedido para un contacto. Se llama con cada
 * mensaje entrante: la ventana de 24h se reinicia, así que re-planeamos desde ahora.
 * Fire-and-forget desde el webhook.
 */
async function armOrderFollowup(waId, name) {
    if (!waId) return;
    const cfg = await getOrderFollowupConfig();
    if (!cfg.enabled) return;

    const ref = db.collection('order_followups').doc(waId);
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() : null;

    // Cooldown anti-spam: si una secuencia ya terminó (con envíos) hace poco, no reiniciar
    if (prev && prev.status !== 'pending') {
        const lastSentMs = toMillis(prev.lastSentAt);
        if (lastSentMs && (Date.now() - lastSentMs) < cfg.cooldownHours * 60 * 60 * 1000) return;
    }

    const nowTs = admin.firestore.Timestamp.now();
    const sends = planSends(nowTs.toMillis(), cfg);
    if (sends.length === 0) return; // no cabe ningún envío en horario/ventana

    await ref.set({
        waId,
        track: 'order_in_progress',
        name: name || (prev && prev.name) || null,
        lastInboundAt: nowTs,
        scheduledSends: sends,
        stage: 0,
        status: 'pending',
        classified: false,
        enProceso: null,
        pendiente: null,
        datosDados: null,
        mensajes: null,
        attempts: 0,
        totalSent: (prev && prev.totalSent) || 0,
        sentLog: (prev && prev.sentLog) || [],
        createdAt: (prev && prev.createdAt) || nowTs,
        updatedAt: nowTs
    });
}

// Lee la etiqueta "en vivo" que el bot pudo dejar en el contacto (híbrido).
// Solo se usa si es reciente (dentro de la ventana de WhatsApp) para evitar datos viejos.
function readLiveTag(contact, cfg) {
    const tag = contact && contact.orderTag;
    if (!tag || typeof tag !== 'object') return null;
    const atMs = toMillis(tag.at);
    if (!atMs || (Date.now() - atMs) > cfg.windowHours * 60 * 60 * 1000) return null;
    return {
        enProceso: tag.enProceso === true,
        datosDados: Array.isArray(tag.datosDados) ? tag.datosDados : [],
        pendiente: typeof tag.pendiente === 'string' ? tag.pendiente : '',
        mensajes: Array.isArray(tag.mensajes) ? tag.mensajes : []
    };
}

async function fetchRecentMessages(waId, limit) {
    const snap = await db.collection('contacts_whatsapp').doc(waId).collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();
    // Devolver en orden cronológico ascendente
    return snap.docs.map(d => d.data()).reverse();
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
            source: 'order_followup'
        });
        await contactRef.update({
            lastMessage: (result.textForDb || '').substring(0, 100),
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('[ORDER_FOLLOWUP] No se pudo reflejar el mensaje en el CRM:', e.message);
    }
    return result.id;
}

const TERMINAL_STATUS = {
    done: 'done',
    expire: 'expired',
    cancel: 'cancelled',
    skip_recent: 'skipped_recent_customer'
};

async function runOrderFollowupSweep({ dryRun = false } = {}) {
    if (sweepRunning) return { skipped: true, reason: 'sweep_en_curso' };
    sweepRunning = true;
    try {
        const cfg = await getOrderFollowupConfig();
        const summary = { evaluated: 0, classified: 0, qualified: 0, sent: 0, waiting: 0, finished: 0, errors: 0, dryRun, wouldSend: [] };
        if (!cfg.enabled && !dryRun) return { ...summary, disabled: true };
        if (!process.env.WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
            console.warn('[ORDER_FOLLOWUP] Saltando: faltan credenciales de WhatsApp.');
            return summary;
        }

        let snap;
        try {
            snap = await db.collection('order_followups')
                .where('status', '==', 'pending')
                .limit(cfg.maxPerSweep)
                .get();
        } catch (e) {
            console.error('[ORDER_FOLLOWUP] Error consultando seguimientos:', e.message);
            return { ...summary, errors: 1 };
        }
        if (snap.empty) return summary;

        const nowMs = Date.now();
        for (const doc of snap.docs) {
            let followup = { id: doc.id, ...doc.data() };
            summary.evaluated++;

            let contact = null;
            try {
                const cs = await db.collection('contacts_whatsapp').doc(doc.id).get();
                contact = cs.exists ? cs.data() : null;
            } catch (e) {
                console.error(`[ORDER_FOLLOWUP] Error leyendo contacto ${doc.id}:`, e.message);
                summary.errors++;
                continue;
            }

            const verdict = evaluateOrderFollowup(followup, contact, cfg, nowMs);

            if (verdict.action === 'wait' || verdict.action === 'wait_hours' || verdict.action === 'none') {
                summary.waiting++;
                continue;
            }
            if (verdict.action !== 'send') {
                if (!dryRun) {
                    await doc.ref.update({
                        status: TERMINAL_STATUS[verdict.action] || 'cancelled',
                        cancelReason: verdict.reason || null,
                        updatedAt: new Date()
                    }).catch(() => {});
                }
                summary.finished++;
                continue;
            }

            // --- verdict.action === 'send' ---

            // Compuerta de clasificación antes del PRIMER envío de la secuencia
            if (!followup.classified) {
                let cls = readLiveTag(contact, cfg);
                if (!cls) {
                    const msgs = await fetchRecentMessages(doc.id, 14);
                    if (msgs.length < cfg.classifyMinMessages) {
                        if (!dryRun) await doc.ref.update({ status: 'cancelled', cancelReason: 'pocos_mensajes', updatedAt: new Date() }).catch(() => {});
                        summary.finished++;
                        continue;
                    }
                    const convText = buildConversationText(msgs, doc.id);
                    cls = await classifyOrderIntent({ conversationText: convText, name: (contact && contact.name) || followup.name });
                    summary.classified++;
                }

                if (!cls) {
                    // La IA falló: reintentar en el próximo sweep (sin marcar como enviado)
                    if (!dryRun) {
                        const attempts = (followup.attempts || 0) + 1;
                        const upd = { attempts, lastError: 'clasificacion_nula', updatedAt: new Date() };
                        if (attempts >= MAX_ATTEMPTS) upd.status = 'failed';
                        await doc.ref.update(upd).catch(() => {});
                    }
                    summary.errors++;
                    continue;
                }

                if (!cls.enProceso) {
                    if (!dryRun) {
                        await doc.ref.update({
                            status: 'cancelled', cancelReason: 'no_pedido_en_proceso',
                            classified: true, enProceso: false, updatedAt: new Date()
                        }).catch(() => {});
                    }
                    summary.finished++;
                    continue;
                }

                // Califica: guardamos la clasificación para reusarla en el 2º mensaje
                summary.qualified++;
                const persist = {
                    classified: true,
                    enProceso: true,
                    pendiente: cls.pendiente || null,
                    datosDados: cls.datosDados || [],
                    mensajes: cls.mensajes || [],
                    updatedAt: new Date()
                };
                if (!dryRun) await doc.ref.update(persist).catch(() => {});
                followup = { ...followup, ...persist };
            }

            const text = resolveStageText(followup, verdict.stage, cfg);

            if (dryRun) {
                summary.wouldSend.push({ waId: doc.id, stage: verdict.stage, pendiente: followup.pendiente || null, text });
                continue;
            }

            try {
                const messageId = await sendFollowupMessage(doc.id, text);
                const newStage = verdict.stage + 1;
                const isLast = newStage >= (followup.scheduledSends || []).length;
                await doc.ref.update({
                    stage: newStage,
                    status: isLast ? 'done' : 'pending',
                    lastSentAt: new Date(),
                    totalSent: admin.firestore.FieldValue.increment(1),
                    attempts: 0,
                    sentLog: admin.firestore.FieldValue.arrayUnion({ stage: verdict.stage, at: new Date(), messageId, text: String(text).slice(0, 200) }),
                    updatedAt: new Date()
                });
                // Registrar para métricas de rescate (colección durable, no se pierde al re-armar)
                recordOrderFollowupSend(doc.id, {
                    name: (contact && contact.name) || followup.name,
                    stage: verdict.stage, pendiente: followup.pendiente,
                    datosDados: followup.datosDados, text
                }).catch(err => console.warn('[ORDER_FOLLOWUP] recordSend falló:', err.message));
                summary.sent++;
                console.log(`[ORDER_FOLLOWUP] ✓ Seguimiento ${verdict.stage + 1}/${(followup.scheduledSends || []).length} a ${doc.id} (pendiente: ${followup.pendiente || '?'})`);
            } catch (e) {
                const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                const attempts = (followup.attempts || 0) + 1;
                const upd = { attempts, lastError: String(detail).substring(0, 500), updatedAt: new Date() };
                if (attempts >= MAX_ATTEMPTS) upd.status = 'failed';
                await doc.ref.update(upd).catch(() => {});
                summary.errors++;
                console.error(`[ORDER_FOLLOWUP] ✗ ${doc.id}: ${detail}`);
            }

            await new Promise(r => setTimeout(r, 400)); // respiro anti rate-limit
        }
        return summary;
    } finally {
        sweepRunning = false;
    }
}

// Devuelve el timestamp (ms) del último mensaje ENTRANTE (del cliente) de un contacto,
// o null si no tiene. El anclaje de la ventana de 24h es el último mensaje del cliente.
async function lastInboundMillis(waId) {
    const snap = await db.collection('contacts_whatsapp').doc(waId).collection('messages')
        .where('from', '==', waId)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
    if (snap.empty) return null;
    return toMillis(snap.docs[0].data().timestamp);
}

/**
 * Backfill: siembra seguimientos para conversaciones que YA existen (p. ej. de ayer)
 * y que llevan callado >= minSilenceHours, SIEMPRE que el último mensaje del cliente
 * siga dentro de la ventana de 24h (si no, no se puede texto libre y se omite).
 *
 * No envía nada: solo crea los docs `order_followups`. El sweep normal se encarga de
 * clasificar con IA y enviar dentro de horario/ventana. En dryRun solo lista candidatos.
 *
 * @param {{minSilenceHours?:number, dryRun?:boolean, limit?:number}} opts
 */
async function backfillOrderFollowups({ minSilenceHours = 8, dryRun = false, limit = 300 } = {}) {
    const cfg = await getOrderFollowupConfig(true);
    const nowMs = Date.now();
    const windowMs = cfg.windowHours * 60 * 60 * 1000;
    const minSilenceMs = minSilenceHours * 60 * 60 * 1000;
    const cutoff = admin.firestore.Timestamp.fromMillis(nowMs - windowMs);

    const result = {
        enabled: cfg.enabled, dryRun, minSilenceHours,
        scanned: 0, candidates: 0, armed: 0,
        skipped: { sin_inbound: 0, poco_silencio: 0, fuera_de_ventana: 0, ya_compro: 0, otro_canal: 0, ya_sembrado: 0 },
        sample: []
    };

    let snap;
    try {
        snap = await db.collection('contacts_whatsapp')
            .where('lastMessageTimestamp', '>=', cutoff)
            .orderBy('lastMessageTimestamp', 'desc')
            .limit(limit)
            .get();
    } catch (e) {
        console.error('[ORDER_FOLLOWUP] Backfill: error consultando contactos:', e.message);
        return { ...result, error: e.message };
    }

    for (const doc of snap.docs) {
        result.scanned++;
        const c = doc.data();
        const waId = doc.id;

        if (c.channel === 'messenger' || c.channel === 'instagram') { result.skipped.otro_canal++; continue; }

        const inboundMs = await lastInboundMillis(waId);
        if (!inboundMs) { result.skipped.sin_inbound++; continue; }

        const silence = nowMs - inboundMs;
        if (silence < minSilenceMs) { result.skipped.poco_silencio++; continue; }
        if (silence > windowMs) { result.skipped.fuera_de_ventana++; continue; }

        const orderMs = toMillis(c.lastOrderDate);
        if (orderMs && orderMs >= inboundMs) { result.skipped.ya_compro++; continue; }

        // No re-sembrar si ya hay un seguimiento vivo para esta misma conversación
        const existing = await db.collection('order_followups').doc(waId).get();
        if (existing.exists) {
            const prev = existing.data();
            if (prev.status === 'pending' && Math.abs((toMillis(prev.lastInboundAt) || 0) - inboundMs) < 60 * 1000) {
                result.skipped.ya_sembrado++; continue;
            }
        }

        const sends = planSends(inboundMs, cfg);
        if (sends.length === 0) { result.skipped.fuera_de_ventana++; continue; }

        result.candidates++;
        if (result.sample.length < 15) {
            result.sample.push({
                waId, name: c.name || null,
                silenceHours: +(silence / 3600000).toFixed(1),
                primerEnvio: new Date(sends[0]).toISOString()
            });
        }

        if (!dryRun) {
            const nowTs = admin.firestore.Timestamp.now();
            await db.collection('order_followups').doc(waId).set({
                waId, track: 'order_in_progress', name: c.name || null,
                lastInboundAt: admin.firestore.Timestamp.fromMillis(inboundMs),
                scheduledSends: sends, stage: 0, status: 'pending',
                classified: false, enProceso: null, pendiente: null, datosDados: null, mensajes: null,
                attempts: 0, totalSent: 0, sentLog: [], backfilled: true,
                createdAt: nowTs, updatedAt: nowTs
            });
            result.armed++;
        }
    }
    return result;
}

function startOrderFollowupScheduler() {
    if (scheduledTask) {
        console.log('[ORDER_FOLLOWUP] Scheduler ya iniciado');
        return;
    }
    console.log(`[ORDER_FOLLOWUP] Scheduler iniciado. Cron: ${CRON_SCHEDULE}`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        runOrderFollowupSweep().catch(e => console.error('[ORDER_FOLLOWUP] Sweep error:', e.message));
    });
}

module.exports = {
    startOrderFollowupScheduler,
    runOrderFollowupSweep,
    armOrderFollowup,
    backfillOrderFollowups,
    getOrderFollowupConfig,
    saveOrderFollowupConfig
};
