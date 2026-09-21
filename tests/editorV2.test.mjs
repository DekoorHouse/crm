import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, blankDocument, createObject, clone, validateDocument, exportSvg } from '../public/editor-v2/model.mjs';

test('one committed gesture is undone and redone as a whole; edits invalidate redo', () => {
    const history = new History(), initial = clone(history.document);
    const next = clone(initial), object = createObject('rect', 10, 20);
    next.objects.push(object); history.commit(next);
    const moved = clone(next); moved.objects[0].x = 40; moved.objects[0].y = 55;
    history.commit(moved);
    assert.equal(history.undo(), true); assert.deepEqual(history.document, next);
    assert.equal(history.redo(), true); assert.deepEqual(history.document, moved);
    history.undo(); history.undo(); assert.deepEqual(history.document, initial);
    history.commit({ ...initial, name: 'Otro diseño' }); assert.equal(history.redo(), false);
    assert.equal(history.commit(clone(history.document)), false);
});
test('history snapshots do not alias input objects and are bounded', () => {
    const history = new History(), next = blankDocument();
    next.objects.push(createObject('ellipse', 3, 7)); history.commit(next); next.objects[0].x = 99;
    assert.equal(history.document.objects[0].x, 3);
    for (let i = 0; i < 110; i++) history.commit({ ...history.document, name: String(i) });
    assert.equal(history.past.length, 100);
});
test('round trip retains millimetres, layers, hidden/locked flags and text', () => {
    const project = blankDocument(); project.width = 320; project.height = 450;
    const shape = createObject('ellipse', -5.25, 12.7); shape.hidden = true; shape.locked = true;
    const text = createObject('text', 25, 90); text.text = 'Láser & Xerox';
    project.objects.push(shape, text);
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(project))), project);
});
test('SVG preserves physical size, stacking and escapes text; hidden objects are omitted', () => {
    const project = blankDocument(); project.name = '<corte & impresión>';
    const rect = createObject('rect', 2, 4), text = createObject('text', 5, 6), hidden = createObject('ellipse', 0, 0);
    text.text = '<script>alert("x")</script>'; hidden.hidden = true;
    project.objects.push(rect, text, hidden);
    const svg = exportSvg(project);
    assert.match(svg, /width="210mm" height="297mm" viewBox="0 0 210 297"/);
    assert.match(svg, /&lt;corte &amp; impresión&gt;/);
    assert.match(svg, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.ok(svg.indexOf('<rect') < svg.indexOf('<text'));
    assert.ok(!svg.includes('<ellipse')); assert.ok(!svg.includes('<script>'));
    assert.ok(!svg.includes('page-shadow'));
});
test('reject malformed, oversized, duplicate and potentially executable project fields', () => {
    const project = blankDocument(); project.objects.push(createObject('rect', 0, 0));
    for (const change of [
        p => { p.version = 2; }, p => { p.width = NaN; }, p => { p.height = 0; },
        p => { p.objects[0].width = -1; }, p => { p.objects[0].stroke = 'url(https://example.com)'; },
        p => { p.objects[0].fill = '\"><script>'; }, p => { p.objects[0].x = Infinity; },
        p => { p.objects[0].type = 'script'; }, p => { p.objects.push(clone(p.objects[0])); },
    ]) { const invalid = clone(project); change(invalid); assert.throws(() => validateDocument(invalid)); }
    project.objects[0].onclick = 'alert(1)';
    assert.equal(validateDocument(project).objects[0].onclick, undefined);
});
