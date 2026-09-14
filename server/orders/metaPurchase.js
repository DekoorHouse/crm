const { randomUUID } = require('crypto');
const { db, admin } = require('../config');

const RETRY_MS = 5 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;
const millis = t => t && t.toMillis ? t.toMillis() : (Date.parse(t) || 0);
const iso = t => t && t.toDate ? t.toDate().toISOString() : (t || null);

function noAplicaMotivo(marca) {
    if (typeof marca !== 'string' || !marca.startsWith('no_aplica')) return null;
    return marca === 'no_aplica_rechazado' ? 'rechazado' : 'organico';
}

function purchaseState(p) {
    return {
        metaPurchaseSentAt: iso(p.metaPurchaseSentAt),
        metaPurchaseNoAplica: !!noAplicaMotivo(p.metaPurchaseManual),
        metaPurchaseMotivo: noAplicaMotivo(p.metaPurchaseManual),
    };
}

function isAutomaticPurchaseEligible(p) {
    return !!p.comprobanteValidadoAt && !p.ocultoDeEnvios
        && !/cancel|devuelt|devol|reembols/i.test(p.estatus || '');
}

// Todos los envíos por pedido comparten la reserva: Envíos, registro y Fabricar.
// La llamada a Meta queda FUERA de la transacción (Firestore puede repetir su callback).
async function sendOrderPurchase(docId, { source = 'envios_manual', force = false } = {}) {
    if (typeof docId !== 'string' || !docId.trim() || docId.includes('/')) {
        return { status: 400, success: false, message: 'Falta un docId válido.' };
    }
    const automatic = source === 'envios_auto' || source === 'envios_scheduler';
    if (automatic && force) return { status: 400, success: false, message: 'El envío automático no puede marcar no aplica.' };
    const ref = db.collection('pedidos').doc(docId.trim());
    const token = randomUUID();
    const claim = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { result: { status: 404, success: false, message: 'El pedido no existe.' } };
        const p = snap.data();
        if (p.metaPurchaseSentAt) return { result: { success: true, already: true, ...purchaseState(p) } };
        // Una línea manual sin pago validado, un anticipo o una reposición sin pago no
        // deben convertirse automáticamente en ventas por el simple hecho de aparecer aquí.
        if (automatic && !isAutomaticPurchaseEligible(p)) {
            return { result: { success: false, skipped: true, message: 'El pedido no tiene un pago validado vigente en Envíos.' } };
        }
        const now = Date.now();
        const lockedUntil = millis(p.metaPurchaseLeaseUntil);
        if (lockedUntil > now) {
            return { result: { status: 202, success: false, inProgress: true, retryAfterMs: lockedUntil - now, message: 'La compra se está enviando a Meta.' } };
        }
        const retryAt = millis(p.metaPurchaseNextAttemptAt);
        if (automatic && retryAt > now) {
            return { result: { success: false, deferred: true, retryAfterMs: retryAt - now, message: p.metaPurchaseLastError || 'Pendiente de reintento automático.' } };
        }
        tx.update(ref, {
            metaPurchaseLeaseToken: token,
            metaPurchaseLeaseUntil: admin.firestore.Timestamp.fromMillis(now + LEASE_MS),
        });
        return { order: p };
    });
    if (claim.result) return claim.result;
    const p = claim.order;
    const orderNumber = p.consecutiveOrderNumber != null ? `DH${p.consecutiveOrderNumber}` : ref.id;

    async function finish(result, fields = {}) {
        const current = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (snap.exists && snap.data().metaPurchaseSentAt) return { success: true, already: true, ...purchaseState(snap.data()) };
            if (!snap.exists || snap.data().metaPurchaseLeaseToken !== token) {
                return { status: 202, success: false, inProgress: true, retryAfterMs: LEASE_MS, message: 'El pedido cambió durante el envío. Se comprobará de nuevo.' };
            }
            tx.update(ref, {
                metaPurchaseLeaseToken: admin.firestore.FieldValue.delete(),
                metaPurchaseLeaseUntil: admin.firestore.FieldValue.delete(),
                metaPurchaseNextAttemptAt: result.success ? admin.firestore.FieldValue.delete() : admin.firestore.Timestamp.fromMillis(Date.now() + RETRY_MS),
                metaPurchaseLastError: result.success ? admin.firestore.FieldValue.delete() : result.message,
                ...fields,
            });
        });
        if (current) return current;
        return { ...result, ...(!result.success ? { retryAfterMs: RETRY_MS } : {}) };
    }

    try {
        if (!p.contactId) return await finish({ status: 400, success: false, message: `${orderNumber} no tiene contacto ligado.` });
        const contactSnap = await db.collection('contacts_whatsapp').doc(p.contactId).get();
        if (!contactSnap.exists) return await finish({ status: 404, success: false, message: `El contacto de ${orderNumber} ya no existe.` });
        // Requerimiento perezoso para compartir este servicio con services.js sin ciclo de carga.
        const { messagingContactInfo, pickAdReferralForConversion, resolveMessagingIdentity, sendConversionEvent } = require('../services');
        const contact = contactSnap.data();
        const eventInfo = messagingContactInfo(contact);
        if (!eventInfo.wa_id && !eventInfo.psid && !eventInfo.igsid) {
            return await finish({ status: 400, success: false, message: `${orderNumber}: el contacto no tiene identificador de mensajería.` });
        }
        const referral = pickAdReferralForConversion(contact, { attributedAdId: p.attributedAdId, before: p.createdAt });
        const identity = resolveMessagingIdentity(eventInfo, referral, 'Purchase');
        if (force) {
            const motivo = identity ? 'rechazado' : 'organico';
            return await finish({
                success: true, noAplica: true, metaPurchaseSentAt: new Date().toISOString(),
                metaPurchaseNoAplica: true, metaPurchaseMotivo: motivo,
                message: `${orderNumber} marcado como no aplica: la compra no se reportó a Meta.`,
            }, { metaPurchaseSentAt: admin.firestore.FieldValue.serverTimestamp(), metaPurchaseManual: `no_aplica_${motivo}` });
        }
        if (!identity) return await finish({ status: 409, success: false, organico: true, message: `${orderNumber}: no hay señal de anuncio o configuración de canal para atribuir la compra a Meta.` });
        const value = Number(p.precio);
        if (!Number.isFinite(value) || value <= 0) return await finish({ status: 400, success: false, message: `${orderNumber} no tiene un importe de compra válido.` });

        const result = await sendConversionEvent('Purchase', eventInfo, referral, { value, currency: 'MXN' }, { eventId: `Purchase_pedido_${ref.id}` });
        if (!result || !result.sent) {
            return await finish({ status: 503, success: false, message: `${orderNumber}: no se confirmó la recepción en Meta (${result?.reason || 'sin confirmación'}).` });
        }
        const response = await finish({
            success: true, metaPurchaseSentAt: new Date().toISOString(), valor: value, canal: identity.messagingChannel,
            message: `Compra de ${orderNumber} enviada a Meta ($${value.toLocaleString('es-MX')} MXN).`,
        }, {
            metaPurchaseSentAt: admin.firestore.FieldValue.serverTimestamp(),
            metaPurchaseManual: source === 'envios_manual',
            metaPurchaseSource: source,
        });
        console.log(`[META EVENT] Purchase enviado (${source}), pedido ${orderNumber}, valor $${value}`);
        return response;
    } catch (error) {
        console.warn(`[META EVENT] Purchase pendiente (${source}), pedido ${orderNumber}:`, error.message);
        return finish({
            status: error.metaRejected ? 409 : 502, success: false, rechazado: !!error.metaRejected,
            message: `No se pudo reportar la compra de ${orderNumber}: ${error.message}`,
        });
    }
}

module.exports = { sendOrderPurchase, noAplicaMotivo, isAutomaticPurchaseEligible };
