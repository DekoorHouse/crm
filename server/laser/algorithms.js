'use strict';

// ───────── Error Diffusion Dithering ─────────

function ditherAtkinson(gray, w, h) {
    const buf = new Float32Array(gray);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, old = buf[i], nw = old > 128 ? 255 : 0;
        out[i] = nw;
        const d = (old - nw) / 8;
        if (x + 1 < w) buf[i + 1] += d;
        if (x + 2 < w) buf[i + 2] += d;
        if (x - 1 >= 0 && y + 1 < h) buf[i - 1 + w] += d;
        if (y + 1 < h) buf[i + w] += d;
        if (x + 1 < w && y + 1 < h) buf[i + 1 + w] += d;
        if (y + 2 < h) buf[i + 2 * w] += d;
    }
    return out;
}

function ditherFloydSteinberg(gray, w, h) {
    const buf = new Float32Array(gray);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, old = buf[i], nw = old > 128 ? 255 : 0;
        out[i] = nw;
        const err = old - nw;
        if (x + 1 < w) buf[i + 1] += err * 7 / 16;
        if (x - 1 >= 0 && y + 1 < h) buf[i - 1 + w] += err * 3 / 16;
        if (y + 1 < h) buf[i + w] += err * 5 / 16;
        if (x + 1 < w && y + 1 < h) buf[i + 1 + w] += err * 1 / 16;
    }
    return out;
}

function ditherStucki(gray, w, h) {
    const buf = new Float32Array(gray);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, old = buf[i], nw = old > 128 ? 255 : 0;
        out[i] = nw;
        const err = old - nw;
        if (x + 1 < w) buf[i + 1] += err * 8 / 42;
        if (x + 2 < w) buf[i + 2] += err * 4 / 42;
        if (y + 1 < h) {
            if (x - 2 >= 0) buf[i - 2 + w] += err * 2 / 42;
            if (x - 1 >= 0) buf[i - 1 + w] += err * 4 / 42;
            buf[i + w] += err * 8 / 42;
            if (x + 1 < w) buf[i + 1 + w] += err * 4 / 42;
            if (x + 2 < w) buf[i + 2 + w] += err * 2 / 42;
        }
        if (y + 2 < h) {
            const w2 = 2 * w;
            if (x - 2 >= 0) buf[i - 2 + w2] += err * 1 / 42;
            if (x - 1 >= 0) buf[i - 1 + w2] += err * 2 / 42;
            buf[i + w2] += err * 4 / 42;
            if (x + 1 < w) buf[i + 1 + w2] += err * 2 / 42;
            if (x + 2 < w) buf[i + 2 + w2] += err * 1 / 42;
        }
    }
    return out;
}

function ditherJarvis(gray, w, h) {
    const buf = new Float32Array(gray);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, old = buf[i], nw = old > 128 ? 255 : 0;
        out[i] = nw;
        const err = old - nw;
        if (x + 1 < w) buf[i + 1] += err * 7 / 48;
        if (x + 2 < w) buf[i + 2] += err * 5 / 48;
        if (y + 1 < h) {
            if (x - 2 >= 0) buf[i - 2 + w] += err * 3 / 48;
            if (x - 1 >= 0) buf[i - 1 + w] += err * 5 / 48;
            buf[i + w] += err * 7 / 48;
            if (x + 1 < w) buf[i + 1 + w] += err * 5 / 48;
            if (x + 2 < w) buf[i + 2 + w] += err * 3 / 48;
        }
        if (y + 2 < h) {
            const w2 = 2 * w;
            if (x - 2 >= 0) buf[i - 2 + w2] += err * 1 / 48;
            if (x - 1 >= 0) buf[i - 1 + w2] += err * 3 / 48;
            buf[i + w2] += err * 5 / 48;
            if (x + 1 < w) buf[i + 1 + w2] += err * 3 / 48;
            if (x + 2 < w) buf[i + 2 + w2] += err * 1 / 48;
        }
    }
    return out;
}

function ditherSierra(gray, w, h) {
    const buf = new Float32Array(gray);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, old = buf[i], nw = old > 128 ? 255 : 0;
        out[i] = nw;
        const err = old - nw;
        if (x + 1 < w) buf[i + 1] += err * 5 / 32;
        if (x + 2 < w) buf[i + 2] += err * 3 / 32;
        if (y + 1 < h) {
            if (x - 2 >= 0) buf[i - 2 + w] += err * 2 / 32;
            if (x - 1 >= 0) buf[i - 1 + w] += err * 4 / 32;
            buf[i + w] += err * 5 / 32;
            if (x + 1 < w) buf[i + 1 + w] += err * 4 / 32;
            if (x + 2 < w) buf[i + 2 + w] += err * 2 / 32;
        }
        if (y + 2 < h) {
            const w2 = 2 * w;
            if (x - 1 >= 0) buf[i - 1 + w2] += err * 2 / 32;
            buf[i + w2] += err * 3 / 32;
            if (x + 1 < w) buf[i + 1 + w2] += err * 2 / 32;
        }
    }
    return out;
}

