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
const { svgAutoEligibility, forcedDesignFields } = require('../server/design/svgAuto');

const SKILL_DIR = path.join(__dirname, '..', '.claude', 'skills', 'svg-corte');
const INFINITO_VBS = path.join(SKILL_DIR, 'infinito.vbs');
const WEBAPP = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'drive-webapp.json'), 'utf8'));
const OUT_DIR = path.join(os.homedir(), 'Documents', 'SVG-Corte');
const LOG_FILE = path.join(OUT_DIR, 'worker.log');
const LOCK_FILE = path.join(os.tmpdir(), 'svg-corte-worker.lock');

const NEW_STATUS = 'Diseñado por IA';
const SINGLE_AFTER_HOURS = 12;   // pedido impar: horas de espera antes de salir solo
const CLAIM_STALE_MIN = 30;      // reclamo (svgCorteStartedAt) más viejo que esto se considera muerto

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

// Nombre de archivo seguro: sin acentos ni caracteres raros (los acentos rompen el pipe de
// stdout de cscript, por eso el worker dicta el nombre con /file en vez de parsear rutas).
function slugAscii(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}
function stampNow() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Corre infinito.vbs con nombre de salida dictado por el worker y devuelve { svg, cdr }.
function runCorel(label, fields) {
    const base = slugAscii([label, 'infinito', ...fields.map(f => `${f.nombre1}-${f.nombre2}`), stampNow()].join('-'));
    const svg = path.join(OUT_DIR, base + '.svg');
    const cdr = path.join(OUT_DIR, base + '.cdr');
    const args = ['//nologo', INFINITO_VBS, '/label:' + label, '/file:' + base, '/close'];
    // Los saltos de línea (nombres a 2 renglones) viajan como token literal \n hacia el .vbs
    const enc = s => String(s).replace(/\n/g, '\\n');
    for (const f of fields) {
        args.push(enc(f.nombre1), enc(f.nombre2), enc(f.fecha));
    }
    const r = spawnSync('cscript', args, { encoding: 'utf8', timeout: 5 * 60 * 1000, windowsHide: true });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) throw new Error('infinito.vbs fallo (exit ' + r.status + '): ' + out.trim().slice(0, 300));
    if (!fs.existsSync(svg)) throw new Error('infinito.vbs termino sin crear ' + svg + '. Salida: ' + out.trim().slice(0, 300));
    return { svg, cdr };
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
        if (o.iaForce) continue;                                             // forzado desde el CRM -> lo maneja processForcedDesigns (con confirmación antes de subir)
        // Con guía de envío (o quitado de Envíos) el pedido ya se fabricó/gestionó: cortarlo
        // sería duplicar producción. Misma regla que Pendientes de Diseño (designPending.js).
        if ((o.guiaEnvio && o.guiaEnvio.guia) || o.ocultoDeEnvios) continue;
        if (ms(o.svgCorteStartedAt) > staleMs) continue;                     // otro proceso lo está trabajando
        const prev = await db.collection('mockup_previews').doc(String(o.id)).get();
        const previews = prev.exists ? (prev.data().previews || []) : [];
        // Elegibilidad de CONTENIDO (corazones + no especial + mockup aprobado + layout verificado +
        // datos completos): fuente de verdad COMPARTIDA con el endpoint /api/design-pending, para que
        // "lo corta la IA" y "está en Pendientes manual" nunca se contradigan (server/design/svgAuto.js).
        const el = svgAutoEligibility(o, previews);
        if (!el.eligible) {
            if (el.reason === 'layout_mismatch') {
                const lay = (previews[previews.length - 1] || {}).layout || {};
                log(`  ~ ${dhOf(o)} layout del mockup NO coincide con los datos (izq=${JSON.stringify(lay.izquierdo)} der=${JSON.stringify(lay.derecho)}) -> revisión manual`);
            } else if (el.reason === 'incomplete_fields') {
                log(`  ~ ${dhOf(o)} tiene mockup pero campos incompletos -> manual`);
            }
            continue;
        }
        const paidMs = ms(o.comprobanteValidadoAt) || ms(o.confirmedAt) || ms(o.createdAt);
        out.push({ o, fields: el.fields, paidMs, layoutVerificado: el.layoutVerificado });
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
    const vis = e => (e.layoutVerificado ? '' : ' [sin visión]');
    log(`> Hoja ${label}: ` + entries.map(e => `${e.fields.nombre1.replace(/\n/g, '⏎')} y ${e.fields.nombre2.replace(/\n/g, '⏎')} (${e.fields.fecha.replace(/\n/g, '⏎')})${vis(e)}`).join(' | '));
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

