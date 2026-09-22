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
