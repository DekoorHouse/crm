// "Convertir a raster": asks an image model on OpenRouter, through the CRM's image studio API
// (/api/imagenes), for a black-and-white raster-engrave version of an image. The generation runs on the
// server and also appears in the Imágenes gallery; this module sends it and waits for the result.
export const RASTER_MODEL = 'openai/gpt-image-2.5-sunburst';
export const RASTER_PROMPT = 'dame el diseño de la imagen con rellenos blancos y fondos negros. En raster engrave con degradado en trama';

async function studio(path, token, options = {}) {
    const response = await fetch(`/api/imagenes${path}`, {
        ...options, credentials: 'same-origin',
        headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw Object.assign(new Error('Inicia sesión con tu cuenta del CRM para usar la IA.'), { login: true });
    if (!response.ok || data.success === false) throw new Error(data.error || 'El servidor no pudo atender la solicitud. Intenta de nuevo.');
    return data;
}

// The raster model with its aspect ratios, and whether the team has it linked in Imágenes.
export async function rasterModel(token) {
    const data = await studio('/models', token);
    const model = data.models.find(item => item.id === RASTER_MODEL);
    if (!model) throw new Error('El modelo GPT Image 2.5 Sunburst no está disponible en OpenRouter ahora mismo.');
    if (!data.connected) throw new Error('Falta conectar OpenRouter en el servidor.');
    return { model, linked: data.linkedIds.includes(RASTER_MODEL), ratios: model.parameters.aspect_ratio?.values || [] };
}
export const linkRasterModel = token => studio('/models', token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: RASTER_MODEL, action: 'link' }),
});

// Sends the image (a PNG or JPEG blob) and waits for the finished generation; returns its full-size URL.
export async function rasterize({ image, prompt, aspectRatio, token, onProgress = () => {}, signal }) {
    const body = new FormData();
    body.append('requestId', crypto.randomUUID());
    body.append('model', RASTER_MODEL);
    body.append('prompt', prompt);
    if (aspectRatio) body.append('aspect_ratio', aspectRatio);
    body.append('references', image, image.type === 'image/jpeg' ? 'imagen.jpg' : 'imagen.png');
    let { job } = await studio('/generations', await token(), { method: 'POST', body });
    const started = Date.now();
    while (job.status === 'generating') {
        if (signal?.aborted) throw new Error('Cancelado.');
        if (Date.now() - started > 6 * 60 * 1000) throw new Error('La IA tardó demasiado. Revisa la galería de Imágenes más tarde.');
        onProgress(Math.round((Date.now() - started) / 1000));
        await new Promise(resolve => setTimeout(resolve, 3000));
        ({ job } = await studio(`/generations/${job.id}`, await token()));
    }
    if (job.status !== 'completed' || !job.images?.[0]?.fullUrl) throw new Error(job.error || 'La IA no devolvió una imagen.');
    return { url: job.images[0].fullUrl, width: job.images[0].width, height: job.images[0].height, cost: job.cost };
}
