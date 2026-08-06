// --- Pendientes de Diseño ------------------------------------------------------------------------
// Centraliza en UNA sola bandera del CONTACTO (designPending + designPendingReasons) los pedidos que
// tienen algún pendiente para el equipo de diseño. Se calcula desde el ÚLTIMO pedido del contacto
// (misma semántica que el resto de flujos post-venta, que operan sobre el pedido más reciente) y se
// denormaliza al contacto para reutilizar la infraestructura de filtros del CRM (igual que
// inDesignReview). El filtro "Pendientes de Diseño" del CRM consulta where('designPending','==',true).
//
// La lista es la cola del diseño (Erika):
//   - fabricar         -> pedido 'Fabricar' (pagó y hay que producir) -> falta el diseño en Corel para
//                         corte. Aparece aunque ya tenga mockup.
//   - datos            -> estatus 'Corregir' porque el cliente reportó un DATO MAL.
//   - segundo_producto -> agregó un producto DESPUÉS de haber pagado (productoAgregadoPostPagoAt).
// Se limpian solas al llegar a un estatus "terminado", tener guía/quitarse de Envíos, o marca ✓ Diseñado.
//
// MOCKUP y VIDEO ya NO son de Diseño (Chris, 2026-08-06): son otro puesto (Lupita) y viven en la
// sección "Pendientes" (server/pendientes/pendientesRoutes.js). Su lógica sigue AQUÍ —
// pendientesReasonsForOrderData, al final del archivo— para no partir en dos las reglas de un pedido.
const { db, admin } = require('../config');

// Estatus "terminado" para diseño: si el pedido está aquí, NO hay pendiente (limpia la bandera).
// OJO: 'Fabricar' NO va aquí. En este flujo se pone 'Fabricar' al CONFIRMAR la venta (dispara el
// evento Purchase a Meta), a veces ANTES de diseñar (ej. DH13491: pagó y pasó a Fabricar el mismo día,
// sin preview). Por eso un 'Fabricar' pagado y no enviado se considera pendiente de diseño; si ya
// estaba diseñado, se saca con el botón ✓ Diseñado. El diseño terminado real se marca como 'Diseñado'.
const DONE = new Set([
    'diseñado', 'disenado', 'corregido',
    'diseñado por ia', 'disenado por ia',   // diseño generado automáticamente por el svg-worker local
    'cancelado', 'entregado', 'devolución', 'devolucion', 'mns amenazador',
]);

const REASONS = ['fabricar', 'corte', 'datos', 'segundo_producto', 'manual', 'reenvio'];
// Motivos de la OTRA sección ("Pendientes", Lupita). Nunca se mezclan con los de arriba.
const PENDIENTES_REASONS = ['mockup', 'video'];

// --- Motivo 'corte': el HUECO por el que se colaban pedidos sin diseñar (detectado 2026-07-27) -----
// Al VALIDAR el pago el pedido pasa a 'Pagado' (NO a 'Fabricar'), y si además se le generó la guía por
// adelantado (aquí se sacan antes de fabricar) quedaba fuera de TODAS las colas: el worker lo saltaba
// por el candado anti-re-corte de la guía, y esta lista tampoco lo mostraba porque 'Pagado' no era un
// bucket. Resultado: 153 pedidos pagados y sin diseñar, invisibles. Ahora un pedido PAGADO y sin
// diseñar es pendiente de corte AUNQUE ya tenga guía.
// El corte de fecha evita volcar el histórico (127 de esos 153 ya se fabricaron a mano hace semanas);
// es una fecha FIJA, no una ventana móvil, para que ningún pedido nuevo vuelva a desaparecer solo.
// MISMA constante que usa el corte automático (svgAuto.AUTO_DESDE_MS): si divergen, un pedido podría
// salir en esta lista pero no en la cola del worker (o al revés).
const { AUTO_DESDE_MS: CORTE_DESDE_MS, boardTerminado, disenoYaHecho } = require('./svgAuto');

