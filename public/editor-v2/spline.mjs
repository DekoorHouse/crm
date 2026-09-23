// CorelDRAW-style B-spline: the points are control points that pull the curve without it passing
// through them. An open curve is clamped to its first and last points by mirrored phantom points;
// a closed curve wraps around and touches none of them. Each segment becomes one cubic Bézier.
const mirror = (end, next) => ({ x: 2 * end.x - next.x, y: 2 * end.y - next.y });
export function splineSegments(points, closed = false) {
    const n = points.length, wrap = closed && n >= 3;
    if (n < 2) return [];
    const control = wrap ? points : [mirror(points[0], points[1]), ...points, mirror(points[n - 1], points[n - 2])];
    const at = i => control[wrap ? (i + n) % n : i];
    // Segment i is driven by four consecutive control points; its middle leg is points[i] → points[i + 1].
    return Array.from({ length: wrap ? n : n - 1 }, (_, i) => {
        const [q0, q1, q2, q3] = wrap ? [at(i - 1), at(i), at(i + 1), at(i + 2)] : [at(i), at(i + 1), at(i + 2), at(i + 3)];
        return {
            p0: { x: (q0.x + 4 * q1.x + q2.x) / 6, y: (q0.y + 4 * q1.y + q2.y) / 6 },
            c1: { x: (2 * q1.x + q2.x) / 3, y: (2 * q1.y + q2.y) / 3 },
            c2: { x: (q1.x + 2 * q2.x) / 3, y: (q1.y + 2 * q2.y) / 3 },
            p3: { x: (q1.x + 4 * q2.x + q3.x) / 6, y: (q1.y + 4 * q2.y + q3.y) / 6 },
        };
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
    const t = (low + high) / 2, p = curvePoint(segment, t);
    return { x: p.x, y: p.y, t, distance: Math.hypot(point.x - p.x, point.y - p.y) };
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
// The nearest point on the dashed control line; index is the leg that starts at points[index].
export function closestOnControlLine(object, point) {
    const nodes = splinePoints(object), legs = object.closed && nodes.length >= 3 ? nodes.length : nodes.length - 1;
    let best = null;
    for (let index = 0; index < legs; index++) {
        const a = nodes[index], b = nodes[(index + 1) % nodes.length], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
        const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
        const x = a.x + dx * t, y = a.y + dy * t, distance = Math.hypot(point.x - x, point.y - y);
        if (!best || distance < best.distance) best = { index, x, y, t, distance };
    }
    return best;
}
// Where a new control point goes when the curve itself is double-clicked: on the leg of the control
// line that drives that segment, at the same position along it.
export function legPoint(object, { index, t }) {
    const nodes = splinePoints(object), a = nodes[index], b = nodes[(index + 1) % nodes.length];
    return { index, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export function pointsPath(points, closed = false) {
    const segments = splineSegments(points, closed);
    if (!segments.length) return '';
    return `M ${segments[0].p0.x} ${segments[0].p0.y} ` + segments.map(s => `C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.p3.x} ${s.p3.y}`).join(' ') +
        (closed && points.length >= 3 ? ' Z' : '');
}
export const splinePath = object => pointsPath(splinePoints(object), object.closed);
// The dashed line that joins the control points, as CorelDRAW shows it while drawing and editing.
export function controlPath(points, closed = false) {
    if (points.length < 2) return '';
    return 'M ' + points.map(p => `${p.x} ${p.y}`).join(' L ') + (closed && points.length >= 3 ? ' Z' : '');
}
// The bounds follow the visible curve, so control points may fall outside them (normalized outside 0–1).
export function normalizeSpline(points, closed = false) {
    const { x, y, width, height } = segmentsBounds(splineSegments(points, closed), points);
    return { x, y, width, height, points: points.map(p => ({ x: (p.x - x) / width, y: (p.y - y) / height })) };
}
// Exact bounds of cubic Bézier segments (end points and the curve's turning points), at least 0.1 mm.
export function segmentsBounds(segments, fallback = []) {
    const extrema = segments.length ? segments.flatMap(s => [s.p0, s.p3]) : [...fallback];
    for (const segment of segments) {
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
    // A loop, not Math.min(...points): imported curves can have more points than a call takes arguments.
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of extrema) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
    return { x, y, width: Math.max(.1, right - x), height: Math.max(.1, bottom - y) };
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
