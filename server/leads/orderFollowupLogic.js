/**
 * Seguimiento de "pedido en proceso" — Lógica pura (sin Firebase, testeable en aislamiento)
 *
 * Objetivo: cuando un cliente EMPEZÓ a dar datos para su pedido (nombre a grabar,
 * tipo de lámpara, foto, etc.) pero NO lo terminó, enviarle hasta 2 recordatorios
 * dentro de la ventana de 24h de WhatsApp, SIEMPRE en horario laboral (8am–9pm).
 *
 * Diferencias clave con la reactivación genérica (leadReactivationLogic.js):
 *   - Delays en HORAS (default 8h y 16h) anclados al último mensaje del cliente.
 *   - Respeta horario diurno: si un envío caería de noche, se "acomoda" a las 9pm
 *     del mismo día ("antes") o a las 8am del día siguiente ("temprano"), eligiendo
 *     el slot que mantenga los 2 envíos dentro de las 24h.
 *   - Solo se envía si la IA clasifica la conversación como "pedido en proceso"
 *     (esa decisión es I/O y vive en orderFollowupScheduler.js).
 *
 * Nota de zona horaria: México (Centro: CDMX/MTY/DGO) NO observa horario de verano
 * desde 2022, así que usamos un offset FIJO (UTC-6). Esto evita bugs de DST y hace
 * la lógica determinista y testeable.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_ORDER_CONFIG = {
    enabled: false,                 // OFF por defecto: es envío saliente; se activa explícitamente
    delaysHours: [8, 16],           // 2 recordatorios, ~cada 8h desde el último mensaje
    businessHours: { start: 8, end: 21 }, // 8am–9pm
    utcOffsetHours: -6,             // México Centro (sin DST desde 2022)
    windowHours: 23.5,              // ventana segura de WhatsApp (margen de 30 min)
    minGapHours: 4,                 // separación mínima entre los 2 envíos
    minDaysSinceLastOrder: 15,      // si compró hace poco (pregunta por su entrega) no insistir
    cooldownHours: 24,              // tras terminar una secuencia, no reiniciar otra tan pronto
    classifyMinMessages: 3,         // no gastar tokens en chats triviales (solo saludo)
    liveTagging: true,              // etiquetar el estado del pedido cuando el bot responde (híbrido)
    maxPerSweep: 40,
    // Textos de respaldo si la IA no devuelve mensajes personalizados. {{nombre}} se sustituye.
    messageFallbacks: [
        '¡Hola{{nombre}}! 😊 Quedamos pendientes de unos datos para terminar tu pedido. ¿Te ayudo a dejarlo listo?',
        'Hola{{nombre}} 👋 Seguimos al pendiente para completar tu pedido cuando gustes. ¿Lo continuamos? ✨'
    ]
};

// Convierte Timestamp de Firestore / Date / millis a millis (o null)
function toMillis(value) {
    if (value == null) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value._seconds === 'number') return value._seconds * 1000;
    return null;
}

// Primer nombre presentable, o '' si no hay uno real
function firstName(name) {
    const clean = (name || '').trim();
    if (!clean || /^nuevo contacto/i.test(clean)) return '';
    return clean.split(/\s+/)[0];
}

// Sustituye {{nombre}}; si no hay nombre, lo quita junto con el espacio previo
// para que "¡Hola{{nombre}}!" quede "¡Hola!" y no "¡Hola !"
function renderText(template, name) {
    const nombre = firstName(name);
    return String(template || '').replace(/\s*\{\{\s*nombre\s*\}\}/gi, nombre ? ` ${nombre}` : '');
}

// --- Helpers de tiempo local (offset fijo) ---------------------------------

// Hora local (con fracción de minutos) de un instante UTC dado.
function localHourOf(ms, offsetHours) {
    const shifted = new Date(ms + offsetHours * HOUR_MS);
    return shifted.getUTCHours() + shifted.getUTCMinutes() / 60;
}

// Devuelve el instante UTC correspondiente a "hora local HH:00" del MISMO día local que `ms`.
function localTimeOnSameDay(ms, hour, offsetHours) {
    const shifted = new Date(ms + offsetHours * HOUR_MS);
    const wallClockAsUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), hour, 0, 0, 0);
    return wallClockAsUtc - offsetHours * HOUR_MS;
}

// Acomoda un objetivo a horario laboral eligiendo el borde MÁS CERCANO:
//   - dentro de [start, end] -> sin cambios
//   - después de `end` (tarde-noche) -> ese mismo día a las `end` ("enviarlo antes")
//   - antes de `start` (madrugada) -> ese mismo día a las `start` ("en la mañana temprano")
function snapIntoBusinessHours(targetMs, cfg) {
    const { start, end } = cfg.businessHours;
    const h = localHourOf(targetMs, cfg.utcOffsetHours);
    if (h >= start && h <= end) return targetMs;
    if (h > end) return localTimeOnSameDay(targetMs, end, cfg.utcOffsetHours);
    return localTimeOnSameDay(targetMs, start, cfg.utcOffsetHours);
}

// Primer instante laboral en o DESPUÉS de `ms` (cota inferior; nunca va hacia atrás).
function nextBusinessAtOrAfter(ms, cfg) {
    const { start, end } = cfg.businessHours;
    const h = localHourOf(ms, cfg.utcOffsetHours);
    if (h >= start && h <= end) return ms;
    if (h < start) return localTimeOnSameDay(ms, start, cfg.utcOffsetHours);
    return localTimeOnSameDay(ms + DAY_MS, start, cfg.utcOffsetHours); // pasó el cierre -> mañana
}

// Último instante laboral en o ANTES de `ms` (red de seguridad contra el cierre de 24h).
function lastBusinessInstantBefore(ms, cfg) {
    const { start, end } = cfg.businessHours;
    const h = localHourOf(ms, cfg.utcOffsetHours);
    if (h > end) return localTimeOnSameDay(ms, end, cfg.utcOffsetHours);
    if (h >= start) return ms;
    return localTimeOnSameDay(ms - DAY_MS, end, cfg.utcOffsetHours); // antes del start -> ayer a las end
}

/**
 * Planea los instantes de envío (UTC ms) a partir del último mensaje del cliente.
 * Garantiza: cada envío en horario laboral, dentro de la ventana de 24h, separados
 * al menos `minGapHours`, lo más cerca posible del objetivo (~cada 8h).
 * Devuelve un arreglo con 0, 1 o 2 timestamps (los que quepan).
 */
