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

// "Sin fecha" (el cliente no quiere fecha) -> se graba en blanco (misma regla que el mockup).
const SIN_FECHA_RE = /sin\s*fecha|no\s*(lleva|quiere|va|hay)\s*fecha|ninguna\s*fecha/i;

// Saca nombre1/nombre2/fecha del TEXTO de datos del pedido ("Nombres: A y B | Fecha: Z" y variantes),
// para poder diseñar un pedido forzado que aún NO tiene mockup aprobado (fallback del mockup).
function parseDatosFields(datos) {
    const s = String(datos || '').replace(/\r/g, '');
    let fecha = '';
    const fm = s.match(/fecha\s*:\s*([^\n|]+)/i);
    if (fm) fecha = fm[1].split('·')[0].trim();
    if (!fecha) {
        // Sin la etiqueta "Fecha:": busca un token con forma de fecha (29-Abril-2026, 24/06/1984…).
        const dm = s.match(/\d{1,2}\s*[-/]\s*[A-Za-zÁÉÍÓÚáéíóúÑñ]+\s*[-/]\s*\d{2,4}/) || s.match(/\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{2,4}/);
        if (dm) fecha = dm[0].replace(/\s+/g, '');
    }
    let namePart;
    const nm = s.match(/nombres?\s*:\s*([^\n|]+)/i);
    namePart = nm ? nm[1] : (s.split(/\n|\|/)[0] || '');
    namePart = namePart.split('·')[0].replace(/\bfecha\b.*$/i, '').trim();
    let nombre1 = '', nombre2 = '';
    const yy = namePart.split(/\s+y\s+|\s*&\s*|\s*\+\s*/i);
    if (yy.length >= 2) { nombre1 = yy[0].trim(); nombre2 = yy.slice(1).join(' y ').trim(); }
    return { nombre1, nombre2, fecha };
}

// Elegibilidad para diseño FORZADO desde el CRM (botón "Diseñar con IA"). Más laxa que la automática:
// NO exige que el pedido esté en 'Fabricar', ni mockup aprobado, ni layout verificado por visión —
// porque el usuario CONFIRMA el resultado antes de subir. Solo exige lo que el skill sabe generar:
// lámpara de corazones, no-especial, con dos nombres (fecha puede ir en blanco si el cliente no la
// quiere). Fuente de los datos: el mockup aprobado (si hay, da también la imagen de preview) o el
// texto de datos del pedido. Devuelve { ok, reason, fields, previewUrl }.
function forcedDesignFields(o, previews) {
    if (!/corazon/i.test(productOf(o))) return { ok: false, reason: 'not_corazon' };
    if (SPECIAL_RE.test(datosOf(o))) return { ok: false, reason: 'special' };
    previews = Array.isArray(previews) ? previews : [];
    const last = previews.length ? previews[previews.length - 1] : null;
    let nombre1 = '', nombre2 = '', fecha = '', previewUrl = null;
    if (last) {
        previewUrl = last.imageUrl || last.url || null;
        const f = last.fields || {};
        const lay = last.layout || null;
        const conLineas = (vision, plain) => (vision && vision.length ? vision.join('\n') : String(plain || ''));
        nombre1 = lay ? conLineas(lay.izquierdo, f.nombre1) : String(f.nombre1 || '');
        nombre2 = lay ? conLineas(lay.derecho, f.nombre2) : String(f.nombre2 || '');
        fecha = lay ? conLineas(lay.fecha, f.fecha) : String(f.fecha || '');
    }
    if (!nombre1 || !nombre2 || !fecha) {
        const p = parseDatosFields(datosOf(o));
        nombre1 = nombre1 || p.nombre1;
        nombre2 = nombre2 || p.nombre2;
        fecha = fecha || p.fecha;
    }
    if (!nombre1 || !nombre2) return { ok: false, reason: 'incomplete_fields' };
    if (SIN_FECHA_RE.test(fecha)) fecha = '';                                   // "Sin Fecha" -> blanco
    if (!fecha && !SIN_FECHA_RE.test(datosOf(o))) return { ok: false, reason: 'incomplete_fields' };
    return { ok: true, reason: 'ok', fields: { nombre1, nombre2, fecha }, previewUrl };
}

module.exports = { svgAutoEligibility, isAutoWaiting, forcedDesignFields, parseDatosFields, SPECIAL_RE, SIN_FECHA_RE, productOf, datosOf };
