/**
 * Clasificador de "pedido en proceso" (Gemini, salida JSON).
 *
 * Lee la conversación reciente de WhatsApp y decide si el cliente empezó a armar
 * un pedido (nombre a grabar, tipo de lámpara, personalización, foto, dirección…)
 * pero quedó pendiente algo, y propone 1–2 mensajes de seguimiento personalizados.
 *
 * El parseo/normalizado vive en orderFollowupLogic.js (puro/testeable). Aquí solo
 * el I/O: llamada a Gemini + registro de tokens.
 */
const { db, admin } = require('../config');
const { parseClassifierJson, normalizeClassification } = require('./orderFollowupLogic');

const SYSTEM_INSTRUCTION = `Eres un clasificador para DekoorHouse, una tienda mexicana de lámparas personalizadas.
Analizas una conversación de WhatsApp entre el "Cliente" y el "Asistente" (la tienda) y decides
si el cliente EMPEZÓ a dar datos para un pedido (por ejemplo: un nombre o texto a grabar, el tipo o
modelo de lámpara, color/tamaño, una foto de referencia, datos de envío) pero NO terminó de concretarlo
y tampoco confirmó la compra.

Responde ÚNICAMENTE con un JSON válido (sin texto antes ni después, sin markdown) con esta forma exacta:
{
  "enProceso": boolean,      // true SOLO si empezó a armar un pedido y quedó algo pendiente
  "datosDados": string[],    // datos que el cliente ya proporcionó, p. ej. ["nombre: Sofía", "lámpara luna", "color cálido"]
  "pendiente": string,       // lo que falta para cerrar, p. ej. "foto", "confirmar diseño", "dirección", "anticipo"; "" si no es claro
  "mensajes": string[]       // 1 o 2 mensajes de seguimiento, cálidos y breves, español de México, emojis sobrios,
                             // personalizados con lo que ya dio y mencionando lo pendiente; el 2º distinto del 1º; sin presionar
}

Reglas:
- Si el cliente solo saludó, preguntó precios/ubicación en general, ya compró/confirmó, o no hay intención de pedido: enProceso=false (y "mensajes" puede ir vacío).
- Si el Asistente ya le dijo al cliente que el pedido NO se puede concretar por una razón de fondo (no hay cobertura de envío para su código postal o zona, no se envía a su ubicación, no hay stock del modelo, no se puede hacer ese diseño, etc.) y el cliente NO ofreció una alternativa viable después (por ejemplo otro CP con cobertura): enProceso=false. Ese pedido está BLOQUEADO: no hay nada que rescatar y un recordatorio sonaría a contradicción con lo que ya se le dijo.
- Coherencia obligatoria: los "mensajes" JAMÁS deben contradecir, re-ofrecer ni re-prometer algo que el Asistente ya descartó en la conversación. Si ya se negó la cobertura de un código postal, NO ofrezcas volver a "checar la cobertura" de ese mismo CP; si ya se dijo que no hay stock de un modelo, no lo vuelvas a ofrecer.
- No inventes datos que no estén en la conversación.
- Los mensajes deben sonar humanos y naturales, como un vendedor amable dando seguimiento, no como un bot.`;

/**
 * @param {{conversationText: string, name?: string}} args
 * @returns {Promise<{enProceso:boolean, datosDados:string[], pendiente:string, mensajes:string[]}|null>}
 *          null si la IA falla o el JSON no se pudo interpretar (el caller decide reintentar).
 */
async function classifyOrderIntent({ conversationText, name }) {
    if (!conversationText || !conversationText.trim()) return null;

    // require perezoso para evitar ciclo services <-> classifier (live-tagging)
    const { generateGeminiResponse } = require('../services');

    const prompt = `Cliente: ${name || 'desconocido'}\n\nConversación (más antiguo arriba):\n${conversationText}\n\nDevuelve solo el JSON.`;

    let res;
    try {
        res = await generateGeminiResponse(prompt, [], SYSTEM_INSTRUCTION);
    } catch (e) {
        console.warn('[ORDER_FOLLOWUP] Clasificación falló:', e.message);
        return null;
    }

    // Registrar uso de tokens (mismo doc diario que usa el bot)
    try {
        const today = new Date().toISOString().split('T')[0];
        await db.collection('ai_usage_logs').doc(today).set({
            inputTokens: admin.firestore.FieldValue.increment(res.inputTokens || 0),
            outputTokens: admin.firestore.FieldValue.increment(res.outputTokens || 0),
            cachedTokens: admin.firestore.FieldValue.increment(res.cachedTokens || 0),
            requestCount: admin.firestore.FieldValue.increment(1),
            date: today
        }, { merge: true });
    } catch (_) { /* el logging no debe tumbar la clasificación */ }

    return normalizeClassification(parseClassifierJson(res.text));
}

module.exports = { classifyOrderIntent, SYSTEM_INSTRUCTION };
