// Rotation, CorelDRAW-style: angles are degrees counterclockwise on screen. SVG's y axis points down,
// so the markup uses rotate(-angle).
import { splinePoints, normalizeSpline } from './spline.mjs';

// Quarter turns are exact, so 90° rotations leave clean coordinates in projects and exports.
export function trig(degrees) {
    const quarter = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[((degrees % 360) + 360) % 360];
    const a = degrees * Math.PI / 180;
    return quarter || [Math.cos(a), Math.sin(a)];
}
export function rotatePoint(p, centre, degrees) {
    if (!degrees) return { x: p.x, y: p.y };
    const [cos, sin] = trig(degrees), dx = p.x - centre.x, dy = p.y - centre.y;
    return { x: centre.x + dx * cos + dy * sin, y: centre.y - dx * sin + dy * cos };
}
// (-180, 180]
export function normalizeAngle(degrees) {
    const angle = ((degrees % 360) + 540) % 360 - 180;
    return angle === -180 ? 180 : angle;
}
// Angle of p seen from the centre, counterclockwise from the positive x axis.
export const angleOf = (p, centre) => Math.atan2(centre.y - p.y, p.x - centre.x) * 180 / Math.PI;
// Text turns around its anchor, because its box only exists once rendered; every other shape turns
// around its centre.
export const pivot = o => o.type === 'text' ? { x: o.x, y: o.y } : { x: o.x + o.width / 2, y: o.y + o.height / 2 };
export function placeAtPivot(o, p) {
    if (o.type === 'text') { o.x = p.x; o.y = p.y; } else { o.x = p.x - o.width / 2; o.y = p.y - o.height / 2; }
}
// Turn an object around any point. Splines turn their control points, like curves in CorelDRAW, and
// keep the angle only to show it in the panel; other objects keep their shape plus a rotation angle.
export function rotateObject(o, centre, degrees) {
    const turned = { ...o, rotation: normalizeAngle((o.rotation || 0) + degrees) };
    if (o.type === 'spline') return { ...turned, ...normalizeSpline(splinePoints(o).map(p => rotatePoint(p, centre, degrees)), o.closed) };
    placeAtPivot(turned, rotatePoint(pivot(o), centre, degrees));
    return turned;
}
// Whether the markup and the hit tests must turn the object (splines already carry their rotation).
export const turns = o => Boolean(o.rotation) && o.type !== 'spline';

// Mirror an object across the vertical line x = centre.x (axis 'x', reflect horizontally) or the
// horizontal line y = centre.y (axis 'y'). Curves and splines mirror their points in their own box,
// gradients their matrix, and the angle changes sign; symmetric shapes only move. Text and images keep a
// flipX / flipY mark that the markup draws. PowerClip content is mirrored about its container's centre.
const mirrorMatrix = (m, axis) => axis === 'x' ? [-m[0], m[1], -m[2], m[3], 1 - m[4], m[5]] : [m[0], -m[1], m[2], -m[3], m[4], 1 - m[5]];
const mirrorPoints = (points, axis) => points.map((value, i) => (i % 2 === (axis === 'x' ? 0 : 1)) ? 1 - value : value);
const mirrorSubpaths = (subpaths, axis) => subpaths.map(({ closed, points }) => ({ closed, points: mirrorPoints(points, axis) }));
export function mirrorObject(o, centre, axis) {
    const m = { ...o }, key = axis === 'x' ? 'flipX' : 'flipY';
    if (o.rotation) m.rotation = normalizeAngle(-o.rotation);
    if (o.type === 'spline') m.points = o.points.map(p => axis === 'x' ? { x: 1 - p.x, y: p.y } : { x: p.x, y: 1 - p.y });
    if (o.type === 'path') {
        m.subpaths = mirrorSubpaths(o.subpaths, axis);
        if (o.overlay) m.overlay = { ...o.overlay, subpaths: mirrorSubpaths(o.overlay.subpaths, axis) };
    }
    for (const gradient of ['fillGradient', 'strokeGradient']) if (o[gradient]) m[gradient] = { ...o[gradient], transform: mirrorMatrix(o[gradient].transform, axis) };
    if (o.type === 'text' || o.type === 'image') { if (o[key]) delete m[key]; else m[key] = true; }
    if (o.type === 'spline') {
        // Splines carry their rotation in their points: only their box moves.
        if (axis === 'x') m.x = 2 * centre.x - o.x - o.width; else m.y = 2 * centre.y - o.y - o.height;
    } else {
        const p = pivot(o);
        placeAtPivot(m, axis === 'x' ? { x: 2 * centre.x - p.x, y: p.y } : { x: p.x, y: 2 * centre.y - p.y });
    }
    if (o.powerClip) {
        const t = o.powerClip.transform || { x: 0, y: 0, scale: 1 };
        const inside = { x: (o.powerClip.width / 2 - t.x) / t.scale, y: (o.powerClip.height / 2 - t.y) / t.scale };
        m.powerClip = { ...o.powerClip, objects: o.powerClip.objects.map(item => mirrorObject(item, inside, axis)) };
    }
    return m;
}
