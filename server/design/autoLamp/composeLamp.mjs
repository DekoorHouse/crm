// Arma, sin intervención humana, una lámpara de personaje como PROYECTO DEL EDITOR V2 (el mismo formato
// que se abre en /editor-v2): el marco de lámpara con su base blanca, la imagen de grabado dentro del
// PowerClip llenándolo, y el nombre en Rows of Sunflowers blanco con su silueta negra detrás (como la
// armó a mano el equipo en DH17220). Reutiliza el código del editor tal cual (modelo, PowerClip,
// silueta), así que lo que sale aquí se ve y se edita igual que si lo hubiera hecho una persona.
//
// Todo es puro salvo el renderizado (resvg); no toca Firestore ni la red.
import { createRequire } from 'node:module';
import { blankDocument, createObject, validateDocument, exportSvg, placeInPowerClip, fitPowerClip, clone } from '../../../public/editor-v2/model.mjs';
import { pathContains } from '../../../public/editor-v2/path.mjs';
import { presetObject, PRESETS } from '../../../public/editor-v2/presets.mjs';
import { silhouetteField, traceSilhouettes } from '../../../public/editor-v2/silhouette.mjs';
import { normalizePath } from '../../../public/editor-v2/path.mjs';
import { parsePathData } from '../../../public/editor-v2/svgImport.mjs';
import { withoutLayoutTables } from '../../../public/editor-v2/fonts.mjs';

const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js');
const opentype = require('opentype.js');

export const FONT_FAMILY = 'Rows of Sunflowers';
// La hoja del marco (coso.svg): 350 × 330 mm, con el marco en su lugar original.
const PAGE = { width: 350, height: 330 };
// Medidas tomadas del diseño hecho a mano (DH17220), en proporción al marco.
export const LAYOUT = {
    nameWidth: .52,        // ancho máximo del nombre, fracción del ancho del marco
    nameHeight: .11,       // alto máximo de las letras, fracción del alto del marco
    silhouette: 2,         // mm de silueta negra alrededor del nombre
    edge: 1.5,             // mm libres entre la silueta y el borde del marco
    rasterScale: 10,       // px por mm al medir la silueta
};

// La fuente, lista para sacar contornos (sin las tablas GDEF/GPOS/GSUB que opentype.js no siempre lee).
export function loadFont(bytes) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return opentype.parse(withoutLayoutTables(buffer));
}

// Contorno del texto en mm de la hoja, con la línea base en (x, baseline).
function textSubpaths(font, text, x, baseline, size) {
    return parsePathData(font.getPath(text, x, baseline, size).toPathData(4));
}

