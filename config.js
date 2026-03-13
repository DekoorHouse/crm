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
    process.exit(1);
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const bucket = getStorage().bucket();

// --- CONFIGURACIÓN DEL SERVIDOR EXPRESS ---
const app = express();

// --- SOLUCIÓN DE CORS ---
// Define los orígenes (dominios) que tienen permiso para hacer solicitudes a este servidor.
const allowedOrigins = [
    'https://dekoormx.onrender.com', // El frontend de producción del CRM
    'https://crm-rzon.onrender.com', // El propio backend para auto-llamadas si es necesario
    'http://localhost:3000',        // Para pruebas locales del backend
    'http://127.0.0.1:5500',       // Para desarrollo del frontend con Live Server
    'http://localhost:5500',          // Otra variación común para Live Server
    // Si tienes otra URL de desarrollo, agrégala aquí.
];

// Aplica la configuración de CORS a todas las rutas de la aplicación.
// Esta configuración le dice al servidor que acepte solicitudes únicamente de los
// dominios listados en 'allowedOrigins'. Esto soluciona el error al incluir
// el encabezado 'Access-Control-Allow-Origin' en las respuestas del servidor.
app.use(cors({ origin: allowedOrigins }));
// --- FIN DE LA SOLUCIÓN DE CORS ---

// --- SOLUCIÓN DE PAYLOADS GRANDES ---
// Al convertir imágenes a Base64 pueden superar el megabyte fácilmente, se requiere ampliar el límite
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// El middleware estático debe ir después si queremos que las rutas de la API tengan prioridad
// o manejarse en el index.js principal. Lo dejamos aquí pero movido abajo.
// app.use(express.static(path.join(__dirname, 'public')));

// Logger de Peticiones Globales
app.use((req, res, next) => {
    console.log(`[REQUEST] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
    next();
});

module.exports = { app, db, bucket, admin };
