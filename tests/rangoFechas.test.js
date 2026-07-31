/**
 * Pruebas de la traducción del filtro de fecha a rangos (server/orders/rangoFechas.js).
 *
 * Lo importante que cuidan: que la ventana que se le pide a Meta sea LA MISMA
 * que la de los pedidos. Si no, el costo por pedido divide el gasto de unos días
 * entre los pedidos de otros y nadie se entera.
 */
const { ordersDateRange, metaDateRange } = require('../server/orders/rangoFechas');

// Miércoles 15 de julio de 2026, 3 p.m. hora de México (21:00 UTC).
const AHORA = new Date('2026-07-15T21:00:00Z');

describe('metaDateRange — la ventana que se le pide a Meta', () => {
    test('hoy: un solo día', () => {
        expect(metaDateRange({ dateFilter: 'hoy' }, AHORA)).toEqual({
            dateFrom: '2026-07-15',
            dateTo: '2026-07-15'
        });
    });

    test('ayer: NO se cuela el gasto de hoy', () => {
        // El rango de pedidos termina en las 00:00 de HOY (exclusivo). Como el
        // `until` de Meta es inclusivo, sin restar 1 ms diría 2026-07-15 y
        // cobraría el gasto de hoy contra los pedidos de ayer.
        expect(metaDateRange({ dateFilter: 'ayer' }, AHORA)).toEqual({
            dateFrom: '2026-07-14',
            dateTo: '2026-07-14'
        });
    });

    test('últimos 10 días: incluye hoy y arranca 10 días atrás', () => {
        expect(metaDateRange({ dateFilter: 'ultimos-10-dias' }, AHORA)).toEqual({
            dateFrom: '2026-07-05',
            dateTo: '2026-07-15'
        });
    });

    test('este mes: del día 1 a hoy', () => {
        expect(metaDateRange({ dateFilter: 'este-mes' }, AHORA)).toEqual({
            dateFrom: '2026-07-01',
            dateTo: '2026-07-15'
        });
    });

    test('sin filtro no hay rango: mejor sin costo que con uno inventado', () => {
        expect(metaDateRange({}, AHORA)).toBeNull();
        expect(metaDateRange({ dateFilter: 'inventado' }, AHORA)).toBeNull();
    });

    test('personalizado usa las marcas de tiempo que manda el front', () => {
        const inicio = new Date('2026-06-01T06:00:00Z').getTime(); // 1-jun 00:00 MX
        const fin = new Date('2026-06-04T05:59:59.999Z').getTime(); // 3-jun 23:59 MX
        expect(metaDateRange({ dateFilter: 'personalizado', customStart: inicio, customEnd: fin }, AHORA)).toEqual({
            dateFrom: '2026-06-01',
            dateTo: '2026-06-03'
        });
    });
});

describe('ordersDateRange — la ventana de los pedidos', () => {
    test('el fin es EXCLUSIVO: ayer termina justo al empezar hoy', () => {
        const r = ordersDateRange({ dateFilter: 'ayer' }, AHORA);
        expect(r.startDate.toISOString()).toBe('2026-07-14T06:00:00.000Z');
        expect(r.endDate.toISOString()).toBe('2026-07-15T06:00:00.000Z');
    });

    test('hoy arranca a las 00:00 de México, no a las 00:00 UTC', () => {
        const r = ordersDateRange({ dateFilter: 'hoy' }, AHORA);
        expect(r.startDate.toISOString()).toBe('2026-07-15T06:00:00.000Z');
    });

    test('personalizado deja el tope inclusivo del front como exclusivo', () => {
        const fin = 1780000000000;
        const r = ordersDateRange({ dateFilter: 'personalizado', customStart: 1779000000000, customEnd: fin }, AHORA);
        expect(r.endDate.getTime()).toBe(fin + 1);
    });

    test('las dos ventanas cubren el mismo día en todos los filtros', () => {
        for (const dateFilter of ['hoy', 'ayer', 'este-mes', 'ultimos-10-dias']) {
            const pedidos = ordersDateRange({ dateFilter }, AHORA);
            const meta = metaDateRange({ dateFilter }, AHORA);
            const iso = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
            expect(iso(pedidos.startDate)).toBe(meta.dateFrom);
            expect(iso(new Date(pedidos.endDate.getTime() - 1))).toBe(meta.dateTo);
        }
    });
});
