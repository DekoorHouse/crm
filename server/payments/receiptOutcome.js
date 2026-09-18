const OUTCOME_VERSION = 1;
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Exigir estado explícito y texto visible: false también representa operaciones
// en proceso y lecturas inciertas en los comprobantes anteriores a esta versión.
function isDefinitivelyFailed(receipt = {}) {
    if (receipt.pagoRealizado !== false || receipt.estadoOperacion !== 'rechazado') return false;
    const text = normalized(receipt.evidenciaEstado);
    return /\b(?:transaccion|operacion|pago|deposito|transferencia)\s+(?:no\s+(?:fue\s+)?(?:realizad[oa]|procesad[oa]|completad[oa]|autorizad[oa])|rechazad[oa]|denegad[oa]|declinad[oa]|fallid[oa])\b/.test(text)
        || /\b(?:transaccion|operacion|pago)\s+(?:ha sido|fue)\s+(?:rechazad[oa]|denegad[oa]|declinad[oa])\b/.test(text);
}

function normalizeReceiptOutcome(data) {
    const estadoOperacion = ['realizado', 'en_proceso', 'rechazado', 'desconocido'].includes(data.estadoOperacion) ? data.estadoOperacion : 'desconocido';
    const receipt = { ...data, estadoOperacion, evidenciaEstado: String(data.evidenciaEstado || '').trim().slice(0, 400), outcomeVersion: OUTCOME_VERSION };
    // Una lectura contradictoria conserva la revisión humana y no acredita dinero.
    if (['en_proceso', 'rechazado'].includes(estadoOperacion)) {
        receipt.pagoRealizado = false;
        if (data.pagoRealizado === true) receipt.estadoOperacion = 'desconocido';
    }
    return receipt;
}

module.exports = { OUTCOME_VERSION, isDefinitivelyFailed, normalizeReceiptOutcome };
