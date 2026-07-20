const express = require('express');
const multer = require('multer');
const router = express.Router();
const svc = require('./mockupsService');
const { db, admin } = require('../config');
const { applyNameLayout } = require('./nameLayout');

// Regla de renglones (kill-switch: mockup_config/settings.nameLayoutRule = false).
// Nombres compuestos quedan con '\n' decidido por NOSOTROS; el prompt le ordena a la IA ese
// salto de línea, y el diseño de corte (svg-corte-worker) reproduce el MISMO layout.
async function fieldsConLayout(fields) {
    try {
        const cfg = await db.collection('mockup_config').doc('settings').get();
        if (cfg.exists && cfg.data().nameLayoutRule === false) return fields;
    } catch (_) {}
    return applyNameLayout(fields);
}

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
        if (i >= 0) {
            previews[i] = entry;
        } else {
            // Anti-DUPLICADO: si ya existe un preview con el MISMO diseño (misma plantilla y mismos
            // campos —nombres/fecha—), es una regeneración accidental con blockId nuevo (p. ej. la
            // lista se re-renderizó a mitad de la generación, o se recargó la página antes de
            // persistir el primer preview). Se reemplaza ese en vez de agregar uno idéntico. Los
            // previews con datos DISTINTOS (variantes reales) sí conviven; para reintentar el MISMO
            // diseño está el botón "Regenerar" (reusa el blockId). NO se compara secondRefUrl: es
            // una imagen que se sube nueva en cada generación aunque el diseño sea idéntico.
            const sameDesign = (a, b) => (a.templateId || '') === (b.templateId || '')
                && JSON.stringify(a.fields || {}) === JSON.stringify(b.fields || {});
            const dup = previews.findIndex(p => sameDesign(p, entry));
            if (dup >= 0) previews[dup] = entry; else previews.push(entry);
        }
        await ref.set({ orderId: String(orderId), previews }, { merge: true });
        // Verificación de layout por visión (fire-and-forget): guarda cómo quedaron los textos
        // grabados renglón por renglón — la "verdad" que luego reproduce el diseño de corte.
        svc.verifyAndStoreLayout(String(orderId), blockId);
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
            pilotoPreview: o.pilotoPreview || null,   // piloto preview: 'A' se marca/prioriza en la UI
        };
    });
    // Piloto preview: los del grupo A hasta ARRIBA de la cola (revisión express manual);
    // el sort es estable, así que dentro de cada grupo se conserva "recientes primero".
    items.sort((a, b) => Number(b.pilotoPreview === 'A') - Number(a.pilotoPreview === 'A'));
    res.json({ success: true, items });
}));

// --- Plantillas de mockup (diseños de lámpara) ---
router.get('/templates', asyncHandler(async (req, res) => {
    res.json({ success: true, templates: await svc.listTemplates() });
}));

