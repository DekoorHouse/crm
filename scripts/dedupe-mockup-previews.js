/**
 * Limpieza única: colapsa previews DUPLICADOS dentro de un mismo pedido en
 * mockup_previews (mismo templateId + fields + secondRefUrl, distinto blockId).
 * Estos duplicados nacían cuando la lista de Mockup se re-renderizaba a mitad de
 * una generación y el preview terminado se guardaba con un blockId nuevo en vez
 * de reemplazar el existente (ya corregido en savePreview, mockupsRoutes.js).
 *
 * Por cada grupo de previews idénticos deja UNO: el que tenga layout verificado
 * y, a igualdad, el más reciente. NO toca pedidos con previews de datos distintos.
 *
 * Uso:  node scripts/dedupe-mockup-previews.js          (dry-run, no escribe)
 *       node scripts/dedupe-mockup-previews.js --apply  (aplica los cambios)
 */
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, '..', 'serviceAccountKey.json'))) });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
// Clave de "mismo diseño": plantilla + campos (nombres/fecha). NO se incluye secondRefUrl:
// esa imagen de referencia se sube nueva en cada generación aunque el diseño sea idéntico.
const keyOf = (p) => JSON.stringify([p.templateId || '', p.fields || {}]);
const ts = (p) => { try { return Date.parse(p.createdAt) || 0; } catch (_) { return 0; } };
// Mejor preview de un grupo: primero los que tienen layout verificado, luego el más reciente.
const better = (a, b) => (!!b.layout - !!a.layout) || (ts(b) - ts(a));

(async () => {
    const snap = await db.collection('mockup_previews').get();
    let changed = 0, removed = 0;
    for (const d of snap.docs) {
        const arr = Array.isArray(d.data().previews) ? d.data().previews : [];
        if (arr.length < 2) continue;
        const groups = new Map();
        for (const p of arr) { const k = keyOf(p); (groups.get(k) || groups.set(k, []).get(k)).push(p); }
        if ([...groups.values()].every(g => g.length === 1)) continue;   // sin duplicados
        const kept = [...groups.values()].map(g => g.slice().sort(better)[0]);
        // Conserva el orden original (por el primer superviviente de cada grupo).
        const out = arr.filter(p => kept.includes(p));
        const drop = arr.length - out.length;
        removed += drop; changed++;
        console.log(`${d.id}: ${arr.length} -> ${out.length} previews (${drop} eliminado(s))`);
        if (APPLY) await d.ref.set({ previews: out }, { merge: true });
    }
    console.log(`\n${APPLY ? 'APLICADO' : 'DRY-RUN'}: ${changed} pedido(s), ${removed} preview(s) redundante(s) ${APPLY ? 'eliminados' : 'a eliminar'}.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
