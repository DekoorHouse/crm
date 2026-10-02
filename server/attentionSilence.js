// "ATENDIDO" SE RESPETA (Chris, 2-oct-2026): "cuando le doy Atendido, ¿por qué me vuelven a aparecer
// si no les respondo? Hay unos que no ocupan respuesta". La mayoría volvía por el MISMO motivo: el
// candado de adjuntos (mediaReplyGuard) o el /equipo de la IA re-marcaban el chat cada vez que Leonel
// repetía "le pido al equipo la foto". Al dar Atendido se guarda cuándo y por qué motivo; durante 12 h
// ese mismo motivo ya no vuelve a marcar la conversación. Un motivo distinto sí la marca.
const SILENCIO_MS = 12 * 60 * 60 * 1000;

const toMs = t => (t && typeof t.toMillis === 'function') ? t.toMillis()
    : (t && t._seconds ? t._seconds * 1000 : (t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : 0)));

function silenciadoPorAtendido(contact, reason, now = Date.now()) {
    if (!contact || !reason) return false;
    const at = toMs(contact.attendedAt);
    return !!at && (now - at) < SILENCIO_MS && contact.attendedReason === reason;
}

module.exports = { silenciadoPorAtendido, SILENCIO_MS };
