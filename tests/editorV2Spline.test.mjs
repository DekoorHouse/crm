import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpline, splineSegments, curvePoint, splinePoints, closestOnSpline, moveSplineNodes, insertSplineNode, removeSplineNodes } from '../public/editor-v2/spline.mjs';
import { createObject, blankDocument, validateDocument, exportSvg } from '../public/editor-v2/model.mjs';
import { fullyContained, objectReference } from '../public/editor-v2/geometry.mjs';

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const arch = () => ({ ...createObject('spline', 0, 0), ...normalizeSpline([{ x: 10, y: 30 }, { x: 20, y: 10 }, { x: 80, y: 10 }, { x: 90, y: 30 }]) });

test('spline bounds include curve overshoot and resizing preserves normalized points', () => {
    const points = [{ x: 10, y: 30 }, { x: 20, y: 10 }, { x: 80, y: 10 }, { x: 90, y: 30 }];
    const bounds = normalizeSpline(points);
    assert.ok(bounds.y < 10);
    for (const segment of splineSegments(points)) for (let i = 0; i <= 100; i++) {
        const p = curvePoint(segment, i / 100);
        assert.ok(p.x >= bounds.x - 1e-8 && p.x <= bounds.x + bounds.width + 1e-8);
        assert.ok(p.y >= bounds.y - 1e-8 && p.y <= bounds.y + bounds.height + 1e-8);
    }
    const object = { ...createObject('spline', 0, 0), ...bounds };
    const restored = splinePoints(object);
    restored.forEach((p, i) => { assert.ok(Math.abs(p.x - points[i].x) < 1e-8); assert.ok(Math.abs(p.y - points[i].y) < 1e-8); });
    const d = blankDocument(); d.objects.push(object);
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(d))), d);
    assert.match(exportSvg(d), /<path d="M .* C /);
});
test('two-point horizontal and vertical splines have valid bounds; invalid points are rejected', () => {
    for (const points of [[{ x: 0, y: 0 }, { x: 50, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 50 }]]) {
        const d = blankDocument(); d.objects.push({ ...createObject('spline', 0, 0), ...normalizeSpline(points) });
        assert.doesNotThrow(() => validateDocument(d));
        d.objects[0].points[0].x = Infinity; assert.throws(() => validateDocument(d));
    }
});
test('moving nodes keeps the other nodes in place and renormalizes exact bounds', () => {
    const object = arch(), before = splinePoints(object);
    const moved = { ...object, ...moveSplineNodes(object, [1, 2], 5, -15) };
    splinePoints(moved).forEach((p, i) => {
        const shift = [1, 2].includes(i) ? { x: 5, y: -15 } : { x: 0, y: 0 };
        close(p.x, before[i].x + shift.x); close(p.y, before[i].y + shift.y);
    });
    for (const segment of splineSegments(splinePoints(moved))) for (let i = 0; i <= 100; i++) {
        const p = curvePoint(segment, i / 100);
        assert.ok(p.y >= moved.y - 1e-8 && p.y <= moved.y + moved.height + 1e-8);
    }
    assert.ok(moved.y < object.y);
    assert.deepEqual(splinePoints(object), before);
});
test('a node inserted at the closest curve point keeps the existing nodes and validates', () => {
    const object = arch(), hit = closestOnSpline(object, { x: 50, y: 0 });
    // The middle segment is symmetric, so its closest point to (50, 0) is its apex (50, 7.5).
    assert.equal(hit.index, 1); close(hit.x, 50, 1e-3); close(hit.y, 7.5, 1e-3);
    const inserted = { ...object, ...insertSplineNode(object, hit) }, nodes = splinePoints(inserted), before = splinePoints(object);
    assert.equal(nodes.length, 5);
    close(nodes[2].x, hit.x); close(nodes[2].y, hit.y);
    [0, 1, 3, 4].forEach((index, i) => { close(nodes[index].x, before[i].x); close(nodes[index].y, before[i].y); });
    const d = blankDocument(); d.objects.push(inserted);
    assert.doesNotThrow(() => validateDocument(d));
});
test('removing nodes keeps at least two, and insertion stops at 500 points', () => {
    const object = arch(), before = splinePoints(object);
    const removed = splinePoints({ ...object, ...removeSplineNodes(object, [1, 2]) });
    assert.equal(removed.length, 2);
    close(removed[0].x, before[0].x); close(removed[1].y, before[3].y);
    assert.throws(() => removeSplineNodes(object, [0, 1, 2]), /al menos dos nodos/);
    const full = { ...createObject('spline', 0, 0), ...normalizeSpline(Array.from({ length: 500 }, (_, i) => ({ x: i, y: i % 2 }))) };
    assert.throws(() => insertSplineNode(full, closestOnSpline(full, { x: 1.5, y: .5 })), /500/);
});
test('spline hover edge matches the closest curve point used to insert nodes', () => {
    const object = arch(), query = { x: 32.66, y: 7.6 };
    const edge = objectReference(object, query, 1), hit = closestOnSpline(object, query);
    assert.equal(edge?.label, 'Borde');
    close(edge.x, hit.x); close(edge.y, hit.y); close(edge.distance, hit.distance);
});
test('selection area requires full containment, not an intersection', () => {
    const area = { x: 10, y: 10, width: 100, height: 50 };
    assert.equal(fullyContained(area, { x: 10, y: 10, width: 100, height: 50 }), true);
    assert.equal(fullyContained(area, { x: 20, y: 20, width: 10, height: 10 }), true);
    assert.equal(fullyContained(area, { x: 5, y: 20, width: 20, height: 10 }), false);
    assert.equal(fullyContained(area, { x: 30, y: 50, width: 10, height: 20 }), false);
});
test('image projects round trip and export embedded image data; SVG/external sources are rejected', () => {
    const d = blankDocument();
    d.objects.push({ ...createObject('image', 0, 0), src: 'data:image/png;base64,aGVsbG8=' });
    assert.deepEqual(validateDocument(d), d); assert.match(exportSvg(d), /<image .*href="data:image\/png;base64,/);
    for (const src of ['javascript:alert(1)', 'data:image/svg+xml;base64,aGVsbG8=', 'https://example.com/image.png']) {
        d.objects[0].src = src; assert.throws(() => validateDocument(d));
    }
});
