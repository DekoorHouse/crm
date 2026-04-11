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
const { sendConversionEvent, generateGeminiResponse, generateGeminiResponseWithCache, getOrCreateCache, skipAiTimer, sendAdvancedWhatsAppMessage, sendMessengerMessage, invalidateGeminiCache, getMetaSpend } = require('./services');
const jtService = require('./jt/jtService');

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

router.post('/referencias/upload', uploadRef.single('foto'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió archivo' });
        const webpBuffer = await sharp(req.file.buffer)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
        const fileName = 'referencias/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.webp';
        const file = bucket.file(fileName);
        await file.save(webpBuffer, {
            metadata: { contentType: 'image/webp' },
            public: true
        });
        const url = 'https://storage.googleapis.com/' + bucket.name + '/' + fileName;
        res.json({ url });
    } catch (error) {
        console.error('Error subiendo foto de referencia:', error);
        res.status(500).json({ error: error.message });
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
        // Descargar imagen
        const response = await axios.get(oldUrl, { responseType: 'arraybuffer' });
        const angle = direction === 'ccw' ? -90 : 90;
        const rotatedBuffer = await sharp(Buffer.from(response.data))
            .rotate(angle)
            .webp({ quality: 80 })
            .toBuffer();

        // Subir con nuevo nombre
        const fileName = 'referencias/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.webp';
        const file = bucket.file(fileName);
        await file.save(rotatedBuffer, { metadata: { contentType: 'image/webp' }, public: true });
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
        const INCOME_ADJUSTMENT = 19183.22;
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

        const adjustedCredits = Math.max(0, totalCredits - INCOME_ADJUSTMENT);

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
            // CRM: cache-first con knowledge base + quick replies fallback
            const dynamicPrompt = `**Historial de la Conversación Reciente:**\n${conversationHistory}\n\n**Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;

            try {
                const cacheName = await getOrCreateCache(systemPrompt);
                if (cacheName) {
                    aiResult = await generateGeminiResponseWithCache(cacheName, dynamicPrompt, mediaParts);
                } else {
                    throw new Error('Caché no disponible');
                }
            } catch (cacheError) {
                // Fallback: construir prompt completo sin caché, usando systemInstruction
                console.warn(`[SIMULATOR] Caché falló (${cacheError.message}). Usando método sin caché.`);
                const kbSnapshot = await db.collection('ai_knowledge_base').get();
                const knowledgeBase = kbSnapshot.docs.map(doc => `P: ${doc.data().topic}\nR: ${doc.data().answer}`).join('\n\n');
                const qrSnapshot = await db.collection('quick_replies').get();
                const quickRepliesText = qrSnapshot.docs.filter(doc => doc.data().message).map(doc => `- ${doc.data().shortcut}: ${doc.data().message}`).join('\n');

                const fallbackSystem = `${systemPrompt}\n\n**Regla Especial de Mensajes Múltiples:** SOLO usa la etiqueta [SPLIT] si tus instrucciones EXPLÍCITAMENTE dicen enviar algo "en otro mensaje", "seguido de" otro mensaje, o "en dos mensajes separados". Si NO hay una instrucción explícita de separar en varios mensajes, responde TODO en un ÚNICO mensaje. NUNCA dividas una respuesta en múltiples mensajes por tu cuenta.`;
                const fullPrompt = `**Base de Conocimiento:**\n${knowledgeBase || 'No hay información adicional.'}\n\n**Respuestas Rápidas:**\n${quickRepliesText || 'No hay respuestas rápidas.'}\n\n**Historial de la Conversación Reciente:**\n${conversationHistory}\n\n**Tarea:**\nBasado en las instrucciones y el historial, responde al ÚLTIMO mensaje del cliente de manera concisa y útil. No repitas información si ya fue dada. Si el cliente envió multimedia, analízala cuidadosamente. Si no sabes la respuesta, indica que un agente humano lo atenderá pronto.`;
                aiResult = await generateGeminiResponse(fullPrompt, mediaParts, fallbackSystem);
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
    const headerDef = templateComponents?.find(c => c.type === 'HEADER');
    if (headerDef?.format === 'IMAGE') {
        if (!imageUrl) throw new Error(`La plantilla '${templateName}' requiere una imagen.`);
        // Añadir componente de cabecera de imagen
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'image', image: { link: imageUrl } }]
        });
        messageToSaveText = `🖼️ Plantilla con imagen: ${templateName}`;
    }
    // Si la cabecera es texto y espera una variable ({{1}}), usar el nombre del contacto
    if (headerDef?.format === 'TEXT' && headerDef.text?.includes('{{1}}')) {
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'text', text: contactName }]
        });
    }

    // --- Procesar Cuerpo (BODY) ---
    const bodyDef = templateComponents?.find(c => c.type === 'BODY');
    if (bodyDef) {
        // Encontrar cuántas variables ({{n}}) espera el cuerpo
        const matches = bodyDef.text?.match(/\{\{\d\}\}/g);
        if (matches) {
            // Combinar nombre del contacto (para {{1}}) con los parámetros adicionales (para {{2}}, {{3}}, ...)
            const allParams = [contactName, ...bodyParams];
            // Crear los parámetros de texto, asegurándose de no exceder los esperados
            const parameters = allParams.slice(0, matches.length).map(param => ({
                type: 'text',
                text: String(param) // Asegurar que sea string
            }));

            payloadComponents.push({ type: 'body', parameters });

            // Reconstruir el texto del mensaje para guardarlo en la DB
            let tempText = bodyDef.text;
            parameters.forEach((param, index) => {
                tempText = tempText.replace(`{{${index + 1}}}`, param.text);
            });
            messageToSaveText = tempText;

        } else {
            // Si el cuerpo no tiene variables, añadir componente vacío
            payloadComponents.push({ type: 'body', parameters: [] });
            messageToSaveText = bodyDef.text || messageToSaveText; // Usar texto del cuerpo si existe
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

        // --- INICIO: Filtro por Departamento ---
        // Si se proporciona departmentId, filtrar por 'assignedDepartmentId'
        if (departmentId && departmentId !== 'all') {
            // Soporte para múltiples IDs separados por coma (para usuarios con múltiples departamentos)
            if (departmentId.includes(',')) {
                const ids = departmentId.split(',').map(id => id.trim()).filter(id => id);
                if (ids.length > 0) {
                    // Nota: Firestore limita el operador 'in' a 10 valores.
                    query = query.where('assignedDepartmentId', 'in', ids.slice(0, 10));
                }
            } else {
                query = query.where('assignedDepartmentId', '==', departmentId);
            }
        }
        // --- FIN: Filtro por Departamento ---

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
        const contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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

// --- Endpoint POST /api/contacts/:contactId/messages (Enviar mensaje) ---
router.post('/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    const { text, fileUrl, fileType, reply_to_wamid, template, tempId } = req.body; // tempId es opcional, para UI optimista

    // Validaciones básicas
    if (!text && !fileUrl && !template) {
        return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío (texto, archivo o plantilla).' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);

        // --- Detectar canal del contacto ---
        const contactDoc = await contactRef.get();
        const channel = contactDoc.exists ? (contactDoc.data().channel || 'whatsapp') : 'whatsapp';

        // === MESSENGER: Lógica de envío para Facebook Messenger ===
        if (channel === 'messenger') {
            const psid = contactDoc.data().psid || contactId.replace('fb_', '');
            const sentData = await sendMessengerMessage(psid, { text, fileUrl, fileType });

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

            await contactRef.update({
                lastMessage: sentData.lastTextForDb,
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                unreadCount: 0
            });

            return res.status(200).json({ success: true, message: 'Mensaje(s) enviado(s) por Messenger.' });
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

        // --- Lógica para enviar PLANTILLA ---
        if (template) {
            const { payload, messageToSaveText } = await buildAdvancedTemplatePayload(contactId, template, null, []);
            if (reply_to_wamid) {
                payload.context = { message_id: reply_to_wamid };
            }

            const response = await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
            });
            messageId = response.data.messages[0].id;
            messageToSave = {
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: messageId, text: messageToSaveText
            };
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

            const messageTextForDb = text || (type === 'video' ? '🎥 Video' : type === 'image' ? '📷 Imagen' : type === 'audio' ? '🎵 Audio' : '📄 Documento');
            messageToSave = {
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: messageId, text: messageTextForDb, fileUrl: fileUrl, fileType: fileType
            };

        }
        // --- Lógica para enviar solo TEXTO ---
        else {
            const sentMessageData = await sendAdvancedWhatsAppMessage(contactId, { text, reply_to_wamid });
            messageId = sentMessageData.id;
            messageToSave = {
                from: PHONE_NUMBER_ID, status: 'sent', timestamp: admin.firestore.FieldValue.serverTimestamp(),
                id: messageId, text: sentMessageData.textForDb
            };
        }

        if (reply_to_wamid) {
            messageToSave.context = { id: reply_to_wamid };
        }
        Object.keys(messageToSave).forEach(key => messageToSave[key] == null && delete messageToSave[key]);

        const messageRef = tempId ? contactRef.collection('messages').doc(tempId) : contactRef.collection('messages').doc();
        await messageRef.set(messageToSave);

        const contactUpdateData = {
            lastMessage: messageToSave.text,
            lastMessageTimestamp: messageToSave.timestamp,
            unreadCount: 0
        };

        if (isFinalCommand) {
            contactUpdateData.botActive = false;
            contactUpdateData.status = 'pendientes_ia';
        }

        await contactRef.update(contactUpdateData);

        res.status(200).json({ success: true, message: 'Mensaje(s) enviado(s).' });
    } catch (error) {
        console.error('❌ Error al enviar mensaje:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al enviar el mensaje.' });
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

        if (isFinalCommand) {
            contactUpdateData.botActive = false;
            contactUpdateData.status = 'pendientes_ia';
        }

        await contactRef.update(contactUpdateData);

        res.status(200).json({ success: true, message: 'Mensaje encolado con éxito.' });

    } catch (error) {
        console.error('❌ Error al encolar mensaje:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error del servidor al encolar el mensaje.' });
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
    const { emoji } = req.body; // Emoji para reaccionar, o string vacío para quitar

    try {
        // 1. Obtener el ID de mensaje de WhatsApp (wamid) desde Firestore
        const messageDoc = await db.collection('contacts_whatsapp').doc(contactId).collection('messages').doc(messageDocId).get();
        if (!messageDoc.exists) {
            return res.status(404).json({ success: false, message: 'Mensaje no encontrado.' });
        }
        const messageData = messageDoc.data();
        const wamid = messageData.id; // El ID de WhatsApp

        if (!wamid) {
            return res.status(400).json({ success: false, message: 'Este mensaje no tiene un ID de WhatsApp válido.' });
        }

        // 2. Enviar la reacción a la API de WhatsApp
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

        // 3. Actualizar el estado en Firestore (opcional, para reflejarlo en UI)
        await db.collection('contacts_whatsapp').doc(contactId).collection('messages').doc(messageDocId).update({
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
    const { name, role, assignedDepartments } = req.body;

    try {
        const userRef = db.collection('users').doc(userId);
        const doc = await userRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (role !== undefined) updates.role = role;
        if (assignedDepartments !== undefined) updates.assignedDepartments = assignedDepartments;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await userRef.update(updates);

        res.status(200).json({ success: true, message: 'Usuario actualizado correctamente.' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar el usuario.' });
    }
});

// DELETE /api/users/:userId - Eliminar un usuario
router.delete('/users/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        await db.collection('users').doc(userId).delete();
        res.status(200).json({ success: true, message: 'Usuario eliminado correctamente.' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: 'Error al eliminar el usuario.' });
    }
});

// GET /api/users/profile/:email - Obtener perfil por email (para login)
router.get('/users/profile/:email', async (req, res) => {
    const { email } = req.params;
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
                if (authError.code === 'auth/user-not-found') {
                    console.warn(`[LOGIN] Intento de acceso para email no registrado en Auth: ${userId}`);
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

    const url = `https://graph.facebook.com/v19.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
    try {
        // Llamar a la API de Meta
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });

        // Filtrar solo plantillas APROBADAS y mapear a formato útil
        const templates = response.data.data
            .filter(t => t.status === 'APPROVED') // Solo aprobadas
            .map(t => ({
                name: t.name,
                language: t.language,
                status: t.status,
                category: t.category,
                // Mapear componentes (header, body, footer, buttons)
                components: t.components.map(c => ({
                    type: c.type,
                    text: c.text, // Texto (puede tener variables {{n}})
                    format: c.format, // Para header (IMAGE, TEXT, VIDEO, DOCUMENT)
                    buttons: c.buttons // Array de botones si type es BUTTONS
                }))
            }));
        res.status(200).json({ success: true, templates });
    } catch (error) {
        console.error('Error al obtener plantillas de WhatsApp:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ success: false, message: 'Error al obtener las plantillas de WhatsApp.' });
    }
});


