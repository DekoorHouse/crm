// Backfill/recalculo de la bandera "Pendiente de Diseño" (designPending / designPendingReasons) en los
// contactos. Dos fases:
//   1) LIMPIA todas las banderas actuales (evita positivos falsos de corridas o lógicas anteriores).
//   2) MARCA de nuevo solo los contactos cuyos pedidos SÍ están pendientes hoy (lógica de
//      server/design/designPending.js: Corregir + comprobante validado sin guía/preview + 2º producto).
//
// Uso (desde la raíz del repo, con serviceAccountKey.json presente):
//   node scripts/backfill-design-pending.js
const { db } = require('../server/config');
const { reasonsForOrderData, recomputeForContact } = require('../server/design/designPending');

(async () => {
    // --- FASE 1: limpiar banderas actuales en lotes ---
    console.log('[backfill] Fase 1: limpiando designPending existentes...');
    let cleared = 0;
    while (true) {
        const snap = await db.collection('contacts_whatsapp').where('designPending', '==', true).limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach(d => batch.update(d.ref, { designPending: false, designPendingReasons: [] }));
        await batch.commit();
        cleared += snap.size;
        console.log(`  ...limpiados ${cleared}`);
    }
    console.log(`[backfill] Fase 1 lista: ${cleared} banderas limpiadas.`);

    // --- FASE 2: marcar los pendientes reales ---
    console.log('[backfill] Fase 2: escaneando candidatos...');
    const byId = new Map();
    const [s1, s2, s3] = await Promise.all([
        db.collection('pedidos').where('estatus', '==', 'Corregir').get(),
        db.collection('pedidos').orderBy('comprobanteValidadoAt', 'desc').limit(500).get(),
        db.collection('pedidos').orderBy('productoAgregadoPostPagoAt', 'desc').limit(200).get(),
    ]);
    [s1, s2, s3].forEach(s => s.forEach(d => byId.set(d.id, d)));

    const contactIds = new Set();
    for (const doc of byId.values()) {
        const d = doc.data();
        if (reasonsForOrderData(d).length > 0) {
            const cid = d.contactId || d.telefono;
            if (cid) contactIds.add(String(cid));
        }
    }
    console.log(`[backfill] candidatos: ${byId.size} pedidos | contactos a recalcular: ${contactIds.size}`);

    let marcados = 0, i = 0;
    for (const cid of contactIds) {
        const r = await recomputeForContact(cid);
        if (r && r.length) marcados++;
        if (++i % 25 === 0) console.log(`  ...${i}/${contactIds.size}`);
    }
    console.log(`[backfill] LISTO. Contactos con designPending=true al final: ${marcados}.`);
    process.exit(0);
})().catch(e => { console.error('[backfill] FALLÓ:', e); process.exit(1); });
