/**
 * Backfill de atribución para pedidos existentes.
 * Para cada pedido sin `leadDate` busca en su contacto el ad más reciente <= pedido.createdAt
 * y le agrega: attributedAdId, leadDate, leadSource.
 *
 * Uso:
 *   node scripts/backfill-pedido-attribution.js          # dry-run (no escribe)
 *   node scripts/backfill-pedido-attribution.js --apply  # aplica los cambios
 *
 * Requiere: FIREBASE_SERVICE_ACCOUNT_JSON en .env
 */
require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');

async function resolveAttribution(contactId, beforeTs) {
    const fallback = { leadDate: null, attributedAdId: null, leadSource: 'organic' };
    if (!contactId) return fallback;

    const contactRef = db.collection('contacts_whatsapp').doc(contactId);

    try {
        const msgSnap = await contactRef.collection('messages')
            .where('timestamp', '<=', beforeTs)
            .orderBy('timestamp', 'desc')
            .limit(200)
            .get();

        for (const doc of msgSnap.docs) {
            const data = doc.data();
            if (data.adId) {
                return {
                    leadDate: data.timestamp || null,
                    attributedAdId: String(data.adId),
                    leadSource: 'ad'
                };
            }
        }

        const contactDoc = await contactRef.get();
        if (contactDoc.exists) {
            const ref = contactDoc.data().adReferral;
            if (ref && ref.source_id) {
                return {
                    leadDate: contactDoc.data().createdAt || null,
                    attributedAdId: String(ref.source_id),
                    leadSource: 'ad'
                };
            }
        }
    } catch (err) {
        console.error(`  [ERR ${contactId}] ${err.message}`);
    }

    return fallback;
}

async function main() {
    console.log(`Modo: ${APPLY ? 'APPLY (escribe a Firestore)' : 'DRY-RUN (no escribe)'}\n`);

    const snap = await db.collection('pedidos').get();
    console.log(`Total pedidos en colección: ${snap.size}\n`);

    let toUpdate = [];
    let alreadyHave = 0;
    let noContact = 0;
    let processed = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        processed++;

        if (processed % 500 === 0) {
            console.log(`  procesando... ${processed}/${snap.size}`);
        }

        if (data.leadDate || data.leadSource) {
            alreadyHave++;
            continue;
        }

        const contactId = data.contactId || data.telefono;
        if (!contactId) {
            noContact++;
            continue;
        }

        const beforeTs = data.createdAt || admin.firestore.Timestamp.now();
        const attr = await resolveAttribution(contactId, beforeTs);

        toUpdate.push({ ref: doc.ref, id: doc.id, attr, contactId });
    }

    const stats = { ad: 0, organic: 0 };
    toUpdate.forEach(it => { stats[it.attr.leadSource]++; });

    console.log(`Ya tenían atribución: ${alreadyHave}`);
    console.log(`Sin contactId/telefono: ${noContact}`);
    console.log(`A actualizar: ${toUpdate.length}`);
    console.log(`  - con ad: ${stats.ad}`);
    console.log(`  - orgánicos: ${stats.organic}\n`);

    if (toUpdate.length === 0) {
        console.log('Nada que hacer.');
        return;
    }

    // Mostrar muestra
    console.log('Muestra (primeros 5):');
    toUpdate.slice(0, 5).forEach(it => {
        const date = it.attr.leadDate ? it.attr.leadDate.toDate().toISOString().slice(0, 10) : 'null';
        console.log(`  ${it.id} | contact=${it.contactId} | ${it.attr.leadSource} | ad=${it.attr.attributedAdId || '-'} | leadDate=${date}`);
    });

    if (!APPLY) {
        console.log('\n(Dry-run. Vuelve a correr con --apply para escribir.)');
        return;
    }

    console.log('\nEscribiendo en lotes de 400...');
    let written = 0;
    for (let i = 0; i < toUpdate.length; i += 400) {
        const chunk = toUpdate.slice(i, i + 400);
        const batch = db.batch();
        chunk.forEach(it => {
            batch.update(it.ref, {
                attributedAdId: it.attr.attributedAdId,
                leadDate: it.attr.leadDate,
                leadSource: it.attr.leadSource
            });
        });
        await batch.commit();
        written += chunk.length;
        console.log(`  ${written}/${toUpdate.length}`);
    }

    console.log(`\n✅ ${written} pedidos actualizados.`);
}

main().catch(err => { console.error(err); process.exit(1); }).finally(() => process.exit());