function planSends(t0Ms, cfg) {
    const windowClose = t0Ms + cfg.windowHours * HOUR_MS;
    const minGap = cfg.minGapHours * HOUR_MS;
    const sends = [];
    let earliest = t0Ms;

    for (const delayH of cfg.delaysHours) {
        const target = t0Ms + delayH * HOUR_MS;
        let s = snapIntoBusinessHours(target, cfg);
        const lowerBound = nextBusinessAtOrAfter(earliest, cfg);
        if (s < lowerBound) s = lowerBound;
        if (s > windowClose) s = lastBusinessInstantBefore(windowClose, cfg);
        if (s == null || s > windowClose || s < earliest) break; // ya no cabe
        sends.push(s);
        earliest = s + minGap;
    }
    return sends;
}

function normalizeOrderConfig(raw) {
    const merged = { ...DEFAULT_ORDER_CONFIG, ...(raw || {}) };
    const num = (v, def, min, max) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return def;
        return Math.min(max == null ? n : max, Math.max(min, n));
    };

    let delaysHours = Array.isArray(merged.delaysHours) ? merged.delaysHours : [];
    delaysHours = delaysHours.map(Number).filter(n => Number.isFinite(n) && n >= 1).sort((a, b) => a - b).slice(0, 2);
    if (delaysHours.length === 0) delaysHours = DEFAULT_ORDER_CONFIG.delaysHours;

    const bh = merged.businessHours || {};
    let start = num(bh.start, 8, 0, 23);
    let end = num(bh.end, 21, 1, 24);
    if (end <= start) { start = 8; end = 21; }

    let fallbacks = Array.isArray(merged.messageFallbacks)
        ? merged.messageFallbacks.map(s => String(s || '').trim()).filter(Boolean)
        : [];
    if (fallbacks.length === 0) fallbacks = DEFAULT_ORDER_CONFIG.messageFallbacks;

    return {
        enabled: merged.enabled === true,
        delaysHours,
        businessHours: { start, end },
        utcOffsetHours: num(merged.utcOffsetHours, -6, -12, 14),
        windowHours: num(merged.windowHours, 23.5, 1, 24),
        minGapHours: num(merged.minGapHours, 4, 0, 24),
        minDaysSinceLastOrder: num(merged.minDaysSinceLastOrder, 15, 0),
        cooldownHours: num(merged.cooldownHours, 24, 0),
        classifyMinMessages: num(merged.classifyMinMessages, 3, 1),
        liveTagging: merged.liveTagging !== false,
        maxPerSweep: num(merged.maxPerSweep, 40, 1, 200),
        messageFallbacks: fallbacks
    };
}

/**
 * Decide qué hacer con un seguimiento pendiente (la decisión de IA "enProceso"
 * se resuelve aparte, en el scheduler, antes del primer envío).
 *
 * @returns {{action:'none'|'wait'|'wait_hours'|'send'|'done'|'expire'|'skip_recent'|'cancel', stage?:number, reason?:string}}
 */
