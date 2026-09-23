import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceField, fillHoles, contourLoops, silhouettes } from '../public/editor-v2/silhouette.mjs';
import { curvePoint } from '../public/editor-v2/spline.mjs';

const disc = (size, cx, cy, radius, hole = 0) => {
    const mask = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + .5 - cx, y + .5 - cy);
        mask[y * size + x] = d <= radius && d >= hole ? 1 : 0;
    }
    return mask;
};
// Distances from a centre to points sampled along every segment of a subpath.
const radii = (subpath, cx, cy) => {
    const p = subpath.points, out = [];
    for (let i = 2; i + 5 < p.length; i += 6) {
        const s = { p0: { x: p[i - 2], y: p[i - 1] }, c1: { x: p[i], y: p[i + 1] }, c2: { x: p[i + 2], y: p[i + 3] }, p3: { x: p[i + 4], y: p[i + 5] } };
        for (const t of [0, .5]) { const q = curvePoint(s, t); out.push(Math.hypot(q.x - cx, q.y - cy)); }
    }
    return out;
};

test('the distance field is exact along rows, columns and diagonals', () => {
    const inside = new Uint8Array(25); inside[12] = 1;
    const field = distanceField(inside, 5, 5);
    assert.equal(field[12], 0); assert.equal(field[14], 2); assert.equal(field[2], 2);
    assert.ok(Math.abs(field[0] - Math.hypot(2, 2)) < 1e-6);
});

test('an outside silhouette of a disc is a larger circle at the chosen distance', () => {
    const size = 200, mask = disc(size, 100, 100, 50);
    const [[subpath]] = silhouettes(mask, size, size, { distance: 20 });
    assert.equal(subpath.closed, true);
    for (const r of radii(subpath, 100, 100)) assert.ok(Math.abs(r - 70) < 1.2, `radius ${r}`);
});

test('several steps grow outward; inside silhouettes shrink; holes only count inside', () => {
    const size = 200, ring = disc(size, 100, 100, 60, 25);
    const outside = silhouettes(ring, size, size, { distance: 10, steps: 2 });
    assert.equal(outside.length, 2);
    // Outside, the hole is filled: one loop per step, at 70 and 80.
    assert.equal(outside[0].length, 1); assert.equal(outside[1].length, 1);
    const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
    assert.ok(Math.abs(mean(radii(outside[1][0], 100, 100)) - 80) < 1.2);
    // Inside a ring there are two loops, one next to each edge.
    const inside = silhouettes(ring, size, size, { distance: 5, direction: 'inside' });
    assert.equal(inside[0].length, 2);
    const means = inside[0].map(loop => mean(radii(loop, 100, 100))).sort((a, b) => a - b);
    assert.ok(Math.abs(means[0] - 30) < 1.2 && Math.abs(means[1] - 55) < 1.2, JSON.stringify(means));
    // Steps stop when the shape runs out.
    assert.equal(silhouettes(disc(60, 30, 30, 8), 60, 60, { distance: 5, steps: 4, direction: 'inside' }).length, 1);
    assert.equal(fillHoles(ring, size, size)[100 * size + 100], 1);
});

test('separate shapes give separate loops and every loop closes', () => {
    const size = 120, mask = new Uint8Array(size * size);
    for (const [cx, cy] of [[30, 60], [90, 60]]) disc(size, cx, cy, 12).forEach((v, i) => { if (v) mask[i] = 1; });
    const [loops] = silhouettes(mask, size, size, { distance: 4 });
    assert.equal(loops.length, 2);
    const value = Float32Array.from(mask, v => v ? 1 : -1);
    for (const loop of contourLoops(value, size, size)) assert.ok(loop.length > 10);
});

test('outside silhouettes round the pointed joins between parts', () => {
    const size = 120, mask = new Uint8Array(size * size);
    for (const cx of [45, 75]) disc(size, cx, 60, 12).forEach((v, i) => { if (v) mask[i] = 1; });
    // How far above the centre line the outline passes midway between the two discs.
    const midHeight = options => {
        const [[loop]] = silhouettes(mask, size, size, { distance: 6, ...options });
        let best = 0;
        for (let i = 0; i + 1 < loop.points.length; i += 2) if (Math.abs(loop.points[i] - 60) < 1.5) best = Math.max(best, 60 - loop.points[i + 1]);
        return best;
    };
    const pointed = midHeight({ round: 0 }), rounded = midHeight({});
    assert.ok(rounded > pointed + .8, `${pointed} → ${rounded}`);
});

test('a silhouette keeps the ids of the objects it outlines', async () => {
    const { blankDocument, createObject, validateDocument } = await import('../public/editor-v2/model.mjs');
    const d = blankDocument(), rect = createObject('rect', 0, 0, 10, 10);
    const line = { ...createObject('path', 0, 0), subpaths: [{ closed: true, points: [0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1] }], silhouetteOf: [rect.id] };
    d.objects.push(rect, line);
    assert.deepEqual(validateDocument(d).objects[1].silhouetteOf, [rect.id]);
    assert.throws(() => validateDocument({ ...d, objects: [rect, { ...line, silhouetteOf: [] }] }), /origen/);
});
