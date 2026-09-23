// SVG import: converts an SVG file into the editor's own validated objects (curves, rectangles,
// ellipses, text and embedded images). The file is only read as data: nothing from it is inserted into
// the page, and every object still goes through validateDocument.
import { createObject } from './model.mjs';
import { normalizePath } from './path.mjs';

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
const PROPERTIES = ['fill', 'stroke', 'stroke-width', 'fill-rule', 'display', 'visibility', 'font-size', 'text-anchor', 'color', 'stop-color', 'clip-path'];
const INHERITED = new Set(['fill', 'stroke', 'stroke-width', 'fill-rule', 'visibility', 'font-size', 'text-anchor', 'color']);
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
        return { matrix: [scale, 0, 0, scale, ox - box[0] * scale, oy - box[1] * scale], width, height };
    }
    return { matrix: [MM_PER.px, 0, 0, MM_PER.px, 0, 0], width: width ?? null, height: height ?? null };
}
const firstNumber = (element, name, fallback = 0) => numbers(attribute(element, name))[0] ?? fallback;
const lengthIn = (element, name, fallback = 0) => { const value = parseLength(attribute(element, name)); return value && value.unit !== '%' ? value.value * (value.unit === 'px' ? 1 : MM_PER[value.unit] / MM_PER.px) : fallback; };

