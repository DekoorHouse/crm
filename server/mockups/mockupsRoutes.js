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

// Guarda el último preview de un pedido para que persista en la lista (mockup_previews/{orderId}).
async function savePreview(orderId, image, prompt) {
    if (!orderId || !image) return;
    try {
        await db.collection('mockup_previews').doc(String(orderId)).set({
            orderId: String(orderId),
            imageUrl: image.fullUrl || image.thumbUrl || '',
            prompt: prompt || '',
            createdAt: new Date().toISOString(),
        });
    } catch (e) { console.error('[mockups] savePreview:', e.message); }
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
    // TODOS los pedidos "Sin estatus" (sin ventana por fecha, para no perder ninguno).
    // Nota: orderBy('createdAt') excluiría los docs que no tengan ese campo, así que
    // filtramos por estatus (índice automático) y ordenamos por fecha en código.
    const snap = await db.collection('pedidos').where('estatus', '==', 'Sin estatus').limit(500).get();
    const pend = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
            const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;   // más recientes primero; los que no tienen fecha, al final
        });

    // Join del nombre del cliente (contacts_whatsapp/{telefono}.name)
    const phones = [...new Set(pend.map(o => o.contactId || o.telefono).filter(Boolean).map(String))];
    const nameByPhone = {};
    if (phones.length) {
        const refs = phones.map(p => db.collection('contacts_whatsapp').doc(p));
        const docs = await db.getAll(...refs);
        docs.forEach(d => { if (d.exists) nameByPhone[d.id] = d.data().name || ''; });
    }

    // Previews ya generados, para que persistan en la lista al recargar.
    const previewByOrder = {};
    if (pend.length) {
        const prefs = pend.map(o => db.collection('mockup_previews').doc(String(o.id)));
        const pdocs = await db.getAll(...prefs);
        pdocs.forEach(d => { if (d.exists) previewByOrder[d.id] = d.data().imageUrl || ''; });
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
            previewUrl: previewByOrder[o.id] || null,
        };
    });
    res.json({ success: true, items });
}));

// --- Plantillas de mockup (diseños de lámpara) ---
router.get('/templates', asyncHandler(async (req, res) => {
    res.json({ success: true, templates: await svc.listTemplates() });
}));

router.post('/templates', asyncHandler(async (req, res) => {
    const { nombre, baseImagePath, baseImageUrl, promptTemplate, productMatch, aspectRatio } = req.body;
    const template = await svc.createTemplate({ nombre, baseImagePath, baseImageUrl, promptTemplate, productMatch, aspectRatio });
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

    // Gemini responde en una sola llamada (rápido) -> síncrono.
    if (provider === 'gemini') {
        const ref = await svc.fetchImageAsBase64(tpl.baseImageUrl);
        const result = await svc.generateImage(prompt, aspectRatio, [ref], resolution || '2K');
        const saved = await svc.saveToGallery(prompt, aspectRatio, result.images, result.usage, result.cost);
        await savePreview(req.body.orderId, saved[0], prompt);
        return res.json({ success: true, image: saved[0], prompt, cost: result.cost });
    }

    // WaveSpeed (GPT Image 2) puede tardar >90s -> asíncrono: enviamos la tarea
    // y devolvemos un jobId; el front consulta /generate-status/:jobId.
    const wave = require('./wavespeedClient');
    const { predictionId } = await wave.submitEdit(prompt, [tpl.baseImageUrl], {
        aspectRatio,
        resolution: resolution || '1k',
        quality: quality || 'high',
    });
    await db.collection('mockup_jobs').doc(predictionId).set({
        prompt, aspectRatio, templateId, orderId: req.body.orderId || null, createdAt: new Date().toISOString(),
    });
    res.json({ success: true, jobId: predictionId, prompt });
}));

// GET /api/mockups/generate-status/:jobId — Avance del preview (WaveSpeed)
router.get('/generate-status/:jobId', asyncHandler(async (req, res) => {
    const jobId = req.params.jobId;
    const wave = require('./wavespeedClient');
    const r = await wave.fetchResult(jobId);

    if (r.status === 'failed') {
        return res.json({ success: true, status: 'failed', error: r.error || 'La generación falló.' });
    }
    if (r.status !== 'completed' || r.outputs.length === 0) {
        return res.json({ success: true, status: 'processing' });
    }

    // Completado: descargar, guardar en galería y limpiar el job.
    const jobDoc = await db.collection('mockup_jobs').doc(jobId).get();
    const job = jobDoc.exists ? jobDoc.data() : {};
    const img = await wave.downloadImage(r.outputs[0]);
    const cost = wave.costFor(1);
    const saved = await svc.saveToGallery(
        job.prompt || 'Preview de lámpara',
        job.aspectRatio || '1:1',
        [img],
        { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost
    );
    try { await db.collection('mockup_jobs').doc(jobId).delete(); } catch (_) { /* ignore */ }
    await savePreview(job.orderId, saved[0], job.prompt || '');

    res.json({ success: true, status: 'completed', image: saved[0], cost });
}));

// GET /api/mockups/send-context?telefono=... — datos para armar el envío del preview:
// textos de /cuatro y /bbb, y si la ventana de 24h de WhatsApp está abierta.
router.get('/send-context', asyncHandler(async (req, res) => {
    const telefono = String(req.query.telefono || '').trim();
    if (!telefono) return res.status(400).json({ success: false, error: 'Falta telefono.' });

    // Textos de las respuestas rápidas /cuatro (pedido listo + pago) y /bbb (tarjeta)
    const qr = {};
    try {
        const qrSnap = await db.collection('quick_replies').where('shortcut', 'in', ['cuatro', 'bbb']).get();
        qrSnap.forEach(d => { const x = d.data(); qr[String(x.shortcut || '').toLowerCase()] = x.message || ''; });
    } catch (e) { console.error('[mockups] quick_replies:', e.message); }

    // Ventana de 24h: ¿el último mensaje ENTRANTE (from === telefono) es < 24h?
    let windowOpen = false;
    try {
        const msgs = await db.collection('contacts_whatsapp').doc(telefono).collection('messages')
            .orderBy('timestamp', 'desc').limit(50).get();
        for (const d of msgs.docs) {
            const m = d.data();
            if (m.from && String(m.from) === telefono) {   // entrante (del cliente)
                const t = m.timestamp && m.timestamp.toMillis ? m.timestamp.toMillis() : 0;
                windowOpen = t > 0 && (Date.now() - t) <= 24 * 3600 * 1000;
                break;
            }
        }
    } catch (e) { console.error('[mockups] window check:', e.message); /* ante la duda: cerrada */ }

    res.json({ success: true, windowOpen, cuatro: qr.cuatro || '', bbb: qr.bbb || '' });
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
