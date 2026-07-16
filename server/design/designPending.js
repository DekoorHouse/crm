// --- Pendientes de Diseño ------------------------------------------------------------------------
// Centraliza en UNA sola bandera del CONTACTO (designPending + designPendingReasons) los pedidos que
// tienen algún pendiente para el equipo de diseño. Se calcula desde el ÚLTIMO pedido del contacto
// (misma semántica que el resto de flujos post-venta, que operan sobre el pedido más reciente) y se
// denormaliza al contacto para reutilizar la infraestructura de filtros del CRM (igual que
// inDesignReview). El filtro "Pendientes de Diseño" del CRM consulta where('designPending','==',true).
//
// Las 5 condiciones (todas se limpian solas cuando el pedido llega a un estatus "terminado"):
//   1. mockup_pagado    -> pagó Y ya le mandamos su preview (previewEnviadoAt)
//   2. datos            -> estatus 'Corregir' con corregirMotivo != 'video' (el cliente reportó un dato mal)
//   3. video            -> estatus 'Corregir' con corregirMotivo == 'video' (el cliente pide un video)
//   4. anticipo         -> pagó (comprobante válido / Pagado) pero AÚN no le mandamos su preview
//   5. segundo_producto -> agregó un producto DESPUÉS de haber pagado (productoAgregadoPostPagoAt)
const { db, admin } = require('../config');

// Estatus "terminado" para diseño: si el pedido está aquí, NO hay pendiente (limpia la bandera).
const DONE = new Set([
    'diseñado', 'disenado', 'fabricar', 'corregido',
    'cancelado', 'entregado', 'devolución', 'devolucion', 'mns amenazador',
]);

const REASONS = ['mockup_pagado', 'datos', 'video', 'anticipo', 'segundo_producto'];

// Evalúa las 5 condiciones sobre los datos de UN pedido y devuelve la lista de motivos (puede ser []).
function reasonsForOrderData(d) {
    if (!d) return [];
    // Marcado a mano como "ya diseñado" desde el tablero (botón ✓ Diseñado) -> fuera de pendientes.
    if (d.disenoListoAt) return [];
    const estatus = String(d.estatus || '').trim().toLowerCase();
    if (DONE.has(estatus)) return [];

    const reasons = [];
    if (estatus === 'corregir') {
        // 2 y 3: en corrección. El motivo lo persiste markOrderCorregirForContact.
        reasons.push(String(d.corregirMotivo || '').toLowerCase() === 'video' ? 'video' : 'datos');
    } else if (d.comprobanteValidadoAt && !(d.guiaEnvio && d.guiaEnvio.guia)) {
        // 1 y 4: "pagó" = mandó COMPROBANTE VÁLIDO (comprobanteValidadoAt). OJO: NO usamos el estatus
        // 'Pagado' como señal de pago porque en este CRM 'Pagado' es un estado donde se ACUMULAN miles
        // de pedidos ya terminados; usarlo inundaba la lista. Si ya tiene guía de envío, el diseño ya
        // se hizo y se envió -> tampoco es pendiente. Con comprobante, sin guía y sin preview ->
        // anticipo; si ya le mandamos su preview -> mockup pagado.
        reasons.push(d.previewEnviadoAt ? 'mockup_pagado' : 'anticipo');
    }
    // 5: puede coexistir con cualquiera de las anteriores.
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

module.exports = { recomputeForContact, recomputeForOrder, markPreviewSent, reasonsForOrderData, REASONS, DONE };
