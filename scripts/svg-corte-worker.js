/**
 * svg-corte-worker.js — Diseño automático de lámparas infinito para corte láser.
 *
 * SOLO corre LOCAL en la compu de diseño (necesita CorelDRAW; Render nunca ejecuta scripts/).
 * Cada corrida (Task Scheduler cada 15 min):
 *   1. Busca pedidos 'Fabricar' de "Lámpara de corazones" que ya tienen mockup aprobado
 *      (mockup_previews.previews[]), sin nada "especial" (logo/foto → diseño manual),
 *      sin diseñar (sin disenoListoAt) y sin SVG previo (sin svgCorteAt). También entran los
 *      'Corregir' con motivo VIDEO (el cliente pidió video de una lámpara que nunca se cortó:
 *      lo que vio fue el mockup) — esos conservan su estatus 'Corregir'.
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
 * Kill-switches: Firestore svg_corte_config/settings { autoGenerate: false } (todo el auto-corte),
 *                { videoAutoCut: false } (solo los 'Corregir' que pidieron video).
 * Log: Documents\SVG-Corte\worker.log
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const { db, admin } = require('../server/config');
const { recomputeForContact } = require('../server/design/designPending');
const { svgAutoEligibility, forcedDesignFields, isVideoCorregir,
        autoBlocked, ESTATUS_TERMINAL, AUTO_DESDE_MS,
        personajeEligibility, PLANTILLAS_PERSONAJE, quejaDeDatosAbierta } = require('../server/design/svgAuto');
const { uploadPublicImage } = require('../server/mockups/mockupsService');

const SKILL_DIR = path.join(__dirname, '..', '.claude', 'skills', 'svg-corte');
const INFINITO_VBS = path.join(SKILL_DIR, 'infinito.vbs');
const HOJA_PERSONAJE_JS = path.join(SKILL_DIR, 'hoja-personaje.js');
const CLIENT_PREVIEW_VBS = path.join(SKILL_DIR, 'client-preview.vbs');
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

// Genera un PNG AL DERECHO (legible) del corte desde el .cdr guardado (que infinito.vbs deja en
// orientacion natural) con client-preview.vbs, y lo sube a Storage como imagen publica. Devuelve la
// URL (o null si algo falla — el corte NO depende de esto). Es "el diseno que hizo la skill" que el
// CRM muestra en el modal "Revisar" para comparar contra el mockup que aprobo el cliente.
async function makeCortePreview(cdr, label) {
    try {
        if (!cdr || !fs.existsSync(cdr)) return null;
        const png = path.join(OUT_DIR, slugAscii(String(label) + '-corte-' + stampNow()) + '.png');
        const r = spawnSync('cscript', ['//nologo', CLIENT_PREVIEW_VBS, cdr, png], { encoding: 'utf8', timeout: 3 * 60 * 1000, windowsHide: true });
        if (r.status !== 0 || !fs.existsSync(png)) {
            log('  ~ no se pudo generar el PNG de corte: ' + ((r.stdout || '') + (r.stderr || '')).trim().slice(0, 200));
            return null;
        }
        const { url } = await uploadPublicImage(fs.readFileSync(png), 'corte-preview');
        try { fs.unlinkSync(png); } catch (_) {}
        return url;
    } catch (e) {
        log('  ~ makeCortePreview fallo: ' + e.message);
        return null;
    }
}

async function getSettings() {
    try {
        const d = await db.collection('svg_corte_config').doc('settings').get();
        return d.exists ? d.data() : {};
    } catch (_) { return {}; }
}

// Cola del corte automático. Dos orígenes:
//   - 'Fabricar'  -> pagó y hay que producir (caso normal).
//   - 'Corregir' con motivo VIDEO -> el cliente pidió un video de su lámpara y esta NUNCA se cortó:
//     lo que vio fue el MOCKUP, la pieza todavía no existe (Chris, 2026-07-23). El mockup aprobado
//     sigue siendo la fuente de verdad, así que se corta igual; el pedido se queda en 'Corregir'
//     (el pendiente del video sigue vivo). Las correcciones de 'datos' NO entran: ahí el dato del
//     mockup está mal y lo revisa una persona. Kill-switch propio: settings.videoAutoCut = false.
async function findCandidates(cfg) {
    const videoOn = (cfg || {}).videoAutoCut !== false;
    // 3er origen: TODO pedido con PAGO VALIDADO reciente, sin importar cómo se llame su estatus.
    // Se consulta por comprobanteValidadoAt desc (no por estatus) para NO barrer los ~6700 pedidos
    // viejos: la fecha fija AUTO_DESDE_MS los deja fuera. Ya no se filtra por 'Pagado' (2026-08-05):
    // al validar el pago el pedido puede quedarse en 'Foto enviada' y así el worker pasó ~21 h
    // diciendo "Nada que generar" con 7 pedidos listos. El estatus solo descarta los terminales.
    const [snapFab, snapCor, snapPag] = await Promise.all([
        db.collection('pedidos').where('estatus', '==', 'Fabricar').limit(800).get(),
        videoOn ? db.collection('pedidos').where('estatus', '==', 'Corregir').limit(300).get()
                : Promise.resolve({ docs: [] }),
        db.collection('pedidos').orderBy('comprobanteValidadoAt', 'desc').limit(400).get(),
    ]);
    const vistos = new Set();
    const queue = [];
    for (const doc of snapFab.docs) { vistos.add(doc.id); queue.push({ doc, video: false }); }
    for (const doc of snapCor.docs) { if (!vistos.has(doc.id)) { vistos.add(doc.id); queue.push({ doc, video: true }); } }
    for (const doc of snapPag.docs) {
        if (vistos.has(doc.id)) continue;
        // Sin filtro de estatus: lo que califica es el pago validado. Los terminales se descartan abajo.
        vistos.add(doc.id); queue.push({ doc, video: false });
    }
    const out = [];
    const staleMs = Date.now() - CLAIM_STALE_MIN * 60 * 1000;
    for (const { doc, video } of queue) {
        const o = { id: doc.id, ...doc.data() };
        if (video && !isVideoCorregir(o)) continue;                          // Corregir por 'datos' -> manual
        if (o.iaForce) continue;                                             // forzado desde el CRM -> lo maneja processForcedDesigns (con confirmación antes de subir)
        if (video) {
            // VIDEO: el pendiente es CORTAR la pieza para poder grabar el video. Solo lo frena que YA esté
            // cortado/subido a Drive (svgCorteAt) o gestionado (ocultoDeEnvios). Un ✓ Diseñado
            // (disenoListoAt) o el tablero 'Terminado' NO cuentan: si nunca se subió a Drive no hay pieza
            // que grabar (DH13714 estaba marcado ✓ Diseñado SIN corte real -> se saltaba). Chris, 2026-08-06.
            if (o.svgCorteAt || o.ocultoDeEnvios) continue;
        } else {
            // Candados compartidos con el CRM (svgAuto.autoBlocked): ya diseñado (svgCorteAt / disenoListoAt /
            // tablero 'Terminado'), quitado de Envíos, o 2º producto. La GUÍA ya NO bloquea (se saca por
            // adelantado, antes de cortar); ver svgAuto.autoBlocked + incidente 2026-07-30.
            if (autoBlocked(o)) continue;
            const est = String(o.estatus || '').trim().toLowerCase();
            if (ESTATUS_TERMINAL.has(est)) continue;                         // cancelado/entregado/ya diseñado
            // Manda el PAGO VALIDADO, no el nombre del estatus. Sin pago solo pasa 'Fabricar'.
            if (est !== 'fabricar' && ms(o.comprobanteValidadoAt) < AUTO_DESDE_MS) continue;
        }
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
        out.push({ o, fields: el.fields, paidMs, layoutVerificado: el.layoutVerificado, video });
    }
    // Los que piden VIDEO van PRIMERO (Chris, 2026-08-01): el cliente está esperando el video de una
    // lámpara que todavía no existe, así que es lo más urgente de la cola. Entre iguales, más antiguos
    // primero. Ir al frente también los hace emparejar antes.
    out.sort((a, b) => (b.video ? 1 : 0) - (a.video ? 1 : 0) || a.paidMs - b.paidMs);
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
        // Un pedido de VIDEO nunca espera pareja: sale solo en media hoja de inmediato. Media hoja de
        // acrílico cuesta mucho menos que dejar a un cliente esperando hasta 12 h su video (Chris,
        // 2026-08-01). El resto sí espera pareja hasta SINGLE_AFTER_HOURS para no desperdiciar material.
        if (solo.video) {
            log(`  ! ${dhOf(solo.o)} pide VIDEO y no tiene pareja -> sale SOLO ya (sin esperar ${SINGLE_AFTER_HOURS}h)`);
            sheets.push([solo]);
        } else if (ageH >= SINGLE_AFTER_HOURS) {
            sheets.push([solo]);
        } else {
            log(`  ~ ${dhOf(solo.o)} espera pareja (lleva ${ageH.toFixed(1)}h de ${SINGLE_AFTER_HOURS}h)`);
        }
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
    const vis = e => (e.layoutVerificado ? '' : ' [sin visión]') + (e.video ? ' [pide video]' : '');
    log(`> Hoja ${label}: ` + entries.map(e => `${e.fields.nombre1.replace(/\n/g, '⏎')} y ${e.fields.nombre2.replace(/\n/g, '⏎')} (${e.fields.fecha.replace(/\n/g, '⏎')})${vis(e)}`).join(' | '));
    if (DRY) return;

    await claim(entries);
    try {
        const { svg, cdr } = runCorel(label, entries.map(e => e.fields));
        const up = await uploadToDrive(svg);
        for (const e of entries) {
            const otros = entries.filter(x => x !== e).map(x => dhOf(x.o));
            const upd = {
                svgCorteAt: admin.firestore.FieldValue.serverTimestamp(),
                svgCorteUrl: up.webViewLink,
                svgCorteFileName: up.name,
                svgCorteCdrLocal: cdr,
                svgCorteSheetWith: otros.length ? otros.join(',') : null,
                svgCorteBy: e.video ? 'svg-worker-video' : 'svg-worker',
                svgCorteStartedAt: admin.firestore.FieldValue.delete(),
            };
            // Los pedidos que pidieron VIDEO se quedan en 'Corregir': su pendiente no era el diseño
            // sino el video, y sigue vivo hasta que el equipo lo grabe y lo mande. En la lista se ven
            // con la insignia "Video" + el link "Diseñado por IA" del SVG.
            if (!e.video) upd.estatus = NEW_STATUS;
            await db.collection('pedidos').doc(String(e.o.id)).update(upd);
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
        // Guard: no resucitar un pedido cancelado o quitado de Envíos (misma regla que findCandidates).
        // La GUÍA ya NO descalifica (Chris, 2026-07-31): se saca por adelantado, antes de producir, así que
        // no significa "ya se envió"; el candado real de "ya hecho" es svgCorteAt (abajo). Lo marca
        // 'needs_review' para que deje de aparecer en la query.
        const estatus = String(o.estatus || '').toLowerCase();
        if (o.ocultoDeEnvios || /cancel/.test(estatus)) {
            log(`  ~ ${dh} aprobado pero el pedido está "${o.estatus}"/quitado de Envíos -> needs_review (no subo)`);
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
        special: 'Lleva una imagen/foto o texto extra para grabar: requiere diseño manual.',
        incomplete_fields: 'Faltan nombres o fecha en los datos del pedido.',
    }[reason] || ('No elegible: ' + reason);
}

// Diseños FORZADOS desde el CRM (botón "Diseñar con IA"). Corren SIEMPRE (aunque el kill-switch de
// auto-generación esté apagado): son una orden explícita del usuario. Dos pasos por corrida:
//   1) status='approved'  -> LEGADO: quedan de antes del 2026-07-31, cuando el corte esperaba que el
//                            usuario apretara "Subir a Drive". Se sigue atendiendo para no dejar
//                            colgado nada que ya estuviera staged/aprobado.
//   2) status='queued'    -> genera el SVG con Corel y lo SUBE A DRIVE en la misma corrida (Chris,
//                            2026-07-31: apretar "Diseñar con IA" YA es la decisión, no se pide
//                            confirmación aparte). El PNG legible del corte queda en
//                            svgCortePreviewUrl para poder revisarlo después desde el CRM.
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
        // La GUÍA ya NO frena la subida de un forzado aprobado (Chris, 2026-07-31): es anticipada. El
        // operador YA confirmó este corte en el CRM -> debe subir a Drive aunque tenga guía. Solo lo frenan
        // quitado de Envíos o cancelado (svgCorteAt = ya subido, se maneja abajo).
        if (o.ocultoDeEnvios || /cancel/.test(estatus)) {
            log(`  ~ ${dh} forzado aprobado pero quitado de Envíos/cancelado -> no subo`);
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
                svgCortePreviewUrl: f.cortePreviewUrl || null,   // PNG legible del corte, para verlo luego en el CRM
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
        // La GUÍA ya NO descalifica un forzado (Chris, 2026-07-31): se saca por adelantado (mockup->pago->
        // formulario->guía), ANTES de cortar, así que "tiene guía" NO significa "ya se envió". Sin esto,
        // "Diseñar con IA" fallaba con "ya se envió" en justo los pedidos que hay que diseñar (DH14098/14064).
        // Es una acción MANUAL y explícita del operador; solo lo frenan las señales duras: quitado de Envíos
        // o cancelado (svgCorteAt se maneja abajo: si ya está cortado, se descarta el forzado en silencio).
        if (o.ocultoDeEnvios || /cancel/.test(estatus)) {
            log(`  ~ ${dh} forzado pero quitado de Envíos/cancelado -> error`);
            if (!DRY) await doc.ref.update({ 'iaForce.status': 'error', 'iaForce.error': 'El pedido se quitó de Envíos o está cancelado.' });
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
        // Correccion manual desde el CRM (boton "Corregir"): si el operador edito los textos/renglones,
        // esos MANDAN sobre lo que leyo la vision (el corte debe quedar como el operador lo aprobo). El
        // '\n' de un renglon partido viaja literal en el string del override.
        const ov = (o.iaForce || {}).overrideLines || null;
        const fields = ov ? {
            nombre1: String(ov.nombre1 != null ? ov.nombre1 : ff.fields.nombre1),
            nombre2: String(ov.nombre2 != null ? ov.nombre2 : ff.fields.nombre2),
            fecha: String(ov.fecha != null ? ov.fecha : ff.fields.fecha),
        } : ff.fields;
        const nl = s => String(s).replace(/\n/g, '⏎');
        log(`> ${dh} forzado -> generando ${nl(fields.nombre1)} y ${nl(fields.nombre2)} (${nl(fields.fecha) || 'sin fecha'})${ov ? ' [corregido]' : ''}`);
        if (DRY) continue;
        try {
            const { svg, cdr } = runCorel(dh, [fields]);
            const cortePreviewUrl = await makeCortePreview(cdr, dh);   // PNG legible del corte -> Storage
            // SUBIDA DIRECTA (Chris, 2026-07-31): antes esto quedaba 'staged' esperando que el operador
            // apretara "Subir a Drive" en el CRM. Ya no: apretar "Diseñar con IA" es la decisión, así que
            // el corte se sube en la MISMA corrida. El PNG del corte queda en svgCortePreviewUrl para
            // poder revisarlo después desde el CRM.
            const up = await uploadToDrive(svg);
            await doc.ref.update({
                estatus: NEW_STATUS,
                svgCorteAt: admin.firestore.FieldValue.serverTimestamp(),
                svgCorteUrl: up.webViewLink,
                svgCorteFileName: up.name,
                svgCorteCdrLocal: cdr,
                svgCortePreviewUrl: cortePreviewUrl || null,
                svgCorteBy: 'ia-force',
                iaForce: admin.firestore.FieldValue.delete(),
            });
            try { await recomputeForContact(o.contactId || o.telefono); } catch (_) {}
            log(`  OK ${dh} -> ${up.webViewLink}${cortePreviewUrl ? ' (+preview)' : ''}`);
        } catch (e) {
            log(`  ERROR generando forzado ${dh}: ${e.message}`);
            // Cubre generar Y subir: si falla cualquiera de los dos el pedido queda en 'error' con el
            // motivo y el botón del CRM se convierte en "Reintentar IA".
            try { await doc.ref.update({ 'iaForce.status': 'error', 'iaForce.error': ('No se pudo diseñar/subir: ' + e.message).slice(0, 300) }); } catch (_) {}
        }
    }
}

// =====================================================================================
// LÁMPARAS DE PERSONAJE (Spiderman / T-Rex) — Modo 5 de la skill
// =====================================================================================
// Diferencias contra el corte de corazones, todas por la forma del producto:
//   - La unidad NO es el pedido sino la LÁMPARA: un pedido puede traer varias, incluso de
//     personajes distintos ("Nombre: X | Personaje: Y" por item).
//   - NUNCA se mezclan modelos en una hoja (regla de Chris): se agrupa por plantilla.
//   - Se corta con hoja-personaje.js, NO con el .vbs pelón: ese driver mide el render y encoge el
//     nombre hasta que no toca la figura azul ni el corte rojo. El .vbs solo no lo garantiza.
//   - Solo entran pedidos donde TODAS sus lámparas son cortables. Si una lleva foto grabada o un
//     personaje sin plantilla, el pedido entero se queda en manual: así nunca queda a medias, ni hay
//     que inventar un estado intermedio de "medio diseñado".

function runCorelPersonaje(label, tpl, nombres) {
    const base = slugAscii([label, tpl, ...nombres.map(n => n.replace(/\n/g, '-')), stampNow()].join('-'));
    const svg = path.join(OUT_DIR, base + '.svg');
    const cdr = path.join(OUT_DIR, base + '.cdr');
    const enc = s => String(s).replace(/\n/g, '\\n');   // los renglones viajan como token literal \n
    const args = [HOJA_PERSONAJE_JS, '--tpl', tpl, '--file', base, '--label', label, '--close',
        ...nombres.map(enc)];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15 * 60 * 1000, windowsHide: true });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    if (r.status !== 0) throw new Error('hoja-personaje.js fallo (exit ' + r.status + '): ' + out.slice(-300));
    if (!fs.existsSync(svg)) throw new Error('hoja-personaje.js termino sin crear ' + svg + '. Salida: ' + out.slice(-300));
    return { svg, cdr, out };
}

// Lámparas de personaje listas para cortar. Devuelve una entrada POR LÁMPARA.
async function findPersonajeLamps() {
    const staleMs = Date.now() - CLAIM_STALE_MIN * 60 * 1000;
    const [snapFab, snapPag] = await Promise.all([
        db.collection('pedidos').where('estatus', '==', 'Fabricar').limit(1000).get(),
        db.collection('pedidos').orderBy('comprobanteValidadoAt', 'desc').limit(400).get(),
    ]);
    const docs = new Map();
    [...snapFab.docs, ...snapPag.docs].forEach(d => docs.set(d.id, d));

    const lamps = [];
    for (const doc of docs.values()) {
        const o = { id: doc.id, ...doc.data() };
        if (o.iaForce) continue;
        if (autoBlocked(o)) continue;                                        // ya diseñado / tablero Terminado / gestionado
        const est = String(o.estatus || '').trim().toLowerCase();
        if (ESTATUS_TERMINAL.has(est)) continue;
        // 'Corregir' por un DATO mal NO se corta: se grabaría justo el nombre que el cliente dijo que
        // estaba mal. Solo pasa el que pidió VIDEO (ahí el dato está bien; falta la pieza para grabarla).
        const video = isVideoCorregir(o);
        if (est === 'corregir' && !video) continue;
        if (quejaDeDatosAbierta(o)) continue;                                // queja de datos sin corregir
        if (!video && est !== 'fabricar' && ms(o.comprobanteValidadoAt) < AUTO_DESDE_MS) continue;
        if (ms(o.svgCorteStartedAt) > staleMs) continue;                     // otro proceso lo trabaja
        const prev = await db.collection('mockup_previews').doc(String(o.id)).get();
        const previews = prev.exists ? (prev.data().previews || []) : [];
        const el = personajeEligibility(o, previews);
        if (!el.eligible) {
            if (el.reason === 'mixto') log(`  ~ ${dhOf(o)} tiene lámparas que la skill no hace (${el.manuales.map(m => m.motivo).join(',')}) -> pedido completo a manual`);
            continue;
        }
        const paidMs = ms(o.comprobanteValidadoAt) || ms(o.confirmedAt) || ms(o.createdAt);
        el.lamparas.forEach((l, i) => lamps.push({ o, video, tpl: l.tpl, nombre: l.nombre, delMockup: l.delMockup, paidMs, i, total: el.lamparas.length }));
    }
    // Más antiguos primero, y las lámparas del MISMO pedido juntas, para que se emparejen entre ellas
    // antes que con las de otro pedido (menos hojas a medias y menos pedidos partidos).
    lamps.sort((a, b) => a.paidMs - b.paidMs || String(a.o.id).localeCompare(String(b.o.id)) || a.i - b.i);
    return lamps;
}

// TODO O NADA POR PEDIDO. Quita las hojas que dejarían un pedido con unas lámparas cortadas y otras no.
// Sin esto, un pedido de 3 lámparas salía con 2 en una hoja (SUBIDA A DRIVE) y la 3ª esperando pareja:
// como no se marcaba nada durable, a los 15 min el worker lo volvía a encontrar entero y subía la MISMA
// hoja otra vez, y otra, hasta que la 3ª cumpliera 12 h. El estatus se puede revertir; un archivo ya
// subido a Drive y una pieza ya cortada, no.
function podarPedidosPartidos(sheets) {
    for (;;) {
        const cubiertas = new Map();
        for (const s of sheets) for (const l of s) cubiertas.set(l.o.id, (cubiertas.get(l.o.id) || 0) + 1);
        const partidos = new Set();
        for (const s of sheets) for (const l of s) if ((cubiertas.get(l.o.id) || 0) < l.total) partidos.add(l.o.id);
        if (!partidos.size) return sheets;
        const antes = sheets.length;
        // Al quitar una hoja pueden quedar partidos OTROS pedidos que compartían hoja: se repite.
        sheets = sheets.filter(s => !s.some(l => partidos.has(l.o.id)));
        for (const id of partidos) log(`  ~ pedido ${id} no cabe completo en esta corrida -> ninguna de sus lámparas se corta todavía`);
        if (sheets.length === antes) return sheets;
    }
}

// Hojas de 2 lámparas, SIN mezclar modelos. Una lámpara suelta espera pareja igual que en corazones.
function buildPersonajeSheets(lamps) {
    const sheets = [];
    for (const tpl of PLANTILLAS_PERSONAJE) {
        const grupo = lamps.filter(l => l.tpl === tpl);
        let i = 0;
        while (i + 1 < grupo.length) { sheets.push([grupo[i], grupo[i + 1]]); i += 2; }
        if (i < grupo.length) {
            const solo = grupo[i];
            const ageH = (Date.now() - solo.paidMs) / 36e5;
            if (ageH >= SINGLE_AFTER_HOURS) sheets.push([solo]);
            else log(`  ~ ${dhOf(solo.o)} (${tpl}: ${solo.nombre.replace(/\n/g, '⏎')}) espera pareja del MISMO modelo (lleva ${ageH.toFixed(1)}h de ${SINGLE_AFTER_HOURS}h)`);
        }
    }
    return sheets;
}

// Agrupa las hojas en BLOQUES que comparten pedidos. Cada bloque se trabaja como una sola operación:
// primero se generan TODAS sus hojas en Corel y solo si todas salen se sube algo a Drive. Sin esto, si
// la 2ª hoja de un pedido fallaba, la 1ª ya estaba subida y el pedido quedaba sin marcar -> a los 15
// min se volvía a cortar y a subir ESA MISMA hoja. Generar es lo que falla (Corel); subir casi nunca.
function bloquesDeHojas(sheets) {
    const bloques = [];
    for (const s of sheets) {
        const ids = new Set(s.map(l => l.o.id));
        const tocan = bloques.filter(b => b.ids.size && [...ids].some(id => b.ids.has(id)));
        if (!tocan.length) { bloques.push({ ids, hojas: [s] }); continue; }
        const [primero, ...resto] = tocan;
        primero.hojas.push(s);
        ids.forEach(id => primero.ids.add(id));
        for (const otro of resto) {
            otro.hojas.forEach(h => primero.hojas.push(h));
            otro.ids.forEach(id => primero.ids.add(id));
            bloques.splice(bloques.indexOf(otro), 1);
        }
    }
    return bloques;
}

async function processPersonajeSheets(sheets) {
    let ok = 0;
    for (const bloque of bloquesDeHojas(sheets)) {
        const pedidos = new Map();
        for (const h of bloque.hojas) for (const l of h) if (!pedidos.has(l.o.id)) pedidos.set(l.o.id, l.o);
        const dhs = [...pedidos.values()].map(dhOf);
        const video = bloque.hojas.flat().some(l => l.video);

        for (const h of bloque.hojas) {
            log(`> Hoja ${h[0].tpl} ${[...new Set(h.map(l => dhOf(l.o)))].join('-')}: `
                + h.map(l => `${l.nombre.replace(/\n/g, '⏎')}${l.delMockup ? '' : ' [sin mockup]'}`).join(' | '));
        }
        if (DRY) { ok += bloque.hojas.length; continue; }

        for (const id of pedidos.keys()) {
            await db.collection('pedidos').doc(String(id)).update({ svgCorteStartedAt: admin.firestore.FieldValue.serverTimestamp() });
        }

        const generadas = [];
        let fallo = null;
        for (const h of bloque.hojas) {
            const label = [...new Set(h.map(l => dhOf(l.o)))].join('-');
            try {
                // Se refresca el claim antes de cada hoja: una hoja puede tardar varios minutos y el
                // claim caduca a los CLAIM_STALE_MIN.
                for (const id of pedidos.keys()) {
                    await db.collection('pedidos').doc(String(id)).update({ svgCorteStartedAt: admin.firestore.FieldValue.serverTimestamp() });
                }
                const r = runCorelPersonaje(label, h[0].tpl, h.map(l => l.nombre));
                const holgura = /holgura final: ([^\n]+)/.exec(r.out);
                if (holgura) log(`    ${holgura[1]}`);
                generadas.push(r);
            } catch (e) { fallo = `${label}: ${e.message}`; break; }
        }

        if (fallo) {
            // NADA subido: se libera el claim y se cuenta el intento. Tras varios fallos el pedido deja
            // de esconderse en "SVG IA" (designForce) para que una persona lo vea en Pendientes.
            log(`  ERROR generando el bloque ${dhs.join('-')}: ${fallo} -> no se sube nada`);
            for (const [id, o] of pedidos) {
                const fails = (Number(o.svgCortePersonajeFails) || 0) + 1;
                const upd = { svgCorteStartedAt: admin.firestore.FieldValue.delete(), svgCortePersonajeFails: fails };
                if (fails >= 3) { upd.designForce = true; log(`  ! ${dhOf(o)} lleva ${fails} intentos fallidos -> se manda a Pendientes manual`); }
                try { await db.collection('pedidos').doc(String(id)).update(upd); } catch (_) {}
            }
            continue;
        }

        const subidas = [];
        for (const g of generadas) {
            const up = await uploadToDrive(g.svg);
            subidas.push({ up, cdr: g.cdr });
            log(`  OK ${up.name} -> ${up.webViewLink}`);
            ok++;
        }

        for (const [id, o] of pedidos) {
            const otros = dhs.filter(d => d !== dhOf(o));
            const upd = {
                svgCorteAt: admin.firestore.FieldValue.serverTimestamp(),
                svgCorteUrl: subidas[0].up.webViewLink,
                svgCorteFileName: subidas[0].up.name,
                svgCorteCdrLocal: subidas[0].cdr,
                // Los DH que comparten hoja (el CRM lo imprime tal cual en el tooltip), NO las URLs.
                svgCorteSheetWith: otros.length ? otros.join(',') : null,
                svgCorteUrls: subidas.length > 1 ? subidas.map(s => s.up.webViewLink).join(',') : null,
                svgCorteBy: 'svg-worker-personaje',
                svgCorteStartedAt: admin.firestore.FieldValue.delete(),
                svgCortePersonajeFails: admin.firestore.FieldValue.delete(),
            };
            // Los que pidieron VIDEO se quedan en 'Corregir': el pendiente del video sigue vivo hasta
            // que el equipo lo grabe y lo mande (misma regla que el corte de corazones).
            if (!video) upd.estatus = NEW_STATUS;
            await db.collection('pedidos').doc(String(id)).update(upd);
            try { await recomputeForContact(o.contactId || o.telefono); } catch (_) {}
        }
    }
    return ok;
}

async function processPersonaje(cfg) {
    if (!FORCE && cfg.personajeAutoCut === false) { log('personajeAutoCut=false (kill-switch), salto personaje.'); return; }
    const lamps = await findPersonajeLamps();
    log(`Lámparas de personaje listas: ${lamps.length}` + (DRY ? ' (DRY RUN)' : ''));
    if (!lamps.length) return;
    // Presupuesto de hojas: se corta en MAX_SHEETS, pero se sigue tomando mientras un pedido ya
    // empezado tenga lámparas sin cubrir (así un pedido de 3+ no se queda a medias por el recorte).
    const todas = buildPersonajeSheets(lamps);
    const faltan = new Map();
    let sheets = [];
    for (const s of todas) {
        const yaEmpezado = s.some(l => (faltan.get(l.o.id) || 0) > 0);
        if (sheets.length >= MAX_SHEETS && !yaEmpezado) break;
        sheets.push(s);
        for (const l of s) faltan.set(l.o.id, (faltan.has(l.o.id) ? faltan.get(l.o.id) : l.total) - 1);
    }
    // Red de seguridad: lo que aun así quede partido (p.ej. una lámpara esperando pareja) no se corta.
    sheets = podarPedidosPartidos(sheets);
    if (!sheets.length) { log('Nada de personaje que generar.'); return; }
    const ok = await processPersonajeSheets(sheets);
    log(`Personaje: ${ok}/${sheets.length} hoja(s) generadas.`);
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

        // Lámparas de personaje (Modo 5). Va ANTES de los corazones y en su propio try: si algo falla
        // aquí, el corte de corazones —que lleva semanas estable— tiene que seguir corriendo igual.
        try { await processPersonaje(cfg); }
        catch (e) { log(`ERROR en el paso de personaje: ${e.stack || e.message}`); }

        const candidates = await findCandidates(cfg);
        const nVideo = candidates.filter(c => c.video).length;
        log(`Candidatos listos para diseño IA: ${candidates.length}` + (nVideo ? ` (${nVideo} piden video)` : '') + (DRY ? ' (DRY RUN)' : ''));
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
