// Arma, sin intervención humana, una lámpara de personaje como PROYECTO DEL EDITOR V2 (el mismo formato
// que se abre en /editor-v2): el marco de lámpara con su base blanca, la imagen de grabado dentro del
// PowerClip llenándolo, y el nombre en Rows of Sunflowers con su silueta detrás. Todo en negro sobre blanco, que es lo que se graba (como la
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

// Tamaño en mm con que la imagen queda en la hoja al llenar el marco ("cover"): el mapa de bits se
// calcula a esta medida, como "Convertir a mapa de bits" del editor sobre la imagen ya colocada.
export function pictureSizeMm(image) {
    const frame = frameObject(), width = frame.width, height = frame.width * image.height / image.width;
    const scale = Math.max(frame.width / width, frame.height / height);
    return { width: width * scale, height: height * scale };
}

/**
 * @param {{ image: { dataUrl: string, width: number, height: number, pixelated?: boolean }, name: string, font: object, title?: string }} input
 * @returns {{ document: object, textId: string, frameId: string }}
 */
export function composeLamp({ image, name, font, title, nameSlot = null, avoid = [] }) {
    const text = String(name || '').trim();
    const document = { ...blankDocument(), name: title || `Lámpara ${text}`.trim(), ...PAGE };

    // 1) Marco (PowerClip vacío con base blanca) e imagen de grabado llenándolo.
    const frame = frameObject();
    const picture = { ...createObject('image', frame.x, frame.y, frame.width, frame.width * image.height / image.width),
        name: 'Grabado', src: image.dataUrl, fill: 'none', stroke: 'none', strokeWidth: 0, ...(image.pixelated ? { pixelated: true } : {}) };
    document.objects.push(frame, picture);
    placeInPowerClip(document, new Set([picture.id]), frame.id);
    const content = frame.powerClip.objects[0];
    fitPowerClip(frame, 'cover', { x: content.x, y: content.y, width: content.width, height: content.height });
    // Sin nombre (diseños que solo llevan la imagen): solo el marco con su grabado.
    if (!text) return { document: validateDocument(document), textId: null, frameId: frame.id };

    // 2) Nombre centrado, tocando la base, del tamaño que quepa en ancho y alto… En VARIOS renglones si el
    // texto trae " · " o saltos de línea (p. ej. "Victor Emilio · Domínguez Quintana"), cada uno centrado.
    // Un renglón muy largo (frases dedicadas) se parte por palabras en renglones parejos de ~22 letras.
    const lines = text.split(/\s*·\s*|\n+/).map(l => l.trim()).filter(Boolean).flatMap(line => {
        if (line.length <= 26) return [line];
        const words = line.split(/\s+/), target = line.length / Math.ceil(line.length / 22), out = [''];
        for (const w of words) {
            const cur = out[out.length - 1];
            if (cur && cur.length + 1 + w.length > target + 4) out.push(w); else out[out.length - 1] = cur ? `${cur} ${w}` : w;
        }
        return out;
    });
    const units = lines.map(line => font.getPath(line, 0, 0, 1).getBoundingBox());
    const inkWidth = Math.max(...units.map(u => u.x2 - u.x1)), inkHeight = Math.max(...units.map(u => u.y2 - u.y1));
    const LINE_GAP = 1.05;   // distancia entre renglones, en tamaños de letra
    const place = (size, lift = 0, fromTop = null) => {
        const last = units[units.length - 1];
        // nameSlot (plantillas del taller, p. ej. Spiderman): el bloque de texto centrado en un punto fijo del
        // marco (mm desde su esquina superior izquierda). Sin él, abajo, tocando la base. fromTop: el bloque ARRIBA,
        // su orilla de arriba a esa distancia del tope del marco (para no tapar rostros).
        let lastBaseline = baseTop(frame) - LAYOUT.silhouette - last.y2 * size - lift;
        if (fromTop != null) lastBaseline = frame.y + fromTop - units[0].y1 * size + (lines.length - 1) * LINE_GAP * size;
        if (nameSlot) {
            const top = units[0].y1 * size - (lines.length - 1) * LINE_GAP * size, bottom = last.y2 * size;
            lastBaseline = frame.y + nameSlot.cy - (top + bottom) / 2;
        }
        const rows = lines.map((line, k) => {
            const u = units[k], baseline = lastBaseline - (lines.length - 1 - k) * LINE_GAP * size;
            return { line, x: frame.x + (nameSlot ? nameSlot.cx : frame.width / 2) - (u.x1 + u.x2) * size / 2, baseline };
        });
        const subpaths = rows.flatMap(r => textSubpaths(font, r.line, r.x, r.baseline, size));
        return { size, rows, outline: outlineSilhouette(subpaths, LAYOUT.silhouette) };
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
    const maxW = nameSlot ? nameSlot.maxWidth : frame.width * LAYOUT.nameWidth;
    const maxH = nameSlot ? nameSlot.maxHeight / lines.length : frame.height * LAYOUT.nameHeight;
    // Frases de 3+ renglones: antes de achicar, el bloque sube hacia la parte ancha del círculo (hasta ~30% del
    // marco); un nombre de 1-2 renglones se queda tocando la base como siempre.
    const lifts = !nameSlot && lines.length > 2 ? Array.from({ length: 16 }, (_, k) => k * frame.height * .02) : [0];
    const fit = size => { for (const lift of lifts) { const l = place(size, lift); if (inside(l.outline)) return l; } return null; };
    const start = Math.min(maxW / inkWidth, maxH / inkHeight);
    let size = start, layout = fit(size);
    for (let tries = 0; tries < 40 && !layout; tries++) layout = fit(size *= .96);
    layout = layout || place(size);

    // ROSTROS (Chris, 21-oct-2026): el texto nunca encima de una cara. avoid = cajas de los rostros en fracciones de
    // la imagen [x0, y0, x1, y1]; se pasan a mm según dónde quedó la imagen en el marco (con 2 mm de aire).
    let faceOverlap = false;
    // La imagen vive en coordenadas del PowerClip: a la hoja = marco + (p · escala + desplazamiento) / (clip / marco).
    const pic = frame.powerClip.objects.find(item => item.type === 'image') || content;
    const t = frame.powerClip.transform || { x: 0, y: 0, scale: 1 }, sx = frame.powerClip.width / frame.width, sy = frame.powerClip.height / frame.height;
    const toPage = (x, y) => ({ x: frame.x + (x * t.scale + t.x) / sx, y: frame.y + (y * t.scale + t.y) / sy });
    const p0 = toPage(pic.x, pic.y), p1 = toPage(pic.x + pic.width, pic.y + pic.height), pw = p1.x - p0.x, ph = p1.y - p0.y;
    const faces = (nameSlot ? [] : avoid).map(([x0, y0, x1, y1]) => ({ x0: p0.x + x0 * pw - 2, y0: p0.y + y0 * ph - 2, x1: p0.x + x1 * pw + 2, y1: p0.y + y1 * ph + 2 }));
    const hitsFace = outline => outline.some(({ points }) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < points.length; i += 2) { x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]); y0 = Math.min(y0, points[i + 1]); y1 = Math.max(y1, points[i + 1]); }
        return faces.some(f => x0 < f.x1 && x1 > f.x0 && y0 < f.y1 && y1 > f.y0);
    });
    if (faces.length && hitsFace(layout.outline)) {
        // 1) Abajo, subiéndolo un poco o achicándolo (hasta 55 %); 2) arriba; 3) si no se puede, donde iba y se avisa.
        // Revisión rápida con la caja de cada renglón (sin armar la silueta, que es lo caro); solo las que pasan se
        // arman completas.
        const roughHit = (s, lift, fromTop) => {
            const last = units[units.length - 1], m = LAYOUT.silhouette;
            let lastBaseline = baseTop(frame) - m - last.y2 * s - lift;
            if (fromTop != null) lastBaseline = frame.y + fromTop - units[0].y1 * s + (lines.length - 1) * LINE_GAP * s;
            return units.some((u, k) => {
                const baseline = lastBaseline - (lines.length - 1 - k) * LINE_GAP * s, x = frame.x + frame.width / 2 - (u.x1 + u.x2) * s / 2;
                const b = { x0: x + u.x1 * s - m, x1: x + u.x2 * s + m, y0: baseline + u.y1 * s - m, y1: baseline + u.y2 * s + m };
                return faces.some(f => b.x0 < f.x1 && b.x1 > f.x0 && b.y0 < f.y1 && b.y1 > f.y0);
            });
        };
        const ok = l => inside(l.outline) && !hitsFace(l.outline);
        const sizes = []; for (let s = start; s >= start * .55; s *= .94) sizes.push(s);
        const pick = () => {
            for (const s of sizes) for (let k = 0; k <= 12; k++) { const lift = k * frame.height * .02; if (roughHit(s, lift)) continue; const l = place(s, lift); if (ok(l)) return l; }
            for (const s of sizes) for (let k = 2; k <= 18; k++) { const top = k * frame.height * .02; if (roughHit(s, 0, top)) continue; const l = place(s, 0, top); if (ok(l)) return l; }
            return null;
        };
        const better = pick();
        if (better) layout = better; else faceOverlap = true;
    }
    const labels = layout.rows.map((row, k) => ({ ...createObject('text', row.x, row.baseline - layout.size), name: lines.length > 1 ? `Nombre ${k + 1}` : 'Nombre',
        text: row.line, fontSize: layout.size, fontFamily: FONT_FAMILY, fill: '#000000', stroke: 'none', strokeWidth: 0 }));

    // 3) Silueta blanca detrás del nombre (el nombre va en negro: se graba), enlazada a él como la herramienta
    // Silueta del editor. Todo va dentro del PowerClip, encima del grabado, como lo deja el equipo.
    const silhouette = { ...createObject('path', 0, 0), name: 'Silueta', ...normalizePath(layout.outline),
        fill: '#ffffff', stroke: 'none', strokeWidth: 0, silhouetteOf: labels.map(l => l.id) };
    document.objects.push(silhouette, ...labels);
    placeInPowerClip(document, new Set([silhouette.id, ...labels.map(l => l.id)]), frame.id);

    return { document: validateDocument(document), textId: labels[0].id, frameId: frame.id, faceOverlap };
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

