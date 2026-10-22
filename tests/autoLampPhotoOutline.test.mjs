import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoOutline, composeLamp, PHOTO_OUTLINE } from '../server/design/autoLamp/composeLamp.mjs';
import { curvePoint } from '../public/editor-v2/spline.mjs';

// Una foto ya convertida a grabado: fondo blanco y la "persona" como un disco de puntitos de trama (negro = se graba).
const dottedDisc = (size, radius, { background = false } = {}) => {
    const grey = new Uint8Array(size * size).fill(255);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const inDisc = Math.hypot(x + .5 - size / 2, y + .5 - size / 2) <= radius;
        if ((inDisc || background) && x % 3 === 0 && y % 3 === 0) grey[y * size + x] = 0;
    }
    return grey;
};
const radii = (subpath, size) => {
    const p = subpath.points.map(v => v * size), out = [];
    for (let i = 2; i + 5 < p.length; i += 6) {
        const s = { p0: { x: p[i - 2], y: p[i - 1] }, c1: { x: p[i], y: p[i + 1] }, c2: { x: p[i + 2], y: p[i + 3] }, p3: { x: p[i + 4], y: p[i + 5] } };
        for (const t of [0, .5]) { const q = curvePoint(s, t); out.push(Math.hypot(q.x - size / 2, q.y - size / 2)); }
    }
    return out;
};

test('una foto sin fondo lleva una línea alrededor de la persona, a la distancia y del grosor pedidos', () => {
    const size = 300, mmPerPx = .5, outline = photoOutline(dottedDisc(size, 80), size, size, mmPerPx);
    assert.ok(outline, 'debió trazar la silueta');
    assert.equal(outline.length, 2);
    const [outer, inner] = outline;
    const expect = (subpath, mm) => { for (const r of radii(subpath, size)) assert.ok(Math.abs(r - (80 + mm / mmPerPx)) < 3, `radio ${r}`); };
    expect(outer, PHOTO_OUTLINE.gap + PHOTO_OUTLINE.width);
    expect(inner, PHOTO_OUTLINE.gap);
});

test('una foto que conserva su fondo no lleva silueta', () => {
    assert.equal(photoOutline(dottedDisc(300, 80, { background: true }), 300, 300, .5), null);
    assert.equal(photoOutline(new Uint8Array(300 * 300).fill(255), 300, 300, .5), null);
});

test('la silueta va en el marco como curva que se graba, enlazada a la imagen', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const outline = photoOutline(dottedDisc(300, 80), 300, 300, .5);
    const { document } = composeLamp({ image: { dataUrl: png, width: 300, height: 300 }, name: '', font: null, title: 'prueba', outline });
    const frame = document.objects.find(item => item.powerClip);
    const picture = frame.powerClip.objects.find(item => item.type === 'image');
    const ring = frame.powerClip.objects.find(item => item.name === 'Silueta de la foto');
    assert.ok(ring, 'falta la silueta dentro del marco');
    assert.equal(ring.fillRule, 'evenodd');
    assert.equal(ring.fill, '#000000');
    assert.deepEqual(ring.silhouetteOf, [picture.id]);
    assert.equal(ring.subpaths.length, 2);
    assert.equal(document.objects.length, 1, 'nada suelto fuera del marco');
});