// --- Endpoint POST /api/campaigns/send-template (Enviar campaña de texto) ---
router.post('/campaigns/send-template', async (req, res) => {
    const { contactIds, template } = req.body; // template es el objeto completo

    // Validaciones
    if (!contactIds?.length || !template) {
        return res.status(400).json({ success: false, message: 'Se requieren IDs de contacto y una plantilla.' });
    }

    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    let successful = 0;
    let failed = 0;
    const failedDetails = [];

    // Enviar mensaje a cada contacto (con pequeño delay)
    for (const contactId of contactIds) {
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
            // Actualizar último mensaje del contacto
            await contactRef.update({
                lastMessage: messageToSaveText, lastMessageTimestamp: timestamp, unreadCount: 0
            });

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
                    precio: Number(it.precio) || 0,
                    datosProducto: it.datosProducto || ''
                }));
            if (normalizedItems.length > 0) {
                updateData.items = normalizedItems;
                updateData.producto = normalizedItems[0].producto;
                updateData.precio = normalizedItems.reduce((sum, it) => sum + (it.precio || 0), 0);
                updateData.datosProducto = normalizedItems.length > 1
                    ? normalizedItems.map(it => {
                        const base = `${it.producto}${it.precio ? ` ($${it.precio})` : ''}`;
                        return it.datosProducto ? `${base}: ${it.datosProducto}` : base;
                    }).join('\n')
                    : normalizedItems[0].datosProducto;
            }
        } else if (updateData.producto !== undefined) {
            // Update legacy (standalone page): reconstruir items como un solo elemento
            // para mantener el array de items consistente con producto/precio/datosProducto
            updateData.items = [{
                producto: String(updateData.producto),
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

        res.status(200).json({ success: true, message: 'Pedido actualizado con éxito.' });

    } catch (error) {
        console.error(`Error al actualizar el pedido ${orderId}:`, error);
        res.status(500).json({ success: false, message: 'Error del servidor al actualizar el pedido.' });
    }
});


