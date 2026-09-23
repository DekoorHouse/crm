// Licensed text fonts. The font files are not in the repository: they are kept in Firebase Storage
// (editor-v2/fonts/), downloaded with the CRM session and cached in this browser. On export, text in these
// fonts becomes curves (opentype.js), so the laser software needs no font and the file is not shipped.
import { createObject, objectsWithContents } from './model.mjs';
import { normalizePath } from './path.mjs';
import { parsePathData } from './svgImport.mjs';
import { rotatePoint, pivot } from './transform.mjs';

export const FONTS = { 'Rows of Sunflowers': { file: 'rows-of-sunflowers.ttf' } };
export const DEFAULT_TEXT_FONT = 'Rows of Sunflowers';
const CACHE = 'dekoor-editor-fonts';
const loaded = new Map();
export const fontReady = family => family === 'Arial' || loaded.has(family);

async function register(family, bytes) {
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
    loaded.set(family, bytes);
}
async function cache() { try { return await caches.open(CACHE); } catch { return null; } }

// Fonts already in this browser's cache load without a session or a network request.
export async function loadCachedFonts() {
    const store = await cache();
    if (!store) return;
    for (const [family, { file }] of Object.entries(FONTS)) {
        if (loaded.has(family)) continue;
        const response = await store.match(file);
        if (response) await register(family, await response.arrayBuffer()).catch(() => store.delete(file));
    }
}
// The rest come from Storage; returns the families that are not there yet (to offer uploading them).
export async function loadCloudFonts(api) {
    const missing = [];
    for (const [family, { file }] of Object.entries(FONTS)) {
        if (loaded.has(family)) continue;
        const url = await api.fonts.url(file);
        if (!url) { missing.push(family); continue; }
        const response = await fetch(url);
        if (!response.ok) throw new Error('No se pudo descargar la fuente.');
        const bytes = await response.arrayBuffer();
        await register(family, bytes.slice(0));
        await (await cache())?.put(file, new Response(bytes, { headers: { 'Content-Type': 'font/ttf' } }));
    }
    return missing;
}
export async function uploadFont(api, family, fileObject) {
    const bytes = await fileObject.arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('La fuente pesa más de 5 MB.');
    // Checks it is a font before uploading it.
    await new FontFace(family, bytes.slice(0)).load().catch(() => { throw new Error('El archivo no es una fuente TrueType válida.'); });
    await api.fonts.upload(FONTS[family].file, bytes);
    await register(family, bytes.slice(0));
    await (await cache())?.put(FONTS[family].file, new Response(bytes, { headers: { 'Content-Type': 'font/ttf' } }));
}

// Text in a loaded font as a curve: the glyph outlines at the text's position and size, turned like the
// text around its anchor. The object keeps its id, name, colours and place in the document.
let opentype;
const parsed = new Map();
// Outlines only need glyphs, metrics, the character map and basic kerning. The advanced layout tables
// (GDEF, GPOS, GSUB) are left out before parsing: some fonts carry versions opentype.js cannot read.
export function withoutLayoutTables(bytes) {
    const view = new DataView(bytes), count = view.getUint16(4), keep = [];
    for (let i = 0; i < count; i++) {
        const at = 12 + i * 16, tag = String.fromCharCode(...new Uint8Array(bytes, at, 4));
        if (!['GDEF', 'GPOS', 'GSUB'].includes(tag)) keep.push({ record: new Uint8Array(bytes, at, 16), offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
    }
    let size = 12 + keep.length * 16;
    const placed = keep.map(table => { const offset = size; size += (table.length + 3) & ~3; return { ...table, newOffset: offset }; });
    const out = new Uint8Array(size), outView = new DataView(out.buffer);
    out.set(new Uint8Array(bytes, 0, 12));
    outView.setUint16(4, keep.length);
    placed.forEach((table, i) => {
        out.set(table.record, 12 + i * 16);
        outView.setUint32(12 + i * 16 + 8, table.newOffset);
        out.set(new Uint8Array(bytes, table.offset, table.length), table.newOffset);
    });
    return out.buffer;
}
async function glyphFont(family) {
    opentype ||= await import('https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/+esm');
    if (!parsed.has(family)) parsed.set(family, (opentype.parse || opentype.default.parse)(withoutLayoutTables(loaded.get(family).slice(0))));
    return parsed.get(family);
}
export async function textToCurve(text) {
    const font = await glyphFont(text.fontFamily);
    const d = font.getPath(text.text, text.x, text.y + text.fontSize, text.fontSize).toPathData(4);
    let subpaths = parsePathData(d);
    if (!subpaths.length) return null;
    if (text.rotation) {
        const centre = pivot(text);
        subpaths = subpaths.map(({ closed, points }) => {
            const out = [];
            for (let i = 0; i < points.length; i += 2) { const p = rotatePoint({ x: points[i], y: points[i + 1] }, centre, text.rotation); out.push(p.x, p.y); }
            return { closed, points: out };
        });
    }
    const curve = { ...createObject('path', 0, 0), ...normalizePath(subpaths), id: text.id, name: text.name, fill: text.fill, stroke: text.stroke, strokeWidth: text.strokeWidth, hidden: text.hidden, locked: text.locked };
    return curve;
}
// Replaces every text in a licensed font (also inside PowerClips) with its curve, in place.
export async function outlineLicensedText(document) {
    const lists = [document.objects, ...[...objectsWithContents(document.objects)].filter(item => item.powerClip).map(item => item.powerClip.objects)];
    for (const list of lists) {
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (item.type !== 'text' || !item.fontFamily || item.fontFamily === 'Arial') continue;
            if (!loaded.has(item.fontFamily)) throw new Error(`La fuente ${item.fontFamily} no está cargada. Inicia sesión para descargarla antes de exportar.`);
            const curve = await textToCurve(item);
            if (curve) list[i] = curve; else list.splice(i--, 1);
        }
    }
    return document;
}
