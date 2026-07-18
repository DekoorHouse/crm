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

// Construye el SVG del diseño del lienzo (imagen de fondo + textos) relleno con los datos del pedido.
// Los items 'limit'/'limitPath' son solo restricciones de ajuste del frontend: no se dibujan.
async function buildLienzoSvg(items, fields) {
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
            const size = it.size || it.baseSize || 60;
            const anchor = it.align === 'center' ? 'middle' : it.align === 'right' ? 'end' : 'start';
            inner += `<text x="${it.x}" y="${it.y}" fill="#fff" font-family="${FONT_FAMILY}" font-size="${size}" text-anchor="${anchor}">${esc(val)}</text>`;
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
