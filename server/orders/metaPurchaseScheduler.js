const cron = require('node-cron');
const { db } = require('../config');
const { sendOrderPurchase, isPurchaseResolved, isAutomaticPurchaseEligible } = require('./metaPurchase');

// Misma ventana que Envíos. Fuera de ella se recuperan pendientes sin guía,
// reposiciones y pedidos enlazados por una línea manual, no todo el historial enviado.
const ENVIOS_RECIENTES = 300;
const PAGE_SIZE = 300;
const CRON = '*/5 * * * *';
const millis = t => t && t.toMillis ? t.toMillis() : (Date.parse(t) || 0);
const norm = value => String(value || '').replace(/\D/g, '');
let task = null;
let running = false;
let lastStartedAt = null;
let lastCompletedAt = null;
let lastResult = null;
let lastError = null;
const liveQueue = new Set();
let liveInFlight = null;
let liveRunning = false;
let liveSent = 0;
let liveOrganic = 0;
let lastLiveCompletedAt = null;
const listeners = {};
const listenerErrors = {};
const listenerRetries = {};
const manualOrderNumbers = new Map();

function readyToSend(p) {
    return !isPurchaseResolved(p) && !p.metaPurchaseRejectedAt && isAutomaticPurchaseEligible(p)
        && millis(p.metaPurchaseNextAttemptAt) <= Date.now()
        && millis(p.metaPurchaseLeaseUntil) <= Date.now();
}

function enqueueLivePurchase(id, p) {
    if (!readyToSend(p)) return;
    if (liveInFlight === id) return;
    liveQueue.add(id);
    void drainLiveQueue();
}

async function drainLiveQueue() {
    if (liveRunning) return;
    liveRunning = true;
    try {
        while (liveQueue.size) {
            const id = liveQueue.values().next().value;
            liveQueue.delete(id);
            liveInFlight = id;
            try {
                const result = await sendOrderPurchase(id, { source: 'envios_scheduler' });
                if (result.success && !result.already) {
                    if (result.metaPurchaseMotivo === 'organico') liveOrganic++;
                    else if (!result.metaPurchaseNoAplica) liveSent++;
                }
            } catch (e) {
                // El barrido de respaldo lo recupera sin necesitar otra modificación del pedido.
                console.warn(`[META PURCHASE LIVE] Pedido ${id}:`, e.message);
            }
            lastLiveCompletedAt = new Date().toISOString();
        }
    } finally {
        liveInFlight = null;
        liveRunning = false;
    }
}

// Firestore reintenta fallos transitorios. Si termina un listener con error, lo
// volvemos a suscribir; el snapshot inicial recupera cambios ocurridos durante la caída.
function watchChanges(name, query, onChanges) {
    const retry = error => {
        listeners[name] = false;
        listenerErrors[name] = error.message;
        console.warn(`[META PURCHASE LIVE] Listener ${name}:`, error.message);
        clearTimeout(listenerRetries[name]);
        listenerRetries[name] = setTimeout(() => watchChanges(name, query, onChanges), 30000);
        listenerRetries[name].unref?.();
    };
    try {
        query.onSnapshot(snapshot => {
            listeners[name] = true;
            delete listenerErrors[name];
            Promise.resolve().then(() => onChanges(snapshot.docChanges())).catch(error => {
                listenerErrors[name] = error.message;
                console.warn(`[META PURCHASE LIVE] Procesar ${name}:`, error.message);
            });
        }, retry);
    } catch (error) { retry(error); }
}

function startPurchaseListeners() {
    const ordersChanged = changes => {
        for (const change of changes) {
            if (change.type !== 'removed') enqueueLivePurchase(change.doc.id, change.doc.data());
        }
    };
    // Mismas entradas que la sección Envíos: nuevos pagos, reposiciones y líneas manuales.
    watchChanges('pedidos', db.collection('pedidos').orderBy('comprobanteValidadoAt', 'desc').limit(ENVIOS_RECIENTES), ordersChanged);
    watchChanges('reenvios', db.collection('pedidos').where('estatus', '==', 'Reenvio').limit(500), ordersChanged);
    watchChanges('manuales', db.collection('envios_manuales').orderBy('createdAt', 'desc').limit(300), async changes => {
        for (const change of changes) {
            if (change.type === 'removed') { manualOrderNumbers.delete(change.doc.id); continue; }
            const num = norm(change.doc.data().orderNumber);
            if (!num || manualOrderNumbers.get(change.doc.id) === num) continue;
            const orders = await db.collection('pedidos').where('consecutiveOrderNumber', '==', Number(num)).limit(1).get();
            manualOrderNumbers.set(change.doc.id, num);
            for (const doc of orders.docs) enqueueLivePurchase(doc.id, doc.data());
        }
    });
}

