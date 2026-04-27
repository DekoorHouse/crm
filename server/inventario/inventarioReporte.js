/**
 * Genera el reporte diario de inventario:
 *  - Cuántos pedidos pasaron a Pagado/Fabricar en las últimas 24h
 *  - Materiales consumidos en ese periodo (a partir del kardex)
 *  - Materiales que están bajo el mínimo y deben pedirse
 *  - Cantidad sugerida (paquetesPorOrden fijo o cálculo dinámico)
 */
const { db } = require('../config');

const HORAS_VENTANA = 24;

/**
 * Calcula cantidad a pedir respetando buffer y múltiplo de compra.
 *
 *  - Si paquetesPorOrden > 0: pide exactamente esa cantidad fija de paquetes.
 *  - Si no: necesario × (1 + buffer%) redondeado al siguiente múltiplo.
 *
 * @returns {{ unidades: number, paquetes: number, multiplo: number, modo: 'fijo'|'dinamico' }}
 */
function calcularSugerencia(material, necesarioUnidades) {
    const multiplo = Math.max(1, parseInt(material.multiploCompra, 10) || 1);
    const buffer = Math.max(0, Number(material.bufferPct) || 0) / 100;
    const fijo = Math.max(0, parseInt(material.paquetesPorOrden, 10) || 0);

    if (fijo > 0) {
        const unidades = fijo * multiplo;
        return { unidades, paquetes: fijo, multiplo, modo: 'fijo' };
    }
    const conBuffer = Math.max(0, necesarioUnidades) * (1 + buffer);
    const unidades = Math.max(multiplo, Math.ceil(conBuffer / multiplo) * multiplo);
    return { unidades, paquetes: unidades / multiplo, multiplo, modo: 'dinamico' };
}

/**
 * Calcula el reporte de inventario para una ventana de tiempo.
 * @param {Date} [hasta=now]
 * @returns {Promise<{
 *   periodo: { desde: Date, hasta: Date },
 *   pedidos: { total: number, porProducto: object },
 *   consumo: Array<{materialId, materialNombre, materialUnidad, cantidad}>,
 *   aPedir: Array<{materialId, nombre, unidad, stockActual, stockMinimo, consumo24h, sugerencia, costoEstimado}>,
 *   stockOk: Array<{materialId, nombre, stockActual, stockMinimo}>,
 *   costoTotal: number
 * }>}
 */
async function calcularReporte(hasta = new Date()) {
    const desde = new Date(hasta.getTime() - HORAS_VENTANA * 60 * 60 * 1000);

    // 1) Pedidos que entraron a Pagado/Fabricar en la ventana
    //    Se identifican por inventarioDescontadoAt (timestamp del descuento).
    const pedidosSnap = await db.collection('pedidos')
        .where('inventarioDescontado', '==', true)
        .where('inventarioDescontadoAt', '>=', desde)
        .where('inventarioDescontadoAt', '<=', hasta)
        .get();

    let totalPedidos = 0;
    const porProducto = {};
    pedidosSnap.docs.forEach(d => {
        const data = d.data();
        totalPedidos++;
        const items = Array.isArray(data.items) && data.items.length > 0
            ? data.items
            : [{ producto: data.producto || '(sin producto)', cantidad: 1 }];
        items.forEach(it => {
            const p = it.producto || '(sin producto)';
            const qty = Math.max(1, parseInt(it.cantidad, 10) || 1);
            porProducto[p] = (porProducto[p] || 0) + qty;
        });
    });

    // 2) Movimientos de inventario en la ventana (kardex de salida)
    const movsSnap = await db.collection('movimientos_inventario')
        .where('tipo', '==', 'salida')
        .where('createdAt', '>=', desde)
        .where('createdAt', '<=', hasta)
        .get();

    const consumoPorMaterial = new Map(); // materialId -> { nombre, unidad, cantidad }
    movsSnap.docs.forEach(d => {
        const m = d.data();
        if (!m.materialId) return;
        const agg = consumoPorMaterial.get(m.materialId) || {
            materialId: m.materialId,
            materialNombre: m.materialNombre || '',
            materialUnidad: m.materialUnidad || '',
            cantidad: 0
        };
        agg.cantidad += Number(m.cantidad) || 0;
        consumoPorMaterial.set(m.materialId, agg);
    });

    // 3) Cargar TODOS los materiales (no muchos — caben en una query)
    const matSnap = await db.collection('materiales').get();
    const materiales = matSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 4) Para cada material: ¿está bajo el mínimo? ¿qué pedir?
    const aPedir = [];
    const stockOk = [];
    let costoTotal = 0;

    for (const m of materiales) {
        const stockActual = Number(m.stockActual) || 0;
        const stockMinimo = Number(m.stockMinimo) || 0;
        const consumo24h = consumoPorMaterial.get(m.id)?.cantidad || 0;

        if (stockMinimo > 0 && stockActual <= stockMinimo) {
            // El "necesario" base es: cubrir el lead time × consumo diario observado.
            // Si no hay consumo observado todavía, usar el stockMinimo como floor.
            const consumoDiarioEst = consumo24h || (stockMinimo / Math.max(1, Number(m.leadTimeDias) || 3));
            const necesarioParaLeadTime = consumoDiarioEst * (Number(m.leadTimeDias) || 3);
            const necesarioReposicion = Math.max(0, stockMinimo - stockActual);
            const necesarioBase = Math.max(necesarioParaLeadTime, necesarioReposicion);

            const sugerencia = calcularSugerencia(m, necesarioBase);
            const costoUnit = Number(m.costoUnit) || 0;
            const costoEstimado = sugerencia.unidades * costoUnit;
            costoTotal += costoEstimado;

            aPedir.push({
                materialId: m.id,
                nombre: m.nombre || '',
                unidad: m.unidad || 'pieza',
                proveedor: m.proveedor || '',
                stockActual,
                stockMinimo,
                consumo24h,
                sugerencia,
                costoUnit,
                costoEstimado
            });
        } else {
            stockOk.push({
                materialId: m.id,
                nombre: m.nombre || '',
                stockActual,
                stockMinimo
            });
        }
    }

    // Ordenar: primero stock 0 (crítico), luego más bajo respecto al mínimo
    aPedir.sort((a, b) => {
        if (a.stockActual === 0 && b.stockActual !== 0) return -1;
        if (b.stockActual === 0 && a.stockActual !== 0) return 1;
        const ratioA = a.stockMinimo > 0 ? a.stockActual / a.stockMinimo : 0;
        const ratioB = b.stockMinimo > 0 ? b.stockActual / b.stockMinimo : 0;
        return ratioA - ratioB;
    });

    return {
        periodo: { desde, hasta },
        pedidos: { total: totalPedidos, porProducto },
        consumo: [...consumoPorMaterial.values()],
        aPedir,
        stockOk,
        costoTotal
    };
}

module.exports = {
    calcularReporte,
    calcularSugerencia
};
