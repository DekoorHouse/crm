/**
 * Reactivación de leads - Lógica pura (sin Firebase, testeable en aislamiento)
 *
 * Un "seguimiento" (lead_followups/{wa_id}) se arma con cada mensaje entrante
 * del cliente. Si pasado un tiempo no registró pedido, se le envía una
 * secuencia de mensajes para reactivarlo. Aquí vive solo la lógica de
 * decisión; el I/O (Firestore, WhatsApp) está en leadReactivationScheduler.js
 */

const DEFAULT_CONFIG = {
    enabled: true,
    // Secuencia de seguimientos. delayMinutes se mide desde el ÚLTIMO mensaje
    // entrante del cliente. {{nombre}} se sustituye por el primer nombre.
    followups: [
        {
            delayMinutes: 15,
            text: '¡Hola{{nombre}}! 😊 Vimos tu mensaje hace un momento. ¿Te ayudamos a elegir tu producto o a completar tu pedido? Con gusto te atendemos 🙌'
        },
        {
            delayMinutes: 240, // 4 horas
            text: 'Hola{{nombre}} 👋 Seguimos al pendiente por si tienes alguna duda o quieres que te apoyemos con tu pedido. ¡Estamos para ayudarte! ✨'
        }
    ],
    // Si el contacto registró un pedido hace menos de N días antes de escribir,
    // se asume cliente reciente (p. ej. pregunta por su entrega) y no se le insiste.
    minDaysSinceLastOrder: 15,
    // Tras terminar una secuencia, no iniciar otra para el mismo contacto
    // durante este periodo aunque vuelva a escribir (anti-spam).
    cooldownHours: 24,
    maxPerSweep: 50
};

// WhatsApp solo permite texto libre dentro de las 24h posteriores al último
// mensaje del cliente. Margen de 30 min para no rozar el límite.
const WHATSAPP_WINDOW_MS = 23.5 * 60 * 60 * 1000;

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
function renderFollowupText(template, name) {
    const nombre = firstName(name);
    return String(template || '').replace(/\s*\{\{\s*nombre\s*\}\}/gi, nombre ? ` ${nombre}` : '');
}

function normalizeConfig(raw) {
    const merged = { ...DEFAULT_CONFIG, ...(raw || {}) };

    let followups = Array.isArray(merged.followups) ? merged.followups : [];
    followups = followups
        .map(f => ({ delayMinutes: Number(f && f.delayMinutes), text: String((f && f.text) || '').trim() }))
        .filter(f => Number.isFinite(f.delayMinutes) && f.delayMinutes >= 1 && f.text)
        .sort((a, b) => a.delayMinutes - b.delayMinutes);
    if (followups.length === 0) followups = DEFAULT_CONFIG.followups;

    const num = (v, def, min) => (Number.isFinite(Number(v)) ? Math.max(min, Number(v)) : def);

    return {
        enabled: merged.enabled !== false,
        followups,
        minDaysSinceLastOrder: num(merged.minDaysSinceLastOrder, DEFAULT_CONFIG.minDaysSinceLastOrder, 0),
        cooldownHours: num(merged.cooldownHours, DEFAULT_CONFIG.cooldownHours, 0),
        maxPerSweep: Math.min(200, num(merged.maxPerSweep, DEFAULT_CONFIG.maxPerSweep, 1))
    };
}

/**
 * Decide qué hacer con un seguimiento pendiente.
 *
 * @param {object} followup Doc de lead_followups ({ status, stage, lastInboundAt, name })
 * @param {object|null} contact Doc de contacts_whatsapp (para lastOrderDate y name)
 * @param {object} config Config normalizada
 * @param {number} nowMs Date.now()
 * @returns {{action: 'none'|'wait'|'send'|'done'|'expire'|'skip_recent'|'cancel', stage?: number, text?: string, reason?: string}}
 */
function evaluateFollowup(followup, contact, config, nowMs) {
    if (!followup || followup.status !== 'pending') return { action: 'none' };

    const stage = followup.stage || 0;
    if (stage >= config.followups.length) return { action: 'done' };

    const inboundMs = toMillis(followup.lastInboundAt);
    if (!inboundMs) return { action: 'cancel', reason: 'sin_fecha_de_mensaje' };

    const dueMs = inboundMs + config.followups[stage].delayMinutes * 60 * 1000;
    if (nowMs < dueMs) return { action: 'wait' };

    // Fuera de la ventana de 24h ya no se puede enviar texto libre
    if (nowMs - inboundMs > WHATSAPP_WINDOW_MS) return { action: 'expire' };

    if (!contact) return { action: 'cancel', reason: 'contacto_inexistente' };

    const orderMs = toMillis(contact.lastOrderDate);
    // Registró pedido después de escribir: objetivo cumplido, no enviar nada
    if (orderMs && orderMs >= inboundMs) return { action: 'cancel', reason: 'pedido_registrado' };
    // Cliente con pedido reciente (probablemente pregunta por su entrega): no insistir
    if (orderMs && (inboundMs - orderMs) < config.minDaysSinceLastOrder * 24 * 60 * 60 * 1000) {
        return { action: 'skip_recent' };
    }

    return {
        action: 'send',
        stage,
        text: renderFollowupText(config.followups[stage].text, (contact && contact.name) || followup.name)
    };
}

module.exports = {
    DEFAULT_CONFIG,
    WHATSAPP_WINDOW_MS,
    toMillis,
    firstName,
    renderFollowupText,
    normalizeConfig,
    evaluateFollowup
};
