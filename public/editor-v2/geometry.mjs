import { splinePoints, splineSegments, curvePoint, closestOnSegment } from './spline.mjs';
import { rotatePoint, pivot, turns, trig } from './transform.mjs';
import { subpathSegments, pathContains } from './path.mjs';
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
// fromCentre (Shift, as in CorelDRAW): the centre stays, so both sides of the axis move; the handle
// still follows the pointer.
export function resizeBounds(original, handle, dx, dy, fromCentre = false) {
    if (fromCentre) {
        const next = resizeBounds(original, handle, 2 * dx, 2 * dy);
        return { ...next, x: original.x + (original.width - next.width) / 2, y: original.y + (original.height - next.height) / 2 };
    }
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

// A resize handle snapped to a point: side handles take the movement as it is; corners, which scale in
// proportion, get the scale that puts the corner exactly on the point along the axis where it is closer.
export function snapResizeDelta(box, handle, delta, fromCentre = false) {
    const control = RESIZE_HANDLES.find(item => item.name === handle);
    const sx = control.x === 0 ? -1 : control.x === 1 ? 1 : 0, sy = control.y === 0 ? -1 : control.y === 1 ? 1 : 0;
    if (!sx || !sy) return delta;
    // From the centre, the corner moves half as much as the size grows.
    const k = fromCentre ? 2 : 1, { width: w, height: h } = box, fx = 1 + k * sx * delta.x / w, fy = 1 + k * sy * delta.y / h;
    const factor = Math.abs(sy * (fx - 1) * h / k - delta.y) <= Math.abs(sx * (fy - 1) * w / k - delta.x) ? fx : fy;
    return { x: sx * (factor - 1) * w / k, y: sy * (factor - 1) * h / k };
}
// The page point of a resize handle, also on a turned box.
export function handlePoint(box, handle) {
    const control = RESIZE_HANDLES.find(item => item.name === handle), local = { x: box.x + box.width * control.x, y: box.y + box.height * control.y };
    return box.rotation ? rotatePoint(local, pivot(box), box.rotation) : local;
}

// Resize a rotated shape along its own axes: the pointer delta is turned into the shape's frame, and
// the point opposite the dragged handle stays where it was on the page.
export function resizeRotated(original, handle, dx, dy, fromCentre = false) {
    const local = rotatePoint({ x: dx, y: dy }, { x: 0, y: 0 }, -original.rotation);
    const next = resizeBounds(original, handle, local.x, local.y, fromCentre), control = RESIZE_HANDLES.find(item => item.name === handle);
    // From the centre, the shape turns around the same point, so nothing else moves.
    if (fromCentre && original.type !== 'text') return next;
    const fixed = box => ({ x: box.x + box.width * (1 - control.x), y: box.y + box.height * (1 - control.y) });
    const before = rotatePoint(fixed(original), pivot(original), original.rotation);
    const after = rotatePoint(fixed(next), pivot({ ...original, ...next }), original.rotation);
    return { ...next, x: next.x + before.x - after.x, y: next.y + before.y - after.y };
}

// The page-aligned box around a shape, rotated or not. Text boxes come from rendering instead.
export function rotatedBounds(o) {
    if (!turns(o)) return { x: o.x, y: o.y, width: o.width, height: o.height };
    const c = pivot(o), cos = Math.abs(trig(o.rotation)[0]), sin = Math.abs(trig(o.rotation)[1]);
    const halfWidth = o.type === 'ellipse' ? Math.hypot(o.width / 2 * cos, o.height / 2 * sin) : (o.width * cos + o.height * sin) / 2;
    const halfHeight = o.type === 'ellipse' ? Math.hypot(o.width / 2 * sin, o.height / 2 * cos) : (o.width * sin + o.height * cos) / 2;
    return { x: c.x - halfWidth, y: c.y - halfHeight, width: 2 * halfWidth, height: 2 * halfHeight };
}

export function unionBounds(list) {
    const x = Math.min(...list.map(b => b.x)), y = Math.min(...list.map(b => b.y));
    return { x, y, width: Math.max(...list.map(b => b.x + b.width)) - x, height: Math.max(...list.map(b => b.y + b.height)) - y };
}

// Scale a selection inside its bounding box with the same handles as one object: corners keep
// proportions, sides stretch one axis. Text cannot stretch, so its size changes only on corners.
export function resizeSelection(items, box, handle, dx, dy, fromCentre = false) {
    const next = resizeBounds(box, handle, dx, dy, fromCentre);
    const sx = next.width / box.width, sy = next.height / box.height, corner = handle.length === 2;
    return items.map(item => {
        const moved = { ...item, x: next.x + (item.x - box.x) * sx, y: next.y + (item.y - box.y) * sy };
        if (item.type === 'text') return corner ? { ...moved, fontSize: Math.max(.1, item.fontSize * sx) } : moved;
        if (turns(item)) {
            // A rotated shape cannot stretch along the page axes either: its centre follows the box,
            // and it only changes size on corners.
            const c = pivot(item), width = corner ? Math.max(.1, item.width * sx) : item.width, height = corner ? Math.max(.1, item.height * sy) : item.height;
            return { ...item, width, height, x: next.x + (c.x - box.x) * sx - width / 2, y: next.y + (c.y - box.y) * sy - height / 2 };
        }
        return { ...moved, width: Math.max(.1, item.width * sx), height: Math.max(.1, item.height * sy) };
    });
}

export function objectReference(object, point, tolerance) {
    // A rotated shape finds the reference in its own frame, then turns it back onto the page.
    if (turns(object) && object.type !== 'text') {
        const c = pivot(object), local = objectReference({ ...object, rotation: 0 }, rotatePoint(point, c, -object.rotation), tolerance);
        return local && { ...local, ...rotatePoint(local, c, object.rotation) };
    }
    const { x, y, width: w, height: h } = object;
    if (point.x < x - tolerance || point.x > x + w + tolerance || point.y < y - tolerance || point.y > y + h + tolerance) return null;
    const cx = x + w / 2, cy = y + h / 2;
    const points = [{ x: cx, y: cy, label: 'Centro' }];
    if (object.type === 'spline' || object.type === 'path') {
        const runs = object.type === 'spline' ? [splineSegments(splinePoints(object), object.closed)] : subpathSegments(object), segments = runs.flat();
        // References sit on the visible curve (segment joints and midpoints), not on the control points.
        const joints = runs.flatMap(run => run.length ? [run[0].p0, ...run.map(s => s.p3)] : []);
        const refs = [...joints.map(p => ({ ...p, label: 'Nodo' })), ...segments.map(s => ({ ...curvePoint(s, .5), label: 'Punto medio' })), ...points];
        const near = refs.map(p => ({ ...p, distance: Math.hypot(point.x - p.x, point.y - p.y) })).filter(p => p.distance <= tolerance).sort((a, b) => a.distance - b.distance);
        if (near.length) return near[0];
        let best = null;
        for (const segment of segments) {
            const hit = closestOnSegment(segment, point);
            if (!best || hit.distance < best.distance) best = { x: hit.x, y: hit.y, distance: hit.distance, label: 'Borde' };
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

export function powerClipDropTarget(objects, sourceIds, point) {
    const sources = objects.filter(item => sourceIds.has(item.id));
    if (!sources.length || sources.some(item => item.locked || item.hidden)) return null;
    for (const item of [...objects].reverse()) {
        if (sourceIds.has(item.id) || item.hidden) continue;
        const local = turns(item) ? rotatePoint(point, pivot(item), -item.rotation) : point;
        const nx = (local.x - item.x) / item.width, ny = (local.y - item.y) / item.height;
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
        if (item.type === 'ellipse' && (2 * nx - 1) ** 2 + (2 * ny - 1) ** 2 > 1) continue;
        if (item.type === 'path' && !pathContains(item, local)) continue;
        if (item.powerClip && !item.locked) return item;
        // A visible foreground object blocks a container behind it.
        return null;
    }
    return null;
}

// Snap the grabbed point, preserving the pointer offset and the group's geometry.
export function snapTranslation(anchor, delta, objects, excludedIds, tolerance) {
    const position = { x: anchor.x + delta.x, y: anchor.y + delta.y };
    let hit = null;
    for (const target of [...objects].reverse()) {
        if (target.hidden || excludedIds.has(target.id)) continue;
        const reference = objectReference(target, position, tolerance);
        if (!reference) continue;
        const distance = Math.hypot(reference.x - position.x, reference.y - position.y);
        const priority = reference.label === 'Borde' ? 1 : 0;
        if (!hit || priority < hit.priority || (priority === hit.priority && distance < hit.distance))
            hit = { target, reference, distance, priority };
    }
    return {
        x: delta.x + (hit ? hit.reference.x - position.x : 0),
        y: delta.y + (hit ? hit.reference.y - position.y : 0),
        hit,
    };
}
