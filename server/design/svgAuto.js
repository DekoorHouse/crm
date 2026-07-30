'use strict';
// Elegibilidad para diseño AUTOMÁTICO de corte (el svg-corte-worker local). ÚNICA fuente de verdad,
// compartida entre:
//   - el worker (scripts/svg-corte-worker.js), que decide qué pedidos corta solo, y
//   - el endpoint GET /api/design-pending, que decide si un pedido va a la pestaña "SVG IA"
//     (lo hace la IA) en vez de a "Pendientes" (diseño manual).
// Si estas dos difieren, un pedido saldría como "manual" aunque el worker lo vaya a cortar (o al
// revés) — exactamente el problema que esta separación resuelve. Por eso vive en un solo lugar.

// "Algo especial" (foto/logo/grabado/frase/dibujo/…) -> diseño MANUAL, no lo toca la IA AUTOMÁTICA.
// Mismo criterio que el auto-mockup (mockupsService) y el que tenía el worker inline. Lo usa el corte
// AUTOMÁTICO (svgAutoEligibility), que es conservador: cualquier "Especial:" lo manda a revisión humana.
const SPECIAL_RE = /foto|imagen|graba|logo|escudo|especial|personaje|mascota|dibuj|dise[nñ]|frase|leyenda|adicional|s[ií]mbolo|\bpng\b|\bjpg\b/i;

// Subconjunto de "especial" que el botón "Diseñar con IA" NO puede resolver ni forzándolo: requiere
// grabar una IMAGEN (foto/logo/dibujo/escudo/símbolo…) que la lámpara infinito no lleva. Esos SIEMPRE
// van a diseño manual o al Modo 4 de grabado.
// NO incluye 'frase'/'leyenda' (Chris, 2026-07-27): al ver los mockups de DH13922/DH13603 se confirmó
// que una frase corta ("Te amo") la grabó el mockup EN EL LUGAR DE LA FECHA, y el infinito.vbs ya graba
// cualquier texto libre ahí (como "Forever"). Por eso una lámpara "con frase" con mockup aprobado SÍ es
// elegible para el botón: se corta usando el layout del mockup (la frase ya viene como su "fecha"). Si
// el mockup NO incorporó la frase (p.ej. la pidieron ADEMÁS de la fecha, DH13603), el corte saldrá sin
// ella y el usuario lo verá en el preview antes de subir -> rehace el mockup con la frase o lo hace a
// mano. Tampoco incluye 'especial'/'diseño' genéricos.
const MANUAL_SPECIAL_RE = /foto|imagen|graba|logo|escudo|personaje|mascota|dibuj|adicional|s[ií]mbolo|\bpng\b|\bjpg\b/i;

const productOf = o => String(o.producto || (o.items && o.items[0] && o.items[0].producto) || '').toLowerCase();
const datosOf = o => (Array.isArray(o.items) ? o.items : []).map(it => it.datosProducto).filter(Boolean).join('\n') || o.datosProducto || o.producto || '';

// Notas de LOGÍSTICA/pago que la gente escribe en el campo "Especial" del pedido pero que NO cambian
// el diseño de la lámpara ("Envío exprés DHL", "Recoger en oficinas", "Tarjeta: ..."). Sin esto, la
// sola ETIQUETA "Especial:" hacía match con SPECIAL_RE y CUALQUIER pedido con ese campo lleno quedaba
// fuera del corte automático aunque no tuviera nada especial en el diseño (caso DH13973, 2026-07-27).
// Se exige que la nota EMPIECE con una de estas palabras: si trae además algo de diseño (foto, frase,
// grabado...), SPECIAL_RE lo detecta igual y el pedido sigue siendo manual.
const ESPECIAL_LOGISTICA_RE = /^\W*(env[ií]os?|expr[eé]s|dhl|estafeta|paqueter|recoger|ocurre|sucursal|entrega|domicilio|urgente|factura|tarjeta)\b/i;

// ¿El pedido lleva algo ESPECIAL que obliga a diseño manual? Evalúa el VALOR del campo "Especial",
// no su etiqueta, y descarta las notas de logística.
function esEspecial(o) {
    const datos = String(datosOf(o) || '');
    const m = /especial\s*:\s*([^|\n]+)/i.exec(datos);
    if (m) {
        const valor = m[1].trim();
        // Nota de logística y sin ninguna palabra de diseño -> NO es especial
        if (ESPECIAL_LOGISTICA_RE.test(valor) && !SPECIAL_RE.test(valor)) {
            return SPECIAL_RE.test(datos.replace(/especial\s*:[^|\n]*/gi, ' '));
        }
    }
    return SPECIAL_RE.test(datos);
}

