'use strict';
// Compatibility for special designs staged on disk before the server migration.
// New automatic lamp designs are generated exclusively by server/design/svgCutWorker.
const fs = require('fs');
const path = require('path');
const { db, admin } = require('../server/config');
const { recomputeForContact } = require('../server/design/designPending');
const { uploadDrive } = require('../server/design/svgCutStorage');
const DRY = process.argv.includes('--dry');
const NEW_STATUS = 'Diseñado por IA';
const dhOf = o => 'DH' + (o.consecutiveOrderNumber || o.id);
const log = console.log;
const uploadToDrive = file => uploadDrive(path.basename(file), fs.readFileSync(file));
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


module.exports = { processApprovedDesigns };
if (require.main === module) processApprovedDesigns().catch(e => { console.error(e.message); process.exitCode = 1; });