function evaluateOrderFollowup(followup, contact, cfg, nowMs) {
    if (!followup || followup.status !== 'pending') return { action: 'none' };

    const stage = followup.stage || 0;
    const sends = Array.isArray(followup.scheduledSends) ? followup.scheduledSends.map(toMillis).filter(v => v != null) : [];
    if (sends.length === 0) return { action: 'cancel', reason: 'sin_agenda' };
    if (stage >= sends.length) return { action: 'done' };

    const inboundMs = toMillis(followup.lastInboundAt);
    if (!inboundMs) return { action: 'cancel', reason: 'sin_fecha_de_mensaje' };

    // Registró pedido después de escribir: objetivo cumplido
    const orderMs = toMillis(contact && contact.lastOrderDate);
    if (orderMs && orderMs >= inboundMs) return { action: 'cancel', reason: 'pedido_registrado' };
    if (orderMs && (inboundMs - orderMs) < cfg.minDaysSinceLastOrder * DAY_MS) return { action: 'skip_recent' };

    // Fuera de la ventana de 24h ya no se puede enviar texto libre
    if (nowMs - inboundMs > cfg.windowHours * HOUR_MS) return { action: 'expire' };

    const dueMs = sends[stage];
    if (nowMs < dueMs) return { action: 'wait' };

    // Espaciado mínimo entre envíos: protege el backlog (ambos horarios ya vencidos)
    // y catch-ups tras caídas, para no disparar 2 mensajes seguidos. Para conversaciones
    // nuevas no aplica porque los horarios ya vienen separados.
    if (stage > 0) {
        const lastSentMs = toMillis(followup.lastSentAt);
        if (lastSentMs && (nowMs - lastSentMs) < cfg.minGapHours * HOUR_MS) return { action: 'wait' };
    }

    // Ya venció, pero solo enviamos dentro del horario laboral (defensa ante caídas/retrasos)
    const h = localHourOf(nowMs, cfg.utcOffsetHours);
    if (h < cfg.businessHours.start || h > cfg.businessHours.end) return { action: 'wait_hours' };

    return { action: 'send', stage };
}

// Texto a enviar para una etapa: usa el mensaje personalizado de la IA si existe,
// si no, cae al texto de respaldo correspondiente.
function resolveStageText(followup, stage, cfg) {
    const msgs = Array.isArray(followup.mensajes) ? followup.mensajes : [];
    if (msgs[stage] && String(msgs[stage]).trim()) return String(msgs[stage]).trim();
    const fb = cfg.messageFallbacks[stage] || cfg.messageFallbacks[cfg.messageFallbacks.length - 1];
    return renderText(fb, (contactName(followup)));
}

function contactName(followup) {
    return (followup && followup.name) || '';
}

// --- Parseo robusto del JSON del clasificador ------------------------------
function parseClassifierJson(text) {
    if (!text) return null;
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const m = t.match(/\{[\s\S]*\}/);
    if (m) t = m[0];
    try { return JSON.parse(t); } catch (_) { return null; }
}

// Normaliza la salida del clasificador a una forma segura
function normalizeClassification(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    return {
        enProceso: parsed.enProceso === true,
        datosDados: Array.isArray(parsed.datosDados) ? parsed.datosDados.map(String).slice(0, 12) : [],
        pendiente: typeof parsed.pendiente === 'string' ? parsed.pendiente.trim() : '',
        mensajes: Array.isArray(parsed.mensajes)
            ? parsed.mensajes.map(s => String(s || '').trim()).filter(Boolean).slice(0, 2)
            : []
    };
}

// Construye el texto de la conversación (más antiguo arriba) para el clasificador.
// `messageDocs` deben venir en orden cronológico ascendente.
function buildConversationText(messageDocs, contactId) {
    return (messageDocs || []).map(d => {
        const who = d.from === contactId ? 'Cliente' : 'Asistente';
        let body = d.text;
        if (!body && d.type && d.type !== 'text') body = `[${d.type}]`;
        return `${who}: ${body || ''}`;
    }).join('\n');
}

module.exports = {
    DEFAULT_ORDER_CONFIG,
    HOUR_MS,
    DAY_MS,
    toMillis,
    firstName,
    renderText,
    localHourOf,
    localTimeOnSameDay,
    snapIntoBusinessHours,
    nextBusinessAtOrAfter,
    lastBusinessInstantBefore,
    planSends,
    normalizeOrderConfig,
    evaluateOrderFollowup,
    resolveStageText,
    parseClassifierJson,
    normalizeClassification,
    buildConversationText
};
