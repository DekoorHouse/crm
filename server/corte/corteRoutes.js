'use strict';
/**
 * /corte — biblioteca de archivos SVG para la cortadora láser.
 * -------------------------------------------------------------------
 * El problema que resuelve: los archivos de corte viven repartidos entre la carpeta
 * "SVG Corte" de Drive (los que sube el worker), el escritorio del diseñador y el USB
 * de la máquina. Aquí quedan todos en un solo lugar, con miniatura para reconocerlos
 * sin abrirlos y descarga en lote para preparar una tanda de corte.
 *
 * Mismo patrón que /galeria: los bytes en Storage, los datos en Firestore y el archivo
 * se sirve por el MISMO origen (el bucket es privado, un fetch directo da 403).
 *
 * Decisiones que conviene conocer antes de tocar esto:
 *
 *  - EL ID ES EL HASH del contenido. Subir dos veces el mismo archivo no duplica nada:
 *    se devuelve el que ya estaba. Con la máquina, el diseñador y el worker subiendo a
 *    la misma biblioteca, eso pasa seguido.
 *  - LA MINIATURA SE GENERA AL SUBIR (ver miniatura.js), no al listar. Un grabado con
 *    foto embebida pesa MB: la lista sería inusable si el navegador bajara los SVG.
 *  - EL PEDIDO (DH) SALE DEL NOMBRE del archivo. Es el dato que el equipo ya escribe a
 *    mano en cada archivo; no inventamos otra fuente de verdad.
 */
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { db, bucket } = require('../config');
const { generar: generarMiniatura } = require('./miniatura');
const { crearZip } = require('./zip');

const router = express.Router();

const COLECCION = 'corte_archivos';
const CARPETA = 'corte';
const MAX_ARCHIVO_BYTES = 25 * 1024 * 1024;   // un grabado con foto embebida ronda 1-5 MB
const MAX_POR_SUBIDA = 20;
const LIMITE_LISTA = 1000;
const MAX_ZIP_ARCHIVOS = 60;
const LIMITE_ZIP_BYTES = 80 * 1024 * 1024;    // el ZIP se arma en memoria (ver zip.js)

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ARCHIVO_BYTES, files: MAX_POR_SUBIDA },
    // Sin esto multer lee los nombres en latin1 (su default) y "corazón" llega como
    // "corazÃ³n". Los archivos de corte se llaman con nombres de clientes: los acentos
    // y las ñ son la regla, no la excepción.
    defParamCharset: 'utf8',
});

/** Exige un ID token de Firebase. Mismo criterio que /api/inventario: escribir pide identidad. */
async function requiereAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: 'Falta token de sesión' });
    try {
        req.usuario = await admin.auth().verifyIdToken(token);
        next();
    } catch {
        res.status(401).json({ success: false, message: 'Sesión inválida o expirada' });
    }
}

// ===================== LECTURA DE METADATOS DEL SVG =====================

/** Número + unidad de un atributo tipo "350mm", "12.5cm", "1024". null si es %, calc, etc. */
function medida(valor) {
    const m = String(valor || '').trim().match(/^([\d.]+)\s*(mm|cm|in|pt|px)?$/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!isFinite(n) || n <= 0) return null;
    return { n, unidad: (m[2] || '').toLowerCase() };
}

const redondear = n => String(Math.round(n * 10) / 10);

/**
 * Medidas del archivo, leídas de su propia etiqueta <svg>. Primero width/height (que es
 * el tamaño real de la hoja, lo que le importa a quien corta) y, si vienen en % o no
 * vienen, el viewBox.
 */
