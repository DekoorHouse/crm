/**
 * Agregación de pedidos por CAMPAÑA de Meta Ads para /pedidos/desglose.
 *
 * Lógica pura (no toca Firestore ni la Graph API) para poder probarla: recibe
 * los `data()` de los pedidos ya filtrados y el mapa adId -> campaña ya resuelto,
 * y devuelve el conteo por campaña.
 *
 * A diferencia del desglose por producto, aquí cada pedido cae en UNA sola
 * campaña: la suma de `pedidos` y `monto` de las tarjetas cuadra exacto con el
 * total del filtro (en productos no, porque un pedido con dos productos aparece
 * en las dos tarjetas).
 */

const { lineasDelPedido, folioDelPedido, contactoDelPedido } = require('./desgloseProductos');

// Cubetas que no son una campaña real de Meta.
const ORGANICO = '__organico__';
const SIN_CAMPANA = '__sin_campana__';

/**
 * Decide en qué cubeta cae un pedido.
 * - Sin anuncio atribuido -> orgánico (llegó por su cuenta o por otro canal).
 * - Con anuncio pero sin campaña resuelta (anuncio borrado, sin acceso, o Meta
 *   no contestó) -> una sola cubeta, con los IDs de anuncio en el detalle, para
 *   no llenar la cuadrícula de tarjetas "Anuncio 5253...".
 */
function cubetaDelPedido(pedido, adToCampaign) {
    const adId = pedido && pedido.attributedAdId ? String(pedido.attributedAdId) : null;
    if (!adId) return { id: ORGANICO, nombre: 'Orgánico / Directo', adId: null };

    const campana = adToCampaign[adId];
    if (campana && campana.campaignId) {
        return {
            id: String(campana.campaignId),
            nombre: campana.campaignName || `Campaña ${campana.campaignId}`,
            adId
        };
    }
    return { id: SIN_CAMPANA, nombre: 'Campaña no identificada', adId };
}

/**
 * @param {Array<object>} pedidos - documentos de `pedidos` (ya filtrados).
 * @param {Object<string,{campaignId:string, campaignName:string}>} adToCampaign - mapa adId -> campaña.
 * @returns {{campanas: Array<{id:string, nombre:string, piezas:number, pedidos:number, monto:number, porEstatus:object, porProducto:Array<{producto:string, piezas:number}>, listaPedidos:Array<{numero:number|null, estatus:string, piezas:number, contactId:string|null}>, ads:string[]}>, totalPiezas:number, totalPedidos:number, totalMonto:number}}
 */
function agregarPorCampana(pedidos, adToCampaign = {}) {
    const acumulado = new Map();
    let totalPiezas = 0;
    let totalMonto = 0;

    for (const pedido of pedidos) {
        const estatus = pedido.estatus || 'Sin estatus';
        const monto = Number(pedido.precio) || 0;
        const { id, nombre, adId } = cubetaDelPedido(pedido, adToCampaign);

        const acc = acumulado.get(id) || {
            id,
            nombre,
            piezas: 0,
            pedidos: 0,
            monto: 0,
            porEstatus: {},
            listaPedidos: [],
            _porProducto: new Map(),
            _ads: new Set()
        };

        // Las piezas del pedido se cuentan una vez y se reparten a la campaña
        // completa: dentro de la tarjeta el detalle por producto dice qué eran.
        let piezasPedido = 0;
        for (const linea of lineasDelPedido(pedido)) {
            const producto = (linea && linea.producto) ? String(linea.producto) : 'Sin producto';
            const cantidad = Math.max(1, parseInt(linea && linea.cantidad, 10) || 1);
            piezasPedido += cantidad;
            acc._porProducto.set(producto, (acc._porProducto.get(producto) || 0) + cantidad);
        }

        acc.piezas += piezasPedido;
        acc.pedidos += 1;
        acc.monto += monto;
        acc.porEstatus[estatus] = (acc.porEstatus[estatus] || 0) + piezasPedido;
        acc.listaPedidos.push({
            numero: folioDelPedido(pedido),
            estatus,
            piezas: piezasPedido,
            contactId: contactoDelPedido(pedido)
        });
        if (adId) acc._ads.add(adId);

        acumulado.set(id, acc);
        totalPiezas += piezasPedido;
        totalMonto += monto;
    }

    const campanas = [...acumulado.values()]
        .map(({ _porProducto, _ads, ...acc }) => ({
            ...acc,
            porProducto: [..._porProducto.entries()]
                .map(([producto, piezas]) => ({ producto, piezas }))
                .sort((a, b) => b.piezas - a.piezas),
            // Folios de más nuevo a más viejo (el consecutivo crece con el tiempo);
            // los legacy sin folio (null) caen al final.
            listaPedidos: acc.listaPedidos.sort((a, b) => (b.numero || 0) - (a.numero || 0)),
            ads: [..._ads]
        }))
        .sort((a, b) => b.piezas - a.piezas);

    return {
        campanas,
        totalPiezas,
        totalPedidos: pedidos.length,
        totalMonto
    };
}

module.exports = { agregarPorCampana, cubetaDelPedido, ORGANICO, SIN_CAMPANA };
