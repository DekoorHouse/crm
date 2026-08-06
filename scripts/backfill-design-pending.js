// Backfill/recalculo de "Pendiente de Diseño". Tres fases:
//   0) Marca mockupPreviewAt en los pedidos que YA tienen mockup (colección mockup_previews), para que
//      salgan de la cola "falta mockup". Solo toca pedidos que existen.
//   1) LIMPIA todas las banderas designPending actuales (evita positivos falsos de lógicas anteriores).
//   2) MARCA de nuevo los contactos cuyos pedidos SÍ están pendientes hoy (motor designPending.js:
//      Fabricar sin enviar + Corregir por datos + reenvíos + 2º producto + PAGADOS sin cortar).
//
// Correrlo también sirve para MIGRAR: desde el 2026-08-06 "falta mockup" y "video" ya no son motivos
// de diseño (se fueron a la sección Pendientes), así que este script apaga las banderas viejas que
// quedaron encendidas solo por eso. Si no se corre, se limpian solas conforme cada contacto se
// recalcula (cualquier cambio en sus pedidos), pero mientras tanto siguen saliendo sus chips.
//
// OJO: la Fase 1 apaga TODO antes de que la Fase 2 vuelva a encender. Los buckets de la Fase 2 tienen
// que cubrir TODOS los motivos de designPending.reasonsForOrderData; si falta uno, esos pedidos
// desaparecen del filtro del CRM sin avisar. Si agregas un motivo nuevo, agrega aquí su consulta.
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
    // Los buckets tienen que ser LOS MISMOS que consulta el tablero (apiRoutes /design-pending).
    // Faltaba comprobanteValidadoAt, que es de donde sale el motivo 'corte' (pagado y sin diseñar,
    // ver designPending.faltaCorte): como la Fase 1 apaga TODAS las banderas primero, esos pedidos
    // se quedaban apagados para siempre y desaparecían del filtro del CRM. Justo el incidente que el
    // propio motivo 'corte' vino a resolver (153 pedidos invisibles). Detectado al auditar antes de
    // correr el backfill: hoy afectaba a DH14128 ('Foto enviada', pendiente de corte). Chris, 2026-08-01.
    console.log('[backfill] Fase 2: escaneando candidatos...');
    const byId = new Map();
    const LIM = { sin: 500, fab: 1000, prod: 200, pag: 1500 };
    const [sSin, sFab, sCor, sProd, sPag] = await Promise.all([
        db.collection('pedidos').where('estatus', '==', 'Sin estatus').limit(LIM.sin).get(),
        db.collection('pedidos').where('estatus', '==', 'Fabricar').limit(LIM.fab).get(),
        db.collection('pedidos').where('estatus', '==', 'Corregir').get(),
        db.collection('pedidos').orderBy('productoAgregadoPostPagoAt', 'desc').limit(LIM.prod).get(),
        db.collection('pedidos').orderBy('comprobanteValidadoAt', 'desc').limit(LIM.pag).get(),
    ]);
    // Un bucket que llega a su tope está TRUNCADO: los que quedaron fuera se apagaron en la Fase 1 y
    // no se van a volver a encender. Se avisa fuerte en vez de dejarlo pasar como si todo hubiera ido bien.
    [['Sin estatus', sSin, LIM.sin], ['Fabricar', sFab, LIM.fab], ['2º producto', sProd, LIM.prod], ['pagados', sPag, LIM.pag]]
        .forEach(([nombre, snap, lim]) => {
            if (snap.size >= lim) console.warn(`[backfill] ⚠️  BUCKET TRUNCADO: '${nombre}' llegó al tope de ${lim}. Sube el límite y vuelve a correr, o quedarán pendientes apagados.`);
        });
    [sSin, sFab, sCor, sProd, sPag].forEach(s => s.forEach(d => byId.set(d.id, d)));

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
