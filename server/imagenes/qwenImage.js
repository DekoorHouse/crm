'use strict';

// Qwen Image 2.1 como un modelo más de la sección Imágenes. Con referencias edita (la salida conserva el
// formato de la primera imagen); sin referencias crea desde texto. Los grafos son los de las plantillas
// oficiales de ComfyUI (image_qwen_image_2_1_image_edit / _t2i) aplanados al formato de la API.
const crypto = require('crypto');
const FormData = require('form-data');
const pod = require('./qwenPod');
const { enhancePrompt } = require('./qwenPromptEnhancer');

const MODEL_ID = 'dekoor/qwen-image-2.1';
const ASPECTS = ['1:1', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9'];
const POLL_MS = 2000;
const LIMIT_MS = 5 * 60 * 1000;
// Prueba A/B del 24-sep-2026 con la misma semilla: al crear, CFG 2.5 da un resultado más nítido (~60 % más tiempo);
// al editar, CFG 1 conserva el aspecto de grabado real y con más CFG el personaje sale "pintado". 40 pasos no mejoran nada.
const CFG = { create: 2.5, edit: 1 };

function failure(message, status = 502) { return Object.assign(new Error(message), { status }); }

function modelEntry() {
    return { id: MODEL_ID, name: 'Qwen Image 2.1 · GPU propia', local: true, parameters: {
        input_references: { type: 'range', min: 0, max: 4 },
        aspect_ratio: { type: 'enum', values: ASPECTS },
        resolution: { type: 'enum', values: ['1K', '2K'] },
    } };
}

// Tamaño en múltiplos de 32 con ~1 MP (1K) o ~4 MP (2K), la resolución nativa del modelo.
function outputSize(aspect = '1:1', resolution = '1K') {
    const [w, h] = aspect.split(':').map(Number);
    const side = resolution === '2K' ? 2048 : 1024;
    const round = value => Math.max(256, Math.round(value / 32) * 32);
    return { width: round(side * Math.sqrt(w / h)), height: round(side * Math.sqrt(h / w)) };
}

function buildWorkflow({ prompt, images = [], aspect_ratio, resolution, seed }) {
    const encoderImages = Object.fromEntries(images.map((_, i) => [`images.image_${i + 1}`, [`ref${i + 1}`, 0]]));
    const graph = {
        unet: { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' } },
        clip: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' } },
        vae: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
        encode: { class_type: 'TextEncodeQwenImage21', inputs: {
            clip: ['clip', 0], prompt, negative_prompt: '',
            resolution: resolution === '2K' ? 2048 : 1024, ...encoderImages,
        } },
        sampler: { class_type: 'KSampler', inputs: {
            model: [images.length ? 'cache' : 'unet', 0], positive: ['encode', 0], negative: ['encode', 1], latent_image: images.length ? ['encode', 2] : ['latent', 0],
            seed, steps: 25, cfg: images.length ? CFG.edit : CFG.create, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
        } },
        decode: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } },
        save: { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: 'crm' } },
    };
    images.forEach((name, i) => { graph[`ref${i + 1}`] = { class_type: 'LoadImage', inputs: { image: name } }; });
    // Con referencias, el codificador recibe el VAE y entrega el latente del tamaño de la primera imagen (plantilla de edición).
    if (images.length) {
        graph.cache = { class_type: 'QwenImage21Cache', inputs: { model: ['unet', 0], device: 'auto', dtype: 'default' } };
        graph.encode.inputs.vae = ['vae', 0];
    } else graph.latent = { class_type: 'EmptyLatentImage', inputs: { ...outputSize(aspect_ratio, resolution), batch_size: 1 } };
    return graph;
}

async function json(response, what) {
    if (!response.ok) throw failure(`La GPU no pudo ${what} (${response.status}).`);
    return response.json();
}

async function uploadReference(dataUrl, name) {
    const form = new FormData();
    form.append('image', Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'), { filename: name, contentType: 'image/png' });
    form.append('overwrite', 'true');
    const data = await json(await pod.comfy('/upload/image', { method: 'POST', body: form, headers: form.getHeaders() }), 'recibir la referencia');
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

function executionError(entry) {
    const error = (entry.status?.messages || []).find(([type]) => type === 'execution_error')?.[1];
    return String(error?.exception_message || 'error desconocido').replace(/\s+/g, ' ').trim().slice(0, 300);
}

// Mismo contrato que la respuesta de OpenRouter que consume runGeneration: { data: [{ b64_json }], usage: { cost } },
// más enhancedPrompt cuando el mejorador reescribió la descripción (el costo es solo el del mejorador; la GPU se paga por hora).
async function generate(request, jobId) {
    const status = await pod.getStatus();
    if (status.status !== 'ready') throw failure(`Qwen no está disponible: ${status.message}`, 503);
    await pod.markUsed();
    const references = request.input_references || [];
    const enhanced = request.enhance === false ? { prompt: request.prompt, cost: null }
        : await enhancePrompt({ prompt: request.prompt, references, aspect_ratio: request.aspect_ratio });
    const images = [];
    for (const [i, reference] of references.entries()) images.push(await uploadReference(reference.image_url.url, `crm_${jobId}_${i + 1}.png`));
    const workflow = buildWorkflow({ ...request, prompt: enhanced.prompt, images, seed: crypto.randomInt(0, 2 ** 48 - 1) });
    const queued = await json(await pod.comfy('/prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow }),
    }), 'aceptar la solicitud');
    if (!queued.prompt_id) throw failure('La GPU rechazó el flujo de Qwen.');
    const started = Date.now();
    while (Date.now() - started < LIMIT_MS) {
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
        const entry = (await json(await pod.comfy(`/history/${queued.prompt_id}`), 'informar el avance'))[queued.prompt_id];
        if (!entry?.status) continue;
        if (entry.status.status_str === 'error') throw failure(`Qwen no pudo generar la imagen: ${executionError(entry)}`);
        const image = entry.outputs?.save?.images?.[0];
        if (!entry.status.completed || !image) continue;
        const view = await pod.comfy(`/view?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type })}`);
        if (!view.ok) throw failure('No se pudo descargar la imagen de la GPU.');
        await pod.markUsed();
        return {
            data: [{ b64_json: Buffer.from(await view.arrayBuffer()).toString('base64') }],
            usage: { cost: enhanced.cost }, enhancedPrompt: enhanced.prompt !== request.prompt ? enhanced.prompt : null,
        };
    }
    throw failure('Qwen tardó demasiado en responder. Intenta de nuevo.', 504);
}

module.exports = { MODEL_ID, modelEntry, outputSize, buildWorkflow, generate };
