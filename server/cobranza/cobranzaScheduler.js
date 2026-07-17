// =================================================================
// === Scheduler de COBRANZA AUTOMÁTICA (Andrea cobra sola) =========
// =================================================================
// Flujo definido por el negocio (17-jul-2026):
//   - Cobra pedidos en estatus "Foto enviada" o "Esperando pago".
//   - Máximo 1 cobro por día por cliente, y máximo 3 cobros en total.
//   - Cuando TOCARÍA el 4º cobro (ya hubo 3 sin pago), ya NO se cobra:
//     el pedido se CANCELA (estatus "Cancelado") y queda registrado.
//   - Corte por tiempo: si un pedido lleva más de 10 días en la automatización
//     sin completar el ciclo (p. ej. por promesas de pago o conversaciones que
//     pausaron los cobros), se saca de la automatización SIN cancelar y se
//     reporta para revisión manual ("si no pagaron en 10 días ya no van a pagar").
//   - Respeta: promesas de fecha futura ([FUTURE] de la IA), recordatorios ya
//     agendados (scheduled_reminders), conversaciones activas hoy y el límite de
//     1 mensaje de cobranza por día (estos dos últimos viven en cobranzaService).
//
// El envío usa el MISMO motor que la página manual de cobranza (cobrarContacto):
// la IA lee la conversación y decide mensaje libre / respuesta rápida / plantilla
// (si la ventana de 24h está cerrada), con las instrucciones de crm_settings/bot_cobranza.
//
// Config en crm_settings/cobranza_auto:
//   { enabled: bool (default false), hour: 0-23 (default 11, hora MX),
//     maxPerRun: number (default 40), lastRunDate: 'YYYY-MM-DD' }
// Cada corrida deja su reporte en cobranza_runs/{YYYY-MM-DD} (visible en la página).
const cron = require('node-cron');
const { db, admin } = require('../config');
const { cobrarContacto } = require('./cobranzaService');
const { decideCobranzaAction, MAX_ATTEMPTS, MAX_DAYS } = require('./cobranzaLogic');

const ESTATUS_COBRABLES = ['Foto enviada', 'Esperando pago'];
const LOOKBACK_DAYS = 30;        // ventana de búsqueda de pedidos (colchón para fabricación)
const SEND_DELAY_MS = 1500;      // pausa entre envíos (rate limit de Meta)
const CRON_SCHEDULE = '*/15 * * * *'; // el gate interno decide si ya toca correr hoy

let scheduledTask = null;
let sweepRunning = false;

function todayMxStr() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

function hourMx() {
    return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City', hour: 'numeric', hour12: false })) % 24;
}

async function getConfig() {
    const snap = await db.collection('crm_settings').doc('cobranza_auto').get();
    const d = snap.exists ? snap.data() : {};
    return {
        enabled: d.enabled === true, // apagado por default: se enciende desde la página de cobranza
        hour: Number.isFinite(Number(d.hour)) ? Number(d.hour) : 11,
        maxPerRun: Number.isFinite(Number(d.maxPerRun)) && Number(d.maxPerRun) > 0 ? Number(d.maxPerRun) : 40,
        lastRunDate: d.lastRunDate || null
    };
}

// La decisión de negocio por cliente (3 cobros → cancelar; 10 días → revisión manual;
// respetar promesas futuras) vive en cobranzaLogic.js: es pura y tiene tests en tests/.