// Quita acentos para comparaciones robustas ("Corazón" -> "Corazon").
const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
// ¿Es una lámpara de corazones? TOLERA acentos y singular/plural: el regex simple /corazon/ NO matchea
// "corazón" (con ó) y por eso un producto llamado "Corazón" se colaba como 'not_corazon' (DH13047,
// 2026-07-27). Única fuente de verdad de "esto lo hace la skill de corazones".
const isCorazon = o => /corazon/i.test(sinAcentos(productOf(o)));

// Regla COMPARTIDA de capitalización de nombres (inicial mayúscula + espacio tras punto), la MISMA
// que usa el mockup. Los nombres que se graban SIEMPRE pasan por aquí, vengan de la visión o del
// texto del pedido, así el cliente lo escriba en minúscula o pegue "L.Angel" (Chris, 2026-07-24).
// applyNameLayout re-decide los renglones (1 o 2 líneas) cuando cortamos desde el texto del pedido.
const { titleCaseName, applyNameLayout } = require('../mockups/nameLayout');

// Milisegundos de un valor de fecha en cualquier forma (Timestamp de Firestore, {_seconds}, ISO, nº).
const tsMs = v => !v ? 0 : (v.toMillis ? v.toMillis() : (v._seconds ? v._seconds * 1000 : (typeof v === 'number' ? v : (Date.parse(v) || 0))));

// ¿El cliente CORRIGIÓ sus datos DESPUÉS de generar este mockup? Entonces el mockup quedó OBSOLETO
// (tiene la fecha/nombre viejos) y NO debe usarse como fuente de verdad para el corte: los datos
// corregidos viven en `datosProducto`. Caso DH13941 (Chris, 2026-07-27): el cliente cambió la fecha
// 25->26-Julio y pagó, pero el mockup —creado antes— seguía con el 25; el SVG se cortaría con el 25.
function mockupObsoletoPorCorreccion(o, mockup) {
    const corr = tsMs(o && o.datoCorregidoAt);
    return corr > 0 && corr > tsMs(mockup && mockup.createdAt);
}

// Fields (nombre1/nombre2/fecha) desde el TEXTO de datos ACTUAL del pedido, con los renglones
// recalculados por la regla de negocio (applyNameLayout). Se usa cuando no hay mockup usable o cuando
// quedó obsoleto por una corrección posterior. Los nombres salen ya title-cased de parseDatosFields.
function fieldsFromDatos(o) {
    const p = parseDatosFields(datosOf(o));
    const wl = applyNameLayout({ nombre1: p.nombre1, nombre2: p.nombre2 });
    return { nombre1: wl.nombre1 || '', nombre2: wl.nombre2 || '', fecha: p.fecha };
}

// ¿Este pedido lo puede diseñar SOLO el worker (lámpara de corazones estándar, con mockup aprobado y
// layout verificado por visión)? `previews` = mockup_previews[orderId].previews (array; [] si no hay).
// Devuelve { eligible, reason, fields, layoutVerificado }. `reason` explica el NO (para logs/UI):
//   not_corazon | special | no_mockup | layout_mismatch | incomplete_fields | ok
// NO evalúa disenoListoAt / svgCorteAt / claim / shipped ni el estatus: eso lo decide cada caller
// (el worker salta los ya trabajados o en proceso; el endpoint separa "ya diseñado" de "en cola").
function svgAutoEligibility(o, previews) {
    if (!isCorazon(o)) return { eligible: false, reason: 'not_corazon' };
    if (esEspecial(o)) return { eligible: false, reason: 'special' };
    previews = Array.isArray(previews) ? previews : [];
    if (!previews.length) return { eligible: false, reason: 'no_mockup' };
    const last = previews[previews.length - 1];
    // Corrección posterior al mockup -> el mockup tiene datos viejos: cortar con los datos ACTUALES del
    // pedido (DH13941: el cliente cambió la fecha tras aprobar el mockup y pagó).
    if (mockupObsoletoPorCorreccion(o, last)) {
        const ff = fieldsFromDatos(o);
        if (!ff.nombre1 || !ff.nombre2 || !ff.fecha) return { eligible: false, reason: 'incomplete_fields' };
        return { eligible: true, reason: 'ok', fields: ff, layoutVerificado: false };
    }
    const f = last.fields || {};
    // Layout verificado por visión (mockupsService.verifyAndStoreLayout): los renglones EXACTOS que el
    // cliente vio en su mockup. Es la fuente de verdad del diseño; si no existe, se usan los fields.
    const lay = last.layout || null;
    // La visión detectó que lo grabado en el mockup NO coincide con los datos del pedido (nombre mal
    // escrito por la IA de imagen, faltante, etc.) -> requiere ojos humanos, no se corta automático.
    if (lay && lay.ok === false) return { eligible: false, reason: 'layout_mismatch' };
    const conLineas = (vision, plain) => (vision && vision.length ? vision.join('\n') : String(plain || ''));
    const nombre1 = titleCaseName(lay ? conLineas(lay.izquierdo, f.nombre1) : String(f.nombre1 || ''));
    const nombre2 = titleCaseName(lay ? conLineas(lay.derecho, f.nombre2) : String(f.nombre2 || ''));
    const fecha = lay ? conLineas(lay.fecha, f.fecha) : String(f.fecha || '');   // la fecha NO se title-casea
    if (!nombre1 || !nombre2 || !fecha) return { eligible: false, reason: 'incomplete_fields' };
    return { eligible: true, reason: 'ok', fields: { nombre1, nombre2, fecha }, layoutVerificado: !!lay };
}

