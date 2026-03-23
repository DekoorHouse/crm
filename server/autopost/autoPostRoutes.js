const express = require('express');
const router = express.Router();
const multer = require('multer');
const { fetchAvailablePhotos, uploadPhoto, deletePhoto } = require('./photoService');
const { verifyPageToken } = require('./facebookPostService');
const { executeAutoPost, previewNextPost, getLog, getUpcomingQueue, getSchedulerStatus } = require('./autoPostScheduler');
const { getPages, getPage, createPage, updatePage, deletePage } = require('./pageService');

// Multer para subir archivos en memoria
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Solo se permiten imagenes.'));
    }
});

// Helper para obtener pageConfig del query param
async function resolvePageConfig(req) {
    const pageDocId = req.query.page;
    if (!pageDocId) return null;
    return await getPage(pageDocId);
}

// --- Paginas ---

router.get('/pages', async (req, res) => {
    try {
        const pages = await getPages();
        res.json({ pages });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/pages', async (req, res) => {
    try {
        const { name, fbPageId, accessToken, storageFolder, brandPrompt } = req.body;
        if (!name || !fbPageId || !accessToken) {
            return res.status(400).json({ error: 'name, fbPageId y accessToken son requeridos.' });
        }
        const id = await createPage({ name, fbPageId, accessToken, storageFolder, brandPrompt });
        res.json({ id, message: 'Pagina creada.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/pages/:id', async (req, res) => {
    try {
        await updatePage(req.params.id, req.body);
        res.json({ message: 'Pagina actualizada.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/pages/:id', async (req, res) => {
    try {
        await deletePage(req.params.id);
        res.json({ message: 'Pagina eliminada.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Fotos (Firebase Storage) ---

// Listar fotos disponibles (filtradas por pagina si ?page=xxx)
router.get('/photos', async (req, res) => {
    try {
        const pageConfig = await resolvePageConfig(req);
        const photos = await fetchAvailablePhotos(pageConfig);
        res.json({ photos, count: photos.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Subir foto(s)
router.post('/photos/upload', upload.array('photos', 20), async (req, res) => {
    try {
        if (!req.files?.length) return res.status(400).json({ error: 'No se enviaron fotos.' });

        const pageConfig = await resolvePageConfig(req);
        const uploaded = [];
        for (const file of req.files) {
            const path = await uploadPhoto(file.buffer, file.originalname, file.mimetype, pageConfig);
            uploaded.push({ filename: file.originalname, path });
        }

        res.json({ uploaded, count: uploaded.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Eliminar foto
router.delete('/photos/:filename', async (req, res) => {
    try {
        const pageConfig = await resolvePageConfig(req);
        const folder = pageConfig?.storageFolder ? `autopost/${pageConfig.storageFolder}` : 'autopost';
        await deletePhoto(`${folder}/${req.params.filename}`);
        res.json({ deleted: req.params.filename });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Facebook ---

router.get('/facebook/verify', async (req, res) => {
    try {
        const pageConfig = await resolvePageConfig(req);
        const result = await verifyPageToken(pageConfig);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Auto Post ---

router.get('/status', (req, res) => {
    res.json(getSchedulerStatus());
});

router.get('/log', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const pageConfig = await resolvePageConfig(req);
        const pageId = pageConfig?.fbPageId;
        const [log, upcoming] = await Promise.all([
            getLog(limit, pageId),
            getUpcomingQueue(pageConfig)
        ]);
        res.json({ log, upcoming });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/preview', async (req, res) => {
    try {
        const pageConfig = await resolvePageConfig(req);
        const preview = await previewNextPost(pageConfig);
        res.json(preview);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/trigger', async (req, res) => {
    try {
        const pageConfig = await resolvePageConfig(req);
        const result = await executeAutoPost(pageConfig);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Seed inicial de paginas ---
router.post('/pages/seed', async (req, res) => {
    try {
        const { db } = require('../config');
        const pages = req.body.pages;
        if (!pages?.length) return res.status(400).json({ error: 'Enviar array de pages.' });

        const results = [];
        for (const page of pages) {
            const existing = await db.collection('autopost_pages')
                .where('fbPageId', '==', page.fbPageId)
                .get();

            if (!existing.empty) {
                await db.collection('autopost_pages').doc(existing.docs[0].id).update(page);
                results.push({ name: page.name, action: 'updated', id: existing.docs[0].id });
            } else {
                const ref = await db.collection('autopost_pages').add({ ...page, createdAt: new Date() });
                results.push({ name: page.name, action: 'created', id: ref.id });
            }
        }
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
