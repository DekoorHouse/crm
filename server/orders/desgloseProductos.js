/**
 * Agregación de piezas por producto para /pedidos/desglose.
 *
 * Lógica pura (no toca Firestore) para poder probarla: recibe los `data()` de los
 * pedidos ya filtrados y devuelve el conteo por producto.
 */

/**
 * Devuelve las líneas de producto de un pedido en el formato canónico.
 * `items` es lo que escribe createOrderCore; los pedidos viejos solo traen
 * `producto`/`precio` sueltos y cuentan como una pieza.
 */
function lineasDelPedido(pedido) {
    if (Array.isArray(pedido.items) && pedido.items.length) return pedido.items;
    return [{ producto: pedido.producto, cantidad: 1, precio: Number(pedido.precio) || 0 }];
}

/**
 * @param {Array<object>} pedidos - documentos de `pedidos` (ya filtrados).
 * @returns {{productos: Array<{producto:string, piezas:number, pedidos:number, monto:number, porEstatus:object}>, totalPiezas:number, totalPedidos:number, totalMonto:number}}
 */
function agregarPorProducto(pedidos) {
    const acumulado = new Map();
    let totalPiezas = 0;
    let totalMonto = 0;

    for (const pedido of pedidos) {
        const estatus = pedido.estatus || 'Sin estatus';
        totalMonto += Number(pedido.precio) || 0;

        // Un pedido con 2 Corazones suma 2 piezas pero 1 solo pedido.
        const contadosEnEstePedido = new Set();

        for (const linea of lineasDelPedido(pedido)) {
            const nombre = (linea && linea.producto) ? String(linea.producto) : 'Sin producto';
            const cantidad = Math.max(1, parseInt(linea && linea.cantidad, 10) || 1);
            const acc = acumulado.get(nombre) || { producto: nombre, piezas: 0, pedidos: 0, monto: 0, porEstatus: {} };

            acc.piezas += cantidad;
            // `precio` de la línea es unitario: el total de la línea es precio × cantidad.
            acc.monto += (Number(linea && linea.precio) || 0) * cantidad;
            acc.porEstatus[estatus] = (acc.porEstatus[estatus] || 0) + cantidad;
            if (!contadosEnEstePedido.has(nombre)) {
                acc.pedidos += 1;
                contadosEnEstePedido.add(nombre);
            }

            acumulado.set(nombre, acc);
            totalPiezas += cantidad;
        }
    }

    return {
        productos: [...acumulado.values()].sort((a, b) => b.piezas - a.piezas),
        totalPiezas,
        totalPedidos: pedidos.length,
        totalMonto
    };
}

module.exports = { agregarPorProducto, lineasDelPedido };
