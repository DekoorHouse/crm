'use strict';

const crypto = require('crypto');
const fetch = require('node-fetch');
const sharp = require('sharp');
const { db, bucket } = require('../config');
const qwenPod = require('./qwenPod');
const qwenImage = require('./qwenImage');

const API = 'https://openrouter.ai/api/v1';
const COLLECTION = 'image_studio_generations';
const MAX_REFERENCES = 4;
const JOB_TTL_MS = 10 * 60 * 1000;
let catalogCache;
let catalogFlight;
function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function connected() { return !!process.env.OPENROUTER_API_KEY; }

async function getCatalog() {
    if (catalogCache && Date.now() - catalogCache.at < 15 * 60 * 1000) return catalogCache.models;
    if (catalogFlight) return catalogFlight;
    catalogFlight = (async () => {
        const response = await fetch(`${API}/images/models`, { timeout: 20000, size: 4 * 1024 * 1024 });
        if (!response.ok) throw failure('No se pudo consultar el catálogo de OpenRouter. Intenta de nuevo.', 503);
        const data = await response.json();
        if (!Array.isArray(data.data)) throw failure('OpenRouter devolvió un catálogo no válido.', 503);
        const models = data.data.filter(model => {
            const formats = model.supported_parameters?.output_format?.values;
            return model.architecture?.output_modalities?.includes('image') &&
                model.architecture?.input_modalities?.includes('text') &&
                !(Array.isArray(formats) && formats.length && formats.every(format => format === 'svg'));
        }).map(model => ({
            id: model.id, name: model.name || model.id,
            parameters: model.supported_parameters || {},
        })).sort((a, b) => a.name.localeCompare(b.name));
        if (!models.length) throw failure('No hay modelos de imagen disponibles en OpenRouter.', 503);
        if (qwenPod.enabled()) models.unshift(qwenImage.modelEntry());
        catalogCache = { models, at: Date.now() };
        return models;
    })();
    try { return await catalogFlight; }
    finally { catalogFlight = null; }
}

function defaultModels(catalog) {
    // Presets verificados en el catálogo de imágenes de OpenRouter (14-sep-2026).
    // Las selecciones guardadas por el equipo se conservan en configuredIds.
    const preferred = [
        process.env.OPENROUTER_IMAGE_MODEL,
        'openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2.5-flare', 'openai/gpt-5.4-image-2',
        'bytedance-seed/seedream-5-0-pro', 'bytedance-seed/seedream-5-0-lite',
        'qwen/qwen-image-3-pro', 'qwen/qwen-image-3',
        'google/gemini-3-pro-image-preview', 'google/gemini-3.1-flash-image', 'openai/gpt-image-2',
    ].filter(Boolean);
    return [...new Set(preferred)].filter(id => catalog.some(model => model.id === id));
}
function configuredIds(data, catalog) {
    return Array.isArray(data?.modelIds) ? data.modelIds : defaultModels(catalog);
}
async function getModels() {
    const catalog = await getCatalog();
    const snapshot = await db.collection('crm_settings').doc('image_studio').get();
    const linkedIds = configuredIds(snapshot.data(), catalog);
    // Qwen corre en la GPU propia: siempre está a mano mientras RunPod esté conectado.
    if (qwenPod.enabled() && !linkedIds.includes(qwenImage.MODEL_ID)) linkedIds.unshift(qwenImage.MODEL_ID);
    const qwen = qwenPod.enabled() ? await qwenPod.getStatus().catch(() => ({ status: 'error', message: 'No se pudo consultar la GPU.', error: true })) : null;
    return { connected: connected(), models: catalog, linkedIds, maxReferences: MAX_REFERENCES, qwen };
}
async function linkModel(id, action) {
    if (!['link', 'unlink'].includes(action)) throw failure('Acción de modelo no válida.');
    const catalog = await getCatalog();
    if (typeof id !== 'string' || (action === 'link' && !catalog.some(model => model.id === id))) throw failure('Elige un modelo de imágenes del catálogo.');
    const ref = db.collection('crm_settings').doc('image_studio');
    await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        const ids = new Set(configuredIds(snapshot.data(), catalog));
        if (action === 'link') ids.add(id); else ids.delete(id);
        if (ids.size > 50) throw failure('Puedes vincular hasta 50 modelos.');
        tx.set(ref, { modelIds: [...ids], updatedAt: new Date().toISOString() }, { merge: true });
    });
    return getModels();
}

