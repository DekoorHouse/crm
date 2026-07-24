// ===================================================================
// Renderizador de la 2ª referencia ("diseño a grabar") en el SERVIDOR.
// -------------------------------------------------------------------
// El camino MANUAL rasteriza el diseño del lienzo en el NAVEGADOR (con la fuente manuscrita) y lo
// manda a la IA como 2ª imagen. La generación AUTOMÁTICA (mockupAutoScheduler) no tenía cómo hacerlo
// en el servidor, así que generaba el mockup SIN referencia. Este módulo replica ese rasterizado en
// Node con @resvg/resvg-js + la fuente RowsOfSunflowers, para que el automático también la use.
// ===================================================================
const path = require('path');
const { db } = require('../config');
const { Resvg } = require('@resvg/resvg-js');
const axios = require('axios');

const FONT_PATH = path.join(__dirname, '..', '..', 'public', 'editor', 'fonts', 'RowsOfSunflowers.ttf');
const FONT_FAMILY = 'Rows of Sunflowers';
const LZ_W = 864, LZ_H = 1152;   // lienzo de diseño (mismas dimensiones que el editor del frontend)

// Instrucción que se AGREGA al prompt cuando hay 2ª referencia (idéntica a la del camino manual
// en mockupsRoutes.js, para que la IA reproduzca EXACTAMENTE el diseño grabado).
const SECOND_REF_PROMPT = '\n\nSe adjuntan DOS imágenes: (1) la foto de la lámpara base —NO la modifiques (figura, base, acrílico, color, iluminación y fondo intactos)— y (2) el DISEÑO de referencia que debes grabar en la lámpara. Reproduce el diseño (2) EXACTAMENTE: mismas palabras y ortografía, misma tipografía manuscrita, mismo símbolo y misma composición. Intégralo de forma foto-realista sobre la lámpara ajustando solo tamaño, posición y perspectiva; no inventes ni cambies el texto.';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Normaliza el nombre del item para mapearlo a un campo (igual que mkNorm del frontend): minúsculas,
// sin acentos, sin espacios. Así "Nombre 1" -> "nombre1".
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');

// "Sin Fecha" (el cliente NO quiere fecha) -> vacío, para que la referencia NO lleve ese texto.
function esSinFecha(v) {
    const s = String(v || '').toLowerCase().trim();
    if (!s) return false;
    return /sin\s*fecha/.test(s) || /\bno\b[^]*\bfecha\b/.test(s) || /^(ninguna?|n\s*\/\s*a|s\s*\/\s*f|-{1,}|—{1,})$/.test(s);
}

// Rellena el texto de un item con los datos del pedido: por placeholder {clave} o por el name del item.
function fillText(it, fields) {
    const t = it.text || '';
    if (/\{[a-zA-Z0-9_]+\}/.test(t)) return t.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => {
        const val = fields[k] != null ? String(fields[k]) : '';
        return (k === 'fecha' && esSinFecha(val)) ? '' : val;
    });
    const key = norm(it.name);
    if (key && key !== 'personalizacion' && Object.prototype.hasOwnProperty.call(fields, key)) {
        let v = fields[key] != null ? String(fields[key]) : '';
        if (key === 'fecha' && esSinFecha(v)) v = '';   // "Sin Fecha" -> vacío
        return v;
    }
    return t;
}

// resvg no descarga URLs http; convierte un href a data-uri (los data-uri se dejan igual).
async function toDataUri(href) {
    if (!href) return null;
    if (href.startsWith('data:')) return href;
    if (/^https?:\/\//.test(href)) {
        try {
            const r = await axios.get(href, { responseType: 'arraybuffer', timeout: 20000 });
            const mime = r.headers['content-type'] || 'image/png';
            return `data:${mime};base64,${Buffer.from(r.data).toString('base64')}`;
        } catch (_) { return null; }
    }
    return null;
}

