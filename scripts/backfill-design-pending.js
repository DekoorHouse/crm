// Backfill/recalculo de "Pendiente de Diseño". Tres fases:
//   0) Marca mockupPreviewAt en los pedidos que YA tienen mockup (colección mockup_previews), para que
//      salgan de la cola "falta mockup". Solo toca pedidos que existen.
//   1) LIMPIA todas las banderas designPending actuales (evita positivos falsos de lógicas anteriores).
//   2) MARCA de nuevo los contactos cuyos pedidos SÍ están pendientes hoy (motor designPending.js:
//      Sin estatus sin mockup + Fabricar sin enviar + Corregir + 2º producto).
//
// Uso (desde la raíz del repo, con serviceAccountKey.json presente):
//   node scripts/backfill-design-pending.js
const { db, admin } = require('../server/config');
const { reasonsForOrderData, recomputeForContact } = require('../server/design/designPending');

(async () => {
    // --- FASE 0: mockupPreviewAt desde mockup_previews (solo pedidos existentes) ---
    console.log('[backfill] Fase 0: marcando mockupPreviewAt en pedidos con mockup...');
    const mp = await db.collection('mockup_previews').get();
    const withPreview = mp.docs.filter(d => Array.isArray(d.data().previews) && d.data().previews.length > 0).map(d => d.id);
    let mpSet = 0;
    for (let i = 0; i < withPreview.length; i += 300) {
        const ids = withPreview.slice(i, i + 300);
        const docs = await db.getAll(...ids.map(id => db.collection('pedidos').doc(id)));
        const batch = db.batch();
        let n = 0;
        docs.forEach(doc => {
            if (doc.exists && !doc.data().mockupPreviewAt) {
                batch.update(doc.ref, { mockupPreviewAt: admin.firestore.FieldValue.serverTimestamp() });
                n++;
            }
        });
        if (n > 0) { await batch.commit(); mpSet += n; }
    }
    console.log(`[backfill] Fase 0 lista: ${mpSet} pedidos marcados con mockup (${withPreview.length} previews).`);

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
    const [sSin, sFab, sCor, sProd] = await Promise.all([
        db.collection('pedidos').where('estatus', '==', 'Sin estatus').limit(500).get(),
        db.collection('pedidos').where('estatus', '==', 'Fabricar').limit(1000).get(),
        db.collection('pedidos').where('estatus', '==', 'Corregir').get(),
        db.collection('pedidos').orderBy('productoAgregadoPostPagoAt', 'desc').limit(200).get(),
    ]);
    [sSin, sFab, sCor, sProd].forEach(s => s.forEach(d => byId.set(d.id, d)));

    const contactIds = new Set();
    for (const doc of byId.values()) {
        if (reasonsForOrderData(doc.data()).length > 0) {
            const cid = doc.data().contactId || doc.data().telefono;
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