function validateGeneration(fields, model, files = []) {
    const prompt = String(fields.prompt || '').trim();
    if (!prompt || prompt.length > 6000) throw failure('Describe la imagen en un máximo de 6,000 caracteres.');
    const referenceRange = model.parameters.input_references;
    const max = Math.min(MAX_REFERENCES, Number(referenceRange?.max) || 0);
    if (files.length > max) throw failure(`Este modelo admite hasta ${max} imágenes de referencia en esta sección.`);
    if (files.length < (Number(referenceRange?.min) || 0)) throw failure('Este modelo necesita al menos una imagen de referencia.');
    const request = { model: model.id, prompt, n: 1 };
    for (const key of ['aspect_ratio', 'resolution', 'quality']) {
        const value = fields[key];
        if (value == null || value === '') continue;
        const allowed = model.parameters[key]?.values;
        if (!Array.isArray(allowed) || !allowed.includes(value)) throw failure(`La opción ${key} no es compatible con este modelo.`);
        request[key] = value;
    }
    if (model.parameters.output_format?.values?.includes('png')) request.output_format = 'png';
    if (model.local) request.enhance = !['0', 'false'].includes(String(fields.enhance ?? '1'));
    return request;
}

async function prepareReferences(files) {
    const references = [];
    for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype) || file.buffer.length > 6 * 1024 * 1024) throw failure('Usa referencias PNG, JPG o WebP de hasta 6 MB.');
        try {
            const source = sharp(file.buffer, { limitInputPixels: 40 * 1000 * 1000 });
            const metadata = await source.metadata();
            if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('Formato inválido');
            const buffer = await source.rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
            references.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${buffer.toString('base64')}` } });
        } catch (_) { throw failure('Una referencia no se puede leer. Usa una imagen PNG, JPG o WebP válida.'); }
    }
    return references;
}

function requestFingerprint(request) { return crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex'); }
function publicJob(id, data) {
    let status = data.status;
    let error = data.error || null;
    if (status === 'generating' && Date.now() - Date.parse(data.createdAt) > JOB_TTL_MS) {
        status = 'interrupted';
        error = 'Esta generación se interrumpió. No se volvió a enviar automáticamente; puedes crear otra.';
    }
    return {
        id, status, error, prompt: data.prompt, modelId: data.modelId, modelName: data.modelName,
        options: data.options, referenceCount: data.referenceCount, createdAt: data.createdAt,
        images: data.images || [], cost: data.cost ?? null, enhancedPrompt: data.enhancedPrompt || null,
    };
}
async function getJob(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw failure('Generación no válida.');
    const snapshot = await db.collection(COLLECTION).doc(id).get();
    if (!snapshot.exists) throw failure('No se encontró esta generación.', 404);
    return publicJob(id, snapshot.data());
}
async function getGallery(before) {
    let query = db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(24);
    if (before) {
        if (!Number.isFinite(Date.parse(before))) throw failure('Fecha de galería no válida.');
        query = query.startAfter(before);
    }
    const snapshot = await query.get();
    const jobs = snapshot.docs.map(doc => publicJob(doc.id, doc.data()));
    return { jobs, nextCursor: jobs.length === 24 ? jobs[jobs.length - 1].createdAt : null };
}

// Borra para siempre una imagen de la galería compartida: sus archivos en Storage y su registro.
async function deleteGeneration(id, actor) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw failure('Generación no válida.');
    const ref = db.collection(COLLECTION).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw failure('No se encontró esta generación.', 404);
    if (publicJob(id, snapshot.data()).status === 'generating') throw failure('Espera a que termine esta imagen antes de borrarla.', 409);
    // Las de Qwen también dejan copias en la GPU. Se intenta borrarlas, pero no bloquean el borrado del CRM.
    if (snapshot.data().modelId === qwenImage.MODEL_ID) {
        await qwenPod.purge(id).then(result => { if (!result.skipped) console.log('[IMAGENES] Copias borradas del pod de Qwen:', id, JSON.stringify(result)); })
            .catch(err => console.warn('[IMAGENES] No se pudieron borrar las copias del pod de Qwen:', id, err.message));
    }
    const files = (snapshot.data().images || []).flatMap((_, index) => [`image_studio/${id}/${index}_full.png`, `image_studio/${id}/${index}_thumb.webp`]);
    await Promise.all(files.map(filePath => bucket.file(filePath).delete({ ignoreNotFound: true })));
    await ref.delete();
    console.log('[IMAGENES] Imagen borrada:', id, 'por', actor?.email || actor?.uid || 'worker');
}

async function saveOutput(id, entry, index) {
    if (typeof entry.b64_json !== 'string' || entry.b64_json.length > 30 * 1024 * 1024) throw failure('El modelo devolvió una imagen demasiado grande.', 502);
    const raw = Buffer.from(entry.b64_json, 'base64');
    const source = sharp(raw, { limitInputPixels: 50 * 1000 * 1000 });
    const meta = await source.metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format)) throw failure('El modelo devolvió un formato de imagen no compatible.', 502);
    const full = await source.png().toBuffer();
    const thumb = await sharp(full).resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const upload = async (suffix, buffer, contentType) => {
        const filePath = `image_studio/${id}/${index}_${suffix}`;
        const token = crypto.randomUUID();
        await bucket.file(filePath).save(buffer, { resumable: false, metadata: {
            contentType, cacheControl: 'private, max-age=3600', metadata: { firebaseStorageDownloadTokens: token },
        } });
        return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
    };
    const fullUrl = await upload('full.png', full, 'image/png');
    const thumbUrl = await upload('thumb.webp', thumb, 'image/webp');
    return { fullUrl, thumbUrl, width: meta.width, height: meta.height };
}

// OpenRouter explains a rejection in error.message, and the provider's own reason in error.metadata.raw
// (often a JSON string). Only that text is kept, trimmed, so the team can see why a request failed.
async function providerReason(response) {
    try {
        const body = typeof response.json === 'function' ? await response.json() : null;
        let reason = body?.error?.metadata?.raw ?? body?.error?.message;
        if (typeof reason === 'string') {
            try { const inner = JSON.parse(reason); reason = inner?.error?.message ?? inner?.message ?? reason; } catch (_) {}
        }
        return typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    } catch (_) { return ''; }
}

async function openRouterImages(request, jobId) {
    const response = await fetch(`${API}/images`, {
        method: 'POST', timeout: 240000, size: 40 * 1024 * 1024,
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://app.dekoormx.com', 'X-Title': 'Dekoor Imágenes' },
        body: JSON.stringify(request),
    });
    if (!response.ok) {
        const messages = {
            400: 'El modelo no pudo aceptar la solicitud. Revisa la descripción y las referencias.',
            401: 'La conexión de OpenRouter necesita revisión.',
            402: 'No hay saldo suficiente en OpenRouter. Recarga para generar imágenes.',
            403: 'OpenRouter no permite usar este modelo con la conexión actual.',
            429: 'El modelo está ocupado. Intenta de nuevo en unos minutos.',
        };
        const reason = await providerReason(response);
        if (reason) console.warn('[IMAGENES] OpenRouter rechazó la generación:', jobId, response.status, reason);
        const blocked = /safety|moderat|policy|content|violat|not allowed|public figure|real person/i.test(reason);
        const message = blocked
            ? 'OpenAI rechazó la imagen por sus políticas de contenido (por ejemplo, fotos de personas reales o famosas). Prueba con otra imagen.'
            : messages[response.status] || 'OpenRouter no pudo generar la imagen. Intenta de nuevo más tarde.';
        throw failure(reason ? `${message} Detalle: ${reason}` : message, 502);
    }
    return response.json();
}

async function runGeneration(ref, lockRef, request) {
    try {
        const data = request.model === qwenImage.MODEL_ID ? await qwenImage.generate(request, ref.id) : await openRouterImages(request, ref.id);
        if (!Array.isArray(data.data) || !data.data.length) throw failure('El modelo no devolvió una imagen. Prueba con otra descripción.', 502);
        const images = [];
        for (const [index, entry] of data.data.slice(0, 1).entries()) images.push(await saveOutput(ref.id, entry, index));
        const reportedCost = data.usage?.cost;
        await ref.update({ status: 'completed', images, ...(data.enhancedPrompt ? { enhancedPrompt: data.enhancedPrompt } : {}), cost: reportedCost != null && Number.isFinite(Number(reportedCost)) ? Number(reportedCost) : null, completedAt: new Date().toISOString() });
    } catch (err) {
        const error = err.status ? err.message : 'No se pudo completar o guardar la imagen. La solicitud no se reenvió automáticamente.';
        console.warn('[IMAGENES] Generación fallida:', ref.id, err.type || err.code || 'generation_error');
        await ref.update({ status: 'failed', error, completedAt: new Date().toISOString() }).catch(() => {});
    } finally {
        await db.runTransaction(async tx => {
            const snapshot = await tx.get(lockRef);
            if (snapshot.data()?.jobId === ref.id) tx.delete(lockRef);
        }).catch(() => {});
    }
}

async function createGeneration(fields, files, actor) {
    if (fields.model !== qwenImage.MODEL_ID && !connected()) throw failure('Falta conectar OpenRouter en el servidor.', 503);
    if (!/^[a-f0-9-]{36}$/i.test(fields.requestId || '')) throw failure('Identificador de generación no válido.');
    const { models, linkedIds, qwen } = await getModels();
    const model = models.find(m => m.id === fields.model);
    if (!model || !linkedIds.includes(model.id)) throw failure('Vincula y selecciona un modelo de imágenes disponible.');
    if (model.local && qwen?.status !== 'ready') throw failure(`Qwen no está disponible: ${qwen?.message || 'GPU apagada'}.`, 503);
    const request = validateGeneration(fields, model, files);
    if (files.length) request.input_references = await prepareReferences(files);
    const fingerprint = requestFingerprint(request);
    const ref = db.collection(COLLECTION).doc(fields.requestId);
    const owner = actor.uid || actor.email || 'worker';
    const lockRef = db.collection('image_studio_locks').doc(crypto.createHash('sha256').update(owner).digest('hex'));
    const job = {
        status: 'generating', prompt: request.prompt, modelId: model.id, modelName: model.name,
        options: Object.fromEntries(['aspect_ratio', 'resolution', 'quality'].filter(k => request[k]).map(k => [k, request[k]])),
        referenceCount: files.length, createdAt: new Date().toISOString(), fingerprint, owner,
    };
    const created = await db.runTransaction(async tx => {
        const [existing, lock] = await Promise.all([tx.get(ref), tx.get(lockRef)]);
        if (existing.exists) {
            if (existing.data().owner !== owner || existing.data().fingerprint !== fingerprint) throw failure('Este identificador ya se usó para otra generación.', 409);
            return false;
        }
        if (lock.exists && lock.data().expiresAt > Date.now()) throw failure('Ya tienes una imagen en proceso. Espera a que termine antes de generar otra.', 409);
        tx.set(ref, job);
        tx.set(lockRef, { jobId: ref.id, expiresAt: Date.now() + JOB_TTL_MS });
        return true;
    });
    if (created) void runGeneration(ref, lockRef, request);
    return created ? publicJob(ref.id, job) : getJob(ref.id);
}

module.exports = { getModels, linkModel, getGallery, getJob, createGeneration, deleteGeneration, validateGeneration, publicJob, prepareReferences };
