import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutLayoutTables, FONTS, DEFAULT_TEXT_FONT } from '../public/editor-v2/fonts.mjs';
import { blankDocument, createObject, validateDocument, exportSvg, FONT_FAMILIES } from '../public/editor-v2/model.mjs';

test('texts remember their font; unknown fonts are rejected and Arial stays the default', () => {
    assert.ok(FONT_FAMILIES.includes(DEFAULT_TEXT_FONT) && FONTS[DEFAULT_TEXT_FONT].file.endsWith('.ttf'));
    const d = blankDocument(), text = { ...createObject('text', 10, 10), fontFamily: 'Rows of Sunflowers' };
    d.objects.push(text);
    assert.equal(validateDocument(d).objects[0].fontFamily, 'Rows of Sunflowers');
    assert.match(exportSvg(d), /font-family="&apos;Rows of Sunflowers&apos;, Arial, sans-serif"/);
    assert.equal('fontFamily' in validateDocument({ ...d, objects: [{ ...text, fontFamily: 'Arial' }] }).objects[0], false);
    assert.throws(() => validateDocument({ ...d, objects: [{ ...text, fontFamily: 'Comic Sans' }] }), /fuente/);
    assert.match(exportSvg({ ...d, objects: [{ ...text, fontFamily: undefined }] }), /font-family="Arial, sans-serif"/);
});

test('the advanced layout tables are dropped before reading outlines; the others are kept intact', () => {
    // A tiny sfnt: header, three table records (GPOS, glyf, name) and their data.
    const tables = [['GPOS', [1, 2, 3]], ['glyf', [4, 5, 6, 7, 8]], ['name', [9]]];
    const size = 12 + tables.length * 16 + tables.reduce((sum, [, data]) => sum + ((data.length + 3) & ~3), 0);
    const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
    view.setUint32(0, 0x00010000); view.setUint16(4, tables.length);
    let offset = 12 + tables.length * 16;
    tables.forEach(([tag, data], i) => {
        const at = 12 + i * 16;
        bytes.set([...tag].map(c => c.charCodeAt(0)), at);
        view.setUint32(at + 8, offset); view.setUint32(at + 12, data.length);
        bytes.set(data, offset); offset += (data.length + 3) & ~3;
    });
    const out = new DataView(withoutLayoutTables(bytes.buffer)), count = out.getUint16(4);
    assert.equal(count, 2);
    const read = i => {
        const at = 12 + i * 16, tag = String.fromCharCode(...[0, 1, 2, 3].map(k => out.getUint8(at + k)));
        const start = out.getUint32(at + 8), length = out.getUint32(at + 12);
        return [tag, [...new Uint8Array(out.buffer, start, length)]];
    };
    assert.deepEqual([read(0), read(1)], [['glyf', [4, 5, 6, 7, 8]], ['name', [9]]]);
});
