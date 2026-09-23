import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetObject } from '../public/editor-v2/presets.mjs';
import { blankDocument, createObject, validateDocument, exportSvg, placeInPowerClip, clone } from '../public/editor-v2/model.mjs';
import { pathNodes } from '../public/editor-v2/pathEdit.mjs';

const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);

test('the lamp frame keeps its real cutting size and is a 0.3 mm red cutting line', () => {
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
    assert.throws(() => presetObject('otra', { x: 0, y: 0 }, '#000000'), /no encontrada/);
});

test('the frame is an empty PowerClip whose white base stays above the content and below the cut line', () => {
    const frame = presetObject('lamp-frame', { x: 100, y: 150 }, '#000000');
    assert.deepEqual(frame.powerClip.objects, []);
    // The white base is the frame's own trapezoid under the circle: from 151.34 mm down to the bottom.
    const [base] = frame.overlay.subpaths, ys = base.points.filter((_, i) => i % 2).map(v => frame.y + v * frame.height);
    assert.equal(frame.overlay.fill, '#ffffff');
    close(Math.min(...ys) - frame.y, 151.3364, 1e-3); close(Math.max(...ys), frame.y + frame.height, 1e-6);
    const d = blankDocument(), photo = { ...createObject('rect', 20, 60, 160, 160), fill: '#1e88e5' };
    d.objects.push(frame, photo);
    placeInPowerClip(d, new Set([photo.id]), frame.id);
    const valid = validateDocument(JSON.parse(JSON.stringify(d)));
    assert.equal(valid.objects[0].overlay.fill, '#ffffff');
    const markup = exportSvg(valid), content = markup.indexOf('fill="#1e88e5"'), white = markup.indexOf('fill="#ffffff" stroke="none"/>', content), cut = markup.lastIndexOf('stroke="#ff0000"');
    assert.ok(content > 0 && white > content && cut > white, 'content, then the white base, then the red line');
    // Recolouring the frame does not touch the base, and a broken layer is rejected.
    const recoloured = clone(valid); recoloured.objects[0].fill = '#000000';
    assert.equal(validateDocument(recoloured).objects[0].overlay.fill, '#ffffff');
    assert.throws(() => validateDocument({ ...valid, objects: [{ ...valid.objects[0], overlay: { fill: 'white', subpaths: frame.overlay.subpaths } }] }), /capa fija/);
    // Without a PowerClip the base still sits between the fill and the line.
    const plain = { ...frame }; delete plain.powerClip;
    const alone = exportSvg({ ...blankDocument(), objects: [plain] });
    assert.ok(alone.indexOf('fill="#ffffff"') < alone.indexOf('stroke="#ff0000"'));
});
