// =================================================================
// === Scheduler de COBRANZA AUTOMÁTICA (Andrea cobra sola) =========
// =================================================================
// Flujo definido por el negocio (17-jul-2026, versión 4 toques espaciados):
//   - Cobra pedidos en estatus "Foto enviada", "Esperando pago" o "Corregido"
//     (corrección YA hecha con foto nueva enviada; lo normal es que regresen a
//     "Foto enviada", pero si quedan en "Corregido" también se cobran). "Corregir"
//     NUNCA se cobra: ahí el equipo le debe la corrección al cliente.
//   - CUATRO cobros máximo por cliente, espaciados: día 0 (la misma tarde de la
//     foto, pase VESPERTINO), día 2, día 5 y día 9 (última llamada). Al día
//     siguiente del 4º cobro sin pago (~día 10), el pedido se CANCELA
//     (estatus "Cancelado") y queda registrado. El espaciado vive en cobranzaLogic.
//   - Pase VESPERTINO (default 19:00 MX): SOLO hace el cobro 1 del mismo día —
//     clientes a los que HOY se les envió la foto y siguen en silencio (guardias:
//     sin mensaje del cliente hoy, último envío del equipo con ≥5h). Los demás
//     cobros salen en el pase de la MAÑANA (default 11:00 MX).
//   - Corte por tiempo: si un pedido lleva más de 10 días SIN promesa de por medio,
//     se saca de la automatización SIN cancelar y se reporta para revisión manual
//     ("si no pagaron en 10 días ya no van a pagar"). Las promesas de pago con
//     fecha PAUSAN ese reloj: al vencer la promesa, Andrea retoma con los cobros
//     restantes y el corte se cuenta desde la fecha prometida (ver cobranzaLogic).
//   - Respeta: promesas de fecha futura ([FUTURE] de la IA), recordatorios ya
//     agendados (scheduled_reminders), conversaciones activas hoy y el límite de
//     1 mensaje de cobranza por día (estos dos últimos viven en cobranzaService).
//   - A la IA se le dice EN QUÉ COBRO va (1..4) y qué plantilla preferir
//     (cobro1..cobro4, SIN variable de nombre: los nombres de WhatsApp a veces
//     son basura tipo "ds65834") cuando la ventana de 24h está cerrada.
//
// El envío usa el MISMO motor que la página manual de cobranza (cobrarContacto):
// la IA lee la conversación y decide mensaje libre / respuesta rápida / plantilla,
// con las instrucciones de crm_settings/bot_cobranza.
//
// Config en crm_settings/cobranza_auto:
//   { enabled: bool (default false), hour: 0-23 (default 11, hora MX),
//     eveningEnabled: bool (default true), eveningHour: 0-23 (default 19, hora MX),
//     maxPerRun: number (default 40; 0 = SIN tope/ilimitado),
//     lookbackDays: number (default 30; ventana de búsqueda de pedidos, acotada 5-90),
//     lastRunDate: 'YYYY-MM-DD', lastEveningRunDate: 'YYYY-MM-DD' }
// Cada corrida deja su reporte en cobranza_runs/{YYYY-MM-DD} bajo el campo del pase
// ('manana' | 'tarde'), visible en la página de cobranza.
const cron = require('node-cron');
const { db, admin } = require('../config');
const { cobrarContacto, loadContactCobranzaContext } = require('./cobranzaService');
const { decideCobranzaAction, MAX_ATTEMPTS, MAX_DAYS } = require('./cobranzaLogic');

const ESTATUS_COBRABLES = ['Foto enviada', 'Esperando pago', 'Corregido'];
const LOOKBACK_DAYS = 30;        // ventana de búsqueda de pedidos por DEFAULT (configurable: cobranza_auto.lookbackDays)
const SEND_DELAY_MS = 1500;      // pausa entre envíos (rate limit de Meta)
const CRON_SCHEDULE = '*/15 * * * *'; // el gate interno decide si ya toca correr cada pase

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
        eveningEnabled: d.eveningEnabled !== false, // el pase vespertino viene incluido salvo que se apague
        eveningHour: Number.isFinite(Number(d.eveningHour)) ? Number(d.eveningHour) : 19,
        // maxPerRun: 0 = SIN tope (Infinity); ausente/ inválido = 40 por default.
        maxPerRun: Number(d.maxPerRun) === 0 ? Infinity
            : (Number.isFinite(Number(d.maxPerRun)) && Number(d.maxPerRun) > 0 ? Number(d.maxPerRun) : 40),
        // Ventana de búsqueda de pedidos (días desde su creación). Acotada a [5, 90]:
        // menos de 5 no alcanza ni para fabricar; más de 90 barre cartera muerta.
        lookbackDays: Number.isFinite(Number(d.lookbackDays)) && Number(d.lookbackDays) > 0
            ? Math.max(5, Math.min(90, Number(d.lookbackDays)))
            : LOOKBACK_DAYS,
        lastRunDate: d.lastRunDate || null,
        lastEveningRunDate: d.lastEveningRunDate || null
    };
}

