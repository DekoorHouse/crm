/**
 * Lógica de descuento de inventario por pedido.
 *
 * Cuando un pedido cambia a estatus "Pagado" o "Fabricar" por primera vez,
 * se descuenta el material según la receta (BOM) de cada item, y se registra
 * un movimiento en `movimientos_inventario` por cada material consumido.
 *
 * Diseño idempotente: el pedido se marca con `inventarioDescontado: true`
 * tras un descuento exitoso. Si la función vuelve a invocarse para el mismo
 * pedido, no descuenta de nuevo.
 */
const { db, admin } = require('../config');

/**
 * Descuenta inventario por un pedido confirmado.
 * @param {string} orderId
 * @param {object} orderData (datos ya leídos del pedido, debe incluir items[])
 * @param {string} motivo (ej. "Pagado", "Fabricar")
 * @returns {Promise<{ ok: boolean, descontado?: boolean, faltantes?: string[], movimientos?: number, motivo?: string }>}
 */
async function descontarInventarioPorPedido(orderId, orderData, motivo) {
    if (!orderId || !orderData) {
        return { ok: false, motivo: 'orderId/orderData faltantes' };
    }

    // Idempotencia: si ya se descontó, no hacer nada
    if (orderData.inventarioDescontado === true) {
        return { ok: true, descontado: false, motivo: 'ya descontado previamente' };
    }

    // Construir lista de items con cantidades
    const items = Array.isArray(orderData.items) && orderData.items.length > 0
        ? orderData.items
        : (orderData.producto ? [{ producto: orderData.producto, cantidad: 1 }] : []);

    if (items.length === 0) {
        return { ok: false, motivo: 'pedido sin productos' };
    }

    // 1) Cargar BOM de cada producto único (en paralelo)
    const productosUnicos = [...new Set(items.map(it => it.producto).filter(Boolean))];
    const bomDocs = await Promise.all(
        productosUnicos.map(p => db.collection('productos_bom').doc(p).get())
    );
    const bomByProducto = new Map();
    bomDocs.forEach((d, i) => {
        if (d.exists) bomByProducto.set(productosUnicos[i], d.data());
    });

    // 2) Calcular consumo total por material (multi-producto, multi-cantidad)
    const consumoPorMaterial = new Map(); // materialId -> total cantidad
    const productosSinBom = [];

    for (const item of items) {
        const bom = bomByProducto.get(item.producto);
        if (!bom || !Array.isArray(bom.componentes) || bom.componentes.length === 0) {
            productosSinBom.push(item.producto);
            continue;
        }
        const qtyPedido = Math.max(1, parseInt(item.cantidad, 10) || 1);
        for (const comp of bom.componentes) {
            if (!comp.materialId) continue;
            const totalConsumo = (Number(comp.cantidad) || 0) * qtyPedido;
            if (totalConsumo <= 0) continue;
            consumoPorMaterial.set(
                comp.materialId,
                (consumoPorMaterial.get(comp.materialId) || 0) + totalConsumo
            );
        }
    }

    if (consumoPorMaterial.size === 0) {
        // Marcar como "intentado" para no reintentar pero NO escribir movimientos
        await db.collection('pedidos').doc(orderId).update({
            inventarioDescontado: true,
            inventarioDescontadoAt: admin.firestore.FieldValue.serverTimestamp(),
            inventarioDescontadoMotivo: motivo || '',
            inventarioDescontadoNota: productosSinBom.length > 0
                ? `Sin BOM definido para: ${productosSinBom.join(', ')}`
                : 'Sin componentes a descontar'
        });
        return {
            ok: true,
            descontado: false,
            motivo: productosSinBom.length > 0
                ? `Productos sin receta: ${productosSinBom.join(', ')}`
                : 'sin componentes'
        };
    }

    // 3) Cargar materiales (en paralelo) — necesarios para nombre/unidad en el movimiento
    const materialIds = [...consumoPorMaterial.keys()];
    const materialDocs = await Promise.all(
        materialIds.map(id => db.collection('materiales').doc(id).get())
    );
    const materialesById = new Map();
    materialDocs.forEach(d => {
        if (d.exists) materialesById.set(d.id, { id: d.id, ...d.data() });
    });

    // 4) Transacción: leer stock actual de cada material, descontar, registrar movimientos
    const fecha = admin.firestore.FieldValue.serverTimestamp();
    const consecutiveOrderNumber = orderData.consecutiveOrderNumber || null;
    let movimientosEscritos = 0;

    await db.runTransaction(async (tx) => {
        // Releer materiales dentro de la transacción para evitar race conditions
        const refs = materialIds.map(id => db.collection('materiales').doc(id));
        const snaps = await Promise.all(refs.map(r => tx.get(r)));

        for (let i = 0; i < materialIds.length; i++) {
            const matId = materialIds[i];
            const snap = snaps[i];
            if (!snap.exists) continue;
            const matData = snap.data();
            const consumo = consumoPorMaterial.get(matId);
            const stockNuevo = (Number(matData.stockActual) || 0) - consumo;

            // Decrementar stock
            tx.update(refs[i], {
                stockActual: stockNuevo,
                updatedAt: fecha
            });

            // Registrar movimiento (kardex)
            const movRef = db.collection('movimientos_inventario').doc();
            tx.set(movRef, {
                tipo: 'salida',
                fuente: 'pedido',
                motivo: motivo || 'Pedido confirmado',
                materialId: matId,
                materialNombre: matData.nombre || (materialesById.get(matId)?.nombre || ''),
                materialUnidad: matData.unidad || (materialesById.get(matId)?.unidad || ''),
                cantidad: consumo,
                stockAntes: Number(matData.stockActual) || 0,
                stockDespues: stockNuevo,
                pedidoId: orderId,
                consecutiveOrderNumber,
                createdAt: fecha
            });
            movimientosEscritos++;
        }

        // Marcar pedido como descontado (idempotencia)
        const orderRef = db.collection('pedidos').doc(orderId);
        tx.update(orderRef, {
            inventarioDescontado: true,
            inventarioDescontadoAt: fecha,
            inventarioDescontadoMotivo: motivo || ''
        });
    });

    return {
        ok: true,
        descontado: true,
        movimientos: movimientosEscritos,
        sinBom: productosSinBom
    };
}

module.exports = {
    descontarInventarioPorPedido
};
