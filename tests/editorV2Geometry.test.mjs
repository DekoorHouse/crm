import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeBounds, objectReference } from '../public/editor-v2/geometry.mjs';

const box = { x: 10, y: 20, width: 80, height: 40 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);
test('rectangle hover identifies center, corners, midpoints and edges within screen tolerance', () => {
    const object = { ...box, type: 'rect' };
    for (const [x, y, label] of [[50, 40, 'Centro'], [10, 20, 'Nodo'], [90, 60, 'Nodo'], [50, 20, 'Punto medio'], [10, 40, 'Punto medio'], [30, 20, 'Borde']]) {
        assert.equal(objectReference(object, { x: x + .2, y: y + .2 }, 1)?.label, label);
    }
    assert.equal(objectReference(object, { x: 30, y: 30 }, 1), null);
    assert.equal(objectReference(object, { x: 30, y: 22 }, 1), null);
    assert.equal(objectReference(object, { x: 30, y: 22 }, 3)?.label, 'Borde');
});
test('ellipse hover follows the curved perimeter, not the bounding box', () => {
    const object = { ...box, type: 'ellipse' };
    assert.equal(objectReference(object, { x: 50, y: 40 }, 1)?.label, 'Centro');
    assert.equal(objectReference(object, { x: 90, y: 40 }, 1)?.label, 'Nodo');
    assert.equal(objectReference(object, { x: 10, y: 20 }, 1), null);
    const p = { x: 50 + 40 * Math.cos(.7), y: 40 + 20 * Math.sin(.7) };
    const edge = objectReference(object, p, 1);
    assert.equal(edge?.label, 'Borde');
    assert.ok(Math.hypot(edge.x - p.x, edge.y - p.y) < .001);
});
for (const [corner, sx, sy] of [['nw', -1, -1], ['ne', 1, -1], ['sw', -1, 1], ['se', 1, 1]]) {
    test(`${corner}: proportional scaling keeps the opposite corner fixed`, () => {
        for (const [dx, dy] of [[40 * sx, 20 * sy], [30, -10], [-8 * sx, -4 * sy]]) {
            const result = resizeBounds(box, corner, dx, dy);
            close(result.width / result.height, 2);
            close(sx < 0 ? result.x + result.width : result.x, sx < 0 ? 90 : 10);
            close(sy < 0 ? result.y + result.height : result.y, sy < 0 ? 60 : 20);
        }
        const enlarged = resizeBounds(box, corner, 40 * sx, 20 * sy);
        close(enlarged.width, 120); close(enlarged.height, 60);
        const minimum = resizeBounds(box, corner, -800 * sx, -400 * sy);
        close(minimum.height, .1); close(minimum.width, .2);
    });
}
test('midpoints stretch only their own axis and keep the opposite edge fixed', () => {
    assert.deepEqual(resizeBounds(box, 'e', 25, 90), { ...box, width: 105 });
    assert.deepEqual(resizeBounds(box, 'w', -25, 90), { ...box, x: -15, width: 105 });
    assert.deepEqual(resizeBounds(box, 's', 90, 25), { ...box, height: 65 });
    assert.deepEqual(resizeBounds(box, 'n', 90, -25), { ...box, y: -5, height: 65 });
    const collapsed = resizeBounds(box, 'w', 999, 0);
    close(collapsed.width, .1); close(collapsed.x + collapsed.width, 90);
    assert.deepEqual(box, { x: 10, y: 20, width: 80, height: 40 });
});
