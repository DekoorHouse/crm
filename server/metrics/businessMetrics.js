/**
 * Métricas de NEGOCIO del CRM (panel "Negocio" de la sección Métricas).
 *
 * Responde 8 preguntas concretas del negocio:
 *   1. ¿Cuántas conversaciones NUEVAS llegan cada día?
 *   2. ¿Cuántas de esas NO contestan nuestro primer mensaje?
 *   3. ¿Cuántos PEDIDOS hay cada día?
 *   4. ¿Cuántas personas mandan COMPROBANTE de pago y cuánto suman?
 *   5. ¿Cuántas pagan dentro de las primeras 4/8/12/24 h de mandarles el pedido terminado?
 *   6. ¿Cuál es el HORARIO más frecuente de pago?
 *   7. ¿Cuántas piden VIDEO y cuántas de esas pagan?
 *   8. ¿Cuántas NO RESPONDEN cuando mandamos la foto del pedido terminado (/cuatro)?
 * Y de pasada el EMBUDO (conversación → pedido → foto enviada → pagado) y la CARTERA por cobrar.
 *
 * === De dónde sale cada dato ===
 *  1 y 2  →  colección `contacts_whatsapp` (createTime del documento = cuándo nació la conversación)
 *            cruzada con los mensajes del contacto. Es lo ÚNICO caro (escanea mensajes), así que el
 *            resultado se congela por día en `metrics_conversations/<YYYY-MM-DD>`: un día que ya pasó
 *            no cambia. Cada carga solo recalcula HOY y AYER (ver FRESH_DAYS).
 *  3,4,6,7 →  colección `pedidos` (createdAt / comprobanteValidadoAt / videoRequestedAt) — barato.
 *  5 y 8   →  cohorte de pedidos a los que YA les mandamos el pedido terminado
 *            (`pedidoListoEnviadoAt` desde el chat, `mockupPaymentSentAt` desde el módulo Mockup)
 *            + una consulta por pedido para ver si el cliente escribió DESPUÉS de ese envío.
 *
 * Todo se agrupa en hora de CDMX (America/Mexico_City), no en UTC.
 */
const express = require('express');
const { db, admin } = require('../config');

const router = express.Router();

const TZ = 'America/Mexico_City';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
// Un mensaje es NUESTRO si viene del número de WhatsApp o de la página (Messenger/Instagram).
const OUTBOUND_FROM = [PHONE_NUMBER_ID, 'page'].filter(Boolean);

// Colección donde se congelan los días ya calculados de conversaciones (métricas 1 y 2).
const CONV_COLL = 'metrics_conversations';
// Versión del cálculo: al subirla, los días guardados se recalculan solos.
const CONV_VERSION = 1;
// Cuántos días del final NUNCA se congelan (hoy y ayer): una conversación de hoy todavía
// puede contestar, así que su resultado no es definitivo.
const FRESH_DAYS = 2;
// Caché en memoria del payload completo (el panel se abre varias veces seguidas).
const CACHE_TTL_MS = 10 * 60 * 1000;

const _cache = new Map();

// ===== Helpers de fecha en hora de México ==================================================
const _tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', weekday: 'short'
});

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Devuelve { day:'YYYY-MM-DD', hour:0-23, weekday:0-6 (0=domingo) } de una fecha, en hora de CDMX. */
function tzParts(date) {
    const o = {};
    for (const p of _tzParts.formatToParts(date)) o[p.type] = p.value;
    return {
        day: `${o.year}-${o.month}-${o.day}`,
        hour: parseInt(o.hour, 10) || 0,
        weekday: WEEKDAY_INDEX[o.weekday] != null ? WEEKDAY_INDEX[o.weekday] : 0,
    };
}
const dayKeyOf = (date) => tzParts(date).day;

/** Offset de CDMX respecto a UTC en ms (negativo). Se calcula al instante dado. */
function tzOffsetMs(date) {
    const asLocal = new Date(date.toLocaleString('en-US', { timeZone: TZ }));
    return asLocal.getTime() - date.getTime();
}

