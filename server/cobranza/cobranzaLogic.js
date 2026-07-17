// =================================================================
// === Lógica PURA de la cobranza automática (testeable) ============
// =================================================================
// Sin I/O ni dependencias de Firebase: el scheduler (cobranzaScheduler.js) le pasa
// los datos y esta función decide qué hacer con cada cliente. Regla de negocio
// (17-jul-2026): máx 3 cobros (1 por día); al tocar el 4º se CANCELA el pedido;
// a los 10 días en automatización sin resolverse, sale para revisión manual.

const MAX_ATTEMPTS = 3;  // cobros máximos por pedido
const MAX_DAYS = 10;     // días máximos en automatización

/**
 * Decisión de negocio para UN cliente (con todos sus pedidos cobrables agrupados).
 * @param {Array<{cobranzaAuto?: {attempts?: number, firstAt?: {toMillis: Function}, futureDate?: string}}>} orders
 * @param {string} todayMx - 'YYYY-MM-DD' (hora de México)
 * @param {number} nowMs - Date.now()
 * @returns {{action: 'skip_future'|'cancel'|'expire'|'collect', reason?: string}}
 */
function decideCobranzaAction(orders, todayMx, nowMs) {
    // Promesa de pago futura vigente en cualquiera de sus pedidos: se respeta (no
    // se cobra NI se cancela — el cliente está comprometido a una fecha).
    const future = orders.map(o => (o.cobranzaAuto || {}).futureDate).filter(f => f && f > todayMx);
    if (future.length) {
        return { action: 'skip_future', reason: `promesa de pago para ${future.sort()[0]}` };
    }

    // Ya se hicieron los 3 cobros sin pago: cuando tocaría el 4º, se cancela.
    const attempts = Math.max(0, ...orders.map(o => (o.cobranzaAuto || {}).attempts || 0));
    if (attempts >= MAX_ATTEMPTS) {
        return { action: 'cancel', reason: `${attempts} cobros sin pago` };
    }

    // Lleva más de MAX_DAYS en la automatización sin completar el ciclo (promesas o
    // conversaciones fueron pausando los cobros): fuera de la automatización, SIN
    // cancelar — hubo interacción de por medio; que lo revise un humano.
    const firstMs = orders
        .map(o => { const f = (o.cobranzaAuto || {}).firstAt; return f && typeof f.toMillis === 'function' ? f.toMillis() : null; })
        .filter(Boolean);
    if (firstMs.length && (nowMs - Math.min(...firstMs)) > MAX_DAYS * 24 * 60 * 60 * 1000) {
        return { action: 'expire', reason: `más de ${MAX_DAYS} días en cobranza` };
    }

    return { action: 'collect' };
}

module.exports = { decideCobranzaAction, MAX_ATTEMPTS, MAX_DAYS };
