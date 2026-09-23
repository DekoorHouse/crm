// SVG import: converts an SVG file into the editor's own validated objects (curves, rectangles,
// ellipses, text and images, with gradients; clip paths become PowerClips). The file is only read as
// data: nothing from it is inserted into the page, and every object still goes through validateDocument.
import { createObject, placeInPowerClip } from './model.mjs';
import { normalizePath } from './path.mjs';
import { pivot } from './transform.mjs';

// ── Numbers, lengths and transforms ─────────────────────────────────────────────────────────────
const MM_PER = { px: 25.4 / 96, pt: 25.4 / 72, pc: 25.4 / 6, mm: 1, cm: 10, in: 25.4, q: .25 };
export function parseLength(value) {
    const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(px|pt|pc|mm|cm|in|q|%)?\s*$/i.exec(value ?? '');
    return match ? { value: Number(match[1]), unit: (match[2] || 'px').toLowerCase() } : null;
}
const numbers = text => (String(text ?? '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);
const IDENTITY = [1, 0, 0, 1, 0, 0];
export const multiply = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function parseTransform(text) {
    let matrix = IDENTITY;
    for (const [, name, args] of String(text ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
        const v = numbers(args), rad = (v[0] || 0) * Math.PI / 180;
        let m = IDENTITY;
        if (name === 'matrix' && v.length >= 6) m = v.slice(0, 6);
        if (name === 'translate') m = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
        if (name === 'scale') m = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        if (name === 'rotate') {
            m = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
            if (v.length >= 3) m = multiply(multiply([1, 0, 0, 1, v[1], v[2]], m), [1, 0, 0, 1, -v[1], -v[2]]);
        }
        if (name === 'skewX') m = [1, 0, Math.tan(rad), 1, 0, 0];
        if (name === 'skewY') m = [1, Math.tan(rad), 0, 1, 0, 0];
        matrix = multiply(matrix, m);
    }
    return matrix;
}

// ── Path data → absolute cubic subpaths ─────────────────────────────────────────────────────────
const line = (x0, y0, x1, y1) => [x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3, x0 + 2 * (x1 - x0) / 3, y0 + 2 * (y1 - y0) / 3, x1, y1];
export function arcToCubics(x1, y1, rx, ry, degrees, large, sweep, x2, y2) {
    if (x1 === x2 && y1 === y2) return [];
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry) return line(x1, y1, x2, y2);
    const phi = degrees * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
    const lambda = xp * xp / (rx * rx) + yp * yp / (ry * ry);
    if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
    const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
    const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cxp = coef * rx * yp / ry, cyp = -coef * ry * xp / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const start = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
    let delta = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    if (sweep && delta < 0) delta += 2 * Math.PI;
    const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9)), step = delta / count, t = 4 / 3 * Math.tan(step / 4), out = [];
    const map = (x, y) => [cx + rx * cos * x - ry * sin * y, cy + rx * sin * x + ry * cos * y];
    for (let i = 0; i < count; i++) {
        const a = start + i * step, b = a + step;
        out.push(...map(Math.cos(a) - t * Math.sin(a), Math.sin(a) + t * Math.cos(a)), ...map(Math.cos(b) + t * Math.sin(b), Math.sin(b) - t * Math.cos(b)));
        out.push(...(i === count - 1 ? [x2, y2] : map(Math.cos(b), Math.sin(b))));
    }
    return out;
}
export function parsePathData(d) {
    const text = String(d ?? ''), subpaths = [];
    let i = 0, command = '', current = null, x = 0, y = 0, startX = 0, startY = 0, lastControl = null, lastQuad = null;
    const skip = () => { while (i < text.length && /[\s,]/.test(text[i])) i++; };
    const number = () => {
        skip();
        const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(text.slice(i, i + 40));
        if (!match) throw new Error('bad number');
        i += match[0].length; return Number(match[0]);
    };
    const flag = () => { skip(); const c = text[i++]; if (c !== '0' && c !== '1') throw new Error('bad flag'); return c === '1'; };
    const begin = () => { current = { closed: false, points: [x, y] }; subpaths.push(current); };
    const segment = values => { if (!current) begin(); current.points.push(...values); };
    try {
        while (true) {
            skip();
            if (i >= text.length) break;
            if (/[a-df-z]/i.test(text[i])) command = text[i++];
            else if (!command || /[zZ]/.test(command)) break;
            const relative = command === command.toLowerCase(), ox = relative ? x : 0, oy = relative ? y : 0, type = command.toUpperCase();
            if (type === 'M') {
                x = ox + number(); y = oy + number(); startX = x; startY = y; begin();
                command = relative ? 'l' : 'L'; lastControl = lastQuad = null; continue;
            }
            if (type === 'Z') {
                if (current) {
                    if (x !== startX || y !== startY) segment(line(x, y, startX, startY));
                    current.closed = true;
                }
                x = startX; y = startY; current = null; lastControl = lastQuad = null; continue;
            }
            if (!current) begin();
            if (type === 'L' || type === 'H' || type === 'V') {
                const nx = type === 'V' ? x : ox + number(), ny = type === 'H' ? y : (type === 'V' ? oy : oy) + number();
                segment(line(x, y, nx, ny)); x = nx; y = ny; lastControl = lastQuad = null;
            } else if (type === 'C' || type === 'S') {
                const [c1x, c1y] = type === 'C' ? [ox + number(), oy + number()] : lastControl ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
                const c2x = ox + number(), c2y = oy + number(), nx = ox + number(), ny = oy + number();
                segment([c1x, c1y, c2x, c2y, nx, ny]); lastControl = [c2x, c2y]; lastQuad = null; x = nx; y = ny;
            } else if (type === 'Q' || type === 'T') {
                const [qx, qy] = type === 'Q' ? [ox + number(), oy + number()] : lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
                const nx = ox + number(), ny = oy + number();
                segment([x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), nx + 2 / 3 * (qx - nx), ny + 2 / 3 * (qy - ny), nx, ny]);
                lastQuad = [qx, qy]; lastControl = null; x = nx; y = ny;
            } else if (type === 'A') {
                const rx = number(), ry = number(), rotation = number(), large = flag(), sweep = flag(), nx = ox + number(), ny = oy + number();
                const arc = arcToCubics(x, y, rx, ry, rotation, large, sweep, nx, ny);
                if (arc.length) segment(arc);
                x = nx; y = ny; lastControl = lastQuad = null;
            } else break;
        }
    } catch { /* Like browsers, draw the path up to the first error. */ }
    return subpaths.filter(subpath => subpath.points.length >= 8);
}

