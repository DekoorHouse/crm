require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const cors = require('cors');
const path = require('path');

// --- CONFIGURACIÓN DE FIREBASE ---
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: 'pedidos-con-gemini.firebasestorage.app'
    });
    console.log('✅ Conexión con Firebase (Firestore y Storage) establecida.');
} catch (error) {
    console.error('❌ ERROR CRÍTICO: No se pudo inicializar Firebase. Revisa la variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON.', error.message);
    process.exit(1); // Detiene la aplicación si Firebase no puede inicializar
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const bucket = getStorage().bucket();

// --- CONFIGURACIÓN DEL SERVIDOR EXPRESS ---
const app = express();

// --- INICIO DE LA CORRECCIÓN DE CORS ---
// Define los orígenes permitidos explícitamente.
const allowedOrigins = [
    'https://dekoormx.onrender.com', // AÑADIDO: Tu nuevo dominio de frontend
    'https://crm-rzon.onrender.com', // Tu dominio principal en Render
    'https://dekoor.onrender.com',   // El subdominio de Render anterior (por si acaso)
    'http://localhost:3000',        // Para pruebas locales
    'http://127.0.0.1:5500',         // Para desarrollo con Live Server
    // Si tienes otros subdominios o dominios personalizados, añádelos aquí.
];

const corsOptions = {
    origin: function (origin, callback) {
        // Permite peticiones sin 'origin' (como Postman o apps móviles) o si el origen está en la lista blanca.
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`CORS: Se bloqueó una solicitud del origen no permitido: ${origin}`);
            callback(new Error('No permitido por CORS'));
        }
    }
};

app.use(cors(corsOptions)); // Usa la nueva configuración de CORS
// --- FIN DE LA CORRECCIÓN DE CORS ---

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

module.exports = { app, db, bucket, admin };
