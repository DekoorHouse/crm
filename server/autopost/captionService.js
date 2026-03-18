const { generateGeminiResponse } = require('../services');

const CAPTION_PROMPT = `Eres el community manager de DeKoor MX, una tienda mexicana de decoracion y hogar.
Analiza esta imagen y genera un copy para publicar en Facebook.

Reglas:
- Escribe en espanol mexicano, tono amigable y aspiracional
- Incluye 1-2 emojis relevantes
- Maximo 280 caracteres
- Incluye un llamado a la accion sutil (ej: "Visitanos", "Encuentra el tuyo", "Dale vida a tu espacio")
- NO incluyas hashtags
- Si no puedes identificar el producto, genera un copy generico sobre decoracion del hogar

Responde SOLO con el copy, sin explicaciones adicionales.`;

async function generateCaption(imageBuffer, mimeType) {
    const base64Image = imageBuffer.toString('base64');

    const imageParts = [{
        inlineData: {
            mimeType: mimeType || 'image/jpeg',
            data: base64Image
        }
    }];

    const result = await generateGeminiResponse(CAPTION_PROMPT, imageParts);

    // Limpiar el caption de comillas o formato extra
    let caption = result.text;
    caption = caption.replace(/^["']|["']$/g, '').trim();

    console.log(`[CAPTION] Generado (${result.inputTokens} in / ${result.outputTokens} out): ${caption}`);
    return caption;
}

module.exports = { generateCaption };
