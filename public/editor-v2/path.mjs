// General curves ("Curva"), mostly from imported SVG: one or more subpaths of cubic Bézier segments,
// open or closed, with straight lines stored as cubics. Like splines, the points are normalized to the
// curve's exact bounds, so resizing only changes x, y, width and height.
// A subpath is { closed, points: [x0, y0, c1x, c1y, c2x, c2y, x1, y1, …] }: a start point, then three
// points (two controls and an end) per segment.
import { segmentsBounds } from './spline.mjs';

export const MAX_PATH_NUMBERS = 400000;

// Cubic segments of each subpath in page coordinates.
export function subpathSegments(object) {
    const { x, y, width, height } = object;
    return object.subpaths.map(subpath => {
        const p = subpath.points, at = i => ({ x: x + p[i] * width, y: y + p[i + 1] * height }), segments = [];
        for (let i = 2; i + 5 < p.length; i += 6) segments.push({ p0: at(i - 2), c1: at(i), c2: at(i + 2), p3: at(i + 4) });
        return segments;
    });
}
export const pathSegments = object => subpathSegments(object).flat();

const n = value => +value.toFixed(4);
export function pathData(object) {
    return subpathSegments(object).map((segments, i) => segments.length ? `M ${n(segments[0].p0.x)} ${n(segments[0].p0.y)} ` +
        segments.map(s => `C ${n(s.c1.x)} ${n(s.c1.y)} ${n(s.c2.x)} ${n(s.c2.y)} ${n(s.p3.x)} ${n(s.p3.y)}`).join(' ') +
        (object.subpaths[i].closed ? ' Z' : '') : '').join(' ');
}

// Page-coordinate subpaths → a curve's geometry fields.
export function normalizePath(subpaths) {
    const segments = [];
    for (const { points: p } of subpaths) for (let i = 2; i + 5 < p.length; i += 6) {
        segments.push({ p0: { x: p[i - 2], y: p[i - 1] }, c1: { x: p[i], y: p[i + 1] }, c2: { x: p[i + 2], y: p[i + 3] }, p3: { x: p[i + 4], y: p[i + 5] } });
    }
    const { x, y, width, height } = segmentsBounds(segments);
    return { x, y, width, height, subpaths: subpaths.map(({ closed, points }) => ({ closed, points: points.map((value, i) => i % 2 ? (value - y) / height : (value - x) / width) })) };
}

// Page-coordinate subpaths of a curve, e.g. to turn it or place it in a PowerClip.
export function pathPoints(object) {
    return object.subpaths.map(({ closed, points }) => ({ closed, points: points.map((value, i) => i % 2 ? object.y + value * object.height : object.x + value * object.width) }));
}

export function validPathGeometry(subpaths) {
    if (!Array.isArray(subpaths) || !subpaths.length) return false;
    let total = 0;
    for (const subpath of subpaths) {
        if (!subpath || typeof subpath.closed !== 'boolean' || !Array.isArray(subpath.points)) return false;
        const { points } = subpath;
        if (points.length < 8 || (points.length - 2) % 6) return false;
        total += points.length;
        if (total > MAX_PATH_NUMBERS) return false;
        for (const value of points) if (typeof value !== 'number' || !Number.isFinite(value) || value < -10000 || value > 10000) return false;
    }
    return true;
}