const _ms = t => (t && t.toMillis) ? t.toMillis() : (t && t._seconds ? t._seconds * 1000 : 0);

// ¿Pedido con pago validado que sigue SIN diseño de corte? (no mira el estatus ni la guía a propósito)
// El tablero cuenta: si el diseñador arrastró la tarjeta a Terminado/Diseñado ya está hecho aunque
// nadie haya registrado svgCorteAt (así se re-cortó DH14039 el 2026-07-30 — ver svgAuto.boardTerminado).
// El TABLERO no oculta (Chris, 2026-08-04) --------------------------------------------------------
// El 2026-07-30 se hizo que la columna 'Terminado' contara como "ya diseñado" para frenar re-cortes
// (incidente DH14039). Pero medido el 2026-08-04: de 113 pedidos en 'Terminado', 78 NO tienen ningún
// corte registrado — la tarjeta se mueve por muchas razones, no solo porque ya se cortó (DH14204/
// 14267/14264 se marcaron ANTES de que saliera su guía). Usarla para OCULTAR desaparecía pedidos que
// sí faltaba diseñar.
// Criterio que aguanta los dos errores: el tablero SIGUE frenando el corte automático (svgAuto.
// autoBlocked -> nunca se re-corta solo, que es el error caro) pero YA NO oculta de esta lista, que
// es la que mira un humano. Ver y decidir es barato; cortar de más, no.
function marcaDeCorteReal(d) {
    const re = _ms(d.reenvioAt);
    const vig = ts => ts > 0 && (!re || ts > re);   // un corte anterior a un reenvío ya no vale
    return vig(_ms(d.svgCorteAt)) || vig(_ms(d.disenoListoAt));
}

function faltaCorte(d) {
    // Solo las marcas DURAS (svgCorteAt / ✓Diseñado) sacan un pedido de la lista. La columna del
    // tablero NO: ver el comentario de arriba.
    if (marcaDeCorteReal(d)) return false;
    // REPOSICIÓN (producto equivocado o dañado): siempre pendiente hasta volver a cortarla, sin
    // importar la antigüedad del pago — el pedido original puede ser de hace meses (Chris, 2026-08-03).
    if (_ms(d.reenvioAt)) return true;
    const pago = _ms(d.comprobanteValidadoAt);
    return !!pago && pago >= CORTE_DESDE_MS;
}

// Fecha del ÚLTIMO pendiente que se le generó al pedido. Sirve para saber si una marca manual
// ("✓ Diseñado", o la tarjeta movida a Terminado en el tablero) ya quedó VIEJA porque después el
// cliente volvió a pedir algo. Sin esto, marcar un pedido como terminado lo silenciaba para siempre.
function pendienteRenovadoMs(d) {
    if (!d) return 0;
    return Math.max(
        _ms(d.pendienteDisenoAt),          // se refresca en CADA petición (aunque ya estuviera en Corregir)
        _ms(d.corregirAt),                 // corrección / video pedidos
        _ms(d.videoRequestedAt),
        _ms(d.productoAgregadoPostPagoAt), // 2º producto tras pagar
        _ms(d.comprobanteValidadoAt),      // pagó -> falta corte
        _ms(d.reenvioAt),                  // reposición -> re-hacer el diseño desde el principio
    );
}

