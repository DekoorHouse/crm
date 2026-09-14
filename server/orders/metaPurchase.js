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
    const motivo = p.metaPurchaseResolution || noAplicaMotivo(p.metaPurchaseManual);
    return {
        metaPurchaseSentAt: motivo ? null : iso(p.metaPurchaseSentAt),
        metaPurchaseResolvedAt: iso(p.metaPurchaseResolvedAt || p.metaPurchaseSentAt),
        metaPurchaseNoAplica: !!motivo,
        metaPurchaseMotivo: motivo || null,
        metaPurchaseRejectedAt: isPurchaseResolved(p) ? null : iso(p.metaPurchaseRejectedAt),
        metaPurchaseNeedsReviewAt: isPurchaseResolved(p) ? null : iso(p.metaPurchaseNeedsReviewAt || p.metaPurchaseRejectedAt),
        metaPurchaseError: p.metaPurchaseReviewReason || p.metaPurchaseRejectionReason || p.metaPurchaseLastError || null,
    };
}

function isPurchaseResolved(p) {
    return !!(p.metaPurchaseSentAt || p.metaPurchaseResolvedAt);
}

function purchaseNeedsReview(p) {
    return !isPurchaseResolved(p) && !!(p.metaPurchaseNeedsReviewAt || p.metaPurchaseRejectedAt);
}

