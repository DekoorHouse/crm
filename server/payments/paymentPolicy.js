const crypto = require('crypto');

const DAY = 86400000;
const ms = value => value?.toMillis ? value.toMillis() : (typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value) || 0);
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cents = value => Math.round(Number(value) * 100);
const terminal = order => /entregad|devol/i.test(order.estatus || '');
const cancelled = order => /cancel/i.test(order.estatus || '');
const awaitingPaymentApproval = order => !!order.shippingFormRequestedBeforeApproval && !order.comprobanteValidadoAt;
const canRequestShippingForm = order => !!order && !terminal(order) && (
    (!!order.comprobanteValidadoAt && !cancelled(order)) ||
    (order.paymentReportedComplete === true && !order.paymentFormNeedsAssessment)
);

// Los destinos admitidos son los mismos que se comunican en el protocolo de pagos.
const DESTINATIONS = ['3262', '0670', '2629', '1983', '9250'];

function receiptKeys(receipt) {
    const keys = [];
    if (receipt.imageHash) keys.push('image_' + receipt.imageHash);
    for (const folio of receiptFolios(receipt)) if (receipt.fecha && cents(receipt.monto) > 0) {
        // No incluir al cliente ni al pedido: un mismo pago no financia dos pedidos.
        keys.push('folio_' + hash([folio, receipt.fecha, String(receipt.cuentaDestino || '').replace(/\D/g, '').slice(-4)].join('|')));
    }
    return keys;
}

const receiptFolios = receipt => [...new Set([receipt.claveRastreo, receipt.referencia].map(normalize).filter(v => v.length >= 5))];

// Dos capturas pueden corresponder al mismo ingreso. La incertidumbre obliga a
// revisar; no permite descartar ni acreditar dinero automáticamente.
function possibleSamePayment(a, b) {
    if (a.contactId && b.contactId && a.contactId !== b.contactId) return false;
    if (a.verifiedProvider && b.verifiedProvider) return a.providerPaymentId === b.providerPaymentId;
    const x = a.ocr || {}, y = b.ocr || {};
    if (x.imageHash && x.imageHash === y.imageHash) return true;
    if (!(Number(a.amountCents ?? cents(x.monto)) > 0) || Number(a.amountCents ?? cents(x.monto)) !== Number(b.amountCents ?? cents(y.monto))) return false;
    const destination = r => String(r.cuentaDestino || '').replace(/\D/g, '').slice(-4);
    if (destination(x) && destination(y) && destination(x) !== destination(y)) return false;
    const xf = receiptFolios(x), yf = receiptFolios(y);
    if (xf.length && yf.length && !xf.some(f => yf.includes(f))) return false;
    // Sin folio, otra fecha leída no demuestra que sean dos transferencias.
    if (xf.length && yf.length && x.fecha && y.fecha && x.fecha !== y.fecha) return false;
    return true;
}

function validateReceipt(order, receipt, receivedAt, destinations = DESTINATIONS) {
    if (receipt.esComprobante === false) return { status: 'ignored', reason: 'La imagen no es un comprobante de pago.' };
    if (receipt.esComprobante !== true) return { status: 'review', reason: 'No se pudo determinar si la imagen es un comprobante; revisar a mano.' };
    if (terminal(order)) return { status: 'review', reason: 'El pedido ya fue entregado o devuelto.' };
    if (receipt.pagoRealizado === false) return { status: 'review', reason: 'La operación aparece en proceso o no completada. Confirmar que el dinero se acreditó antes de aprobar el anticipo.' };
    const destination = String(receipt.cuentaDestino || '').replace(/\D/g, '').slice(-4);
    const folio = normalize(receipt.claveRastreo || receipt.referencia);
    if (!destinations.includes(destination) || receipt.moneda !== 'MXN' || !receipt.fecha || folio.length < 5 || !(cents(receipt.monto) > 0) || receipt.pagoRealizado !== true) {
        return { status: 'review', reason: 'Revisar destino, monto, fecha, folio y que el pago esté realizado.' };
    }
    const day = Date.parse(receipt.fecha + 'T12:00:00Z');
    const arrival = ms(receivedAt);
    // La edad se compara con la RECEPCIÓN, no con cuándo vuelve a encenderse la IA.
    // Un comprobante pendiente conserva su validez; uno ajeno a este pedido no la adquiere.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receipt.fecha) || !Number.isFinite(day) || !arrival || day > arrival + DAY || arrival - day > 7 * DAY || day < ms(order.createdAt) - 2 * DAY) {
        return { status: 'review', reason: 'La fecha del comprobante requiere confirmar a qué pedido corresponde.' };
    }
    if (cancelled(order) && order.canceladoPorCobranza !== true) {
        return { status: 'review', reason: 'Pago en pedido cancelado: confirmar manualmente su reactivación.' };
    }
    if (!(cents(order.precio) > 0)) return { status: 'review', reason: 'El pedido no tiene un total válido.' };
    return { status: 'valid', amountCents: cents(receipt.monto) };
}

