'use strict';
// /api/auto-lamp/:dh — el sistema arma la lámpara de personaje de un pedido como proyecto del editor v2.
// POST la empieza (tarda ~1 min: elegir imagen, grabado con IA, armado); GET consulta cómo va.
const express = require('express');
const { requireApiUser } = require('../../apiAuth');
const service = require('./autoLampService');
const router = express.Router();
router.use(requireApiUser);

const dhOf = value => { const n = parseInt(String(value).replace(/\D/g, ''), 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const running = new Set();

// BANCO DE DISEÑOS (antes de las rutas /:dh): la lista, y renombrar o sacar un dibujo (body.personaje, body.active).
router.get('/bank/list', async (req, res) => {
    try { res.json({ success: true, entries: await service.listBank() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message || 'No se pudo leer el banco.' }); }
});
router.post('/bank/:id', async (req, res) => {
    try { res.json({ success: true, ...(await service.updateBankEntry(req.params.id, { personaje: req.body?.personaje, active: req.body?.active, adMatch: req.body?.adMatch })) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo cambiar.' }); }
});

router.post('/:dh', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Ya se está generando esta lámpara.' });
    running.add(dh);
    // Responde de inmediato y trabaja en segundo plano; el avance queda en el pedido (autoLamp).
    // BETA (?beta=1, desde Pendientes de Diseño): la IA lee el pedido y el chat y decide el diseño;
    // note = indicación del equipo al regenerar.
    const beta = req.query.beta === '1' || req.body?.beta === true;
    // La sesión de quien aprieta sirve también para el envío automático al cliente al terminar.
    const auth = {};
    if (req.headers.authorization) auth.Authorization = req.headers.authorization;
    if (req.headers.cookie) auth.Cookie = req.headers.cookie;
    // noBank: «Generar nuevo con IA» (no usa el dibujo del banco de diseños aunque el personaje ya tenga).
    service.generate(dh, { beta, auth, noBank: req.body?.noBank === true, note: beta ? String(req.body?.note || '').trim() : '', lamps: Array.isArray(req.body?.lamps) ? req.body.lamps.map(Number).filter(Number.isInteger) : null }).catch(error => console.warn(`[AUTO-LAMP] DH${dh}:`, error.message)).finally(() => running.delete(dh));
    res.status(202).json({ success: true, status: 'working' });
});

router.get('/:dh', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try {
        const state = await service.status(dh);
        res.json({ success: true, autoLamp: state && { ...state, running: running.has(dh), updatedAt: state.updatedAt?.toDate?.() || null } });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.status ? error.message : 'No se pudo consultar el pedido.' }); }
});

// Aprobación humana: el único paso que sube el diseño a Drive (body.svg = versión corregida en el editor).
router.post('/:dh/approve', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Todavía se está generando este diseño.' });
    try { res.json({ success: true, ...(await service.approve(dh, { svg: req.body?.fromEditor ? 'editor' : null, actor: req.apiAuth, force: req.body?.force === true, alone: req.body?.alone === true })) }); }
    catch (error) { console.warn(`[AUTO-LAMP] aprobar DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo subir a Drive.', code: error.code || null, previous: error.previous || null }); }
});

// «Subir sola»: la lámpara que espera pareja para la hoja se sube sin esperar.
router.post('/:dh/upload-alone', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { res.json({ success: true, ...(await service.uploadQueuedAlone(dh, { actor: req.apiAuth })) }); }
    catch (error) { console.warn(`[AUTO-LAMP] subir sola DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo subir a Drive.' }); }
});

// «Reabrir para corregir»: el archivo se borró de Drive y el diseño vuelve a «Revisar diseño».
router.post('/:dh/reopen', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { res.json({ success: true, ...(await service.reopen(dh, { actor: req.apiAuth })) }); }
    catch (error) { console.warn(`[AUTO-LAMP] reabrir DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo reabrir.' }); }
});

// «Quitar aro»: limpia el aro del acrílico de un diseño ya hecho, sin regenerarlo (body.lamp = índice).
router.post('/:dh/remove-ring', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { res.json({ success: true, ...(await service.removeRingFromLamp(dh, Number(req.body?.lamp ?? 0) || 0, { actor: req.apiAuth })) }); }
    catch (error) { console.warn(`[AUTO-LAMP] quitar aro DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo quitar el aro.' }); }
});

// «Usar mi imagen»: arma la lámpara con una imagen del equipo (sin IA). multipart: image, lamp, nombre, estilo.
const multer = require('multer');
const ownImage = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 15 * 1024 * 1024, fields: 6, fieldSize: 2000 } }).single('image');
router.post('/:dh/own-image', (req, res, next) => ownImage(req, res, err => err ? res.status(400).json({ success: false, error: err.code === 'LIMIT_FILE_SIZE' ? 'La imagen pesa más de 15 MB.' : err.message }) : next()), async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    if (!req.file || !/^image\//.test(req.file.mimetype || '')) return res.status(400).json({ success: false, error: 'Falta la imagen (PNG, JPG o WEBP).' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Todavía se está generando este diseño.' });
    // Con IA tarda como una generación (Qwen): responde de inmediato y el avance queda en el pedido (autoLamp).
    // asIs=1: la imagen tal cual (ya lista para grabar), sin IA.
    running.add(dh);
    const estilo = ['plano', 'trama'].includes(req.body?.estilo) ? req.body.estilo : undefined;
    service.buildFromImage(dh, req.file.buffer, { lampIndex: Number(req.body?.lamp ?? 0) || 0, nombre: String(req.body?.nombre || '').trim().slice(0, 400), estilo, actor: req.apiAuth, asIs: req.body?.asIs === '1' })
        .catch(error => console.warn(`[AUTO-LAMP] imagen propia DH${dh}:`, error.message)).finally(() => running.delete(dh));
    res.status(202).json({ success: true, status: 'working' });
});

