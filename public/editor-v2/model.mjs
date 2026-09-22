// Coordinates and stroke widths are always millimetres; viewport state is separate.
import { splinePath } from './spline.mjs';
export const TYPES = ['rect', 'ellipse', 'text', 'spline', 'image'];
export const HAIRLINE_WIDTH = 0.0762;
export const clone = value => structuredClone(value);
export const blankDocument = () => ({ version: 1, name: 'Sin título', width: 210, height: 297, objects: [] });

export function createObject(type, x, y, width = 40, height = 30) {
    if (!TYPES.includes(type)) throw new Error('Tipo de objeto no compatible.');
    return { id: crypto.randomUUID(), type, name: { rect: 'Rectángulo', ellipse: 'Elipse', text: 'Texto', spline: 'Spline', image: 'Imagen' }[type],
        x, y, width, height, fill: '#b9a3ed', stroke: '#352a49', strokeWidth: HAIRLINE_WIDTH,
        text: 'Tu texto', fontSize: 10, hidden: false, locked: false,
        ...(type === 'spline' ? { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } : {}) };
}

const numberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const color = value => typeof value === 'string' && /^(none|#[0-9a-f]{6})$/i.test(value);
export function validImageSource(src) {
    if (typeof src !== 'string' || src.length > 16000000) return false;
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) return true;
    try {
        const url = new URL(src);
        return url.protocol === 'https:' && url.hostname === 'firebasestorage.googleapis.com' && !url.username && !url.password &&
            url.pathname.startsWith('/v0/b/pedidos-con-gemini.firebasestorage.app/o/editor-v2%2Fimages%2F');
    } catch { return false; }
}
export function validateDocument(input) {
    if (!input || input.version !== 1 || typeof input.name !== 'string' || input.name.length > 120 ||
        !numberIn(input.width, 1, 5000) || !numberIn(input.height, 1, 5000) ||
        !Array.isArray(input.objects) || input.objects.length > 2000) throw new Error('El archivo no es un proyecto válido de Editor V2.');
    const ids = new Set();
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
        if (o.type === 'spline') {
            if (!Array.isArray(o.points) || o.points.length < 2 || o.points.length > 500 || o.points.some(p => !p || !numberIn(p.x, 0, 1) || !numberIn(p.y, 0, 1))) throw new Error('La spline contiene puntos inválidos.');
            valid.points = o.points.map(p => ({ x: p.x, y: p.y }));
        }
        if (o.type === 'image') {
            if (!validImageSource(o.src)) throw new Error('La imagen contiene un origen inválido o es demasiado grande.');
            valid.src = o.src;
        }
        if (o.powerClip !== undefined) {
            const clip = o.powerClip;
            if (!['rect', 'ellipse'].includes(o.type) || !clip || !numberIn(clip.width, .1, 10000) || !numberIn(clip.height, .1, 10000) ||
                !Array.isArray(clip.objects) || clip.objects.some(child => !child || child.powerClip !== undefined)) throw new Error('Contenedor PowerClip inválido.');
            valid.powerClip = { width: clip.width, height: clip.height, objects: validateDocument({ ...input, objects: clip.objects }).objects };
            if (clip.transform !== undefined) {
                const t = clip.transform;
                if (!t || !numberIn(t.x, -100000000, 100000000) || !numberIn(t.y, -100000000, 100000000) || !numberIn(t.scale, .000001, 1000000)) throw new Error('Ajuste PowerClip inválido.');
                valid.powerClip.transform = { x: t.x, y: t.y, scale: t.scale };
            }
            for (const child of valid.powerClip.objects) {
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
        if (JSON.stringify(valid) === JSON.stringify(this.document)) return false;
        this.past.push(clone(this.document));
        if (this.past.length > 100) this.past.shift();
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
export function objectMarkup(o) {
    if (o.powerClip) {
        const base = { ...o }; delete base.powerClip;
        const clipId = 'pc-' + Array.from(o.id).map(c => c.codePointAt(0).toString(16)).join('-');
        const shape = objectMarkup({ ...base, fill: '#ffffff', stroke: 'none' });
        const content = o.powerClip.objects.filter(item => !item.hidden).map(objectMarkup).join('');
        const t = o.powerClip.transform || { x: 0, y: 0, scale: 1 };
        return `${objectMarkup({ ...base, stroke: 'none' })}<defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${shape}</clipPath></defs><g clip-path="url(#${clipId})"><g transform="translate(${o.x} ${o.y}) scale(${o.width / o.powerClip.width} ${o.height / o.powerClip.height})"><g data-powerclip-content="true" transform="translate(${t.x} ${t.y}) scale(${t.scale})">${content}</g></g></g>${objectMarkup({ ...base, fill: 'none' })}`;
    }
    const style = `fill="${escapeXml(o.fill)}" stroke="${escapeXml(o.stroke)}" stroke-width="${o.strokeWidth}"`;
    if (o.type === 'rect') return `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" ${style}/>`;
    if (o.type === 'ellipse') return `<ellipse cx="${o.x + o.width / 2}" cy="${o.y + o.height / 2}" rx="${o.width / 2}" ry="${o.height / 2}" ${style}/>`;
    if (o.type === 'spline') return `<path d="${splinePath(o)}" ${style}/>`;
    if (o.type === 'image') return `<image x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" preserveAspectRatio="none" href="${escapeXml(o.src)}"/><rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="none" stroke="${escapeXml(o.stroke)}" stroke-width="${o.strokeWidth}"/>`;
    return `<text x="${o.x}" y="${o.y + o.fontSize}" font-family="Arial, sans-serif" font-size="${o.fontSize}" ${style} xml:space="preserve">${escapeXml(o.text)}</text>`;
}
export function exportSvg(document) {
    const d = validateDocument(document);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}mm" height="${d.height}mm" viewBox="0 0 ${d.width} ${d.height}">\n<title>${escapeXml(d.name)}</title>\n${d.objects.filter(o => !o.hidden).map(objectMarkup).join('\n')}\n</svg>`;
}

export function* objectsWithContents(objects) {
    for (const object of objects) { yield object; if (object.powerClip) yield* objectsWithContents(object.powerClip.objects); }
}

export function makePowerClip(object) {
    if (object.locked || object.powerClip || !['rect', 'ellipse'].includes(object.type)) throw new Error('Selecciona un rectángulo o una elipse sin bloquear.');
    object.powerClip = { width: object.width, height: object.height, objects: [] };
}

export function placeInPowerClip(document, sourceIds, targetId) {
    const target = document.objects.find(item => item.id === targetId);
    if (!target?.powerClip || target.locked || sourceIds.has(targetId)) throw new Error('Elige otro contenedor PowerClip sin bloquear.');
    const sources = document.objects.filter(item => sourceIds.has(item.id));
    if (!sources.length || sources.some(item => item.locked || item.hidden || item.powerClip)) throw new Error('Selecciona contenido visible, sin bloquear y sin PowerClip anidado.');
    const sx = target.powerClip.width / target.width, sy = target.powerClip.height / target.height;
    const t = target.powerClip.transform || { x: 0, y: 0, scale: 1 };
    for (const source of sources) {
        const child = clone(source);
        child.x = ((source.x - target.x) * sx - t.x) / t.scale; child.y = ((source.y - target.y) * sy - t.y) / t.scale;
        child.width *= sx / t.scale; child.height *= sy / t.scale; child.fontSize *= sy / t.scale;
        target.powerClip.objects.push(child);
    }
    document.objects = document.objects.filter(item => !sourceIds.has(item.id));
}

export function extractPowerClip(document, targetId) {
    const target = document.objects.find(item => item.id === targetId);
    if (!target?.powerClip || target.locked) return;
    const sx = target.width / target.powerClip.width, sy = target.height / target.powerClip.height;
    const t = target.powerClip.transform || { x: 0, y: 0, scale: 1 };
    const content = target.powerClip.objects.map(item => ({ ...clone(item), x: target.x + (item.x * t.scale + t.x) * sx, y: target.y + (item.y * t.scale + t.y) * sy, width: item.width * t.scale * sx, height: item.height * t.scale * sy, fontSize: item.fontSize * t.scale * sy, strokeWidth: item.strokeWidth * t.scale * Math.min(sx, sy) }));
    target.powerClip.objects = [];
    delete target.powerClip.transform;
    document.objects.splice(document.objects.indexOf(target) + 1, 0, ...content);
}

export function fitPowerClip(target, mode, bounds) {
    if (!target?.powerClip?.objects.length || target.locked || !['contain', 'cover'].includes(mode)) return;
    if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) throw new Error('El contenido no tiene dimensiones para ajustar.');
    const clip = target.powerClip;
    const scale = Math[mode === 'cover' ? 'max' : 'min'](clip.width / bounds.width, clip.height / bounds.height);
    clip.transform = { scale, x: (clip.width - bounds.width * scale) / 2 - bounds.x * scale, y: (clip.height - bounds.height * scale) / 2 - bounds.y * scale };
}
