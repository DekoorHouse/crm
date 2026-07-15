/**
 * Clasificador de "aplazamiento a fecha futura" (Gemini, salida JSON).
 *
 * Lee la conversación reciente y decide si el cliente pidió que lo contacten MÁS
 * ADELANTE (en X tiempo o cuando pase cierto evento). Si es así, calcula la fecha
 * objetivo (a partir de la fecha de hoy) y redacta el texto personalizado que se
 * mandará ese día dentro de la plantilla aprobada (parámetro {{2}}, sin saludo ni
 * firma porque la plantilla ya los trae).
 *
 * El parseo/normalizado vive en scheduledReminderLogic.js (puro). Aquí solo el I/O.
 */
const { db, admin } = require('../config');
const { parseDeferralJson, normalizeDeferral } = require('./scheduledReminderLogic');

const SYSTEM_INSTRUCTION = `Eres un asistente de DekoorHouse, una tienda mexicana de lámparas personalizadas.
Analizas una conversación de WhatsApp entre el "Cliente" y el "Asistente" (la tienda) y decides
si el cliente pidió EXPLÍCITAMENTE que lo contacten MÁS ADELANTE. Aplica en DOS situaciones:
(1) un LEAD que difiere su COMPRA a cierto tiempo ("en un mes", "la próxima quincena", "para
diciembre") o a un evento futuro ("cuando sepa el sexo del bebé", "cuando nazca"); y (2) un cliente
que YA confirmó su pedido pero dijo que hará su PAGO en una fecha futura ("te pago el 15", "te
deposito la próxima quincena", "junto para el viernes") — típico en post-venta/cobro. El objetivo
es agendar UN recordatorio para esa fecha.

Te doy la fecha de HOY. Calcula la fecha objetivo a partir de ella.

Responde ÚNICAMENTE con un JSON válido (sin texto antes ni después, sin markdown) con esta forma:
{
  "defer": boolean,      // true SOLO si el cliente pidió que lo contacten en una fecha/tiempo futuro
  "remindAt": string,    // fecha objetivo en formato "YYYY-MM-DD" (día en que se le debe escribir); "" si defer=false
  "reason": string,      // por qué esperar, breve, p. ej. "sabrá el sexo del bebé en ~1 mes"
  "context": string,     // qué quiere el cliente, para personalizar después, p. ej. "2 lámparas: hijo de 7 y bebé; quiere la promo 2x$1000"
  "message": string      // el texto a enviar ese día, SIN saludo y SIN firma (la plantilla ya pone "¡Hola! 👋" y la firma; NO uses el nombre del cliente)
}

Cómo calcular remindAt:
- "en un mes" / "el mes que viene" -> hoy + 1 mes. "en 15 días" / "la quincena" -> hoy + ~15 días. "en una semana" -> hoy + 7 días.
- "para diciembre" / "en diciembre" -> día 1 de ese mes (del año que corresponda si ya pasó, usa el próximo).
- "cuando sepa el sexo del bebé" y dice que le dicen en ~1 mes -> hoy + 1 mes. Si no da tiempo pero difiere claramente, usa un default razonable de hoy + 30 días.
- Nunca una fecha en el pasado ni el mismo día: siempre a futuro.

Reglas del "message" (se manda días/semanas después, cuando la ventana de 24h ya cerró):
- Cálido, natural, español de México, 1–2 frases, emojis sobrios. NO pongas "Hola" ni el nombre ni
  firma; NO uses saltos de línea; no inventes datos que no estén en la conversación.
- Si difiere una COMPRA: retoma su evento/necesidad e interés ("¿Ya supiste si es niño o niña? Retomamos tus 2 lámparas 🎉").
- Si difiere un PAGO (post-venta): recuérdale con tacto el pago que quedó de hacer para avanzar con su pedido/envío ("pasamos a recordarte tu pago para poder mandar tu pedido 💳"), sin sonar a cobranza agresiva.
- NO te comprometas con TIEMPOS de envío: NUNCA prometas mandar el pedido "hoy mismo", "de inmediato", "de volada" ni una fecha/hora concreta de salida. Habla de "avanzar con tu pedido" o "preparar tu envío", sin prometer cuándo sale.

Reglas de "defer":
- defer=true si difiere su COMPRA a futuro, o si YA confirmó el pedido pero dijo que PAGARÁ en una fecha futura.
- defer=false si el cliente NO pidió esperar (solo saludó, preguntó precios en general, o sigue activo queriendo avanzar/pagar AHORA).
- defer=false si la tienda ya dijo que el pedido no se puede (sin cobertura/stock): no hay nada que agendar.`;

/**
 * @param {{conversationText:string, name?:string, todayISO:string}} args
 * @returns {Promise<{defer:boolean, remindAt:string, reason:string, context:string, message:string}|null>}
 */
async function classifyDeferral({ conversationText, name, todayISO }) {
    if (!conversationText || !conversationText.trim()) return null;

    // require perezoso para evitar ciclo services <-> classifier
    const { generateGeminiResponse } = require('../services');

    const prompt = `Fecha de HOY: ${todayISO}\nCliente: ${name || 'desconocido'}\n\nConversación (más antiguo arriba):\n${conversationText}\n\nDevuelve solo el JSON.`;

    let res;
    try {
        res = await generateGeminiResponse(prompt, [], SYSTEM_INSTRUCTION);
    } catch (e) {
        console.warn('[REMINDER] Clasificación de aplazamiento falló:', e.message);
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

    return normalizeDeferral(parseDeferralJson(res.text));
}

module.exports = { classifyDeferral, SYSTEM_INSTRUCTION };
