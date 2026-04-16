/**
 * Script para crear un usuario admin en Firebase Auth.
 * Uso: node scripts/create-admin-user.js <email> <password>
 * Requiere: variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON
 */
require('dotenv').config();
const admin = require('firebase-admin');

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
    console.error('Uso: node scripts/create-admin-user.js <email> <password>');
    process.exit(1);
}

if (password.length < 6) {
    console.error('La contraseña debe tener al menos 6 caracteres.');
    process.exit(1);
}

try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (e) {
    console.error('Error inicializando Firebase Admin. Verifica FIREBASE_SERVICE_ACCOUNT_JSON en .env');
    process.exit(1);
}

(async () => {
    try {
        const user = await admin.auth().createUser({
            email,
            password,
            emailVerified: true
        });
        console.log(`Usuario creado exitosamente:`);
        console.log(`  UID: ${user.uid}`);
        console.log(`  Email: ${user.email}`);
        process.exit(0);
    } catch (error) {
        if (error.code === 'auth/email-already-exists') {
            console.log(`El email ${email} ya existe. Actualizando contraseña...`);
            try {
                const existing = await admin.auth().getUserByEmail(email);
                await admin.auth().updateUser(existing.uid, { password });
                console.log(`Contraseña actualizada para ${email} (UID: ${existing.uid})`);
                process.exit(0);
            } catch (updateError) {
                console.error('Error actualizando:', updateError.message);
                process.exit(1);
            }
        }
        console.error('Error creando usuario:', error.message);
        process.exit(1);
    }
})();