// --- Guía: "recién sacada" NO significa "ya fabricado" (Chris, 2026-07-29) -------------------------
// El candado original saltaba CUALQUIER pedido con guía, porque el 2026-07-16 el worker re-cortó 9
// pedidos ya enviados. Pero aquí las guías se sacan POR ADELANTADO, antes de fabricar, así que ese
// candado también tapaba pedidos que aún no existen físicamente (153 casos medidos el 2026-07-27).
// Discriminador validado con datos reales: la ANTIGÜEDAD de guiaEnvio.createdAt. Guía de ≤3 días =
// generada por adelantado (pedido pendiente); guía de 11-30 días = ya se envió, nunca re-cortar.
const GUIA_RECIENTE_DIAS = 3;

// Fecha FIJA desde la que el corte automático puede tomar pedidos 'Pagado'. NO es ventana móvil: así
// ningún pedido nuevo vuelve a desaparecer solo, y el histórico de 'Pagado' (~6700 pedidos viejos ya
// fabricados a mano) queda fuera para siempre. Compartida con designPending.js.
const AUTO_DESDE_MS = Date.parse('2026-07-17T00:00:00Z');

// ¿La guía es lo bastante vieja como para asumir que el pedido YA se envió? Sin fecha de guía se
// asume vieja (conservador: no se corta solo).
function guiaVieja(o) {
    if (!(o.guiaEnvio && o.guiaEnvio.guia)) return false;   // sin guía -> no bloquea
    const creada = tsMs(o.guiaEnvio.createdAt);
    if (!creada) return true;
    return (Date.now() - creada) > GUIA_RECIENTE_DIAS * 864e5;
}

// Candados comunes a cualquier cola de corte automático: ya diseñado (a mano o por IA), ya enviado/
// gestionado, o con un pendiente MANUAL aparte (2º producto agregado tras pagar -> lo revisa alguien).
function autoBlocked(o) {
    return !!(o.disenoListoAt || o.svgCorteAt                                // ya diseñado / ya tiene SVG
        || guiaVieja(o) || o.ocultoDeEnvios                                  // ya se envió/gestionó
        || o.productoAgregadoPostPagoAt);                                    // 2º producto -> manual
}

// Estatus que el corte automático acepta. 'Pagado' se sumó el 2026-07-29: al validar el pago el pedido
// pasa a 'Pagado' (NO a 'Fabricar'), así que exigir 'Fabricar' dejaba fuera pedidos listos para cortar.
// OJO: 'Pagado' es también el cementerio de miles de pedidos viejos ya fabricados -> se exige además
// que el pago sea POSTERIOR a AUTO_DESDE_MS (ver arriba).
const ESTATUS_AUTO = new Set(['fabricar', 'pagado']);

// ¿El pedido está EN COLA para el corte automático (aún sin cortar, auto-elegible)? Es el conjunto
// exacto que el endpoint saca de "Pendientes" manual y muestra en "SVG IA" como "esperando pareja".
// `previews` = mockup_previews[orderId].previews.
function isAutoWaiting(o, previews) {
    const est = String(o.estatus || '').trim().toLowerCase();
    if (!ESTATUS_AUTO.has(est)) return false;
    // 'Pagado' solo cuenta si el pago es reciente (el histórico viejo no se re-corta).
    if (est === 'pagado' && tsMs(o.comprobanteValidadoAt) < AUTO_DESDE_MS) return false;
    if (autoBlocked(o)) return false;
    return svgAutoEligibility(o, previews).eligible;
}