// ARCHIVO PARA RDWORKS (Chris, 19-oct-2026): se importa el SVG directo en RDWorks, que arma una capa por
// color y no respeta recortes. Por eso lleva SOLO dos cosas: una imagen de 1 bit a 254 DPI (0.1 mm por
// pixel) con todo lo que se graba ya fusionado y recortado al marco (grabado, nombre, silueta, base blanca;
// negro = se graba), y la línea de corte del marco como vector rojo puro #FF0000. Nada de rellenos blancos,
// texto ni clipPath que RDWorks pueda leer como otra capa.
export const RDWORKS_DPI = 254;
// Una PIEZA por lámpara: su imagen de grabado (1 bit, ya transpuesta = girada y espejeada) y el trayecto del
// marco en coordenadas de la hoja SIN girar (el giro se aplica al acomodarla en la hoja, rdworksSheet).
export async function rdworksPiece(document, font) {
    const sharp = require('sharp');
    const { pngWithDpi } = await import('../../../public/editor-v2/bitmap.mjs');
    const frame = document.objects.find(item => item.powerClip);
    const box = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    const pxPerMm = RDWORKS_DPI / 25.4, width = Math.round(box.width * pxPerMm), height = Math.round(box.height * pxPerMm);
    const crop = svg => svg.replace(/<svg ([^>]*?)width="[^"]*" height="[^"]*" viewBox="[^"]*"/, `<svg $1width="${box.width}mm" height="${box.height}mm" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"`);
    const draw = doc => new Resvg(crop(exportSvg(doc)), { fitTo: { mode: 'width', value: width }, background: '#ffffff' }).render();
    // Lo que se graba, sin la línea del marco (va aparte como vector).
    const shown = outlinedDocument(document, font);
    shown.objects = shown.objects.map(item => item.id === frame.id ? { ...item, stroke: 'none' } : item);
    const art = draw(shown);
    // Máscara del marco (blanco = dentro) para que nada se grabe fuera de la pieza.
    const maskDoc = clone(document);
    maskDoc.objects = maskDoc.objects.filter(item => item.id === frame.id).map(item => {
        const plain = { ...item, fill: '#000000', stroke: 'none', powerClip: { ...item.powerClip, objects: [] } };
        delete plain.overlay; return plain;
    });
    // OJO: en resvg `.pixels` COPIA todo el buffer en cada lectura; se lee una sola vez.
    const artPx = art.pixels, maskPx = draw(maskDoc).pixels;
    const w = art.width, h = art.height, grey = Buffer.alloc(w * h);
    let insideCount = 0, inkCount = 0;
    for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
        const inside = maskPx[p] < 128;                       // el marco se pintó negro sobre blanco
        const lum = (artPx[p] * 299 + artPx[p + 1] * 587 + artPx[p + 2] * 114) / 1000;
        grey[i] = inside && lum < 128 ? 0 : 255;              // 1 bit: negro se graba, blanco no
        if (inside) { insideCount++; if (lum < 128) inkCount++; }
    }
    // ACOMODO PARA LA LÁSER (Chris, 19-oct-2026): girar 90° a la derecha + espejear (= transponer, (x, y) ->
    // (y, x)) y luego girar 180° para que la pestaña de la base quede a la IZQUIERDA. Todo junto es
    // (x, y) -> (H - y, W - x). Se aplica de verdad a los pixeles y a las coordenadas (sin transform="" que
    // RDWorks pueda leer mal). Solo en este archivo: los previos del equipo y del cliente quedan derechos.
    const turned = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) turned[(w - 1 - x) * h + (h - 1 - y)] = grey[y * w + x];
    const png = Buffer.from(pngWithDpi(await sharp(turned, { raw: { width: h, height: w, channels: 1 } }).png({ palette: true, colours: 2 }).toBuffer(), RDWORKS_DPI));
    const line = { ...frame, fill: 'none', stroke: '#ff0000', strokeWidth: .3 };
    delete line.powerClip; delete line.overlay;
    const d = exportSvg({ ...blankDocument(), width: document.width, height: document.height, objects: [line] }).match(/<path\b[^>]*?\sd="([^"]*)"/)[1];
    if (/[a-y]/i.test(d.replace(/[MCLZ]/g, ''))) throw new Error('La línea de corte trae comandos que no se pueden girar.');
    // inkShare: qué parte del marco se graba (para notar un diseño que quedó recortado o vacío al moverlo).
    return { png, box, d, page: { width: document.width, height: document.height }, inkShare: insideCount ? inkCount / insideCount : 0 };
}

// PLANTILLA DE LAS MÁQUINAS (Chris, 20-oct-2026, «especiales1910.8.svg» de CorelDRAW): hoja de 350 × 330 mm,
// cuadro AZUL de 20 × 20 mm en la esquina superior izquierda (referencia de la láser) y las dos lámparas una
// ARRIBA de la otra, pegadas al borde izquierdo con la pestaña a la izquierda. Esquina superior izquierda de
// cada lámpara (ya girada) en la hoja, en mm.
export const RDWORKS_SHEET = { width: 350, height: 330 };
// Entre las dos lámparas van 5 mm (Chris, 20-oct-2026; en la plantilla eran 1.2 mm): 0.349 + 160 + 5.
export const RDWORKS_SLOTS = [{ x: 0, y: 0.349 }, { x: 0, y: 165.349 }];
const RDWORKS_MARK = '<rect x="0" y="0" width="20" height="20" fill="none" stroke="#0000ff" stroke-width="0.2"/>';
const NUMBER_PAIR = /(-?\d*\.?\d+(?:e-?\d+)?)[ ,]+(-?\d*\.?\d+(?:e-?\d+)?)/gi;

/**
 * Una HOJA para RDWorks con 1 o 2 piezas. placements: [{ piece, slot }] (0 = arriba, 1 = abajo). Cada pieza se
 * gira (x, y) -> (-y, -x) (90° der + espejo + 180°: pestaña a la izquierda) y se recorre a su lugar de la plantilla.
 * Las imágenes de las dos lámparas van en UNA sola imagen, con la separación en blanco: dos imágenes sueltas dejaban
 * un hueco transparente entre ellas que se veía como una línea negra (Chris, 20-oct-2026). A 254 DPI son 10 px por
 * mm exactos, así que cada lámpara cae justo en su lugar.
 */
export async function rdworksSheet(placements, title = '') {
    const sharp = require('sharp');
    const { pngWithDpi } = await import('../../../public/editor-v2/bitmap.mjs');
    const pxPerMm = RDWORKS_DPI / 25.4;
    const top = Math.min(...placements.map(({ slot }) => RDWORKS_SLOTS[slot].y)), left = Math.min(...placements.map(({ slot }) => RDWORKS_SLOTS[slot].x));
    const layers = [], paths = [];
    let width = 0, height = 0;
    for (const { piece, slot } of placements) {
        const { box, png } = piece, at = RDWORKS_SLOTS[slot];
        const meta = await sharp(png).metadata();
        const dx = Math.round((at.x - left) * pxPerMm), dy = Math.round((at.y - top) * pxPerMm);
        layers.push({ input: await sharp(png).greyscale().toBuffer(), left: dx, top: dy });
        width = Math.max(width, dx + meta.width); height = Math.max(height, dy + meta.height);
        // Girada, la pieza ocupa x' en [-(box.y + box.height), -box.y] e y' en [-(box.x + box.width), -box.x].
        const ox = at.x + box.y + box.height, oy = at.y + box.x + box.width;
        // El trayecto es absoluto (M/C/L/Z con pares x y): se gira y se recorre cada par.
        paths.push(`<path d="${piece.d.replace(NUMBER_PAIR, (_, x, y) => `${(ox - +y).toFixed(4)} ${(oy - +x).toFixed(4)}`)}" fill="none" stroke="#ff0000" stroke-width="0.3"/>`);
    }
    const merged = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(layers).greyscale()
        .threshold(128).png({ palette: true, colours: 2 }).toBuffer();
    const png = Buffer.from(pngWithDpi(merged, RDWORKS_DPI));
    const { width: W, height: H } = RDWORKS_SHEET;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">
<title>${String(title).replace(/[<&>"]/g, '')}</title>
${RDWORKS_MARK}
<image x="${left}" y="${top}" width="${width / pxPerMm}" height="${height / pxPerMm}" preserveAspectRatio="none" style="image-rendering:pixelated" xlink:href="data:image/png;base64,${png.toString('base64')}"/>
${paths.join('\n')}
</svg>`;
}

