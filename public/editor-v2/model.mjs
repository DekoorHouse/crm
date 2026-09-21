// Coordinates and stroke widths are always millimetres; viewport state is separate.
import { splinePath } from './spline.mjs';
export const TYPES = ['rect', 'ellipse', 'text', 'spline', 'image'];
export const clone = value => structuredClone(value);
export const blankDocument = () => ({ version: 1, name: 'Sin título', width: 210, height: 297, objects: [] });

export function createObject(type, x, y, width = 40, height = 30) {
    if (!TYPES.includes(type)) throw new Error('Tipo de objeto no compatible.');
    return { id: crypto.randomUUID(), type, name: { rect: 'Rectángulo', ellipse: 'Elipse', text: 'Texto', spline: 'Spline', image: 'Imagen' }[type],
        x, y, width, height, fill: '#b9a3ed', stroke: '#352a49', strokeWidth: 0.4,
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
        return valid;
    });
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
