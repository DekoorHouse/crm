const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const FormData = require('form-data');
const path = require('path');
// --- INICIO DE MODIFICACIÓN: Se añaden librerías para manejo de archivos y video ---
const fs = require('fs');
const tmp = require('tmp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Configurar la ruta de ffmpeg para que la librería pueda encontrarlo
ffmpeg.setFfmpegPath(ffmpegPath);
// --- FIN DE MODIFICACIÓN ---

const multer = require('multer');
const { db, admin, bucket } = require('./config');
const PRICES = require('./prices');
const { sendConversionEvent, messagingContactInfo, generateGeminiResponse, generateGeminiResponseWithCache, getOrCreateCache, skipAiTimer, cancelPendingAiTimer, sendAdvancedWhatsAppMessage, sendMessengerMessage, messengerMediaSelfTest, sendMessengerUtilityMessage, sendInstagramReaction, invalidateGeminiCache, getMetaSpend, getPedidoAttribution, askGeminiPro, getPurchaseEventTrigger, sendPurchaseEventOnFabricar, markComprobanteValidadoAndSendForm, notifyGuiaToCustomer } = require('./services');
const metaAdsService = require('./meta/metaAdsService');
const { descontarInventarioPorPedido } = require('./inventario/inventarioService');
const { calcularReporte } = require('./inventario/inventarioReporte');
const { ejecutarReporteDiario } = require('./inventario/inventarioScheduler');
const { runScheduledMessagesSweep } = require('./scheduledMessages/scheduledMessagesScheduler');

const router = express.Router();
const uploadRef = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// --- Notificar nueva referencia por WhatsApp ---
router.post('/referencias/notificar', async (req, res) => {
    try {
        const { nombre, ciudad, rating, texto } = req.body;
        const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
        const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
        if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
            return res.json({ ok: true, skipped: true });
        }
        const stars = '⭐'.repeat(rating || 0);
        const msg = `📝 *Nueva referencia recibida*\n\n👤 *${nombre}*\n📍 ${ciudad}\n${stars}\n\n"${texto}"`;
        await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
            messaging_product: 'whatsapp',
            to: '526182297167',
            type: 'text',
            text: { body: msg }
        }, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
        });
        res.json({ ok: true });
    } catch (error) {
        console.error('Error notificando referencia por WhatsApp:', error.response?.data || error.message);
        res.json({ ok: false, error: error.message });
    }
});

// --- Subir foto de referencia (público, sin auth) ---
const sharp = require('sharp');

// Reintenta una operación de Storage ante errores de red transitorios.
// En Render, el token OAuth de Google (https://www.googleapis.com/oauth2/v4/token)
// falla de forma intermitente con "Premature close" / ECONNRESET cuando se reutiliza
// un socket keep-alive que el servidor ya cerró. El token se cachea tras el primer
// éxito, por lo que un reintento inmediato (con socket nuevo) casi siempre resuelve.
async function withStorageRetry(fn, label = 'storage op', retries = 3) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const msg = String((err && err.message) || '');
            const code = err && err.code;
            const transient = /Premature close|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|fetch failed|network|ECONNREFUSED/i.test(msg)
                || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN';
            if (!transient || attempt === retries) throw err;
            console.warn(`[storage-retry] ${label}: intento ${attempt}/${retries} falló (${msg}). Reintentando...`);
            await new Promise(r => setTimeout(r, 400 * attempt));
        }
    }
    throw lastErr;
}

router.post('/referencias/upload', uploadRef.single('foto'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió archivo' });
        const webpBuffer = await sharp(req.file.buffer)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
        const fileName = 'referencias/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.webp';
        const file = bucket.file(fileName);
        // El bucket usa acceso uniforme (UBLA): no se puede (ni hace falta) marcar el
        // objeto como público con ACL. Se sirve luego vía /api/wa/file (URL firmada).
        // resumable:false => una sola petición (más rápido y menos expuesto al fallo de red).
        await withStorageRetry(() => file.save(webpBuffer, {
            metadata: { contentType: 'image/webp' },
            resumable: false
        }), 'subir foto referencia');
        const url = 'https://storage.googleapis.com/' + bucket.name + '/' + fileName;
        res.json({ url });
    } catch (error) {
        console.error('Error subiendo foto de referencia:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Crear referencia (publico, sin auth) ---
// La creacion se hace server-side con admin SDK para que los visitantes (no
// autenticados) puedan publicar sin abrir escritura publica en las reglas de
// Firestore. Se fuerza aprobado=false y la fecha del servidor.
router.post('/referencias/crear', async (req, res) => {
    try {
        const { nombre, ciudad, rating, texto, fotos } = req.body;

        const nombreLimpio = (nombre || '').toString().trim().slice(0, 100);
        const ciudadLimpia = (ciudad || '').toString().trim().slice(0, 100);
        const textoLimpio = (texto || '').toString().trim().slice(0, 2000);
        const ratingNum = parseInt(rating, 10);

        if (!nombreLimpio) return res.status(400).json({ error: 'Escribe tu nombre.' });
        if (!ciudadLimpia) return res.status(400).json({ error: 'Escribe tu ciudad.' });
        if (!textoLimpio) return res.status(400).json({ error: 'Escribe tu opinion.' });
        if (!(ratingNum >= 1 && ratingNum <= 5)) {
            return res.status(400).json({ error: 'Selecciona una calificacion valida.' });
        }

        // Solo aceptar URLs de nuestro propio Storage (las devuelve /referencias/upload)
        const fotosLimpias = Array.isArray(fotos)
            ? fotos.filter(u => typeof u === 'string' && u.startsWith('https://storage.googleapis.com/')).slice(0, 5)
            : [];

        const docRef = await db.collection('referencias').add({
            nombre: nombreLimpio,
            ciudad: ciudadLimpia,
            rating: ratingNum,
            texto: textoLimpio,
            foto: fotosLimpias[0] || '',
            fotos: fotosLimpias,
            fecha: admin.firestore.FieldValue.serverTimestamp(),
            aprobado: false
        });

        res.json({ id: docRef.id });
    } catch (error) {
        console.error('Error creando referencia:', error);
        res.status(500).json({ error: 'No se pudo publicar la referencia.' });
    }
});

// --- Rotar foto de referencia ---
router.post('/referencias/rotate', async (req, res) => {
    try {
        const { refId, photoIndex, direction } = req.body;
        if (!refId || photoIndex === undefined) return res.status(400).json({ error: 'Faltan parámetros' });

        const docRef = db.collection('referencias').doc(refId);
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ error: 'Referencia no encontrada' });

        const data = doc.data();
        const fotos = data.fotos || (data.foto ? [data.foto] : []);
        if (photoIndex < 0 || photoIndex >= fotos.length) return res.status(400).json({ error: 'Índice inválido' });

        const oldUrl = fotos[photoIndex];
        // Descargar imagen desde el bucket. Las URLs públicas storage.googleapis.com
        // dan 403 con UBLA, así que se baja el objeto con la cuenta de servicio.
        const marker = `storage.googleapis.com/${bucket.name}/`;
        const markerIdx = oldUrl.indexOf(marker);
        let srcBuffer;
        if (markerIdx >= 0) {
            const oldPath = decodeURIComponent(oldUrl.slice(markerIdx + marker.length).split('?')[0]);
            const [buf] = await withStorageRetry(() => bucket.file(oldPath).download(), 'descargar foto referencia');
            srcBuffer = buf;
        } else {
            const response = await axios.get(oldUrl, { responseType: 'arraybuffer' });
            srcBuffer = Buffer.from(response.data);
        }
        const angle = direction === 'ccw' ? -90 : 90;
        const rotatedBuffer = await sharp(srcBuffer)
            .rotate(angle)
            .webp({ quality: 80 })
            .toBuffer();

        // Subir con nuevo nombre
        const fileName = 'referencias/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.webp';
        const file = bucket.file(fileName);
        await withStorageRetry(() => file.save(rotatedBuffer, {
            metadata: { contentType: 'image/webp' },
            resumable: false
        }), 'subir foto rotada');
        const newUrl = 'https://storage.googleapis.com/' + bucket.name + '/' + fileName;

        // Actualizar Firestore
        fotos[photoIndex] = newUrl;
        if (data.fotos) {
            await docRef.update({ fotos });
        } else {
            await docRef.update({ foto: newUrl });
        }

        res.json({ url: newUrl });
    } catch (error) {
        console.error('Error rotando foto:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Validación de ubicación / red autorizada para checador ---
// Modo principal: GPS (geofence). Si el doc Firestore tiene `officeLocation`
// con lat/lng/radiusMeters, se valida la distancia entre el celular y la
// oficina (fórmula de Haversine). Si no hay `officeLocation`, cae al modo
// legacy de validación por IP usando `authorizedPrefixes`.
const CHECADOR_FALLBACK_PREFIXES = ['2806:267:2484', '177.226.102', '187.244.64', '187.244.65'];
const CHECADOR_DEFAULT_RADIUS_M = 100;
const CHECADOR_DEFAULT_MAX_ACCURACY_M = 200;
let checadorConfigCache = { value: null, timestamp: 0 };
const CHECADOR_CONFIG_TTL_MS = 60 * 1000;

function parseOfficeLocation(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const radiusMeters = Number.isFinite(Number(raw.radiusMeters)) && Number(raw.radiusMeters) > 0
        ? Number(raw.radiusMeters)
        : CHECADOR_DEFAULT_RADIUS_M;
    const maxAccuracyMeters = Number.isFinite(Number(raw.maxAccuracyMeters)) && Number(raw.maxAccuracyMeters) > 0
        ? Number(raw.maxAccuracyMeters)
        : CHECADOR_DEFAULT_MAX_ACCURACY_M;
    return { lat, lng, radiusMeters, maxAccuracyMeters };
}

async function getCheckadorConfig() {
    const now = Date.now();
    if (checadorConfigCache.value && now - checadorConfigCache.timestamp < CHECADOR_CONFIG_TTL_MS) {
        return checadorConfigCache.value;
    }
    try {
        const doc = await db.collection('config').doc('checador_network').get();
        const data = doc.exists ? doc.data() : null;
        const config = {
            authorizedPrefixes: Array.isArray(data?.authorizedPrefixes) && data.authorizedPrefixes.length > 0
                ? data.authorizedPrefixes
                : CHECADOR_FALLBACK_PREFIXES,
            officeLocation: parseOfficeLocation(data?.officeLocation),
            allowGpsBypassNames: Array.isArray(data?.allowGpsBypassNames)
                ? data.allowGpsBypassNames.map(s => String(s).toLowerCase())
                : []
        };
        checadorConfigCache = { value: config, timestamp: now };
        return config;
    } catch (err) {
        console.warn('[CHECADOR-NETWORK] Error leyendo config, usando fallback:', err.message);
        return {
            authorizedPrefixes: CHECADOR_FALLBACK_PREFIXES,
            officeLocation: null,
            allowGpsBypassNames: []
        };
    }
}

function getCheckadorClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
        const first = xff.split(',')[0].trim();
        if (first) return first;
    }
    return req.ip || req.connection?.remoteAddress || '';
}

// Distancia en metros entre dos coordenadas (Haversine).
function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

router.get('/checador/check-network', async (req, res) => {
    // Evitar cualquier caché intermedio (browser, CDN, proxy)
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    try {
        const ip = getCheckadorClientIp(req);
        const config = await getCheckadorConfig();
        const ua = (req.headers['user-agent'] || '').slice(0, 80);

        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        const accuracy = parseFloat(req.query.accuracy);
        const hasGps = Number.isFinite(lat) && Number.isFinite(lng);

        // --- Modo GPS (geofence) ---
        if (config.officeLocation) {
            if (!hasGps) {
                console.log(`[CHECADOR-NETWORK] Sin GPS. ip=${ip} ua=${ua}`);
                return res.json({
                    authorized: false,
                    mode: 'gps',
                    reason: 'no-gps',
                    ip
                });
            }
            const accFinite = Number.isFinite(accuracy) ? accuracy : null;
            // Si la precisión reportada es peor que el máximo permitido, rechaza
            // para evitar falsos positivos con posiciones imprecisas.
            if (accFinite !== null && accFinite > config.officeLocation.maxAccuracyMeters) {
                console.log(`[CHECADOR-NETWORK] Precisión baja. ip=${ip} acc=${Math.round(accFinite)}m max=${config.officeLocation.maxAccuracyMeters}m`);
                return res.json({
                    authorized: false,
                    mode: 'gps',
                    reason: 'low-accuracy',
                    accuracy: Math.round(accFinite),
                    maxAccuracy: config.officeLocation.maxAccuracyMeters,
                    ip
                });
            }
            const distance = haversineMeters(
                lat, lng,
                config.officeLocation.lat, config.officeLocation.lng
            );
            const radius = config.officeLocation.radiusMeters;
            const authorized = distance <= radius;
            if (!authorized) {
                console.log(`[CHECADOR-NETWORK] Fuera de oficina. ip=${ip} dist=${Math.round(distance)}m radio=${radius}m acc=${accFinite ?? '?'}m`);
            }
            return res.json({
                authorized,
                mode: 'gps',
                distance: Math.round(distance),
                radius,
                accuracy: accFinite !== null ? Math.round(accFinite) : null,
                ip
            });
        }

        // --- Modo legacy: validación por IP ---
        const authorized = !!ip && config.authorizedPrefixes.some(p => ip.startsWith(p));
        if (!authorized) {
            console.log(`[CHECADOR-NETWORK] No autorizado (IP). ip=${ip} xff=${req.headers['x-forwarded-for'] || '-'} ua=${ua}`);
        }
        res.json({ authorized, mode: 'ip', ip });
    } catch (err) {
        console.error('[CHECADOR-NETWORK] Error:', err);
        res.status(500).json({ authorized: false, error: 'Error verificando red' });
    }
});

// --- Subir foto de perfil (checador) ---
router.post('/checador/avatar', uploadRef.single('foto'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envio archivo' });
        const empId = req.body.empId;
        const docId = req.body.docId;
        if (!empId || !docId) return res.status(400).json({ error: 'Falta empId o docId' });
        const webpBuffer = await sharp(req.file.buffer)
            .resize(400, 400, { fit: 'cover' })
            .webp({ quality: 80 })
            .toBuffer();
        const fileName = `checador/avatars/${empId}.webp`;
        const file = bucket.file(fileName);
        await file.save(webpBuffer, {
            metadata: { contentType: 'image/webp' },
            public: true
        });
        const url = 'https://storage.googleapis.com/' + bucket.name + '/' + fileName;
        await db.collection('checador_employees').doc(docId).update({ photoURL: url });
        res.json({ url });
    } catch (error) {
        console.error('Error subiendo avatar:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Enviar reporte semanal individual por WhatsApp ---
router.post('/checador/whatsapp-report', async (req, res) => {
    try {
        const { phone, name, report } = req.body;
        if (!phone || !name || !report) return res.status(400).json({ error: 'Faltan datos' });
        const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
        const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
        if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return res.json({ ok: false, error: 'WhatsApp no configurado' });

        // Formatear numero (agregar 521 si es local)
        let to = phone.replace(/\D/g, '');
        if (to.length === 10) to = '52' + to;

        await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: report }
        }, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
        });
        res.json({ ok: true });
    } catch (error) {
        console.error('Error enviando reporte checador:', error.response?.data || error.message);
        res.json({ ok: false, error: error.message });
    }
});

// --- Mapa de entregas (Google Sheets, agrupado por estado) ---
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1ggvTcOJtasfk0sz4KRSXSUSIfko62AtxfTKhRyKkkCk/export?format=csv';
let mapaCache = { data: null, timestamp: 0 };

// Coordenadas de estados mexicanos (centroides) con variantes
const ESTADO_COORDS_RAW = {
    'aguascalientes': {lat:21.88,lng:-102.29},
    'baja california': {lat:30.84,lng:-115.28},
    'baja california sur': {lat:25.04,lng:-111.66},
    'campeche': {lat:19.83,lng:-90.53},
    'chiapas': {lat:16.75,lng:-93.12},
    'chihuahua': {lat:28.63,lng:-106.09},
    'ciudad de mexico': {lat:19.43,lng:-99.13},
    'coahuila': {lat:25.42,lng:-100.99},
    'colima': {lat:19.24,lng:-103.72},
    'durango': {lat:24.02,lng:-104.67},
    'guanajuato': {lat:21.02,lng:-101.26},
    'guerrero': {lat:17.44,lng:-99.55},
    'hidalgo': {lat:20.09,lng:-98.76},
    'jalisco': {lat:20.66,lng:-103.35},
    'mexico': {lat:19.29,lng:-99.65},
    'michoacan': {lat:19.57,lng:-101.71},
    'morelos': {lat:18.68,lng:-99.10},
    'nayarit': {lat:21.75,lng:-104.85},
    'nuevo leon': {lat:25.67,lng:-100.31},
    'oaxaca': {lat:17.07,lng:-96.73},
    'puebla': {lat:19.04,lng:-98.21},
    'queretaro': {lat:20.59,lng:-100.39},
    'quintana roo': {lat:19.18,lng:-88.48},
    'san luis potosi': {lat:22.15,lng:-100.98},
    'sinaloa': {lat:24.81,lng:-107.39},
    'sonora': {lat:29.07,lng:-110.96},
    'tabasco': {lat:17.99,lng:-92.93},
    'tamaulipas': {lat:24.27,lng:-98.84},
    'tlaxcala': {lat:19.32,lng:-98.24},
    'veracruz': {lat:19.17,lng:-96.13},
    'yucatan': {lat:20.97,lng:-89.62},
    'zacatecas': {lat:22.77,lng:-102.58}
};
// Aliases
const ESTADO_ALIASES = {
    'cdmx': 'ciudad de mexico', 'df': 'ciudad de mexico', 'distrito federal': 'ciudad de mexico',
    'estado de mexico': 'mexico', 'edomex': 'mexico', 'edo mex': 'mexico', 'edo. mex.': 'mexico', 'edo de mexico': 'mexico',
    'coahuila de zaragoza': 'coahuila', 'michoacan de ocampo': 'michoacan',
    'veracruz de ignacio de la llave': 'veracruz', 'ver': 'veracruz',
    'nuevo leon': 'nuevo leon', 'nl': 'nuevo leon', 'n.l.': 'nuevo leon', 'n l': 'nuevo leon',
    'qro': 'queretaro', 'q. roo': 'quintana roo', 'q roo': 'quintana roo',
    'slp': 'san luis potosi', 's.l.p.': 'san luis potosi',
    'bc': 'baja california', 'bcs': 'baja california sur',
    'ags': 'aguascalientes', 'gto': 'guanajuato', 'jal': 'jalisco',
    'mich': 'michoacan', 'mor': 'morelos', 'nay': 'nayarit',
    'oax': 'oaxaca', 'pue': 'puebla', 'sin': 'sinaloa', 'son': 'sonora',
    'tab': 'tabasco', 'tam': 'tamaulipas', 'tamps': 'tamaulipas',
    'tlax': 'tlaxcala', 'yuc': 'yucatan', 'zac': 'zacatecas',
    'chis': 'chiapas', 'chih': 'chihuahua', 'col': 'colima',
    'dgo': 'durango', 'gro': 'guerrero', 'hgo': 'hidalgo',
    'camp': 'campeche', 'cam': 'campeche'
};

function normalizeEstado(raw) {
    const n = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, '').trim();
    if (ESTADO_COORDS_RAW[n]) return n;
    if (ESTADO_ALIASES[n]) return ESTADO_ALIASES[n];
    // Fuzzy: check if any key is contained in the value
    for (const [alias, target] of Object.entries(ESTADO_ALIASES)) {
        if (n.includes(alias) || alias.includes(n)) return target;
    }
    for (const key of Object.keys(ESTADO_COORDS_RAW)) {
        if (n.includes(key) || key.includes(n)) return key;
    }
    return null;
}

// Coordenadas de ciudades mexicanas (lat, lng)
const CIUDAD_COORDS = {
    // Estado de México
    'naucalpan':{lat:19.4784,lng:-99.2398},'cuautitlan izcalli':{lat:19.6474,lng:-99.2118},
    'toluca':{lat:19.2826,lng:-99.6557},'tlalnepantla':{lat:19.5440,lng:-99.1945},
    'ecatepec':{lat:19.6010,lng:-99.0500},'chimalhuacan':{lat:19.4275,lng:-98.9581},
    'nezahualcoyotl':{lat:19.4007,lng:-99.0145},'zumpango':{lat:19.7954,lng:-99.0993},
    'tecamac':{lat:19.7130,lng:-98.9687},'huixquilucan':{lat:19.3591,lng:-99.3517},
    'atizapan de zaragoza':{lat:19.5578,lng:-99.2542},'chalco':{lat:19.2646,lng:-98.8975},
    'lerma':{lat:19.2844,lng:-99.5119},'zinacantepec':{lat:19.2847,lng:-99.7357},
    'apaxco':{lat:19.9756,lng:-99.1664},'iztapaluca':{lat:19.3173,lng:-98.8827},
    'temoaya':{lat:19.4684,lng:-99.5932},'cuajimalpa':{lat:19.3586,lng:-99.2929},
    'acambay':{lat:19.9539,lng:-99.8442},'valle de chalco':{lat:19.2724,lng:-98.9372},
    'san pedro atzompa':{lat:19.5359,lng:-99.6903},'almoloya de juarez':{lat:19.3720,lng:-99.7525},
    // Ciudad de México
    'iztapalapa':{lat:19.3553,lng:-99.0574},'miguel hidalgo':{lat:19.4328,lng:-99.1937},
    'alvaro obregon':{lat:19.3550,lng:-99.2032},'coyoacan':{lat:19.3467,lng:-99.1617},
    'tlalpan':{lat:19.2897,lng:-99.1680},'benito juarez':{lat:19.3714,lng:-99.1598},
    'tlahuac':{lat:19.2869,lng:-99.0059},'azcapotzalco':{lat:19.4869,lng:-99.1838},
    'polanco':{lat:19.4333,lng:-99.1975},'cuauhtemoc':{lat:19.4320,lng:-99.1561},
    // Veracruz
    'veracruz':{lat:19.1738,lng:-96.1342},'xalapa':{lat:19.5438,lng:-96.9102},
    'cordoba':{lat:18.8844,lng:-96.9337},'minatitlan':{lat:17.9932,lng:-94.5556},
    'poza rica':{lat:20.5332,lng:-97.4596},'orizaba':{lat:18.8501,lng:-97.0999},
    'coatzacoalcos':{lat:18.1348,lng:-94.4587},'martinez de la torre':{lat:20.0693,lng:-97.0553},
    'nogales':{lat:18.8236,lng:-97.1574},'las choapas':{lat:17.9164,lng:-94.1022},
    // Baja California
    'tijuana':{lat:32.5149,lng:-117.0382},'ensenada':{lat:31.8667,lng:-116.5964},
    'mexicali':{lat:32.6245,lng:-115.4523},'tecate':{lat:32.5721,lng:-116.6262},
    // Jalisco
    'guadalajara':{lat:20.6597,lng:-103.3496},'zapopan':{lat:20.7231,lng:-103.3839},
    'tlaquepaque':{lat:20.6419,lng:-103.3118},'puerto vallarta':{lat:20.6534,lng:-105.2253},
    'tlajomulco':{lat:20.4727,lng:-103.4443},'chapalita':{lat:20.6685,lng:-103.3972},
    // Guanajuato
    'leon':{lat:21.1250,lng:-101.6860},'irapuato':{lat:20.6768,lng:-101.3556},
    'villagran':{lat:20.5155,lng:-100.9946},
    // Nuevo León
    'monterrey':{lat:25.6866,lng:-100.3161},'apodaca':{lat:25.7817,lng:-100.1884},
    'guadalupe':{lat:25.6771,lng:-100.2594},'garcia':{lat:25.8050,lng:-100.5910},
    // Quintana Roo
    'cancun':{lat:21.1619,lng:-86.8515},'playa del carmen':{lat:20.6296,lng:-87.0739},
    'solidaridad':{lat:20.6296,lng:-87.0739},
    // San Luis Potosí
    'san luis potosi':{lat:22.1565,lng:-100.9855},'soledad de graciano sanchez':{lat:22.1833,lng:-100.9289},
    'ciudad valles':{lat:21.9864,lng:-99.0119},'ebano':{lat:22.2244,lng:-98.3850},
    // Chihuahua
    'chihuahua':{lat:28.6353,lng:-106.0889},'ciudad juarez':{lat:31.6904,lng:-106.4245},
    'hidalgo del parral':{lat:26.9319,lng:-105.6671},'delicias':{lat:28.1901,lng:-105.4710},
    // Coahuila
    'saltillo':{lat:25.4232,lng:-100.9924},'torreon':{lat:25.5428,lng:-103.4068},
    'monclova':{lat:26.9063,lng:-101.4213},
    // Puebla
    'puebla':{lat:19.0414,lng:-98.2063},'san andres cholula':{lat:19.0529,lng:-98.2985},
    'coronango':{lat:19.1553,lng:-98.3062},
    // Sinaloa
    'mazatlan':{lat:23.2494,lng:-106.4111},'culiacan':{lat:24.7994,lng:-107.3940},
    'escuinapa':{lat:22.8483,lng:-105.7667},'los mochis':{lat:25.7905,lng:-108.9935},
    // Tamaulipas
    'matamoros':{lat:25.8693,lng:-97.5024},'ciudad victoria':{lat:23.7369,lng:-99.1411},
    'nuevo laredo':{lat:27.4761,lng:-99.5065},'reynosa':{lat:26.0509,lng:-98.2973},
    'rio bravo':{lat:25.9869,lng:-98.0942},
    // Michoacán
    'morelia':{lat:19.7060,lng:-101.1950},'maravatio':{lat:19.8889,lng:-100.4450},
    'la piedad':{lat:20.3461,lng:-102.0342},'tacambaro':{lat:19.2345,lng:-101.4585},
    // Yucatán
    'merida':{lat:20.9674,lng:-89.5926},'uman':{lat:20.8832,lng:-89.7417},
    'kanasin':{lat:20.9351,lng:-89.5571},
    // Hidalgo
    'tula de allende':{lat:20.0543,lng:-99.3418},'tezontepec de aldama':{lat:20.1893,lng:-99.2753},
    'mineral de la reforma':{lat:20.0728,lng:-98.6968},
    // Baja California Sur
    'los cabos':{lat:22.8905,lng:-109.9167},'san jose del cabo':{lat:23.0586,lng:-109.7008},
    'san jose':{lat:23.0586,lng:-109.7008},
    // Guerrero
    'acapulco':{lat:16.8634,lng:-99.8901},
    // Sonora
    'hermosillo':{lat:29.0729,lng:-110.9559},'san luis rio colorado':{lat:32.4563,lng:-114.7719},
    // Morelos
    'jiutepec':{lat:18.8833,lng:-99.1736},'yautepec':{lat:18.8783,lng:-99.0681},
    'cuautla':{lat:18.8122,lng:-98.9544},
    // Aguascalientes
    'aguascalientes':{lat:21.8818,lng:-102.2916},
    // Colima
    'manzanillo':{lat:19.1131,lng:-104.3381},
    // Zacatecas
    'fresnillo':{lat:23.1750,lng:-102.8700},
    // Querétaro
    'queretaro':{lat:20.5888,lng:-100.3899},'el marques':{lat:20.6169,lng:-100.2922},
};

// Aliases para normalizar nombres de ciudades con variantes
const CIUDAD_ALIASES = {
    'cd juarez':'ciudad juarez','cuidad juarez':'ciudad juarez','cd victoria':'ciudad victoria',
    'h matamoros':'matamoros','h. matamoros':'matamoros',
    'naucalpan de juarez':'naucalpan','naucalpan de juárez':'naucalpan',
    'ecatepec de morelos':'ecatepec','tlalnepantla de baz':'tlalnepantla',
    'acapulco de juarez':'acapulco','acapulco de juárez':'acapulco',
    'valle de chalco solidaridad':'valle de chalco',
    'san diego churubusco coyoacan':'coyoacan',
    'guadalajara jalisco':'guadalajara','xalapa veracruz':'xalapa',
    'xalapa enriquez':'xalapa','minatitlan ver':'minatitlan',
    'matamoros tamaulipas':'matamoros','san andres cholula puebla':'san andres cholula',
    'coronango puebla':'coronango','ensenada bc':'ensenada','tijuana bc':'tijuana',
    'cancun qr':'cancun','cancun benito juarez':'cancun','cancun q r':'cancun',
    'leon guanajuato':'leon','merida yucatan':'merida',
    'huixquilucan edomex':'huixquilucan','huixquilucan edo mex':'huixquilucan',
    'iztapaluca estado mexico':'iztapaluca','san pedro tlaquepaque':'tlaquepaque',
    'acambay de ruiz castaneda':'acambay','alcaldia miguel hidalgo':'miguel hidalgo',
    'san rafael chamapa cuarta seccion':'naucalpan',
    'soledad de graciano sanchez':'soledad de graciano sanchez',
    'atizapan de zaragoza':'atizapan de zaragoza',
    'cuautitlan izcalli':'cuautitlan izcalli',
};

function normalizeCiudad(raw) {
    let n = raw.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, '').trim();
    // Remove trailing state names
    n = n.replace(/\s+(ver|veracruz|jalisco|puebla|yucatan|tamaulipas|guanajuato|bc|qr|q r|edo\s*mex|estado\s*mexico)$/g, '').trim();
    if (CIUDAD_ALIASES[n]) return CIUDAD_ALIASES[n];
    if (CIUDAD_COORDS[n]) return n;
    // Partial match
    for (const key of Object.keys(CIUDAD_COORDS)) {
        if (n.includes(key) && key.length >= 4) return key;
    }
    for (const key of Object.keys(CIUDAD_COORDS)) {
        if (key.includes(n) && n.length >= 4) return key;
    }
    return n;
}

function getCiudadCoords(normCity, normState) {
    // State-specific overrides for ambiguous names
    if (normCity === 'benito juarez' && normState === 'quintana roo') return CIUDAD_COORDS['cancun'];
    if (normCity === 'juarez' && normState === 'chihuahua') return CIUDAD_COORDS['ciudad juarez'];
    if (normCity === 'juarez' && normState === 'nuevo leon') return {lat:25.6479,lng:-100.0955};
    // Direct lookup
    if (CIUDAD_COORDS[normCity]) return CIUDAD_COORDS[normCity];
    // Fallback: state centroid with deterministic offset
    if (normState && ESTADO_COORDS_RAW[normState]) {
        const sc = ESTADO_COORDS_RAW[normState];
        let hash = 0;
        for (let i = 0; i < normCity.length; i++) hash = ((hash << 5) - hash) + normCity.charCodeAt(i);
        return { lat: sc.lat + ((hash % 100) / 400) - 0.125, lng: sc.lng + (((hash >> 8) % 100) / 400) - 0.125 };
    }
    return null;
}

function parseCSV(text) {
    const lines = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === '\n' && !inQuotes) { lines.push(current); current = ''; }
        else { current += ch; }
    }
    if (current) lines.push(current);
    return lines.map(line => {
        const cols = []; let col = ''; let q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { q = !q; }
            else if (c === ',' && !q) { cols.push(col.trim()); col = ''; }
            else if (c !== '\r') { col += c; }
        }
        cols.push(col.trim());
        return cols;
    });
}

// Referencias aprobadas para el carrusel del home del sitio público.
// Evita que la landing cargue el SDK completo de Firebase solo para esto.
let referenciasHomeCache = { data: null, timestamp: 0 };
router.get('/referencias/home', async (req, res) => {
    try {
        // Cache en memoria 10 min
        if (referenciasHomeCache.data && Date.now() - referenciasHomeCache.timestamp < 10 * 60 * 1000) {
            return res.json(referenciasHomeCache.data);
        }
        const snap = await db.collection('referencias')
            .where('aprobado', '==', true)
            .orderBy('fecha', 'desc')
            .limit(30)
            .get();
        const refs = snap.docs.map(doc => {
            const r = doc.data();
            return {
                nombre: r.nombre || '',
                ciudad: r.ciudad || '',
                rating: Number(r.rating) || 5,
                texto: r.texto || '',
                foto: r.foto || '',
                fotos: Array.isArray(r.fotos) ? r.fotos : []
            };
        });
        referenciasHomeCache = { data: refs, timestamp: Date.now() };
        res.json(refs);
    } catch (error) {
        console.error('[REFERENCIAS HOME] Error:', error.message);
        res.status(500).json({ error: 'Error cargando referencias' });
    }
});

router.get('/referencias/mapa', async (req, res) => {
    try {
        // Cache en memoria 2h
        if (mapaCache.data && Date.now() - mapaCache.timestamp < 2 * 60 * 60 * 1000) {
            return res.json(mapaCache.data);
        }

        const csvRes = await axios.get(SHEET_CSV_URL, { timeout: 15000 });
        const rows = parseCSV(csvRes.data);
        if (rows.length < 2) return res.json([]);

        // Detectar columnas dinámicamente
        const header = rows[0];
        let estadoIdx = header.findIndex(h => h.toLowerCase().trim() === 'estado');
        if (estadoIdx === -1) estadoIdx = 14;
        let ciudadIdx = header.findIndex(h => h.toLowerCase().trim().includes('ciudad'));
        if (ciudadIdx === -1) ciudadIdx = estadoIdx - 2; // fallback: 2 cols antes de estado

        const stateGroups = {};
        const cityGroups = {};
        let totalEntregas = 0;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const estadoRaw = (row[estadoIdx] || '').trim();
            const ciudadRaw = (row[ciudadIdx] || '').trim();
            if (!estadoRaw) continue;
            totalEntregas++;

            // Agrupación por estado
            const stateKey = estadoRaw.toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z ]/g, '').trim();
            if (!stateGroups[stateKey]) stateGroups[stateKey] = { estado: estadoRaw, count: 0 };
            stateGroups[stateKey].count++;

            // Agrupación por ciudad
            if (ciudadRaw && ciudadRaw.length >= 2) {
                const normState = normalizeEstado(estadoRaw);
                const normCity = normalizeCiudad(ciudadRaw);
                const cityKey = normCity + '|' + (normState || stateKey);
                if (!cityGroups[cityKey]) {
                    cityGroups[cityKey] = { ciudad: ciudadRaw, estadoNorm: normState, estadoRaw, normCity, count: 0 };
                }
                cityGroups[cityKey].count++;
            }
        }

        // Resolver estados
        const canonical = {};
        for (const g of Object.values(stateGroups)) {
            const norm = normalizeEstado(g.estado);
            if (!norm) continue;
            if (!canonical[norm]) canonical[norm] = { estado: norm.charAt(0).toUpperCase() + norm.slice(1), count: 0 };
            canonical[norm].count += g.count;
        }
        const stateResults = [];
        for (const g of Object.values(canonical)) {
            const key = g.estado.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const coords = ESTADO_COORDS_RAW[key];
            if (coords) stateResults.push({ estado: g.estado, count: g.count, lat: coords.lat, lng: coords.lng });
        }

        // Resolver ciudades con coordenadas
        const cityResults = [];
        for (const g of Object.values(cityGroups)) {
            const coords = getCiudadCoords(g.normCity, g.estadoNorm);
            if (!coords) continue;
            let displayCity = g.ciudad.replace(/\s*-\s*[A-Z]{2,3}\s*$/g, '').trim();
            displayCity = displayCity.charAt(0).toUpperCase() + displayCity.slice(1);
            let displayState = g.estadoRaw.replace(/\s*-\s*[A-Z]{2,3}\s*$/g, '').trim();
            cityResults.push({ ciudad: displayCity, estado: displayState, count: g.count, lat: coords.lat, lng: coords.lng });
        }

        const response = {
            estados: stateResults, ciudades: cityResults,
            totalEntregas, totalEstados: stateResults.length, totalCiudades: cityResults.length
        };
        mapaCache = { data: response, timestamp: Date.now() };
        res.json(response);
    } catch (error) {
        console.error('Error generando mapa:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- PEDIDOS RECIENTES (público, para feed en referencias) ---
let pedidosRecientesCache = { data: null, timestamp: 0 };

router.get('/pedidos-recientes', async (req, res) => {
    try {
        // Cache 5 minutos
        if (pedidosRecientesCache.data && Date.now() - pedidosRecientesCache.timestamp < 5 * 60 * 1000) {
            return res.json(pedidosRecientesCache.data);
        }

        const snapshot = await db.collection('datos_envio')
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();

        if (snapshot.empty) return res.json([]);

        // Buscar producto en pedidos (doc ID = numeroPedido)
        const pedidoIds = snapshot.docs.map(d => d.data().numeroPedido).filter(Boolean);
        const pedidosMap = {};
        const chunks = [];
        for (let i = 0; i < pedidoIds.length; i += 10) {
            chunks.push(pedidoIds.slice(i, i + 10));
        }
        await Promise.all(chunks.map(async (chunk) => {
            const promises = chunk.map(id => db.collection('pedidos').doc(id).get());
            const docs = await Promise.all(promises);
            docs.forEach(doc => {
                if (doc.exists) pedidosMap[doc.id] = doc.data();
            });
        }));

        const result = snapshot.docs.map(doc => {
            const d = doc.data();
            const primerNombre = (d.nombreCompleto || '').split(' ')[0];
            const pedido = pedidosMap[d.numeroPedido] || {};
            return {
                nombre: primerNombre,
                ciudad: d.ciudad || '',
                estado: d.estado || '',
                producto: pedido.producto || '',
                fecha: d.createdAt ? d.createdAt.toDate().toISOString() : null,
            };
        }).filter(d => d.nombre && d.ciudad && d.estado && d.fecha);

        pedidosRecientesCache = { data: result, timestamp: Date.now() };
        res.json(result);
    } catch (error) {
        console.error('Error pedidos recientes:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Helper para procesar pedidos y adjuntar info de contacto/anuncio ---
async function processOrdersData(ordersSnapshot) {
    // Recopilar IDs de contacto únicos
    const contactIds = new Set();
    ordersSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const contactId = data.contactId || data.telefono;
        if (contactId) contactIds.add(contactId);
    });

    // Traer todos los contactos en paralelo (un solo batch)
    const contactsMap = {};
    if (contactIds.size > 0) {
        const contactPromises = [...contactIds].map(id =>
            db.collection('contacts_whatsapp').doc(id).get()
        );
        const contactDocs = await Promise.all(contactPromises);
        contactDocs.forEach(doc => {
            if (doc.exists) contactsMap[doc.id] = doc.data();
        });
    }

    // Construir orders usando el mapa de contactos
    return ordersSnapshot.docs.map(doc => {
        const orderData = doc.data();
        const contactId = orderData.contactId || orderData.telefono;
        const contactData = contactsMap[contactId];
        let clientName = 'Sin nombre';
        let adSource = 'Desconocido';

        if (contactData) {
            clientName = contactData.name || clientName;
            if (contactData.adReferral) {
                adSource = contactData.adReferral.ad_name || contactData.adReferral.source_id || adSource;
            }
        }

        return {
            id: doc.id,
            consecutiveOrderNumber: orderData.consecutiveOrderNumber,
            clientName,
            total: orderData.precio || 0,
            createdAt: orderData.createdAt ? orderData.createdAt.toDate() : null,
            adSource,
            producto: orderData.producto,
            estatus: orderData.estatus || 'Sin estatus'
        };
    });
}

// --- Helper para generar snapshot diario de KPIs ---
async function generateDailySnapshot(dateISO) {
    const start = new Date(dateISO + 'T00:00:00-06:00'); // Hora México
    const end = new Date(dateISO + 'T23:59:59-06:00');
    const firestoreStart = admin.firestore.Timestamp.fromDate(start);
    const firestoreEnd = admin.firestore.Timestamp.fromDate(end);

    const ordersSnap = await db.collection('pedidos')
        .where('createdAt', '>=', firestoreStart)
        .where('createdAt', '<=', firestoreEnd)
        .get();

    let proyectado = 0;
    let real = 0;
    let totalOrders = 0;
    let confirmedOrders = 0;

    ordersSnap.docs.forEach(doc => {
        const data = doc.data();
        const amount = parseFloat(data.precio) || 0;
        const rawStatus = (data.estatus || '').toLowerCase();

        proyectado += amount;
        totalOrders++;

        if (rawStatus.includes('fabricar') || rawStatus.includes('pagado')) {
            real += amount;
            confirmedOrders++;
        }
    });

    // Obtener gasto publicitario
    let adSpend = 0;
    try {
        const metaSpend = await getMetaSpend(dateISO, '1890131678412987');
        if (metaSpend !== null) {
            adSpend = metaSpend;
        } else {
            const kpiDoc = await db.collection('daily_kpis').doc(dateISO).get();
            if (kpiDoc.exists) {
                adSpend = kpiDoc.data().costo_publicidad || 0;
            }
        }
    } catch (e) {
        console.error('[SNAPSHOT] Error obteniendo ad spend:', e.message);
    }

    const efectividadPedidos = totalOrders > 0 ? (confirmedOrders / totalOrders) * 100 : 0;
    const efectividadDinero = proyectado > 0 ? (real / proyectado) * 100 : 0;
    const roas = adSpend > 0 ? (real / adSpend) : 0;

    return {
        date: dateISO,
        proyectado: Math.round(proyectado * 100) / 100,
        real: Math.round(real * 100) / 100,
        totalOrders,
        confirmedOrders,
        efectividadPedidos: Math.round(efectividadPedidos * 10) / 10,
        efectividadDinero: Math.round(efectividadDinero * 10) / 10,
        adSpend: Math.round(adSpend * 100) / 100,
        roas: Math.round(roas * 10) / 10
    };
}

// --- Endpoint GET /api/orders/list (Pedidos paginados con cursor) ---
router.get('/orders/list', async (req, res) => {
    try {
        const { limit = 50, startAfterId, producto, estatus, dateFilter, customStart, customEnd } = req.query;
        const pageLimit = Math.min(Number(limit) || 50, 100);

        let query = db.collection('pedidos');

        if (producto) query = query.where('producto', '==', producto);
        if (estatus) query = query.where('estatus', '==', estatus);

        // Date range filtering
        const getMexicoDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

        if (dateFilter === 'personalizado' && customStart && customEnd) {
            query = query.where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(Number(customStart)));
            query = query.where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(Number(customEnd)));
        } else if (dateFilter) {
            const mexicoDate = getMexicoDate();
            let startDate, endDate;

            if (dateFilter === 'hoy') {
                startDate = new Date(mexicoDate + 'T00:00:00-06:00');
                endDate = new Date(mexicoDate + 'T23:59:59.999-06:00');
            } else if (dateFilter === 'ayer') {
                const yesterday = new Date(mexicoDate + 'T00:00:00-06:00');
                yesterday.setDate(yesterday.getDate() - 1);
                startDate = yesterday;
                endDate = new Date(mexicoDate + 'T00:00:00-06:00');
            } else if (dateFilter === 'este-mes') {
                startDate = new Date(mexicoDate.substring(0, 7) + '-01T00:00:00-06:00');
                endDate = new Date(mexicoDate + 'T23:59:59.999-06:00');
            } else if (dateFilter === 'ultimos-10-dias') {
                const tenDaysAgo = new Date(mexicoDate + 'T00:00:00-06:00');
                tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
                startDate = tenDaysAgo;
                endDate = new Date(mexicoDate + 'T23:59:59.999-06:00');
            }

            if (startDate && endDate) {
                query = query.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate));
                query = query.where('createdAt', '<', admin.firestore.Timestamp.fromDate(endDate));
            }
        }

        query = query.orderBy('createdAt', 'desc');

        // Cursor-based pagination
        if (startAfterId) {
            const lastDoc = await db.collection('pedidos').doc(startAfterId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        // Fetch one extra to know if there are more pages
        const snapshot = await query.limit(pageLimit + 1).get();
        const hasMore = snapshot.docs.length > pageLimit;
        const docs = hasMore ? snapshot.docs.slice(0, pageLimit) : snapshot.docs;

        const orders = docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                consecutiveOrderNumber: data.consecutiveOrderNumber || null,
                producto: data.producto || '',
                telefono: data.telefono || '',
                precio: data.precio || 0,
                datosProducto: data.datosProducto || '',
                datosPromocion: data.datosPromocion || '',
                comentarios: data.comentarios || '',
                fotoUrls: data.fotoUrls || (data.fotoUrl ? [data.fotoUrl] : []),
                fotoPromocionUrls: data.fotoPromocionUrls || (data.fotoPromocionUrl ? [data.fotoPromocionUrl] : []),
                estatus: data.estatus || 'Sin estatus',
                telefonoVerificado: data.telefonoVerificado || false,
                estatusVerificado: data.estatusVerificado || false,
                createdAt: data.createdAt ? { _seconds: data.createdAt._seconds, _nanoseconds: data.createdAt._nanoseconds } : null,
                vendedor: data.vendedor || '',
                contactId: data.contactId || null,
                // Red de seguridad de pedidos registrados por la IA (orders/aiOrderRegistration.js)
                registeredByAI: data.registeredByAI === true,
                aiReviewStatus: data.aiReviewStatus || null,
                aiConfidence: data.aiConfidence != null ? data.aiConfidence : null,
            };
        });

        const lastVisibleId = docs.length > 0 ? docs[docs.length - 1].id : null;

        res.status(200).json({ success: true, orders, lastVisibleId, hasMore });
    } catch (error) {
        console.error("Error fetching paginated orders:", error);
        res.status(500).json({ success: false, message: 'Error al obtener los pedidos.', error: error.message });
    }
});

// --- Endpoint GET /api/orders/count (Conteo rápido sin traer documentos) ---
router.get('/orders/count', async (req, res) => {
    try {
        const { producto, estatus, dateFilter, customStart, customEnd } = req.query;

        let query = db.collection('pedidos');

        if (producto) query = query.where('producto', '==', producto);
        if (estatus) query = query.where('estatus', '==', estatus);

        const getMexicoDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

        if (dateFilter === 'personalizado' && customStart && customEnd) {
            query = query.where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(Number(customStart)));
            query = query.where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(Number(customEnd)));
        } else if (dateFilter) {
            const mexicoDate = getMexicoDate();
            let startDate, endDate;

            if (dateFilter === 'hoy') {
                startDate = new Date(mexicoDate + 'T00:00:00-06:00');
                endDate = new Date(mexicoDate + 'T23:59:59.999-06:00');
            } else if (dateFilter === 'ayer') {
                const yesterday = new Date(mexicoDate + 'T00:00:00-06:00');
                yesterday.setDate(yesterday.getDate() - 1);
                startDate = yesterday;
                endDate = new Date(mexicoDate + 'T00:00:00-06:00');
            } else if (dateFilter === 'este-mes') {
                startDate = new Date(mexicoDate.substring(0, 7) + '-01T00:00:00-06:00');
                endDate = new Date(mexicoDate + 'T23:59:59.999-06:00');
            } else if (dateFilter === 'ultimos-10-dias') {
                const tenDaysAgo = new Date(mexicoDate + 'T00:00:00-06:00');
                tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
                startDate = tenDaysAgo;
                endDate = new Date(mexicoDate + 'T23:59:59.999-06:00');
            }

            if (startDate && endDate) {
                query = query.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate));
                query = query.where('createdAt', '<', admin.firestore.Timestamp.fromDate(endDate));
            }
        }

        const snapshot = await query.count().get();
        res.status(200).json({ success: true, count: snapshot.data().count });
    } catch (error) {
        console.error("Error counting orders:", error);
        res.status(500).json({ success: false, message: 'Error al contar pedidos.', error: error.message });
    }
});

// --- Endpoint GET /api/orders/today (Pedidos del día con origen de anuncio) ---
router.get('/orders/today', async (req, res) => {
    try {
        const mexicoDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
        const todayStart = new Date(mexicoDate + 'T00:00:00-06:00');
        const firestoreTodayStart = admin.firestore.Timestamp.fromDate(todayStart);

        let query = db.collection('pedidos')
            .where('createdAt', '>=', firestoreTodayStart);

        const { time } = req.query; // HH:mm
        if (time) {
            const limitDate = new Date(`${mexicoDate}T${time}:59-06:00`);
            query = query.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(limitDate));
        }

        const ordersSnapshot = await query.orderBy('createdAt', 'desc').get();

        if (ordersSnapshot.empty) {
            return res.status(200).json({ success: true, orders: [] });
        }

        const orders = await processOrdersData(ordersSnapshot);
        res.status(200).json({ success: true, orders: orders });
    } catch (error) {
        console.error("Error fetching today's orders:", error);
        res.status(500).json({ success: false, message: 'Error al obtener los pedidos de hoy.', error: error.message });
    }
});

// --- Endpoint GET /api/orders/history (Pedidos por fecha específica) ---
router.get('/orders/history', async (req, res) => {
    try {
        const { date } = req.query; // Formato YYYY-MM-DD
        if (!date) {
            return res.status(400).json({ success: false, message: 'Se requiere una fecha.' });
        }

        // Crear rango de fecha en zona horaria de México
        const start = new Date(date + 'T00:00:00-06:00');
        let end = new Date(date + 'T23:59:59-06:00');

        const firestoreStart = admin.firestore.Timestamp.fromDate(start);
        const { time } = req.query; // HH:mm
        if (time) {
            end = new Date(date + 'T' + time + ':59-06:00');
        }
        const firestoreEnd = admin.firestore.Timestamp.fromDate(end);

        const ordersSnapshot = await db.collection('pedidos')
            .where('createdAt', '>=', firestoreStart)
            .where('createdAt', '<=', firestoreEnd)
            .orderBy('createdAt', 'desc')
            .get();

        const orders = await processOrdersData(ordersSnapshot);
        res.status(200).json({ success: true, orders: orders });
    } catch (error) {
        console.error("Error fetching orders history:", error);
        res.status(500).json({ success: false, message: 'Error al obtener el historial de pedidos.', error: error.message });
    }
});

// --- Endpoint GET /api/orders/recurring (Lee clientes recurrentes desde Firestore) ---
router.get('/orders/recurring', async (req, res) => {
    try {
        const recurringSnap = await db.collection('recurring_customers')
            .orderBy('totalSpent', 'desc')
            .limit(50)
            .get();

        const clients = recurringSnap.docs.map(doc => ({ phone: doc.id, ...doc.data() }));
        const totalRecurring = clients.length;

        // Si no hay datos guardados, sugerir ejecutar el scan inicial
        if (totalRecurring === 0) {
            return res.status(200).json({
                success: true,
                needsScan: true,
                message: 'No hay datos de recurrentes. Ejecuta POST /api/orders/recurring/scan para el escaneo inicial.',
                stats: { totalClients: 0, totalRecurring: 0, recurringRate: 0, totalRevenueRecurring: 0, totalOrders: 0, recurringOrders: 0, recurringOrdersRate: 0, avgOrdersPerRecurring: 0, avgSpentPerRecurring: 0 },
                clients: []
            });
        }

        // Calcular estadísticas desde los datos guardados
        const totalRevenueRecurring = clients.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
        const totalOrdersRecurring = clients.reduce((sum, c) => sum + (c.orderCount || 0), 0);
        const avgSpent = totalRecurring > 0 ? Math.round(totalRevenueRecurring / totalRecurring) : 0;
        const avgOrders = totalRecurring > 0 ? (totalOrdersRecurring / totalRecurring).toFixed(1) : 0;

        // Obtener total de clientes únicos para calcular tasa
        const statsDoc = await db.collection('recurring_customers').doc('_stats').get();
        const stats = statsDoc.exists ? statsDoc.data() : {};

        res.status(200).json({
            success: true,
            stats: {
                totalClients: stats.totalClients || 0,
                totalRecurring,
                recurringRate: stats.totalClients > 0 ? ((totalRecurring / stats.totalClients) * 100).toFixed(1) : 0,
                totalRevenueRecurring,
                totalOrders: stats.totalOrders || 0,
                recurringOrders: totalOrdersRecurring,
                recurringOrdersRate: stats.totalOrders > 0 ? ((totalOrdersRecurring / stats.totalOrders) * 100).toFixed(1) : 0,
                avgOrdersPerRecurring: avgOrders,
                avgSpentPerRecurring: avgSpent,
                lastScan: stats.lastScan || null
            },
            clients
        });
    } catch (error) {
        console.error('Error fetching recurring customers:', error);
        res.status(500).json({ success: false, message: 'Error al obtener clientes recurrentes.', error: error.message });
    }
});

// --- Endpoint POST /api/orders/recurring/scan (Escaneo inicial único — guarda recurrentes en Firestore) ---
router.post('/orders/recurring/scan', async (req, res) => {
    try {
        const { months } = req.query;
        const lookback = parseInt(months) || 3;

        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - lookback);
        const firestoreStart = admin.firestore.Timestamp.fromDate(startDate);

        const ordersSnap = await db.collection('pedidos')
            .where('createdAt', '>=', firestoreStart)
            .orderBy('createdAt', 'desc')
            .get();

        // Agrupar por teléfono — SOLO contar pedidos pagados (Pagado o Fabricar)
        const clientOrders = {};
        ordersSnap.docs.forEach(doc => {
            const data = doc.data();
            const phone = data.contactId || data.telefono;
            if (!phone) return;

            // Solo contar pedidos que realmente se pagaron
            const isPaid = data.estatus === 'Pagado' || data.estatus === 'Fabricar';
            if (!isPaid) return;

            if (!clientOrders[phone]) {
                clientOrders[phone] = { orderCount: 0, totalSpent: 0, products: [], lastOrderDate: null };
            }
            clientOrders[phone].orderCount++;
            clientOrders[phone].totalSpent += data.precio || 0;
            if (data.producto && !clientOrders[phone].products.includes(data.producto)) {
                clientOrders[phone].products.push(data.producto);
            }
            const orderDate = data.createdAt ? data.createdAt.toDate() : null;
            if (orderDate && (!clientOrders[phone].lastOrderDate || orderDate > clientOrders[phone].lastOrderDate)) {
                clientOrders[phone].lastOrderDate = orderDate;
            }
        });

        // Guardar solo recurrentes (2+ pedidos PAGADOS) en colección recurring_customers
        const batch = db.batch();
        let savedCount = 0;

        for (const [phone, data] of Object.entries(clientOrders)) {
            if (data.orderCount < 2) continue;

            // Obtener nombre del contacto
            let name = 'Sin nombre';
            try {
                const contactDoc = await db.collection('contacts_whatsapp').doc(phone).get();
                if (contactDoc.exists) name = contactDoc.data().name || name;
            } catch (e) {}

            const ref = db.collection('recurring_customers').doc(phone);
            batch.set(ref, {
                name,
                orderCount: data.orderCount, // Solo pedidos pagados
                totalSpent: data.totalSpent,
                products: data.products,
                lastOrderDate: data.lastOrderDate,
                detectedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            savedCount++;

            // Firestore batch limit es 500
            if (savedCount % 400 === 0) {
                await batch.commit();
            }
        }

        // Guardar estadísticas generales
        const statsRef = db.collection('recurring_customers').doc('_stats');
        batch.set(statsRef, {
            totalClients: Object.keys(clientOrders).length,
            totalOrders: ordersSnap.size,
            totalRecurring: savedCount,
            lastScan: admin.firestore.FieldValue.serverTimestamp(),
            monthsScanned: lookback
        });

        await batch.commit();

        res.status(200).json({
            success: true,
            message: `Escaneo completado. ${savedCount} clientes recurrentes guardados de ${Object.keys(clientOrders).length} clientes únicos.`,
            totalClients: Object.keys(clientOrders).length,
            totalRecurring: savedCount
        });
    } catch (error) {
        console.error('Error scanning recurring customers:', error);
        res.status(500).json({ success: false, message: 'Error al escanear clientes recurrentes.', error: error.message });
    }
});

// --- Endpoint GET /api/expenses/summary (Resumen de gastos por categoría del mes) ---
router.get('/expenses/summary', async (req, res) => {
    try {
        const now = new Date();
        const mexicoDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
        const year = mexicoDate.getFullYear();
        const month = String(mexicoDate.getMonth() + 1).padStart(2, '0');

        const startDate = `${year}-${month}-01`;
        const endDate = `${year}-${month}-31`;

        const expSnap = await db.collection('expenses')
            .where('date', '>=', startDate)
            .where('date', '<=', endDate)
            .get();

        // Un solo recorrido — replica EXACTAMENTE la lógica del gestor (charts.js)
        const drawCategories = ['Alex', 'Chris'];
        const cogsCategories = ['Material', 'Sueldos'];
        const categories = {};
        let totalCharges = 0, totalCredits = 0;
        let cogs = 0, operatingExpenses = 0, ownerDraw = 0;

        expSnap.docs.forEach(doc => {
            const data = doc.data();
            const charge = parseFloat(data.charge) || 0;
            const credit = parseFloat(data.credit) || 0;
            const isOperational = data.type === 'operativo' || !data.type;

            // Créditos (ingresos) — mismo filtro que el gestor
            if (credit > 0 && isOperational) {
                totalCredits += credit;
            }

            // Cargos (gastos) — usar splits si existen (igual que getExpenseParts en utils.js)
            if (charge > 0) {
                const parts = (data.splits && data.splits.length > 0)
                    ? data.splits.map(s => ({ category: s.category, amount: s.amount }))
                    : [{ category: data.category || 'SinCategorizar', amount: charge }];

                parts.forEach(p => {
                    // Para la gráfica de distribución
                    if (isOperational || data.sub_type === 'pago_intereses') {
                        if (!categories[p.category]) categories[p.category] = 0;
                        categories[p.category] += p.amount;
                        totalCharges += p.amount;
                    }

                    // Para utilidad operativa: misma lógica que charts.js
                    if (drawCategories.includes(p.category)) {
                        ownerDraw += p.amount;
                    } else if (isOperational || data.sub_type === 'pago_intereses') {
                        if (cogsCategories.includes(p.category)) {
                            cogs += p.amount;
                        } else {
                            operatingExpenses += p.amount;
                        }
                    }
                });
            }
        });

        const adjustedCredits = totalCredits;

        const sorted = Object.entries(categories)
            .sort(([,a], [,b]) => b - a)
            .map(([category, amount]) => ({
                category,
                amount: Math.round(amount * 100) / 100,
                percent: totalCharges > 0 ? ((amount / totalCharges) * 100).toFixed(1) : 0
            }));

        const businessCosts = cogs + operatingExpenses;
        const operatingProfit = adjustedCredits - businessCosts;
        const netProfit = operatingProfit - ownerDraw;

        res.status(200).json({
            success: true,
            month: `${year}-${month}`,
            totalCharges: Math.round(totalCharges * 100) / 100,
            totalCredits: Math.round(adjustedCredits * 100) / 100,
            operatingProfit: Math.round(operatingProfit * 100) / 100,
            netProfit: Math.round(netProfit * 100) / 100,
            ownerDraw: Math.round(ownerDraw * 100) / 100,
            businessCosts: Math.round(businessCosts * 100) / 100,
            cogs: Math.round(cogs * 100) / 100,
            categories: sorted
        });
    } catch (error) {
        console.error('Error fetching expenses summary:', error);
        res.status(500).json({ success: false, message: 'Error al obtener resumen de gastos.', error: error.message });
    }
});

// --- Endpoint POST /api/expenses/delete-by-ids (elimina docs por id) ---
router.post('/expenses/delete-by-ids', async (req, res) => {
    try {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
        if (!ids || ids.length === 0) return res.status(400).json({ error: 'ids requeridos' });
        const CHUNK = 400;
        let deleted = 0;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const batch = db.batch();
            ids.slice(i, i + CHUNK).forEach(id => batch.delete(db.collection('expenses').doc(id)));
            await batch.commit();
            deleted += ids.slice(i, i + CHUNK).length;
        }
        res.json({ success: true, deleted });
    } catch (error) {
        console.error('delete-by-ids error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Endpoint POST /api/expenses/diff-against-file (compara CRM vs un set de signatures) ---
router.post('/expenses/diff-against-file', async (req, res) => {
    try {
        const { expenses, from, to } = req.body || {};
        if (!Array.isArray(expenses)) return res.status(400).json({ error: 'expenses requerido' });
        if (!from || !to) return res.status(400).json({ error: 'from/to requeridos' });

        const fileSigs = new Map(); // sig -> count
        expenses.forEach(e => {
            const concept = (e.concept || '').trim();
            const charge = Math.abs(parseFloat(e.charge) || 0);
            const credit = parseFloat(e.credit) || 0;
            const sig = `${e.date}|${concept}|${charge}|${credit}`;
            fileSigs.set(sig, (fileSigs.get(sig) || 0) + 1);
        });

        const snap = await db.collection('expenses').get();
        const crmSigs = new Map(); // sig -> [docs]
        snap.docs.forEach(doc => {
            const d = doc.data();
            if (d.date < from || d.date > to) return;
            if (d.type === 'ajuste_saldo') return;
            const concept = (d.concept || '').trim();
            const charge = parseFloat(d.charge) || 0;
            const credit = parseFloat(d.credit) || 0;
            const sig = `${d.date}|${concept}|${charge}|${credit}`;
            if (!crmSigs.has(sig)) crmSigs.set(sig, []);
            crmSigs.get(sig).push({ id: doc.id, date: d.date, concept: d.concept, charge, credit, source: d.source });
        });

        const onlyInCRM = []; // CRM tiene pero file no
        const onlyInFile = []; // file tiene pero CRM no
        const duplicatedInCRM = []; // CRM tiene N copias pero file tiene < N

        crmSigs.forEach((docs, sig) => {
            const fileCount = fileSigs.get(sig) || 0;
            if (fileCount === 0) {
                docs.forEach(d => onlyInCRM.push(d));
            } else if (docs.length > fileCount) {
                // sobran (docs.length - fileCount) copias
                const extras = docs.slice(fileCount);
                extras.forEach(d => duplicatedInCRM.push(d));
            }
        });

        fileSigs.forEach((count, sig) => {
            const crmCount = (crmSigs.get(sig) || []).length;
            if (crmCount < count) {
                const [date, concept, charge, credit] = sig.split('|');
                for (let i = 0; i < (count - crmCount); i++) {
                    onlyInFile.push({ date, concept, charge: parseFloat(charge), credit: parseFloat(credit) });
                }
            }
        });

        const sumExtras = duplicatedInCRM.reduce((s, d) => ({ c: s.c + d.charge, a: s.a + d.credit }), { c: 0, a: 0 });
        const sumOnlyCRM = onlyInCRM.reduce((s, d) => ({ c: s.c + d.charge, a: s.a + d.credit }), { c: 0, a: 0 });
        const sumOnlyFile = onlyInFile.reduce((s, d) => ({ c: s.c + d.charge, a: s.a + d.credit }), { c: 0, a: 0 });

        res.json({
            from, to,
            fileMovements: expenses.length,
            crmMovements: Array.from(crmSigs.values()).reduce((s, a) => s + a.length, 0),
            duplicatedInCRM: { count: duplicatedInCRM.length, sumCharge: sumExtras.c, sumCredit: sumExtras.a, items: duplicatedInCRM.slice(0, 50) },
            onlyInCRM: { count: onlyInCRM.length, sumCharge: sumOnlyCRM.c, sumCredit: sumOnlyCRM.a, items: onlyInCRM.slice(0, 30) },
            onlyInFile: { count: onlyInFile.length, sumCharge: sumOnlyFile.c, sumCredit: sumOnlyFile.a, items: onlyInFile.slice(0, 30) }
        });
    } catch (error) {
        console.error('diff-against-file error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Endpoint GET /api/expenses/types-summary (resumen de tipos únicos) ---
router.get('/expenses/types-summary', async (req, res) => {
    try {
        const from = req.query.from;
        const to = req.query.to;
        const snapshot = await db.collection('expenses').get();
        const byType = {};
        snapshot.docs.forEach(doc => {
            const d = doc.data();
            if (from && d.date < from) return;
            if (to && d.date > to) return;
            const t = d.type || '(none)';
            if (!byType[t]) byType[t] = { count: 0, charge: 0, credit: 0, sample: [] };
            byType[t].count++;
            byType[t].charge += parseFloat(d.charge) || 0;
            byType[t].credit += parseFloat(d.credit) || 0;
            if (byType[t].sample.length < 5) byType[t].sample.push({ id: doc.id, date: d.date, concept: d.concept?.substring(0, 60), charge: d.charge, credit: d.credit, sub_type: d.sub_type });
        });
        res.json({ from, to, byType });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Endpoint GET /api/expenses/list-by-type (Diagnóstico: lista expenses por tipo) ---
router.get('/expenses/list-by-type', async (req, res) => {
    try {
        const type = req.query.type || 'ajuste_saldo';
        const snapshot = await db.collection('expenses').where('type', '==', type).get();
        const docs = snapshot.docs.map(d => ({
            id: d.id,
            ...d.data()
        }));
        let totalCharge = 0, totalCredit = 0;
        docs.forEach(d => {
            totalCharge += parseFloat(d.charge) || 0;
            totalCredit += parseFloat(d.credit) || 0;
        });
        res.json({ type, count: docs.length, totalCharge, totalCredit, docs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Endpoint POST /api/expenses/set-balance-target (Ajusta Utilidad para que coincida con saldo real) ---
router.post('/expenses/set-balance-target', async (req, res) => {
    try {
        const { targetBalance, from, to, concept } = req.body || {};
        if (typeof targetBalance !== 'number') return res.status(400).json({ error: 'targetBalance (number) requerido' });
        if (!from || !to) return res.status(400).json({ error: 'from y to (YYYY-MM-DD) requeridos' });

        const snapshot = await db.collection('expenses').get();
        let totalIncome = 0, totalCharge = 0;
        const adjDocs = [];
        snapshot.docs.forEach(doc => {
            const d = doc.data();
            if (d.date < from || d.date > to) return;
            const isOperational = d.type === 'operativo' || !d.type || d.sub_type === 'pago_intereses';
            const isAdjustment = d.type === 'ajuste_saldo';
            if (isAdjustment) {
                adjDocs.push(doc.ref);
                return; // no contar ajustes en el neto base
            }
            if (!isOperational) return;
            totalIncome += parseFloat(d.credit) || 0;
            totalCharge += parseFloat(d.charge) || 0;
        });

        // Borra ajustes previos para no duplicar
        if (adjDocs.length > 0) {
            const batch = db.batch();
            adjDocs.forEach(ref => batch.delete(ref));
            await batch.commit();
        }
        // Neto base (sin ajustes previos)
        const neto = totalIncome - totalCharge;

        const delta = +(targetBalance - neto).toFixed(2);
        if (Math.abs(delta) < 0.01) {
            return res.json({ success: true, message: 'Sin ajuste necesario.', currentNeto: neto, delta: 0 });
        }

        const doc = {
            date: to,
            concept: concept || 'Ajuste de saldo bancario',
            charge: delta < 0 ? Math.abs(delta) : 0,
            credit: delta > 0 ? delta : 0,
            category: 'AjusteSaldo',
            type: 'ajuste_saldo',
            source: 'manual',
            subcategory: '',
            sub_type: '',
            channel: ''
        };
        await db.collection('expenses').add(doc);

        res.json({
            success: true,
            message: `Ajuste creado: ${delta < 0 ? 'cargo' : 'abono'} de $${Math.abs(delta).toFixed(2)}.`,
            previousNeto: neto,
            targetBalance,
            delta,
            adjustmentsRemoved: adjDocs.length,
            created: doc
        });
    } catch (error) {
        console.error('Error set-balance-target:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Endpoint POST /api/expenses/delete-by-range (Elimina gastos en un rango de fechas) ---
router.post('/expenses/delete-by-range', async (req, res) => {
    try {
        const from = req.query.from || req.body?.from;
        const to = req.query.to || req.body?.to;
        if (!from || !to) return res.status(400).json({ error: 'from y to requeridos (YYYY-MM-DD)' });
        const snapshot = await db.collection('expenses')
            .where('date', '>=', from)
            .where('date', '<=', to)
            .get();
        if (snapshot.empty) {
            return res.json({ success: true, message: 'No hay movimientos en el rango.', deleted: 0 });
        }
        const refs = snapshot.docs.map(d => d.ref);
        const CHUNK = 400;
        for (let i = 0; i < refs.length; i += CHUNK) {
            const batch = db.batch();
            refs.slice(i, i + CHUNK).forEach(ref => batch.delete(ref));
            await batch.commit();
        }
        res.json({ success: true, message: `${refs.length} movimientos eliminados (${from} a ${to}).`, deleted: refs.length });
    } catch (error) {
        console.error('Error delete-by-range:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper: extrae el "merchant key" (parte antes del primer "/")
function extractMerchantKeyServer(concept) {
    const lower = String(concept || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const slashIdx = lower.indexOf('/');
    return slashIdx >= 0 ? lower.substring(0, slashIdx).trim() : lower;
}

// --- Reglas de auto-categorización (replica de public/admon/js/utils.js) ---
function autoCategorizeServer(concept, manualCategories) {
    const lowerConcept = String(concept || '').toLowerCase().replace(/\s+/g, ' ');
    // 1. Match exacto
    if (manualCategories && manualCategories[lowerConcept]) {
        return manualCategories[lowerConcept];
    }
    // 2. Match por comercio
    const merchantKey = extractMerchantKeyServer(concept);
    if (merchantKey && manualCategories && manualCategories[merchantKey]) {
        return manualCategories[merchantKey];
    }
    const rules = {
        Ganancia: ['xciento'],
        Chris: ['chris', 'moises', 'wm max llc', 'stori', 'jessica', 'yannine', 'recargas y paquetes bmov / ******6530', 'recargas y paquetes bmov / ******7167', 'carniceria las pradera', 'minisuper natalia', 'temu', 'alsuper plus mezquital', 'alsuper plus d arrieta', 'fruteria alvarez'],
        Alex: ['alex', 'bolt', 'retiro sin tarjeta / ******0670'],
        Publicidad: ['facebook'],
        Material: ['material', 'raza', 'c00008749584', 'acrilico', 'mercadolibre', 'psa computo'],
        Envios: ['guias'],
        Sueldos: ['diego', 'catalina', 'rosario', 'erika', 'catarina', 'maria gua', 'karla', 'lupita', 'recargas y paquetes bmov / ******0030'],
        Tecnologia: ['openai', 'claude', 'whaticket', 'hostinger', 'payu *google cloud', 'tripo ai'],
        Local: ['local', 'renta', 'valeria'],
        Deudas: ['saldos vencidos'],
        Devoluciones: ['devolucion'],
        GastosFinancieros: ['interes', 'comision']
    };
    for (const category in rules) {
        if (rules[category].some(keyword => lowerConcept.includes(keyword))) return category;
    }
    return 'SinCategorizar';
}

// --- Endpoint POST /api/expenses/bulk-import (Importa expenses desde JSON) ---
router.post('/expenses/bulk-import', async (req, res) => {
    try {
        const items = Array.isArray(req.body?.expenses) ? req.body.expenses : null;
        if (!items || items.length === 0) return res.status(400).json({ error: 'expenses (array) requerido' });

        // Cargar manualCategories
        const mcSnap = await db.collection('manualCategories').get();
        const manualCategories = {};
        mcSnap.docs.forEach(d => {
            const data = d.data();
            if (data.concept) manualCategories[data.concept.toLowerCase().replace(/\s+/g, ' ')] = data.category;
        });

        // Dedupe contra base existente (misma firma)
        const existingSnap = await db.collection('expenses').get();
        const existingSigs = new Set();
        existingSnap.docs.forEach(d => {
            const e = d.data();
            const concept = (e.concept || '').trim();
            const charge = parseFloat(e.charge) || 0;
            const credit = parseFloat(e.credit) || 0;
            existingSigs.add(`${e.date}|${concept}|${charge}|${credit}`);
        });

        const toImport = [];
        const seenInFile = new Set();
        let skippedExisting = 0, skippedIntraFile = 0;

        items.forEach(raw => {
            const date = raw.date;
            const concept = String(raw.concept || '').trim();
            const charge = Math.abs(parseFloat(raw.charge) || 0);
            const credit = parseFloat(raw.credit) || 0;
            if (!date || !concept) return;
            const sig = `${date}|${concept}|${charge}|${credit}`;
            const upperConcept = concept.toUpperCase();
            const isSpecial = upperConcept.includes('SU PAGO EN EFECTIVO') || upperConcept.includes('PAY PAL*FACEBOOK') || upperConcept.includes('PAYPAL*FACEBOOK');
            if (!isSpecial) {
                if (existingSigs.has(sig)) { skippedExisting++; return; }
                if (seenInFile.has(sig)) { skippedIntraFile++; return; }
                seenInFile.add(sig);
            }
            // Para ingresos, solo respetar override manual previo (no aplicar reglas por substring)
            const lowerConcept = concept.toLowerCase().replace(/\s+/g, ' ');
            const merchantKey = extractMerchantKeyServer(concept);
            const category = credit > 0
                ? (manualCategories[lowerConcept] || manualCategories[merchantKey] || '')
                : autoCategorizeServer(concept, manualCategories);
            toImport.push({
                date,
                concept,
                charge,
                credit,
                category,
                type: 'operativo',
                source: raw.source || 'api-import',
                subcategory: '',
                sub_type: '',
                channel: ''
            });
        });

        if (toImport.length === 0) {
            return res.json({ success: true, imported: 0, skippedExisting, skippedIntraFile, message: 'Nada nuevo para importar.' });
        }

        const CHUNK = 400;
        for (let i = 0; i < toImport.length; i += CHUNK) {
            const batch = db.batch();
            toImport.slice(i, i + CHUNK).forEach(exp => {
                batch.set(db.collection('expenses').doc(), exp);
            });
            await batch.commit();
        }

        res.json({
            success: true,
            imported: toImport.length,
            skippedExisting,
            skippedIntraFile,
            message: `${toImport.length} movimientos importados. ${skippedExisting} ya existían, ${skippedIntraFile} duplicados en archivo.`
        });
    } catch (error) {
        console.error('Error bulk-import:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Endpoint GET /api/expenses/totals-by-range (Totales de cargo/abono por rango) ---
router.get('/expenses/totals-by-range', async (req, res) => {
    try {
        const from = req.query.from;
        const to = req.query.to;
        if (!from || !to) return res.status(400).json({ error: 'from y to requeridos (YYYY-MM-DD)' });
        const snapshot = await db.collection('expenses').get();
        let totalCargo = 0, totalAbono = 0, count = 0;
        snapshot.docs.forEach(doc => {
            const d = doc.data();
            if (d.date < from || d.date > to) return;
            totalCargo += parseFloat(d.charge) || 0;
            totalAbono += parseFloat(d.credit) || 0;
            count++;
        });
        res.json({ from, to, count, totalCargo: +totalCargo.toFixed(2), totalAbono: +totalAbono.toFixed(2) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Endpoint GET /api/expenses/find-duplicates (Encuentra gastos duplicados por firma) ---
router.get('/expenses/find-duplicates', async (req, res) => {
    try {
        const from = req.query.from || null; // YYYY-MM-DD
        const to = req.query.to || null;
        const snapshot = await db.collection('expenses').get();
        const bySig = new Map();
        snapshot.docs.forEach(doc => {
            const d = doc.data();
            if (from && d.date < from) return;
            if (to && d.date > to) return;
            const concept = (d.concept || '').trim();
            const charge = parseFloat(d.charge) || 0;
            const credit = parseFloat(d.credit) || 0;
            const sig = `${d.date}|${concept}|${charge}|${credit}`;
            if (!bySig.has(sig)) bySig.set(sig, []);
            bySig.get(sig).push({ id: doc.id, date: d.date, concept: d.concept, charge, credit, category: d.category, source: d.source });
        });
        const duplicates = [];
        let extraCopies = 0;
        bySig.forEach((docs, sig) => {
            if (docs.length > 1) {
                duplicates.push({ signature: sig, count: docs.length, docs });
                extraCopies += docs.length - 1;
            }
        });
        res.json({ filter: { from, to }, scannedExpenses: bySig.size > 0 ? [...bySig.values()].reduce((s,a)=>s+a.length,0) : 0, duplicateGroups: duplicates.length, extraCopies, duplicates: duplicates.slice(0, 50) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Endpoint POST /api/expenses/remove-duplicates (Elimina copias duplicadas, preserva 1) ---
router.post('/expenses/remove-duplicates', async (req, res) => {
    try {
        const from = req.query.from || req.body?.from || null;
        const to = req.query.to || req.body?.to || null;
        const snapshot = await db.collection('expenses').get();
        const bySig = new Map();
        snapshot.docs.forEach(doc => {
            const d = doc.data();
            if (from && d.date < from) return;
            if (to && d.date > to) return;
            const concept = (d.concept || '').trim().toUpperCase().replace(/\s+/g, ' ');
            // Respeta los conceptos que sí pueden repetirse (pagos recurrentes en efectivo y ads Facebook)
            const isSpecial = concept.includes('SU PAGO EN EFECTIVO') ||
                              concept.includes('PAY PAL*FACEBOOK') ||
                              concept.includes('PAYPAL*FACEBOOK');
            if (isSpecial) return;
            const charge = parseFloat(d.charge) || 0;
            const credit = parseFloat(d.credit) || 0;
            const sig = `${d.date}|${(d.concept || '').trim()}|${charge}|${credit}`;
            if (!bySig.has(sig)) bySig.set(sig, []);
            bySig.get(sig).push({ ref: doc.ref, data: d });
        });

        const toDelete = [];
        bySig.forEach(docs => {
            if (docs.length <= 1) return;
            // Prioridad para conservar: source 'manual' o 'modified' > resto. Conserva el primero tras ordenar.
            docs.sort((a, b) => {
                const priA = (a.data.source === 'manual' || a.data.source === 'modified') ? 0 : 1;
                const priB = (b.data.source === 'manual' || b.data.source === 'modified') ? 0 : 1;
                if (priA !== priB) return priA - priB;
                return (a.ref.id > b.ref.id ? 1 : -1);
            });
            docs.slice(1).forEach(d => toDelete.push(d.ref));
        });

        if (toDelete.length === 0) {
            return res.json({ success: true, message: 'No hay duplicados para eliminar.', deleted: 0 });
        }

        const CHUNK = 400;
        for (let i = 0; i < toDelete.length; i += CHUNK) {
            const batch = db.batch();
            toDelete.slice(i, i + CHUNK).forEach(ref => batch.delete(ref));
            await batch.commit();
        }
        res.json({ success: true, message: `${toDelete.length} copias duplicadas eliminadas.`, deleted: toDelete.length });
    } catch (error) {
        console.error('Error removing duplicates:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Endpoint POST /api/expenses/recategorize (Recategorizar movimientos por concepto) ---
router.post('/expenses/recategorize', async (req, res) => {
    try {
        const rules = [
            { match: 'minisuper natalia', category: 'Chris' },
            { match: 'temu', category: 'Chris' },
            { match: 'alsuper plus mezquital', category: 'Chris' },
            { match: 'alsuper plus d arrieta', category: 'Chris' },
            { match: 'fruteria alvarez', category: 'Chris' },
            { match: 'psa computo', category: 'Material' },
            { match: 'retiro sin tarjeta / ******0670', category: 'Alex' },
            { match: 'payu *google cloud', category: 'Tecnologia' },
            { match: 'tripo ai', category: 'Tecnologia' },
        ];

        const snapshot = await db.collection('expenses').get();
        const batch = db.batch();
        const changes = [];

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const concept = (data.concept || '').toLowerCase().replace(/\s+/g, ' ');
            for (const rule of rules) {
                if (concept.includes(rule.match)) {
                    const oldCat = data.category || 'SinCategorizar';
                    if (oldCat !== rule.category) {
                        batch.update(doc.ref, { category: rule.category });
                        changes.push({ concept: data.concept, from: oldCat, to: rule.category });
                    }
                    break;
                }
            }
        });

        // Sincronizar manualCategories para no sobrescribir la regla
        const manualSnap = await db.collection('manualCategories').get();
        const manualChanges = [];
        manualSnap.docs.forEach(doc => {
            const data = doc.data();
            const concept = (data.concept || '').toLowerCase().replace(/\s+/g, ' ');
            for (const rule of rules) {
                if (concept.includes(rule.match) && data.category !== rule.category) {
                    batch.update(doc.ref, { category: rule.category });
                    manualChanges.push({ concept: data.concept, from: data.category, to: rule.category });
                    break;
                }
            }
        });

        if (changes.length === 0 && manualChanges.length === 0) {
            return res.json({ success: true, message: 'No se encontraron movimientos para recategorizar.', changes: [] });
        }

        await batch.commit();
        res.json({
            success: true,
            message: `${changes.length} movimientos + ${manualChanges.length} categorías manuales actualizadas.`,
            changes,
            manualChanges
        });
    } catch (error) {
        console.error('Error recategorizando:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Endpoint GET /api/kpi/monthly (KPIs del mes actual: revenue, ticket, pedidos pagados) ---
router.get('/kpi/monthly', async (req, res) => {
    try {
        // Primer día del mes actual en hora México
        const now = new Date();
        const mexicoDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
        const firstDay = new Date(mexicoDate.getFullYear(), mexicoDate.getMonth(), 1);
        const firestoreStart = admin.firestore.Timestamp.fromDate(firstDay);

        const ordersSnap = await db.collection('pedidos')
            .where('createdAt', '>=', firestoreStart)
            .get();

        let totalRevenue = 0;
        let paidCount = 0;
        let totalCount = 0;
        let cancelledCount = 0;
        const ticketDistribution = { single: 0, double: 0, triple: 0, other: 0 };

        ordersSnap.docs.forEach(doc => {
            const data = doc.data();
            totalCount++;
            const isPaid = data.estatus === 'Pagado' || data.estatus === 'Fabricar';
            const isCancelled = data.estatus === 'Cancelado';

            if (isCancelled) cancelledCount++;
            if (!isPaid) return;

            paidCount++;
            const precio = data.precio || 0;
            totalRevenue += precio;

            // Clasificar por rango de ticket
            if (precio <= 700) ticketDistribution.single++;
            else if (precio <= 1400) ticketDistribution.double++;
            else if (precio <= 2100) ticketDistribution.triple++;
            else ticketDistribution.other++;
        });

        const avgTicket = paidCount > 0 ? Math.round(totalRevenue / paidCount) : 0;
        const daysElapsed = mexicoDate.getDate();
        const daysInMonth = new Date(mexicoDate.getFullYear(), mexicoDate.getMonth() + 1, 0).getDate();
        const projectedRevenue = daysElapsed > 0 ? Math.round((totalRevenue / daysElapsed) * daysInMonth) : 0;
        const projectedOrders = daysElapsed > 0 ? Math.round((paidCount / daysElapsed) * daysInMonth) : 0;

        res.status(200).json({
            success: true,
            month: `${mexicoDate.getFullYear()}-${String(mexicoDate.getMonth() + 1).padStart(2, '0')}`,
            daysElapsed,
            daysInMonth,
            revenue: totalRevenue,
            projectedRevenue,
            paidOrders: paidCount,
            projectedOrders,
            totalOrders: totalCount,
            cancelledOrders: cancelledCount,
            avgTicket,
            conversionRate: totalCount > 0 ? ((paidCount / totalCount) * 100).toFixed(1) : 0,
            ticketDistribution
        });
    } catch (error) {
        console.error('Error fetching monthly KPIs:', error);
        res.status(500).json({ success: false, message: 'Error al obtener KPIs mensuales.', error: error.message });
    }
});

// --- Endpoint GET /api/kpi/revenue-history (Revenue mensual de los últimos N meses) ---
router.get('/kpi/revenue-history', async (req, res) => {
    try {
        const months = Math.min(parseInt(req.query.months) || 12, 24);
        const now = new Date();
        const mexicoDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
        const results = [];

        for (let i = months - 1; i >= 0; i--) {
            const d = new Date(mexicoDate.getFullYear(), mexicoDate.getMonth() - i, 1);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const startDate = `${year}-${month}-01`;
            const endDate = `${year}-${month}-31`;

            // Revenue from expenses (credits = income)
            const expSnap = await db.collection('expenses')
                .where('date', '>=', startDate)
                .where('date', '<=', endDate)
                .get();

            let totalCredits = 0;
            expSnap.docs.forEach(doc => {
                const data = doc.data();
                const credit = parseFloat(data.credit) || 0;
                const isOperational = data.type === 'operativo' || !data.type;
                if (credit > 0 && isOperational) totalCredits += credit;
            });

            results.push({
                month: `${year}-${month}`,
                label: d.toLocaleString('es-MX', { month: 'short', year: '2-digit' }),
                revenue: Math.round(totalCredits),
                isCurrent: i === 0
            });
        }

        res.status(200).json({ success: true, data: results });
    } catch (error) {
        console.error('Error fetching revenue history:', error);
        res.status(500).json({ success: false, message: 'Error al obtener historial de revenue.', error: error.message });
    }
});

// === Cache simple en memoria para KPIs (TTL 5 min) ===
const _kpiCache = {};
function _cacheGet(key, ttlMs = 300000) {
    const entry = _kpiCache[key];
    if (!entry) return null;
    if (Date.now() - entry.at > ttlMs) { delete _kpiCache[key]; return null; }
    return entry.value;
}
function _cacheSet(key, value) { _kpiCache[key] = { value, at: Date.now() }; }

// --- Endpoint GET /api/kpi/messages-daily (Mensajes entrantes por día, últimos N días) ---
router.get('/kpi/messages-daily', async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);

        // Cache hit?
        const cacheKey = `msg-daily:${days}`;
        const cached = _cacheGet(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'public, max-age=300');
            return res.status(200).json(cached);
        }

        // Ventana en hora local de CDMX: [hoy 00:00 CDMX - (days-1) días, ahora]
        const TZ = 'America/Mexico_City';
        const now = new Date();
        const mexicoNow = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
        const startLocal = new Date(mexicoNow.getFullYear(), mexicoNow.getMonth(), mexicoNow.getDate() - (days - 1));

        // Convertimos el inicio local a timestamp absoluto (UTC real)
        // Truco: la diferencia entre `new Date()` y `new Date(...toLocaleString(...,{timeZone:TZ}))`
        // nos da el offset actual de CDMX respecto a UTC.
        const offsetMs = now.getTime() - mexicoNow.getTime();
        const startUtc = new Date(startLocal.getTime() + offsetMs);

        const startTimestamp = admin.firestore.Timestamp.fromDate(startUtc);
        const endTimestamp = admin.firestore.Timestamp.fromDate(now);

        // .select('timestamp') proyecta solo el campo timestamp — reduce ~10x el payload de 50k docs
        const snapshot = await db.collectionGroup('messages')
            .where('timestamp', '>=', startTimestamp)
            .where('timestamp', '<=', endTimestamp)
            .where('from', '!=', PHONE_NUMBER_ID) // Solo entrantes
            .select('timestamp')
            .get();

        // Inicializamos todos los días del rango con 0 para gráfica sin huecos
        const counts = {};
        for (let i = 0; i < days; i++) {
            const d = new Date(startLocal.getFullYear(), startLocal.getMonth(), startLocal.getDate() + i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            counts[key] = 0;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.timestamp || typeof data.timestamp.toDate !== 'function') return;
            const msgDate = data.timestamp.toDate();
            // Convertir a fecha local CDMX
            const localStr = msgDate.toLocaleString('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
            // en-CA devuelve YYYY-MM-DD
            const key = localStr.slice(0, 10);
            if (counts[key] !== undefined) counts[key] += 1;
        });

        const data = Object.keys(counts).sort().map(day => {
            const d = new Date(day + 'T12:00:00'); // mediodía para evitar zona
            return {
                day,
                label: d.toLocaleString('es-MX', { day: '2-digit', month: 'short' }),
                count: counts[day]
            };
        });

        const total = data.reduce((s, d) => s + d.count, 0);
        const avg = data.length > 0 ? Math.round(total / data.length) : 0;
        const today = data.length > 0 ? data[data.length - 1].count : 0;
        const max = data.reduce((m, d) => d.count > m ? d.count : m, 0);

        const payload = {
            success: true,
            data,
            summary: { total, avg, today, max, days: data.length }
        };
        _cacheSet(cacheKey, payload);
        res.set('Cache-Control', 'public, max-age=300');
        res.status(200).json(payload);
    } catch (error) {
        console.error('Error fetching messages-daily:', error);
        res.status(500).json({ success: false, message: 'Error al obtener mensajes diarios.', error: error.message });
    }
});

// --- Endpoint GET /api/kpi/conversations-daily (Conversaciones nuevas vs recurrentes por día) ---
router.get('/kpi/conversations-daily', async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);

        const cacheKey = `conv-daily:${days}`;
        const cached = _cacheGet(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'public, max-age=300');
            return res.status(200).json(cached);
        }

        const TZ = 'America/Mexico_City';
        const now = new Date();
        const mexicoNow = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
        const startLocal = new Date(mexicoNow.getFullYear(), mexicoNow.getMonth(), mexicoNow.getDate() - (days - 1));
        const offsetMs = now.getTime() - mexicoNow.getTime();
        const startUtc = new Date(startLocal.getTime() + offsetMs);

        const startTimestamp = admin.firestore.Timestamp.fromDate(startUtc);
        const endTimestamp = admin.firestore.Timestamp.fromDate(now);

        // Correr ambas queries en paralelo:
        // A) Mensajes entrantes del rango (proyectados — solo timestamp) para armar contactId -> días.
        // B) Contactos activos del rango (una sola query indexada sobre lastMessageTimestamp)
        //    para extraer createTime de cada uno y decidir nuevo vs recurrente.
        const [msgSnap, contactsSnap] = await Promise.all([
            db.collectionGroup('messages')
                .where('timestamp', '>=', startTimestamp)
                .where('timestamp', '<=', endTimestamp)
                .where('from', '!=', PHONE_NUMBER_ID)
                .select('timestamp')
                .get(),
            db.collection('contacts_whatsapp')
                .where('lastMessageTimestamp', '>=', startTimestamp)
                .select('lastMessageTimestamp') // proyección mínima; createTime viene como metadata
                .get()
        ]);

        // 1) contactId -> Set<día local> desde los mensajes
        const contactDays = {};
        msgSnap.forEach(doc => {
            const data = doc.data();
            if (!data.timestamp || typeof data.timestamp.toDate !== 'function') return;
            const contactId = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
            if (!contactId) return;
            const localStr = data.timestamp.toDate().toLocaleString('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
            const day = localStr.slice(0, 10);
            if (!contactDays[contactId]) contactDays[contactId] = new Set();
            contactDays[contactId].add(day);
        });

        // 2) contactId -> día de creación (de createTime, metadata Firestore)
        const firstDayByContact = {};
        contactsSnap.forEach(snap => {
            const ct = snap.createTime;
            if (!ct) { firstDayByContact[snap.id] = null; return; }
            const localStr = ct.toDate().toLocaleString('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
            firstDayByContact[snap.id] = localStr.slice(0, 10);
        });

        // 3) Buckets por día inicializados en 0 (sin huecos)
        const bucket = {};
        for (let i = 0; i < days; i++) {
            const d = new Date(startLocal.getFullYear(), startLocal.getMonth(), startLocal.getDate() + i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            bucket[key] = { new: 0, existing: 0, total: 0 };
        }
        const contactIds = Object.keys(contactDays);
        for (const cid of contactIds) {
            const firstDay = firstDayByContact[cid]; // puede ser undefined si el contacto no salió en contactsSnap
            for (const day of contactDays[cid]) {
                if (!bucket[day]) continue;
                bucket[day].total += 1;
                if (firstDay && firstDay === day) bucket[day].new += 1;
                else bucket[day].existing += 1;
            }
        }

        const data = Object.keys(bucket).sort().map(day => {
            const d = new Date(day + 'T12:00:00');
            return {
                day,
                label: d.toLocaleString('es-MX', { day: '2-digit', month: 'short' }),
                new: bucket[day].new,
                existing: bucket[day].existing,
                total: bucket[day].total
            };
        });

        const totalNew = data.reduce((s, d) => s + d.new, 0);
        const totalExisting = data.reduce((s, d) => s + d.existing, 0);
        const avgNew = data.length > 0 ? Math.round(totalNew / data.length) : 0;
        const avgTotal = data.length > 0 ? Math.round((totalNew + totalExisting) / data.length) : 0;
        const todayRow = data.length > 0 ? data[data.length - 1] : { new: 0, existing: 0, total: 0 };

        const payload = {
            success: true,
            data,
            summary: {
                uniqueContacts: contactIds.length,
                totalNew,
                totalExisting,
                avgNewPerDay: avgNew,
                avgConversationsPerDay: avgTotal,
                todayNew: todayRow.new,
                todayExisting: todayRow.existing,
                todayTotal: todayRow.total,
                days: data.length
            }
        };
        _cacheSet(cacheKey, payload);
        res.set('Cache-Control', 'public, max-age=300');
        res.status(200).json(payload);
    } catch (error) {
        console.error('Error fetching conversations-daily:', error);
        res.status(500).json({ success: false, message: 'Error al obtener conversaciones diarias.', error: error.message });
    }
});

// --- Endpoint GET /api/kpi/daily (Obtener gasto publicitario del día) ---
router.get('/kpi/daily', async (req, res) => {
    try {
        let { date } = req.query; // Formato YYYY-MM-DD
        if (!date) {
            date = new Date().toISOString().split('T')[0];
        }

        // 1. Intentar obtener el gasto directamente de Meta Ads
        // El ID de la cuenta publicitaria es el solicitado por el usuario: 1890131678412987
        const metaSpend = await getMetaSpend(date, '1890131678412987');
        
        let spend = 0;

        if (metaSpend !== null) {
            // Si logramos obtenerlo de Meta, lo usamos y actualizamos Firestore como respaldo
            spend = metaSpend;
            console.log(`[KPI] Gasto de Meta obtenido para ${date}: ${spend}. Sincronizando Firestore...`);
            
            await db.collection('daily_kpis').doc(date).set({
                fecha: date,
                costo_publicidad: spend,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                source: 'meta_ads'
            }, { merge: true });
        } else {
            // Si Meta falló, intentamos leer lo último que tengamos en Firestore
            console.log(`[KPI] Meta falló o no disponible. Buscando en Firestore para ${date}...`);
            const kpiSnapshot = await db.collection('daily_kpis')
                .where('fecha', '==', date)
                .limit(1)
                .get();

            if (!kpiSnapshot.empty) {
                spend = kpiSnapshot.docs[0].data().costo_publicidad || 0;
            }
        }

        res.status(200).json({ success: true, spend: spend });
    } catch (error) {
        console.error("Error fetching daily KPI:", error);
        res.status(500).json({ success: false, message: 'Error al obtener el gasto publicitario.', error: error.message });
    }
});


// --- Endpoint GET /api/kpi/profitability (Dashboard de rentabilidad por anuncio/campaña) ---
// Cruza pedidos atribuidos por leadDate con spend de Meta Ads. Devuelve KPIs, tabla,
// curva diaria, pipeline y histograma de tiempo a pago en un solo JSON.
//
// Query params:
//   from=YYYY-MM-DD   Fecha inicio (default: 2026-01-01, cuando el tracking empezó a ser confiable)
//   to=YYYY-MM-DD     Fecha fin (default: hoy)
//   groupBy=ad        Agrupar por anuncio (default) o campaign
router.get('/kpi/profitability', async (req, res) => {
    try {
        const { from, to } = req.query;
        const groupBy = (req.query.groupBy === 'campaign') ? 'campaign' : 'ad';

        const todayStr = new Date().toISOString().slice(0, 10);
        const dateTo = to || todayStr;
        const dateFrom = from || '2026-01-01';

        const fromTs = admin.firestore.Timestamp.fromDate(new Date(dateFrom + 'T00:00:00'));
        const toTs = admin.firestore.Timestamp.fromDate(new Date(dateTo + 'T23:59:59.999'));

        const isPaid = (e) => e === 'Pagado' || e === 'Fabricar';
        const isCancelled = (e) => e === 'Cancelado';
        const COST_PER_UNIT = 70;
        const SHIPPING = 80;
        const ORG_KEY = '__organic__';

        // 1. Pedidos en rango. Para evitar índice compuesto:
        //    - Una query amplia por createdAt (con padding de 7 días para cubrir casos donde
        //      leadDate está en rango pero createdAt cayó días después por la IA nocturna).
        //    - Filtrado en memoria por COALESCE(leadDate, createdAt) ∈ [fromTs, toTs].
        const padMs = 7 * 24 * 60 * 60 * 1000;
        const wideFromTs = admin.firestore.Timestamp.fromMillis(fromTs.toMillis() - padMs);
        const wideToTs = admin.firestore.Timestamp.fromMillis(toTs.toMillis() + padMs);
        const snap = await db.collection('pedidos')
            .where('createdAt', '>=', wideFromTs)
            .where('createdAt', '<=', wideToTs)
            .get();

        const fromMs = fromTs.toMillis();
        const toMs = toTs.toMillis();
        const pedidos = [];
        for (const doc of snap.docs) {
            const d = doc.data();
            const effective = d.leadDate || d.createdAt;
            if (!effective) continue;
            const ms = effective.toMillis();
            if (ms < fromMs || ms > toMs) continue;
            pedidos.push({
                id: doc.id,
                attributedAdId: d.attributedAdId || null,
                leadSource: d.leadSource || 'organic',
                leadDate: d.leadDate || d.createdAt || null,
                createdAt: d.createdAt || null,
                confirmedAt: d.confirmedAt || null,
                estatus: d.estatus || 'Sin estatus',
                precio: Number(d.precio) || 0,
                unidades: Array.isArray(d.items)
                    ? Math.max(d.items.reduce((sum, it) => sum + (Math.max(1, parseInt(it?.cantidad, 10) || 1)), 0), 1)
                    : 1
            });
        }

        // 2. Insights de Meta (ad-level siempre — cubre ambos modos)
        let adInsights = [];
        try {
            adInsights = await metaAdsService.getInsightsByLevel(null, 'ad', dateFrom, dateTo);
        } catch (metaErr) {
            console.warn('[PROFITABILITY] No se pudieron obtener insights de Meta:', metaErr.message);
        }

        // adId -> { campaign_id, campaign_name, ad_name, spend }
        const adMap = {};
        for (const r of adInsights) {
            if (!r.ad_id) continue;
            adMap[r.ad_id] = {
                ad_name: r.ad_name,
                campaign_id: r.campaign_id,
                campaign_name: r.campaign_name,
                spend: r.spend
            };
        }

        // 3. Spend agrupado por entidad según groupBy
        const spendByKey = {};
        const nameByKey = {};
        const campaignNameByKey = {};
        for (const r of adInsights) {
            const key = groupBy === 'campaign' ? r.campaign_id : r.ad_id;
            if (!key) continue;
            spendByKey[key] = (spendByKey[key] || 0) + r.spend;
            nameByKey[key] = groupBy === 'campaign' ? r.campaign_name : r.ad_name;
            if (groupBy === 'ad') campaignNameByKey[key] = r.campaign_name;
        }

        // 4. Agregar pedidos por entidad
        const aggByKey = {};
        function ensureAgg(key) {
            if (!aggByKey[key]) {
                aggByKey[key] = { pedidos: 0, pagados: 0, cancelados: 0, ingresos: 0, costos: 0, daysToPay: [] };
            }
            return aggByKey[key];
        }

        function getKey(p) {
            if (p.leadSource === 'organic' || !p.attributedAdId) return ORG_KEY;
            if (groupBy === 'campaign') {
                return adMap[p.attributedAdId]?.campaign_id || `unknown_campaign_${p.attributedAdId}`;
            }
            return p.attributedAdId;
        }

        const allDaysToPay = [];
        for (const p of pedidos) {
            const key = getKey(p);
            const agg = ensureAgg(key);
            agg.pedidos++;
            if (isPaid(p.estatus)) {
                agg.pagados++;
                agg.ingresos += p.precio;
                agg.costos += p.unidades * COST_PER_UNIT + SHIPPING;
                if (p.confirmedAt && p.leadDate) {
                    const days = (p.confirmedAt.toMillis() - p.leadDate.toMillis()) / (1000 * 60 * 60 * 24);
                    if (days >= 0 && days < 90) {
                        agg.daysToPay.push(days);
                        allDaysToPay.push(days);
                    }
                }
            } else if (isCancelled(p.estatus)) {
                agg.cancelados++;
            }
        }

        // 5. Filas de la tabla
        const allKeys = new Set([...Object.keys(aggByKey), ...Object.keys(spendByKey)]);
        const filas = [];
        for (const key of allKeys) {
            const agg = aggByKey[key] || { pedidos: 0, pagados: 0, cancelados: 0, ingresos: 0, costos: 0, daysToPay: [] };
            const spend = spendByKey[key] || 0;
            const profit = agg.ingresos - agg.costos - spend;
            const roas = spend > 0 ? agg.ingresos / spend : null;
            const tasaPago = agg.pedidos > 0 ? agg.pagados / agg.pedidos : 0;
            const diasProm = agg.daysToPay.length > 0
                ? agg.daysToPay.reduce((a, b) => a + b, 0) / agg.daysToPay.length
                : null;

            let name;
            let campaignName = null;
            if (key === ORG_KEY) {
                name = 'Orgánico';
            } else if (key.startsWith('unknown_campaign_')) {
                name = 'Campaña desconocida';
            } else if (groupBy === 'campaign') {
                name = nameByKey[key] || `Campaña ${key}`;
            } else {
                name = nameByKey[key] || `Ad ${key}`;
                campaignName = campaignNameByKey[key] || null;
            }

            filas.push({
                id: key,
                name,
                campaignName,
                spend: Math.round(spend * 100) / 100,
                pedidos: agg.pedidos,
                pagados: agg.pagados,
                ingresos: agg.ingresos,
                costos: agg.costos,
                profit: Math.round(profit * 100) / 100,
                roas: roas !== null ? Math.round(roas * 100) / 100 : null,
                tasaPago: Math.round(tasaPago * 1000) / 1000,
                diasProm: diasProm !== null ? Math.round(diasProm * 10) / 10 : null
            });
        }
        filas.sort((a, b) => b.profit - a.profit);

        // 6. Totales
        const totals = filas.reduce((acc, r) => ({
            spend: acc.spend + r.spend,
            pedidos: acc.pedidos + r.pedidos,
            pagados: acc.pagados + r.pagados,
            ingresos: acc.ingresos + r.ingresos,
            costos: acc.costos + r.costos,
            profit: acc.profit + r.profit
        }), { spend: 0, pedidos: 0, pagados: 0, ingresos: 0, costos: 0, profit: 0 });
        totals.spend = Math.round(totals.spend * 100) / 100;
        totals.profit = Math.round(totals.profit * 100) / 100;
        totals.roas = totals.spend > 0 ? Math.round((totals.ingresos / totals.spend) * 100) / 100 : null;
        totals.tasaPago = totals.pedidos > 0 ? Math.round((totals.pagados / totals.pedidos) * 1000) / 1000 : 0;
        totals.diasPromedioLeadAPago = allDaysToPay.length > 0
            ? Math.round((allDaysToPay.reduce((a, b) => a + b, 0) / allDaysToPay.length) * 10) / 10
            : null;

        // 7. Pipeline pendiente (no pagados ni cancelados, últimos 30d)
        const pipelineFromTs = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const pipelineSnap = await db.collection('pedidos').where('createdAt', '>=', pipelineFromTs).get();
        const pipelineDocs = pipelineSnap.docs
            .map(d => d.data())
            .filter(p => !isPaid(p.estatus) && !isCancelled(p.estatus));
        const pipelineCount = pipelineDocs.length;
        const pipelineValue = Math.round(pipelineDocs.reduce((s, p) => s + (Number(p.precio) || 0), 0));
        const esperadoCobrar = Math.round(pipelineValue * (totals.tasaPago || 0));

        // 8. Curva diaria: spend (Meta) + ingresos/pipeline (pedidos)
        let dailySpendArr = [];
        try {
            dailySpendArr = await metaAdsService.getDailySpend(null, dateFrom, dateTo);
        } catch (e) {
            console.warn('[PROFITABILITY] Error en gasto diario:', e.message);
        }
        const dailyMap = {};
        function getOrInitDay(date) {
            if (!dailyMap[date]) dailyMap[date] = { date, spend: 0, ingresos: 0, pedidos: 0, pagados: 0, pipeline: 0 };
            return dailyMap[date];
        }
        for (const ds of dailySpendArr) getOrInitDay(ds.date).spend = Math.round(ds.spend * 100) / 100;
        for (const p of pedidos) {
            const d = p.leadDate || p.createdAt;
            if (!d) continue;
            const date = d.toDate().toISOString().slice(0, 10);
            const day = getOrInitDay(date);
            day.pedidos++;
            if (isPaid(p.estatus)) {
                day.pagados++;
                day.ingresos += p.precio;
            } else if (!isCancelled(p.estatus)) {
                day.pipeline += p.precio;
            }
        }
        const sevenDaysAgoStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const curvaDiaria = Object.values(dailyMap)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(d => ({ ...d, incompleto: d.date >= sevenDaysAgoStr }));

        // 9. Histograma tiempo a pago
        const buckets = { '1d': 0, '2d': 0, '3d': 0, '4-7d': 0, '8-14d': 0, '15+d': 0 };
        for (const days of allDaysToPay) {
            if (days <= 1) buckets['1d']++;
            else if (days <= 2) buckets['2d']++;
            else if (days <= 3) buckets['3d']++;
            else if (days <= 7) buckets['4-7d']++;
            else if (days <= 14) buckets['8-14d']++;
            else buckets['15+d']++;
        }
        const histogramaTiempoAPago = Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));

        res.json({
            success: true,
            range: { from: dateFrom, to: dateTo },
            groupBy,
            totals,
            pipeline: { pedidosPendientes: pipelineCount, valorPendiente: pipelineValue, esperadoCobrar },
            curvaDiaria,
            histogramaTiempoAPago,
            filas
        });
    } catch (err) {
        console.error('[PROFITABILITY] Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// --- Endpoint POST /api/kpi/profitability/ask (Q&A sobre los datos del dashboard) ---
// Recibe { question, snapshot } donde snapshot es la respuesta del endpoint de profitability.
// Llama a Gemini Pro con un prompt enfocado en analizar el dataset y responder.
router.post('/kpi/profitability/ask', async (req, res) => {
    try {
        const { question, snapshot, history } = req.body || {};
        if (!question || typeof question !== 'string') {
            return res.status(400).json({ success: false, message: 'Falta el campo question.' });
        }
        if (!snapshot || typeof snapshot !== 'object') {
            return res.status(400).json({ success: false, message: 'Falta el snapshot de datos.' });
        }

        const systemInstruction = `Eres un analista de marketing experto que ayuda a Dekoor (negocio de lámparas personalizadas vendidas por WhatsApp desde anuncios de Meta Ads) a interpretar sus métricas de rentabilidad.

CONTEXTO DE NEGOCIO:
- Producto: lámparas personalizadas a $650 MXN cada una.
- Costo unitario: $70 producto + $80 envío fijo (envío no escala con cantidad).
- El cliente paga después de ver una foto del producto con su nombre personalizado.
- Estatus que cuentan como pagado: "Pagado" y "Fabricar".
- El evento Purchase a Meta se dispara cuando el estatus pasa a "Fabricar".
- Rango promedio lead → pago: 1-7 días.
- Atribución: cada pedido se asigna al ad MÁS RECIENTE del contacto antes del pedido.
- El tracking de atribución es confiable desde enero 2026.

REGLAS DE RESPUESTA:
- Responde en español, conciso y directo (máximo 4-6 oraciones a menos que pidan detalle).
- Usa números EXACTOS del dataset que recibes. No inventes ni redondees agresivamente.
- Si la pregunta no se puede responder con los datos actuales, dilo claramente y di qué dato faltaría.
- Cuando aplique, da recomendaciones accionables (qué ad escalar, cuál pausar, qué probar).
- No agregues disclaimers como "como modelo de IA" ni "te recomiendo consultar".
- Cuando hables de un ad/campaña específico, usa su nombre exacto del dataset.
- Formato: texto plano con viñetas (-) cuando sea útil. NO uses markdown bold ni headers.`;

        // Reducir el snapshot para no mandar payload gigante: top 20 filas + totales + curva
        const compactSnapshot = {
            range: snapshot.range,
            groupBy: snapshot.groupBy,
            totals: snapshot.totals,
            pipeline: snapshot.pipeline,
            histogramaTiempoAPago: snapshot.histogramaTiempoAPago,
            curvaDiaria: snapshot.curvaDiaria,
            filas: Array.isArray(snapshot.filas) ? snapshot.filas.slice(0, 30) : [],
            totalFilas: Array.isArray(snapshot.filas) ? snapshot.filas.length : 0
        };

        let historyText = '';
        if (Array.isArray(history) && history.length > 0) {
            historyText = '\n\nCONVERSACIÓN PREVIA:\n' + history.slice(-6).map(h => {
                return `Usuario: ${h.q}\nAnalista: ${h.a}`;
            }).join('\n\n');
        }

        const prompt = `DATOS DEL DASHBOARD (rango ${compactSnapshot.range?.from} → ${compactSnapshot.range?.to}, agrupado por ${compactSnapshot.groupBy}):
${JSON.stringify(compactSnapshot, null, 2)}${historyText}

PREGUNTA DEL USUARIO:
${question}`;

        const result = await askGeminiPro(prompt, systemInstruction);

        res.json({
            success: true,
            answer: result.text,
            model: result.model,
            tokens: { input: result.inputTokens, output: result.outputTokens }
        });
    } catch (err) {
        console.error('[PROFITABILITY ASK] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});


// --- Endpoint POST /api/spellcheck (autocorrector ortográfico con contexto, IA) ---
// Recibe { text } y devuelve { corrected, changed }. Corrige SOLO ortografía y
// acentuación, preservando nombres, números, códigos, URLs y emojis. Pensado para
// usarse "conforme el usuario escribe" en el cuadro de mensaje del CRM.
// Filosofía: ante cualquier duda, devolver el texto ORIGINAL (mejor no tocar que romper).
router.post('/spellcheck', async (req, res) => {
    const original = (req.body && typeof req.body.text === 'string') ? req.body.text : '';
    // Palabras del diccionario compartido marcadas como "válidas": la IA NO debe tocarlas.
    const protect = Array.isArray(req.body && req.body.protect)
        ? req.body.protect.filter(w => typeof w === 'string' && w.trim()).slice(0, 100)
        : [];
    try {
        const trimmed = original.trim();
        // Nada útil que corregir o texto demasiado largo: devolver tal cual.
        if (trimmed.length < 3 || original.length > 1200) {
            return res.json({ corrected: original, changed: false });
        }

        let systemInstruction = `Eres un corrector ortográfico para mensajes de atención a clientes por WhatsApp, en español de México.
Tu ÚNICA tarea es corregir errores de ORTOGRAFÍA y ACENTUACIÓN (tildes), además de la mayúscula al inicio de oración y signos de puntuación claramente faltantes.

REGLAS ESTRICTAS:
- Devuelve EXCLUSIVAMENTE el texto corregido. Sin comillas, sin explicaciones, sin etiquetas, sin prefijos.
- NO cambies el significado, el tono ni el estilo. NO reformules ni reescribas frases.
- NO agregues, quites ni completes palabras. Conserva el MISMO número de palabras y el mismo orden.
- Si la última palabra parece incompleta (porque el usuario aún está escribiendo), NO la completes ni la cambies; déjala igual.
- NO toques: nombres propios, marcas, números, precios, códigos/SKU (p. ej. DK-123), URLs, correos, @menciones, #hashtags ni emojis.
- Respeta tal cual los saltos de línea, los espacios y las mayúsculas intencionales.
- Si el texto ya está correcto, devuélvelo IDÉNTICO.`;
        if (protect.length) {
            systemInstruction += `\n- Palabras que NO debes modificar bajo ninguna circunstancia (déjalas EXACTAMENTE igual aunque parezcan mal escritas; son nombres/marca/jerga válidos): ${protect.join(', ')}.`;
        }

        const aiResult = await generateGeminiResponse(original, [], systemInstruction);
        let corrected = (aiResult && aiResult.text ? aiResult.text : '').trim();

        // --- Saneamiento defensivo de la respuesta del modelo ---
        // 1) Quitar comillas que envuelvan TODO el texto si el original no las tenía.
        if (corrected.length >= 2) {
            const f = corrected[0], l = corrected[corrected.length - 1];
            const wrapped = (f === '"' && l === '"') || (f === '«' && l === '»') || (f === '“' && l === '”') || (f === "'" && l === "'");
            if (wrapped && trimmed[0] !== f) corrected = corrected.slice(1, -1).trim();
        }
        // 2) Quitar prefijos típicos que a veces agrega el modelo.
        corrected = corrected.replace(/^(texto corregido|correcci[oó]n|resultado)\s*:\s*/i, '').trim();

        // --- Validaciones de seguridad: si no se cumplen, devolver el ORIGINAL ---
        const wordCount = s => (s.trim().match(/\S+/g) || []).length;
        const safe =
            corrected.length > 0 &&
            wordCount(corrected) === wordCount(original) &&        // mismo nº de palabras
            corrected.length <= original.length + 12 &&            // no crece de más (tildes/signos)
            corrected.length >= Math.floor(original.length * 0.6); // no se encoge de más
        if (!safe) {
            return res.json({ corrected: original, changed: false });
        }

        // Preservar los espacios inicial/final del original (el .trim() del modelo los quita)
        // para no mover el cursor de forma rara mientras el usuario escribe.
        const leading = (original.match(/^\s*/) || [''])[0];
        const trailing = (original.match(/\s*$/) || [''])[0];
        const finalCorrected = leading + corrected + trailing;

        return res.json({ corrected: finalCorrected, changed: finalCorrected !== original });
    } catch (err) {
        console.error('[SPELLCHECK] Error:', err.message);
        // Ante cualquier error, no interrumpir la escritura: devolver lo que vino.
        return res.status(200).json({ corrected: original, changed: false });
    }
});


// --- Diccionario COMPARTIDO del autocorrector (todos los agentes) ---
// Guardado en crm_settings/spellcheck_dictionary como dos mapas:
//   corrections: { "porfa": "por favor", ... }  (from en minúsculas -> to)
//   ignores:     { "dekoor": true, ... }        (palabras válidas que NO se corrigen)
const SPELLCHECK_DICT_REF = () => db.collection('crm_settings').doc('spellcheck_dictionary');
const _normWord = s => (typeof s === 'string' ? s.trim() : '');

// GET: leer el diccionario compartido (lo usa el frontend como respaldo del onSnapshot).
router.get('/spellcheck/dictionary', async (req, res) => {
    try {
        const doc = await SPELLCHECK_DICT_REF().get();
        const data = doc.exists ? doc.data() : {};
        res.json({ success: true, corrections: data.corrections || {}, ignores: data.ignores || {} });
    } catch (err) {
        console.error('[SPELLCHECK DICT GET] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST: agregar/quitar entradas. Body: { action, from, to, word }.
//   add-correction    { from, to }  -> corrige "from" por "to"
//   add-ignore        { word }      -> marca "word" como válida (no corregir)
//   remove-correction { from }
//   remove-ignore     { word }
router.post('/spellcheck/dictionary', async (req, res) => {
    try {
        const { action } = req.body || {};
        const ref = SPELLCHECK_DICT_REF();
        const del = admin.firestore.FieldValue.delete();

        if (action === 'add-correction') {
            const from = _normWord(req.body.from).toLowerCase();
            const to = _normWord(req.body.to);
            if (!from || !to) return res.status(400).json({ success: false, message: 'Faltan la palabra y su corrección.' });
            if (/\s/.test(from)) return res.status(400).json({ success: false, message: 'La palabra a corregir debe ser una sola palabra.' });
            if (from === to.toLowerCase()) return res.status(400).json({ success: false, message: 'La corrección es igual a la palabra.' });
            if (to.length > 60) return res.status(400).json({ success: false, message: 'La corrección es demasiado larga.' });
            await ref.set({ corrections: { [from]: to } }, { merge: true });
        } else if (action === 'add-ignore') {
            const word = _normWord(req.body.word).toLowerCase();
            if (!word) return res.status(400).json({ success: false, message: 'Falta la palabra.' });
            if (/\s/.test(word)) return res.status(400).json({ success: false, message: 'Debe ser una sola palabra.' });
            await ref.set({ ignores: { [word]: true } }, { merge: true });
        } else if (action === 'remove-correction') {
            const from = _normWord(req.body.from).toLowerCase();
            if (!from) return res.status(400).json({ success: false, message: 'Falta la palabra.' });
            await ref.set({ corrections: { [from]: del } }, { merge: true });
        } else if (action === 'remove-ignore') {
            const word = _normWord(req.body.word).toLowerCase();
            if (!word) return res.status(400).json({ success: false, message: 'Falta la palabra.' });
            await ref.set({ ignores: { [word]: del } }, { merge: true });
        } else {
            return res.status(400).json({ success: false, message: 'Acción no válida.' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[SPELLCHECK DICT POST] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});


// --- Endpoint Temporal: Actualizar nombres de anuncios de las últimas 20 horas ---
router.get('/admin/test-update-ads-20h', async (req, res) => {
    console.log('[DEBUG] Entrando a la ruta test-update-ads-20h');
    try {
        const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000);
        const firestoreTimestamp = admin.firestore.Timestamp.fromDate(twentyHoursAgo);

        console.log(`[DEBUG] Buscando chats con anuncios desde: ${twentyHoursAgo.toISOString()}`);
        console.log('[DEBUG] Iniciando consulta a Firestore: contacts_whatsapp...');
        
        const snapshot = await db.collection('contacts_whatsapp')
            .where('lastMessageTimestamp', '>=', firestoreTimestamp)
            .get();

        console.log(`[DEBUG] Consulta a Firestore finalizada. Documentos encontrados: ${snapshot.size}`);

        if (snapshot.empty) {
            console.log('[DEBUG] No se encontraron resultados. Enviando respuesta 200.');
            return res.status(200).json({ success: true, message: 'No se encontraron chats en las últimas 20 horas.', found: 0, updated: 0 });
        }

        let foundCount = 0;
        let updatedCount = 0;
        let errorsCount = 0;

        const results = [];

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const adReferral = data.adReferral;

            // Solo procesar si tiene un source_id de anuncio
            if (adReferral && adReferral.source_id && adReferral.source_type === 'ad') {
                foundCount++;
                const adId = adReferral.source_id;

                try {
                    console.log(`[DEBUG] Procesando contacto: ${doc.id}, Ad ID: ${adId}`);
                    console.log(`[DEBUG] Llamando a Meta Graph API para el Ad ID: ${adId}`);
                    
                    const metaResponse = await axios.get(`https://graph.facebook.com/v18.0/${adId}`, {
                        params: {
                            fields: 'name',
                            access_token: process.env.META_GRAPH_TOKEN
                        }
                    });

                    console.log(`[DEBUG] Respuesta de Meta recibida para ${adId}: ${JSON.stringify(metaResponse.data)}`);

                    if (metaResponse.data && metaResponse.data.name) {
                        const adName = metaResponse.data.name;
                        
                        console.log(`[DEBUG] Actualizando Firestore para el contacto ${doc.id} con ad_name: ${adName}`);
                        // Actualizar en Firestore
                        await doc.ref.update({
                            'adReferral.ad_name': adName
                        });
                        console.log(`[DEBUG] Actualización en Firestore exitosa para ${doc.id}`);
                        
                        updatedCount++;
                        results.push({ id: doc.id, adId, status: 'updated', name: adName });
                    } else {
                        console.log(`[DEBUG] Meta no devolvió un nombre para ${adId}`);
                        results.push({ id: doc.id, adId, status: 'no_name_returned' });
                    }
                } catch (error) {
                    console.error(`[ERROR CRÍTICO EN BUCLE] test-update-ads-20h (Ad ID ${adId}):`, error.message);
                    if (error.response) {
                        console.error('[DEBUG] Detalles del error de Meta:', JSON.stringify(error.response.data));
                    }
                    errorsCount++;
                    results.push({ id: doc.id, adId, status: 'error', error: error.message });
                }
            }
        }

        console.log('[DEBUG] Finalizando procesamiento. Enviando respuesta summary.');
        res.status(200).json({
            success: true,
            summary: {
                total_recent_chats: snapshot.size,
                chats_with_ads: foundCount,
                updated_successfully: updatedCount,
                errors: errorsCount
            },
            details: results
        });

    } catch (error) {
        console.error('[ERROR CRÍTICO] test-update-ads-20h falló:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno en test-update-ads-20h.', 
            error: error.message,
            stack: error.stack 
        });
    }
});

// --- CONSTANTES ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const PORT = process.env.PORT || 3000;

// --- PROMPT DE ACCIONES PARA EDITOR ---
function getEditorActionPrompt() {
    return `**Sistema de Acciones del Editor SVG:**
Puedes ejecutar acciones en el editor incluyendo un bloque \`\`\`actions en tu respuesta.
El bloque contiene un array JSON de acciones. Siempre responde con texto explicativo además de las acciones.
Todos los valores con sufijo _u están en la unidad actual del usuario (indicada en el contexto del lienzo).
Para colores usa formato hexadecimal (#ff0000) o "none".

**Acciones disponibles:**

1. create - Crear objeto
   rect: { "action":"create", "type":"rect", "props":{ "x_u":N, "y_u":N, "width_u":N, "height_u":N, "fill":"#hex", "stroke":"#hex", "strokeWidth":N }}
   ellipse: { "action":"create", "type":"ellipse", "props":{ "cx_u":N, "cy_u":N, "rx_u":N, "ry_u":N, "fill":"#hex", "stroke":"#hex" }}
   line: { "action":"create", "type":"line", "props":{ "x1_u":N, "y1_u":N, "x2_u":N, "y2_u":N, "stroke":"#hex", "strokeWidth":N }}
   text: { "action":"create", "type":"text", "props":{ "x_u":N, "y_u":N, "text":"contenido", "fontFamily":"Inter", "fontSize_u":N, "fill":"#hex", "textAlign":"left|center|right" }}

2. modify - Modificar propiedades: { "action":"modify", "target":"selected"|ID, "props":{ "fill", "stroke", "strokeWidth", "rotation", "text", "fontFamily", "fontSize_u", "textAlign" }}

3. move - Mover relativo: { "action":"move", "target":"selected"|ID, "dx_u":N, "dy_u":N }

4. moveTo - Mover a posición: { "action":"moveTo", "target":"selected"|ID, "x_u":N, "y_u":N }

5. resize - Cambiar tamaño: { "action":"resize", "target":"selected"|ID, "width_u":N, "height_u":N }

6. delete - Eliminar: { "action":"delete", "target":"selected"|ID }

7. duplicate - Duplicar: { "action":"duplicate", "target":"selected"|ID, "dx_u":N, "dy_u":N }
    dx_u/dy_u son opcionales para posicionar la copia (offset desde el original).

8. order - Orden Z: { "action":"order", "target":"selected"|ID, "position":"front"|"back" }

9. flip - Voltear: { "action":"flip", "target":"selected"|ID, "direction":"horizontal"|"vertical" }

10. select - Seleccionar: { "action":"select", "target":ID }

11. fit - Encajar objeto dentro de otro (escala uniforme + centrado): { "action":"fit", "source":"selected"|ID, "target":ID }
    Escala "source" uniformemente (mantiene proporción) para que quepa dentro del contorno de "target", y lo centra.
    "source" puede ser "selected" (útil tras duplicate, donde la selección es la copia nueva).
    Usa esto cuando el usuario diga "encaja", "mete", "ajusta dentro de", "fit", etc.

12. fill_names - Llenar plantilla con lista de nombres:
    Formato simple (un solo diseño): { "action":"fill_names", "source":"selected"|ID, "names":["nombre1","nombre2",...], "slots":[ID1,ID2,...], "extras":[ID,...] }
    Formato multi-diseño (cada nombre puede usar un diseño diferente): { "action":"fill_names", "assignments":[{"name":"Alex","source":ID1},{"name":"María","source":ID2},...], "slots":[...], "extras":[...] }
    Para cada nombre: duplica el "source" correspondiente, cambia el texto, y lo encaja en el siguiente contorno/slot.
    IMPORTANTE: Cuando el usuario especifique diferentes tipos de diseño para cada nombre (ej: "Alex-dinosaurio, María-Guerreras"), usa el formato "assignments" para asignar el source correcto a cada nombre. Identifica cada diseño disponible en el lienzo por su contenido (imágenes, textos, tipo de grupo) y asócialo con el tipo que el usuario menciona.
    "slots" es opcional: si se omite, auto-detecta contornos vacíos (shapes con stroke y sin fill).
    "extras" es opcional: IDs de objetos adicionales de la plantilla (marcas de corte, rectángulos de registro, etc.) que se duplican junto con los slots al crear nuevas páginas, pero donde NO se colocan diseños.
    Si hay más nombres que slots, duplica slots+extras automáticamente debajo y sigue llenando.
    Usa esto cuando el usuario dé una lista de nombres para producción/corte.

**Acciones de Pedidos (CRM):**

13. get_orders - Consultar pedidos: { "action":"get_orders", "date":"today"|"YYYY-MM-DD" }
    Devuelve la lista de pedidos del día indicado. "today" = hoy.

14. update_order - Actualizar pedido: { "action":"update_order", "orderId":"DOCUMENT_ID", "props":{ "estatus":"Pagado", "comentarios":"...", "producto":"..." }}
    Campos actualizables: estatus, producto, comentarios, datosProducto, datosPromocion, precio, telefono.
    Estatus válidos: Sin estatus, Foto enviada, Esperando pago, Pagado, Diseñado, Fabricar, Corregir, Corregido, Mns Amenazador, Cancelado.

**Reglas:**
- "selected" usa el objeto seleccionado. Si no hay selección y el usuario dice "eso", pide que seleccione algo.
- Para referencias como "el rectángulo rojo", busca en los objetos del lienzo el que coincida.
- Si no se especifica posición, centra el objeto en la página.
- Si no se especifica color de fill, usa "none". Si no se especifica stroke, usa "#000000".
- "círculo" = ellipse con rx_u = ry_u. "cuadrado" = rect con width_u = height_u.
- Cuando el usuario da un tamaño como "50mm" para un círculo, ese es el DIÁMETRO, así que rx_u = ry_u = 25.
- Para "encaja X en Y" / "mete X dentro de Y" / "ajusta X al contorno Y", usa la acción "fit" con source=X y target=Y. Identifica los objetos por su posición, color, tipo o ID en el contexto del lienzo.
- Al duplicar un diseño, si hay un contorno/plantilla vacío visible en el lienzo, usa "fit" después del "duplicate" para encajar la copia en ese contorno. Tras duplicate la selección cambia a la copia, así que usa "selected" como source en fit.
- Cuando el usuario dé una lista de nombres (ej: "llena con: Ana, Pedro, Luis"), usa "fill_names" con el diseño base y los nombres. No uses múltiples duplicate+fit manuales; fill_names lo hace todo automáticamente.
- Si la lista tiene nombres con DIFERENTES diseños (ej: "Alex-dinosaurio, María-Guerreras"), usa fill_names con "assignments" para asignar cada nombre a su diseño source correcto. Busca en el contexto del lienzo los grupos/objetos que correspondan a cada tipo de diseño.
- Si el usuario no pide una acción (solo pregunta algo), responde solo con texto, sin bloque actions.
- Para pedidos: si el usuario pregunta sobre pedidos, usa get_orders para consultarlos. Si el contexto ya incluye pedidos recientes, puedes responder directamente sin get_orders.
- Para actualizar un pedido, necesitas el ID del documento (campo "id" del pedido). Si el usuario dice "pedido 1045", busca el que tenga consecutiveOrderNumber 1045.

**Colores comunes:** rojo=#ff0000, azul=#0000ff, verde=#00ff00, amarillo=#ffff00, naranja=#ff8000, morado=#800080, rosa=#ff69b4, negro=#000000, blanco=#ffffff, gris=#808080, celeste=#00bfff, marrón=#8B4513

**Fuentes disponibles:** Inter, Montserrat, Playfair Display, Roboto, Open Sans, Lato, Oswald, Raleway, Merriweather, Nunito, Poppins, Dancing Script, Pacifico, Lobster, Bebas Neue, Caveat, Abril Fatface, Righteous, Permanent Marker, Satisfy, Great Vibes, Rows of Sunflowers`;
}

// --- ENDPOINT SIMULADOR IA ---
router.post('/simulate-ai', async (req, res) => {
    try {
        const { message, mediaBase64, mediaMimeType, history, source, canvasContext } = req.body;
        const isEditor = (source === 'editor');

        if (!message) {
            return res.status(400).json({ success: false, message: 'Se requiere un mensaje.' });
        }

        // Recuperar instrucciones del bot según el origen
        const botDocId = isEditor ? 'editor_bot' : 'bot';
        const defaultPrompt = isEditor
            ? 'Eres un asistente de diseño gráfico integrado en un editor SVG. Ayuda al usuario con sus diseños, da sugerencias creativas y responde preguntas sobre el editor.'
            : 'Eres un asistente virtual amigable y servicial.';
        const botDoc = await db.collection('crm_settings').doc(botDocId).get();
        const systemPrompt = botDoc.exists && botDoc.data().instructions ? botDoc.data().instructions : defaultPrompt;

        // Construir historial de conversación y recolectar media
        const mediaParts = [];
        let mediaCount = 0;

        const dbHistory = (history || []).map(msg => {
            if (msg.role === 'user' && msg.mediaBase64 && mediaCount < 2) {
                // Remove the prefix (e.g., "data:image/jpeg;base64," or "data:audio/ogg;base64,")
                const base64Data = msg.mediaBase64.replace(/^data:\w+\/\w+;base64,/, '');
                // Detect mime type from prefix or use provided
                const mimeMatch = msg.mediaBase64.match(/^data:(\w+\/\w+);base64,/);
                const mimeType = mimeMatch ? mimeMatch[1] : (msg.mediaMimeType || 'image/jpeg');
                
                mediaParts.unshift({ inlineData: { data: base64Data, mimeType: mimeType } }); // unshift to keep chronological order logic similar to services.js
                mediaCount++;
            }
            return {
                role: msg.role === 'user' ? 'user' : 'model',
                text: msg.content
            };
        });
        
        // Handle current message text, and potentially media if sent alongside it
        if (mediaBase64 && mediaCount < 2) {
            const base64Data = mediaBase64.replace(/^data:\w+\/\w+;base64,/, '');
            const mimeMatch = mediaBase64.match(/^data:(\w+\/\w+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : (mediaMimeType || 'image/jpeg');
            mediaParts.push({ inlineData: { data: base64Data, mimeType: mimeType } });
            mediaCount++;
        }
        dbHistory.push({ role: 'user', text: message || '' });

        const userLabel = isEditor ? 'Usuario' : 'Cliente';
        const conversationHistory = dbHistory.map(d => {
            return `${d.role === 'user' ? userLabel : 'Asistente'}: ${d.text}`;
        }).join('\n');

        let aiResult;

        if (isEditor) {
            // Editor: instrucciones van en systemInstruction, contexto dinámico en contents
            const actionPrompt = getEditorActionPrompt();
            const canvasSection = canvasContext ? `**Estado Actual del Lienzo:**\n${JSON.stringify(canvasContext)}\n\n` : '';
            const editorSystemPrompt = `${systemPrompt}\n\n${actionPrompt}`;

            // Fetch today's orders summary for context (Mexico timezone)
            let ordersSection = '';
            try {
                const mexicoDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
                const todayStart = new Date(mexicoDate + 'T00:00:00-06:00');
                const snap = await db.collection('pedidos')
                    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(todayStart))
                    .orderBy('createdAt', 'desc').get();
                if (!snap.empty) {
                    const totalCount = snap.size;
                    const ordersList = [];
                    for (const doc of snap.docs) {
                        const d = doc.data();
                        let clientName = 'Sin nombre';
                        const cid = d.contactId || d.telefono;
                        if (cid) {
                            const cDoc = await db.collection('contacts_whatsapp').doc(cid).get();
                            if (cDoc.exists) clientName = cDoc.data().name || clientName;
                        }
                        ordersList.push(`#${d.consecutiveOrderNumber || '?'} | ${clientName} | ${d.producto || 'N/A'} | $${d.precio || 0} | ${d.estatus || 'Sin estatus'} | id:${doc.id}`);
                    }
                    ordersSection = `**Pedidos de Hoy (${totalCount} en total):**\n${ordersList.join('\n')}\n\n`;
                }
            } catch (e) { console.warn('[Editor AI] Error fetching orders:', e.message); }

            const fullPrompt = `${canvasSection}${ordersSection}**Historial de la Conversación:**\n${conversationHistory}\n\n**Tarea:**\nResponde al último mensaje del usuario. Si pide realizar una acción en el editor, incluye el bloque \`\`\`actions correspondiente con el JSON de acciones. Si solo pregunta algo, responde con texto.`;
            aiResult = await generateGeminiResponse(fullPrompt, mediaParts, editorSystemPrompt);
        } else {
            // CRM: cache-first con knowledge base + quick replies fallback.
            // Igual que producción (processAutoReplyAI): turnos reales user/model + turno
            // final con la tarea mecánica (el tono viene solo de las instrucciones del bot).
            const historyTurns = dbHistory
                .filter(d => d.text)
                .map(d => ({ role: d.role, parts: [{ text: d.text }] }));
            const tareaText = `**Tarea:**\nSiguiendo tus instrucciones, responde al ÚLTIMO mensaje del cliente. No repitas información que ya se haya dado en la conversación (ni parafraseada), a menos que el cliente la pida de nuevo.${mediaParts.length > 0 ? ' Vienen adjuntos archivos de la conversación: analízalos con cuidado cuando sean relevantes para el último mensaje del cliente.' : ''} Si no tienes un dato, no lo inventes.`;
            const dynamicContents = [...historyTurns, { role: 'user', parts: [{ text: tareaText }] }];

            try {
                const cacheName = await getOrCreateCache(systemPrompt);
                if (cacheName) {
                    aiResult = await generateGeminiResponseWithCache(cacheName, dynamicContents, mediaParts);
                } else {
                    throw new Error('Caché no disponible');
                }
            } catch (cacheError) {
                // Fallback: misma conversación sin caché, usando systemInstruction
                console.warn(`[SIMULATOR] Caché falló (${cacheError.message}). Usando método sin caché.`);
                const kbSnapshot = await db.collection('ai_knowledge_base').get();
                const knowledgeBase = kbSnapshot.docs.map(doc => `P: ${doc.data().topic}\nR: ${doc.data().answer}`).join('\n\n');
                const qrSnapshot = await db.collection('quick_replies').get();
                const quickRepliesText = qrSnapshot.docs.filter(doc => doc.data().message).map(doc => `- ${doc.data().shortcut}: ${doc.data().message}`).join('\n');

                const fallbackSystem = `${systemPrompt}\n\n**Regla Especial de Mensajes Múltiples:** SOLO usa la etiqueta [SPLIT] si tus instrucciones EXPLÍCITAMENTE dicen enviar algo "en otro mensaje", "seguido de" otro mensaje, o "en dos mensajes separados". Si NO hay una instrucción explícita de separar en varios mensajes, responde TODO en un ÚNICO mensaje. NUNCA dividas una respuesta en múltiples mensajes por tu cuenta.`;
                const fallbackContents = [
                    { role: 'user', parts: [{ text: `**Base de Conocimiento:**\n${knowledgeBase || 'No hay información adicional.'}\n\n**Respuestas Rápidas:**\n${quickRepliesText || 'No hay respuestas rápidas.'}` }] },
                    ...historyTurns,
                    { role: 'user', parts: [{ text: tareaText }] }
                ];
                aiResult = await generateGeminiResponse(fallbackContents, mediaParts, fallbackSystem);
            }
        }

        const rawResponse = aiResult.text || '';
        const shouldQuote = /\[CITA\]/i.test(rawResponse);
        const aiResponse = rawResponse.replace(/\[CITA\]/ig, '').trim();

        res.status(200).json({ 
            success: true, 
            response: aiResponse,
            shouldQuote: shouldQuote,
            inputTokens: aiResult.inputTokens || 0,
            outputTokens: aiResult.outputTokens || 0,
            cachedTokens: aiResult.cachedTokens || 0
        });
    } catch (error) {
        console.error('Error en simulación de IA:', error);
        res.status(500).json({ success: false, message: 'Error procesando simulación IA.' });
    }
});
// --- FIN ENDPOINT SIMULADOR IA ---

// --- ENDPOINT TEXT-TO-SPEECH ---
router.post('/tts', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ success: false, message: 'Se requiere texto.' });

        // Limpiar texto: quitar bloques de acciones JSON y markdown
        const cleanText = text
            .replace(/```actions\s*\n[\s\S]*?```/g, '')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/[*_#`]/g, '')
            .trim();

        if (!cleanText) return res.status(400).json({ success: false, message: 'No hay texto para sintetizar.' });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ success: false, message: 'API key no configurada.' });

        const response = await axios.post(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
            {
                input: { text: cleanText.slice(0, 5000) },
                voice: {
                    languageCode: 'es-US',
                    name: 'es-US-Neural2-A',
                    ssmlGender: 'FEMALE'
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: 1.25,
                    pitch: 0
                }
            }
        );

        res.status(200).json({ success: true, audioContent: response.data.audioContent });
    } catch (error) {
        console.error('Error TTS:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Error generando audio.' });
    }
});
// --- FIN ENDPOINT TTS ---

// --- INICIO: NUEVAS CONSTANTES PARA COMPRESIÓN ---
const VIDEO_SIZE_LIMIT_MB = 15.5; // Límite seguro de 15.5MB (el de WhatsApp es 16MB)
const VIDEO_SIZE_LIMIT_BYTES = VIDEO_SIZE_LIMIT_MB * 1024 * 1024;
const TARGET_BITRATE = '1000k'; // Bitrate objetivo de 1 Mbps para la compresión
const IMAGE_SIZE_LIMIT_MB = 4.8; // Margen seguro bajo el límite real de WhatsApp (5MB para imágenes)
const IMAGE_SIZE_LIMIT_BYTES = IMAGE_SIZE_LIMIT_MB * 1024 * 1024;
// --- FIN: NUEVAS CONSTANTES ---

// --- INICIO: NUEVA FUNCIÓN DE COMPRESIÓN DE VIDEO ---
/**
 * Comprime un búfer de video si excede el límite de tamaño de WhatsApp.
 * @param {Buffer} inputBuffer El búfer de video a procesar.
 * @param {string} mimeType El tipo MIME del video.
 * @returns {Promise<Buffer>} Una promesa que se resuelve con el búfer de video (potencialmente comprimido).
 */
function compressVideoIfNeeded(inputBuffer, mimeType) {
    return new Promise((resolve, reject) => {
        // Si no es un video o ya está dentro del límite, no hacer nada
        if (!mimeType.startsWith('video/') || inputBuffer.length <= VIDEO_SIZE_LIMIT_BYTES) {
            console.log(`[COMPRESSOR] El archivo no es un video o está dentro del límite (${(inputBuffer.length / 1024 / 1024).toFixed(2)} MB). Omitiendo compresión.`);
            return resolve(inputBuffer);
        }

        console.log(`[COMPRESSOR] El video excede el límite (${(inputBuffer.length / 1024 / 1024).toFixed(2)} MB > ${VIDEO_SIZE_LIMIT_MB} MB). Iniciando compresión.`);

        const tempInput = tmp.fileSync({ postfix: '.mp4' });
        const tempOutput = tmp.fileSync({ postfix: '.mp4' });

        fs.writeFile(tempInput.name, inputBuffer, (err) => {
            if (err) {
                tempInput.removeCallback();
                tempOutput.removeCallback();
                return reject(err);
            }

            ffmpeg(tempInput.name)
                .outputOptions([
                    '-c:v libx264',
                    `-b:v ${TARGET_BITRATE}`,
                    '-c:a aac',
                    '-b:a 128k',
                    '-preset ultrafast', // Prioriza la velocidad sobre la calidad de compresión
                    '-crf 28' // Controla la calidad (más alto = menor calidad, menor tamaño)
                ])
                .on('end', () => {
                    console.log('[COMPRESSOR] Procesamiento con FFmpeg finalizado.');
                    fs.readFile(tempOutput.name, (err, compressedBuffer) => {
                        tempInput.removeCallback();
                        tempOutput.removeCallback();
                        if (err) return reject(err);
                        console.log(`[COMPRESSOR] Compresión exitosa. Nuevo tamaño: ${(compressedBuffer.length / 1024 / 1024).toFixed(2)} MB.`);
                        resolve(compressedBuffer);
                    });
                })
                .on('error', (err) => {
                    console.error('[COMPRESSOR] Error de FFmpeg:', err);
                    tempInput.removeCallback();
                    tempOutput.removeCallback();
                    reject(new Error('No se pudo comprimir el video. ' + err.message));
                })
                .save(tempOutput.name);
        });
    });
}
// --- FIN: NUEVA FUNCIÓN ---

// --- INICIO: NUEVA FUNCIÓN PARA CONVERSIÓN DE AUDIO ---
/**
 * Convierte un búfer de audio a formato OGG con códec Opus para ser enviado como nota de voz.
 * @param {Buffer} inputBuffer El búfer de audio a procesar.
 * @param {string} mimeType El tipo MIME original del audio.
 * @returns {Promise<{buffer: Buffer, mimeType: string}>} Una promesa que resuelve con el búfer (potencialmente convertido) y el nuevo tipo MIME.
 */
function convertAudioToOggOpusIfNeeded(inputBuffer, mimeType) {
    return new Promise((resolve) => { // No rechaza, siempre resuelve.
        // Si ya es ogg o no es audio, devolver original
        if (!mimeType.startsWith('audio/') || mimeType === 'audio/ogg') {
            return resolve({ buffer: inputBuffer, mimeType: mimeType });
        }

        console.log(`[AUDIO CONVERTER] Convirtiendo audio de ${mimeType} a OGG Opus.`);
        const tempInput = tmp.fileSync({ postfix: `.${mimeType.split('/')[1] || 'tmp'}` });
        const tempOutput = tmp.fileSync({ postfix: '.ogg' });

        fs.writeFile(tempInput.name, inputBuffer, (err) => {
            if (err) {
                tempInput.removeCallback();
                tempOutput.removeCallback();
                console.warn(`[AUDIO CONVERTER] Fallo al escribir archivo temporal. Se enviará como archivo estándar.`);
                return resolve({ buffer: inputBuffer, mimeType: mimeType }); // Devolver original en caso de error
            }

            ffmpeg(tempInput.name)
                // Opciones para OGG Opus compatible con WhatsApp (nota de voz)
                .outputOptions(['-c:a libopus', '-b:a 16k', '-vbr off', '-ar 16000'])
                .on('end', () => {
                    fs.readFile(tempOutput.name, (err, convertedBuffer) => {
                        tempInput.removeCallback();
                        tempOutput.removeCallback();
                        if (err) {
                            console.warn(`[AUDIO CONVERTER] Fallo al leer archivo convertido. Se enviará como archivo estándar.`);
                            return resolve({ buffer: inputBuffer, mimeType: mimeType }); // Devolver original
                        }
                        console.log(`[AUDIO CONVERTER] Conversión a OGG Opus exitosa.`);
                        resolve({ buffer: convertedBuffer, mimeType: 'audio/ogg' }); // Devolver convertido
                    });
                })
                .on('error', (err) => {
                    tempInput.removeCallback();
                    tempOutput.removeCallback();
                    console.warn(`[AUDIO CONVERTER] Falló la conversión a OGG: ${err.message}. Se enviará como archivo de audio estándar.`);
                    resolve({ buffer: inputBuffer, mimeType: mimeType }); // Devolver original
                })
                .save(tempOutput.name);
        });
    });
}
// --- FIN: NUEVA FUNCIÓN ---

/**
 * Comprime una imagen si excede el límite de WhatsApp (5MB para imágenes).
 * Convierte a JPEG y redimensiona/recomprime con presets progresivos hasta caber.
 * @param {Buffer} inputBuffer Búfer de la imagen original.
 * @param {string} mimeType Tipo MIME original.
 * @returns {Promise<{buffer: Buffer, mimeType: string}>} Búfer (potencialmente recomprimido) y MIME final.
 */
async function compressImageIfNeeded(inputBuffer, mimeType) {
    if (!mimeType.startsWith('image/') || inputBuffer.length <= IMAGE_SIZE_LIMIT_BYTES) {
        return { buffer: inputBuffer, mimeType };
    }

    console.log(`[IMAGE COMPRESSOR] La imagen excede el límite (${(inputBuffer.length / 1024 / 1024).toFixed(2)} MB > ${IMAGE_SIZE_LIMIT_MB} MB). Iniciando compresión.`);

    const presets = [
        { width: 2560, quality: 85 },
        { width: 1920, quality: 82 },
        { width: 1600, quality: 78 },
        { width: 1280, quality: 72 },
        { width: 1024, quality: 65 },
        { width: 800, quality: 55 },
    ];

    try {
        for (const preset of presets) {
            const compressed = await sharp(inputBuffer)
                .rotate() // Respetar orientación EXIF
                .resize({ width: preset.width, withoutEnlargement: true, fit: 'inside' })
                .jpeg({ quality: preset.quality, mozjpeg: true })
                .toBuffer();

            if (compressed.length <= IMAGE_SIZE_LIMIT_BYTES) {
                console.log(`[IMAGE COMPRESSOR] Compresión exitosa con preset ${preset.width}px / q${preset.quality}. Nuevo tamaño: ${(compressed.length / 1024 / 1024).toFixed(2)} MB.`);
                return { buffer: compressed, mimeType: 'image/jpeg' };
            }
        }

        // Si ningún preset funcionó, devolver el más agresivo igual (último del array)
        const last = presets[presets.length - 1];
        const fallback = await sharp(inputBuffer)
            .rotate()
            .resize({ width: last.width, withoutEnlargement: true, fit: 'inside' })
            .jpeg({ quality: last.quality, mozjpeg: true })
            .toBuffer();
        console.warn(`[IMAGE COMPRESSOR] Ningún preset bajó del límite. Enviando el más comprimido: ${(fallback.length / 1024 / 1024).toFixed(2)} MB.`);
        return { buffer: fallback, mimeType: 'image/jpeg' };
    } catch (err) {
        console.error(`[IMAGE COMPRESSOR] Falló la compresión, se enviará el original: ${err.message}`);
        return { buffer: inputBuffer, mimeType };
    }
}

// --- INICIO: Helper function to parse ad IDs ---
/**
 * Parses the adIds input (string or array) into a clean array of strings.
 * @param {string|string[]} adIdsInput - The input from the request body.
 * @returns {string[]} An array of unique, trimmed ad IDs.
 */
function parseAdIds(adIdsInput) {
    if (!adIdsInput) return [];
    let ids = [];
    if (Array.isArray(adIdsInput)) {
        ids = adIdsInput;
    } else if (typeof adIdsInput === 'string') {
        // Split by comma, trim whitespace, and filter out empty strings
        ids = adIdsInput.split(',').map(id => id.trim()).filter(id => id);
    }
    // Remove duplicates and ensure they are strings
    return [...new Set(ids.map(id => String(id).trim()).filter(id => id))];
}
// --- FIN: Helper function ---

/**
 * Sube un archivo multimedia a los servidores de WhatsApp y devuelve su ID.
 * MODIFICADO: Añade compresión de video y conversión de audio antes de la subida.
 * @param {string} mediaUrl La URL pública del archivo (GCS o externa).
 * @param {string} mimeType El tipo MIME del archivo (ej. 'video/mp4').
 * @returns {Promise<string>} El ID del medio asignado por WhatsApp.
 */
async function uploadMediaToWhatsApp(mediaUrl, mimeType) {
    try {
        console.log(`[MEDIA UPLOAD] Descargando ${mediaUrl} para procesar y subir...`);
        // Descargar el archivo como buffer
        const fileResponse = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
        let fileBuffer = fileResponse.data;
        let finalMimeType = mimeType;
        // Extraer nombre de archivo de la URL
        const fileName = path.basename(new URL(mediaUrl).pathname) || `media.${mimeType.split('/')[1] || 'bin'}`;

        // --- INICIO: PASO DE COMPRESIÓN/CONVERSIÓN AÑADIDO ---
        if (mimeType.startsWith('video/')) {
            fileBuffer = await compressVideoIfNeeded(fileBuffer, mimeType);
        } else if (mimeType.startsWith('audio/')) {
            // Convertir audio a OGG Opus si es necesario
            const conversionResult = await convertAudioToOggOpusIfNeeded(fileBuffer, mimeType);
            fileBuffer = conversionResult.buffer;
            finalMimeType = conversionResult.mimeType; // Podría ser 'audio/ogg' ahora
        } else if (mimeType.startsWith('image/')) {
            // Comprimir imagen si excede el límite (5MB) — convierte a JPEG si es necesario
            const compressionResult = await compressImageIfNeeded(fileBuffer, mimeType);
            fileBuffer = compressionResult.buffer;
            finalMimeType = compressionResult.mimeType; // Podría ser 'image/jpeg' ahora
        }
        // --- FIN: PASO DE COMPRESIÓN/CONVERSIÓN AÑADIDO ---

        // Crear FormData para la subida a WhatsApp
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', fileBuffer, {
            filename: fileName, // Nombre de archivo original
            contentType: finalMimeType, // Tipo MIME final (puede haber cambiado para audio)
        });

        console.log(`[MEDIA UPLOAD] Subiendo ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB, tipo: ${finalMimeType}) a WhatsApp...`);
        // Realizar la subida a la API de Medios de WhatsApp
        const uploadResponse = await axios.post(
            `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/media`,
            form,
            {
                headers: {
                    ...form.getHeaders(), // Headers necesarios para FormData
                    'Authorization': `Bearer ${WHATSAPP_TOKEN}`
                },
                maxContentLength: Infinity, // Permitir archivos grandes
                maxBodyLength: Infinity,
            }
        );

        const mediaId = uploadResponse.data.id;
        if (!mediaId) {
            throw new Error("La API de WhatsApp no devolvió un ID de medio.");
        }

        console.log(`[MEDIA UPLOAD] Archivo subido con éxito. Media ID: ${mediaId}`);
        return mediaId; // Devolver el ID del medio de WhatsApp

    } catch (error) {
        // Manejo detallado de errores
        console.error('❌ Error al subir archivo a WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw new Error('No se pudo subir el archivo a los servidores de WhatsApp.');
    }
}


/**
 * Construye el payload para enviar una plantilla avanzada de WhatsApp (con header, body, botones).
 * @param {string} contactId ID del contacto (número de teléfono).
 * @param {object} templateObject Objeto de la plantilla obtenido de la API de Meta.
 * @param {string|null} [imageUrl=null] URL de la imagen para plantillas con cabecera de imagen.
 * @param {string[]} [bodyParams=[]] Array de strings para reemplazar variables {{2}}, {{3}}, etc. en el cuerpo.
 * @returns {Promise<{payload: object, messageToSaveText: string}>} Objeto con el payload y el texto para guardar en DB.
 */
async function buildAdvancedTemplatePayload(contactId, templateObject, imageUrl = null, bodyParams = []) {
    // ... (el resto de la función no necesita cambios)
    console.log('[DIAGNÓSTICO] Objeto de plantilla recibido:', JSON.stringify(templateObject, null, 2));
    const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
    // Usa el nombre del contacto si existe, si no 'Cliente'
    const contactName = contactDoc.exists ? contactDoc.data().name : 'Cliente';

    // Extraer datos relevantes de la plantilla
    const { name: templateName, components: templateComponents, language } = templateObject;

    const payloadComponents = []; // Array para los componentes del payload final
    let messageToSaveText = `📄 Plantilla: ${templateName}`; // Texto por defecto para guardar en DB

    // --- Procesar Cabecera (HEADER) ---
    // Nota: el parametro se llama `imageUrl` por historia pero acepta cualquier media URL
    // (imagen/video/documento). Lo usamos como `mediaUrl` segun el formato del HEADER.
    const headerDef = templateComponents?.find(c => c.type === 'HEADER');
    const mediaUrl = imageUrl;
    if (headerDef?.format === 'IMAGE') {
        if (!mediaUrl) throw new Error(`La plantilla '${templateName}' requiere una imagen.`);
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'image', image: { link: mediaUrl } }]
        });
        messageToSaveText = `🖼️ Plantilla con imagen: ${templateName}`;
    }
    else if (headerDef?.format === 'VIDEO') {
        if (!mediaUrl) throw new Error(`La plantilla '${templateName}' requiere un video.`);
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'video', video: { link: mediaUrl } }]
        });
        messageToSaveText = `🎬 Plantilla con video: ${templateName}`;
    }
    else if (headerDef?.format === 'DOCUMENT') {
        if (!mediaUrl) throw new Error(`La plantilla '${templateName}' requiere un documento.`);
        const filename = (typeof mediaUrl === 'string' && mediaUrl.split('/').pop().split('?')[0]) || 'documento.pdf';
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'document', document: { link: mediaUrl, filename } }]
        });
        messageToSaveText = `📄 Plantilla con documento: ${templateName}`;
    }
    // Si la cabecera es texto y espera una variable ({{1}}), usar el nombre del contacto
    if (headerDef?.format === 'TEXT' && headerDef.text?.includes('{{1}}')) {
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'text', text: contactName }]
        });
    }

    // --- Procesar Cuerpo (BODY) ---
    // Meta soporta dos estilos de variables (mutuamente excluyentes por plantilla):
    //   - Numeradas:  {{1}}, {{2}}, ...
    //   - Con nombre: {{customer_name}}, {{discount}}, ...
    // El payload tiene formato distinto: las nombradas requieren `parameter_name`.
    const bodyDef = templateComponents?.find(c => c.type === 'BODY');
    if (bodyDef) {
        const bodyText = bodyDef.text || '';

        // Detectar variables con nombre (primero, son mas especificas que las numeradas)
        const namedRe = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
        const namedMatches = [];
        let nm;
        while ((nm = namedRe.exec(bodyText)) !== null) {
            if (!namedMatches.includes(nm[1])) namedMatches.push(nm[1]);
        }

        // Detectar variables numeradas
        const numRe = /\{\{(\d+)\}\}/g;
        const varNumbers = new Set();
        while ((nm = numRe.exec(bodyText)) !== null) varNumbers.add(Number(nm[1]));
        const maxVar = varNumbers.size ? Math.max(...varNumbers) : 0;

        // Heuristica: nombres que tipicamente representan el nombre del contacto
        const NAME_PARAM_RE = /^(customer_name|nombre|nombre_cliente|client_name|first_name|name)$/i;

        if (namedMatches.length > 0) {
            // ---- Variables con nombre ----
            const examplesByName = {};
            (bodyDef.example?.body_text_named_params || []).forEach(p => {
                examplesByName[p.param_name] = p.example;
            });
            const parameters = namedMatches.map((name, idx) => {
                let value;
                if (NAME_PARAM_RE.test(name)) {
                    value = contactName;
                } else if (bodyParams[idx] !== undefined && bodyParams[idx] !== null) {
                    value = bodyParams[idx];
                } else if (examplesByName[name] !== undefined && examplesByName[name] !== null) {
                    value = examplesByName[name];
                } else {
                    value = '';
                }
                return { type: 'text', parameter_name: name, text: String(value) };
            });
            payloadComponents.push({ type: 'body', parameters });

            // Reconstruir texto para DB
            let tempText = bodyText;
            parameters.forEach(p => {
                tempText = tempText.replace(new RegExp(`\\{\\{${p.parameter_name}\\}\\}`, 'g'), p.text);
            });
            messageToSaveText = tempText;

        } else if (maxVar > 0) {
            // ---- Variables numeradas ----
            const exampleValues = (bodyDef.example?.body_text?.[0]) || [];
            const allParams = [];
            for (let i = 0; i < maxVar; i++) {
                if (i === 0) {
                    allParams.push(contactName);
                } else if (bodyParams[i - 1] !== undefined && bodyParams[i - 1] !== null) {
                    allParams.push(bodyParams[i - 1]);
                } else if (exampleValues[i] !== undefined && exampleValues[i] !== null) {
                    allParams.push(exampleValues[i]);
                } else {
                    allParams.push('');
                }
            }
            const parameters = allParams.map(p => ({ type: 'text', text: String(p) }));
            payloadComponents.push({ type: 'body', parameters });

            let tempText = bodyText;
            parameters.forEach((param, index) => {
                tempText = tempText.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), param.text);
            });
            messageToSaveText = tempText;

        } else {
            // Sin variables
            payloadComponents.push({ type: 'body', parameters: [] });
            messageToSaveText = bodyText || messageToSaveText;
        }
    }

    // --- Procesar Botones (BUTTONS) ---
    const buttonsDef = templateComponents?.find(c => c.type === 'BUTTONS');
    buttonsDef?.buttons?.forEach((button, index) => {
        // Si el botón es de tipo URL y espera una variable ({{1}}), usar el contactId
        if (button.type === 'URL' && button.url?.includes('{{1}}')) {
            payloadComponents.push({
                type: 'button',
                sub_type: 'url',
                index: index.toString(), // El índice debe ser string
                parameters: [{ type: 'text', text: contactId }] // Usar el ID del contacto
            });
        }
        // Nota: Los botones de respuesta rápida (quick_reply) no necesitan parámetros aquí.
    });

    // Construir el payload final
    const payload = {
        messaging_product: 'whatsapp',
        to: contactId,
        type: 'template',
        template: {
            name: templateName,
            language: { code: language }
            // components se añade solo si hay alguno
        }
    };
    if (payloadComponents.length > 0) {
        payload.template.components = payloadComponents;
    }

    console.log(`[DIAGNÓSTICO] Payload final construido para ${contactId}:`, JSON.stringify(payload, null, 2));
    // Devolver el payload y el texto representativo
    return { payload, messageToSaveText };
}

// Extrae metadatos de una plantilla para guardar en el doc del mensaje
// (para que el CRM pueda renderizar botones, footer y previsualizar media tal como
// los recibe el cliente en WhatsApp).
function extractTemplateMetadata(template, mediaUrl) {
    const meta = { templateName: template.name, templateLanguage: template.language || null };
    const header = template.components?.find(c => c.type === 'HEADER');
    const buttonsDef = template.components?.find(c => c.type === 'BUTTONS');
    const footer = template.components?.find(c => c.type === 'FOOTER');
    if (header?.format && mediaUrl) {
        const mimeByFormat = { IMAGE: 'image/jpeg', VIDEO: 'video/mp4', DOCUMENT: 'application/pdf' };
        if (mimeByFormat[header.format]) {
            meta.fileUrl = mediaUrl;
            meta.fileType = mimeByFormat[header.format];
        }
    }
    if (footer?.text) meta.templateFooter = footer.text;
    if (buttonsDef?.buttons?.length) {
        meta.templateButtons = buttonsDef.buttons.map(b => ({
            type: b.type, // QUICK_REPLY | URL | PHONE_NUMBER
            text: b.text || '',
            url: b.url || null,
            phone_number: b.phone_number || null
        }));
    }
    return meta;
}

// =============================================================
// TEMPLATE TRACKING (Fase 1) — registra cada envio de plantilla
// =============================================================
// Escribe en:
//  - template_batches/{batchId}: metadatos de la tanda (template, fuente, total)
//  - template_sends/{auto}: una doc por envio (contactId, wamid, status, source, batchId)
// Disenado para fallar silenciosamente: si el tracking explota, el envio NO se rompe.
const TEMPLATE_TRACKING_SOURCES = new Set(['chat', 'retargeting_plantilla']);

async function recordTemplateSend({ contactId, contactName, template, wamid, source, batchId, batchTotal, sentBy }) {
    try {
        if (!contactId || !template?.name || !wamid || !batchId) {
            console.warn('[template-tracking] Faltan campos requeridos, no se registra.');
            return;
        }
        if (!TEMPLATE_TRACKING_SOURCES.has(source)) {
            console.warn(`[template-tracking] Fuente desconocida "${source}", no se registra.`);
            return;
        }
        const now = admin.firestore.FieldValue.serverTimestamp();

        // Upsert del batch (merge no sobreescribe createdAt / total si ya existian)
        const batchRef = db.collection('template_batches').doc(batchId);
        const batchSnap = await batchRef.get();
        if (!batchSnap.exists) {
            await batchRef.set({
                templateName: template.name,
                templateLanguage: template.language || null,
                source,
                sentBy: sentBy || null,
                createdAt: now,
                total: Number(batchTotal) || 1
            });
        }

        await db.collection('template_sends').add({
            contactId,
            contactName: contactName || null,
            templateName: template.name,
            templateLanguage: template.language || null,
            batchId,
            source,
            wamid,
            sentAt: now,
            status: 'sent',
            deliveredAt: null,
            readAt: null,
            failedAt: null,
            failureReason: null,
            repliedAt: null,
            blocked: false
        });
    } catch (e) {
        console.error('[template-tracking] Error registrando envio:', e.message);
    }
}


// --- El resto de las rutas no necesitan cambios ---
// ... (todas las demás rutas permanecen igual) ...
// --- Endpoint GET /api/contacts/pending-ia-count (Conteo global de pendientes IA) ---
router.get('/contacts/pending-ia-count', async (req, res) => {
    try {
        const { departmentId } = req.query;
        let query = db.collection('contacts_whatsapp').where('status', '==', 'pendientes_ia');

        // Filtrar por departamento si es necesario (para que el conteo sea relevante al usuario)
        if (departmentId && departmentId !== 'all') {
            if (departmentId.includes(',')) {
                const ids = departmentId.split(',').map(id => id.trim()).filter(id => id);
                if (ids.length > 0) {
                    query = query.where('assignedDepartmentId', 'in', ids.slice(0, 10));
                }
            } else {
                query = query.where('assignedDepartmentId', '==', departmentId);
            }
        }

        const countSnapshot = await query.count().get();
        const totalCount = countSnapshot.data().count;

        res.status(200).json({ success: true, count: totalCount });
    } catch (error) {
        console.error('Error getting pending IA count:', error);
        res.status(500).json({ success: false, message: 'Error al obtener el conteo.', error: error.message });
    }
});

// --- GET /api/leads/daily-count ---
// "Leads WA" por dia: conversaciones que llegan desde un anuncio (mensajes con referral de anuncio),
// pre-agregadas en daily_metrics.adLeads. No importa si el contacto ya existia. Cuenta desde que se
// desplego el contador (no hay historico previo).
// Query: from, to (YYYY-MM-DD). Respuesta: { success, from, to, leadsByDate: { fecha: n }, total }.
router.get('/leads/daily-count', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) {
            return res.status(400).json({ success: false, message: 'Se requieren from y to (YYYY-MM-DD).' });
        }
        const snap = await db.collection('daily_metrics')
            .where(admin.firestore.FieldPath.documentId(), '>=', from)
            .where(admin.firestore.FieldPath.documentId(), '<=', to)
            .get();
        const leadsByDate = {};
        let total = 0;
        snap.forEach(doc => {
            const n = Number(doc.data().adLeads) || 0;
            if (n > 0) { leadsByDate[doc.id] = n; total += n; }
        });
        res.status(200).json({ success: true, from, to, leadsByDate, total });
    } catch (error) {
        console.error('Error getting daily leads count:', error);
        res.status(500).json({ success: false, message: 'Error al obtener leads por dia.', error: error.message });
    }
});

// --- GET /api/orders/daily-count ---
// "Pedidos cerrados" por dia: cuenta pedidos con estatus 'Pagado' o 'Fabricar' (venta confirmada),
// agrupados por dia en zona horaria de Mexico (UTC-6), igual que /api/orders/today. Tiene historico.
// Query: from, to (YYYY-MM-DD). Respuesta: { success, from, to, closedByDate: { fecha: n }, total }.
router.get('/orders/daily-count', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) {
            return res.status(400).json({ success: false, message: 'Se requieren from y to (YYYY-MM-DD).' });
        }
        const CLOSED = ['Pagado', 'Fabricar'];
        const startTs = admin.firestore.Timestamp.fromDate(new Date(from + 'T00:00:00-06:00'));
        const endTs = admin.firestore.Timestamp.fromDate(new Date(to + 'T23:59:59-06:00'));
        const snap = await db.collection('pedidos')
            .where('createdAt', '>=', startTs)
            .where('createdAt', '<=', endTs)
            .select('createdAt', 'estatus')
            .get();
        const closedByDate = {};
        let total = 0;
        snap.forEach(doc => {
            const d = doc.data();
            if (!d.createdAt || typeof d.createdAt.toDate !== 'function') return;
            if (!CLOSED.includes(d.estatus)) return;
            const day = d.createdAt.toDate().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
            closedByDate[day] = (closedByDate[day] || 0) + 1;
            total++;
        });
        res.status(200).json({ success: true, from, to, closedByDate, total });
    } catch (error) {
        console.error('Error getting daily orders count:', error);
        res.status(500).json({ success: false, message: 'Error al obtener pedidos por dia.', error: error.message });
    }
});

// --- Helper: arma query de contactos con botActive=true filtrada por depto ---
// Soporta departmentId simple ("X") o multi separado por coma ("X,Y,Z", max 10).
function buildIaActiveQueryForDept(departmentId) {
    let query = db.collection('contacts_whatsapp').where('botActive', '==', true);
    if (departmentId && departmentId !== 'all') {
        if (departmentId.includes(',')) {
            const ids = departmentId.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
            if (ids.length > 0) {
                query = query.where('assignedDepartmentId', 'in', ids);
            }
        } else {
            query = query.where('assignedDepartmentId', '==', departmentId);
        }
    }
    return query;
}

// --- GET /api/contacts/ia-active-count ---
// Cuenta contactos con IA activa (botActive=true) en el depto indicado.
// Usa Firestore count() — barato, no lee documentos.
router.get('/contacts/ia-active-count', async (req, res) => {
    try {
        const { departmentId } = req.query;
        if (!departmentId) {
            return res.status(400).json({ success: false, message: 'Se requiere departmentId.' });
        }
        const query = buildIaActiveQueryForDept(departmentId);
        const countSnapshot = await query.count().get();
        const totalCount = countSnapshot.data().count;
        res.status(200).json({ success: true, count: totalCount });
    } catch (error) {
        console.error('Error counting IA-active contacts:', error);
        res.status(500).json({ success: false, message: 'Error al contar contactos con IA activa.', error: error.message });
    }
});

// --- GET /api/departments/contact-counts ---
// Devuelve cuántos contactos hay asignados a CADA departamento.
// Usa Firestore count() por depto (agregación barata, no lee documentos) en paralelo.
// Respuesta: { success, counts: { [departmentId]: n }, total }.
router.get('/departments/contact-counts', async (req, res) => {
    try {
        // Tomar los IDs de departamento solicitados, o todos los existentes si no se especifican.
        let deptIds;
        if (req.query.departmentIds) {
            deptIds = req.query.departmentIds.split(',').map(s => s.trim()).filter(Boolean);
        } else {
            const deptsSnap = await db.collection('departments').select().get();
            deptIds = deptsSnap.docs.map(doc => doc.id);
        }

        const counts = {};
        let total = 0;
        await Promise.all(deptIds.map(async (id) => {
            const snap = await db.collection('contacts_whatsapp')
                .where('assignedDepartmentId', '==', id)
                .count().get();
            const n = snap.data().count || 0;
            counts[id] = n;
            total += n;
        }));

        res.status(200).json({ success: true, counts, total });
    } catch (error) {
        console.error('Error getting department contact counts:', error);
        res.status(500).json({ success: false, message: 'Error al obtener el conteo por departamento.', error: error.message });
    }
});

// --- POST /api/contacts/disable-ia-bulk ---
// Desactiva la IA (botActive=false) para TODOS los contactos del depto que la tengan
// activa actualmente. Procesa en batches de 500 (limite de Firestore para writes).
router.post('/contacts/disable-ia-bulk', async (req, res) => {
    try {
        const { departmentId } = req.body || {};
        if (!departmentId) {
            return res.status(400).json({ success: false, message: 'Se requiere departmentId en el body.' });
        }

        const query = buildIaActiveQueryForDept(departmentId);
        const snapshot = await query.get();

        if (snapshot.empty) {
            return res.status(200).json({ success: true, disabled: 0, message: 'No había contactos con IA activa.' });
        }

        // Batches de 500 (limite de Firestore para writes en un solo batch)
        const docs = snapshot.docs;
        const BATCH_SIZE = 500;
        let disabled = 0;

        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const slice = docs.slice(i, i + BATCH_SIZE);
            slice.forEach(doc => {
                batch.update(doc.ref, { botActive: false });
            });
            await batch.commit();
            disabled += slice.length;
        }

        console.log(`[disable-ia-bulk] Desactivada IA para ${disabled} contactos en depto(s): ${departmentId}`);
        res.status(200).json({ success: true, disabled });
    } catch (error) {
        console.error('Error desactivando IA masivo:', error);
        res.status(500).json({ success: false, message: 'Error al desactivar IA masivo.', error: error.message });
    }
});

// Helper: enciende la IA del contacto (botActive=true + campos extra) y, si el último
// mensaje es del cliente (sin contestar), dispara la IA para que lo revise y responda.
// Lo usan tanto "activar venta" (sin tocar aiStage) como "activar post-venta" (aiStage='postventa').
async function activateAiAndAnswerPending(contactRef, snap, extraUpdate = {}) {
    const contactId = contactRef.id;
    const update = { botActive: true, ...extraUpdate };
    await contactRef.update(update);

    let answering = false;
    const lastSnap = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(1).get();
    if (!lastSnap.empty) {
        const lastMsg = lastSnap.docs[0].data();
        if (lastMsg.from === contactId) { // entrante = del cliente, sin contestar
            answering = true;
            const { processAutoReplyAI, cancelPendingAiTimer: cancelTimer } = require('./services');
            // Si había un temporizador pendiente para este contacto, cancelarlo: aquí se
            // genera de inmediato y el timer dispararía una SEGUNDA respuesta después.
            cancelTimer(contactId);
            const message = { id: lastMsg.id, text: lastMsg.text || '' };
            const freshData = { ...snap.data(), ...update };
            // Fire-and-forget: no bloquear la respuesta HTTP con la generación de la IA.
            processAutoReplyAI(contactId, message, contactRef, freshData)
                .catch(e => console.error(`[activate-ai] IA falló para ${contactId}:`, e.message));
        }
    }
    return answering;
}

// --- POST /api/contacts/:contactId/activate-ai ---
// Enciende la IA de VENTA (botActive=true, sin tocar la etapa) y contesta el mensaje
// pendiente del cliente si lo hay. Lo usa el toggle del robot al ENCENDER.
router.post('/contacts/:contactId/activate-ai', async (req, res) => {
    try {
        const { contactId } = req.params;
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const snap = await contactRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        const answering = await activateAiAndAnswerPending(contactRef, snap, {});
        return res.status(200).json({ success: true, answering });
    } catch (error) {
        console.error('[activate-ai] error:', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// --- POST /api/contacts/:contactId/activate-postventa ---
// Activa la etapa 2 (post-venta) SIN enviarle /final: aiStage='postventa' + botActive=true,
// y contesta el mensaje pendiente del cliente si lo hay (ya en modo post-venta).
router.post('/contacts/:contactId/activate-postventa', async (req, res) => {
    try {
        const { contactId } = req.params;
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const snap = await contactRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        const answering = await activateAiAndAnswerPending(contactRef, snap, { aiStage: 'postventa' });
        return res.status(200).json({ success: true, answering });
    } catch (error) {
        console.error('[activate-postventa] error:', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// --- Endpoint GET /api/contacts (Paginado y con filtro de etiqueta) ---
router.get('/contacts', async (req, res) => {
    try {
        const { limit = 30, startAfterId, tag, departmentId } = req.query; // AÑADIDO: departmentId
        let query = db.collection('contacts_whatsapp');

        // Aplicar filtro de etiqueta si se proporciona
        if (tag) {
            query = query.where('status', '==', tag);
        }

        // Aplicar filtro de no leídos si se proporciona
        if (req.query.unreadOnly === 'true') {
            query = query.where('unreadCount', '>', 0);
        }

        // Aplicar filtro por estatus de compra (coronita gris/azul)
        if (req.query.purchaseStatus) {
            if (req.query.purchaseStatus === 'both') {
                query = query.where('purchaseStatus', 'in', ['registered', 'completed']);
            } else {
                query = query.where('purchaseStatus', '==', req.query.purchaseStatus);
            }
        }

        // Aplicar filtro de revisión de diseño
        if (req.query.designReview === 'true') {
            query = query.where('inDesignReview', '==', true);
        }

        // Filtro "Archivados": SOLO chats archivados. Se consulta en Firestore (no en memoria) para que
        // persistan al recargar, aunque el chat ya no esté en la primera página por recencia.
        if (req.query.archivedOnly === 'true') {
            query = query.where('archived', '==', true);
        }

        // Aplicar filtro de canal (whatsapp, messenger, instagram)
        if (req.query.channel) {
            query = query.where('channel', '==', req.query.channel);
        }

        // --- Filtro por anuncio(s) de origen ---
        // Coincide si el contacto tuvo ese anuncio como fuente EN CUALQUIER momento de su historial,
        // aunque también haya venido de otros anuncios. Usa el campo plano 'adSourceIds'
        // (poblado desde adReferralHistory) porque Firestore no indexa arreglos de objetos.
        // Acepta uno (adSourceId, retrocompat) o varios (adSourceIds, separados por coma).
        let adSourceIdsFilter = [];
        if (req.query.adSourceIds) {
            adSourceIdsFilter = String(req.query.adSourceIds).split(',').map(s => s.trim()).filter(Boolean);
        } else if (req.query.adSourceId) {
            adSourceIdsFilter = [String(req.query.adSourceId).trim()].filter(Boolean);
        }
        // 'array-contains-any' admite hasta 30 valores; recortamos por seguridad y quitamos duplicados.
        adSourceIdsFilter = [...new Set(adSourceIdsFilter)].slice(0, 30);
        const multiAds = adSourceIdsFilter.length > 1;

        // --- INICIO: Filtro por Departamento ---
        // Si se proporciona departmentId, filtrar por 'assignedDepartmentId'.
        // Firestore NO permite combinar 'in' con 'array-contains-any' en la misma consulta; por eso,
        // cuando hay varios anuncios + varios departamentos, el de departamentos se aplica en memoria
        // tras la consulta (sin perder la restricción de visibilidad del agente).
        let deptIdsInMemory = null;
        if (departmentId && departmentId !== 'all') {
            // Soporte para múltiples IDs separados por coma (para usuarios con múltiples departamentos)
            if (departmentId.includes(',')) {
                // Nota: Firestore limita el operador 'in' a 10 valores.
                const ids = departmentId.split(',').map(id => id.trim()).filter(id => id).slice(0, 10);
                if (ids.length === 1) {
                    query = query.where('assignedDepartmentId', '==', ids[0]);
                } else if (ids.length > 1) {
                    if (multiAds) {
                        deptIdsInMemory = ids; // se filtra en memoria para no chocar con array-contains-any
                    } else {
                        query = query.where('assignedDepartmentId', 'in', ids);
                    }
                }
            } else {
                query = query.where('assignedDepartmentId', '==', departmentId);
            }
        }
        // --- FIN: Filtro por Departamento ---

        // Aplicar el filtro de anuncio(s): uno → array-contains; varios → array-contains-any.
        if (adSourceIdsFilter.length === 1) {
            query = query.where('adSourceIds', 'array-contains', adSourceIdsFilter[0]);
        } else if (adSourceIdsFilter.length > 1) {
            query = query.where('adSourceIds', 'array-contains-any', adSourceIdsFilter);
        }

        // Ordenar por último mensaje y limitar resultados
        const noLimit = req.query.unreadOnly === 'true';
        if (req.query.unreadOnly === 'true') {
            // Firestore requiere ordenar primero por el campo de la desigualdad (unreadCount > 0)
            query = query.orderBy('unreadCount', 'desc').orderBy('lastMessageTimestamp', 'desc');
        } else {
            // purchaseStatus usa igualdad, permite orderBy timestamp + limit + paginación normal
            query = query.orderBy('lastMessageTimestamp', 'desc').limit(Number(limit));
        }

        // Paginación: no aplica con unreadOnly que trae todo
        if (startAfterId && !noLimit) {
            const lastDoc = await db.collection('contacts_whatsapp').doc(startAfterId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc); // Iniciar consulta después de este documento
            }
        }

        // Ejecutar la consulta
        const snapshot = await query.get();
        let contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Restricción de departamentos aplicada en memoria (ver nota del filtro de departamento arriba).
        if (deptIdsInMemory) {
            const allow = new Set(deptIdsInMemory);
            contacts = contacts.filter(c => allow.has(c.assignedDepartmentId));
        }

        // Obtener el ID del último documento para la siguiente página
        const lastVisibleId = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null;

        res.status(200).json({ success: true, contacts, lastVisibleId });
    } catch (error) {
        console.error('Error fetching paginated contacts:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener contactos.', errorDetails: error.message || error.details || error.toString() });
    }
});

// --- Endpoint PUT /api/contacts/:contactId/transfer (Transferir Chat a Departamento) ---
router.put('/contacts/:contactId/transfer', async (req, res) => {
    const { contactId } = req.params;
    const { targetDepartmentId } = req.body;

    if (!targetDepartmentId) {
        return res.status(400).json({ success: false, message: 'Se requiere el ID del departamento destino.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        await contactRef.update({ 
            assignedDepartmentId: targetDepartmentId,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(), // Trigger frontend update
            unreadCount: 1 // Mark as unread
        });
        res.status(200).json({ success: true, message: `Chat transferido al departamento '${targetDepartmentId}'.` });
    } catch (error) {
        console.error(`Error al transferir el chat ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error al transferir el chat.' });
    }
});

// --- Endpoint GET /api/contacts/search (Búsqueda de contactos) ---
router.get('/contacts/search', async (req, res) => {
    const { query } = req.query;
    console.log(`[SEARCH] Iniciando búsqueda para: "${query}"`);
    if (!query) {
        return res.status(400).json({ success: false, message: 'Se requiere un término de búsqueda.' });
    }

    try {
        const searchResults = [];
        const lowercaseQuery = query.toLowerCase();
        const uniqueIds = new Set(); // Para evitar duplicados

        const addResult = (doc) => {
            if (!uniqueIds.has(doc.id)) {
                searchResults.push({ id: doc.id, ...doc.data() });
                uniqueIds.add(doc.id);
            }
        };

        // 1. Buscar por número de pedido (DHxxxx)
        if (lowercaseQuery.startsWith('dh') && /dh\d+/.test(lowercaseQuery)) {
            const orderNumber = parseInt(lowercaseQuery.replace('dh', ''), 10);
            if (!isNaN(orderNumber)) {
                const orderSnapshot = await db.collection('pedidos').where('consecutiveOrderNumber', '==', orderNumber).limit(1).get();
                if (!orderSnapshot.empty) {
                    const orderData = orderSnapshot.docs[0].data();
                    const contactId = orderData.telefono;
                    if (contactId) {
                        const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
                        if (contactDoc.exists) addResult(contactDoc);
                    }
                }
            }
        }

        // 2. Buscar por número de teléfono exacto (ID del documento)
        const phoneDoc = await db.collection('contacts_whatsapp').doc(query).get();
        if (phoneDoc.exists) addResult(phoneDoc);

        // 3. Buscar por nombre (usando name_lowercase)
        const nameSnapshot = await db.collection('contacts_whatsapp')
            .where('name_lowercase', '>=', lowercaseQuery)
            .where('name_lowercase', '<=', lowercaseQuery + '\uf8ff') // Técnica de prefijo
            .orderBy('name_lowercase') // Necesario para where con rango
            .limit(20) // Limitar resultados por eficiencia
            .get();
        nameSnapshot.forEach(addResult);

        // 4. Buscar por inicio de número de teléfono (prefijo)
        const partialPhoneSnapshot = await db.collection('contacts_whatsapp')
            .where(admin.firestore.FieldPath.documentId(), '>=', query)
            .where(admin.firestore.FieldPath.documentId(), '<=', query + '\uf8ff') // Técnica de prefijo
            .orderBy(admin.firestore.FieldPath.documentId()) // Necesario para where con rango en ID
            .limit(20)
            .get();
        partialPhoneSnapshot.forEach(addResult);

        // 5. Buscar por número local (prefijo 521 + query) si es numérico y corto
        if (/^\d+$/.test(query) && query.length >= 3) {
            const prefixedQuery = "521" + query;
            const prefixedSnapshot = await db.collection('contacts_whatsapp')
                .where(admin.firestore.FieldPath.documentId(), '>=', prefixedQuery)
                .where(admin.firestore.FieldPath.documentId(), '<=', prefixedQuery + '\uf8ff')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(20)
                .get();
            prefixedSnapshot.forEach(addResult);
        }

        // Ordenar resultados finales por fecha del último mensaje
        searchResults.sort((a, b) => (b.lastMessageTimestamp?.toMillis() || 0) - (a.lastMessageTimestamp?.toMillis() || 0));

        res.status(200).json({ success: true, contacts: searchResults });
    } catch (error) {
        console.error('Error searching contacts:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al buscar contactos.' });
    }
});

// --- Endpoint PUT /api/contacts/:contactId (Actualizar contacto) ---
router.put('/contacts/:contactId', async (req, res) => {
    const { contactId } = req.params;
    const { name, email, nickname } = req.body;

    if (!name) {
        return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
    }

    try {
        // Actualizar documento del contacto y notificar cambios en tiempo real
        await db.collection('contacts_whatsapp').doc(contactId).update({
            name: name,
            email: email || null, // Guardar null si está vacío
            nickname: nickname || null, // Guardar null si está vacío
            name_lowercase: name.toLowerCase(), // Actualizar campo para búsquedas
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp() // Trigger sync
        });
        res.status(200).json({ success: true, message: 'Contacto actualizado.' });
    } catch (error) {
        console.error('Error al actualizar el contacto:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el contacto.' });
    }
});

// --- Endpoint PUT /api/contacts/:contactId/status (Actualizar estatus/etiqueta de contacto) ---
router.put('/contacts/:contactId/status', async (req, res) => {
    const { contactId } = req.params;
    const { status } = req.body; // El nuevo estatus (ej. 'seguimiento')

    if (status === undefined) {
        return res.status(400).json({ success: false, message: 'El campo "status" es obligatorio.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);

        // Verificar si el contacto existe antes de actualizar
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        }

        // Actualizar el campo 'status' y el timestamp para notificar a todos los dispositivos en tiempo real
        await contactRef.update({
            status: status,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(200).json({ success: true, message: `Estatus del contacto actualizado a "${status}".` });
    } catch (error) {
        console.error(`Error al actualizar el estatus para el contacto ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el estatus del contacto.' });
    }
});

// --- Endpoint POST /api/contacts/:contactId/skip-ai (Saltar temporizador de IA) ---
router.post('/contacts/:contactId/skip-ai', async (req, res) => {
    const { contactId } = req.params;
    try {
        const skipped = await skipAiTimer(contactId);
        if (skipped) {
            res.status(200).json({ success: true, message: 'Temporizador saltado correctamente.' });
        } else {
            res.status(404).json({ success: false, message: 'No se encontró un temporizador activo para este contacto.' });
        }
    } catch (error) {
        console.error(`Error al saltar el timer de la IA para ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error interno al saltar el temporizador.' });
    }
});

// --- Endpoint POST /api/contacts/:contactId/cancel-ai (Cancelar generación de IA) ---
router.post('/contacts/:contactId/cancel-ai', async (req, res) => {
    const { contactId } = req.params;
    try {
        const { cancelAiResponse } = require('./services');
        await cancelAiResponse(contactId);
        res.status(200).json({ success: true, message: 'Generación cancelada.' });
    } catch (error) {
        console.error(`Error al cancelar la IA para ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error al cancelar.' });
    }
});

// --- Endpoint DELETE /api/contacts/:contactId/messages (Borrar historial de chat) ---
router.delete('/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        
        // Función interna para borrar en lotes (evita límites de batch de Firestore)
        async function deleteMessages(query) {
            const snapshot = await query.get();
            if (snapshot.size === 0) return;

            const batch = db.batch();
            snapshot.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();

            // Llamada recursiva para el siguiente lote
            if (snapshot.size > 0) {
                return deleteMessages(query);
            }
        }

        // Ejecutar borrado en lotes de 400
        await deleteMessages(contactRef.collection('messages').limit(400));

        // Actualizar datos de contacto para reflejar el borrado
        await contactRef.update({
            lastMessage: 'Historial borrado por el equipo.',
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            unreadCount: 0
        });

        res.status(200).json({ success: true, message: 'Historial de chat borrado correctamente.' });
    } catch (error) {
        console.error(`❌ Error al borrar el historial para ${contactId}:`, error);
        res.status(500).json({ success: false, message: 'No se pudo borrar el historial del chat.' });
    }
});

// --- Endpoint GET /api/contacts/:contactId/orders (Historial de pedidos) ---
router.get('/contacts/:contactId/orders', async (req, res) => {
    try {
        const { contactId } = req.params;

        // Buscar pedidos donde el campo 'telefono' coincida con el contactId
        const snapshot = await db.collection('pedidos')
            .where('telefono', '==', contactId)
            .get();

        if (snapshot.empty) {
            return res.status(200).json({ success: true, orders: [] }); // Devolver array vacío si no hay pedidos
        }

        // Mapear los documentos a un formato deseado
        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                consecutiveOrderNumber: data.consecutiveOrderNumber,
                producto: data.producto,
                // Convertir timestamp a ISO string si existe
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
                estatus: data.estatus || 'Sin estatus' // Valor por defecto
            };
        });

        // Ordenar por fecha de creación descendente (más reciente primero)
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.status(200).json({ success: true, orders });
    } catch (error) {
        console.error(`Error al obtener el historial de pedidos para ${req.params.contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener el historial de pedidos.' });
    }
});

// --- Endpoint POST /api/contacts/:contactId/utility-message ---
// Envia una actualizacion de pedido/cuenta fuera de la ventana de 24h
// usando message tags (pages_utility_messaging). Solo Messenger.
router.post('/contacts/:contactId/utility-message', async (req, res) => {
    const { contactId } = req.params;
    const { text, tag } = req.body || {};
    const validTags = ['POST_PURCHASE_UPDATE', 'CONFIRMED_EVENT_UPDATE', 'ACCOUNT_UPDATE'];
    const chosenTag = validTags.includes(tag) ? tag : 'POST_PURCHASE_UPDATE';

    if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: 'Texto requerido' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado' });
        }
        const data = contactDoc.data();
        if (data.channel !== 'messenger') {
            return res.status(400).json({ success: false, message: 'Solo disponible para contactos de Messenger' });
        }
        const psid = data.psid || contactId.replace(/^fb_/, '');

        const sent = await sendMessengerUtilityMessage(psid, text, chosenTag);

        const messageToSave = {
            from: process.env.FB_PAGE_ID,
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: sent.messageId,
            text,
            messagingType: 'MESSAGE_TAG',
            tag: chosenTag,
        };
        await contactRef.collection('messages').doc().set(messageToSave);
        await contactRef.update({
            lastMessage: text,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({ success: true, messageId: sent.messageId, tag: chosenTag });
    } catch (err) {
        const metaErr = err.response?.data?.error;
        console.error('[UTILITY MSG] error:', metaErr || err.message);
        res.status(500).json({
            success: false,
            message: metaErr?.message || err.message,
        });
    }
});

// --- Endpoint GET /api/contacts/:contactId/window-state (ventana de 24h) ---
// Devuelve si el contacto está dentro de la ventana de servicio de 24h de Meta
// (último mensaje ENTRANTE hace menos de 24h). Fuera de ella, los mensajes de
// formato libre se aceptan pero luego fallan (error 131047), así que el frontend
// lo usa para avisar antes de enviar/reenviar.
router.get('/contacts/:contactId/window-state', async (req, res) => {
    const { contactId } = req.params;
    try {
        const snap = await db.collection('contacts_whatsapp').doc(contactId)
            .collection('messages').orderBy('timestamp', 'desc').limit(50).get();
        const lastInboundMsg = snap.docs.find(d => d.data().from === contactId);
        const lastInboundTime = lastInboundMsg?.data()?.timestamp?.toDate();
        const windowOpen = !!(lastInboundTime && (Date.now() - lastInboundTime.getTime() < 24 * 60 * 60 * 1000));
        res.json({ success: true, windowOpen, lastInboundAt: lastInboundTime ? lastInboundTime.toISOString() : null });
    } catch (error) {
        console.error(`[WINDOW-STATE] Error para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// --- Endpoint POST /api/contacts/:contactId/messages (Enviar mensaje) ---
router.post('/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid, template, templateMediaUrl, tempId, forwarded } = req.body; // tempId es opcional, para UI optimista

    // Validaciones básicas
    if (!text && !fileUrl && !template) {
        return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío (texto, archivo o plantilla).' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);

        // Un humano va a responder desde el CRM: cancelar YA el temporizador de la IA,
        // ANTES del envío a Meta (subir un archivo puede tardar segundos y el timer de
        // 20s podría vencer en ese lapso, arrancando una generación que respondería
        // encima del humano). Se repite el chequeo después del envío para la generación
        // que aun así haya alcanzado a arrancar.
        cancelPendingAiTimer(contactId);

        // --- Detectar canal del contacto ---
        const contactDoc = await contactRef.get();
        const channel = contactDoc.exists ? (contactDoc.data().channel || 'whatsapp') : 'whatsapp';

        // /corazon = bienvenida + hand-off a la IA. La quick reply llega con la marca ' /corazon' que
        // agrega el frontend; se detecta para ENCENDER la IA (botActive=true) en CUALQUIER canal, y se
        // limpia del texto visible para que el cliente no vea el comando. Se maneja en ambos branches
        // (Messenger retorna antes del bloque de comandos de WhatsApp).
        const isCorazonCommand = !!(text && text.toLowerCase().includes('/corazon'));
        const corazonCleanText = isCorazonCommand && text ? text.replace(/\/corazon/gi, '').trim() : text;

        // === MESSENGER / INSTAGRAM: Lógica de envío via Meta Send API ===
        if (channel === 'messenger' || channel === 'instagram') {
            const channelName = channel === 'instagram' ? 'Instagram' : 'Messenger';
            const recipientId = contactDoc.data().psid || contactDoc.data().igsid || contactId.replace(/^(fb_|ig_)/, '');

            let sentData;
            try {
                sentData = await sendMessengerMessage(recipientId, { text: corazonCleanText, fileUrl, fileType, channel });
            } catch (sendErr) {
                const metaErr = sendErr.response?.data?.error || {};
                const code = metaErr.code;
                const subcode = metaErr.error_subcode;

                // Error específico: app pendiente de revisión de Meta (acceso estándar)
                if (code === 10 && /pages_messaging.*revise/i.test(metaErr.message || '')) {
                    return res.status(400).json({
                        success: false,
                        code: 'APP_PENDING_REVIEW',
                        message: `No se puede enviar a este contacto de ${channelName}. La app está pendiente de revisión por Meta y solo puede enviar a administradores/evaluadores de la app. Agrega al contacto como tester o espera la aprobación de Meta.`
                    });
                }
                if (code === 200 && /acceso avanzado|advanced access/i.test(metaErr.message || '')) {
                    return res.status(400).json({
                        success: false,
                        code: 'APP_PENDING_REVIEW',
                        message: `No se puede enviar a este contacto de ${channelName}. La app no tiene acceso avanzado al permiso y el destinatario no es tester de la app. Espera la aprobación de Meta.`
                    });
                }
                // Error de ventana 24h de Messenger
                if (code === 10 && subcode === 2018278) {
                    return res.status(400).json({
                        success: false,
                        code: 'OUT_OF_24H_WINDOW',
                        message: `No se puede enviar a este contacto de Messenger. Han pasado más de 24h desde el último mensaje del cliente. Solo se permiten etiquetas de mensaje o plantillas fuera de la ventana.`
                    });
                }

                // Otros errores de Meta: devolver mensaje descriptivo
                return res.status(500).json({
                    success: false,
                    code: 'META_SEND_ERROR',
                    message: metaErr.message || sendErr.message || 'Error al enviar el mensaje.',
                    meta_code: code || null,
                    meta_subcode: subcode || null
                });
            }

            // Guardar cada mensaje enviado en Firestore
            let lastMessageToSave;
            for (const msg of sentData.messages) {
                const messageToSave = {
                    from: 'page', status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: msg.id, text: msg.textForDb
                };
                if (msg.fileUrlForDb) messageToSave.fileUrl = msg.fileUrlForDb;
                if (msg.fileTypeForDb) messageToSave.fileType = msg.fileTypeForDb;

                const messageRef = (!lastMessageToSave && tempId) ? contactRef.collection('messages').doc(tempId) : contactRef.collection('messages').doc();
                await messageRef.set(messageToSave);
                lastMessageToSave = messageToSave;
            }

            // Un humano respondió desde el CRM: cancelar la respuesta pendiente de la IA.
            // (Segundo cancel; el primero fue al inicio del request, antes del envío.)
            cancelPendingAiTimer(contactId);
            const msgrContactUpdate = {
                lastMessage: sentData.lastTextForDb,
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                unreadCount: 0,
                aiNextRun: admin.firestore.FieldValue.delete()
            };
            // Releer el contacto (no usar el snapshot del inicio): si una generación
            // arrancó durante el envío, marcarla cancelada.
            const freshMsgrDoc = await contactRef.get();
            if (freshMsgrDoc.exists && freshMsgrDoc.data().aiStatus === 'generating') {
                msgrContactUpdate.aiStatus = 'cancelled';
            }
            // /corazon: encender la IA del contacto (todos los canales). La IA responderá el próximo
            // mensaje del cliente (aquí el último mensaje es saliente, así que no contesta de inmediato).
            if (isCorazonCommand) { msgrContactUpdate.botActive = true; console.log(`[CORAZON] IA activada (${channel}) para ${contactId}.`); }
            await contactRef.update(msgrContactUpdate);

            return res.status(200).json({ success: true, message: `Mensaje(s) enviado(s) por ${channelName}.` });
        }

        // === WHATSAPP: Lógica existente de envío ===
        let messageToSave;
        let messageId;
        let isFinalCommand = false;
        let cleanedText = text;

        if (text && (text.toLowerCase().includes('/final') || text.toLowerCase().includes('ya registramos tu pedido'))) {
            isFinalCommand = true;
            if (text.toLowerCase().includes('/final')) {
                cleanedText = text.replace(/\/final/gi, '').trim();
            } else {
                cleanedText = text;
            }
        }
        // /cuatro = "tu pedido ya está LISTO" (foto + datos de pago): dispara la etapa
        // post-venta. Desde el CRM la respuesta rápida llega ya EXPANDIDA, así que se
        // detecta también por su frase distintiva.
        const isCuatroCommand = !!(text && (text.toLowerCase().includes('/cuatro') || text.toLowerCase().includes('ya tenemos tu pedido listo')));
        // /corazon: quitar la marca del texto visible (la activación de IA se aplica en contactUpdateData abajo).
        if (isCorazonCommand) cleanedText = (cleanedText || '').replace(/\/corazon/gi, '').trim();

        // --- Lógica para enviar PLANTILLA ---
        if (template) {
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template, templateMediaUrl || null, []);
            if (reply_to_wamid) {
                payload.context = { message_id: reply_to_wamid };
            }

            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
            });
            messageId = response.data.messages[0].id;
            messageToSave = {
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: messageId, text: messageToSaveText,
                ...extractTemplateMetadata(template, templateMediaUrl)
            };

            // Tracking de plantilla (Fase 1): cada envio desde chat = batch propio de 1
            const chatBatchId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            await recordTemplateSend({
                contactId,
                contactName: contactDoc.exists ? (contactDoc.data().name || null) : null,
                template,
                wamid: messageId,
                source: 'chat',
                batchId: chatBatchId,
                batchTotal: 1
            });
        }
        // --- Lógica para enviar ARCHIVO (imagen, video, audio, documento) ---
        else if (fileUrl && fileType) {
            if (fileUrl && fileUrl.includes(bucket.name)) {
                try {
                    const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                    await bucket.file(decodeURIComponent(filePath)).makePublic();
                    console.log(`[GCS-CHAT] Archivo ${decodeURIComponent(filePath)} hecho público para envío.`);
                } catch (gcsError) {
                    console.error(`[GCS-CHAT] Advertencia: No se pudo hacer público el archivo ${fileUrl}:`, gcsError.message);
                }
            }

            const mediaId = await uploadMediaToWhatsApp(fileUrl, fileType);

            const type = fileType.startsWith('image/') ? 'image' :
                fileType.startsWith('video/') ? 'video' :
                    fileType.startsWith('audio/') ? 'audio' : 'document';

            const mediaObject = { id: mediaId };
            if (type !== 'audio' && cleanedText) {
                mediaObject.caption = cleanedText;
            }

            const messagePayload = {
                messaging_product: 'whatsapp',
                to: contactId,
                type: type,
                [type]: mediaObject
            };
            if (reply_to_wamid) {
                messagePayload.context = { message_id: reply_to_wamid };
            }

            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, messagePayload, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
            messageId = response.data.messages[0].id;

            const messageTextForDb = cleanedText || (type === 'video' ? '🎥 Video' : type === 'image' ? '📷 Imagen' : type === 'audio' ? '🎵 Audio' : '📄 Documento');
            messageToSave = {
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: messageId, text: messageTextForDb, fileUrl: fileUrl, fileType: fileType
            };

        }
        // --- Lógica para enviar solo TEXTO ---
        else {
            // cleanedText (no `text`): ya viene sin /final y sin /corazon, para que el cliente NO reciba el comando.
            const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text: cleanedText, reply_to_wamid });
            messageId = sentMessageData.id;
            messageToSave = {
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: messageId, text: sentMessageData.textForDb
            };
        }

        if (reply_to_wamid) {
            messageToSave.context = { id: reply_to_wamid };
        }
        if (forwarded) {
            messageToSave.forwarded = true;
        }
        Object.keys(messageToSave).forEach(key => messageToSave[key] == null && delete messageToSave[key]);

        const messageRef = tempId ? contactRef.collection('messages').doc(tempId) : contactRef.collection('messages').doc();
        await messageRef.set(messageToSave);

        // Un humano acaba de responder desde el CRM: la IA ya no debe contestar encima.
        // Segundo cancel (el primero fue al inicio del request): cubre un timer re-armado
        // por un mensaje del cliente que haya llegado DURANTE el envío a Meta.
        cancelPendingAiTimer(contactId);

        const contactUpdateData = {
            lastMessage: messageToSave.text,
            lastMessageTimestamp: messageToSave.timestamp,
            unreadCount: 0,
            aiNextRun: admin.firestore.FieldValue.delete()
        };
        // Releer el contacto AHORA (no usar el snapshot del inicio del request): si una
        // generación arrancó mientras enviábamos a Meta, aiStatus ya dice 'generating'
        // y hay que marcarla cancelada para que aborte antes de enviar su respuesta.
        const freshContactDoc = await contactRef.get();
        if (freshContactDoc.exists && freshContactDoc.data().aiStatus === 'generating') {
            contactUpdateData.aiStatus = 'cancelled';
        }

        if (isFinalCommand || isCuatroCommand) {
            const genDoc = await db.collection('crm_settings').doc('general').get();
            const postSaleStageActive = !genDoc.exists || genDoc.data().postSaleStageActive !== false;
            if (isFinalCommand) {
                // /final registra la venta → Pendientes IA. La etapa POST-VENTA ya NO arranca
                // aquí: arranca con /cuatro (pedido listo). Con el kill-switch de etapa 2
                // apagado se conserva el comportamiento viejo (desactivar bot).
                if (!postSaleStageActive) contactUpdateData.botActive = false;
                contactUpdateData.status = 'pendientes_ia';
            }
            if (isCuatroCommand && postSaleStageActive) {
                // Pedido LISTO: arranca la etapa post-venta (cobro/comprobantes/datos de envío).
                contactUpdateData.aiStage = 'postventa';
            }
        }
        // /corazon: encender la IA del contacto. No dispara respuesta inmediata (el último mensaje es
        // saliente); la IA contestará el próximo mensaje del cliente.
        if (isCorazonCommand) { contactUpdateData.botActive = true; console.log(`[CORAZON] IA activada (whatsapp) para ${contactId}.`); }

        await contactRef.update(contactUpdateData);

        res.status(200).json({ success: true, message: 'Mensaje(s) enviado(s).' });
    } catch (error) {
        const metaErr = error.response?.data?.error;
        const detail = metaErr?.message || error.message || 'Error al enviar el mensaje.';
        console.error('❌ Error al enviar mensaje:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({
            success: false,
            message: detail,
            meta_code: metaErr?.code || null,
            meta_subcode: metaErr?.error_subcode || null,
            meta_details: metaErr?.error_data?.details || null
        });
    }
});
// ... (resto de las rutas sin cambios)
// --- Endpoint POST /api/contacts/:contactId/queue-message (Encolar mensaje si >24h) ---
router.post('/contacts/:contactId/queue-message', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid } = req.body;

    // Validar que haya contenido
    if (!text && !fileUrl) {
        return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        let isFinalCommand = false;
        let cleanedText = text;

        if (text && (text.toLowerCase().includes('/final') || text.toLowerCase().includes('ya registramos tu pedido'))) {
            isFinalCommand = true;
            if (text.toLowerCase().includes('/final')) {
                cleanedText = text.replace(/\/final/gi, '').trim();
            } else {
                cleanedText = text;
            }
        }
        // /cuatro = pedido LISTO (foto + datos de pago): dispara la etapa post-venta.
        const isCuatroCommand = !!(text && (text.toLowerCase().includes('/cuatro') || text.toLowerCase().includes('ya tenemos tu pedido listo')));
        // /corazon = bienvenida + hand-off a la IA: enciende la IA y se limpia la marca del texto visible.
        const isCorazonCommand = !!(text && text.toLowerCase().includes('/corazon'));
        if (isCorazonCommand) cleanedText = (cleanedText || '').replace(/\/corazon/gi, '').trim();

        // Determinar texto para DB (igual que en envío normal)
        let messageToSaveText = cleanedText;
        if (fileUrl && !cleanedText) {
            const type = fileType.startsWith('image/') ? 'image' :
                fileType.startsWith('video/') ? 'video' :
                fileType.startsWith('audio/') ? 'audio' : 'document';
            messageToSaveText = (type === 'video' ? '🎥 Video' : type === 'image' ? '📷 Imagen' : '🎵 Audio');
        }

        // Crear objeto del mensaje para guardar
        const messageToSave = {
            from: PHONE_NUMBER_ID, // Mensaje saliente
            status: 'queued', // Marcar como encolado
            timestamp: admin.firestore.FieldValue.serverTimestamp(), // Hora actual
            text: messageToSaveText,
            fileUrl: fileUrl || null,
            fileType: fileType || null,
        };

        // Añadir contexto si es una respuesta
        if (reply_to_wamid) {
            messageToSave.context = { id: reply_to_wamid };
        }

        // Guardar el mensaje en la subcolección 'messages'
        await contactRef.collection('messages').add(messageToSave);

        // Actualizar la vista previa del último mensaje y el estado del bot
        const contactUpdateData = {
            lastMessage: `[En cola] ${messageToSave.text}`, // Añadir prefijo para UI
            lastMessageTimestamp: messageToSave.timestamp,
        };

        if (isFinalCommand || isCuatroCommand) {
            const genDoc = await db.collection('crm_settings').doc('general').get();
            const postSaleStageActive = !genDoc.exists || genDoc.data().postSaleStageActive !== false;
            if (isFinalCommand) {
                // /final registra la venta → Pendientes IA. La post-venta arranca con /cuatro.
                if (!postSaleStageActive) contactUpdateData.botActive = false;
                contactUpdateData.status = 'pendientes_ia';
            }
            if (isCuatroCommand && postSaleStageActive) {
                contactUpdateData.aiStage = 'postventa';
            }
        }
        // /corazon: encender la IA aunque el mensaje quede en cola (se activará al reabrirse la ventana).
        if (isCorazonCommand) contactUpdateData.botActive = true;

        await contactRef.update(contactUpdateData);

        res.status(200).json({ success: true, message: 'Mensaje encolado con éxito.' });

    } catch (error) {
        const metaErr = error.response?.data?.error;
        const detail = metaErr?.message || error.message || 'Error desconocido';
        console.error('❌ Error al encolar mensaje:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({
            success: false,
            message: detail,
            meta_code: metaErr?.code || null,
            meta_subcode: metaErr?.error_subcode || null
        });
    }
});

// --- Endpoint POST /api/contacts/:contactId/schedule-message (Programar envío a hora futura) ---
// Guarda el mensaje en la subcolección 'messages' con status:'scheduled' y scheduledAt.
// NO envía a Meta: el scheduledMessagesScheduler lo enviará cuando llegue el momento.
router.post('/contacts/:contactId/schedule-message', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, scheduledAt, tempId } = req.body;

    if (!text && !fileUrl) {
        return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    }
    const scheduledMs = Number(scheduledAt);
    if (!scheduledMs || Number.isNaN(scheduledMs)) {
        return res.status(400).json({ success: false, message: 'Falta la fecha/hora de programación (scheduledAt).' });
    }
    if (scheduledMs <= Date.now()) {
        return res.status(400).json({ success: false, message: 'La hora programada debe ser futura.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();
        const channel = contactDoc.exists ? (contactDoc.data().channel || 'whatsapp') : 'whatsapp';

        // Texto para guardar (igual que el envío normal: si solo hay archivo, etiqueta por tipo)
        let messageToSaveText = text;
        if (fileUrl && !text) {
            const type = fileType && fileType.startsWith('image/') ? 'image' :
                fileType && fileType.startsWith('video/') ? 'video' :
                fileType && fileType.startsWith('audio/') ? 'audio' : 'document';
            messageToSaveText = (type === 'video' ? '🎥 Video' : type === 'image' ? '📷 Imagen' : type === 'audio' ? '🎵 Audio' : '📄 Documento');
        }

        const scheduledTs = admin.firestore.Timestamp.fromMillis(scheduledMs);
        const messageToSave = {
            from: channel === 'whatsapp' ? PHONE_NUMBER_ID : 'page',
            status: 'scheduled',
            scheduledAt: scheduledTs,
            timestamp: scheduledTs, // ordena al fondo del chat (es el mensaje "más futuro")
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            text: messageToSaveText || '',
            fileUrl: fileUrl || null,
            fileType: fileType || null,
            channel,
            source: 'scheduled',
            attempts: 0,
        };
        Object.keys(messageToSave).forEach(key => messageToSave[key] == null && delete messageToSave[key]);

        // Usar el tempId como id del doc (igual que /messages) para reconciliar el mensaje optimista del frontend.
        const docRef = tempId ? contactRef.collection('messages').doc(tempId) : contactRef.collection('messages').doc();
        await docRef.set(messageToSave);

        return res.status(200).json({ success: true, message: 'Mensaje programado.', id: docRef.id, scheduledAt: scheduledMs });
    } catch (error) {
        console.error('❌ Error al programar mensaje:', error.message);
        return res.status(500).json({ success: false, message: error.message || 'Error al programar el mensaje.' });
    }
});

// --- Endpoint POST /api/scheduled-messages/sweep (barrido manual de programados; útil para pruebas) ---
router.post('/scheduled-messages/sweep', async (req, res) => {
    try {
        const dryRun = !!(req.body && req.body.dryRun === true);
        const summary = await runScheduledMessagesSweep({ dryRun });
        return res.status(200).json({ success: true, summary });
    } catch (error) {
        console.error('❌ Error en sweep de programados:', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// --- Endpoint GET /api/contacts/:contactId/messages-paginated (Obtener mensajes paginados) ---
router.get('/contacts/:contactId/messages-paginated', async (req, res) => {
    try {
        const { contactId } = req.params;
        const { limit = 30, before } = req.query; // 'before' es un timestamp en segundos

        let query = db.collection('contacts_whatsapp')
            .doc(contactId)
            .collection('messages')
            .orderBy('timestamp', 'desc') // Ordenar por más reciente primero
            .limit(Number(limit));

        // Si se proporciona 'before', obtener mensajes *anteriores* a ese timestamp
        if (before) {
            // Convertir timestamp de segundos (del cliente) a Timestamp de Firestore
            const firestoreTimestamp = admin.firestore.Timestamp.fromMillis(parseInt(before) * 1000);
            // CORRECCIÓN: Usar startAfter en lugar de where <, ya que la consulta va desc
            // Necesitamos el documento anterior para usar startAfter, o ajustar la lógica
            // Alternativa más simple: Filtrar por timestamp <
            query = query.where('timestamp', '<', firestoreTimestamp);
            // Si se quiere paginación estricta con startAfter, se necesitaría obtener el documento
            // const lastDocSnapshot = await db.collection('contacts_whatsapp').doc(contactId).collection('messages').where('timestamp','==', firestoreTimestamp).limit(1).get();
            // if(!lastDocSnapshot.empty) query = query.startAfter(lastDocSnapshot.docs[0]);
        }

        const snapshot = await query.get();

        if (snapshot.empty) {
            return res.status(200).json({ success: true, messages: [] });
        }

        // Mapear documentos, incluyendo el ID del documento de Firestore (docId)
        const messages = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() }));

        // Nota: La API devuelve los mensajes ordenados del más reciente al más antiguo.
        // El frontend los invertirá si necesita mostrarlos en orden cronológico.
        res.status(200).json({ success: true, messages });

    } catch (error) {
        console.error(`Error al obtener mensajes paginados para ${req.params.contactId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener mensajes.' });
    }
});


// --- Endpoint POST /api/contacts/:contactId/messages/:messageDocId/react (Enviar/quitar reacción) ---
router.post('/contacts/:contactId/messages/:messageDocId/react', async (req, res) => {
    const { contactId, messageDocId } = req.params;
    const { emoji } = req.body; // Emoji para reaccionar, o string vacío/null para quitar

    try {
        // 1. Obtener el contacto para conocer el canal (whatsapp | messenger | instagram)
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        }
        const contactData = contactDoc.data();
        const channel = contactData.channel || 'whatsapp';

        // 2. Obtener el mensaje
        const messageRef = contactRef.collection('messages').doc(messageDocId);
        const messageDoc = await messageRef.get();
        if (!messageDoc.exists) {
            return res.status(404).json({ success: false, message: 'Mensaje no encontrado.' });
        }
        const messageData = messageDoc.data();

        // === MESSENGER: Meta no permite que la página reaccione a mensajes del usuario ===
        // El Send API de Messenger solo soporta typing_on/typing_off/mark_seen; las
        // reacciones únicamente se reciben por webhook, no se pueden enviar.
        if (channel === 'messenger') {
            return res.status(400).json({
                success: false,
                code: 'REACTION_NOT_SUPPORTED',
                message: 'Messenger no permite reaccionar a los mensajes desde la página. Las reacciones solo están disponibles en WhatsApp e Instagram.'
            });
        }

        // === INSTAGRAM: el Send API soporta react/unreact ===
        if (channel === 'instagram') {
            const mid = messageData.id;
            if (!mid) {
                return res.status(400).json({ success: false, message: 'Este mensaje no tiene un ID válido para reaccionar.' });
            }
            const recipientId = contactData.igsid || contactData.psid || contactId.replace(/^(fb_|ig_)/, '');
            try {
                await sendInstagramReaction(recipientId, mid, emoji || null);
            } catch (sendErr) {
                const metaErr = sendErr.response?.data?.error;
                console.error('Error al enviar reacción de Instagram:', metaErr ? JSON.stringify(metaErr) : sendErr.message);
                return res.status(500).json({ success: false, message: metaErr?.message || 'No se pudo enviar la reacción a Instagram.' });
            }
            await messageRef.update({ reaction: emoji || admin.firestore.FieldValue.delete() });
            return res.status(200).json({ success: true, message: emoji ? 'Reacción enviada.' : 'Reacción eliminada.' });
        }

        // === WHATSAPP: lógica original ===
        const wamid = messageData.id; // El ID de WhatsApp
        if (!wamid) {
            return res.status(400).json({ success: false, message: 'Este mensaje no tiene un ID de WhatsApp válido.' });
        }

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: contactId,
            type: 'reaction',
            reaction: {
                message_id: wamid,
                emoji: emoji || "" // Emoji o cadena vacía para eliminar
            }
        };

        await axios.post(
            `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
            payload,
            { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
        );

        await messageRef.update({
            reaction: emoji || admin.firestore.FieldValue.delete()
        });

        res.status(200).json({ success: true, message: emoji ? 'Reacción enviada.' : 'Reacción eliminada.' });

    } catch (error) {
        console.error('Error al enviar reacción:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al enviar la reacción.' });
    }
});

// --- INICIO: ENDPOINTS DE GESTIÓN DE USUARIOS (AGENTS) ---

// GET /api/users - Listar todos los usuarios (de Auth y Firestore)
router.get('/users', async (req, res) => {
    try {
        // 1. Obtener usuarios de Firebase Authentication
        const listUsersResult = await admin.auth().listUsers();
        const authUsers = listUsersResult.users
            .filter(userRecord => userRecord.email) // Filtrar usuarios que no tienen email
            .map(userRecord => ({
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName,
                disabled: userRecord.disabled
            }));

        // 2. Obtener usuarios de la colección 'users' de Firestore
        const snapshot = await db.collection('users').get();
        const firestoreUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 3. Combinar los datos
        // Usaremos el email como clave para unir, asumiendo que es único.
        const combinedUsers = authUsers.map(authUser => {
            // Encontrar el usuario correspondiente en Firestore por email
            const firestoreUser = firestoreUsers.find(fsUser => fsUser.email && fsUser.email.toLowerCase() === authUser.email.toLowerCase());
            // Devolver un objeto combinado. Los datos de Firestore (rol, deptos) prevalecen.
            // El ID de documento de Firestore es el email en minúsculas, así que lo usamos.
            return {
                id: authUser.email.toLowerCase(), // Ahora es seguro llamar a toLowerCase
                uid: authUser.uid,
                email: authUser.email,
                name: firestoreUser?.name || authUser.displayName || authUser.email.split('@')[0],
                role: firestoreUser?.role || 'agent',
                photoURL: firestoreUser?.photoURL || null,
                assignedDepartments: firestoreUser?.assignedDepartments || [],
                disabled: authUser.disabled
            };
        });

        res.status(200).json({ success: true, users: combinedUsers });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Error al obtener la lista de usuarios.' });
    }
});

// POST /api/users - Crear un nuevo usuario
router.post('/users', async (req, res) => {
    const { email, name, role, assignedDepartments } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: 'El correo electrónico es obligatorio.' });
    }

    try {
        // Usar el email como ID del documento para unicidad y fácil acceso
        // Convertir a minúsculas para evitar duplicados por case sensitivity
        const userId = email.toLowerCase().trim();

        const newUser = {
            email: userId, // Guardar email normalizado
            name: name || '',
            role: role || 'agent', // 'admin' o 'agent'
            assignedDepartments: assignedDepartments || [], // Array de IDs de departamentos
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('users').doc(userId).set(newUser);

        res.status(201).json({ success: true, message: 'Usuario creado correctamente.', user: { id: userId, ...newUser } });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ success: false, message: 'Error al crear el usuario.' });
    }
});

// PUT /api/users/:userId - Actualizar un usuario
router.put('/users/:userId', async (req, res) => {
    const { userId } = req.params; // Esperamos que sea el email (o ID)
    const { name, role, photoURL, assignedDepartments } = req.body;

    try {
        const userRef = db.collection('users').doc(userId);
        const doc = await userRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (role !== undefined) updates.role = role;
        if (photoURL !== undefined) updates.photoURL = photoURL;
        if (assignedDepartments !== undefined) updates.assignedDepartments = assignedDepartments;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await userRef.update(updates);

        res.status(200).json({ success: true, message: 'Usuario actualizado correctamente.' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar el usuario.' });
    }
});

// DELETE /api/users/:userId - Eliminar un usuario (cuenta de Auth + perfil de Firestore)
router.delete('/users/:userId', async (req, res) => {
    const { userId } = req.params; // email
    const docId = (userId || '').toLowerCase(); // el doc de Firestore usa el email en minúsculas

    try {
        // 1. Eliminar la cuenta de Firebase Auth (si existe). GET /users arma la lista
        //    desde Auth, así que sin esto el usuario reaparece tras borrar solo Firestore.
        try {
            const userRecord = await admin.auth().getUserByEmail(userId);
            await admin.auth().deleteUser(userRecord.uid);
        } catch (authErr) {
            // Si no existe en Auth (solo perfil de Firestore), continuamos sin error.
            if (authErr.code !== 'auth/user-not-found') throw authErr;
        }

        // 2. Eliminar el perfil de Firestore.
        await db.collection('users').doc(docId).delete();

        res.status(200).json({ success: true, message: 'Usuario eliminado correctamente.' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: 'Error al eliminar el usuario.' });
    }
});

// GET /api/users/profile/:email - Obtener perfil por email (para login)
router.get('/users/profile/:email', async (req, res) => {
    const { email } = req.params;
    // Email inválido o ausente (p. ej. el front lo mandó como "null"): 404 limpio, no 500.
    if (!email || !email.includes('@')) {
        return res.status(404).json({ success: false, message: 'Email inválido o no proporcionado.' });
    }
    try {
        const userId = email.toLowerCase().trim();
        const doc = await db.collection('users').doc(userId).get();

        if (!doc.exists) {
            // --- LÓGICA DE AUTO-CREACIÓN MEJORADA ---
            // Verificar si el usuario existe en Firebase Authentication
            try {
                const userRecord = await admin.auth().getUserByEmail(userId);
                
                // Si llegamos aquí, el usuario EXISTE en Auth pero NO en la base de datos.
                // Lo creamos automáticamente.
                
                // Determinar rol inicial: Alex es admin, los demás agentes por defecto.
                const initialRole = (userId === 'alex@dekoor.com') ? 'admin' : 'agent';
                
                const newUserData = {
                    email: userId,
                    name: userRecord.displayName || userId.split('@')[0], // Usar nombre de Auth o parte del correo
                    role: initialRole,
                    assignedDepartments: [], // Sin departamentos asignados inicialmente (acceso restringido hasta asignar)
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                };

                // Guardar en Firestore
                await db.collection('users').doc(userId).set(newUserData);
                console.log(`[AUTO-CREATE] Usuario ${userId} sincronizado de Auth a Firestore con rol ${initialRole}.`);

                return res.status(200).json({ success: true, user: { id: userId, ...newUserData } });

            } catch (authError) {
                // Si el usuario NO existe en Authentication (error user-not-found), devolvemos 404 real
                if (authError.code === 'auth/user-not-found' || authError.code === 'auth/invalid-email') {
                    console.warn(`[LOGIN] Email no registrado o inválido en Auth: ${userId}`);
                    return res.status(404).json({ success: false, message: 'Usuario no registrado en el sistema.' });
                }
                throw authError; // Otros errores
            }
            // -----------------------------
        }

        res.status(200).json({ success: true, user: { id: doc.id, ...doc.data() } });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ success: false, message: 'Error al obtener perfil.' });
    }
});

// --- FIN: ENDPOINTS DE GESTIÓN DE USUARIOS ---

// --- INICIO: ENDPOINTS DE GESTIÓN DE DEPARTAMENTOS ---

// GET /api/departments - Listar todos los departamentos
router.get('/departments', async (req, res) => {
    try {
        const snapshot = await db.collection('departments').orderBy('name').get();
        const departments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json({ success: true, departments });
    } catch (error) {
        console.error('Error fetching departments:', error);
        res.status(500).json({ success: false, message: 'Error al obtener departamentos.' });
    }
});

// POST /api/departments - Crear un nuevo departamento
router.post('/departments', async (req, res) => {
    const { name, color, users: userEmails } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: 'El nombre del departamento es obligatorio.' });
    }
    try {
        const newDept = {
            name,
            color: color || '#6c757d', // Default color
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const docRef = await db.collection('departments').add(newDept);
        const deptId = docRef.id;

        // Asignar los usuarios seleccionados al nuevo departamento
        if (Array.isArray(userEmails) && userEmails.length > 0) {
            const batch = db.batch();
            const usersSnapshot = await db.collection('users').get();
            
            for (const userDoc of usersSnapshot.docs) {
                if (userEmails.includes(userDoc.data().email)) {
                    batch.update(userDoc.ref, { 
                        assignedDepartments: admin.firestore.FieldValue.arrayUnion(deptId) 
                    });
                }
            }
            await batch.commit();
        }

        res.status(201).json({ success: true, message: 'Departamento creado.', department: { id: deptId, ...newDept } });
    } catch (error) {
        console.error('Error creating department:', error);
        res.status(500).json({ success: false, message: 'Error al crear el departamento.' });
    }
});

// PUT /api/departments/:id - Actualizar un departamento y sus usuarios
router.put('/departments/:id', async (req, res) => {
    const { id } = req.params;
    const { name, color, users: userEmails } = req.body; // userEmails es un array de emails

    try {
        const deptRef = db.collection('departments').doc(id);
        const batch = db.batch();

        // 1. Actualizar nombre y color del departamento
        const deptUpdateData = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (name) deptUpdateData.name = name;
        if (color) deptUpdateData.color = color;
        batch.update(deptRef, deptUpdateData);

        // 2. Actualizar usuarios asignados (si se proporcionó la lista)
        if (Array.isArray(userEmails)) {
            // Obtener todos los usuarios para comparar
            const usersSnapshot = await db.collection('users').get();
            
            for (const userDoc of usersSnapshot.docs) {
                const userRef = userDoc.ref;
                const userData = userDoc.data();
                const userEmail = userData.email;
                const assignedDepts = userData.assignedDepartments || [];
                
                const shouldBeAssigned = userEmails.includes(userEmail);
                const isCurrentlyAssigned = assignedDepts.includes(id);

                if (shouldBeAssigned && !isCurrentlyAssigned) {
                    // Añadir departamento al usuario
                    batch.update(userRef, { assignedDepartments: admin.firestore.FieldValue.arrayUnion(id) });
                } else if (!shouldBeAssigned && isCurrentlyAssigned) {
                    // Quitar departamento del usuario
                    batch.update(userRef, { assignedDepartments: admin.firestore.FieldValue.arrayRemove(id) });
                }
            }
        }

        await batch.commit();
        res.status(200).json({ success: true, message: 'Departamento y asignaciones actualizados.' });

    } catch (error) {
        console.error(`Error updating department ${id}:`, error);
        res.status(500).json({ success: false, message: 'Error al actualizar el departamento.' });
    }
});


// DELETE /api/departments/:id - Eliminar un departamento
router.delete('/departments/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const batch = db.batch();
        // 1. Eliminar el departamento
        batch.delete(db.collection('departments').doc(id));

        // 2. Quitar el departamento de todos los usuarios que lo tengan asignado
        const usersSnapshot = await db.collection('users').where('assignedDepartments', 'array-contains', id).get();
        usersSnapshot.forEach(doc => {
            batch.update(doc.ref, { assignedDepartments: admin.firestore.FieldValue.arrayRemove(id) });
        });

        await batch.commit();
        res.status(200).json({ success: true, message: 'Departamento eliminado correctamente.' });
    } catch (error) {
        console.error(`Error deleting department ${id}:`, error);
        res.status(500).json({ success: false, message: 'Error al eliminar el departamento.' });
    }
});

// --- FIN: ENDPOINTS DE GESTIÓN DE DEPARTAMENTOS ---

// --- Endpoint GET /api/whatsapp-templates (Obtener plantillas aprobadas) ---
router.get('/whatsapp-templates', async (req, res) => {
    // Validar credenciales
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp Business.' });
    }

    // ?all=1 devuelve TODAS las plantillas con su estatus (para la pestaña "Plantillas" tipo Meta);
    // por defecto solo las APROBADAS (que es lo que usa el selector de "Enviar campaña").
    const includeAll = req.query.all === '1' || req.query.all === 'true';
    const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    try {
        // limit alto para no truncar (Meta pagina de a 25 por defecto)
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }, params: { limit: 200 } });

        let list = response.data.data || [];
        if (!includeAll) list = list.filter(t => t.status === 'APPROVED'); // Solo aprobadas
        const templates = list.map(t => ({
            id: t.id,
            name: t.name,
            language: t.language,
            status: t.status,               // APPROVED | PENDING | REJECTED | DISABLED | ...
            category: t.category,
            rejected_reason: t.rejected_reason || null, // motivo si status === REJECTED
            // Mapear componentes (header, body, footer, buttons)
            components: (t.components || []).map(c => ({
                type: c.type,
                text: c.text, // Texto (puede tener variables {{n}})
                format: c.format, // Para header (IMAGE, TEXT, VIDEO, DOCUMENT)
                buttons: c.buttons, // Array de botones si type es BUTTONS
                example: c.example // Valores ejemplo de Meta para sustituir {{2}}, {{3}}, ...
            }))
        }));
        res.status(200).json({ success: true, templates });
    } catch (error) {
        console.error('Error al obtener plantillas de WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al obtener las plantillas de WhatsApp.' });
    }
});

// --- Endpoint DELETE /api/whatsapp-templates/:name (Eliminar plantilla de Meta) ---
// Con ?id=<hsm_id> Meta borra solo esa plantilla (ese idioma); sin id, borra
// todas las plantillas con ese nombre en todos los idiomas.
router.delete('/whatsapp-templates/:name', async (req, res) => {
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp Business.' });
    }
    const { name } = req.params;
    if (!name || !/^[a-z0-9_]+$/.test(name)) {
        return res.status(400).json({ success: false, message: 'Nombre de plantilla inválido.' });
    }
    try {
        const params = { name };
        if (req.query.id) params.hsm_id = req.query.id;
        const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
        await axios.delete(url, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }, params });
        console.log(`[TEMPLATES] Plantilla "${name}"${req.query.id ? ` (hsm_id ${req.query.id})` : ''} eliminada de Meta.`);
        res.json({ success: true });
    } catch (error) {
        const metaErr = error.response?.data?.error;
        console.error(`[TEMPLATES] Error al eliminar plantilla "${name}":`, error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(500).json({ success: false, message: metaErr?.message || 'Error al eliminar la plantilla en Meta.' });
    }
});

// =============================================================
// PERFIL DE EMPRESA DE WHATSAPP (Ajustes → Personalizar mi empresa)
// =============================================================

// --- GET /api/whatsapp-business-profile (foto, nombre verificado, teléfono, estatus) ---
router.get('/whatsapp-business-profile', async (_req, res) => {
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
    }
    try {
        const headers = { Authorization: `Bearer ${WHATSAPP_TOKEN}` };
        const [profileRes, phoneRes] = await Promise.all([
            axios.get(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/whatsapp_business_profile`, {
                headers, params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical' }
            }),
            axios.get(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}`, {
                headers, params: { fields: 'display_phone_number,verified_name,name_status,quality_rating' }
            })
        ]);
        res.json({ success: true, profile: profileRes.data?.data?.[0] || {}, phone: phoneRes.data || {} });
    } catch (error) {
        const metaErr = error.response?.data?.error;
        console.error('[BUSINESS-PROFILE] Error al leer el perfil:', metaErr ? JSON.stringify(metaErr) : error.message);
        res.status(500).json({ success: false, message: metaErr?.message || 'Error al leer el perfil de WhatsApp.' });
    }
});

// --- POST /api/whatsapp-business-profile/photo (cambiar foto de perfil) ---
// Recibe { imageBase64, mimeType }, la sube con el Resumable Upload API y aplica el
// handle al perfil. Se usa el nodo "app" (la app dueña del token) para no depender
// de FB_APP_ID. El cambio de foto es inmediato (no pasa por revisión de Meta).
router.post('/whatsapp-business-profile/photo', async (req, res) => {
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
    }
    try {
        const { imageBase64, mimeType } = req.body || {};
        if (!imageBase64) return res.status(400).json({ success: false, message: 'Falta la imagen.' });
        const mime = String(mimeType || 'image/jpeg').split(';')[0].trim().toLowerCase();
        if (!/^image\/(jpe?g|png)$/.test(mime)) {
            return res.status(400).json({ success: false, message: 'La foto debe ser JPG o PNG.' });
        }
        const data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
        let buffer = Buffer.from(data, 'base64');
        if (!buffer.length) return res.status(400).json({ success: false, message: 'Imagen vacía o inválida.' });

        // Meta limita la foto de perfil a 5MB: comprimir si se pasa (mismo compresor de plantillas)
        let finalMime = mime;
        if (buffer.length > 5 * 1024 * 1024) {
            const compressed = await compressImageIfNeeded(buffer, mime);
            buffer = compressed.buffer;
            finalMime = compressed.mimeType;
            if (buffer.length > 5 * 1024 * 1024) {
                return res.status(400).json({ success: false, message: 'La imagen es demasiado grande (máx. 5 MB).' });
            }
        }

        // 1) Sesión de subida (Resumable Upload API)
        const appNode = process.env.FB_APP_ID || 'app';
        const startResp = await axios.post(`https://graph.facebook.com/v19.0/${appNode}/uploads`, null, {
            params: {
                file_name: `profile.${finalMime.split('/')[1] || 'jpg'}`,
                file_length: buffer.length,
                file_type: finalMime,
                access_token: WHATSAPP_TOKEN
            }
        });
        const sessionId = startResp.data?.id;
        if (!sessionId) throw new Error('Meta no devolvió una sesión de subida.');

        // 2) Subir los bytes → handle
        const uploadResp = await axios.post(`https://graph.facebook.com/v19.0/${sessionId}`, buffer, {
            headers: { Authorization: `OAuth ${WHATSAPP_TOKEN}`, file_offset: '0', 'Content-Type': finalMime },
            maxContentLength: Infinity, maxBodyLength: Infinity
        });
        const handle = uploadResp.data?.h;
        if (!handle) throw new Error('Meta no devolvió el handle de la imagen.');

        // 3) Aplicar la foto al perfil
        await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/whatsapp_business_profile`,
            { messaging_product: 'whatsapp', profile_picture_handle: handle },
            { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );

        // 4) Releer la URL nueva (puede tardar unos segundos en reflejarse del lado de Meta)
        let newUrl = null;
        try {
            const check = await axios.get(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/whatsapp_business_profile`, {
                headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, params: { fields: 'profile_picture_url' }
            });
            newUrl = check.data?.data?.[0]?.profile_picture_url || null;
        } catch (_) { /* opcional: el frontend recarga después */ }

        console.log('[BUSINESS-PROFILE] ✓ Foto de perfil de WhatsApp actualizada.');
        res.json({ success: true, profile_picture_url: newUrl });
    } catch (error) {
        const metaErr = error.response?.data?.error;
        console.error('[BUSINESS-PROFILE] Error al cambiar la foto:', metaErr ? JSON.stringify(metaErr) : error.message);
        res.status(500).json({ success: false, message: metaErr?.error_user_msg || metaErr?.message || 'Error al actualizar la foto de perfil.' });
    }
});

// --- POST /api/whatsapp-business-profile/name (solicitar cambio de nombre) ---
// El nombre visible (display name) SIEMPRE pasa por revisión de Meta: esto solo
// crea la solicitud; el nombre cambia cuando Meta la aprueba (minutos a días).
router.post('/whatsapp-business-profile/name', async (req, res) => {
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
    }
    const newDisplayName = String((req.body || {}).newDisplayName || '').trim();
    if (newDisplayName.length < 3) {
        return res.status(400).json({ success: false, message: 'Escribe el nuevo nombre (mínimo 3 caracteres).' });
    }
    try {
        await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}`, null, {
            params: { new_display_name: newDisplayName, access_token: WHATSAPP_TOKEN }
        });
        console.log(`[BUSINESS-PROFILE] Solicitud de cambio de nombre enviada a Meta: "${newDisplayName}"`);
        // Ojo: al aprobarse, Cloud API suele exigir re-registrar el número (POST /register con el
        // PIN de 2FA, que no guardamos) para aplicar el nombre; se avisa al usuario en el mensaje.
        res.json({ success: true, message: `Solicitud enviada ✅ Meta revisará el nombre "${newDisplayName}" (minutos a días). Si al aprobarse no se refleja en los chats, confírmalo en WhatsApp Manager (re-registro del número).` });
    } catch (error) {
        const metaErr = error.response?.data?.error;
        console.error('[BUSINESS-PROFILE] Error al solicitar cambio de nombre:', metaErr ? JSON.stringify(metaErr) : error.message);
        res.status(400).json({ success: false, message: metaErr?.error_user_msg || metaErr?.message || 'No se pudo solicitar el cambio de nombre.' });
    }
});

// Sube una imagen de muestra a Meta (resumable upload) y devuelve el `handle`
// requerido para plantillas con cabecera de IMAGEN. Usa FB_APP_ID + WHATSAPP_TOKEN.
async function uploadSampleHeaderImage(imageUrl) {
    const FB_APP_ID = process.env.FB_APP_ID;
    if (!FB_APP_ID) throw new Error('Falta FB_APP_ID en el servidor para subir la imagen de muestra.');

    // Descargar la imagen de muestra
    const imgResp = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(imgResp.data);
    const mime = (imgResp.headers['content-type'] || 'image/jpeg').split(';')[0];
    const fileName = (imageUrl.split('/').pop() || 'sample').split('?')[0] || 'sample.jpg';

    // 1) Crear sesión de subida
    const startResp = await axios.post(
        `https://graph.facebook.com/v19.0/${FB_APP_ID}/uploads`,
        null,
        { params: { file_name: fileName, file_length: buffer.length, file_type: mime, access_token: WHATSAPP_TOKEN } }
    );
    const sessionId = startResp.data && startResp.data.id; // formato "upload:..."
    if (!sessionId) throw new Error('Meta no devolvió una sesión de subida para la imagen.');

    // 2) Subir los bytes y obtener el handle
    const uploadResp = await axios.post(
        `https://graph.facebook.com/v19.0/${sessionId}`,
        buffer,
        { headers: { 'Authorization': `OAuth ${WHATSAPP_TOKEN}`, 'file_offset': '0', 'Content-Type': mime } }
    );
    const handle = uploadResp.data && uploadResp.data.h;
    if (!handle) throw new Error('Meta no devolvió el handle de la imagen de muestra.');
    return handle;
}

// --- Endpoint POST /api/whatsapp-templates/create (Crear plantilla de Meta) ---
router.post('/whatsapp-templates/create', async (req, res) => {
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp Business.' });
    }

    try {
        const { name, language, category, header, body, footer, buttons, bodyExamples } = req.body;

        // Validaciones
        if (!name || !/^[a-z0-9_]+$/.test(name)) {
            return res.status(400).json({ success: false, message: 'Nombre inválido: usa solo minúsculas, números y guion bajo.' });
        }
        if (!body || !body.trim()) {
            return res.status(400).json({ success: false, message: 'El cuerpo del mensaje es obligatorio.' });
        }

        const components = [];

        // --- HEADER (opcional) ---
        if (header && header.type === 'TEXT' && header.text && header.text.trim()) {
            const comp = { type: 'HEADER', format: 'TEXT', text: header.text.trim() };
            if (/\{\{1\}\}/.test(header.text) && header.example) {
                comp.example = { header_text: [String(header.example)] };
            }
            components.push(comp);
        } else if (header && header.type === 'IMAGE' && header.imageUrl && header.imageUrl.trim()) {
            const handle = await uploadSampleHeaderImage(header.imageUrl.trim());
            components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } });
        }

        // --- BODY (obligatorio) ---
        const bodyComp = { type: 'BODY', text: body.trim() };
        const varCount = (body.match(/\{\{\d+\}\}/g) || []).length;
        if (varCount > 0) {
            const examples = (Array.isArray(bodyExamples) ? bodyExamples : [])
                .slice(0, varCount)
                .map(v => (v && String(v).trim()) || 'ejemplo');
            while (examples.length < varCount) examples.push('ejemplo');
            bodyComp.example = { body_text: [examples] };
        }
        components.push(bodyComp);

        // --- FOOTER (opcional) ---
        if (footer && footer.trim()) {
            components.push({ type: 'FOOTER', text: footer.trim() });
        }

        // --- BUTTONS (opcional) ---
        if (Array.isArray(buttons) && buttons.length) {
            const built = buttons.map(b => {
                if (!b || !b.text || !b.text.trim()) return null;
                if (b.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', text: b.text.trim() };
                if (b.type === 'URL' && b.url) {
                    const ub = { type: 'URL', text: b.text.trim(), url: b.url.trim() };
                    // Botón URL con variable ({{1}}): Meta exige un ejemplo de la URL completa.
                    if (/\{\{\d+\}\}/.test(b.url) && b.urlExample) ub.example = [String(b.urlExample)];
                    return ub;
                }
                if (b.type === 'PHONE_NUMBER' && b.phone_number) return { type: 'PHONE_NUMBER', text: b.text.trim(), phone_number: b.phone_number.trim() };
                return null;
            }).filter(Boolean);
            if (built.length) components.push({ type: 'BUTTONS', buttons: built });
        }

        const payload = {
            name,
            language: language || 'es_MX',
            category: category || 'MARKETING',
            components
        };

        const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
        const response = await axios.post(url, payload, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
        });

        res.status(200).json({
            success: true,
            data: response.data,
            message: 'Plantilla creada y enviada a revisión de Meta. Aparecerá disponible cuando sea aprobada.'
        });
    } catch (error) {
        const apiErr = error.response?.data?.error;
        console.error('[CREAR PLANTILLA] Error:', apiErr ? JSON.stringify(apiErr) : error.message);
        res.status(400).json({
            success: false,
            message: apiErr?.error_user_msg || apiErr?.message || error.message || 'No se pudo crear la plantilla.'
        });
    }
});

// --- Endpoint POST /api/whatsapp-templates/ai-generate (Sugerir plantilla con IA) ---
// Recibe una descripción (y opcionalmente una foto) y devuelve una sugerencia
// completa de plantilla (nombre, categoría, cabecera, cuerpo con emojis, pie y
// botones) lista para precargar el formulario.
router.post('/whatsapp-templates/ai-generate', async (req, res) => {
    try {
        const { description, imageBase64, imageMimeType, category } = req.body;
        if (!description || !description.trim()) {
            return res.status(400).json({ success: false, message: 'Describe para qué es la plantilla.' });
        }

        const systemInstruction = `Eres un experto en marketing por WhatsApp para "Dekoor", una marca mexicana de regalos personalizados y lámparas LED.
Creas plantillas de mensajes de WhatsApp (HSM) que cumplen las políticas de Meta.
Escribes SIEMPRE en español de México, tono cálido y cercano, y SIEMPRE incluyes emojis relevantes en el cuerpo.
Devuelves EXCLUSIVAMENTE un objeto JSON válido (sin texto extra, sin markdown, sin comillas triples) con esta forma exacta:
{
  "name": "nombre_en_snake_case",
  "category": "MARKETING",
  "header": { "type": "NONE", "text": "" },
  "body": "cuerpo con emojis y variables {{1}} si aporta",
  "bodyExamples": ["ejemplo de {{1}}"],
  "footer": "pie corto opcional",
  "buttons": [ { "type": "QUICK_REPLY", "text": "..." } ]
}
Reglas:
- "category": "MARKETING" o "UTILITY".
- "header.type": "NONE", "TEXT" o "IMAGE". Si el usuario adjunta una foto del producto, usa "IMAGE". Si usas "TEXT", llena "header.text".
- El cuerpo lleva emojis, máx ~600 caracteres. Usa variables {{1}}, {{2}}… SOLO si aporta (nombre del cliente, número de pedido, etc.), numeradas en orden desde 1.
- "bodyExamples": un ejemplo por cada variable, en orden. Si no hay variables, deja [].
- "footer": máximo 60 caracteres. Si no aplica, deja "".
- "buttons": máximo 3. Tipos: "QUICK_REPLY" (solo text), "URL" (text + url), "PHONE_NUMBER" (text + phone_number). Si no aplica, deja [].
- "name": solo minúsculas, números y guion bajo.`;

        const prompt = `Crea una plantilla de WhatsApp para esto:\n"${description.trim()}"\n${category ? `Categoría preferida: ${category}.` : ''}\nDevuelve solo el objeto JSON.`;

        const imageParts = [];
        if (imageBase64) {
            const data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
            imageParts.push({ inlineData: { data, mimeType: imageMimeType || 'image/jpeg' } });
        }

        const aiResult = await generateGeminiResponse(prompt, imageParts, systemInstruction);
        let text = (aiResult.text || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('La IA no devolvió un JSON válido.');

        const suggestion = JSON.parse(text.slice(start, end + 1));
        res.status(200).json({ success: true, suggestion });
    } catch (error) {
        console.error('[IA PLANTILLA] Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'No se pudo generar la plantilla con IA.' });
    }
});


// --- Endpoint POST /api/campaigns/send-template (Enviar campaña de texto) ---
router.post('/campaigns/send-template', async (req, res) => {
    const { contactIds, template, phoneNumber } = req.body; // template es el objeto completo

    // Validaciones
    if ((!contactIds?.length && !phoneNumber) || !template) {
        return res.status(400).json({ success: false, message: 'Se requieren destinatarios (IDs o teléfono) y una plantilla.' });
    }

    // Destinatarios: un teléfono específico tiene prioridad sobre la lista de IDs
    const targets = phoneNumber ? [phoneNumber] : contactIds;
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let successful = 0;
    let failed = 0;
    const failedDetails = [];

    // Enviar mensaje a cada contacto (con pequeño delay)
    for (const contactId of targets) {
        try {
            // Construir payload usando la función helper
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template); // Sin imagen, sin params extra

            // Enviar a WhatsApp
            const response = await axios.post(url, payload, { headers });
            const messageId = response.data.messages[0].id;
            const timestamp = admin.firestore.FieldValue.serverTimestamp();

            // Guardar en Firestore
            const contactRef = db.collection('contacts_whatsapp').doc(contactId);
            await contactRef.collection('messages').add({
                from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId, text: messageToSaveText
            });
            // Actualizar último mensaje del contacto (set+merge para crear el contacto si es un teléfono nuevo)
            await contactRef.set({
                lastMessage: messageToSaveText, lastMessageTimestamp: timestamp, unreadCount: 0
            }, { merge: true });

            successful++;
        } catch (error) {
            console.error(`Error en campaña (texto) a ${contactId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
            failed++;
            failedDetails.push({ contactId, error: error.response ? JSON.stringify(error.response.data) : error.message });
        }
        await new Promise(resolve => setTimeout(resolve, 300)); // Delay de 300ms
    }

    res.status(200).json({
        success: true,
        message: `Campaña de texto procesada.`,
        results: { successful: successful, failed: failed, details: failedDetails }
    });
});

// --- Endpoint POST /api/campanas/contar-envios (Detectar contactos que recibieron una plantilla) ---
// Cuenta contactos UNICOS que recibieron una plantilla en un rango de fechas usando la
// coleccion `template_sends` (fuente de verdad para retargeting y envios de chat).
// Schema en recordTemplateSend (apiRoutes.js:3432-3448):
//   templateName, contactId, sentAt, source ('chat'|'retargeting_plantilla'), batchId, etc.
router.post('/campanas/contar-envios', async (req, res) => {
    try {
        const { template, fechaInicio, fechaFin } = req.body;
        if (!template || !fechaInicio) {
            return res.status(400).json({ success: false, message: 'Faltan template o fechaInicio' });
        }

        const startTs = admin.firestore.Timestamp.fromDate(new Date(fechaInicio));
        const endTs = fechaFin ? admin.firestore.Timestamp.fromDate(new Date(fechaFin)) : null;

        // Query principal: template_sends por templateName + rango de sentAt
        let q = db.collection('template_sends')
            .where('templateName', '==', template)
            .where('sentAt', '>=', startTs);
        if (endTs) q = q.where('sentAt', '<=', endTs);

        const snap = await q.get();

        const uniqueContacts = new Set();
        const bySource = { chat: 0, retargeting_plantilla: 0, other: 0 };

        // Agrupacion por batch: cada envio masivo en retargeting/ crea un batchId.
        // Asi el usuario puede seleccionar el batch especifico de su campana piloto
        // en lugar de contar todos los envios de la plantilla en el rango.
        const batchMap = new Map(); // batchId → { contacts:Set, firstSent, source }

        snap.docs.forEach(d => {
            const data = d.data();
            const contactId = data?.contactId;
            const batchId = data?.batchId;
            if (contactId) uniqueContacts.add(contactId);
            const src = data?.source;
            if (src === 'chat') bySource.chat++;
            else if (src === 'retargeting_plantilla') bySource.retargeting_plantilla++;
            else bySource.other++;

            if (batchId) {
                if (!batchMap.has(batchId)) {
                    batchMap.set(batchId, {
                        batchId,
                        contacts: new Set(),
                        firstSent: data.sentAt || null,
                        source: src || 'unknown',
                    });
                }
                const b = batchMap.get(batchId);
                if (contactId) b.contacts.add(contactId);
                if (data.sentAt && (!b.firstSent || data.sentAt.toMillis() < b.firstSent.toMillis())) {
                    b.firstSent = data.sentAt;
                }
            }
        });

        // Convertir batches a array, ordenar por fecha asc, transformar Set→count
        const batches = [...batchMap.values()]
            .map(b => ({
                batchId: b.batchId,
                count: b.contacts.size,
                firstSent: b.firstSent ? b.firstSent.toDate().toISOString() : null,
                source: b.source,
            }))
            .sort((a, b) => (a.firstSent || '').localeCompare(b.firstSent || ''));

        // Diagnostico: si count==0, ver que plantillas SI hubo envios en el rango
        let sampleTemplateNames = [];
        if (uniqueContacts.size === 0) {
            let diagQ = db.collection('template_sends').where('sentAt', '>=', startTs);
            if (endTs) diagQ = diagQ.where('sentAt', '<=', endTs);
            const diagSnap = await diagQ.get();
            const tplCount = new Map();
            diagSnap.docs.forEach(d => {
                const name = d.data()?.templateName;
                if (name) tplCount.set(name, (tplCount.get(name) || 0) + 1);
            });
            sampleTemplateNames = [...tplCount.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([name, count]) => ({ name, count }));
        }

        res.json({
            success: true,
            template,
            count: uniqueContacts.size,
            totalSendsScanned: snap.size,
            bySource,
            batches, // [{batchId, count, firstSent, source}] — para seleccionar batch específico
            sampleTemplateNames,
            rango: { desde: fechaInicio, hasta: fechaFin || 'ahora' },
        });
    } catch (err) {
        console.error('Error en /campanas/contar-envios:', err);
        const errMsg = (err && err.message) || 'Error interno';
        // Si Firestore pide un indice, devolver mensaje claro con el link
        if (errMsg.includes('index') || errMsg.includes('requires an index')) {
            console.error('Falta indice. Link de creacion debe estar en este error:', errMsg);
            return res.status(500).json({
                success: false,
                message: 'Falta indice Firestore (template_sends por templateName+sentAt). Revisa logs del servidor en Render para el link de creacion.',
                detail: errMsg,
            });
        }
        res.status(500).json({ success: false, message: errMsg });
    }
});

// --- Endpoint POST /api/campaigns/send-template-with-image (Enviar campaña con imagen) ---
router.post('/campaigns/send-template-with-image', async (req, res) => {
    const { contactIds, templateObject, imageUrl, phoneNumber } = req.body;

    // Validaciones
    if ((!contactIds || !contactIds.length) && !phoneNumber) {
        return res.status(400).json({ success: false, message: 'Se requiere una lista de IDs de contacto o un número de teléfono.' });
    }
    if (!templateObject || !templateObject.name) {
        return res.status(400).json({ success: false, message: 'Se requiere el objeto de la plantilla.' });
    }
    if (!imageUrl) {
        return res.status(400).json({ success: false, message: 'Se requiere la URL de la imagen.' });
    }
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
    }

    // Determinar a quién enviar
    const targets = phoneNumber ? [phoneNumber] : contactIds;
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let successful = 0;
    let failed = 0;
    const failedDetails = [];

    // Enviar a cada destinatario
    for (const contactId of targets) {
        try {
            // Construir payload (incluyendo imageUrl)
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, templateObject, imageUrl);

            // Enviar a WhatsApp
            const response = await axios.post(url, payload, { headers });
            const messageId = response.data.messages[0].id;
            const timestamp = admin.firestore.FieldValue.serverTimestamp();

            // Guardar/Actualizar contacto y mensaje en Firestore
            const contactRef = db.collection('contacts_whatsapp').doc(contactId);
            // Asegurarse de que el contacto exista (crear si no)
            await contactRef.set({
                name: `Nuevo Contacto (${contactId.slice(-4)})`, // Nombre genérico
                wa_id: contactId,
                lastMessage: messageToSaveText,
                lastMessageTimestamp: timestamp,
                unreadCount: 0 // Resetear no leídos
            }, { merge: true }); // Usar merge para no sobrescribir datos existentes como tags

            // Guardar el mensaje enviado
            await contactRef.collection('messages').add({
                from: PHONE_NUMBER_ID, status: 'sent', timestamp, id: messageId,
                text: messageToSaveText, fileUrl: imageUrl, fileType: 'image/external' // Marcar como imagen externa
            });

            successful++;
        } catch (error) {
            console.error(`Error en campaña con imagen a ${contactId}:`, error.response ? JSON.stringify(error.response.data) : error.message);
            failed++;
            failedDetails.push({ contactId, error: error.response ? JSON.stringify(error.response.data) : error.message });
        }
        await new Promise(resolve => setTimeout(resolve, 300)); // Delay
    }

    res.status(200).json({
        success: true,
        message: `Campaña con imagen procesada.`,
        results: { successful: successful, failed: failed, details: failedDetails }
    });
});

// --- GET /api/debug/media-selftest (Diagnóstico de envío de media a Messenger/IG) ---
// Abrir en el navegador (sesión iniciada). Confirma que ffmpeg corre y que la URL de
// entrega es alcanzable, sin necesidad de revisar los logs del servidor.
router.get('/debug/media-selftest', async (req, res) => {
    try {
        const report = await messengerMediaSelfTest();
        res.json(report);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// --- Debug del resumen diario de guías: estado de la cola y último envío ---
router.get('/debug/shipping-digest', async (_req, res) => {
    try {
        const settings = await db.collection('crm_settings').doc('shipping_digest').get();
        const snap = await db.collection('shipping_digest_queue').where('sentAt', '==', null).get();
        res.json({
            success: true,
            settings: settings.exists ? settings.data() : null,
            pendingCount: snap.size,
            pending: snap.docs.map(d => ({ id: d.id, ...d.data() }))
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/debug/shipping-digest-run?dry=1&force=1 → dispara el barrido manualmente.
// dry=1 no envía ni marca nada (solo muestra qué saldría); force=1 ignora hora y lastSentDate.
router.get('/debug/shipping-digest-run', async (req, res) => {
    try {
        const { runShippingDigestSweep } = require('./shipping/shippingDigestScheduler');
        const result = await runShippingDigestSweep({
            force: req.query.force === '1',
            dryRun: req.query.dry === '1'
        });
        res.json({ success: true, result });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/debug/ai-order-extract?contactId=521... → DRY-RUN del extractor de pedidos de la IA:
// reconstruye el transcript del contacto y muestra qué pedido registraría, SIN crear nada.
// Sirve para probar el registro automático (orders/aiOrderRegistration.js) contra chats reales.
router.get('/debug/ai-order-extract', async (req, res) => {
    try {
        const contactId = String(req.query.contactId || '').trim();
        if (!contactId) return res.status(400).json({ success: false, message: 'Falta ?contactId=' });

        const { getAiOrderConfig, extractOrderFromChat } = require('./orders/aiOrderRegistration');
        const cfg = await getAiOrderConfig();

        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactSnap = await contactRef.get();
        if (!contactSnap.exists) return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        const contactData = contactSnap.data();

        // Transcript igual que el de los clasificadores (más antiguo arriba, sangría en multilínea)
        const msgsSnap = await contactRef.collection('messages').orderBy('timestamp', 'desc').limit(60).get();
        const lines = msgsSnap.docs.reverse().map(d => {
            const m = d.data();
            let body = (m.text || '').trim();
            if (!body && m.type && m.type !== 'text') body = `[${m.type}]`;
            if (!body) return null;
            const who = m.from === contactId ? 'Cliente' : 'Asistente';
            return `${who}: ${body.replace(/\r?\n/g, '\n    ')}`;
        }).filter(Boolean);
        const conversationText = lines.join('\n');

        // Igual que el flujo real: pasar el pedido reciente como contexto para que el
        // extractor decida CAMBIO vs ADICIONAL (esAdicional).
        let existingOrder = null;
        try {
            const oSnap = await db.collection('pedidos').where('contactId', '==', contactId).get();
            let best = null, bestMs = 0;
            oSnap.forEach(doc => {
                const d = doc.data();
                if (d.estatus === 'Cancelado') return;
                const ms = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0;
                if (ms > bestMs) { bestMs = ms; best = d; }
            });
            if (best && (Date.now() - bestMs) <= 24 * 60 * 60 * 1000) {
                existingOrder = {
                    num: best.consecutiveOrderNumber != null ? `DH${best.consecutiveOrderNumber}` : '(sin número)',
                    datosProducto: best.datosProducto || best.producto || '',
                    precio: best.precio
                };
            }
        } catch (_) {}

        const extraction = await extractOrderFromChat({
            conversationText,
            name: contactData.name || contactId,
            catalogText: cfg.catalogText,
            existingOrder
        });
        const computedTotal = extraction ? extraction.items.reduce((s, it) => s + it.precio * it.cantidad, 0) : null;

        res.json({
            success: true,
            dryRun: true,
            config: { enabled: cfg.enabled, minConfidence: cfg.minConfidence },
            existingOrder,
            accion: !extraction ? 'nada'
                : (existingOrder && !extraction.esAdicional ? 'ACTUALIZARÍA ' + existingOrder.num : 'CREARÍA pedido nuevo'),
            registraria: !!(extraction && extraction.listo && extraction.items.length > 0
                && !extraction.items.some(it => !(it.precio > 0) || it.precio > 20000)
                && extraction.total > 0 && Math.abs(computedTotal - extraction.total) <= 1
                && extraction.confianza >= cfg.minConfidence),
            computedTotal,
            extraction,
            transcriptPreview: conversationText.slice(-1500)
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- Endpoint POST /api/storage/generate-signed-url (Generar URL firmada para subida a GCS) ---
router.post('/storage/generate-signed-url', async (req, res) => {
    const { fileName, contentType, pathPrefix } = req.body;

    // Validaciones
    if (!fileName || !contentType || !pathPrefix) {
        return res.status(400).json({ success: false, message: 'Faltan fileName, contentType o pathPrefix.' });
    }

    // Crear ruta única en GCS
    const filePath = `${pathPrefix}/${Date.now()}_${fileName.replace(/\s/g, '_')}`;
    const file = bucket.file(filePath);

    // Opciones para la URL firmada (v4, escritura, expira en 15 min)
    const options = {
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType: contentType, // Forzar tipo de contenido en la subida
    };

    try {
        // Generar la URL firmada
        const [signedUrl] = await file.getSignedUrl(options);
        // Generar la URL pública (para guardar en Firestore después de subir)
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

        // Devolver ambas URLs al cliente
        res.status(200).json({
            success: true,
            signedUrl, // URL para subir el archivo
            publicUrl, // URL para acceder al archivo después
        });
    } catch (error) {
        console.error('Error al generar la URL firmada:', error);
        res.status(500).json({ success: false, message: 'No se pudo generar la URL para la subida.' });
    }
});

// --- GET /api/wa/file?path=<rutaDelObjeto|urlCompleta> ---
// Sirve un objeto del bucket, que es privado (Uniform Bucket-Level Access).
// Las URLs storage.googleapis.com/<bucket>/... guardadas históricamente dan 403
// porque el bucket bloquea el acceso anónimo. Este endpoint firma una URL de lectura
// temporal (la firma usa la cuenta de servicio, que sí tiene acceso) y redirige a ella,
// sin pasar el archivo por Node. Así se ven los medios viejos sin migrar los datos.
const WA_FILE_ALLOWED_PREFIXES = ['whatsapp_media/', 'messenger_media/', 'referencias/', 'quick_replies/', 'ad_responses/', 'mockups/'];
router.get('/wa/file', async (req, res) => {
    try {
        let raw = String(req.query.path || req.query.url || '');
        // Acepta también una URL completa de storage.googleapis.com de nuestro bucket.
        const marker = `storage.googleapis.com/${bucket.name}/`;
        const markerIdx = raw.indexOf(marker);
        if (markerIdx >= 0) raw = raw.slice(markerIdx + marker.length);
        const objectPath = decodeURIComponent(raw.split('?')[0]).replace(/^\/+/, '');

        // Seguridad: sin path traversal y solo carpetas de medios conocidas.
        if (!objectPath || objectPath.includes('..') ||
            !WA_FILE_ALLOWED_PREFIXES.some((p) => objectPath.startsWith(p))) {
            return res.status(400).send('Ruta no permitida');
        }

        const [signedUrl] = await bucket.file(objectPath).getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hora
        });
        // Cache corto en el navegador para no re-firmar en cada repintado del chat.
        res.set('Cache-Control', 'private, max-age=1800');
        return res.redirect(302, signedUrl);
    } catch (err) {
        console.error('[FILE PROXY] No se pudo firmar el objeto:', err.message);
        return res.status(404).send('Archivo no encontrado');
    }
});


// --- Endpoint GET /api/orders/cohort-progression (Progresión de cobro por cohorte) ---
router.get('/orders/cohort-progression', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'Se requiere una fecha (date).' });
        }

        const start = new Date(date + 'T00:00:00-06:00');
        const end = new Date(date + 'T23:59:59-06:00');
        const firestoreStart = admin.firestore.Timestamp.fromDate(start);
        const firestoreEnd = admin.firestore.Timestamp.fromDate(end);

        const ordersSnap = await db.collection('pedidos')
            .where('createdAt', '>=', firestoreStart)
            .where('createdAt', '<=', firestoreEnd)
            .get();

        let proyectado = 0;
        const totalOrders = ordersSnap.docs.length;
        const confirmations = [];

        ordersSnap.docs.forEach(doc => {
            const data = doc.data();
            const amount = parseFloat(data.precio) || 0;
            const rawStatus = (data.estatus || '').toLowerCase();
            const isConfirmed = rawStatus.includes('fabricar') || rawStatus.includes('pagado');

            proyectado += amount;

            if (isConfirmed) {
                let confirmDate = date;
                if (data.confirmedAt && data.confirmedAt.toDate) {
                    const d = data.confirmedAt.toDate();
                    const mx = new Date(d.getTime() - 6 * 60 * 60 * 1000);
                    confirmDate = mx.toISOString().split('T')[0];
                }
                confirmations.push({ date: confirmDate, amount, orderId: doc.id });
            }
        });

        const byDay = {};
        confirmations.forEach(c => {
            if (!byDay[c.date]) byDay[c.date] = { amount: 0, count: 0 };
            byDay[c.date].amount += c.amount;
            byDay[c.date].count += 1;
        });

        const sortedDays = Object.keys(byDay).sort();
        let cumAmount = 0;
        let cumCount = 0;
        const progression = sortedDays.map(day => {
            cumAmount += byDay[day].amount;
            cumCount += byDay[day].count;
            return {
                date: day,
                dayAmount: Math.round(byDay[day].amount * 100) / 100,
                dayCount: byDay[day].count,
                cumAmount: Math.round(cumAmount * 100) / 100,
                cumCount: cumCount
            };
        });

        const totalConfirmed = Math.round(cumAmount * 100) / 100;

        res.status(200).json({
            success: true,
            cohortDate: date,
            proyectado: Math.round(proyectado * 100) / 100,
            totalOrders,
            totalConfirmed,
            totalConfirmedOrders: cumCount,
            progression
        });
    } catch (error) {
        console.error('Error fetching cohort progression:', error);
        res.status(500).json({ success: false, message: 'Error al obtener la progresión.', error: error.message });
    }
});

// --- Endpoint GET /api/orders/confirmed-today (Pedidos que cambiaron a Fabricar/Pagado en una fecha) ---
router.get('/orders/confirmed-today', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'Se requiere una fecha (date).' });
        }

        const start = new Date(date + 'T00:00:00-06:00');
        const end = new Date(date + 'T23:59:59.999-06:00');
        const firestoreStart = admin.firestore.Timestamp.fromDate(start);
        const firestoreEnd = admin.firestore.Timestamp.fromDate(end);

        const snapshot = await db.collection('pedidos')
            .where('confirmedAt', '>=', firestoreStart)
            .where('confirmedAt', '<=', firestoreEnd)
            .get();

        let totalAmount = 0;
        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            const precio = parseFloat(data.precio) || 0;
            totalAmount += precio;
            return {
                id: doc.id,
                consecutiveOrderNumber: data.consecutiveOrderNumber,
                producto: data.producto,
                precio,
                estatus: data.estatus,
                confirmedAt: data.confirmedAt?.toDate?.()?.toISOString() || null
            };
        });

        res.status(200).json({
            success: true,
            count: orders.length,
            totalAmount: Math.round(totalAmount * 100) / 100,
            orders
        });
    } catch (error) {
        console.error('Error fetching confirmed orders:', error);
        res.status(500).json({ success: false, message: 'Error al obtener pedidos confirmados.' });
    }
});

// --- Endpoint POST /api/orders/backfill-confirmed (Rellenar confirmedAt en pedidos existentes) ---
router.post('/orders/backfill-confirmed', async (req, res) => {
    try {
        const ordersSnap = await db.collection('pedidos').get();
        let updated = 0;
        let skipped = 0;
        const batch = db.batch();

        ordersSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.confirmedAt) { skipped++; return; }

            const rawStatus = (data.estatus || '').toLowerCase();
            const isConfirmed = rawStatus.includes('fabricar') || rawStatus.includes('pagado');
            if (!isConfirmed) { skipped++; return; }

            if (data.createdAt) {
                batch.update(doc.ref, { confirmedAt: data.createdAt });
                updated++;
            }
        });

        if (updated > 0) await batch.commit();

        res.status(200).json({
            success: true,
            message: `Backfill completado. ${updated} pedidos actualizados, ${skipped} omitidos.`,
            updated,
            skipped
        });
    } catch (error) {
        console.error('Error en backfill:', error);
        res.status(500).json({ success: false, message: 'Error en backfill.', error: error.message });
    }
});

// --- Endpoint GET /api/orders/:orderId (Obtener un pedido por ID) ---
router.get('/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const docRef = db.collection('pedidos').doc(orderId);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        }
        // Devolver datos del pedido incluyendo su ID
        res.status(200).json({ success: true, order: { id: doc.id, ...doc.data() } });
    } catch (error) {
        console.error('Error fetching single order:', error);
        res.status(500).json({ success: false, message: 'Error del servidor.' });
    }
});

// getPurchaseEventTrigger() y sendPurchaseEventOnFabricar() se movieron a services.js para
// poder reutilizarlos desde la IA de post-venta (markOrderFabricarForContact). Se importan arriba.

// --- Endpoint PUT /api/orders/:orderId (Actualizar un pedido) ---
router.put('/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const updateData = req.body; // Datos enviados desde el frontend

    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Falta el ID del pedido.' });
    }

    try {
        const orderRef = db.collection('pedidos').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        }

        const existingData = orderDoc.data();

        // --- Normalizar items si vienen en el update ---
        // Mantiene 'producto', 'precio' y 'datosProducto' derivados en sync para backward compat
        if (Array.isArray(updateData.items) && updateData.items.length > 0) {
            const normalizedItems = updateData.items
                .filter(it => it && it.producto)
                .map(it => ({
                    producto: String(it.producto),
                    cantidad: Math.max(1, parseInt(it.cantidad, 10) || 1),
                    precio: Number(it.precio) || 0,
                    datosProducto: it.datosProducto || ''
                }));
            if (normalizedItems.length > 0) {
                updateData.items = normalizedItems;
                updateData.producto = normalizedItems[0].producto;
                updateData.precio = normalizedItems.reduce((sum, it) => sum + (it.precio || 0) * it.cantidad, 0);
                updateData.datosProducto = normalizedItems.length > 1
                    ? normalizedItems.map(it => {
                        const qtyTxt = it.cantidad > 1 ? ` ×${it.cantidad}` : '';
                        const base = `${it.producto}${qtyTxt}${it.precio ? ` ($${it.precio})` : ''}`;
                        return it.datosProducto ? `${base}: ${it.datosProducto}` : base;
                    }).join('\n')
                    : normalizedItems[0].datosProducto;
            }
        } else if (updateData.producto !== undefined) {
            // Update legacy (standalone page): reconstruir items como un solo elemento
            // para mantener el array de items consistente con producto/precio/datosProducto
            updateData.items = [{
                producto: String(updateData.producto),
                cantidad: 1,
                precio: Number(updateData.precio) || 0,
                datosProducto: updateData.datosProducto || ''
            }];
        }

        // --- Manejo de eliminación de fotos ---
        // Combinar URLs de fotos existentes (pedido y promoción)
        const existingPhotos = new Set([
            ...(existingData.fotoUrls || []),
            ...(existingData.fotoPromocionUrls || [])
        ]);
        // Combinar URLs de fotos actualizadas
        const updatedPhotos = new Set([
            ...(updateData.fotoUrls || []),
            ...(updateData.fotoPromocionUrls || [])
        ]);

        // Encontrar URLs que estaban antes pero ya no están
        const photosToDelete = [...existingPhotos].filter(url => !updatedPhotos.has(url));

        // Borrar las fotos eliminadas de GCS
        const deletePromises = photosToDelete.map(url => {
            try {
                // Extraer la ruta del archivo de la URL pública
                const filePath = new URL(url).pathname.split(`/${bucket.name}/`)[1];
                if (!filePath) throw new Error('Invalid GCS URL path');
                console.log(`[GCS DELETE] Intentando borrar: ${decodeURIComponent(filePath)}`);
                return bucket.file(decodeURIComponent(filePath)).delete()
                    .catch(err => console.warn(`No se pudo eliminar la foto antigua ${url}:`, err.message)); // No fallar si el borrado falla
            } catch (error) {
                console.warn(`URL de foto inválida o error al parsear, no se puede eliminar de storage: ${url}`, error.message);
                return Promise.resolve(); // Continuar aunque falle el parseo/borrado
            }
        });

        await Promise.all(deletePromises); // Esperar a que terminen los intentos de borrado

        // Hacer públicas las fotos nuevas
        for (const url of updatedPhotos) {
            if (url && url.includes(bucket.name) && !existingPhotos.has(url)) {
                try {
                    const filePath = new URL(url).pathname.split(`/${bucket.name}/`)[1];
                    if (filePath) {
                        await bucket.file(decodeURIComponent(filePath)).makePublic();
                    }
                } catch (e) {
                    console.error('Error al hacer pública la foto nueva de GCS:', e);
                }
            }
        }

        // Registrar confirmedAt cuando el pedido se confirma por primera vez vía API
        if (updateData.estatus) {
            const newStatus = (updateData.estatus || '').toLowerCase();
            const oldStatus = (existingData.estatus || '').toLowerCase();
            const isConfirming = newStatus.includes('fabricar') || newStatus.includes('pagado');
            const wasConfirmed = oldStatus.includes('fabricar') || oldStatus.includes('pagado');
            if (isConfirming && !wasConfirmed && !existingData.confirmedAt) {
                updateData.confirmedAt = admin.firestore.FieldValue.serverTimestamp();
            }
        }

        // Actualizar el documento del pedido en Firestore con los nuevos datos
        await orderRef.update(updateData);

        // Si esta edición llevó el pedido a "Fabricar", enviar el evento Purchase a Meta (idempotente)
        await sendPurchaseEventOnFabricar(orderId, { ...existingData, ...updateData }, (existingData.estatus || '').toLowerCase());

        res.status(200).json({ success: true, message: 'Pedido actualizado con éxito.' });

    } catch (error) {
        console.error(`Error al actualizar el pedido ${orderId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el pedido.' });
    }
});


// --- Endpoint POST /api/orders (Crear nuevo pedido) ---
router.post('/orders', async (req, res) => {
    // Toda la mecánica de creación (contador consecutivo, atribución, corona del contacto,
    // Purchase a Meta, cliente recurrente) vive en orders/createOrderCore.js, COMPARTIDA con
    // el registro automático por IA (orders/aiOrderRegistration.js). Cambios de flujo: allá.
    const {
        contactId, // ID del contacto de WhatsApp asociado
        producto,
        telefono, // Puede ser diferente al contactId si se edita manualmente
        precio,
        datosProducto,
        datosPromocion,
        comentarios,
        fotoUrls, // Array de URLs de GCS para fotos del producto
        fotoPromocionUrls, // Array de URLs de GCS para fotos de la promoción
        items, // Array opcional de productos: [{ producto, precio, datosProducto }]
        campana_id, // Opcional: id de la campaña de la que viene el pedido
        plantilla_origen // Opcional: nombre de la plantilla de la campaña
    } = req.body;

    try {
        const { createOrder } = require('./orders/createOrderCore');
        const { orderNumber, itemCount } = await createOrder({
            contactId, telefono, items, producto, precio, datosProducto,
            datosPromocion, comentarios, fotoUrls, fotoPromocionUrls,
            campana_id, plantilla_origen
        });

        // Devolver éxito y el número de pedido generado
        res.status(201).json({
            success: true,
            message: itemCount > 1
                ? `Pedido con ${itemCount} productos registrado con éxito.`
                : 'Pedido registrado con éxito.',
            orderNumber: `DH${orderNumber}`,
            itemCount
        });

    } catch (error) {
        if (error.statusCode === 400) {
            return res.status(400).json({ success: false, message: error.message });
        }
        console.error('Error al registrar el nuevo pedido:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al registrar el pedido.' });
    }
});


// --- Endpoint POST /api/orders/:orderId/change-status (Cambiar estatus + corona zafiro al pasar a Fabricar) ---
router.post('/orders/:orderId/change-status', async (req, res) => {
    const { orderId } = req.params;
    const { newStatus } = req.body;

    if (!orderId || !newStatus) {
        return res.status(400).json({ success: false, message: 'Faltan datos obligatorios: orderId y newStatus.' });
    }

    try {
        const orderRef = db.collection('pedidos').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        }

        const orderData = orderDoc.data();
        const oldStatus = (orderData.estatus || 'Sin estatus').toLowerCase();
        const updatePayload = { estatus: newStatus };

        // Registrar confirmedAt cuando el pedido se confirma por primera vez
        const isConfirming = newStatus.toLowerCase().includes('fabricar') || newStatus.toLowerCase().includes('pagado');
        const wasConfirmed = oldStatus.includes('fabricar') || oldStatus.includes('pagado');
        if (isConfirming && !wasConfirmed && !orderData.confirmedAt) {
            updatePayload.confirmedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        // Actualizar el pedido en Firestore
        await orderRef.update(updatePayload);

        // --- Descuento de inventario al confirmar pedido (idempotente) ---
        if (isConfirming && !wasConfirmed) {
            try {
                const result = await descontarInventarioPorPedido(orderId, orderData, newStatus);
                if (result.ok && result.descontado) {
                    console.log(`[INVENTARIO] Pedido ${orderId} descontó ${result.movimientos} materiales (${newStatus})`);
                } else if (result.ok && !result.descontado) {
                    console.log(`[INVENTARIO] Pedido ${orderId} no descontado: ${result.motivo}`);
                } else {
                    console.warn(`[INVENTARIO] Pedido ${orderId} falló descuento: ${result.motivo}`);
                }
            } catch (invErr) {
                console.error(`[INVENTARIO] Error descontando pedido ${orderId}:`, invErr.message);
                // No fallar el cambio de estatus por un error de inventario
            }
        }

        // Si cambia a "Fabricar" y antes no era Fabricar → corona zafiro (compra completada)
        if (newStatus === 'Fabricar' && !oldStatus.includes('fabricar') && orderData.contactId) {
            try {
                const contactRef = db.collection('contacts_whatsapp').doc(orderData.contactId);
                await contactRef.update({
                    purchaseStatus: 'completed',
                    purchaseDate: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (crownError) {
                console.error('[CROWN] Error al actualizar corona a completed:', crownError.message);
                // No fallar el request principal
            }
        }

        // Enviar el evento Purchase a Meta al confirmar la fabricación (idempotente por pedido)
        await sendPurchaseEventOnFabricar(orderId, { ...orderData, estatus: newStatus }, oldStatus);

        // --- Detección de recurrente al confirmar pago ---
        if (isConfirming && !wasConfirmed) {
            const phone = orderData.contactId || orderData.telefono;
            if (phone) {
                try {
                    const allOrders = await db.collection('pedidos')
                        .where('contactId', '==', phone)
                        .get();

                    const paidDocs = allOrders.docs.filter(doc => {
                        const est = doc.data().estatus;
                        // Incluir el pedido actual que acaba de cambiar a Pagado/Fabricar
                        return est === 'Pagado' || est === 'Fabricar' || (doc.id === orderId && isConfirming);
                    });

                    if (paidDocs.length >= 2) {
                        let totalSpent = 0;
                        const products = [];
                        let lastOrderDate = null;

                        paidDocs.forEach(doc => {
                            const d = doc.data();
                            totalSpent += d.precio || 0;
                            if (d.producto && !products.includes(d.producto)) products.push(d.producto);
                            const oDate = d.createdAt ? d.createdAt.toDate() : null;
                            if (oDate && (!lastOrderDate || oDate > lastOrderDate)) lastOrderDate = oDate;
                        });

                        let name = 'Sin nombre';
                        try {
                            const cDoc = await db.collection('contacts_whatsapp').doc(phone).get();
                            if (cDoc.exists) name = cDoc.data().name || name;
                        } catch (e) {}

                        await db.collection('recurring_customers').doc(phone).set({
                            name,
                            orderCount: paidDocs.length,
                            totalSpent,
                            products,
                            lastOrderDate,
                            detectedAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });

                        console.log(`[RECURRENTE] Cliente ${name} (${phone}) detectado al confirmar pago: ${paidDocs.length} pedidos pagados, $${totalSpent}`);
                    }
                } catch (recErr) {
                    console.error('Error al detectar recurrente en cambio de estatus:', recErr);
                }
            }
        }

        res.status(200).json({
            success: true,
            message: 'Estatus actualizado.'
        });

    } catch (error) {
        console.error(`Error al cambiar estatus del pedido ${orderId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al cambiar estatus.' });
    }
});


// --- Endpoint POST /api/contacts/:contactId/mark-as-purchase (Marcar compra y enviar evento a Meta) ---
router.post('/contacts/:contactId/mark-as-purchase', async (req, res) => {
    const { contactId } = req.params;
    const { value } = req.body; // Valor de la compra

    // Validar valor
    if (!value || isNaN(parseFloat(value))) {
        return res.status(400).json({ success: false, message: 'Se requiere un valor numérico válido para la compra.' });
    }

    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        }
        const contactData = contactDoc.data();

        // Evitar registrar la compra dos veces
        if (contactData.purchaseStatus === 'completed') {
            return res.status(400).json({ success: false, message: 'Este contacto ya realizó una compra registrada.' });
        }
        // Multicanal: WhatsApp (wa_id), Messenger (psid) o Instagram (igsid). Asegurar que hay
        // al menos un identificador de mensajería para poder enviar el evento a Meta.
        const eventInfo = messagingContactInfo(contactData);
        if (!eventInfo.wa_id && !eventInfo.psid && !eventInfo.igsid) {
            return res.status(500).json({ success: false, message: "Error interno: El contacto no tiene un ID de mensajería (WhatsApp/Messenger/Instagram) para enviar el evento a Meta." });
        }
        const customEventData = {
            value: parseFloat(value),
            currency: 'MXN' // Moneda
        };

        // Enviar evento 'Purchase' a la API de Conversiones de Meta. sendConversionEvent arma el
        // user_data correcto por canal y omite a los contactos sin señal de anuncio (orgánicos).
        await sendConversionEvent('Purchase', eventInfo, contactData.adReferral || {}, customEventData);

        // Actualizar el estado del contacto en Firestore
        await contactRef.update({
            purchaseStatus: 'completed',
            purchaseValue: parseFloat(value),
            purchaseCurrency: 'MXN',
            purchaseDate: admin.firestore.FieldValue.serverTimestamp()
            // Podrías añadir lógica para actualizar la etiqueta ('status') aquí si es necesario
            // status: 'venta_cerrada' // Por ejemplo
        });

        res.status(200).json({ success: true, message: 'Compra registrada y evento enviado a Meta con éxito.' });
    } catch (error) {
        console.error(`Error en mark-as-purchase para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar la compra.' });
    }
});

// --- Endpoint POST /api/contacts/:contactId/send-view-content (Enviar evento ViewContent a Meta) ---
router.post('/contacts/:contactId/send-view-content', async (req, res) => {
    const { contactId } = req.params;
    const contactRef = db.collection('contacts_whatsapp').doc(contactId);
    try {
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.status(404).json({ success: false, message: 'Contacto no encontrado.' });
        }
        const contactData = contactDoc.data();

        // Multicanal: WhatsApp (wa_id), Messenger (psid) o Instagram (igsid).
        const eventInfo = messagingContactInfo(contactData);
        if (!eventInfo.wa_id && !eventInfo.psid && !eventInfo.igsid) {
            return res.status(500).json({ success: false, message: "Error interno: El contacto no tiene un ID de mensajería (WhatsApp/Messenger/Instagram) para enviar el evento a Meta." });
        }

        // Enviar evento 'ViewContent'
        await sendConversionEvent('ViewContent', eventInfo, contactData.adReferral || {});

        res.status(200).json({ success: true, message: 'Evento ViewContent enviado a Meta con éxito.' });
    } catch (error) {
        console.error(`Error en send-view-content para ${contactId}:`, error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al procesar el envío de ViewContent.' });
    }
});


// --- Endpoints para Notas Internas (/api/contacts/:contactId/notes) ---
// POST (Crear)
router.post('/contacts/:contactId/notes', async (req, res) => {
    const { contactId } = req.params;
    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ success: false, message: 'El texto de la nota no puede estar vacío.' });
    }
    try {
        // Añadir nota a la subcolección 'notes' del contacto
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').add({
            text,
            timestamp: admin.firestore.FieldValue.serverTimestamp() // Guardar hora de creación
        });
        res.status(201).json({ success: true, message: 'Nota guardada con éxito.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al guardar la nota.' });
    }
});

// PUT (Actualizar)
router.put('/contacts/:contactId/notes/:noteId', async (req, res) => {
    const { contactId, noteId } = req.params;
    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ success: false, message: 'El texto de la nota no puede estar vacío.' });
    }
    try {
        // Actualizar el texto de la nota específica
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').doc(noteId).update({
            text: text
            // Podrías añadir un campo 'updatedAt' si quisieras rastrear ediciones
        });
        res.status(200).json({ success: true, message: 'Nota actualizada con éxito.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar la nota.' });
    }
});

// DELETE (Borrar)
router.delete('/contacts/:contactId/notes/:noteId', async (req, res) => {
    const { contactId, noteId } = req.params;
    try {
        // Borrar la nota específica
        await db.collection('contacts_whatsapp').doc(contactId).collection('notes').doc(noteId).delete();
        res.status(200).json({ success: true, message: 'Nota eliminada con éxito.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar la nota.' });
    }
});


// --- Endpoints para Respuestas Rápidas (/api/quick-replies) ---
// POST (Crear)
router.post('/quick-replies', async (req, res) => {
    const { shortcut, message, fileUrl, fileType } = req.body;
    // Validaciones
    if (!shortcut || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'El atajo y un mensaje o archivo adjunto son obligatorios.' });
    }
    if (fileUrl && !fileType) { // Si hay archivo, se necesita el tipo
        return res.status(400).json({ success: false, message: 'El tipo de archivo es obligatorio si se adjunta uno.' });
    }

    try {
        // Asegurar que archivo GCS sea público
        if (fileUrl && fileUrl.includes(bucket.name)) {
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(decodeURIComponent(filePath)).makePublic();
                console.log(`[GCS-QR] Archivo ${decodeURIComponent(filePath)} hecho público con éxito.`);
            } catch (gcsError) {
                console.error(`[GCS-QR] No se pudo hacer público el archivo ${fileUrl}:`, gcsError);
                // No fallar la operación, solo loguear
            }
        }

        // Verificar si el atajo ya existe
        const existing = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existing.empty) {
            return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya existe.` });
        }

        // Crear datos para Firestore (null si no hay valor)
        const replyData = {
            shortcut,
            message: message || null,
            fileUrl: fileUrl || null,
            fileType: fileType || null
        };
        // Añadir a Firestore
        const newReply = await db.collection('quick_replies').add(replyData);
        res.status(201).json({ success: true, id: newReply.id, data: replyData });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al crear la respuesta rápida.' });
    }
});

// PUT (Actualizar)
router.put('/quick-replies/:id', async (req, res) => {
    const { id } = req.params;
    const { shortcut, message, fileUrl, fileType } = req.body;
    // Validaciones
    if (!shortcut || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'El atajo y un mensaje o archivo adjunto son obligatorios.' });
    }
    if (fileUrl && !fileType) {
        return res.status(400).json({ success: false, message: 'El tipo de archivo es obligatorio si se adjunta uno.' });
    }

    try {
        // Asegurar que archivo GCS sea público
        if (fileUrl && fileUrl.includes(bucket.name)) {
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(decodeURIComponent(filePath)).makePublic();
                console.log(`[GCS-QR] Archivo ${decodeURIComponent(filePath)} hecho público con éxito.`);
            } catch (gcsError) {
                console.error(`[GCS-QR] No se pudo hacer público el archivo ${fileUrl}:`, gcsError);
            }
        }

        // Verificar si el nuevo atajo ya existe en *otro* documento
        const existing = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (!existing.empty && existing.docs[0].id !== id) { // Asegurarse de que no sea el mismo documento
            return res.status(409).json({ success: false, message: `El atajo '/${shortcut}' ya está en uso por otra respuesta.` });
        }

        // Crear datos para actualizar
        const updateData = {
            shortcut,
            message: message || null,
            fileUrl: fileUrl || null,
            fileType: fileType || null
        };
        // Actualizar en Firestore
        await db.collection('quick_replies').doc(id).update(updateData);
        res.status(200).json({ success: true, message: 'Respuesta rápida actualizada.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar.' });
    }
});

// DELETE (Borrar)
router.delete('/quick-replies/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Borrar de Firestore
        await db.collection('quick_replies').doc(id).delete();
        res.status(200).json({ success: true, message: 'Respuesta rápida eliminada.' });
        // Nota: No se borra el archivo de GCS asociado automáticamente.
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar.' });
    }
});


// --- Endpoints para Etiquetas (/api/tags) ---
// POST (Crear)
router.post('/tags', async (req, res) => {
    const { label, color, key, order } = req.body;
    if (!label || !color || !key || order === undefined) {
        return res.status(400).json({ success: false, message: 'Faltan datos (label, color, key, order).' });
    }
    try {
        await db.collection('crm_tags').add({ label, color, key, order });
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al crear la etiqueta.' });
    }
});

// PUT (Actualizar Orden)
router.put('/tags/order', async (req, res) => {
    const { orderedIds } = req.body; // Array de IDs en el nuevo orden
    if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ success: false, message: 'Se esperaba un array de IDs.' });
    }
    try {
        const batch = db.batch();
        // Actualizar el campo 'order' de cada etiqueta según su posición en el array
        orderedIds.forEach((id, index) => {
            const docRef = db.collection('crm_tags').doc(id);
            batch.update(docRef, { order: index });
        });
        await batch.commit(); // Ejecutar todas las actualizaciones en lote
        res.status(200).json({ success: true, message: 'Orden de etiquetas actualizado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar orden.' });
    }
});

// PUT (Actualizar una etiqueta)
router.put('/tags/:id', async (req, res) => {
    const { id } = req.params;
    const { label, color, key } = req.body;
    if (!label || !color || !key) {
        return res.status(400).json({ success: false, message: 'Faltan datos (label, color, key).' });
    }
    try {
        await db.collection('crm_tags').doc(id).update({ label, color, key });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al actualizar la etiqueta.' });
    }
});

// DELETE (Borrar una etiqueta)
router.delete('/tags/:id', async (req, res) => {
    try {
        await db.collection('crm_tags').doc(req.params.id).delete();
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al eliminar la etiqueta.' });
    }
});

// DELETE (Borrar TODAS las etiquetas)
router.delete('/tags', async (req, res) => {
    try {
        const snapshot = await db.collection('crm_tags').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref)); // Añadir borrado de cada doc al lote
        await batch.commit(); // Ejecutar borrado en lote
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al eliminar todas las etiquetas.' });
    }
});


// --- Endpoints para Mensajes de Anuncios (/api/ad-responses) ---
// POST (Crear)
router.post('/ad-responses', async (req, res) => {
    const { adName, adIds: adIdsInput, message, fileUrl, fileType } = req.body;
    const adIds = parseAdIds(adIdsInput); // Usa la función helper para limpiar

    if (!adName || adIds.length === 0 || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'Nombre, al menos un Ad ID válido, y un mensaje o archivo son obligatorios.' });
    }

    try {
        if (fileUrl && fileUrl.includes(bucket.name)) { // Hacer público archivo GCS
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(decodeURIComponent(filePath)).makePublic();
                console.log(`[GCS-AD] Archivo ${decodeURIComponent(filePath)} hecho público.`);
            } catch (gcsError) { console.error(`[GCS-AD] Warn: No se pudo hacer público ${fileUrl}:`, gcsError); }
        }

        // Verificar conflictos de Ad ID
        const snapshot = await db.collection('ad_responses').where('adIds', 'array-contains-any', adIds).get();
        if (!snapshot.empty) {
            const conflictingIds = snapshot.docs.reduce((acc, doc) => {
                const docIds = doc.data().adIds || [];
                const overlap = adIds.filter(id => docIds.includes(id));
                return acc.concat(overlap);
            }, []);
            if (conflictingIds.length > 0) {
                return res.status(409).json({ success: false, message: `Los Ad IDs ya están en uso: ${[...new Set(conflictingIds)].join(', ')}` });
            }
        }

        // Guardar en Firestore
        const data = { adName, adIds, message: message || null, fileUrl: fileUrl || null, fileType: fileType || null };
        const newResponse = await db.collection('ad_responses').add(data);
        res.status(201).json({ success: true, id: newResponse.id, data });
    } catch (error) {
        console.error("Error creating ad response:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al crear el mensaje.' });
    }
});

// PUT (Actualizar)
router.put('/ad-responses/:id', async (req, res) => {
    const { id } = req.params;
    const { adName, adIds: adIdsInput, message, fileUrl, fileType } = req.body;
    const adIds = parseAdIds(adIdsInput); // Limpiar IDs

    if (!adName || adIds.length === 0 || (!message && !fileUrl)) {
        return res.status(400).json({ success: false, message: 'Nombre, al menos un Ad ID válido, y un mensaje o archivo son obligatorios.' });
    }
    try {
        if (fileUrl && fileUrl.includes(bucket.name)) { // Hacer público archivo GCS
            try {
                const filePath = fileUrl.split(`${bucket.name}/`)[1].split('?')[0];
                await bucket.file(decodeURIComponent(filePath)).makePublic();
                console.log(`[GCS-AD] Archivo ${decodeURIComponent(filePath)} hecho público.`);
            } catch (gcsError) { console.error(`[GCS-AD] Warn: No se pudo hacer público ${fileUrl}:`, gcsError); }
        }

        // Verificar conflictos (excluyendo el documento actual)
        const snapshot = await db.collection('ad_responses').where('adIds', 'array-contains-any', adIds).get();
        let conflict = false;
        let conflictingIdsList = [];
        snapshot.forEach(doc => {
            if (doc.id !== id) { // No comparar consigo mismo
                const docIds = doc.data().adIds || [];
                const overlap = adIds.filter(newId => docIds.includes(newId));
                if (overlap.length > 0) {
                    conflict = true;
                    conflictingIdsList = conflictingIdsList.concat(overlap);
                }
            }
        });

        if (conflict) {
            return res.status(409).json({ success: false, message: `Ad IDs en uso por otros mensajes: ${[...new Set(conflictingIdsList)].join(', ')}` });
        }

        // Actualizar en Firestore
        const data = { adName, adIds, message: message || null, fileUrl: fileUrl || null, fileType: fileType || null };
        await db.collection('ad_responses').doc(id).update(data);
        res.status(200).json({ success: true, message: 'Mensaje de anuncio actualizado.' });
    } catch (error) {
        console.error("Error updating ad response:", error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar.' });
    }
});
// DELETE (Borrar)
router.delete('/ad-responses/:id', async (req, res) => {
    try {
        // Borrar de Firestore
        await db.collection('ad_responses').doc(req.params.id).delete();
        res.status(200).json({ success: true, message: 'Mensaje de anuncio eliminado.' });
        // Nota: No se borra el archivo de GCS asociado.
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar.' });
    }
});



// --- Endpoints para Ajustes Generales (/api/settings/...) ---
// GET (Obtener estado del mensaje de ausencia)
router.get('/settings/away-message', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        // Devolver estado o true por defecto si no existe
        res.status(200).json({ success: true, settings: { isActive: doc.exists ? doc.data().awayMessageActive : true } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener ajuste de mensaje de ausencia.' });
    }
});

// POST (Guardar estado del mensaje de ausencia)
router.post('/settings/away-message', async (req, res) => {
    try {
        // Guardar estado en el documento 'general' (usar merge para no borrar otros ajustes)
        await db.collection('crm_settings').doc('general').set({ awayMessageActive: req.body.isActive }, { merge: true });
        res.status(200).json({ success: true, message: 'Ajuste de mensaje de ausencia guardado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar ajuste.' });
    }
});



// GET (Obtener ID de Google Sheet)
router.get('/settings/google-sheet', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        // Devolver ID o string vacío si no existe
        res.status(200).json({ success: true, settings: { googleSheetId: doc.exists ? doc.data().googleSheetId : '' } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener ID de Google Sheet.' });
    }
});

// POST (Guardar ID de Google Sheet)
router.post('/settings/google-sheet', async (req, res) => {
    try {
        // Guardar ID en el documento 'general'
        await db.collection('crm_settings').doc('general').set({ googleSheetId: req.body.googleSheetId }, { merge: true });
        res.status(200).json({ success: true, message: 'ID de Google Sheet guardado.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar ID.' });
    }
});

// GET (Obtener la respuesta rápida configurada como bienvenida de Facebook/Messenger)
router.get('/settings/messenger-welcome', async (req, res) => {
    try {
        const doc = await db.collection('crm_settings').doc('general').get();
        const shortcut = doc.exists ? (doc.data().messengerWelcomeShortcut || '') : '';
        res.status(200).json({ success: true, settings: { shortcut } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener la bienvenida de Facebook.' });
    }
});

// POST (Guardar la respuesta rápida que se envía como bienvenida a Facebook/Messenger)
router.post('/settings/messenger-welcome', async (req, res) => {
    try {
        const shortcut = (req.body.shortcut || '').trim();
        await db.collection('crm_settings').doc('general').set({ messengerWelcomeShortcut: shortcut }, { merge: true });
        res.status(200).json({ success: true, message: 'Bienvenida de Facebook guardada.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar la bienvenida de Facebook.' });
    }
});



// --- Endpoint POST /api/test/simulate-ad-message (Simular mensaje de anuncio) ---
router.post('/test/simulate-ad-message', async (req, res) => {
    const { from, adId, text } = req.body;
    if (!from || !adId || !text) {
        return res.status(400).json({ success: false, message: 'Faltan parámetros (from, adId, text).' });
    }

    // Construir un payload falso similar al que enviaría Meta
    const fakePayload = {
        object: 'whatsapp_business_account',
        entry: [{
            id: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || 'DUMMY_WABA_ID', // Usar variable de entorno o dummy
            changes: [{
                value: {
                    messaging_product: 'whatsapp',
                    metadata: {
                        display_phone_number: (PHONE_NUMBER_ID || '15550001111').slice(-10), // Usar variable o dummy
                        phone_number_id: PHONE_NUMBER_ID || '15550001111'
                    },
                    contacts: [{ profile: { name: `Test User ${from.slice(-4)}` }, wa_id: from }],
                    messages: [{
                        from: from,
                        id: `wamid.TEST_${uuidv4()}`, // ID de mensaje falso único
                        timestamp: Math.floor(Date.now() / 1000).toString(),
                        text: { body: text },
                        type: 'text',
                        // Incluir la sección 'referral' para simular origen de anuncio
                        referral: {
                            source_url: `https://fb.me/xxxxxxxx`, // URL genérica
                            source_type: 'ad',
                            source_id: adId, // El Ad ID proporcionado
                            headline: 'Anuncio de Prueba Simulado' // Texto genérico
                        }
                    }]
                },
                field: 'messages'
            }]
        }]
    };

    try {
        console.log(`[SIMULATOR] Recibida simulación para ${from} desde Ad ID ${adId}.`);
        // Enviar el payload falso al propio endpoint del webhook
        // Asegúrate de que la URL y el puerto sean correctos para tu entorno (local o producción)
        const webhookUrl = `http://localhost:${PORT}/webhook`; // Cambiar si es necesario
        await axios.post(webhookUrl, fakePayload, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`[SIMULATOR] Simulación enviada al webhook (${webhookUrl}) con éxito.`);
        res.status(200).json({ success: true, message: 'Simulación procesada por el webhook.' });
    } catch (error) {
        console.error('❌ ERROR EN EL SIMULADOR:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Error interno al procesar la simulación.' });
    }
});

// --- Endpoint GET /api/metrics (Obtener métricas de mensajes) ---
router.get('/metrics', async (req, res) => {
    try {
        // Leer los últimos 30 días de daily_metrics (máximo 30 documentos)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);
        const startKey = startDate.toISOString().split('T')[0]; // YYYY-MM-DD

        const snapshot = await db.collection('daily_metrics')
            .where(admin.firestore.FieldPath.documentId(), '>=', startKey)
            .orderBy(admin.firestore.FieldPath.documentId())
            .get();

        if (snapshot.empty) {
            // Fallback: si no hay datos pre-agregados, devolver vacío
            return res.status(200).json({ success: true, data: [] });
        }

        const formattedMetrics = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                date: doc.id,
                totalMessages: data.totalMessages || 0,
                tags: data.tags || {}
            };
        });

        res.status(200).json({ success: true, data: formattedMetrics });
    } catch (error) {
        console.error('❌ Error al obtener las métricas:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener métricas.' });
    }
});

// --- Endpoint GET /api/metrics/series (Serie temporal de mensajes recibidos por día) ---
// Lee daily_metrics en una ventana amplia (~24 meses) para graficar por día/mes/año.
// El frontend agrupa por la granularidad elegida. Cache simple de 10 min.
let metricsSeriesCache = null;
router.get('/metrics/series', async (req, res) => {
    try {
        if (req.query.fresh !== '1' && metricsSeriesCache && (Date.now() - metricsSeriesCache.at) < 10 * 60 * 1000) {
            return res.status(200).json({ success: true, data: metricsSeriesCache.data, fromCache: true });
        }
        const start = new Date();
        start.setMonth(start.getMonth() - 24);
        const startKey = start.toISOString().split('T')[0]; // YYYY-MM-DD
        const snapshot = await db.collection('daily_metrics')
            .where(admin.firestore.FieldPath.documentId(), '>=', startKey)
            .orderBy(admin.firestore.FieldPath.documentId())
            .get();
        const data = snapshot.docs.map(doc => ({ date: doc.id, total: doc.data().totalMessages || 0 }));
        metricsSeriesCache = { at: Date.now(), data };
        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('❌ Error en /metrics/series:', error);
        res.status(500).json({ success: false, message: error.message || 'Error del servidor al obtener la serie.' });
    }
});

// --- Endpoint GET /api/orders/verify/:orderId (Verificar pedido o teléfono) ---
router.get('/orders/verify/:orderId', async (req, res) => {
    const { orderId } = req.params;

    // Verificar si es un número de teléfono (simplificado)
    const isPhoneNumber = /^\d{10,}$/.test(orderId.replace(/\D/g, ''));
    if (isPhoneNumber) {
        // Si es teléfono, devolver directamente el ID y nombre N/A
        return res.status(200).json({ success: true, contactId: orderId, customerName: 'N/A (Teléfono directo)' });
    }

    // Si no es teléfono, intentar parsear como número de pedido (DHxxxx)
    const match = orderId.match(/(\d+)/); // Extraer números
    if (!match) {
        return res.status(400).json({ success: false, message: 'Formato de ID de pedido inválido. Se esperaba "DH" seguido de números o un teléfono.' });
    }
    const consecutiveOrderNumber = parseInt(match[1], 10);

    try {
        // Buscar pedido por número consecutivo
        const ordersQuery = db.collection('pedidos').where('consecutiveOrderNumber', '==', consecutiveOrderNumber).limit(1);
        const snapshot = await ordersQuery.get();

        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado.' });
        }

        const pedidoData = snapshot.docs[0].data();
        const contactId = pedidoData.telefono; // Obtener teléfono del pedido

        if (!contactId) {
            return res.status(404).json({ success: false, message: 'El pedido encontrado no tiene un número de teléfono asociado.' });
        }

        // Buscar el nombre del contacto asociado al teléfono
        const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
        const customerName = contactDoc.exists ? contactDoc.data().name : 'Cliente (No en CRM)';

        // Devolver ID de contacto (teléfono) y nombre del cliente
        res.status(200).json({ success: true, contactId, customerName });

    } catch (error) {
        console.error(`Error al verificar el pedido ${orderId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al verificar el pedido.' });
    }
});

// --- Endpoint POST /api/difusion/bulk-send (Envío masivo para difusión) ---
router.post('/difusion/bulk-send', async (req, res) => {
    const { jobs, messageSequence, contingencyTemplate } = req.body;

    // Validación básica de entrada
    if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
        return res.status(400).json({ success: false, message: 'La lista de trabajos de envío es inválida o está vacía.' });
    }

    const results = { successful: [], failed: [], contingent: [] };

    // Procesar cada trabajo de envío
    for (const job of jobs) {
        // Validar datos del trabajo individual
        if (!job.contactId || !job.orderId || !job.photoUrl) {
            results.failed.push({ orderId: job.orderId, reason: 'Datos del trabajo incompletos (contactId, orderId, o photoUrl faltantes).' });
            continue; // Saltar al siguiente trabajo
        }

        try {
            const contactRef = db.collection('contacts_whatsapp').doc(job.contactId);
            const contactDoc = await contactRef.get();

            // Crear contacto si no existe
            if (!contactDoc.exists) {
                console.log(`[DIFUSION] El contacto ${job.contactId} no existe. Creando nuevo registro.`);
                await contactRef.set({
                    name: `Nuevo Contacto (${job.contactId.slice(-4)})`, // Nombre genérico
                    wa_id: job.contactId,
                    lastMessage: 'Inicio de conversación por difusión.',
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                    // unreadCount no se establece aquí, se maneja al recibir mensaje
                }, { merge: true }); // Usar merge por si acaso
                console.log(`[DIFUSION] Contacto ${job.contactId} creado.`);
            }

            // Verificar si la última respuesta del cliente fue hace menos de 24h
            const messagesSnapshot = await contactRef.collection('messages')
                .where('from', '==', job.contactId) // Mensajes DEL cliente
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();

            let isWithin24Hours = false;
            if (!messagesSnapshot.empty) {
                const lastMessageTimestamp = messagesSnapshot.docs[0].data().timestamp.toMillis();
                const now = Date.now();
                const hoursDiff = (now - lastMessageTimestamp) / (1000 * 60 * 60);
                if (hoursDiff <= 24) {
                    isWithin24Hours = true;
                }
            }

            // --- Lógica de envío basada en la ventana de 24h ---
            if (isWithin24Hours) {
                // --- DENTRO de 24h: Enviar secuencia + foto ---
                console.log(`[DIFUSION] Contacto ${job.contactId} dentro de 24h. Enviando secuencia y foto.`);
                let lastMessageText = ''; // Para actualizar el contacto

                // Enviar secuencia de mensajes (si existe)
                if (messageSequence && messageSequence.length > 0) {
                    for (const qr of messageSequence) {
                        const sentMessageData = await sendAdvancedWhatsAppMessage(job.contactId, { text: qr.message, fileUrl: qr.fileUrl, fileType: qr.fileType });
                        // Guardar mensaje enviado en Firestore
                        const messageToSave = {
                            from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                            id: sentMessageData.id, text: sentMessageData.textForDb, isAutoReply: true
                        };
                        await contactRef.collection('messages').add(messageToSave);
                        lastMessageText = sentMessageData.textForDb;
                        await new Promise(resolve => setTimeout(resolve, 500)); // Pequeño delay
                    }
                }

                // Enviar la foto del pedido
                const sentPhotoData = await sendAdvancedWhatsAppMessage(job.contactId, { text: null, fileUrl: job.photoUrl, fileType: 'image/jpeg' /* Asumir JPEG */ });
                // Guardar mensaje de foto en Firestore
                const photoMessageToSave = {
                    from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: sentPhotoData.id, text: sentPhotoData.textForDb, fileUrl: sentPhotoData.fileUrlForDb,
                    fileType: sentPhotoData.fileTypeForDb, isAutoReply: true
                };
                Object.keys(photoMessageToSave).forEach(key => photoMessageToSave[key] == null && delete photoMessageToSave[key]); // Limpiar nulos
                await contactRef.collection('messages').add(photoMessageToSave);
                lastMessageText = sentPhotoData.textForDb;

                // Actualizar último mensaje del contacto
                await contactRef.update({
                    lastMessage: lastMessageText,
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                results.successful.push({ orderId: job.orderId });

            } else {
                // --- FUERA de 24h: Enviar plantilla de contingencia ---
                console.log(`[DIFUSION] Contacto ${job.contactId} fuera de 24h. Enviando plantilla de contingencia.`);

                // Validar que se proporcionó una plantilla
                if (!contingencyTemplate || !contingencyTemplate.name) {
                    results.failed.push({ orderId: job.orderId, reason: 'Fuera de ventana de 24h y no se proporcionó plantilla de contingencia válida.' });
                    continue; // Saltar al siguiente trabajo
                }

                // Parámetros para la plantilla (asumiendo que {{1}} es el ID del pedido y {{2}} la imagen)
                const bodyParams = [job.orderId]; // Parámetros a partir de {{2}}
                // Construir payload de la plantilla (con imagen como cabecera)
                const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(job.contactId, contingencyTemplate, job.photoUrl, bodyParams);

                // Enviar plantilla a WhatsApp
                const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
                    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
                });

                // Guardar mensaje de plantilla en Firestore
                const messageId = response.data.messages[0].id;
                const messageToSave = {
                    from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    id: messageId, text: messageToSaveText, isAutoReply: true
                };
                await contactRef.collection('messages').add(messageToSave);
                // Actualizar último mensaje del contacto
                await contactRef.update({
                    lastMessage: messageToSaveText,
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                // Guardar registro de envío contingente para ejecutarlo cuando el cliente responda
                await db.collection('contingentSends').add({
                    contactId: job.contactId,
                    status: 'pending', // Marcar como pendiente
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    payload: { // Guardar la información necesaria para el envío posterior
                        messageSequence: messageSequence || [], // Secuencia original
                        photoUrl: job.photoUrl, // Foto original
                        orderId: job.orderId // ID del pedido original
                    }
                });

                results.contingent.push({ orderId: job.orderId });
            }
        } catch (error) {
            console.error(`Error procesando el trabajo para el pedido ${job.orderId} (Contacto: ${job.contactId}):`, error.response ? error.response.data : error.message);
            results.failed.push({ orderId: job.orderId, reason: error.message || 'Error desconocido durante el envío.' });
        }
    } // Fin del bucle for

    // Devolver resultados consolidados
    res.status(200).json({ success: true, message: 'Proceso de envío masivo completado.', results });
});

// --- INICIO: Nuevo Endpoint para Conteo de Mensajes por Ad ID ---
router.get('/metrics/messages-by-ad', async (req, res) => {
    const { startDate, endDate } = req.query; // Espera fechas en formato YYYY-MM-DD

    // Validación básica de fechas
    if (!startDate || !endDate) {
        return res.status(400).json({ success: false, message: 'Se requieren las fechas de inicio (startDate) y fin (endDate) en formato YYYY-MM-DD.' });
    }

    try {
        // Convertir strings de fecha a Timestamps de Firestore
        // Asegurarse de que startDate sea el inicio del día y endDate el final del día
        const start = new Date(`${startDate}T00:00:00.000Z`); // UTC para Firestore
        const end = new Date(`${endDate}T23:59:59.999Z`); // UTC para Firestore

        if (isNaN(start) || isNaN(end)) {
            return res.status(400).json({ success: false, message: 'Formato de fecha inválido. Usar YYYY-MM-DD.' });
        }

        const startTimestamp = admin.firestore.Timestamp.fromDate(start);
        const endTimestamp = admin.firestore.Timestamp.fromDate(end);

        console.log(`[METRICS AD] Buscando mensajes entre ${startTimestamp.toDate()} y ${endTimestamp.toDate()}`);

        // Consulta usando collectionGroup para buscar en todas las subcolecciones 'messages'
        const messagesQuery = db.collectionGroup('messages')
            .where('timestamp', '>=', startTimestamp)
            .where('timestamp', '<=', endTimestamp)
            .where('from', '!=', PHONE_NUMBER_ID) // Solo mensajes entrantes
            .where('adId', '!=', null); // Solo mensajes que SÍ tengan un adId guardado

        const snapshot = await messagesQuery.get();

        if (snapshot.empty) {
            console.log('[METRICS AD] No se encontraron mensajes entrantes con Ad ID en el rango especificado.');
            return res.status(200).json({ success: true, counts: {} }); // Devolver objeto vacío
        }

        // Procesar los resultados para contar por Ad ID
        const countsByAdId = {};
        snapshot.forEach(doc => {
            const messageData = doc.data();
            const adId = messageData.adId; // El campo que guardamos en whatsappHandler.js

            if (adId) { // Doble verificación por si acaso
                countsByAdId[adId] = (countsByAdId[adId] || 0) + 1;
            }
        });

        console.log(`[METRICS AD] Conteo final:`, countsByAdId);
        res.status(200).json({ success: true, counts: countsByAdId });

    } catch (error) {
        console.error('❌ Error al obtener conteo de mensajes por Ad ID:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al procesar la solicitud de métricas por Ad ID.' });
    }
});
// --- FIN: Nuevo Endpoint ---

// --- INICIO DE NUEVAS RUTAS PARA DEPARTAMENTOS Y REGLAS DE ENRUTAMIENTO ---


// 2. REGLAS DE ENRUTAMIENTO DE ANUNCIOS (/api/ad-routing-rules)

// GET /api/ad-routing-rules: Listar todas las reglas
router.get('/ad-routing-rules', async (req, res) => {
    try {
        const snapshot = await db.collection('ad_routing_rules').get();
        const rules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json({ success: true, rules });
    } catch (error) {
        console.error('Error al obtener reglas de enrutamiento:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener reglas.' });
    }
});

// POST /api/ad-routing-rules: Crear nueva regla
router.post('/ad-routing-rules', async (req, res) => {
    const { ruleName, adIds: adIdsInput, targetDepartmentId, enableAi } = req.body;
    const adIds = parseAdIds(adIdsInput); // Usa la función helper existente para limpiar IDs

    if (!ruleName || adIds.length === 0 || !targetDepartmentId) {
        return res.status(400).json({ success: false, message: 'Nombre, Ad IDs y Departamento son obligatorios.' });
    }

    try {
        const newRule = {
            ruleName,
            adIds,
            targetDepartmentId,
            enableAi: !!enableAi,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const docRef = await db.collection('ad_routing_rules').add(newRule);
        res.status(201).json({ success: true, id: docRef.id, ...newRule });
    } catch (error) {
        console.error('Error al crear regla de enrutamiento:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al crear regla.' });
    }
});

// PUT /api/ad-routing-rules/:id: Actualizar regla
router.put('/ad-routing-rules/:id', async (req, res) => {
    const { id } = req.params;
    const { ruleName, adIds: adIdsInput, targetDepartmentId, enableAi } = req.body;
    const adIds = parseAdIds(adIdsInput);

    try {
        await db.collection('ad_routing_rules').doc(id).update({
            ruleName,
            adIds,
            targetDepartmentId,
            enableAi: !!enableAi
        });
        res.status(200).json({ success: true, message: 'Regla actualizada.' });
    } catch (error) {
        console.error('Error al actualizar regla de enrutamiento:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar regla.' });
    }
});

// DELETE /api/ad-routing-rules/:id: Eliminar regla
router.delete('/ad-routing-rules/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('ad_routing_rules').doc(id).delete();
        res.status(200).json({ success: true, message: 'Regla eliminada.' });
    } catch (error) {
        console.error('Error al eliminar regla de enrutamiento:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al eliminar regla.' });
    }
});

// --- GET /api/ads: lista de anuncios para el selector del filtro de conversaciones ---
// Combina los anuncios CONFIGURADOS (ad_routing_rules / ad_responses, con nombre curado por el usuario)
// con los DETECTADOS en los chats (adReferralHistory de los contactos). Devuelve por cada anuncio:
//   { id (source_id), name, count (chats donde apareció), configured }.
// Cachea el resultado en memoria unos minutos porque escanea la colección de contactos.
let __adsListCache = { data: null, ts: 0 };
const ADS_LIST_CACHE_MS = 5 * 60 * 1000;

router.get('/ads', async (req, res) => {
    try {
        const force = req.query.refresh === 'true';
        const now = Date.now();
        if (!force && __adsListCache.data && (now - __adsListCache.ts) < ADS_LIST_CACHE_MS) {
            return res.status(200).json({ success: true, ads: __adsListCache.data, cached: true });
        }

        // Mapa source_id -> { id, name, count, configured }
        const adsMap = new Map();
        const upsert = (rawId, { name, configured, addCount } = {}) => {
            if (rawId === undefined || rawId === null || rawId === '') return;
            const id = String(rawId);
            const cur = adsMap.get(id) || { id, name: '', count: 0, configured: false };
            // Preferimos un nombre curado (configurado) sobre el del referral.
            if (name && (!cur.name || (configured && !cur.configured))) cur.name = String(name);
            if (configured) cur.configured = true;
            if (addCount) cur.count += addCount;
            adsMap.set(id, cur);
        };

        // 1) Anuncios configurados (nombre curado por el usuario)
        const [rulesSnap, respSnap] = await Promise.all([
            db.collection('ad_routing_rules').get(),
            db.collection('ad_responses').get()
        ]);
        rulesSnap.forEach(doc => {
            const d = doc.data() || {};
            (Array.isArray(d.adIds) ? d.adIds : []).forEach(id => upsert(id, { name: d.ruleName, configured: true }));
        });
        respSnap.forEach(doc => {
            const d = doc.data() || {};
            (Array.isArray(d.adIds) ? d.adIds : []).forEach(id => upsert(id, { name: d.adName, configured: true }));
        });

        // 2) Anuncios detectados en las conversaciones (solo traemos los campos de anuncio)
        const contactsSnap = await db.collection('contacts_whatsapp')
            .select('adReferralHistory', 'adReferral')
            .get();
        contactsSnap.forEach(doc => {
            const d = doc.data() || {};
            const hist = (Array.isArray(d.adReferralHistory) && d.adReferralHistory.length)
                ? d.adReferralHistory
                : (d.adReferral ? [d.adReferral] : []);
            hist.forEach(ref => {
                if (!ref || !ref.source_id) return;
                const name = ref.ad_name || ref.headline || ref.body || '';
                upsert(ref.source_id, { name, addCount: 1 });
            });
        });

        const ads = Array.from(adsMap.values())
            .map(a => ({ id: a.id, name: a.name || `Anuncio ${a.id}`, count: a.count, configured: a.configured }))
            // Primero los que tienen más conversaciones; a igualdad, por nombre.
            .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'es'));

        __adsListCache = { data: ads, ts: now };
        res.status(200).json({ success: true, ads, cached: false });
    } catch (error) {
        console.error('Error al obtener la lista de anuncios:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al obtener la lista de anuncios.' });
    }
});

// --- FIN DE NUEVAS RUTAS ---

// --- Endpoint POST /api/maintenance/migrate-orphans (Mantenimiento) ---
router.post('/maintenance/migrate-orphans', async (req, res) => {
    try {
        // 1. Buscar el ID del departamento "General"
        const generalDeptSnapshot = await db.collection('departments').where('name', '==', 'General').limit(1).get();
        if (generalDeptSnapshot.empty) {
            return res.status(404).json({ success: false, message: 'No se encontró el departamento "General".' });
        }
        const generalDeptId = generalDeptSnapshot.docs[0].id;

        // 2. Obtener TODOS los contactos
        const allContactsSnapshot = await db.collection('contacts_whatsapp').get();

        // 3. Filtrar en el backend para encontrar los huérfanos
        const orphanContacts = [];
        allContactsSnapshot.forEach(doc => {
            const data = doc.data();
            // Un chat es huérfano si la propiedad no existe O si es null/undefined/vacía
            if (!data.assignedDepartmentId) {
                orphanContacts.push(doc);
            }
        });
        
        if (orphanContacts.length === 0) {
            return res.status(200).json({ success: true, message: 'No se encontraron chats huérfanos para migrar.' });
        }

        // 4. Crear un batch para actualizar todos los huérfanos
        const batch = db.batch();
        orphanContacts.forEach(doc => {
            const contactRef = db.collection('contacts_whatsapp').doc(doc.id);
            batch.update(contactRef, { assignedDepartmentId: generalDeptId });
        });

        // 5. Ejecutar el batch
        await batch.commit();

        // 6. Devolver resumen
        const migratedCount = orphanContacts.length;
        res.status(200).json({
            success: true,
            message: `Se migraron ${migratedCount} chats al departamento General.`
        });

    } catch (error) {
        console.error('Error en la migración de chats huérfanos:', error);
        res.status(500).json({ success: false, message: 'Ocurrió un error en el servidor durante la migración.' });
    }
});

// --- Endpoint POST /api/maintenance/backfill-ad-source-ids (Mantenimiento) ---
// Rellena el campo plano 'adSourceIds' (IDs de anuncio de TODO el historial) en los contactos
// existentes, para que el filtro por ID de anuncio funcione también con conversaciones previas.
// Solo necesita ejecutarse una vez; de ahí en adelante el campo se mantiene solo al llegar anuncios.
router.post('/maintenance/backfill-ad-source-ids', async (req, res) => {
    try {
        const snapshot = await db.collection('contacts_whatsapp').get();
        let updated = 0;
        let batch = db.batch();
        let ops = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();

            // Reunir todos los source_id: del historial y del primer anuncio (adReferral).
            const ids = new Set();
            if (Array.isArray(data.adReferralHistory)) {
                data.adReferralHistory.forEach(e => { if (e && e.source_id) ids.add(String(e.source_id)); });
            }
            if (data.adReferral && data.adReferral.source_id) ids.add(String(data.adReferral.source_id));
            const adSourceIds = Array.from(ids);

            // Escribir solo si hay IDs y el valor realmente cambió (evita writes innecesarios).
            const current = Array.isArray(data.adSourceIds) ? data.adSourceIds : null;
            const changed = !current
                || current.length !== adSourceIds.length
                || adSourceIds.some(id => !current.includes(id));

            if (adSourceIds.length > 0 && changed) {
                batch.update(doc.ref, { adSourceIds });
                updated++;
                ops++;
                // Firestore limita los batches a 500 operaciones; commit cada 400 por seguridad.
                if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
            }
        }

        if (ops > 0) await batch.commit();
        res.status(200).json({ success: true, message: `adSourceIds rellenado en ${updated} contactos.`, scanned: snapshot.size });
    } catch (error) {
        console.error('Error en backfill de adSourceIds:', error);
        res.status(500).json({ success: false, message: 'Error en el backfill de adSourceIds.', error: error.message });
    }
});

// --- Endpoint GET /api/snapshots/daily (Leer snapshot guardado o generar en vivo) ---
router.get('/snapshots/daily', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'Se requiere una fecha (date).' });
        }

        // Intentar leer snapshot guardado
        const snapshotDoc = await db.collection('daily_snapshots').doc(date).get();

        if (snapshotDoc.exists) {
            return res.status(200).json({
                success: true,
                source: 'snapshot',
                snapshot: snapshotDoc.data()
            });
        }

        // Fallback: generar en vivo (sin guardar)
        const liveSnapshot = await generateDailySnapshot(date);
        return res.status(200).json({
            success: true,
            source: 'live',
            snapshot: liveSnapshot
        });
    } catch (error) {
        console.error('Error fetching daily snapshot:', error);
        res.status(500).json({ success: false, message: 'Error al obtener el snapshot diario.', error: error.message });
    }
});

// --- Endpoint POST /api/snapshots/daily (Guardar snapshot inmutable) ---
router.post('/snapshots/daily', async (req, res) => {
    try {
        let { date } = req.body;
        if (!date) {
            // Por defecto: ayer
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            date = yesterday.toISOString().split('T')[0];
        }

        // Verificar si ya existe (inmutabilidad)
        const existing = await db.collection('daily_snapshots').doc(date).get();
        if (existing.exists) {
            return res.status(409).json({
                success: false,
                message: `Ya existe un snapshot para ${date}. Los snapshots son inmutables.`,
                snapshot: existing.data()
            });
        }

        // Generar y guardar
        const snapshotData = await generateDailySnapshot(date);
        snapshotData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        snapshotData.source = 'manual';

        await db.collection('daily_snapshots').doc(date).set(snapshotData);

        res.status(201).json({ success: true, message: `Snapshot guardado para ${date}.`, snapshot: snapshotData });
    } catch (error) {
        console.error('Error saving daily snapshot:', error);
        res.status(500).json({ success: false, message: 'Error al guardar el snapshot.', error: error.message });
    }
});

// --- CONSULTA CÓDIGO POSTAL (SEPOMEX LOCAL) ---
const sepomex = require('./data/sepomex/sepomexService');

router.get('/codigo-postal/:cp', async (req, res) => {
    const { cp } = req.params;
    if (!/^\d{5}$/.test(cp)) {
        return res.status(400).json({ success: false, message: 'El código postal debe tener 5 dígitos.' });
    }
    const result = sepomex.getByCp(cp);
    if (!result) {
        return res.json({ success: false, message: 'Código postal no encontrado.', colonias: [] });
    }
    res.json(result);
});

// --- BUSCAR CP POR COLONIA (SEPOMEX LOCAL) ---
router.get('/buscar-cp', async (req, res) => {
    const { estado, colonia } = req.query;
    if (!estado || !colonia || colonia.length < 3) {
        return res.json({ success: false, message: 'Escribe al menos 3 letras de tu colonia.', results: [] });
    }
    const results = sepomex.searchByColonia(estado, colonia);
    if (results.length === 0) {
        return res.json({ success: true, results: [], message: 'No se encontraron resultados.' });
    }
    res.json({ success: true, results });
});

// --- LISTA DE ESTADOS (SEPOMEX LOCAL) — para el dropdown del formulario de datos ---
router.get('/estados', (_req, res) => {
    res.json({ success: true, estados: sepomex.getEstados() });
});

// --- DATOS PARA ENVÍO ---
router.get('/datos-envio', async (req, res) => {
    try {
        const snapshot = await db.collection('datos_envio').orderBy('createdAt', 'desc').get();
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error obteniendo datos de envío:', error);
        res.status(500).json({ success: false, message: 'Error al obtener los datos.', error: error.message });
    }
});

router.delete('/datos-envio/:id', async (req, res) => {
    try {
        await db.collection('datos_envio').doc(req.params.id).delete();
        res.json({ success: true, message: 'Registro eliminado.' });
    } catch (error) {
        console.error('Error eliminando dato de envío:', error);
        res.status(500).json({ success: false, message: 'Error al eliminar.', error: error.message });
    }
});

router.post('/datos-envio', async (req, res) => {
    try {
        const { numeroPedido, nombreCompleto, telefono, direccion, numInterior, colonia, estado, ciudad, codigoPostal, referencia, entreCalles, lat, lng } = req.body;

        if (!numeroPedido || !nombreCompleto || !telefono || !direccion || !colonia || !estado || !ciudad || !codigoPostal) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
        }

        if (!/^\d{10}$/.test(telefono)) {
            return res.status(400).json({ success: false, message: 'El teléfono debe tener 10 dígitos.' });
        }

        if (!/^\d{5}$/.test(codigoPostal)) {
            return res.status(400).json({ success: false, message: 'El código postal debe tener 5 dígitos.' });
        }

        // Coordenadas del pin que el cliente verificó en el mapa (opcionales; DHL crea la guía
        // con la dirección/CP, no con el pin, pero las guardamos para poder cotejar la ubicación).
        const toCoord = (v) => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Number(v);
        const latNum = toCoord(lat), lngNum = toCoord(lng);

        await db.collection('datos_envio').add({
            numeroPedido,
            nombreCompleto,
            telefono,
            direccion,
            numInterior: numInterior || '',
            colonia,
            estado,
            ciudad,
            codigoPostal,
            entreCalles: entreCalles || '',
            referencia: referencia || '',
            lat: latNum,
            lng: lngNum,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Red de seguridad para Envíos: si el cliente ya llenó el formulario, su pedido DEBE
        // aparecer en la sección "Envíos". Esa sección solo lista pedidos con comprobanteValidadoAt,
        // que normalmente lo pone el flujo de /comprobante. Pero si el pedido llegó a pagado por
        // otra vía (p. ej. se cambió a "Pagado" a mano, sin pasar por el botón de formulario),
        // el campo queda sin poner y los datos no se ven aunque estén guardados (caso DH12942).
        // Aquí lo marcamos si falta, uniendo por consecutiveOrderNumber (dígitos de numeroPedido,
        // sin el prefijo "DH"). No romper el guardado si esto falla: los datos ya se guardaron.
        try {
            const numDigits = String(numeroPedido).replace(/\D/g, '');
            if (numDigits) {
                const pedSnap = await db.collection('pedidos')
                    .where('consecutiveOrderNumber', '==', Number(numDigits))
                    .limit(1).get();
                if (!pedSnap.empty && !pedSnap.docs[0].data().comprobanteValidadoAt) {
                    await pedSnap.docs[0].ref.update({ comprobanteValidadoAt: admin.firestore.FieldValue.serverTimestamp() });
                    console.log(`[ENVIOS] Pedido ${numeroPedido} marcado en Envíos al recibir el formulario (no tenía comprobanteValidadoAt).`);
                }
            }
        } catch (e) {
            console.warn('[ENVIOS] No se pudo marcar el pedido al recibir el formulario:', e.message);
        }

        res.status(201).json({
            success: true,
            message: 'Datos de envío guardados correctamente.',
        });
    } catch (error) {
        console.error('Error guardando datos de envío:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.', error: error.message });
    }
});

// =============================================================
// ENVÍOS: sección del CRM + formulario de datos de envío (post-venta)
// =============================================================

// Normaliza "DH1045" | "dh1045" | "1045" -> 1045 (entero) o null.
function parseOrderNumber(raw) {
    const m = String(raw || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
}

// --- GET /api/envio/pedido/:orderNumber — datos para precargar el formulario (teléfono, nombre) ---
router.get('/envio/pedido/:orderNumber', async (req, res) => {
    const num = parseOrderNumber(req.params.orderNumber);
    if (!num) return res.status(400).json({ success: false, message: 'Número de pedido inválido.' });
    try {
        const snap = await db.collection('pedidos').where('consecutiveOrderNumber', '==', num).limit(1).get();
        if (snap.empty) return res.status(404).json({ success: false, message: 'No encontramos ese número de pedido.' });
        const p = snap.docs[0].data();
        // Teléfono: preferir el campo `telefono` del pedido. Solo caer al contactId si es un
        // wa_id (WhatsApp); para Messenger/Instagram el contactId es "fb_/ig_"+PSID (NO es teléfono).
        let telRaw = (p.telefono || '').toString().replace(/\D/g, '');
        if (telRaw.length < 10) {
            const cid = (p.contactId || '').toString();
            if (cid && !/^(fb_|ig_)/i.test(cid)) telRaw = cid.replace(/\D/g, '');
        }
        const telefono = telRaw.length >= 10 ? telRaw.slice(-10) : '';
        // Nombre: preferir el del contacto de WhatsApp (más limpio que datosProducto).
        let nombreCompleto = '';
        try {
            if (p.contactId) {
                const c = await db.collection('contacts_whatsapp').doc(p.contactId).get();
                if (c.exists) nombreCompleto = c.data().name || '';
            }
        } catch (_) { /* opcional */ }
        res.json({ success: true, orderNumber: `DH${num}`, telefono, nombreCompleto });
    } catch (error) {
        console.error('[ENVIOS] Error en /envio/pedido:', error.message);
        res.status(500).json({ success: false, message: 'Error al buscar el pedido.' });
    }
});

// --- POST /api/envio/send-form/:contactId — el operador manda manualmente el formulario al cliente ---
// (respaldo por si la IA no emitió /comprobante). Marca el pedido para Envíos y envía el enlace.
router.post('/envio/send-form/:contactId', async (req, res) => {
    const { contactId } = req.params;
    try {
        const cDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
        const contactData = cDoc.exists ? cDoc.data() : {};
        // force=true: el agente pidió reenviar el formulario a propósito (aunque ya se haya
        // enviado antes). La IA no fuerza — así no reenvía el formulario en cada turno.
        const orderNumber = await markComprobanteValidadoAndSendForm(contactId, contactData, { force: true });
        if (!orderNumber) {
            return res.status(400).json({ success: false, message: 'El contacto no tiene un pedido registrado para enviarle el formulario.' });
        }
        res.json({ success: true, orderNumber });
    } catch (error) {
        console.error('[ENVIOS] Error en send-form:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Error al enviar el formulario.' });
    }
});

// --- GET /api/envios — pedidos con comprobante validado (para la sección Envíos del CRM) ---
// Devuelve por pedido: número, monto pagado (precio) y datos de envío (si el cliente ya llenó el
// formulario; se unen por numeroPedido con la colección datos_envio).
router.get('/envios', async (_req, res) => {
    try {
        const [pedidosSnap, datosSnap, manualSnap] = await Promise.all([
            db.collection('pedidos').orderBy('comprobanteValidadoAt', 'desc').limit(300).get(),
            db.collection('datos_envio').get(),
            db.collection('envios_manuales').orderBy('createdAt', 'desc').limit(300).get(),
        ]);

        // Mapa numeroPedido (solo dígitos) -> datos de envío MÁS RECIENTES.
        const norm = (v) => String(v || '').replace(/\D/g, '');
        // Serializa la guía DHL guardada en el doc (sin el serverTimestamp) para el frontend.
        const serGuia = (g) => (g && g.guia) ? { proveedor: g.proveedor || 't1', guia: g.guia, numOrden: g.numOrden || null, mensajeria: g.mensajeria || null, tipoServicio: g.tipoServicio || null, costo: (g.costo != null ? g.costo : null), pdfPath: g.pdfPath || null, labelUrl: g.labelUrl || null, tracking: g.tracking || null, manual: g.manual === true } : null;
        const datosByOrder = new Map();
        datosSnap.docs.forEach(d => {
            const dd = d.data();
            const key = norm(dd.numeroPedido);
            if (!key) return;
            const prev = datosByOrder.get(key);
            const prevMs = prev && prev.createdAt && prev.createdAt.toMillis ? prev.createdAt.toMillis() : -1;
            const curMs = dd.createdAt && dd.createdAt.toMillis ? dd.createdAt.toMillis() : 0;
            if (!prev || curMs >= prevMs) datosByOrder.set(key, dd);
        });

        const pedidosByNum = new Map(); // nº de pedido (dígitos) -> { id, estatus } para enlazar líneas manuales a su pedido
        const envios = pedidosSnap.docs.map(doc => {
            const p = doc.data();
            const num = p.consecutiveOrderNumber != null ? p.consecutiveOrderNumber : null;
            if (num != null) pedidosByNum.set(String(num), { id: doc.id, estatus: p.estatus || null });
            if (p.ocultoDeEnvios) return null; // el operador lo quitó de Envíos (el pedido sigue intacto)
            const orderNumber = num != null ? `DH${num}` : (p.numeroPedido || doc.id);
            const de = datosByOrder.get(norm(num));
            // Datos de envío desglosados (cada campo va en su propia columna en el CRM).
            const datos = de ? {
                nombre: de.nombreCompleto || '',
                direccion: de.direccion || '',        // cruda (calle + nº ext); la "Int." se fusiona solo al mostrar
                numInterior: de.numInterior || '',
                colonia: de.colonia || '',
                entreCalles: de.entreCalles || '',
                referencia: de.referencia || '',
                ciudad: de.ciudad || '',
                estado: de.estado || '',
                codigoPostal: de.codigoPostal || '',
                telefono: de.telefono || '',
                lat: (de.lat != null ? de.lat : null),
                lng: (de.lng != null ? de.lng : null),
            } : null;
            return {
                id: doc.id,
                orderNumber,
                montoPagado: (p.precio != null ? p.precio : null),
                estatus: p.estatus || null,
                comentarioInterno: p.comentarioInterno || '', // nota interna del operador (NO sale en la guía)
                comprobanteValidadoAt: p.comprobanteValidadoAt && p.comprobanteValidadoAt.toDate ? p.comprobanteValidadoAt.toDate().toISOString() : null,
                datos,               // objeto con cada campo, o null si el cliente aún no llena el formulario
                tieneDatos: !!de,
                manualId: null,      // no es una línea manual
                contactId: p.contactId || null, // para abrir la conversación en Chats
                orderDocId: doc.id,  // id del pedido para cambiar su estatus
                guiaEnvio: serGuia(p.guiaEnvio),
            };
        }).filter(Boolean);

        // Líneas agregadas manualmente por el operador (colección envios_manuales).
        const manuales = manualSnap.docs.map(doc => {
            const m = doc.data();
            const campos = [m.nombre, m.direccion, m.colonia, m.entreCalles, m.referencia, m.ciudad, m.estado, m.codigoPostal, m.telefono];
            const tieneDatos = campos.some(v => (v || '').toString().trim());
            const datos = tieneDatos ? {
                nombre: m.nombre || '', direccion: m.direccion || '', numInterior: m.numInterior || '', colonia: m.colonia || '',
                entreCalles: m.entreCalles || '', referencia: m.referencia || '', ciudad: m.ciudad || '',
                estado: m.estado || '', codigoPostal: m.codigoPostal || '', telefono: m.telefono || '',
            } : null;
            return {
                id: doc.id,
                orderNumber: m.orderNumber || doc.id,
                montoPagado: (m.montoPagado != null && m.montoPagado !== '' ? Number(m.montoPagado) : null),
                estatus: null,
                comentarioInterno: m.comentarioInterno || '', // nota interna del operador (NO sale en la guía)
                comprobanteValidadoAt: m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().toISOString() : null,
                datos,
                tieneDatos,
                manualId: doc.id,    // permite borrarla desde el CRM
                guiaEnvio: serGuia(m.guiaEnvio),
            };
        });

        // Enlazar cada línea manual a su pedido real (por número) para mostrar/editar su estatus.
        const missingNums = [...new Set(manuales.map(m => norm(m.orderNumber)).filter(n => n && !pedidosByNum.has(n)))];
        for (let i = 0; i < missingNums.length; i += 10) {
            const chunk = missingNums.slice(i, i + 10).map(Number).filter(n => !Number.isNaN(n));
            if (!chunk.length) continue;
            try {
                const snap = await db.collection('pedidos').where('consecutiveOrderNumber', 'in', chunk).get();
                snap.docs.forEach(d => { const dd = d.data(); if (dd.consecutiveOrderNumber != null) pedidosByNum.set(String(dd.consecutiveOrderNumber), { id: d.id, estatus: dd.estatus || null }); });
            } catch (e) { console.warn('[ENVIOS] resolver manual->pedido:', e.message); }
        }
        manuales.forEach(m => {
            const ped = pedidosByNum.get(norm(m.orderNumber));
            if (ped) { m.orderDocId = ped.id; m.estatus = ped.estatus; }
        });

        // Manuales primero (recién agregadas), luego los pedidos con comprobante validado.
        res.json({ success: true, envios: [...manuales, ...envios] });
    } catch (error) {
        console.error('[ENVIOS] Error en GET /envios:', error.message);
        res.status(500).json({ success: false, message: 'Error al cargar los envíos.', error: error.message });
    }
});

// --- POST /api/envios/comentario — guarda una NOTA INTERNA en la línea (pedido o manual). NO sale en la guía. ---
router.post('/envios/comentario', async (req, res) => {
    try {
        const b = req.body || {};
        const comentario = String(b.comentario || '').slice(0, 1000);
        const col = b.manualId ? 'envios_manuales' : 'pedidos';
        const docId = b.manualId || b.docId;
        if (!docId) return res.status(400).json({ success: false, message: 'docId o manualId requerido.' });
        await db.collection(col).doc(docId).set({ comentarioInterno: comentario }, { merge: true });
        res.json({ success: true });
    } catch (e) {
        console.error('[ENVIOS] comentario:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- POST /api/envios/manual — agregar una línea manual (solo el número de pedido es obligatorio) ---
router.post('/envios/manual', async (req, res) => {
    try {
        const b = req.body || {};
        let orderNumber = String(b.orderNumber || '').trim();
        if (!orderNumber) return res.status(400).json({ success: false, message: 'El número de pedido es obligatorio.' });
        if (/^\d+$/.test(orderNumber)) orderNumber = 'DH' + orderNumber; // "12345" -> "DH12345"

        const str = (v) => (v == null ? '' : String(v).trim());
        const montoRaw = str(b.montoPagado).replace(/[^\d.]/g, '');
        const doc = {
            orderNumber,
            montoPagado: montoRaw ? Number(montoRaw) : null,
            nombre: str(b.nombre),
            direccion: str(b.direccion),
            colonia: str(b.colonia),
            entreCalles: str(b.entreCalles),
            referencia: str(b.referencia),
            ciudad: str(b.ciudad),
            estado: str(b.estado),
            codigoPostal: str(b.codigoPostal),
            telefono: str(b.telefono),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'manual',
        };
        const ref = await db.collection('envios_manuales').add(doc);
        res.status(201).json({ success: true, id: ref.id, orderNumber });
    } catch (error) {
        console.error('[ENVIOS] Error en POST /envios/manual:', error.message);
        res.status(500).json({ success: false, message: 'Error al agregar la línea.' });
    }
});

// --- DELETE /api/envios/manual/:id — borrar una línea manual ---
router.delete('/envios/manual/:id', async (req, res) => {
    try {
        await db.collection('envios_manuales').doc(req.params.id).delete();
        res.json({ success: true });
    } catch (error) {
        console.error('[ENVIOS] Error en DELETE /envios/manual:', error.message);
        res.status(500).json({ success: false, message: 'Error al borrar la línea.' });
    }
});

// --- PUT /api/envios/manual/:id — editar una línea manual ---
router.put('/envios/manual/:id', async (req, res) => {
    try {
        const b = req.body || {};
        const str = (v) => (v == null ? '' : String(v).trim());
        const montoRaw = str(b.montoPagado).replace(/[^\d.]/g, '');
        const upd = {
            montoPagado: montoRaw ? Number(montoRaw) : null,
            nombre: str(b.nombre || b.nombreCompleto),
            direccion: str(b.direccion),
            numInterior: str(b.numInterior),
            colonia: str(b.colonia),
            entreCalles: str(b.entreCalles),
            referencia: str(b.referencia),
            ciudad: str(b.ciudad),
            estado: str(b.estado),
            codigoPostal: str(b.codigoPostal),
            telefono: str(b.telefono).replace(/\D/g, ''),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await db.collection('envios_manuales').doc(req.params.id).update(upd);
        res.json({ success: true });
    } catch (error) {
        console.error('[ENVIOS] Error en PUT /envios/manual:', error.message);
        res.status(500).json({ success: false, message: 'Error al editar la línea.' });
    }
});

// --- PUT /api/envios/datos/:orderNumber — editar (o crear) los datos de envío de un pedido ---
// Sirve para corregir una fila ya llena, o para capturar a mano un pedido aún pendiente.
// Actualiza el datos_envio MÁS RECIENTE del pedido; si no existe, crea uno nuevo.
router.put('/envios/datos/:orderNumber', async (req, res) => {
    try {
        const num = parseOrderNumber(req.params.orderNumber);
        if (!num) return res.status(400).json({ success: false, message: 'Número de pedido inválido.' });
        const b = req.body || {};
        const str = (v) => (v == null ? '' : String(v)).trim();
        const toCoord = (v) => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Number(v);
        const fields = {
            nombreCompleto: str(b.nombreCompleto || b.nombre),
            telefono: str(b.telefono).replace(/\D/g, ''),
            direccion: str(b.direccion),
            numInterior: str(b.numInterior),
            colonia: str(b.colonia),
            entreCalles: str(b.entreCalles),
            referencia: str(b.referencia),
            ciudad: str(b.ciudad),
            estado: str(b.estado),
            codigoPostal: str(b.codigoPostal).replace(/\D/g, ''),
        };
        if (b.lat !== undefined) fields.lat = toCoord(b.lat);
        if (b.lng !== undefined) fields.lng = toCoord(b.lng);

        const orderTag = 'DH' + num;
        const snap = await db.collection('datos_envio').where('numeroPedido', '==', orderTag).get();
        if (!snap.empty) {
            // Elegir el doc más reciente (sin índice compuesto: se ordena en memoria).
            let target = snap.docs[0], bestMs = -1;
            snap.docs.forEach(doc => {
                const ca = doc.data().createdAt;
                const ms = ca && ca.toMillis ? ca.toMillis() : 0;
                if (ms >= bestMs) { bestMs = ms; target = doc; }
            });
            fields.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            await target.ref.update(fields);
            return res.json({ success: true, updated: true });
        }
        // No había datos: crear uno (permite capturar a mano un pedido pendiente).
        fields.numeroPedido = orderTag;
        fields.createdAt = admin.firestore.FieldValue.serverTimestamp();
        fields.source = 'crm-edit';
        await db.collection('datos_envio').add(fields);
        res.json({ success: true, created: true });
    } catch (error) {
        console.error('[ENVIOS] Error en PUT /envios/datos:', error.message);
        res.status(500).json({ success: false, message: 'Error al guardar los datos de envío.' });
    }
});

// --- POST /api/envios/ocultar — quita un PEDIDO de la tabla de Envíos (no lo borra; flag ocultoDeEnvios). ---
router.post('/envios/ocultar', async (req, res) => {
    try {
        const docId = String((req.body && req.body.docId) || '').trim();
        if (!docId) return res.status(400).json({ success: false, message: 'Falta docId.' });
        const ref = db.collection('pedidos').doc(docId);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: 'El pedido no existe.' });
        await ref.set({ ocultoDeEnvios: true }, { merge: true });
        res.json({ success: true });
    } catch (error) {
        console.error('[ENVIOS] Error en POST /envios/ocultar:', error.message);
        res.status(500).json({ success: false, message: 'No se pudo ocultar el pedido.' });
    }
});

// ============================ Guías DHL vía T1 Envíos ============================
// Cliente de T1 (auth Keycloak + cotizar/crearGuia). Ver server/t1/t1Client.js.
const t1 = require('./t1/t1Client');

// Mapea el objeto de datos de envío del CRM (display) al datos_destino que pide T1.
function _mapDestinoT1(datos = {}) {
    const nombreCompleto = String(datos.nombre || '').trim();
    const sp = nombreCompleto.split(/\s+/).filter(Boolean);
    const nombre = sp.shift() || nombreCompleto || 'Cliente';
    const apellidos = sp.join(' ') || '.';
    const calleFull = String(datos.direccion || '').trim();
    const numMatch = calleFull.match(/(\d+[A-Za-z]?)\s*$/);
    // `direccion` es la calle + nº exterior; el nº interior + entre calles + referencia se combinan aquí.
    // OJO: T1 limita datos_destino.referencias a 35 caracteres (lo corta ANTES de mandarlo a DHL/Estafeta),
    // por eso las referencias largas "salían mochas" en la guía. Orden por prioridad —nº interior (corto y
    // clave), luego la referencia del cliente, luego entre calles— y recorte a 35 para que lo impreso en la
    // guía coincida con lo que el cliente escribió en el formulario.
    const referencias = [datos.numInterior ? ('Int. ' + datos.numInterior) : '', datos.referencia, datos.entreCalles].filter(Boolean).join(' · ').slice(0, 35);
    return {
        codigo_postal: String(datos.codigoPostal || '').replace(/\D/g, ''),
        nombre, apellidos,
        email: datos.email || process.env.T1_DEST_EMAIL || 'dekoorhouse.work@gmail.com', // T1 exige email de destinatario; el formulario no lo pide -> respaldo
        calle: (numMatch ? calleFull.slice(0, numMatch.index).trim() : calleFull) || 'Domicilio', // sin el nº exterior (va en `numero`) para no duplicarlo
        numero: numMatch ? numMatch[1] : 'SN',
        colonia: datos.colonia || '',
        telefono: String(datos.telefono || '').replace(/\D/g, ''),
        estado: datos.estado || '',
        municipio: datos.ciudad || '',
        referencias,
    };
}

// Cotiza un C.P. destino en TODAS las paqueterías (T1: DHL/FedEx + Envíos Perros: Estafeta…) y
// devuelve la lista de servicios ordenada por costo (más barato primero). Reusable: individual y en lote.
async function _cotizarCP(dest, opts = {}) {
    const servicios = [];
    try {
        const q = await t1.cotizar({ cpDestino: dest, peso: opts.peso, largo: opts.largo, ancho: opts.ancho, alto: opts.alto, valorPaquete: opts.valorPaquete });
        (Array.isArray(q.result) ? q.result : []).forEach((r) => {
            const svc = (r.cotizacion && r.cotizacion.servicios) || {};
            Object.keys(svc).forEach((k) => {
                const s = svc[k] || {};
                servicios.push({ proveedor: 't1', paqueteria: r.clave, clave: k, servicio: s.servicio, tipo_servicio: s.tipo_servicio, codigoServicio: s.servicio, costo: s.costo_total, dias: s.dias_entrega, moneda: s.moneda || 'MXN' });
            });
        });
    } catch (e) { console.warn('[COTIZAR] T1 falló:', (e.response && e.response.status) || '', e.message); }
    try {
        const epData = await ep.cotizar({ cpDestino: dest, peso: opts.peso, largo: opts.largo, ancho: opts.ancho, alto: opts.alto });
        ep.normalizarRates(epData).forEach((r) => {
            servicios.push({ proveedor: 'ep', paqueteria: r.paqueteria, clave: r.deliveryType, servicio: r.servicio, tipo_servicio: r.tipo_servicio, codigoServicio: r.deliveryType, costo: r.costo, dias: r.dias, moneda: r.moneda });
        });
    } catch (e) { console.warn('[COTIZAR] Envíos Perros falló:', (e.response && e.response.status) || '', e.message); }
    servicios.sort((a, b2) => (a.costo || 0) - (b2.costo || 0));
    return servicios;
}

// --- POST /api/envios/cotizar — cotiza DHL (y demás) para un CP destino. GRATIS. ---
router.post('/envios/cotizar', async (req, res) => {
    try {
        const b = req.body || {};
        const dest = String(b.cp || '').replace(/\D/g, '');
        if (!/^\d{5}$/.test(dest)) return res.status(400).json({ success: false, message: 'C.P. destino inválido (5 dígitos).' });
        const servicios = await _cotizarCP(dest, { peso: b.peso, largo: b.largo, ancho: b.ancho, alto: b.alto, valorPaquete: b.valorPaquete });
        res.json({ success: true, cp: dest, servicios });
    } catch (e) {
        console.error('[COTIZAR]', e.message);
        res.status(502).json({ success: false, message: 'No se pudo cotizar.', detail: e.message });
    }
});

// --- POST /api/envios/cotizar-batch — cotiza VARIOS pedidos en PARALELO (para el flujo de lote). ---
router.post('/envios/cotizar-batch', async (req, res) => {
    try {
        const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 80) : [];
        if (!items.length) return res.status(400).json({ success: false, message: 'Sin pedidos para cotizar.' });
        const results = new Array(items.length);
        let idx = 0;
        const worker = async () => {
            while (idx < items.length) {
                const i = idx++;
                const it = items[i] || {};
                const base = { orderNumber: it.orderNumber, docId: it.docId || null, manualId: it.manualId || null };
                const cp = String(it.cp || '').replace(/\D/g, '');
                if (!/^\d{5}$/.test(cp)) { results[i] = { ...base, cp, error: 'C.P. inválido' }; continue; }
                try { results[i] = { ...base, cp, servicios: await _cotizarCP(cp) }; }
                catch (e) { results[i] = { ...base, cp, error: e.message }; }
            }
        };
        await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker)); // tope de concurrencia 6
        res.json({ success: true, results });
    } catch (e) {
        console.error('[COTIZAR-BATCH]', e.message);
        res.status(502).json({ success: false, message: 'No se pudo cotizar el lote.', detail: e.message });
    }
});

// --- POST /api/envios/crear-guia — crea la guía DHL (DESCUENTA SALDO). Guarda PDF + guía en el pedido. ---
router.post('/envios/crear-guia', async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.datos || !b.datos.codigoPostal) return res.status(400).json({ success: false, message: 'Faltan datos de envío (C.P.).' });
        const destino = _mapDestinoT1(b.datos);
        if (!/^\d{5}$/.test(destino.codigo_postal)) return res.status(400).json({ success: false, message: 'C.P. destino inválido.' });

        // Localizar el doc destino y checar IDEMPOTENCIA (evita doble cobro por doble clic / reintento).
        const col = b.manualId ? 'envios_manuales' : 'pedidos';
        const docId = b.manualId || b.docId || null;
        let docRef = null;
        let contactIdNotif = b.contactId || null; // para avisar al cliente por WhatsApp al crear la guía
        if (docId) {
            docRef = db.collection(col).doc(docId);
            const snap = await docRef.get();
            if (!snap.exists) return res.status(404).json({ success: false, message: 'El pedido o la línea no existe.' });
            const dd = snap.data() || {};
            // Preferir el id de contacto WhatsApp; si el pedido/línea no lo tiene, caer al teléfono
            // (convención del CRM: contactId || telefono es el id del doc de contacto).
            contactIdNotif = dd.contactId || dd.telefono || contactIdNotif;
            const ex = dd.guiaEnvio;
            if (ex && ex.guia) {
                return res.json({ success: true, already: true, guia: ex.guia, numOrden: ex.numOrden || null, pickUp: ex.pickUp || null, pdfPath: ex.pdfPath || null, tracking: ex.tracking || null });
            }
        }

        // Crear la guía en el proveedor elegido (DESCUENTA SALDO). proveedor: 't1' (DHL/FedEx) | 'ep' (Envíos Perros).
        const proveedor = b.proveedor === 'ep' ? 'ep' : 't1';
        let guia = null, numOrden = null, pickUp = null, pdfBase64 = null, tracking = null, labelUrl = null, mensajeria = b.mensajeria || null;
        if (proveedor === 'ep') {
            const data = await ep.crearGuia({ destino, deliveryType: b.tipoServicio });
            const info = ep.extractGuia(data);
            if (!info.guia) {
                return res.status(502).json({ success: false, message: 'Envíos Perros no devolvió número de guía.', detail: data });
            }
            guia = info.guia; numOrden = info.orderId || null; labelUrl = info.label || null;
            mensajeria = b.mensajeria || 'ENVIOSPERROS'; // rastreo: por número de guía en el sitio de la paquetería
        } else {
            const r = await t1.crearGuia({ destino, pedido: b.orderNumber, tipoServicio: b.tipoServicio, mensajeria: b.mensajeria });
            const det = r && r.detail;
            if (!r || r.success === false || !det || !det.guia) {
                return res.status(502).json({ success: false, message: (r && r.message) || 'T1 no devolvió número de guía.', detail: r });
            }
            guia = det.guia; numOrden = det.num_orden || null; pickUp = det.pick_up || null; pdfBase64 = det.file || null;
            tracking = `https://www.dhl.com/mx-es/home/rastreo.html?tracking-id=${encodeURIComponent(det.guia)}`;
            mensajeria = b.mensajeria || t1._config.T1_MENSAJERIA;
        }

        // Guardar el PDF de la etiqueta en el bucket (T1 lo trae en base64). Best-effort; la guía es lo prioritario.
        let pdfPath = null;
        try {
            if (pdfBase64) {
                const buf = Buffer.from(pdfBase64, 'base64');
                pdfPath = `etiquetas/${String(b.orderNumber || 'guia').replace(/[^\w-]/g, '')}-${guia}.pdf`;
                await bucket.file(pdfPath).save(buf, { contentType: 'application/pdf', resumable: false });
            }
        } catch (e2) { pdfPath = null; console.warn('[GUIA] No se pudo guardar el PDF de la etiqueta:', e2.message); }

        const guiaEnvio = {
            proveedor, guia, numOrden, pickUp,
            mensajeria, tipoServicio: b.tipoServicio || null,
            costo: (b.costo != null ? Number(b.costo) : null),
            pdfPath, labelUrl: labelUrl || null, tracking: tracking || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Persistir la guía. CRÍTICO: si falla, la guía YA se creó/cobró -> devolverla igual para no perderla.
        if (docRef) {
            try {
                await docRef.set({ guiaEnvio }, { merge: true });
            } catch (e3) {
                console.error('[GUIA] CRÍTICO: guía creada/cobrada pero NO persistida:', guia, e3.message);
                return res.status(500).json({ success: false, persistError: true, guia, numOrden, tracking, pdfPath, labelUrl, message: 'La guía se creó y cobró, pero no se pudo guardar en el CRM. Anota el número de guía.' });
            }
        }

        // Avisar al cliente por WhatsApp (fire-and-forget: no bloquea la respuesta ni afecta la guía ya creada).
        // Se OMITE si el operador marcó "no avisar" (skipNotify) — p.ej. porque alguien del equipo ya le
        // mandó el mensaje a mano y no queremos duplicarlo.
        if (contactIdNotif && !b.skipNotify) {
            notifyGuiaToCustomer(contactIdNotif, guia).catch(e => console.warn('[GUIA] notifyGuiaToCustomer falló:', e.message));
        }

        res.json({ success: true, proveedor, guia, numOrden, pickUp, pdfPath, labelUrl: labelUrl || null, tracking: tracking || null });
    } catch (e) {
        const t1body = (e.response && e.response.data) || null;
        const t1msg = String((t1body && t1body.message) || e.message || '');
        console.error('[GUIA] crear-guia:', e.response && e.response.status, t1body ? JSON.stringify(t1body) : e.message);
        // DHL (vía T1) rechaza direcciones que no cuadran con su catálogo (típico: la colonia no coincide con el C.P.).
        // T1 NO detalla el problema ("Multiple problems found, see Additional Details" sin los detalles) -> guiamos al operador.
        if (/multiple problems|additional details|colonia|c[oó]?digo postal|\bzip\b|catal/i.test(t1msg)) {
            return res.status(502).json({ success: false, message: 'DHL no aceptó esta dirección (su catálogo es estricto; casi siempre la colonia no coincide con el C.P.). Elige la opción de Estafeta en el modal para este pedido, o corrige el C.P./colonia.', detail: t1body || e.message });
        }
        res.status(502).json({ success: false, message: 'No se pudo crear la guía.', detail: t1body || e.message });
    }
});

// --- POST /api/envios/attach-guia — registra una guía hecha MANUALMENTE (en T1/panel) en el pedido.
//     NO cobra, NO genera guía, NO notifica al cliente. Solo marca el pedido como "Con guía" para no re-generarla. ---
router.post('/envios/attach-guia', async (req, res) => {
    try {
        const b = req.body || {};
        const col = b.manualId ? 'envios_manuales' : 'pedidos';
        const docId = b.manualId || b.docId;
        const guia = String(b.guia || '').trim();
        if (!docId || !guia) return res.status(400).json({ success: false, message: 'docId/manualId y guia son requeridos' });
        const docRef = db.collection(col).doc(docId);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: 'El pedido o la línea no existe.' });
        const dd = snap.data() || {};
        const existingGuia = (dd.guiaEnvio || {}).guia;
        const existingManual = (dd.guiaEnvio || {}).manual === true;
        // Idempotente: si ya hay guía no la sobreescribas... salvo que se pida overwrite Y la existente sea MANUAL
        // (para corregir un número mal tecleado; nunca clobbereamos una guía creada por API que ya tiene etiqueta/pdf).
        if (existingGuia && !(b.overwrite && existingManual)) {
            return res.json({ success: true, already: true, guia: existingGuia });
        }
        const proveedor = b.proveedor === 'ep' ? 'ep' : 't1';
        const mensajeria = b.mensajeria || 'DHL';
        // Link de rastreo según paquetería (para el botón "📍 Rastrear" de la tabla).
        const gEnc = encodeURIComponent(guia);
        let tracking = null;
        if (proveedor !== 'ep') {
            tracking = /fedex/i.test(mensajeria)
                ? `https://www.fedex.com/fedextrack/?trknbr=${gEnc}`
                : `https://www.dhl.com/mx-es/home/rastreo.html?tracking-id=${gEnc}`;
        }
        const guiaEnvio = {
            proveedor, guia, mensajeria,
            tipoServicio: b.tipoServicio || null,
            costo: (b.costo != null ? Number(b.costo) : null),
            manual: true,
            tracking,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await docRef.set({ guiaEnvio }, { merge: true });
        res.json({ success: true, guia, docId });
    } catch (e) {
        console.error('[GUIA] attach-guia:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- GET /api/debug/pedidos-info?key=...&nums=DH1,DH2 — nombre/contacto de pedidos (TEMPORAL). ---
router.get('/debug/pedidos-info', async (req, res) => {
    if (req.query.key !== 't1diag_9f3k2xQ7') return res.status(403).json({ success: false, message: 'forbidden' });
    const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.status(400).json({ success: false, message: 'ids (docId) requerido' });
    try {
        const out = [];
        for (const id of ids) {
            const doc = await db.collection('pedidos').doc(id).get();
            if (!doc.exists) { out.push({ id, found: false }); continue; }
            const dd = doc.data();
            let contactName = null;
            const cid = dd.contactId || dd.telefono;
            if (cid) {
                try {
                    const c = await db.collection('contacts_whatsapp').doc(String(cid)).get();
                    if (c.exists) { const cData = c.data(); contactName = cData.name || cData.profileName || cData.pushName || null; }
                } catch (e) {}
            }
            out.push({
                id, num: dd.consecutiveOrderNumber || dd.orderNumber || null,
                nombre: dd.nombre || dd.nombreCliente || dd.cliente || dd.contactName || (dd.datos || {}).nombre || null,
                contactName, contactId: dd.contactId || null, telefono: dd.telefono || null,
                campos: Object.keys(dd).filter(k => /nom|clien|contact|name/i.test(k)),
            });
        }
        res.json({ success: true, pedidos: out });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// --- GET /api/debug/guia-notif — DIAGNÓSTICO del aviso de guía al cliente (TEMPORAL). ---
// dry-run por defecto (NO envía nada, solo reporta ventana 24h + existencia de /dgui y /rastreo).
// ?send=1 ejecuta el envío REAL (manda WhatsApp al cliente). Gated por key.
router.get('/debug/guia-notif', async (req, res) => {
    if (req.query.key !== 't1diag_9f3k2xQ7') return res.status(403).json({ success: false, message: 'forbidden' });
    const contactId = String(req.query.contactId || '').trim();
    const guia = String(req.query.guia || '').trim();
    const send = req.query.send === '1';
    if (!contactId || !guia) return res.status(400).json({ success: false, message: 'contactId y guia son requeridos' });
    try {
        const r = await notifyGuiaToCustomer(contactId, guia, { dryRun: !send });
        res.json({ success: true, mode: send ? 'SEND' : 'DRY', contactId, guia, ...r });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- GET /api/debug/qr — leer una respuesta rápida por shortcut (TEMPORAL). ---
router.get('/debug/qr', async (req, res) => {
    if (req.query.key !== 't1diag_9f3k2xQ7') return res.status(403).json({ success: false, message: 'forbidden' });
    const shortcut = String(req.query.shortcut || '').replace(/^\/+/, '').trim();
    if (!shortcut) return res.status(400).json({ success: false, message: 'shortcut requerido' });
    try {
        const snap = await db.collection('quick_replies').where('shortcut', '==', shortcut).limit(1).get();
        if (snap.empty) return res.json({ success: true, found: false, shortcut });
        const doc = snap.docs[0];
        const d = doc.data();
        res.json({ success: true, found: true, id: doc.id, shortcut: d.shortcut, message: d.message || '', fileUrl: d.fileUrl || null, fileType: d.fileType || null });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// --- GET /api/rastreo/:guia — rastreo PÚBLICO amigable de una guía (para la página del cliente). ---
router.get('/rastreo/:guia', async (req, res) => {
    try {
        const guia = String(req.params.guia || '').replace(/[^\w-]/g, '');
        if (!guia) return res.status(400).json({ success: false, message: 'Falta el número de guía.' });
        // 1) Ubicar la guía (pedidos / envios_manuales) para saber la PAQUETERÍA y el link OFICIAL de rastreo.
        let mensajeria = null, officialUrl = null;
        try {
            let snap = await db.collection('pedidos').where('guiaEnvio.guia', '==', guia).limit(1).get();
            if (snap.empty) snap = await db.collection('envios_manuales').where('guiaEnvio.guia', '==', guia).limit(1).get();
            if (!snap.empty) { const ge = snap.docs[0].data().guiaEnvio || {}; mensajeria = ge.mensajeria || null; officialUrl = ge.tracking || null; }
        } catch (e) { /* la query por campo anidado puede fallar; seguimos con defaults DHL */ }
        const isEP = /perros|estafeta/i.test(String(mensajeria || ''));
        const courier = isEP ? 'Estafeta' : 'DHL';
        if (!officialUrl) {
            officialUrl = isEP
                ? `https://rastreo.estafeta.com/RastreoWebInternet/consultaEnvio.do?dispatchAction=busqueda&idERROR=&noGuias=${encodeURIComponent(guia)}`
                : `https://www.dhl.com/mx-es/home/rastreo.html?tracking-id=${encodeURIComponent(guia)}`;
        }
        // 2a) API OFICIAL de DHL (si hay DHL_API_KEY y es guía DHL): estatus real con historial.
        if (!isEP && process.env.DHL_API_KEY) {
            try {
                const dhlTrack = require('./dhl/dhlTracking');
                const dt = await dhlTrack.getTracking(guia);
                if (dt && dt.fase) {
                    const code = dt.entregado ? 'entregado'
                        : (/reparto|camino|ciudad/i.test(dt.fase) ? 'en_camino' : 'recolectado');
                    return res.json({ success: true, guia, found: true, estado: dt.descripcion || dt.fase, ubicacion: dt.ubicacion || null,
                        fecha: dt.fecha || null, entregado: !!dt.entregado, fase: code, courier, officialUrl });
                }
            } catch (e) { console.warn('[RASTREO] DHL API falló, sigo con fallback:', e.message); }
        }
        // 2b) Intentar el rastreo de T1 (por si algún día trae datos). NO dependemos de él (hoy viene vacío/403);
        //     el estado real vive con la paquetería (DHL bloquea scraping -> API oficial arriba).
        let d = {};
        try { const data = await t1.rastrear(guia); d = (data && data.detail) || {}; } catch (e) { d = {}; }
        const desc = String(d.descripcion || '').trim();
        if (!desc) {
            return res.json({ success: true, guia, found: false, courier, officialUrl, message: `El estado en tiempo real lo tiene ${courier}. Consúltalo con el botón de aquí abajo. Si acabas de recibir tu guía, puede tardar unas horas en aparecer.` });
        }
        const dl = desc.toLowerCase();
        const entregado = /entreg/.test(dl);
        const enCamino = /tr[aá]nsito|camino|ruta|reparto|distribuci|salida/.test(dl);
        const recolectado = /recolec|recogid|recibid|acopio/.test(dl);
        const fase = entregado ? 'entregado' : (enCamino ? 'en_camino' : (recolectado ? 'recolectado' : 'procesando'));
        return res.json({ success: true, guia, found: true, estado: desc, codigo: d.codigo || null, fecha: d.fecha || null, recibe: d.recibe || null, entregado, fase, courier, officialUrl });
    } catch (e) {
        console.error('[RASTREO]', e.message);
        res.status(502).json({ success: false, message: 'No se pudo consultar el rastreo en este momento. Intenta más tarde.' });
    }
});

// --- GET /api/envios/etiqueta?path=etiquetas/... — sirve el PDF de la etiqueta desde el bucket. ---
router.get('/envios/etiqueta', async (req, res) => {
    try {
        const p = String(req.query.path || '');
        if (!/^etiquetas\/[\w\-]+\.pdf$/.test(p)) return res.status(400).send('Ruta inválida.');
        const file = bucket.file(p);
        const [exists] = await file.exists();
        if (!exists) return res.status(404).send('Etiqueta no encontrada.');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${p.split('/').pop()}"`);
        file.createReadStream().on('error', () => res.status(500).end()).pipe(res);
    } catch (e) {
        console.error('[T1] etiqueta:', e.message);
        res.status(500).send('Error al obtener la etiqueta.');
    }
});

// --- GET /api/estafeta/frecuencia/:cp — chequeo de cobertura del CP destino desde 34188 ---
// Lógica compartida con la IA en server/estafeta/estafetaFrecuencia.js.
const { checkFrecuencia: checkEstafetaFrecuencia } = require('./estafeta/estafetaFrecuencia');
router.get('/estafeta/frecuencia/:cp', async (req, res) => {
    const cp = String(req.params.cp || '').replace(/\D/g, '');
    if (!/^\d{5}$/.test(cp)) {
        return res.status(400).json({ success: false, message: 'El código postal debe tener 5 dígitos.' });
    }
    const r = await checkEstafetaFrecuencia(cp);
    if (r === null) {
        return res.status(502).json({ success: false, message: 'No se pudo consultar Estafeta en este momento.' });
    }
    res.json({ success: true, ...r });
});

// --- GET /api/debug/t1-test — prueba de conexión con T1 Envíos (auth + saldo + cotización) ---
// TEMPORAL / diagnóstico. Protegido con ?key=. NO expone token/credenciales y NO crea guías.
const t1Client = require('./t1/t1Client');
router.get('/debug/t1-test', async (req, res) => {
    if ((req.query.key || '') !== 't1diag_9f3k2xQ7') return res.status(403).json({ error: 'forbidden' });
    const cp = String(req.query.cp || '06700').replace(/\D/g, '') || '06700';
    const out = { config: t1Client._config };
    // 1) Token
    try {
        const token = await t1Client.getToken();
        out.token_ok = !!token;
        out.token_len = token ? token.length : 0;
        // Decodificar claims del JWT (a nombre de qué cuenta está el token) — diagnóstico.
        try {
            const payload = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
            const picked = {};
            ['preferred_username', 'email', 'name', 'given_name', 'family_name', 'sub', 'azp'].forEach((k) => { if (payload[k] != null) picked[k] = payload[k]; });
            Object.keys(payload).forEach((k) => { if (/comerci|shop|store|tienda/i.test(k)) picked[k] = payload[k]; });
            out.token_claims = picked;
        } catch (e2) { out.token_claims_error = e2.message; }
    } catch (e) {
        out.token_ok = false;
        out.token_error = e.response ? { status: e.response.status, data: e.response.data } : e.message;
        return res.status(200).json(out);
    }
    // 2) Saldo
    try {
        out.saldo = await t1Client.consultarSaldo();
    } catch (e) {
        out.saldo_error = e.response ? { status: e.response.status, data: e.response.data } : e.message;
    }
    // 3) Cotización (descubre tipo_servicio DHL + costo)
    try {
        const q = await t1Client.cotizar({ cpDestino: cp, valorPaquete: 750 });
        const result = Array.isArray(q.result) ? q.result : (Array.isArray(q.data) ? q.data : []);
        const servicios = [];
        result.forEach((r) => {
            const svc = (r.cotizacion && r.cotizacion.servicios) ? r.cotizacion.servicios : {};
            Object.keys(svc).forEach((k) => {
                const s = svc[k] || {};
                servicios.push({ paqueteria: r.comercio || r.clave, clave: k, servicio: s.servicio, tipo_servicio: s.tipo_servicio, costo_total: s.costo_total, dias_entrega: s.dias_entrega });
            });
        });
        out.cotizacion = { cp_destino: cp, servicios, raw: JSON.stringify(q).slice(0, 2500) };
    } catch (e) {
        out.cotizacion_error = e.response ? { status: e.response.status, data: e.response.data } : e.message;
    }
    res.json(out);
});

// --- GET /api/debug/ep-test — prueba de conexión con Envíos Perros (cotización). TEMPORAL. ---
const ep = require('./enviosPerros/enviosPerrosClient');
router.get('/debug/ep-test', async (req, res) => {
    if ((req.query.key || '') !== 't1diag_9f3k2xQ7') return res.status(403).json({ error: 'forbidden' });
    const cp = String(req.query.cp || '06700').replace(/\D/g, '') || '06700';
    const out = { config: ep._config, cp };
    try {
        const data = await ep.cotizar({ cpDestino: cp });
        out.rates = ep.normalizarRates(data);
        out.raw = JSON.stringify(data).slice(0, 3000);
    } catch (e) {
        out.error = e.response ? { status: e.response.status, data: e.response.data } : e.message;
    }
    res.json(out);
});

// --- Background Removal (server-side AI) ---
let removeBackgroundFn = null;

router.post('/remove-background', async (req, res) => {
    try {
        const { image } = req.body; // base64 data URL
        if (!image) return res.status(400).json({ error: 'No image provided' });

        // Lazy-load the library (model stays in memory after first call)
        if (!removeBackgroundFn) {
            const bgModule = await import('@imgly/background-removal-node');
            removeBackgroundFn = bgModule.removeBackground || bgModule.default;
        }

        // Convert data URL to Blob for the library
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const blob = new Blob([buffer], { type: 'image/png' });

        const resultBlob = await removeBackgroundFn(blob);

        // Convert result blob to base64 data URL
        const arrayBuffer = await resultBlob.arrayBuffer();
        const resultBuffer = Buffer.from(arrayBuffer);
        const resultBase64 = `data:image/png;base64,${resultBuffer.toString('base64')}`;

        res.json({ image: resultBase64 });
    } catch (err) {
        console.error('Background removal error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- Endpoint GET /api/meta/test-event (Diagnóstico de conexión con Meta CAPI) ---
router.get('/meta/test-event', async (req, res) => {
    const META_PIXEL_ID = process.env.META_PIXEL_ID;
    const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
    const FB_PAGE_ID = process.env.FB_PAGE_ID;

    const diagnostics = {
        META_PIXEL_ID_SET: !!META_PIXEL_ID,
        META_PIXEL_ID_PREVIEW: META_PIXEL_ID ? `${META_PIXEL_ID.substring(0, 4)}...` : null,
        META_CAPI_ACCESS_TOKEN_SET: !!META_CAPI_ACCESS_TOKEN,
        META_CAPI_ACCESS_TOKEN_LENGTH: META_CAPI_ACCESS_TOKEN ? META_CAPI_ACCESS_TOKEN.length : 0,
        FB_PAGE_ID_SET: !!FB_PAGE_ID,
        testEventResult: null
    };

    if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) {
        diagnostics.testEventResult = 'SKIP: Faltan credenciales. Configura META_PIXEL_ID y META_CAPI_ACCESS_TOKEN en las variables de entorno.';
        return res.json(diagnostics);
    }

    // Enviar evento de prueba con test_event_code para que no afecte métricas reales
    const url = `https://graph.facebook.com/v22.0/${META_PIXEL_ID}/events`;

    const testPayload = {
        data: [{
            event_name: 'Purchase',
            event_time: Math.floor(Date.now() / 1000),
            event_id: `test_diag_${Date.now()}`,
            action_source: 'business_messaging',
            messaging_channel: 'whatsapp',
            user_data: {
                page_id: '110927358587213',
                ctwa_clid: 'TEST_CLICK_ID_DIAGNOSTIC'
            },
            custom_data: {
                value: 0.01,
                currency: 'MXN'
            }
        }],
        test_event_code: 'TEST_DIAG_CRM'
    };

    try {
        const response = await axios.post(url, testPayload, {
            headers: { 'Authorization': `Bearer ${META_CAPI_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        diagnostics.testEventResult = { status: 'SUCCESS', metaResponse: response.data };
    } catch (error) {
        diagnostics.testEventResult = {
            status: 'ERROR',
            message: error.message,
            metaResponse: error.response ? error.response.data : null,
            httpStatus: error.response ? error.response.status : null
        };
    }

    res.json(diagnostics);
});

// --- Endpoints para configuración Meta: conectar páginas a datasets ---

// Crear dataset VÍA página (auto-asocia página↔dataset) y vincular a WABA
router.post('/meta/config/create-page-dataset', async (req, res) => {
    const { token, page_id, old_dataset_id } = req.body;
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const pageId = page_id || process.env.FB_PAGE_ID;

    if (!token) return res.status(400).json({ error: 'Se requiere un User/Page Access Token' });
    if (!pageId) return res.status(400).json({ error: 'Se requiere page_id' });

    const steps = [];
    let datasetId = null;

    // === PASO 1: Crear dataset vía POST /{PAGE_ID}/dataset (auto-asocia la página) ===
    try {
        const r = await axios.post(`https://graph.facebook.com/v22.0/${pageId}/dataset`, {
            access_token: token
        });
        datasetId = r.data?.id;
        steps.push({ step: 'Crear dataset vía página', success: true, data: r.data });
    } catch (e) {
        steps.push({ step: 'Crear dataset vía página', success: false, error: e.response?.data?.error || e.message });
        return res.status(500).json({ error: 'No se pudo crear dataset vía página', steps });
    }

    // === PASO 2: Desvincular dataset viejo del WABA (si aplica) ===
    if (wabaId && old_dataset_id && old_dataset_id !== datasetId) {
        const tokensToTry = [token, systemToken].filter(Boolean);
        for (const tk of tokensToTry) {
            try {
                await axios.delete(`https://graph.facebook.com/v22.0/${wabaId}/dataset`, {
                    data: { dataset_id: old_dataset_id, access_token: tk }
                });
                steps.push({ step: 'Desvincular dataset viejo', success: true });
                break;
            } catch (e) {
                steps.push({ step: 'Desvincular dataset viejo', success: false, error: e.response?.data?.error?.message || e.message });
            }
        }
    }

    // === PASO 3: Vincular nuevo dataset al WABA ===
    let wabaLinked = false;
    if (wabaId) {
        const tokensToTry = [token, systemToken].filter(Boolean);
        for (const tk of tokensToTry) {
            if (wabaLinked) break;
            try {
                const r = await axios.post(`https://graph.facebook.com/v22.0/${wabaId}/dataset`, {
                    dataset_id: datasetId, access_token: tk
                });
                wabaLinked = r.data?.id === datasetId;
                steps.push({ step: 'Vincular WABA', success: true, data: r.data, linked: wabaLinked });
            } catch (e) {
                steps.push({ step: 'Vincular WABA', success: false, error: e.response?.data?.error?.message || e.message });
            }
        }
    }

    // === PASO 4: Verificar dataset ===
    try {
        const r = await axios.get(`https://graph.facebook.com/v22.0/${datasetId}`, {
            params: { fields: 'id,name', access_token: token }
        });
        steps.push({ step: 'Verificar dataset', success: true, data: r.data });
    } catch (e) {
        steps.push({ step: 'Verificar dataset', success: false, error: e.response?.data?.error?.message || e.message });
    }

    res.json({
        success: !!datasetId,
        dataset_id: datasetId,
        page_auto_associated: true,
        waba_linked: wabaLinked,
        update_env: `META_PIXEL_ID=${datasetId}`,
        steps
    });
});

// Obtener info del dataset y sus páginas conectadas
router.get('/meta/config/dataset', async (req, res) => {
    const token = req.query.token || process.env.META_CAPI_ACCESS_TOKEN;
    const pixelId = req.query.dataset_id || process.env.META_PIXEL_ID;
    if (!token || !pixelId) return res.status(400).json({ error: 'Falta token o dataset_id' });

    try {
        // Info del dataset
        const dsRes = await axios.get(`https://graph.facebook.com/v19.0/${pixelId}`, {
            params: { fields: 'name,id,owner_business', access_token: token }
        });
        // Páginas conectadas
        let connectedPages = [];
        try {
            const pagesRes = await axios.get(`https://graph.facebook.com/v19.0/${pixelId}/stats`, {
                params: { fields: 'connected_page', access_token: token }
            });
            connectedPages = pagesRes.data.data || [];
        } catch (e) {
            // Intentar otro edge
        }
        res.json({ dataset: dsRes.data, connectedPages });
    } catch (error) {
        res.status(error.response?.status || 500).json({
            error: error.response?.data?.error || error.message
        });
    }
});

// Listar páginas de Facebook accesibles con el token
router.get('/meta/config/pages', async (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'Se requiere un access_token' });

    try {
        const response = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
            params: { fields: 'id,name,access_token', limit: 100, access_token: token }
        });
        res.json({ pages: response.data.data || [] });
    } catch (error) {
        res.status(error.response?.status || 500).json({
            error: error.response?.data?.error || error.message
        });
    }
});

// Listar negocios y ad accounts del usuario
router.get('/meta/config/businesses', async (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'Se requiere un access_token' });

    try {
        const [bizRes, adRes] = await Promise.all([
            axios.get('https://graph.facebook.com/v21.0/me/businesses', {
                params: { fields: 'id,name', limit: 50, access_token: token }
            }),
            axios.get('https://graph.facebook.com/v21.0/me/adaccounts', {
                params: { fields: 'id,name,account_id,business{id,name}', limit: 50, access_token: token }
            })
        ]);
        res.json({
            businesses: bizRes.data.data || [],
            ad_accounts: (adRes.data.data || []).map(a => ({
                id: a.id,
                account_id: a.account_id,
                name: a.name,
                business_id: a.business?.id,
                business_name: a.business?.name
            }))
        });
    } catch (error) {
        res.status(error.response?.status || 500).json({
            error: error.response?.data?.error || error.message
        });
    }
});

// Descubrir edges disponibles en el dataset y la página
router.get('/meta/config/discover', async (req, res) => {
    const token = req.query.token;
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const datasetId = req.query.dataset_id || process.env.META_PIXEL_ID;
    const pageId = req.query.page_id;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    const discovery = {};

    // 1. Metadata del dataset (con system token que sabemos tiene acceso)
    if (systemToken && datasetId) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/${datasetId}`, {
                params: { metadata: 1, access_token: systemToken }
            });
            discovery.dataset = { id: r.data.id, name: r.data.name, type: r.data.metadata?.type, connections: r.data.metadata?.connections };
        } catch (e) {
            discovery.dataset = { error: e.response?.data?.error || e.message };
        }
    }

    // 2. Metadata de la página (con user token)
    if (token && pageId) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
                params: { metadata: 1, access_token: token }
            });
            discovery.page = { id: r.data.id, name: r.data.name, type: r.data.metadata?.type, connections: r.data.metadata?.connections };
        } catch (e) {
            discovery.page = { error: e.response?.data?.error || e.message };
        }
    }

    // 3. WABA info y datasets vinculados
    if (wabaId) {
        const tk = token || systemToken;
        if (tk) {
            try {
                const r = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}`, {
                    params: { metadata: 1, access_token: tk }
                });
                discovery.waba = { id: r.data.id, name: r.data.name, type: r.data.metadata?.type, connections: r.data.metadata?.connections };
            } catch (e) {
                discovery.waba = { error: e.response?.data?.error || e.message };
            }
        }
    }

    // 4. Businesses del usuario
    if (token) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/me/businesses`, {
                params: { fields: 'id,name', access_token: token }
            });
            discovery.businesses = r.data.data || [];
        } catch (e) {
            discovery.businesses = { error: e.response?.data?.error || e.message };
        }
    }

    res.json(discovery);
});

// Conectar una página a un dataset
// NOTA: Para AdsPixels/CAPI datasets, POST /{dataset_id}/pages NO funciona.
// La conexión página↔pixel solo se puede hacer en Meta Events Manager UI.
// Este endpoint intenta el método directo y vía WABA, y reporta claramente el estado.
router.post('/meta/config/connect-page', async (req, res) => {
    const { token, page_token, dataset_id, page_id } = req.body;
    if (!dataset_id || !page_id) {
        return res.status(400).json({ error: 'Se requieren dataset_id y page_id' });
    }

    const results = [];
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const allTokens = [
        ['page_token', page_token],
        ['user_token', token],
        ['system_token', systemToken]
    ].filter(([, t]) => t);

    // Helper: intenta con todos los tokens
    async function tryTokens(methodName, fn) {
        for (const [label, tk] of allTokens) {
            try {
                const r = await fn(tk);
                results.push({ method: `${methodName} (${label})`, success: true, data: r.data });
                return r.data;
            } catch (e) {
                results.push({ method: `${methodName} (${label})`, success: false, error: e.response?.data?.error?.message || e.message });
            }
        }
        return null;
    }

    let pageConnected = false;
    let wabaLinked = false;

    // 1. Método directo — POST /{dataset_id}/pages (funciona con offline_conversion_data_sets, NO con AdsPixels)
    const directResult = await tryTokens('dataset/pages', tk =>
        axios.post(`https://graph.facebook.com/v21.0/${dataset_id}/pages`, { page_id, access_token: tk })
    );
    if (directResult) pageConnected = true;

    // 2. Vía WABA — vincula dataset a WABA (NO conecta página en Event Manager)
    if (wabaId) {
        const wabaResult = await tryTokens('waba/dataset+page', tk =>
            axios.post(`https://graph.facebook.com/v21.0/${wabaId}/dataset`, {
                dataset_id, page_id, access_token: tk
            })
        );
        if (wabaResult) wabaLinked = true;
    }

    // 3. Verificar WABA
    let wabaVerified = false;
    if (wabaId) {
        for (const [label, tk] of allTokens) {
            try {
                const r = await axios.get(`https://graph.facebook.com/v21.0/${wabaId}/dataset`, {
                    params: { access_token: tk }
                });
                const datasets = r.data?.data || (r.data?.id ? [r.data] : []);
                wabaVerified = datasets.some(d => d.id === dataset_id);
                results.push({ method: `VERIFY waba/dataset (${label})`, success: true, data: r.data, waba_dataset_linked: wabaVerified });
                break;
            } catch (e) {
                results.push({ method: `VERIFY waba/dataset (${label})`, success: false, error: e.response?.data?.error?.message || e.message });
            }
        }
    }

    res.json({
        success: pageConnected,
        page_connected: pageConnected,
        waba_linked: wabaLinked || wabaVerified,
        waba_only: !pageConnected && (wabaLinked || wabaVerified),
        results
    });
});

// Crear/encontrar pixel en ad account, compartir con BM, y vincular a WABA
// NOTA: AdsPixels NO soportan POST /{id}/pages. La conexión página↔pixel
// debe hacerse manualmente en Meta Events Manager → Configuración → Recursos conectados.
router.post('/meta/config/create-and-connect', async (req, res) => {
    const { token, page_token, page_id, dataset_name, old_dataset_id, business_id, ad_account_id } = req.body;
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    if (!token) return res.status(400).json({ error: 'Se requiere un User Access Token' });
    if (!page_id) return res.status(400).json({ error: 'Se requiere page_id' });
    if (!dataset_name) return res.status(400).json({ error: 'Se requiere dataset_name' });

    const allTokens = [
        ['user_token', token],
        ['page_token', page_token],
        ['system_token', systemToken]
    ].filter(([, t]) => t);

    const steps = [];
    let newDatasetId = null;
    let wabaLinked = false;

    // === PASO 1: BM y Ad Account ===
    let businessId = business_id || null;
    let adAccountId = ad_account_id || null;

    if (!businessId) {
        try {
            const r = await axios.get('https://graph.facebook.com/v21.0/me/businesses', {
                params: { fields: 'id,name', access_token: token }
            });
            if (r.data.data?.length > 0) {
                businessId = r.data.data[0].id;
                steps.push({ step: 'Descubrir BM', success: true, data: { id: businessId, name: r.data.data[0].name } });
            }
        } catch (e) {
            steps.push({ step: 'Descubrir BM', success: false, error: e.response?.data?.error?.message || e.message });
        }
    } else {
        steps.push({ step: 'BM seleccionado', success: true, data: { id: businessId } });
    }

    if (!adAccountId) {
        try {
            const r = await axios.get('https://graph.facebook.com/v21.0/me/adaccounts', {
                params: { fields: 'id,name', limit: 5, access_token: token }
            });
            if (r.data.data?.length > 0) {
                adAccountId = r.data.data[0].id;
                steps.push({ step: 'Descubrir Ad Account', success: true, data: { id: adAccountId, name: r.data.data[0].name } });
            }
        } catch (e) {
            steps.push({ step: 'Descubrir Ad Account', success: false, error: e.response?.data?.error?.message || e.message });
        }
    } else {
        if (!adAccountId.startsWith('act_')) adAccountId = `act_${adAccountId}`;
        steps.push({ step: 'Ad Account seleccionada', success: true, data: { id: adAccountId } });
    }

    if (!adAccountId) {
        return res.status(400).json({ error: 'No se encontró ninguna Ad Account.', steps });
    }

    // === PASO 2: Crear pixel o usar existente ===
    let isNew = false;

    // 2a. Intentar crear pixel nuevo
    try {
        const r = await axios.post(`https://graph.facebook.com/v21.0/${adAccountId}/adspixels`, {
            name: dataset_name, access_token: token
        });
        newDatasetId = r.data.id;
        isNew = true;
        steps.push({ step: 'Crear pixel', success: true, data: r.data });
    } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        steps.push({ step: 'Crear pixel', success: false, error: msg });

        // 2b. Si ya existe, buscar el existente
        if (msg.includes('already exists')) {
            try {
                const r = await axios.get(`https://graph.facebook.com/v21.0/${adAccountId}/adspixels`, {
                    params: { fields: 'id,name', access_token: token }
                });
                if (r.data.data?.length > 0) {
                    newDatasetId = r.data.data[0].id;
                    steps.push({ step: 'Usar pixel existente', success: true, data: r.data.data[0] });
                }
            } catch (e2) {
                steps.push({ step: 'Buscar pixel existente', success: false, error: e2.response?.data?.error?.message || e2.message });
            }
        }
    }

    if (!newDatasetId) {
        return res.status(500).json({ error: 'No se pudo crear ni encontrar un pixel/dataset.', steps });
    }

    // === PASO 3: Compartir pixel con ad account del BM (da acceso al BM) ===
    if (businessId) {
        try {
            const r = await axios.post(`https://graph.facebook.com/v21.0/${newDatasetId}/shared_accounts`, {
                business: businessId,
                account_id: adAccountId.replace('act_', ''),
                access_token: token
            });
            steps.push({ step: 'Compartir con ad account', success: true, data: r.data });
        } catch (e) {
            steps.push({ step: 'Compartir con ad account', success: false, error: e.response?.data?.error?.message || e.message });
        }
    }

    // === PASO 4: Desvincular dataset viejo de WABA ===
    if (wabaId && old_dataset_id) {
        for (const [label, tk] of allTokens) {
            try {
                await axios.delete(`https://graph.facebook.com/v21.0/${wabaId}/dataset`, {
                    data: { dataset_id: old_dataset_id, access_token: tk }
                });
                steps.push({ step: `Desvincular dataset viejo (${label})`, success: true });
                break;
            } catch (e) {
                steps.push({ step: `Desvincular dataset viejo (${label})`, success: false, error: e.response?.data?.error?.message || e.message });
            }
        }
    }

    // === PASO 5: Vincular a WABA ===
    if (wabaId) {
        for (const [label, tk] of allTokens) {
            if (wabaLinked) break;
            try {
                const r = await axios.post(`https://graph.facebook.com/v21.0/${wabaId}/dataset`, {
                    dataset_id: newDatasetId, page_id, access_token: tk
                });
                const linkedId = r.data?.id;
                wabaLinked = linkedId === newDatasetId;
                steps.push({ step: `Vincular WABA (${label})`, success: true, data: r.data,
                    ...(linkedId !== newDatasetId ? { warning: `WABA respondió con ID ${linkedId}. Desvincula el dataset viejo primero.` } : {})
                });
            } catch (e) {
                steps.push({ step: `Vincular WABA (${label})`, success: false, error: e.response?.data?.error?.message || e.message });
            }
        }
    }

    // === PASO 6: Verificar ===
    try {
        const r = await axios.get(`https://graph.facebook.com/v21.0/${newDatasetId}`, {
            params: { fields: 'id,name,owner_business{id,name}', access_token: token }
        });
        steps.push({ step: 'Verificar dataset', success: true, data: r.data });
    } catch (e) {
        steps.push({ step: 'Verificar dataset', success: false, error: e.response?.data?.error?.message || e.message });
    }

    res.json({
        success: !!newDatasetId,
        new_dataset_id: newDatasetId,
        is_new: isNew,
        page_connected: false, // AdsPixels no soportan /pages — debe hacerse manual
        page_connect_note: 'La conexión página↔pixel debe hacerse en Meta Events Manager → Configuración → Recursos conectados.',
        waba_linked: wabaLinked,
        steps
    });
});

// Desvincular y revincular WABA a un dataset diferente
router.post('/meta/config/switch-waba-dataset', async (req, res) => {
    const { token, old_dataset_id, new_dataset_id } = req.body;
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    if (!wabaId) return res.status(400).json({ error: 'WHATSAPP_BUSINESS_ACCOUNT_ID no configurado' });
    if (!new_dataset_id) return res.status(400).json({ error: 'Se requiere new_dataset_id' });

    const results = [];
    const tokensToTry = [
        ['user_token', token],
        ['whatsapp_token', process.env.WHATSAPP_TOKEN],
        ['meta_graph_token', process.env.META_GRAPH_TOKEN],
        ['system_token', systemToken]
    ].filter(([, t]) => t);

    // Paso 1: Intentar DELETE del dataset viejo
    if (old_dataset_id) {
        for (const [label, tk] of tokensToTry) {
            try {
                const r = await axios.delete(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                    data: { dataset_id: old_dataset_id, access_token: tk }
                });
                results.push({ step: `DELETE old (${label})`, success: true, data: r.data });
                break; // Si funciona, no intentar con otro token
            } catch (e) {
                results.push({ step: `DELETE old (${label})`, success: false, error: e.response?.data?.error || e.message });
            }
        }
    }

    // Paso 2: POST del dataset nuevo
    for (const [label, tk] of tokensToTry) {
        try {
            const r = await axios.post(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                dataset_id: new_dataset_id, access_token: tk
            });
            results.push({ step: `POST new (${label})`, success: true, data: r.data });
            break;
        } catch (e) {
            results.push({ step: `POST new (${label})`, success: false, error: e.response?.data?.error || e.message });
        }
    }

    // Paso 3: Verificar cuál dataset está vinculado ahora
    for (const [label, tk] of tokensToTry) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                params: { access_token: tk }
            });
            results.push({ step: `GET verify (${label})`, success: true, data: r.data });
            break;
        } catch (e) {
            results.push({ step: `GET verify (${label})`, success: false, error: e.response?.data?.error || e.message });
        }
    }

    res.json({ results });
});

// GET — Ver qué datasets están vinculados a la WABA
router.get('/meta/config/waba-datasets', async (req, res) => {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const userToken = req.query.token;

    if (!wabaId) return res.status(400).json({ error: 'WHATSAPP_BUSINESS_ACCOUNT_ID no configurado' });

    const tokensToTry = [
        ['user_token', userToken],
        ['whatsapp_token', process.env.WHATSAPP_TOKEN],
        ['meta_graph_token', process.env.META_GRAPH_TOKEN],
        ['system_token', systemToken]
    ].filter(([, t]) => t);

    const errors = [];
    for (const [label, tk] of tokensToTry) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}/dataset`, {
                params: { access_token: tk }
            });
            return res.json({ waba_id: wabaId, token_used: label, datasets: r.data });
        } catch (e) {
            const err = e.response?.data?.error || e.message;
            console.log(`[WABA datasets] ${label} falló:`, err);
            errors.push({ token: label, error: err });
        }
    }
    res.status(500).json({ error: 'No se pudo consultar datasets con ningún token', details: errors });
});

// DELETE — Desvincular un dataset de la WABA (intenta desde ambos lados)
router.delete('/meta/config/waba-dataset', async (req, res) => {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const systemToken = process.env.META_CAPI_ACCESS_TOKEN;
    const { dataset_id, token } = req.body;

    if (!wabaId) return res.status(400).json({ error: 'WHATSAPP_BUSINESS_ACCOUNT_ID no configurado' });
    if (!dataset_id) return res.status(400).json({ error: 'Se requiere dataset_id a desvincular' });

    const tokensToTry = [
        ['user_token', token],
        ['whatsapp_token', process.env.WHATSAPP_TOKEN],
        ['meta_graph_token', process.env.META_GRAPH_TOKEN],
        ['system_token', systemToken]
    ].filter(([, t]) => t);

    const results = [];
    let deleted = false;
    const apiVersions = ['v21.0', 'v19.0', 'v18.0'];

    // Helper para intentar una operación con todos los tokens y versiones de API
    async function tryOp(stepName, fn) {
        if (deleted) return;
        for (const version of apiVersions) {
            if (deleted) break;
            for (const [label, tk] of tokensToTry) {
                if (deleted) break;
                try {
                    const r = await fn(tk, version);
                    results.push({ step: `${stepName} ${version} (${label})`, success: true, data: r.data });
                    deleted = true;
                } catch (e) {
                    results.push({ step: `${stepName} ${version} (${label})`, success: false, error: e.response?.data?.error?.message || e.response?.data?.error || e.message });
                }
            }
        }
    }

    // --- Lado WABA ---

    // 1. DELETE /{waba_id}/dataset con params
    await tryOp(`DELETE /${wabaId}/dataset params`, (tk, v) =>
        axios.delete(`https://graph.facebook.com/${v}/${wabaId}/dataset`, {
            params: { dataset_id, access_token: tk }
        })
    );

    // 2. DELETE /{waba_id}/dataset con body
    await tryOp(`DELETE /${wabaId}/dataset body`, (tk, v) =>
        axios.delete(`https://graph.facebook.com/${v}/${wabaId}/dataset`, {
            data: { dataset_id, access_token: tk }
        })
    );

    // 3. DELETE /{waba_id}/datasets (plural)
    await tryOp(`DELETE /${wabaId}/datasets`, (tk, v) =>
        axios.delete(`https://graph.facebook.com/${v}/${wabaId}/datasets`, {
            params: { dataset_id, access_token: tk }
        })
    );

    // 4. POST /{waba_id}/dataset con method=delete en body
    await tryOp(`POST method=delete /${wabaId}/dataset`, (tk, v) =>
        axios.post(`https://graph.facebook.com/${v}/${wabaId}/dataset`, {
            dataset_id, access_token: tk, method: 'delete'
        })
    );

    // --- Lado Dataset ---

    const datasetEdges = ['whatsapp_business_accounts', 'event_source_groups'];

    for (const edge of datasetEdges) {
        // 5. DELETE /{dataset_id}/{edge} con params
        await tryOp(`DELETE /${dataset_id}/${edge} params`, (tk, v) =>
            axios.delete(`https://graph.facebook.com/${v}/${dataset_id}/${edge}`, {
                params: { whatsapp_business_account_id: wabaId, access_token: tk }
            })
        );

        // 6. DELETE /{dataset_id}/{edge} con body
        await tryOp(`DELETE /${dataset_id}/${edge} body`, (tk, v) =>
            axios.delete(`https://graph.facebook.com/${v}/${dataset_id}/${edge}`, {
                data: { whatsapp_business_account_id: wabaId, access_token: tk }
            })
        );

        // 7. POST method=delete /{dataset_id}/{edge}
        await tryOp(`POST method=delete /${dataset_id}/${edge}`, (tk, v) =>
            axios.post(`https://graph.facebook.com/${v}/${dataset_id}/${edge}`, {
                whatsapp_business_account_id: wabaId, access_token: tk, method: 'delete'
            })
        );
    }

    // --- Vía Business Manager ---

    // Descubrir business_id
    let businessId = null;
    for (const [label, tk] of tokensToTry) {
        if (businessId) break;
        try {
            const r = await axios.get(`https://graph.facebook.com/v21.0/me/businesses`, {
                params: { fields: 'id,name', access_token: tk }
            });
            if (r.data.data?.length > 0) businessId = r.data.data[0].id;
        } catch (e) { /* ignore */ }
    }

    if (businessId) {
        // 8. DELETE /{business_id}/adspixels con pixel_id
        await tryOp(`DELETE /${businessId}/adspixels`, (tk, v) =>
            axios.delete(`https://graph.facebook.com/${v}/${businessId}/adspixels`, {
                params: { pixel_id: dataset_id, access_token: tk }
            })
        );

        // 9. POST dissociate pixel from business
        await tryOp(`POST /${dataset_id}/shared_accounts remove`, (tk, v) =>
            axios.post(`https://graph.facebook.com/${v}/${dataset_id}/shared_accounts`, {
                business: businessId, access_token: tk, method: 'delete'
            })
        );
    }

    // --- Intentar vincular nuevo dataset vacío para forzar reemplazo ---
    // (WABA solo puede tener 1 dataset, vincular otro lo reemplaza)

    // 10. POST /{waba_id}/dataset SIN dataset_id (para desvincular sin revincular)
    await tryOp(`POST /${wabaId}/dataset empty`, (tk, v) =>
        axios.post(`https://graph.facebook.com/${v}/${wabaId}/dataset`, {
            access_token: tk
        })
    );

    // Verificar estado actual
    for (const [label, tk] of tokensToTry) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v21.0/${wabaId}/dataset`, {
                params: { access_token: tk }
            });
            results.push({ step: `GET verify (${label})`, success: true, datasets_remaining: r.data });
            break;
        } catch (e) {
            results.push({ step: `GET verify (${label})`, success: false, error: e.response?.data?.error?.message || e.response?.data?.error || e.message });
        }
    }

    res.status(deleted ? 200 : 500).json({ waba_id: wabaId, dataset_delinked: dataset_id, success: deleted, results });
});

// POST — Reclamar/agregar una página a tu Business Manager actual
router.post('/meta/config/claim-page', async (req, res) => {
    const { token, page_id, business_id } = req.body;
    if (!token || !page_id) return res.status(400).json({ error: 'Se requieren token y page_id' });

    const results = [];
    let claimed = false;

    // Usar business_id proporcionado o descubrir el primero
    let businessId = business_id || null;
    if (!businessId) {
        try {
            const r = await axios.get('https://graph.facebook.com/v21.0/me/businesses', {
                params: { fields: 'id,name', access_token: token }
            });
            if (r.data.data?.length > 0) {
                businessId = r.data.data[0].id;
                results.push({ step: 'discover_business', success: true, business: r.data.data[0] });
            }
        } catch (e) {
            results.push({ step: 'discover_business', success: false, error: e.response?.data?.error?.message || e.message });
        }
    } else {
        results.push({ step: 'using_provided_business', success: true, business_id: businessId });
    }

    if (!businessId) return res.status(400).json({ error: 'No se pudo encontrar tu Business Manager', results });

    // Obtener page access token (si el usuario es admin de la página)
    let pageToken = null;
    try {
        const r = await axios.get(`https://graph.facebook.com/v21.0/${page_id}`, {
            params: { fields: 'access_token,name', access_token: token }
        });
        pageToken = r.data.access_token;
        results.push({ step: 'get_page_token', success: true, page_name: r.data.name });
    } catch (e) {
        results.push({ step: 'get_page_token', success: false, error: e.response?.data?.error?.message || e.message });
    }

    // Tokens a intentar
    const tokensToTry = [
        ['user_token', token],
        ['page_token', pageToken]
    ].filter(([, t]) => t);

    const apiVersions = ['v21.0', 'v19.0'];

    async function tryOp(stepName, fn) {
        if (claimed) return;
        for (const v of apiVersions) {
            if (claimed) break;
            for (const [label, tk] of tokensToTry) {
                if (claimed) break;
                try {
                    const r = await fn(v, tk);
                    results.push({ step: `${stepName} ${v} (${label})`, success: true, data: r.data });
                    claimed = true;
                } catch (e) {
                    results.push({ step: `${stepName} ${v} (${label})`, success: false, error: e.response?.data?.error?.message || e.response?.data?.error || e.message });
                }
            }
        }
    }

    // 1. POST /{business_id}/owned_pages
    await tryOp(`POST /${businessId}/owned_pages`, (v, tk) =>
        axios.post(`https://graph.facebook.com/${v}/${businessId}/owned_pages`, {
            page_id, access_token: tk
        })
    );

    // 2. POST /{business_id}/client_pages con permitted_tasks
    await tryOp(`POST /${businessId}/client_pages permitted_tasks`, (v, tk) =>
        axios.post(`https://graph.facebook.com/${v}/${businessId}/client_pages`, {
            page_id, access_token: tk,
            permitted_tasks: ['MANAGE', 'CREATE_CONTENT', 'MODERATE', 'ADVERTISE', 'ANALYZE']
        })
    );

    // 3. POST /{business_id}/client_pages con permitted_roles
    await tryOp(`POST /${businessId}/client_pages permitted_roles`, (v, tk) =>
        axios.post(`https://graph.facebook.com/${v}/${businessId}/client_pages`, {
            page_id, access_token: tk,
            permitted_roles: ['MANAGER']
        })
    );

    // 4. POST /{business_id}/pages
    await tryOp(`POST /${businessId}/pages`, (v, tk) =>
        axios.post(`https://graph.facebook.com/${v}/${businessId}/pages`, {
            page_id, access_token: tk,
            permitted_tasks: ['MANAGE', 'CREATE_CONTENT', 'MODERATE', 'ADVERTISE', 'ANALYZE']
        })
    );

    // 5. POST /{page_id}/agencies — compartir página con el BM
    await tryOp(`POST /${page_id}/agencies`, (v, tk) =>
        axios.post(`https://graph.facebook.com/${v}/${page_id}/agencies`, {
            business: businessId, access_token: tk,
            permitted_tasks: ['MANAGE', 'CREATE_CONTENT', 'MODERATE', 'ADVERTISE', 'ANALYZE']
        })
    );

    // 6. POST /{page_id}/assigned_users con user ID
    // Obtener user ID primero
    let userId = null;
    try {
        const r = await axios.get('https://graph.facebook.com/v21.0/me', {
            params: { fields: 'id', access_token: token }
        });
        userId = r.data.id;
    } catch (e) { /* ignore */ }

    if (userId) {
        await tryOp(`POST /${page_id}/assigned_users`, (v, tk) =>
            axios.post(`https://graph.facebook.com/${v}/${page_id}/assigned_users`, {
                user: userId, business: businessId, access_token: tk,
                tasks: ['MANAGE', 'CREATE_CONTENT', 'MODERATE', 'ADVERTISE', 'ANALYZE']
            })
        );
    }

    // 7. POST /{business_id}/pages con params en URL
    await tryOp(`POST /${businessId}/pages (params)`, (v, tk) =>
        axios.post(`https://graph.facebook.com/${v}/${businessId}/pages`, null, {
            params: { page_id, access_token: tk, permitted_tasks: 'MANAGE,CREATE_CONTENT,MODERATE,ADVERTISE,ANALYZE' }
        })
    );

    // Verificar si la página está ahora en el BM
    for (const [label, tk] of tokensToTry) {
        try {
            const r = await axios.get(`https://graph.facebook.com/v21.0/${businessId}/owned_pages`, {
                params: { access_token: tk, fields: 'id,name' }
            });
            const found = r.data.data?.some(p => p.id === page_id);
            results.push({ step: `VERIFY owned_pages (${label})`, success: true, page_found: found, pages: r.data.data });
            break;
        } catch (e) {
            // Intentar client_pages también
            try {
                const r2 = await axios.get(`https://graph.facebook.com/v21.0/${businessId}/client_pages`, {
                    params: { access_token: tk, fields: 'id,name' }
                });
                const found = r2.data.data?.some(p => p.id === page_id);
                results.push({ step: `VERIFY client_pages (${label})`, success: true, page_found: found, pages: r2.data.data });
                break;
            } catch (e2) {
                results.push({ step: `VERIFY (${label})`, success: false, error: e.response?.data?.error?.message || e.message });
            }
        }
    }

    res.json({ success: claimed, business_id: businessId, page_id, results });
});

// =============================================================================
// DESGLOSE DE PAGOS POR CAMPAÑA
// =============================================================================

router.get('/campaigns/payments', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ success: false, message: 'Se requiere date (YYYY-MM-DD).' });

        // 1. Obtener pedidos confirmados (Fabricar/Pagado) de esa fecha
        const startDate = new Date(date + 'T00:00:00-06:00');
        const endDate = new Date(date + 'T23:59:59.999-06:00');

        const ordersSnap = await db.collection('pedidos')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
            .where('createdAt', '<', admin.firestore.Timestamp.fromDate(endDate))
            .get();

        // 2. Para cada pedido confirmado, buscar contacto y obtener adReferral
        const payments = []; // { adSourceId, adName, payment }
        const noAdPayments = [];

        for (const doc of ordersSnap.docs) {
            const order = doc.data();
            const status = (order.estatus || '').toLowerCase();
            const isConfirmed = status.includes('fabricar') || status.includes('pagado');
            if (!isConfirmed) continue;

            const contactId = order.contactId || order.telefono;
            let adSourceId = null;
            let adName = null;
            let clientName = 'Sin nombre';

            if (contactId) {
                const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
                if (contactDoc.exists) {
                    const cd = contactDoc.data();
                    clientName = cd.name || clientName;
                    if (cd.adReferral && cd.adReferral.source_id) {
                        adSourceId = cd.adReferral.source_id;
                        adName = cd.adReferral.ad_name || adSourceId;
                    }
                }
            }

            const payment = {
                orderNumber: order.consecutiveOrderNumber,
                amount: order.precio || 0,
                clientName,
                producto: order.producto || ''
            };

            if (adSourceId) {
                payments.push({ adSourceId, adName, payment });
            } else {
                noAdPayments.push(payment);
            }
        }

        // 3. Resolver ad_id → campaign_id via Meta API
        const META_TOKEN = process.env.META_GRAPH_TOKEN || process.env.WHATSAPP_TOKEN;
        const uniqueAdIds = [...new Set(payments.map(p => p.adSourceId))];
        const adToCampaign = {}; // { ad_id: campaignId }

        for (let i = 0; i < uniqueAdIds.length; i += 50) {
            const batch = uniqueAdIds.slice(i, i + 50);
            try {
                const metaRes = await axios.get(`https://graph.facebook.com/v22.0/`, {
                    params: {
                        ids: batch.join(','),
                        fields: 'campaign_id',
                        access_token: META_TOKEN
                    }
                });
                for (const [adId, adData] of Object.entries(metaRes.data)) {
                    if (adData.campaign_id) {
                        adToCampaign[adId] = adData.campaign_id;
                    }
                }
            } catch (e) {
                console.warn('[Campaigns/Payments] Error consultando Meta API:', e.response?.data?.error?.message || e.message);
                // Fallback: no podemos resolver, agrupar por ad name
            }
        }

        // 4. Agrupar pagos por campaign_id
        const byCampaignId = {}; // { campaignId: { adNames: Set, payments: [] } }

        for (const { adSourceId, adName, payment } of payments) {
            const campaignId = adToCampaign[adSourceId] || `ad_${adSourceId}`;
            if (!byCampaignId[campaignId]) {
                byCampaignId[campaignId] = { adNames: new Set(), payments: [] };
            }
            byCampaignId[campaignId].adNames.add(adName);
            byCampaignId[campaignId].payments.push(payment);
        }

        // 5. Construir resultado con campaign_id como clave para cruce en frontend
        const campaignPayments = {};

        for (const [campaignId, data] of Object.entries(byCampaignId)) {
            campaignPayments[campaignId] = {
                campaignId,
                name: [...data.adNames].join(', '),
                totalAmount: data.payments.reduce((s, p) => s + p.amount, 0),
                payments: data.payments
            };
        }

        if (noAdPayments.length > 0) {
            campaignPayments['organic'] = {
                campaignId: 'organic',
                name: 'Orgánico / Directo',
                totalAmount: noAdPayments.reduce((s, p) => s + p.amount, 0),
                payments: noAdPayments
            };
        }

        const result = Object.values(campaignPayments)
            .sort((a, b) => b.totalAmount - a.totalAmount);

        res.json({ success: true, campaigns: result });
    } catch (error) {
        console.error('Error en campaigns/payments:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// =============================================================================
// COBRANZA MASIVA IA
// =============================================================================

// Buscar pedidos por rango de fecha para cobranza
router.get('/cobranza/buscar-pedidos', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'Se requieren startDate y endDate.' });
        }

        const start = admin.firestore.Timestamp.fromMillis(Number(startDate));
        const end = admin.firestore.Timestamp.fromMillis(Number(endDate));

        const snapshot = await db.collection('pedidos')
            .where('createdAt', '>=', start)
            .where('createdAt', '<=', end)
            .orderBy('createdAt', 'desc')
            .get();

        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                consecutiveOrderNumber: data.consecutiveOrderNumber,
                producto: data.producto,
                telefono: data.telefono,
                precio: data.precio,
                estatus: data.estatus,
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
            };
        });

        // Obtener lastCobranzaDate de cada contacto para marcar "Cobrado Hoy"
        const telefonos = [...new Set(orders.map(o => o.telefono).filter(Boolean))];
        const cobranzaMap = {};
        // Firestore 'in' soporta max 30 valores por query
        for (let i = 0; i < telefonos.length; i += 30) {
            const batch = telefonos.slice(i, i + 30);
            const contactsSnap = await db.collection('contacts_whatsapp')
                .where(admin.firestore.FieldPath.documentId(), 'in', batch).get();
            contactsSnap.docs.forEach(doc => {
                const d = doc.data();
                if (d.lastCobranzaDate) cobranzaMap[doc.id] = d.lastCobranzaDate;
            });
        }

        // Fecha de hoy en formato YYYY-MM-DD (zona horaria de México)
        const todayMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

        orders.forEach(o => {
            o.cobradoHoy = cobranzaMap[o.telefono] === todayMx;
        });

        res.json({ success: true, orders });
    } catch (error) {
        console.error('Error buscando pedidos para cobranza:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Enviar mensaje de cobranza IA para un contacto
router.post('/cobranza/enviar', async (req, res) => {
    try {
        const { contactId, instructions, orderNumbers } = req.body;
        if (!contactId || !instructions) {
            return res.status(400).json({ success: false, message: 'Faltan contactId o instrucciones.' });
        }

        // 1. Verificar que el contacto existe
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.json({ success: false, skipped: true, reason: 'Contacto no encontrado en WhatsApp' });
        }

        // 1.5 Verificar que no se haya cobrado hoy (por fecha calendario, no 24h)
        const todayMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
        const contactData = contactDoc.data();
        if (contactData.lastCobranzaDate === todayMx) {
            return res.json({ success: false, skipped: true, reason: 'Ya se cobró hoy' });
        }

        // 2. Cargar historial de conversación (ordenado desc para detectar ventana 24h)
        const messagesSnapshot = await contactRef.collection('messages')
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();

        // 2.1 Si la conversación tiene mensajes de hoy (cualquier dirección), no cobrar
        const hasMessagesToday = messagesSnapshot.docs.some(d => {
            const ts = d.data().timestamp?.toDate();
            if (!ts) return false;
            const msgDateMx = ts.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
            return msgDateMx === todayMx;
        });
        if (hasMessagesToday) {
            return res.json({ success: false, skipped: true, reason: 'Tiene conversación hoy' });
        }

        // Detectar ventana de 24h: buscar último mensaje ENTRANTE del cliente
        const lastInboundMsg = messagesSnapshot.docs.find(d => d.data().from === contactId);
        const lastInboundTime = lastInboundMsg?.data()?.timestamp?.toDate();
        const windowOpen = lastInboundTime && (Date.now() - lastInboundTime.getTime() < 24 * 60 * 60 * 1000);

        const conversationHistory = messagesSnapshot.docs.map(doc => {
            const d = doc.data();
            const fromLabel = d.from === contactId ? 'Cliente' : 'Asistente';
            return `${fromLabel}: ${d.text || ''}`;
        }).reverse().join('\n');

        if (!conversationHistory.trim()) {
            return res.json({ success: false, skipped: true, reason: 'Sin historial de conversación' });
        }

        // 3. Cargar respuestas guardadas CON archivos adjuntos
        const quickRepliesSnapshot = await db.collection('quick_replies').get();
        const quickRepliesData = quickRepliesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const quickRepliesContext = quickRepliesData.map(qr => {
            let entry = `/${qr.shortcut}: ${qr.message || ''}`;
            if (qr.fileUrl) entry += ` [ARCHIVO: ${qr.fileUrl}]`;
            return entry;
        }).join('\n');

        // 4. Cargar plantillas de WhatsApp aprobadas (para chats cerrados)
        let templatesContext = '';
        let templatesData = [];
        try {
            const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
            const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
            if (WHATSAPP_BUSINESS_ACCOUNT_ID && WHATSAPP_TOKEN) {
                const tplRes = await axios.get(
                    `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`,
                    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, params: { limit: 100 } }
                );
                templatesData = (tplRes.data.data || [])
                    .filter(t => t.status === 'APPROVED')
                    .map(t => ({
                        name: t.name,
                        language: t.language,
                        components: t.components?.map(c => ({ type: c.type, text: c.text, format: c.format, buttons: c.buttons })) || []
                    }));
                templatesContext = templatesData.map(t => {
                    const body = t.components.find(c => c.type === 'BODY');
                    return `[TEMPLATE:${t.name}]: ${body?.text || '(sin texto)'}`;
                }).join('\n');
            }
        } catch (e) {
            console.warn('[Cobranza] Error cargando plantillas:', e.message);
        }

        // 5. Info de pedidos del contacto
        const ordersInfo = orderNumbers ? `Pedidos del cliente: ${orderNumbers.map(n => 'DH' + n).join(', ')}` : '';

        // 6. Construir prompt para la IA
        const windowStatus = windowOpen
            ? 'VENTANA DE 24H: ABIERTA - Puedes enviar mensaje normal o respuesta rápida.'
            : 'VENTANA DE 24H: CERRADA - Debes usar una plantilla. Responde con [TEMPLATE:nombre_plantilla]';

        const systemPrompt = `${instructions}

--- RESPUESTAS GUARDADAS DISPONIBLES ---
${quickRepliesContext}

--- PLANTILLAS DE WHATSAPP APROBADAS (para chats cerrados) ---
${templatesContext || '(ninguna disponible)'}

--- ESTADO DEL CHAT ---
${windowStatus}

--- FECHA DE HOY ---
Hoy es ${todayMx} (zona horaria America/Mexico_City, formato YYYY-MM-DD).

--- FORMATO DE RESPUESTA ---
- Para enviar una respuesta rápida: responde SOLAMENTE con el shortcut, ej: /a3
- Para enviar una plantilla (chat cerrado): responde con [TEMPLATE:nombre_plantilla]
- Para enviar un mensaje personalizado (chat abierto): escribe solo el mensaje
- Si necesitas cambiar el estatus del pedido, agrega al final: [ESTATUS:NuevoEstatus]
  Valores válidos: Foto enviada, Esperando pago, Pagado, Mns Amenazador, Cancelado
- Si el cliente YA DIJO una fecha específica en la que va a pagar y esa fecha es POSTERIOR a hoy (${todayMx}): responde SOLAMENTE con [FUTURE:YYYY-MM-DD] usando la fecha prometida en formato ISO. NO envíes ningún mensaje. Si la fecha prometida es hoy o ya pasó, NO uses [FUTURE] y continúa con el flujo normal de cobranza.
- Si el cobro ya se resolvió o ya pagó: responde SKIP
- No incluyas "Asistente:" ni etiquetas extra.`;

        const dynamicPrompt = `${ordersInfo}

--- HISTORIAL DE CONVERSACIÓN ---
${conversationHistory}

--- INSTRUCCIÓN ---
Analiza la conversación y decide qué acción de cobranza tomar.`;

        // 7. Llamar a Gemini
        const aiResponse = await generateGeminiResponse(dynamicPrompt, [], systemPrompt);
        let responseText = aiResponse.text.trim();

        // 8. Log de uso de tokens
        const today = new Date().toISOString().split('T')[0];
        const usageRef = db.collection('ai_usage_logs').doc(today);
        await usageRef.set({
            inputTokens: admin.firestore.FieldValue.increment(aiResponse.inputTokens),
            outputTokens: admin.firestore.FieldValue.increment(aiResponse.outputTokens),
            requestCount: admin.firestore.FieldValue.increment(1),
            date: today
        }, { merge: true });

        // 9. FUTURE - el cliente ya dio una fecha futura de pago
        const futureMatch = responseText.match(/\[FUTURE:(\d{4}-\d{2}-\d{2})\]/i);
        if (futureMatch) {
            const futureDate = futureMatch[1];
            if (futureDate > todayMx) {
                return res.json({
                    success: false,
                    skipped: true,
                    reason: `Cobranza futura (${futureDate})`
                });
            }
            // Si la fecha no es realmente futura, removemos la etiqueta y continuamos
            responseText = responseText.replace(/\[FUTURE:.+?\]/i, '').trim();
        }

        // 9. SKIP
        if (responseText.toUpperCase().includes('SKIP')) {
            return res.json({ success: false, skipped: true, reason: 'IA determinó que no requiere cobro' });
        }

        // 10. Extraer y ejecutar cambio de estatus si la IA lo indica
        const statusMatch = responseText.match(/\[ESTATUS:(.+?)\]/);
        if (statusMatch) {
            const newStatus = statusMatch[1].trim();
            responseText = responseText.replace(/\[ESTATUS:.+?\]/, '').trim();
            // Buscar pedidos del contacto y actualizar estatus
            if (orderNumbers && orderNumbers.length > 0) {
                for (const orderNum of orderNumbers) {
                    const orderQuery = await db.collection('pedidos')
                        .where('consecutiveOrderNumber', '==', orderNum)
                        .limit(1).get();
                    if (!orderQuery.empty) {
                        await orderQuery.docs[0].ref.update({ estatus: newStatus });
                        console.log(`[Cobranza] Estatus de DH${orderNum} cambiado a: ${newStatus}`);
                    }
                }
            }
        }

        // 11. Detectar si es un shortcut de respuesta rápida
        const shortcutMatch = responseText.match(/^\/(\S+)$/);
        let sendResult;

        if (shortcutMatch) {
            const shortcut = shortcutMatch[1];
            const qr = quickRepliesData.find(q => q.shortcut === shortcut);
            if (qr) {
                sendResult = await sendAdvancedWhatsAppMessage(contactId, {
                    text: qr.message || '',
                    fileUrl: qr.fileUrl || null,
                    fileType: qr.fileType || null
                });
            } else {
                // Shortcut no encontrado, enviar como texto
                sendResult = await sendAdvancedWhatsAppMessage(contactId, { text: responseText });
            }
        }
        // 12. Detectar si es plantilla (chat cerrado)
        else if (responseText.includes('[TEMPLATE:')) {
            const templateMatch = responseText.match(/\[TEMPLATE:(.+?)\]/);
            if (templateMatch) {
                const templateName = templateMatch[1].trim();
                const template = templatesData.find(t => t.name === templateName);
                if (template) {
                    const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template);
                    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
                    const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
                    const tplResponse = await axios.post(
                        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
                        payload,
                        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
                    );
                    const messageId = tplResponse.data.messages[0].id;
                    sendResult = { id: messageId, textForDb: messageToSaveText };
                } else {
                    // Plantilla no encontrada, intentar enviar como texto normal
                    const cleanText = responseText.replace(/\[TEMPLATE:.+?\]/, '').trim();
                    if (cleanText) {
                        sendResult = await sendAdvancedWhatsAppMessage(contactId, { text: cleanText });
                    } else {
                        return res.json({ success: false, skipped: true, reason: `Plantilla '${templateName}' no encontrada` });
                    }
                }
            }
        }
        // 13. Mensaje normal
        else {
            sendResult = await sendAdvancedWhatsAppMessage(contactId, { text: responseText });
        }

        // 14. Guardar en historial de mensajes
        if (sendResult) {
            await contactRef.collection('messages').doc(sendResult.id).set({
                from: process.env.PHONE_NUMBER_ID || 'system',
                text: sendResult.textForDb,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'sent',
                id: sendResult.id,
                isAutoReply: true,
                ...(sendResult.fileUrlForDb ? { fileUrl: sendResult.fileUrlForDb, fileType: sendResult.fileTypeForDb } : {})
            });

            await contactRef.update({
                lastMessage: sendResult.textForDb,
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                lastCobranzaDate: todayMx
            });
        }

        res.json({
            success: true,
            message: 'Mensaje enviado',
            sentText: responseText,
            windowOpen,
            statusChanged: statusMatch ? statusMatch[1].trim() : null
        });

    } catch (error) {
        console.error('Error en cobranza individual:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// RETARGETING (mensajes masivos a pedidos Pagado)
// ============================================

// Cache en memoria de la lista de pedidos Pagado por rango.
// El servidor es persistente (no Cloud Functions), asi que el Map vive entre requests.
// Key: "YYYY-MM-DD_YYYY-MM-DD" (normalizamos a dia, no a timestamp exacto).
// Solo cacheamos la lista de pedidos; el flag retargetadoHoy se calcula en cada
// request (~17 lecturas pequenas para 500 telefonos) para no servir flags obsoletos.
const retargetingPedidosCache = new Map();
const RETARGETING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

function pruneRetargetingCache() {
    const now = Date.now();
    for (const [key, entry] of retargetingPedidosCache) {
        if (now - entry.cachedAt > RETARGETING_CACHE_TTL_MS) retargetingPedidosCache.delete(key);
    }
}

function dateKeyFromMillis(ms) {
    return new Date(Number(ms)).toISOString().slice(0, 10);
}

async function fetchContactosMetaMap(telefonos) {
    // Lee de contacts_whatsapp en batches de 30 (limite de Firestore para 'in').
    // Retorna { [telefono]: { lastRetargetingDate, satisfactionLevel } }
    const map = {};
    if (!telefonos.length) return map;
    for (let i = 0; i < telefonos.length; i += 30) {
        const batch = telefonos.slice(i, i + 30);
        const contactsSnap = await db.collection('contacts_whatsapp')
            .where(admin.firestore.FieldPath.documentId(), 'in', batch).get();
        contactsSnap.docs.forEach(doc => {
            const d = doc.data();
            map[doc.id] = {
                lastRetargetingDate: d.lastRetargetingDate || null,
                satisfactionLevel: d.satisfaction?.level || null
            };
        });
    }
    return map;
}

// Buscar pedidos Pagado por rango de fecha para retargeting
router.get('/retargeting/buscar-pedidos', async (req, res) => {
    try {
        const { startDate, endDate, fresh } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'Se requieren startDate y endDate.' });
        }

        const cacheKey = `${dateKeyFromMillis(startDate)}_${dateKeyFromMillis(endDate)}`;
        const todayMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

        let baseOrders = null;
        let cachedAt = null;
        let fromCache = false;

        if (fresh !== '1') {
            const entry = retargetingPedidosCache.get(cacheKey);
            if (entry && (Date.now() - entry.cachedAt) < RETARGETING_CACHE_TTL_MS) {
                baseOrders = entry.orders;
                cachedAt = entry.cachedAt;
                fromCache = true;
            }
        }

        if (!baseOrders) {
            const start = admin.firestore.Timestamp.fromMillis(Number(startDate));
            const end = admin.firestore.Timestamp.fromMillis(Number(endDate));

            const snapshot = await db.collection('pedidos')
                .where('estatus', '==', 'Pagado')
                .where('createdAt', '>=', start)
                .where('createdAt', '<=', end)
                .orderBy('createdAt', 'desc')
                .get();

            baseOrders = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    consecutiveOrderNumber: data.consecutiveOrderNumber,
                    producto: data.producto,
                    telefono: data.telefono,
                    precio: data.precio,
                    estatus: data.estatus,
                    createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
                };
            });

            cachedAt = Date.now();
            pruneRetargetingCache();
            retargetingPedidosCache.set(cacheKey, { cachedAt, orders: baseOrders });
        }

        // Siempre refrescar retargetadoHoy y satisfaccion (no se cachean para no servir datos obsoletos)
        const telefonos = [...new Set(baseOrders.map(o => o.telefono).filter(Boolean))];
        const metaMap = await fetchContactosMetaMap(telefonos);

        const orders = baseOrders.map(o => {
            const meta = metaMap[o.telefono] || {};
            return {
                ...o,
                retargetadoHoy: meta.lastRetargetingDate === todayMx,
                lastRetargetingDate: meta.lastRetargetingDate || null,
                satisfactionLevel: meta.satisfactionLevel || null
            };
        });

        res.json({
            success: true,
            orders,
            fromCache,
            cachedAt,
            cacheAgeMs: Date.now() - cachedAt
        });
    } catch (error) {
        console.error('Error buscando pedidos para retargeting:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Cache para contactos nuevos por departamento+rango
const retargetingNuevosCache = new Map();
function pruneRetargetingNuevosCache() {
    const now = Date.now();
    for (const [key, entry] of retargetingNuevosCache) {
        if (now - entry.cachedAt > RETARGETING_CACHE_TTL_MS) retargetingNuevosCache.delete(key);
    }
}

// Buscar contactos NUEVOS por departamento y rango de fecha (provenientes de anuncios de Meta)
// Devuelve contactos cuyo assignedDepartmentId == X y que tienen adReferral (vinieron de anuncio).
// El rango de fecha se aplica sobre lastMessageTimestamp (proxy útil de actividad reciente).
router.get('/retargeting/buscar-nuevos', async (req, res) => {
    try {
        const { departmentId, startDate, endDate, fresh } = req.query;
        if (!departmentId || !startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'Se requieren departmentId, startDate y endDate.' });
        }

        // v2: cache invalidado porque cambió el shape (ahora trae enteredAt y filtra por
        // fecha de primer mensaje real, no por lastMessageTimestamp).
        const cacheKey = `nuevos_v2_${departmentId}_${dateKeyFromMillis(startDate)}_${dateKeyFromMillis(endDate)}`;
        const todayMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
        const startMs = Number(startDate);
        const endMs = Number(endDate);

        let baseContacts = null;
        let cachedAt = null;
        let fromCache = false;

        if (fresh !== '1') {
            const entry = retargetingNuevosCache.get(cacheKey);
            if (entry && (Date.now() - entry.cachedAt) < RETARGETING_CACHE_TTL_MS) {
                baseContacts = entry.contacts;
                cachedAt = entry.cachedAt;
                fromCache = true;
            }
        }

        if (!baseContacts) {
            const start = admin.firestore.Timestamp.fromMillis(startMs);

            // Pre-filtro coarse por lastMessageTimestamp >= start.
            // Justificacion: si la ultima actividad del contacto es ANTERIOR a start,
            // entonces su primer mensaje tambien lo es → no nos sirve. Esto reduce
            // mucho el set sin perder candidatos validos.
            // El filtro fino por fecha de PRIMER mensaje (ingreso real al depto) se
            // hace despues leyendo la subcollection messages de cada candidato.
            let query = db.collection('contacts_whatsapp');
            if (departmentId.includes(',')) {
                const ids = departmentId.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
                query = query.where('assignedDepartmentId', 'in', ids);
            } else {
                query = query.where('assignedDepartmentId', '==', departmentId);
            }
            query = query
                .where('lastMessageTimestamp', '>=', start)
                .orderBy('lastMessageTimestamp', 'desc');

            const snapshot = await query.get();

            // Pre-filtra a los que vienen de un anuncio
            const candidates = snapshot.docs.filter(doc => {
                const d = doc.data();
                return d.adReferral && d.adReferral.source_id;
            });

            // Para cada candidato, lee el primer mensaje de su subcollection y
            // confirma que cae en [start, end]. Esto es el "ingreso real al depto".
            const enriched = await Promise.all(candidates.map(async (doc) => {
                try {
                    const firstMsgSnap = await doc.ref.collection('messages')
                        .orderBy('timestamp', 'asc')
                        .limit(1)
                        .get();

                    if (firstMsgSnap.empty) return null;
                    const firstMsgTs = firstMsgSnap.docs[0].data().timestamp;
                    if (!firstMsgTs || typeof firstMsgTs.toMillis !== 'function') return null;

                    const firstMsgMs = firstMsgTs.toMillis();
                    if (firstMsgMs < startMs || firstMsgMs > endMs) return null;

                    const d = doc.data();
                    return {
                        id: doc.id,
                        telefono: doc.id,
                        name: d.name || 'Sin nombre',
                        adName: d.adReferral.ad_name || d.adReferral.headline || d.adReferral.body || `ID: ${d.adReferral.source_id}`,
                        adId: d.adReferral.source_id || null,
                        sourceType: d.adReferral.source_type || null,
                        lastMessage: d.lastMessage || '',
                        lastMessageTimestamp: d.lastMessageTimestamp ? d.lastMessageTimestamp.toDate().toISOString() : null,
                        enteredAt: firstMsgTs.toDate().toISOString(),
                        assignedDepartmentId: d.assignedDepartmentId || null,
                        status: d.status || null,
                        purchaseStatus: d.purchaseStatus || null,
                        lastOrderNumber: d.lastOrderNumber || null,
                        purchaseValue: typeof d.purchaseValue === 'number' ? d.purchaseValue : null
                    };
                } catch (e) {
                    console.warn(`[buscar-nuevos] Error leyendo primer mensaje de ${doc.id}:`, e.message);
                    return null;
                }
            }));

            baseContacts = enriched
                .filter(Boolean)
                .sort((a, b) => new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime());

            cachedAt = Date.now();
            pruneRetargetingNuevosCache();
            retargetingNuevosCache.set(cacheKey, { cachedAt, contacts: baseContacts });
        }

        // Refrescar lastRetargetingDate y satisfaction en cada request (no cacheable)
        const telefonos = [...new Set(baseContacts.map(c => c.telefono).filter(Boolean))];
        const metaMap = await fetchContactosMetaMap(telefonos);

        const contacts = baseContacts.map(c => {
            const meta = metaMap[c.telefono] || {};
            return {
                ...c,
                retargetadoHoy: meta.lastRetargetingDate === todayMx,
                lastRetargetingDate: meta.lastRetargetingDate || null,
                satisfactionLevel: meta.satisfactionLevel || null
            };
        });

        res.json({
            success: true,
            contacts,
            fromCache,
            cachedAt,
            cacheAgeMs: Date.now() - cachedAt
        });
    } catch (error) {
        console.error('Error buscando contactos nuevos para retargeting:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Enviar mensaje de retargeting IA para un contacto
router.post('/retargeting/enviar', async (req, res) => {
    try {
        const { contactId, instructions, orderNumbers } = req.body;
        if (!contactId || !instructions) {
            return res.status(400).json({ success: false, message: 'Faltan contactId o instrucciones.' });
        }

        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.json({ success: false, skipped: true, reason: 'Contacto no encontrado en WhatsApp' });
        }

        const todayMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
        const contactData = contactDoc.data();
        if (contactData.lastRetargetingDate === todayMx) {
            return res.json({ success: false, skipped: true, reason: 'Ya se envió retargeting hoy' });
        }

        const messagesSnapshot = await contactRef.collection('messages')
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();

        // Si la conversación tiene mensajes de hoy (cualquier dirección), no molestar
        const hasMessagesToday = messagesSnapshot.docs.some(d => {
            const ts = d.data().timestamp?.toDate();
            if (!ts) return false;
            const msgDateMx = ts.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
            return msgDateMx === todayMx;
        });
        if (hasMessagesToday) {
            return res.json({ success: false, skipped: true, reason: 'Tiene conversación hoy' });
        }

        // Detectar ventana de 24h
        const lastInboundMsg = messagesSnapshot.docs.find(d => d.data().from === contactId);
        const lastInboundTime = lastInboundMsg?.data()?.timestamp?.toDate();
        const windowOpen = lastInboundTime && (Date.now() - lastInboundTime.getTime() < 24 * 60 * 60 * 1000);

        const conversationHistory = messagesSnapshot.docs.map(doc => {
            const d = doc.data();
            const fromLabel = d.from === contactId ? 'Cliente' : 'Asistente';
            return `${fromLabel}: ${d.text || ''}`;
        }).reverse().join('\n');

        // Respuestas guardadas
        const quickRepliesSnapshot = await db.collection('quick_replies').get();
        const quickRepliesData = quickRepliesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const quickRepliesContext = quickRepliesData.map(qr => {
            let entry = `/${qr.shortcut}: ${qr.message || ''}`;
            if (qr.fileUrl) entry += ` [ARCHIVO: ${qr.fileUrl}]`;
            return entry;
        }).join('\n');

        // Plantillas WhatsApp aprobadas (para chats cerrados)
        let templatesContext = '';
        let templatesData = [];
        try {
            const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
            const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
            if (WHATSAPP_BUSINESS_ACCOUNT_ID && WHATSAPP_TOKEN) {
                const tplRes = await axios.get(
                    `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`,
                    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, params: { limit: 100 } }
                );
                templatesData = (tplRes.data.data || [])
                    .filter(t => t.status === 'APPROVED')
                    .map(t => ({
                        name: t.name,
                        language: t.language,
                        components: t.components?.map(c => ({ type: c.type, text: c.text, format: c.format, buttons: c.buttons })) || []
                    }));
                templatesContext = templatesData.map(t => {
                    const body = t.components.find(c => c.type === 'BODY');
                    return `[TEMPLATE:${t.name}]: ${body?.text || '(sin texto)'}`;
                }).join('\n');
            }
        } catch (e) {
            console.warn('[Retargeting] Error cargando plantillas:', e.message);
        }

        const ordersInfo = orderNumbers ? `Pedidos previos del cliente (todos Pagado): ${orderNumbers.map(n => 'DH' + n).join(', ')}` : '';

        const windowStatus = windowOpen
            ? 'VENTANA DE 24H: ABIERTA - Puedes enviar mensaje normal o respuesta rápida.'
            : 'VENTANA DE 24H: CERRADA - Debes usar una plantilla. Responde con [TEMPLATE:nombre_plantilla]';

        const systemPrompt = `${instructions}

--- RESPUESTAS GUARDADAS DISPONIBLES ---
${quickRepliesContext}

--- PLANTILLAS DE WHATSAPP APROBADAS (para chats cerrados) ---
${templatesContext || '(ninguna disponible)'}

--- ESTADO DEL CHAT ---
${windowStatus}

--- FECHA DE HOY ---
Hoy es ${todayMx} (zona horaria America/Mexico_City, formato YYYY-MM-DD).

--- FORMATO DE RESPUESTA ---
- Para enviar una respuesta rápida: responde SOLAMENTE con el shortcut, ej: /a3
- Para enviar una plantilla (chat cerrado): responde con [TEMPLATE:nombre_plantilla]
- Para enviar un mensaje personalizado (chat abierto): escribe solo el mensaje
- Si decides que NO conviene re-contactar a este cliente: responde SKIP
- No incluyas "Asistente:" ni etiquetas extra.`;

        const dynamicPrompt = `${ordersInfo}

--- HISTORIAL DE CONVERSACIÓN ---
${conversationHistory || '(sin historial previo)'}

--- INSTRUCCIÓN ---
Analiza la conversación y decide qué mensaje de retargeting enviar al cliente. Recuerda que este cliente YA HA PAGADO al menos un pedido anteriormente.`;

        const aiResponse = await generateGeminiResponse(dynamicPrompt, [], systemPrompt);
        let responseText = aiResponse.text.trim();

        // Log de uso de tokens
        const today = new Date().toISOString().split('T')[0];
        const usageRef = db.collection('ai_usage_logs').doc(today);
        await usageRef.set({
            inputTokens: admin.firestore.FieldValue.increment(aiResponse.inputTokens),
            outputTokens: admin.firestore.FieldValue.increment(aiResponse.outputTokens),
            requestCount: admin.firestore.FieldValue.increment(1),
            date: today
        }, { merge: true });

        if (responseText.toUpperCase().includes('SKIP')) {
            return res.json({ success: false, skipped: true, reason: 'IA determinó que no conviene re-contactar' });
        }

        // Detectar shortcut
        const shortcutMatch = responseText.match(/^\/(\S+)$/);
        let sendResult;

        if (shortcutMatch) {
            const shortcut = shortcutMatch[1];
            const qr = quickRepliesData.find(q => q.shortcut === shortcut);
            if (qr) {
                sendResult = await sendAdvancedWhatsAppMessage(contactId, {
                    text: qr.message || '',
                    fileUrl: qr.fileUrl || null,
                    fileType: qr.fileType || null
                });
            } else {
                sendResult = await sendAdvancedWhatsAppMessage(contactId, { text: responseText });
            }
        }
        else if (responseText.includes('[TEMPLATE:')) {
            const templateMatch = responseText.match(/\[TEMPLATE:(.+?)\]/);
            if (templateMatch) {
                const templateName = templateMatch[1].trim();
                const template = templatesData.find(t => t.name === templateName);
                if (template) {
                    const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template);
                    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
                    const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
                    const tplResponse = await axios.post(
                        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
                        payload,
                        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
                    );
                    const messageId = tplResponse.data.messages[0].id;
                    sendResult = { id: messageId, textForDb: messageToSaveText };
                } else {
                    const cleanText = responseText.replace(/\[TEMPLATE:.+?\]/, '').trim();
                    if (cleanText) {
                        sendResult = await sendAdvancedWhatsAppMessage(contactId, { text: cleanText });
                    } else {
                        return res.json({ success: false, skipped: true, reason: `Plantilla '${templateName}' no encontrada` });
                    }
                }
            }
        }
        else {
            sendResult = await sendAdvancedWhatsAppMessage(contactId, { text: responseText });
        }

        if (sendResult) {
            await contactRef.collection('messages').doc(sendResult.id).set({
                from: process.env.PHONE_NUMBER_ID || 'system',
                text: sendResult.textForDb,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'sent',
                id: sendResult.id,
                isAutoReply: true,
                isRetargeting: true,
                ...(sendResult.fileUrlForDb ? { fileUrl: sendResult.fileUrlForDb, fileType: sendResult.fileTypeForDb } : {})
            });

            await contactRef.update({
                lastMessage: sendResult.textForDb,
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                lastRetargetingDate: todayMx
            });
        }

        res.json({
            success: true,
            message: 'Mensaje enviado',
            sentText: responseText,
            windowOpen
        });

    } catch (error) {
        console.error('Error en retargeting individual:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Enviar plantilla aprobada de Meta como retargeting (modo manual, sin IA)
router.post('/retargeting/enviar-plantilla', async (req, res) => {
    try {
        const { contactId, template, mediaUrl, batchId, batchTotal, sentBy } = req.body;
        if (!contactId || !template?.name) {
            return res.status(400).json({ success: false, message: 'Faltan contactId o template.' });
        }

        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        const contactDoc = await contactRef.get();
        if (!contactDoc.exists) {
            return res.json({ success: false, skipped: true, reason: 'Contacto no encontrado en WhatsApp' });
        }

        const todayMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
        const contactData = contactDoc.data();
        if (contactData.lastRetargetingDate === todayMx) {
            return res.json({ success: false, skipped: true, reason: 'Ya se envió retargeting hoy' });
        }

        const PHONE_NUMBER_ID_ENV = process.env.PHONE_NUMBER_ID;
        const WHATSAPP_TOKEN_ENV = process.env.WHATSAPP_TOKEN;
        if (!PHONE_NUMBER_ID_ENV || !WHATSAPP_TOKEN_ENV) {
            return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
        }

        const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template, mediaUrl || null);
        const tplResponse = await axios.post(
            `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID_ENV}/messages`,
            payload,
            { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN_ENV}`, 'Content-Type': 'application/json' } }
        );
        const messageId = tplResponse.data.messages[0].id;

        await contactRef.collection('messages').doc(messageId).set({
            from: PHONE_NUMBER_ID_ENV,
            text: messageToSaveText,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'sent',
            id: messageId,
            isRetargeting: true,
            ...extractTemplateMetadata(template, mediaUrl)
        });
        await contactRef.update({
            lastMessage: messageToSaveText,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            lastRetargetingDate: todayMx
        });

        // Tracking de plantilla (Fase 1)
        const effectiveBatchId = batchId || `ret_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await recordTemplateSend({
            contactId,
            contactName: contactData.name || null,
            template,
            wamid: messageId,
            source: 'retargeting_plantilla',
            batchId: effectiveBatchId,
            batchTotal: Number(batchTotal) || 1,
            sentBy: sentBy || null
        });

        res.json({ success: true, sentText: messageToSaveText, batchId: effectiveBatchId });
    } catch (error) {
        const detail = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error en retargeting (plantilla):', detail);
        res.status(500).json({ success: false, message: detail });
    }
});

// =============================================================
// TEMPLATE METRICS (Fase 3) — dashboard de efectividad de plantillas
// =============================================================
const TEMPLATE_PURCHASE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const TEMPLATE_METRICS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min — el dashboard se refresca seguido
const templateMetricsCache = new Map();

function pruneTemplateMetricsCache() {
    const now = Date.now();
    for (const [k, v] of templateMetricsCache) {
        if (now - v.cachedAt > TEMPLATE_METRICS_CACHE_TTL_MS) templateMetricsCache.delete(k);
    }
}

// Calcula los counts de un grupo de sends. Recibe array ya leido de docs.
function computeSendsCounts(sendsDocs) {
    const counts = { sent: 0, delivered: 0, read: 0, failed: 0, replied: 0, blocked: 0 };
    for (const d of sendsDocs) {
        const data = d.data ? d.data() : d;
        counts.sent++;
        if (data.status === 'delivered' || data.status === 'read') counts.delivered++;
        if (data.status === 'read') counts.read++;
        if (data.status === 'failed') counts.failed++;
        if (data.repliedAt) counts.replied++;
        if (data.blocked) counts.blocked++;
    }
    return counts;
}

// Atribuye compras a una tanda: queda con los pedidos Pagado de los contactos del batch
// creados entre batchCreatedAt y batchCreatedAt + 7d.
async function attributePurchases(batchCreatedAt, contactIds) {
    if (!contactIds.length) return { count: 0, value: 0 };
    const startMs = batchCreatedAt.toMillis();
    const endMs = startMs + TEMPLATE_PURCHASE_WINDOW_MS;
    // Query global de pedidos en la ventana — luego filtramos por telefono en memoria.
    const snap = await db.collection('pedidos')
        .where('estatus', '==', 'Pagado')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(startMs))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(endMs))
        .get();
    const contactSet = new Set(contactIds);
    let count = 0;
    let value = 0;
    for (const doc of snap.docs) {
        const d = doc.data();
        if (contactSet.has(d.telefono)) {
            count++;
            value += parseFloat(d.precio) || 0;
        }
    }
    return { count, value };
}

// GET /api/template-metrics/batches?from=&to=&template=&source=&aggregate=
// Lista tandas con sus metricas computadas
router.get('/template-metrics/batches', async (req, res) => {
    try {
        const { from, to, template, source, aggregate, fresh } = req.query;
        const cacheKey = `batches_${from || ''}_${to || ''}_${template || ''}_${source || ''}_${aggregate || ''}`;
        if (fresh !== '1') {
            const entry = templateMetricsCache.get(cacheKey);
            if (entry && (Date.now() - entry.cachedAt) < TEMPLATE_METRICS_CACHE_TTL_MS) {
                return res.json({ success: true, ...entry.data, fromCache: true, cacheAgeMs: Date.now() - entry.cachedAt });
            }
        }

        let batchQuery = db.collection('template_batches');
        if (from) batchQuery = batchQuery.where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(Number(from)));
        if (to) batchQuery = batchQuery.where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(Number(to)));
        if (template) batchQuery = batchQuery.where('templateName', '==', template);
        if (source) batchQuery = batchQuery.where('source', '==', source);
        batchQuery = batchQuery.orderBy('createdAt', 'desc').limit(200);

        const batchesSnap = await batchQuery.get();
        const batches = [];
        for (const batchDoc of batchesSnap.docs) {
            const b = batchDoc.data();
            const sendsSnap = await db.collection('template_sends')
                .where('batchId', '==', batchDoc.id)
                .get();
            const counts = computeSendsCounts(sendsSnap.docs);
            const contactIds = sendsSnap.docs.map(d => d.data().contactId).filter(Boolean);
            const purchases = await attributePurchases(b.createdAt, contactIds);
            batches.push({
                batchId: batchDoc.id,
                templateName: b.templateName,
                templateLanguage: b.templateLanguage || null,
                source: b.source,
                sentBy: b.sentBy || null,
                createdAt: b.createdAt ? b.createdAt.toDate().toISOString() : null,
                total: b.total || counts.sent,
                ...counts,
                purchasesCount: purchases.count,
                purchaseValue: purchases.value
            });
        }

        let response = { batches };

        // Agregacion opcional por plantilla (suma todas las tandas de cada template)
        if (aggregate === 'template') {
            const byTpl = new Map();
            for (const b of batches) {
                const key = b.templateName;
                if (!byTpl.has(key)) {
                    byTpl.set(key, {
                        templateName: key,
                        batchesCount: 0,
                        total: 0, sent: 0, delivered: 0, read: 0, failed: 0,
                        replied: 0, blocked: 0, purchasesCount: 0, purchaseValue: 0,
                        sources: new Set()
                    });
                }
                const acc = byTpl.get(key);
                acc.batchesCount++;
                acc.total += b.total;
                acc.sent += b.sent;
                acc.delivered += b.delivered;
                acc.read += b.read;
                acc.failed += b.failed;
                acc.replied += b.replied;
                acc.blocked += b.blocked;
                acc.purchasesCount += b.purchasesCount;
                acc.purchaseValue += b.purchaseValue;
                acc.sources.add(b.source);
            }
            response.aggregated = Array.from(byTpl.values()).map(r => ({
                ...r,
                sources: Array.from(r.sources)
            }));
        }

        pruneTemplateMetricsCache();
        templateMetricsCache.set(cacheKey, { cachedAt: Date.now(), data: response });
        res.json({ success: true, ...response, fromCache: false });
    } catch (err) {
        console.error('Error en template-metrics/batches:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/template-metrics/batches/:batchId - detalle por contacto
router.get('/template-metrics/batches/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;
        const batchDoc = await db.collection('template_batches').doc(batchId).get();
        if (!batchDoc.exists) {
            return res.status(404).json({ success: false, message: 'Batch no encontrado' });
        }
        const batchData = batchDoc.data();
        const sendsSnap = await db.collection('template_sends')
            .where('batchId', '==', batchId)
            .orderBy('sentAt', 'asc')
            .get();
        const sends = sendsSnap.docs.map(d => {
            const s = d.data();
            return {
                id: d.id,
                contactId: s.contactId,
                contactName: s.contactName || null,
                wamid: s.wamid,
                status: s.status,
                sentAt: s.sentAt ? s.sentAt.toDate().toISOString() : null,
                deliveredAt: s.deliveredAt ? s.deliveredAt.toDate().toISOString() : null,
                readAt: s.readAt ? s.readAt.toDate().toISOString() : null,
                repliedAt: s.repliedAt ? s.repliedAt.toDate().toISOString() : null,
                failedAt: s.failedAt ? s.failedAt.toDate().toISOString() : null,
                failureReason: s.failureReason || null,
                blocked: !!s.blocked
            };
        });

        // Atribuir compras por contacto
        const contactIds = sends.map(s => s.contactId);
        const startMs = batchData.createdAt.toMillis();
        const endMs = startMs + TEMPLATE_PURCHASE_WINDOW_MS;
        const pedidosSnap = await db.collection('pedidos')
            .where('estatus', '==', 'Pagado')
            .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(startMs))
            .where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(endMs))
            .get();
        const purchasesByContact = new Map();
        for (const pd of pedidosSnap.docs) {
            const d = pd.data();
            if (!purchasesByContact.has(d.telefono)) purchasesByContact.set(d.telefono, { count: 0, value: 0 });
            const acc = purchasesByContact.get(d.telefono);
            acc.count++;
            acc.value += parseFloat(d.precio) || 0;
        }
        for (const s of sends) {
            const p = purchasesByContact.get(s.contactId);
            s.purchasesCount = p?.count || 0;
            s.purchaseValue = p?.value || 0;
        }

        res.json({
            success: true,
            batch: {
                batchId,
                templateName: batchData.templateName,
                templateLanguage: batchData.templateLanguage || null,
                source: batchData.source,
                sentBy: batchData.sentBy || null,
                createdAt: batchData.createdAt ? batchData.createdAt.toDate().toISOString() : null,
                total: batchData.total
            },
            sends
        });
    } catch (err) {
        console.error('Error en template-metrics/batches/:id:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/template-metrics/templates - lista las plantillas usadas (para llenar el filtro)
router.get('/template-metrics/templates', async (_req, res) => {
    try {
        const snap = await db.collection('template_batches').get();
        const names = new Set();
        for (const d of snap.docs) {
            if (d.data().templateName) names.add(d.data().templateName);
        }
        res.json({ success: true, templates: Array.from(names).sort() });
    } catch (err) {
        console.error('Error listando plantillas:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// === Meta /template_analytics — metricas oficiales del WhatsApp Manager =================
// Cache nombre→id para no llamar /message_templates cada vez
const metaTemplateIdsCache = { ids: null, cachedAt: 0 };
const META_TEMPLATE_IDS_TTL_MS = 60 * 60 * 1000; // 1h

async function getMetaTemplateIdMap() {
    if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) {
        throw new Error('Faltan credenciales de WhatsApp Business.');
    }
    const now = Date.now();
    if (metaTemplateIdsCache.ids && now - metaTemplateIdsCache.cachedAt < META_TEMPLATE_IDS_TTL_MS) {
        return metaTemplateIdsCache.ids;
    }
    const map = new Map(); // name → id
    let url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    let params = { limit: 200, fields: 'id,name,status' };
    // Paginar por si hay muchas plantillas
    for (let i = 0; i < 10; i++) {
        const resp = await axios.get(url, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
            params: i === 0 ? params : undefined
        });
        for (const t of (resp.data?.data || [])) {
            if (t.name && t.id) map.set(t.name, t.id);
        }
        const nextUrl = resp.data?.paging?.next;
        if (!nextUrl) break;
        url = nextUrl;
        params = undefined;
    }
    metaTemplateIdsCache.ids = map;
    metaTemplateIdsCache.cachedAt = now;
    return map;
}

// Cache de respuestas del endpoint (5 min — Meta tarda algunas horas en actualizar igual)
const metaAnalyticsCache = new Map();
const META_ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;

// GET /api/template-metrics/meta-insights-status
// Verifica si la cuenta tiene activado is_enabled_for_insights (analytics oficiales de Meta).
router.get('/template-metrics/meta-insights-status', async (req, res) => {
    try {
        const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
        if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) {
            return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
        }
        const url = `https://graph.facebook.com/v22.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}`;
        const resp = await axios.get(url, {
            params: { fields: 'is_enabled_for_insights,name,id' },
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
        res.json({ success: true, enabled: !!resp.data?.is_enabled_for_insights, account: resp.data });
    } catch (err) {
        const detail = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error('Error en meta-insights-status:', detail);
        res.status(500).json({ success: false, message: err.message, detail });
    }
});

// POST /api/template-metrics/enable-meta-insights
// Activa el flag is_enabled_for_insights en la WhatsApp Business Account.
// Despues de activarlo, Meta empieza a poblar template_analytics (puede tardar 24-48h).
router.post('/template-metrics/enable-meta-insights', async (req, res) => {
    try {
        const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
        if (!WHATSAPP_BUSINESS_ACCOUNT_ID || !WHATSAPP_TOKEN) {
            return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp.' });
        }
        const url = `https://graph.facebook.com/v22.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}`;
        const resp = await axios.post(url, null, {
            params: { is_enabled_for_insights: true },
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
        // Invalidar cache de analytics
        metaAnalyticsCache.clear();
        res.json({ success: true, data: resp.data });
    } catch (err) {
        const detail = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error('Error en enable-meta-insights:', detail);
        res.status(500).json({ success: false, message: err.message, detail });
    }
});

// =============================================================
// AUDIENCIAS — Fase 2 del sistema de retargeting
// Cinco grupos con sub-estados (Limbo / Listos / Contactados).
// Tiempos basados en psicología del consumidor + best practices de marketing.
// =============================================================
const AUDIENCIA_CONFIG = {
    sinPagar: {
        limboHours: 4,
        listosMaxDays: 30, // Ampliado: incluye pedidos viejos sin pagar (no solo 7 días)
        cooldownDays: 3
    },
    sinDatos: {
        limboHours: 2,
        listosMaxDays: 5,
        cooldownDays: 2
    },
    enVisto: {
        limboHours: 24,
        listosMaxDays: 21,
        cooldownDays: 14
    },
    recompra: {
        calienteMin: 30, calienteMax: 60,
        optimaMin: 60, optimaMax: 120,
        ultimaMin: 120, ultimaMax: 180,
        cooldownDays: 30
    },
    inactivos: {
        tibioMin: 180, tibioMax: 365,
        frioMin: 365, frioMax: 730,
        hibernadoMin: 730,
        tibioCooldownDays: 45,
        frioCooldownDays: 60,
        hibernadoCooldownDays: 90
    },
    cooldownGlobalDays: 7 // Cualquier mensaje en los últimos 7 días → en cooldown
};

// Cache por rango de fechas (key = `${from}_${to}`)
const audienciasCacheMap = new Map();
const AUDIENCIAS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min

// Núcleo de cálculo de audiencias. Devuelve { payload (conteos), miembros (listas) }.
// Tanto /conteos como /detalle lo usan vía getAudienciasCached.
async function computeAudiencias(fromMs, toMs) {
    const inDateRange = (ms) => {
        if (!ms) return false;
        if (fromMs && ms < fromMs) return false;
        if (toMs && ms > toMs) return false;
        return true;
    };
    const dateRangeIsSet = !!(fromMs || toMs);

    const now = Date.now();
    const cfg = AUDIENCIA_CONFIG;
    const msH = 60 * 60 * 1000;
    const msD = 24 * msH;
    const tsToMs = (ts) => ts?.toMillis?.() || (ts?.toDate?.()?.getTime?.()) || 0;

    // Estructura de miembros (mismas claves que los conteos). Cap por bucket para
    // no consumir memoria sin límite.
    const MAX_POR_BUCKET = 2000;
    const miembros = {
        sinPagar: { limbo: [], listos: [], contactados: [] },
        sinDatos: { limbo: [], listos: [], contactados: [] },
        enVisto: { limbo: [], listos: [], contactados: [] },
        recompra: { caliente: { listos: [], contactados: [] }, optima: { listos: [], contactados: [] }, ultima: { listos: [], contactados: [] } },
        inactivos: { tibio: { listos: [], contactados: [] }, frio: { listos: [], contactados: [] }, hibernado: { listos: [], contactados: [] } }
    };
    const push = (arr, obj) => { if (arr.length < MAX_POR_BUCKET) arr.push(obj); };

    // === 0) Total de contactos en el CRM (global, no afectado por el rango de fechas) ===
    let totalContactos = 0;
    try {
        const totalSnap = await db.collection('contacts_whatsapp').count().get();
        totalContactos = totalSnap.data().count || 0;
    } catch (e) {
        console.error('[AUDIENCIAS] No se pudo contar contactos:', e.message);
    }

    // === 1) No Molestar ===
    const noMolestarSet = new Set();
    try {
        const nmSnap = await db.collection('contacts_whatsapp').where('noContact', '==', true).select().get();
        nmSnap.docs.forEach(d => noMolestarSet.add(d.id));
    } catch (_) { /* índice opcional */ }

    // === 2) Cooldown global (mensajes últimos 7 días) ===
    const cooldownStartMs = now - cfg.cooldownGlobalDays * msD;
    const cooldownSet = new Set();
    const sendsRecientesSnap = await db.collection('template_sends')
        .where('sentAt', '>=', admin.firestore.Timestamp.fromMillis(cooldownStartMs))
        .select('contactId', 'sentAt', 'templateName')
        .get();
    const ultimoEnvioPorContacto = new Map();
    for (const d of sendsRecientesSnap.docs) {
        const data = d.data();
        if (!data.contactId) continue;
        cooldownSet.add(data.contactId);
        const ms = tsToMs(data.sentAt);
        const prev = ultimoEnvioPorContacto.get(data.contactId);
        if (!prev || ms > prev.ms) ultimoEnvioPorContacto.set(data.contactId, { ms, templateName: data.templateName });
    }

    // === 3) SIN PAGAR ===
    const sinPagar = { total: 0, limbo: 0, listos: 0, contactados: 0, montoTotal: 0 };
    const sinPagarVentanaMs = cfg.sinPagar.listosMaxDays * msD;
    const sinPagarStartMs = now - sinPagarVentanaMs;
    const ESTATUS_EXCLUIDOS_SIN_PAGAR = new Set(['Pagado', 'Cancelado', 'Devolucion', 'Devolución', 'Entregado']);
    const sinPagarPedidosSnap = await db.collection('pedidos')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(sinPagarStartMs))
        .orderBy('createdAt', 'desc').limit(3000).get();
    for (const d of sinPagarPedidosSnap.docs) {
        const p = d.data();
        const tel = p.telefono;
        if (!tel || noMolestarSet.has(tel)) continue;
        const estatus = p.estatus || 'Sin estatus';
        if (ESTATUS_EXCLUIDOS_SIN_PAGAR.has(estatus)) continue;
        const createdMs = tsToMs(p.createdAt);
        if (!createdMs) continue;
        if (dateRangeIsSet && !inDateRange(createdMs)) continue;
        const ageMs = now - createdMs;
        const monto = parseFloat(p.precio) || 0;
        sinPagar.total++;
        sinPagar.montoTotal += monto;
        const ultimo = ultimoEnvioPorContacto.get(tel);
        const enCooldown = ultimo && (now - ultimo.ms) < cfg.sinPagar.cooldownDays * msD;
        const row = { orderNumber: p.consecutiveOrderNumber ? 'DH' + p.consecutiveOrderNumber : null, phone: tel, dateMs: createdMs, amount: monto, estatus, producto: p.producto || null };
        let estado;
        if (ageMs < cfg.sinPagar.limboHours * msH) { sinPagar.limbo++; estado = 'limbo'; }
        else if (enCooldown) { sinPagar.contactados++; estado = 'contactados'; }
        else { sinPagar.listos++; estado = 'listos'; }
        push(miembros.sinPagar[estado], row);
    }

    // === 4) SIN DATOS ===
    const sinDatos = { total: 0, limbo: 0, listos: 0, contactados: 0 };
    const pagadosRecientesSnap = await db.collection('pedidos')
        .where('estatus', '==', 'Pagado')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(now - cfg.sinDatos.listosMaxDays * msD * 2))
        .orderBy('createdAt', 'desc').limit(1000).get();
    const datosEnvioRecientesSnap = await db.collection('datos_envio')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(now - 30 * msD))
        .select('numeroPedido').get();
    const numerosConDatos = new Set(datosEnvioRecientesSnap.docs.map(d => String(d.data().numeroPedido || '').replace(/\D/g, '')));
    for (const d of pagadosRecientesSnap.docs) {
        const p = d.data();
        const tel = p.telefono;
        if (!tel || noMolestarSet.has(tel)) continue;
        const consecNum = String(p.consecutiveOrderNumber || '').replace(/\D/g, '');
        if (numerosConDatos.has(consecNum)) continue;
        const createdMs = tsToMs(p.createdAt);
        if (!createdMs) continue;
        if (dateRangeIsSet && !inDateRange(createdMs)) continue;
        const ageMs = now - createdMs;
        if (ageMs > cfg.sinDatos.listosMaxDays * msD) continue;
        sinDatos.total++;
        const ultimo = ultimoEnvioPorContacto.get(tel);
        const enCooldown = ultimo && (now - ultimo.ms) < cfg.sinDatos.cooldownDays * msD;
        const row = { orderNumber: p.consecutiveOrderNumber ? 'DH' + p.consecutiveOrderNumber : null, phone: tel, dateMs: createdMs, amount: parseFloat(p.precio) || 0, estatus: 'Pagado', producto: p.producto || null };
        let estado;
        if (ageMs < cfg.sinDatos.limboHours * msH) { sinDatos.limbo++; estado = 'limbo'; }
        else if (enCooldown) { sinDatos.contactados++; estado = 'contactados'; }
        else { sinDatos.listos++; estado = 'listos'; }
        push(miembros.sinDatos[estado], row);
    }

    // === 5) EN VISTO ===
    const enVisto = { total: 0, limbo: 0, listos: 0, contactados: 0 };
    const contactosActivosSnap = await db.collection('contacts_whatsapp')
        .where('lastMessageTimestamp', '>=', admin.firestore.Timestamp.fromMillis(now - cfg.enVisto.listosMaxDays * msD))
        .orderBy('lastMessageTimestamp', 'desc').limit(3000).get();
    const telConPedidoReciente = new Set();
    for (const d of sinPagarPedidosSnap.docs) { const t = d.data().telefono; if (t) telConPedidoReciente.add(t); }
    for (const d of pagadosRecientesSnap.docs) { const t = d.data().telefono; if (t) telConPedidoReciente.add(t); }
    for (const d of contactosActivosSnap.docs) {
        const c = d.data();
        const tel = d.id;
        if (noMolestarSet.has(tel)) continue;
        if (telConPedidoReciente.has(tel)) continue;
        if (c.unreadCount && c.unreadCount > 0) continue;
        const lastMs = tsToMs(c.lastMessageTimestamp);
        if (!lastMs) continue;
        if (dateRangeIsSet && !inDateRange(lastMs)) continue;
        const ageMs = now - lastMs;
        if (ageMs > cfg.enVisto.listosMaxDays * msD) continue;
        enVisto.total++;
        const ultimo = ultimoEnvioPorContacto.get(tel);
        const enCooldown = ultimo && (now - ultimo.ms) < cfg.enVisto.cooldownDays * msD;
        const row = { orderNumber: null, phone: tel, name: c.name || c.nombre || null, dateMs: lastMs, lastMessage: (c.lastMessage || '').slice(0, 60) };
        let estado;
        if (ageMs < cfg.enVisto.limboHours * msH) { enVisto.limbo++; estado = 'limbo'; }
        else if (enCooldown) { enVisto.contactados++; estado = 'contactados'; }
        else { enVisto.listos++; estado = 'listos'; }
        push(miembros.enVisto[estado], row);
    }

    // === 6) RECOMPRA + INACTIVOS ===
    const recompra = { total: 0, caliente: { total: 0, listos: 0, contactados: 0 }, optima: { total: 0, listos: 0, contactados: 0 }, ultima: { total: 0, listos: 0, contactados: 0 } };
    const inactivos = { total: 0, tibio: { total: 0, listos: 0, contactados: 0 }, frio: { total: 0, listos: 0, contactados: 0 }, hibernado: { total: 0, listos: 0, contactados: 0 }, montoTotalLTV: 0 };
    const dosAñosAtrasMs = now - 730 * msD;
    const pedidosHistSnap = await db.collection('pedidos')
        .where('estatus', '==', 'Pagado')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(dosAñosAtrasMs))
        .orderBy('createdAt', 'desc').limit(5000).get();
    const ultimoPedidoPorTel = new Map();
    for (const d of pedidosHistSnap.docs) {
        const p = d.data();
        const tel = p.telefono;
        if (!tel || noMolestarSet.has(tel)) continue;
        const createdMs = tsToMs(p.createdAt);
        if (!createdMs) continue;
        if (!ultimoPedidoPorTel.has(tel)) {
            ultimoPedidoPorTel.set(tel, { createdMs, precio: parseFloat(p.precio) || 0, orderNumber: p.consecutiveOrderNumber ? 'DH' + p.consecutiveOrderNumber : null, producto: p.producto || null });
        }
    }
    const recompraCooldownMs = cfg.recompra.cooldownDays * msD;
    for (const [tel, info] of ultimoPedidoPorTel) {
        if (dateRangeIsSet && !inDateRange(info.createdMs)) continue;
        const daysAgo = (now - info.createdMs) / msD;
        const ultimo = ultimoEnvioPorContacto.get(tel);
        const enCooldownRecompra = ultimo && (now - ultimo.ms) < recompraCooldownMs;
        const row = { orderNumber: info.orderNumber, phone: tel, dateMs: info.createdMs, amount: info.precio, producto: info.producto, diasDesdeCompra: Math.round(daysAgo) };

        if (daysAgo >= cfg.recompra.calienteMin && daysAgo < cfg.recompra.calienteMax) {
            recompra.caliente.total++; recompra.total++;
            const est = enCooldownRecompra ? 'contactados' : 'listos';
            recompra.caliente[est]++; push(miembros.recompra.caliente[est], row);
        } else if (daysAgo >= cfg.recompra.optimaMin && daysAgo < cfg.recompra.optimaMax) {
            recompra.optima.total++; recompra.total++;
            const est = enCooldownRecompra ? 'contactados' : 'listos';
            recompra.optima[est]++; push(miembros.recompra.optima[est], row);
        } else if (daysAgo >= cfg.recompra.ultimaMin && daysAgo < cfg.recompra.ultimaMax) {
            recompra.ultima.total++; recompra.total++;
            const est = enCooldownRecompra ? 'contactados' : 'listos';
            recompra.ultima[est]++; push(miembros.recompra.ultima[est], row);
        } else if (daysAgo >= cfg.inactivos.tibioMin && daysAgo < cfg.inactivos.tibioMax) {
            inactivos.tibio.total++; inactivos.total++; inactivos.montoTotalLTV += info.precio;
            const enCd = ultimo && (now - ultimo.ms) < cfg.inactivos.tibioCooldownDays * msD;
            const est = enCd ? 'contactados' : 'listos';
            inactivos.tibio[est]++; push(miembros.inactivos.tibio[est], row);
        } else if (daysAgo >= cfg.inactivos.frioMin && daysAgo < cfg.inactivos.frioMax) {
            inactivos.frio.total++; inactivos.total++; inactivos.montoTotalLTV += info.precio;
            const enCd = ultimo && (now - ultimo.ms) < cfg.inactivos.frioCooldownDays * msD;
            const est = enCd ? 'contactados' : 'listos';
            inactivos.frio[est]++; push(miembros.inactivos.frio[est], row);
        } else if (daysAgo >= cfg.inactivos.hibernadoMin) {
            inactivos.hibernado.total++; inactivos.total++; inactivos.montoTotalLTV += info.precio;
            const enCd = ultimo && (now - ultimo.ms) < cfg.inactivos.hibernadoCooldownDays * msD;
            const est = enCd ? 'contactados' : 'listos';
            inactivos.hibernado[est]++; push(miembros.inactivos.hibernado[est], row);
        }
    }

    const payload = {
        calculadoEn: new Date().toISOString(),
        config: cfg,
        totalContactos,
        range: { from: fromMs, to: toMs },
        grupos: { sinPagar, sinDatos, enVisto, recompra, inactivos },
        noMolestar: noMolestarSet.size,
        enCooldownGlobal: cooldownSet.size
    };
    return { payload, miembros };
}

// Devuelve { payload, miembros } usando cache por rango (2 min).
async function getAudienciasCached(fromMs, toMs, fresh) {
    const cacheKey = `${fromMs || ''}_${toMs || ''}`;
    if (fresh !== '1' && audienciasCacheMap.has(cacheKey)) {
        const cached = audienciasCacheMap.get(cacheKey);
        if ((Date.now() - cached.cachedAt) < AUDIENCIAS_CACHE_TTL_MS) {
            return { ...cached, fromCache: true, cacheAgeMs: Date.now() - cached.cachedAt };
        }
    }
    const { payload, miembros } = await computeAudiencias(fromMs, toMs);
    const entry = { data: payload, miembros, cachedAt: Date.now() };
    audienciasCacheMap.set(cacheKey, entry);
    if (audienciasCacheMap.size > 20) {
        const firstKey = audienciasCacheMap.keys().next().value;
        audienciasCacheMap.delete(firstKey);
    }
    return { ...entry, fromCache: false };
}

// GET /api/audiencias/conteos?from=<ms>&to=<ms>
// Devuelve solo los conteos (rápido, sin listas).
router.get('/audiencias/conteos', async (req, res) => {
    try {
        const { fresh, from, to } = req.query;
        const fromMs = from ? Number(from) : null;
        const toMs = to ? Number(to) : null;
        const { data, fromCache, cacheAgeMs } = await getAudienciasCached(fromMs, toMs, fresh);
        res.json({ success: true, ...data, fromCache, cacheAgeMs });
    } catch (err) {
        console.error('Error en audiencias/conteos:', err);
        const msg = err.message || 'Error interno';
        if (msg.includes('index') || msg.includes('requires an index')) {
            return res.status(500).json({ success: false, message: 'Falta índice de Firestore para alguna query de audiencias. Revisa logs del server.', detail: msg });
        }
        res.status(500).json({ success: false, message: msg });
    }
});

// GET /api/audiencias/detalle?grupo=X&estado=Y[&sub=Z][&from=&to=]
// Devuelve la lista de personas de un grupo/sub-estado (carga bajo demanda).
// grupo: sinPagar | sinDatos | enVisto | recompra | inactivos
// sub (solo recompra/inactivos): caliente|optima|ultima | tibio|frio|hibernado
// estado: limbo | listos | contactados
router.get('/audiencias/detalle', async (req, res) => {
    try {
        const { grupo, sub, estado, from, to } = req.query;
        if (!grupo || !estado) {
            return res.status(400).json({ success: false, message: 'Faltan parámetros grupo y estado' });
        }
        const fromMs = from ? Number(from) : null;
        const toMs = to ? Number(to) : null;
        const { miembros } = await getAudienciasCached(fromMs, toMs, '0');

        let lista;
        if (sub) {
            lista = miembros?.[grupo]?.[sub]?.[estado];
        } else {
            lista = miembros?.[grupo]?.[estado];
        }
        if (!Array.isArray(lista)) {
            return res.status(404).json({ success: false, message: 'Grupo/estado no encontrado', grupo, sub, estado });
        }
        // Ordenar por fecha desc (más reciente primero)
        const ordenada = lista.slice().sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
        res.json({
            success: true,
            grupo, sub: sub || null, estado,
            total: ordenada.length,
            personas: ordenada
        });
    } catch (err) {
        console.error('Error en audiencias/detalle:', err);
        res.status(500).json({ success: false, message: err.message || 'Error interno' });
    }
});

// =============================================================
// CENSO — "Resumen de tu base": parte TODOS los contactos del CRM en
// grupos mutuamente excluyentes que SUMAN al total. Es el complemento de
// las audiencias (que son bandejas de acción acotadas por ventanas de tiempo).
// Recorre toda la colección, así que va en su propio cache largo (30 min).
// =============================================================
const CENSO_ACTIVO_DIAS = 30; // nunca-compró: activo si escribió en este rango, si no, frío
const censoCacheMap = new Map();
const CENSO_CACHE_TTL_MS = 30 * 60 * 1000;

async function computeCenso(fromMs, toMs) {
    const now = Date.now();
    const msD = 24 * 60 * 60 * 1000;
    const tsToMs = (ts) => ts?.toMillis?.() || (ts?.toDate?.()?.getTime?.()) || 0;
    const norm = (t) => String(t || '').replace(/\D/g, '').slice(-10); // últimos 10 dígitos (52/521)
    const activoCutoff = now - CENSO_ACTIVO_DIAS * msD;
    const rangeSet = !!(fromMs || toMs);
    const inRange = (ms) => {
        if (!ms) return false;
        if (fromMs && ms < fromMs) return false;
        if (toMs && ms > toMs) return false;
        return true;
    };

    // 1) # de compras por teléfono (pedidos Pagado o Entregado)
    const buyerCount = new Map();
    const pagadosSnap = await db.collection('pedidos')
        .where('estatus', 'in', ['Pagado', 'Entregado'])
        .select('telefono').get();
    for (const d of pagadosSnap.docs) {
        const tel = norm(d.data().telefono);
        if (!tel) continue;
        buyerCount.set(tel, (buyerCount.get(tel) || 0) + 1);
    }

    // 2) Recorrer TODOS los contactos en lotes (memoria acotada en Render)
    const counts = { compraron1vez: 0, recurrentes: 0, nuncaActivos: 0, nuncaFrios: 0 };
    const miembros = { compraron1vez: [], recurrentes: [], nuncaActivos: [], nuncaFrios: [] };
    const MAX_POR_BUCKET = 2000;
    const pushM = (arr, obj) => { if (arr.length < MAX_POR_BUCKET) arr.push(obj); };
    let total = 0, noMolestar = 0;

    const PER_BATCH = 10000;
    let last = null;
    while (true) {
        let q = db.collection('contacts_whatsapp')
            .orderBy(admin.firestore.FieldPath.documentId())
            .select('lastMessageTimestamp', 'noContact', 'name')
            .limit(PER_BATCH);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) break;
        for (const d of snap.docs) {
            const c = d.data();
            total++;
            if (c.noContact === true) noMolestar++;
            const n = buyerCount.get(norm(d.id)) || 0;
            const lastMs = tsToMs(c.lastMessageTimestamp);
            let bucket;
            if (n === 1) bucket = 'compraron1vez';
            else if (n >= 2) bucket = 'recurrentes';
            else bucket = (lastMs >= activoCutoff) ? 'nuncaActivos' : 'nuncaFrios';
            counts[bucket]++;
            if (!rangeSet || inRange(lastMs)) {
                pushM(miembros[bucket], { phone: d.id, name: c.name || null, dateMs: lastMs, compras: n });
            }
        }
        last = snap.docs[snap.docs.length - 1].id;
        if (snap.size < PER_BATCH) break;
    }

    const payload = { calculadoEn: new Date().toISOString(), total, noMolestar, activoDias: CENSO_ACTIVO_DIAS, counts };
    return { payload, miembros };
}

async function getCensoCached(fromMs, toMs, fresh) {
    const key = `${fromMs || ''}_${toMs || ''}`;
    if (fresh !== '1' && censoCacheMap.has(key)) {
        const cached = censoCacheMap.get(key);
        if ((Date.now() - cached.at) < CENSO_CACHE_TTL_MS) return cached;
    }
    const { payload, miembros } = await computeCenso(fromMs, toMs);
    const entry = { at: Date.now(), payload, miembros };
    censoCacheMap.set(key, entry);
    if (censoCacheMap.size > 20) { const k = censoCacheMap.keys().next().value; censoCacheMap.delete(k); }
    return entry;
}

// GET /api/audiencias/censo[?from=&to=&fresh=1] — conteos del censo (suman al total)
router.get('/audiencias/censo', async (req, res) => {
    try {
        const { fresh, from, to } = req.query;
        const fromMs = from ? Number(from) : null;
        const toMs = to ? Number(to) : null;
        const entry = await getCensoCached(fromMs, toMs, fresh);
        const cacheAgeMs = Date.now() - entry.at;
        res.json({ success: true, ...entry.payload, fromCache: cacheAgeMs > 50, cacheAgeMs });
    } catch (err) {
        console.error('Error en audiencias/censo:', err);
        const msg = err.message || 'Error interno';
        if (msg.includes('index') || msg.includes('requires an index')) {
            return res.status(500).json({ success: false, message: 'Falta índice de Firestore para el censo. Revisa logs del server.', detail: msg });
        }
        res.status(500).json({ success: false, message: msg });
    }
});

// GET /api/audiencias/censo/detalle?bucket=X[&from=&to=] — lista de personas de un grupo del censo
router.get('/audiencias/censo/detalle', async (req, res) => {
    try {
        const { bucket, from, to } = req.query;
        if (!bucket) return res.status(400).json({ success: false, message: 'Falta el parámetro bucket' });
        const fromMs = from ? Number(from) : null;
        const toMs = to ? Number(to) : null;
        const entry = await getCensoCached(fromMs, toMs, '0');
        const lista = entry.miembros?.[bucket];
        if (!Array.isArray(lista)) return res.status(404).json({ success: false, message: 'Grupo no encontrado', bucket });
        const ordenada = lista.slice().sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
        res.json({ success: true, bucket, total: ordenada.length, personas: ordenada });
    } catch (err) {
        console.error('Error en audiencias/censo/detalle:', err);
        res.status(500).json({ success: false, message: err.message || 'Error interno' });
    }
});

// GET /api/retargeting/conversion-stats?templateName=X[&from=ms][&to=ms]
// Devuelve { enviados, conversiones, ingreso, gasto } para auto-llenar la calculadora.
// - enviados: contactos únicos en template_sends con templateName=X (menos failed/blocked)
// - conversiones: pedidos donde campana_id="tpl:X" (opcionalmente filtrados por createdAt en rango)
// - ingreso: suma de precio en esos pedidos
// - gasto: enviados × tarifa promedio (USD 0.034 default; override con ?tarifa=)
router.get('/retargeting/conversion-stats', async (req, res) => {
    try {
        const { templateName, from, to, tarifa } = req.query;
        if (!templateName) {
            return res.status(400).json({ success: false, message: 'Falta templateName' });
        }
        const ratePerMsg = Number(tarifa) || 0.034; // USD por mensaje

        // 1) Enviados: template_sends con templateName + status != failed/blocked
        let sendsQuery = db.collection('template_sends').where('templateName', '==', templateName);
        if (from) sendsQuery = sendsQuery.where('sentAt', '>=', admin.firestore.Timestamp.fromMillis(Number(from)));
        if (to) sendsQuery = sendsQuery.where('sentAt', '<=', admin.firestore.Timestamp.fromMillis(Number(to)));
        const sendsSnap = await sendsQuery.get();

        const uniqueContacts = new Set();
        let failed = 0, blocked = 0;
        for (const d of sendsSnap.docs) {
            const data = d.data();
            if (data.contactId) uniqueContacts.add(data.contactId);
            if (data.status === 'failed') failed++;
            if (data.blocked) blocked++;
        }
        const enviados = Math.max(0, uniqueContacts.size - failed - blocked);

        // 2) Conversiones e ingreso: pedidos con campana_id = "tpl:<templateName>"
        const campanaId = 'tpl:' + templateName;
        let pedidosQuery = db.collection('pedidos').where('campana_id', '==', campanaId);
        if (from) pedidosQuery = pedidosQuery.where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(Number(from)));
        if (to) pedidosQuery = pedidosQuery.where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(Number(to)));
        const pedidosSnap = await pedidosQuery.get();

        let conversiones = 0;
        let ingreso = 0;
        const pedidosDetalle = [];
        for (const d of pedidosSnap.docs) {
            const p = d.data();
            conversiones++;
            const precio = parseFloat(p.precio) || 0;
            ingreso += precio;
            pedidosDetalle.push({
                id: d.id,
                consecutiveOrderNumber: p.consecutiveOrderNumber || null,
                precio,
                estatus: p.estatus || null,
                createdAt: p.createdAt?.toDate?.()?.toISOString?.() || null
            });
        }

        // 3) Gasto: estimado por ahora (enviados × tarifa).
        // Si en el futuro tenemos meta-stats con costo real, se podría obtener de ahí.
        const gasto = enviados * ratePerMsg;

        res.json({
            success: true,
            templateName,
            enviados,
            conversiones,
            ingreso,
            gasto,
            tarifa: ratePerMsg,
            currency: 'USD',
            pedidos: pedidosDetalle.length <= 50 ? pedidosDetalle : pedidosDetalle.slice(0, 50),
            pedidosTotal: pedidosDetalle.length,
            range: { from: from || null, to: to || null }
        });
    } catch (err) {
        console.error('Error en conversion-stats:', err);
        const msg = err.message || 'Error interno';
        if (msg.includes('index')) {
            return res.status(500).json({
                success: false,
                message: 'Falta índice Firestore (pedidos por campana_id + createdAt). Revisa logs.',
                detail: msg
            });
        }
        res.status(500).json({ success: false, message: msg });
    }
});

// GET /api/template-metrics/meta-stats?from=<ms>&to=<ms>&templates=name1,name2
// Devuelve { stats: { [templateName]: { sent, delivered, read, clicked, costValue, costCurrency } } }
router.get('/template-metrics/meta-stats', async (req, res) => {
    try {
        const { from, to, templates: namesParam, fresh } = req.query;
        if (!from || !to || !namesParam) {
            return res.status(400).json({ success: false, message: 'Faltan from, to o templates' });
        }
        const names = String(namesParam).split(',').map(s => s.trim()).filter(Boolean);
        if (!names.length) return res.json({ success: true, stats: {} });

        const cacheKey = `${from}_${to}_${names.slice().sort().join('|')}`;
        if (fresh !== '1') {
            const hit = metaAnalyticsCache.get(cacheKey);
            if (hit && Date.now() - hit.cachedAt < META_ANALYTICS_CACHE_TTL_MS) {
                return res.json({ success: true, ...hit.data, fromCache: true, cacheAgeMs: Date.now() - hit.cachedAt });
            }
        }

        const nameToId = await getMetaTemplateIdMap();
        const idToName = new Map();
        const ids = [];
        const unresolved = [];
        for (const name of names) {
            const id = nameToId.get(name);
            if (id) { ids.push(id); idToName.set(String(id), name); }
            else unresolved.push(name);
        }

        const stats = {};
        // Mapa interno para acumular clics y tendencia diaria por plantilla
        const clickedAccum = new Map(); // templateName → Map(key → {label, type, count})
        const trendAccum = new Map(); // templateName → Map(dateStr → {sent,delivered,read,clicked})
        for (const n of names) {
            stats[n] = { sent: 0, delivered: 0, read: 0, clicked: 0, clickedBreakdown: [], trend: [], costValue: 0, costCurrency: null, resolved: !!nameToId.get(n), templateId: nameToId.get(n) || null };
            clickedAccum.set(n, new Map());
            trendAccum.set(n, new Map());
        }

        const debug = { totalDataPoints: 0, sampleDataPoint: null, requestUrl: null, idsRequested: ids.length, idsResolved: ids.length, unresolved };

        if (ids.length) {
            // Meta requiere segundos UNIX, no millis
            const startSec = Math.floor(Number(from) / 1000);
            const endSec = Math.floor(Number(to) / 1000);
            const url = `https://graph.facebook.com/v22.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/template_analytics`;
            const reqParams = {
                start: startSec,
                end: endSec,
                granularity: 'DAILY',
                metric_types: JSON.stringify(['SENT', 'DELIVERED', 'READ', 'CLICKED', 'COST']),
                template_ids: JSON.stringify(ids)
            };
            debug.requestUrl = `${url}?${new URLSearchParams(reqParams).toString()}`;

            const resp = await axios.get(url, {
                headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
                params: reqParams
            });

            // Algunos formatos devuelven multiples entradas en data[], iterar todas
            const dataPoints = [];
            for (const entry of (resp.data?.data || [])) {
                if (Array.isArray(entry?.data_points)) dataPoints.push(...entry.data_points);
            }
            debug.totalDataPoints = dataPoints.length;
            debug.rawDataEntries = resp.data?.data?.length || 0;
            // Sample con datos reales si existe; si no, el primero
            const sampleWithData = dataPoints.find(d => Number(d.sent || 0) > 0) || dataPoints[0];
            // Sample con cost.value si existe (para ver shape del cost lleno)
            const sampleWithCost = dataPoints.find(d => Array.isArray(d.cost) && d.cost.some(c => c.value != null));
            if (dataPoints.length) {
                debug.sampleDataPoint = sampleWithData;
                debug.sampleDataPointJson = JSON.stringify(sampleWithData);
                debug.sampleWithCostJson = sampleWithCost ? JSON.stringify(sampleWithCost) : null;
                debug.sampleTemplateIds = [...new Set(dataPoints.map(d => String(d.template_id || d.templateId || '')))].slice(0, 5);
                debug.idMapKeys = [...idToName.keys()].slice(0, 5);
                // Distribucion por template_id
                const byTid = new Map();
                for (const d of dataPoints) {
                    const tid = String(d.template_id ?? d.templateId ?? '');
                    if (!byTid.has(tid)) byTid.set(tid, { count: 0, sumSent: 0, sumDelivered: 0, sumCostValue: 0 });
                    const r = byTid.get(tid);
                    r.count++;
                    r.sumSent += Number(d.sent || 0);
                    r.sumDelivered += Number(d.delivered || 0);
                    if (Array.isArray(d.cost)) {
                        for (const c of d.cost) r.sumCostValue += Number(c.value || 0);
                    }
                }
                debug.byTemplateId = Object.fromEntries(byTid);
            }
            let matched = 0, unmatched = 0;

            for (const dp of dataPoints) {
                // v22.0 puede devolver template_id como number o string; tambien probar templateId
                const tid = String(dp.template_id ?? dp.templateId ?? '');
                const name = idToName.get(tid);
                if (!name) { unmatched++; continue; }
                matched++;
                const s = stats[name];
                const sent = Number(dp.sent || 0);
                const delivered = Number(dp.delivered || 0);
                const read = Number(dp.read || 0);
                let clickedDp = 0;
                s.sent += sent;
                s.delivered += delivered;
                s.read += read;
                if (Array.isArray(dp.clicked)) {
                    const acc = clickedAccum.get(name);
                    for (const c of dp.clicked) {
                        const count = Number(c.count || 0);
                        s.clicked += count;
                        clickedDp += count;
                        const label = c.button_content || c.label || c.text || '(sin etiqueta)';
                        const type = c.type || 'button';
                        const key = `${label}||${type}`;
                        if (!acc.has(key)) acc.set(key, { label, type, count: 0 });
                        acc.get(key).count += count;
                    }
                }
                if (Array.isArray(dp.cost)) {
                    for (const c of dp.cost) {
                        s.costValue += Number(c.value || 0);
                        if (c.currency && !s.costCurrency) s.costCurrency = c.currency;
                    }
                }
                // Tendencia diaria
                const dateStr = dp.start
                    ? new Date(dp.start * 1000).toISOString().slice(0, 10)
                    : null;
                if (dateStr) {
                    const tAcc = trendAccum.get(name);
                    if (!tAcc.has(dateStr)) tAcc.set(dateStr, { date: dateStr, sent: 0, delivered: 0, read: 0, clicked: 0 });
                    const t = tAcc.get(dateStr);
                    t.sent += sent;
                    t.delivered += delivered;
                    t.read += read;
                    t.clicked += clickedDp;
                }
            }
            debug.matched = matched;
            debug.unmatched = unmatched;
            // Volcar el desglose y la tendencia ordenados
            for (const n of names) {
                stats[n].clickedBreakdown = [...clickedAccum.get(n).values()]
                    .sort((a, b) => b.count - a.count);
                stats[n].trend = [...trendAccum.get(n).values()]
                    .sort((a, b) => a.date.localeCompare(b.date));
            }
        }

        const payload = { stats, unresolved, debug };
        metaAnalyticsCache.set(cacheKey, { cachedAt: Date.now(), data: payload });
        res.json({ success: true, ...payload, fromCache: false });
    } catch (err) {
        const detail = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error('Error en template-metrics/meta-stats:', detail);
        res.status(500).json({ success: false, message: err.message, detail });
    }
});

// ============================================
// SATISFACCION (clasificacion masiva con Gemini)
// ============================================

const pLimit = require('p-limit');

// Job tracking en memoria (servidor persistente, no Cloud Functions)
const satisfaccionJobs = new Map();
const SATISFACCION_JOB_TTL_MS = 60 * 60 * 1000; // 1h, luego se borra

// Cache del listado (mismo patron que retargeting): TTL 30 min
const satisfaccionListadoCache = new Map();
const SATISFACCION_LISTADO_TTL_MS = 30 * 60 * 1000;

function pruneSatisfaccionState() {
    const now = Date.now();
    for (const [id, job] of satisfaccionJobs) {
        if (job.finishedAt && now - job.finishedAt > SATISFACCION_JOB_TTL_MS) {
            satisfaccionJobs.delete(id);
        }
    }
    for (const [key, entry] of satisfaccionListadoCache) {
        if (now - entry.cachedAt > SATISFACCION_LISTADO_TTL_MS) {
            satisfaccionListadoCache.delete(key);
        }
    }
}

const SATISFACCION_LEVELS = ['positivo', 'neutral', 'negativo', 'sin_senal'];
const SATISFACCION_SYSTEM_PROMPT = `Eres un analista de servicio al cliente para una tienda mexicana que vende productos personalizados (cuadros, mugs, velas) por WhatsApp.

Tu tarea: leer el historial de una conversacion con un cliente y clasificar el nivel de satisfaccion del CLIENTE (no de la asistente) en una de tres categorias:

- **positivo**: el cliente expresa agrado, agradece, recompra, recomienda, da feedback bueno, o tiene un tono claramente contento.
- **negativo**: el cliente expresa molestia, queja activa, reclamo, frustracion, decepcion, amenaza con devolucion, o tono claramente molesto. Tambien si quedo sin respuesta tras una queja seria.
- **neutral**: conversacion normal, transaccional, sin senales emocionales claras en ninguna direccion. Ej: solo pregunto precio, hizo el pedido sin comentarios, conversacion corta sin opinion.

REGLAS:
- Te enfocas SOLO en lo que dice el cliente, no en lo que dice la asistente.
- Si el cliente repitio preocupaciones o quejas multiples veces sin resolver, es negativo aunque al final haya un mensaje cordial.
- Si solo hay 1-2 mensajes muy cortos y transaccionales, es neutral.
- Si la conversacion esta vacia o solo tiene mensajes nuestros, no clasifiques (te lo filtramos antes).

FORMATO DE RESPUESTA (estricto, una sola linea):
NIVEL|RAZON

Donde NIVEL es exactamente uno de: positivo, neutral, negativo
Y RAZON es una frase MUY corta (max 100 chars) en espanol explicando la decision.

Ejemplos:
positivo|Cliente agradecio el resultado y dijo que volveria a comprar
negativo|Cliente se quejo varias veces de la calidad sin recibir solucion
neutral|Solo pregunto precio y confirmo pedido, sin opinion expresada`;

function parseSatisfaccionResponse(text) {
    if (!text) return null;
    const line = text.split('\n')[0].trim();
    const sep = line.indexOf('|');
    if (sep < 0) return null;
    const rawLevel = line.slice(0, sep).trim().toLowerCase();
    const reason = line.slice(sep + 1).trim().slice(0, 200);
    if (!['positivo', 'neutral', 'negativo'].includes(rawLevel)) return null;
    return { level: rawLevel, reason };
}

async function classifyOneContact(contactDoc) {
    const contactId = contactDoc.id;
    const messagesSnap = await db.collection('contacts_whatsapp').doc(contactId)
        .collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

    // Mensajes utiles del cliente (con texto)
    const clientHasText = messagesSnap.docs.some(d => {
        const data = d.data();
        return data.from === contactId && (data.text || '').trim().length > 0;
    });

    if (!clientHasText) {
        return {
            level: 'sin_senal',
            reason: 'Sin mensajes de texto del cliente',
            messagesAnalyzed: messagesSnap.size,
            tokens: { input: 0, output: 0, cached: 0 }
        };
    }

    const conversationHistory = messagesSnap.docs.map(d => {
        const data = d.data();
        const who = data.from === contactId ? 'Cliente' : 'Asistente';
        const text = (data.text || '').replace(/\s+/g, ' ').trim();
        if (!text) return null;
        return `${who}: ${text}`;
    }).filter(Boolean).reverse().join('\n');

    const dynamicPrompt = `--- HISTORIAL DE CONVERSACION ---
${conversationHistory}

--- INSTRUCCION ---
Clasifica la satisfaccion del cliente.`;

    const aiResponse = await generateGeminiResponse(dynamicPrompt, [], SATISFACCION_SYSTEM_PROMPT);
    const parsed = parseSatisfaccionResponse(aiResponse.text);

    if (!parsed) {
        throw new Error(`Respuesta IA invalida: "${aiResponse.text}"`);
    }

    return {
        level: parsed.level,
        reason: parsed.reason,
        messagesAnalyzed: messagesSnap.size,
        tokens: {
            input: aiResponse.inputTokens || 0,
            output: aiResponse.outputTokens || 0,
            cached: aiResponse.cachedTokens || 0
        }
    };
}

async function getCandidateContactsByAudience(audience, limit, dateRange = null) {
    // Devuelve { docs, breakdown } donde breakdown describe los pasos del filtro
    // para poder diagnosticar de donde salen los numeros en la UI.

    if (audience === 'all') {
        let query = db.collection('contacts_whatsapp').orderBy('lastMessageTimestamp', 'desc');
        if (limit) query = query.limit(limit);
        const snap = await query.get();
        return {
            docs: snap.docs,
            breakdown: {
                source: 'contacts_whatsapp (toda la coleccion)',
                contactsTotal: snap.size,
                contactsLimited: snap.docs.length
            }
        };
    }

    // audience === 'pagado'
    let pagadoQuery = db.collection('pedidos').where('estatus', '==', 'Pagado');
    if (dateRange?.startMs) {
        pagadoQuery = pagadoQuery.where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(Number(dateRange.startMs)));
    }
    if (dateRange?.endMs) {
        pagadoQuery = pagadoQuery.where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(Number(dateRange.endMs)));
    }
    if (dateRange?.startMs || dateRange?.endMs) {
        pagadoQuery = pagadoQuery.orderBy('createdAt', 'desc');
    }
    const pagadoSnap = await pagadoQuery.get();
    const pedidosCount = pagadoSnap.size;

    const telefonos = [...new Set(pagadoSnap.docs.map(d => {
        const t = d.data().telefono;
        return t ? String(t).replace(/\D/g, '') : null;
    }).filter(Boolean))];
    const uniqueTelefonos = telefonos.length;

    const breakdown = {
        source: 'pedidos.estatus == Pagado',
        dateRange: dateRange ? {
            from: dateRange.startMs ? new Date(Number(dateRange.startMs)).toISOString() : null,
            to: dateRange.endMs ? new Date(Number(dateRange.endMs)).toISOString() : null
        } : null,
        pedidosCount,
        uniqueTelefonos,
        contactsFound: 0,
        contactsLimited: 0
    };

    if (uniqueTelefonos === 0) {
        return { docs: [], breakdown };
    }

    // Lookup batched a contacts_whatsapp (Firestore IN max 30)
    const docs = [];
    for (let i = 0; i < telefonos.length; i += 30) {
        const batch = telefonos.slice(i, i + 30);
        const snap = await db.collection('contacts_whatsapp')
            .where(admin.firestore.FieldPath.documentId(), 'in', batch).get();
        docs.push(...snap.docs);
    }

    breakdown.contactsFound = docs.length;
    const finalDocs = limit ? docs.slice(0, limit) : docs;
    breakdown.contactsLimited = finalDocs.length;
    return { docs: finalDocs, breakdown };
}

async function runSatisfaccionJob(jobId, options = {}) {
    const { mode = 'pending', limit = null, audience = 'pagado', dateRange = null } = options;
    const job = satisfaccionJobs.get(jobId);
    if (!job) return;

    try {
        const { docs: contactDocs, breakdown } = await getCandidateContactsByAudience(audience, limit, dateRange);
        job.breakdown = breakdown;

        const candidates = contactDocs.filter(doc => {
            const data = doc.data();
            const hasClassification = !!(data.satisfaction && data.satisfaction.level);

            if (mode === 'all') return true;

            if (mode === 'recent-activity') {
                // Solo contactos ya clasificados que tuvieron mensajes nuevos despues
                if (!hasClassification) return false;
                const classifiedAtMs = data.satisfaction.classifiedAt?.toMillis?.() || 0;
                const lastMsgMs = data.lastMessageTimestamp?.toMillis?.() || 0;
                return lastMsgMs > classifiedAtMs;
            }

            // mode === 'pending' (default): solo contactos sin clasificar
            return !hasClassification;
        });

        job.total = candidates.length;
        job.processed = 0;
        job.errors = 0;
        job.skipped = contactDocs.length - candidates.length;
        job.startedAt = Date.now();

        if (candidates.length === 0) {
            job.status = 'done';
            job.finishedAt = Date.now();
            return;
        }

        const concurrency = pLimit(10);
        const totalTokens = { input: 0, output: 0, cached: 0 };
        let totalAiCalls = 0;

        await Promise.all(candidates.map(contactDoc => concurrency(async () => {
            // Permitir cancelacion entre llamadas
            if (job.status === 'cancelled') return;
            try {
                const result = await classifyOneContact(contactDoc);
                if (job.status === 'cancelled') return; // doble-check antes de escribir
                await contactDoc.ref.update({
                    satisfaction: {
                        level: result.level,
                        reason: result.reason,
                        classifiedAt: admin.firestore.FieldValue.serverTimestamp(),
                        messagesAnalyzed: result.messagesAnalyzed,
                        model: 'gemini-3-flash-preview'
                    }
                });
                totalTokens.input += result.tokens.input;
                totalTokens.output += result.tokens.output;
                totalTokens.cached += result.tokens.cached;
                if (result.tokens.input > 0) totalAiCalls++;
            } catch (err) {
                console.error(`[Satisfaccion] Error clasificando ${contactDoc.id}:`, err.message);
                job.errors++;
                job.lastError = err.message;
            } finally {
                job.processed++;
            }
        })));

        // Tracking de tokens (igual que cobranza/retargeting)
        if (totalAiCalls > 0) {
            const today = new Date().toISOString().split('T')[0];
            await db.collection('ai_usage_logs').doc(today).set({
                inputTokens: admin.firestore.FieldValue.increment(totalTokens.input),
                outputTokens: admin.firestore.FieldValue.increment(totalTokens.output),
                cachedTokens: admin.firestore.FieldValue.increment(totalTokens.cached),
                requestCount: admin.firestore.FieldValue.increment(totalAiCalls),
                date: today
            }, { merge: true });
        }

        // Invalidar cache del listado para que la siguiente lectura traiga los nuevos niveles
        satisfaccionListadoCache.clear();

        job.tokens = totalTokens;
        job.aiCalls = totalAiCalls;
        // No sobreescribir 'cancelled' con 'done'
        if (job.status !== 'cancelled') job.status = 'done';
        job.finishedAt = Date.now();
    } catch (err) {
        console.error('[Satisfaccion] Error fatal del job:', err);
        job.status = 'error';
        job.error = err.message;
        job.finishedAt = Date.now();
    }
}

// POST /api/satisfaccion/clasificar - lanza un job asincrono
router.post('/satisfaccion/clasificar', async (req, res) => {
    try {
        const { force = false, mode: requestedMode, limit = null, audience: requestedAudience, startDate, endDate } = req.body || {};

        // Backward-compat: si vino force=true sin mode, equivale a mode='all'
        let mode = requestedMode || (force ? 'all' : 'pending');
        if (!['pending', 'all', 'recent-activity'].includes(mode)) {
            mode = 'pending';
        }

        // Audience: 'pagado' (default seguro) o 'all' (toda contacts_whatsapp, puede ser 80k+)
        let audience = requestedAudience || 'pagado';
        if (!['pagado', 'all'].includes(audience)) audience = 'pagado';

        // Rango de fechas opcional (millis); solo aplica cuando audience === 'pagado'
        const dateRange = (audience === 'pagado' && (startDate || endDate)) ? {
            startMs: startDate ? Number(startDate) : null,
            endMs: endDate ? Number(endDate) : null
        } : null;

        // Verificar si ya hay un job en curso
        for (const [id, job] of satisfaccionJobs) {
            if (job.status === 'running') {
                return res.json({
                    success: false,
                    message: 'Ya hay un job en curso',
                    jobId: id,
                    processed: job.processed,
                    total: job.total
                });
            }
        }

        pruneSatisfaccionState();

        const jobId = uuidv4();
        const numericLimit = limit ? Number(limit) : null;
        satisfaccionJobs.set(jobId, {
            id: jobId,
            status: 'running',
            createdAt: Date.now(),
            startedAt: null,
            finishedAt: null,
            total: 0,
            processed: 0,
            errors: 0,
            skipped: 0,
            tokens: { input: 0, output: 0, cached: 0 },
            aiCalls: 0,
            options: { mode, audience, limit: numericLimit, dateRange }
        });

        // Lanzar en background; el frontend pollea /progreso
        runSatisfaccionJob(jobId, { mode, audience, limit: numericLimit, dateRange });

        res.json({ success: true, jobId });
    } catch (err) {
        console.error('Error iniciando job de satisfaccion:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/satisfaccion/preview - calcula candidatos sin lanzar job (lectura barata)
// Body: { mode, audience, startDate, endDate, limit }
router.post('/satisfaccion/preview', async (req, res) => {
    try {
        const { force = false, mode: requestedMode, limit = null, audience: requestedAudience, startDate, endDate } = req.body || {};

        let mode = requestedMode || (force ? 'all' : 'pending');
        if (!['pending', 'all', 'recent-activity'].includes(mode)) mode = 'pending';

        let audience = requestedAudience || 'pagado';
        if (!['pagado', 'all'].includes(audience)) audience = 'pagado';

        const dateRange = (audience === 'pagado' && (startDate || endDate)) ? {
            startMs: startDate ? Number(startDate) : null,
            endMs: endDate ? Number(endDate) : null
        } : null;

        const numericLimit = limit ? Number(limit) : null;
        const { docs: contactDocs, breakdown } = await getCandidateContactsByAudience(audience, numericLimit, dateRange);

        let candidatesCount = 0;
        let needsAI = 0;
        for (const doc of contactDocs) {
            const data = doc.data();
            const hasClassification = !!(data.satisfaction && data.satisfaction.level);

            let passes = false;
            if (mode === 'all') passes = true;
            else if (mode === 'recent-activity') {
                if (hasClassification) {
                    const classifiedAtMs = data.satisfaction.classifiedAt?.toMillis?.() || 0;
                    const lastMsgMs = data.lastMessageTimestamp?.toMillis?.() || 0;
                    passes = lastMsgMs > classifiedAtMs;
                }
            } else {
                // pending
                passes = !hasClassification;
            }

            if (passes) candidatesCount++;
        }

        // Estimacion conservadora de costo Gemini Flash:
        // ~1000 tokens entrada + 50 tokens salida por contacto.
        // Tarifas aprox: entrada $0.30/M, salida $2.50/M
        // Asumiendo que ~30% pueden ser 'sin_senal' (sin llamada a Gemini)
        const aiCallsEstimate = Math.round(candidatesCount * 0.7);
        const inputCostUSD = (aiCallsEstimate * 1000 / 1_000_000) * 0.30;
        const outputCostUSD = (aiCallsEstimate * 50 / 1_000_000) * 2.50;
        const estimatedCostUSD = inputCostUSD + outputCostUSD;

        res.json({
            success: true,
            mode,
            audience,
            breakdown,
            candidatesCount,
            aiCallsEstimate,
            estimatedCostUSD: Number(estimatedCostUSD.toFixed(3))
        });
    } catch (err) {
        console.error('Error en preview de satisfaccion:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/satisfaccion/cancelar - marca como 'cancelled' cualquier job en curso
// (o uno especifico si se pasa jobId). Los workers ya en vuelo terminan; no se inician nuevos.
router.post('/satisfaccion/cancelar', (req, res) => {
    const { jobId } = req.body || {};
    let cancelled = 0;
    for (const [id, job] of satisfaccionJobs) {
        if (jobId && id !== jobId) continue;
        if (job.status === 'running') {
            job.status = 'cancelled';
            job.cancelledAt = Date.now();
            cancelled++;
        }
    }
    res.json({ success: true, cancelled });
});

// GET /api/satisfaccion/progreso?jobId=X - polling
router.get('/satisfaccion/progreso', (req, res) => {
    const { jobId } = req.query;
    if (!jobId) {
        return res.status(400).json({ success: false, message: 'Falta jobId' });
    }
    const job = satisfaccionJobs.get(jobId);
    if (!job) {
        return res.status(404).json({ success: false, message: 'Job no encontrado' });
    }
    const elapsed = job.startedAt ? (Date.now() - job.startedAt) / 1000 : 0;
    const rate = job.processed > 0 && elapsed > 0 ? job.processed / elapsed : 0;
    const remaining = job.total - job.processed;
    const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;
    res.json({
        success: true,
        jobId,
        status: job.status,
        total: job.total,
        processed: job.processed,
        errors: job.errors,
        skipped: job.skipped,
        tokens: job.tokens,
        aiCalls: job.aiCalls,
        etaSeconds,
        breakdown: job.breakdown || null,
        options: job.options,
        lastError: job.lastError,
        error: job.error
    });
});

// GET /api/satisfaccion/listado - lista paginada de contactos clasificados
router.get('/satisfaccion/listado', async (req, res) => {
    try {
        const { level, search, limit = 200, cursor, fresh } = req.query;
        const lim = Math.min(Number(limit) || 200, 500);

        const cacheKey = `${level || 'all'}_${lim}_${cursor || ''}`;
        if (fresh !== '1' && !search) {
            const entry = satisfaccionListadoCache.get(cacheKey);
            if (entry && (Date.now() - entry.cachedAt) < SATISFACCION_LISTADO_TTL_MS) {
                return res.json({
                    success: true,
                    contacts: entry.contacts,
                    nextCursor: entry.nextCursor,
                    counts: entry.counts,
                    fromCache: true,
                    cacheAgeMs: Date.now() - entry.cachedAt
                });
            }
        }

        let query = db.collection('contacts_whatsapp');

        if (level && SATISFACCION_LEVELS.includes(level)) {
            query = query.where('satisfaction.level', '==', level);
        }

        // Para tener orden estable, ordenamos por lastMessageTimestamp DESC
        query = query.orderBy('lastMessageTimestamp', 'desc');

        if (cursor) {
            const cursorDoc = await db.collection('contacts_whatsapp').doc(cursor).get();
            if (cursorDoc.exists) query = query.startAfter(cursorDoc);
        }

        const snapshot = await query.limit(lim).get();

        let contacts = snapshot.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                name: d.name || '',
                lastMessage: d.lastMessage || '',
                lastMessageTimestamp: d.lastMessageTimestamp ? d.lastMessageTimestamp.toDate().toISOString() : null,
                satisfaction: d.satisfaction ? {
                    level: d.satisfaction.level,
                    reason: d.satisfaction.reason,
                    classifiedAt: d.satisfaction.classifiedAt ? d.satisfaction.classifiedAt.toDate().toISOString() : null,
                    messagesAnalyzed: d.satisfaction.messagesAnalyzed || 0
                } : null
            };
        });

        // Filtro por busqueda (post-query; pequeno set)
        if (search) {
            const q = String(search).toLowerCase().trim();
            contacts = contacts.filter(c =>
                c.id.includes(q) || (c.name || '').toLowerCase().includes(q)
            );
        }

        const nextCursor = snapshot.docs.length === lim ? snapshot.docs[snapshot.docs.length - 1].id : null;

        // Conteos por nivel (solo se calcula cuando no hay filtro de nivel)
        let counts = null;
        if (!level) {
            counts = { positivo: 0, neutral: 0, negativo: 0, sin_senal: 0, sin_clasificar: 0 };
            try {
                const aggPromises = SATISFACCION_LEVELS.map(lv =>
                    db.collection('contacts_whatsapp').where('satisfaction.level', '==', lv).count().get()
                        .then(s => ({ lv, n: s.data().count }))
                );
                const aggs = await Promise.all(aggPromises);
                aggs.forEach(({ lv, n }) => { counts[lv] = n; });
            } catch (err) {
                console.warn('[Satisfaccion] count() fallo (indice?):', err.message);
            }
        }

        const responseBody = { contacts, nextCursor, counts };

        if (!search) {
            pruneSatisfaccionState();
            satisfaccionListadoCache.set(cacheKey, {
                cachedAt: Date.now(),
                contacts, nextCursor, counts
            });
        }

        res.json({ success: true, ...responseBody, fromCache: false });
    } catch (err) {
        console.error('Error leyendo listado de satisfaccion:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/config/prices - Precios autoritativos del servidor (consumido por el sitio publico)
router.get('/config/prices', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300'); // 5 min cache
    res.json(PRICES);
});

// ============================================
// INVENTARIO
// ============================================

// GET /api/inventario/reporte - Reporte de inventario actual (consumido por la pantalla web)
router.get('/inventario/reporte', async (req, res) => {
    try {
        const hasta = req.query.hasta ? new Date(req.query.hasta) : new Date();
        if (isNaN(hasta.getTime())) {
            return res.status(400).json({ success: false, message: 'Parámetro "hasta" inválido' });
        }
        const reporte = await calcularReporte(hasta);
        res.json({ success: true, reporte });
    } catch (err) {
        console.error('[INVENTARIO] Error en /reporte:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/inventario/enviar-reporte - Disparo manual del reporte completo (testing)
router.post('/inventario/enviar-reporte', async (_req, res) => {
    try {
        const result = await ejecutarReporteDiario();
        res.json({ success: !!result.ok, ...result });
    } catch (err) {
        console.error('[INVENTARIO] Error en /enviar-reporte:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// === DIAGNÓSTICO: por qué los contactos de Messenger llegan sin nombre real ===
// GET /api/debug/messenger-profile?psid=<PSID>
// Replica la llamada exacta de getUserProfile() para saber si el bloqueo es el
// token de página (vencido/inválido) o el permiso pages_messaging (Acceso Avanzado).
// Nunca devuelve el token. El PSID es el ID del contacto en el CRM (doc de contacts_whatsapp).
router.get('/debug/messenger-profile', async (req, res) => {
    const GRAPH = 'https://graph.facebook.com/v19.0';
    const token = process.env.FB_PAGE_ACCESS_TOKEN;
    const { psid } = req.query;
    const out = { success: true, tokenPresent: !!token, page: null, profile: null, diagnostico: '' };

    if (!token) {
        out.success = false;
        out.diagnostico = 'No hay FB_PAGE_ACCESS_TOKEN configurado en el servidor.';
        return res.json(out);
    }

    // 1) Salud del token: ¿es válido y de qué página es?
    try {
        const me = await axios.get(`${GRAPH}/me`, { params: { fields: 'id,name,category', access_token: token } });
        out.page = { ok: true, id: me.data.id, name: me.data.name, category: me.data.category || null };
    } catch (err) {
        const e = err.response?.data?.error;
        out.page = { ok: false, error: e || { message: err.message } };
        out.diagnostico = 'TOKEN INVÁLIDO O VENCIDO. Renueva FB_PAGE_ACCESS_TOKEN (token de página de larga duración).';
        return res.json(out);
    }

    // La Graph API necesita el PSID crudo, NO el doc id con prefijo (fb_/ig_).
    const stripPrefix = s => (s || '').replace(/^(fb_|ig_|messenger_|instagram_)/, '');

    // 2) Elegir qué PSID probar. Sin psid → autodetectar un contacto GENÉRICO ("Facebook User (...)")
    let testPsid = stripPrefix(psid);
    if (!psid) {
        try {
            // Buscar directamente contactos con nombre genérico (rango sobre 'name')
            const genSnap = await db.collection('contacts_whatsapp')
                .where('name', '>=', 'Facebook User (')
                .where('name', '<', 'Facebook User (')
                .limit(5).get();
            let chosen = genSnap.docs[0];
            if (!chosen) {
                // Fallback: cualquier contacto de Messenger
                const anySnap = await db.collection('contacts_whatsapp').where('channel', '==', 'messenger').limit(40).get();
                chosen = anySnap.docs.find(d => /^Facebook User \(/.test(d.data().name || '')) || anySnap.docs[0];
            }
            if (chosen) {
                const d = chosen.data();
                testPsid = d.psid || stripPrefix(chosen.id); // el campo psid trae el ID crudo
                out.autoContact = { id: chosen.id, name: d.name || null, esGenerico: /^Facebook User \(/.test(d.name || ''), psidUsado: testPsid };
            }
        } catch (e) {
            out.autoContactError = e.message;
        }
        if (!testPsid) {
            out.diagnostico = 'Token OK (página: ' + out.page.name + '). No encontré contactos de Messenger para autoprobar. Agrega ?psid=<PSID> manualmente.';
            return res.json(out);
        }
    }

    // 3) Perfil del usuario (misma llamada que en producción)
    try {
        const prof = await axios.get(`${GRAPH}/${testPsid}`, {
            params: { fields: 'name,first_name,last_name,profile_pic', access_token: token }
        });
        const data = prof.data || {};
        const resolvedName = (data.name || [data.first_name, data.last_name].filter(Boolean).join(' ')).trim();
        out.profile = { ok: true, psidProbado: testPsid, raw: data, resolvedName: resolvedName || null };
        out.diagnostico = resolvedName
            ? '✅ FUNCIONA: la API devolvió "' + resolvedName + '". El permiso está bien; los contactos viejos genéricos se reparan cuando el cliente vuelve a escribir (o con un backfill).'
            : '⚠️ Token OK pero la API responde 200 SIN nombre. Falta ACCESO AVANZADO al permiso "pages_messaging" (App Review en tu app de Meta). Hasta aprobarlo, los nombres solo llegan para admins/testers de la app.';
    } catch (err) {
        const e = err.response?.data?.error;
        out.profile = { ok: false, psidProbado: testPsid, error: e || { message: err.message } };
        out.diagnostico = 'La API devolvió error al pedir el perfil. Código Meta: ' + (e?.code ?? '?') + ' — ' + (e?.message || err.message) +
            '. (code 190 = token vencido; code 100/200/10 = permiso/campo no permitido → pages_messaging Acceso Avanzado).';
    }
    res.json(out);
});

// === DIAGNÓSTICO 2: ¿de qué APP es el token de Render y qué scopes tiene? ===
// GET /api/debug/messenger-token
// Usa debug_token para revelar app_id, scopes, tipo y página del FB_PAGE_ACCESS_TOKEN.
// Clave: los PSID son page+APP scoped → si el token es de una app distinta a la que
// recibe los webhooks de Messenger, la Graph API responde "Object does not exist".
router.get('/debug/messenger-token', async (_req, res) => {
    const GRAPH = 'https://graph.facebook.com/v19.0';
    const token = process.env.FB_PAGE_ACCESS_TOKEN;
    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;
    const out = { success: true, tokenPresent: !!token, fbPageIdEnv: process.env.FB_PAGE_ID || null, fbAppIdEnv: appId || null };
    if (!token) { out.success = false; out.diagnostico = 'No hay FB_PAGE_ACCESS_TOKEN.'; return res.json(out); }
    if (!appId || !appSecret) { out.success = false; out.diagnostico = 'Faltan FB_APP_ID / FB_APP_SECRET para inspeccionar el token.'; return res.json(out); }
    try {
        const r = await axios.get(`${GRAPH}/debug_token`, {
            params: { input_token: token, access_token: `${appId}|${appSecret}` }
        });
        const d = r.data?.data || {};
        out.token = {
            appId: d.app_id || null,
            appName: d.application || null,
            type: d.type || null,          // PAGE / USER
            pageId: d.profile_id || null,  // página dueña (si es PAGE token)
            valid: d.is_valid ?? null,
            scopes: d.scopes || [],
            expiresAt: d.expires_at ? (d.expires_at === 0 ? 'nunca' : new Date(d.expires_at * 1000).toISOString()) : null
        };
        const CRM_GEMINI = '995915149281962';
        const tieneMsg = (d.scopes || []).includes('pages_messaging');
        const esCrmGemini = String(d.app_id || '') === CRM_GEMINI;
        out.diagnostico =
            (esCrmGemini
                ? '✅ El token ES de CRM Gemini (la app con Acceso Avanzado). '
                : `⚠️ El token es de la app ${d.app_id} (${d.application || '?'}), NO de CRM Gemini (995915149281962). Si los webhooks entran por CRM Gemini, por eso el PSID "no existe" para este token. `) +
            (tieneMsg ? "Incluye 'pages_messaging'. " : "⚠️ NO incluye 'pages_messaging' en sus scopes. ") +
            (d.type && d.type !== 'PAGE' ? `⚠️ Tipo de token: ${d.type} (debería ser PAGE). ` : '');
    } catch (err) {
        const e = err.response?.data?.error;
        out.success = false;
        out.error = e || { message: err.message };
        out.diagnostico = 'No se pudo inspeccionar el token: ' + (e?.message || err.message);
    }
    res.json(out);
});

// === DIAGNÓSTICO 3: ¿la Conversations API devuelve nombres? ===
// GET /api/debug/messenger-conversations
// La User Profile API (GET /{psid}) está restringida por Meta. La vía moderna para
// el nombre es /{page}/conversations?fields=participants{name}. Esto prueba si ahí SÍ vienen.
router.get('/debug/messenger-conversations', async (_req, res) => {
    const GRAPH = 'https://graph.facebook.com/v19.0';
    const token = process.env.FB_PAGE_ACCESS_TOKEN;
    const pageId = process.env.FB_PAGE_ID;
    const out = { success: true };
    if (!token || !pageId) { out.success = false; out.diagnostico = 'Falta FB_PAGE_ACCESS_TOKEN o FB_PAGE_ID.'; return res.json(out); }
    try {
        const r = await axios.get(`${GRAPH}/${pageId}/conversations`, {
            params: { platform: 'messenger', fields: 'participants,updated_time', limit: 8, access_token: token }
        });
        const convs = r.data?.data || [];
        const sample = convs.map(c => ({
            updated: c.updated_time || null,
            participants: (c.participants?.data || []).map(p => ({ id: p.id, name: p.name || null }))
        }));
        out.sample = sample;
        let conNombre = 0, total = 0;
        for (const c of sample) for (const p of c.participants) {
            if (String(p.id) === String(pageId)) continue;
            total++;
            if (p.name && !/^Facebook User/i.test(p.name)) conNombre++;
        }
        out.resumen = { conversaciones: sample.length, participantesNoPagina: total, conNombreReal: conNombre };
        out.diagnostico = total === 0
            ? 'No se encontraron conversaciones de Messenger en la página (o sin participantes).'
            : (conNombre > 0
                ? `✅ La Conversations API SÍ devuelve nombres (${conNombre}/${total} con nombre real). SOLUCIÓN: leer el nombre desde aquí en vez de la User Profile API. Es arreglo de código.`
                : `⚠️ La Conversations API tampoco trae nombres (${conNombre}/${total}). El bloqueo sería más profundo del lado Meta.`);
    } catch (err) {
        const e = err.response?.data?.error;
        out.success = false;
        out.error = e || { message: err.message };
        out.diagnostico = 'Error al leer conversaciones: ' + (e?.message || err.message);
    }
    res.json(out);
});

// === BACKFILL: repara nombres genéricos leyendo de la Conversations API ===
// GET /api/debug/messenger-backfill-names?platform=messenger[&pages=20][&confirm=1]
// Sin confirm=1 = SIMULACRO (no escribe). Solo ACTUALIZA contactos existentes cuyo
// nombre es genérico ("Facebook User (...)" / "IG User (...)"); nunca crea duplicados.
// Reejecuta para continuar si hay más páginas (los ya reparados se saltan solos).
router.get('/debug/messenger-backfill-names', async (req, res) => {
    const GRAPH = 'https://graph.facebook.com/v19.0';
    const token = process.env.FB_PAGE_ACCESS_TOKEN;
    const pageId = process.env.FB_PAGE_ID;
    const confirm = req.query.confirm === '1';
    const platform = req.query.platform === 'instagram' ? 'instagram' : 'messenger';
    const prefix = platform === 'instagram' ? 'ig' : 'fb';
    const maxPages = Math.min(parseInt(req.query.pages, 10) || 8, 200);
    const out = { success: true, confirm, platform, scanned: 0, conNombreReal: 0, actualizados: 0, ejemplos: [], paginas: 0, hayMas: false };
    if (!token || !pageId) { out.success = false; out.diagnostico = 'Falta FB_PAGE_ACCESS_TOKEN o FB_PAGE_ID.'; return res.json(out); }
    const esGenerico = n => !n || /^Facebook User|^IG User/i.test(n);
    try {
        let url = `${GRAPH}/${pageId}/conversations`;
        let params = { platform, fields: 'participants', limit: 50, access_token: token };
        while (url && out.paginas < maxPages) {
            const r = await axios.get(url, { params });
            const convs = r.data?.data || [];
            // Candidatos de la página: participante (no la página) con nombre real
            const cand = [];
            for (const c of convs) {
                const parts = c.participants?.data || [];
                const user = parts.find(p => String(p.id) !== String(pageId));
                if (!user || !user.id) continue;
                out.scanned++;
                const name = (user.name || '').trim();
                if (esGenerico(name)) continue;
                out.conNombreReal++;
                cand.push({ id: `${prefix}_${user.id}`, name });
            }
            // Lectura en LOTE: 1 llamada a Firestore por página (no 50)
            if (cand.length) {
                const snaps = await db.getAll(...cand.map(x => db.collection('contacts_whatsapp').doc(x.id)));
                let batch = db.batch();
                let batchCount = 0;
                for (let i = 0; i < snaps.length; i++) {
                    const snap = snaps[i];
                    if (!snap.exists || !esGenerico(snap.data().name)) continue;
                    if (out.ejemplos.length < 15) out.ejemplos.push({ id: cand[i].id, de: snap.data().name || '(sin nombre)', a: cand[i].name });
                    if (confirm) {
                        batch.update(snap.ref, { name: cand[i].name, name_lowercase: cand[i].name.toLowerCase() });
                        out.actualizados++;
                        batchCount++;
                    }
                }
                if (confirm && batchCount > 0) await batch.commit();
            }
            url = r.data?.paging?.next || null;
            params = {};
            out.paginas++;
            if (url) await new Promise(rs => setTimeout(rs, 120));
        }
        out.hayMas = !!url;
        out.diagnostico = confirm
            ? `✅ Reparados ${out.actualizados} contactos (revisé ${out.paginas} páginas / ${out.scanned} conversaciones).` + (out.hayMas ? ' Hay más páginas: vuelve a abrir la URL para continuar.' : ' No hay más.')
            : `SIMULACRO: ${out.ejemplos.length}${out.ejemplos.length >= 15 ? '+' : ''} contactos genéricos reparables (de ${out.scanned} conversaciones). Agrega &confirm=1 para aplicarlo.` + (out.hayMas ? ' (hay más páginas)' : '');
    } catch (err) {
        const e = err.response?.data?.error;
        out.success = false;
        out.error = e || { message: err.message };
        out.diagnostico = 'Error en backfill: ' + (e?.message || err.message);
    }
    res.json(out);
});

// === LISTA CRM unificada: Clientes (pagaron) / Leads (registraron sin pagar) / Contactos (sin pedido) ===
const _tsMs = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : (t && t._seconds ? t._seconds * 1000 : (typeof t === 'number' ? t : null));
const _slimContact = (id, d) => ({
    id,
    name: d.name || null,
    status: d.status || null,
    channel: d.channel || null,
    purchaseStatus: d.purchaseStatus || null,
    lastMessage: d.lastMessage || '',
    totalSpent: d.totalSpent || 0,
    orderCount: d.orderCount || 0,
    products: Array.isArray(d.products) ? d.products : [],
    lastOrderDate: _tsMs(d.lastOrderDate),
    lastMessageTimestamp: _tsMs(d.lastMessageTimestamp)
});

// Caché en memoria del servidor (TTL): evita releer Firestore en cada F5 / cada usuario.
// ?fresh=1 la salta (botón "Actualizar"). Es compartida entre todos los usuarios.
const CRM_LIST_CACHE = new Map();
const CRM_LIST_TTL_MS = 3 * 60 * 1000; // 3 minutos
function _crmCacheGet(key, fresh) {
    if (fresh) return null;
    const e = CRM_LIST_CACHE.get(key);
    return (e && (Date.now() - e.at) < CRM_LIST_TTL_MS) ? e.data : null;
}
function _crmCacheSet(key, data) {
    CRM_LIST_CACHE.set(key, { at: Date.now(), data });
    if (CRM_LIST_CACHE.size > 40) {
        const cutoff = Date.now() - CRM_LIST_TTL_MS;
        for (const [k, v] of CRM_LIST_CACHE) if (v.at < cutoff) CRM_LIST_CACHE.delete(k);
    }
}

// GET /api/crm-list/counts[&fresh=1] → cuántos hay de cada tipo (count(), barato + cacheado)
router.get('/crm-list/counts', async (req, res) => {
    try {
        const fresh = req.query.fresh === '1';
        const cached = _crmCacheGet('counts', fresh);
        if (cached) return res.json({ ...cached, fromCache: true });

        const col = db.collection('contacts_whatsapp');
        const [tot, cli, lead] = await Promise.all([
            col.count().get(),
            col.where('purchaseStatus', '==', 'completed').count().get(),
            col.where('purchaseStatus', '==', 'registered').count().get()
        ]);
        const total = tot.data().count;
        const clientes = cli.data().count;
        const leads = lead.data().count;
        const data = { success: true, total, clientes, leads, contactos: Math.max(0, total - clientes - leads) };
        _crmCacheSet('counts', data);
        res.json({ ...data, fromCache: false });
    } catch (err) {
        console.error('crm-list/counts error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/crm-list/items?tab=clientes|leads|contactos[&days=3][&fresh=1]
// El orden lo hace el frontend (sobre todo lo cargado); aquí solo entregamos los datos.
router.get('/crm-list/items', async (req, res) => {
    try {
        const tab = ['clientes', 'leads', 'contactos'].includes(req.query.tab) ? req.query.tab : 'clientes';
        const fresh = req.query.fresh === '1';
        const days = tab === 'contactos' ? Math.min(Math.max(parseInt(req.query.days, 10) || 3, 1), 90) : 0;
        const cacheKey = `items_${tab}${tab === 'contactos' ? '_' + days : ''}`;
        const cached = _crmCacheGet(cacheKey, fresh);
        if (cached) return res.json({ ...cached, fromCache: true });

        const col = db.collection('contacts_whatsapp');
        let items = [];
        let truncated = false;

        if (tab === 'clientes' || tab === 'leads') {
            // Acotado (compradores/leads) → cargamos todos; el frontend ordena/filtra.
            const ps = tab === 'clientes' ? 'completed' : 'registered';
            const CAP = 12000; // cubre el total actual con margen
            const snap = await col.where('purchaseStatus', '==', ps).limit(CAP).get();
            items = snap.docs.map(d => _slimContact(d.id, d.data()));
            truncated = snap.size >= CAP;

            if (tab === 'clientes') {
                // Los campos del contacto (totalSpent/orderCount/products) solo se denormalizan
                // para recurrentes (2+ compras). Para totales CONFIABLES (incluye clientes de 1
                // sola compra), agregamos desde los pedidos PAGADOS agrupando por contactId.
                try {
                    const agg = new Map(); // key -> { orderCount, totalSpent, products:Set, lastOrderDate }
                    const pedSnap = await db.collection('pedidos')
                        .where('estatus', 'in', ['Pagado', 'Fabricar'])
                        .select('contactId', 'telefono', 'precio', 'producto', 'createdAt')
                        .get();
                    for (const pd of pedSnap.docs) {
                        const p = pd.data();
                        const key = p.contactId || p.telefono;
                        if (!key) continue;
                        let a = agg.get(key);
                        if (!a) { a = { orderCount: 0, totalSpent: 0, products: new Set(), lastOrderDate: null }; agg.set(key, a); }
                        a.orderCount++;
                        a.totalSpent += parseFloat(p.precio) || 0;
                        if (p.producto) a.products.add(p.producto);
                        const ms = _tsMs(p.createdAt);
                        if (ms && (!a.lastOrderDate || ms > a.lastOrderDate)) a.lastOrderDate = ms;
                    }
                    items = items.map(c => {
                        const a = agg.get(c.id);
                        if (!a) return c;
                        return { ...c, orderCount: a.orderCount, totalSpent: a.totalSpent, products: Array.from(a.products), lastOrderDate: a.lastOrderDate || c.lastOrderDate };
                    });
                } catch (aggErr) {
                    console.warn('crm-list: no se pudieron agregar pedidos:', aggErr.message);
                }
            }

            items.sort((a, b) => (b.lastOrderDate || b.lastMessageTimestamp || 0) - (a.lastOrderDate || a.lastMessageTimestamp || 0));
        } else {
            // Contactos (colección grande) → solo últimos N días, excluyendo compradores/leads
            const since = admin.firestore.Timestamp.fromMillis(Date.now() - days * 86400000);
            const snap = await col.where('lastMessageTimestamp', '>=', since)
                .orderBy('lastMessageTimestamp', 'desc').limit(1500).get();
            items = snap.docs.map(d => _slimContact(d.id, d.data()))
                .filter(c => c.purchaseStatus !== 'completed' && c.purchaseStatus !== 'registered');
            truncated = snap.size >= 1500;
        }

        const data = { success: true, tab, count: items.length, truncated, items };
        _crmCacheSet(cacheKey, data);
        res.json({ ...data, fromCache: false });
    } catch (err) {
        console.error('crm-list/items error:', err);
        const msg = err.message || 'error';
        if (/requires an index|needs.*index/i.test(msg)) {
            return res.status(500).json({ success: false, needsIndex: true, message: 'Falta índice Firestore: ' + msg });
        }
        res.status(500).json({ success: false, message: msg });
    }
});

module.exports = router;