async function runCobranzaSweep({ force = false } = {}) {
    if (sweepRunning) { console.log('[COBRANZA_AUTO] Sweep ya en curso; se omite.'); return; }
    sweepRunning = true;
    const todayMx = todayMxStr();
    const report = {
        date: todayMx,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        enviados: 0, cancelados: 0, vencidos: 0, saltados: 0, errores: 0,
        candidatos: 0,
        detalle: []
    };
    const pushDetail = (entry) => { if (report.detalle.length < 200) report.detalle.push(entry); };

    try {
        const cfg = await getConfig();
        if (!cfg.enabled && !force) return;

        // Claim del día ANTES de trabajar: si el server se reinicia a media corrida,
        // no se vuelve a cobrar hoy (mejor quedarse corto que cobrar doble).
        await db.collection('crm_settings').doc('cobranza_auto').set({ lastRunDate: todayMx }, { merge: true });

        // Instrucciones del bot de cobranza (las mismas de la página manual).
        const instrSnap = await db.collection('crm_settings').doc('bot_cobranza').get();
        const instructions = instrSnap.exists ? String(instrSnap.data().instructions || '').trim() : '';
        if (!instructions) {
            report.error = 'Sin instrucciones en crm_settings/bot_cobranza: no se cobró. Configúralas en la página de cobranza.';
            console.warn('[COBRANZA_AUTO] ' + report.error);
            return;
        }

        // Pedidos recientes en estatus cobrable. Se consulta solo por fecha (índice simple,
        // igual que la página manual) y el estatus se filtra en memoria.
        const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
        const snap = await db.collection('pedidos')
            .where('createdAt', '>=', cutoff)
            .orderBy('createdAt', 'asc') // los más viejos primero: son los más urgentes de cobrar
            .get();

        const cobrables = snap.docs
            .map(doc => ({ ref: doc.ref, id: doc.id, ...doc.data() }))
            .filter(o => ESTATUS_COBRABLES.includes(String(o.estatus || '').trim()))
            .filter(o => o.telefono && o.consecutiveOrderNumber != null)
            .filter(o => !(o.cobranzaAuto && o.cobranzaAuto.done));

        // Agrupar por cliente: un solo mensaje cubre todos sus pedidos pendientes.
        const byContact = new Map();
        for (const o of cobrables) {
            const key = String(o.telefono).trim();
            if (!byContact.has(key)) byContact.set(key, []);
            byContact.get(key).push(o);
        }
        report.candidatos = byContact.size;
        console.log(`[COBRANZA_AUTO] Corrida ${todayMx}: ${cobrables.length} pedidos cobrables de ${byContact.size} clientes.`);

        const nowMs = Date.now();
        for (const [contactId, orders] of byContact) {
            if (report.enviados >= cfg.maxPerRun) {
                pushDetail({ contactId, resultado: 'tope diario alcanzado, queda para mañana' });
                report.saltados++;
                continue;
            }
            const dhList = orders.map(o => 'DH' + o.consecutiveOrderNumber).join(', ');

            try {
                // Recordatorio YA agendado para este cliente (p. ej. Andrea lo armó en el chat
                // cuando el cliente dijo "te pago el 23"): ese mecanismo es el dueño del siguiente
                // contacto — la cobranza no se le encima. No cobra NI cancela mientras esté vigente.
                try {
                    const remSnap = await db.collection('scheduled_reminders').doc(contactId).get();
                    if (remSnap.exists && remSnap.data().status === 'scheduled') {
                        report.saltados++;
                        pushDetail({ contactId, pedidos: dhList, resultado: 'saltado: ya hay un recordatorio agendado para este cliente' });
                        continue;
                    }
                } catch (e) {
                    console.warn(`[COBRANZA_AUTO] No se pudo leer scheduled_reminders de ${contactId}; se continúa:`, e.message);
                }

                const decision = decideCobranzaAction(orders, todayMx, nowMs);

                if (decision.action === 'skip_future') {
                    report.saltados++;
                    pushDetail({ contactId, pedidos: dhList, resultado: `saltado: ${decision.reason}` });
                    continue;
                }

                if (decision.action === 'cancel') {
                    for (const o of orders) {
                        await o.ref.update({
                            estatus: 'Cancelado',
                            canceladoPorCobranza: true,
                            canceladoPorCobranzaAt: admin.firestore.FieldValue.serverTimestamp(),
                            'cobranzaAuto.done': 'cancelado_3_cobros'
                        });
                        console.log(`[COBRANZA_AUTO] ✗ DH${o.consecutiveOrderNumber} CANCELADO (${decision.reason}).`);
                    }
                    report.cancelados += orders.length;
                    pushDetail({ contactId, pedidos: dhList, resultado: `CANCELADO (${decision.reason})` });
                    continue;
                }

                if (decision.action === 'expire') {
                    for (const o of orders) {
                        await o.ref.update({ 'cobranzaAuto.done': 'vencido_10d' });
                    }
                    report.vencidos += orders.length;
                    pushDetail({ contactId, pedidos: dhList, resultado: `fuera de automatización (${decision.reason}); revisar manualmente` });
                    continue;
                }

                // Entra (o sigue) en la automatización: sellar firstAt si es su primer día.
                // El reloj de los 10 días corre desde aquí — es la mejor aproximación a
                // "desde que se le mandó la foto" (no se guarda esa fecha hoy en día).
                for (const o of orders) {
                    if (!(o.cobranzaAuto && o.cobranzaAuto.firstAt)) {
                        await o.ref.update({ 'cobranzaAuto.firstAt': admin.firestore.FieldValue.serverTimestamp() });
                    }
                }

                const result = await cobrarContacto({
                    contactId,
                    instructions,
                    orderNumbers: orders.map(o => o.consecutiveOrderNumber)
                });

                if (result.success) {
                    for (const o of orders) {
                        await o.ref.update({
                            'cobranzaAuto.attempts': admin.firestore.FieldValue.increment(1),
                            'cobranzaAuto.lastAt': admin.firestore.FieldValue.serverTimestamp(),
                            'cobranzaAuto.lastDate': todayMx
                        });
                    }
                    report.enviados++;
                    const intento = Math.max(0, ...orders.map(o => (o.cobranzaAuto || {}).attempts || 0)) + 1;
                    pushDetail({ contactId, pedidos: dhList, resultado: `cobro ${intento}/${MAX_ATTEMPTS} enviado${result.windowOpen ? '' : ' (plantilla)'}` });
                    console.log(`[COBRANZA_AUTO] ✓ ${contactId} (${dhList}): cobro ${intento}/${MAX_ATTEMPTS} enviado.`);
                    await new Promise(r => setTimeout(r, SEND_DELAY_MS));
                } else if (result.futureDate) {
                    // La IA detectó promesa de fecha futura: guardarla para respetarla.
                    for (const o of orders) {
                        await o.ref.update({ 'cobranzaAuto.futureDate': result.futureDate });
                    }
                    report.saltados++;
                    pushDetail({ contactId, pedidos: dhList, resultado: `promesa de pago detectada para ${result.futureDate}` });
                } else {
                    report.saltados++;
                    pushDetail({ contactId, pedidos: dhList, resultado: `saltado: ${result.reason || 'sin motivo'}` });
                }
            } catch (e) {
                report.errores++;
                pushDetail({ contactId, pedidos: dhList, resultado: `error: ${String(e.message || e).slice(0, 200)}` });
                console.error(`[COBRANZA_AUTO] Error con ${contactId}:`, e.message);
            }
        }

        console.log(`[COBRANZA_AUTO] Corrida ${todayMx} terminada: ${report.enviados} enviados, ${report.cancelados} cancelados, ${report.vencidos} vencidos, ${report.saltados} saltados, ${report.errores} errores.`);
    } catch (e) {
        report.error = String(e.message || e).slice(0, 300);
        console.error('[COBRANZA_AUTO] Sweep falló:', e.message);
    } finally {
        sweepRunning = false;
        try {
            report.finishedAt = admin.firestore.FieldValue.serverTimestamp();
            await db.collection('cobranza_runs').doc(todayMx).set(report, { merge: true });
        } catch (e) {
            console.warn('[COBRANZA_AUTO] No se pudo guardar el reporte de la corrida:', e.message);
        }
    }
}

function startCobranzaScheduler() {
    if (scheduledTask) {
        console.log('[COBRANZA_AUTO] Scheduler ya iniciado');
        return;
    }
    console.log(`[COBRANZA_AUTO] Scheduler iniciado (${CRON_SCHEDULE}). Se activa desde la página de cobranza (crm_settings/cobranza_auto.enabled).`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, async () => {
        try {
            const cfg = await getConfig();
            const today = todayMxStr();
            if (!cfg.enabled) return;
            if (cfg.lastRunDate === today) return;    // ya corrió hoy
            if (hourMx() < cfg.hour) return;          // aún no es la hora configurada
            await runCobranzaSweep();
        } catch (e) {
            console.error('[COBRANZA_AUTO] Gate del cron falló:', e.message);
        }
    });
}

module.exports = {
    startCobranzaScheduler,
    runCobranzaSweep,       // exportado para trigger manual/pruebas
    decideCobranzaAction,   // pura, para tests
    MAX_ATTEMPTS,
    MAX_DAYS
};