function ditherSierraLite(gray, w, h) {
    const buf = new Float32Array(gray);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, old = buf[i], nw = old > 128 ? 255 : 0;
        out[i] = nw;
        const err = old - nw;
        if (x + 1 < w) buf[i + 1] += err * 2 / 4;
        if (x - 1 >= 0 && y + 1 < h) buf[i - 1 + w] += err * 1 / 4;
        if (y + 1 < h) buf[i + w] += err * 1 / 4;
    }
    return out;
}

function ditherBurkes(gray, w, h) {
    const buf = new Float32Array(gray);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, old = buf[i], nw = old > 128 ? 255 : 0;
        out[i] = nw;
        const err = old - nw;
        if (x + 1 < w) buf[i + 1] += err * 8 / 32;
        if (x + 2 < w) buf[i + 2] += err * 4 / 32;
        if (y + 1 < h) {
            if (x - 2 >= 0) buf[i - 2 + w] += err * 2 / 32;
            if (x - 1 >= 0) buf[i - 1 + w] += err * 4 / 32;
            buf[i + w] += err * 8 / 32;
            if (x + 1 < w) buf[i + 1 + w] += err * 4 / 32;
            if (x + 2 < w) buf[i + 2 + w] += err * 2 / 32;
        }
    }
    return out;
}

// ───────── Ordered / Pattern Dithering ─────────

function ditherHalftone(gray, w, h) {
    const out = new Uint8Array(w * h);
    const cs = Math.max(4, Math.round(w / 350));
    for (let cy = 0; cy < h; cy += cs) for (let cx = 0; cx < w; cx += cs) {
        let sum = 0, cnt = 0;
        for (let dy = 0; dy < cs && cy + dy < h; dy++)
            for (let dx = 0; dx < cs && cx + dx < w; dx++) { sum += gray[(cy + dy) * w + (cx + dx)]; cnt++; }
        const r = cs / 2 * Math.sqrt(1 - sum / cnt / 255), mx = cx + cs / 2, my = cy + cs / 2;
        for (let dy = 0; dy < cs && cy + dy < h; dy++)
            for (let dx = 0; dx < cs && cx + dx < w; dx++)
                out[(cy + dy) * w + (cx + dx)] = Math.sqrt((cx + dx - mx) ** 2 + (cy + dy - my) ** 2) <= r ? 0 : 255;
    }
    return out;
}

function ditherBayer(gray, w, h, size) {
    const out = new Uint8Array(w * h);
    const m4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    const m8 = [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22], [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]];
    const m = size === 8 ? m8 : m4, n = m.length, d = n * n;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        out[y * w + x] = gray[y * w + x] > ((m[y % n][x % n] + 0.5) / d) * 255 ? 255 : 0;
    return out;
}

function ditherThreshold(gray, w, h, threshold) {
    const out = new Uint8Array(w * h);
    const t = threshold || 128;
    for (let i = 0; i < w * h; i++) out[i] = gray[i] > t ? 255 : 0;
    return out;
}

// ───────── Dispatcher ─────────

const ALGORITHMS = {
    'atkinson': ditherAtkinson,
    'floyd-steinberg': ditherFloydSteinberg,
    'stucki': ditherStucki,
    'jarvis': ditherJarvis,
    'sierra': ditherSierra,
    'sierra-lite': ditherSierraLite,
    'burkes': ditherBurkes,
    'halftone': ditherHalftone,
    'threshold': ditherThreshold,
};

function applyDither(gray, w, h, algorithm, options = {}) {
    if (algorithm === 'bayer4') return ditherBayer(gray, w, h, 4);
    if (algorithm === 'bayer8') return ditherBayer(gray, w, h, 8);
    const fn = ALGORITHMS[algorithm] || ditherAtkinson;
    if (algorithm === 'threshold') return fn(gray, w, h, options.threshold);
    return fn(gray, w, h);
}

module.exports = { applyDither, ALGORITHMS: Object.keys(ALGORITHMS).concat(['bayer4', 'bayer8']) };
