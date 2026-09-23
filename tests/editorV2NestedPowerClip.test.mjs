import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankDocument, createObject, clone, validateDocument, exportSvg, placeInPowerClip, extractPowerClip, powerClipEditDocument, mergePowerClipEdits, objectsWithContents, MAX_POWERCLIP_DEPTH } from '../public/editor-v2/model.mjs';
import { powerClipDropTarget } from '../public/editor-v2/geometry.mjs';

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const box = (type, x, y, width, height, extra = {}) => ({ ...createObject(type, x, y, width, height), ...extra });

// Page ← frame (inner container, holding a dot) ← outer container.
function nested() {
    const d = blankDocument();
    const outer = box('rect', 10, 10, 100, 100), frame = box('ellipse', 20, 20, 50, 40), dot = box('rect', 30, 30, 10, 10, { fill: '#ff0000' });
    d.objects.push(outer, frame, dot);
    placeInPowerClip(d, new Set([dot.id]), frame.id, { createContainer: true });
    placeInPowerClip(d, new Set([frame.id]), outer.id, { createContainer: true });
    return { d: validateDocument(d), outer, frame, dot };
}

test('a PowerClip goes inside another one and everything keeps its place on the page', () => {
    const { d, outer, frame, dot } = nested();
    assert.equal(d.objects.length, 1);
    const [container] = d.objects, inner = container.powerClip.objects[0];
    assert.equal(inner.id, frame.id);
    assert.equal(inner.powerClip.objects[0].id, dot.id);
    assert.deepEqual([...objectsWithContents(d.objects)].map(o => o.id), [outer.id, frame.id, dot.id]);
    // Both clips appear in the markup, the inner one inside the outer one's clipped group.
    const markup = exportSvg(d);
    assert.equal(markup.match(/<clipPath /g).length, 2);
    // Taking everything out again returns the original page positions.
    const out = clone(d);
    extractPowerClip(out, outer.id);
    const back = out.objects.find(o => o.id === frame.id);
    close(back.x, 20); close(back.y, 20); close(back.width, 50); close(back.height, 40);
    extractPowerClip(out, frame.id);
    const spot = out.objects.find(o => o.id === dot.id);
    close(spot.x, 30); close(spot.y, 30); close(spot.width, 10);
});

test('editing an inner PowerClip level by level merges back into the page', () => {
    const { d, outer, frame, dot } = nested();
    // Level 1: the outer container's content, in page coordinates.
    const level1 = powerClipEditDocument(d, outer.id);
    assert.deepEqual(level1.objects.map(o => o.id), [frame.id]);
    // Level 2: the inner container's content.
    const level2 = powerClipEditDocument(level1, frame.id);
    close(level2.objects[0].x, 30); close(level2.objects[0].y, 30);
    level2.objects[0].x += 5;
    const merged = mergePowerClipEdits(d, outer.id, mergePowerClipEdits(level1, frame.id, level2));
    const out = clone(merged);
    extractPowerClip(out, outer.id); extractPowerClip(out, frame.id);
    close(out.objects.find(o => o.id === dot.id).x, 35);
});

test('nesting depth and identifiers are checked across every level', () => {
    const { d } = nested();
    const repeated = clone(d); repeated.objects[0].powerClip.objects[0].powerClip.objects[0].id = repeated.objects[0].id;
    assert.throws(() => validateDocument(repeated), /identificadores repetidos/);
    // A chain deeper than the limit is rejected, both when validating and when placing.
    const deep = blankDocument();
    let inner = box('rect', 0, 0, 10, 10);
    for (let level = 0; level < MAX_POWERCLIP_DEPTH; level++) {
        const holder = box('rect', 0, 0, 10, 10);
        const doc = { objects: [holder, inner] };
        placeInPowerClip(doc, new Set([inner.id]), holder.id, { createContainer: true });
        inner = doc.objects[0];
    }
    deep.objects.push(inner);
    assert.doesNotThrow(() => validateDocument(deep));
    const tooDeep = { objects: [box('rect', 0, 0, 10, 10), inner] };
    assert.throws(() => placeInPowerClip(tooDeep, new Set([inner.id]), tooDeep.objects[0].id, { createContainer: true }), /niveles/);
    const forced = blankDocument(); forced.objects.push({ ...box('rect', 0, 0, 10, 10), powerClip: { width: 10, height: 10, objects: [inner] } });
    assert.throws(() => validateDocument(forced), /niveles/);
});

test('a PowerClip can be dropped onto another PowerClip', () => {
    const { d } = nested();
    const extra = box('rect', 200, 200, 30, 30, { powerClip: { width: 30, height: 30, objects: [] } });
    const objects = [...d.objects, extra];
    assert.equal(powerClipDropTarget(objects, new Set([extra.id]), { x: 50, y: 50 })?.id, d.objects[0].id);
});
