const { isDefinitivelyFailed, normalizeReceiptOutcome } = require('../server/payments/receiptOutcome');
const failed = evidence => ({ esComprobante: true, pagoRealizado: false, estadoOperacion: 'rechazado', evidenciaEstado: evidence });

test.each([
    'TRANSACCIÓN NO REALIZADA POR HABER EXCEDIDO SU LÍMITE PERMITIDO',
    'Lo sentimos, la transacción no fue realizada. Devuélvele al cliente sus $312.00',
    'Operación rechazada', 'PAGO DENEGADO', 'Transferencia fallida', 'La operación fue rechazada'
])('recognizes an explicit failure: %s', text => expect(isDefinitivelyFailed(failed(text))).toBe(true));

test.each([
    { pagoRealizado: false },
    { ...failed(''), fecha: '2020-01-01' },
    failed('No se lee el folio'), failed('Referencia para pagar en OXXO'),
    { ...failed('Transferencia pendiente'), estadoOperacion: 'en_proceso' },
    { ...failed('Operación rechazada'), pagoRealizado: true },
    { ...failed('Operación rechazada'), estadoOperacion: 'desconocido' },
])('uncertainty and age are not definitive failures: %j', receipt => expect(isDefinitivelyFailed(receipt)).toBe(false));

test('contradictory OCR cannot approve or automatically discard a payment', () => {
    const result = normalizeReceiptOutcome({ ...failed('Operación rechazada'), pagoRealizado: true });
    expect(result).toMatchObject({ pagoRealizado: false, estadoOperacion: 'desconocido', outcomeVersion: 1 });
    expect(isDefinitivelyFailed(result)).toBe(false);
});
