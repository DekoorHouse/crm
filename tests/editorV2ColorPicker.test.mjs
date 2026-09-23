import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hsvToHex, hexToHsv, normalizeHex } from '../public/editor-v2/colorPicker.mjs';

test('colours round-trip between hex and HSV', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#e53935', '#123456', '#b9a3ed', '#808080']) {
        assert.equal(hsvToHex(hexToHsv(hex)), hex);
    }
    assert.deepEqual(hexToHsv('#ff0000'), { h: 0, s: 1, v: 1 });
    assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), '#00ff00');
    assert.equal(hsvToHex({ h: 240, s: 1, v: .5 }), '#000080');
});
test('hex field input is normalized or rejected', () => {
    assert.equal(normalizeHex(' FF6600 '), '#ff6600');
    assert.equal(normalizeHex('#abc'), '#aabbcc');
    assert.equal(normalizeHex('#12345'), null);
    assert.equal(normalizeHex('verde'), null);
});
