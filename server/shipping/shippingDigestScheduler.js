/**
 * Resumen diario de pedidos listos para guía.
 *
 * Antes se le mandaba a Rosario una plantilla por CADA pedido con nombre del
 * cliente y todos los datos de envío (mucho ruido; ella solo ocupa el número).
 * Ahora los pedidos se encolan en `shipping_digest_queue` (services.js →
 * notifyShippingDataReady) y una vez al día, a la 1:30 pm hora de México, se
 * manda UN solo mensaje con puros números de pedido:
 * "📦 Pedidos listos para guía: DH12977, DH12980, DH12985".
 *
 * Robusto a reinicios de Render: el cron barre cada 5 minutos y envía solo si
 * (a) ya pasó la hora objetivo, (b) hoy no se ha enviado (lastSentDate en
 * crm_settings/shipping_digest) — si el server estaba caído a la 1:30, sale en
 * el siguiente barrido. Un día sin pedidos pendientes se marca como procesado
 * sin enviar nada. Los pedidos que lleguen después del envío del día salen en
 * el resumen del día siguiente.
 *
 * Variables de entorno:
 *  - SHIPPING_DIGEST_TIME     (default '13:30', hora de México "HH:MM")
 *  - SHIPPING_DIGEST_TEMPLATE (default 'pedidos_listos_guia'; {{1}} = lista de pedidos)
 *  - ROSARIO_PHONE            (destinataria; compartida con el aviso individual)
 */
const cron = require('node-cron');
const { db, admin } = require('../config');
const { sendApprovedTemplateMessage, sendAdvancedWhatsAppMessage } = require('../services');

const SHIPPING_NOTIFY_PHONE = process.env.ROSARIO_PHONE || '5216181441382';
const DIGEST_TEMPLATE = process.env.SHIPPING_DIGEST_TEMPLATE || 'pedidos_listos_guia';
const DIGEST_TIME = process.env.SHIPPING_DIGEST_TIME || '13:30';
const TIMEZONE = 'America/Mexico_City';
const CRON_SCHEDULE = '*/5 * * * *'; // barrido; la hora real la decide DIGEST_TIME

let scheduledTask = null;
let sweepRunning = false;