// --- Endpoint POST /api/orders (Crear nuevo pedido) ---
router.post('/orders', async (req, res) => {
    // Extraer datos del cuerpo de la solicitud
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
        items // Array opcional de productos: [{ producto, precio, datosProducto }]
    } = req.body;

    // Normalizar items: si viene el array, úsalo; si no, construir uno desde los campos legacy
    let normalizedItems;
    if (Array.isArray(items) && items.length > 0) {
        normalizedItems = items
            .filter(it => it && it.producto)
            .map(it => ({
                producto: String(it.producto),
                precio: Number(it.precio) || 0,
                datosProducto: it.datosProducto || ''
            }));
    } else if (producto) {
        normalizedItems = [{
            producto: String(producto),
            precio: Number(precio) || 0,
            datosProducto: datosProducto || ''
        }];
    } else {
        normalizedItems = [];
    }

    // Validaciones básicas
    if (!contactId || normalizedItems.length === 0 || !telefono) {
        return res.status(400).json({ success: false, message: 'Faltan datos obligatorios: contactId, producto(s) y teléfono.' });
    }

    try {
        const contactRef = db.collection('contacts_whatsapp').doc(contactId);
        // Referencia al contador de pedidos en Firestore
        const orderCounterRef = db.collection('counters').doc('orders');

        // --- Generar número de pedido consecutivo usando una transacción ---
        const newOrderNumber = await db.runTransaction(async (transaction) => {
            const counterDoc = await transaction.get(orderCounterRef);
            let currentCounter = counterDoc.exists ? counterDoc.data().lastOrderNumber || 0 : 0;
            // Asegurar que el contador empiece en 1001 si es menor
            const nextOrderNumber = (currentCounter < 1000) ? 1001 : currentCounter + 1;
            transaction.set(orderCounterRef, { lastOrderNumber: nextOrderNumber }, { merge: true });
            return nextOrderNumber;
        });

        // Calcular totales y datos "principales" (para backward compat con queries y reportes)
        const totalValue = normalizedItems.reduce((sum, it) => sum + (it.precio || 0), 0);
        const mainProducto = normalizedItems[0].producto;
        const mainDatosProducto = normalizedItems.map(it => {
            const base = `${it.producto}${it.precio ? ` ($${it.precio})` : ''}`;
            return it.datosProducto ? `${base}: ${it.datosProducto}` : base;
        }).join('\n');

        // Crear objeto del nuevo pedido con items embebidos
        const nuevoPedido = {
            contactId,
            producto: mainProducto, // Primer producto para backward compat (queries where producto==)
            items: normalizedItems, // Lista completa de productos
            telefono,
            precio: totalValue, // Suma total para mostrar el valor real del pedido
            datosProducto: normalizedItems.length > 1 ? mainDatosProducto : normalizedItems[0].datosProducto,
            datosPromocion: datosPromocion || '',
            comentarios: comentarios || '',
            fotoUrls: fotoUrls || [],
            fotoPromocionUrls: fotoPromocionUrls || [],
            consecutiveOrderNumber: newOrderNumber,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            estatus: 'Sin estatus',
            telefonoVerificado: false,
            estatusVerificado: false
        };

        // Hacer públicas las fotos para que se vean en la lista de pedidos
        const allUrls = [...(fotoUrls || []), ...(fotoPromocionUrls || [])];
        for (const url of allUrls) {
            if (url && url.includes(bucket.name)) {
                try {
                    const filePath = new URL(url).pathname.split(`/${bucket.name}/`)[1];
                    if (filePath) {
                        await bucket.file(decodeURIComponent(filePath)).makePublic();
                    }
                } catch (e) {
                    console.error('Error al hacer pública la foto de GCS:', e);
                }
            }
        }

        // Añadir el nuevo pedido a la colección 'pedidos'
        const newOrderRef = await db.collection('pedidos').add(nuevoPedido);

        // Actualizar el documento del contacto con la información del último pedido y MARCAR COMO REGISTRADO (corona plateada)
        // El evento Purchase a Meta se envía cuando el estatus cambie a "Fabricar" (corona zafiro)
        await contactRef.update({
            lastOrderNumber: newOrderNumber,
            lastOrderDate: nuevoPedido.createdAt,
            purchaseStatus: 'registered',
            purchaseValue: totalValue,
            purchaseDate: admin.firestore.FieldValue.serverTimestamp()
        });

        // --- Detección automática de cliente recurrente ---
        // Buscar si este teléfono ya tiene otros pedidos PAGADOS anteriores
        const phone = contactId || telefono;
        if (phone) {
            try {
                const previousOrders = await db.collection('pedidos')
                    .where('contactId', '==', phone)
                    .get();

                // Filtrar solo pedidos pagados (Pagado o Fabricar)
                const paidDocs = previousOrders.docs.filter(doc => {
                    const est = doc.data().estatus;
                    return est === 'Pagado' || est === 'Fabricar';
                });

                // Si tiene 2+ pedidos PAGADOS, es recurrente
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

                    // Obtener nombre
                    const contactData = (await contactRef.get()).data();
                    const name = contactData?.name || 'Sin nombre';

                    // Guardar/actualizar en recurring_customers
                    await db.collection('recurring_customers').doc(phone).set({
                        name,
                        orderCount: paidDocs.length,
                        totalSpent,
                        products,
                        lastOrderDate,
                        detectedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });

                    console.log(`[RECURRENTE] Cliente ${name} (${phone}) detectado con ${paidDocs.length} pedidos pagados, total: $${totalSpent}`);
                }
            } catch (recErr) {
                console.error('Error al detectar recurrente:', recErr);
                // No bloquear la creación del pedido por este error
            }
        }

        // Devolver éxito y el número de pedido generado
        res.status(201).json({
            success: true,
            message: normalizedItems.length > 1
                ? `Pedido con ${normalizedItems.length} productos registrado con éxito.`
                : 'Pedido registrado con éxito.',
            orderNumber: `DH${newOrderNumber}`,
            itemCount: normalizedItems.length
        });

    } catch (error) {
        console.error('Error al registrar el nuevo pedido:', error);
        res.status(500).json({ success: false, message: 'Error del servidor al registrar el pedido.' });
    }
});


