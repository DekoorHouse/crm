jest.mock('../server/config', () => ({ db: {}, admin: {} }));
const { compraEnMercadoLibre, canRequestShippingForm, ventaMercadoLibre } = require('../server/payments/paymentPolicy');

describe('DH17047: venta hecha en Mercado Libre (ML envía a la dirección de su app)', () => {
    test('no se pide el formulario de datos a una venta de Mercado Libre', () => {
        const pagado = { comprobanteValidadoAt: { toMillis: () => 1 }, estatus: 'Pagado' };
        expect(canRequestShippingForm(pagado)).toBe(true);
        expect(canRequestShippingForm({ ...pagado, ventaMercadoLibre: true })).toBe(false);
        expect(ventaMercadoLibre({ ventaMercadoLibre: true })).toBe(true);
    });

    test.each([
        'Muchas gracias  ya los pedimos por mercado libre',
        'Ya lo compré en Mercado Libre',
        'Ya quedó, ya hice el pedido en Mercado Libre',
        'Hice la compra a través de Mercado Libre',
        'ya la pedí por mercadolibre',
    ])('compra ya hecha en ML: "%s"', t => expect(compraEnMercadoLibre(t)).toBe(true));

    test.each([
        'Les haré el pago por mercado libre',
        'Si por mercado libre mejor',
        'Mándame el enlace de mercado libre',
        'ya pagué por mercado libre',          // suele ser el link de Mercado Pago: ese envío lo hacemos nosotros
        'ya hice el pago por mercado libre',
        'Ya compré por mercado pago',
        'Pedí unas cosas en mercado libre y me llegaron otras',
        'Si me interesa, lo haré por mercado libre',
    ])('no es una compra hecha en ML: "%s"', t => expect(compraEnMercadoLibre(t)).toBe(false));
});
