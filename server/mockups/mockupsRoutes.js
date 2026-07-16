const express = require('express');
const multer = require('multer');
const router = express.Router();
const svc = require('./mockupsService');
const { db, admin } = require('../config');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(err => {
            console.error('[MOCKUPS ERROR]', err.message);
            res.status(err.status || 500).json({ success: false, error: err.message || 'Error interno del servidor' });
        });
    };
}

// Guarda un preview de un pedido para que persista en la lista. Un pedido puede tener
// VARIOS previews (una lámpara por bloque); se guardan en un array upsert por blockId.
async function savePreview(orderId, image, prompt, meta = {}) {
    if (!orderId || !image) return;
    try {
        const ref = db.collection('mockup_previews').doc(String(orderId));
        const doc = await ref.get();
        const previews = (doc.exists && Array.isArray(doc.data().previews)) ? doc.data().previews : [];
        const blockId = meta.blockId || 'b1';
        const entry = {
            blockId,
            imageUrl: image.fullUrl || image.thumbUrl || '',
            templateId: meta.templateId || null,
            fields: meta.fields || {},
            createdAt: new Date().toISOString(),
        };
        if (meta.secondRefUrl) entry.secondRefUrl = meta.secondRefUrl;   // 2ª referencia usada (diseño/subida)
        const i = previews.findIndex(p => p.blockId === blockId);
        if (i >= 0) previews[i] = entry; else previews.push(entry);
        await ref.set({ orderId: String(orderId), previews }, { merge: true });
        // El pedido ya tiene mockup -> sale de la cola "falta mockup" de Pendientes de Diseño.
        try {
            const pref = db.collection('pedidos').doc(String(orderId));
            await pref.set({ mockupPreviewAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            const ped = await pref.get();
            const cid = ped.exists ? (ped.data().contactId || ped.data().telefono) : null;
            if (cid) await require('../design/designPending').recomputeForContact(cid);
        } catch (_) {}
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
        .filter(o => o.mockupHidden !== true)   // pedidos ocultados manualmente de la lista de mockups
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

    // Hora del ÚLTIMO mensaje del CLIENTE (entrante: from === telefono) por contacto. Usa el índice
    // messages (from ASC, timestamp DESC); si falla, se omite la hora (no rompe la lista).
    const lastMsgByPhone = {};
    if (phones.length) {
        const snaps = await Promise.all(phones.map(p =>
            db.collection('contacts_whatsapp').doc(p).collection('messages')
                .where('from', '==', p).orderBy('timestamp', 'desc').limit(1).get()
                .then(s => ({ p, s })).catch(() => ({ p, s: null }))
        ));
        snaps.forEach(({ p, s }) => {
            if (s && !s.empty) {
                const t = s.docs[0].data().timestamp;
                try { lastMsgByPhone[p] = t && t.toDate ? t.toDate().toISOString() : (t || null); } catch (_) { lastMsgByPhone[p] = null; }
            }
        });
    }

    // Previews ya generados (uno o varios por pedido), para persistir en la lista al recargar.
    const previewByOrder = {};
    if (pend.length) {
        const prefs = pend.map(o => db.collection('mockup_previews').doc(String(o.id)));
        const pdocs = await db.getAll(...prefs);
        pdocs.forEach(d => { if (d.exists) previewByOrder[d.id] = Array.isArray(d.data().previews) ? d.data().previews : []; });
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
            lastCustomerMsgAt: lastMsgByPhone[phone] || null,
            items: orderItems,
            previews: previewByOrder[o.id] || [],
        };
    });
    res.json({ success: true, items });
}));

// --- Plantillas de mockup (diseños de lámpara) ---
router.get('/templates', asyncHandler(async (req, res) => {
    res.json({ success: true, templates: await svc.listTemplates() });
}));

