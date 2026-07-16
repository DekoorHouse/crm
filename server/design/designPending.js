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
    'cancelado', 'entregado', 'devolución', 'devolucion', 'mns amenazador',
]);

const REASONS = ['mockup', 'fabricar', 'datos', 'video', 'segundo_producto'];

// Evalúa los motivos de "pendiente de diseño" sobre los datos de UN pedido (puede ser []).
// hasMockup (opcional): si el caller ya consultó mockup_previews, lo pasa para no depender de la marca.
function reasonsForOrderData(d, hasMockup) {
    if (!d) return [];
    // Marcado a mano como "ya diseñado" desde el tablero (botón ✓ Diseñado) -> fuera de pendientes.
    if (d.disenoListoAt) return [];
    const estatus = String(d.estatus || 'Sin estatus').trim().toLowerCase();
    if (DONE.has(estatus)) return [];

    // Envío ya gestionado (tiene guía o lo quitaron de Envíos) -> el diseño ya se hizo (no aplica a Corregir).
    const shipped = (d.guiaEnvio && d.guiaEnvio.guia) || d.ocultoDeEnvios;
    const reasons = [];

    if (estatus === 'corregir') {
        // Corrección pedida por el cliente (siempre pendiente, aunque ya se hubiera enviado). El motivo
        // lo persiste markOrderCorregirForContact.
        reasons.push(String(d.corregirMotivo || '').toLowerCase() === 'video' ? 'video' : 'datos');
    } else if (!shipped) {
        if (estatus === 'fabricar') {
            // ETAPA 2: pagó y hay que producir -> falta el diseño en Corel para corte (aunque tenga mockup).
            reasons.push('fabricar');
        } else if (estatus === 'sin estatus' && !d.mockupHidden && !d.mockupPreviewAt && !hasMockup) {
            // ETAPA 1: aún sin mockup (no se pudo hacer en la sección Mockup) -> falta el mockup.
            // hasMockup viene de consultar mockup_previews (fuente de verdad, por si falta la marca).
            reasons.push('mockup');
        }
    }
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

module.exports = { recomputeForContact, recomputeForOrder, markPreviewSent, reasonsForOrderData, orderHasMockup, REASONS, DONE };
