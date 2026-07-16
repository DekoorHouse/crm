// Backfill de la bandera "Pendiente de Diseño" (designPending / designPendingReasons) sobre los
// contactos, para poblar la vista con los pedidos que YA existen. Recorre todos los pedidos, junta
// los contactos cuyo pedido tiene algún pendiente y recalcula cada uno con la misma lógica del server
// (server/design/designPending.js), que evalúa el ÚLTIMO pedido del contacto.
//
// Uso (desde la raíz del repo, con serviceAccountKey.json presente):
//   node scripts/backfill-design-pending.js
//
// Nota: para pedidos históricos no hay marca de "preview enviado" (previewEnviadoAt es nuevo), así que
// los pagados sin preview caen en "anticipo"; se corrige solo cuando avanzan de estatus o se les manda
// un mockup nuevo. corregirMotivo también es nuevo: los 'Corregir' viejos se muestran como "datos".
const { db } = require('../server/config');
const { reasonsForOrderData, recomputeForContact } = require('../server/design/designPending');

(async () => {
    console.log('[backfill-design-pending] Leyendo pedidos...');
    const snap = await db.collection('pedidos').get();

    const contactIds = new Set();
    let candidatos = 0;
    snap.forEach(doc => {
        const d = doc.data();
        if (reasonsForOrderData(d).length > 0) {
            candidatos++;
            const cid = d.contactId || d.telefono;
            if (cid) contactIds.add(String(cid));
        }
    });
    console.log(`[backfill-design-pending] Pedidos: ${snap.size} | con pendiente: ${candidatos} | contactos únicos: ${contactIds.size}`);

    let marcados = 0, limpiados = 0, i = 0;
    for (const cid of contactIds) {
        const reasons = await recomputeForContact(cid);
        if (reasons && reasons.length) marcados++; else limpiados++;
        if (++i % 50 === 0) console.log(`  ...${i}/${contactIds.size}`);
    }

    console.log(`[backfill-design-pending] LISTO. designPending=true: ${marcados} | recalculados a false (su último pedido ya no aplica): ${limpiados}.`);
    process.exit(0);
})().catch(e => { console.error('[backfill-design-pending] FALLÓ:', e); process.exit(1); });
