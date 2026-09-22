const { ms, DAY } = require('../payments/paymentPolicy');

// El extractor necesita los datos acordados antes del comprobante, aunque una conversación
// larga los haya desplazado de los 50 mensajes que usa la respuesta conversacional.
function registrationTranscript(contactId, messages) {
    const seenBusiness = new Set();
    return [...messages].sort((a, b) => ms(a.timestamp) - ms(b.timestamp)).flatMap(m => {
        const client = m.from === contactId;
        const text = String(m.text || m.transcription || (m.type ? `[${m.type} recibido]` : '')).trim();
        if (!text) return [];
        if (!client) {
            if (seenBusiness.has(text)) return [];
            seenBusiness.add(text);
        }
        return [`${client ? 'Cliente' : 'Asistente'}: ${text.replace(/\r?\n/g, '\n    ')}`];
    }).join('\n');
}

async function loadRegistrationHistory(contactRef, contactId, currentTranscript) {
    const snap = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(400).get();
    const contact = (await contactRef.get()).data() || {};
    const history = snap.docs.map(d => d.data()).filter(m => ms(m.timestamp) >= Date.now() - 45 * DAY
        && (!contact.activePurchaseStartedAt || ms(m.timestamp) >= ms(contact.activePurchaseStartedAt))
        && (!m.purchaseSessionId || !contact.activePurchaseSessionId || m.purchaseSessionId === contact.activePurchaseSessionId));
    return registrationTranscript(contactId, history) + '\n\nTurno actual (puede repetir el final del historial):\n' + currentTranscript;
}

module.exports = { registrationTranscript, loadRegistrationHistory };
