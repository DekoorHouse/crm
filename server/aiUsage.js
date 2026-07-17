// =================================================================
// === Registro CENTRALIZADO del consumo de IA (Gemini) por fuente ==
// =================================================================
// Antes cada llamada a Gemini escribía su propio bloque en ai_usage_logs/{today}
// (o no lo escribía, p. ej. la transcripción de audios), y todo se sumaba en un
// único total sin saber quién gastaba qué. Este helper unifica ese registro:
//
//   ai_usage_logs/{YYYY-MM-DD} = {
//     date, inputTokens, outputTokens, cachedTokens, requestCount,   // TOTALES (compat. con la vista actual)
//     bySource: { <fuente>: { inputTokens, outputTokens, cachedTokens, requestCount }, ... }
//   }
//
// Los totales se conservan tal cual para no romper la pantalla de "Uso y Costos de IA";
// bySource es el desglose nuevo. Es best-effort: nunca lanza (el logging no debe tumbar
// la respuesta al cliente).
const { db, admin } = require('./config');

/**
 * Registra el consumo de una llamada (o lote de llamadas) a Gemini.
 * @param {string} source - Etiqueta de la fuente. Ej.: 'bot', 'transcripcion',
 *   'clasificador_pedido', 'clasificador_recordatorio', 'registro_pedido',
 *   'cobranza', 'reactivacion', 'satisfaccion'.
 * @param {{inputTokens?:number, outputTokens?:number, cachedTokens?:number, requestCount?:number}} usage
 *   El objeto de resultado de generateGeminiResponse* sirve tal cual (tiene inputTokens/
 *   outputTokens/cachedTokens). requestCount default 1; pásalo >1 para lotes (batch).
 */
async function logAiUsage(source, usage = {}) {
    try {
        const inputTokens = Number(usage.inputTokens) || 0;
        const outputTokens = Number(usage.outputTokens) || 0;
        const cachedTokens = Number(usage.cachedTokens) || 0;
        const requestCount = Number(usage.requestCount) || 1;

        const today = new Date().toISOString().split('T')[0];
        const inc = admin.firestore.FieldValue.increment;
        // Las claves de un mapa en Firestore no admiten . $ [ ] # / — sanea la fuente por si acaso.
        const src = (String(source || 'desconocido').trim().replace(/[.$\[\]#/]/g, '_')) || 'desconocido';

        await db.collection('ai_usage_logs').doc(today).set({
            date: today,
            inputTokens: inc(inputTokens),
            outputTokens: inc(outputTokens),
            cachedTokens: inc(cachedTokens),
            requestCount: inc(requestCount),
            bySource: {
                [src]: {
                    inputTokens: inc(inputTokens),
                    outputTokens: inc(outputTokens),
                    cachedTokens: inc(cachedTokens),
                    requestCount: inc(requestCount),
                }
            }
        }, { merge: true });
    } catch (e) {
        console.warn('[AI_USAGE] No se pudo registrar el uso de IA:', e.message);
    }
}

module.exports = { logAiUsage };