router.post('/templates', asyncHandler(async (req, res) => {
    const { nombre, baseImagePath, baseImageUrl, promptTemplate, productMatch, aspectRatio, designSvg, designId } = req.body;
    const template = await svc.createTemplate({ nombre, baseImagePath, baseImageUrl, promptTemplate, productMatch, aspectRatio, designSvg, designId });
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

// --- Diseños del lienzo (banco de pruebas): guardar/cargar composiciones 864×1152 ---
router.get('/designs', asyncHandler(async (req, res) => {
    res.json({ success: true, designs: await svc.listDesigns() });
}));

router.post('/designs', asyncHandler(async (req, res) => {
    const design = await svc.createDesign({ nombre: req.body.nombre, items: req.body.items });
    res.json({ success: true, design });
}));

router.put('/designs/:id', asyncHandler(async (req, res) => {
    const design = await svc.updateDesign(req.params.id, { nombre: req.body.nombre, items: req.body.items });
    res.json({ success: true, design });
}));

router.delete('/designs/:id', asyncHandler(async (req, res) => {
    await svc.deleteDesign(req.params.id);
    res.json({ success: true });
}));

// POST /api/mockups/fetch-image — Imagen de NUESTRO bucket a base64. Rehidrata diseños del
// lienzo: para rasterizar, los <image> del SVG deben ser data URIs (un href http externo no
// carga dentro de un SVG usado como imagen).
router.post('/fetch-image', asyncHandler(async (req, res) => {
    const out = await svc.fetchOwnImageAsBase64(String(req.body.url || ''));
    res.json({ success: true, ...out });
}));

// POST /api/mockups/generate-preview — Generar preview desde plantilla + campos
router.post('/generate-preview', asyncHandler(async (req, res) => {
    const { templateId, fields: rawFields = {}, provider = 'wavespeed', resolution, quality } = req.body;
    if (!templateId) return res.status(400).json({ success: false, error: 'Se requiere templateId.' });

    const tpl = await svc.getTemplate(templateId);
    if (!tpl) return res.status(404).json({ success: false, error: 'Plantilla no encontrada.' });
    if (!tpl.baseImageUrl) return res.status(400).json({ success: false, error: 'La plantilla no tiene imagen base.' });

    // Nombres compuestos: la regla de renglones decide el salto de línea ANTES de generar
    // (así el mockup y el diseño de corte comparten exactamente el mismo layout).
    const fields = await fieldsConLayout(rawFields);

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
        inputImages: images.length, createdAt: new Date().toISOString(),
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
    const extraInputs = Math.max(0, (job.inputImages || 1) - 1);
    const cost = wave.costFor(1, extraInputs);
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

// ===================== GRABADO LÁSER (foto del cliente -> imagen para raster engrave) =====================
// Convierte una FOTO cualquiera (la que el cliente quiere grabada) en una imagen lista para grabado
// raster: rellenos BLANCOS, fondo NEGRO, sombreado por TRAMA (halftone) y alto detalle. Si va en el
// modelo de corazones, se pasa una 2ª imagen con la SILUETA DE CORAZÓN para que el grabado salga con
// esa forma. Usa WaveSpeed (GPT Image 2 Edit) — mismo flujo async que el preview: este submit
// devuelve jobId; se consulta con GET /generate-status/:jobId (reusa descarga + galería).
const ENGRAVE_PROMPT_BASE = [
    'Convierte la fotografía adjunta en una ILUSTRACIÓN EN BLANCO Y NEGRO lista para GRABADO LÁSER RASTER (raster engrave).',
    'Reglas obligatorias:',
    '- Estrictamente MONOCROMA: solo blanco puro (#FFFFFF) y negro puro (#000000). Sin color, sin grises planos.',
    '- El FONDO debe ser NEGRO sólido. El sujeto y sus detalles se representan con RELLENOS BLANCOS (formas blancas sobre negro).',
    '- Los tonos, sombras y volúmenes se logran con TRAMA de puntos/líneas (halftone / dithering): un DEGRADADO EN TRAMA. Más densidad de puntos en las zonas oscuras, menos en las claras.',
    '- ALTO DETALLE y máximo parecido: conserva claramente los rostros, cabello, lentes, facciones, ropa y bordes de las personas para que sean reconocibles.',
    '- Bordes limpios y nítidos. SIN texto, SIN marca de agua, SIN marco, SIN objetos de fondo adicionales.',
    'Resultado: una máscara de grabado de alto contraste, blanco sobre negro, con sombreado por trama, lista para grabar.',
].join('\n');

const ENGRAVE_PROMPT_SHAPE = [
    '',
    'Se adjuntan DOS imágenes: (1) la FOTO a convertir y (2) una SILUETA (forma) de referencia.',
    'Compón el grabado de modo que TODA la escena quede DENTRO de la forma de la imagen (2): el área de la',
    'forma se llena con el grabado blanco-sobre-negro con trama de la foto (1), y TODO lo que quede FUERA de',
    'la forma es negro sólido. La forma va centrada, con su contorno limpio, y la foto se encuadra para que',
    'las personas se vean completas dentro de la forma.',
].join('\n');

function buildEngravePrompt(hasShape, extra) {
    let p = ENGRAVE_PROMPT_BASE;
    if (hasShape) p += '\n' + ENGRAVE_PROMPT_SHAPE;
    const e = String(extra || '').trim();
    if (e) p += '\n\nInstrucciones adicionales del operador (aplícalas además de lo anterior): ' + e;
    return p;
}

// POST /api/mockups/engrave-submit — { imageUrl, shapeImageUrl?, extraPrompt?, aspectRatio?, resolution? }
router.post('/engrave-submit', asyncHandler(async (req, res) => {
    const imageUrl = String(req.body.imageUrl || '').trim();
    const shapeImageUrl = String(req.body.shapeImageUrl || '').trim();
    if (!/^https?:\/\//.test(imageUrl)) {
        return res.status(400).json({ success: false, error: 'Se requiere imageUrl (URL pública de la foto a grabar).' });
    }
    if (shapeImageUrl && !/^https?:\/\//.test(shapeImageUrl)) {
        return res.status(400).json({ success: false, error: 'shapeImageUrl debe ser una URL pública.' });
    }
    const aspectRatio = String(req.body.aspectRatio || '1:1');
    const prompt = buildEngravePrompt(!!shapeImageUrl, req.body.extraPrompt);
    const images = shapeImageUrl ? [imageUrl, shapeImageUrl] : [imageUrl];

    // model: 'gpt-image-2' (default) o 'seedream' (Seedream 5.0 Pro) — el fallback cuando GPT
    // Image 2 rechaza por contenido sensible / derechos de autor. El poller es el mismo.
    const model = req.body.model === 'seedream' ? 'seedream' : 'gpt-image-2';
    const wave = require('./wavespeedClient');
    const { predictionId } = await wave.submitEdit(prompt, images, {
        aspectRatio,
        resolution: req.body.resolution || '1k',
        quality: req.body.quality || 'high',
        model,
    });
    // Reusa el poller /generate-status/:jobId (descarga + galería). Sin orderId -> no toca pedidos.
    await db.collection('mockup_jobs').doc(predictionId).set({
        prompt, aspectRatio, kind: 'grabado', model, inputImages: images.length, createdAt: new Date().toISOString(),
    });
    res.json({ success: true, jobId: predictionId, prompt });
}));

// POST /api/mockups/backfill-layout — verifica por visión los previews SIN `layout` de pedidos
// vigentes ('Sin estatus' y 'Fabricar'). Para el backlog histórico y como red de seguridad.
// Body: { limit } — máximo por llamada (default 8) para no exceder tiempos de request.
router.post('/backfill-layout', asyncHandler(async (req, res) => {
    const limit = Math.min(30, Math.max(1, parseInt((req.body || {}).limit, 10) || 8));
    const done = [];
    for (const est of ['Sin estatus', 'Fabricar']) {
        if (done.length >= limit) break;
        const snap = await db.collection('pedidos').where('estatus', '==', est).limit(500).get();
        for (const d of snap.docs) {
            if (done.length >= limit) break;
            const prev = await db.collection('mockup_previews').doc(String(d.id)).get();
            if (!prev.exists) continue;
            const previews = Array.isArray(prev.data().previews) ? prev.data().previews : [];
            const last = previews[previews.length - 1];
            if (!last || !last.imageUrl || last.layout) continue;   // sin preview o ya verificado
            const v = await svc.verifyAndStoreLayout(String(d.id), last.blockId);
            done.push({ DH: d.data().consecutiveOrderNumber, ok: v ? v.ok : null, izq: v ? v.izquierdo : null, der: v ? v.derecho : null });
        }
    }
    res.json({ success: true, procesados: done.length, detalle: done });
}));

// GET /api/mockups/send-context?telefono=... — datos para armar el envío del preview:
// textos de /cuatro y /bbb, y si la ventana de 24h de WhatsApp está abierta.
router.get('/send-context', asyncHandler(async (req, res) => {
    const telefono = String(req.query.telefono || '').trim();
    if (!telefono) return res.status(400).json({ success: false, error: 'Falta telefono.' });

    // Respuestas rápidas /cuatro (pedido listo + pago; PUEDE llevar foto) y /bbb (tarjeta).
    // Se devuelven con su media para replicar el envío tal cual lo hace el chat.
    // Piloto preview: a los contactos del grupo A se les da /cuatrop (encuadre de "diseño
    // para aprobar") en lugar de /cuatro — el frontend no cambia, solo recibe otro texto.
    const qr = { cuatro: null, bbb: null, cuatrop: null };
    try {
        const qrSnap = await db.collection('quick_replies').where('shortcut', 'in', ['cuatro', 'bbb', 'cuatrop']).get();
        qrSnap.forEach(d => {
            const x = d.data();
            qr[String(x.shortcut || '').toLowerCase()] = { text: x.message || '', fileUrl: x.fileUrl || null, fileType: x.fileType || null };
        });
    } catch (e) { console.error('[mockups] quick_replies:', e.message); }

    let pilotoGroup = null;
    try {
        const piloto = require('../orders/pilotoPreview');
        if ((await piloto.getPilotoConfig()).enabled) {
            const cSnap = await db.collection('contacts_whatsapp').doc(telefono).get();
            pilotoGroup = cSnap.exists ? (cSnap.data().pilotoPreview || null) : null;
            if (pilotoGroup === 'A') {
                qr.cuatro = qr.cuatrop && qr.cuatrop.text ? qr.cuatrop : { text: piloto.CUATROP_FALLBACK, fileUrl: null, fileType: null };
            }
        }
    } catch (e) { console.warn('[PILOTO] send-context grupo falló (se usa /cuatro normal):', e.message); }

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

    res.json({ success: true, windowOpen, cuatro: qr.cuatro, bbb: qr.bbb, pilotoGroup });
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

// --- Piloto preview (A/B): switch desde la sección Mockup ---
// El server cachea la config 60s (orders/pilotoPreview.js), así que el cambio
// tarda máximo un minuto en aplicar a todos los flujos.
router.get('/piloto-config', asyncHandler(async (req, res) => {
    const doc = await db.collection('crm_settings').doc('piloto_preview').get();
    res.json({ success: true, enabled: !!(doc.exists && doc.data().enabled === true) });
}));

router.post('/piloto-config', asyncHandler(async (req, res) => {
    const enabled = req.body.enabled === true;
    await db.collection('crm_settings').doc('piloto_preview').set({ enabled }, { merge: true });
    console.log(`[PILOTO] Switch ${enabled ? 'ENCENDIDO ⚡' : 'APAGADO'} desde la sección Mockup.`);
    res.json({ success: true, enabled });
}));

// --- Prueba A/B de la RI (mensaje inicial): switch desde la sección Mockup ---
router.get('/ri-test-config', asyncHandler(async (req, res) => {
    const doc = await db.collection('crm_settings').doc('ri_test').get();
    res.json({ success: true, enabled: !!(doc.exists && doc.data().enabled === true) });
}));

router.post('/ri-test-config', asyncHandler(async (req, res) => {
    const enabled = req.body.enabled === true;
    await db.collection('crm_settings').doc('ri_test').set({ enabled }, { merge: true });
    console.log(`[RI_TEST] Switch ${enabled ? 'ENCENDIDO 🅰️' : 'APAGADO'} desde la sección Mockup.`);
    res.json({ success: true, enabled });
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
        const update = { mockupPaymentSentAt: admin.firestore.FieldValue.serverTimestamp() };
        // Piloto preview: sellar el momento en que el preview+cobro sale al cliente
        // (grupo A). Mide el SLA real y ancla el "no cobrar de nuevo antes de 6h".
        if (d.data().pilotoPreview === 'A') {
            update.previewEnviadoAt = admin.firestore.FieldValue.serverTimestamp();
        }
        tx.update(ref, update);
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
