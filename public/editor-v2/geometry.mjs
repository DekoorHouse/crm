import { splinePoints, splineSegments, curvePoint } from './spline.mjs';
export const RESIZE_HANDLES = [
    { name: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
    { name: 'n', x: .5, y: 0, cursor: 'ns-resize' },
    { name: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
    { name: 'e', x: 1, y: .5, cursor: 'ew-resize' },
    { name: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
    { name: 's', x: .5, y: 1, cursor: 'ns-resize' },
    { name: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
    { name: 'w', x: 0, y: .5, cursor: 'ew-resize' },
];

// Corners scale uniformly about the opposite corner. Edge handles affect one axis.
// Crossing the fixed anchor stops at the minimum size instead of flipping the object.
export function resizeBounds(original, handle, dx, dy) {
    if (!RESIZE_HANDLES.some(item => item.name === handle)) throw new Error('Control de tamaño desconocido.');
    const sx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
    const sy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
    const { x, y, width: w, height: h } = original;
    let width = w, height = h;
    if (sx && sy) {
        // Project the pointer onto the original diagonal for smooth proportional resizing.
        const factor = Math.max(Math.max(.1 / w, .1 / h), Math.min(Math.min(10000 / w, 10000 / h),
            1 + (sx * dx * w + sy * dy * h) / (w * w + h * h)));
        width = w * factor; height = h * factor;
    } else {
        if (sx) width = Math.max(.1, Math.min(10000, w + sx * dx));
        if (sy) height = Math.max(.1, Math.min(10000, h + sy * dy));
    }
    return { x: sx < 0 ? x + w - width : x, y: sy < 0 ? y + h - height : y, width, height };
}

export function objectReference(object, point, tolerance) {
    const { x, y, width: w, height: h } = object;
    if (point.x < x - tolerance || point.x > x + w + tolerance || point.y < y - tolerance || point.y > y + h + tolerance) return null;
    const cx = x + w / 2, cy = y + h / 2;
    const points = [{ x: cx, y: cy, label: 'Centro' }];
    if (object.type === 'spline') {
        const nodes = splinePoints(object), segments = splineSegments(nodes);
        const refs = [...nodes.map(p => ({ ...p, label: 'Nodo' })), ...segments.map(s => ({ ...curvePoint(s, .5), label: 'Punto medio' })), ...points];
        const near = refs.map(p => ({ ...p, distance: Math.hypot(point.x - p.x, point.y - p.y) })).filter(p => p.distance <= tolerance).sort((a, b) => a.distance - b.distance);
        if (near.length) return near[0];
        let best = null;
        for (const segment of segments) {
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
            const p = curvePoint(segment, (low + high) / 2), distance = Math.hypot(point.x - p.x, point.y - p.y);
            if (!best || distance < best.distance) best = { ...p, distance, label: 'Borde' };
        }
        return best?.distance <= tolerance ? best : null;
    }
    if (object.type === 'rect') {
        points.push(...[[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([x, y]) => ({ x, y, label: 'Nodo' })));
        points.push(...[[cx, y], [x + w, cy], [cx, y + h], [x, cy]].map(([x, y]) => ({ x, y, label: 'Punto medio' })));
    } else if (object.type === 'ellipse') {
        points.push(...[[cx, y], [x + w, cy], [cx, y + h], [x, cy]].map(([x, y]) => ({ x, y, label: 'Nodo' })));
    }
    const nearby = points.map(p => ({ ...p, distance: Math.hypot(point.x - p.x, point.y - p.y) }))
        .filter(p => p.distance <= tolerance).sort((a, b) => a.distance - b.distance);
    if (nearby.length) return nearby[0];
    // Text has a typographic bounding box, not editable curve nodes or a geometric edge.
    if (object.type === 'text') return null;
    if (object.type === 'ellipse') {
        const a = w / 2, b = h / 2, dx = point.x - cx, dy = point.y - cy;
        if (a <= 0 || b <= 0) return null;
        // Find the closest perimeter point, including very elongated ellipses.
        const px = Math.abs(dx), py = Math.abs(dy);
        let low = 0, high = Math.PI / 2;
        const distance = angle => (a * Math.cos(angle) - px) ** 2 + (b * Math.sin(angle) - py) ** 2;
        // Seed from samples to avoid the other stationary point inside an ellipse.
        let best = 0;
        for (let i = 1; i <= 32; i++) if (distance(i * Math.PI / 64) < distance(best * Math.PI / 64)) best = i;
        low = Math.max(0, (best - 1) * Math.PI / 64); high = Math.min(Math.PI / 2, (best + 1) * Math.PI / 64);
        for (let i = 0; i < 24; i++) {
            const left = (2 * low + high) / 3, right = (low + 2 * high) / 3;
            if (distance(left) < distance(right)) high = right; else low = left;
        }
        const angle = (low + high) / 2;
        const edge = { x: cx + Math.sign(dx || 1) * a * Math.cos(angle), y: cy + Math.sign(dy || 1) * b * Math.sin(angle), label: 'Borde' };
        return Math.hypot(edge.x - point.x, edge.y - point.y) <= tolerance ? edge : null;
    }
    const edges = [
        { x: Math.max(x, Math.min(x + w, point.x)), y },
        { x: Math.max(x, Math.min(x + w, point.x)), y: y + h },
        { x, y: Math.max(y, Math.min(y + h, point.y)) },
        { x: x + w, y: Math.max(y, Math.min(y + h, point.y)) },
    ].map(p => ({ ...p, label: 'Borde', distance: Math.hypot(point.x - p.x, point.y - p.y) })).sort((a, b) => a.distance - b.distance);
    return edges[0].distance <= tolerance ? edges[0] : null;
}

export function fullyContained(area, bounds) {
    return bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height;
}