function medirSvg(texto) {
    const etiqueta = (texto.slice(0, 4000).match(/<svg\b[^>]*>/i) || [''])[0];
    const atributo = nombre => {
        const m = etiqueta.match(new RegExp(`\\b${nombre}\\s*=\\s*["']([^"']+)["']`, 'i'));
        return m ? m[1] : null;
    };

    const w = medida(atributo('width'));
    const h = medida(atributo('height'));
    if (w && h) {
        const unidad = w.unidad || h.unidad || 'px';
        return { ancho: w.n, alto: h.n, unidad, medidas: `${redondear(w.n)} × ${redondear(h.n)} ${unidad}` };
    }

    const vb = String(atributo('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0) {
        return { ancho: vb[2], alto: vb[3], unidad: 'px', medidas: `${redondear(vb[2])} × ${redondear(vb[3])} px` };
    }
    return { ancho: null, alto: null, unidad: null, medidas: null };
}

/** El pedido que el equipo escribió en el nombre: "DH15412 Ana & Luis.svg" -> DH15412. */
function pedidoDelNombre(nombre) {
    const m = String(nombre || '').match(/\bDH\s?-?\s?(\d{3,6})\b/i);
    return m ? `DH${m[1]}` : null;
}

/** Nombre seguro para el header Content-Disposition (ASCII) + versión UTF-8 (RFC 5987). */
function disposicion(nombre) {
    const limpio = String(nombre || 'archivo.svg').replace(/["\\]/g, '').replace(/[\r\n]/g, ' ');
    const ascii = limpio.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '_');
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(limpio)}`;
}

/** URL pública estilo Firebase (token en la metadata), la que sí funciona en un <img>. */
function urlConToken(ruta, token) {
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(ruta)}?alt=media&token=${token}`;
}

const salida = doc => ({ id: doc.id, ...doc.data() });

// ===================== RUTAS =====================

/**
 * GET /api/corte
 * Lista completa, lo más nuevo arriba. El filtrado y la búsqueda son en el navegador:
 * son cientos de documentos chicos, igual que en /galeria.
 */
router.get('/', requiereAuth, async (req, res) => {
    try {
        const snap = await db.collection(COLECCION)
            .orderBy('subidoEn', 'desc')
            .limit(LIMITE_LISTA)
            .get();
        res.json({ success: true, archivos: snap.docs.map(salida) });
    } catch (error) {
        console.error('[CORTE] No se pudo listar:', error.message);
        res.status(500).json({ success: false, message: 'No se pudieron leer los archivos.' });
    }
});

/**
 * POST /api/corte   (multipart, campo "archivos")
 * Sube uno o varios SVG. Responde qué entró, qué ya estaba y qué se rechazó, para que
 * la pantalla lo pueda decir archivo por archivo en vez de un "algo falló".
 */
router.post('/', requiereAuth, upload.array('archivos', MAX_POR_SUBIDA), async (req, res) => {
    const archivos = req.files || [];
    if (!archivos.length) {
        return res.status(400).json({ success: false, message: 'No llegó ningún archivo.' });
    }

    const email = (req.usuario && (req.usuario.email || req.usuario.uid)) || 'desconocido';
    const subidos = [];
    const duplicados = [];
    const rechazados = [];

    for (const archivo of archivos) {
        const nombre = archivo.originalname || 'archivo.svg';
        try {
            const texto = archivo.buffer.toString('utf8');
            if (!/\.svg$/i.test(nombre) || !/<svg[\s>]/i.test(texto.slice(0, 4000))) {
                rechazados.push({ nombre, motivo: 'No es un SVG' });
                continue;
            }

            const hash = crypto.createHash('sha1').update(archivo.buffer).digest('hex');
            const id = hash.slice(0, 16);
            const yaEsta = await db.collection(COLECCION).doc(id).get();
            if (yaEsta.exists) {
                duplicados.push({ nombre, yaSubidoComo: yaEsta.data().nombre, archivo: salida(yaEsta) });
                continue;
            }

            const rutaSvg = `${CARPETA}/${id}.svg`;
            const rutaThumb = `${CARPETA}/${id}.png`;
            const { ancho, alto, unidad, medidas } = medirSvg(texto);

            const png = await generarMiniatura(archivo.buffer);
            const token = crypto.randomUUID();

            await bucket.file(rutaSvg).save(archivo.buffer, {
                contentType: 'image/svg+xml',
                resumable: false,
                metadata: { cacheControl: 'private, max-age=31536000' },
            });
            if (png) {
                await bucket.file(rutaThumb).save(png, {
                    contentType: 'image/png',
                    resumable: false,
                    // El contenido es inmutable (el id es el hash): se puede cachear para siempre.
                    metadata: { cacheControl: 'public, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
                });
            }

            const datos = {
                nombre,
                dh: pedidoDelNombre(nombre),
                medidas, ancho, alto, unidad,
                peso: archivo.size,
                hash,
                svgPath: rutaSvg,
                thumbPath: png ? rutaThumb : null,
                thumbUrl: png ? urlConToken(rutaThumb, token) : null,
                subidoPor: email,
                subidoEn: new Date().toISOString(),
            };
            await db.collection(COLECCION).doc(id).set(datos);
            subidos.push({ id, ...datos });
        } catch (error) {
            console.error(`[CORTE] Falló la subida de "${nombre}":`, error.message);
            rechazados.push({ nombre, motivo: 'Error al guardarlo' });
        }
    }

    res.json({ success: true, subidos, duplicados, rechazados });
});

/**
 * GET /api/corte/archivo/:id?thumb=1&descargar=1
 * Los bytes por el mismo origen: el bucket es privado y un fetch directo daría 403.
 *
 * Pide sesión como todo lo demás, así que NO sirve para un <img src> pelón: la pantalla
 * baja el archivo con fetch + token y lo muestra desde un blob. Las miniaturas de la
 * lista no pasan por aquí — van por su URL de Firebase con token, que sí carga sola.
 */
router.get('/archivo/:id', requiereAuth, async (req, res) => {
    try {
        const doc = await db.collection(COLECCION).doc(String(req.params.id)).get();
        if (!doc.exists) return res.status(404).json({ success: false, message: 'Ese archivo ya no está.' });

        const datos = doc.data();
        const esThumb = req.query.thumb === '1';
        const ruta = esThumb ? datos.thumbPath : datos.svgPath;
        if (!ruta) return res.status(404).json({ success: false, message: 'Ese archivo no tiene miniatura.' });

        const objeto = bucket.file(ruta);
        const [existe] = await objeto.exists();
        if (!existe) return res.status(404).json({ success: false, message: 'El archivo ya no está en Storage.' });

        if (req.query.descargar === '1') res.setHeader('Content-Disposition', disposicion(datos.nombre));
        res.setHeader('Content-Type', esThumb ? 'image/png' : 'image/svg+xml');
        res.setHeader('Cache-Control', 'private, max-age=31536000');   // inmutable: el id es el hash

        objeto.createReadStream()
            .on('error', err => {
                console.error('[CORTE] Error leyendo de Storage:', err.message);
                if (!res.headersSent) res.status(500).end(); else res.end();
            })
            .pipe(res);
    } catch (error) {
        console.error('[CORTE] /archivo falló:', error.message);
        res.status(500).json({ success: false, message: 'No se pudo leer el archivo.' });
    }
});

/**
 * POST /api/corte/zip   { ids: [...] }
 * Una tanda de corte en un solo archivo. Se arma en memoria, por eso los topes.
 */
router.post('/zip', requiereAuth, express.json(), async (req, res) => {
    try {
        const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String).filter(Boolean) : [];
        if (!ids.length) return res.status(400).json({ success: false, message: 'No se pidió ningún archivo.' });
        if (ids.length > MAX_ZIP_ARCHIVOS) {
            return res.status(400).json({ success: false, message: `Máximo ${MAX_ZIP_ARCHIVOS} archivos por ZIP.` });
        }

        const docs = await db.getAll(...ids.map(id => db.collection(COLECCION).doc(id)));
        const encontrados = docs.filter(d => d.exists).map(d => d.data());
        if (!encontrados.length) return res.status(404).json({ success: false, message: 'Esos archivos ya no están.' });

        const total = encontrados.reduce((suma, d) => suma + (d.peso || 0), 0);
        if (total > LIMITE_ZIP_BYTES) {
            return res.status(400).json({ success: false, message: 'Son demasiados MB juntos; selecciona menos archivos.' });
        }

        const entradas = [];
        for (const datos of encontrados) {
            const [bytes] = await bucket.file(datos.svgPath).download();
            entradas.push({ nombre: datos.nombre, datos: bytes, fecha: new Date(datos.subidoEn) });
        }

        const zip = crearZip(entradas);
        const hoy = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="corte-${hoy}.zip"`);
        res.setHeader('Content-Length', zip.length);
        res.end(zip);
    } catch (error) {
        console.error('[CORTE] /zip falló:', error.message);
        res.status(500).json({ success: false, message: 'No se pudo armar el ZIP.' });
    }
});

/**
 * DELETE /api/corte/:id
 * Borra de verdad: el SVG, su miniatura y el documento. La pantalla pide confirmación.
 */
router.delete('/:id', requiereAuth, async (req, res) => {
    try {
        const id = String(req.params.id);
        const ref = db.collection(COLECCION).doc(id);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ success: false, message: 'Ese archivo ya no está.' });

        const datos = doc.data();

        // El bucket trae encendida la extensión "Resize Images": por cada PNG que subimos
        // aparece además un corte/<id>_45x45.png que nosotros nunca escribimos. Borrando
        // solo svgPath y thumbPath, esas copias quedarían huérfanas para siempre — por eso
        // se borra TODO lo que empiece con el id (que son 16 hex: no puede pegar con otro).
        const [objetos] = await bucket.getFiles({ prefix: `${CARPETA}/${id}` });
        await Promise.all(objetos.map(o => o.delete({ ignoreNotFound: true })));
        for (const ruta of [datos.svgPath, datos.thumbPath].filter(Boolean)) {
            if (!objetos.some(o => o.name === ruta)) await bucket.file(ruta).delete({ ignoreNotFound: true });
        }
        await ref.delete();
        console.log(`[CORTE] ${req.usuario.email || req.usuario.uid} borró "${datos.nombre}" (${id}).`);
        res.json({ success: true });
    } catch (error) {
        console.error('[CORTE] No se pudo borrar:', error.message);
        res.status(500).json({ success: false, message: 'No se pudo borrar el archivo.' });
    }
});

// Multer contesta con su propio error cuando el archivo pasa del límite; sin esto, el
// navegador recibe un 500 sin explicación y la pantalla no sabe qué decir.
router.use((error, req, res, next) => {
    if (error && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: 'Cada archivo puede pesar hasta 25 MB.' });
    }
    if (error && error.code === 'LIMIT_FILE_COUNT') {
        return res.status(413).json({ success: false, message: `Máximo ${MAX_POR_SUBIDA} archivos por subida.` });
    }
    if (error) {
        console.error('[CORTE] Error no previsto:', error.message);
        return res.status(500).json({ success: false, message: 'Algo falló al subir.' });
    }
    next();
});

module.exports = router;
