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

describe('DH18191: el mismo ticket OXXO leído con la autorización en campos distintos', () => {
    const { possibleSamePayment, receiptFolios } = require('../server/payments/paymentPolicy');
    const foto1 = { monto: 300, fecha: '2026-10-16', hora: '16:52', cuentaDestino: '************1983', evidenciaEstado: 'AUTORIZACION : 665972', referencia: '665972', claveRastreo: '2396077253' };
    const foto2 = { monto: 300, fecha: '2026-10-16', hora: '16:52', cuentaDestino: '************1983', evidenciaEstado: '', referencia: '************1983', claveRastreo: '665972' };
    test('la autorización cuenta como folio', () => {
        expect(receiptFolios(foto1)).toContain('665972');
    });
    test('se reconoce como el mismo pago', () => {
        expect(possibleSamePayment({ contactId: 'c', ocr: foto1 }, { contactId: 'c', ocr: foto2 })).toBe(true);
    });
    test('dos depósitos con autorizaciones distintas siguen siendo distintos', () => {
        const otro = { ...foto2, claveRastreo: '771234', hora: '18:10' };
        expect(possibleSamePayment({ contactId: 'c', ocr: foto1 }, { contactId: 'c', ocr: otro })).toBe(false);
    });
});
