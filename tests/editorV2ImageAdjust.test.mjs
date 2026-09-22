import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustPixels, normalizeAdjust } from '../public/editor-v2/imageAdjust.mjs';
import { blankDocument, createObject, validateDocument, objectMarkup, exportSvg } from '../public/editor-v2/model.mjs';

const pixels = (...rgba) => new Uint8ClampedArray(rgba.flat());

test('neutral settings return an unchanged copy of the pixels', () => {
    const source = pixels([10, 20, 30, 255], [200, 100, 50, 128]);
    const out = adjustPixels(source, 2, 1, { desaturate: 0, contrast: 0, brightness: 0, sharpness: 0 });
    assert.deepEqual([...out], [...source]);
    assert.notEqual(out, source);
});
test('desaturate, brightness and contrast use the usual formulas and keep alpha', () => {
    const gray = Math.round(.2126 * 200 + .7152 * 100 + .0722 * 50);
    assert.deepEqual([...adjustPixels(pixels([200, 100, 50, 77]), 1, 1, { desaturate: 100 })], [gray, gray, gray, 77]);
    assert.deepEqual([...adjustPixels(pixels([100, 200, 0, 255]), 1, 1, { brightness: 100 })], [200, 255, 0, 255]);
    assert.deepEqual([...adjustPixels(pixels([100, 200, 0, 255]), 1, 1, { brightness: -100 })], [0, 0, 0, 255]);
    assert.deepEqual([...adjustPixels(pixels([40, 220, 128, 255]), 1, 1, { contrast: -100 })], [128, 128, 128, 255]);
    const [low, high] = adjustPixels(pixels([100, 160, 0, 255]), 1, 1, { contrast: 50 });
    assert.ok(low < 100 && high > 160);
});
test('sharpness boosts edges, leaves flat areas alone and ignores transparent neighbours', () => {
    const step = pixels([100, 100, 100, 255], [100, 100, 100, 255], [200, 200, 200, 255], [200, 200, 200, 255]);
    const out = adjustPixels(step, 4, 1, { sharpness: 50 });
    assert.deepEqual([out[0], out[4], out[8], out[12]], [100, 50, 250, 200]);
    const cutout = adjustPixels(pixels([0, 0, 0, 0], [180, 180, 180, 255], [180, 180, 180, 255]), 3, 1, { sharpness: 100 });
    assert.deepEqual([...cutout.slice(4, 8)], [180, 180, 180, 255]);
});
test('settings normalise to null when neutral and reject values out of range', () => {
    assert.equal(normalizeAdjust({}), null);
    assert.equal(normalizeAdjust({ contrast: 0, sharpness: 0 }), null);
    assert.deepEqual(normalizeAdjust({ brightness: 20 }), { desaturate: 0, contrast: 0, brightness: 20, sharpness: 0 });
    for (const bad of [{ brightness: 101 }, { desaturate: -1 }, { sharpness: '10' }, { contrast: NaN }, null, 5]) assert.throws(() => normalizeAdjust(bad));
});
test('projects keep the original image with its settings; neutral settings and other objects carry none', () => {
    const d = blankDocument();
    const image = { ...createObject('image', 0, 0), src: 'data:image/png;base64,aGVsbG8=', adjust: { desaturate: 100, contrast: 10, brightness: -5, sharpness: 30 } };
    d.objects.push(image);
    const valid = validateDocument(JSON.parse(JSON.stringify(d)));
    assert.deepEqual(valid.objects[0].adjust, image.adjust);
    assert.equal(valid.objects[0].src, image.src);
    assert.match(objectMarkup(valid.objects[0]), new RegExp(`data-adjusted="${image.id}"`));
    d.objects[0].adjust = { desaturate: 0 };
    assert.equal('adjust' in validateDocument(d).objects[0], false);
    assert.doesNotMatch(exportSvg(d), /data-adjusted/);
    d.objects[0].adjust = { brightness: 500 };
    assert.throws(() => validateDocument(d), /Ajustes de imagen/);
    const rect = { ...createObject('rect', 0, 0), adjust: { brightness: 10 } };
    assert.equal('adjust' in validateDocument({ ...blankDocument(), objects: [rect] }).objects[0], false);
});
