const { db, admin } = require('../config');
const { DAY, ms, hash, cents, terminal, cancelled, receiptKeys, receiptKeyMatches, validateReceipt, paymentDecision, reportedPaymentCents, canRequestShippingForm, awaitingPaymentApproval } = require('./paymentPolicy');
const stamp = () => admin.firestore.FieldValue.serverTimestamp();
const date = n => admin.firestore.Timestamp.fromMillis(n);
const receipts = () => db.collection('payment_receipts');
const services = () => require('../services');
const LEASE_MS = 3 * 60000;
const { sameReceipt, matchesAlert, resolution, mergeReviewRows } = require('./receiptReviewQueue');
const { receiptReviewState, checkManualReview } = require('./receiptSafety');
const { OUTCOME_VERSION } = require('./receiptOutcome');
const { rejectFailedReceipt } = require('./failedReceiptWorkflow');

// Actualización puntual del OCR antiguo: sólo identidad de origen, nunca saldos
// ni el resultado de un pago ya aplicado. La lectura externa queda fuera del tx.
async function refreshSourceIdentity(ref) {
    const before = (await ref.get()).data();
    if (!before?.ocr || before.ocr.sourceIdentityVersion === 1 || !before.fileUrl) return before?.ocr;
    const reading = await services().extractReceiptData(before.fileUrl, before.fileType);
    if (before.ocr.imageHash && reading.imageHash !== before.ocr.imageHash) throw new Error('La imagen del comprobante cambió; revisa el archivo antes de validar.');
    return db.runTransaction(async tx => {
        const fresh = (await tx.get(ref)).data();
        if (!fresh?.ocr || fresh.fileUrl !== before.fileUrl || fresh.ocr.imageHash !== before.ocr.imageHash) throw new Error('El comprobante cambió. Actualiza la lista.');
        if (fresh.ocr.sourceIdentityVersion === 1) return fresh.ocr;
        const ocr = { ...fresh.ocr, cuentaOrigen: reading.cuentaOrigen || null, sourceIdentityVersion: 1 };
        tx.update(ref, { ocr, updatedAt: stamp() });
        return ocr;
    });
}

async function refreshSourceOwners(ocr) {
    if (!ocr?.cuentaOrigen) return;
    const owners = new Set();
    for (const key of receiptKeys(ocr).filter(key => !key.startsWith('image_'))) {
        const value = (await db.collection('payment_receipt_keys').doc(key).get()).data();
        if (value?.receiptId) owners.add(value.receiptId);
    }
    for (const id of owners) await refreshSourceIdentity(receipts().doc(id));
}

async function readCreditedKeys(tx, keys) {
    const credited = new Map(), owners = new Map();
    for (const key of keys) {
        const snap = await tx.get(db.collection('payment_receipt_keys').doc(key));
        if (!snap.exists) continue;
        const value = snap.data();
        let identity = value.identity;
        // Índices antiguos: consultar su comprobante dentro de la misma transacción.
        // Si falta, conservar el bloqueo; no asumir que una referencia es distinta.
        if ((!identity || identity.sourceIdentityVersion !== 1) && !key.startsWith('image_') && value.receiptId) {
            if (!owners.has(value.receiptId)) owners.set(value.receiptId, (await tx.get(receipts().doc(value.receiptId))).data()?.ocr);
            identity = { ...owners.get(value.receiptId), ...identity,
                cuentaOrigen: owners.get(value.receiptId)?.cuentaOrigen || identity?.cuentaOrigen || null };
        }
        credited.set(key, { ...value, identity });
    }
    return credited;
}

// Vista previa sin acreditar dinero ni enviar mensajes. Archiva intentos fallidos.
async function previewReceiptReview(id, { amount, orderId } = {}) {
    if (!Number.isFinite(Number(amount)) || !(Number(amount) > 0)) throw new Error('Confirma un importe válido.');
    const ref = receipts().doc(id);
    let receipt = (await ref.get()).data();
    if (!receipt?.open || ms(receipt.leaseUntil) > Date.now()) throw new Error('El comprobante ya se resolvió o se está procesando. Actualiza la lista.');
    if (!receipt.fileUrl && !receipt.ocr) receipt = await require('./receiptMedia').recoverReceiptMedia(ref);
    if (!receipt.ocr || (receipt.ocr.pagoRealizado === false && receipt.ocr.outcomeVersion !== OUTCOME_VERSION)) {
        if (!receipt.fileUrl) throw new Error(receipt.reason || 'No hay imagen del comprobante para revisar.');
        const reading = await services().extractReceiptData(receipt.fileUrl, receipt.fileType);
        const ocr = receipt.ocr?.pagoRealizado === false && reading.pagoRealizado !== false
            ? { ...receipt.ocr, estadoOperacion: 'desconocido', evidenciaEstado: reading.evidenciaEstado || '', outcomeVersion: OUTCOME_VERSION }
            : reading;
        await db.runTransaction(async tx => {
            const fresh = (await tx.get(ref)).data();
            if (!fresh?.open || ms(fresh.leaseUntil) > Date.now()) throw new Error('El comprobante cambió. Actualiza la lista.');
            if (fresh.fileUrl !== receipt.fileUrl) throw new Error('El comprobante cambió. Actualiza la lista.');
            tx.update(ref, { ocr, updatedAt: stamp() });
        });
    }
    const sourceOcr = await refreshSourceIdentity(ref);
    await refreshSourceOwners(sourceOcr);
    const checked = (await ref.get()).data();
    const failed = await rejectFailedReceipt(ref, checked.ocr || {});
    if (failed) throw new Error('Este ticket corresponde a una operación fallida. Se retiró de los comprobantes por revisar sin registrar dinero.');
    return db.runTransaction(async tx => {
        receipt = (await tx.get(ref)).data();
        if (!receipt?.open || ms(receipt.leaseUntil) > Date.now()) throw new Error('El comprobante ya se resolvió o se está procesando. Actualiza la lista.');
        const selected = orderId || receipt.orderId;
        if (!selected || (receipt.orderId && selected !== receipt.orderId)) throw new Error('Selecciona el pedido correcto de este contacto.');
        const order = (await tx.get(db.collection('pedidos').doc(selected))).data();
        if (!order || order.contactId !== receipt.contactId) throw new Error('El pedido no pertenece a este contacto.');
        const related = await tx.get(receipts().where('contactId', '==', receipt.contactId));
        return receiptReviewState(order, { ...receipt, id, orderId: selected }, related.docs.map(d => ({ ...d.data(), id: d.id })), amount);
    });
}