// ── Basic shapes → subpaths ─────────────────────────────────────────────────────────────────────
const K = 0.5522847498307936;
function ellipseSubpath(cx, cy, rx, ry) {
    return { closed: true, points: [cx + rx, cy, cx + rx, cy + K * ry, cx + K * rx, cy + ry, cx, cy + ry, cx - K * rx, cy + ry, cx - rx, cy + K * ry, cx - rx, cy,
        cx - rx, cy - K * ry, cx - K * rx, cy - ry, cx, cy - ry, cx + K * rx, cy - ry, cx + rx, cy - K * ry, cx + rx, cy] };
}
function rectSubpath(x, y, w, h, rx, ry) {
    if (!rx || !ry) return { closed: true, points: [x, y, ...line(x, y, x + w, y), ...line(x + w, y, x + w, y + h), ...line(x + w, y + h, x, y + h), ...line(x, y + h, x, y)] };
    const kx = K * rx, ky = K * ry;
    return { closed: true, points: [x + rx, y, ...line(x + rx, y, x + w - rx, y), x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry,
        ...line(x + w, y + ry, x + w, y + h - ry), x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h,
        ...line(x + w - rx, y + h, x + rx, y + h), x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry,
        ...line(x, y + h - ry, x, y + ry), x, y + ry - ky, x + rx - kx, y, x + rx, y] };
}
const polySubpath = (values, closed) => {
    const points = [values[0], values[1]];
    for (let i = 2; i + 1 < values.length; i += 2) points.push(...line(values[i - 2], values[i - 1], values[i], values[i + 1]));
    if (closed && values.length >= 4) points.push(...line(values.at(-2), values.at(-1), values[0], values[1]));
    return { closed, points };
};

// ── Colours ─────────────────────────────────────────────────────────────────────────────────────
const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff',
    magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', lime: '#00ff00',
    navy: '#000080', purple: '#800080', teal: '#008080', orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700' };
