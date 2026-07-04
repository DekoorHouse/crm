const express = require('express');
const multer = require('multer');
const router = express.Router();
const svc = require('./mockupsService');
const { db } = require('../config');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(err => {
            console.error('[MOCKUPS ERROR]', err.message);
            res.status(err.status || 500).json({ success: false, error: err.message || 'Error interno del servidor' });
        });
    };
}

// POST /api/mockups/generate — Generar imagen y guardar en galería
router.post('/generate', asyncHandler(async (req, res) => {
    const { prompt, aspectRatio, resolution, images: refImages } = req.body;

    if (!prompt || !prompt.trim()) {
        return res.status(400).json({ success: false, error: 'Se requiere un prompt.' });
    }

    // refImages: array de { mimeType, base64 }
    const validImages = (refImages || []).filter(i => i?.base64);
    const result = await svc.generateImage(prompt.trim(), aspectRatio || '1:1', validImages, resolution || '2K');

    // Guardar en Firebase Storage + Firestore
    const saved = await svc.saveToGallery(prompt.trim(), aspectRatio || '1:1', result.images, result.usage, result.cost);

    res.json({
        success: true,
        images: saved.map(s => ({ id: s.id, fullUrl: s.fullUrl, thumbUrl: s.thumbUrl })),
        usage: result.usage,
        cost: result.cost,
    });
}));

// GET /api/mockups/gallery — Listar galería
router.get('/gallery', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const items = await svc.getGallery(limit);
    res.json({ success: true, items });
}));

// DELETE /api/mockups/gallery/:id — Eliminar imagen
router.delete('/gallery/:id', asyncHandler(async (req, res) => {
    await svc.deleteFromGallery(req.params.id);
    res.json({ success: true });
}));

// POST /api/mockups/batch — Crear batch job desde el editor
router.post('/batch', asyncHandler(async (req, res) => {
    const { names, nameImageUrls } = req.body;
    if (!names?.length || !nameImageUrls?.length) {
        return res.status(400).json({ success: false, error: 'Se requieren nombres e imágenes.' });
    }
    const id = await svc.saveBatch(names, nameImageUrls);
    res.json({ success: true, id });
}));

// GET /api/mockups/batch/:id — Obtener batch job
router.get('/batch/:id', asyncHandler(async (req, res) => {
    const batch = await svc.getBatch(req.params.id);
    res.json({ success: true, batch });
}));

// ===================== PREVIEW DE LÁMPARAS (desde pedidos) =====================

// GET /api/mockups/pending — Pedidos "Sin estatus" (pendientes de preview)
// Se sobre-trae por fecha y se filtra en código para incluir también los
// documentos antiguos que NO tienen el campo `estatus` (default = 'Sin estatus').
router.get('/pending', asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 60, 150);
    const snap = await db.collection('pedidos').orderBy('createdAt', 'desc').limit(limit * 3).get();
    const pend = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(o => (o.estatus || 'Sin estatus') === 'Sin estatus')
        .slice(0, limit);

    // Join del nombre del cliente (contacts_whatsapp/{telefono}.name)
    const phones = [...new Set(pend.map(o => o.contactId || o.telefono).filter(Boolean).map(String))];
    const nameByPhone = {};
    if (phones.length) {
        const refs = phones.map(p => db.collection('contacts_whatsapp').doc(p));
        const docs = await db.getAll(...refs);
        docs.forEach(d => { if (d.exists) nameByPhone[d.id] = d.data().name || ''; });
    }

    const items = pend.map(o => {
        const phone = String(o.contactId || o.telefono || '');
        let createdAt = null;
        try { createdAt = o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : (o.createdAt || null); } catch (_) { createdAt = null; }
        const orderItems = (Array.isArray(o.items) && o.items.length)
            ? o.items.map(it => ({ producto: it.producto || '', cantidad: it.cantidad || 1, precio: it.precio ?? null, datosProducto: it.datosProducto || '' }))
            : [{ producto: o.producto || '', cantidad: 1, precio: o.precio ?? null, datosProducto: o.datosProducto || '' }];
        return {
            id: o.id,
            consecutiveOrderNumber: o.consecutiveOrderNumber || null,
            telefono: o.telefono || phone,
            clientName: nameByPhone[phone] || '',
            producto: o.producto || (orderItems[0] && orderItems[0].producto) || '',
            createdAt,
            items: orderItems,
        };
    });
    res.json({ success: true, items });
}));

