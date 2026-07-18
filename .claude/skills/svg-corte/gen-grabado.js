/**
 * gen-grabado.js — Convierte una FOTO del cliente en una imagen lista para GRABADO LÁSER RASTER
 * (rellenos blancos, fondo negro, degradado en trama, alto detalle) con WaveSpeed (GPT Image 2).
 *
 * Cuando el grabado va en el modelo de CORAZONES, pasa `--corazon` y se le manda a WaveSpeed la
 * silueta `referencias/corazon-forma.png` para que el grabado salga con forma de corazón.
 *
 * La llave de WaveSpeed vive SOLO en Render, así que esto llama al endpoint del servidor
 * (POST /api/mockups/engrave-submit -> jobId; GET /api/mockups/generate-status/:jobId para el
 * resultado). Corre LOCAL. Guarda el PNG resultante en Documents\SVG-Corte\.
 *
 * FALLBACK (regla Chris 2026-07-18): si GPT Image 2 rechaza generar por CONTENIDO SENSIBLE o
 * DERECHOS DE AUTOR, reintenta solo con Seedream 5.0 Pro (bytedance/seedream-v5.0-pro/edit).
 * `--model seedream` fuerza arrancar directo con Seedream (se salta GPT Image 2 y el fallback).
 *
 * Uso:
 *   node .claude/skills/svg-corte/gen-grabado.js --img "<ruta.jpg | http...>" [--corazon]
 *        [--extra "instruccion adicional"] [--out "<ruta.png>"] [--res 1k|2k]
 *        [--aspect 1:1|2:3|3:2] [--model seedream]
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

// Sube un archivo local y devuelve su URL pública (WaveSpeed la descarga por URL).
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

// Nombre bonito del modelo para los logs.
const MODEL_LABEL = m => (m === 'seedream' ? 'Seedream 5 Pro' : 'WaveSpeed GPT Image 2');
// Errores de WaveSpeed que disparan el FALLBACK a Seedream 5 Pro (contenido sensible / derechos de autor).
const FALLBACK_RE = /sensitiv|sensible|copyright|derechos de autor|content policy|flagged|moderation|not allowed|safety/i;

// Envía la tarea de grabado con el modelo indicado y devuelve el jobId.
async function submitEngrave(imageUrl, shapeImageUrl, model) {
    const submit = await (await fetch(`${API}/api/mockups/engrave-submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            imageUrl, shapeImageUrl,
            extraPrompt: (typeof arg('extra') === 'string' ? arg('extra') : ''),
            resolution: (typeof arg('res') === 'string' ? arg('res') : '1k'),
            // Corazón siempre cuadrado; foto suelta respeta --aspect (default 1:1) para no recortar de más.
            aspectRatio: shapeImageUrl ? '1:1' : (typeof arg('aspect') === 'string' ? arg('aspect') : '1:1'),
            model,
        }),
    })).json();
    if (!submit.success || !submit.jobId) throw new Error('engrave-submit falló: ' + JSON.stringify(submit));
    return submit.jobId;
}

// Polla el job hasta terminar (~hasta 6.5 min). TOLERA blips de red (un fetch fallido NO aborta:
// el job sigue vivo en el servidor). Devuelve { image } al completar o { error } si el modelo falló.
async function pollJob(jobId) {
    for (let i = 0; i < 130; i++) {
        await new Promise(r => setTimeout(r, 3000));
        let st;
        try {
            st = await (await fetch(`${API}/api/mockups/generate-status/${jobId}`)).json();
        } catch (_) { process.stdout.write('x'); continue; }  // error de red transitorio: reintentar
        if (st.status === 'failed') return { error: st.error || '?' };
        if (st.status === 'completed' && st.image) return { image: st.image };
        if (i % 5 === 0) process.stdout.write('.');
    }
    return { error: 'Tiempo agotado esperando a WaveSpeed.' };
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

    // 2) Enviar la tarea de grabado. `--model seedream` fuerza el modelo; si no, arranca con GPT Image 2.
    const forced = (typeof arg('model') === 'string') ? arg('model') : null;
    let model = forced || 'gpt-image-2';
    let jobId = await submitEngrave(imageUrl, shapeImageUrl, model);
    console.log(`Job: ${jobId} — generando (${MODEL_LABEL(model)})…`);
    let res = await pollJob(jobId);
    process.stdout.write('\n');

    // 3) FALLBACK: si GPT Image 2 rechaza por contenido sensible / derechos de autor,
    //    reintentar con Seedream 5 Pro (regla Chris 2026-07-18). Solo si no se forzó modelo.
    if (res.error && !forced && model !== 'seedream' && FALLBACK_RE.test(res.error)) {
        console.log(`${MODEL_LABEL(model)} rechazó: "${res.error}". Reintentando con Seedream 5 Pro…`);
        model = 'seedream';
        jobId = await submitEngrave(imageUrl, shapeImageUrl, model);
        console.log(`Job: ${jobId} — generando (${MODEL_LABEL(model)})…`);
        res = await pollJob(jobId);
        process.stdout.write('\n');
    }
    if (res.error) throw new Error(`${MODEL_LABEL(model)} falló: ${res.error}`);
    const out = res.image;

    // 4) Descargar el resultado (webp de galería) y guardarlo como PNG
    const src = out.fullUrl || out.thumbUrl;
    const bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
    const outPath = (typeof arg('out') === 'string' ? arg('out') : path.join(OUT_DIR, `grabado-${stamp()}.png`));
    await sharp(bytes).png().toFile(outPath);

    console.log('URL ' + src);
    console.log('OK ' + outPath);
    process.exit(0);
})().catch(e => { console.error('ERROR ' + e.message); process.exit(1); });
