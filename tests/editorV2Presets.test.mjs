import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetObject } from '../public/editor-v2/presets.mjs';
import { blankDocument, validateDocument } from '../public/editor-v2/model.mjs';
import { pathNodes } from '../public/editor-v2/pathEdit.mjs';

const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);

test('the lamp frame keeps its real cutting size and is a 0.3 mm cutting line', () => {
    // Whatever colour new objects use, the frame is K40 Whisperer's cutting red.
    const frame = presetObject('lamp-frame', { x: 100, y: 150 }, '#00ff00');
    // A circle 160 mm across with a 70 mm base: 160 × 166.3 mm in all.
    close(frame.width, 160, 1e-3); close(frame.height, 166.2999, 1e-3);
    close(frame.x + frame.width / 2, 100); close(frame.y + frame.height / 2, 150);
    assert.deepEqual([frame.type, frame.fill, frame.stroke, frame.strokeWidth, frame.name], ['path', 'none', '#ff0000', .3, 'Marco de lámpara']);
    const base = pathNodes(frame).filter(node => Math.abs(node.y - (frame.y + frame.height)) < 1e-6);
    assert.equal(base.length, 2);
    close(Math.abs(base[0].x - base[1].x), 70, 1e-3);
    assert.equal(presetObject('lamp-frame', { x: 0, y: 0 }, 'none').stroke, '#ff0000');
    const d = blankDocument(); d.objects.push(frame);
    assert.doesNotThrow(() => validateDocument(d));
    assert.throws(() => presetObject('otra', { x: 0, y: 0 }, '#000000'), /no encontrada/);
});
