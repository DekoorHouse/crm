/**
 * Pruebas del desglose por campaña de /pedidos/desglose
 * (server/orders/desgloseCampanas.js). Lógica pura: no toca Firestore ni Meta.
 */
const { agregarPorCampana } = require('../server/orders/desgloseCampanas');

const MAPA = {
    'ad1': { campaignId: 'c1', campaignName: 'Corazones//4ads' },
    'ad2': { campaignId: 'c1', campaignName: 'Corazones//4ads' },
    'ad3': { campaignId: 'c2', campaignName: 'Infantiles//Dino' }
};

const porNombre = (r, nombre) => r.campanas.find(c => c.nombre === nombre);
const pedido = (attrs) => ({ estatus: 'Pagado', precio: 850, items: [{ producto: 'Corazón', cantidad: 1, precio: 850 }], ...attrs });

describe('agregarPorCampana — agrupación', () => {
    test('junta en una campaña los pedidos de sus distintos anuncios', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1' }),
            pedido({ attributedAdId: 'ad2' }),
            pedido({ attributedAdId: 'ad3' })
        ], MAPA);

        expect(porNombre(r, 'Corazones//4ads')).toMatchObject({ id: 'c1', pedidos: 2, piezas: 2 });
        expect(porNombre(r, 'Infantiles//Dino')).toMatchObject({ id: 'c2', pedidos: 1, piezas: 1 });
    });

    test('lista los anuncios que alimentaron cada campaña', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1' }),
            pedido({ attributedAdId: 'ad2' }),
            pedido({ attributedAdId: 'ad1' })
        ], MAPA);

        expect(porNombre(r, 'Corazones//4ads').ads.sort()).toEqual(['ad1', 'ad2']);
    });

    test('un pedido sin anuncio atribuido cae en Orgánico / Directo', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1' }),
            pedido({ leadSource: 'organic' }),
            pedido({})
        ], MAPA);

        expect(porNombre(r, 'Orgánico / Directo')).toMatchObject({ pedidos: 2, piezas: 2 });
        expect(porNombre(r, 'Orgánico / Directo').ads).toEqual([]);
    });

    test('los anuncios que Meta no resolvió caen todos en una sola tarjeta con sus IDs', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'borrado1' }),
            pedido({ attributedAdId: 'borrado2' })
        ], MAPA);

        const sinCampana = porNombre(r, 'Campaña no identificada');
        expect(sinCampana.pedidos).toBe(2);
        expect(sinCampana.ads.sort()).toEqual(['borrado1', 'borrado2']);
        expect(r.campanas).toHaveLength(1);
    });

    test('con el mapa vacío (Meta caída) no se pierde ningún pedido', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1' }),
            pedido({ attributedAdId: 'ad3' }),
            pedido({})
        ], {});

        expect(r.totalPedidos).toBe(3);
        expect(porNombre(r, 'Campaña no identificada').pedidos).toBe(2);
        expect(porNombre(r, 'Orgánico / Directo').pedidos).toBe(1);
    });

    test('el ID numérico del pedido se compara como texto (Firestore lo puede traer number)', () => {
        const r = agregarPorCampana(
            [pedido({ attributedAdId: 123456 })],
            { '123456': { campaignId: 'c9', campaignName: 'Campaña vieja' } }
        );

        expect(porNombre(r, 'Campaña vieja').pedidos).toBe(1);
    });
});

describe('agregarPorCampana — totales', () => {
    test('cada pedido cuenta en UNA sola campaña: los pedidos suman el total exacto', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1', precio: 1050, items: [
                { producto: 'Corazón', cantidad: 1, precio: 850 },
                { producto: 'Rex', cantidad: 1, precio: 200 }
            ] }),
            pedido({ attributedAdId: 'ad3', precio: 850 })
        ], MAPA);

        expect(r.campanas.reduce((s, c) => s + c.pedidos, 0)).toBe(r.totalPedidos);
        expect(r.campanas.reduce((s, c) => s + c.piezas, 0)).toBe(r.totalPiezas);
        expect(r.campanas.reduce((s, c) => s + c.monto, 0)).toBe(r.totalMonto);
        expect(r.totalMonto).toBe(1900);
        expect(r.totalPiezas).toBe(3);
    });

    test('el monto de la campaña sale del precio del pedido, no de las líneas', () => {
        // El pedido trae descuento: 900 cobrados aunque las líneas sumen 1050.
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1', precio: 900, items: [
                { producto: 'Corazón', cantidad: 1, precio: 850 },
                { producto: 'Rex', cantidad: 1, precio: 200 }
            ] })
        ], MAPA);

        expect(porNombre(r, 'Corazones//4ads').monto).toBe(900);
    });

    test('pedidos legacy sin items cuentan una pieza', () => {
        const r = agregarPorCampana([
            { attributedAdId: 'ad1', estatus: 'Pagado', producto: 'Guerreras', precio: 950, items: undefined }
        ], MAPA);

        expect(porNombre(r, 'Corazones//4ads')).toMatchObject({ piezas: 1, pedidos: 1, monto: 950 });
    });

    test('sin pedidos devuelve todo en cero', () => {
        expect(agregarPorCampana([], MAPA)).toEqual({
            campanas: [],
            totalPiezas: 0,
            totalPedidos: 0,
            totalMonto: 0
        });
    });
});