async function ordersForContact(contactId) {
    const snap = await db.collection('pedidos').where('contactId', '==', contactId).get();
    return snap.docs.sort((a, b) => ms(b.data().createdAt) - ms(a.data().createdAt));
}

async function enqueueReceipt(contactId, messageId, message, { historical = false, orderId = null, knownOrders = null } = {}) {
    if (message.from !== contactId || !['image', 'document'].includes(message.type)) return null;
    if (message.type === 'document' && !/pdf/i.test(message.fileType || '')) return null;
    const id = hash(contactId + '|' + (message.id || messageId));
    const ref = receipts().doc(id);
    // Un registro existente conserva su decisión, incluso si hoy el contacto
    // tiene otros pedidos. Recuperar el chat nunca lo reasigna ni lo reabre.
    const existing = (await ref.get()).data();
    if (existing?.orderId || (existing && !existing.open)) return id;
    const orders = knownOrders || await ordersForContact(contactId);
    const inPeriod = d => ms(d.data().createdAt) >= ms(message.timestamp) - 45 * DAY
        && ms(d.data().createdAt) <= ms(message.timestamp) + 2 * DAY;
    // Los pagos anteriores al registro durable también cuentan como posible
    // propietario. No reciclar sus imágenes para otro pedido al volver al chat.
    if (historical && orders.some(d => inPeriod(d) && (d.data().comprobanteValidadoAt || d.data().guiaEnvio?.guia || terminal(d.data()))
        && (!d.data().comprobanteValidadoAt || ms(message.timestamp) <= ms(d.data().comprobanteValidadoAt)))) return null;
    const candidates = orders.filter(d => !terminal(d.data()) && !d.data().comprobanteValidadoAt
        && !(historical && cancelled(d.data())) && (inPeriod(d)
            || (ms(d.data().createdAt) > ms(message.timestamp) && ms(d.data().createdAt) <= ms(message.timestamp) + 45 * DAY)));
    if (orderId && !candidates.some(d => d.id === orderId)) return null;
    const order = orderId ? candidates.find(d => d.id === orderId) : candidates.length === 1 ? candidates[0] : null;
    // Guardar también los adjuntos recibidos antes del DH. El OCR descarta fotos
    // normales; un comprobante sin propietario queda visible para revisión.
    if (!candidates.length && historical) return existing ? id : null;
    const beforeRegistration = order && ms(message.timestamp) + 2 * DAY < ms(order.data().createdAt);
    if (existing) {
        if (order) await db.runTransaction(async tx => {
            const fresh = (await tx.get(ref)).data();
            if (!fresh?.open || fresh.orderId || ms(fresh.leaseUntil) > Date.now()) return;
            tx.update(ref, { orderId: order.id, orderNumber: `DH${order.data().consecutiveOrderNumber}`,
                status: 'pending', associationNeedsReview: true, nextAttemptAt: stamp(), updatedAt: stamp(),
                reason: 'Comprobante anterior al registro: confirmar que corresponde a esta compra.' });
        });
        return id;
    }
    const value = { contactId, messageId, orderId: order?.id || null,
        orderNumber: order ? `DH${order.data().consecutiveOrderNumber}` : null,
        receivedAt: message.timestamp, createdAt: stamp(), updatedAt: stamp(), status: 'pending', open: true,
        attempts: 0, nextAttemptAt: date(Date.now() + (historical ? 0 : 25000)), historical,
        associationNeedsReview: !!beforeRegistration,
        fileUrl: message.fileUrl || null, fileType: message.fileType || null,
        whatsappMediaId: message.whatsappMediaId || null, mediaProxyUrl: message.mediaProxyUrl || null,
        reason: order ? 'Comprobante pendiente de revisión.' : 'Hay varios pedidos: seleccionar el pedido correcto.',
    };
    try { await ref.create(value); }
    catch (error) { if (error.code !== 6 && !/already exist/i.test(error.message)) throw error; }
    return id;
}