function paymentDecision(order, amountCents, manual = false) {
    const total = cents(order.precio);
    const previous = Number(order.paymentReceivedCents) || 0;
    const received = previous + amountCents;
    if (!(total > 0) || !(amountCents > 0)) return { status: 'review', reason: 'Importe inválido.' };
    if (!manual && received > total) return { status: 'review', reason: 'El pago supera el total registrado; confirmar el importe acordado.' };
    if (cancelled(order) && received < total && !manual) return { status: 'review', reason: 'Pedido cancelado con abono parcial: requiere revisión.' };
    return { status: received >= total ? 'paid' : 'partial', receivedCents: received, remainingCents: Math.max(0, total - received) };
}

// Pedir una dirección no acredita dinero. Sumamos importes legibles aun si falta
// validar el folio, el destino o reactivar el pedido; nunca operaciones fallidas.
function reportedPaymentCents(order, jobs, creditedKeys = new Set()) {
    const groups = [];
    for (const job of jobs) {
        const keys = receiptKeys(job.ocr || {});
        if (!keys.length) continue;
        const matches = groups.filter(g => keys.some(k => g.keys.has(k)) || g.jobs.some(other =>
            ['applied', 'review', 'pending', 'processing'].includes(job.status) &&
            ['applied', 'review', 'pending', 'processing'].includes(other.status) && possibleSamePayment(job, other)));
        const group = { keys: new Set(keys), jobs: [job] };
        for (const match of matches) {
            match.keys.forEach(k => group.keys.add(k));
            group.jobs.push(...match.jobs);
            groups.splice(groups.indexOf(match), 1);
        }
        groups.push(group);
    }
    let total = Number(order.paymentReceivedCents) || 0;
    for (const group of groups) {
        if ([...group.keys].some(k => creditedKeys.has(k)) || group.jobs.some(j => ['applied', 'duplicate', 'rejected'].includes(j.status))) continue;
        const candidates = group.jobs.filter(j => ['review', 'pending', 'processing'].includes(j.status)
            && j.ocr?.esComprobante === true && j.ocr.pagoRealizado !== false
            && (!j.ocr.moneda || j.ocr.moneda === 'MXN')
            && Number.isFinite(cents(j.ocr.monto)) && cents(j.ocr.monto) > 0);
        candidates.sort((a, b) => ms(a.receivedAt) - ms(b.receivedAt));
        if (candidates.length) total += cents(candidates[0].ocr.monto);
    }
    return total;
}

function claimsPayment(text) {
    return /(?:ya\s+(?:valid[aá](?:mos|do)|valid[eé]|confirm[aá](?:mos|do)|verifiqu[eé]|verificamos)|(?:recibimos|recib[ií]|recibido|gracias)[^.!?\n]{0,65})(?:[^.!?\n]{0,65})(?:pago|comprobante|dep[oó]sito|transferencia|anticipo)|(?:pedido|pago)[^.!?\n]{0,35}(?:liquidado|pagado|validado|confirmado)/i.test(text);
}

module.exports = { DAY, ms, hash, cents, terminal, cancelled, receiptKeys, receiptFolios, possibleSamePayment, validateReceipt, paymentDecision, claimsPayment, reportedPaymentCents, canRequestShippingForm, awaitingPaymentApproval };
