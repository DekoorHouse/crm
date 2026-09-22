import { test } from 'node:test';
import assert from 'node:assert/strict';
import { powerClipDropTarget } from '../public/editor-v2/geometry.mjs';
import { blankDocument, createObject, makePowerClip, placeInPowerClip, extractPowerClip, validateDocument, exportSvg, History, clone, objectsWithContents, fitPowerClip } from '../public/editor-v2/model.mjs';

test('drag target respects ellipse boundary, blockers and invalid sources', () => {
    const frame = createObject('ellipse', 100, 100, 100, 100); makePowerClip(frame);
    const source = createObject('rect', 0, 0), ids = new Set([source.id]);
    assert.equal(powerClipDropTarget([frame, source], ids, { x: 150, y: 150 }), frame);
    assert.equal(powerClipDropTarget([frame, source], ids, { x: 101, y: 101 }), null);
    const blocker = createObject('rect', 140, 140);
    assert.equal(powerClipDropTarget([frame, blocker, source], ids, { x: 150, y: 150 }), null);
    frame.locked = true;
    assert.equal(powerClipDropTarget([frame, source], ids, { x: 150, y: 150 }), null);
    frame.locked = false; makePowerClip(source);
    assert.equal(powerClipDropTarget([frame, source], ids, { x: 150, y: 150 }), null);
});

test('new objects use hairline and export does not include editor-only container markers', () => {
    const d = blankDocument();
    for (const type of ['rect', 'ellipse', 'text', 'spline', 'image']) assert.equal(createObject(type, 0, 0).strokeWidth, .0762);
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

test('PowerClip rejects nested, duplicate, locked and unsupported containers', () => {
    const d = blankDocument(), frame = createObject('rect', 0, 0); makePowerClip(frame); d.objects.push(frame);
    assert.throws(() => placeInPowerClip(d, new Set([frame.id]), frame.id));
    assert.throws(() => makePowerClip(createObject('text', 0, 0)));
    const child = createObject('rect', 0, 0); child.id = frame.id; frame.powerClip.objects.push(child);
    assert.throws(() => validateDocument(d));
    child.id = 'child'; child.powerClip = { width: 1, height: 1, objects: [] }; assert.throws(() => validateDocument(d));
});
