import { test } from 'node:test';
import assert from 'node:assert/strict';
import { powerClipDropTarget } from '../public/editor-v2/geometry.mjs';
import { powerClipEditDocument, mergePowerClipEdits } from '../public/editor-v2/model.mjs';
import { blankDocument, createObject, makePowerClip, placeInPowerClip, extractPowerClip, validateDocument, exportSvg, History, clone, objectsWithContents, fitPowerClip } from '../public/editor-v2/model.mjs';

test('picking a plain shape converts and inserts in one undoable operation', () => {
    const d = blankDocument(), frame = createObject('ellipse', 10, 10), source = createObject('rect', 12, 12);
    d.objects.push(frame, source);
    const history = new History(d), next = clone(d), ids = new Set([source.id]);
    placeInPowerClip(next, ids, frame.id, { createContainer: true });
    history.commit(next);
    assert.equal(history.document.objects.length, 1);
    assert.equal(history.document.objects[0].powerClip.objects[0].id, source.id);
    history.undo();
    assert.equal(history.document.objects.length, 2);
    assert.equal(history.document.objects[0].powerClip, undefined);
    for (const invalid of [source.id, 'missing']) {
        const copy = clone(d);
        assert.throws(() => placeInPowerClip(copy, ids, invalid, { createContainer: true }));
        assert.deepEqual(copy, d);
    }
    frame.locked = true;
    assert.throws(() => placeInPowerClip(d, ids, frame.id, { createContainer: true }));
    assert.equal(frame.powerClip, undefined);
});

test('PowerClip editing preserves transforms, siblings and undo while applying content changes', () => {
    const d = blankDocument(), frame = createObject('rect', 40, 50, 100, 80), child = createObject('rect', 55, 65, 20, 10), sibling = createObject('ellipse', 200, 200);
    d.objects.push(frame, child, sibling); makePowerClip(frame);
    placeInPowerClip(d, new Set([child.id]), frame.id);
    frame.powerClip.transform = { x: 5, y: -3, scale: 2 };
    frame.width *= 1.5;
    const content = powerClipEditDocument(d, frame.id);
    const roundtrip = mergePowerClipEdits(d, frame.id, content);
    assert.deepEqual(roundtrip, validateDocument(d));
    content.objects[0].x += 30; content.objects[0].fill = '#ff0000';
    const history = new History(d);
    history.commit(mergePowerClipEdits(d, frame.id, content));
    assert.equal(history.document.objects[0].powerClip.objects[0].x, frame.powerClip.objects[0].x + 10);
    assert.equal(history.document.objects[0].powerClip.objects[0].fill, '#ff0000');
    assert.deepEqual(history.document.objects[1], validateDocument(d).objects[1]);
    history.undo(); assert.deepEqual(history.document, validateDocument(d));
    content.objects = [];
    assert.equal(mergePowerClipEdits(d, frame.id, content).objects[0].powerClip.objects.length, 0);
});

test('drag target respects ellipse boundary, blockers and invalid sources', () => {
    const frame = createObject('ellipse', 100, 100, 100, 100); makePowerClip(frame);
    const source = createObject('rect', 0, 0), ids = new Set([source.id]);
    assert.equal(powerClipDropTarget([frame, source], ids, { x: 150, y: 150 }), frame);
    assert.equal(powerClipDropTarget([frame, source], ids, { x: 101, y: 101 }), null);
    const blocker = createObject('rect', 140, 140);
    assert.equal(powerClipDropTarget([frame, blocker, source], ids, { x: 150, y: 150 }), null);
    frame.locked = true;
    assert.equal(powerClipDropTarget([frame, source], ids, { x: 150, y: 150 }), null);
    // Another PowerClip can be dropped in too: PowerClips nest.
    frame.locked = false; makePowerClip(source);
    assert.equal(powerClipDropTarget([frame, source], ids, { x: 150, y: 150 }), frame);
});

