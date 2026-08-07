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

// Fecha FIJA desde la que el corte automático puede tomar pedidos 'Pagado'. NO es ventana móvil: así
// ningún pedido nuevo vuelve a desaparecer solo, y el histórico de 'Pagado' (~6700 pedidos viejos ya
// fabricados a mano) queda fuera para siempre. Compartida con designPending.js.
const AUTO_DESDE_MS = Date.parse('2026-07-17T00:00:00Z');

// --- TABLERO Kanban = "ya lo corté a mano" (Chris, 2026-07-30) -------------------------------------
// El tablero de Pendientes de Diseño guarda la columna en `disenoBoardCol` y era "solo visual": nadie
// lo leía. Pero arrastrar una tarjeta a Terminado/Diseñado es justamente el diseñador diciendo "esto
// ya está hecho". Al no mirarlo, DH14039 (marcado Terminado el 29-jul, con la pieza ya en mano y el
// pedido enviado) se re-cortó y se subió DUPLICADO a Drive el 30-jul. Ahora cuenta como diseñado en
// TODAS las colas. Conservador a propósito: si la marca sobra, el pedido solo deja de auto-cortarse y
// sigue a la vista de un humano; el error caro es el contrario.
const BOARD_TERMINAL = new Set(['terminado', 'disenado', 'diseñado', 'cortado']);
function boardTerminado(o) {
    return BOARD_TERMINAL.has(String((o && o.disenoBoardCol) || '').trim().toLowerCase());
}

// Candados comunes a cualquier cola de corte automático: ya diseñado (a mano, por IA o marcado en el
// tablero), ya gestionado en Envíos, o con un pendiente MANUAL aparte (2º producto -> lo revisa alguien).
// LA GUÍA YA NO BLOQUEA (Chris, 2026-07-31). El flujo es mockup -> pago -> formulario -> GUÍA, así que la
// guía se genera POR ADELANTADO, ANTES de que el diseñador físico corte la pieza. Con la guía bloqueando,
// los pedidos pagados que la skill SÍ puede cortar quedaban atorados —invisibles y sin cortar— si la guía
// le ganaba la carrera al worker (21 casos el 2026-07-31: DH14098/14064/14106, etc.).
// La señal FIABLE de "ya está hecho" son las TRES marcas REALES: svgCorteAt, disenoListoAt y
// disenoBoardCol terminal (boardTerminado). Esas SÍ atrapan lo fabricado a mano: los 4 pedidos del
// incidente del 2026-07-30 (DH14039/13970/13859/13860, re-cortados por error) estaban TODOS en el tablero
// 'Terminado' -> boardTerminado los frena aunque la guía ya no (boardTerminado se sumó a este candado
// DESPUÉS de ese incidente; por eso hoy es seguro quitar la guía y no lo era entonces).
// Verificado con datos reales antes del cambio: quitar la guía NO cortó ningún pedido de más; los viejos
// con guía (DH13468/13542, pagados ~11 días antes) siguen frenados por su disenoListoAt (✓Diseñado).
// RIESGO RESIDUAL asumido por Chris: si el diseñador hace una pieza a MANO y NO la marca (ni tablero
// 'Terminado' ni ✓Diseñado ni svgCorteAt), la skill podría re-cortarla. Depende de que SIEMPRE se marque.
// --- REENVÍO (reposición) = hay que hacer una lámpara NUEVA (Chris, 2026-08-03) --------------------
// Cuando al cliente le llega el producto EQUIVOCADO o DAÑADO, `reenvioAt` sella la reposición. Todo lo
// hecho ANTES de ese sello deja de valer: el corte viejo es de la pieza que ya se fue. Sin esto el
// pedido quedaba fuera de la cola de diseño para siempre — caso DH13554: se repuso, sacó guía nueva y
// nunca volvió a diseño porque conservaba el svgCorteAt del corte original.
// Se apoya en `reenvioAt` y NO en el estatus a propósito: al generar la guía nueva el estatus se fuerza
// a 'Pagado' (apiRoutes:9209), así que 'Reenvio' se pierde a los minutos; el sello de tiempo no.
function disenoYaHecho(o) {
    if (!o) return false;
    const re = tsMs(o.reenvioAt);
    const vigente = ts => ts > 0 && (!re || ts > re);      // marca anterior al reenvío -> ya no cuenta
    if (vigente(tsMs(o.svgCorteAt))) return true;
    if (vigente(tsMs(o.disenoListoAt))) return true;
    if (boardTerminado(o)) {
        // Sin reenvío la columna del tablero cuenta aunque no traiga fecha (conservador, protege lo
        // fabricado a mano). Con reenvío, solo si se movió DESPUÉS de él.
        const bts = tsMs(o.disenoBoardColAt);
        if (!re || (bts && bts > re)) return true;
    }
    return false;
}