// --- Endpoint POST /api/orders/:orderId/change-status (Cambiar estatus + Meta al pasar a Fabricar) ---
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

        let metaEventSent = false;

        // Si cambia a "Fabricar" y antes no era Fabricar → corona zafiro + evento Purchase a Meta
        if (newStatus === 'Fabricar' && !oldStatus.includes('fabricar') && orderData.contactId) {
            try {
                const contactRef = db.collection('contacts_whatsapp').doc(orderData.contactId);
                const contactDoc = await contactRef.get();

                if (contactDoc.exists) {
                    const contactData = contactDoc.data();

                    // Actualizar purchaseStatus del contacto a 'completed' (corona zafiro)
                    await contactRef.update({
                        purchaseStatus: 'completed',
                        purchaseDate: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Enviar evento Purchase a Meta CAPI
                    if (contactData.wa_id) {
                        const eventInfo = {
                            wa_id: contactData.wa_id,
                            profile: { name: contactData.name }
                        };
                        const customData = {
                            value: parseFloat(orderData.precio) || 0,
                            currency: 'MXN'
                        };
                        console.log(`[META EVENT] Enviando Purchase por cambio a Fabricar, pedido ${orderId}, contacto ${orderData.contactId}`);
                        await sendConversionEvent('Purchase', eventInfo, contactData.adReferral || {}, customData);
                        console.log(`[META EVENT] ✅ Evento Purchase enviado por Fabricar, pedido ${orderId}, valor $${orderData.precio}`);
                        metaEventSent = true;
                    } else {
                        console.warn(`[META EVENT] Contacto ${orderData.contactId} sin wa_id. No se envió evento Purchase.`);
                    }
                }
            } catch (metaError) {
                console.error('[META EVENT] Error al enviar evento Purchase por Fabricar:', metaError.message);
                if (metaError.response) console.error('[META EVENT] Respuesta:', JSON.stringify(metaError.response.data));
                // No fallar el request principal
            }
        }

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
            message: 'Estatus actualizado.',
            metaEventSent
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
        // Asegurar que tenemos el wa_id para el evento de Meta
        if (!contactData.wa_id) {
            return res.status(500).json({ success: false, message: "Error interno: El contacto no tiene un ID de WhatsApp guardado para enviar el evento a Meta." });
        }

        // Preparar información para el evento de Meta
        const eventInfo = {
            wa_id: contactData.wa_id,
            profile: { name: contactData.name }
        };
        const customEventData = {
            value: parseFloat(value),
            currency: 'MXN' // Moneda
        };

        // Enviar evento 'Purchase' a la API de Conversiones de Meta
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

        if (!contactData.wa_id) {
            return res.status(500).json({ success: false, message: "Error interno: El contacto no tiene un ID de WhatsApp guardado para enviar el evento a Meta." });
        }

        // Preparar información para el evento
        const eventInfo = {
            wa_id: contactData.wa_id,
            profile: { name: contactData.name }
        };

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

// --- Endpoint para Rastreo de J&T Express ---
router.get('/jt/track', async (req, res) => {
    const { waybill, phoneVerify } = req.query;

    if (!waybill) {
        return res.status(400).json({ success: false, message: 'Se requiere un número de guía.' });
    }

    try {
        const candidates = [];
        const userSupplied = (phoneVerify || '').toString().replace(/\D/g, '').slice(-4);
        if (userSupplied.length === 4) candidates.push(userSupplied);

        try {
            const guiaSnap = await db.collection('guias_jt')
                .where('waybillNo', '==', waybill)
                .limit(1)
                .get();
            if (!guiaSnap.empty) {
                const rawPhone = (guiaSnap.docs[0].data().receiverPhone || '').toString().replace(/\D/g, '');
                if (rawPhone.length >= 4) candidates.push(rawPhone.slice(-4));
            }
        } catch (lookupErr) {
            console.warn('[J&T TRACK] No se pudo buscar phoneVerify en Firestore:', lookupErr.message);
        }

        // Fallbacks conocidos (telefonos historicos de Dekoor)
        candidates.push('3519', '7167');

        const seen = new Set();
        const tryList = candidates.filter(c => {
            if (!c || seen.has(c)) return false;
            seen.add(c);
            return true;
        });

        const jtHeaders = {
            'Referer': 'https://www.jtexpress.mx/',
            'Origin': 'https://www.jtexpress.mx',
            'langtype': 'es',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        let lastResponse = null;
        for (const candidate of tryList) {
            console.log(`[J&T TRACK] Consultando guía: ${waybill}, Verificación: ${candidate}`);
            const response = await axios.get('https://official.jtjms-mx.com/official/logisticsTracking/v3/getDetailByWaybillNo', {
                params: { waybillNo: waybill, langType: 'es', phoneVerify: candidate },
                headers: jtHeaders
            });
            lastResponse = response;
            if (response.data && response.data.succ) {
                return res.status(200).json({ success: true, data: response.data.data });
            }
        }

        if (lastResponse && lastResponse.data) {
            return res.status(200).json({
                success: false,
                message: lastResponse.data.msg || 'No se encontró información para esta guía.',
                code: lastResponse.data.code
            });
        }
        return res.status(200).json({ success: false, message: 'No se encontró información para esta guía.' });
    } catch (error) {
        console.error('Error consultando J&T Tracking:', error.message);
        res.status(500).json({ success: false, message: 'Error interno conectando con el servidor de J&T.' });
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

// --- Endpoint POST /api/jt/resend-guia-whatsapp ---
// Reenvia la plantilla guia_envio_creada para un arreglo de orderNumbers.
router.post('/jt/resend-guia-whatsapp', async (req, res) => {
    try {
        const { orderNumbers } = req.body || {};
        if (!Array.isArray(orderNumbers) || orderNumbers.length === 0) {
            return res.status(400).json({ success: false, message: 'Se requiere un arreglo orderNumbers.' });
        }

        const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
        const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
        if (!PHONE_NUMBER_ID || !WHATSAPP_TOKEN) {
            return res.status(500).json({ success: false, message: 'Faltan credenciales de WhatsApp en el servidor.' });
        }

        const results = [];
        for (const orderNumber of orderNumbers) {
            try {
                const guiaSnap = await db.collection('guias_jt')
                    .where('orderNumber', '==', orderNumber)
                    .limit(1)
                    .get();

                if (guiaSnap.empty) {
                    results.push({ orderNumber, success: false, message: 'Guia no encontrada en guias_jt' });
                    continue;
                }

                const guia = guiaSnap.docs[0].data();
                let telefono = (guia.receiverPhone || '').toString().replace(/\D/g, '');
                let nombreCompleto = guia.receiverName || '';

                // Fallback: buscar en datos_envio si falta telefono o nombre
                if (!telefono || !nombreCompleto) {
                    try {
                        const deSnap = await db.collection('datos_envio')
                            .where('numeroPedido', '==', orderNumber)
                            .limit(1)
                            .get();
                        if (!deSnap.empty) {
                            const de = deSnap.docs[0].data();
                            telefono = telefono || (de.telefono || '').toString().replace(/\D/g, '');
                            nombreCompleto = nombreCompleto || de.nombreCompleto || '';
                        }
                    } catch (_) { /* ignore */ }
                }

                if (!telefono || telefono.length < 10) {
                    results.push({ orderNumber, success: false, message: 'Telefono invalido o faltante' });
                    continue;
                }
                if (!guia.waybillNo) {
                    results.push({ orderNumber, success: false, message: 'Guia sin waybillNo' });
                    continue;
                }

                const waId = telefono.length === 10 ? '52' + telefono : telefono;
                const firstName = (nombreCompleto || 'Cliente').split(' ')[0];

                const templatePayload = {
                    messaging_product: 'whatsapp',
                    to: waId,
                    type: 'template',
                    template: {
                        name: 'guia_envio_creada',
                        language: { code: 'es_MX' },
                        components: [
                            {
                                type: 'body',
                                parameters: [
                                    { type: 'text', text: firstName },
                                    { type: 'text', text: orderNumber },
                                    { type: 'text', text: guia.waybillNo },
                                ],
                            },
                            {
                                type: 'button',
                                sub_type: 'url',
                                index: '0',
                                parameters: [
                                    { type: 'text', text: guia.waybillNo },
                                ],
                            },
                        ],
                    },
                };

                await axios.post(
                    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
                    templatePayload,
                    { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
                );

                console.log(`[JT RESEND] Plantilla enviada a ${waId} para ${orderNumber} (${guia.waybillNo})`);
                results.push({ orderNumber, success: true, waybillNo: guia.waybillNo, to: waId });
            } catch (err) {
                const errMsg = err.response?.data?.error?.message || err.message;
                console.warn(`[JT RESEND] Error para ${orderNumber}:`, errMsg);
                results.push({ orderNumber, success: false, message: errMsg });
            }
        }

        const okCount = results.filter(r => r.success).length;
        return res.status(200).json({
            success: true,
            sent: okCount,
            failed: results.length - okCount,
            results,
        });
    } catch (error) {
        console.error('[JT RESEND] Error general:', error);
        res.status(500).json({ success: false, message: error.message });
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

// --- CONSULTA CÓDIGO POSTAL (SEPOMEX) ---
router.get('/codigo-postal/:cp', async (req, res) => {
    const { cp } = req.params;
    if (!/^\d{5}$/.test(cp)) {
        return res.status(400).json({ success: false, message: 'El código postal debe tener 5 dígitos.' });
    }
    try {
        const response = await axios.get(`https://api.zippopotam.us/mx/${cp}`, { timeout: 5000 });
        const data = response.data;
        const colonias = (data.places || []).map(p => p['place name']);
        const estado = data.places?.[0]?.state || '';
        res.json({
            success: true,
            codigoPostal: cp,
            estado: estado === 'Distrito Federal' ? 'Ciudad de Mexico' : estado,
            colonias,
        });
    } catch (err) {
        if (err.response?.status === 404) {
            return res.json({ success: false, message: 'Código postal no encontrado.', colonias: [] });
        }
        console.warn(`[CP] Error consultando ${cp}:`, err.message);
        res.json({ success: false, message: 'No se pudo consultar el código postal.', colonias: [] });
    }
});

// --- BUSCAR CP POR COLONIA ---
router.get('/buscar-cp', async (req, res) => {
    const { estado, colonia } = req.query;
    if (!estado || !colonia || colonia.length < 3) {
        return res.json({ success: false, message: 'Escribe al menos 3 letras de tu colonia.', results: [] });
    }
    try {
        const response = await axios.get(
            `https://api.zippopotam.us/mx/${encodeURIComponent(estado)}/${encodeURIComponent(colonia)}`,
            { timeout: 5000 }
        );
        const places = response.data.places || [];

        // Agrupar por CP para obtener colonias vecinas
        const cpGroups = {};
        places.forEach(p => {
            if (!cpGroups[p['post code']]) cpGroups[p['post code']] = [];
            cpGroups[p['post code']].push(p['place name']);
        });

        // Buscar colonias vecinas para cada CP (las que comparten el mismo CP)
        const vecinosCache = {};
        await Promise.all(Object.keys(cpGroups).map(async (cp) => {
            try {
                const cpRes = await axios.get(`https://api.zippopotam.us/mx/${cp}`, { timeout: 4000 });
                vecinosCache[cp] = (cpRes.data.places || []).map(p => p['place name']);
            } catch { vecinosCache[cp] = cpGroups[cp]; }
        }));

        const results = places.map(p => {
            const cp = p['post code'];
            const vecinos = (vecinosCache[cp] || []).filter(v => v !== p['place name']).slice(0, 3);
            return {
                colonia: p['place name'],
                codigoPostal: cp,
                estado: response.data.state || estado,
                vecinos,
                lat: parseFloat(p.latitude) || null,
                lon: parseFloat(p.longitude) || null,
            };
        });

        res.json({ success: true, results });
    } catch (err) {
        if (err.response?.status === 404) {
            return res.json({ success: true, results: [], message: 'No se encontraron resultados.' });
        }
        res.json({ success: false, results: [], message: 'Error al buscar.' });
    }
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
        const { numeroPedido, nombreCompleto, telefono, direccion, numInterior, colonia, estado, ciudad, codigoPostal, referencia } = req.body;

        if (!numeroPedido || !nombreCompleto || !telefono || !direccion || !colonia || !estado || !ciudad || !codigoPostal) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
        }

        if (!/^\d{10}$/.test(telefono)) {
            return res.status(400).json({ success: false, message: 'El teléfono debe tener 10 dígitos.' });
        }

        if (!/^\d{5}$/.test(codigoPostal)) {
            return res.status(400).json({ success: false, message: 'El código postal debe tener 5 dígitos.' });
        }

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
            referencia: referencia || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // --- Auto-crear guía J&T ---
        let guiaResult = null;
        if (jtService.isConfigured()) {
            try {
                // Verificar que no exista ya una guía activa para este pedido
                const existingSnap = await db.collection('guias_jt')
                    .where('orderNumber', '==', numeroPedido)
                    .where('status', '!=', 'cancelled')
                    .limit(1)
                    .get();

                if (existingSnap.empty) {
                    // Buscar nombre de producto en pedidos
                    let productName = 'Lámpara 3D Personalizada';
                    try {
                        const pedidoDoc = await db.collection('pedidos').doc(numeroPedido).get();
                        if (pedidoDoc.exists) {
                            productName = pedidoDoc.data().producto || productName;
                        }
                    } catch (_) { /* usar default */ }

                    const fullStreet = numInterior ? `${direccion} Int. ${numInterior}` : direccion;

                    const jtResult = await jtService.createOrder({
                        orderNumber: numeroPedido,
                        receiverName: nombreCompleto,
                        receiverPhone: telefono,
                        street: fullStreet,
                        colonia,
                        city: ciudad,
                        state: estado,
                        zip: codigoPostal,
                        reference: referencia || '',
                        productName,
                    });

                    if (jtResult.success) {
                        await db.collection('guias_jt').add({
                            orderNumber: numeroPedido,
                            waybillNo: jtResult.waybillNo,
                            receiverName: nombreCompleto,
                            receiverPhone: telefono,
                            address: `${fullStreet}, ${colonia}, ${ciudad}, ${estado} C.P. ${codigoPostal}`,
                            reference: referencia || '',
                            productName,
                            status: 'created',
                            autoGenerated: true,
                            createdAt: new Date(),
                        });

                        try {
                            const pedidoRef = db.collection('pedidos').doc(numeroPedido);
                            const pedidoDoc = await pedidoRef.get();
                            if (pedidoDoc.exists) {
                                await pedidoRef.update({
                                    guiaJT: jtResult.waybillNo,
                                    guiaCreatedAt: new Date(),
                                });
                            }
                        } catch (e) { /* ignore */ }

                        console.log(`[DATOS-ENVIO] Guía J&T auto-creada: ${jtResult.waybillNo} para ${numeroPedido}`);
                        guiaResult = { success: true, waybillNo: jtResult.waybillNo };

                        // Enviar WhatsApp al cliente (plantilla guia_envio_creada)
                        try {
                            const waId = '52' + telefono;
                            const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
                            const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
                            const templatePayload = {
                                messaging_product: 'whatsapp',
                                to: waId,
                                type: 'template',
                                template: {
                                    name: 'guia_envio_creada',
                                    language: { code: 'es_MX' },
                                    components: [
                                        {
                                            type: 'body',
                                            parameters: [
                                                { type: 'text', text: nombreCompleto.split(' ')[0] },
                                                { type: 'text', text: numeroPedido },
                                                { type: 'text', text: jtResult.waybillNo },
                                            ],
                                        },
                                        {
                                            type: 'button',
                                            sub_type: 'url',
                                            index: '0',
                                            parameters: [
                                                { type: 'text', text: jtResult.waybillNo },
                                            ],
                                        },
                                    ],
                                },
                            };
                            await axios.post(
                                `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
                                templatePayload,
                                { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
                            );
                            console.log(`[DATOS-ENVIO] WhatsApp plantilla enviada a ${waId} para pedido ${numeroPedido}`);
                        } catch (waErr) {
                            console.warn(`[DATOS-ENVIO] No se pudo enviar WhatsApp a ${telefono}:`, waErr.response?.data || waErr.message);
                        }
                    } else {
                        console.warn(`[DATOS-ENVIO] No se pudo auto-crear guía J&T para ${numeroPedido}: ${jtResult.message}`);
                        guiaResult = { success: false, message: jtResult.message };
                    }
                } else {
                    console.log(`[DATOS-ENVIO] Ya existe guía para ${numeroPedido}, omitiendo auto-creación.`);
                    guiaResult = { success: true, waybillNo: existingSnap.docs[0].data().waybillNo, alreadyExists: true };
                }
            } catch (jtError) {
                console.error(`[DATOS-ENVIO] Error auto-creando guía J&T para ${numeroPedido}:`, jtError.message);
                guiaResult = { success: false, message: jtError.message };
            }
        }

        res.status(201).json({
            success: true,
            message: 'Datos de envío guardados correctamente.',
            guia: guiaResult,
        });
    } catch (error) {
        console.error('Error guardando datos de envío:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.', error: error.message });
    }
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

module.exports = router;
