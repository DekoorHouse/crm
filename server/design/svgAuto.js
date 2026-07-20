'use strict';
// Elegibilidad para diseño AUTOMÁTICO de corte (el svg-corte-worker local). ÚNICA fuente de verdad,
// compartida entre:
//   - el worker (scripts/svg-corte-worker.js), que decide qué pedidos corta solo, y
//   - el endpoint GET /api/design-pending, que decide si un pedido va a la pestaña "SVG IA"
//     (lo hace la IA) en vez de a "Pendientes" (diseño manual).
// Si estas dos difieren, un pedido saldría como "manual" aunque el worker lo vaya a cortar (o al
// revés) — exactamente el problema que esta separación resuelve. Por eso vive en un solo lugar.

// "Algo especial" (foto/logo/grabado/frase/dibujo/…) -> diseño MANUAL, no lo toca la IA.
// Mismo criterio que el auto-mockup (mockupsService) y el que tenía el worker inline.
const SPECIAL_RE = /foto|imagen|graba|logo|escudo|especial|personaje|mascota|dibuj|dise[nñ]|frase|leyenda|adicional|s[ií]mbolo|\bpng\b|\bjpg\b/i;

const productOf = o => String(o.producto || (o.items && o.items[0] && o.items[0].producto) || '').toLowerCase();
const datosOf = o => (Array.isArray(o.items) ? o.items : []).map(it => it.datosProducto).filter(Boolean).join('\n') || o.datosProducto || o.producto || '';

// ¿Este pedido lo puede diseñar SOLO el worker (lámpara de corazones estándar, con mockup aprobado y
// layout verificado por visión)? `previews` = mockup_previews[orderId].previews (array; [] si no hay).
// Devuelve { eligible, reason, fields, layoutVerificado }. `reason` explica el NO (para logs/UI):
//   not_corazon | special | no_mockup | layout_mismatch | incomplete_fields | ok
// NO evalúa disenoListoAt / svgCorteAt / claim / shipped ni el estatus: eso lo decide cada caller
// (el worker salta los ya trabajados o en proceso; el endpoint separa "ya diseñado" de "en cola").
function svgAutoEligibility(o, previews) {
    if (!/corazon/i.test(productOf(o))) return { eligible: false, reason: 'not_corazon' };
    if (SPECIAL_RE.test(datosOf(o))) return { eligible: false, reason: 'special' };
    previews = Array.isArray(previews) ? previews : [];
    if (!previews.length) return { eligible: false, reason: 'no_mockup' };
    const last = previews[previews.length - 1];
    const f = last.fields || {};
    // Layout verificado por visión (mockupsService.verifyAndStoreLayout): los renglones EXACTOS que el
    // cliente vio en su mockup. Es la fuente de verdad del diseño; si no existe, se usan los fields.
    const lay = last.layout || null;
    // La visión detectó que lo grabado en el mockup NO coincide con los datos del pedido (nombre mal
    // escrito por la IA de imagen, faltante, etc.) -> requiere ojos humanos, no se corta automático.
    if (lay && lay.ok === false) return { eligible: false, reason: 'layout_mismatch' };
    const conLineas = (vision, plain) => (vision && vision.length ? vision.join('\n') : String(plain || ''));
    const nombre1 = lay ? conLineas(lay.izquierdo, f.nombre1) : String(f.nombre1 || '');
    const nombre2 = lay ? conLineas(lay.derecho, f.nombre2) : String(f.nombre2 || '');
    const fecha = lay ? conLineas(lay.fecha, f.fecha) : String(f.fecha || '');
    if (!nombre1 || !nombre2 || !fecha) return { eligible: false, reason: 'incomplete_fields' };
    return { eligible: true, reason: 'ok', fields: { nombre1, nombre2, fecha }, layoutVerificado: !!lay };
}

// ¿El pedido está EN COLA para el corte automático (Fabricar, aún sin cortar, auto-elegible)? Es el
// conjunto exacto que el endpoint saca de "Pendientes" manual y muestra en "SVG IA" como
// "esperando pareja". `previews` = mockup_previews[orderId].previews.
// Excluye lo que ya no es cola de IA: enviado, ya diseñado (manual o IA), o con un pendiente MANUAL
// aparte (2º producto agregado tras pagar -> lo revisa una persona).
function isAutoWaiting(o, previews) {
    if (String(o.estatus || '').trim().toLowerCase() !== 'fabricar') return false;
    if (o.disenoListoAt || o.svgCorteAt) return false;                       // ya diseñado / ya tiene SVG
    if ((o.guiaEnvio && o.guiaEnvio.guia) || o.ocultoDeEnvios) return false; // ya se envió/gestionó
    if (o.productoAgregadoPostPagoAt) return false;                          // 2º producto -> manual
    return svgAutoEligibility(o, previews).eligible;
}

module.exports = { svgAutoEligibility, isAutoWaiting, SPECIAL_RE, productOf, datosOf };
