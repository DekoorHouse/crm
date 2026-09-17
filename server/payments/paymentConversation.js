const clean = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const fullPaymentClaim = text => /(?:pago|pedido|total)[^.!?\n]{0,30}(?:completo|liquidado|pagado)|(?:liquidaste|pagaste todo)|datos-estafeta\//i.test(text);
const blocksProductionForBalance = text => /(?:resto|restante|saldo|liquidar|pago completo|falta)[^.!?\n]{0,100}(?:para|antes de)[^.!?\n]{0,40}(?:registr|fabric|empez|inici|arranc)/i.test(text);
// Revisar también las solicitudes de cobro, no sólo las afirmaciones de haber recibido dinero.
const requestsPaymentAgain = text => /(?:manda|envia|comparte|compartir|adjunta|necesit|falta|pendiente|espera|requier|proporcion)[^.!?\n]{0,100}(?:comprobante|pago|deposito|transferencia)|(?:comprobante|pago)[^.!?\n]{0,60}(?:pendiente|falta|no (?:aparece|esta registrado|hemos recibido))|(?:realiza|haz|hacer|efectua|completa)[^.!?\n]{0,50}(?:pago|deposito|transferencia)|(?:liquida|liquidar|pagar)[^.!?\n]{0,50}(?:saldo|resto|pedido)|(?:puedes|debes|necesitas|falta)[^.!?\n]{0,30}(?:pagar|depositar|transferir)|\/(?:oxxo|oxxomp)\b/.test(clean(text));
const paymentComplaint = text => /ya\s+(?:(?:te|lo|les)\s+)?(?:pague|page|pago|pagado|pago esta|deposite|transferi)|(?:mandan|piden|cobran|cobrando|cobrar)[^.!?\n]{0,60}(?:pague|page|pago|pagar|otra vez|nuevo)/.test(clean(text));
const orderNumberInMessage = text => {
    const numbers = [...new Set([...String(text || '').matchAll(/\bDH\s*(\d{4,6})\b/gi)].map(m => 'DH' + m[1]))];
    return numbers.length === 1 ? numbers[0] : null;
};

// El pedido se registra ANTES de consultar su pago. Así un comprador recurrente
// nunca recibe una confirmación basada en el pedido anterior mientras se crea el nuevo.
async function preparePaymentTurn(contactId, { register = null, orderNumber = null, newOrderIntent = false } = {}) {
    const registeredOrderNumber = register ? await register() : null;
    if (register && !registeredOrderNumber) return { registeredOrderNumber, context: { registrationPending: true, hasPaid: false, pending: 1 } };
    const context = await require('./paymentWorkflow').paymentContext(contactId, {
        discover: true, process: true, orderNumber: registeredOrderNumber || orderNumber, newOrderIntent,
    });
    return { registeredOrderNumber, context };
}

function paymentReply(context, { customerText = '', aiText = '', receiptPresent = false, recentReplies = [], onlyPreventRepeatRequest = false } = {}) {
    // Una instrucción legítima para pagar un pedido aún no pagado conserva los datos bancarios.
    if (onlyPreventRepeatRequest && !context.hasPaid && !context.reportedComplete && !context.pending) return null;
    const question = clean(customerText).trim();
    if (/^(?:ok|okey|va|sale|si|si gracias|gracias|muchas gracias|perfecto|listo|de acuerdo)[\s.!¡,😊👍✨]*$/.test(question) && !receiptPresent) return ['¡Con gusto! ✨'];
    if (context.registrationPending) return [(receiptPresent ? 'Recibimos tu comprobante. ' : '') + 'El equipo dará seguimiento al registro de este pedido y a su pago.'];
    if (context.ambiguous) return ['El equipo revisará a cuál de tus pedidos corresponde este comprobante para registrarlo correctamente.'];
    if (context.hasPaid || context.reportedComplete) {
        if (requestsPaymentAgain(aiText) || paymentComplaint(customerText)) {
            const name = context.orderNumber ? ` de ${context.orderNumber}` : '';
            return [context.hasPaid
                ? `Tu pago completo${name} ya está registrado. No necesitas volver a pagar ni reenviar el comprobante.${paymentComplaint(customerText) ? ' Disculpa la confusión.' : ''}`
                : `Ya recibimos los comprobantes${name} que cubren el total. El equipo está revisando su acreditación; no necesitas reenviarlos.`];
        }
        if (receiptPresent && context.formSent) return []; // el formulario ya incluye el agradecimiento
        if (!context.formSent) return [context.hasPaid
            ? 'Tu pago completo está registrado. Tu formulario de envío quedó pendiente y el equipo le dará seguimiento.'
            : 'Recibimos tu comprobante. Solicitaremos tus datos de envío mientras el equipo revisa el pago.'];
        if (!context.hasPaid && fullPaymentClaim(aiText)) return ['Tu comprobante está en revisión. Ya te compartimos el formulario para adelantar tus datos de envío.'];
        return null; // conservar la respuesta pertinente del modelo; no repetir el formulario
    }
    if (context.partialCents > 0) {
        const asksBalance = /(?:cuanto|cu[aá]l).*(?:falta|resta|saldo|restante)|(?:saldo|restante)\s*\?/.test(question);
        const asksPhoto = /foto|fotografia|imagen|terminad/.test(question);
        if (asksPhoto && !asksBalance && !receiptPresent) return ['El resto lo liquidas después de ver la foto de tus lámparas terminadas, como acordamos. Te compartiremos la foto cuando esté lista.'];
        const unsafe = fullPaymentClaim(aiText) || blocksProductionForBalance(aiText) || /\/anticipopagado\b|\/comprobante\b/i.test(aiText);
        if (!receiptPresent && !asksBalance && !unsafe) return null;
        const amount = (context.partialCents / 100).toLocaleString('es-MX');
        const production = context.productionStatus === 'Fabricar' ? ' Tu pedido ya pasó a Fabricar.' : ' El equipo dará seguimiento a la fabricación de tu pedido.';
        const balance = asksBalance ? ` El saldo es de $${(Math.max(0, context.totalCents - context.partialCents) / 100).toLocaleString('es-MX')}, y lo liquidas al ver la foto del trabajo terminado.` : ' El resto lo liquidas al ver la foto del trabajo terminado.';
        const reply = `Tu anticipo de $${amount} quedó registrado.${production}${balance}`;
        if (!asksBalance && !receiptPresent && recentReplies.includes(reply)) return ['El resto lo liquidas al ver la foto del trabajo terminado, como acordamos.'];
        return [reply];
    }
    if (context.pending || receiptPresent) return ['Recibimos tu comprobante y el equipo está revisando que el importe se haya acreditado. No necesitas volver a mandar la misma imagen.'];
    return ['Para registrar el pago necesitamos la foto o el PDF del comprobante. ¿Nos lo compartes por aquí, por favor?'];
}

module.exports = { preparePaymentTurn, paymentReply, fullPaymentClaim, blocksProductionForBalance, requestsPaymentAgain, paymentComplaint, orderNumberInMessage };
