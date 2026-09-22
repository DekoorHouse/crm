import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpline, splineSegments, curvePoint, splinePoints, closestOnSpline, moveSplineNodes, insertSplineNode, removeSplineNodes, controlPath, closestOnControlLine, legPoint } from '../public/editor-v2/spline.mjs';
import { createObject, blankDocument, validateDocument, exportSvg } from '../public/editor-v2/model.mjs';
import { fullyContained, objectReference } from '../public/editor-v2/geometry.mjs';

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const arch = () => ({ ...createObject('spline', 0, 0), ...normalizeSpline([{ x: 10, y: 30 }, { x: 20, y: 10 }, { x: 80, y: 10 }, { x: 90, y: 30 }]) });

test('a B-spline starts and ends on its end points, stays inside its control points and round-trips', () => {
    const points = [{ x: 10, y: 30 }, { x: 20, y: 10 }, { x: 80, y: 10 }, { x: 90, y: 30 }];
    const bounds = normalizeSpline(points), segments = splineSegments(points);
    close(segments[0].p0.x, 10); close(segments[0].p0.y, 30); close(segments.at(-1).p3.x, 90); close(segments.at(-1).p3.y, 30);
    // The middle control points pull the curve without it reaching them: its top is the apex (50, 10.8333).
    close(bounds.y, 65 / 6, 1e-6);
    for (const segment of segments) for (let i = 0; i <= 100; i++) {
        const p = curvePoint(segment, i / 100);
        assert.ok(p.x >= bounds.x - 1e-8 && p.x <= bounds.x + bounds.width + 1e-8);
        assert.ok(p.y >= bounds.y - 1e-8 && p.y <= bounds.y + bounds.height + 1e-8);
    }
    const object = { ...createObject('spline', 0, 0), ...bounds };
    assert.ok(object.points[1].y < 0);
    splinePoints(object).forEach((p, i) => { close(p.x, points[i].x); close(p.y, points[i].y); });
    const d = blankDocument(); d.objects.push(object);
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(d))), d);
    assert.match(exportSvg(d), /<path d="M 10 30 C /);
    assert.equal(controlPath(points), 'M 10 30 L 20 10 L 80 10 L 90 30');
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
test('a double click adds the control point on the control line, both from the line and from the curve', () => {
    const object = arch(), hit = closestOnSpline(object, { x: 50, y: 0 });
    // The middle segment is symmetric: its closest point to (50, 0) is its apex, halfway along it.
    assert.equal(hit.index, 1); close(hit.x, 50, 1e-3); close(hit.y, 65 / 6, 1e-3); close(hit.t, .5, 1e-3);
    // That segment is driven by the leg (20, 10) → (80, 10), so the new point goes on that leg.
    const fromCurve = legPoint(object, hit);
    assert.equal(fromCurve.index, 1); close(fromCurve.x, 50, 1e-3); close(fromCurve.y, 10);
    const fromLine = closestOnControlLine(object, { x: 35, y: 12 });
    assert.deepEqual([fromLine.index, fromLine.x, fromLine.y, fromLine.distance], [1, 35, 10, 2]);
    const inserted = { ...object, ...insertSplineNode(object, fromLine) }, nodes = splinePoints(inserted), before = splinePoints(object);
    assert.equal(nodes.length, 5);
    close(nodes[2].x, 35); close(nodes[2].y, 10);
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
test('spline hover references sit on the visible curve, not on the control points', () => {
    const object = arch(), on = curvePoint(splineSegments(splinePoints(object))[1], .3), query = { x: on.x, y: on.y - .4 };
    const edge = objectReference(object, query, 1), hit = closestOnSpline(object, query);
    assert.equal(edge?.label, 'Borde');
    close(edge.x, hit.x); close(edge.y, hit.y); close(edge.distance, hit.distance);
    // The control point (20, 10) is off the curve, so it is no reference; the curve's end points are.
    assert.equal(objectReference(object, { x: 20, y: 10 }, 1), null);
    assert.equal(objectReference(object, { x: 10.2, y: 29.8 }, 1)?.label, 'Nodo');
});
const loop = () => ({ ...createObject('spline', 0, 0), closed: true, ...normalizeSpline([{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 50 }, { x: 10, y: 50 }], true) });
test('a closed spline wraps around smoothly inside its control points and exports a closed path', () => {
    const object = loop(), nodes = splinePoints(object), segments = splineSegments(nodes, true);
    assert.equal(segments.length, 4);
    close(segments[3].p3.x, segments[0].p0.x); close(segments[3].p3.y, segments[0].p0.y);
    // The handles on both sides of the joint mirror each other, so it has no corner.
    close(segments[0].c1.x - segments[0].p0.x, segments[3].p3.x - segments[3].c2.x); close(segments[0].c1.y - segments[0].p0.y, segments[3].p3.y - segments[3].c2.y);
    for (const segment of segments) for (let i = 0; i <= 100; i++) {
        const p = curvePoint(segment, i / 100);
        assert.ok(p.x >= object.x - 1e-8 && p.x <= object.x + object.width + 1e-8 && p.y >= object.y - 1e-8 && p.y <= object.y + object.height + 1e-8);
    }
    // A closed B-spline rounds the corners and touches none of its control points.
    close(object.x, 10 + 25 / 12, 1e-6); close(object.y, 10 + 5 / 3, 1e-6);
    assert.equal(controlPath(nodes, true), 'M 10 10 L 60 10 L 60 50 L 10 50 Z');
    const d = blankDocument(); d.objects.push(object);
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(d))), d);
    assert.match(exportSvg(d), /<path d="M [^"]* Z"/);
});
test('closed splines need a boolean flag and three points; open ones keep no flag', () => {
    const d = blankDocument(); d.objects.push({ ...arch(), closed: true });
    assert.doesNotThrow(() => validateDocument(d));
    d.objects[0] = { ...createObject('spline', 0, 0), ...normalizeSpline([{ x: 0, y: 0 }, { x: 50, y: 0 }]), closed: true };
    assert.throws(() => validateDocument(d), /tres puntos/);
    d.objects[0].closed = 'sí'; assert.throws(() => validateDocument(d));
    d.objects[0].closed = false; assert.equal('closed' in validateDocument(d).objects[0], false);
});
test('node edits on a closed spline use the closing leg and keep three nodes', () => {
    const object = loop(), hit = closestOnSpline(object, { x: 5, y: 30 });
    assert.equal(hit.index, 3);
    assert.equal(objectReference(object, hit, 1)?.label, 'Punto medio');
    // The closing leg (10, 50) → (10, 10) drives that side, so the new point lands on it.
    const at = legPoint(object, hit);
    close(at.x, 10); close(at.y, 30, 1e-3);
    assert.equal(closestOnControlLine(object, { x: 8, y: 30 }).index, 3);
    const inserted = splinePoints({ ...object, ...insertSplineNode(object, at) });
    assert.equal(inserted.length, 5); close(inserted[4].x, at.x); close(inserted[4].y, at.y);
    assert.equal(removeSplineNodes(object, [0]).points.length, 3);
    assert.throws(() => removeSplineNodes(object, [0, 1]), /al menos tres nodos/);
    const moved = { ...object, ...moveSplineNodes(object, [3], -20, 0) }, node = splinePoints(moved)[3];
    close(node.x, -10); close(node.y, 50);
    assert.ok(moved.x < object.x && moved.x > -10);
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