// ¿El pedido está en 'Corregir' porque el cliente PIDIÓ UN VIDEO de su lámpara (corregirMotivo
// 'video'), no porque un dato esté mal? Ese pendiente NO invalida el diseño: lo que el cliente vio
// fue el MOCKUP, así que la pieza puede no existir todavía.
function isVideoCorregir(o) {
    return String(o.estatus || '').trim().toLowerCase() === 'corregir'
        && String(o.corregirMotivo || '').toLowerCase() === 'video';
}

// ¿El worker debe cortar este pedido de VIDEO? (Chris, 2026-07-23) El cliente pidió video de una
// lámpara que nunca se cortó: hay que fabricarla para poder grabarla. El mockup que aprobó sigue
// siendo la fuente de verdad, así que se corta igual que un 'Fabricar'. Las correcciones de 'datos'
// NO entran: ahí justamente el dato del mockup está mal y lo revisa una persona.
// OJO: al cortarlo NO se le cambia el estatus (sigue en 'Corregir'), porque el pendiente del video
// sigue vivo hasta que el equipo lo grabe y se lo mande.
function isVideoAutoWaiting(o, previews) {
    if (!isVideoCorregir(o)) return false;
    if (autoBlocked(o)) return false;
    if (quejaDeDatosAbierta(o)) return false;   // un dato sigue mal: no se corta solo (ver abajo)
    return svgAutoEligibility(o, previews).eligible;
}

// ¿El cliente reportó un DATO MAL que nadie ha corregido todavía? Desde que la ÚLTIMA petición manda
// sobre `corregirMotivo` (Chris, 2026-07-29), un pedido con un dato mal puede quedar marcado como
// 'video' si el cliente pide un video después. Sin este candado el worker lo cortaría solo usando el
// mockup con el dato que el propio cliente dijo que estaba mal. Se libera al corregir el dato.
function quejaDeDatosAbierta(o) {
    const rep = tsMs(o && o.datosReportadoAt);
    return rep > 0 && rep > tsMs(o && o.datoCorregidoAt);
}

// "Sin fecha" (el cliente no quiere fecha) -> se graba en blanco (misma regla que el mockup).
const SIN_FECHA_RE = /sin\s*fecha|no\s*(lleva|quiere|va|hay)\s*fecha|ninguna\s*fecha/i;

// Saca nombre1/nombre2/fecha del TEXTO de datos del pedido ("Nombres: A y B | Fecha: Z" y variantes),
// para poder diseñar un pedido forzado que aún NO tiene mockup aprobado (fallback del mockup).
function parseDatosFields(datos) {
    const s = String(datos || '').replace(/\r/g, '');
    let fecha = '', dm = null;
    const fm = s.match(/fecha\s*:\s*([^\n|]+)/i);
    if (fm) fecha = fm[1].split('·')[0].trim();
    if (!fecha) {
        // Sin la etiqueta "Fecha:": busca un token con forma de fecha. Formatos soportados: con guiones/
        // slash (29-Abril-2026, 24/06/1984) y con ESPACIOS + mes en palabra ("6 agosto 2026", "6 de
        // agosto de 2026" — DH13047, que antes quedaba sin fecha -> 'incomplete_fields').
        dm = s.match(/\d{1,2}\s*[-/]\s*[A-Za-zÁÉÍÓÚáéíóúÑñ]+\s*[-/]\s*\d{2,4}/)
          || s.match(/\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{2,4}/)
          || s.match(/\d{1,2}\s+(?:de\s+)?[A-Za-zÁÉÍÓÚáéíóúÑñ]{3,}\s+(?:de\s+)?\d{2,4}/i);
        // Normaliza: pega los guiones/slash ("6 - agosto - 2026" -> "6-agosto-2026") y colapsa espacios.
        if (dm) fecha = dm[0].replace(/\s*([-/])\s*/g, '$1').replace(/\s+/g, ' ').trim();
    }
    let namePart;
    const nm = s.match(/nombres?\s*:\s*([^\n|]+)/i);
    namePart = nm ? nm[1] : (s.split(/\n|\|/)[0] || '');
    namePart = namePart.split('·')[0].replace(/\bfecha\b.*$/i, '').trim();
    // Si la fecha venía EMBEBIDA con los nombres (sin etiqueta), quitarla para que no se cuele en nombre2
    // ("Luis y Sarahí 6 agosto 2026" -> nombre2="Sarahí", no "Sarahí 6 agosto 2026").
    if (dm && !nm) namePart = namePart.replace(dm[0], ' ').replace(/\s+/g, ' ').trim();
    let nombre1 = '', nombre2 = '';
    // Separadores de pareja: "y", la conjunción española "e" (antes de i/hi: "Alison e Ivan", "Gustavo
    // e Isabel" — sin esto quedaban como un solo nombre y el pedido salía 'incomplete_fields'), "&", "+".
    const yy = namePart.split(/\s+y\s+|\s+e\s+|\s*&\s*|\s*\+\s*/i);
    if (yy.length >= 2) { nombre1 = yy[0].trim(); nombre2 = yy.slice(1).join(' y ').trim(); }
    return { nombre1: titleCaseName(nombre1), nombre2: titleCaseName(nombre2), fecha };
}

