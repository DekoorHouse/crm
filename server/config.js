require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
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

// --- COMPRESIÓN GZIP/BROTLI ---
app.use(compression());

// --- REQUEST COUNTER (temporal - para medir tráfico) ---
let requestCounter = { count: 0, windowStart: Date.now() };
const requestHistory = []; // últimas ventanas de 15 min
app.use('/api/', (req, res, next) => {
    const now = Date.now();
    if (now - requestCounter.windowStart > 15 * 60 * 1000) {
        const entry = { count: requestCounter.count, from: new Date(requestCounter.windowStart).toLocaleTimeString('es-MX'), to: new Date(now).toLocaleTimeString('es-MX'), date: new Date(requestCounter.windowStart).toLocaleDateString('es-MX') };
        console.log(`[TRAFFIC] ${entry.count} requests (${entry.from} - ${entry.to})`);
        requestHistory.push(entry);
        if (requestHistory.length > 200) requestHistory.shift();
        requestCounter = { count: 0, windowStart: now };
    }
    requestCounter.count++;
    next();
});
app.get('/api/traffic-stats', (req, res) => {
    const elapsed = Math.round((Date.now() - requestCounter.windowStart) / 1000);
    const remaining = Math.max(0, 15 * 60 - elapsed);
    res.json({
        current: { count: requestCounter.count, elapsedSeconds: elapsed, remainingSeconds: remaining },
        history: requestHistory.slice(-50)
    });
});

// --- RATE LIMITING ---
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10000, // máximo 10000 peticiones por IP por ventana
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones, intenta de nuevo en unos minutos.' }
});
app.use('/api/', apiLimiter);

// Rate limit más estricto para checkout/pagos
const checkoutLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Demasiados intentos de pago, intenta más tarde.' }
});
app.use('/api/conekta/', checkoutLimiter);

// --- SECURITY HEADERS ---
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://www.gstatic.com https://pay.conekta.com https://unpkg.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://npmcdn.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net; " +
        "img-src 'self' data: blob: https: http:; " +
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
        "connect-src 'self' https://www.google-analytics.com https://firestore.googleapis.com https://*.firebaseio.com https://*.basemaps.cartocdn.com https://pay.conekta.com https://www.gstatic.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebasestorage.googleapis.com https://graph.facebook.com https://cdn.jsdelivr.net; " +
        "media-src 'self' https: blob:; " +
        "frame-src https://pay.conekta.com; " +
        "object-src 'none'; " +
        "base-uri 'self';"
    );
    next();
});

// --- SOLUCIÓN DE CORS ---
const allowedOrigins = [
    'https://app.dekoormx.com',      // Dominio personalizado de producción
    'https://dekoormx.onrender.com', // El frontend de producción del CRM
    'https://crm-rzon.onrender.com', // El propio backend para auto-llamadas
    'http://localhost:3000',        // Para pruebas locales del backend
    'http://127.0.0.1:5500',       // Para desarrollo del frontend con Live Server
    'http://localhost:5500',          // Otra variación común para Live Server
];

app.use(cors({
    origin: function (origin, callback) {
        // Permitir peticiones sin origen (apps móviles, curl, archivos file://)
        if (!origin || origin === 'null') return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.onrender.com')) {
            callback(null, true);
        } else {
            callback(new Error('No permitido por CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
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
