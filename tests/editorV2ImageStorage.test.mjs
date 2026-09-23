import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clone, createObject, blankDocument, documentKey, packDocument, unpackDocument, validateDocument, History, objectMarkup, exportSvg } from '../public/editor-v2/model.mjs';

const src = 'data:image/png;base64,' + 'QUJD'.repeat(50000);
const withCopies = count => {
    const d = blankDocument();
    for (let i = 0; i < count; i++) d.objects.push({ ...createObject('image', i, i), src });
    return d;
};

test('copies share image data and the draft stores each image once', () => {
    const d = withCopies(10), copy = clone(d);
    assert.notEqual(copy.objects[0], d.objects[0]);
    assert.deepEqual(copy, d);
    const packed = packDocument(d);
    assert.ok(packed.length < src.length + 10 * 1000, `packed draft is ${packed.length} characters`);
    assert.deepEqual(validateDocument(unpackDocument(packed)), d);
    // Drafts saved before packing still open.
    assert.deepEqual(unpackDocument(JSON.stringify(d)), d);
});
test('document keys compare images by fingerprint without their data', () => {
    const d = withCopies(3), key = documentKey(d);
    assert.ok(key.length < 3 * 1000);
    assert.equal(documentKey(JSON.parse(JSON.stringify(d))), key);
    const other = clone(d); other.objects[1].src = src.slice(0, -4) + 'QUJE';
    assert.notEqual(documentKey(other), key);
    const history = new History(d);
    assert.equal(history.commit(clone(d)), false);
    assert.equal(history.commit(other), true);
});
test('the editor can show images through another URL while exports embed the data', () => {
    const d = withCopies(1);
    assert.match(objectMarkup(d.objects[0], () => 'blob:shown'), /href="blob:shown"/);
    assert.ok(exportSvg(d).includes(src));
});
