'use strict';

// Mejorador de prompts para Qwen Image 2.1. Usa las instrucciones oficiales de Qwen (qwenPrompts/t2i.md de
// Qwen/Qwen-Image-2.1-PE-T2I e i2i.md de Qwen/Qwen-Image-2.1-PE-I2I, system_prompt.txt) con un modelo de
// texto de OpenRouter, porque el mejorador oficial (Qwen3.5 9B) no corre en la GPU con el ComfyUI fijado.
// Probado el 24-sep-2026: "Spiderman corriendo" pasó de una foto de cosplay rígida a una escena completa.
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const sharp = require('sharp');

const URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = () => process.env.QWEN_PROMPT_MODEL || process.env.OPENROUTER_CHAT_MODEL || 'google/gemini-3-flash-preview';
const SYSTEM = {};
function system(kind) { return (SYSTEM[kind] ||= fs.readFileSync(path.join(__dirname, 'qwenPrompts', `${kind}.md`), 'utf8').replace(/\r\n/g, '\n')); }

// El modelo de texto solo necesita ver la referencia: se manda a 1024 px en JPG para ahorrar tokens.
async function preview(dataUrl) {
    const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    const jpg = await sharp(buffer).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

function parse(text) {
    const answer = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
    const json = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1));
    const prompt = String(json.rewritten_prompt || '').replace(/\s+/g, ' ').trim();
    if (prompt.length < 20) throw new Error('respuesta sin rewritten_prompt');
    return prompt;
}

// Devuelve { prompt, cost }. Si algo falla se genera con el texto original: el mejorador no debe tumbar la imagen.
async function enhancePrompt({ prompt, references = [], aspect_ratio }) {
    if (!process.env.OPENROUTER_API_KEY) return { prompt, cost: null, error: 'sin OPENROUTER_API_KEY' };
    const edit = references.length > 0;
    const images = edit ? await Promise.all(references.map(ref => preview(ref.image_url.url))) : [];
    const text = edit ? prompt : `${prompt}\n\nAspect ratio: ${aspect_ratio || '1:1'}`;
    try {
        const response = await fetch(URL, {
            method: 'POST', timeout: 90000,
            headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://app.dekoormx.com', 'X-Title': 'Dekoor Imágenes' },
            body: JSON.stringify({
                model: MODEL(), temperature: 1,
                messages: [
                    { role: 'system', content: system(edit ? 'i2i' : 't2i') },
                    { role: 'user', content: [...images.map(url => ({ type: 'image_url', image_url: { url } })), { type: 'text', text }] },
                ],
            }),
        });
        if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
        const data = await response.json();
        const cost = Number(data.usage?.cost);
        return { prompt: parse(data.choices?.[0]?.message?.content), cost: Number.isFinite(cost) ? cost : null };
    } catch (err) {
        console.warn('[QWEN] No se pudo mejorar el prompt; se usa el original:', err.message);
        return { prompt, cost: null, error: err.message };
    }
}

module.exports = { enhancePrompt, parse };
