/**
 * Pruebas del desglose por producto de /pedidos/desglose
 * (server/orders/desgloseProductos.js). Lógica pura: no toca Firestore.
 */
const { agregarPorProducto, folioDelPedido } = require('../server/orders/desgloseProductos');

const porNombre = (resultado, nombre) => resultado.productos.find(p => p.producto === nombre);

describe('agregarPorProducto — conteo de piezas', () => {
    test('suma las cantidades de items, no los pedidos', () => {
        const r = agregarPorProducto([
            { estatus: 'Pagado', precio: 1700, items: [{ producto: 'Corazón', cantidad: 2, precio: 850 }] },
            { estatus: 'Pagado', precio: 850, items: [{ producto: 'Corazón', cantidad: 1, precio: 850 }] }
        ]);

        expect(porNombre(r, 'Corazón').piezas).toBe(3);
        expect(porNombre(r, 'Corazón').pedidos).toBe(2);
        expect(r.totalPiezas).toBe(3);
        expect(r.totalPedidos).toBe(2);
    });

    test('un pedido con varios productos cuenta 1 pedido en cada uno', () => {
        const r = agregarPorProducto([
            {
                estatus: 'Fabricar',
                precio: 1050,
                items: [
                    { producto: 'Corazón', cantidad: 1, precio: 850 },
                    { producto: 'Rex', cantidad: 1, precio: 200 }
                ]
            }
        ]);

        expect(porNombre(r, 'Corazón').pedidos).toBe(1);
        expect(porNombre(r, 'Rex').pedidos).toBe(1);
        expect(r.totalPedidos).toBe(1);
        expect(r.totalPiezas).toBe(2);
    });

    test('el mismo producto repetido en dos líneas sigue siendo 1 pedido', () => {
        const r = agregarPorProducto([
            {
                estatus: 'Pagado',
                precio: 1700,
                items: [
                    { producto: 'Corazón', cantidad: 1, precio: 850 },
                    { producto: 'Corazón', cantidad: 1, precio: 850 }
                ]
            }
        ]);

        expect(porNombre(r, 'Corazón').piezas).toBe(2);
        expect(porNombre(r, 'Corazón').pedidos).toBe(1);
    });
});

describe('agregarPorProducto — pedidos legacy sin items', () => {
    test('cuentan como una pieza con el precio del pedido', () => {
        const r = agregarPorProducto([
            { estatus: 'Pagado', producto: 'Guerreras', precio: 950 }
        ]);

        expect(porNombre(r, 'Guerreras')).toMatchObject({ piezas: 1, pedidos: 1, monto: 950 });
    });

    test('sin producto ni items caen en "Sin producto" y no se pierden del total', () => {
        const r = agregarPorProducto([{ estatus: 'Cancelado', precio: 0 }]);

        expect(porNombre(r, 'Sin producto').piezas).toBe(1);
        expect(r.totalPiezas).toBe(1);
    });
});

describe('agregarPorProducto — montos', () => {
    test('el precio de la línea es unitario: se multiplica por la cantidad', () => {
        const r = agregarPorProducto([
            { estatus: 'Pagado', precio: 1700, items: [{ producto: 'Corazón', cantidad: 2, precio: 850 }] }
        ]);

        expect(porNombre(r, 'Corazón').monto).toBe(1700);
    });

    test('el total del filtro sale del precio del pedido', () => {
        const r = agregarPorProducto([
            { estatus: 'Pagado', precio: 1050, items: [
                { producto: 'Corazón', cantidad: 1, precio: 850 },
                { producto: 'Rex', cantidad: 1, precio: 200 }
            ] },
            { estatus: 'Pagado', producto: 'Especial', precio: 950 }
        ]);

        expect(r.totalMonto).toBe(2000);
    });
});

describe('agregarPorProducto — desglose por estatus', () => {
    test('acumula piezas por estatus del pedido', () => {
        const r = agregarPorProducto([
            { estatus: 'Pagado', precio: 1700, items: [{ producto: 'Corazón', cantidad: 2, precio: 850 }] },
            { estatus: 'Fabricar', precio: 850, items: [{ producto: 'Corazón', cantidad: 1, precio: 850 }] },
            { precio: 850, items: [{ producto: 'Corazón', cantidad: 1, precio: 850 }] }
        ]);

        expect(porNombre(r, 'Corazón').porEstatus).toEqual({
            'Pagado': 2,
            'Fabricar': 1,
            'Sin estatus': 1
        });
    });
});

