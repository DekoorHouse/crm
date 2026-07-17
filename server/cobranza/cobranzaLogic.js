// =================================================================
// === Lógica PURA de la cobranza automática (testeable) ============
// =================================================================
// Sin I/O ni dependencias de Firebase: el scheduler (cobranzaScheduler.js) le pasa
// los datos y esta función decide qué hacer con cada cliente. Regla de negocio
// (17-jul-2026): máx 3 cobros (1 por día); al tocar el 4º se CANCELA el pedido;
// a los 10 días en automatización sin resolverse, sale para revisión manual.
// Las promesas de pago con fecha PAUSAN el reloj de los 10 días (decisión del
// dueño, 17-jul-2026): al vencer la promesa, Andrea retoma con los cobros que
// le quedaban (nunca más de 3 en total) — el corte de 10 días solo aplica al
// silencio SIN promesa de por medio.

const MAX_ATTEMPTS = 3;  // cobros máximos por pedido
const MAX_DAYS = 10;     // días máximos en automatización (sin contar pausas por promesa)

// 'YYYY-MM-DD' → ms. México ya no tiene horario de verano: UTC-6 todo el año.
function dateStrToMs(d) {
    const ms = Date.parse(`${d}T00:00:00-06:00`);
    return Number.isFinite(ms) ? ms : null;
}

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

    // Corte de MAX_DAYS: el reloj corre desde el ancla MÁS RECIENTE — la entrada a la
    // automatización (firstAt) o la última promesa de pago aunque ya haya vencido
    // (la promesa PAUSA el reloj: al vencer, Andrea retoma con los cobros restantes
    // y el corte se cuenta desde la fecha prometida, no desde el arranque). Solo si
    // pasan MAX_DAYS de silencio SIN promesa de por medio, sale a revisión manual.
    const firstMs = orders
        .map(o => { const f = (o.cobranzaAuto || {}).firstAt; return f && typeof f.toMillis === 'function' ? f.toMillis() : null; })
        .filter(Boolean);
    const lapsedPromiseMs = orders
        .map(o => (o.cobranzaAuto || {}).futureDate)
        .filter(f => f && f <= todayMx)
        .map(dateStrToMs)
        .filter(Boolean);
    const anchorMs = Math.max(
        firstMs.length ? Math.min(...firstMs) : 0,
        lapsedPromiseMs.length ? Math.max(...lapsedPromiseMs) : 0
    );
    if (anchorMs && (nowMs - anchorMs) > MAX_DAYS * 24 * 60 * 60 * 1000) {
        return { action: 'expire', reason: `más de ${MAX_DAYS} días en cobranza sin promesa vigente` };
    }

    return { action: 'collect' };
}

module.exports = { decideCobranzaAction, MAX_ATTEMPTS, MAX_DAYS };