async function discoverReceipts(contactId, { orderId = null } = {}) {
    const messages = await db.collection('contacts_whatsapp').doc(contactId).collection('messages')
        .orderBy('timestamp', 'desc').limit(100).get();
    const ids = [], knownOrders = await ordersForContact(contactId);
    const contact = (await db.collection('contacts_whatsapp').doc(contactId).get()).data();
    const newOrderSince = ms(contact?.paymentNewOrderRequestedAt);
    // Los anticipos persistidos no dependen de seguir dentro de los últimos 100 mensajes.
    const saved = await receipts().where('contactId', '==', contactId).get();
    for (const r of saved.docs) {
        const data = r.data();
        if (!data.open || data.orderId || (newOrderSince && ms(data.receivedAt) < newOrderSince)) continue;
        const id = await enqueueReceipt(contactId, data.messageId, { ...data, id: data.messageId,
            from: contactId, type: /pdf/i.test(data.fileType || '') ? 'document' : 'image', timestamp: data.receivedAt },
        { historical: true, orderId, knownOrders });
        if (id) ids.push(id);
    }
    for (const m of [...messages.docs].reverse()) {
        if (ms(m.data().timestamp) < Date.now() - 45 * DAY) continue;
        if (newOrderSince && ms(m.data().timestamp) < newOrderSince) continue;
        const id = await enqueueReceipt(contactId, m.id, m.data(), { historical: true, orderId, knownOrders });
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

async function reviewReceipt(ref, reason, extra = {}) {
    return db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (!current || ['applied', 'duplicate', 'ignored', 'rejected'].includes(current.status)) return { status: current?.status || 'missing' };
        const orderRef = current.orderId ? db.collection('pedidos').doc(current.orderId) : null;
        const order = orderRef ? await tx.get(orderRef) : null;
        tx.update(ref, { status: 'review', open: true, reason, leaseUntil: null, updatedAt: stamp(), ...extra });
        if (order?.exists) tx.update(orderRef, { paymentFormNeedsAssessment: true });
        return { status: 'review', reason };
    });
}