// La decisión de negocio por cliente (espaciado de los 4 cobros → cancelar; 10 días →
// revisión manual; promesas pausan) vive en cobranzaLogic.js: es pura y tiene tests.

// Contexto que se anexa a las instrucciones para que la IA sepa en qué punto del
// ciclo va este cliente y qué plantilla usar si la ventana de 24h está cerrada.
function buildAttemptContext(cobroNum) {
    const ultima = cobroNum >= MAX_ATTEMPTS;
    return `\n\n[CONTEXTO DEL SISTEMA — NO se lo menciones al cliente]\n` +
        `Este es el cobro número ${cobroNum} de ${MAX_ATTEMPTS} del ciclo de cobranza automática de este cliente.` +
        (ultima
            ? ` Es la ÚLTIMA LLAMADA: avisa con calidez y claridad que si no se recibe su pago, su pedido se cancelará automáticamente mañana. No amenaces; transmite que no queremos que lo pierda.`
            : '') +
        `\nSi la ventana de 24h está CERRADA y existe la plantilla "cobro${cobroNum}", usa EXACTAMENTE esa (responde [TEMPLATE:cobro${cobroNum}]). Si no existe, elige la plantilla aprobada más adecuada.`;
}

/**
 * Corrida de cobranza de un pase.
 * @param {'manana'|'tarde'} pass - 'manana': cobros 2..4, cancelaciones y vencimientos
 *   (y cobro 1 de pedidos cuya foto fue de días anteriores). 'tarde': SOLO cobro 1
 *   del mismo día (foto enviada hoy y cliente en silencio), vía sameDayFirstTouch.
 */
