/**
 * Pruebas del monto de la referencia OXXO por Mercado Pago que la IA pide con /oxxomp
 * (server/mercadopago/mercadopagoRoutes.js → resolveOxxoAmount). Firestore y demás van simulados.
 */

jest.mock('../server/config.js', () => ({ db: {}, admin: {}, app: null, bucket: null }));
jest.mock('../server/carritos/carritosRoutes.js', () => ({ markCartConverted: async () => {} }));

const { resolveOxxoAmount } = require('../server/mercadopago/mercadopagoRoutes');

describe('resolveOxxoAmount — el monto que se cobra en la referencia', () => {
    test('usa el monto que pidió la IA cuando cabe en el total (restante/anticipo)', () => {
        expect(resolveOxxoAmount({ requested: 450, orderTotal: 750 })).toBe(450);
        expect(resolveOxxoAmount({ requested: 750, orderTotal: 750 })).toBe(750);
    });

    test('si la IA pide MÁS que el total del pedido, se cobra el total (nunca de más)', () => {
        expect(resolveOxxoAmount({ requested: 1200, orderTotal: 750 })).toBe(750);
    });

    test('sin monto de la IA (o inválido), se cobra el total del pedido', () => {
        expect(resolveOxxoAmount({ requested: null, orderTotal: 750 })).toBe(750);
        expect(resolveOxxoAmount({ requested: 'abc', orderTotal: 1000 })).toBe(1000);
        expect(resolveOxxoAmount({ requested: 10, orderTotal: 750 })).toBe(750); // debajo del mínimo
    });

    test('sin total del pedido, se respeta el monto de la IA', () => {
        expect(resolveOxxoAmount({ requested: 300, orderTotal: 0 })).toBe(300);
    });

    test('sin nada cobrable devuelve null (el que llama avisa al admin)', () => {
        expect(resolveOxxoAmount({ requested: null, orderTotal: 0 })).toBeNull();
        expect(resolveOxxoAmount({ requested: 20, orderTotal: 30 })).toBeNull();
    });

    test('redondea a centavos', () => {
        expect(resolveOxxoAmount({ requested: 333.333, orderTotal: 1000 })).toBe(333.33);
    });
});

describe('detección del comando /oxxomp en la respuesta de la IA (misma regex que services.js)', () => {
    const RX = /\/oxxomp\b[^\S\n]*:?[^\S\n]*\$?[^\S\n]*(\d[\d,]*(?:\.\d+)?)?/i;
    const monto = (txt) => { const m = txt.match(RX); return m ? (m[1] ? Number(m[1].replace(/,/g, '')) : null) : undefined; };

    test('lee el monto en sus variantes típicas', () => {
        expect(monto('Te genero una nueva 😊[SPLIT]/oxxomp 750')).toBe(750);
        expect(monto('/oxxomp $1,000')).toBe(1000);
        expect(monto('/oxxomp: 450.50')).toBe(450.5);
    });

    test('sin monto devuelve null (se cobra el total) y sin comando no dispara', () => {
        expect(monto('/oxxomp')).toBeNull();
        expect(monto('Puedes pagar en oxxo con la referencia')).toBeUndefined();
        expect(monto('/oxxo')).toBeUndefined();
    });
});
