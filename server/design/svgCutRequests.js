'use strict';
const { currentCut, ms } = require('./svgCutQueue');
const { invalidaMarcasAnteriores } = require('./svgAuto');

function requestBlocked(o) {
    return !!(o.svgServerJob || o.svgCorteReviewRequired || o.svgCorteSubidaDudosa
        || (o.iaForce && !['staged', 'error'].includes(o.iaForce.status)));
}

// Approval of an old preview must retain exactly its saved text, not today's possibly
// different order data. It becomes a server request; the retired PC never sees 'approved'.
function approvedPreviewFields(o) {
    const f = o.svgServerRequest || o.iaForce || {};
    const fail = message => { throw Object.assign(new Error(message), { statusCode: 409 }); };
    if (f.status !== 'staged') fail('El diseño aún no está listo para subir.');
    if (requestBlocked(o) || currentCut(o) || o.ocultoDeEnvios || /cancel/i.test(o.estatus || ''))
        fail('El pedido ya tiene corte, está en curso o requiere revisión.');
    if (invalidaMarcasAnteriores(o) > ms(f.requestedAt)) fail('El pedido cambió desde este previo; corrige o regenera el diseño antes de confirmarlo.');
    const lines = f.overrideLines || f.lines;
    if (!lines || typeof lines.nombre1 !== 'string' || typeof lines.nombre2 !== 'string'
        || !lines.nombre1.trim() || !lines.nombre2.trim() || (lines.fecha != null && typeof lines.fecha !== 'string'))
        fail('Este previo antiguo no conserva los textos. Usa Corregir para verificarlos y generarlo en el servidor.');
    return { nombre1: lines.nombre1, nombre2: lines.nombre2, fecha: lines.fecha || '' };
}
module.exports = { requestBlocked, approvedPreviewFields };