// ===================== AUTO-AJUSTE DEL TEXTO (paridad con el editor del navegador) =====================
// El editor del lienzo (mockups-handlers.js) hace DOS cosas con cada texto que este renderizador debía
// replicar y no lo hacía —por eso los nombres del automático tocaban el infinito o salían corridos
// hacia arriba (visto en pedidos reales, jul-2026):
//   1) Encoge el texto que no cabe DENTRO de su área de límite (limit/limitPath = los lóbulos del
//      infinito y la caja de la fecha), por bisección, midiendo la tinta real.
//   2) Ancla el texto por su CENTRO vertical (dominant-baseline central); sin eso el texto se dibuja
//      desde su base y sube ~40px respecto a donde lo puso el diseñador, invadiendo el trazo.
const LIMIT_MARGIN = 6;   // mismo margen que MK_LZ_LIMIT_MARGIN del navegador

// Áreas de límite como polígonos en coords del lienzo (rect -> 4 esquinas; trazo a mano -> sus puntos).
function limitShapesFrom(items) {
    const shapes = [];
    for (const it of (items || [])) {
        if (it.type === 'limit') {
            shapes.push([{ x: it.x, y: it.y }, { x: it.x + it.w, y: it.y }, { x: it.x + it.w, y: it.y + it.h }, { x: it.x, y: it.y + it.h }]);
        } else if (it.type === 'limitPath' && Array.isArray(it.points) && it.points.length >= 3) {
            const s = it.scale || 1;
            shapes.push(it.points.map(p => ({ x: it.x + s * p.x, y: it.y + s * p.y })));
        }
    }
    return shapes;
}

// ¿El punto está dentro del polígono? (ray casting par/impar) — idéntico al del navegador.
function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

// Cuerpo de un <text>: una línea (esc) o varios renglones apilados (tspans centrados en y) cuando el
// valor trae saltos de línea (Enter = nombre a 2 renglones). Se usa igual para MEDIR y para DIBUJAR,
// así el auto-ajuste ve la caja multilínea real (medirlo como una sola línea lo achicaría de más).
const TEXT_LH = 1.15;
function textBody(text, x) {
    const lines = String(text == null ? '' : text).split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length <= 1) return esc(lines[0] || '');
    return lines.map((ln, i) => `<tspan x="${x}" dy="${i === 0 ? (-((lines.length - 1) * TEXT_LH) / 2) : TEXT_LH}em">${esc(ln)}</tspan>`).join('');
}

// Caja de TINTA de un texto (a un tamaño dado) en coords del lienzo, medida con resvg (getBBox).
// La tinta escala linealmente con el tamaño, así que con UNA medición se prueba cualquier factor.
function measureInk(text, size, x, y, anchor) {
    try {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LZ_W}" height="${LZ_H}"><text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="central">${textBody(text, x)}</text></svg>`;
        const r = new Resvg(svg, { font: { fontFiles: [FONT_PATH], defaultFontFamily: FONT_FAMILY, loadSystemFonts: false } });
        return r.getBBox() || null;
    } catch (_) { return null; }
}

// Perímetro de la caja del texto escalada por f alrededor del ancla (x,y), crecida un margen M.
// Igual que mkLzTextBoxPts del navegador: si TODOS estos puntos caen dentro del límite, cabe.
function textBoxPts(x, y, ink, f, M) {
    const extL = x - ink.x, extR = ink.x + ink.width - x, extT = y - ink.y, extB = ink.y + ink.height - y;
    const x0 = x - (extL * f + M), x1 = x + (extR * f + M);
    const y0 = y - (extT * f + M), y1 = y + (extB * f + M);
    const pts = []; const N = 6;
    for (let i = 0; i <= N; i++) { const px = x0 + (x1 - x0) * i / N; pts.push({ x: px, y: y0 }, { x: px, y: y1 }); }
    for (let i = 1; i < N; i++) { const py = y0 + (y1 - y0) * i / N; pts.push({ x: x0, y: py }, { x: x1, y: py }); }
    return pts;
}

