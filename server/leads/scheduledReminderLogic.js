/**
 * Recordatorios programados a fecha futura — Lógica pura (sin Firebase, testeable).
 *
 * Caso de uso: un cliente pide que lo contacten MÁS ADELANTE ("escríbanme en un mes",
 * "cuando sepa el sexo del bebé", "para diciembre"). Fuera de la ventana de 24h de
 * WhatsApp NO se puede mandar texto libre, así que se agenda un envío con PLANTILLA
 * aprobada de Meta, en la fecha pedida, con el texto personalizado que rellena la IA.
 *
 * Este archivo solo tiene funciones puras: normalización de config, cálculo del
 * instante de envío (con offset fijo MX Centro UTC-6, sin DST), sanitizado del
 * parámetro de plantilla y parseo del JSON del clasificador. El I/O (Gemini, Meta,
 * Firestore) vive en scheduledReminderClassifier.js y scheduledReminderScheduler.js.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_REMINDER_CONFIG = {
    enabled: false,                 // OFF por defecto: es envío saliente; se activa explícitamente
    templateName: 'recordatorio_lead', // plantilla aprobada en Meta ({{1}}=nombre, {{2}}=texto IA)
    langCode: 'es_MX',              // idioma de la plantilla (fallback si Meta no lo trae)
    utcOffsetHours: -6,             // México Centro (sin DST desde 2022)
    sendHourLocal: 10,              // hora local a la que se manda el recordatorio (10am)
    businessHours: { start: 8, end: 21 }, // franja válida de envío (defensa ante retrasos del sweep)
    minFutureHours: 12,             // no agendar para "ya"; mínimo a futuro
    maxFutureDays: 120,             // tope: no agendar más allá de ~4 meses
    graceDays: 3,                   // si el sweep se atrasa, hasta 3 días tarde aún envía; más = expira
    maxPerSweep: 40,
    liveDetect: true,               // la IA detecta aplazamientos cuando el bot responde
    // Texto de respaldo (parámetro {{2}}) si no hay mensaje personalizado. {{nombre}} va en {{1}}.
    fallbackMessage: '¿Retomamos tu pedido de DekoorHouse cuando gustes? Aquí seguimos para ayudarte. ✨'
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

// Sustituye {{nombre}}; si no hay nombre, lo quita junto con el espacio previo.
function renderText(template, name) {
    const nombre = firstName(name);
    return String(template || '').replace(/\s*\{\{\s*nombre\s*\}\}/gi, nombre ? ` ${nombre}` : '');
}

// --- Helpers de tiempo local (offset fijo, mismos que order_followup) ----------
function localHourOf(ms, offsetHours) {
    const shifted = new Date(ms + offsetHours * HOUR_MS);
    return shifted.getUTCHours() + shifted.getUTCMinutes() / 60;
}

// Instante UTC correspondiente a "hora local HH:00" del MISMO día local que `ms`.
function localTimeOnSameDay(ms, hour, offsetHours) {
    const shifted = new Date(ms + offsetHours * HOUR_MS);
    const wallClockAsUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), hour, 0, 0, 0);
    return wallClockAsUtc - offsetHours * HOUR_MS;
}

/**
 * Calcula el instante de envío (UTC ms) a partir de una fecha objetivo.
 * @param {string|number} remindAt  'YYYY-MM-DD' (día local) o millis
 * @param {number} nowMs
 * @param {object} cfg  config normalizada
 * @returns {number|null}  instante de envío snapeado a sendHourLocal y acotado a
 *                         [now+minFutureHours, now+maxFutureDays]; null si no se pudo parsear.
 */
function computeSendAtMs(remindAt, nowMs, cfg) {
    let rawMs = null;
    if (typeof remindAt === 'number' && Number.isFinite(remindAt)) {
        rawMs = remindAt;
    } else if (typeof remindAt === 'string') {
        const m = remindAt.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        const y = +m[1], mo = +m[2] - 1, d = +m[3];
        // Interpretar como ese día local a la hora de envío
        const wallUtc = Date.UTC(y, mo, d, cfg.sendHourLocal, 0, 0, 0);
        rawMs = wallUtc - cfg.utcOffsetHours * HOUR_MS;
    } else {
        return null;
    }
    if (!Number.isFinite(rawMs)) return null;

    // Normalizar a la hora de envío del día local objetivo
    let sendMs = localTimeOnSameDay(rawMs, cfg.sendHourLocal, cfg.utcOffsetHours);

    const minMs = nowMs + cfg.minFutureHours * HOUR_MS;
    const maxMs = nowMs + cfg.maxFutureDays * DAY_MS;

    // Si cae demasiado pronto, empujar a la hora de envío de un día que respete el mínimo.
    if (sendMs < minMs) {
        sendMs = localTimeOnSameDay(minMs + DAY_MS, cfg.sendHourLocal, cfg.utcOffsetHours);
        let guard = 0;
        while (sendMs < minMs && guard++ < 5) sendMs += DAY_MS;
    }
    // Tope superior: no más allá del máximo.
    if (sendMs > maxMs) sendMs = localTimeOnSameDay(maxMs, cfg.sendHourLocal, cfg.utcOffsetHours);

    return sendMs;
}