async function creditReceipt(ref, receipt, { manual = false, amount = null, reactivate = false, verification = {} } = {}) {
    const keys = receiptKeys(receipt);
    return db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const r = snap.data();
        if (!r || ['applied', 'duplicate', 'ignored', 'rejected'].includes(r.status)) return { status: r?.status || 'missing', orderId: r?.orderId };
        if (!r.orderId) return { status: 'review', reason: 'Selecciona un pedido antes de validar.' };
        const orderRef = db.collection('pedidos').doc(r.orderId);
        const os = await tx.get(orderRef);
        if (!os.exists || os.data().contactId !== r.contactId) return { status: 'review', reason: 'El pedido no pertenece a este contacto.' };
        const order = os.data();
        if (terminal(order)) return { status: 'review', reason: 'El pedido ya está entregado o devuelto.' };
        if (cancelled(order) && !(order.canceladoPorCobranza === true || (manual && reactivate))) {
            return { status: 'review', reason: 'Pago en pedido cancelado: confirmar su reactivación.' };
        }
        const existing = await readCreditedKeys(tx, keys);
        const matching = [...existing].filter(([key, value]) => receiptKeyMatches(key, receipt, value.identity)).map(([, value]) => value);
        const contactRef = db.collection('contacts_whatsapp').doc(r.contactId);
        const contact = manual ? (await tx.get(contactRef)).data() : null;
        const related = await tx.get(receipts().where('contactId', '==', r.contactId));
        const copies = related.docs.filter(other => other.id !== ref.id && other.data().open && sameReceipt(r, other.data()));
        const affectedOrders = [];
        for (const id of new Set(copies.map(d => d.data().orderId).filter(id => id && id !== r.orderId))) {
            affectedOrders.push(await tx.get(db.collection('pedidos').doc(id)));
        }
        const closeRelated = () => {
            for (const other of copies) {
                tx.update(other.ref, {
                    status: 'duplicate', open: false, reason: 'Este mismo comprobante ya fue revisado.', leaseUntil: null, updatedAt: stamp(),
                });
            }
            for (const other of affectedOrders) if (other.exists) tx.update(other.ref, { paymentFormNeedsAssessment: true });
            if (matchesAlert(contact, r)) tx.update(contactRef, { ...resolution('approved'), suspiciousReceiptResolvedBy: manual ? 'manual' : 'automatic' });
        };
        const conflict = matching.find(value => value.orderId !== r.orderId);
        if (conflict) return { status: 'review', reason: 'Este comprobante ya está aplicado a otro pedido. No se volvió a sumar.' };
        if (matching.length || order.comprobanteValidadoAt) {
            closeRelated();
            tx.update(ref, { status: 'duplicate', open: false, reason: 'Pago ya registrado; no se vuelve a sumar.', leaseUntil: null, updatedAt: stamp() });
            return { status: 'duplicate', orderId: r.orderId };
        }
        if (!keys.length) return { status: 'review', reason: 'No se pudo identificar el comprobante para evitar duplicados.' };
        const safety = receiptReviewState(order, { ...r, ocr: receipt, id: ref.id }, related.docs.map(d => ({ ...d.data(), id: d.id })), manual ? amount : receipt.monto);
        if (manual) {
            const reason = checkManualReview(safety, verification);
            if (reason) return { status: 'review', reason, risks: safety.risks };
        } else if (safety.risks.some(risk => risk.code === 'possible_duplicate')) {
            return { status: 'review', reason: 'Posible comprobante repetido: verificar que sea otro ingreso antes de sumarlo.', risks: safety.risks };
        }
        const decision = paymentDecision(order, cents(manual ? amount : receipt.monto), manual);
        if (decision.status === 'review') return decision;
        const fields = { paymentReceivedCents: decision.receivedCents, paymentUpdatedAt: stamp(), paymentFormNeedsAssessment: true, paymentProductionPending: true };
        if (decision.status === 'paid') {
            Object.assign(fields, { comprobanteValidadoAt: stamp(), paymentValidatedBy: manual ? 'manual' : 'receipt' });
            if (!order.shippingFormStatus && !order.shippingFormSentAt) Object.assign(fields, { shippingFormStatus: 'pending', shippingFormNextAttemptAt: stamp(), shippingFormReason: 'Pago validado; formulario pendiente.' });
            if (cancelled(order)) Object.assign(fields, { estatus: 'Pagado', paymentReactivatedAt: stamp(), paymentPreviousStatus: order.estatus });
        }
        // Nunca sobrescribir la referencia compartida que pertenece al otro ingreso.
        // Cada pago conserva además su imagen y su clave de rastreo propias.
        for (const key of keys) if (!existing.has(key)) tx.set(db.collection('payment_receipt_keys').doc(key), {
            orderId: r.orderId, receiptId: ref.id, amountCents: cents(manual ? amount : receipt.monto), createdAt: stamp(),
            identity: { claveRastreo: receipt.claveRastreo || null, cuentaOrigen: receipt.cuentaOrigen || null,
                sourceIdentityVersion: receipt.sourceIdentityVersion || null },
        });
        tx.update(orderRef, fields);
        closeRelated();
        tx.update(ref, { status: 'applied', open: false, result: decision.status, amountCents: cents(manual ? amount : receipt.monto), reviewedBy: manual ? 'manual' : 'automatic', reason: decision.status === 'paid' ? 'Pago completo registrado.' : 'Abono registrado; falta liquidar el total.', leaseUntil: null, updatedAt: stamp(),
            ...(manual ? { manualVerification: { safetyToken: safety.safetyToken, previousReceivedCents: safety.receivedCents,
                confirmedRisks: safety.risks.map(risk => risk.code), bankVerified: verification.bankVerified === true,
                bankEvidence: String(verification.bankEvidence || '').trim().slice(0, 1000), reviewedAt: stamp() } } : {}) });
        return { ...decision, orderId: r.orderId, contactId: r.contactId };
    });
}

