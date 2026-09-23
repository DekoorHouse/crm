import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorObject } from '../public/editor-v2/transform.mjs';
import { blankDocument, createObject, validateDocument, exportSvg } from '../public/editor-v2/model.mjs';

const centre = { x: 100, y: 50 };
test('shapes move across the axis and turned ones turn the other way', () => {
    const rect = { ...createObject('rect', 10, 20, 40, 30), rotation: 30 };
    const h = mirrorObject(rect, centre, 'x');
    assert.deepEqual([h.x, h.y, h.rotation], [150, 20, -30]);
    const v = mirrorObject(rect, centre, 'y');
    assert.deepEqual([v.x, v.y, v.rotation], [10, 50, -30]);
});
test('curves mirror their points and gradients; twice gives the original back', () => {
    const path = { ...createObject('path', 0, 0, 10, 10), subpaths: [{ closed: false, points: [0, 0, .2, .1, .3, .4, 1, .5] }],
        fillGradient: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ offset: 0, color: '#000000', opacity: 1 }], transform: [1, 0, 0, 1, 0, 0] } };
    const once = mirrorObject(path, { x: 5, y: 5 }, 'x');
    assert.deepEqual(once.subpaths[0].points, [1, 0, .8, .1, .7, .4, 0, .5]);
    assert.deepEqual(once.fillGradient.transform, [-1, 0, -0, 1, 1, 0]);
    const twice = mirrorObject(once, { x: 5, y: 5 }, 'x');
    twice.subpaths[0].points.forEach((value, i) => assert.ok(Math.abs(value - path.subpaths[0].points[i]) < 1e-12));
    assert.deepEqual(twice.fillGradient.transform.map(v => v + 0), path.fillGradient.transform);
    const spline = mirrorObject({ ...createObject('spline', 0, 0, 10, 10), points: [{ x: 0, y: .2 }, { x: 1, y: .9 }] }, { x: 20, y: 0 }, 'y');
    assert.deepEqual(spline.points, [{ x: 0, y: .8 }, { x: 1, y: .09999999999999998 }]);
});
test('text and images keep a flip mark that the markup draws; a second flip removes it', () => {
    const text = { ...createObject('text', 10, 10), text: 'Hola' };
    const flipped = mirrorObject(text, centre, 'x');
    assert.equal(flipped.flipX, true); assert.equal(flipped.x, 190);
    assert.equal('flipX' in mirrorObject(flipped, centre, 'x'), false);
    const d = blankDocument(); d.objects.push(flipped);
    assert.equal(validateDocument(d).objects[0].flipX, true);
    assert.match(exportSvg(d), /translate\(190 10\) scale\(-1 1\) translate\(-190 -10\)/);
    assert.throws(() => validateDocument({ ...d, objects: [{ ...createObject('rect', 0, 0), flipX: true }] }), /reflejo/);
});
test('PowerClip content is mirrored about its container centre', () => {
    const inner = createObject('rect', 0, 0, 10, 10);
    const box = { ...createObject('rect', 0, 0, 100, 100), powerClip: { width: 100, height: 100, transform: { x: 0, y: 0, scale: 1 }, objects: [inner] } };
    const mirrored = mirrorObject(box, { x: 50, y: 50 }, 'x');
    assert.equal(mirrored.powerClip.objects[0].x, 90);
});
