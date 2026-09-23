// Coordinates and stroke widths are always millimetres; viewport state is separate.
import { splinePath, splinePoints, normalizeSpline } from './spline.mjs';
import { pathData, validPathGeometry, MAX_PATH_NUMBERS } from './path.mjs';
import { normalizeAdjust } from './imageAdjust.mjs';
import { normalizeAngle, pivot, placeAtPivot, rotatePoint, turns } from './transform.mjs';
export const TYPES = ['rect', 'ellipse', 'text', 'spline', 'image', 'path'];
export const HAIRLINE_WIDTH = 0.0762;
// New objects, and outlines added to objects without one, start at this width (mm).
export const DEFAULT_STROKE_WIDTH = 0.3;
// Text fonts: Arial is built in; the others are loaded by the editor (fonts.mjs) and turned into curves on export.
export const FONT_FAMILIES = ['Arial', 'Rows of Sunflowers'];
// Shapes that can hold PowerClip content.
export const POWERCLIP_TYPES = ['rect', 'ellipse', 'path'];
// A gradient paints a fill or an outline; fill/stroke keep a plain colour for everything else (its first
// stop). Its geometry is in the object's box units (0–1), turned by transform, so it follows resizes.
const GRADIENT_NUMBERS = { linear: ['x1', 'y1', 'x2', 'y2'], radial: ['cx', 'cy', 'r', 'fx', 'fy'] };
function validGradient(g) {
    const fail = () => { throw new Error('El proyecto contiene un degradado inválido.'); };
    if (!g || !GRADIENT_NUMBERS[g.type] || !Array.isArray(g.stops) || !g.stops.length || g.stops.length > 64) fail();
    const valid = { type: g.type };
    for (const key of GRADIENT_NUMBERS[g.type]) { if (!numberIn(g[key], -1e6, 1e6)) fail(); valid[key] = g[key]; }
    if (g.type === 'radial' && !(g.r > 0)) fail();
    let last = 0;
    valid.stops = g.stops.map(stop => {
        if (!stop || !numberIn(stop.offset, 0, 1) || !/^#[0-9a-f]{6}$/i.test(stop.color) || !numberIn(stop.opacity, 0, 1)) fail();
        last = Math.max(last, stop.offset);
        return { offset: last, color: stop.color, opacity: stop.opacity };
    });
    if (!Array.isArray(g.transform) || g.transform.length !== 6 || g.transform.some(value => !numberIn(value, -1e6, 1e6))) fail();
    valid.transform = [...g.transform];
    if (g.spread !== undefined && !['pad', 'reflect', 'repeat'].includes(g.spread)) fail();
    if (g.spread && g.spread !== 'pad') valid.spread = g.spread;
    return valid;
}
// Setting a plain colour replaces that paint's gradient.
export function setPaint(object, key, color) {
    object[key] = color;
    delete object[key + 'Gradient'];
}
// Documents are plain JSON data. Objects and arrays are copied but strings are shared, so an embedded
// image is never duplicated in memory by edits, the undo history or duplicated objects.
export function clone(value) {
    // Curve point lists are frozen once validated, so copies can share them too.
    if (Array.isArray(value)) return Object.isFrozen(value) ? value : value.map(clone);
    if (value && typeof value === 'object') { const copy = {}; for (const key of Object.keys(value)) copy[key] = clone(value[key]); return copy; }
    return value;
}
// A short fingerprint of an embedded image (length and two 32-bit FNV-1a hashes), computed once per image.
// Per-image caches keep one entry per image the editor still holds; forgetImages drops the others.
const imageTokens = new Map();
export function imageToken(src) {
    let token = imageTokens.get(src);
    if (!token) {
        let a = 0x811c9dc5, b = 0x2f1d3c5b;
        for (let i = 0; i < src.length; i++) { const c = src.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822519); }
        token = `${src.length.toString(36)}.${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
        imageTokens.set(src, token);
    }
    return token;
}
// The draft store already knows each image's fingerprint, so loading does not compute them again.
export const rememberImageToken = (src, token) => { imageTokens.set(src, token); };
export function forgetImages(live) {
    for (const src of imageTokens.keys()) if (!live.has(src)) imageTokens.delete(src);
    for (const src of checkedSources) if (!live.has(src)) checkedSources.delete(src);
}
export const embeddedImage = (key, value) => key === 'src' && typeof value === 'string' && value.startsWith('data:');
// Compares documents without serializing their image data: images appear by fingerprint.
export const documentKey = document => JSON.stringify(document, (key, value) => embeddedImage(key, value) ? 'img:' + imageToken(value) : value);
// Splits a document into small JSON that names each embedded image by fingerprint, and the images.
export function separateImages(document) {
    const images = new Map();
    const json = JSON.stringify(document, (key, value) => {
        if (!embeddedImage(key, value)) return value;
        const token = imageToken(value); images.set(token, value); return 'img:' + token;
    });
    return { json, images };
}
export function restoreImages(value, images) {
    if (Array.isArray(value)) return value.map(item => restoreImages(item, images));
    if (!value || typeof value !== 'object') return value;
    const copy = {};
    for (const key of Object.keys(value)) {
        const item = value[key];
        if (key !== 'src' || typeof item !== 'string' || !item.startsWith('img:')) { copy[key] = restoreImages(item, images); continue; }
        if (!images.has(item.slice(4))) throw new Error('Falta una imagen del borrador.');
        copy[key] = images.get(item.slice(4));
    }
    return copy;
}
// A single-string form that stores each embedded image once, however many copies the document has.
export function packDocument(document) {
    const { json, images } = separateImages(document);
    return `{"packed":1,"images":${JSON.stringify(Object.fromEntries(images))},"document":${json}}`;
}
export function unpackDocument(text) {
    const data = JSON.parse(text);
    return data?.packed === 1 ? restoreImages(data.document, new Map(Object.entries(data.images))) : data;
}
export const blankDocument = () => ({ version: 1, name: 'Sin título', width: 210, height: 297, objects: [] });

export function createObject(type, x, y, width = 40, height = 30) {
    if (!TYPES.includes(type)) throw new Error('Tipo de objeto no compatible.');
    return { id: crypto.randomUUID(), type, name: { rect: 'Rectángulo', ellipse: 'Elipse', text: 'Texto', spline: 'Spline', image: 'Imagen', path: 'Curva' }[type],
        x, y, width, height, fill: '#b9a3ed', stroke: '#352a49', strokeWidth: DEFAULT_STROKE_WIDTH,
        text: 'Tu texto', fontSize: 10, hidden: false, locked: false,
        ...(type === 'spline' ? { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } : {}) };
}

const numberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const color = value => typeof value === 'string' && /^(none|#[0-9a-f]{6})$/i.test(value);
// Curves can hold hundreds of thousands of numbers, so a checked point list is frozen and not checked again.
const checkedPoints = new WeakSet();
const frozenPoints = points => {
    if (checkedPoints.has(points)) return points;
    const frozen = Object.freeze(points.slice()); checkedPoints.add(frozen); return frozen;
};
const validPathSubpaths = subpaths => Array.isArray(subpaths) && subpaths.length > 0 && subpaths.every(s => s && checkedPoints.has(s.points) && typeof s.closed === 'boolean') || validPathGeometry(subpaths);
// Checking the base64 of a large image is slow, so each image is checked once.
const checkedSources = new Set();
export function validImageSource(src) {
    if (typeof src !== 'string' || src.length > 16000000) return false;
    if (checkedSources.has(src)) return true;
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) { checkedSources.add(src); return true; }
    try {
        const url = new URL(src);
        return url.protocol === 'https:' && url.hostname === 'firebasestorage.googleapis.com' && !url.username && !url.password &&
            url.pathname.startsWith('/v0/b/pedidos-con-gemini.firebasestorage.app/o/editor-v2%2Fimages%2F');
    } catch { return false; }
}
// PowerClips can hold other PowerClips, up to this many levels deep.
export const MAX_POWERCLIP_DEPTH = 8;
export function validateDocument(input, depth = 0) {
    if (!input || input.version !== 1 || typeof input.name !== 'string' || input.name.length > 120 ||
        !numberIn(input.width, 1, 5000) || !numberIn(input.height, 1, 5000) ||
        !Array.isArray(input.objects) || input.objects.length > 2000) throw new Error('El archivo no es un proyecto válido de Editor V2.');
    const ids = new Set();
    let curveNumbers = 0;
    const objects = input.objects.map(o => {
        if (!o || typeof o.id !== 'string' || !o.id || o.id.length > 100 || ids.has(o.id) || !TYPES.includes(o.type) ||
            typeof o.name !== 'string' || o.name.length > 120 || typeof o.text !== 'string' || o.text.length > 10000 ||
            !numberIn(o.x, -10000, 10000) || !numberIn(o.y, -10000, 10000) ||
            !numberIn(o.width, 0.1, 10000) || !numberIn(o.height, 0.1, 10000) ||
            !numberIn(o.strokeWidth, 0, 100) || !numberIn(o.fontSize, 0.1, 1000) ||
            !color(o.fill) || !color(o.stroke) || typeof o.hidden !== 'boolean' || typeof o.locked !== 'boolean') {
            throw new Error('El proyecto contiene objetos inválidos o no compatibles.');
        }
        ids.add(o.id);
        // Whitelist fields: project files are data, never markup or executable content.
        const valid = Object.fromEntries(['id', 'type', 'name', 'x', 'y', 'width', 'height', 'fill', 'stroke', 'strokeWidth', 'text', 'fontSize', 'hidden', 'locked'].map(k => [k, o[k]]));
        if (o.rotation !== undefined) {
            if (!numberIn(o.rotation, -360, 360)) throw new Error('El proyecto contiene objetos inválidos o no compatibles.');
            if (normalizeAngle(o.rotation)) valid.rotation = normalizeAngle(o.rotation);
        }
        if (o.type === 'text' && o.fontFamily !== undefined) {
            if (!FONT_FAMILIES.includes(o.fontFamily)) throw new Error('El texto usa una fuente no disponible.');
            if (o.fontFamily !== 'Arial') valid.fontFamily = o.fontFamily;
        }
        if (o.type === 'spline') {
            // Control points are normalized to the curve's bounds, so they may fall outside 0–1.
            if (!Array.isArray(o.points) || o.points.length < 2 || o.points.length > 500 || o.points.some(p => !p || !numberIn(p.x, -10000, 10000) || !numberIn(p.y, -10000, 10000))) throw new Error('La spline contiene puntos inválidos.');
            if (o.closed !== undefined && (typeof o.closed !== 'boolean' || (o.closed && o.points.length < 3))) throw new Error('Una curva cerrada necesita al menos tres puntos.');
            valid.points = o.points.map(p => ({ x: p.x, y: p.y }));
            if (o.closed) valid.closed = true;
        }
        if (o.type === 'path') {
            if (!validPathSubpaths(o.subpaths)) throw new Error('La curva contiene puntos inválidos o demasiados puntos.');
            valid.subpaths = o.subpaths.map(({ closed, points }) => ({ closed, points: frozenPoints(points) }));
            curveNumbers += valid.subpaths.reduce((sum, subpath) => sum + subpath.points.length, 0);
            if (curveNumbers > 5 * MAX_PATH_NUMBERS) throw new Error('El proyecto tiene demasiados puntos de curva.');
            if (o.fillRule !== undefined && o.fillRule !== 'evenodd' && o.fillRule !== 'nonzero') throw new Error('La curva tiene un relleno inválido.');
            if (o.fillRule === 'evenodd') valid.fillRule = 'evenodd';
            // A fixed layer (e.g. the white base of the lamp frame): in the curve's box units, drawn above any
            // PowerClip content and below the outline, whatever the curve's own colours are.
            if (o.overlay !== undefined) {
                const overlay = o.overlay;
                if (!overlay || !/^#[0-9a-f]{6}$/i.test(overlay.fill) || !validPathSubpaths(overlay.subpaths)) throw new Error('La capa fija de la curva es inválida.');
                valid.overlay = { fill: overlay.fill, subpaths: overlay.subpaths.map(({ closed, points }) => ({ closed, points: frozenPoints(points) })) };
            }
            // A silhouette remembers the objects it outlines, so dragging on them again replaces it.
            if (o.silhouetteOf !== undefined) {
                if (!Array.isArray(o.silhouetteOf) || !o.silhouetteOf.length || o.silhouetteOf.length > 500 || o.silhouetteOf.some(id => typeof id !== 'string' || !id || id.length > 100)) throw new Error('La silueta tiene un origen inválido.');
                valid.silhouetteOf = [...o.silhouetteOf];
            }
        }
        // Text and images keep their mirroring as a mark (other shapes mirror their geometry).
        for (const key of ['flipX', 'flipY']) if (o[key] !== undefined) {
            if (typeof o[key] !== 'boolean' || !['text', 'image'].includes(o.type)) throw new Error('El reflejo del objeto es inválido.');
            if (o[key]) valid[key] = true;
        }
        for (const key of ['fillGradient', 'strokeGradient']) if (o[key] !== undefined) {
            if (o.type === 'image') throw new Error('Las imágenes no llevan degradados.');
            valid[key] = validGradient(o[key]);
        }
        if (o.type === 'image') {
            if (!validImageSource(o.src)) throw new Error('La imagen contiene un origen inválido o es demasiado grande.');
            valid.src = o.src;
            const adjust = o.adjust === undefined ? null : normalizeAdjust(o.adjust);
            if (adjust) valid.adjust = adjust;
            // 1-bit bitmaps are drawn with square pixels, never smoothed into greys.
            if (o.pixelated !== undefined && typeof o.pixelated !== 'boolean') throw new Error('La imagen tiene un ajuste de píxeles inválido.');
            if (o.pixelated) valid.pixelated = true;
        }
        if (o.powerClip !== undefined) {
            const clip = o.powerClip;
            if (!POWERCLIP_TYPES.includes(o.type) || !clip || !numberIn(clip.width, .1, 10000) || !numberIn(clip.height, .1, 10000) ||
                !Array.isArray(clip.objects) || clip.objects.some(child => !child)) throw new Error('Contenedor PowerClip inválido.');
            if (depth >= MAX_POWERCLIP_DEPTH) throw new Error(`Los PowerClips admiten hasta ${MAX_POWERCLIP_DEPTH} niveles, uno dentro de otro.`);
            valid.powerClip = { width: clip.width, height: clip.height, objects: validateDocument({ ...input, objects: clip.objects }, depth + 1).objects };
            if (clip.transform !== undefined) {
                const t = clip.transform;
                if (!t || !numberIn(t.x, -100000000, 100000000) || !numberIn(t.y, -100000000, 100000000) || !numberIn(t.scale, .000001, 1000000)) throw new Error('Ajuste PowerClip inválido.');
                valid.powerClip.transform = { x: t.x, y: t.y, scale: t.scale };
            }
            for (const child of objectsWithContents(valid.powerClip.objects)) {
                if (ids.has(child.id)) throw new Error('El PowerClip contiene identificadores repetidos.');
                ids.add(child.id);
            }
            if (ids.size > 2000) throw new Error('El proyecto supera el límite de objetos.');
        }
        return valid;
    });
    if (ids.size > 2000) throw new Error('El proyecto supera el límite de objetos.');
    return { version: 1, name: input.name, width: input.width, height: input.height, objects };
}

export class History {
    constructor(document = blankDocument()) { this.document = validateDocument(document); this.past = []; this.future = []; }
    commit(next) {
        const valid = validateDocument(next);
        if (documentKey(valid) === documentKey(this.document)) return false;
        this.past.push(clone(this.document));
        if (this.past.length > 100) this.past.shift();
        this.document = valid;
        this.future = [];
        return true;
    }
    // Replaces the current step instead of adding one: typing a text is a single undo step.
    amend(next) {
        const valid = validateDocument(next);
        if (documentKey(valid) === documentKey(this.document)) return false;
        this.document = valid;
        this.future = [];
        return true;
    }
    undo() {
        if (!this.past.length) return false;
        this.future.push(this.document); this.document = this.past.pop(); return true;
    }
    redo() {
        if (!this.future.length) return false;
        this.past.push(this.document); this.document = this.future.pop(); return true;
    }
}

const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
// resolve(src, object) maps an image source to the URL shown; the editor passes one that shows previews.
export function objectMarkup(o, resolve = src => src) {
    // A rotated object turns around its pivot (see transform.mjs); a PowerClip turns with its content.
    if (turns(o)) {
        const p = pivot(o);
        return `<g transform="rotate(${-o.rotation} ${p.x} ${p.y})">${objectMarkup({ ...o, rotation: 0 }, resolve)}</g>`;
    }
    // Mirrored text turns over around its anchor, a mirrored image around its centre.
    if ((o.flipX || o.flipY) && (o.type === 'text' || o.type === 'image')) {
        const c = o.type === 'text' ? { x: o.x, y: o.y } : { x: o.x + o.width / 2, y: o.y + o.height / 2 }, plain = { ...o };
        delete plain.flipX; delete plain.flipY;
        return `<g transform="translate(${c.x} ${c.y}) scale(${o.flipX ? -1 : 1} ${o.flipY ? -1 : 1}) translate(${-c.x} ${-c.y})">${objectMarkup(plain, resolve)}</g>`;
    }
    if (o.powerClip) {
        const base = { ...o }; delete base.powerClip;
        const plain = { ...base }; delete plain.fillGradient; delete plain.strokeGradient;
        const clipId = 'pc-' + Array.from(o.id).map(c => c.codePointAt(0).toString(16)).join('-');
        delete plain.overlay; delete base.overlay;
        const shape = objectMarkup({ ...plain, fill: '#ffffff', stroke: 'none' }, resolve);
        const content = o.powerClip.objects.filter(item => !item.hidden).map(item => objectMarkup(item, resolve)).join('');
        const t = o.powerClip.transform || { x: 0, y: 0, scale: 1 };
        return `${objectMarkup({ ...base, stroke: 'none' }, resolve)}<defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${shape}</clipPath></defs><g clip-path="url(#${clipId})"><g transform="translate(${o.x} ${o.y}) scale(${o.width / o.powerClip.width} ${o.height / o.powerClip.height})"><g data-powerclip-content="true" transform="translate(${t.x} ${t.y}) scale(${t.scale})">${content}</g></g></g>${o.overlay && o.type === 'path' ? overlayMarkup(o) : ''}${objectMarkup({ ...base, fill: 'none' }, resolve)}`;
    }
    // A fixed layer goes between the fill and the outline, so the outline stays visible on top.
    if (o.overlay && o.type === 'path') {
        const bare = { ...o }; delete bare.overlay;
        return objectMarkup({ ...bare, stroke: 'none', strokeGradient: undefined }, resolve) + overlayMarkup(o) + objectMarkup({ ...bare, fill: 'none', fillGradient: undefined }, resolve);
    }
    const fill = paint(o, 'fill'), stroke = paint(o, 'stroke'), defs = fill.defs + stroke.defs ? `<defs>${fill.defs}${stroke.defs}</defs>` : '';
    const style = `fill="${fill.value}" stroke="${stroke.value}" stroke-width="${o.strokeWidth}"`;
    return defs + shapeMarkup(o, style, resolve);
}
const overlayMarkup = o => `<path d="${pathData({ ...o, subpaths: o.overlay.subpaths })}" fill="${escapeXml(o.overlay.fill)}" stroke="none"/>`;
// The id of an object's gradient, unique in the page because object ids are.
const gradientId = (o, key) => 'gr-' + key[0] + '-' + Array.from(o.id).map(c => c.codePointAt(0).toString(16)).join('-');
function paint(o, key) {
    const g = o[key + 'Gradient'];
    if (!g || o[key] === 'none') return { value: escapeXml(o[key]), defs: '' };
    const id = gradientId(o, key), tag = g.type === 'linear' ? 'linearGradient' : 'radialGradient';
    const geometry = GRADIENT_NUMBERS[g.type].map(name => `${name}="${g[name]}"`).join(' ');
    const stops = g.stops.map(stop => `<stop offset="${stop.offset}" stop-color="${stop.color}"${stop.opacity < 1 ? ` stop-opacity="${stop.opacity}"` : ''}/>`).join('');
    return { value: `url(#${id})`, defs: `<${tag} id="${id}" gradientUnits="objectBoundingBox" gradientTransform="matrix(${g.transform.join(' ')})" ${geometry}${g.spread ? ` spreadMethod="${g.spread}"` : ''}>${stops}</${tag}>` };
}
function shapeMarkup(o, style, resolve) {
    if (o.type === 'rect') return `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" ${style}/>`;
    if (o.type === 'ellipse') return `<ellipse cx="${o.x + o.width / 2}" cy="${o.y + o.height / 2}" rx="${o.width / 2}" ry="${o.height / 2}" ${style}/>`;
    if (o.type === 'spline') return `<path d="${splinePath(o)}" ${style}/>`;
    if (o.type === 'path') return `<path d="${pathData(o)}"${o.fillRule === 'evenodd' ? ' fill-rule="evenodd" clip-rule="evenodd"' : ''} ${style}/>`;
    // data-adjusted lets the editor swap in the processed pixels; exports bake the adjustments first.
    if (o.type === 'image') return `<image x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" preserveAspectRatio="none"${o.pixelated ? ` image-rendering="optimizeSpeed" style="image-rendering:pixelated" data-bitmap="${escapeXml(o.id)}"` : ''}${o.adjust ? ` data-adjusted="${escapeXml(o.id)}"` : ''} href="${escapeXml(resolve(o.src, o))}"/><rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="none" stroke="${escapeXml(o.stroke)}" stroke-width="${o.strokeWidth}"/>`;
    const family = o.fontFamily && o.fontFamily !== 'Arial' ? `'${o.fontFamily}', Arial, sans-serif` : 'Arial, sans-serif';
    return `<text x="${o.x}" y="${o.y + o.fontSize}" font-family="${escapeXml(family)}" font-size="${o.fontSize}" ${style} xml:space="preserve">${escapeXml(o.text)}</text>`;
}
export function exportSvg(document) {
    const d = validateDocument(document);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}mm" height="${d.height}mm" viewBox="0 0 ${d.width} ${d.height}">\n<title>${escapeXml(d.name)}</title>\n${d.objects.filter(o => !o.hidden).map(o => objectMarkup(o)).join('\n')}\n</svg>`;
}

export function* objectsWithContents(objects) {
    for (const object of objects) { yield object; if (object.powerClip) yield* objectsWithContents(object.powerClip.objects); }
}

export function makePowerClip(object) {
    if (object.locked || object.powerClip || !POWERCLIP_TYPES.includes(object.type)) throw new Error('Selecciona un rectángulo, una elipse o una curva sin bloquear.');
    object.powerClip = { width: object.width, height: object.height, objects: [] };
}

export function placeInPowerClip(document, sourceIds, targetId, { createContainer = false } = {}) {
    const target = document.objects.find(item => item.id === targetId);
    if (!target || target.hidden || target.locked || sourceIds.has(targetId) || (!target.powerClip && (!createContainer || !POWERCLIP_TYPES.includes(target.type)))) throw new Error('Elige otro rectángulo, elipse o curva visible y sin bloquear.');
    const sources = document.objects.filter(item => sourceIds.has(item.id));
    if (!sources.length || sources.some(item => item.locked || item.hidden)) throw new Error('Selecciona contenido visible y sin bloquear.');
    const depth = objects => Math.max(0, ...objects.map(item => item.powerClip ? 1 + depth(item.powerClip.objects) : 0));
    if (1 + depth(sources) > MAX_POWERCLIP_DEPTH) throw new Error(`Los PowerClips admiten hasta ${MAX_POWERCLIP_DEPTH} niveles, uno dentro de otro.`);
    if (!target.powerClip) makePowerClip(target);
    const frame = clipFrame(target), kx = frame.sx / frame.t.scale, ky = frame.sy / frame.t.scale;
    for (const source of sources) target.powerClip.objects.push(mapObject(source, frame.toContent, kx, ky, -frame.angle));
    document.objects = document.objects.filter(item => !sourceIds.has(item.id));
}

// Page ↔ content coordinates of a PowerClip, including the container's own rotation.
function clipFrame(target) {
    const t = target.powerClip.transform || { x: 0, y: 0, scale: 1 }, angle = target.rotation || 0, centre = pivot(target);
    const sx = target.powerClip.width / target.width, sy = target.powerClip.height / target.height;
    return {
        t, sx, sy, angle,
        toContent: p => { const local = rotatePoint(p, centre, -angle); return { x: ((local.x - target.x) * sx - t.x) / t.scale, y: ((local.y - target.y) * sy - t.y) / t.scale }; },
        toPage: p => rotatePoint({ x: target.x + (p.x * t.scale + t.x) / sx, y: target.y + (p.y * t.scale + t.y) / sy }, centre, angle),
    };
}
// Carry an object across that mapping: its pivot (or a spline's control points) follows the map,
// sizes scale by kx and ky, and the container's angle is added or removed.
function mapObject(item, map, kx, ky, angle) {
    const child = clone(item);
    if (item.type === 'spline') Object.assign(child, normalizeSpline(splinePoints(item).map(map), item.closed));
    else {
        child.width = item.width * kx; child.height = item.height * ky; child.fontSize = item.fontSize * ky;
        placeAtPivot(child, map(pivot(item)));
    }
    const rotation = normalizeAngle((item.rotation || 0) + angle);
    if (rotation) child.rotation = rotation; else delete child.rotation;
    return child;
}

export function extractPowerClip(document, targetId) {
    const target = document.objects.find(item => item.id === targetId);
    if (!target?.powerClip || target.locked) return;
    const frame = clipFrame(target), kx = frame.t.scale / frame.sx, ky = frame.t.scale / frame.sy;
    const content = target.powerClip.objects.map(item => ({ ...mapObject(item, frame.toPage, kx, ky, frame.angle), strokeWidth: item.strokeWidth * Math.min(kx, ky) }));
    target.powerClip.objects = [];
    delete target.powerClip.transform;
    document.objects.splice(document.objects.indexOf(target) + 1, 0, ...content);
}

export function powerClipEditDocument(document, targetId) {
    const copy = clone(document), target = copy.objects.find(item => item.id === targetId);
    if (!target?.powerClip || target.locked) throw new Error('Selecciona un PowerClip sin bloquear.');
    const ids = new Set(target.powerClip.objects.map(item => item.id));
    extractPowerClip(copy, targetId);
    copy.objects = copy.objects.filter(item => ids.has(item.id));
    return validateDocument(copy);
}

export function mergePowerClipEdits(document, targetId, content) {
    const copy = clone(document), target = copy.objects.find(item => item.id === targetId);
    const frame = clipFrame(target), kx = frame.sx / frame.t.scale, ky = frame.sy / frame.t.scale;
    target.powerClip.objects = content.objects.map(item => ({ ...mapObject(item, frame.toContent, kx, ky, -frame.angle), strokeWidth: item.strokeWidth * Math.max(kx, ky) }));
    return validateDocument(copy);
}

export function fitPowerClip(target, mode, bounds) {
    if (!target?.powerClip?.objects.length || target.locked || !['contain', 'cover'].includes(mode)) return;
    if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) throw new Error('El contenido no tiene dimensiones para ajustar.');
    const clip = target.powerClip;
    const scale = Math[mode === 'cover' ? 'max' : 'min'](clip.width / bounds.width, clip.height / bounds.height);
    clip.transform = { scale, x: (clip.width - bounds.width * scale) / 2 - bounds.x * scale, y: (clip.height - bounds.height * scale) / 2 - bounds.y * scale };
}