async function processReceipt(id, options = {}) {
    if (options.manual && !options.verification?.safetyToken) return { status: 'review', reason: 'Abre la revisión del comprobante y confirma el saldo antes de aprobar.' };
    const ref = receipts().doc(id);
    const claimed = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const r = snap.data();
        if (!options.manual && (!['pending', 'processing'].includes(r.status) || ms(r.leaseUntil) > Date.now() || (!options.immediate && ms(r.nextAttemptAt) > Date.now()))) return null;
        if (options.manual && ['applied', 'duplicate', 'ignored', 'rejected'].includes(r.status)) return null;
        if (ms(r.leaseUntil) > Date.now()) return null;
        if (options.orderId && r.orderId && r.orderId !== options.orderId) return null;
        const binding = options.orderId ? { orderId: options.orderId, orderNumber: options.orderNumber } : {};
        tx.update(ref, { ...binding, status: 'processing', leaseUntil: date(Date.now() + LEASE_MS), attempts: (r.attempts || 0) + 1, updatedAt: stamp() });
        return { ...r, ...binding };
    });
    if (!claimed) return { status: 'unchanged' };
    try {
        let ocr = claimed.ocr;
        if (!ocr) {
            if (!claimed.fileUrl) {
                let recovered;
                try { recovered = await require('./receiptMedia').recoverReceiptMedia(ref); }
                catch (_) { return await reviewReceipt(ref, (await ref.get()).data()?.reason || 'Recuperando comprobante. Se reintentará automáticamente.'); }
                if (!recovered?.fileUrl) return await reviewReceipt(ref, recovered?.reason || 'No se pudo recuperar la imagen; solicita que reenvíen el comprobante.');
                claimed.fileUrl = recovered.fileUrl;
                claimed.fileType = recovered.fileType;
            }
            ocr = await services().extractReceiptData(claimed.fileUrl, claimed.fileType);
            await ref.update({ ocr, updatedAt: stamp() });
        }
        if (!options.manual && ocr.sourceIdentityVersion !== 1) ocr = await refreshSourceIdentity(ref) || ocr;
        await refreshSourceOwners(ocr);
        const failed = !claimed.verifiedProvider && await rejectFailedReceipt(ref, ocr, { processing: true });
        if (failed) return failed;
        if (!options.manual && ocr.esComprobante === false) {
            await ref.update({ status: 'ignored', open: false, reason: 'La imagen no es un comprobante de pago.', leaseUntil: null, updatedAt: stamp() });
            return { status: 'ignored' };
        }
        if (!claimed.orderId) return await reviewReceipt(ref, 'Comprobante sin pedido asignado: registrar o seleccionar el pedido correcto.');
        if (!options.manual && claimed.associationNeedsReview) return await reviewReceipt(ref, 'Anticipo anterior al registro: confirmar a qué compra corresponde antes de sumarlo.');
        const os = await db.collection('pedidos').doc(claimed.orderId).get();
        if (!os.exists) return await reviewReceipt(ref, 'El pedido ya no existe.');
        const check = validateReceipt(os.data(), ocr, claimed.receivedAt);
        if (!options.manual && check.status === 'ignored') {
            await ref.update({ status: 'ignored', open: false, reason: check.reason, leaseUntil: null, updatedAt: stamp() });
            return check;
        }
        if (!options.manual && !claimed.verifiedProvider && check.status === 'review') return await reviewReceipt(ref, check.reason);
        const result = await creditReceipt(ref, ocr, options);
        if (result.status === 'review') return await reviewReceipt(ref, result.reason, { reviewRisks: result.risks || [] });
        if (result.status === 'paid' || result.status === 'duplicate') {
            // El pago ya quedó comprometido; un fallo posterior sólo afecta al formulario.
            await deliverForm(result.orderId).catch(e => console.warn('[PAYMENTS] Formulario pendiente:', e.message));
        }
        if (result.status === 'paid') {
            await require('../leads/scheduledReminderScheduler').cancelReminderForContact(claimed.contactId, 'ya_pago').catch(() => {});
            await require('../design/designPending').recomputeForContact(claimed.contactId).catch(() => {});
        }
        return result;
    } catch (error) {
        const attempts = (claimed.attempts || 0) + 1;
        await db.runTransaction(async tx => {
            const current = (await tx.get(ref)).data();
            if (current?.status !== 'processing') return;
            const orderRef = current.orderId ? db.collection('pedidos').doc(current.orderId) : null;
            const order = orderRef ? await tx.get(orderRef) : null;
            tx.update(ref, { status: attempts >= 5 ? 'review' : 'pending', open: true, reason: 'No se pudo procesar el comprobante: ' + error.message.slice(0, 200), leaseUntil: null, nextAttemptAt: date(Date.now() + Math.min(attempts * 60000, 15 * 60000)), updatedAt: stamp() });
            if (order?.exists) tx.update(orderRef, { paymentFormNeedsAssessment: true });
        });
        return { status: 'review', reason: 'El comprobante sigue pendiente de revisión.' };
    } finally {
        if (claimed.orderId) await refreshReportedPayment(claimed.orderId).catch(e => console.warn('[PAYMENTS] Datos por solicitar:', e.message));
    }
}

async function refreshReportedPayment(orderId) {
    const ref = db.collection('pedidos').doc(orderId);
    await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const order = snap.data();
        const rs = await tx.get(receipts().where('orderId', '==', orderId));
        const jobs = rs.docs.map(d => d.data()).filter(r => r.contactId === order.contactId);
        const keys = [...new Set(jobs.flatMap(r => receiptKeys(r.ocr || {})))];
        const credited = await readCreditedKeys(tx, keys);
        const reported = reportedPaymentCents(order, jobs, credited);
        const complete = cents(order.precio) > 0 && reported >= cents(order.precio);
        const fields = { paymentReportedCents: reported, paymentReportedComplete: complete, paymentFormNeedsAssessment: false };
        if (complete && !terminal(order)) {
            if (!order.comprobanteValidadoAt) fields.shippingFormRequestedBeforeApproval = true;
            if (!order.shippingFormStatus && !order.shippingFormSentAt) Object.assign(fields, {
                shippingFormStatus: 'pending', shippingFormEligibleAt: stamp(), shippingFormNextAttemptAt: stamp(),
                shippingFormReason: 'Los comprobantes cubren el total; solicitar datos sin esperar la aprobación.',
            });
        }
        tx.update(ref, fields);
    });
    await require('./paymentProduction').reconcilePaymentProduction(orderId);
    return deliverForm(orderId);
}

async function recordShippingDataForOrder(orderNumber) {
    const num = Number(String(orderNumber).replace(/\D/g, ''));
    if (!num) return;
    const orders = await db.collection('pedidos').where('consecutiveOrderNumber', '==', num).limit(1).get();
    if (orders.empty) return;
    const ref = orders.docs[0].ref;
    await db.runTransaction(async tx => {
        const order = (await tx.get(ref)).data();
        if (!order) return;
        const fields = { shippingDataReceivedAt: stamp() };
        // Una dirección nunca acredita un pago, aunque provenga de un formulario antiguo.
        tx.update(ref, fields);
    });
    await require('./paymentProduction').reconcilePaymentProduction(ref.id);
}