// ¿Cuándo dijo la DISEÑADORA "mi parte ya está hecha"? Hay DOS marcas equivalentes:
//   - botón ✓ Diseñado                                  -> disenoListoAt
//   - tarjeta movida en el TABLERO a Terminado/Diseñado  -> disenoBoardCol (+ disenoBoardColAt)
// Esta lista es la vista de QUIEN DISEÑA: mover la tarjeta a una columna terminal es justamente ella
// diciendo "terminé mi trabajo". Que falte cortar, enviar, etc. NO la devuelve aquí — eso ya es de
// otras áreas y se ve en sus propias colas (Chris, 2026-08-01). Antes solo contaba disenoListoAt, así
// que arrastrar la tarjeta no servía de nada y el pedido regresaba solo a Pendientes (DH13817/DH14079).
// Es la MISMA señal que ya respeta el corte automático (svgAuto.autoBlocked -> boardTerminado); ahora
// las dos colas coinciden en qué cuenta como "diseñado".
// Devuelve ms (0 = sin marca). Con FECHA a propósito: una petición NUEVA del cliente posterior a la
// marca la invalida y la tarjeta se reactiva sola (ver pendienteRenovadoMs).
// Solo cuenta la marca DURA: el botón "✓ Diseñado" (disenoListoAt), que es un acto explícito de
// "esto ya está resuelto". La columna 'Terminado' del TABLERO ya NO cuenta aquí (Chris, 2026-08-04):
// se movía por muchas razones y no solo porque el corte estuviera hecho — medido, 78 de 113 pedidos en
// 'Terminado' no tenían ningún corte registrado, y así desaparecían de esta lista pedidos que sí
// faltaba diseñar (DH14204/14267/14264, marcados ANTES incluso de que saliera su guía).
// El tablero SIGUE frenando el corte automático en svgAuto.autoBlocked: no re-cortar es el error caro,
// no mostrar es el barato. Aquí la lista la mira un humano, así que peca de mostrar de más.
function disenoMarcadoHechoMs(d) {
    if (!d) return 0;
    return _ms(d.disenoListoAt);
}

// Evalúa los motivos de "pendiente de DISEÑO" sobre los datos de UN pedido (puede ser []).
// Los de la sección "Pendientes" (mockup/video) van en pendientesReasonsForOrderData.
function reasonsForOrderData(d) {
    if (!d) return [];
    const estatus = String(d.estatus || 'Sin estatus').trim().toLowerCase();


    // Marcado a mano "ya diseñado" -> fuera de pendientes, SALVO que DESPUÉS de marcarlo el cliente
    // haya pedido algo nuevo (pendienteRenovadoMs > la marca -> reactivación).
    // Aplica también a 'Corregir': una corrección YA RESUELTA (marcada Diseñado después de pedirla) no
    // sigue pendiente; si el cliente vuelve a pedir, reaparece. DH13817 (pidió otro video, sin marca ->
    // sigue) vs DH13608/13586 (marcados Diseñado tras la corrección -> fuera). Chris, 2026-07-31.
    const hechoMs = disenoMarcadoHechoMs(d);
    if (hechoMs && hechoMs >= pendienteRenovadoMs(d)) return [];
    if (DONE.has(estatus)) return [];

    // Envío ya gestionado (tiene guía o lo quitaron de Envíos) -> el diseño ya se hizo (no aplica a Corregir).
    const shipped = (d.guiaEnvio && d.guiaEnvio.guia) || d.ocultoDeEnvios;
    const reasons = [];

    if (estatus === 'corregir') {
        // VIDEO -> no es de Diseño: es de la sección "Pendientes" (grabar y mandar el video). Sale
        // ENTERO de esta cola —con return, no con un simple "no pushear"— para que tampoco lo recoja
        // la red de seguridad 'corte' de abajo; si no, el mismo pedido aparecería en los DOS tableros.
        // Ahí también se puede cortar con la skill (el botón "Diseñar con IA" vive en esa sección).
        // Chris, 2026-08-06.
        if (String(d.corregirMotivo || '').toLowerCase() === 'video') return [];
        // Corrección pedida por el cliente y AÚN no resuelta (las ya marcadas se filtran arriba). Aparece
        // aunque ya se hubiera enviado. El motivo lo persiste markOrderCorregirForContact.
        reasons.push('datos');
    } else if (estatus === 'reenvio') {
        // REPOSICIÓN: el pedido se vuelve a hacer desde el principio (Chris, 2026-08-01). Además de
        // re-meterse a Envíos, REACTIVA el diseño: reaparece en Pendientes (motivo 'reenvio') aunque el
        // original ya estuviera diseñado. reenvioAt entra en pendienteRenovadoMs, así que una tarjeta que
        // estaba en "Terminado" regresa sola a Pendientes al ponerse en Reenvio.
        reasons.push('reenvio');
    } else if (!shipped) {
        if (estatus === 'fabricar') {
            // pagó y hay que producir -> falta el diseño en Corel para corte (aunque tenga mockup).
            reasons.push('fabricar');
        }
        // 'Sin estatus' sin mockup ya NO entra aquí: ese pendiente es de la sección "Pendientes"
        // (columna "Falta mockup"). Ver faltaMockup() al final del archivo. Chris, 2026-08-06.
    }
    // Red de seguridad: pagado y sin diseñar sigue siendo un pendiente aunque su estatus sea 'Pagado'
    // y aunque ya tenga guía (ver CORTE_DESDE_MS arriba). Solo si ningún otro motivo lo cubre ya.
    if (!reasons.length && faltaCorte(d)) reasons.push('corte');

    if (d.productoAgregadoPostPagoAt) reasons.push('segundo_producto');

    // Empujado a mano a Pendientes de Diseño desde la sección Mockup (botón "A Diseño"): aparece aquí
    // aunque no tenga un motivo natural (p.ej. ya tiene mockup). Los early-returns de arriba (marcado
    // hecho / estatus terminal) ganan primero, así que un forzado YA diseñado NO reaparece. El botón
    // "✓ Diseñado" (endpoint /done) limpia designForce. Espejo inverso de mockupForce. Chris, 2026-08-01.
    if (!reasons.length && d.designForce) reasons.push('manual');

    return reasons;
}

