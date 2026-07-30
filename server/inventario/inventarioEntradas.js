/**
 * Entradas de inventario: registro de compras, conteo físico y kardex.
 *
 * ⚠️ PLACEHOLDER. La implementación real se quedó FUERA del commit que agregó
 * los endpoints /api/inventario/entrada|conteo|movimientos (81410eaa): el
 * `require('./inventario/inventarioEntradas')` de server/apiRoutes.js apuntaba a
 * un archivo que nunca se subió al repo, y eso tumbaba el arranque del servidor
 * en cada deploy (MODULE_NOT_FOUND). Este stub existe para que el servidor
 * ARRANQUE; los tres endpoints responden 501 (no implementado) hasta que se
 * reemplace por la lógica real.
 *
 * Contrato esperado (deducido de server/apiRoutes.js y server/inventario/*):
 *   - registrarEntrada({ materialId, unidades, paquetes, costoTotal, proveedor,
 *       factura, nota, usuario }): suma al `stockActual` del material (unidades +
 *       paquetes × `multiploCompra`) y escribe un movimiento { tipo:'entrada' } en
 *       la colección `movimientos_inventario`.
 *   - registrarConteoFisico({ materialId, stockReal, nota, usuario }): fija el
 *       `stockActual` al valor contado y escribe { tipo:'ajuste' }.
 *   - listarMovimientos({ tipo, materialId, limite }): lee el kardex de
 *       `movimientos_inventario` ordenado por `createdAt` desc.
 *
 * Modelo de datos: ver server/inventario/inventarioService.js (colecciones
 * `materiales` y `movimientos_inventario`).
 */

function noImplementado() {
    const err = new Error(
        'Entradas de inventario aún no implementadas (falta la lógica real de inventarioEntradas.js).'
    );
    err.statusCode = 501;
    throw err;
}

module.exports = {
    registrarEntrada: noImplementado,
    registrarConteoFisico: noImplementado,
    listarMovimientos: noImplementado,
};