describe('agregarPorCampana — detalle de la tarjeta', () => {
    test('desglosa las piezas de la campaña por producto, de mayor a menor', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1', items: [{ producto: 'Corazón', cantidad: 3, precio: 850 }] }),
            pedido({ attributedAdId: 'ad2', items: [
                { producto: 'Rex', cantidad: 1, precio: 200 },
                { producto: 'Corazón', cantidad: 1, precio: 850 }
            ] })
        ], MAPA);

        expect(porNombre(r, 'Corazones//4ads').porProducto).toEqual([
            { producto: 'Corazón', piezas: 4 },
            { producto: 'Rex', piezas: 1 }
        ]);
    });

    test('acumula las piezas por estatus del pedido', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1', estatus: 'Pagado', items: [{ producto: 'Corazón', cantidad: 2, precio: 850 }] }),
            pedido({ attributedAdId: 'ad1', estatus: 'Fabricar' }),
            pedido({ attributedAdId: 'ad1', estatus: undefined })
        ], MAPA);

        expect(porNombre(r, 'Corazones//4ads').porEstatus).toEqual({
            'Pagado': 2,
            'Fabricar': 1,
            'Sin estatus': 1
        });
    });

    test('lista los folios de más nuevo a más viejo y los legacy sin folio al final', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1', consecutiveOrderNumber: 10 }),
            pedido({ attributedAdId: 'ad2', consecutiveOrderNumber: 30 }),
            pedido({ attributedAdId: 'ad1' })
        ], MAPA);

        expect(porNombre(r, 'Corazones//4ads').listaPedidos.map(p => p.numero)).toEqual([30, 10, null]);
    });

    test('un pedido con dos productos es UNA fila con las piezas sumadas', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1', consecutiveOrderNumber: 77, items: [
                { producto: 'Corazón', cantidad: 1, precio: 850 },
                { producto: 'Rex', cantidad: 2, precio: 200 }
            ] })
        ], MAPA);

        expect(porNombre(r, 'Corazones//4ads').listaPedidos).toEqual([
            { numero: 77, estatus: 'Pagado', piezas: 3, contactId: null }
        ]);
    });
});

describe('agregarPorCampana — costo por pedido', () => {
    test('divide el gasto de Meta entre los pedidos de esa campaña', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad1' }),
            pedido({ attributedAdId: 'ad2' }),
            pedido({ attributedAdId: 'ad3' })
        ], MAPA, { c1: 1000, c2: 300 });

        expect(porNombre(r, 'Corazones//4ads')).toMatchObject({ gasto: 1000, pedidos: 2, costoPorPedido: 500 });
        expect(porNombre(r, 'Infantiles//Dino')).toMatchObject({ gasto: 300, pedidos: 1, costoPorPedido: 300 });
    });

    test('el orgánico no tiene gasto: va null, NO cero', () => {
        // Un $0 se leería como "no costó nada"; null es "no aplica".
        const r = agregarPorCampana([pedido({})], MAPA, { c1: 1000 });

        expect(porNombre(r, 'Orgánico / Directo')).toMatchObject({ gasto: null, costoPorPedido: null });
    });

    test('la cubeta de anuncios sin campaña tampoco reparte gasto', () => {
        const r = agregarPorCampana([pedido({ attributedAdId: 'borrado' })], MAPA, { c1: 1000 });

        expect(porNombre(r, 'Campaña no identificada')).toMatchObject({ gasto: null, costoPorPedido: null });
    });

    test('sin datos de Meta el desglose se arma igual, solo sin costo', () => {
        const r = agregarPorCampana([pedido({ attributedAdId: 'ad1' })], MAPA, {});

        expect(porNombre(r, 'Corazones//4ads')).toMatchObject({ pedidos: 1, gasto: null, costoPorPedido: null });
    });

    test('una campaña que gastó $0 sí muestra $0, no null', () => {
        // Gastó de verdad cero (pausada a media jornada), que es distinto de
        // "no sabemos cuánto gastó".
        const r = agregarPorCampana([pedido({ attributedAdId: 'ad1' })], MAPA, { c1: 0 });

        expect(porNombre(r, 'Corazones//4ads')).toMatchObject({ gasto: 0, costoPorPedido: 0 });
    });
});

describe('agregarPorCampana — orden', () => {
    test('ordena de más a menos PEDIDOS (el número grande de la tarjeta)', () => {
        const r = agregarPorCampana([
            // Dino: 1 pedido de 10 piezas. Corazones: 2 pedidos de 1 pieza.
            pedido({ attributedAdId: 'ad3', items: [{ producto: 'Corazón', cantidad: 10, precio: 850 }] }),
            pedido({ attributedAdId: 'ad1' }),
            pedido({ attributedAdId: 'ad2' })
        ], MAPA);

        expect(r.campanas.map(c => c.nombre)).toEqual(['Corazones//4ads', 'Infantiles//Dino']);
    });

    test('a igualdad de pedidos desempatan las piezas', () => {
        const r = agregarPorCampana([
            pedido({ attributedAdId: 'ad3' }),
            pedido({ attributedAdId: 'ad1', items: [{ producto: 'Corazón', cantidad: 5, precio: 850 }] }),
            pedido({})
        ], MAPA);

        expect(r.campanas.map(c => c.nombre)).toEqual([
            'Corazones//4ads',
            'Infantiles//Dino',
            'Orgánico / Directo'
        ]);
    });
});