// Returns { objects, width, height, skipped, clipped }. width/height are the SVG's page size in mm, if it has one.
export function importSvgElement(svg, { resolveColor, maxObjects = 2000 } = {}) {
    if (tagOf(svg) !== 'svg') throw new Error('El archivo no es un SVG válido.');
    const ids = new Map(), cssText = [];
    for (const element of walk(svg)) {
        const id = attribute(element, 'id'); if (id && !ids.has(id)) ids.set(id, element);
        if (tagOf(element) === 'style') cssText.push(element.textContent || '');
    }
    const rules = parseCss(cssText.join('\n')), root = rootMatrix(svg), objects = [];
    let skipped = 0, clipped = 0, full = false;
    const paint = (value, style) => {
        if (value === undefined) return null;
        const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(value);
        if (url) {
            // Gradients and patterns become their first colour.
            const target = ids.get(url[1]);
            const stop = target && [...walk(target)].find(element => tagOf(element) === 'stop');
            if (stop) return parseColor(computeStyle(stop, {}, rules)['stop-color'] ?? '#000000', resolveColor) ?? '#000000';
            const fallback = value.slice(url[0].length).trim();
            return fallback ? parseColor(fallback, resolveColor) : '#808080';
        }
        if (value.toLowerCase() === 'currentcolor') return parseColor(style.color ?? '#000000', resolveColor);
        return parseColor(value, resolveColor);
    };
    const add = object => { if (objects.length >= maxObjects) { full = true; return; } objects.push(object); };
    const named = (element, fallback) => (attribute(element, 'id') || fallback).slice(0, 120);
    const common = (element, style, matrix) => {
        const fill = paint(style.fill ?? '#000000', style) ?? '#000000', stroke = paint(style.stroke ?? 'none', style) ?? 'none';
        const width = Number.parseFloat(style['stroke-width'] ?? '1'), scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
        return { fill, stroke, strokeWidth: stroke === 'none' || !Number.isFinite(width) ? 0 : Math.min(100, Math.max(0, width * scale)) };
    };
    const addCurve = (element, style, matrix, subpaths, fallbackName) => {
        const mapped = subpaths.map(({ closed, points }) => {
            const out = new Array(points.length);
            for (let i = 0; i < points.length; i += 2) { const [px, py] = apply(matrix, points[i], points[i + 1]); out[i] = px; out[i + 1] = py; }
            return { closed, points: out };
        }).filter(subpath => subpath.points.length >= 8 && subpath.points.every(Number.isFinite));
        if (!mapped.length) return;
        const geometry = normalizePath(mapped);
        if (Math.abs(geometry.x) > 10000 || Math.abs(geometry.y) > 10000 || geometry.width > 10000 || geometry.height > 10000) { skipped++; return; }
        add({ ...createObject('path', 0, 0), name: named(element, fallbackName), ...common(element, style, matrix), ...geometry,
            ...(style['fill-rule'] === 'evenodd' ? { fillRule: 'evenodd' } : {}) });
    };
    const unskewed = m => Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-9 * (m[0] * m[0] + m[1] * m[1] + m[2] * m[2] + m[3] * m[3]);
    // Axis-aligned or turned boxes (images, text) keep their own type; mirrored ones are not supported.
    const placeBox = (matrix, x, y, w, h) => {
        const det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
        if (det <= 0) return null;
        const sx = Math.hypot(matrix[0], matrix[1]), sy = det / sx, angle = Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI;
        const [cx, cy] = apply(matrix, x + w / 2, y + h / 2), width = w * sx, height = h * sy;
        // Exporters round their matrices (Corel writes 0.866025), so the angle is rounded to 1/10000 degree.
        const rotation = Math.round(-angle * 1e4) / 1e4 || 0;
        return { x: cx - width / 2, y: cy - height / 2, width, height, ...(rotation ? { rotation } : {}) };
    };
    const visit = (element, parentStyle, parentMatrix, depth, using) => {
        if (full || depth > 60) return;
        const tag = tagOf(element);
        if (SKIPPED.has(tag)) return;
        const style = computeStyle(element, parentStyle, rules);
        if (style.display === 'none') return;
        if (style['clip-path'] && style['clip-path'] !== 'none') clipped++;
        let matrix = multiply(parentMatrix, parseTransform(attribute(element, 'transform')));
        const hidden = style.visibility === 'hidden' || style.visibility === 'collapse';
        if (tag === 'svg' && element !== svg) {
            // A nested viewport: its own position, size and viewBox.
            const box = numbers(attribute(element, 'viewBox')), x = lengthIn(element, 'x'), y = lengthIn(element, 'y');
            matrix = multiply(matrix, [1, 0, 0, 1, x, y]);
            if (box.length === 4 && box[2] > 0 && box[3] > 0) {
                const w = lengthIn(element, 'width', box[2]), h = lengthIn(element, 'height', box[3]), scale = Math.min(w / box[2], h / box[3]);
                matrix = multiply(matrix, [scale, 0, 0, scale, -box[0] * scale, -box[1] * scale]);
            }
        }
        if (tag === 'svg' || tag === 'g' || tag === 'a' || tag === 'switch') {
            for (const child of children(element)) visit(child, style, matrix, depth + 1, using);
            return;
        }
        if (tag === 'use') {
            const href = (attribute(element, 'href') || attribute(element, 'xlink:href') || '').replace(/^#/, ''), target = ids.get(href);
            if (!target || using.has(target)) { skipped++; return; }
            const placed = multiply(matrix, [1, 0, 0, 1, lengthIn(element, 'x'), lengthIn(element, 'y')]);
            const next = new Set(using).add(target);
            if (tagOf(target) === 'symbol') for (const child of children(target)) visit(child, style, placed, depth + 1, next);
            else visit(target, style, placed, depth + 1, next);
            return;
        }
        if (hidden) return;
        const n = name => lengthIn(element, name);
        if (tag === 'path') addCurve(element, style, matrix, parsePathData(attribute(element, 'd')), 'Curva');
        else if (tag === 'rect' || tag === 'circle' || tag === 'ellipse') {
            let x, y, w, h;
            if (tag === 'rect') { x = n('x'); y = n('y'); w = n('width'); h = n('height'); }
            else {
                const rx = tag === 'circle' ? n('r') : n('rx'), ry = tag === 'circle' ? n('r') : n('ry');
                x = n('cx') - rx; y = n('cy') - ry; w = 2 * rx; h = 2 * ry;
            }
            if (!(w > 0 && h > 0)) return;
            let rx = tag === 'rect' ? n('rx') : 0, ry = tag === 'rect' ? n('ry') : 0;
            if (tag === 'rect') { if (!attribute(element, 'rx')) rx = ry; if (!attribute(element, 'ry')) ry = rx; rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2); }
            // Rectangles and ellipses, also turned, stay editable as such; skewed, mirrored or rounded ones become curves.
            const box = !(rx > 0 && ry > 0) && unskewed(matrix) && placeBox(matrix, x, y, w, h);
            if (box) add({ ...createObject(tag === 'rect' ? 'rect' : 'ellipse', 0, 0), name: named(element, tag === 'rect' ? 'Rectángulo' : 'Elipse'), ...common(element, style, matrix), ...box });
            else addCurve(element, style, matrix, [tag === 'rect' ? rectSubpath(x, y, w, h, rx, ry) : ellipseSubpath(x + w / 2, y + h / 2, w / 2, h / 2)], tag === 'rect' ? 'Rectángulo' : 'Elipse');
        } else if (tag === 'line') addCurve(element, { ...style, fill: 'none' }, matrix, [polySubpath([n('x1'), n('y1'), n('x2'), n('y2')], false)], 'Línea');
        else if (tag === 'polyline' || tag === 'polygon') {
            const values = numbers(attribute(element, 'points'));
            if (values.length >= 4) addCurve(element, style, matrix, [polySubpath(values.slice(0, values.length - values.length % 2), tag === 'polygon')], 'Curva');
        } else if (tag === 'text') {
            const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            const span = [...walk(element)].find(item => tagOf(item) === 'tspan' && attribute(item, 'x') !== null);
            const x = numbers(attribute(element, 'x'))[0] ?? (span ? firstNumber(span, 'x') : 0), y = numbers(attribute(element, 'y'))[0] ?? (span ? firstNumber(span, 'y') : 0);
            const size = parseLength(style['font-size'] ?? '16')?.value || 16, estimate = text.length * size * .55;
            const shift = style['text-anchor'] === 'middle' ? estimate / 2 : style['text-anchor'] === 'end' ? estimate : 0;
            const box = placeBox(matrix, x - shift, y - size, estimate, size * 1.2);
            if (!box) { skipped++; return; }
            const fontSize = size * box.height / (size * 1.2);
            add({ ...createObject('text', 0, 0), name: text.slice(0, 40), text: text.slice(0, 10000), ...common(element, style, matrix), ...box, fontSize });
        } else if (tag === 'image') {
            const href = attribute(element, 'href') || attribute(element, 'xlink:href') || '';
            const box = placeBox(matrix, n('x'), n('y'), n('width'), n('height'));
            if (!/^data:image\/(png|jpeg|webp);base64,/i.test(href) || !box || !(box.width > 0 && box.height > 0)) { skipped++; return; }
            add({ ...createObject('image', 0, 0), name: named(element, 'Imagen'), src: href.replace(/\s+/g, ''), fill: 'none', stroke: 'none', strokeWidth: 0, ...box });
        } else if (tag !== 'tspan' && tag !== 'textpath') skipped++;
    };
    const rootStyle = computeStyle(svg, {}, rules);
    for (const child of children(svg)) visit(child, rootStyle, multiply(root.matrix, parseTransform(attribute(svg, 'transform'))), 0, new Set());
    return { objects, width: root.width, height: root.height, skipped, clipped, truncated: full };
}

export function importSvg(text, options = {}) {
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (parsed.getElementsByTagName('parsererror').length) throw new Error('El archivo SVG está dañado o no es válido.');
    return importSvgElement(parsed.documentElement, options);
}