// No confundir falta de ctwa_clid/IG_BUSINESS_ID con origen orgánico:
// cualquier señal publicitaria conocida conserva la compra pendiente para corregirla.
function hasPurchaseAdSignal(order, contact, referral) {
    if (order.attributedAdId || order.leadSource === 'ad') return true;
    const refs = [referral, contact.adReferral, ...(Array.isArray(contact.adReferralHistory) ? contact.adReferralHistory : [])];
    return refs.some(r => r && (r.ctwa_clid || r.ad_id || r.source_id || r.source_type === 'ad'));
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
    if (automatic && force) return { status: 400, success: false, message: 'El envío automático no puede aprobar una revisión manual.' };
    const ref = db.collection('pedidos').doc(docId.trim());
    const token = randomUUID();
    const claim = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { result: { status: 404, success: false, message: 'El pedido no existe.' } };
        const p = snap.data();
        if (isPurchaseResolved(p)) return { result: { success: true, already: true, ...purchaseState(p) } };
        if (purchaseNeedsReview(p) && !force) return { result: {
            status: 409, success: false, needsReview: true, rechazado: !!p.metaPurchaseRejectedAt, ...purchaseState(p),
            message: purchaseState(p).metaPurchaseError || 'No se pudo reportar la compra. Requiere revisión manual.',
        } };
        if (force && !purchaseNeedsReview(p)) return { result: {
            status: 409, success: false, message: 'Solo se puede marcar como revisada una compra con un error que requiere revisión manual.',
        } };
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
            if (snap.exists && isPurchaseResolved(snap.data())) return { success: true, already: true, ...purchaseState(snap.data()) };
            if (!snap.exists || snap.data().metaPurchaseLeaseToken !== token) {
                return { status: 202, success: false, inProgress: true, retryAfterMs: LEASE_MS, message: 'El pedido cambió durante el envío. Se comprobará de nuevo.' };
            }
            tx.update(ref, {
                metaPurchaseLeaseToken: admin.firestore.FieldValue.delete(),
                metaPurchaseLeaseUntil: admin.firestore.FieldValue.delete(),
                metaPurchaseNextAttemptAt: result.success || result.needsReview ? admin.firestore.FieldValue.delete() : admin.firestore.Timestamp.fromMillis(Date.now() + RETRY_MS),
                metaPurchaseLastError: result.success ? admin.firestore.FieldValue.delete() : result.message,
                ...fields,
            });
        });
        if (current) return current;
        return { ...result, ...(!result.success && !result.needsReview ? { retryAfterMs: RETRY_MS } : {}) };
    }

    // Un error de datos/configuración bloquea antes de llegar a Meta. También requiere
    // revisión, pero no se registra como un rechazo de Meta ni como una compra enviada.
    function finishNeedsReview(message, status, rechazado = false) {
        return finish({
            status, success: false, needsReview: true, rechazado, message,
            metaPurchaseNeedsReviewAt: new Date().toISOString(), metaPurchaseError: message,
            ...(rechazado ? { metaPurchaseRejectedAt: new Date().toISOString() } : {}),
        }, {
            metaPurchaseNeedsReviewAt: admin.firestore.FieldValue.serverTimestamp(),
            metaPurchaseReviewReason: message,
            ...(rechazado ? {
                metaPurchaseRejectedAt: admin.firestore.FieldValue.serverTimestamp(),
                metaPurchaseRejectionReason: message,
            } : {}),
        });
    }

    try {
        if (force) {
            return await finish({
                success: true, noAplica: true, metaPurchaseSentAt: null, metaPurchaseResolvedAt: new Date().toISOString(),
                metaPurchaseNoAplica: true, metaPurchaseMotivo: 'revisado',
                message: `${orderNumber} revisado y marcado en verde. La revisión no envía un evento a Meta.`,
            }, {
                metaPurchaseResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
                metaPurchaseReviewedAt: admin.firestore.FieldValue.serverTimestamp(),
                metaPurchaseResolution: 'revisado', metaPurchaseSource: source,
            });
        }
        if (!p.contactId) return await finishNeedsReview(`${orderNumber} no tiene contacto ligado.`, 400);
        const contactSnap = await db.collection('contacts_whatsapp').doc(p.contactId).get();
        if (!contactSnap.exists) return await finishNeedsReview(`El contacto de ${orderNumber} ya no existe.`, 404);
        // Requerimiento perezoso para compartir este servicio con services.js sin ciclo de carga.
        const { messagingContactInfo, pickAdReferralForConversion, resolveMessagingIdentity, sendConversionEvent } = require('../services');
        const contact = contactSnap.data();
        const eventInfo = messagingContactInfo(contact);
        if (!eventInfo.wa_id && !eventInfo.psid && !eventInfo.igsid) {
            return await finishNeedsReview(`${orderNumber}: el contacto no tiene identificador de mensajería.`, 400);
        }
        const referral = pickAdReferralForConversion(contact, { attributedAdId: p.attributedAdId, before: p.createdAt });
        if (!hasPurchaseAdSignal(p, contact, referral)) {
            return await finish({
                success: true, noAplica: true, metaPurchaseSentAt: null,
                metaPurchaseResolvedAt: new Date().toISOString(),
                metaPurchaseNoAplica: true, metaPurchaseMotivo: 'organico',
                message: `${orderNumber} marcado como orgánico. No se envió Purchase a Meta.`,
            }, {
                metaPurchaseResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
                metaPurchaseResolution: 'organico', metaPurchaseSource: source,
            });
        }
        const identity = resolveMessagingIdentity(eventInfo, referral, 'Purchase');
        if (!identity) return await finishNeedsReview(`${orderNumber}: hay señal de anuncio, pero falta el identificador de atribución o la configuración del canal. No se marcó como orgánico.`, 503);
        const value = Number(p.precio);
        if (!Number.isFinite(value) || value <= 0) return await finishNeedsReview(`${orderNumber} no tiene un importe de compra válido.`, 400);

        const result = await sendConversionEvent('Purchase', eventInfo, referral, { value, currency: 'MXN' }, { eventId: `Purchase_pedido_${ref.id}` });
        if (!result || !result.sent) {
            if (result?.needsReview) return await finishNeedsReview(`${orderNumber}: ${result.reason}.`, 503);
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
        if (error.metaRejected) return finishNeedsReview(error.message, 409, true);
        return finish({
            status: 502, success: false, rechazado: false,
            message: `No se pudo reportar la compra de ${orderNumber}: ${error.message}`,
        });
    }
}

module.exports = { sendOrderPurchase, noAplicaMotivo, purchaseState, isPurchaseResolved, purchaseNeedsReview, isAutomaticPurchaseEligible };
