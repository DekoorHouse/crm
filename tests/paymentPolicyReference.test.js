jest.mock('../server/config', () => ({ db: {}, admin: {} }));
const { receiptKeyMatches, possibleSamePayment } = require('../server/payments/paymentPolicy');

describe('DH17926: la misma referencia (la fecha) en pagos de dos clientes distintos', () => {
    const lily = { monto: 750, fecha: '2026-10-09', hora: '14:04', referencia: '91026', claveRastreo: null, cuentaOrigen: '**293', cuentaDestino: '**670' };
    const otro = { claveRastreo: '085904939210328262', cuentaOrigen: '**307' };

    test('otra terminación de origen (aunque sea de 3 dígitos) no es el mismo pago', () => {
        expect(receiptKeyMatches('folio_x', lily, otro)).toBe(false);
    });
    test('otra hora (a más de 2 minutos) tampoco', () => {
        expect(receiptKeyMatches('folio_x', { ...lily, cuentaOrigen: null }, { hora: '10:40' })).toBe(false);
    });
    test('sin datos para desempatar se sigue bloqueando (como antes)', () => {
        expect(receiptKeyMatches('folio_x', { ...lily, cuentaOrigen: null, hora: null }, { claveRastreo: null, cuentaOrigen: null })).toBe(true);
    });
    test('la misma imagen siempre es el mismo pago', () => {
        expect(receiptKeyMatches('image_x', lily, otro)).toBe(true);
    });
    test('la misma cuenta y la misma hora siguen siendo el mismo pago', () => {
        expect(possibleSamePayment({ ocr: lily }, { ocr: { ...lily } })).toBe(true);
    });
});
