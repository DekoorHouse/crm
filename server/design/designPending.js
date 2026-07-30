// --- Pendientes de Diseño ------------------------------------------------------------------------
// Centraliza en UNA sola bandera del CONTACTO (designPending + designPendingReasons) los pedidos que
// tienen algún pendiente para el equipo de diseño. Se calcula desde el ÚLTIMO pedido del contacto
// (misma semántica que el resto de flujos post-venta, que operan sobre el pedido más reciente) y se
// denormaliza al contacto para reutilizar la infraestructura de filtros del CRM (igual que
// inDesignReview). El filtro "Pendientes de Diseño" del CRM consulta where('designPending','==',true).
//
// El diseño se hace en DOS etapas, y la lista es la cola de ambas:
//   - mockup           -> ETAPA 1: pedido 'Sin estatus' que aún NO tiene mockup (no se pudo hacer en la
//                         sección Mockup). Al generar su preview (mockupPreviewAt) sale de la cola.
//   - fabricar         -> ETAPA 2: pedido 'Fabricar' (pagó y hay que producir) -> falta el diseño en
//                         Corel para corte. Aparece aunque ya tenga mockup.
//   - datos / video    -> estatus 'Corregir' (el cliente reportó un dato mal / pide un video).
//   - segundo_producto -> agregó un producto DESPUÉS de haber pagado (productoAgregadoPostPagoAt).
// Se limpian solas al llegar a un estatus "terminado", tener guía/quitarse de Envíos, o marca ✓ Diseñado.
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

const REASONS = ['mockup', 'fabricar', 'corte', 'datos', 'video', 'segundo_producto'];

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
const { AUTO_DESDE_MS: CORTE_DESDE_MS } = require('./svgAuto');

const _ms = t => (t && t.toMillis) ? t.toMillis() : (t && t._seconds ? t._seconds * 1000 : 0);

// ¿Pedido con pago validado que sigue SIN diseño de corte? (no mira el estatus ni la guía a propósito)
function faltaCorte(d) {
    if (d.svgCorteAt) return false;                       // ya tiene su SVG de corte
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
    );
}

// Evalúa los motivos de "pendiente de diseño" sobre los datos de UN pedido (puede ser []).
// hasMockup (opcional): si el caller ya consultó mockup_previews, lo pasa para no depender de la marca.
function reasonsForOrderData(d, hasMockup) {
    if (!d) return [];
    const estatus = String(d.estatus || 'Sin estatus').trim().toLowerCase();

    // 'Corregir' = corrección ABIERTA que pidió el cliente: SIEMPRE es pendiente de diseño, aunque ya se
    // le hubiera dado ✓ Diseñado o ya se hubiera enviado. Va ANTES de todo lo demás (incluido el
    // disenoListoAt) porque el estatus manda: se cierra cambiándole el estatus (Corregido/Fabricar/…),
    // no con el botón del tablero. (Chris, 2026-07-30: 13 de 23 Corregir estaban ocultos por ✓ Diseñado.)
    if (estatus === 'corregir') {
        return [String(d.corregirMotivo || '').toLowerCase() === 'video' ? 'video' : 'datos'];
    }

    // Marcado a mano como "ya diseñado" desde el tablero (botón ✓ Diseñado) -> fuera de pendientes,
    // SALVO que después de marcarlo el cliente haya pedido algo nuevo (ahí la marca ya no vale).
    if (d.disenoListoAt && _ms(d.disenoListoAt) >= pendienteRenovadoMs(d)) return [];
    if (DONE.has(estatus)) return [];

    // Envío ya gestionado (tiene guía o lo quitaron de Envíos) -> el diseño ya se hizo.
    const shipped = (d.guiaEnvio && d.guiaEnvio.guia) || d.ocultoDeEnvios;
    const reasons = [];

    if (!shipped) {
        if (estatus === 'fabricar') {
            // ETAPA 2: pagó y hay que producir -> falta el diseño en Corel para corte (aunque tenga mockup).
            reasons.push('fabricar');
        } else if (estatus === 'sin estatus' && !d.mockupHidden && !d.mockupPreviewAt && !hasMockup) {
            // ETAPA 1: aún sin mockup (no se pudo hacer en la sección Mockup) -> falta el mockup.
            // hasMockup viene de consultar mockup_previews (fuente de verdad, por si falta la marca).
            reasons.push('mockup');
        }
    }
    // Red de seguridad: pagado y sin diseñar sigue siendo un pendiente aunque su estatus sea 'Pagado'
    // y aunque ya tenga guía (ver CORTE_DESDE_MS arriba). Solo si ningún otro motivo lo cubre ya.
    if (!reasons.length && faltaCorte(d)) reasons.push('corte');

    if (d.productoAgregadoPostPagoAt) reasons.push('segundo_producto');

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
        let reasons = [];
        if (orderDoc) {
            const od = orderDoc.data();
            // Para 'Sin estatus' sin la marca, consultamos mockup_previews (fuente de verdad).
            const esSin = String(od.estatus || 'Sin estatus').trim().toLowerCase() === 'sin estatus';
            const hm = (esSin && !od.mockupPreviewAt) ? await orderHasMockup(orderDoc.id) : false;
            reasons = reasonsForOrderData(od, hm);
        }
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

module.exports = { recomputeForContact, recomputeForOrder, markPreviewSent, reasonsForOrderData, pendienteRenovadoMs, orderHasMockup, REASONS, DONE };
