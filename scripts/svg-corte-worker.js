/**
 * svg-corte-worker.js — Diseño automático de lámparas infinito para corte láser.
 *
 * SOLO corre LOCAL en la compu de diseño (necesita CorelDRAW; Render nunca ejecuta scripts/).
 * Cada corrida (Task Scheduler cada 15 min):
 *   1. Busca pedidos 'Fabricar' de "Lámpara de corazones" que ya tienen mockup aprobado
 *      (mockup_previews.previews[]), sin nada "especial" (logo/foto → diseño manual),
 *      sin diseñar (sin disenoListoAt) y sin SVG previo (sin svgCorteAt).
 *   2. Toma nombres/fecha del ÚLTIMO preview (lo que el cliente vio y aprobó).
 *   3. Los empareja de 2 en 2 (más antiguos primero). Un pedido suelto espera pareja;
 *      si lleva más de SINGLE_AFTER_HOURS pagado, sale solo en hoja de 1.
 *   4. Genera la hoja con CorelDRAW (infinito.vbs), la sube a Drive (carpeta "SVG Corte")
 *      y cambia cada pedido a estatus "Diseñado por IA" (+ svgCorteUrl, svgCorteAt...).
 *
 * Uso:  node scripts/svg-corte-worker.js [--dry] [--force] [--max N]
 *   --dry    solo muestra qué haría, no toca nada
 *   --force  ignora el kill-switch autoGenerate
 *   --max N  máximo de hojas en esta corrida (default 2)
 * Kill-switch: Firestore svg_corte_config/settings { autoGenerate: false }.
 * Log: Documents\SVG-Corte\worker.log
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const { db, admin } = require('../server/config');
const { recomputeForContact } = require('../server/design/designPending');

const SKILL_DIR = path.join(__dirname, '..', '.claude', 'skills', 'svg-corte');
const INFINITO_VBS = path.join(SKILL_DIR, 'infinito.vbs');
const WEBAPP = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'drive-webapp.json'), 'utf8'));
const OUT_DIR = path.join(os.homedir(), 'Documents', 'SVG-Corte');
const LOG_FILE = path.join(OUT_DIR, 'worker.log');
const LOCK_FILE = path.join(os.tmpdir(), 'svg-corte-worker.lock');

const NEW_STATUS = 'Diseñado por IA';
const SINGLE_AFTER_HOURS = 12;   // pedido impar: horas de espera antes de salir solo
const CLAIM_STALE_MIN = 30;      // reclamo (svgCorteStartedAt) más viejo que esto se considera muerto
// Mismo criterio que el auto-mockup: "algo especial" -> diseño manual.
const SPECIAL_RE = /foto|imagen|graba|logo|escudo|especial|personaje|mascota|dibuj|dise[nñ]|frase|leyenda|adicional|s[ií]mbolo|\bpng\b|\bjpg\b/i;

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const FORCE = argv.includes('--force');
const MAX_SHEETS = (() => {
    const i = argv.indexOf('--max');
    return i >= 0 ? Math.max(1, parseInt(argv[i + 1], 10) || 2) : 2;
})();

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

const ms = v => { if (!v) return 0; if (v.toMillis) return v.toMillis(); const t = Date.parse(v); return isNaN(t) ? 0 : t; };
const datosOf = o => (Array.isArray(o.items) ? o.items : []).map(it => it.datosProducto).filter(Boolean).join('\n') || o.datosProducto || o.producto || '';
const productOf = o => String(o.producto || (o.items && o.items[0] && o.items[0].producto) || '').toLowerCase();
const dhOf = o => 'DH' + (o.consecutiveOrderNumber || o.id);

// Sube un archivo a Drive vía el Apps Script del usuario (misma vía que upload-drive.js).
async function uploadToDrive(filePath) {
    const payload = {
        secret: WEBAPP.secret,
        name: path.basename(filePath),
        mimeType: 'image/svg+xml',
        b64: fs.readFileSync(filePath).toString('base64'),
    };
    const res = await fetch(WEBAPP.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
    });
    const data = JSON.parse(await res.text());
    if (!data.ok) throw new Error('Drive: ' + (data.error || 'respuesta no ok'));
    return data; // { ok, id, name, webViewLink }
}

// Corre infinito.vbs y devuelve { svg, cdr }.
function runCorel(label, fields) {
    const args = ['//nologo', INFINITO_VBS, '/label:' + label];
    for (const f of fields) {
        args.push(f.nombre1, f.nombre2, f.fecha);
    }
    const r = spawnSync('cscript', args, { encoding: 'utf8', timeout: 5 * 60 * 1000, windowsHide: true });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) throw new Error('infinito.vbs fallo (exit ' + r.status + '): ' + out.trim().slice(0, 300));
    const svg = (out.match(/^OK (.+)$/m) || [])[1];
    const cdr = (out.match(/^CDR (.+)$/m) || [])[1];
    if (!svg || !fs.existsSync(svg.trim())) throw new Error('infinito.vbs no reporto SVG. Salida: ' + out.trim().slice(0, 300));
    return { svg: svg.trim(), cdr: (cdr || '').trim() };
}

async function getSettings() {
    try {
        const d = await db.collection('svg_corte_config').doc('settings').get();
        return d.exists ? d.data() : {};
    } catch (_) { return {}; }
}

async function findCandidates() {
    const snap = await db.collection('pedidos').where('estatus', '==', 'Fabricar').limit(800).get();
    const out = [];
    const staleMs = Date.now() - CLAIM_STALE_MIN * 60 * 1000;
    for (const doc of snap.docs) {
        const o = { id: doc.id, ...doc.data() };
        if (o.disenoListoAt || o.svgCorteAt) continue;                       // ya diseñado / ya tiene SVG
        if (ms(o.svgCorteStartedAt) > staleMs) continue;                     // otro proceso lo está trabajando
        if (!/corazon/i.test(productOf(o))) continue;                        // solo lámpara de corazones
        if (SPECIAL_RE.test(datosOf(o))) continue;                           // especial -> manual
        const prev = await db.collection('mockup_previews').doc(String(o.id)).get();
        const previews = prev.exists ? (prev.data().previews || []) : [];
        if (!previews.length) continue;                                      // sin mockup aprobado -> manual
        const f = previews[previews.length - 1].fields || {};
        if (!f.nombre1 || !f.nombre2 || !f.fecha) {                          // datos incompletos -> manual
            log(`  ~ ${dhOf(o)} tiene mockup pero campos incompletos (n1='${f.nombre1 || ''}' n2='${f.nombre2 || ''}' fecha='${f.fecha || ''}') -> manual`);
            continue;
        }
        const paidMs = ms(o.comprobanteValidadoAt) || ms(o.confirmedAt) || ms(o.createdAt);
        out.push({ o, fields: { nombre1: f.nombre1, nombre2: f.nombre2, fecha: f.fecha }, paidMs });
    }
    out.sort((a, b) => a.paidMs - b.paidMs);   // más antiguos primero
    return out;
}

function buildSheets(candidates) {
    const sheets = [];
    let i = 0;
    while (i + 1 < candidates.length) {
        sheets.push([candidates[i], candidates[i + 1]]);
        i += 2;
    }
    if (i < candidates.length) {
        const solo = candidates[i];
        const ageH = (Date.now() - solo.paidMs) / 36e5;
        if (ageH >= SINGLE_AFTER_HOURS) sheets.push([solo]);
        else log(`  ~ ${dhOf(solo.o)} espera pareja (lleva ${ageH.toFixed(1)}h de ${SINGLE_AFTER_HOURS}h)`);
    }
    return sheets;
}

async function claim(entries) {
    for (const e of entries) {
        await db.collection('pedidos').doc(String(e.o.id)).update({ svgCorteStartedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
}
async function unclaim(entries) {
    for (const e of entries) {
        try { await db.collection('pedidos').doc(String(e.o.id)).update({ svgCorteStartedAt: admin.firestore.FieldValue.delete() }); } catch (_) {}
    }
}

async function processSheet(entries) {
    const label = entries.map(e => dhOf(e.o)).join('-');
    log(`> Hoja ${label}: ` + entries.map(e => `${e.fields.nombre1} y ${e.fields.nombre2} (${e.fields.fecha})`).join(' | '));
    if (DRY) return;

    await claim(entries);
    try {
        const { svg, cdr } = runCorel(label, entries.map(e => e.fields));
        const up = await uploadToDrive(svg);
        for (const e of entries) {
            const otros = entries.filter(x => x !== e).map(x => dhOf(x.o));
            await db.collection('pedidos').doc(String(e.o.id)).update({
                estatus: NEW_STATUS,
                svgCorteAt: admin.firestore.FieldValue.serverTimestamp(),
                svgCorteUrl: up.webViewLink,
                svgCorteFileName: up.name,
                svgCorteCdrLocal: cdr,
                svgCorteSheetWith: otros.length ? otros.join(',') : null,
                svgCorteBy: 'svg-worker',
                svgCorteStartedAt: admin.firestore.FieldValue.delete(),
            });
            try { await recomputeForContact(e.o.contactId || e.o.telefono); } catch (_) {}
        }
        log(`  OK ${label} -> ${up.webViewLink}`);
    } catch (e) {
        await unclaim(entries);
        throw e;
    }
}

async function main() {
    // Lock local para no encimarse con una corrida anterior
    try {
        const st = fs.existsSync(LOCK_FILE) ? fs.statSync(LOCK_FILE) : null;
        if (st && Date.now() - st.mtimeMs < 20 * 60 * 1000) { log('Lock activo, salgo.'); return; }
        fs.writeFileSync(LOCK_FILE, String(process.pid));
    } catch (_) {}

    try {
        const cfg = await getSettings();
        if (!FORCE && cfg.autoGenerate === false) { log('autoGenerate=false (kill-switch), salgo.'); return; }

        const candidates = await findCandidates();
        log(`Candidatos listos para diseño IA: ${candidates.length}` + (DRY ? ' (DRY RUN)' : ''));
        const sheets = buildSheets(candidates).slice(0, MAX_SHEETS);
        if (!sheets.length) { log('Nada que generar.'); return; }

        let ok = 0;
        for (const sheet of sheets) {
            try { await processSheet(sheet); ok++; }
            catch (e) { log(`  ERROR en hoja ${sheet.map(x => dhOf(x.o)).join('-')}: ${e.message}`); }
        }
        log(`Corrida terminada: ${ok}/${sheets.length} hoja(s) generadas.`);
    } finally {
        try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
    }
}

main().then(() => process.exit(0)).catch(e => { log('ERROR FATAL: ' + (e.stack || e.message)); process.exit(1); });