const hex2 = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
// '#rrggbb', 'none', or null when the value is not a plain colour (resolveColor handles other names).
export function parseColor(value, resolveColor) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return null;
    if (text === 'none' || text === 'transparent') return 'none';
    let match = /^#([0-9a-f]{3,4})$/.exec(text);
    if (match) return '#' + [...match[1].slice(0, 3)].map(c => c + c).join('');
    match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(text);
    if (match) return '#' + match[1];
    match = /^rgba?\(([^)]*)\)$/.exec(text);
    if (match) {
        const parts = match[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
        if (parts.length === 3) return '#' + parts.map(p => hex2(p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p))).join('');
    }
    if (NAMED[text]) return NAMED[text];
    return resolveColor?.(text) ?? null;
}

// ── Styles: presentation attributes, simple CSS rules and style attributes ─────────────────────
const PROPERTIES = ['fill', 'stroke', 'stroke-width', 'fill-rule', 'display', 'visibility', 'font-size', 'text-anchor', 'color', 'stop-color', 'stop-opacity', 'clip-path', 'clip-rule', 'mask'];
const INHERITED = new Set(['fill', 'stroke', 'stroke-width', 'fill-rule', 'visibility', 'font-size', 'text-anchor', 'color', 'clip-rule']);
const declarations = text => {
    const out = {};
    for (const part of String(text ?? '').split(';')) {
        const colon = part.indexOf(':');
        if (colon < 0) continue;
        const name = part.slice(0, colon).trim().toLowerCase(), value = part.slice(colon + 1).replace(/!important/i, '').trim();
        if (PROPERTIES.includes(name) && value) out[name] = value;
    }
    return out;
};
export function parseCss(text) {
    const rules = [];
    const css = String(text ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const style = declarations(body);
        for (const raw of selectors.split(',')) {
            const selector = raw.trim();
            const match = /^([a-z][\w-]*|\*)?((?:[.#][\w-]+)*)$/i.exec(selector);
            if (!selector || selector.startsWith('@') || !match || (!match[1] && !match[2])) continue;
            const parts = match[2].match(/[.#][\w-]+/g) || [];
            rules.push({ tag: match[1] && match[1] !== '*' ? match[1].toLowerCase() : null, ids: parts.filter(p => p[0] === '#').map(p => p.slice(1)),
                classes: parts.filter(p => p[0] === '.').map(p => p.slice(1)), style, order: rules.length,
                specificity: parts.filter(p => p[0] === '#').length * 100 + parts.filter(p => p[0] === '.').length * 10 + (match[1] && match[1] !== '*' ? 1 : 0) });
        }
    }
    return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
}
const tagOf = element => (element.localName || element.tagName || '').replace(/^.*:/, '').toLowerCase();
const attribute = (element, name) => element.getAttribute?.(name) ?? null;
function computeStyle(element, parent, rules) {
    const style = {};
    for (const name of INHERITED) if (parent[name] !== undefined) style[name] = parent[name];
    const set = values => { for (const [name, value] of Object.entries(values)) if (value !== 'inherit') style[name] = value; else if (parent[name] !== undefined) style[name] = parent[name]; };
    const presentation = {};
    for (const name of PROPERTIES) { const value = attribute(element, name); if (value !== null && value.trim()) presentation[name] = value.trim(); }
    set(presentation);
    const tag = tagOf(element), id = attribute(element, 'id'), classes = (attribute(element, 'class') || '').split(/\s+/).filter(Boolean);
    for (const rule of rules) {
        if (rule.tag && rule.tag !== tag) continue;
        if (rule.ids.some(value => value !== id) || rule.classes.some(value => !classes.includes(value))) continue;
        set(rule.style);
    }
    set(declarations(attribute(element, 'style')));
    return style;
}

// ── The importer ────────────────────────────────────────────────────────────────────────────────
const SKIPPED = new Set(['defs', 'symbol', 'clippath', 'mask', 'pattern', 'lineargradient', 'radialgradient', 'marker', 'style', 'title', 'desc', 'metadata', 'script', 'filter']);
const children = element => [...(element.children || [])];
function* walk(element) { yield element; for (const child of children(element)) yield* walk(child); }
export const invert = m => {
    const det = m[0] * m[3] - m[1] * m[2];
    return det ? [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det] : null;
};
const urlId = value => /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(value ?? '')?.[1] ?? null;

// Maps the root <svg> to millimetres: width/height with units, and the viewBox (centred, like "meet").
function rootMatrix(svg) {
    const box = numbers(attribute(svg, 'viewBox'));
    const size = name => { const length = parseLength(attribute(svg, name)); return length && length.unit !== '%' ? length.value * MM_PER[length.unit] : null; };
    let width = size('width'), height = size('height');
    if (box.length === 4 && box[2] > 0 && box[3] > 0) {
        if (width === null && height === null) { width = box[2] * MM_PER.px; height = box[3] * MM_PER.px; }
        width ??= height * box[2] / box[3]; height ??= width * box[3] / box[2];
        const scale = Math.min(width / box[2], height / box[3]);
        const ox = (width - box[2] * scale) / 2, oy = (height - box[3] * scale) / 2;
        return { matrix: [scale, 0, 0, scale, ox - box[0] * scale, oy - box[1] * scale], width, height, viewport: { width: box[2], height: box[3] } };
    }
    return { matrix: [MM_PER.px, 0, 0, MM_PER.px, 0, 0], width: width ?? null, height: height ?? null,
        viewport: { width: width ? width / MM_PER.px : 100, height: height ? height / MM_PER.px : 100 } };
}
const firstNumber = (element, name, fallback = 0) => numbers(attribute(element, name))[0] ?? fallback;
const lengthIn = (element, name, fallback = 0) => { const value = parseLength(attribute(element, name)); return value && value.unit !== '%' ? value.value * (value.unit === 'px' ? 1 : MM_PER[value.unit] / MM_PER.px) : fallback; };

// A basic shape's outline in its own user units, or null for elements that are not shapes.
function shapeSubpaths(element) {
    const tag = tagOf(element), n = name => lengthIn(element, name);
    if (tag === 'path') return parsePathData(attribute(element, 'd'));
    if (tag === 'rect' || tag === 'circle' || tag === 'ellipse') {
        const box = shapeBox(element);
        if (!box) return [];
        return [tag === 'rect' ? rectSubpath(box.x, box.y, box.width, box.height, box.rx, box.ry) : ellipseSubpath(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2)];
    }
    if (tag === 'line') return [polySubpath([n('x1'), n('y1'), n('x2'), n('y2')], false)];
    if (tag === 'polyline' || tag === 'polygon') {
        const values = numbers(attribute(element, 'points'));
        return values.length >= 4 ? [polySubpath(values.slice(0, values.length - values.length % 2), tag === 'polygon')] : [];
    }
    return null;
}
function shapeBox(element) {
    const tag = tagOf(element), n = name => lengthIn(element, name);
    let x, y, w, h, rx = 0, ry = 0;
    if (tag === 'rect') {
        x = n('x'); y = n('y'); w = n('width'); h = n('height'); rx = n('rx'); ry = n('ry');
        if (!attribute(element, 'rx')) rx = ry; if (!attribute(element, 'ry')) ry = rx;
    } else {
        const radiusX = tag === 'circle' ? n('r') : n('rx'), radiusY = tag === 'circle' ? n('r') : n('ry');
        x = n('cx') - radiusX; y = n('cy') - radiusY; w = 2 * radiusX; h = 2 * radiusY;
    }
    if (!(w > 0 && h > 0)) return null;
    return { x, y, width: w, height: h, rx: Math.min(rx, w / 2), ry: Math.min(ry, h / 2) };
}
const mapSubpaths = (matrix, subpaths) => subpaths.map(({ closed, points }) => {
    const out = new Array(points.length);
    for (let i = 0; i < points.length; i += 2) { const [px, py] = apply(matrix, points[i], points[i + 1]); out[i] = px; out[i + 1] = py; }
    return { closed, points: out };
}).filter(subpath => subpath.points.length >= 8 && subpath.points.every(Number.isFinite));
const unskewed = m => Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-9 * (m[0] * m[0] + m[1] * m[1] + m[2] * m[2] + m[3] * m[3]);
// Axis-aligned or turned boxes keep their own type; mirrored ones cannot.
function placeBox(matrix, x, y, w, h) {
    const det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    if (det <= 0) return null;
    const sx = Math.hypot(matrix[0], matrix[1]), sy = det / sx, angle = Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI;
    const [cx, cy] = apply(matrix, x + w / 2, y + h / 2), width = w * sx, height = h * sy;
    // Exporters round their matrices (Corel writes 0.866025), so the angle is rounded to 1/10000 degree.
    const rotation = Math.round(-angle * 1e4) / 1e4 || 0;
    return { x: cx - width / 2, y: cy - height / 2, width, height, ...(rotation ? { rotation } : {}) };
}
// The matrix from an editor object's box units (0–1) to the page, including its turn.
function objectBoxMatrix(object) {
    const box = [object.width, 0, 0, object.height, object.x, object.y];
    if (!object.rotation) return box;
    const c = pivot(object), rad = -object.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    return multiply([cos, sin, -sin, cos, c.x - cos * c.x + sin * c.y, c.y - sin * c.x - cos * c.y], box);
}

// Returns { objects, width, height, skipped, clipped, masked, pending, truncated }. width/height are the
// SVG's page size in mm, if it has one. pending lists image objects whose src still has to be fetched
// or converted (linked files, GIF, SVG…); see the editor's import.
export function importSvgElement(svg, { resolveColor, maxObjects = 2000 } = {}) {
    if (tagOf(svg) !== 'svg') throw new Error('El archivo no es un SVG válido.');
    const ids = new Map(), cssText = [];
    for (const element of walk(svg)) {
        const id = attribute(element, 'id'); if (id && !ids.has(id)) ids.set(id, element);
        if (tagOf(element) === 'style') cssText.push(element.textContent || '');
    }
    const rules = parseCss(cssText.join('\n')), root = rootMatrix(svg), objects = [], pending = [];
    let skipped = 0, clipped = 0, masked = 0, count = 0, full = false;
    const add = (out, object) => { if (count >= maxObjects) { full = true; return false; } count++; out.push(object); return true; };
    const named = (element, fallback) => (attribute(element, 'id') || fallback).slice(0, 120);

    // Gradients, following href chains for their stops and settings (as Inkscape writes them).
    const gradientElement = value => { const target = ids.get(urlId(value)); return target && ['lineargradient', 'radialgradient'].includes(tagOf(target)) ? target : null; };
    const chainOf = gradient => { const chain = []; for (let g = gradient; g && chain.length < 10 && !chain.includes(g); g = ids.get((attribute(g, 'href') || attribute(g, 'xlink:href') || '').replace(/^#/, ''))) chain.push(g); return chain; };
    const stopsOf = chain => {
        const stops = chain.map(g => children(g).filter(child => tagOf(child) === 'stop')).find(list => list.length) || [];
        let last = 0;
        return stops.map(stop => {
            const style = computeStyle(stop, {}, rules), text = attribute(stop, 'offset') ?? '0';
            const offset = Math.max(last, Math.min(1, Math.max(0, text.trim().endsWith('%') ? parseFloat(text) / 100 : parseFloat(text) || 0)));
            last = offset;
            const color = parseColor(style['stop-color'] ?? '#000000', resolveColor);
            const opacity = Math.min(1, Math.max(0, Number.parseFloat(style['stop-opacity'] ?? '1')));
            return { offset, color: color && color !== 'none' ? color : '#000000', opacity: color === 'none' ? 0 : Number.isFinite(opacity) ? opacity : 1 };
        });
    };
    const firstColor = value => { const gradient = gradientElement(value); const stops = gradient && stopsOf(chainOf(gradient)); return stops?.length ? stops[0].color : null; };
    const paint = (value, style) => {
        if (value === undefined) return null;
        if (urlId(value)) return firstColor(value) ?? (value.slice(value.indexOf(')') + 1).trim() ? parseColor(value.slice(value.indexOf(')') + 1).trim(), resolveColor) : '#808080');
        if (value.toLowerCase() === 'currentcolor') return parseColor(style.color ?? '#000000', resolveColor);
        return parseColor(value, resolveColor);
    };
    // A gradient in the editor's form: box units of the object it paints, turned by a matrix.
    const gradientFor = (value, matrix, userBox, object) => {
        const gradient = gradientElement(value); if (!gradient) return null;
        const chain = chainOf(gradient), stops = stopsOf(chain);
        if (!stops.length) return null;
        const get = name => chain.map(g => attribute(g, name)).find(v => v !== null) ?? null;
        const box = get('gradientUnits') !== 'userSpaceOnUse';
        const coordinate = (name, fallback, axis) => {
            const text = get(name) ?? fallback, value = Number.parseFloat(text);
            if (!Number.isFinite(value)) return Number.parseFloat(fallback);
            if (!String(text).trim().endsWith('%')) return value;
            const { width, height } = root.viewport, size = axis === 'x' ? width : axis === 'y' ? height : Math.hypot(width, height) / Math.SQRT2;
            return box ? value / 100 : value / 100 * size;
        };
        const radial = tagOf(gradient) === 'radialgradient', geometry = radial
            ? { cx: coordinate('cx', '50%', 'x'), cy: coordinate('cy', '50%', 'y'), r: coordinate('r', '50%', 'r') }
            : { x1: coordinate('x1', '0', 'x'), y1: coordinate('y1', '0', 'y'), x2: coordinate('x2', '100%', 'x'), y2: coordinate('y2', '0', 'y') };
        if (radial) { geometry.fx = get('fx') === null ? geometry.cx : coordinate('fx', '0', 'x'); geometry.fy = get('fy') === null ? geometry.cy : coordinate('fy', '0', 'y'); if (!(geometry.r > 0)) return null; }
        let toPage = multiply(matrix, parseTransform(get('gradientTransform')));
        if (box) {
            if (!(userBox?.width > 0 && userBox?.height > 0)) return null;
            toPage = multiply(multiply(matrix, [userBox.width, 0, 0, userBox.height, userBox.x, userBox.y]), parseTransform(get('gradientTransform')));
        }
        const inverse = invert(objectBoxMatrix(object)); if (!inverse) return null;
        const transform = multiply(inverse, toPage);
        if (!transform.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6) || Object.values(geometry).some(v => !Number.isFinite(v) || Math.abs(v) > 1e6)) return null;
        const spread = get('spreadMethod');
        return { type: radial ? 'radial' : 'linear', ...geometry, stops, transform, ...(spread === 'reflect' || spread === 'repeat' ? { spread } : {}) };
    };
    const paints = (object, style, matrix, userBox) => {
        const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
        const fill = paint(style.fill ?? '#000000', style) ?? '#000000', stroke = paint(style.stroke ?? 'none', style) ?? 'none';
        const width = Number.parseFloat(style['stroke-width'] ?? '1');
        Object.assign(object, { fill, stroke, strokeWidth: stroke === 'none' || !Number.isFinite(width) ? 0 : Math.min(100, Math.max(0, width * scale)) });
        if (object.type === 'image') return object;
        for (const key of ['fill', 'stroke']) {
            const gradient = object[key] !== 'none' && gradientFor(style[key], matrix, userBox, object);
            if (gradient) object[key + 'Gradient'] = gradient;
        }
        return object;
    };
    const userBounds = subpaths => { const all = subpaths.filter(s => s.points.length >= 8); return all.length ? normalizePath(all) : null; };
    const curve = (element, style, matrix, subpaths, fallbackName, fillRule = style['fill-rule']) => {
        const mapped = mapSubpaths(matrix, subpaths);
        if (!mapped.length) return null;
        const geometry = normalizePath(mapped);
        if (Math.abs(geometry.x) > 10000 || Math.abs(geometry.y) > 10000 || geometry.width > 10000 || geometry.height > 10000) { skipped++; return null; }
        return paints({ ...createObject('path', 0, 0), name: named(element, fallbackName), ...geometry, ...(fillRule === 'evenodd' ? { fillRule: 'evenodd' } : {}) }, style, matrix, userBounds(subpaths));
    };
    // Rectangles and ellipses, also turned, stay editable as such; skewed, mirrored or rounded ones become curves.
    const shape = (element, style, matrix) => {
        const tag = tagOf(element);
        if (tag === 'rect' || tag === 'circle' || tag === 'ellipse') {
            const box = shapeBox(element); if (!box) return null;
            const placed = !(box.rx > 0 && box.ry > 0) && unskewed(matrix) && placeBox(matrix, box.x, box.y, box.width, box.height);
            const type = tag === 'rect' ? 'rect' : 'ellipse', name = tag === 'rect' ? 'Rectángulo' : 'Elipse';
            if (placed) return paints({ ...createObject(type, 0, 0), name: named(element, name), ...placed }, style, matrix, box);
            return curve(element, style, matrix, shapeSubpaths(element), name);
        }
        if (tag === 'line') return curve(element, { ...style, fill: 'none' }, matrix, shapeSubpaths(element), 'Línea');
        return curve(element, style, matrix, shapeSubpaths(element) || [], 'Curva');
    };

    // A clip path becomes the container of a PowerClip, in the clipped element's user space.
    const clipContainer = (clip, matrix, content) => {
        let base = multiply(matrix, parseTransform(attribute(clip, 'transform')));
        if (attribute(clip, 'clipPathUnits') === 'objectBoundingBox') {
            const bounds = content.reduce((box, o) => box ? { x: Math.min(box.x, o.x), y: Math.min(box.y, o.y), right: Math.max(box.right, o.x + o.width), bottom: Math.max(box.bottom, o.y + o.height) } : { x: o.x, y: o.y, right: o.x + o.width, bottom: o.y + o.height }, null);
            base = multiply([bounds.right - bounds.x, 0, 0, bounds.bottom - bounds.y, bounds.x, bounds.y], parseTransform(attribute(clip, 'transform')));
        }
        const parts = [];
        for (const child of children(clip)) {
            const target = tagOf(child) === 'use' ? ids.get((attribute(child, 'href') || attribute(child, 'xlink:href') || '').replace(/^#/, '')) : child;
            if (!target) continue;
            let m = multiply(base, parseTransform(attribute(child, 'transform')));
            if (target !== child) m = multiply(multiply(m, [1, 0, 0, 1, lengthIn(child, 'x'), lengthIn(child, 'y')]), parseTransform(attribute(target, 'transform')));
            const subpaths = shapeSubpaths(target);
            if (subpaths?.length) parts.push({ element: target, matrix: m, subpaths, rule: computeStyle(target, computeStyle(clip, {}, rules), rules)['clip-rule'] });
        }
        if (!parts.length) return null;
        const style = { fill: 'none', stroke: 'none' };
        if (parts.length === 1) {
            const container = shape(parts[0].element, style, parts[0].matrix);
            if (container && container.type !== 'path') return { ...container, name: named(clip, 'Contenedor') };
        }
        const all = parts.flatMap(part => mapSubpaths(part.matrix, part.subpaths));
        if (!all.length) return null;
        return { ...createObject('path', 0, 0), name: named(clip, 'Contenedor'), ...normalizePath(all), fill: 'none', stroke: 'none', strokeWidth: 0, ...(parts[0].rule === 'evenodd' ? { fillRule: 'evenodd' } : {}) };
    };

    const visit = (element, parentStyle, parentMatrix, depth, using, out, inClip) => {
        if (full || depth > 60) return;
        const tag = tagOf(element);
        if (SKIPPED.has(tag)) return;
        const style = computeStyle(element, parentStyle, rules);
        if (style.display === 'none') return;
        let matrix = multiply(parentMatrix, parseTransform(attribute(element, 'transform')));
        if (tag === 'svg' && element !== svg) {
            // A nested viewport: its own position, size and viewBox.
            const box = numbers(attribute(element, 'viewBox'));
            matrix = multiply(matrix, [1, 0, 0, 1, lengthIn(element, 'x'), lengthIn(element, 'y')]);
            if (box.length === 4 && box[2] > 0 && box[3] > 0) {
                const w = lengthIn(element, 'width', box[2]), h = lengthIn(element, 'height', box[3]), scale = Math.min(w / box[2], h / box[3]);
                matrix = multiply(matrix, [scale, 0, 0, scale, -box[0] * scale, -box[1] * scale]);
            }
        }
        if (style.mask && style.mask !== 'none') masked++;
        const clipValue = style['clip-path'], clip = clipValue && clipValue !== 'none' ? ids.get(urlId(clipValue)) : null;
        // PowerClips cannot hold other PowerClips, so a clip inside clipped content is left out.
        if (clip && tagOf(clip) === 'clippath' && !inClip) {
            const content = [];
            body(element, tag, style, matrix, depth, using, content, true);
            if (!content.length) return;
            const container = clipContainer(clip, matrix, content);
            if (!container) { clipped++; out.push(...content); return; }
            container.powerClip = { width: container.width, height: container.height, objects: [] };
            const holder = { objects: [container, ...content] };
            try { placeInPowerClip(holder, new Set(content.map(item => item.id)), container.id); }
            catch { clipped++; out.push(...content); return; }
            // Placing copies the content, so pending images now live in the container.
            content.forEach((item, i) => { const k = pending.indexOf(item); if (k >= 0) pending[k] = container.powerClip.objects[i]; });
            if (add(out, container)) return;
            count -= content.length;
            return;
        }
        if (clipValue && clipValue !== 'none') clipped++;
        body(element, tag, style, matrix, depth, using, out, inClip);
    };
    const body = (element, tag, style, matrix, depth, using, out, inClip) => {
        if (tag === 'svg' || tag === 'g' || tag === 'a' || tag === 'switch') {
            for (const child of children(element)) visit(child, style, matrix, depth + 1, using, out, inClip);
            return;
        }
        if (tag === 'use') {
            const target = ids.get((attribute(element, 'href') || attribute(element, 'xlink:href') || '').replace(/^#/, ''));
            if (!target || using.has(target)) { skipped++; return; }
            const placed = multiply(matrix, [1, 0, 0, 1, lengthIn(element, 'x'), lengthIn(element, 'y')]), next = new Set(using).add(target);
            if (tagOf(target) === 'symbol') for (const child of children(target)) visit(child, style, placed, depth + 1, next, out, inClip);
            else visit(target, style, placed, depth + 1, next, out, inClip);
            return;
        }
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return;
        if (shapeSubpaths(element) !== null) { const object = shape(element, style, matrix); if (object) add(out, object); return; }
        if (tag === 'text') {
            const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            const span = [...walk(element)].find(item => tagOf(item) === 'tspan' && attribute(item, 'x') !== null);
            const x = numbers(attribute(element, 'x'))[0] ?? (span ? firstNumber(span, 'x') : 0), y = numbers(attribute(element, 'y'))[0] ?? (span ? firstNumber(span, 'y') : 0);
            const size = parseLength(style['font-size'] ?? '16')?.value || 16, estimate = text.length * size * .55;
            const shift = style['text-anchor'] === 'middle' ? estimate / 2 : style['text-anchor'] === 'end' ? estimate : 0;
            const userBox = { x: x - shift, y: y - size, width: estimate, height: size * 1.2 }, box = placeBox(matrix, userBox.x, userBox.y, userBox.width, userBox.height);
            if (!box) { skipped++; return; }
            add(out, paints({ ...createObject('text', 0, 0), name: text.slice(0, 40), text: text.slice(0, 10000), ...box, fontSize: size * box.height / userBox.height }, style, matrix, userBox));
            return;
        }
        if (tag === 'image') {
            const href = (attribute(element, 'href') || attribute(element, 'xlink:href') || '').trim();
            const box = placeBox(matrix, lengthIn(element, 'x'), lengthIn(element, 'y'), lengthIn(element, 'width'), lengthIn(element, 'height'));
            if (!href || !box || !(box.width > 0 && box.height > 0)) { skipped++; return; }
            const object = { ...createObject('image', 0, 0), name: named(element, 'Imagen'), src: href.startsWith('data:') ? href.replace(/\s+/g, '') : href, fill: 'none', stroke: 'none', strokeWidth: 0, ...box };
            // PNG, JPEG and WebP data is used as is; anything else is fetched or converted by the editor.
            if (add(out, object) && !/^data:image\/(png|jpeg|webp);base64,/i.test(object.src)) pending.push(object);
            return;
        }
        if (tag !== 'tspan' && tag !== 'textpath') skipped++;
    };
    const rootStyle = computeStyle(svg, {}, rules);
    visit({ ...svg, localName: 'g', children: children(svg), getAttribute: name => name === 'transform' || name === 'clip-path' || name === 'mask' ? attribute(svg, name) : null }, rootStyle, root.matrix, 0, new Set(), objects, false);
    return { objects, width: root.width, height: root.height, skipped, clipped, masked, pending, truncated: full };
}

// Pending images that failed to load are removed, also from PowerClips.
export function dropImages(result, failed) {
    const keep = list => list.filter(object => !failed.has(object)).map(object => {
        if (object.powerClip) object.powerClip.objects = keep(object.powerClip.objects);
        return object;
    });
    result.objects = keep(result.objects);
    result.pending = result.pending.filter(object => !failed.has(object));
    result.skipped += failed.size;
    return result;
}

export function importSvg(text, options = {}) {
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (parsed.getElementsByTagName('parsererror').length) throw new Error('El archivo SVG está dañado o no es válido.');
    return importSvgElement(parsed.documentElement, options);
}
