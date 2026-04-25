/**
 * Diagnóstico: por qué un pedido queda sin atribución de ad.
 * No escribe nada. Solo clasifica los pedidos "orgánicos" en buckets
 * y muestra estadísticas para entender qué tipo de data falta.
 *
 * Uso: node scripts/diagnose-pedido-attribution.js
 */
require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function diagnose(contactId, beforeTs) {
    if (!contactId) return { bucket: 'A_no_contactId' };

    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    const contactDoc = await contactRef.get();

    if (!contactDoc.exists) return { bucket: 'B_contact_doc_missing' };

    const contactData = contactDoc.data();
    const hasAdReferral = !!(contactData.adReferral && contactData.adReferral.source_id);

    // Contar mensajes totales y los que tienen adId
    const allMsgsSnap = await contactRef.collection('messages')
        .where('timestamp', '<=', beforeTs)
        .orderBy('timestamp', 'desc')
        .get();

    const totalMsgs = allMsgsSnap.size;
    let msgsWithAd = 0;
    let foundInFirst200 = false;
    let foundAtPosition = -1;
    allMsgsSnap.docs.forEach((doc, idx) => {
        if (doc.data().adId) {
            msgsWithAd++;
            if (foundAtPosition === -1) foundAtPosition = idx;
            if (idx < 200) foundInFirst200 = true;
        }
    });

    if (totalMsgs === 0) {
        return hasAdReferral
            ? { bucket: 'F_should_have_been_caught_via_referral' }  // bug del helper
            : { bucket: 'C_no_messages_no_referral', totalMsgs };
    }

    if (msgsWithAd === 0) {
        return hasAdReferral
            ? { bucket: 'F_should_have_been_caught_via_referral' }
            : { bucket: 'D_messages_but_no_adId_no_referral', totalMsgs };
    }

    // Tiene mensajes con ad pero más allá de los 200 más recientes
    if (!foundInFirst200) {
        return { bucket: 'E_ad_message_beyond_200', totalMsgs, foundAtPosition };
    }

    // Si llegamos aquí, había ad en los primeros 200 → no debería ser orgánico
    return { bucket: 'F_should_have_been_caught_via_messages' };
}

async function main() {
    const snap = await db.collection('pedidos').get();
    console.log(`Total pedidos: ${snap.size}\n`);

    const buckets = {};
    const monthHistogram = {};
    let processed = 0;
    let organicCount = 0;

    for (const doc of snap.docs) {
        processed++;
        if (processed % 500 === 0) console.log(`  procesando... ${processed}/${snap.size}`);

        const data = doc.data();
        if (data.leadDate || data.leadSource === 'ad') continue; // ya tiene atribución de ad

        const contactId = data.contactId || data.telefono;
        const beforeTs = data.createdAt || admin.firestore.Timestamp.now();

        if (!contactId) {
            organicCount++;
            buckets['A_no_contactId'] = (buckets['A_no_contactId'] || 0) + 1;
            if (data.createdAt) {
                const d = data.createdAt.toDate();
                const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                monthHistogram[month] = (monthHistogram[month] || 0) + 1;
            }
            continue;
        }

        // Replicar la lógica del backfill rápido para detectar si es ad real
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        let isAd = false;
        try {
            const recentMsgs = await contactRef.collection('messages')
                .where('timestamp', '<=', beforeTs)
                .orderBy('timestamp', 'desc')
                .limit(200)
                .get();
            for (const m of recentMsgs.docs) {
                if (m.data().adId) { isAd = true; break; }
            }
            if (!isAd) {
                const cd = await contactRef.get();
                if (cd.exists && cd.data().adReferral && cd.data().adReferral.source_id) {
                    isAd = true;
                }
            }
        } catch (_) {}

        if (isAd) continue;

        organicCount++;

        // Diagnóstico profundo
        const diag = await diagnose(contactId, beforeTs);
        buckets[diag.bucket] = (buckets[diag.bucket] || 0) + 1;

        // Histograma por mes de createdAt
        if (data.createdAt) {
            const d = data.createdAt.toDate();
            const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthHistogram[month] = (monthHistogram[month] || 0) + 1;
        }
    }

    console.log(`\n=== RESULTADOS ===\n`);
    console.log(`Pedidos orgánicos analizados: ${organicCount}\n`);

    console.log('Por causa raíz:');
    const labels = {
        A_no_contactId: 'A. Pedido sin contactId/telefono',
        B_contact_doc_missing: 'B. ContactId apunta a un contacto que NO existe',
        C_no_messages_no_referral: 'C. Contacto sin mensajes y sin adReferral',
        D_messages_but_no_adId_no_referral: 'D. Tiene mensajes pero ninguno con adId, ni adReferral',
        E_ad_message_beyond_200: 'E. Sí tiene ad en mensajes, pero >200 atrás (bug del límite)',
        F_should_have_been_caught_via_referral: 'F. BUG: debería haber sido capturado',
        F_should_have_been_caught_via_messages: 'F. BUG: debería haber sido capturado'
    };
    Object.entries(buckets).sort((a, b) => b[1] - a[1]).forEach(([b, n]) => {
        const pct = ((n / organicCount) * 100).toFixed(1);
        console.log(`  ${labels[b] || b}: ${n} (${pct}%)`);
    });

    console.log('\nHistograma por mes de creación (orgánicos):');
    Object.keys(monthHistogram).sort().forEach(m => {
        const bar = '█'.repeat(Math.min(60, Math.ceil(monthHistogram[m] / 20)));
        console.log(`  ${m}: ${String(monthHistogram[m]).padStart(4)} ${bar}`);
    });
}

main().catch(err => { console.error(err); process.exit(1); }).finally(() => process.exit());
