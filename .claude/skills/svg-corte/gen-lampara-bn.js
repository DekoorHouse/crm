/**
 * gen-lampara-bn.js — Convierte el MOCKUP de una lámpara (nube/infantil y similares) en una imagen
 * BLANCO Y NEGRO lista para PowerClip en Corel: todo lo iluminado/encendido del acrílico -> negro,
 * el resto fondo blanco, sin el círculo/contorno de corte. Es el paso 1 del modo "nube".
 *
 * La llave de Gemini vive SOLO en Render, así que llama al endpoint del servidor
 * (POST /api/mockups/engrave-submit con promptOverride). Corre LOCAL; guarda el PNG en
 * Documents\SVG-Corte\. OJO: el promptOverride del endpoint debe estar DESPLEGADO en Render.
 *
 * Uso: node .claude/skills/svg-corte/gen-lampara-bn.js --img "<url|ruta>" [--out "<ruta.png>"]
 *      [--aspect 1:1|3:4|2:3] [--extra "instruccion adicional al prompt"]
 * Éxito = última línea `OK <ruta-png>` (+ `DEPLOY_OK` si el server usó nuestro prompt).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const API = process.env.CRM_API || 'https://crm-rzon.onrender.com';
const OUT_DIR = path.join(os.homedir(), 'Documents', 'SVG-Corte');

// Prompt para convertir el MOCKUP de lámpara a grabado raster: BLANCO sobre NEGRO (Chris 2026-07-25;
// reforzado para forzar el aislamiento — Gemini tendía a conservar la mesa/base/control/círculo).
const PROMPT = [
    'Extrae ÚNICAMENTE el diseño grabado en el acrílico de esta lámpara (el nombre y TODOS sus adornos: la nube con su moño y sus gotas colgantes, la corona, la luna, las estrellas, los corazones y los puntos) y represéntalo con FONDO NEGRO PURO (#000000) y los RELLENOS/trazos en BLANCO PURO (#FFFFFF).',
    'Todo lo que en la foto está iluminado/encendido/brillando dentro del acrílico debe quedar en BLANCO; el fondo y todo lo demás en NEGRO.',
    'ELIMINA por completo todo lo demás de la foto: la base/soporte de la lámpara, el control remoto, la mesa, la pared, las plantas, los libros, las sombras y CUALQUIER otro objeto o fondo.',
    'NO dibujes el contorno ni la línea del círculo del acrílico.',
    'Conserva la composición y TODOS los elementos del acrílico, incluida la nube completa con su carita (ojos cerrados, boca, mejillas), su moño y las gotas colgantes (corazones y estrellas que cuelgan de hilos de puntos).',
    'Entrega SOLO el diseño en BLANCO sobre NEGRO, centrado, completo y limpio, fiel a las formas del acrílico, sin color, sin grises ni degradados (listo para grabado láser raster).',
].join('\n');

function arg(name, def = null) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def;
}
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

async function uploadLocal(file) {
    const buf = fs.readFileSync(file);
    const ext = (path.extname(file) || '.png').slice(1).toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), path.basename(file));
    const r = await (await fetch(`${API}/api/mockups/upload-image`, { method: 'POST', body: fd })).json();
    if (!r.success || !r.url) throw new Error('upload-image falló: ' + JSON.stringify(r));
    return r.url;
}

(async () => {
    const img = arg('img');
    if (!img || img === true) { console.error('Falta --img "<url o ruta>"'); process.exit(1); }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const imageUrl = /^https?:\/\//.test(img) ? img : await uploadLocal(img);
    const aspectRatio = (typeof arg('aspect') === 'string' ? arg('aspect') : '1:1');
    const extra = (typeof arg('extra') === 'string' ? arg('extra') : '');
    const promptOverride = extra ? PROMPT + '\n' + extra : PROMPT;

    console.log('Generando B/N con Gemini… (30-60 s)  aspect=' + aspectRatio);
    const r = await (await fetch(`${API}/api/mockups/engrave-submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, promptOverride, resolution: '2k', aspectRatio }),
    })).json();
    if (!r.success || !r.image) throw new Error('engrave-submit falló: ' + (r.error || JSON.stringify(r)));

    const usedOverride = !/^Convierte la fotograf/i.test(r.prompt || '');   // ¿el server usó nuestro prompt y no el de grabado halftone?
    const src = r.image.fullUrl || r.image.thumbUrl;
    const bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
    const outPath = (typeof arg('out') === 'string' ? arg('out') : path.join(OUT_DIR, `lampara-bn-${stamp()}.png`));
    await sharp(bytes).png().toFile(outPath);
    console.log('URL ' + src);
    console.log('OK ' + outPath);
    console.log(usedOverride ? 'DEPLOY_OK' : 'DEPLOY_PENDIENTE (el server aún usa el prompt de grabado; reintenta en 1-2 min)');
    process.exit(0);
})().catch(e => { console.error('ERROR ' + e.message); process.exit(1); });
