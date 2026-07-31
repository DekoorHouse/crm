/**
 * Traducción del filtro de fecha del front a rangos concretos, en hora de México.
 *
 * Vive aparte de apiRoutes para poder probarlo: el desglose por campaña divide
 * el gasto de Meta entre los pedidos del MISMO rango, y si las dos ventanas no
 * coinciden el costo por pedido sale mal sin que nada truene.
 */

/**
 * @param {{dateFilter?:string, customStart?:number|string, customEnd?:number|string}} filtros
 * @param {Date} [ahora] - inyectable para las pruebas.
 * @returns {{startDate: Date, endDate: Date}|null} `endDate` es EXCLUSIVO. null si no hay filtro.
 */
function ordersDateRange({ dateFilter, customStart, customEnd }, ahora = new Date()) {
    if (dateFilter === 'personalizado' && customStart && customEnd) {
        return {
            startDate: new Date(Number(customStart)),
            // El filtro personalizado viene con tope INCLUSIVO; se le suma 1 ms
            // para dejarlo exclusivo como los demás y no perder ese milisegundo.
            endDate: new Date(Number(customEnd) + 1)
        };
    }
    if (!dateFilter) return null;

    const mexicoDate = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

    if (dateFilter === 'hoy') {
        return {
            startDate: new Date(mexicoDate + 'T00:00:00-06:00'),
            endDate: new Date(mexicoDate + 'T23:59:59.999-06:00')
        };
    }
    if (dateFilter === 'ayer') {
        const ayer = new Date(mexicoDate + 'T00:00:00-06:00');
        ayer.setDate(ayer.getDate() - 1);
        return { startDate: ayer, endDate: new Date(mexicoDate + 'T00:00:00-06:00') };
    }
    if (dateFilter === 'este-mes') {
        return {
            startDate: new Date(mexicoDate.substring(0, 7) + '-01T00:00:00-06:00'),
            endDate: new Date(mexicoDate + 'T23:59:59.999-06:00')
        };
    }
    if (dateFilter === 'ultimos-10-dias') {
        const hace10 = new Date(mexicoDate + 'T00:00:00-06:00');
        hace10.setDate(hace10.getDate() - 10);
        return { startDate: hace10, endDate: new Date(mexicoDate + 'T23:59:59.999-06:00') };
    }
    return null;
}

/**
 * El mismo rango en el formato de la Graph API (YYYY-MM-DD, hora de México).
 *
 * `until` es INCLUSIVO en Meta, por eso se le resta 1 ms al fin exclusivo: con
 * "ayer" el fin cae en las 00:00 de HOY, y sin el ajuste Meta cobraría también
 * el gasto de hoy contra los pedidos de ayer.
 *
 * @returns {{dateFrom:string, dateTo:string}|null}
 */
function metaDateRange(filtros, ahora = new Date()) {
    const rango = ordersDateRange(filtros, ahora);
    if (!rango) return null;
    const iso = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    return {
        dateFrom: iso(rango.startDate),
        dateTo: iso(new Date(rango.endDate.getTime() - 1))
    };
}

module.exports = { ordersDateRange, metaDateRange };