router.post('/templates', asyncHandler(async (req, res) => {
    const { nombre, baseImagePath, baseImageUrl, promptTemplate, productMatch, aspectRatio, designSvg } = req.body;
    const template = await svc.createTemplate({ nombre, baseImagePath, baseImageUrl, promptTemplate, productMatch, aspectRatio, designSvg });
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

// POST /api/mockups/upload-image — Subir una imagen cualquiera y devolver su URL pública.
// La usa la 2ª referencia del preview: el diseño rasterizado por el navegador (PNG) o una
// imagen que el operador suba a mano. Debe ser pública (WaveSpeed la descarga por URL).
router.post('/upload-image', upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se envió archivo.' });
    const out = await svc.uploadPublicImage(req.file.buffer, 'refs');
    res.json({ success: true, url: out.url, path: out.path });
}));

// POST /api/mockups/generate-preview — Generar preview desde plantilla + campos
router.post('/generate-preview', asyncHandler(async (req, res) => {
    const { templateId, fields = {}, provider = 'wavespeed', resolution, quality } = req.body;
    if (!templateId) return res.status(400).json({ success: false, error: 'Se requiere templateId.' });

    const tpl = await svc.getTemplate(templateId);
    if (!tpl) return res.status(404).json({ success: false, error: 'Plantilla no encontrada.' });
    if (!tpl.baseImageUrl) return res.status(400).json({ success: false, error: 'La plantilla no tiene imagen base.' });

    const aspectRatio = tpl.aspectRatio || req.body.aspectRatio || '1:1';
    // Prompt base: el de la plantilla, o un override (el banco de pruebas permite editar el
    // prompt y probarlo sin guardarlo en la plantilla). Conserva los placeholders {nombre1}…
    const promptOverride = (typeof req.body.promptTemplate === 'string' && req.body.promptTemplate.trim()) ? req.body.promptTemplate : null;
    let prompt = svc.buildPromptFromTemplate(promptOverride || tpl.promptTemplate, fields);
    if (!prompt) return res.status(400).json({ success: false, error: 'El prompt quedó vacío.' });
    // Detalles adicionales que el operador escribió: se suman al prompt de la plantilla.
    const extraPrompt = String(req.body.extraPrompt || '').trim();
    if (extraPrompt) prompt += '\n\nInstrucciones adicionales del operador (aplícalas además de lo anterior): ' + extraPrompt;

    // 2ª imagen de referencia (opcional): el DISEÑO a grabar (nombres/fecha/símbolo). Puede venir
    // generada por código (SVG->PNG) o subida a mano. Debe ser una URL pública. Cuando está
    // presente, se le indica a la IA que reproduzca ese diseño sobre la lámpara base.
    const secondImageUrl = String(req.body.secondImageUrl || '').trim();
    if (secondImageUrl) {
        prompt += '\n\nSe adjuntan DOS imágenes: (1) la foto de la lámpara base —NO la modifiques (figura, base, acrílico, color, iluminación y fondo intactos)— y (2) el DISEÑO de referencia que debes grabar en la lámpara. Reproduce el diseño (2) EXACTAMENTE: mismas palabras y ortografía, misma tipografía manuscrita, mismo símbolo y misma composición. Intégralo de forma foto-realista sobre la lámpara ajustando solo tamaño, posición y perspectiva; no inventes ni cambies el texto.';
    }

    // Gemini responde en una sola llamada (rápido) -> síncrono.
    if (provider === 'gemini') {
        const refs = [await svc.fetchImageAsBase64(tpl.baseImageUrl)];
        if (secondImageUrl) refs.push(await svc.fetchImageAsBase64(secondImageUrl));
        const result = await svc.generateImage(prompt, aspectRatio, refs, resolution || '2K');
        const saved = await svc.saveToGallery(prompt, aspectRatio, result.images, result.usage, result.cost);
        await savePreview(req.body.orderId, saved[0], prompt, { blockId: req.body.blockId, templateId, fields, secondRefUrl: secondImageUrl });
        return res.json({ success: true, image: saved[0], prompt, cost: result.cost });
    }

    // WaveSpeed (GPT Image 2) puede tardar >90s -> asíncrono: enviamos la tarea
    // y devolvemos un jobId; el front consulta /generate-status/:jobId.
    const images = [tpl.baseImageUrl];
    if (secondImageUrl) images.push(secondImageUrl);
    const wave = require('./wavespeedClient');
    const { predictionId } = await wave.submitEdit(prompt, images, {
        aspectRatio,
        resolution: resolution || '1k',
        quality: quality || 'high',
    });
    await db.collection('mockup_jobs').doc(predictionId).set({
        prompt, aspectRatio, templateId, orderId: req.body.orderId || null,
        blockId: req.body.blockId || null, fields: fields || {}, secondRefUrl: secondImageUrl || null,
        createdAt: new Date().toISOString(),
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
    await savePreview(job.orderId, saved[0], job.prompt || '', { blockId: job.blockId, templateId: job.templateId, fields: job.fields, secondRefUrl: job.secondRefUrl });

    res.json({ success: true, status: 'completed', image: saved[0], cost });
}));

// GET /api/mockups/send-context?telefono=... — datos para armar el envío del preview:
// textos de /cuatro y /bbb, y si la ventana de 24h de WhatsApp está abierta.
router.get('/send-context', asyncHandler(async (req, res) => {
    const telefono = String(req.query.telefono || '').trim();
    if (!telefono) return res.status(400).json({ success: false, error: 'Falta telefono.' });

    // Respuestas rápidas /cuatro (pedido listo + pago; PUEDE llevar foto) y /bbb (tarjeta).
    // Se devuelven con su media para replicar el envío tal cual lo hace el chat.
    const qr = { cuatro: null, bbb: null };
    try {
        const qrSnap = await db.collection('quick_replies').where('shortcut', 'in', ['cuatro', 'bbb']).get();
        qrSnap.forEach(d => {
            const x = d.data();
            qr[String(x.shortcut || '').toLowerCase()] = { text: x.message || '', fileUrl: x.fileUrl || null, fileType: x.fileType || null };
        });
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

    res.json({ success: true, windowOpen, cuatro: qr.cuatro, bbb: qr.bbb });
}));

// POST /api/mockups/wa-image — Devuelve una versión JPEG pública de una imagen de la
// galería. WhatsApp NO soporta imágenes WebP (solo JPEG/PNG); la galería guarda WebP,
// así que se convierte (una sola vez, cacheada) antes de mandar la foto al cliente.
router.post('/wa-image', asyncHandler(async (req, res) => {
    const url = String(req.body.url || '');
    if (!url) return res.status(400).json({ success: false, error: 'Falta url.' });
    const jpgUrl = await svc.ensureJpeg(url);
    res.json({ success: true, jpgUrl });
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
    // Ya le mandamos su preview: en "Pendientes de Diseño" pasa de "anticipo" a "mockup pagado" (no bloquear).
    try { await require('../design/designPending').markPreviewSent(phone); } catch (_) {}
    res.json({ success: true, messageId: result.id });
}));

// --- Config de la generación automática (on/off) ---
router.get('/auto-config', asyncHandler(async (req, res) => {
    const doc = await db.collection('mockup_config').doc('settings').get();
    const data = doc.exists ? doc.data() : {};
    res.json({ success: true, autoGenerate: data.autoGenerate !== false });   // default: encendida
}));

router.post('/auto-config', asyncHandler(async (req, res) => {
    const autoGenerate = req.body.autoGenerate !== false;
    await db.collection('mockup_config').doc('settings').set({ autoGenerate }, { merge: true });
    res.json({ success: true, autoGenerate });
}));

// POST /api/mockups/auto-run — dispara YA una corrida de auto-generación (p.ej. tras recargar
// saldo en WaveSpeed). NO espera a que termine (puede tardar minutos): arranca en segundo plano y
// responde de inmediato. Fuerza la corrida aunque el toggle de auto-generar esté apagado y usa un
// lote grande para vaciar de un jalón los pendientes de corazones (nombres+fecha) sin preview.
router.post('/auto-run', asyncHandler(async (req, res) => {
    const { runOnce } = require('./mockupAutoScheduler');
    Promise.resolve(runOnce({ force: true })).catch(e => console.error('[mockup-auto] corrida manual falló:', e.message));
    res.json({ success: true, started: true });
}));

// POST /api/mockups/claim-payment — reclama (ATÓMICO, en el servidor) el envío ÚNICO del bloque
// de pago (/cuatro + /bbb) por pedido. Antes el candado vivía en memoria del navegador y se
// reiniciaba al recargar la página o se "carreaba" al mandar varias fotos rápido, por eso el
// bloque de pago salía repetido. Solo el PRIMER claim recibe { claimed:true } y manda el pago.
router.post('/claim-payment', asyncHandler(async (req, res) => {
    const orderId = String(req.body.orderId || '').trim();
    if (!orderId) return res.json({ claimed: false });
    const ref = db.collection('pedidos').doc(orderId);
    const claimed = await db.runTransaction(async (tx) => {
        const d = await tx.get(ref);
        if (!d.exists) return false;
        if (d.data().mockupPaymentSentAt) return false;   // ya se envió antes
        tx.update(ref, { mockupPaymentSentAt: admin.firestore.FieldValue.serverTimestamp() });
        return true;
    });
    res.json({ claimed });
}));

// POST /api/mockups/check-send — salvaguarda ANTI-FUGA: impide mandar el preview de OTRO cliente.
// Averigua a qué pedido pertenece la imagen (colección mockup_previews) y confirma que el teléfono
// destino sea el de ESE pedido. Si la imagen es de otro pedido con otro teléfono, bloquea el envío.
// Si la imagen no se reconoce, NO bloquea (evita frenar envíos válidos por diferencias de formato).
router.post('/check-send', asyncHandler(async (req, res) => {
    const telefono = String(req.body.telefono || '').trim();
    const imageUrl = String(req.body.imageUrl || '').trim();
    const norm = (u) => String(u || '').replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
    const target = norm(imageUrl);
    if (!telefono || !target) return res.json({ ok: true });

    const snap = await db.collection('mockup_previews').get();
    let ownerId = null;
    snap.forEach((d) => {
        if (ownerId) return;
        const previews = Array.isArray(d.data().previews) ? d.data().previews : [];
        if (previews.some((pv) => [pv.imageUrl, pv.fullUrl, pv.thumbUrl].some((u) => u && norm(u) === target))) ownerId = d.id;
    });
    if (!ownerId) return res.json({ ok: true });   // imagen no reconocida: no bloquear

    const ped = await db.collection('pedidos').doc(String(ownerId)).get();
    const p = ped.exists ? ped.data() : {};
    const ownerPhones = [p.contactId, p.telefono].filter(Boolean).map(String);
    if (ownerPhones.length && !ownerPhones.includes(telefono)) {
        const num = p.consecutiveOrderNumber ? ('DH' + p.consecutiveOrderNumber) : ownerId;
        return res.json({ ok: false, error: `⛔ Esta imagen es el preview del pedido ${num} (otro cliente). No se envió para no filtrarle a este cliente la lámpara de otra persona.` });
    }
    res.json({ ok: true });
}));

module.exports = router;
