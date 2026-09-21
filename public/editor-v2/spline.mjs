export function splineSegments(points) {
    return points.slice(0, -1).map((p0, i) => {
        const before = points[Math.max(0, i - 1)], p3 = points[i + 1], after = points[Math.min(points.length - 1, i + 2)];
        return { p0, p3, c1: { x: p0.x + (p3.x - before.x) / 6, y: p0.y + (p3.y - before.y) / 6 },
            c2: { x: p3.x - (after.x - p0.x) / 6, y: p3.y - (after.y - p0.y) / 6 } };
    });
}
export function curvePoint(s, t) {
    const u = 1 - t;
    return { x: u ** 3 * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t ** 3 * s.p3.x,
        y: u ** 3 * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t ** 3 * s.p3.y };
}
export const splinePoints = object => object.points.map(p => ({ x: object.x + p.x * object.width, y: object.y + p.y * object.height }));
export function pointsPath(points) {
    if (!points.length) return '';
    return `M ${points[0].x} ${points[0].y} ` + splineSegments(points).map(s => `C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.p3.x} ${s.p3.y}`).join(' ');
}
export const splinePath = object => pointsPath(splinePoints(object));
export function normalizeSpline(points) {
    const extrema = [...points];
    for (const segment of splineSegments(points)) {
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
