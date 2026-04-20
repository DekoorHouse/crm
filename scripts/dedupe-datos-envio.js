/**
 * Deduplicacion de registros en `datos_envio`.
 *
 * Deja el doc mas reciente (por createdAt) para cada numeroPedido y borra los demas.
 *
 * Uso:
 *   node scripts/dedupe-datos-envio.js <numeroPedido>           # dry-run por defecto
 *   node scripts/dedupe-datos-envio.js <numeroPedido> --execute # borra de verdad
 *   node scripts/dedupe-datos-envio.js --all                    # escanea todos los pedidos (dry-run)
 *   node scripts/dedupe-datos-envio.js --all --execute          # borra todos los duplicados
 *
 * Requiere: FIREBASE_SERVICE_ACCOUNT_JSON en .env
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const scanAll = args.includes('--all');
const orderNumber = args.find(a => !a.startsWith('--'));

if (!scanAll && !orderNumber) {
    console.error('Uso: node scripts/dedupe-datos-envio.js <numeroPedido> [--execute]');
    console.error('     node scripts/dedupe-datos-envio.js --all [--execute]');
    process.exit(1);
}

try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (e) {
    console.error('Error inicializando Firebase Admin:', e.message);
    process.exit(1);
}

const db = admin.firestore();

function tsMillis(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') return new Date(v).getTime() || 0;
    if (v._seconds) return v._seconds * 1000;
    return 0;
}

async function dedupeForOrder(numeroPedido) {
    const snap = await db.collection('datos_envio')
        .where('numeroPedido', '==', numeroPedido)
        .get();

    if (snap.size <= 1) {
        console.log(`[${numeroPedido}] ${snap.size} registro(s) — sin duplicados.`);
        return { kept: snap.size, deleted: 0 };
    }

    const docs = snap.docs
        .map(d => ({ id: d.id, data: d.data(), ref: d.ref, ts: tsMillis(d.data().createdAt) }))
        .sort((a, b) => b.ts - a.ts);

    const keep = docs[0];
    const remove = docs.slice(1);

    console.log(`\n[${numeroPedido}] ${docs.length} registros encontrados:`);
    docs.forEach((d, i) => {
        const date = d.ts ? new Date(d.ts).toLocaleString('es-MX') : '(sin fecha)';
        const marker = i === 0 ? 'KEEP  ' : 'DELETE';
        console.log(`  ${marker} ${d.id}  ${date}  ${d.data.nombreCompleto}`);
    });

    if (!execute) {
        console.log(`  → DRY-RUN (usa --execute para borrar ${remove.length} doc(s))`);
        return { kept: 1, deleted: 0, wouldDelete: remove.length };
    }

    for (const d of remove) {
        await d.ref.delete();
        console.log(`  ✅ borrado ${d.id}`);
    }
    return { kept: 1, deleted: remove.length };
}

async function main() {
    if (orderNumber) {
        const result = await dedupeForOrder(orderNumber);
        console.log(`\nResumen: ${result.kept} conservado, ${result.deleted || result.wouldDelete || 0} ${execute ? 'borrado(s)' : 'a borrar'}`);
    } else if (scanAll) {
        const allSnap = await db.collection('datos_envio').get();
        const byOrder = new Map();
        allSnap.forEach(d => {
            const n = d.data().numeroPedido;
            if (!n) return;
            if (!byOrder.has(n)) byOrder.set(n, []);
            byOrder.get(n).push(d);
        });

        const duplicates = [...byOrder.entries()].filter(([, docs]) => docs.length > 1);
        console.log(`Total pedidos: ${byOrder.size}. Con duplicados: ${duplicates.length}.`);

        let totalDeleted = 0;
        for (const [num] of duplicates) {
            const r = await dedupeForOrder(num);
            totalDeleted += r.deleted || r.wouldDelete || 0;
        }
        console.log(`\nResumen global: ${duplicates.length} pedidos con duplicados, ${totalDeleted} doc(s) ${execute ? 'borrado(s)' : 'a borrar'}`);
    }
    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
