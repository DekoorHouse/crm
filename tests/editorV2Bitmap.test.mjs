import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBitmap, bitmapSize, dpiToStep, stepToDpi, pngWithDpi, MAX_BITMAP_SIDE } from '../public/editor-v2/bitmap.mjs';
import { blankDocument, createObject, validateDocument, exportSvg } from '../public/editor-v2/model.mjs';

const grey = (values, alpha = 255) => new Uint8ClampedArray(values.flatMap(v => [v, v, v, alpha]));
const blacks = rgba => { const out = []; for (let i = 0; i < rgba.length; i += 4) out.push(rgba[i] === 0 ? 1 : 0); return out; };

test('the laser step sets the pixels: 0.1 mm is 254 DPI', () => {
    assert.equal(Math.round(stepToDpi(.1)), 254);
    assert.equal(dpiToStep(254).toFixed(3), '0.100');
    assert.deepEqual(bitmapSize(60, 80, 254), { width: 600, height: 800 });
    assert.throws(() => bitmapSize(1000, 1000, 1200), new RegExp(String(MAX_BITMAP_SIDE)));
});

test('threshold keeps an existing screen: each pixel is black or white by its own brightness', () => {
    const out = toBitmap(grey([0, 100, 127, 128, 200, 255]), 6, 1, { threshold: 128 });
    assert.deepEqual(blacks(out), [1, 1, 1, 0, 0, 0]);
    for (let i = 0; i < out.length; i += 4) { assert.ok(out[i] === 0 || out[i] === 255); assert.equal(out[i + 3], 255); }
    // Transparent pixels count as white: nothing is burned there.
    assert.deepEqual(blacks(toBitmap(grey([0, 0], 0), 2, 1)), [0, 0]);
});

test('diffusion and the ordered screen keep the average tone of a flat grey', () => {
    const size = 32, flat = grey(new Array(size * size).fill(64));
    for (const method of ['diffusion', 'ordered']) {
        const share = blacks(toBitmap(flat, size, size, { method })).reduce((sum, v) => sum + v, 0) / (size * size);
        // Grey 64 of 255 is about 75 % ink.
        assert.ok(Math.abs(share - .75) < .06, `${method}: ${share}`);
    }
    assert.deepEqual(blacks(toBitmap(grey(new Array(16).fill(255)), 4, 4, { method: 'ordered' })), new Array(16).fill(0));
});

test('the PNG says its resolution, so other programs know the real size', () => {
    // A 1 × 1 PNG with an old pHYs chunk that must be replaced.
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACXBIWXMAAAsTAAALEwEAmpwYAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==', 'base64'));
    const out = Buffer.from(pngWithDpi(png, 254));
    assert.equal(out.indexOf('pHYs'), out.lastIndexOf('pHYs'));
    const at = out.indexOf('pHYs');
    assert.equal(out.readUInt32BE(at + 4), Math.round(254 / .0254));
    assert.equal(out[at + 12], 1);
    assert.ok(out.includes(Buffer.from('IDAT')) && out.includes(Buffer.from('IEND')));
    assert.throws(() => pngWithDpi(new Uint8Array(10), 254), /PNG/);
});

test('1-bit images are drawn with square pixels in the editor and the export', () => {
    const d = blankDocument();
    d.objects.push({ ...createObject('image', 0, 0, 10, 10), src: 'data:image/png;base64,iVBORw0KGgo=', pixelated: true });
    const valid = validateDocument(d);
    assert.equal(valid.objects[0].pixelated, true);
    assert.match(exportSvg(valid), /image-rendering="optimizeSpeed" style="image-rendering:pixelated"/);
    assert.throws(() => validateDocument({ ...d, objects: [{ ...d.objects[0], pixelated: 'sí' }] }), /píxeles/);
    assert.equal('pixelated' in validateDocument({ ...d, objects: [{ ...d.objects[0], pixelated: false }] }).objects[0], false);
});
