// =================================================================
// === Lógica PURA de la cobranza automática (testeable) ============
// =================================================================
// Sin I/O ni dependencias de Firebase: el scheduler (cobranzaScheduler.js) le pasa
// los datos y esta función decide qué hacer con cada cliente.
//
// Regla de negocio (17-jul-2026, actualizada el mismo día a 4 toques espaciados):
//   - Máximo 4 cobros por pedido, ESPACIADOS: día 0 (la misma tarde de la foto,
//     pase vespertino), día 2, día 5 y día 9 (última llamada). Al día siguiente
//     del 4º cobro sin pago (≈ día 10), el pedido se CANCELA.
//   - Las promesas de pago con fecha PAUSAN todo: al vencer, Andrea retoma con
//     los cobros restantes y el reloj de los 10 días se re-ancla en la promesa.
//   - El corte de MAX_DAYS (10) a revisión manual aplica solo al silencio SIN
//     promesa de por medio (p. ej. conversaciones que fueron pausando cobros).

const MAX_ATTEMPTS = 4;  // cobros máximos por pedido
const MAX_DAYS = 10;     // días máximos en automatización (sin contar pausas por promesa)

// Espaciado del ciclo: días de espera DESPUÉS del cobro N para mandar el N+1.
// Con el cobro 1 en el día 0: +2 → día 2, +3 → día 5, +4 → día 9.
const GAP_AFTER_ATTEMPT = { 1: 2, 2: 3, 3: 4 };

// 'YYYY-MM-DD' → ms. México ya no tiene horario de verano: UTC-6 todo el año.
function dateStrToMs(d) {
    const ms = Date.parse(`${d}T00:00:00-06:00`);
    return Number.isFinite(ms) ? ms : null;
}

// Días CALENDARIO entre dos fechas 'YYYY-MM-DD' (to - from). null si algo no parsea.
function daysBetween(fromStr, toStr) {
    const a = dateStrToMs(fromStr), b = dateStrToMs(toStr);
    if (a == null || b == null) return null;
    return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * Decisión de negocio para UN cliente (con todos sus pedidos cobrables agrupados).
 * @param {Array<{cobranzaAuto?: {attempts?: number, firstAt?: {toMillis: Function}, lastDate?: string, futureDate?: string}}>} orders
 * @param {string} todayMx - 'YYYY-MM-DD' (hora de México)
 * @param {number} nowMs - Date.now()
 * @returns {{action: 'skip_future'|'cancel'|'expire'|'wait'|'collect', reason?: string}}
 */
function decideCobranzaAction(orders, todayMx, nowMs) {
    // Promesa de pago futura vigente en cualquiera de sus pedidos: se respeta (no
    // se cobra NI se cancela — el cliente está comprometido a una fecha).
    const future = orders.map(o => (o.cobranzaAuto || {}).futureDate).filter(f => f && f > todayMx);
    if (future.length) {
        return { action: 'skip_future', reason: `promesa de pago para ${future.sort()[0]}` };
    }

    // Ya se hicieron los 4 cobros sin pago: al día siguiente del último, se cancela.
    const attempts = Math.max(0, ...orders.map(o => (o.cobranzaAuto || {}).attempts || 0));
    if (attempts >= MAX_ATTEMPTS) {
        return { action: 'cancel', reason: `${attempts} cobros sin pago` };
    }

    // Corte de MAX_DAYS: el reloj corre desde el ancla MÁS RECIENTE — la entrada a la
    // automatización (firstAt) o la última promesa de pago aunque ya haya vencido
    // (la promesa PAUSA el reloj). Solo si pasan MAX_DAYS de silencio SIN promesa
    // de por medio, sale a revisión manual.
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

    // Espaciado: ¿ya toca el siguiente cobro? Se cuenta en días CALENDARIO desde el
    // último cobro (lastDate). Si por promesas o pausas ya pasaron más días que el
    // gap, se cobra de inmediato (el gap es un MÍNIMO, no una cita exacta).
    if (attempts > 0) {
        const gap = GAP_AFTER_ATTEMPT[attempts];
        const lastDates = orders.map(o => (o.cobranzaAuto || {}).lastDate).filter(Boolean).sort();
        const lastDate = lastDates.length ? lastDates[lastDates.length - 1] : null; // la más reciente
        if (gap != null && lastDate) {
            const elapsed = daysBetween(lastDate, todayMx);
            if (elapsed != null && elapsed < gap) {
                return { action: 'wait', reason: `cobro ${attempts + 1} programado para dentro de ${gap - elapsed} día(s)` };
            }
        }
    }

    return { action: 'collect' };
}

module.exports = { decideCobranzaAction, MAX_ATTEMPTS, MAX_DAYS, GAP_AFTER_ATTEMPT, daysBetween };
