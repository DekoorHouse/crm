// ===================================================================
// WaveSpeed AI — cliente para edición de imágenes (GPT Image 2 Edit)
// -------------------------------------------------------------------
// Se usa para generar el "preview" de una lámpara: se le pasa la foto
// base (URL pública) + un prompt que cambia SOLO el texto grabado
// (nombres/fecha). Devuelve el resultado en la MISMA forma que consume
// mockupsService.saveToGallery() -> { images:[{mimeType,base64}], usage, cost }
// para reutilizar toda la galería/almacenamiento existentes.
//
// Flujo asíncrono de WaveSpeed:
//   POST  /api/v3/openai/gpt-image-2/edit           -> { data:{ id, urls:{ get } } }
//   GET   /api/v3/predictions/{id}/result           -> { data:{ status, outputs:[url] } }
// ===================================================================
const axios = require('axios');

const SUBMIT_URL = 'https://api.wavespeed.ai/api/v3/openai/gpt-image-2/edit';
const RESULT_URL = (id) => `https://api.wavespeed.ai/api/v3/predictions/${id}/result`;

const POLL_INTERVAL_MS = 2000;   // esperar 2s entre consultas (recomendado por WaveSpeed)
const MAX_POLL_ATTEMPTS = 45;    // ~90s máximo antes de rendirse
const REQUEST_TIMEOUT_MS = 30000;

// Precio por imagen: WaveSpeed no reporta uso de tokens para GPT Image 2.
// Es un estimado configurable para que las estadísticas de la galería no
// engañen. Ajustar WAVESPEED_COST_PER_IMAGE en Render con el precio real.
const COST_PER_IMAGE = parseFloat(process.env.WAVESPEED_COST_PER_IMAGE) || 0.04;

const API_KEY = () => process.env.WAVESPEED_API_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extrae las URLs de salida tolerando las distintas formas de respuesta.
function extractOutputs(data) {
    if (!data) return [];
    // Forma canónica v3: data.outputs = [url, ...]
    if (Array.isArray(data.outputs)) return data.outputs.filter(Boolean);
    // Variante: data.result.images = [{ url }] | [url]
    const imgs = data.result?.images;
    if (Array.isArray(imgs)) return imgs.map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean);
    return [];
}

function getStatus(data) {
    return (data && (data.status || data.state)) || '';
}

/**
 * Genera una edición de imagen con GPT Image 2 (WaveSpeed).
 * @param {string} prompt   Instrucción de edición.
 * @param {string[]} imageUrls  URLs públicas de las imágenes base (1..n).
 * @param {object} opts     { aspectRatio, resolution, quality }
 * @returns {Promise<{images:{mimeType,base64}[], usage:object, cost:object}>}
 */
async function generateEdit(prompt, imageUrls, opts = {}) {
    const apiKey = API_KEY();
    if (!apiKey) throw new Error('WAVESPEED_API_KEY no está configurada.');
    if (!prompt || !prompt.trim()) throw new Error('Se requiere un prompt.');
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        throw new Error('Se requiere al menos una imagen base (URL pública).');
    }

    const { aspectRatio = '1:1', resolution = '1k', quality = 'high' } = opts;
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // 1) Enviar la tarea
    const submitBody = {
        images: imageUrls,
        prompt,
        aspect_ratio: aspectRatio,
        resolution,
        quality,
    };

    let submit;
    try {
        submit = await axios.post(SUBMIT_URL, submitBody, { headers, timeout: REQUEST_TIMEOUT_MS });
    } catch (err) {
        const detail = err.response ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`WaveSpeed submit error ${err.response?.status || ''}: ${detail}`);
    }

    const submitData = submit.data?.data || submit.data || {};
    const taskId = submitData.id;
    // Algunas respuestas ya traen el resultado (sync); si no, hay que hacer polling.
    let outputs = extractOutputs(submitData);
    const getUrl = submitData.urls?.get || (taskId ? RESULT_URL(taskId) : null);

    // 2) Polling hasta completar
    if (outputs.length === 0) {
        if (!getUrl) throw new Error('WaveSpeed no devolvió un id de tarea ni resultado.');
        let attempts = 0;
        while (attempts < MAX_POLL_ATTEMPTS) {
            await sleep(POLL_INTERVAL_MS);
            attempts++;
            let poll;
            try {
                poll = await axios.get(getUrl, { headers, timeout: REQUEST_TIMEOUT_MS });
            } catch (err) {
                // Un fallo puntual de red no aborta: reintenta en la siguiente vuelta.
                if (attempts >= MAX_POLL_ATTEMPTS) {
                    throw new Error(`WaveSpeed poll error: ${err.response ? JSON.stringify(err.response.data) : err.message}`);
                }
                continue;
            }
            const pd = poll.data?.data || poll.data || {};
            const status = getStatus(pd).toLowerCase();
            if (status === 'completed' || status === 'succeeded' || status === 'success') {
                outputs = extractOutputs(pd);
                break;
            }
            if (status === 'failed' || status === 'error') {
                throw new Error(`WaveSpeed falló: ${pd.error || 'error desconocido'}`);
            }
            // created / processing / queued -> seguir esperando
        }
        if (outputs.length === 0) {
            throw new Error('WaveSpeed no completó a tiempo (timeout de generación).');
        }
    }

    // 3) Descargar la(s) imagen(es) resultante(s) a base64
    const images = [];
    for (const url of outputs) {
        const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: REQUEST_TIMEOUT_MS });
        const mimeType = resp.headers['content-type'] || 'image/png';
        images.push({ mimeType, base64: Buffer.from(resp.data).toString('base64') });
    }

    const imagesCost = COST_PER_IMAGE * images.length;
    return {
        images,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost: { perImage: COST_PER_IMAGE, imagesCost, inputTokenCost: 0, total: imagesCost },
    };
}

module.exports = { generateEdit };