// «Modificar con IA»: aplica body.note a la lámpara body.lamp editando su imagen actual (segundo plano).
router.post('/:dh/edit', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ success: false, error: 'Escribe en la indicación qué cambio quieres.' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Todavía se está generando este diseño.' });
    running.add(dh);
    service.editLamp(dh, Number(req.body?.lamp ?? 0) || 0, note, { actor: req.apiAuth })
        .catch(error => console.warn(`[AUTO-LAMP] modificar DH${dh}:`, error.message)).finally(() => running.delete(dh));
    res.status(202).json({ success: true, status: 'working' });
});

// Versiones anteriores de una lámpara (?lamp=) y regresar a una (body.lamp, body.projectId).
router.get('/:dh/versions', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { res.json({ success: true, versions: await service.lampVersions(dh, Number(req.query.lamp ?? 0) || 0) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudieron leer las versiones.' }); }
});
router.post('/:dh/restore', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Todavía se está generando este diseño.' });
    try { res.json({ success: true, ...(await service.restoreVersion(dh, Number(req.body?.lamp ?? 0) || 0, req.body?.projectId)) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo regresar a esa versión.' }); }
});

// Pedidos nuevos en Pendientes de Diseño: el Diseño IA arranca solo (revisa cada 3 min; espera 2 min tras arrancar
// el servidor para no chocar con un deploy).
setTimeout(() => setInterval(() => service.autoStartBeta().catch(error => console.warn('[AUTO-LAMP] arranque solo:', error.message)), 3 * 60 * 1000), 2 * 60 * 1000);

// Cambios del cliente: se rehacen cuando deja de escribir (revisa cada minuto).
setInterval(() => service.runPendingRedos().catch(error => console.warn('[AUTO-LAMP] cambios pendientes:', error.message)), 60 * 1000);

// La que espera pareja más de 12 h sale sola (revisa cada 15 min).
setInterval(() => service.flushStaleQueue().catch(error => console.warn('[AUTO-LAMP] cola de hojas:', error.message)), 15 * 60 * 1000);

// Manda el previo al CLIENTE (solo cuando una persona aprieta el botón) y deja el chat esperando su
// respuesta (designApproval). El envío reutiliza /api/contacts/:id/messages con la sesión de quien aprieta.
router.post('/:dh/send-client', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Todavía se está generando este diseño.' });
    const auth = {};
    if (req.headers.authorization) auth.Authorization = req.headers.authorization;
    if (req.headers.cookie) auth.Cookie = req.headers.cookie;
    // body.lamps: solo esas lámparas (p. ej. la única que el cliente pidió cambiar); sin él, todas.
    const only = Array.isArray(req.body?.lamps) && req.body.lamps.length ? req.body.lamps.map(Number).filter(Number.isInteger) : null;
    try { res.json({ success: true, ...(await service.sendToClient(dh, { auth, actor: req.apiAuth, only })) }); }
    catch (error) { console.warn(`[AUTO-LAMP] mandar previo DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo mandar al cliente.' }); }
});

// Banco de una lámpara: guardar su dibujo (body.lamp, body.personaje), cambiarla a otro de sus modelos (body.bankId) y
// mandarle al cliente sus modelos para que elija.
router.post('/:dh/bank-save', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { res.json({ success: true, ...(await service.saveToBank(dh, Number(req.body?.lamp ?? 0) || 0, { personaje: String(req.body?.personaje || ''), actor: req.apiAuth })) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo guardar en el banco.' }); }
});
router.post('/:dh/bank-choose', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Todavía se está generando este diseño.' });
    try { res.json({ success: true, ...(await service.chooseBankOption(dh, Number(req.body?.lamp ?? 0) || 0, String(req.body?.bankId || ''))) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo cambiar de modelo.' }); }
});
router.post('/:dh/send-options', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    if (running.has(dh)) return res.status(409).json({ success: false, error: 'Todavía se está generando este diseño.' });
    const auth = {};
    if (req.headers.authorization) auth.Authorization = req.headers.authorization;
    if (req.headers.cookie) auth.Cookie = req.headers.cookie;
    try { res.json({ success: true, ...(await service.sendOptionsToClient(dh, Number(req.body?.lamp ?? 0) || 0, { auth, actor: req.apiAuth })) }); }
    catch (error) { console.warn(`[AUTO-LAMP] mandar opciones DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudieron mandar las opciones.' }); }
});

// Vista «Grabado» de una lámpara desde la versión actual del proyecto (lo corregido en el editor). No manda nada.
router.post('/:dh/team-preview', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { res.json({ success: true, ...(await service.teamPreview(dh, Number(req.body?.lamp ?? 0) || 0)) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo armar la vista.' }); }
});

// Previo para el cliente (círculo con fondo blanco), desde la versión actual del proyecto. No manda nada.
router.post('/:dh/client-preview', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { res.json({ success: true, ...(await service.clientPreview(dh, Number(req.body?.lamp ?? req.query.lamp ?? 0) || 0)) }); }
    catch (error) { console.warn(`[AUTO-LAMP] previo DH${dh}:`, error.message); res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo armar el previo.' }); }
});

router.post('/:dh/reject', async (req, res) => {
    const dh = dhOf(req.params.dh);
    if (!dh) return res.status(400).json({ success: false, error: 'Número de pedido no válido.' });
    try { await service.reject(dh, { reason: req.body?.reason || '', actor: req.apiAuth }); res.json({ success: true }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message || 'No se pudo descartar.' }); }
});

// Al arrancar el servidor (cada deploy de Render), lo que estaba «diseñando» murió con el proceso anterior: se marca
// como interrumpido para que la tarjeta ofrezca «Rehacer» en vez de quedarse con el contador corriendo (DH18198).
setTimeout(() => service.markInterrupted().catch(error => console.warn('[AUTO-LAMP] no pude revisar los interrumpidos:', error.message)), 15000);

module.exports = router;
