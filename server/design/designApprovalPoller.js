// --- Red de seguridad de APROBACIÓN DE DISEÑO ------------------------------------------------
// El camino "en tiempo real" (webhook -> timer de 20s en memoria -> processAutoReplyAIInner ->
// designApproval.handleReply) es FRÁGIL: ese timer vive en la memoria del proceso, así que si el
// servidor se reinicia/duerme (Render) en esos 20s, la respuesta del cliente se pierde y su
// aprobación nunca se procesa. Eso fue exactamente lo que pasó con DH13528 (Angel dijo "Correcto"
// y no se subió nada).
//
// Este scheduler es la RED DE SEGURIDAD: cada ~2 min revisa los contactos en modo aprobación y, si
// hay una respuesta del cliente que el camino en tiempo real NO atendió, corre el clasificador él
// mismo. Es INDEPENDIENTE del timer en memoria y del gate de botActive, así que aunque el proceso
// se reinicie, la aprobación se procesa a más tardar en un par de minutos.
//
// Idempotencia: `designApproval.lastReplyMs` marca la última respuesta ya procesada. handleReply lo
// escribe (ambos caminos), y aquí lo pre-reclamamos antes de procesar para no repetir. La ventana de
// gracia (GRACE_MS) evita pisar al camino en tiempo real cuando sí está corriendo.
// Kill-switch: crm_settings/general.designApprovalAutoActive = false (el mismo del handler).
'use strict';
const cron = require('node-cron');
const { db } = require('../config');

const CRON = process.env.DESIGN_APPROVAL_POLL_CRON || '*/2 * * * *';   // cada 2 min
const GRACE_MS = parseInt(process.env.DESIGN_APPROVAL_GRACE_MS || '90000', 10); // deja actuar al timer en tiempo real
const BATCH = parseInt(process.env.DESIGN_APPROVAL_POLL_BATCH || '50', 10);

let task = null;
let running = false;

const toMs = v => (v && typeof v.toMillis === 'function' ? v.toMillis() : (v && v._seconds ? v._seconds * 1000 : 0));

async function runOnce() {
    if (running) return;   // no solapar corridas
    running = true;
    let processed = 0;
    try {
        // Mismo kill-switch que el handler: si la aprobación automática está apagada, no hacer nada.
        const gen = await db.collection('crm_settings').doc('general').get();
        if (gen.exists && gen.data().designApprovalAutoActive === false) return;

        const da = require('./designApproval');
        const snap = await db.collection('contacts_whatsapp').where('designApprovalPending', '==', true).limit(BATCH).get();
        if (snap.empty) return;

        for (const cDoc of snap.docs) {
            const contactId = cDoc.id;
            try {
                const contactData = cDoc.data();
                if (!da.isPending(contactData)) continue;

                // Pedido asociado
                const orderRef = db.collection('pedidos').doc(String(contactData.designApprovalOrderId));
                const orderSnap = await orderRef.get();
                if (!orderSnap.exists) continue;
                const order = orderSnap.data();
                const daState = order.designApproval || {};
                if (daState.status && daState.status !== 'pending') continue;   // ya resuelto por el otro camino

                // Línea base: la última respuesta ya procesada o, si ninguna, cuándo mandamos la captura.
                const baselineMs = toMs(daState.lastReplyMs) || toMs(daState.sentAt) || 0;

                // Última respuesta ENTRANTE del cliente (misma consulta que usa handleReply).
                const msgs = await cDoc.ref.collection('messages')
                    .where('from', '==', String(contactId))
                    .orderBy('timestamp', 'desc').limit(1).get();
                if (msgs.empty) continue;
                const lastMsg = msgs.docs[0].data();
                const lastMs = toMs(lastMsg.timestamp);
                if (!lastMs) continue;
                if (lastMs <= baselineMs) continue;              // no hay respuesta nueva sin procesar
                if (Date.now() - lastMs < GRACE_MS) continue;    // muy reciente: deja actuar al camino en tiempo real

                // Reclamar ANTES de procesar (si handleReply muere a media, no re-procesamos en bucle).
                await orderRef.update({ 'designApproval.lastReplyMs': lastMs });
                const dh = 'DH' + (order.consecutiveOrderNumber || contactData.designApprovalOrderId);
                console.log(`[design-approval-poller] ${dh}: respuesta del cliente que el flujo en tiempo real no atendió; la proceso (red de seguridad).`);
                await da.handleReply(contactId, lastMsg, cDoc.ref, contactData);
                processed++;
            } catch (e) {
                console.error('[design-approval-poller] contacto', contactId, ':', e.message);
            }
        }
        if (processed) console.log(`[design-approval-poller] procesadas ${processed} aprobación(es) que el flujo en tiempo real no atendió.`);
    } catch (e) {
        console.error('[design-approval-poller] error de corrida:', e.message);
    } finally {
        running = false;
    }
}

function startDesignApprovalPoller() {
    if (task) return;
    task = cron.schedule(CRON, runOnce);
    console.log('[design-approval-poller] Scheduler iniciado. Cron: "' + CRON + '" (red de seguridad de aprobaciones de diseño).');
}

module.exports = { startDesignApprovalPoller, runOnce };