// Fecha (YYYY-MM-DD) y minutos transcurridos del día, en hora de México.
function mxNow() {
    const now = new Date();
    const date = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    const [h, m] = now.toLocaleTimeString('en-GB', { timeZone: TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit' }).split(':');
    return { date, minutes: Number(h) * 60 + Number(m) };
}

function targetMinutes() {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(DIGEST_TIME).trim());
    if (!m) return 13 * 60 + 30;
    return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Ejecuta un barrido: si toca, arma la lista de pedidos pendientes y manda el
 * resumen a Rosario (plantilla aprobada primero; texto libre como respaldo).
 * `force` ignora hora y lastSentDate (para pruebas/manual); `dryRun` no envía
 * ni marca nada, solo devuelve lo que se enviaría.
 */
async function runShippingDigestSweep({ force = false, dryRun = false } = {}) {
    if (sweepRunning) return { skipped: true, reason: 'sweep_en_curso' };
    sweepRunning = true;
    try {
        const { date: today, minutes } = mxNow();
        if (!force && minutes < targetMinutes()) return { skipped: true, reason: 'antes_de_hora' };

        const settingsRef = db.collection('crm_settings').doc('shipping_digest');
        const settingsSnap = await settingsRef.get();
        const lastSentDate = settingsSnap.exists ? settingsSnap.data().lastSentDate : null;
        if (!force && lastSentDate === today) return { skipped: true, reason: 'ya_enviado_hoy' };

        const snap = await db.collection('shipping_digest_queue').where('sentAt', '==', null).get();
        const docs = snap.docs.sort((a, b) => {
            const am = a.data().createdAt?.toMillis?.() || 0;
            const bm = b.data().createdAt?.toMillis?.() || 0;
            return am - bm;
        });

        // Deduplicar por número de pedido conservando las refs (para marcarlas todas).
        const seen = new Set();
        const items = [];       // { num, refs: [docRef,...] }
        for (const d of docs) {
            const num = String(d.data().orderNumber || d.id || '').trim();
            if (!num) continue;
            if (seen.has(num)) {
                items.find(it => it.num === num).refs.push(d.ref);
                continue;
            }
            seen.add(num);
            items.push({ num, refs: [d.ref] });
        }

        // Un barrido forzado ANTES de la hora objetivo no debe consumir el envío del
        // día (p.ej. una prueba con force=1 en la mañana): solo se marca lastSentDate
        // cuando ya es la hora natural del resumen. Los docs enviados igual quedan con
        // sentAt, así que el corte de la 1:30 no los repite.
        const markDay = minutes >= targetMinutes();

        if (items.length === 0) {
            if (!dryRun && markDay) {
                await settingsRef.set({
                    lastSentDate: today, lastCount: 0,
                    lastRunAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            return { sent: false, count: 0, reason: 'sin_pendientes' };
        }

        // Partir en tandas: sanitizeTemplateParam corta los parámetros de plantilla a
        // 700 chars, así que con muchos pedidos una sola lista perdería números en
        // silencio. Cada tanda se envía y se marca por separado; si una falla, las
        // siguientes quedan pendientes y el próximo barrido las reintenta.
        const MAX_LIST_CHARS = 600;
        const chunks = [];
        let cur = [];
        for (const it of items) {
            const tentative = [...cur.map(c => c.num), it.num].join(', ');
            if (cur.length && tentative.length > MAX_LIST_CHARS) { chunks.push(cur); cur = []; }
            cur.push(it);
        }
        if (cur.length) chunks.push(cur);

        if (dryRun) {
            return {
                dryRun: true, count: items.length, parts: chunks.length,
                wouldSend: chunks.map(c => c.map(i => i.num).join(', '))
            };
        }

        const sentLists = [];
        let via = 'template';
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            let list = chunk.map(c => c.num).join(', ');
            if (chunks.length > 1) list += ` (parte ${i + 1}/${chunks.length})`;
            try {
                await sendApprovedTemplateMessage(SHIPPING_NOTIFY_PHONE, DIGEST_TEMPLATE, [list], { source: 'shipping_digest' });
            } catch (tplErr) {
                console.warn(`[GUIAS-DIGEST] Plantilla "${DIGEST_TEMPLATE}" falló (${tplErr.message}). Fallback a texto libre (requiere ventana 24h abierta).`);
                via = 'texto_libre';
                await sendAdvancedWhatsAppMessage(SHIPPING_NOTIFY_PHONE, {
                    text: `📦 *Pedidos listos para guía*\n\n${list}\n\nYa enviaron todos sus datos. Por favor genera sus guías. 🙌`
                });
            }
            // Marcar esta tanda como enviada antes de pasar a la siguiente.
            const batch = db.batch();
            chunk.forEach(c => c.refs.forEach(ref => batch.update(ref, {
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                digestDate: today
            })));
            await batch.commit();
            sentLists.push(list);
        }

        if (markDay) {
            await settingsRef.set({
                lastSentDate: today, lastCount: items.length, lastList: sentLists.join(' | '), lastVia: via,
                lastRunAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

        console.log(`[GUIAS-DIGEST] ✓ Resumen enviado a Rosario (${SHIPPING_NOTIFY_PHONE}) vía ${via}: ${items.length} pedido(s) en ${chunks.length} mensaje(s): ${sentLists.join(' | ')}`);
        return { sent: true, count: items.length, parts: chunks.length, lists: sentLists, via };
    } finally {
        sweepRunning = false;
    }
}

function startShippingDigestScheduler() {
    if (scheduledTask) {
        console.log('[GUIAS-DIGEST] Scheduler ya iniciado');
        return;
    }
    console.log(`[GUIAS-DIGEST] Scheduler iniciado. Resumen diario a las ${DIGEST_TIME} (MX) para ${SHIPPING_NOTIFY_PHONE}. Plantilla: ${DIGEST_TEMPLATE}`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        runShippingDigestSweep().catch(e => console.error('[GUIAS-DIGEST] Error en barrido:', e.message));
    }, { timezone: TIMEZONE });
}

module.exports = {
    startShippingDigestScheduler,
    runShippingDigestSweep
};