// Sube a Drive los diseños ESPECIALES que el cliente ya aprobó (designApproval.status='approved').
// El SVG fue generado a mano y quedó "staged" (ruta local) al mandar la captura de aprobación.
// Al subir: pedido -> "Diseñado por IA" + svgCorteUrl, y designApproval.status='uploaded'.
async function processApprovedDesigns() {
    let snap;
    try {
        snap = await db.collection('pedidos').where('designApproval.status', '==', 'approved').limit(50).get();
    } catch (e) { log('No pude consultar aprobados: ' + e.message); return; }
    if (snap.empty) return;
    log(`Diseños aprobados por el cliente pendientes de subir: ${snap.size}` + (DRY ? ' (DRY RUN)' : ''));
    for (const doc of snap.docs) {
        const o = { id: doc.id, ...doc.data() };
        const da = o.designApproval || {};
        const dh = dhOf(o);
        // Guard: no resucitar un pedido cancelado / con guía / oculto de Envíos (misma regla que
        // findCandidates). Lo marca 'needs_review' para que deje de aparecer en la query.
        const estatus = String(o.estatus || '').toLowerCase();
        if ((o.guiaEnvio && o.guiaEnvio.guia) || o.ocultoDeEnvios || /cancel/.test(estatus)) {
            log(`  ~ ${dh} aprobado pero el pedido está "${o.estatus}"/enviado -> needs_review (no subo)`);
            if (!DRY) await doc.ref.update({ 'designApproval.status': 'needs_review' });
            continue;
        }
        if (o.svgCorteAt) {   // ya subido antes; solo cierra el estado
            if (!DRY) await doc.ref.update({ 'designApproval.status': 'uploaded' });
            continue;
        }
        const svg = da.stagedSvgLocalPath;
        if (!svg || !fs.existsSync(svg)) {
            log(`  ~ ${dh} aprobado pero sin SVG staged (${svg || 'null'}) -> revisar a mano`);
            continue;
        }
        log(`> ${dh} aprobado por el cliente -> subiendo ${path.basename(svg)}`);
        if (DRY) continue;
        try {
            const up = await uploadToDrive(svg);
            await doc.ref.update({
                estatus: NEW_STATUS,
                svgCorteAt: admin.firestore.FieldValue.serverTimestamp(),
                svgCorteUrl: up.webViewLink,
                svgCorteFileName: up.name,
                svgCorteBy: 'design-approval',
                'designApproval.status': 'uploaded',
                'designApproval.uploadedAt': admin.firestore.FieldValue.serverTimestamp(),
            });
            try { await recomputeForContact(o.contactId || o.telefono); } catch (_) {}
            log(`  OK ${dh} -> ${up.webViewLink}`);
        } catch (e) {
            log(`  ERROR subiendo ${dh}: ${e.message}`);
        }
    }
}

// Mensaje humano para el motivo por el que un pedido forzado no se pudo diseñar (se muestra en el CRM).
function forcedErrorMsg(reason) {
    return {
        not_corazon: 'No es lámpara de corazones (el skill solo genera corazones).',
        special: 'Pedido especial: requiere diseño manual.',
        incomplete_fields: 'Faltan nombres o fecha en los datos del pedido.',
    }[reason] || ('No elegible: ' + reason);
}

