'use strict';
const sharp = require('sharp');
const crypto = require('crypto');
const { applyDither } = require('./algorithms');

const WORK_W = 400, WORK_H = 400;

// ───────── Session Store ─────────
const sessions = new Map();
const SESSION_TTL = 10 * 60 * 1000; // 10 min

setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
        if (now - s.createdAt > SESSION_TTL) sessions.delete(id);
    }
}, 60_000);

function deleteSession(id) { sessions.delete(id); }

// ───────── SVG Background Removal ─────────
function stripSvgBackground(svgBuffer) {
    let svgStr = svgBuffer.toString('utf8');
    // Parse viewBox or width/height to find SVG dimensions
    const vbMatch = svgStr.match(/viewBox\s*=\s*"([^"]+)"/);
    const wMatch = svgStr.match(/<svg[^>]+width\s*=\s*"([^"]+)"/);
    const hMatch = svgStr.match(/<svg[^>]+height\s*=\s*"([^"]+)"/);
    let svgW, svgH;
    if (vbMatch) {
        const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
        svgW = parts[2]; svgH = parts[3];
    } else {
        svgW = parseFloat(wMatch?.[1]) || 300;
        svgH = parseFloat(hMatch?.[1]) || 200;
    }
    // Remove first background rect (full size, white fill)
    svgStr = svgStr.replace(
        /<rect([^>]*?)\/>/i,
        (match, attrs) => {
            const x = parseFloat((attrs.match(/\bx\s*=\s*"([^"]+)"/) || [])[1] || 0);
            const y = parseFloat((attrs.match(/\by\s*=\s*"([^"]+)"/) || [])[1] || 0);
            const w = parseFloat((attrs.match(/\bwidth\s*=\s*"([^"]+)"/) || [])[1] || 0);
            const h = parseFloat((attrs.match(/\bheight\s*=\s*"([^"]+)"/) || [])[1] || 0);
            const fill = ((attrs.match(/\bfill\s*=\s*"([^"]+)"/) || [])[1] || '').toLowerCase().replace(/\s/g, '');
            if (x <= 0 && y <= 0 && Math.abs(w - svgW) < 1 && Math.abs(h - svgH) < 1 &&
                (fill === '' || fill === 'white' || fill === '#ffffff' || fill === '#fff' || fill === 'rgb(255,255,255)')) {
                return ''; // Remove background rect
            }
            return match; // Keep non-background rects
        }
    );
    return Buffer.from(svgStr);
}

// ───────── SVG Cut Line Removal ─────────
// Remove geometric cut shapes (circle, ellipse, line, polyline, polygon) with stroke
// These are cut outlines in laser workflows — keep paths, images, text, rects
function stripSvgCutLines(svgBuffer) {
    let svgStr = svgBuffer.toString('utf8');
    // Remove circle, ellipse, line, polyline, polygon elements that have a stroke
    svgStr = svgStr.replace(
        /<(circle|ellipse|line|polyline|polygon)\b([^>]*?)(?:\/>|>[\s\S]*?<\/\1>)/gi,
        (match, tag, attrs) => {
            const hasStrokeAttr = /\bstroke\s*=\s*"(?!none)/.test(attrs);
            const hasStrokeStyle = /style\s*=\s*"[^"]*stroke\s*:/i.test(attrs);
            if (hasStrokeAttr || hasStrokeStyle) return ''; // Remove cut shape
            return match;
        }
    );
    return Buffer.from(svgStr);
}

// ───────── Create Session ─────────
async function createSession(imageBuffer, originalName, options) {
    const isSvg = originalName.toLowerCase().endsWith('.svg');
    const dpi = Math.max(150, Math.min(1500, options.dpi || 1000));
    const lineSpacing = Math.max(1, Math.min(10, options.lineSpacing || 1));
    const dpmm = dpi / 25.4;

    let imgBuffer = imageBuffer;
    if (isSvg) {
        imgBuffer = stripSvgBackground(imageBuffer);
        imgBuffer = stripSvgCutLines(imgBuffer);
    }

    // For SVGs, pass density so Sharp/librsvg knows the render resolution.
    // If Sharp can't decode the format, try converting to PNG first.
    const sharpOpts = isSvg ? { density: Math.min(dpi, 600) } : {};
    let meta;
    try {
        meta = await sharp(imgBuffer, sharpOpts).metadata();
    } catch (decodeErr) {
        // Retry: force-convert to PNG via Sharp's built-in format negotiation
        try {
            const pngBuf = await sharp(imgBuffer, { failOn: 'none', ...sharpOpts })
                .png().toBuffer();
            imgBuffer = pngBuf;
            meta = await sharp(imgBuffer).metadata();
        } catch (_) {
            throw new Error('Formato de imagen no soportado: ' + decodeErr.message);
        }
    }
    const imgW = meta.width, imgH = meta.height;
    const pxToMm = 25.4 / (meta.density || 96);

    // Calculate physical dimensions
    const fullMmW = imgW * pxToMm, fullMmH = imgH * pxToMm;
    const fit = Math.min(WORK_W / fullMmW, WORK_H / fullMmH, 1);

    // BBox cropping for SVGs
    let cropMmX = 0, cropMmY = 0, cropMmW, cropMmH;
    if (options.bboxMmX != null) {
        cropMmX = options.bboxMmX;
        cropMmY = options.bboxMmY;
        cropMmW = options.bboxMmW;
        cropMmH = options.bboxMmH;
    } else {
        cropMmW = fullMmW * fit;
        cropMmH = fullMmH * fit;
    }

    const pxW = Math.round(cropMmW * dpmm);
    const pxH = Math.round(cropMmH * dpmm / lineSpacing);

    // Render full image to target size
    const fullPxW = Math.round(fullMmW * fit * dpmm);
    const fullPxH = Math.round(fullMmH * fit * dpmm / lineSpacing);

    // Decode to RGBA, resize, extract region
    let pipeline = sharp(imgBuffer, sharpOpts).resize(fullPxW, fullPxH, { fit: 'fill' }).ensureAlpha();
    const { data: rgba, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

    // Extract crop region
    const srcX = Math.round(cropMmX / (fullMmW * fit) * fullPxW);
    const srcY = Math.round(cropMmY / (fullMmH * fit) * fullPxH);

    // Convert RGBA to grayscale Float32Array (with alpha compositing)
    const gray = new Float32Array(pxW * pxH);
    for (let y = 0; y < pxH; y++) {
        for (let x = 0; x < pxW; x++) {
            const sx = srcX + x, sy = srcY + y;
            if (sx >= info.width || sy >= info.height) { gray[y * pxW + x] = 255; continue; }
            const si = (sy * info.width + sx) * 4;
            const a = rgba[si + 3];
            if (a < 10) { gray[y * pxW + x] = 255; continue; }
            const af = a / 255;
            const lum = 0.299 * rgba[si] + 0.587 * rgba[si + 1] + 0.114 * rgba[si + 2];
            gray[y * pxW + x] = af * lum + (1 - af) * 255;
        }
    }

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
        gray, width: pxW, height: pxH,
        offsetX: cropMmX, offsetY: cropMmY,
        lineSpacing, dpi, dpmm,
        imgBuffer, isSvg, originalName, options,
        createdAt: Date.now(),
    });

    // Generate initial preview
    const preview = await processSession(sessionId, {
        algorithm: options.algorithm || 'atkinson',
        brightness: 0, contrast: 0, gamma: 1.0,
        invert: false, clahe: false, unsharp: false,
    });

    return { sessionId, ...preview };
}

// ───────── Process Session (preview) ─────────
async function processSession(sessionId, options) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const { gray: srcGray, width: w, height: h, lineSpacing, dpmm } = session;

    // Apply pre-processing with sharp if needed (CLAHE, unsharp, gamma)
    let processedGray;
    if (options.clahe || options.unsharp || (options.gamma && options.gamma !== 1.0)) {
        // Reconstruct 8-bit grayscale buffer for sharp processing
        const buf8 = Buffer.alloc(w * h);
        for (let i = 0; i < w * h; i++) buf8[i] = Math.max(0, Math.min(255, Math.round(srcGray[i])));

        let pipeline = sharp(buf8, { raw: { width: w, height: h, channels: 1 } });
        if (options.gamma && options.gamma !== 1.0) pipeline = pipeline.gamma(options.gamma);
        if (options.clahe) pipeline = pipeline.clahe({ width: 3, height: 3, maxSlope: 3 });
        if (options.unsharp) pipeline = pipeline.sharpen({ sigma: 1.0, m1: 1.5, m2: 0.7 });

        const { data } = await pipeline.raw().toBuffer({ resolveWithObject: true });
        processedGray = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) processedGray[i] = data[i];
    } else {
        processedGray = new Float32Array(srcGray);
    }

    // Apply brightness
    if (options.brightness) {
        for (let i = 0; i < processedGray.length; i++) processedGray[i] += options.brightness;
    }
    // Apply contrast
    if (options.contrast) {
        const f = (259 * (options.contrast + 255)) / (255 * (259 - options.contrast));
        for (let i = 0; i < processedGray.length; i++) processedGray[i] = (processedGray[i] - 128) * f + 128;
    }
    // Clamp
    for (let i = 0; i < processedGray.length; i++) processedGray[i] = Math.max(0, Math.min(255, processedGray[i]));
    // Invert
    if (options.invert) {
        for (let i = 0; i < processedGray.length; i++) processedGray[i] = 255 - processedGray[i];
    }

    // Apply dithering
    const dithered = applyDither(processedGray, w, h, options.algorithm, options);

    // Generate PNG preview
    const pngBuffer = await sharp(Buffer.from(dithered), { raw: { width: w, height: h, channels: 1 } })
        .png({ compressionLevel: 6 })
        .toBuffer();

    const mmW = (w / dpmm).toFixed(1);
    const mmH = (h / dpmm * lineSpacing).toFixed(1);

    return {
        preview: pngBuffer.toString('base64'),
        width: w, height: h,
        offsetX: session.offsetX, offsetY: session.offsetY,
        lineSpacing,
        info: `${w}×${h}px | ${mmW}×${mmH}mm | ${session.dpi} DPI`,
    };
}