// Tamaño de fuente para que el texto quepa dentro de los límites que contienen su ancla (bisección,
// igual que mkLzComputeSizes del navegador). Sin límites, o si ya cabe al tamaño deseado -> baseSize.
function fitTextSize(text, baseSize, x, y, anchor, shapes) {
    if (!shapes.length || !String(text || '').trim()) return baseSize;
    const inShapes = shapes.filter(poly => pointInPoly({ x, y }, poly));
    if (!inShapes.length) return baseSize;
    const ink = measureInk(text, baseSize, x, y, anchor);
    if (!ink) return baseSize;
    const fits = (f) => textBoxPts(x, y, ink, f, LIMIT_MARGIN).every(p => inShapes.every(poly => pointInPoly(p, poly)));
    let f = 1;
    if (!fits(1)) { let lo = 0, hi = 1; for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; } f = lo; }
    return Math.max(10, Math.floor(baseSize * f));
}

// Construye el SVG del diseño del lienzo (imagen de fondo + textos) relleno con los datos del pedido.
// Los items 'limit'/'limitPath' NO se dibujan: solo acotan el auto-ajuste del texto (ver arriba).
async function buildLienzoSvg(items, fields) {
    const shapes = limitShapesFrom(items);
    let inner = `<rect width="${LZ_W}" height="${LZ_H}" fill="#000"/>`;
    for (const it of (items || [])) {
        if (it.type === 'image' && it.href) {
            const uri = await toDataUri(it.href);
            if (!uri) continue;
            const h = it.h || (it.ar ? it.w / it.ar : it.w);
            inner += `<image x="${it.x}" y="${it.y}" width="${it.w}" height="${h}" href="${esc(uri)}" preserveAspectRatio="xMidYMid meet"/>`;
        } else if (it.type === 'text') {
            const val = fillText(it, fields);
            if (!val) continue;
            const baseSize = it.baseSize || it.size || 60;
            const anchor = it.align === 'center' ? 'middle' : it.align === 'right' ? 'end' : 'start';
            const size = fitTextSize(val, baseSize, it.x, it.y, anchor, shapes);
            inner += `<text x="${it.x}" y="${it.y}" fill="#fff" font-family="${FONT_FAMILY}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="central">${textBody(val, it.x)}</text>`;
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${LZ_W}" height="${LZ_H}" viewBox="0 0 ${LZ_W} ${LZ_H}">${inner}</svg>`;
}

// Rasteriza un SVG a PNG (Buffer) con la fuente manuscrita embebida por archivo.
function svgToPng(svg) {
    const resvg = new Resvg(svg, { font: { fontFiles: [FONT_PATH], defaultFontFamily: FONT_FAMILY, loadSystemFonts: false } });
    return resvg.render().asPng();
}

// PNG (Buffer) de la 2ª referencia para un pedido, a partir de la plantilla. null si no hay diseño.
// Fuente del diseño: (1) el diseño del lienzo (mockup_designs) que la plantilla trae en designId;
// (2) el designSvg de la plantilla. Sin ninguno -> null (el mockup se genera sin referencia).
async function renderReferenceForTemplate(tpl, fields) {
    try {
        if (tpl && tpl.designId) {
            const dd = await db.collection('mockup_designs').doc(String(tpl.designId)).get();
            const items = dd.exists ? (dd.data().items || []) : [];
            if (items.length) return svgToPng(await buildLienzoSvg(items, fields));
        }
        if (tpl && tpl.designSvg) {
            const filled = String(tpl.designSvg).replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => esc(fields[k] != null ? String(fields[k]) : ''));
            return svgToPng(filled);
        }
        return null;
    } catch (e) {
        console.warn('[mockup-ref] no se pudo renderizar la referencia:', e.message);
        return null;
    }
}

module.exports = { renderReferenceForTemplate, buildLienzoSvg, svgToPng, SECOND_REF_PROMPT };