// Último pedido del contacto (mismo criterio que services.getLatestOrderForContact: por telefono y
// por contactId, el de createdAt más reciente). Reimplementado aquí para no crear dependencia circular.
async function getLatestOrder(contactId) {
    const seen = new Map();
    for (const field of ['telefono', 'contactId']) {
        const snap = await db.collection('pedidos').where(field, '==', contactId).get();
        snap.forEach(doc => seen.set(doc.id, doc));
    }
    if (seen.size === 0) return null;
    let best = null, bestMs = -1;
    for (const doc of seen.values()) {
        const d = doc.data();
        const ms = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0;
        if (ms >= bestMs) { bestMs = ms; best = doc; }
    }
    return best;
}

// ¿El pedido ya tiene al menos un preview de mockup guardado? Fuente de verdad: colección
// mockup_previews (doc por orderId con previews[]). Se usa por si mockupPreviewAt no quedó puesto.
async function orderHasMockup(orderId) {
    try {
        const doc = await db.collection('mockup_previews').doc(String(orderId)).get();
        return doc.exists && Array.isArray(doc.data().previews) && doc.data().previews.length > 0;
    } catch (_) { return false; }
}

// Recalcula y escribe designPending + designPendingReasons en el contacto. Nunca lanza.
async function recomputeForContact(contactId) {
    if (!contactId) return null;
    try {
        const orderDoc = await getLatestOrder(contactId);
        const reasons = orderDoc ? reasonsForOrderData(orderDoc.data()) : [];
        // El id del doc del contacto = pedido.contactId (o el propio contactId si no hay pedido).
        const cid = (orderDoc && orderDoc.data().contactId) || contactId;
        await db.collection('contacts_whatsapp').doc(String(cid)).set({
            designPending: reasons.length > 0,
            designPendingReasons: reasons,
        }, { merge: true });
        return reasons;
    } catch (e) {
        console.warn('[DISEÑO] recomputeForContact falló para', contactId, e.message);
        return null;
    }
}

// Resuelve el contacto de un pedido y recalcula. Útil desde endpoints que tienen el pedido a mano.
async function recomputeForOrder(orderId, orderData) {
    try {
        const d = orderData || (await db.collection('pedidos').doc(String(orderId)).get()).data();
        if (!d) return null;
        return recomputeForContact(d.contactId || d.telefono);
    } catch (e) {
        console.warn('[DISEÑO] recomputeForOrder falló para', orderId, e.message);
        return null;
    }
}

