const fetch = require('node-fetch');

const API_KEY = () => process.env.GOOGLE_AI_IMAGE_KEY;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// ===================== MODEL DEFINITIONS =====================

const MODELS = {
    'imagen-4-fast': {
        id: 'imagen-4.0-fast-generate-001',
        name: 'Imagen 4 Fast',
        type: 'imagen',
        costPerImage: 0.02,
        speed: 'fast',
        maxPromptTokens: 480,
    },
    'imagen-4': {
        id: 'imagen-4.0-generate-001',
        name: 'Imagen 4',
        type: 'imagen',
        costPerImage: 0.04,
        speed: 'standard',
        maxPromptTokens: 480,
    },
    'imagen-4-ultra': {
        id: 'imagen-4.0-ultra-generate-001',
        name: 'Imagen 4 Ultra',
        type: 'imagen',
        costPerImage: 0.06,
        speed: 'premium',
        maxPromptTokens: 480,
    },
    'nano-banana': {
        id: 'gemini-2.5-flash-image',
        name: 'Nano Banana',
        type: 'gemini',
        costPerImage: 0.039,
        inputPer1M: 0.30,
        speed: 'standard',
    },
    'nano-banana-2': {
        id: 'gemini-3.1-flash-image-preview',
        name: 'Nano Banana 2 Preview',
        type: 'gemini',
        costPerImage: 0.101,  // 2K resolution
        inputPer1M: 0.50,
        speed: 'standard',
    },
    'nano-banana-pro': {
        id: 'gemini-3-pro-image-preview',
        name: 'Nano Banana Pro',
        type: 'gemini',
        costPerImage: 0.134,  // 2K resolution (same as 1K)
        inputPer1M: 2.00,
        speed: 'premium',
    },
};

// ===================== IMAGE GENERATION =====================

/**
 * Genera imágenes con modelos Imagen 4 (endpoint :predict)
 */
async function generateWithImagen(modelId, prompt, aspectRatio = '1:1', sampleCount = 1) {
    const apiKey = API_KEY();
    const url = `${BASE_URL}/models/${modelId}:predict`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
                sampleCount: Math.min(sampleCount, 4),
                aspectRatio,
                personGeneration: 'allow_adult',
            },
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Imagen API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const images = (data.predictions || []).map(p => {
        const bytes = p.bytesBase64Encoded || p.image?.imageBytes || '';
        return `data:image/png;base64,${bytes}`;
    });

    // Imagen no devuelve usageMetadata, estimamos tokens del prompt (~4 chars/token)
    const estimatedTokens = Math.ceil(prompt.length / 4);

    return { images, inputTokens: estimatedTokens, outputTokens: 0 };
}

/**
 * Genera imágenes con modelos Gemini/Nano Banana (endpoint :generateContent)
 */
async function generateWithGemini(modelId, prompt, aspectRatio = '1:1', imageData = null) {
    const apiKey = API_KEY();
    const url = `${BASE_URL}/models/${modelId}:generateContent?key=${apiKey}`;

    // Construir parts: texto + imagen de referencia opcional
    const parts = [{ text: prompt }];
    if (imageData) {
        parts.push({
            inlineData: {
                mimeType: imageData.mimeType,
                data: imageData.base64,
            },
        });
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: {
                    aspectRatio,
                    imageSize: '2K',
                },
            },
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini Image API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('No se recibió respuesta del modelo.');

    // Extraer imágenes y texto de las parts
    const images = [];
    let textResponse = '';
    for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
            images.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
        }
        if (part.text) {
            textResponse += part.text;
        }
    }

    if (images.length === 0) {
        throw new Error(textResponse || 'El modelo no generó imágenes. Intenta reformular el prompt.');
    }

    const usage = data.usageMetadata || {};
    return {
        images,
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
    };
}

// ===================== MAIN FUNCTION =====================

/**
 * Genera imágenes según el modelo seleccionado y calcula costos.
 * @param {string} modelKey - Clave del modelo (ej: 'imagen-4-fast')
 * @param {string} prompt - Prompt de texto
 * @param {string} aspectRatio - Relación de aspecto
 * @param {number} sampleCount - Número de imágenes (solo Imagen)
 * @param {{ mimeType: string, base64: string }|null} imageData - Imagen de referencia (solo Gemini)
 * @returns {{ images, model, usage, cost }}
 */
async function generateImage(modelKey, prompt, aspectRatio = '1:1', sampleCount = 1, imageData = null) {
    const apiKey = API_KEY();
    if (!apiKey) throw new Error('GOOGLE_AI_IMAGE_KEY no está configurada.');

    const modelConfig = MODELS[modelKey];
    if (!modelConfig) throw new Error(`Modelo no soportado: ${modelKey}`);

    let result;
    if (modelConfig.type === 'imagen') {
        result = await generateWithImagen(modelConfig.id, prompt, aspectRatio, sampleCount);
    } else {
        result = await generateWithGemini(modelConfig.id, prompt, aspectRatio, imageData);
    }

    // Calcular costo
    const imageCount = result.images.length;
    let cost;
    if (modelConfig.type === 'imagen') {
        cost = {
            perImage: modelConfig.costPerImage,
            imagesCost: modelConfig.costPerImage * imageCount,
            inputTokenCost: 0,
            total: modelConfig.costPerImage * imageCount,
        };
    } else {
        const inputTokenCost = (result.inputTokens / 1_000_000) * (modelConfig.inputPer1M || 0);
        const imagesCost = modelConfig.costPerImage * imageCount;
        cost = {
            perImage: modelConfig.costPerImage,
            imagesCost,
            inputTokenCost,
            total: inputTokenCost + imagesCost,
        };
    }

    return {
        images: result.images,
        model: modelConfig.name,
        usage: {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.inputTokens + result.outputTokens,
        },
        cost,
    };
}

module.exports = { generateImage, MODELS };