// Diseños FORZADOS desde el CRM (botón "Diseñar con IA"). Corren SIEMPRE (aunque el kill-switch de
// auto-generación esté apagado): son una orden explícita del usuario. Dos pasos por corrida:
//   1) status='approved'  -> el usuario ya confirmó en el CRM: sube el SVG staged a Drive y marca
//                            el pedido "Diseñado por IA" (igual que el auto, pero con confirmación previa).
//   2) status='queued'    -> genera el SVG con Corel y lo deja STAGED (NO sube a Drive); guarda la ruta
//                            local + la imagen de preview (el mockup aprobado) para que el CRM lo muestre.
async function processForcedDesigns() {
    // --- Paso 1: subir lo ya aprobado por el usuario ---
    let appr = { docs: [], empty: true };
    try { appr = await db.collection('pedidos').where('iaForce.status', '==', 'approved').limit(50).get(); }
    catch (e) { log('No pude consultar forzados aprobados: ' + e.message); }
    if (!appr.empty) log(`Forzados aprobados pendientes de subir: ${appr.size}` + (DRY ? ' (DRY RUN)' : ''));
    for (const doc of appr.docs) {
        const o = { id: doc.id, ...doc.data() };
        const f = o.iaForce || {};
        const dh = dhOf(o);
        const estatus = String(o.estatus || '').toLowerCase();
        if ((o.guiaEnvio && o.guiaEnvio.guia) || o.ocultoDeEnvios || /cancel/.test(estatus)) {
            log(`  ~ ${dh} forzado aprobado pero enviado/cancelado -> no subo`);
            if (!DRY) await doc.ref.update({ iaForce: admin.firestore.FieldValue.delete() });
            continue;
        }
        if (o.svgCorteAt) { if (!DRY) await doc.ref.update({ iaForce: admin.firestore.FieldValue.delete() }); continue; }
        const svg = f.svgLocalPath;
        if (!svg || !fs.existsSync(svg)) {
            log(`  ~ ${dh} forzado aprobado pero sin SVG staged (${svg || 'null'}) -> reencolo`);
            if (!DRY) await doc.ref.update({ 'iaForce.status': 'queued', 'iaForce.svgLocalPath': admin.firestore.FieldValue.delete() });
            continue;
        }
        log(`> ${dh} forzado aprobado -> subiendo ${path.basename(svg)}`);
        if (DRY) continue;
        try {
            const up = await uploadToDrive(svg);
            await doc.ref.update({
                estatus: NEW_STATUS,
                svgCorteAt: admin.firestore.FieldValue.serverTimestamp(),
                svgCorteUrl: up.webViewLink,
                svgCorteFileName: up.name,
                svgCorteCdrLocal: f.cdrLocalPath || null,
                svgCorteBy: 'ia-force',
                iaForce: admin.firestore.FieldValue.delete(),
            });
            try { await recomputeForContact(o.contactId || o.telefono); } catch (_) {}
            log(`  OK ${dh} -> ${up.webViewLink}`);
        } catch (e) { log(`  ERROR subiendo forzado ${dh}: ${e.message}`); }
    }

    // --- Paso 2: generar (stage) los encolados ---
    let q = { docs: [], empty: true };
    try { q = await db.collection('pedidos').where('iaForce.status', '==', 'queued').limit(20).get(); }
    catch (e) { log('No pude consultar forzados en cola: ' + e.message); return; }
    if (q.empty) return;
    log(`Forzados en cola para diseño IA: ${q.size}` + (DRY ? ' (DRY RUN)' : ''));
    for (const doc of q.docs) {
        const o = { id: doc.id, ...doc.data() };
        const dh = dhOf(o);
        const estatus = String(o.estatus || '').toLowerCase();
        if ((o.guiaEnvio && o.guiaEnvio.guia) || o.ocultoDeEnvios || /cancel/.test(estatus)) {
            log(`  ~ ${dh} forzado pero enviado/cancelado -> error`);
            if (!DRY) await doc.ref.update({ 'iaForce.status': 'error', 'iaForce.error': 'El pedido ya se envió o está cancelado.' });
            continue;
        }
        if (o.svgCorteAt) { if (!DRY) await doc.ref.update({ iaForce: admin.firestore.FieldValue.delete() }); continue; }
        // Campos (nombres/fecha) + imagen de preview: del mockup aprobado si hay; si no, del texto de datos.
        const prev = await db.collection('mockup_previews').doc(String(o.id)).get();
        const previews = prev.exists ? (prev.data().previews || []) : [];
        const ff = forcedDesignFields(o, previews);
        if (!ff.ok) {
            log(`  ~ ${dh} forzado no elegible (${ff.reason})`);
            if (!DRY) await doc.ref.update({ 'iaForce.status': 'error', 'iaForce.error': forcedErrorMsg(ff.reason) });
            continue;
        }
        const nl = s => String(s).replace(/\n/g, '⏎');
        log(`> ${dh} forzado -> generando ${nl(ff.fields.nombre1)} y ${nl(ff.fields.nombre2)} (${nl(ff.fields.fecha) || 'sin fecha'})`);
        if (DRY) continue;
        try {
            const { svg, cdr } = runCorel(dh, [ff.fields]);
            await doc.ref.update({
                'iaForce.status': 'staged',
                'iaForce.stagedAt': admin.firestore.FieldValue.serverTimestamp(),
                'iaForce.svgLocalPath': svg,
                'iaForce.cdrLocalPath': cdr,
                'iaForce.svgName': path.basename(svg),
                'iaForce.lines': ff.fields,
                'iaForce.previewUrl': ff.previewUrl || null,
                'iaForce.error': admin.firestore.FieldValue.delete(),
            });
            log(`  STAGED ${dh} -> ${path.basename(svg)} (espera confirmación en el CRM)`);
        } catch (e) {
            log(`  ERROR generando forzado ${dh}: ${e.message}`);
            try { await doc.ref.update({ 'iaForce.status': 'error', 'iaForce.error': ('No se pudo generar: ' + e.message).slice(0, 300) }); } catch (_) {}
        }
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

        // Subir a Drive los diseños especiales que el cliente ya aprobó — SIEMPRE, aunque el
        // auto-corte esté apagado (son kill-switches independientes: apagar la generación de
        // hojas no debe dejar sin subir un diseño que el cliente ya aprobó).
        await processApprovedDesigns();

        // Diseños FORZADOS desde el CRM (botón "Diseñar con IA") — también independientes del kill-switch:
        // el usuario pidió explícitamente diseñar ese pedido (con confirmación antes de subir a Drive).
        await processForcedDesigns();

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
