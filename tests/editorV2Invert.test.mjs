import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAdjust, adjustPixels } from '../public/editor-v2/imageAdjust.mjs';

test('inverting colours is an adjustment that keeps alpha and runs after the other ones', () => {
    assert.deepEqual(normalizeAdjust({ invert: true }), { desaturate: 0, contrast: 0, brightness: 0, sharpness: 0, invert: true });
    assert.equal(normalizeAdjust({ invert: false }), null);
    assert.throws(() => normalizeAdjust({ invert: 'sí' }), /inválidos/);
    const pixels = new Uint8ClampedArray([255, 0, 128, 255, 10, 20, 30, 0]);
    assert.deepEqual([...adjustPixels(pixels, 2, 1, { invert: true })], [0, 255, 127, 255, 245, 235, 225, 0]);
    // Desaturating first, then inverting: pure red becomes the inverse of its grey.
    const [r, g, b] = adjustPixels(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1, { desaturate: 100, invert: true });
    assert.equal(r, g); assert.equal(g, b); assert.equal(r, 255 - Math.round(.2126 * 255));
    // Inverting twice gives back the original pixels.
    const twice = adjustPixels(adjustPixels(pixels, 2, 1, { invert: true }), 2, 1, { invert: true });
    assert.deepEqual([...twice], [...pixels]);
});
