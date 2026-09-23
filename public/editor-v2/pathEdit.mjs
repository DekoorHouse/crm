// Node editing for curves: nodes (anchor points) with an incoming and an outgoing handle, as in
// CorelDRAW. Each subpath is turned into a list of nodes, edited, and turned back into cubic segments.
// Nodes are numbered across all subpaths. Everything a caller passes or receives is in page
// coordinates, so a turned curve is edited where it is seen.
import { normalizePath, pathPoints } from './path.mjs';
import { closestOnSegment } from './spline.mjs';
import { rotatePoint, pivot } from './transform.mjs';

const same = (ax, ay, bx, by) => Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9;
// A closed subpath ends where it starts; that last point is the first node again, not a node of its own.
function toNodes({ closed, points }) {
    const nodes = [];
    for (let i = 0; i + 1 < points.length; i += 6) nodes.push({ x: points[i], y: points[i + 1], in: i ? { x: points[i - 2], y: points[i - 1] } : null, out: i + 3 < points.length ? { x: points[i + 2], y: points[i + 3] } : null });
    if (closed && nodes.length > 1) {
        const last = nodes.at(-1);
        if (same(last.x, last.y, nodes[0].x, nodes[0].y)) { nodes[0].in = last.in; nodes.pop(); }
        else { last.out = { x: last.x + (nodes[0].x - last.x) / 3, y: last.y + (nodes[0].y - last.y) / 3 }; nodes[0].in = { x: last.x + 2 * (nodes[0].x - last.x) / 3, y: last.y + 2 * (nodes[0].y - last.y) / 3 }; }
    }
    return { closed, nodes };
}
const handleOr = (handle, node) => handle || { x: node.x, y: node.y };
function fromNodes({ closed, nodes }) {
    const points = [nodes[0].x, nodes[0].y];
    const link = (a, b) => { const out = handleOr(a.out, a), into = handleOr(b.in, b); points.push(out.x, out.y, into.x, into.y, b.x, b.y); };
    for (let k = 0; k + 1 < nodes.length; k++) link(nodes[k], nodes[k + 1]);
    if (closed) link(nodes.at(-1), nodes[0]);
    return { closed, points };
}

// Page ↔ the curve's own unturned coordinates.
const toLocal = (object, p) => object.rotation ? rotatePoint(p, pivot(object), -object.rotation) : p;
const toPage = (object, p) => object.rotation ? rotatePoint(p, pivot(object), object.rotation) : p;
const lists = object => pathPoints(object).map(toNodes);
// New bounds move the centre a turned curve turns around; shift it so unedited nodes stay in place.
function rebuild(object, subpaths) {
    const geometry = normalizePath(subpaths.map(fromNodes));
    if (object.rotation) {
        const before = rotatePoint({ x: 0, y: 0 }, pivot(object), object.rotation), after = rotatePoint({ x: 0, y: 0 }, pivot({ ...object, ...geometry }), object.rotation);
        geometry.x += before.x - after.x; geometry.y += before.y - after.y;
    }
    return geometry;
}
function locate(subpaths, index) {
    for (let s = 0; s < subpaths.length; s++) {
        if (index < subpaths[s].nodes.length) return { s, k: index };
        index -= subpaths[s].nodes.length;
    }
    return null;
}

export function pathNodes(object) {
    return lists(object).flatMap(({ nodes }) => nodes.map(node => ({
        ...toPage(object, node), in: node.in && toPage(object, node.in), out: node.out && toPage(object, node.out),
    })));
}
export function movePathNodes(object, indices, dx, dy) {
    const subpaths = lists(object), delta = object.rotation ? rotatePoint({ x: dx, y: dy }, { x: 0, y: 0 }, -object.rotation) : { x: dx, y: dy };
    for (const index of new Set(indices)) {
        const at = locate(subpaths, index); if (!at) continue;
        const node = subpaths[at.s].nodes[at.k];
        for (const p of [node, node.in, node.out]) if (p) { p.x += delta.x; p.y += delta.y; }
    }
    return rebuild(object, subpaths);
}
// Moves one handle to a page point. A smooth node (its handles in line) stays smooth: the other handle
// turns with it and keeps its length.
export function movePathHandle(object, index, side, point) {
    const subpaths = lists(object), at = locate(subpaths, index);
    if (!at) return rebuild(object, subpaths);
    const node = subpaths[at.s].nodes[at.k], moved = node[side], other = node[side === 'in' ? 'out' : 'in'];
    if (!moved) return rebuild(object, subpaths);
    const target = toLocal(object, point);
    if (other) {
        const a = Math.atan2(moved.y - node.y, moved.x - node.x), b = Math.atan2(other.y - node.y, other.x - node.x);
        const gap = Math.abs(((a - b) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
        const length = Math.hypot(other.x - node.x, other.y - node.y), reach = Math.hypot(target.x - node.x, target.y - node.y);
        if (gap < 2 * Math.PI / 180 && length > 1e-9 && reach > 1e-9 && Math.hypot(moved.x - node.x, moved.y - node.y) > 1e-9) {
            other.x = node.x - (target.x - node.x) / reach * length; other.y = node.y - (target.y - node.y) / reach * length;
        }
    }
    moved.x = target.x; moved.y = target.y;
    return rebuild(object, subpaths);
}
// The closest point on the curve: its segment (from node k to the next one), t and page position.
export function closestOnPath(object, point) {
    const local = toLocal(object, point);
    let best = null, first = 0;
    lists(object).forEach(({ closed, nodes }) => {
        const count = closed ? nodes.length : nodes.length - 1;
        for (let k = 0; k < count; k++) {
            const a = nodes[k], b = nodes[(k + 1) % nodes.length];
            const hit = closestOnSegment({ p0: a, c1: handleOr(a.out, a), c2: handleOr(b.in, b), p3: b }, local);
            if (!best || hit.distance < best.distance) best = { ...toPage(object, hit), t: hit.t, distance: hit.distance, index: first + k };
        }
        first += nodes.length;
    });
    return best;
}
// Splits the segment after node hit.index at hit.t (de Casteljau), so the curve keeps its shape.
export function insertPathNode(object, hit) {
    const subpaths = lists(object), at = locate(subpaths, hit.index);
    if (!at) throw new Error('No se encontró ese tramo de la curva.');
    const { nodes } = subpaths[at.s], a = nodes[at.k], b = nodes[(at.k + 1) % nodes.length], t = hit.t;
    const mix = (p, q) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    const p1 = handleOr(a.out, a), p2 = handleOr(b.in, b), p01 = mix(a, p1), p12 = mix(p1, p2), p23 = mix(p2, b), p012 = mix(p01, p12), p123 = mix(p12, p23);
    a.out = p01; b.in = p23;
    nodes.splice(at.k + 1, 0, { ...mix(p012, p123), in: p012, out: p123 });
    return { geometry: rebuild(object, subpaths), node: hit.index + 1 };
}
// Removing a node joins its two segments; subpaths left with fewer than two nodes disappear.
export function removePathNodes(object, indices) {
    const subpaths = lists(object), remove = new Set(indices);
    let first = 0;
    const kept = [];
    for (const subpath of subpaths) {
        const nodes = subpath.nodes.filter((_, k) => !remove.has(first + k));
        first += subpath.nodes.length;
        if (nodes.length < 2) continue;
        if (!subpath.closed) { nodes[0].in = null; nodes.at(-1).out = null; }
        kept.push({ closed: subpath.closed, nodes });
    }
    if (!kept.length) throw new Error('Una curva necesita al menos dos nodos.');
    return rebuild(object, kept);
}
