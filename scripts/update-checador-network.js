/**
 * Actualiza los prefijos de IP autorizados para el checador.
 *
 * Uso:
 *   node scripts/update-checador-network.js                # Lista los prefijos actuales
 *   node scripts/update-checador-network.js add 187.244.64 # Agrega un prefijo
 *   node scripts/update-checador-network.js rm  187.244.64 # Quita un prefijo
 *   node scripts/update-checador-network.js set 2806:267:2484,177.226.102,187.244.64,187.244.65
 *
 * Requiere FIREBASE_SERVICE_ACCOUNT_JSON en .env
 */
require('dotenv').config();
const admin = require('firebase-admin');

try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (e) {
    console.error('Error inicializando Firebase Admin. Verifica FIREBASE_SERVICE_ACCOUNT_JSON en .env');
    process.exit(1);
}

const db = admin.firestore();
const ref = db.collection('config').doc('checador_network');

(async () => {
    const [cmd, arg] = process.argv.slice(2);
    const snap = await ref.get();
    const current = (snap.exists && Array.isArray(snap.data().authorizedPrefixes))
        ? snap.data().authorizedPrefixes
        : [];

    if (!cmd) {
        console.log('Prefijos autorizados actuales:');
        if (current.length === 0) console.log('  (ninguno — usando fallback del código)');
        else current.forEach(p => console.log('  - ' + p));
        process.exit(0);
    }

    let next = [...current];
    if (cmd === 'add') {
        if (!arg) { console.error('Falta el prefijo'); process.exit(1); }
        if (current.includes(arg)) { console.log(`'${arg}' ya estaba en la lista.`); process.exit(0); }
        next.push(arg);
    } else if (cmd === 'rm') {
        if (!arg) { console.error('Falta el prefijo'); process.exit(1); }
        next = current.filter(p => p !== arg);
    } else if (cmd === 'set') {
        if (!arg) { console.error('Falta la lista'); process.exit(1); }
        next = arg.split(',').map(s => s.trim()).filter(Boolean);
    } else {
        console.error('Comando desconocido. Usa: add | rm | set');
        process.exit(1);
    }

    await ref.set({ authorizedPrefixes: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    console.log('Lista actualizada:');
    next.forEach(p => console.log('  - ' + p));
    console.log('\nNota: el backend cachea por 60s. Espera ~1 minuto o reinicia el server para que tome efecto.');
    process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