// Marca en el último pedido del contacto que ya le mandamos su preview (mueve de "anticipo" a
// "mockup_pagado") y recalcula. Se llama al enviar un mockup por WhatsApp.
async function markPreviewSent(contactId) {
    if (!contactId) return null;
    try {
        const orderDoc = await getLatestOrder(contactId);
        if (orderDoc && !orderDoc.data().previewEnviadoAt) {
            await orderDoc.ref.update({ previewEnviadoAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        return recomputeForContact(contactId);
    } catch (e) {
        console.warn('[DISEÑO] markPreviewSent falló para', contactId, e.message);
        return null;
    }
}

// =================================================================================================
// === Motivos de la sección "Pendientes" (Lupita), NO de Diseño ===================================
// =================================================================================================
// Viven aquí —y no en su propio archivo— porque son reglas sobre el MISMO pedido que las de arriba:
// separarlas era la única forma de garantizar que un pedido no salga en los dos tableros a la vez.
// Los otros tres pendientes de esa sección son de CONTACTOS (atención humana, cola Pendientes IA),
// no de pedidos, y se calculan en server/pendientes/pendientesRoutes.js.

// ¿El cliente pidió VIDEO de su lámpara y todavía no se lo mandamos?
// El pendiente lo abre el webhook al detectar la petición (estatus 'Corregir' + corregirMotivo
// 'video'; ver project_video_corregir) y lo cierra el botón "✓ Video enviado" (videoEnviadoAt).
// Con FECHA a propósito: si el cliente pide OTRO video después (corregirAt/videoRequestedAt se
// refrescan en cada petición), la marca vieja ya no vale y la tarjeta se reactiva sola.
// Cambiar el estatus (a 'Corregido', 'Entregado'…) también lo cierra: deja de ser 'Corregir'.
function esVideoPendiente(d) {
    if (!d) return false;
    if (String(d.estatus || '').trim().toLowerCase() !== 'corregir') return false;
    if (String(d.corregirMotivo || '').toLowerCase() !== 'video') return false;
    const pedido = Math.max(_ms(d.videoRequestedAt), _ms(d.corregirAt));
    const enviado = _ms(d.videoEnviadoAt);
    return !enviado || enviado < pedido;
}

// ¿Al pedido le falta su mockup? (lo que hasta el 2026-08-06 salía en Diseño como "Falta mockup").
// hasMockup: lo pasa el caller tras consultar mockup_previews (fuente de verdad, por si la marca
// mockupPreviewAt no quedó puesta). Las marcas de "ya se atendió" son las MISMAS que usa la cola de
// la sección Mockup (/api/mockups/pending): si la foto se mandó por el chat (/cuatro) o a mano en un
// especial, el pendiente ya está resuelto aunque nunca haya pasado por la sección.
function faltaMockup(d, hasMockup) {
    if (!d) return false;
    if (String(d.estatus || 'Sin estatus').trim().toLowerCase() !== 'sin estatus') return false;
    if (d.mockupHidden) return false;                       // ocultado a mano por el operador
    if (hasMockup || d.mockupPreviewAt) return false;       // ya tiene preview generado
    if (d.previewEnviadoAt || d.pedidoListoEnviadoAt || d.mockupPaymentSentAt || d.mockupSentManuallyAt) return false;
    return true;
}

// Motivos de la sección "Pendientes" para UN pedido (puede ser []). Espejo de reasonsForOrderData.
function pendientesReasonsForOrderData(d, hasMockup) {
    if (!d) return [];
    const reasons = [];
    if (faltaMockup(d, hasMockup)) reasons.push('mockup');
    if (esVideoPendiente(d)) reasons.push('video');
    return reasons;
}

module.exports = {
    recomputeForContact, recomputeForOrder, markPreviewSent, reasonsForOrderData, pendienteRenovadoMs,
    disenoMarcadoHechoMs, orderHasMockup, REASONS, DONE,
    // Sección "Pendientes"
    pendientesReasonsForOrderData, esVideoPendiente, faltaMockup, PENDIENTES_REASONS,
};