/** Instante UTC del 00:00 de CDMX de un día 'YYYY-MM-DD'. */
function dayStartUtc(dayKey) {
    const midday = new Date(Date.parse(`${dayKey}T12:00:00Z`)); // mediodía UTC: mismo día local seguro
    return new Date(Date.parse(`${dayKey}T00:00:00Z`) - tzOffsetMs(midday));
}

/** Lista de los últimos `days` días (incluye hoy), en orden ascendente. */
function dayKeysBack(days) {
    const anchor = Date.parse(`${dayKeyOf(new Date())}T12:00:00Z`);
    const out = [];
    for (let i = days - 1; i >= 0; i--) out.push(new Date(anchor - i * 86400000).toISOString().slice(0, 10));
    return out;
}

/** Desplaza un día 'YYYY-MM-DD' n días (n negativo = hacia atrás). */
function shiftDay(dayKey, n) {
    return new Date(Date.parse(`${dayKey}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** Etiqueta corta para las gráficas: "25 jul". */
function dayLabel(dayKey) {
    return new Date(Date.parse(`${dayKey}T12:00:00Z`))
        .toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

const toMs = (ts) => (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : null;
const pct = (part, total) => total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

/** Ejecuta `fn` sobre los items con concurrencia limitada (para las consultas por pedido). */
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) {
            const idx = i++;
            out[idx] = await fn(items[idx], idx);
        }
    }));
    return out;
}

// ===== Métricas 1 y 2: conversaciones nuevas y quién no contesta ============================
/**
 * Garantiza que existan (y estén frescos) los renglones diarios de conversaciones para `dayKeys`.
 * Los días viejos se leen de `metrics_conversations`; los que faltan o son recientes se recalculan
 * con UN solo escaneo de mensajes desde el primer día pendiente hasta ahora.
 */
async function ensureConversationDays(dayKeys) {
    const todayKey = dayKeyOf(new Date());
    const frozenBefore = shiftDay(todayKey, -(FRESH_DAYS - 1)); // días >= a este NO se congelan

    const snaps = await db.getAll(...dayKeys.map(k => db.collection(CONV_COLL).doc(k)));
    const rows = {};
    const stale = [];
    snaps.forEach((s, idx) => {
        const k = dayKeys[idx];
        const d = s.exists ? s.data() : null;
        // Se reusa el guardado solo si: es de esta versión, el día ya cerró Y no se calculó
        // cuando ese día todavía estaba abierto (si no, su "no contestó" sería el provisional).
        const usable = d && d.v === CONV_VERSION && k < frozenBefore && !d.provisional;
        if (usable) rows[k] = d;
        else stale.push(k);
    });
    if (stale.length === 0) return { rows, recomputed: [] };

    // Un solo escaneo: desde el 00:00 del día pendiente más antiguo hasta ahora. Así el "¿contestó
    // a nuestro primer mensaje?" de una conversación nacida ese día se resuelve con mensajes que
    // sí están en la ventana (aunque hayan pasado horas).
    const scanFrom = admin.firestore.Timestamp.fromDate(dayStartUtc(stale[0]));

    const byDay = {};
    for (const k of stale) {
        byDay[k] = {
            day: k, v: CONV_VERSION,
            newConversations: 0,   // conversaciones que NACIERON ese día (con mensaje del cliente)
            noReply: 0,            // les contestamos y el cliente ya no volvió a escribir
            neverAnswered: 0,      // nunca les contestamos nada (culpa nuestra)
            createdNoInbound: 0,   // contacto creado sin mensaje entrante (campaña/alta manual)
            inbound: 0, outbound: 0,
            provisional: k >= frozenBefore,
        };
    }

    // PRIMERO los contactos: createTime del documento = nacimiento de la conversación. Con eso se
    // sabe QUIÉNES son los contactos nuevos de estos días, y al escanear los mensajes solo se
    // guardan en memoria los de ELLOS (no los de los ~30 mil contactos activos del periodo).
    const contactsSnap = await db.collection('contacts_whatsapp')
        .where('lastMessageTimestamp', '>=', scanFrom).select('lastMessageTimestamp').get();
    const newContactDay = new Map();   // contactId -> día en que nació la conversación
    contactsSnap.forEach(s => {
        if (!s.createTime) return;
        const k = dayKeyOf(s.createTime.toDate());
        if (byDay[k]) newContactDay.set(s.id, k);
    });

    // El select() proyecta 'from' ADEMÁS de 'timestamp' aunque no se use: en escaneos largos
    // (decenas de miles de mensajes) el SDK reanuda el stream construyendo un cursor con los
    // campos filtrados, y si 'from' no viene en el documento lanza
    // "Field from is missing in the provided DocumentSnapshot".
    const inByContact = new Map();
    const outByContact = new Map();
    const scan = async (fromFilter, fromValue, map, dayField) => {
        const snap = await db.collectionGroup('messages')
            .where('from', fromFilter, fromValue)
            .where('timestamp', '>=', scanFrom)
            .select('timestamp', 'from').get();
        snap.forEach(doc => {
            const ms = toMs(doc.get('timestamp'));
            if (ms == null) return;
            const k = dayKeyOf(new Date(ms));
            if (byDay[k]) byDay[k][dayField]++;
            const parent = doc.ref.parent.parent;
            if (!parent || !newContactDay.has(parent.id)) return;
            const arr = map.get(parent.id);
            if (arr) arr.push(ms); else map.set(parent.id, [ms]);
        });
    };
    await Promise.all([
        scan('not-in', OUTBOUND_FROM, inByContact, 'inbound'),
        scan('in', OUTBOUND_FROM, outByContact, 'outbound'),
    ]);

    for (const [contactId, k] of newContactDay) {
        const row = byDay[k];
        const ins = (inByContact.get(contactId) || []).sort((a, b) => a - b);
        if (ins.length === 0) { row.createdNoInbound++; continue; }
        row.newConversations++;

        const outs = (outByContact.get(contactId) || []).sort((a, b) => a - b);
        const firstReply = outs.find(t => t >= ins[0]);
        if (firstReply == null) { row.neverAnswered++; continue; }
        if (!ins.some(t => t > firstReply)) row.noReply++;
    }

    const batch = db.batch();
    for (const k of stale) {
        batch.set(db.collection(CONV_COLL).doc(k),
            { ...byDay[k], computedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        rows[k] = byDay[k];
    }
    await batch.commit();

    return { rows, recomputed: stale };
}

// ===== Métricas de pedidos =================================================================
/** Momento en que le mandamos al cliente su pedido TERMINADO (foto + datos de pago, /cuatro). */
const readySentMs = (p) => {
    const a = toMs(p.pedidoListoEnviadoAt);
    const b = toMs(p.mockupPaymentSentAt);
    if (a != null && b != null) return Math.min(a, b);
    return a != null ? a : b;
};

/** Momento en que el cliente pidió un VIDEO/foto extra de su pedido terminado. */
const videoAskedMs = (p) => {
    const v = toMs(p.videoRequestedAt);
    if (v != null) return v;
    return p.corregirMotivo === 'video' ? toMs(p.corregirAt) : null;
};

/**
 * ¿El cliente escribió algo DESPUÉS de `afterMs`? Una consulta mínima (limit 1) por pedido.
 * Va en orden DESCENDENTE a propósito: es el orden que ya tiene índice (from, timestamp DESC)
 * tanto a nivel colección como grupo, así no hace falta crear un índice nuevo.
 * Devuelve { ok:true, replied:bool } o { ok:false } si la consulta falló (para no contar
 * un error como "el cliente no respondió").
 */
async function clientRepliedAfter(contactId, afterMs) {
    if (!contactId || afterMs == null) return { ok: false };
    try {
        const snap = await db.collection('contacts_whatsapp').doc(String(contactId))
            .collection('messages')
            .where('from', '==', String(contactId))
            .where('timestamp', '>', admin.firestore.Timestamp.fromMillis(afterMs))
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();
        return { ok: true, replied: !snap.empty };
    } catch (e) {
        console.warn(`[BIZ-METRICS] No se pudo revisar respuestas de ${contactId}:`, e.message);
        return { ok: false };
    }
}

// Estatus que significan "ya le mandamos su pedido y la bola está del lado del CLIENTE: nos debe".
// A propósito NO incluye "Corregir" (ahí el pendiente es nuestro) ni "Esperando anticipo".
const PENDING_PAYMENT_STATUS = ['Foto enviada', 'Esperando pago', 'Corregido'];

// Los documentos de `pedidos` son gordos (items, guiaEnvio, fotos…) y aquí se leen miles. Se
// proyectan SOLO estos campos: el mismo select para todas las consultas, así cada una incluye
// siempre su propio campo filtrado (requisito para que el SDK pueda reanudar el stream).
const PEDIDO_FIELDS = [
    'createdAt', 'precio', 'estatus', 'contactId', 'telefono',
    'comprobanteValidadoAt', 'mockupPaymentSentAt', 'pedidoListoEnviadoAt',
    'corregirAt', 'corregirMotivo', 'videoRequestedAt',
];
const pedidos = () => db.collection('pedidos');

// ===== Cálculo completo ====================================================================
async function computeBusinessMetrics(days) {
    const dayKeys = dayKeysBack(days);
    const fromKey = dayKeys[0];
    const todayKey = dayKeys[dayKeys.length - 1];
    const fromTs = admin.firestore.Timestamp.fromDate(dayStartUtc(fromKey));
    const fromMs = fromTs.toMillis();

    const [conv, createdSnap, receiptSnap, readySnapA, readySnapB, videoSnapA, videoSnapB, pendingSnap] =
        await Promise.all([
            ensureConversationDays(dayKeys),
            pedidos().where('createdAt', '>=', fromTs).select(...PEDIDO_FIELDS).get(),
            pedidos().where('comprobanteValidadoAt', '>=', fromTs).select(...PEDIDO_FIELDS).get(),
            pedidos().where('mockupPaymentSentAt', '>=', fromTs).select(...PEDIDO_FIELDS).get(),
            pedidos().where('pedidoListoEnviadoAt', '>=', fromTs).select(...PEDIDO_FIELDS).get(),
            pedidos().where('corregirAt', '>=', fromTs).select(...PEDIDO_FIELDS).get(),
            pedidos().where('videoRequestedAt', '>=', fromTs).select(...PEDIDO_FIELDS).get(),
            pedidos().where('estatus', 'in', PENDING_PAYMENT_STATUS).select(...PEDIDO_FIELDS).get(),
        ]);

    // --- Renglones diarios (base de todas las gráficas) ---
    const daily = {};
    for (const k of dayKeys) {
        const c = conv.rows[k] || {};
        daily[k] = {
            day: k, label: dayLabel(k),
            newConversations: c.newConversations || 0,
            noReply: c.noReply || 0,
            neverAnswered: c.neverAnswered || 0,
            inbound: c.inbound || 0,
            outbound: c.outbound || 0,
            provisional: !!c.provisional,
            orders: 0, ordersValue: 0,
            receipts: 0, receiptsValue: 0,
        };
    }

    // --- 3. Pedidos por día (y embudo de ESTOS pedidos: ¿les mandamos la foto? ¿pagaron?) ---
    let ordersTotal = 0, ordersValue = 0, ordersCancelled = 0;
    let ordersReadySent = 0, ordersReadyPaid = 0, ordersPaid = 0, ordersPaidValue = 0;
    createdSnap.forEach(doc => {
        const p = doc.data();
        const ms = toMs(p.createdAt);
        if (ms == null || ms < fromMs) return;
        const row = daily[dayKeyOf(new Date(ms))];
        if (!row) return;
        row.orders++;
        row.ordersValue += Number(p.precio) || 0;
        ordersTotal++;
        ordersValue += Number(p.precio) || 0;
        if (p.estatus === 'Cancelado') ordersCancelled++;
        // Pasos ANIDADOS (de los que recibieron su foto, cuántos pagaron): si se compara el total
        // de pagados contra los que tienen sello de envío, el porcentaje se infla — no todos los
        // envíos están sellados (ver readySentTracked abajo).
        if (readySentMs(p) != null) {
            ordersReadySent++;
            if (p.comprobanteValidadoAt) ordersReadyPaid++;
        }
        if (p.comprobanteValidadoAt) { ordersPaid++; ordersPaidValue += Number(p.precio) || 0; }
    });

    // --- 4 y 6. Comprobantes de pago: cuántos, cuánto suman y a qué hora llegan ---
    const hours = Array.from({ length: 24 }, () => 0);
    const weekdays = Array.from({ length: 7 }, () => 0);
    let receiptsCount = 0, receiptsValue = 0;
    // Desde cuándo hay datos: `comprobanteValidadoAt` y los sellos de "pedido terminado enviado"
    // son campos que se agregaron al CRM hace poco, así que en rangos largos las primeras semanas
    // salen en cero — no porque no se vendiera, sino porque nadie las estaba registrando.
    let firstReceiptMs = null, firstReadySentMs = null;
    receiptSnap.forEach(doc => {
        const p = doc.data();
        const ms = toMs(p.comprobanteValidadoAt);
        if (ms == null || ms < fromMs) return;
        const parts = tzParts(new Date(ms));
        const row = daily[parts.day];
        const value = Number(p.precio) || 0;
        if (row) { row.receipts++; row.receiptsValue += value; }
        receiptsCount++;
        receiptsValue += value;
        hours[parts.hour]++;
        weekdays[parts.weekday]++;
        if (firstReceiptMs == null || ms < firstReceiptMs) firstReceiptMs = ms;
    });

    // Hora pico y bloque de 3 h pico (más útil para decidir turnos que una hora suelta).
    let topHour = 0;
    hours.forEach((n, h) => { if (n > hours[topHour]) topHour = h; });
    let topBlock = 0, topBlockCount = -1;
    for (let h = 0; h < 24; h++) {
        const c = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24];
        if (c > topBlockCount) { topBlockCount = c; topBlock = h; }
    }

    // --- 5 y 8. Cohorte "ya le mandamos su pedido terminado" ---
    const cohort = new Map();
    for (const snap of [readySnapA, readySnapB]) {
        snap.forEach(doc => {
            const p = doc.data();
            const sentMs = readySentMs(p);
            if (sentMs == null || sentMs < fromMs) return;
            cohort.set(doc.id, { id: doc.id, p, sentMs, paidMs: toMs(p.comprobanteValidadoAt) });
            if (firstReadySentMs == null || sentMs < firstReadySentMs) firstReadySentMs = sentMs;
        });
    }
    const cohortAll = [...cohort.values()];
    // Ojo: bastantes clientes YA habían pagado antes de que les mandáramos la foto (anticipo de
    // especiales, o pagaron durante la venta). Preguntarles "¿en cuántas horas pagaron después de
    // recibir la foto?" no tiene sentido y ensucia el "no pagó" / "no contestó": se sacan del
    // análisis de cobro y se reportan aparte.
    const prepaid = cohortAll.filter(o => o.paidMs != null && o.paidMs < o.sentMs);
    const cohortList = cohortAll.filter(o => !(o.paidMs != null && o.paidMs < o.sentMs));

    // ¿El cliente escribió después de que le mandamos su pedido? (una consulta chica por pedido)
    const replies = await mapLimit(cohortList, 40, (o) => clientRepliedAfter(o.p.contactId || o.p.telefono, o.sentMs));
    cohortList.forEach((o, i) => { o.reply = replies[i]; });

    const H = 3600000;
    const nowMs = Date.now();
    const windows = [
        { key: 'h4', label: 'En las primeras 4 h', max: 4 * H },
        { key: 'h8', label: 'Entre 4 y 8 h', max: 8 * H },
        { key: 'h12', label: 'Entre 8 y 12 h', max: 12 * H },
        { key: 'h24', label: 'Entre 12 y 24 h', max: 24 * H },
        { key: 'more', label: 'Después de 24 h', max: Infinity },
    ];
    const bucketCounts = { h4: 0, h8: 0, h12: 0, h24: 0, more: 0 };
    let cohortPaid = 0, cohortUnpaid = 0, delaySum = 0;
    const delays = [];
    let noReplyCount = 0, repliedCount = 0, replyUnknown = 0;
    let matureNoReply = 0, matureNoReplyPaid = 0, matureReplied = 0, matureRepliedPaid = 0;
    // Un pedido que le mandamos hace 2 h NO puede haber "pagado en 24 h" todavía: cada ventana
    // se mide solo contra los pedidos que ya tuvieron ese tiempo completo para pagar.
    const matureFor = { h4: 0, h8: 0, h12: 0, h24: 0 };
    // Cohorte "madura" (≥24 h desde el envío): la base honesta de los porcentajes acumulados.
    let mature = 0, maturePaid = 0;

    for (const o of cohortList) {
        const age = nowMs - o.sentMs;
        if (age >= 4 * H) matureFor.h4++;
        if (age >= 8 * H) matureFor.h8++;
        if (age >= 12 * H) matureFor.h12++;
        if (age >= 24 * H) { matureFor.h24++; mature++; }

        if (o.paidMs != null && o.paidMs >= o.sentMs) {
            const d = o.paidMs - o.sentMs;
            bucketCounts[windows.find(x => d <= x.max).key]++;
            cohortPaid++;
            delaySum += d;
            delays.push(d);
            if (age >= 24 * H) maturePaid++;
        } else {
            cohortUnpaid++;
        }
        // "Pagó" aquí = pagó DESPUÉS de recibir la foto (los que ya venían pagados no están
        // en cohortList), así que el número es de verdad "contestó → pagó".
        const paid = o.paidMs != null && o.paidMs >= o.sentMs;
        const isMature = age >= 24 * H;
        if (!o.reply || !o.reply.ok) replyUnknown++;
        else if (!o.reply.replied) {
            noReplyCount++;
            if (isMature) { matureNoReply++; if (paid) matureNoReplyPaid++; }
        } else {
            repliedCount++;
            if (isMature) { matureReplied++; if (paid) matureRepliedPaid++; }
        }
    }
    delays.sort((a, b) => a - b);
    const medianDelay = delays.length ? delays[Math.floor(delays.length / 2)] : null;

    // Acumulados: "pagaron DENTRO de las primeras N horas".
    const cum = { h4: bucketCounts.h4 };
    cum.h8 = cum.h4 + bucketCounts.h8;
    cum.h12 = cum.h8 + bucketCounts.h12;
    cum.h24 = cum.h12 + bucketCounts.h24;

    // --- 7. Piden video → ¿pagan? ---
    const videoOrders = new Map();
    for (const snap of [videoSnapA, videoSnapB]) {
        snap.forEach(doc => {
            const p = doc.data();
            const ms = videoAskedMs(p);
            if (ms == null || ms < fromMs) return;
            videoOrders.set(doc.id, { p, askedMs: ms, paidMs: toMs(p.comprobanteValidadoAt) });
        });
    }
    const videoList = [...videoOrders.values()];
    const videoPaid = videoList.filter(v => v.paidMs != null);
    const videoValue = videoPaid.reduce((s, v) => s + (Number(v.p.precio) || 0), 0);
    // Mismo criterio de madurez que en las ventanas de pago: quien pidió video hace 3 h
    // todavía no "decidió" si paga.
    const videoMature = videoList.filter(v => (nowMs - v.askedMs) >= 24 * H);
    const videoMaturePaid = videoMature.filter(v => v.paidMs != null).length;

    // --- Cartera por cobrar: pedidos TERMINADOS que nadie ha pagado (de cualquier fecha).
    // Se parte por antigüedad porque el dinero de esta semana se cobra y el de hace meses ya no.
    const ageBuckets = {
        week: { label: 'Últimos 7 días', count: 0, value: 0 },
        month: { label: '8 a 30 días', count: 0, value: 0 },
        old: { label: 'Más de 30 días', count: 0, value: 0 },
    };
    let pendingCount = 0, pendingValue = 0;
    pendingSnap.forEach(doc => {
        const p = doc.data();
        if (p.comprobanteValidadoAt) return; // ya pagó, solo falta mover el estatus
        const value = Number(p.precio) || 0;
        const ref = readySentMs(p) != null ? readySentMs(p) : toMs(p.createdAt);
        const ageDays = ref != null ? (nowMs - ref) / 86400000 : 999;
        const b = ageDays <= 7 ? ageBuckets.week : ageDays <= 30 ? ageBuckets.month : ageBuckets.old;
        b.count++; b.value += value;
        pendingCount++; pendingValue += value;
    });

    // --- Totales de conversaciones (el % de "no contesta" se mide solo en días ya cerrados) ---
    const rowsArr = dayKeys.map(k => daily[k]);
    const settled = rowsArr.filter(r => !r.provisional);
    const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
    const convTotal = sum(rowsArr, r => r.newConversations);
    const settledTotal = sum(settled, r => r.newConversations);
    const settledNoReply = sum(settled, r => r.noReply);
    const settledNever = sum(settled, r => r.neverAnswered);

    // Promedios por día: se excluye HOY (día incompleto) para que el promedio no se vea castigado.
    const completeDays = Math.max(1, dayKeys.length - 1);
    const avgOf = (total) => Math.round((total / completeDays) * 10) / 10;

    return {
        range: { from: fromKey, to: todayKey, days, tz: TZ },
        daily: rowsArr,

        // 1 y 2
        conversations: {
            total: convTotal,
            avgPerDay: avgOf(convTotal - daily[todayKey].newConversations),
            today: daily[todayKey].newConversations,
            best: rowsArr.reduce((m, r) => r.newConversations > m.newConversations ? r : m, rowsArr[0]),
            inbound: sum(rowsArr, r => r.inbound),
            outbound: sum(rowsArr, r => r.outbound),
            settledDays: settled.length,
            settledTotal,
            noReply: settledNoReply,
            noReplyPct: pct(settledNoReply, settledTotal),
            neverAnswered: settledNever,
            neverAnsweredPct: pct(settledNever, settledTotal),
            engaged: settledTotal - settledNoReply - settledNever,
            engagedPct: pct(settledTotal - settledNoReply - settledNever, settledTotal),
        },

        // 3
        orders: {
            total: ordersTotal,
            value: ordersValue,
            avgPerDay: avgOf(ordersTotal - daily[todayKey].orders),
            today: daily[todayKey].orders,
            avgTicket: ordersTotal ? Math.round(ordersValue / ordersTotal) : 0,
            cancelled: ordersCancelled,
            best: rowsArr.reduce((m, r) => r.orders > m.orders ? r : m, rowsArr[0]),
        },

        // 4
        receipts: {
            count: receiptsCount,
            value: receiptsValue,
            avgTicket: receiptsCount ? Math.round(receiptsValue / receiptsCount) : 0,
            avgPerDay: avgOf(receiptsCount - daily[todayKey].receipts),
            valuePerDay: Math.round(avgOf(receiptsValue - daily[todayKey].receiptsValue)),
            today: daily[todayKey].receipts,
            todayValue: daily[todayKey].receiptsValue,
        },

        // 5
        payWindows: {
            sent: cohortAll.length,                    // a cuántos les mandamos su pedido terminado
            prepaid: prepaid.length,                   // de esos, ya habían pagado ANTES (anticipo)
            cohort: cohortList.length,                 // los que sí debían al momento de recibirlo
            mature,                                    // ya pasaron ≥24 h desde que se les mandó
            paid: cohortPaid,
            unpaid: cohortUnpaid,
            paidPct: pct(cohortPaid, cohortList.length),
            maturePaidPct: pct(maturePaid, mature),
            buckets: windows.map(w => ({
                key: w.key, label: w.label,
                count: bucketCounts[w.key],
                pctOfMature: pct(bucketCounts[w.key], mature),
                pctOfPaid: pct(bucketCounts[w.key], cohortPaid),
            })),
            // Cada acumulado se mide contra los pedidos que YA tuvieron esas horas para pagar.
            cumulative: {
                h4: { count: cum.h4, base: matureFor.h4, pct: pct(cum.h4, matureFor.h4) },
                h8: { count: cum.h8, base: matureFor.h8, pct: pct(cum.h8, matureFor.h8) },
                h12: { count: cum.h12, base: matureFor.h12, pct: pct(cum.h12, matureFor.h12) },
                h24: { count: cum.h24, base: matureFor.h24, pct: pct(cum.h24, matureFor.h24) },
            },
            avgHours: cohortPaid ? Math.round((delaySum / cohortPaid / H) * 10) / 10 : null,
            medianHours: medianDelay != null ? Math.round((medianDelay / H) * 10) / 10 : null,
        },

        // 6
        payHours: {
            hours: hours.map((count, hour) => ({ hour, count })),
            topHour, topHourCount: hours[topHour],
            topBlock, topBlockCount,
            weekdays,
            total: receiptsCount,
        },

        // 7
        video: {
            requested: videoList.length,
            paid: videoPaid.length,
            value: videoValue,
            mature: videoMature.length,
            maturePaid: videoMaturePaid,
            paidPct: pct(videoMaturePaid, videoMature.length),
            // Con qué comparar: el % de pago de TODOS los que ya recibieron su pedido terminado.
            baselinePaidPct: pct(maturePaid, mature),
        },

        // 8 — el % se mide sobre los que ya llevan ≥24 h con su foto (los de hoy aún pueden contestar)
        photoNoReply: {
            cohort: cohortList.length,
            checked: noReplyCount + repliedCount,
            unknown: replyUnknown,
            noReply: noReplyCount,
            replied: repliedCount,
            base: matureNoReply + matureReplied,
            matureNoReply,
            noReplyPct: pct(matureNoReply, matureNoReply + matureReplied),
            noReplyPaid: matureNoReplyPaid,
            // Sí pagan sin escribir: un "no contestó" no siempre es una venta perdida.
            noReplyPaidPct: pct(matureNoReplyPaid, matureNoReply),
            matureReplied,
            repliedPaid: matureRepliedPaid,
            repliedPaidPct: pct(matureRepliedPaid, matureReplied),
        },

        // Embudo: sigue a los PEDIDOS NACIDOS en el rango (no mezcla cohortes), así ningún
        // porcentaje puede pasar de 100%.
        funnel: {
            conversations: convTotal,
            orders: ordersTotal,
            readySent: ordersReadySent,
            paid: ordersReadyPaid,           // anidado: de los que recibieron su foto
            paidTotal: ordersPaid,           // todos los pedidos del rango que ya pagaron
            convToOrderPct: pct(ordersTotal, convTotal),
            orderToReadyPct: pct(ordersReadySent, ordersTotal),
            readyToPaidPct: pct(ordersReadyPaid, ordersReadySent),
            convToPaidPct: pct(ordersPaid, convTotal),
            revenue: ordersPaidValue,
            revenuePerConversation: convTotal ? Math.round(ordersPaidValue / convTotal) : 0,
            // El paso "pedido terminado enviado" solo cuenta los envíos SELLADOS: el módulo Mockup
            // siempre los sella (mockupPaymentSentAt) pero la respuesta rápida /cuatro del chat
            // apenas empezó a sellarse (pedidoListoEnviadoAt), así que en rangos con fechas
            // anteriores el paso se queda corto. Estos pedidos pagaron sin sello de envío: la
            // medida exacta de lo que le falta al paso.
            paidWithoutReadyStamp: ordersPaid - ordersReadyPaid,
        },
        pendingPayment: {
            count: pendingCount,
            value: Math.round(pendingValue),
            buckets: Object.values(ageBuckets).map(b => ({ ...b, value: Math.round(b.value) })),
        },

        meta: {
            computedAt: new Date().toISOString(),
            recomputedDays: conv.recomputed.length,
            ordersScanned: createdSnap.size,
            cohortChecked: cohortList.length,
            // Primer día con datos de cada evento. Si es MUY posterior al inicio del rango, el
            // panel avisa que ahí no hay historia (el campo aún no existía), en vez de dejar que
            // se lea como una caída de ventas.
            firstReceiptDay: firstReceiptMs != null ? dayKeyOf(new Date(firstReceiptMs)) : null,
            firstReadySentDay: firstReadySentMs != null ? dayKeyOf(new Date(firstReadySentMs)) : null,
        },
    };
}

// ===== Ruta ================================================================================
// GET /api/business-metrics?days=30[&fresh=1]
router.get('/', async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 180);
        const cacheKey = `biz:${days}`;
        const hit = _cache.get(cacheKey);
        if (req.query.fresh !== '1' && hit && (Date.now() - hit.at) < CACHE_TTL_MS) {
            return res.json({ success: true, ...hit.data, fromCache: true });
        }
        const data = await computeBusinessMetrics(days);
        _cache.set(cacheKey, { at: Date.now(), data });
        res.json({ success: true, ...data, fromCache: false });
    } catch (error) {
        console.error('❌ Error en /api/business-metrics:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, computeBusinessMetrics, ensureConversationDays, dayKeysBack, dayKeyOf, tzParts };
