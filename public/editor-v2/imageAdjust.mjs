// Image adjustments are stored as parameters; the original pixels are never modified.
// adjustPixels draws both the editor view and the exported file, so what you see is what you export.
export const IMAGE_ADJUSTMENTS = [
    { key: 'desaturate', label: 'Desaturar', min: 0, max: 100 },
    { key: 'contrast', label: 'Contraste', min: -100, max: 100 },
    { key: 'brightness', label: 'Brillo', min: -100, max: 100 },
    { key: 'sharpness', label: 'Nitidez', min: 0, max: 100 },
];

// Returns null when nothing changes, so an image without adjustments carries no field at all.
export function normalizeAdjust(input) {
    if (!input || typeof input !== 'object') throw new Error('Ajustes de imagen inválidos.');
    const adjust = {};
    for (const { key, min, max } of IMAGE_ADJUSTMENTS) {
        const value = input[key] ?? 0;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Ajustes de imagen inválidos.');
        adjust[key] = value;
    }
    if (input.invert !== undefined && typeof input.invert !== 'boolean') throw new Error('Ajustes de imagen inválidos.');
    if (input.invert) adjust.invert = true;
    return Object.values(adjust).some(Boolean) ? adjust : null;
}

// RGBA pixels in, new RGBA pixels out: desaturate, brightness, contrast, sharpen, then invert. Alpha is kept.
export function adjustPixels(source, width, height, adjust) {
    const result = tonePixels(source, width, height, adjust);
    if (adjust?.invert) for (let i = 0; i < result.length; i += 4) { result[i] = 255 - result[i]; result[i + 1] = 255 - result[i + 1]; result[i + 2] = 255 - result[i + 2]; }
    return result;
}
function tonePixels(source, width, height, adjust) {
    const { desaturate = 0, contrast = 0, brightness = 0, sharpness = 0 } = adjust || {};
    const amount = desaturate / 100, gain = (1 + brightness / 100) / 255, slope = 1 + contrast / 100, s = sharpness / 100;
    const toned = new Uint8ClampedArray(source.length);
    for (let i = 0; i < source.length; i += 4) {
        let r = source[i], g = source[i + 1], b = source[i + 2];
        if (amount) {
            const gray = .2126 * r + .7152 * g + .0722 * b;
            r += (gray - r) * amount; g += (gray - g) * amount; b += (gray - b) * amount;
        }
        toned[i] = ((r * gain - .5) * slope + .5) * 255;
        toned[i + 1] = ((g * gain - .5) * slope + .5) * 255;
        toned[i + 2] = ((b * gain - .5) * slope + .5) * 255;
        toned[i + 3] = source[i + 3];
    }
    if (!s) return toned;
    // 3×3 Laplacian sharpen. Borders repeat the edge pixel and transparent neighbours count as the
    // centre, so cut-out images do not get dark halos.
    const sharp = new Uint8ClampedArray(toned.length), row = width * 4, weight = 1 + 4 * s;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * row + x * 4;
            const left = x > 0 ? i - 4 : i, right = x < width - 1 ? i + 4 : i, up = y > 0 ? i - row : i, down = y < height - 1 ? i + row : i;
            for (let k = 0; k < 3; k++) {
                const centre = toned[i + k];
                const around = (toned[left + 3] ? toned[left + k] : centre) + (toned[right + 3] ? toned[right + k] : centre) +
                    (toned[up + 3] ? toned[up + k] : centre) + (toned[down + 3] ? toned[down + k] : centre);
                sharp[i + k] = centre * weight - s * around;
            }
            sharp[i + 3] = toned[i + 3];
        }
    }
    return sharp;
}

// --- Browser helpers ---
const decoded = new Map();
// Large data URLs are compared by length and ends instead of hashing megabytes on every render.
export const sourceKey = src => `${src.length}:${src.slice(0, 96)}:${src.slice(-96)}`;
function decode(src) {
    const key = sourceKey(src);
    if (!decoded.has(key)) {
        const image = new Image(); image.src = src;
        decoded.set(key, image.decode().then(() => image));
        decoded.get(key).catch(() => decoded.delete(key));
        if (decoded.size > 4) decoded.delete(decoded.keys().next().value);
    }
    return decoded.get(key);
}
function pixelCanvas(width, height) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    return [canvas, canvas.getContext('2d', { willReadFrequently: true })];
}
// fast: scale the source down first (slider preview). Otherwise process at full size and then scale,
// so the view shows the same sharpening as the export.
export async function renderAdjusted(src, adjust, { maxSize = Infinity, fast = false } = {}) {
    const image = await decode(src), naturalWidth = image.naturalWidth, naturalHeight = image.naturalHeight;
    const scale = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight));
    const size = factor => [Math.max(1, Math.round(naturalWidth * factor)), Math.max(1, Math.round(naturalHeight * factor))];
    // Without sharpening every step is per pixel, so processing the smaller copy gives the same result.
    const [width, height] = size(fast || !adjust?.sharpness ? scale : 1);
    const [canvas, context] = pixelCanvas(width, height);
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    pixels.data.set(adjustPixels(pixels.data, width, height, adjust));
    context.putImageData(pixels, 0, 0);
    if (width === size(scale)[0]) return canvas;
    const [view, viewContext] = pixelCanvas(...size(scale));
    viewContext.imageSmoothingQuality = 'high';
    viewContext.drawImage(canvas, 0, 0, view.width, view.height);
    return view;
}
// PNG keeps the view lossless; slider previews pass WebP because it encodes faster.
export function canvasBlob(canvas, type = 'image/png') {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen.')), type, .92));
}
// Full-resolution pixels in the original format, ready to embed in the SVG or PDF.
export async function bakeAdjustedSource(src, adjust) {
    const canvas = await renderAdjusted(src, adjust);
    const type = src.match(/^data:(image\/(?:png|jpeg|webp));/)?.[1] || 'image/png';
    const baked = canvas.toDataURL(type, .95);
    if (baked.length > 16000000) throw new Error('La imagen ajustada es demasiado grande para exportar.');
    return baked;
}
