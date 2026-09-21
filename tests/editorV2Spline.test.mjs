import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpline, splineSegments, curvePoint, splinePoints } from '../public/editor-v2/spline.mjs';
import { createObject, blankDocument, validateDocument, exportSvg } from '../public/editor-v2/model.mjs';
import { fullyContained } from '../public/editor-v2/geometry.mjs';

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
