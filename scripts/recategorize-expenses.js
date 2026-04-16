/**
 * Script para recategorizar movimientos por concepto.
 * Uso: node scripts/recategorize-expenses.js
 * Requiere: variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON
 */
require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Reglas: concepto (lowercase, parcial) -> nueva categoría
const rules = [
    { match: 'minisuper natalia', category: 'Chris' },
    { match: 'temu', category: 'Chris' },
    { match: 'alsuper plus mezquital', category: 'Chris' },
    { match: 'alsuper plus d arrieta', category: 'Chris' },
    { match: 'fruteria alvarez', category: 'Chris' },
    { match: 'psa computo', category: 'Material' },
];

async function main() {
    const snapshot = await db.collection('expenses').get();
    let updated = 0;
    const batch = db.batch();

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const concept = (data.concept || '').toLowerCase();

        for (const rule of rules) {
            if (concept.includes(rule.match)) {
                const oldCat = data.category || 'SinCategorizar';
                if (oldCat !== rule.category) {
                    console.log(`[${rule.category}] "${data.concept}" (era: ${oldCat}) — ${doc.id}`);
                    batch.update(doc.ref, { category: rule.category });
                    updated++;
                }
                break;
            }
        }
    });

    if (updated === 0) {
        console.log('No se encontraron movimientos para recategorizar.');
        return;
    }

    await batch.commit();
    console.log(`\n✅ ${updated} movimientos recategorizados.`);
}

main().catch(console.error).finally(() => process.exit());