function autoBlocked(o) {
    return !!(disenoYaHecho(o)                                              // ya diseñado / marcado hecho (3 marcas reales, invalidadas por un reenvío)
        || o.ocultoDeEnvios                                                 // quitado de Envíos = gestionado
        || o.productoAgregadoPostPagoAt                                     // 2º producto -> manual
        || o.iaForce);                                                      // "Diseñar con IA": lo diseña processForcedDesigns CON confirmación, NO el auto-corte (el worker ya lo salta); así isAutoWaiting=false y sigue visible en Pendientes con su UI de confirmar
}

// --- La cola NO se decide por el ESTATUS (Chris, 2026-08-05) ---------------------------------------
// El estatus ha demostrado ser una señal frágil y ya dejó al corte automático sin candidatos TRES
// veces, siempre en silencio (el worker corría y decía "Nada que generar"):
//   1) exigía 'Fabricar', pero al validar el pago el pedido pasa a 'Pagado'   -> 2026-07-29
//   2) se sumó 'Pagado', pero ahora el pago validado deja el pedido en 'Foto enviada' (el estatus del
//      mockup ya enviado) y volvió a quedarse sin candidatos                   -> 2026-08-05
// La señal ESTABLE de "esto ya se vende y hay que fabricarlo" es el PAGO VALIDADO
// (`comprobanteValidadoAt`), que no depende de cómo se llame el estatus del momento. El estatus solo
// se usa para DESCARTAR los terminales (cancelado/entregado/devolución/ya diseñado).
// 'Fabricar' se acepta aunque no traiga comprobante: en el flujo viejo se ponía al confirmar la venta.
const ESTATUS_TERMINAL = new Set([
    'cancelado', 'entregado', 'devolución', 'devolucion', 'mns amenazador',
    'diseñado', 'disenado', 'diseñado por ia', 'disenado por ia', 'corregido',
]);
// Se mantiene exportado por compatibilidad; ya no decide la cola.
const ESTATUS_AUTO = new Set(['fabricar', 'pagado']);

// --- LÁMPARAS DE PERSONAJE (Spiderman / T-Rex) — Modo 5 de la skill -------------------------------
// Producto "Lámpara infantil <Personaje>", datos "Nombre: X | Personaje: Y". UNA lámpara por item, y
// un pedido puede traer varias, incluso de personajes distintos. Va aquí y no en un módulo aparte a
// propósito: `isAutoWaiting` es el predicado que el CRM usa para SACAR un pedido de "Pendientes"
// manual (apiRoutes:8424). Si el worker cortara personaje sin que este predicado lo supiera, el pedido
// seguiría a la vista del diseñador y saldría cortado DOS veces — el mismo incidente del 2026-07-30.
const ES_INFANTIL_RE = /l[aá]mpara\s+infantil/i;

