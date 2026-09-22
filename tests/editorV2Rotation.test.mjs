import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotatePoint, normalizeAngle, angleOf, pivot, rotateObject } from '../public/editor-v2/transform.mjs';
import { rotatedBounds, objectReference, resizeRotated, resizeSelection, powerClipDropTarget, unionBounds } from '../public/editor-v2/geometry.mjs';
import { createObject, blankDocument, validateDocument, objectMarkup, placeInPowerClip, extractPowerClip } from '../public/editor-v2/model.mjs';
import { normalizeSpline, splinePoints } from '../public/editor-v2/spline.mjs';

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const closePoint = (p, q, tolerance) => { close(p.x, q.x, tolerance); close(p.y, q.y, tolerance); };
const rect = (extra = {}) => ({ ...createObject('rect', 10, 20, 40, 20), ...extra });

test('angles are counterclockwise on screen, like CorelDRAW', () => {
    closePoint(rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90), { x: 0, y: -1 });
    close(angleOf({ x: 0, y: -1 }, { x: 0, y: 0 }), 90);
    assert.deepEqual([normalizeAngle(270), normalizeAngle(-180), normalizeAngle(360)], [-90, 180, 0]);
});
test('shapes turn around the given centre; splines turn their control points instead of carrying a transform', () => {
    const turned = rotateObject(rect(), pivot(rect()), 30);
    assert.deepEqual([turned.x, turned.y, turned.width, turned.height, turned.rotation], [10, 20, 40, 20, 30]);
    // Text turns its anchor around the centre it gets (its visual centre in the editor).
    const text = rotateObject({ ...createObject('text', 10, 10) }, { x: 20, y: 10 }, 180);
    close(text.x, 30); close(text.y, 10); assert.equal(text.rotation, 180);
    assert.match(objectMarkup(text), /^<g transform="rotate\(-180 30 10\)"><text /);
    const spline = { ...createObject('spline', 0, 0), ...normalizeSpline([{ x: 0, y: 0 }, { x: 40, y: 0 }]) };
    const upright = rotateObject(spline, { x: 20, y: 0 }, 90);
    splinePoints(upright).forEach((p, i) => closePoint(p, [{ x: 20, y: 20 }, { x: 20, y: -20 }][i]));
    assert.equal(upright.rotation, 90);
    assert.doesNotMatch(objectMarkup(upright), /rotate/);
});
test('rotated shapes draw, bound, snap and take drops in their turned frame', () => {
    const r = rect({ rotation: 90 });
    assert.match(objectMarkup(r), /^<g transform="rotate\(-90 30 30\)"><rect x="10" y="20" width="40" height="20"/);
    assert.deepEqual(rotatedBounds(r), { x: 20, y: 10, width: 20, height: 40 });
    close(rotatedBounds({ ...createObject('ellipse', 0, 0, 40, 20), rotation: 45 }).width, 2 * Math.hypot(20 * Math.SQRT1_2, 10 * Math.SQRT1_2));
    // The local bottom-left corner (10, 40) lands on (40, 50) once turned.
    const corner = objectReference(r, { x: 40.3, y: 49.8 }, 1);
    assert.equal(corner?.label, 'Nodo'); closePoint(corner, { x: 40, y: 50 });
    const container = { ...rect({ id: 'c', rotation: 90 }), powerClip: { width: 40, height: 20, objects: [] } }, source = { ...createObject('rect', 0, 0), id: 's' };
    assert.equal(powerClipDropTarget([container, source], new Set(['s']), { x: 30, y: 45 })?.id, 'c');
    assert.equal(powerClipDropTarget([container, source], new Set(['s']), { x: 45, y: 30 }), null);
});
test('a rotated shape resizes along its own sides and keeps the opposite point on the page', () => {
    const r = rect({ rotation: 30 }), drag = rotatePoint({ x: 10, y: 5 }, { x: 0, y: 0 }, 30);
    const scaled = { ...r, ...resizeRotated(r, 'se', drag.x, drag.y) };
    close(scaled.width, 50); close(scaled.height, 25);
    closePoint(rotatePoint({ x: scaled.x, y: scaled.y }, pivot(scaled), 30), rotatePoint({ x: r.x, y: r.y }, pivot(r), 30));
    const stretched = { ...r, ...resizeRotated(r, 'e', drag.x, drag.y) };
    close(stretched.width, 50); close(stretched.height, 20);
    closePoint(rotatePoint({ x: stretched.x, y: stretched.y + 10 }, pivot(stretched), 30), rotatePoint({ x: r.x, y: r.y + 10 }, pivot(r), 30));
});
test('in a group, rotated shapes follow the box with their centre and only resize on corners', () => {
    const items = [rect({ id: 'a' }), rect({ id: 'b', x: 70, y: 20, rotation: 90 })];
    const box = unionBounds(items.map(rotatedBounds));
    assert.deepEqual(box, { x: 10, y: 10, width: 90, height: 40 });
    const [, doubled] = resizeSelection(items, box, 'se', 90, 40);
    assert.deepEqual([doubled.width, doubled.height, doubled.rotation], [80, 40, 90]);
    closePoint(pivot(doubled), { x: 170, y: 50 });
    const [, stretched] = resizeSelection(items, box, 'e', 90, 0);
    assert.deepEqual([stretched.width, stretched.height], [40, 20]);
    closePoint(pivot(stretched), { x: 170, y: 30 });
});
test('placing into a rotated PowerClip and extracting again keeps the page geometry and angle', () => {
    const d = blankDocument();
    const photo = { ...createObject('image', 30, 25, 30, 20), id: 'photo', src: 'data:image/png;base64,aGVsbG8=', rotation: 10 };
    d.objects.push({ ...createObject('ellipse', 20, 20, 60, 40), id: 'frame', rotation: 30 }, photo);
    placeInPowerClip(d, new Set(['photo']), 'frame', { createContainer: true });
    assert.equal(d.objects[0].powerClip.objects[0].rotation, -20);
    assert.doesNotThrow(() => validateDocument(d));
    extractPowerClip(d, 'frame');
    const back = d.objects.find(o => o.id === 'photo');
    closePoint(pivot(back), pivot(photo)); close(back.width, 30); close(back.height, 20); close(back.rotation, 10);
});
test('projects keep the rotation normalised; zero disappears and invalid angles are rejected', () => {
    const d = blankDocument(); d.objects.push(rect({ rotation: 270 }));
    assert.equal(validateDocument(d).objects[0].rotation, -90);
    d.objects[0].rotation = 360; assert.equal('rotation' in validateDocument(d).objects[0], false);
    d.objects[0].rotation = 400; assert.throws(() => validateDocument(d));
    d.objects[0].rotation = '45'; assert.throws(() => validateDocument(d));
});