async function runMetaPurchaseSweep() {
    if (running) return { skipped: 'already_running' };
    running = true;
    lastStartedAt = new Date().toISOString();
    const result = { scanned: 0, attempted: 0, sent: 0, organic: 0, pending: 0 };
    try {
        const manual = await db.collection('envios_manuales').orderBy('createdAt', 'desc')
            .limit(300).select('orderNumber').get();
        const manualNumbers = new Set(manual.docs.map(d => norm(d.data().orderNumber)).filter(Boolean));
        // Pagina por el comprobante (inmutable durante el envío), no por una bandera que
        // cambiamos al procesar. No necesita índices nuevos ni campos que falten en pedidos viejos.
        const query = db.collection('pedidos').orderBy('comprobanteValidadoAt', 'desc').select(
            'comprobanteValidadoAt', 'metaPurchaseSentAt', 'metaPurchaseResolvedAt', 'metaPurchaseRejectedAt', 'metaPurchaseNextAttemptAt',
            'metaPurchaseLeaseUntil', 'ocultoDeEnvios', 'estatus', 'guiaEnvio.guia', 'consecutiveOrderNumber'
        ).limit(PAGE_SIZE);
        let cursor = null;
        do {
            const page = await (cursor ? query.startAfter(cursor) : query).get();
            for (const doc of page.docs) {
                const p = doc.data();
                const inWindow = result.scanned++ < ENVIOS_RECIENTES;
                if (!readyToSend(p)) continue;
                if (!inWindow && p.guiaEnvio?.guia && p.estatus !== 'Reenvio'
                    && !manualNumbers.has(norm(p.consecutiveOrderNumber))) continue;
                result.attempted++;
                try {
                    // El servicio vuelve a leer y reservar el pedido en una transacción:
                    // comparte exclusión con otra instancia, Fabricar y cualquier pestaña abierta.
                    const sent = await sendOrderPurchase(doc.id, { source: 'envios_scheduler' });
                    if (sent.success && !sent.already) {
                        if (sent.metaPurchaseMotivo === 'organico') result.organic++;
                        else if (!sent.metaPurchaseNoAplica) result.sent++;
                    }
                    else if (!sent.success) result.pending++;
                } catch (e) {
                    result.pending++;
                    console.warn(`[META PURCHASE SCHEDULER] Pedido ${doc.id}:`, e.message);
                }
            }
            cursor = page.size === PAGE_SIZE ? page.docs[page.docs.length - 1] : null;
        } while (cursor);
        if (result.attempted) console.log('[META PURCHASE SCHEDULER] Barrido completado:', JSON.stringify(result));
        return result;
    } catch (e) {
        result.error = e.message;
        console.error('[META PURCHASE SCHEDULER] Error en barrido:', e.message);
        return result;
    } finally {
        lastResult = result;
        lastError = result.error || null;
        lastCompletedAt = new Date().toISOString();
        running = false;
    }
}

function startMetaPurchaseScheduler() {
    if (task) return;
    task = cron.schedule(CRON, runMetaPurchaseSweep);
    startPurchaseListeners();
    console.log('[META PURCHASE SCHEDULER] Activo: detecta nuevos pedidos en tiempo real y recupera pendientes cada 5 minutos, sin depender del navegador.');
    // Recupera pendientes tras despliegues y reinicios, aunque no se abra Envíos.
    void runMetaPurchaseSweep();
}

function getMetaPurchaseSchedulerStatus() {
    return {
        started: !!task, running, intervalMinutes: 5, lastStartedAt, lastCompletedAt, lastResult, lastError,
        realtime: { listeners: { ...listeners }, errors: { ...listenerErrors }, running: liveRunning,
            queued: liveQueue.size, sent: liveSent, organic: liveOrganic, lastCompletedAt: lastLiveCompletedAt },
    };
}

module.exports = { startMetaPurchaseScheduler, runMetaPurchaseSweep, getMetaPurchaseSchedulerStatus, ENVIOS_RECIENTES };