// Sanitiza el texto que irá en un parámetro de plantilla de Meta:
// sin saltos de línea/tabs, sin correr >4 espacios, recortado a un largo prudente.
function sanitizeTemplateParam(text) {
    return String(text || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 700);
}

// Pre-filtro barato: ¿el mensaje del cliente insinúa un aplazamiento a fecha futura?
// Solo si da positivo se gasta una llamada a Gemini. Los falsos positivos solo cuestan
// esa clasificación (que de todas formas decide en firme).
const DEFERRAL_HINT_RE = new RegExp([
    'mes(es)?', 'semana', 'quincena', 'fin de mes', 'quincena',
    'm[aá]s adelante', 'm[aá]s tarde', 'despu[eé]s', 'luego', 'al rato', 'm[aá]s al rato',
    'dentro de', 'en un(a)?\\s', 'pr[oó]xim', 'la que viene', 'entrante',
    'ahorita no', 'todav[ií]a no', 'a[uú]n no', 'por ahora no', 'por el momento no',
    'cuando (sepa|nazca|tenga|pueda|regrese|cobre|me pague|salga|vuelva|junte|termine)',
    'esper(a|ar|e|en|ame|arme|arnos|enme)', 'me esper', 'te esper', 'les esper', 'nos esper',
    'apart(a|ar|en|ado)', 'te (escribo|aviso|marco|contacto)', 'les (escribo|aviso|marco|contacto)',
    'me (escribes|avisas|contactas|marcas)', 'cont[aá]cten', 'reci[eé]n',
    '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)',
    'navidad', 'reyes', 'quincena', 'd[ií]a de'
].join('|'), 'i');

function hasDeferralHint(text) {
    if (!text || typeof text !== 'string') return false;
    return DEFERRAL_HINT_RE.test(text);
}

function normalizeReminderConfig(raw) {
    const merged = { ...DEFAULT_REMINDER_CONFIG, ...(raw || {}) };
    const num = (v, def, min, max) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return def;
        return Math.min(max == null ? n : max, Math.max(min, n));
    };

    const bh = merged.businessHours || {};
    let start = num(bh.start, 8, 0, 23);
    let end = num(bh.end, 21, 1, 24);
    if (end <= start) { start = 8; end = 21; }

    let templateName = String(merged.templateName || '').trim() || DEFAULT_REMINDER_CONFIG.templateName;
    let langCode = String(merged.langCode || '').trim() || DEFAULT_REMINDER_CONFIG.langCode;
    let fallbackMessage = String(merged.fallbackMessage || '').trim() || DEFAULT_REMINDER_CONFIG.fallbackMessage;

    return {
        enabled: merged.enabled === true,
        templateName,
        langCode,
        utcOffsetHours: num(merged.utcOffsetHours, -6, -12, 14),
        sendHourLocal: num(merged.sendHourLocal, 10, start, end),
        businessHours: { start, end },
        minFutureHours: num(merged.minFutureHours, 12, 0),
        maxFutureDays: num(merged.maxFutureDays, 120, 1, 365),
        graceDays: num(merged.graceDays, 3, 0, 30),
        maxPerSweep: num(merged.maxPerSweep, 40, 1, 200),
        liveDetect: merged.liveDetect !== false,
        fallbackMessage
    };
}

// --- Parseo robusto del JSON del clasificador de aplazamiento ------------------
function parseDeferralJson(text) {
    if (!text) return null;
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const m = t.match(/\{[\s\S]*\}/);
    if (m) t = m[0];
    try { return JSON.parse(t); } catch (_) { return null; }
}

// Normaliza la salida del clasificador a una forma segura.
// remindAt debe venir como 'YYYY-MM-DD'; si no matchea, se descarta (defer=false).
function normalizeDeferral(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    const remindAt = typeof parsed.remindAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(parsed.remindAt.trim())
        ? parsed.remindAt.trim().slice(0, 10)
        : '';
    const defer = parsed.defer === true && !!remindAt;
    return {
        defer,
        remindAt,
        reason: typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 200) : '',
        context: typeof parsed.context === 'string' ? parsed.context.trim().slice(0, 500) : '',
        message: typeof parsed.message === 'string' ? sanitizeTemplateParam(parsed.message) : ''
    };
}

module.exports = {
    DEFAULT_REMINDER_CONFIG,
    HOUR_MS,
    DAY_MS,
    toMillis,
    firstName,
    renderText,
    localHourOf,
    localTimeOnSameDay,
    computeSendAtMs,
    sanitizeTemplateParam,
    hasDeferralHint,
    normalizeReminderConfig,
    parseDeferralJson,
    normalizeDeferral
};