async function runCobranzaSweep(pass = 'manana', { force = false } = {}) {
    if (sweepRunning) { console.log('[COBRANZA_AUTO] Sweep ya en curso; se omite.'); return { alreadyRunning: true }; }
    sweepRunning = true;
    const isTarde = pass === 'tarde';
    const todayMx = todayMxStr();
    const report = {
        startedAtMs: Date.now(),
        enviados: 0, cancelados: 0, vencidos: 0, saltados: 0, esperando: 0, errores: 0,
        candidatos: 0,
        detalle: []
    };
    const pushDetail = (entry) => { if (report.detalle.length < 200) report.detalle.push(entry); };

    // Progreso EN VIVO: el reporte parcial se escribe en cobranza_runs mientras la corrida
    // avanza (throttle ~2s) con enCurso:true, para que la página muestre los logs al momento
    // en vez de esperar al final. Nunca tumba la corrida si falla.
    let lastFlushMs = 0;
    const flushProgress = async (force = false) => {
        const now = Date.now();
        if (!force && (now - lastFlushMs) < 2000) return;
        lastFlushMs = now;
        try {
            await db.collection('cobranza_runs').doc(todayMx).set({ date: todayMx, [pass]: { ...report, enCurso: true } }, { merge: true });
        } catch (_) { /* best effort */ }
    };

    try {
        const cfg = await getConfig();
        if (!cfg.enabled && !force) return { disabled: true };

        // Claim del día ANTES de trabajar: si el server se reinicia a media corrida,
        // no se vuelve a cobrar hoy (mejor quedarse corto que cobrar doble).
        await db.collection('crm_settings').doc('cobranza_auto')
            .set(isTarde ? { lastEveningRunDate: todayMx } : { lastRunDate: todayMx }, { merge: true });

        // Instrucciones del bot de cobranza (las mismas de la página manual).
        const instrSnap = await db.collection('crm_settings').doc('bot_cobranza').get();
        const instructions = instrSnap.exists ? String(instrSnap.data().instructions || '').trim() : '';
        if (!instructions) {
            report.error = 'Sin instrucciones en crm_settings/bot_cobranza: no se cobró. Configúralas en la página de cobranza.';
            console.warn('[COBRANZA_AUTO] ' + report.error);
            return;
        }

        // Pedidos recientes en estatus cobrable. Se consulta solo por fecha (índice simple,
        // igual que la página manual) y el estatus se filtra en memoria. La ventana es
        // configurable (cobranza_auto.lookbackDays); pedidos creados antes de la ventana
        // quedan FUERA aunque estén a medio ciclo (decisión del dueño: cartera vieja, manual).
        const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - cfg.lookbackDays * 24 * 60 * 60 * 1000);
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

        // Pase vespertino: SOLO clientes sin ningún cobro previo (candidatos a cobro 1
        // del mismo día de la foto). El resto del ciclo es del pase de la mañana.
        const contactsToProcess = [];
        for (const [contactId, orders] of byContact) {
            const attempts = Math.max(0, ...orders.map(o => (o.cobranzaAuto || {}).attempts || 0));
            if (isTarde && attempts > 0) continue;
            contactsToProcess.push([contactId, orders, attempts]);
        }
        report.candidatos = contactsToProcess.length;
        console.log(`[COBRANZA_AUTO] Corrida ${todayMx} (${pass}): ${cobrables.length} pedidos cobrables, ${contactsToProcess.length} clientes a evaluar.`);
        await flushProgress(true); // marcar "en curso" de inmediato para la página

        const nowMs = Date.now();
        for (const [contactId, orders, attemptsPrev] of contactsToProcess) {
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

                if (decision.action === 'wait') {
                    // Aún no toca el siguiente cobro (espaciado del ciclo). Sin detalle para
                    // no inflar el reporte: es el estado normal de la mayoría cada día.
                    report.esperando++;
                    continue;
                }

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
                            'cobranzaAuto.done': 'cancelado_4_cobros'
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

                const cobroNum = attemptsPrev + 1;
                const result = await cobrarContacto({
                    contactId,
                    instructions: instructions + buildAttemptContext(cobroNum),
                    orderNumbers: orders.map(o => o.consecutiveOrderNumber),
                    sameDayFirstTouch: isTarde
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
                    pushDetail({ contactId, pedidos: dhList, resultado: `cobro ${cobroNum}/${MAX_ATTEMPTS} enviado${result.windowOpen ? '' : ' (plantilla)'}` });
                    console.log(`[COBRANZA_AUTO] ✓ ${contactId} (${dhList}): cobro ${cobroNum}/${MAX_ATTEMPTS} enviado (${pass}).`);
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
            await flushProgress(); // progreso en vivo para la página (throttleado)
        }

        console.log(`[COBRANZA_AUTO] Corrida ${todayMx} (${pass}) terminada: ${report.enviados} enviados, ${report.cancelados} cancelados, ${report.vencidos} vencidos, ${report.saltados} saltados, ${report.esperando} en espera, ${report.errores} errores.`);
    } catch (e) {
        report.error = String(e.message || e).slice(0, 300);
        console.error('[COBRANZA_AUTO] Sweep falló:', e.message);
    } finally {
        sweepRunning = false;
        try {
            report.finishedAt = admin.firestore.FieldValue.serverTimestamp();
            report.enCurso = false; // apagar la marca de progreso en vivo
            // Un doc por día con un campo por pase: {date, manana: {...}, tarde: {...}}
            await db.collection('cobranza_runs').doc(todayMx).set({ date: todayMx, [pass]: report }, { merge: true });
        } catch (e) {
            console.warn('[COBRANZA_AUTO] No se pudo guardar el reporte de la corrida:', e.message);
        }
    }
    return report;
}

// ¿Hay una corrida en curso? (para que el endpoint de corrida manual no encime otra)
function isSweepRunning() {
    return sweepRunning;
}

/**
 * VISTA PREVIA de una corrida (no envía nada, no cambia nada): devuelve la lista de
 * candidatos del pase con lo que les pasaría — cobrar (y qué nº de cobro), cancelar,
 * vencer, esperar su día, o saltarse (promesa/recordatorio/conversación/margen de 5h).
 * Usa las MISMAS reglas del sweep real, incluidas las guardias de conversación del service.
 * Matiz: aun en los marcados "cobrar", la IA puede decidir SKIP al leer la conversación
 * (comprobante ya enviado, se le debe un video…); eso solo se sabe en el cobro real.
 */
async function previewCobranzaSweep(pass = 'manana') {
    const isTarde = pass === 'tarde';
    const cfg = await getConfig();
    const todayMx = todayMxStr();

    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - cfg.lookbackDays * 24 * 60 * 60 * 1000);
    const snap = await db.collection('pedidos')
        .where('createdAt', '>=', cutoff)
        .orderBy('createdAt', 'asc')
        .get();
    const cobrables = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(o => ESTATUS_COBRABLES.includes(String(o.estatus || '').trim()))
        .filter(o => o.telefono && o.consecutiveOrderNumber != null)
        .filter(o => !(o.cobranzaAuto && o.cobranzaAuto.done));

    const byContact = new Map();
    for (const o of cobrables) {
        const key = String(o.telefono).trim();
        if (!byContact.has(key)) byContact.set(key, []);
        byContact.get(key).push(o);
    }

    const items = [];
    const nowMs = Date.now();
    for (const [contactId, orders] of byContact) {
        const attempts = Math.max(0, ...orders.map(o => (o.cobranzaAuto || {}).attempts || 0));
        if (isTarde && attempts > 0) continue; // el vespertino solo hace cobros 1
        const pedidos = orders.map(o => 'DH' + o.consecutiveOrderNumber).join(', ');
        let item = null;
        try {
            const remSnap = await db.collection('scheduled_reminders').doc(contactId).get();
            if (remSnap.exists && remSnap.data().status === 'scheduled') {
                item = { accion: 'saltar', motivo: 'ya hay un recordatorio agendado' };
            }
        } catch (_) { /* si no se puede leer, el sweep real tampoco bloquea por esto */ }
        if (!item) {
            const d = decideCobranzaAction(orders, todayMx, nowMs);
            if (d.action === 'skip_future') item = { accion: 'saltar', motivo: d.reason };
            else if (d.action === 'cancel') item = { accion: 'cancelar', motivo: d.reason };
            else if (d.action === 'expire') item = { accion: 'vencer', motivo: d.reason };
            else if (d.action === 'wait') item = { accion: 'esperar', motivo: d.reason };
            else {
                // Candidato a cobro: validar también las guardias de conversación reales
                // (ya cobrado hoy, conversación de hoy, margen de 5h del vespertino).
                const ctx = await loadContactCobranzaContext({ contactId, sameDayFirstTouch: isTarde });
                if (ctx.skip) item = { accion: 'saltar', motivo: ctx.skip };
                else item = { accion: 'cobrar', motivo: `cobro ${attempts + 1}/${MAX_ATTEMPTS}${ctx.windowOpen ? '' : ' (plantilla)'}` };
            }
        }
        items.push({ contactId, pedidos, ...item });
    }

    const resumen = {};
    for (const it of items) resumen[it.accion] = (resumen[it.accion] || 0) + 1;

    const cfgSnap = await db.collection('crm_settings').doc('cobranza_auto').get();
    const cfgD = cfgSnap.exists ? cfgSnap.data() : {};
    const alreadyRanToday = isTarde ? cfgD.lastEveningRunDate === todayMx : cfgD.lastRunDate === todayMx;

    return {
        pass,
        alreadyRanToday,
        tope: cfg.maxPerRun === Infinity ? null : cfg.maxPerRun,
        lookbackDays: cfg.lookbackDays,
        resumen,
        items
    };
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
            if (!cfg.enabled) return;
            const today = todayMxStr();
            const h = hourMx();
            // Pase de la MAÑANA: cobros 2..4, cancelaciones, vencimientos y cobros 1 rezagados.
            if (cfg.lastRunDate !== today && h >= cfg.hour) {
                await runCobranzaSweep('manana');
                return; // un pase por tick: el vespertino saldrá en un tick posterior
            }
            // Pase VESPERTINO: cobro 1 del mismo día de la foto (cliente en silencio).
            if (cfg.eveningEnabled && cfg.lastEveningRunDate !== today && h >= cfg.eveningHour) {
                await runCobranzaSweep('tarde');
            }
        } catch (e) {
            console.error('[COBRANZA_AUTO] Gate del cron falló:', e.message);
        }
    });
}

module.exports = {
    startCobranzaScheduler,
    runCobranzaSweep,       // exportado para trigger manual/pruebas
    previewCobranzaSweep,   // vista previa (no envía nada)
    isSweepRunning,
    decideCobranzaAction,   // pura, para tests
    MAX_ATTEMPTS,
    MAX_DAYS
};