async function deliverForm(orderId, { force = false } = {}) {
    if (!orderId) return { status: 'missing' };
    const orderRef = db.collection('pedidos').doc(orderId);
    const token = hash(orderId + Date.now() + Math.random());
    const claimed = await db.runTransaction(async tx => {
        const snap = await tx.get(orderRef);
        if (!snap.exists) return null;
        const order = snap.data();
        if (!canRequestShippingForm(order)) return null;
        if (!force && (!order.shippingFormStatus || order.shippingFormSentAt || ['sent', 'review'].includes(order.shippingFormStatus))) return null;
        if (ms(order.shippingFormLeaseUntil) > Date.now()) return null;
        if (!force && ms(order.shippingFormNextAttemptAt) > Date.now()) {
            const cd = order.contactId ? (await tx.get(db.collection('contacts_whatsapp').doc(order.contactId))).data() : null;
            if (!order.shippingFormWaitingForCustomer || Date.now() - ms(cd?.lastClientMsgAt) > DAY) return null;
        }
        tx.update(orderRef, { shippingFormStatus: 'sending', shippingFormWaitingForCustomer: false, shippingFormLeaseToken: token, shippingFormLeaseUntil: date(Date.now() + LEASE_MS), shippingFormAttemptAt: stamp() });
        return order;
    });
    if (!claimed) return { status: 'unchanged' };
    const contactId = claimed.contactId || claimed.telefono;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    const messageRef = contactRef.collection('messages').doc('payment_form_' + orderId + (force ? '_' + token : ''));
    let sending = false, acknowledged = false;
    try {
        const prior = await messageRef.get();
        const formData = await db.collection('datos_envio').where('numeroPedido', '==', `DH${claimed.consecutiveOrderNumber}`).limit(1).get();
        if (prior.exists || !formData.empty || claimed.guiaEnvio?.guia) {
            await orderRef.update({ shippingFormStatus: 'sent', shippingFormSentAt: prior.data()?.timestamp || stamp(), shippingFormReason: 'Formulario ya enviado o datos ya capturados.', shippingFormLeaseUntil: null });
            return { status: 'sent', already: true };
        }
        const cd = (await contactRef.get()).data() || {};
        // No usar mensajes libres fuera de la ventana del canal. Sigue visible hasta que se retome el chat.
        if (ms(cd.lastClientMsgAt) && Date.now() - ms(cd.lastClientMsgAt) > DAY) {
            await orderRef.update({ shippingFormStatus: 'retry', shippingFormWaitingForCustomer: true, shippingFormReason: 'Esperando que el cliente retome la conversación para enviar el formulario.', shippingFormNextAttemptAt: date(Date.now() + 3600000), shippingFormLeaseUntil: null });
            return { status: 'retry' };
        }
        const number = `DH${claimed.consecutiveOrderNumber}`;
        const base = (process.env.APP_BASE_URL || 'https://app.dekoormx.com').replace(/\/$/, '');
        const text = awaitingPaymentApproval(claimed)
            ? `¡Gracias por compartir tu comprobante de ${number}! 🙌\n\nPara adelantar tus datos de envío, llena este formulario 👇\n${base}/datos-estafeta/${number}\n\n📌 Usa una dirección donde haya alguien todo el día para recibir el paquete. Mientras tanto, el equipo revisará tu pago.`
            : `¡Gracias! 🙌 Ya validamos tu pago completo de ${number} ✅\n\nAhora llena tus datos de envío en este formulario 👇\n${base}/datos-estafeta/${number}\n\n📌 Usa una dirección donde haya alguien todo el día para recibir el paquete. En cuanto completes tus datos preparamos el envío 📦✨`;
        const channel = cd.channel || 'whatsapp';
        sending = true;
        const sent = channel === 'messenger' || channel === 'instagram'
            ? await services().sendMessengerMessage(cd.psid || cd.igsid || contactId.replace(/^(fb_|ig_)/, ''), { text, channel })
            : await services().sendAdvancedWhatsAppMessage(contactId, { text });
        const messageId = sent.id || sent.messages?.[0]?.id;
        if (!messageId) throw new Error('El canal no confirmó el identificador del mensaje.');
        acknowledged = true;
        const batch = db.batch();
        batch.set(messageRef, { from: process.env.PHONE_NUMBER_ID || 'system', status: 'sent', timestamp: stamp(), id: messageId, text, isAutoReply: true, channel, paymentFormOrderId: orderId });
        batch.update(orderRef, { shippingFormStatus: 'sent', shippingFormSentAt: stamp(), shippingFormMessageId: messageId, shippingFormReason: '', shippingFormLeaseUntil: null });
        batch.update(contactRef, { lastMessage: text.slice(0, 100), lastMessageTimestamp: stamp() });
        await batch.commit();
        return { status: 'sent' };
    } catch (error) {
        // Un timeout tras transmitir puede haber entregado el mensaje. No repetir a ciegas.
        const ambiguous = acknowledged || (sending && !error.response);
        const attempts = (claimed.shippingFormAttempts || 0) + 1;
        const status = ambiguous || attempts >= 5 ? 'review' : 'retry';
        await orderRef.update({ shippingFormStatus: status, shippingFormReason: ambiguous ? 'El envío pudo completarse: revisar el chat antes de reintentar.' : 'Falló el envío del formulario: ' + error.message.slice(0, 160), shippingFormAttempts: attempts, shippingFormLeaseUntil: null, shippingFormNextAttemptAt: date(Date.now() + attempts * 60000) });
        return { status, reason: error.message };
    }
}