// ───────── Finalize Session (1-bit bitmap) ─────────
async function finalizeSession(sessionId, options) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    // Same processing as preview
    const result = await processSession(sessionId, options);

    // Decode the dithered image back and pack to 1-bit
    const { gray: srcGray, width: w, height: h } = session;

    // Re-run dithering to get the raw output (avoid PNG decode)
    let processedGray;
    if (options.clahe || options.unsharp || (options.gamma && options.gamma !== 1.0)) {
        const buf8 = Buffer.alloc(w * h);
        for (let i = 0; i < w * h; i++) buf8[i] = Math.max(0, Math.min(255, Math.round(srcGray[i])));
        let pipeline = sharp(buf8, { raw: { width: w, height: h, channels: 1 } });
        if (options.gamma && options.gamma !== 1.0) pipeline = pipeline.gamma(options.gamma);
        if (options.clahe) pipeline = pipeline.clahe({ width: 3, height: 3, maxSlope: 3 });
        if (options.unsharp) pipeline = pipeline.sharpen({ sigma: 1.0, m1: 1.5, m2: 0.7 });
        const { data } = await pipeline.raw().toBuffer({ resolveWithObject: true });
        processedGray = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) processedGray[i] = data[i];
    } else {
        processedGray = new Float32Array(srcGray);
    }
    if (options.brightness) for (let i = 0; i < processedGray.length; i++) processedGray[i] += options.brightness;
    if (options.contrast) {
        const f = (259 * (options.contrast + 255)) / (255 * (259 - options.contrast));
        for (let i = 0; i < processedGray.length; i++) processedGray[i] = (processedGray[i] - 128) * f + 128;
    }
    for (let i = 0; i < processedGray.length; i++) processedGray[i] = Math.max(0, Math.min(255, processedGray[i]));
    if (options.invert) for (let i = 0; i < processedGray.length; i++) processedGray[i] = 255 - processedGray[i];

    const dithered = applyDither(processedGray, w, h, options.algorithm, options);

    // Pack to 1-bit bitmap (MSB first, 8px per byte)
    const rowBytes = Math.ceil(w / 8);
    const bitmap = Buffer.alloc(rowBytes * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (dithered[y * w + x] === 0) bitmap[y * rowBytes + Math.floor(x / 8)] |= (1 << (7 - (x % 8)));
    }

    return {
        bitmap, width: w, height: h,
        offsetX: session.offsetX, offsetY: session.offsetY,
    };
}

module.exports = { createSession, processSession, finalizeSession, deleteSession };