// Elegibilidad para diseño FORZADO desde el CRM (botón "Diseñar con IA"). Más laxa que la automática:
// NO exige que el pedido esté en 'Fabricar', ni mockup aprobado, ni layout verificado por visión —
// porque el usuario CONFIRMA el resultado antes de subir. Solo exige lo que el skill sabe generar:
// lámpara de corazones, no-especial, con dos nombres (fecha puede ir en blanco si el cliente no la
// quiere). Fuente de los datos: el mockup aprobado (si hay, da también la imagen de preview) o el
// texto de datos del pedido. Devuelve { ok, reason, fields, previewUrl }.
function forcedDesignFields(o, previews) {
    if (!isCorazon(o)) return { ok: false, reason: 'not_corazon' };
    // FORZADO (botón): más laxo que el automático. Solo bloquea los especiales que la IA de infinito
    // realmente NO puede (imagen/foto/frase/…); "Especial: recoger en tienda" o "…sin la 'y'" pasan.
    if (MANUAL_SPECIAL_RE.test(datosOf(o))) return { ok: false, reason: 'special' };
    previews = Array.isArray(previews) ? previews : [];
    const last = previews.length ? previews[previews.length - 1] : null;
    // Si el cliente corrigió sus datos DESPUÉS del mockup, NO usar el mockup (tiene datos viejos): se
    // corta con los datos ACTUALES del pedido (DH13941: cambió la fecha 25->26 tras aprobar el mockup).
    const usarMockup = last && !mockupObsoletoPorCorreccion(o, last);
    let nombre1 = '', nombre2 = '', fecha = '', previewUrl = null;
    if (usarMockup) {
        previewUrl = last.imageUrl || last.url || null;
        const f = last.fields || {};
        const lay = last.layout || null;
        const conLineas = (vision, plain) => (vision && vision.length ? vision.join('\n') : String(plain || ''));
        nombre1 = lay ? conLineas(lay.izquierdo, f.nombre1) : String(f.nombre1 || '');
        nombre2 = lay ? conLineas(lay.derecho, f.nombre2) : String(f.nombre2 || '');
        fecha = lay ? conLineas(lay.fecha, f.fecha) : String(f.fecha || '');
    }
    if (!nombre1 || !nombre2 || !fecha) {
        // Fallback (sin mockup usable o mockup obsoleto): datos ACTUALES del pedido, con renglones recalculados.
        const ff = fieldsFromDatos(o);
        nombre1 = nombre1 || ff.nombre1;
        nombre2 = nombre2 || ff.nombre2;
        fecha = fecha || ff.fecha;
    }
    if (!nombre1 || !nombre2) return { ok: false, reason: 'incomplete_fields' };
    if (SIN_FECHA_RE.test(fecha)) fecha = '';                                   // "Sin Fecha" -> blanco
    if (!fecha && !SIN_FECHA_RE.test(datosOf(o))) return { ok: false, reason: 'incomplete_fields' };
    // Normalizar SIEMPRE los nombres (venga de visión o del texto): inicial mayúscula + espacio tras punto.
    return { ok: true, reason: 'ok', fields: { nombre1: titleCaseName(nombre1), nombre2: titleCaseName(nombre2), fecha }, previewUrl };
}

module.exports = {
    svgAutoEligibility, isAutoWaiting, isVideoCorregir, isVideoAutoWaiting, forcedDesignFields,
    parseDatosFields, SPECIAL_RE, MANUAL_SPECIAL_RE, esEspecial, SIN_FECHA_RE, productOf, datosOf, isCorazon,
    guiaVieja, autoBlocked, AUTO_DESDE_MS, GUIA_RECIENTE_DIAS, ESTATUS_AUTO,
};
