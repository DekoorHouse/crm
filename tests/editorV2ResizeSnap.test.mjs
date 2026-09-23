import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapResizeDelta, handlePoint, resizeBounds } from '../public/editor-v2/geometry.mjs';

test('a snapped corner keeps the proportion and lands exactly on the point along its nearer axis', () => {
    const box = { x: 0, y: 0, width: 40, height: 20 };
    // Dragging the south-east corner to (61, 31): x needs ×1.525, y ×1.55; x is the nearer fit.
    const delta = snapResizeDelta(box, 'se', { x: 21, y: 11 }), next = resizeBounds(box, 'se', delta.x, delta.y);
    assert.equal(next.x + next.width, 61);
    assert.ok(Math.abs(next.width / next.height - 2) < 1e-12);
    // A side handle takes the movement as it is.
    assert.deepEqual(snapResizeDelta(box, 'e', { x: 7, y: 3 }), { x: 7, y: 3 });
    const west = snapResizeDelta(box, 'nw', { x: -10, y: -1 }), grown = resizeBounds(box, 'nw', west.x, west.y);
    assert.ok(Math.abs(grown.y - -1) < 1e-12 || Math.abs(grown.x - -10) < 1e-12);
});

test('handles sit on the box, also when it is turned', () => {
    assert.deepEqual(handlePoint({ x: 10, y: 20, width: 40, height: 20 }, 'e'), { x: 50, y: 30 });
    const turned = handlePoint({ x: 0, y: 0, width: 40, height: 20, rotation: 90 }, 'e');
    assert.ok(Math.abs(turned.x - 20) < 1e-9 && Math.abs(turned.y - -10) < 1e-9, JSON.stringify(turned));
});

test('Shift resizes from the centre: both sides move and the handle still follows the pointer', async () => {
    const { resizeRotated, resizeSelection } = await import('../public/editor-v2/geometry.mjs');
    const box = { x: 10, y: 10, width: 40, height: 20 };
    // East handle 5 mm to the right: the west side moves 5 mm to the left.
    assert.deepEqual(resizeBounds(box, 'e', 5, 3, true), { x: 5, y: 10, width: 50, height: 20 });
    // A corner keeps the proportion and the centre.
    const corner = resizeBounds(box, 'se', 8, 4, true);
    assert.ok(Math.abs(corner.x + corner.width / 2 - 30) < 1e-9 && Math.abs(corner.y + corner.height / 2 - 20) < 1e-9);
    assert.ok(Math.abs(corner.width / corner.height - 2) < 1e-12 && corner.width > 40);
    // A snapped corner from the centre lands on the point along its nearer axis.
    const delta = snapResizeDelta(box, 'se', { x: 11, y: 7 }, true), snapped = resizeBounds(box, 'se', delta.x, delta.y, true);
    assert.ok(Math.abs(snapped.x + snapped.width - 61) < 1e-9 || Math.abs(snapped.y + snapped.height - 37) < 1e-9);
    // A turned shape keeps its centre.
    const turned = resizeRotated({ ...box, type: 'rect', rotation: 30 }, 'e', 4, 0, true);
    assert.ok(Math.abs(turned.x + turned.width / 2 - 30) < 1e-9 && Math.abs(turned.y + turned.height / 2 - 20) < 1e-9);
    // A selection grows around the centre of its box.
    const [a, b] = resizeSelection([{ ...box, id: 'a', type: 'rect' }, { x: 60, y: 10, width: 10, height: 20, id: 'b', type: 'rect' }], { x: 10, y: 10, width: 60, height: 20 }, 'e', 6, 0, true);
    assert.ok(Math.abs(a.x - 4) < 1e-9 && Math.abs(b.x + b.width - 76) < 1e-9);
});
