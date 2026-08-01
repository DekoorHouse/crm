/**
 * BANCO DE IMÁGENES (colección `galeria`) — rutas de apoyo.
 * -------------------------------------------------------------------
 * El listado y la búsqueda los hace el front leyendo Firestore con el SDK cliente
 * (mismo patrón que /inventario): son ~200 documentos, caben en memoria y así el
 * buscador filtra sin ida y vuelta al servidor.
 *
 * Aquí vive solo lo que el navegador NO puede hacer solo:
 *
 *  1. `/archivo/:id` — proxy de la imagen por el MISMO origen. Las fotos viven en
 *     storage.googleapis.com y el CORS del bucket únicamente permite el origen
 *     crm-rzon.onrender.com, así que desde app.dekoormx.com un fetch() de la imagen
 *     truena y el portapapeles se queda vacío. Mostrarlas en un <img> sí funciona
 *     (eso no pide CORS); lo que falla es leer los bytes. Pasarlas por Node evita
 *     tocar la configuración del bucket, que es infraestructura compartida.
 *
 *  2. `/:id/enviada` — contador de uso. Sirve para ordenar la galería por lo que de
 *     verdad se manda y para detectar qué modelos piden los clientes.
 */
const express = require('express');
const router = express.Router();
const { db, bucket } = require('../config');

const COLECCION = 'galeria';

/**
 * GET /api/galeria/archivo/:id?thumb=1&descargar=1
 * Devuelve los bytes de la imagen por el mismo origen del CRM.
 */
router.get('/archivo/:id', async (req, res) => {
    try {
        const doc = await db.collection(COLECCION).doc(String(req.params.id)).get();
        if (!doc.exists) return res.status(404).json({ success: false, message: 'Foto no encontrada.' });

        const data = doc.data();
        const ruta = req.query.thumb === '1' ? data.thumbPath : data.fullPath;
        if (!ruta) return res.status(404).json({ success: false, message: 'La foto no tiene archivo asociado.' });

        const archivo = bucket.file(ruta);
        const [existe] = await archivo.exists();
        if (!existe) return res.status(404).json({ success: false, message: 'El archivo ya no está en Storage.' });

        if (req.query.descargar === '1') {
            // Nombre legible al descargar: el título, no el hash.
            const base = String(data.titulo || 'foto')
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'foto';
            res.setHeader('Content-Disposition', `attachment; filename="${base}.webp"`);
        }
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'private, max-age=86400');   // el contenido es inmutable: el id es el hash

        archivo.createReadStream()
            .on('error', err => {
                console.error('[GALERIA] Error leyendo de Storage:', err.message);
                if (!res.headersSent) res.status(500).end();
            })
            .pipe(res);
    } catch (error) {
        console.error('[GALERIA] /archivo falló:', error.message);
        res.status(500).json({ success: false, message: 'Error al leer la imagen.' });
    }
});

/**
 * POST /api/galeria/:id/enviada
 * Suma uno al contador de envíos. Es best-effort: si falla NO debe romper el envío
 * al cliente, que es lo único que de verdad importa en ese momento.
 */
router.post('/:id/enviada', async (req, res) => {
    try {
        const admin = require('firebase-admin');
        await db.collection(COLECCION).doc(String(req.params.id)).update({
            vecesEnviada: admin.firestore.FieldValue.increment(1),
            ultimoEnvio: new Date().toISOString(),
        });
        res.json({ success: true });
    } catch (error) {
        console.warn('[GALERIA] No se pudo contar el envío:', error.message);
        res.json({ success: false });
    }
});

module.exports = router;