// La hoja con su marco en el lugar original de coso.svg.
function frameObject() {
    const preset = PRESETS['lamp-frame'];
    const box = normalizePath(parsePathData(preset.d).map(({ closed, points }) => ({ closed, points: points.map(v => v * preset.unit) })));
    return presetObject('lamp-frame', { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}
// Borde superior de la base (en mm de la hoja): la capa blanca fija del marco.
function baseTop(frame) {
    const ys = frame.overlay.subpaths.flatMap(({ points }) => points.filter((_, i) => i % 2)).map(v => frame.y + v * frame.height);
    return Math.min(...ys);
}

// Pinta un SVG a una máscara (alfa > 24), como el editor al medir la silueta.
function maskOf(markup, width, height) {
    const pixels = new Resvg(markup, { fitTo: { mode: 'original' }, background: 'rgba(0,0,0,0)' }).render().pixels;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 24 ? 1 : 0;
    return mask;
}

// Silueta exterior (rellena) alrededor de unos contornos, con el mismo trazo redondeado del editor.
export function outlineSilhouette(subpaths, distance, scale = LAYOUT.rasterScale) {
    const flat = subpaths.flatMap(s => s.points);
    const xs = flat.filter((_, i) => i % 2 === 0), ys = flat.filter((_, i) => i % 2);
    const margin = distance * 1.5 + 2;
    const box = { x: Math.min(...xs) - margin, y: Math.min(...ys) - margin };
    const w = Math.max(...xs) - box.x + margin, h = Math.max(...ys) - box.y + margin;
    const width = Math.round(w * scale), height = Math.round(h * scale);
    const d = subpaths.map(({ closed, points: p }) => {
        let text = `M${p[0]} ${p[1]}`;
        for (let i = 2; i + 5 < p.length; i += 6) text += `C${p[i]} ${p[i + 1]} ${p[i + 2]} ${p[i + 3]} ${p[i + 4]} ${p[i + 5]}`;
        return closed ? text + 'Z' : text;
    }).join('');
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box.x} ${box.y} ${w} ${h}"><path d="${d}" fill="#000"/></svg>`;
    const mask = maskOf(markup, width, height);
    const [loops] = traceSilhouettes(silhouetteField(mask, width, height, 'outside'), width, height, { distance: distance * scale, direction: 'outside' });
    if (!loops?.length) throw new Error('No se pudo trazar la silueta del nombre.');
    return loops.map(({ closed, points }) => ({ closed, points: points.map((v, i) => i % 2 ? box.y + v / scale : box.x + v / scale) }));
}

/**
 * @param {{ image: { dataUrl: string, width: number, height: number }, name: string, font: object, title?: string }} input
 * @returns {{ document: object, textId: string, frameId: string }}
 */
export function composeLamp({ image, name, font, title }) {
    const text = String(name || '').trim();
    if (!text) throw new Error('Falta el nombre de la lámpara.');
    const document = { ...blankDocument(), name: title || `Lámpara ${text}`, ...PAGE };

    // 1) Marco (PowerClip vacío con base blanca) e imagen de grabado llenándolo.
    const frame = frameObject();
    const picture = { ...createObject('image', frame.x, frame.y, frame.width, frame.width * image.height / image.width),
        name: 'Grabado', src: image.dataUrl, fill: 'none', stroke: 'none', strokeWidth: 0 };
    document.objects.push(frame, picture);
    placeInPowerClip(document, new Set([picture.id]), frame.id);
    const content = frame.powerClip.objects[0];
    fitPowerClip(frame, 'cover', { x: content.x, y: content.y, width: content.width, height: content.height });

    // 2) Nombre centrado, tocando la base, del tamaño que quepa en ancho y alto…
    const unit = font.getPath(text, 0, 0, 1).getBoundingBox();
    const inkWidth = unit.x2 - unit.x1, inkHeight = unit.y2 - unit.y1;
    const place = size => {
        const ink = { x1: unit.x1 * size, x2: unit.x2 * size, y2: unit.y2 * size };
        const x = frame.x + frame.width / 2 - (ink.x1 + ink.x2) / 2;
        const baseline = baseTop(frame) - LAYOUT.silhouette - ink.y2;
        return { size, x, baseline, outline: outlineSilhouette(textSubpaths(font, text, x, baseline, size), LAYOUT.silhouette) };
    };
    // …y que su silueta quede entera dentro del marco (con un margen), porque va dentro del PowerClip:
    // abajo el círculo se angosta, así que un nombre largo se hace más chico hasta caber.
    const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.width / 2 };
    const inside = outline => outline.every(({ points }) => {
        for (let i = 0; i < points.length; i += 2) {
            const dx = points[i] - centre.x, dy = points[i + 1] - centre.y, length = Math.hypot(dx, dy) || 1;
            if (!pathContains(frame, { x: points[i] + dx / length * LAYOUT.edge, y: points[i + 1] + dy / length * LAYOUT.edge })) return false;
        }
        return true;
    });
    let layout = place(Math.min(frame.width * LAYOUT.nameWidth / inkWidth, frame.height * LAYOUT.nameHeight / inkHeight));
    for (let tries = 0; tries < 40 && !inside(layout.outline); tries++) layout = place(layout.size * .96);
    const label = { ...createObject('text', layout.x, layout.baseline - layout.size), name: 'Nombre', text, fontSize: layout.size, fontFamily: FONT_FAMILY,
        fill: '#ffffff', stroke: 'none', strokeWidth: 0 };

    // 3) Silueta negra detrás del nombre (enlazada a él, como la herramienta Silueta del editor). Los dos
    // van dentro del PowerClip, encima del grabado, como los deja el equipo.
    const silhouette = { ...createObject('path', 0, 0), name: 'Silueta', ...normalizePath(layout.outline),
        fill: '#000000', stroke: 'none', strokeWidth: 0, silhouetteOf: [label.id] };
    document.objects.push(silhouette, label);
    placeInPowerClip(document, new Set([silhouette.id, label.id]), frame.id);

    return { document: validateDocument(document), textId: label.id, frameId: frame.id };
}

// El mismo documento con el texto convertido en curvas (lo que exporta el editor para la láser),
// también dentro de los PowerClips.
export function outlinedDocument(document, font) {
    const outline = objects => objects.map(item => {
        if (item.powerClip) return { ...item, powerClip: { ...item.powerClip, objects: outline(item.powerClip.objects) } };
        if (item.type !== 'text' || item.fontFamily !== FONT_FAMILY) return item;
        const subpaths = textSubpaths(font, item.text, item.x, item.y + item.fontSize, item.fontSize);
        return { ...createObject('path', 0, 0), ...normalizePath(subpaths), id: item.id, name: item.name, fill: item.fill, stroke: item.stroke, strokeWidth: item.strokeWidth };
    });
    const copy = clone(document);
    copy.objects = outline(copy.objects);
    return validateDocument(copy);
}

// SVG de corte/grabado de la hoja completa (texto en curvas), como "Exportar → SVG" del editor.
export const exportLampSvg = (document, font) => exportSvg(outlinedDocument(document, font));

// Vista previa para el cliente: sólo el marco, sobre negro, con la línea de corte discreta.
export function renderPreview(document, font, { width = 1100 } = {}) {
    const frame = document.objects.find(item => item.powerClip);
    const shown = outlinedDocument(document, font);
    shown.objects = shown.objects.map(item => item.id === frame.id ? { ...item, stroke: '#5f6b73', strokeWidth: .6 } : item);
    const pad = 4, box = { x: frame.x - pad, y: frame.y - pad, width: frame.width + 2 * pad, height: frame.height + 2 * pad };
    const svg = exportSvg(shown)
        .replace(/<svg ([^>]*?)width="[^"]*" height="[^"]*" viewBox="[^"]*"/, `<svg $1width="${box.width}mm" height="${box.height}mm" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"`)
        .replace(/(<title>[^<]*<\/title>)/, `$1<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="#000"/>`);
    return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}
