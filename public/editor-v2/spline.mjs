// A closed curve adds the segment from the last point back to the first and wraps the neighbours,
// so the joint is as smooth as any other node.
export function splineSegments(points, closed = false) {
    const n = points.length, wrap = closed && n >= 3;
    const at = i => points[wrap ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    return Array.from({ length: wrap ? n : n - 1 }, (_, i) => {
        const p0 = at(i), before = at(i - 1), p3 = at(i + 1), after = at(i + 2);
        return { p0, p3, c1: { x: p0.x + (p3.x - before.x) / 6, y: p0.y + (p3.y - before.y) / 6 },
            c2: { x: p3.x - (after.x - p0.x) / 6, y: p3.y - (after.y - p0.y) / 6 } };
    });
}
export function curvePoint(s, t) {
    const u = 1 - t;
    return { x: u ** 3 * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t ** 3 * s.p3.x,
        y: u ** 3 * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t ** 3 * s.p3.y };
}
// Sample coarsely, then refine between the neighbouring samples.
export function closestOnSegment(segment, point) {
    let sample = 0, sampleDistance = Infinity;
    for (let i = 0; i <= 40; i++) {
        const p = curvePoint(segment, i / 40), distance = Math.hypot(point.x - p.x, point.y - p.y);
        if (distance < sampleDistance) { sample = i; sampleDistance = distance; }
    }
    let low = Math.max(0, (sample - 1) / 40), high = Math.min(1, (sample + 1) / 40);
    const distanceAt = t => { const p = curvePoint(segment, t); return Math.hypot(point.x - p.x, point.y - p.y); };
    for (let i = 0; i < 24; i++) {
        const left = (2 * low + high) / 3, right = (low + 2 * high) / 3;
        if (distanceAt(left) < distanceAt(right)) high = right; else low = left;
    }
    const p = curvePoint(segment, (low + high) / 2);
    return { x: p.x, y: p.y, distance: Math.hypot(point.x - p.x, point.y - p.y) };
}
export const splinePoints = object => object.points.map(p => ({ x: object.x + p.x * object.width, y: object.y + p.y * object.height }));
// index is the segment that holds the closest point; a node inserted there goes at index + 1.
export function closestOnSpline(object, point) {
    let best = null;
    splineSegments(splinePoints(object), object.closed).forEach((segment, index) => {
        const hit = closestOnSegment(segment, point);
        if (!best || hit.distance < best.distance) best = { ...hit, index };
    });
    return best;
}
export function pointsPath(points, closed = false) {
    if (!points.length) return '';
    return `M ${points[0].x} ${points[0].y} ` + splineSegments(points, closed).map(s => `C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.p3.x} ${s.p3.y}`).join(' ') +
        (closed && points.length >= 3 ? ' Z' : '');
}
export const splinePath = object => pointsPath(splinePoints(object), object.closed);
export function normalizeSpline(points, closed = false) {
    const extrema = [...points];
    for (const segment of splineSegments(points, closed)) {
        for (const axis of ['x', 'y']) {
            const a = -segment.p0[axis] + 3 * segment.c1[axis] - 3 * segment.c2[axis] + segment.p3[axis];
            const b = 2 * (segment.p0[axis] - 2 * segment.c1[axis] + segment.c2[axis]);
            const c = segment.c1[axis] - segment.p0[axis];
            const discriminant = b * b - 4 * a * c;
            const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b]) :
                discriminant < 0 ? [] : [(-b + Math.sqrt(discriminant)) / (2 * a), (-b - Math.sqrt(discriminant)) / (2 * a)];
            for (const t of roots) if (t > 0 && t < 1) extrema.push(curvePoint(segment, t));
        }
    }
    const x = Math.min(...extrema.map(p => p.x)), y = Math.min(...extrema.map(p => p.y));
    const width = Math.max(.1, Math.max(...extrema.map(p => p.x)) - x), height = Math.max(.1, Math.max(...extrema.map(p => p.y)) - y);
    return { x, y, width, height, points: points.map(p => ({ x: (p.x - x) / width, y: (p.y - y) / height })) };
}
// Node edits work in page coordinates and renormalize, so the bounds stay exact.
export function moveSplineNodes(object, indices, dx, dy) {
    const moving = new Set(indices);
    return normalizeSpline(splinePoints(object).map((p, i) => moving.has(i) ? { x: p.x + dx, y: p.y + dy } : p), object.closed);
}
export function insertSplineNode(object, { index, x, y }) {
    if (object.points.length >= 500) throw new Error('Máximo 500 puntos por spline.');
    const nodes = splinePoints(object);
    nodes.splice(index + 1, 0, { x, y });
    return normalizeSpline(nodes, object.closed);
}
export function removeSplineNodes(object, indices) {
    const removed = new Set(indices), nodes = splinePoints(object).filter((_, i) => !removed.has(i));
    if (object.closed && nodes.length < 3) throw new Error('Una curva cerrada necesita al menos tres nodos.');
    if (nodes.length < 2) throw new Error('Una spline necesita al menos dos nodos.');
    return normalizeSpline(nodes, object.closed);
}