// Alias personaje -> plantilla (Chris, 2026-08-06; "dinosaurio" y "T-Rex" son la MISMA, verificado
// contra el mockup de DH14328). `no` son las trampas: "Dino cuello largo" es otra silueta y
// "dinosaurio bebé" está SIN CONFIRMAR, así que ninguno de los dos se corta solo.
// `\bdino` con frontera al INICIO: sin ella, /dino/ pegaba dentro de cualquier palabra ("aladino").
const PERSONAJE_ALIAS = [
    { tpl: 'rex', re: /\bt-?rex\b|\brex\b|\bdino/, no: /cuello\s*largo|bebe/ },
    { tpl: 'spiderman', re: /spider|hombre\s*ara/ },
];
// Lista de plantillas que el worker sabe emparejar. Se deriva de PERSONAJE_ALIAS para que no se
// desincronicen al agregar un modelo nuevo.
const PLANTILLAS_PERSONAJE = [...new Set(PERSONAJE_ALIAS.map(a => a.tpl))];

// "Algo especial" para una lámpara infantil. NO se puede usar SPECIAL_RE tal cual: incluye la palabra
// "personaje", y estos datos SIEMPRE traen la etiqueta "Personaje:", así que TODO pedido daría especial.
const ESPECIAL_PERSONAJE_RE = /foto|imagen|graba|logo|escudo|mascota|dibuj|dise[nñ]|frase|leyenda|adicional|s[ií]mbolo|\bpng\b|\bjpg\b/i;

// ¿Este item lleva algo que la plantilla no puede? Mira el texto COMPLETO, no solo el valor de la
// etiqueta "Especial:": hay pedidos que lo piden en texto libre, y además todo lo que va ANTES del
// primer "Nombre:" se pierde al partir en lámparas. Las notas de logística no cuentan (igual que esEspecial).
function itemEspecialPersonaje(datos) {
    const s = String(datos || '');
    const sinEtiquetas = s.replace(/(?:personaje|nombre)\s*:/gi, ' ');
    const m = /especial\s*:\s*([^|\n]+)/i.exec(s);
    if (m) {
        const valor = m[1].trim();
        // "Especial: recoger en tienda" no cambia el diseño; "Especial: con su foto" sí.
        if (!(ESPECIAL_LOGISTICA_RE.test(valor) && !ESPECIAL_PERSONAJE_RE.test(valor))) return true;
        return ESPECIAL_PERSONAJE_RE.test(sinEtiquetas.replace(/especial\s*:[^|\n]*/gi, ' '));
    }
    return ESPECIAL_PERSONAJE_RE.test(sinEtiquetas);
}
function plantillaDePersonaje(pers) {
    const p = sinAcentos(String(pers || '')).toLowerCase().trim();
    if (!p) return null;
    for (const a of PERSONAJE_ALIAS) {
        if (a.no && a.no.test(p)) continue;
        if (a.re.test(p)) return a.tpl;
    }
    return null;
}

// Saca TODAS las lámparas del texto de un item. Normalmente es una sola ("Nombre: X | Personaje: Y"),
// pero hay pedidos que traen varias apiladas en el mismo campo, separadas por punto:
// "Nombre: Ian | Personaje: dinosaurio. Nombre: Ivanna | Personaje: dinosaurio." (DH14328). Con un
// solo match se perdían las demás EN SILENCIO: no se les hacía mockup ni se cortaban.
function lamparasDeTexto(datos, productoFallback) {
    const s = String(datos || '').replace(/\r/g, '');
    // El corte solo vale al INICIO de un campo (principio, "|", salto o el punto que separa lámparas
    // apiladas). Con un lookahead pelón, un "nombre:" dentro de un valor libre partía el texto e
    // inventaba una lámpara fantasma que sí se habría cortado.
    const partes = s.split(/(?<=[|\n.]|^)\s*(?=nombre\s*:)/i).filter(x => /nombre\s*:/i.test(x));
    const limpia = v => String(v || '').split(/\b(?:personaje|especial)\s*:/i)[0].trim().replace(/[.,;]+$/, '').trim();
    return partes.map(p => {
        const mn = /nombre\s*:\s*([^|\n]+)/i.exec(p);
        const mp = /personaje\s*:\s*([^|\n]+)/i.exec(p);
        const me = /especial\s*:\s*([^|\n]+)/i.exec(p);
        const pers = mp ? limpia(mp[1]) : String(productoFallback || '').replace(ES_INFANTIL_RE, '').trim();
        return { nombre: limpia(mn && mn[1]), personaje: pers, especial: me ? limpia(me[1]) : '' };
    });
}