// --- Plantillas de mockup (diseños de lámpara) ---
router.get('/templates', asyncHandler(async (req, res) => {
    res.json({ success: true, templates: await svc.listTemplates() });
}));

router.post('/templates', asyncHandler(async (req, res) => {
    const { nombre, baseImagePath, baseImageUrl, promptTemplate, productMatch } = req.body;
    const template = await svc.createTemplate({ nombre, baseImagePath, baseImageUrl, promptTemplate, productMatch });
    res.json({ success: true, template });
}));

router.put('/templates/:id', asyncHandler(async (req, res) => {
    const template = await svc.updateTemplate(req.params.id, req.body || {});
    res.json({ success: true, template });
}));

router.delete('/templates/:id', asyncHandler(async (req, res) => {
    await svc.deleteTemplate(req.params.id);
    res.json({ success: true });
}));

// POST /api/mockups/templates/upload — Subir foto base (webp público)
router.post('/templates/upload', upload.single('foto'), asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se envió archivo.' });
    const out = await svc.uploadTemplateBaseImage(req.file.buffer);
    res.json({ success: true, ...out });
}));

// POST /api/mockups/generate-preview — Generar preview desde plantilla + campos
router.post('/generate-preview', asyncHandler(async (req, res) => {
    const { templateId, fields = {}, provider = 'wavespeed', resolution, quality } = req.body;
    if (!templateId) return res.status(400).json({ success: false, error: 'Se requiere templateId.' });

    const tpl = await svc.getTemplate(templateId);
    if (!tpl) return res.status(404).json({ success: false, error: 'Plantilla no encontrada.' });
    if (!tpl.baseImageUrl) return res.status(400).json({ success: false, error: 'La plantilla no tiene imagen base.' });

    const aspectRatio = tpl.aspectRatio || req.body.aspectRatio || '1:1';
    const prompt = svc.buildPromptFromTemplate(tpl.promptTemplate, fields);
    if (!prompt) return res.status(400).json({ success: false, error: 'El prompt quedó vacío.' });

    let result;
    if (provider === 'gemini') {
        const ref = await svc.fetchImageAsBase64(tpl.baseImageUrl);
        result = await svc.generateImage(prompt, aspectRatio, [ref], resolution || '2K');
    } else {
        const { generateEdit } = require('./wavespeedClient');
        result = await generateEdit(prompt, [tpl.baseImageUrl], {
            aspectRatio,
            resolution: resolution || '1k',
            quality: quality || 'high',
        });
    }

    const saved = await svc.saveToGallery(prompt, aspectRatio, result.images, result.usage, result.cost);
    res.json({ success: true, image: saved[0], prompt, usage: result.usage, cost: result.cost });
}));

// POST /api/mockups/send — Enviar un preview al cliente por WhatsApp
router.post('/send', asyncHandler(async (req, res) => {
    const { telefono, imageUrl, caption } = req.body;
    if (!telefono || !imageUrl) return res.status(400).json({ success: false, error: 'Se requiere telefono e imageUrl.' });

    // Salvaguarda: solo enviar a teléfonos que existan como contacto o pedido.
    const phone = String(telefono).trim();
    const contactSnap = await db.collection('contacts_whatsapp').doc(phone).get();
    let known = contactSnap.exists;
    if (!known) {
        const pedSnap = await db.collection('pedidos').where('telefono', '==', phone).limit(1).get();
        known = !pedSnap.empty;
    }
    if (!known) return res.status(400).json({ success: false, error: 'El teléfono no corresponde a un pedido/contacto conocido.' });

    const { sendAdvancedWhatsAppMessage } = require('../services');
    const result = await sendAdvancedWhatsAppMessage(phone, {
        text: caption || '',
        fileUrl: imageUrl,     // debe ser público (las URLs de galería lo son)
        fileType: 'image/webp',
    });
    res.json({ success: true, messageId: result.id });
}));

module.exports = router;
