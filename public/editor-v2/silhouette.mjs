// "Silueta", like CorelDRAW's contour tool: outlines at a set distance outside or inside the selection.
// The selection is drawn into a fine grid (its alpha is the shape, so images, text and outlines all
// count), the distance of every pixel to the shape is measured, and the line at the wanted distance is
// traced and smoothed into a curve. All functions here are pure; the editor does the drawing.

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher): for every pixel, the distance to the
// nearest pixel where `inside` is true (0 on those pixels).
export function distanceField(inside, width, height) {
    const INF = 1e20, grid = new Float64Array(width * height);
    for (let i = 0; i < grid.length; i++) grid[i] = inside[i] ? 0 : INF;
    const size = Math.max(width, height), f = new Float64Array(size), d = new Float64Array(size), v = new Int32Array(size), z = new Float64Array(size + 1);
    const pass = n => {
        let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
        for (let q = 1; q < n; q++) {
            let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
            k++; v[k] = q; z[k] = s; z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
    };
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
        pass(height);
        for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) f[x] = grid[y * width + x];
        pass(width);
        for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
    }
    const out = new Float32Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(grid[i]);
    return out;
}

// Pixels inside the shape, with its holes filled (what is not reachable from the border): an outside
// silhouette follows the outer edge only, like a sticker's cut line.
export function fillHoles(inside, width, height) {
    const outside = new Uint8Array(width * height), stack = [];
    const push = (x, y) => { const i = y * width + x; if (!inside[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
    for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
    for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
    while (stack.length) {
        const i = stack.pop(), x = i % width, y = (i - x) / width;
        if (x > 0) push(x - 1, y); if (x < width - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < height - 1) push(x, y + 1);
    }
    const filled = new Uint8Array(width * height);
    for (let i = 0; i < filled.length; i++) filled[i] = outside[i] ? 0 : 1;
    return filled;
}

// Closed lines where value = 0 (marching squares on pixel centres, interpolated between them). Positive
// values are inside. The grid is padded with an outside border, so every line closes.
export function contourLoops(value, width, height) {
    const W = width + 2, H = height + 2, at = (x, y) => (x <= 0 || y <= 0 || x > width || y > height) ? -1 : value[(y - 1) * width + (x - 1)];
    const points = new Map(), links = new Map();
    // Each cell edge has a number: even for horizontal edges, odd for vertical ones.
    const edgePoint = (x0, y0, x1, y1) => {
        const key = x0 === x1 ? (Math.min(y0, y1) * W + x0) * 2 + 1 : (y0 * W + Math.min(x0, x1)) * 2;
        if (!points.has(key)) {
            const a = at(x0, y0), b = at(x1, y1), t = a === b ? .5 : a / (a - b);
            points.set(key, { x: x0 + (x1 - x0) * t - .5, y: y0 + (y1 - y0) * t - .5 });
        }
        return key;
    };
    const link = (a, b) => { for (const [p, q] of [[a, b], [b, a]]) { if (!links.has(p)) links.set(p, []); links.get(p).push(q); } };
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
        const tl = at(x, y) > 0, tr = at(x + 1, y) > 0, br = at(x + 1, y + 1) > 0, bl = at(x, y + 1) > 0;
        const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const top = () => edgePoint(x, y, x + 1, y), right = () => edgePoint(x + 1, y, x + 1, y + 1);
        const bottom = () => edgePoint(x, y + 1, x + 1, y + 1), left = () => edgePoint(x, y, x, y + 1);
        const centre = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 > 0;
        switch (code) {
            case 1: case 14: link(left(), bottom()); break;
            case 2: case 13: link(bottom(), right()); break;
            case 3: case 12: link(left(), right()); break;
            case 4: case 11: link(top(), right()); break;
            case 6: case 9: link(top(), bottom()); break;
            case 7: case 8: link(left(), top()); break;
            // Saddles: the centre decides whether the two inside corners are joined.
            case 5: if (centre) { link(left(), top()); link(bottom(), right()); } else { link(left(), bottom()); link(top(), right()); } break;
            case 10: if (centre) { link(left(), bottom()); link(top(), right()); } else { link(left(), top()); link(bottom(), right()); } break;
        }
    }
    const loops = [], seen = new Set();
    for (const start of links.keys()) {
        if (seen.has(start)) continue;
        const loop = [];
        let previous = null, current = start;
        while (current && !seen.has(current)) {
            seen.add(current); loop.push(points.get(current));
            const next = links.get(current).find(key => key !== previous && !seen.has(key));
            previous = current; current = next;
        }
        if (loop.length >= 3) loops.push(loop);
    }
    return loops;
}

// Douglas–Peucker on a closed loop, then a smooth closed curve through the kept points (Catmull–Rom
// turned into cubic Bézier segments). Returns the editor's subpath form: start point, then c1, c2, end.
export function simplifyLoop(loop, tolerance) {
    if (loop.length < 4) return loop;
    const far = (a, b, list) => {
        let best = -1, index = -1;
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
        list.forEach((p, i) => { const distance = Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / length; if (distance > best) { best = distance; index = i; } });
        return { best, index };
    };
    const reduce = list => {
        if (list.length < 3) return list;
        const { best, index } = far(list[0], list.at(-1), list.slice(1, -1));
        if (best <= tolerance) return [list[0], list.at(-1)];
        const split = index + 1;
        return [...reduce(list.slice(0, split + 1)).slice(0, -1), ...reduce(list.slice(split))];
    };
    // Split the loop at its farthest point from the start, so both halves are open polylines.
    let opposite = 0, distance = -1;
    loop.forEach((p, i) => { const d = Math.hypot(p.x - loop[0].x, p.y - loop[0].y); if (d > distance) { distance = d; opposite = i; } });
    const first = reduce(loop.slice(0, opposite + 1)), second = reduce([...loop.slice(opposite), loop[0]]);
    return [...first.slice(0, -1), ...second.slice(0, -1)];
}
export function smoothLoop(points) {
    const n = points.length, out = [points[0].x, points[0].y];
    for (let i = 0; i < n; i++) {
        const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
        out.push(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
    }
    return { closed: true, points: out };
}

// The silhouettes of a mask: one entry per step, each a list of closed subpaths in pixel coordinates.
// distance is in pixels; outside silhouettes grow from the shape (holes filled), inside ones shrink it.
export function silhouettes(inside, width, height, options) {
    return traceSilhouettes(silhouetteField(inside, width, height, options.direction ?? 'outside'), width, height, options);
}
// The distance field for one direction, measured once so dragging only traces new lines: outside, the
// distance to the shape (holes filled); inside, the distance to the outside.
export function silhouetteField(inside, width, height, direction) {
    const shape = direction === 'outside' ? fillHoles(inside, width, height) : Uint8Array.from(inside, v => v ? 0 : 1);
    return distanceField(shape, width, height);
}
// round: the corners the offset leaves pointed (where the rounded outlines of two parts meet, such as
// between letters) are rounded with this fraction of the distance, like a sticker's cut line. Outside,
// the shape is grown by the distance plus that radius and shrunk back by the radius; inside, the reverse.
export function roundedValue(field, width, height, r, radius, direction) {
    const value = new Float32Array(field.length);
    if (radius < 1) {
        for (let i = 0; i < value.length; i++) value[i] = direction === 'outside' ? r - field[i] : field[i] - r;
        return value;
    }
    const grown = new Uint8Array(field.length);
    // Outside: the pixels out of the grown shape; inside: the pixels left in the shrunken one.
    for (let i = 0; i < grown.length; i++) grown[i] = direction === 'outside' ? (field[i] > r + radius ? 1 : 0) : (field[i] >= r + radius ? 1 : 0);
    const back = distanceField(grown, width, height);
    for (let i = 0; i < value.length; i++) value[i] = direction === 'outside' ? back[i] - radius : radius - back[i];
    return value;
}
export function traceSilhouettes(field, width, height, { distance, steps = 1, direction = 'outside', tolerance = .35, round = .5 }) {
    const result = [];
    for (let step = 1; step <= steps; step++) {
        // Distances run between pixel centres; the shape's edge lies half a pixel from its last pixel.
        const r = distance * step + .5, value = roundedValue(field, width, height, r, direction === 'outside' ? distance * step * round : 0, direction);
        const loops = contourLoops(value, width, height).map(loop => simplifyLoop(loop, tolerance)).filter(loop => loop.length >= 3);
        if (!loops.length) break;
        result.push(loops.map(smoothLoop));
    }
    return result;
}
