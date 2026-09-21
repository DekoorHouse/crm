import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeBounds } from '../public/editor-v2/geometry.mjs';

const box = { x: 10, y: 20, width: 80, height: 40 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);
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
