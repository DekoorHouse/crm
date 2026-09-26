// REINTENTO DE REGISTRO con la IA encendida (DH17236 → DH17366, 26-sep-2026).
// La clienta pagó el anticipo de su compra nueva ANTES de dar los textos de sus lámparas. El registro
// no podía completarse (faltaban datos), el sistema apagó la IA y dejó el caso "para el equipo"; ella
// mandó los textos minutos después y nadie le contestó en 14 horas.
// Ahora, cuando llega el comprobante y el pedido no se puede registrar todavía porque FALTAN DATOS, la
// IA sigue encendida pidiendo lo que falta y cada turno vuelve a intentar el registro. Solo si se agota
// (intentos o tiempo) cae al flujo manual de siempre (IA apagada + Pendientes IA).
const RETRY_MAX_ATTEMPTS = 6;
const RETRY_WINDOW_MS = 48 * 60 * 60 * 1000;

const toMs = t => (t && typeof t.toMillis === 'function') ? t.toMillis()
    : (t && t._seconds ? t._seconds * 1000 : (t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : 0)));

// ¿Hay un reintento vigente en el contacto?
function retryActive(contact, now = Date.now()) {
    const r = contact && contact.registrationRetry;
    if (!r) return false;
    const since = toMs(r.since);
    return !!since && (now - since) <= RETRY_WINDOW_MS && (Number(r.attempts) || 0) < RETRY_MAX_ATTEMPTS;
}

// Solo "faltan datos" se reintenta. Un total que no cuadra, un duplicado o un pedido que ya no se puede
// editar necesitan a una persona, igual que antes.
function isMissingDataFailure(motivo) {
    return /^el extractor no lo ve listo/i.test(String(motivo || ''));
}

// Nota para la IA mientras el reintento está vigente: ya pagó, falta un dato; pedir SOLO eso.
function retryNote(contact) {
    const r = contact && contact.registrationRetry;
    if (!retryActive(contact)) return '';
    const falta = String((r && r.faltante) || '').replace(/^el extractor no lo ve listo:\s*/i, '').trim();
    return `\n\n**REGISTRO PENDIENTE (el cliente YA mandó el comprobante del anticipo):** su pedido todavía no se puede registrar porque faltan datos${falta ? ` — según el sistema: ${falta}` : ''}. Pídele con amabilidad SOLO lo que falta (y confirma el resumen si hace falta). NO le pidas otra vez el comprobante ni el pago, y NO digas que ya está registrado: el sistema lo registra solo en cuanto estén los datos.`;
}

module.exports = { retryActive, isMissingDataFailure, retryNote, RETRY_MAX_ATTEMPTS, RETRY_WINDOW_MS };