// Renglones que el cliente vio en su mockup, SOLO cuando se puede confiar en ellos.
// El verificador de visión está cableado a la infinito (nombreIzquierdo/nombreDerecho/fecha), y en una
// lámpara de UN nombre reparte las palabras entre los dos huecos: en DH14299 el mockup dice
// "Angel Ariel" en UN renglón y la visión reportó izq=["Angel"] der=["Ariel"], que leído como renglones
// es un DOS RENGLONES FALSO. Discriminador medido sobre 4 mockups reales:
//   der VACÍO  -> izq es la estructura REAL   (DH14424 ["Luis Roberto"]=1 renglón; DH14344 ["Dylan","Javier"]=2)
//   der CON algo -> es el reparto de la infinito, NO son renglones (DH14299)
// Además se exige que el texto leído sea el nombre de ESTA lámpara: un pedido con varias lámparas tiene
// UN solo mockup, y aplicarle su acomodo a otra lámpara sería grabar lo que nadie aprobó.
function renglonesDelMockup(o, previews, nombre) {
    const arr = Array.isArray(previews) ? previews : [];
    if (!arr.length) return null;
    const last = arr[arr.length - 1];
    if (mockupObsoletoPorCorreccion(o, last)) return null;
    const lay = last.layout;
    if (!lay) return null;
    const izq = (lay.izquierdo || []).filter(Boolean);
    const der = (lay.derecho || []).filter(Boolean);
    if (der.length || !izq.length) return null;
    const norm = t => sinAcentos(String(t || '')).toLowerCase().replace(/\s+/g, ' ').trim();
    if (norm(izq.join(' ')) !== norm(nombre)) return null;
    return izq;
}

// titleCaseName pone mayúscula en CADA palabra, así que "Yandel y Roman" salía grabado
// "Yandel Y Roman". Las conjunciones sueltas vuelven a minúscula.
const arreglaConjunciones = t => String(t || '').replace(/(^|\s)([YE])(\s)/g, (m, a, c, b) => a + c.toLowerCase() + b);