// Compatibilidad con el botón manual existente; no se usa para aprobar pagos de la IA.
async function manualValidateAndSend(contactId, { orderNumber = null, force = false } = {}) {
    const orders = await ordersForContact(contactId);
    const num = Number(String(orderNumber || '').replace(/\D/g, ''));
    const candidates = orders.filter(d => !terminal(d.data()));
    const order = num ? candidates.find(d => Number(d.data().consecutiveOrderNumber) === num) : candidates.length === 1 ? candidates[0] : null;
    if (!order) throw new Error('Selecciona el pedido exacto para validar su pago.');
    if (!force && !order.data().comprobanteValidadoAt) throw new Error('El pago todavía requiere validación.');
    if (cancelled(order.data()) && !force) throw new Error('El pedido está cancelado.');
    const keepExistingForm = await db.runTransaction(async tx => {
        const fresh = (await tx.get(order.ref)).data();
        if (!fresh || terminal(fresh) || fresh.contactId !== contactId) throw new Error('El pedido cambió. Actualiza antes de validar.');
        if (ms(fresh.shippingFormLeaseUntil) > Date.now()) throw new Error('El formulario ya se está enviando. Actualiza en unos segundos.');
        if (!force && (!fresh.comprobanteValidadoAt || cancelled(fresh))) throw new Error('El pago todavía requiere validación.');
        const keepForm = fresh.shippingFormRequestedBeforeApproval && (fresh.shippingFormSentAt || ['sent', 'review'].includes(fresh.shippingFormStatus));
        tx.update(order.ref, { comprobanteValidadoAt: fresh.comprobanteValidadoAt || stamp(), paymentValidatedBy: 'manual', paymentProductionPending: true, ...(!keepForm ? { shippingFormStatus: 'pending', shippingFormNextAttemptAt: stamp() } : {}), ...(cancelled(fresh) ? { estatus: 'Pagado', paymentReactivatedAt: stamp() } : {}) });
        return keepForm ? fresh.shippingFormStatus : null;
    });
    await require('../leads/scheduledReminderScheduler').cancelReminderForContact(contactId, 'ya_pago').catch(() => {});
    await require('../design/designPending').recomputeForContact(contactId).catch(() => {});
    await require('./paymentProduction').reconcilePaymentProduction(order.id);
    const result = keepExistingForm ? { status: keepExistingForm } : await deliverForm(order.id, { force });
    if (result.status !== 'sent') throw new Error('Pago registrado; el formulario quedó pendiente en Pendientes.');
    return `DH${order.data().consecutiveOrderNumber}`;
}

async function paymentContext(contactId, { discover = false, process = false, orderNumber = null, newOrderIntent = false } = {}) {
    const num = Number(String(orderNumber || '').replace(/\D/g, ''));
    if (newOrderIntent && !num) return { registrationPending: true, hasPaid: false, pending: 0 };
    const allOrders = await ordersForContact(contactId);
    const explicit = num ? allOrders.find(d => Number(d.data().consecutiveOrderNumber) === num) : null;
    if (discover) await discoverReceipts(contactId, { orderId: explicit?.id || null });
    const rs = await receipts().where('contactId', '==', contactId).get();
    const ordered = rs.docs.sort((a, b) => ms(a.data().receivedAt) - ms(b.data().receivedAt));
    if (process) for (const r of ordered.filter(d => d.data().status === 'pending').slice(0, 8)) await processReceipt(r.id, { immediate: true });
    const contact = num ? null : (await db.collection('contacts_whatsapp').doc(contactId).get()).data();
    const newOrderSince = ms(contact?.paymentNewOrderRequestedAt);
    const currentOrders = await ordersForContact(contactId);
    const orders = num ? currentOrders : currentOrders.filter(d => !terminal(d.data())
        && (d.data().comprobanteValidadoAt || ms(d.data().createdAt) >= Date.now() - 45 * DAY)
        && (!newOrderSince || ms(d.data().createdAt) >= newOrderSince));
    const fresh = await receipts().where('contactId', '==', contactId).get();
    const unpaid = orders.filter(d => !d.data().comprobanteValidadoAt && !cancelled(d.data()));
    // Una imagen posterior puede ser un reenvío o una captura del chat: no invalida un pago.
    // Los pedidos nuevos se distinguen por su registro o por la solicitud explícita de otro pedido.
    const selected = num ? orders.find(d => Number(d.data().consecutiveOrderNumber) === num)
        : unpaid.length === 1 ? unpaid[0] : orders.length === 1 ? orders[0] : null;
    const pending = fresh.docs.filter(d => d.data().open && (!selected || d.data().orderId === selected.id || !d.data().orderId));
    const latest = selected?.data();
    const hasPaid = latest?.comprobanteValidadoAt && !cancelled(latest);
    return { hasPaid: !!hasPaid, partialCents: latest?.paymentReceivedCents || 0, totalCents: cents(latest?.precio) || 0,
        formSent: !!latest?.shippingFormSentAt, reportedComplete: !!latest?.paymentReportedComplete && !latest?.paymentFormNeedsAssessment, reportedCents: latest?.paymentReportedCents || 0, pending: pending.length,
        reason: pending.find(d => d.data().status === 'review')?.data().reason || latest?.shippingFormReason || '',
        registrationPending: !num && !!newOrderSince && orders.length === 0,
        ambiguous: !selected && (orders.length > 1 || !!num),
        productionStatus: latest?.estatus || null,
        productionReason: latest?.paymentProductionReason || '',
        contextSince: Math.max(ms(latest?.createdAt), ms(latest?.paymentUpdatedAt)),
        orderId: selected?.id, orderNumber: latest?.consecutiveOrderNumber ? `DH${latest.consecutiveOrderNumber}` : null };
}

