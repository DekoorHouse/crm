/**
 * Seed: crea la respuesta rápida "Datos MTY" que usa el botón
 * "Pedir Datos de Envío (MTY)" del CRM para mandar el enlace del formulario
 * de entrega local en Monterrey.
 *
 * Uso: node scripts/seed-quick-reply-mty.js [--force]
 * Requiere: FIREBASE_SERVICE_ACCOUNT_JSON en .env (o serviceAccountKey.json en la raíz).
 *
 * Idempotente: si ya existe un atajo "Datos MTY" no lo duplica.
 *
 * El endpoint /api/repartos-mty/pedir-datos/:contactId reemplaza ** por el
 * número de pedido e inyecta el pedido en la URL /mty -> /mty/DHxxxx.
 */
require('dotenv').config();
const admin = require('firebase-admin');

const FORCE = process.argv.includes('--force');

const SHORTCUT = 'Datos MTY';
const MESSAGE = [
    '📦✨ Para enviarte tu pedido ** necesitamos tu dirección de entrega en Nuevo León 📍🚚',
    '',
    'Por favor llénala en este enlace 👇😊',
    'https://app.dekoormx.com/mty',
].join('\n');

function initAdmin() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
    } else {
        admin.initializeApp({ credential: admin.credential.cert(require('../serviceAccountKey.json')) });
    }
}

(async () => {
    try {
        initAdmin();
        const db = admin.firestore();

        const all = await db.collection('quick_replies').get();
        const existing = all.docs.find(d => (d.data().shortcut || '').toLowerCase() === SHORTCUT.toLowerCase());

        if (existing && !FORCE) {
            console.log(`==> Ya existe la respuesta rápida "${existing.data().shortcut}" (id: ${existing.id}). Nada que hacer.`);
            console.log('    Usa --force para sobrescribir su mensaje.');
            process.exit(0);
        }

        if (existing && FORCE) {
            await existing.ref.update({ message: MESSAGE, fileUrl: null, fileType: null });
            console.log(`==> Respuesta rápida "${SHORTCUT}" actualizada (id: ${existing.id}).`);
        } else {
            const ref = await db.collection('quick_replies').add({
                shortcut: SHORTCUT, message: MESSAGE, fileUrl: null, fileType: null,
            });
            console.log(`==> Respuesta rápida "${SHORTCUT}" creada (id: ${ref.id}).`);
        }
        console.log('\nMensaje:\n' + MESSAGE);
        process.exit(0);
    } catch (e) {
        console.error('ERROR:', e.message);
        process.exit(1);
    }
})();