// ¿Qué lámparas de personaje puede cortar solo el worker?
// `eligible` es TODO O NADA a propósito: basta que UNA lámpara del pedido no se pueda (sin plantilla,
// con foto grabada, datos ilegibles…) para que el pedido ENTERO se vaya a diseño manual. Antes
// devolvía eligible:true con un flag `completo` aparte, y como `isAutoWaiting` solo miraba `eligible`,
// el CRM sacaba el pedido de "Pendientes" pero el worker no lo cortaba: quedaba en un limbo, invisible
// para todos. El predicado del CRM y el candado del worker tienen que ser EL MISMO (ver cabecera).
// `reason` del NO: sin_items | sin_plantilla | mixto.  `manuales` explica el porqué (para el log/UI).
function personajeEligibility(o, previews) {
    const items = Array.isArray(o.items) && o.items.length ? o.items
        : (o.datosProducto || o.producto ? [{ producto: o.producto, datosProducto: o.datosProducto }] : []);
    const lamparas = [], manuales = [];
    for (const it of items) {
        const prod = String(it.producto || it.nombre || '');
        if (!ES_INFANTIL_RE.test(prod)) { manuales.push({ nombre: '', personaje: prod, motivo: 'otro_producto' }); continue; }
        if (itemEspecialPersonaje(it.datosProducto)) { manuales.push({ nombre: '', personaje: prod, motivo: 'especial' }); continue; }
        const ls = lamparasDeTexto(it.datosProducto, prod);
        // Item infantil cuyo texto no se pudo leer: sin esto desaparecía en silencio y el pedido se
        // daba por completo, así que se cortaban solo las otras lámparas y se marcaba como diseñado.
        if (!ls.length) { manuales.push({ nombre: '', personaje: prod, motivo: 'datos_ilegibles' }); continue; }
        // `cantidad` dice cuántas lámparas lleva el item. Si no cuadra con los "Nombre:" encontrados es
        // ambiguo y va a manual: DH14426 pide cantidad=2 con un solo "Nombre: Yandel y Roman" — ¿son dos
        // lámparas iguales, o una para cada niño? No se adivina.
        const cant = Math.max(1, parseInt(it.cantidad, 10) || 1);
        if (cant !== ls.length) { manuales.push({ nombre: ls.map(x => x.nombre).join('/'), personaje: prod, motivo: `cantidad_${cant}_vs_${ls.length}` }); continue; }
        for (const l of ls) {
            const tpl = plantillaDePersonaje(l.personaje);
            if (!l.nombre) manuales.push({ ...l, motivo: 'sin_nombre' });
            else if (!tpl) manuales.push({ ...l, motivo: 'sin_plantilla' });
            else {
                const rr = renglonesDelMockup(o, previews, l.nombre);
                lamparas.push({
                    tpl,
                    personaje: l.personaje,
                    // Sin mockup usable se corta con el nombre del PEDIDO en UN renglón (Chris,
                    // 2026-08-07); el ajuste de tamaño lo hace hoja-personaje.js midiendo el render.
                    nombre: arreglaConjunciones(titleCaseName(rr ? rr.join('\n') : l.nombre)),
                    delMockup: !!rr,
                });
            }
        }
    }
    if (!lamparas.length) return { eligible: false, reason: items.length ? 'sin_plantilla' : 'sin_items', lamparas: [], manuales, completo: false };
    if (manuales.length) return { eligible: false, reason: 'mixto', lamparas, manuales, completo: false };
    return { eligible: true, reason: 'ok', lamparas, manuales, completo: true };
}

function isPersonajeAutoWaiting(o, previews) {
    const est = String(o.estatus || '').trim().toLowerCase();
    if (ESTATUS_TERMINAL.has(est)) return false;
    if (est !== 'fabricar' && tsMs(o.comprobanteValidadoAt) < AUTO_DESDE_MS) return false;
    if (autoBlocked(o)) return false;
    if (quejaDeDatosAbierta(o)) return false;        // un dato sigue mal: lo revisa una persona
    if (est === 'corregir' && !isVideoCorregir(o)) return false;
    return personajeEligibility(o, previews).eligible;
}

// ¿El pedido está EN COLA para el corte automático (aún sin cortar, auto-elegible)? Es el conjunto
// exacto que el endpoint saca de "Pendientes" manual y muestra en "SVG IA" como "esperando pareja".
// `previews` = mockup_previews[orderId].previews.
function isAutoWaiting(o, previews) {
    const est = String(o.estatus || '').trim().toLowerCase();
    if (ESTATUS_TERMINAL.has(est)) return false;
    // El pago validado manda; sin él solo pasa 'Fabricar' (flujo viejo). El corte de fecha deja fuera
    // el histórico de pedidos ya fabricados a mano.
    if (est !== 'fabricar' && tsMs(o.comprobanteValidadoAt) < AUTO_DESDE_MS) return false;
    if (autoBlocked(o)) return false;
    // Corazón (Modo 2) o lámpara de personaje (Modo 5): las dos las corta el worker. Se delega en
    // isPersonajeAutoWaiting (y no en .eligible pelado) para que esta función y el candado del worker
    // no puedan divergir: si el worker no lo va a cortar, el pedido TIENE que seguir visible en manual.
    return svgAutoEligibility(o, previews).eligible || isPersonajeAutoWaiting(o, previews);
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
    boardTerminado, disenoYaHecho, autoBlocked, AUTO_DESDE_MS, ESTATUS_AUTO, ESTATUS_TERMINAL,
    personajeEligibility, isPersonajeAutoWaiting, plantillaDePersonaje, lamparasDeTexto, ES_INFANTIL_RE,
    PLANTILLAS_PERSONAJE, quejaDeDatosAbierta,
};
