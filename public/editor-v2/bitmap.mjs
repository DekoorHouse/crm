// "Convertir a mapa de bits": turns an image into pure black and white (1 bit) at the exact resolution
// the laser engraves, like CorelDRAW's black-and-white bitmap conversion. Black is what K40 Whisperer
// burns. Transparent areas count as white, so they are never burned.
export const BITMAP_METHODS = {
    threshold: 'Umbral (para imágenes que ya traen trama)',
    diffusion: 'Difuminado Floyd–Steinberg (fotos)',
    ordered: 'Trama ordenada (patrón regular)',
};
export const MAX_BITMAP_SIDE = 8000;

// Pixels for a size in millimetres at a resolution in dots per inch.
export function bitmapSize(widthMm, heightMm, dpi) {
    const side = mm => Math.max(1, Math.round(mm / 25.4 * dpi));
    const width = side(widthMm), height = side(heightMm);
    if (width > MAX_BITMAP_SIDE || height > MAX_BITMAP_SIDE) throw new Error(`Con esa resolución el mapa de bits pasaría de ${MAX_BITMAP_SIDE} px por lado. Baja los DPI o el tamaño.`);
    return { width, height };
}
export const stepToDpi = mm => 25.4 / mm;
export const dpiToStep = dpi => 25.4 / dpi;

// Brightness 0–255 of each pixel over white (Rec. 709 luminance).
function greys(rgba) {
    const out = new Float32Array(rgba.length / 4);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
        const lum = .2126 * rgba[i] + .7152 * rgba[i + 1] + .0722 * rgba[i + 2], alpha = rgba[i + 3] / 255;
        out[p] = lum * alpha + 255 * (1 - alpha);
    }
    return out;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// RGBA in, RGBA out with only black (0) and white (255) opaque pixels.
export function toBitmap(rgba, width, height, { method = 'threshold', threshold = 128 } = {}) {
    const grey = greys(rgba), out = new Uint8ClampedArray(width * height * 4);
    const set = (p, black) => { const v = black ? 0 : 255; out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = v; out[p * 4 + 3] = 255; };
    if (method === 'diffusion') {
        // Floyd–Steinberg, serpentine so the error does not drift to one side.
        for (let y = 0; y < height; y++) {
            const forward = y % 2 === 0;
            for (let step = 0; step < width; step++) {
                const x = forward ? step : width - 1 - step, p = y * width + x, old = grey[p], black = old < threshold;
                set(p, black);
                const error = old - (black ? 0 : 255), dir = forward ? 1 : -1;
                const spread = (dx, dy, share) => { const nx = x + dx * dir, ny = y + dy; if (nx >= 0 && nx < width && ny < height) grey[ny * width + nx] += error * share; };
                spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
            }
        }
    } else if (method === 'ordered') {
        // A 4×4 Bayer matrix centred on the threshold, so it moves the same way as with Umbral.
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const p = y * width + x, offset = (BAYER[(y % 4) * 4 + (x % 4)] + .5) / 16 * 255 - 127.5;
            set(p, grey[p] < threshold + offset);
        }
    } else {
        for (let p = 0; p < width * height; p++) set(p, grey[p] < threshold);
    }
    return out;
}

// PNG files can say their resolution (pHYs chunk); other programs then know the real size.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function pngWithDpi(png, dpi) {
    const bytes = new Uint8Array(png), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 33 || view.getUint32(12) !== 0x49484452) throw new Error('No es un PNG válido.');
    const perMetre = Math.round(dpi / .0254), chunk = new Uint8Array(21), out = new DataView(chunk.buffer);
    out.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4);
    out.setUint32(8, perMetre); out.setUint32(12, perMetre); chunk[16] = 1;
    out.setUint32(17, crc32(chunk.subarray(4, 17)));
    // After the signature (8 bytes) and IHDR (25 bytes); an existing pHYs chunk is dropped.
    const rest = [];
    for (let at = 33; at < bytes.length;) {
        const length = view.getUint32(at), type = view.getUint32(at + 4), end = at + 12 + length;
        if (type !== 0x70485973) rest.push(bytes.subarray(at, end));
        at = end;
    }
    const total = 33 + chunk.length + rest.reduce((sum, part) => sum + part.length, 0), result = new Uint8Array(total);
    result.set(bytes.subarray(0, 33)); result.set(chunk, 33);
    let offset = 33 + chunk.length;
    for (const part of rest) { result.set(part, offset); offset += part.length; }
    return result;
}
