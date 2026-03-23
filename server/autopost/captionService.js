const { generateGeminiResponse } = require('../services');

const DEFAULT_CAPTION_PROMPT = `Eres el community manager de Dekoor MX, una tienda mexicana de decoracion y hogar. La marca se escribe "Dekoor" (con k minuscula, siempre).
Analiza esta imagen y genera un copy para publicar en Facebook.

Reglas:
- Escribe en espanol mexicano, tono amigable, calido y aspiracional
- Usa MUCHOS emojis relevantes a lo largo del texto (minimo 5-8 emojis)
- Maximo 300 caracteres
- Incluye un llamado a la accion (ej: "Visitanos", "Encuentra el tuyo", "Dale vida a tu espacio", "Pidelo ya")
- La marca SIEMPRE se escribe "Dekoor" (con k minuscula)
- NO incluyas hashtags
- Si no puedes identificar el producto, genera un copy generico sobre decoracion del hogar

Responde SOLO con el copy, sin explicaciones adicionales.`;

function buildCaptionPrompt(pageConfig) {
    if (pageConfig?.captionPrompt) return pageConfig.captionPrompt;
    if (!pageConfig?.brandPrompt) return DEFAULT_CAPTION_PROMPT;

    return `Eres el community manager de ${pageConfig.brandPrompt}, una tienda mexicana de decoracion y hogar.
Analiza esta imagen y genera un copy para publicar en Facebook.

Reglas:
- Escribe en espanol mexicano, tono amigable, calido y aspiracional
- Usa MUCHOS emojis relevantes a lo largo del texto (minimo 5-8 emojis)
- Maximo 300 caracteres
- Incluye un llamado a la accion (ej: "Visitanos", "Encuentra el tuyo", "Dale vida a tu espacio", "Pidelo ya")
- La marca SIEMPRE se escribe "${pageConfig.name}"
- NO incluyas hashtags
- Si no puedes identificar el producto, genera un copy generico sobre decoracion del hogar

Responde SOLO con el copy, sin explicaciones adicionales.`;
}

async function generateCaption(imageBuffer, mimeType, pageConfig) {
    const base64Image = imageBuffer.toString('base64');

    const imageParts = [{
        inlineData: {
            mimeType: mimeType || 'image/jpeg',
            data: base64Image
        }
    }];

    const prompt = buildCaptionPrompt(pageConfig);
    const result = await generateGeminiResponse(prompt, imageParts);

    // Limpiar el caption de comillas o formato extra
    let caption = result.text;
    caption = caption.replace(/^["']|["']$/g, '').trim();

    console.log(`[CAPTION] Generado (${result.inputTokens} in / ${result.outputTokens} out): ${caption}`);
    return caption;
}

module.exports = { generateCaption };
