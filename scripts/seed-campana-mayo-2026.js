/**
 * Seed inicial: crea la campaña "Mayo 2026 - Promoción Base Histórica".
 *
 * Uso: node scripts/seed-campana-mayo-2026.js
 * Requiere: FIREBASE_SERVICE_ACCOUNT_JSON en .env
 *
 * Idempotente: si ya existe una campaña con el mismo nombre, no la duplica.
 * Para forzar recreación, pasar --force como segundo argumento.
 */
require('dotenv').config();
const admin = require('firebase-admin');

const FORCE = process.argv.includes('--force');

const CAMPANA = {
    nombre: 'Mayo 2026 - Promoción Base Histórica',
    fecha_inicio: new Date(2026, 4, 26, 0, 0, 0, 0),   // 26 may 2026 00:00
    fecha_fin:    new Date(2026, 4, 31, 23, 59, 59, 999), // 31 may 2026 23:59:59
    estatus: 'activa',
    plantillas: {
        // Nombres REALES de las plantillas Meta/WhatsApp Business
        'dekoor_promo_mayo_porta_retrato':   { contactados: 250, notas: 'Plantilla A — oferta porta retrato gratis' },
        'dekoor_promo_mayo_segunda_lampara': { contactados: 250, notas: 'Plantilla B — combo $999 segunda lámpara mitad de precio' },
    },
    notas: 'Primera campaña tracked. 500 plantillas piloto enviadas martes 26 (250 A + 250 B).',
};

try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
} catch (e) {
    console.error('Error inicializando Firebase Admin. Verifica FIREBASE_SERVICE_ACCOUNT_JSON en .env');
    process.exit(1);
}

const db = admin.firestore();

(async () => {
    try {
        const existing = await db
            .collection('campanas')
            .where('nombre', '==', CAMPANA.nombre)
            .limit(1)
            .get();

        if (!existing.empty && !FORCE) {
            const doc = existing.docs[0];
            console.log(`Ya existe campaña con ese nombre (id: ${doc.id}). Usa --force para sobrescribir.`);
            process.exit(0);
        }

        const payload = {
            nombre: CAMPANA.nombre,
            fecha_inicio: admin.firestore.Timestamp.fromDate(CAMPANA.fecha_inicio),
            fecha_fin: admin.firestore.Timestamp.fromDate(CAMPANA.fecha_fin),
            estatus: CAMPANA.estatus,
            plantillas: CAMPANA.plantillas,
            notas: CAMPANA.notas,
            creada_por: 'seed-script',
            creada_en: admin.firestore.FieldValue.serverTimestamp(),
            actualizada_en: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (!existing.empty && FORCE) {
            const docId = existing.docs[0].id;
            await db.collection('campanas').doc(docId).set(payload, { merge: false });
            console.log(`Campaña sobrescrita (id: ${docId}).`);
        } else {
            const ref = await db.collection('campanas').add(payload);
            console.log(`Campaña creada (id: ${ref.id}).`);
        }

        console.log('  Nombre:    ', CAMPANA.nombre);
        console.log('  Período:   ', CAMPANA.fecha_inicio.toISOString().slice(0, 10), '→', CAMPANA.fecha_fin.toISOString().slice(0, 10));
        console.log('  Plantillas:', Object.keys(CAMPANA.plantillas).join(', '));
        process.exit(0);
    } catch (err) {
        console.error('Error en seed:', err.message);
        process.exit(1);
    }
})();
