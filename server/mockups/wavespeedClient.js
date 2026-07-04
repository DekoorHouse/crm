// ===================================================================
// WaveSpeed AI — cliente para edición de imágenes (GPT Image 2 Edit)
// -------------------------------------------------------------------
// Genera el "preview" de una lámpara: foto base (URL pública) + prompt
// que cambia SOLO el texto grabado (nombres/fecha).
//
// GPT Image 2 puede tardar >90s, más de lo que aguanta una petición HTTP
// síncrona en Render. Por eso el cliente expone el flujo en 2 pasos y la
// espera la hace el FRONTEND (submit -> devuelve jobId; el front consulta
// el estado cada pocos segundos):
//   POST /api/v3/openai/gpt-image-2/edit      -> { data:{ id, urls:{ get } } }
//   GET  /api/v3/predictions/{id}/result      -> { data:{ status, outputs:[url] } }
// ===================================================================
const axios = require('axios');

const SUBMIT_URL = 'https://api.wavespeed.ai/api/v3/openai/gpt-image-2/edit';
const RESULT_URL = (id) => `https://api.wavespeed.ai/api/v3/predictions/${id}/result`;
const REQUEST_TIMEOUT_MS = 30000;

// Precio por imagen: WaveSpeed no reporta tokens para GPT Image 2. Estimado
// configurable (WAVESPEED_COST_PER_IMAGE en Render) para las stats de galería.
const COST_PER_IMAGE = parseFloat(process.env.WAVESPEED_COST_PER_IMAGE) || 0.04;

const API_KEY = () => process.env.WAVESPEED_API_KEY;

// Extrae las URLs de salida tolerando las MUCHAS formas posibles de respuesta.
function extractOutputs(data) {
    if (!data) return [];
    const acc = [];
    const push = (v) => { if (typeof v === 'string') acc.push(v); else if (v && (v.url || v.image)) acc.push(v.url || v.image); };
    if (Array.isArray(data.outputs)) data.outputs.forEach(push);
    else if (typeof data.outputs === 'string') acc.push(data.outputs);
    if (data.outputs && Array.isArray(data.outputs.images)) data.outputs.images.forEach(push);
    if (Array.isArray(data.result?.images)) data.result.images.forEach(push);
    if (Array.isArray(data.images)) data.images.forEach(push);
    if (Array.isArray(data.output)) data.output.forEach(push);
    else if (typeof data.output === 'string') acc.push(data.output);
    if (data.image && (data.image.url || typeof data.image === 'string')) acc.push(data.image.url || data.image);
    if (typeof data.url === 'string') acc.push(data.url);
    return acc.filter(v => typeof v === 'string' && /^https?:\/\//.test(v));
}

function getStatus(data) {
    return String((data && (data.status || data.state || data.task_status)) || '').toLowerCase();
}

// 1) Enviar la tarea. Devuelve el id de predicción para consultarla luego.
async function submitEdit(prompt, imageUrls, opts = {}) {
    const apiKey = API_KEY();
    if (!apiKey) throw new Error('WAVESPEED_API_KEY no está configurada.');
    if (!prompt || !prompt.trim()) throw new Error('Se requiere un prompt.');
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        throw new Error('Se requiere al menos una imagen base (URL pública).');
    }

    const { aspectRatio = '1:1', resolution = '1k', quality = 'high' } = opts;
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const submitBody = { images: imageUrls, prompt, aspect_ratio: aspectRatio, resolution, quality };

    let submit;
    try {
        submit = await axios.post(SUBMIT_URL, submitBody, { headers, timeout: REQUEST_TIMEOUT_MS });
    } catch (err) {
        const detail = err.response ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`WaveSpeed submit error ${err.response?.status || ''}: ${detail}`);
    }

    const submitData = submit.data?.data || submit.data || {};
    const predictionId = submitData.id;
    if (!predictionId) {
        throw new Error('WaveSpeed no devolvió un id de tarea. resp: ' + JSON.stringify(submit.data).slice(0, 300));
    }
    // A veces el submit ya trae la imagen (sync); lo pasamos por si acaso.
    return { predictionId, outputs: extractOutputs(submitData) };
}

// 2) Consultar el estado. status normalizado: 'processing' | 'completed' | 'failed'.
async function fetchResult(predictionId) {
    const apiKey = API_KEY();
    if (!apiKey) throw new Error('WAVESPEED_API_KEY no está configurada.');
    const headers = { Authorization: `Bearer ${apiKey}` };

    const poll = await axios.get(RESULT_URL(predictionId), { headers, timeout: REQUEST_TIMEOUT_MS });
    const pd = poll.data?.data || poll.data || {};
    const raw = getStatus(pd);
    const status = ['completed', 'succeeded', 'success', 'ready', 'done', 'finished'].includes(raw) ? 'completed'
        : ['failed', 'error', 'canceled', 'cancelled'].includes(raw) ? 'failed'
        : 'processing';
    return { status, rawStatus: raw, outputs: extractOutputs(pd), error: pd.error || '' };
}

// 3) Descargar una imagen resultante a { mimeType, base64 } para saveToGallery.
async function downloadImage(url) {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: REQUEST_TIMEOUT_MS });
    return { mimeType: resp.headers['content-type'] || 'image/png', base64: Buffer.from(resp.data).toString('base64') };
}

// Objeto de costo compatible con saveToGallery.
function costFor(n) {
    const imagesCost = COST_PER_IMAGE * n;
    return { perImage: COST_PER_IMAGE, imagesCost, inputTokenCost: 0, total: imagesCost };
}

module.exports = { submitEdit, fetchResult, downloadImage, costFor, COST_PER_IMAGE };
