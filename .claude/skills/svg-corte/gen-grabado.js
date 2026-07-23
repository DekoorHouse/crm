/**
 * gen-grabado.js — Convierte una FOTO del cliente en una imagen lista para GRABADO LÁSER RASTER
 * (rellenos blancos, fondo negro, degradado en trama, alto detalle) con Gemini Nano Banana Pro.
 *
 * Cuando el grabado va en el modelo de CORAZONES, pasa `--corazon` y se le manda a la IA la
 * silueta `referencias/corazon-forma.png` para que el grabado salga con forma de corazón.
 *
 * La llave de Gemini vive SOLO en Render, así que esto llama al endpoint del servidor
 * (POST /api/mockups/engrave-submit), que responde YA con la imagen (~30-60 s, sin polling).
 * Corre LOCAL. Guarda el PNG resultante en Documents\SVG-Corte\.
 *
 * Uso:
 *   node .claude/skills/svg-corte/gen-grabado.js --img "<ruta.jpg | http...>" [--corazon]
 *        [--extra "instruccion adicional"] [--out "<ruta.png>"] [--res 1k|2k|4k]
 *        [--aspect 1:1|2:3|3:2]
 *
 * Éxito = última línea `OK <ruta-png>` (+ `URL <galeria>`).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const API = process.env.CRM_API || 'https://crm-rzon.onrender.com';
const HEART_REF = path.join(__dirname, 'referencias', 'corazon-forma.png');
const OUT_DIR = path.join(os.homedir(), 'Documents', 'SVG-Corte');

function arg(name, def = null) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def;
}
const flag = name => process.argv.includes('--' + name);
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

// Sube un archivo local y devuelve su URL pública (el servidor la descarga por URL).
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

async function toPublicUrl(imgArg) {
    if (/^https?:\/\//.test(imgArg)) return imgArg;
    if (!fs.existsSync(imgArg)) throw new Error('No existe la imagen: ' + imgArg);
    return uploadLocal(imgArg);
}

// Genera el grabado. El endpoint es SÍNCRONO: responde ya con la imagen (tarda ~30-60 s).
async function submitEngrave(imageUrl, shapeImageUrl) {
    const r = await (await fetch(`${API}/api/mockups/engrave-submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            imageUrl, shapeImageUrl,
            extraPrompt: (typeof arg('extra') === 'string' ? arg('extra') : ''),
            // 1K y 2K cuestan igual en Nano Banana Pro: 2K por default, más detalle para el grabado.
            resolution: (typeof arg('res') === 'string' ? arg('res') : '2k'),
            // Corazón siempre cuadrado; foto suelta respeta --aspect (default 1:1) para no recortar de más.
            aspectRatio: shapeImageUrl ? '1:1' : (typeof arg('aspect') === 'string' ? arg('aspect') : '1:1'),
        }),
    })).json();
    if (!r.success || !r.image) throw new Error('engrave-submit falló: ' + (r.error || JSON.stringify(r)));
    return r.image;
}

(async () => {
    const img = arg('img');
    if (!img || img === true) { console.error('Falta --img "<ruta o url de la foto>"'); process.exit(1); }
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // 1) URLs públicas: foto (+ silueta de corazón si aplica)
    const imageUrl = await toPublicUrl(img);
    let shapeImageUrl = null;
    if (flag('corazon')) {
        if (!fs.existsSync(HEART_REF)) throw new Error('Falta la silueta: ' + HEART_REF);
        shapeImageUrl = await uploadLocal(HEART_REF);
        console.log('Forma: corazón');
    }

    // 2) Generar el grabado (una sola llamada; el servidor espera a la IA).
    console.log('Generando con Gemini Nano Banana Pro… (30-60 s)');
    const out = await submitEngrave(imageUrl, shapeImageUrl);

    // 3) Descargar el resultado (webp de galería) y guardarlo como PNG
    const src = out.fullUrl || out.thumbUrl;
    const bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
    const outPath = (typeof arg('out') === 'string' ? arg('out') : path.join(OUT_DIR, `grabado-${stamp()}.png`));
    await sharp(bytes).png().toFile(outPath);

    console.log('URL ' + src);
    console.log('OK ' + outPath);
    process.exit(0);
})().catch(e => { console.error('ERROR ' + e.message); process.exit(1); });