test('new objects use a 0.3 mm outline and export does not include editor-only container markers', () => {
    const d = blankDocument();
    for (const type of ['rect', 'ellipse', 'text', 'spline', 'image']) assert.equal(createObject(type, 0, 0).strokeWidth, .3);
    const frame = createObject('rect', 0, 0); makePowerClip(frame); d.objects.push(frame);
    assert.doesNotMatch(exportSvg(d), /data-editor-marker|Soltar para|>PC</);
});

test('contain and cover preserve proportions, center content and are repeatable', () => {
    const frame = createObject('rect', 20, 30, 100, 100); makePowerClip(frame);
    frame.powerClip.objects.push(createObject('rect', -10, 5, 200, 50));
    const bounds = { x: -10, y: 5, width: 200, height: 50 };
    fitPowerClip(frame, 'contain', bounds);
    assert.deepEqual(frame.powerClip.transform, { scale: .5, x: 5, y: 35 });
    fitPowerClip(frame, 'cover', bounds);
    assert.deepEqual(frame.powerClip.transform, { scale: 2, x: -130, y: -10 });
    fitPowerClip(frame, 'cover', bounds);
    assert.equal(frame.powerClip.transform.scale, 2);
    const d = blankDocument(); d.objects.push(frame); assert.deepEqual(validateDocument(d), d);
    extractPowerClip(d, frame.id);
    assert.equal(d.objects[1].width / d.objects[1].height, 4);
    assert.equal(d.objects[1].x, -130); assert.equal(d.objects[1].y, 30);
});

test('empty PowerClip retains shape, accepts content in place, persists and exports clipping', () => {
    const d = blankDocument(), frame = createObject('ellipse', 30, 40, 80, 60), content = createObject('rect', 20, 30, 100, 100);
    makePowerClip(frame); d.objects.push(frame, content);
    assert.deepEqual(frame.powerClip.objects, []);
    placeInPowerClip(d, new Set([content.id]), frame.id);
    assert.equal(d.objects.length, 1);
    assert.equal(frame.powerClip.objects[0].x, -10);
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(d))), d);
    const svg = exportSvg(d);
    assert.match(svg, /clipPathUnits="userSpaceOnUse"/);
    assert.match(svg, /clip-path="url\(#pc-/);
    assert.equal([...objectsWithContents(d.objects)].length, 2);
    frame.x += 10; frame.width *= 2;
    extractPowerClip(d, frame.id);
    assert.equal(d.objects[1].x, 20);
    assert.equal(d.objects[1].width, 200);
    assert.equal(frame.powerClip.objects.length, 0);
});

test('PowerClip conversion and insertion undo in one step each', () => {
    const d = blankDocument(); d.objects.push(createObject('rect', 0, 0), createObject('ellipse', 5, 5));
    const h = new History(d), next = clone(d); makePowerClip(next.objects[0]); h.commit(next);
    const filled = clone(h.document); placeInPowerClip(filled, new Set([filled.objects[1].id]), filled.objects[0].id); h.commit(filled);
    h.undo(); assert.equal(h.document.objects[0].powerClip.objects.length, 0); assert.equal(h.document.objects.length, 2);
    h.undo(); assert.equal(h.document.objects[0].powerClip, undefined);
    h.redo(); h.redo(); assert.equal(h.document.objects.length, 1);
});

test('PowerClip rejects duplicate ids, self-placement and unsupported containers, and accepts nesting', () => {
    const d = blankDocument(), frame = createObject('rect', 0, 0); makePowerClip(frame); d.objects.push(frame);
    assert.throws(() => placeInPowerClip(d, new Set([frame.id]), frame.id));
    assert.throws(() => makePowerClip(createObject('text', 0, 0)));
    const child = createObject('rect', 0, 0); child.id = frame.id; frame.powerClip.objects.push(child);
    assert.throws(() => validateDocument(d));
    child.id = 'child'; child.powerClip = { width: 1, height: 1, objects: [] }; assert.doesNotThrow(() => validateDocument(d));
});