// Sólo lo llama el webhook después de verificar approved con Mercado Pago.
async function recordProviderPayment(contactId, orderNumber, amount, paymentId) {
    const num = Number(String(orderNumber || '').replace(/\D/g, ''));
    const candidates = (await ordersForContact(contactId)).filter(d => Number(d.data().consecutiveOrderNumber) === num);
    const order = candidates.length === 1 ? candidates[0] : null;
    const id = hash('mercadopago|' + paymentId);
    try {
        await receipts().doc(id).create({ contactId, orderId: order?.id || null, orderNumber,
            verifiedProvider: 'mercadopago', providerPaymentId: String(paymentId),
            ocr: { esComprobante: true, monto: amount, imageHash: id },
            receivedAt: stamp(), createdAt: stamp(), updatedAt: stamp(), status: 'pending', open: true,
            attempts: 0, nextAttemptAt: stamp(), reason: 'Pago acreditado por Mercado Pago, pendiente de registro.' });
    } catch (e) { if (e.code !== 6 && !/already exist/i.test(e.message)) throw e; }
    return processReceipt(id, { immediate: true });
}

async function pendingPayments(suspiciousDocs) {
    const [rs, forms] = await Promise.all([
        receipts().where('open', '==', true).get(),
        db.collection('pedidos').where('shippingFormStatus', 'in', ['pending', 'sending', 'retry', 'review']).get(),
    ]);
    const pago_revision = [], pago_cancelado = [], pago_formulario = [];
    const orderIds = [...new Set(rs.docs.map(r => r.data().orderId).filter(Boolean))];
    const orders = new Map(await Promise.all(orderIds.map(async id => [id, (await db.collection('pedidos').doc(id).get()).data() || {}])));
    for (const r of rs.docs) {
        const d = r.data();
        const order = orders.get(d.orderId) || {};
        const row = { id: r.id, contactId: d.contactId, name: d.orderNumber || d.contactId, orderNumber: d.orderNumber, orderId: d.orderId, at: ms(d.receivedAt), reason: d.reason, imageUrl: d.fileUrl, imageHash: d.ocr?.imageHash || null, amount: d.ocr?.monto || null, status: d.status, formSent: !!order.shippingFormSentAt, shippingDataReceived: !!order.shippingDataReceivedAt };
        Object.assign(row, { receivedCents: Number(order.paymentReceivedCents) || 0, totalCents: cents(order.precio) || 0, reviewRisks: d.reviewRisks || [] });
        (/cancelad/i.test(d.reason || '') ? pago_cancelado : pago_revision).push(row);
    }
    for (const o of forms.docs) {
        const d = o.data();
        if (!canRequestShippingForm(d)) continue;
        pago_formulario.push({ id: o.id, contactId: d.contactId, name: `DH${d.consecutiveOrderNumber}`, at: ms(d.shippingFormEligibleAt || d.comprobanteValidadoAt), reason: d.shippingFormReason, status: d.shippingFormStatus });
    }
    if (!suspiciousDocs) suspiciousDocs = (await db.collection('contacts_whatsapp').where('suspiciousReceiptPending', '==', true).limit(200).get()).docs;
    const reviews = await mergeReviewRows([...pago_revision, ...pago_cancelado], suspiciousDocs);
    return { pago_revision: reviews.filter(r => !/cancelad/i.test(r.reason || '')),
        pago_cancelado: reviews.filter(r => /cancelad/i.test(r.reason || '')), pago_formulario };
}

module.exports = { enqueueReceipt, discoverReceipts, processReceipt, creditReceipt, previewReceiptReview, deliverForm, manualValidateAndSend, paymentContext, recordProviderPayment, pendingPayments, ordersForContact, refreshReportedPayment, recordShippingDataForOrder };