describe('agregarPorProducto — orden y bordes', () => {
    test('ordena de más a menos piezas', () => {
        const r = agregarPorProducto([
            { estatus: 'Pagado', precio: 200, items: [{ producto: 'Rex', cantidad: 1, precio: 200 }] },
            { estatus: 'Pagado', precio: 2550, items: [{ producto: 'Corazón', cantidad: 3, precio: 850 }] },
            { estatus: 'Pagado', precio: 1900, items: [{ producto: 'Especial', cantidad: 2, precio: 950 }] }
        ]);

        expect(r.productos.map(p => p.producto)).toEqual(['Corazón', 'Especial', 'Rex']);
    });

    test('cantidad ausente o basura cuenta como 1', () => {
        const r = agregarPorProducto([
            { estatus: 'Pagado', precio: 850, items: [{ producto: 'Corazón', precio: 850 }] },
            { estatus: 'Pagado', precio: 850, items: [{ producto: 'Corazón', cantidad: 'dos', precio: 850 }] },
            { estatus: 'Pagado', precio: 850, items: [{ producto: 'Corazón', cantidad: 0, precio: 850 }] }
        ]);

        expect(porNombre(r, 'Corazón').piezas).toBe(3);
    });

    test('sin pedidos devuelve todo en cero', () => {
        expect(agregarPorProducto([])).toEqual({
            productos: [],
            totalPiezas: 0,
            totalPedidos: 0,
            totalMonto: 0
        });
    });
});

describe('agregarPorProducto — números de pedido por producto', () => {
    test('lista el folio de cada pedido bajo su producto', () => {
        const r = agregarPorProducto([
            { consecutiveOrderNumber: 101, estatus: 'Pagado', precio: 850, items: [{ producto: 'Corazón', cantidad: 1, precio: 850 }] },
            { consecutiveOrderNumber: 102, estatus: 'Fabricar', precio: 200, items: [{ producto: 'Rex', cantidad: 1, precio: 200 }] }
        ]);

        expect(porNombre(r, 'Corazón').listaPedidos).toEqual([{ numero: 101, estatus: 'Pagado', piezas: 1 }]);
        expect(porNombre(r, 'Rex').listaPedidos).toEqual([{ numero: 102, estatus: 'Fabricar', piezas: 1 }]);
    });

    test('un pedido con varios productos aparece en la lista de cada uno', () => {
        const r = agregarPorProducto([
            {
                consecutiveOrderNumber: 200, estatus: 'Pagado', precio: 1050,
                items: [
                    { producto: 'Corazón', cantidad: 1, precio: 850 },
                    { producto: 'Rex', cantidad: 1, precio: 200 }
                ]
            }
        ]);

        expect(porNombre(r, 'Corazón').listaPedidos).toEqual([{ numero: 200, estatus: 'Pagado', piezas: 1 }]);
        expect(porNombre(r, 'Rex').listaPedidos).toEqual([{ numero: 200, estatus: 'Pagado', piezas: 1 }]);
    });

    test('dos líneas del mismo producto en un pedido son una sola fila con las piezas sumadas', () => {
        const r = agregarPorProducto([
            {
                consecutiveOrderNumber: 300, estatus: 'Pagado', precio: 1700,
                items: [
                    { producto: 'Corazón', cantidad: 1, precio: 850 },
                    { producto: 'Corazón', cantidad: 1, precio: 850 }
                ]
            }
        ]);

        expect(porNombre(r, 'Corazón').listaPedidos).toEqual([{ numero: 300, estatus: 'Pagado', piezas: 2 }]);
    });

    test('ordena los folios de más nuevo a más viejo (consecutivo descendente)', () => {
        const r = agregarPorProducto([
            { consecutiveOrderNumber: 10, estatus: 'Pagado', precio: 850, items: [{ producto: 'Corazón', cantidad: 1, precio: 850 }] },
            { consecutiveOrderNumber: 30, estatus: 'Pagado', precio: 850, items: [{ producto: 'Corazón', cantidad: 1, precio: 850 }] },
            { consecutiveOrderNumber: 20, estatus: 'Pagado', precio: 850, items: [{ producto: 'Corazón', cantidad: 1, precio: 850 }] }
        ]);

        expect(porNombre(r, 'Corazón').listaPedidos.map(p => p.numero)).toEqual([30, 20, 10]);
    });

    test('pedidos legacy sin folio caen al final con numero null', () => {
        const r = agregarPorProducto([
            { estatus: 'Pagado', producto: 'Corazón', precio: 850 },
            { consecutiveOrderNumber: 50, estatus: 'Pagado', precio: 850, items: [{ producto: 'Corazón', cantidad: 1, precio: 850 }] }
        ]);

        expect(porNombre(r, 'Corazón').listaPedidos.map(p => p.numero)).toEqual([50, null]);
    });
});

describe('folioDelPedido', () => {
    test('devuelve el número cuando existe', () => {
        expect(folioDelPedido({ consecutiveOrderNumber: 123 })).toBe(123);
        expect(folioDelPedido({ consecutiveOrderNumber: '123' })).toBe(123);
    });

    test('devuelve null cuando falta o no es numérico', () => {
        expect(folioDelPedido({})).toBeNull();
        expect(folioDelPedido({ consecutiveOrderNumber: null })).toBeNull();
        expect(folioDelPedido({ consecutiveOrderNumber: 'abc' })).toBeNull();
        expect(folioDelPedido(null)).toBeNull();
    });
});
