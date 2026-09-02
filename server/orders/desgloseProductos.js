/**
 * Agregación de piezas por producto para /desglose.
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
 * El folio que ve el cliente (DH1234). Los pedidos legacy pueden no tenerlo:
 * en ese caso va `null` y el front lo pinta como "DH--", igual que la tabla.
 */
function folioDelPedido(pedido) {
    const raw = pedido && pedido.consecutiveOrderNumber;
    const n = Number(raw);
    return raw != null && Number.isFinite(n) ? n : null;
}

/**
 * Con quién es la conversación del pedido, para poder abrir el chat desde el
 * folio. `contactId` es lo canónico; los pedidos viejos solo traen `telefono`,
 * que es el mismo id del documento en contacts_whatsapp.
 */
function contactoDelPedido(pedido) {
    const id = pedido && (pedido.contactId || pedido.telefono);
    return id ? String(id) : null;
}

/**
 * @param {Array<object>} pedidos - documentos de `pedidos` (ya filtrados).
 * @returns {{productos: Array<{producto:string, piezas:number, pedidos:number, monto:number, porEstatus:object, listaPedidos:Array<{numero:number|null, estatus:string, piezas:number, contactId:string|null}>}>, totalPiezas:number, totalPedidos:number, totalMonto:number}}
 */
function agregarPorProducto(pedidos) {
    const acumulado = new Map();
    let totalPiezas = 0;
    let totalMonto = 0;

    for (const pedido of pedidos) {
        const estatus = pedido.estatus || 'Sin estatus';
        totalMonto += Number(pedido.precio) || 0;

        for (const linea of lineasDelPedido(pedido)) {
            const nombre = (linea && linea.producto) ? String(linea.producto) : 'Sin producto';
            const cantidad = Math.max(1, parseInt(linea && linea.cantidad, 10) || 1);
            const acc = acumulado.get(nombre) || { producto: nombre, piezas: 0, pedidos: 0, monto: 0, porEstatus: {}, _porPedido: new Map() };

            acc.piezas += cantidad;
            // `precio` de la línea es unitario: el total de la línea es precio × cantidad.
            acc.monto += (Number(linea && linea.precio) || 0) * cantidad;
            acc.porEstatus[estatus] = (acc.porEstatus[estatus] || 0) + cantidad;

            // Un pedido con 2 Corazones suma 2 piezas pero es 1 solo pedido y una
            // sola fila en la lista de folios. La llave es el propio objeto pedido:
            // así dedupe líneas repetidas y no confunde dos pedidos viejos que
            // compartan folio nulo.
            let fila = acc._porPedido.get(pedido);
            if (!fila) {
                fila = { numero: folioDelPedido(pedido), estatus, piezas: 0, contactId: contactoDelPedido(pedido) };
                acc._porPedido.set(pedido, fila);
                acc.pedidos += 1;
            }
            fila.piezas += cantidad;

            acumulado.set(nombre, acc);
            totalPiezas += cantidad;
        }
    }

    const productos = [...acumulado.values()]
        .map(({ _porPedido, ...acc }) => ({
            ...acc,
            // Folios de más nuevo a más viejo (el consecutivo crece con el tiempo);
            // los legacy sin folio (null) caen al final.
            listaPedidos: [..._porPedido.values()].sort((a, b) => (b.numero || 0) - (a.numero || 0))
        }))
        // Por PEDIDOS, que es el número grande de la tarjeta: si se ordenara por
        // piezas se vería una tarjeta de 16 pedidos arriba de una de 20 y parece
        // un error. A igualdad de pedidos desempatan las piezas.
        .sort((a, b) => (b.pedidos - a.pedidos) || (b.piezas - a.piezas));

    return {
        productos,
        totalPiezas,
        totalPedidos: pedidos.length,
        totalMonto
    };
}

module.exports = { agregarPorProducto, lineasDelPedido, folioDelPedido, contactoDelPedido };