// Hojas de un pedido: cada lámpara tantas veces como su cantidad, de 2 en 2 por hoja. pieces: [{ piece, copies }].
// Cada pieza va en su LUGAR FIJO de la plantilla sin importar dónde haya quedado el marco en el proyecto (en el
// editor se puede mover y la hoja salía cortada: DH18191, 19-oct-2026).
export async function rdworksSheets(pieces, title = '') {
    const flat = pieces.flatMap(({ piece, copies }) => Array.from({ length: Math.max(1, Number(copies) || 1) }, () => piece));
    const total = Math.ceil(flat.length / 2), sheets = [];
    for (let i = 0; i < flat.length; i += 2) {
        const placements = flat.slice(i, i + 2).map((piece, slot) => ({ piece, slot }));
        sheets.push(await rdworksSheet(placements, total > 1 ? `${title} · hoja ${sheets.length + 1} de ${total}` : title));
    }
    return sheets;
}

// Una sola lámpara en su hoja.
export async function exportRdworksSvg(document, font) {
    return (await rdworksSheets([{ piece: await rdworksPiece(document, font), copies: 1 }], document.name || ''))[0];
}

// PREVIO PARA EL CLIENTE (Chris, 19-oct-2026): el diseño de grabado es negro sobre blanco (lo negro se graba);
// el cliente ve los colores INVERTIDOS de esa hoja: todo negro y el diseño en blanco, como la lámpara prendida.
// Primero se arma la hoja "en blanco" (círculo y base blancos, contorno discreto) y al final se invierte.
export function renderClientPreview(document, font, { width = 1100 } = {}) {
    const frame = document.objects.find(item => item.powerClip);
    const pad = 4, box = { x: frame.x - pad, y: frame.y - pad, width: frame.width + 2 * pad, height: frame.height + 2 * pad };
    const crop = svg => svg.replace(/<svg ([^>]*?)width="[^"]*" height="[^"]*" viewBox="[^"]*"/, `<svg $1width="${box.width}mm" height="${box.height}mm" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"`);
    const draw = (doc, background) => new Resvg(crop(exportSvg(doc)), { fitTo: { mode: 'width', value: width }, background }).render();
    // Solo el marco (sin contenido), pintado como haga falta para sacar máscaras del mismo tamaño.
    const frameOnly = ({ overlayFill, ...paint }) => {
        const doc = clone(document);
        doc.objects = doc.objects.filter(item => item.id === frame.id).map(item => {
            const plain = { ...item, ...paint, powerClip: { ...item.powerClip, objects: [] } };
            if (overlayFill) plain.overlay = { ...item.overlay, fill: overlayFill }; else delete plain.overlay;
            return plain;
        });
        return doc;
    };
    const shown = outlinedDocument(document, font);
    shown.objects = shown.objects.map(item => item.id === frame.id ? { ...item, stroke: 'none' } : item);
    // OJO: en resvg `.pixels` COPIA todo el buffer en cada lectura; se lee una sola vez por capa.
    const rendered = draw(shown, '#ffffff');
    const design = { width: rendered.width, height: rendered.height, pixels: rendered.pixels };
    const area = draw(frameOnly({ fill: '#ffffff', stroke: 'none', overlayFill: '#ffffff' }), '#000000').pixels;
    const base = draw(frameOnly({ fill: '#000000', stroke: 'none', overlayFill: '#ffffff' }), '#000000').pixels;
    const line = draw(frameOnly({ fill: 'none', stroke: '#5f6b73', strokeWidth: .6 }), 'rgba(0,0,0,0)').pixels;
    const out = Buffer.alloc(design.width * design.height * 3);
    for (let i = 0, j = 0; j < out.length; i += 4, j += 3) {
        // Cualquier pixel que toque la base (aunque sea el borde suavizado) va blanco: si no, queda una costura gris.
        const inFrame = area[i] > 127, inBase = base[i] > 8;
        for (let c = 0; c < 3; c++) {
            let v = 255;
            if (!inBase && inFrame) v = design.pixels[i + c];
            const a = line[i + 3] / 255;   // contorno del marco encima
            out[j + c] = 255 - Math.round(v * (1 - a) + line[i + c] * a);   // invertido para el cliente
        }
    }
    return { raw: out, width: design.width, height: design.height };
}

// Vista previa para el equipo: sólo el marco, sobre negro, con la línea de corte discreta.
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
