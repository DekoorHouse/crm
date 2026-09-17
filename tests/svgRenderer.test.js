'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { Resvg } = require('@resvg/resvg-js');
const { generateSheet, cleanText, manifest } = require('../server/design/svgRenderer');
jest.setTimeout(120000);
const heart = { nombre1: 'Ana', nombre2: 'José Luis', fecha: '17-09-2026' };

function masks(svg) {
    const r = new Resvg(svg, { fitTo: { mode: 'width', value: 2800 }, background: 'white' }).render();
    const p = r.pixels, result = new Uint8Array(r.width * r.height);
    for (let i = 0; i < result.length; i++) {
        const k = i * 4, a = p[k], b = p[k + 1], c = p[k + 2];
        result[i] = Math.max(a, b, c) < 150 ? 1 : a > 160 && b < 150 && c < 150 ? 2 : c > 160 && a < 150 && b < 150 ? 3 : 0;
    }
    return result;
}
function iou(a, b, color) {
    let same = 0, union = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] === color || b[i] === color) union++; if (a[i] === color && b[i] === color) same++; }
    return same / union;
}

test.each(['infinito', 'spiderman'])('%s production cut matches the actual approved Corel export', model => {
    const result = generateSheet({ model, lamps: [model === 'infinito' ? heart : { nombre: 'José Miguel' }] });
    const reference = fs.readFileSync(path.join(__dirname, 'fixtures/svg-cut', `corel-${model}.svg`), 'utf8');
    const expected = masks(reference), actual = masks(result.svg);
    expect(iou(expected, actual, 1)).toBeGreaterThan(0.97);
    expect(iou(expected, actual, 2)).toBeGreaterThan(0.999);
    expect(iou(expected, actual, 3)).toBeGreaterThan(0.999);
    expect(iou(expected, masks(result.naturalSvg), 1)).toBeLessThan(0.1);
    // A negative determinant proves that this is a reflection as well as a rotation.
    const [a, b, c, d] = result.meta.matrix; expect(a * d - b * c).toBe(-1);
    expect(result.svg).not.toMatch(/<(text|image)\b/);
    expect(result.svg).toContain('width="350mm" height="330mm"');
});

test.each(['infinito', 'spiderman', 'rex'])('%s supports two lamps, accents and two-line names', model => {
    const lamps = model === 'infinito' ? [heart, { nombre1: 'José\nÁngel', nombre2: 'María', fecha: '' }]
        : [{ nombre: model === 'spiderman' ? 'José Miguel' : 'José\nMiguel' }, { nombre: 'Ana' }];
    const r = generateSheet({ model, lamps });
    expect(r.meta.count).toBe(2); expect(r.preview.length).toBeGreaterThan(1000);
    expect(new Set(r.meta.texts.map(t => t.slot)).size).toBe(2);
    for (const t of r.meta.texts.filter(t => t.text)) expect(t.clearanceMm).toBeGreaterThanOrEqual(model === 'infinito' ? 0.375 : 1.75);
    expect(r.svg).not.toMatch(/<(text|image)\b|NaN|Infinity/);
});

test('rejects missing glyphs and invalid layouts before cutting', () => {
    expect(() => cleanText('José 🦖', true)).toThrow('carácter');
    expect(() => cleanText('Uno\nDos\nTres', true)).toThrow('renglones');
    expect(cleanText('  josé\\n miguel ', true)).toBe('José\nMiguel');
    expect(() => generateSheet({ model: 'unknown', lamps: [{ nombre: 'Ana' }] })).toThrow('Plantilla');
});

test('Spiderman sends a two-line name that does not fit its narrow corridor to review', () => {
    expect(() => generateSheet({ model: 'spiderman', lamps: [{ nombre: 'José\nMiguel' }, { nombre: 'Ana' }] }))
        .toThrow('No se encontró un tamaño legible');
});

test('uses the calibrated font without system fonts', () => {
    const font = fs.readFileSync(path.join(__dirname, '../public/editor/fonts/RowsOfSunflowers.ttf'));
    expect(createHash('sha256').update(font).digest('hex')).toBe(manifest.fontSha256);
});
