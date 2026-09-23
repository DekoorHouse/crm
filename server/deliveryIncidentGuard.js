const INSTRUCTION = `\n\nINCIDENCIAS DE ENTREGA: Distingue siempre lo que reporta el cliente, lo que registra la paquetería y los hechos verificados. Una entrega marcada como realizada y negada por el cliente es una discrepancia pendiente de revisión, no prueba de culpa. No atribuyas responsabilidad a Dekoor, al cliente ni a la paquetería sin evidencia verificada. Puedes lamentar la molestia sin admitir culpa. No afirmes que revisaste el rastreo, contactaste a DHL, abriste una aclaración o que hay una investigación en curso sin registro explícito de esa gestión. Una promesa anterior del asistente NO es evidencia. No prometas recuperación, reposición, reembolso ni fechas sin autorización humana. No inventes que faltan datos de envío si ya existe una guía. Deriva la discrepancia a revisión humana.\n`;
const clean = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function isDeliveryDispute(text) {
    return /(?:no (?:se me |me )?(?:entregaron|entrego|ha llegado|llego|han entregado)|no (?:he |lo he )?recibido).{0,45}(?:pedido|paquete|lampara)|(?:pedido|paquete|lamparas?).{0,35}(?:no .{0,15}(?:entreg|lleg)|no lo recibi)|(?:equivocaron|equivocada|incorrecta).{0,25}(?:privada|direccion|entrega)|(?:no conozco|no trabaja|no vive).{0,35}(?:recibio|luis|persona|nadie)|aparece entregado.{0,45}(?:no|pero)/.test(clean(text));
}
const RESPONSE = 'Entiendo tu preocupación por la entrega. Hay que contrastar la dirección del pedido con la guía y la evidencia de recepción para determinar qué ocurrió. La incidencia quedó marcada para revisión humana; todavía no hay una conclusión confirmada ni una fecha de resolución.';
async function protectDeliveryIncident({ contactRef, contact, customerText, reply, timestamp, newPurchase = false }) {
    const detected = isDeliveryDispute(customerText);
    const pending = contact.deliveryIncidentPending === true
        && (contact.deliveryIncident?.purchaseSessionId || null) === (contact.activePurchaseSessionId || null);
    if (!detected && (!pending || newPurchase)) return reply;
    if (detected) await contactRef.update({
        deliveryIncidentPending: true,
        deliveryIncident: { customerReport: String(customerText).slice(0, 1000), status: 'needs_verification',
            purchaseSessionId: contact.activePurchaseSessionId || null, at: timestamp },
    });
    // Brief acknowledgements should not repeat the incident or promises.
    if (!detected && /^(?:gracias|ok|va|sale|de acuerdo|muchas gracias)[.!\s]*$/i.test(customerText.trim())) return 'Con gusto.';
    return RESPONSE;
}
module.exports = { INSTRUCTION, isDeliveryDispute, protectDeliveryIncident };
