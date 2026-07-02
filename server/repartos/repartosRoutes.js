/**
 * Repartos MTY — Entregas locales en Monterrey por repartidor propio.
 *
 * A diferencia de J&T (envíos foráneos con guía), aquí el cliente sólo manda su
 * dirección y los pedidos se agrupan en "tandas diarias". El encargado de las
 * entregas en MTY abre un enlace con token para ver la tanda del día, y desde el
 * panel admin se exporta a Excel con el formato del CRM.
 *
 * Rutas (montadas en /api/repartos-mty):
 *   GET  /pedido/:numero            -> lookup CRM para autollenar el formulario (público)
 *   POST /                          -> el cliente guarda su dirección (público)
 *   GET  /tanda/:fecha?token=       -> datos de la tanda para el repartidor (token)
 *   POST /tanda/:fecha/entrega/:id  -> marcar entregado / pendiente (token)
 *   GET  /admin/tandas              -> lista de tandas con conteos (admin cookie)
 *   GET  /admin/tanda/:fecha        -> filas completas de una tanda (admin cookie)
 *   DELETE /admin/entrega/:id       -> eliminar una fila (admin cookie)
 */
const express = require('express');
const router = express.Router();
const { db, admin } = require('../config');
const { v4: uuidv4 } = require('uuid');

const COL_REPARTOS = 'repartos_mty';
const COL_TANDAS = 'tandas_mty';
const TZ = 'America/Monterrey';

// --- Helpers -----------------------------------------------------------------

// Fecha YYYY-MM-DD en horario de Monterrey (UTC-6 todo el año desde 2023).
function fechaMTY(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date || new Date());
}

function tsToMillis(ts) {
    if (!ts) return null;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (ts._seconds) return ts._seconds * 1000;
    return null;
}

function fechaFromTs(ts) {
    const ms = tsToMillis(ts);
    if (!ms) return '';
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(ms));
}

// Junta las notas internas del contacto como "comentarios" de entrega.
// Prioriza las notas que mencionan este pedido (ej: "DH12488 entregar antes de las 6").
async function fetchNotasInternas(contactId, numeroPedido) {
    if (!contactId) return '';
    try {
        const snap = await db.collection('contacts_whatsapp').doc(contactId).collection('notes').get();
        if (snap.empty) return '';
        const notas = snap.docs
            .map(d => ({ text: String(d.data().text || '').trim(), ms: tsToMillis(d.data().timestamp) || 0 }))
            .filter(n => n.text)
            .sort((a, b) => a.ms - b.ms);
        const digits = String(numeroPedido || '').replace(/\D/g, '');
        const dhRe = digits ? new RegExp('DH?\\s*' + digits + '\\b', 'i') : null;
        // Notas que mencionan este pedido (les quitamos el prefijo "DHxxxxx").
        const propias = dhRe
            ? notas.filter(n => dhRe.test(n.text)).map(n => n.text.replace(/DH?\s*\d+\s*[:\-]?\s*/i, '').trim()).filter(Boolean)
            : [];
        const elegidas = propias.length ? propias : notas.map(n => n.text);
        return elegidas.join(' · ');
    } catch (e) {
        console.warn('[REPARTOS-MTY] notas', e.message);
        return '';
    }
}

// Busca el pedido en el CRM y extrae teléfono, precio, fecha, contenido,
// piezas y los comentarios (notas internas) del contacto.
async function lookupPedido(numero) {
    const digits = String(numero || '').replace(/\D/g, '');
    if (!digits) return null;
    const num = parseInt(digits, 10);

    let data = null;
    const byField = await db.collection('pedidos')
        .where('consecutiveOrderNumber', '==', num).limit(1).get();
    if (!byField.empty) data = byField.docs[0].data();
    if (!data) {
        const doc = await db.collection('pedidos').doc('DH' + digits).get();
        if (doc.exists) data = doc.data();
    }
    if (!data) return null;

    // Contenido + piezas desde items[]; fallback al producto legacy.
    let contenido = data.producto || '';
    let piezas = 1;
    if (Array.isArray(data.items) && data.items.length) {
        contenido = data.items
            .map(it => (it.cantidad > 1 ? `${it.producto} x${it.cantidad}` : it.producto))
            .join(', ');
        piezas = data.items.reduce((s, it) => s + (parseInt(it.cantidad, 10) || 1), 0);
    }

    const numeroPedido = 'DH' + digits;
    const contactId = data.contactId || null;
    const tel = String(data.telefono || data.contactId || '').replace(/\D/g, '').slice(-10);

    // Nombre del cliente desde el contacto (defensivo ante distintos campos).
    let nombre = '';
    if (contactId) {
        try {
            const c = await db.collection('contacts_whatsapp').doc(contactId).get();
            if (c.exists) {
                const cd = c.data();
                nombre = cd.name || cd.nombre || cd.profileName || cd.pushName || '';
            }
        } catch (_) { /* opcional */ }
    }

    const comentarios = await fetchNotasInternas(contactId, numeroPedido);

    return {
        numeroPedido,
        consecutiveOrderNumber: num,
        precio: Number(data.precio) || 0,
        comentarios,
        contenido,
        piezas,
        fechaPedido: fechaFromTs(data.createdAt),
        telefono: tel,
        nombre,
        telefonoMasked: tel.length >= 4 ? '••••••' + tel.slice(-4) : '',
    };
}

// Crea (o devuelve) la tanda del día con su token de acceso para el repartidor.
async function ensureTanda(fecha) {
    const ref = db.collection(COL_TANDAS).doc(fecha);
    return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (doc.exists) return doc.data();
        const token = uuidv4().replace(/-/g, '');
        const payload = { fecha, token, createdAt: admin.firestore.FieldValue.serverTimestamp() };
        tx.set(ref, payload);
        return { fecha, token };
    });
}

function parseCookies(req) {
    const out = {};
    (req.headers.cookie || '').split(';').forEach((p) => {
        const idx = p.indexOf('=');
        if (idx > -1) out[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
    });
    return out;
}

// Protege los endpoints admin verificando la session cookie de /admon.
async function requireAdmin(req, res, next) {
    try {
        const session = parseCookies(req).__session || '';
        if (!session) return res.status(401).json({ success: false, message: 'No autorizado.' });
        const decoded = await admin.auth().verifySessionCookie(session, true);
        const email = (decoded.email || '').toLowerCase();
        const allowed = (process.env.ADMIN_EMAIL || 'admin@dekoor.com').toLowerCase();
        if (email !== allowed) return res.status(403).json({ success: false, message: 'No autorizado.' });
        next();
    } catch (e) {
        return res.status(401).json({ success: false, message: 'Sesión inválida.' });
    }
}

// --- Público: lookup de pedido para autollenar el formulario -----------------
router.get('/pedido/:numero', async (req, res) => {
    try {
        const p = await lookupPedido(req.params.numero);
        if (!p) {
            return res.status(404).json({
                success: false, code: 'NO_ENCONTRADO',
                message: 'No encontramos ese pedido. Verifica el número (ej: DH12488).',
            });
        }
        // Datos del CRM para autollenar el formulario.
        res.json({
            success: true,
            numeroPedido: p.numeroPedido,
            nombre: p.nombre,
            telefono: p.telefono,
            contenido: p.contenido,
            piezas: p.piezas,
            precio: p.precio,
            fechaPedido: p.fechaPedido,
            comentarios: p.comentarios,
        });
    } catch (e) {
        console.error('[REPARTOS-MTY] lookup', e.message);
        res.status(500).json({ success: false, message: 'Error al verificar el pedido.' });
    }
});

// --- Público: el cliente guarda su dirección ---------------------------------
router.post('/', async (req, res) => {
    try {
        const b = req.body || {};
        const numeroPedido = String(b.numeroPedido || '').toUpperCase().trim();
        const nombre = String(b.nombre || '').trim();
        const telefono = String(b.telefono || '').replace(/\D/g, '');
        const calle = String(b.calle || '').trim();
        const numExterior = String(b.numExterior || '').trim();
        const numInterior = String(b.numInterior || '').trim();
        const entreCalles = String(b.entreCalles || '').trim();
        const colonia = String(b.colonia || '').trim();
        const cp = String(b.cp || '').replace(/\D/g, '');
        const referencia = String(b.referencia || '').trim();

        // El número de pedido ya NO es obligatorio: el cliente puede mandar sus
        // datos antes de que registremos el pedido. Si viene (enlace /mty/DHxxxx),
        // debe tener formato DH y jalamos su snapshot del CRM.
        if (!nombre || !telefono || !calle || !colonia || !cp) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
        }
        if (numeroPedido && !/^DH\d+$/.test(numeroPedido)) {
            return res.status(400).json({ success: false, message: 'El número de pedido debe ser DH seguido de números.' });
        }
        if (!/^\d{10}$/.test(telefono)) {
            return res.status(400).json({ success: false, message: 'El teléfono debe tener 10 dígitos.' });
        }
        if (!/^\d{5}$/.test(cp)) {
            return res.status(400).json({ success: false, message: 'El código postal debe tener 5 dígitos.' });
        }

        const crm = numeroPedido ? await lookupPedido(numeroPedido) : null;

        // Snapshot del CRM (si hay pedido) + datos capturados por el cliente. Sin
        // pedido, los campos del CRM van vacíos y se completan en /admon/repartos.
        const baseData = {
            numeroPedido,
            consecutiveOrderNumber: crm ? crm.consecutiveOrderNumber : null,
            nombre, telefono, calle, numExterior, numInterior, entreCalles, colonia, cp, referencia,
            ciudad: String(b.ciudad || '').trim(),
            estado: String(b.estado || 'Nuevo León').trim(),
            precio: crm ? crm.precio : 0,
            comentarios: crm ? crm.comentarios : '',
            contenido: crm ? crm.contenido : '',
            piezas: crm ? crm.piezas : 1,
            fechaPedido: crm ? (crm.fechaPedido || '') : '',
        };

        const fecha = fechaMTY();

        // Dedup: por número de pedido si lo hay; si no, por teléfono dentro de la
        // tanda de hoy (re-enviar corrige la dirección en vez de duplicar).
        let exRef = null;
        if (numeroPedido) {
            const existing = await db.collection(COL_REPARTOS)
                .where('numeroPedido', '==', numeroPedido).limit(1).get();
            if (!existing.empty) exRef = existing.docs[0].ref;
        } else {
            const sameTel = await db.collection(COL_REPARTOS).where('telefono', '==', telefono).get();
            const match = sameTel.docs.find(d => { const x = d.data(); return x.tandaFecha === fecha && !x.numeroPedido; });
            if (match) exRef = match.ref;
        }

        if (exRef) {
            await exRef.update({ ...baseData, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            return res.json({ success: true, id: exRef.id, updated: true, message: 'Actualizamos tu dirección. ¡Gracias!' });
        }

        await ensureTanda(fecha);
        const ref = await db.collection(COL_REPARTOS).add({
            ...baseData,
            tandaFecha: fecha,
            entregado: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.status(201).json({ success: true, id: ref.id, message: '¡Gracias! Tu dirección fue registrada.' });
    } catch (e) {
        console.error('[REPARTOS-MTY] submit', e);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// --- Repartidor: ver la tanda del día (token) --------------------------------
async function validarTokenTanda(fecha, token) {
    const tandaDoc = await db.collection(COL_TANDAS).doc(fecha).get();
    if (!tandaDoc.exists) return { ok: false, code: 404 };
    if (!token || token !== tandaDoc.data().token) return { ok: false, code: 403 };
    return { ok: true, tanda: tandaDoc.data() };
}

router.get('/tanda/:fecha', async (req, res) => {
    try {
        const { fecha } = req.params;
        const v = await validarTokenTanda(fecha, req.query.token || '');
        if (!v.ok) {
            const msg = v.code === 404 ? 'Tanda no encontrada.' : 'Enlace inválido o vencido.';
            return res.status(v.code).json({ success: false, message: msg });
        }
        const snap = await db.collection(COL_REPARTOS).where('tandaFecha', '==', fecha).get();
        const items = snap.docs
            .map(d => {
                const x = d.data();
                return {
                    id: d.id,
                    numeroPedido: x.numeroPedido,
                    nombre: x.nombre,
                    telefono: x.telefono,
                    calle: x.calle,
                    numExterior: x.numExterior || '',
                    numInterior: x.numInterior || '',
                    entreCalles: x.entreCalles || '',
                    colonia: x.colonia,
                    cp: x.cp,
                    referencia: x.referencia || '',
                    precio: x.precio || 0,
                    comentarios: x.comentarios || '',
                    contenido: x.contenido || '',
                    piezas: x.piezas || 1,
                    entregado: !!x.entregado,
                    createdAt: tsToMillis(x.createdAt),
                };
            })
            .sort((a, b) => (a.entregado - b.entregado) || (a.createdAt || 0) - (b.createdAt || 0));
        res.json({ success: true, fecha, items });
    } catch (e) {
        console.error('[REPARTOS-MTY] tanda', e.message);
        res.status(500).json({ success: false, message: 'Error al cargar la tanda.' });
    }
});

router.post('/tanda/:fecha/entrega/:id', async (req, res) => {
    try {
        const { fecha, id } = req.params;
        const v = await validarTokenTanda(fecha, req.query.token || req.body?.token || '');
        if (!v.ok) return res.status(v.code).json({ success: false, message: 'Enlace inválido.' });

        const ref = db.collection(COL_REPARTOS).doc(id);
        const doc = await ref.get();
        if (!doc.exists || doc.data().tandaFecha !== fecha) {
            return res.status(404).json({ success: false, message: 'Entrega no encontrada en esta tanda.' });
        }
        const entregado = !!(req.body && req.body.entregado);
        await ref.update({
            entregado,
            entregadoAt: entregado ? admin.firestore.FieldValue.serverTimestamp() : null,
        });
        res.json({ success: true, entregado });
    } catch (e) {
        console.error('[REPARTOS-MTY] toggle', e.message);
        res.status(500).json({ success: false, message: 'Error al actualizar la entrega.' });
    }
});

// --- Admin: lista de tandas (cookie) -----------------------------------------
router.get('/admin/tandas', requireAdmin, async (req, res) => {
    try {
        const tandasSnap = await db.collection(COL_TANDAS).get();
        const tandas = tandasSnap.docs.map(d => d.data()).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
        const out = await Promise.all(tandas.map(async (t) => {
            const agg = await db.collection(COL_REPARTOS).where('tandaFecha', '==', t.fecha).get();
            const total = agg.size;
            const entregados = agg.docs.filter(d => d.data().entregado).length;
            return { fecha: t.fecha, token: t.token, total, entregados };
        }));
        res.json({ success: true, tandas: out });
    } catch (e) {
        console.error('[REPARTOS-MTY] admin tandas', e.message);
        res.status(500).json({ success: false, message: 'Error al cargar las tandas.' });
    }
});

// --- Admin: filas completas de una tanda (cookie) ----------------------------
router.get('/admin/tanda/:fecha', requireAdmin, async (req, res) => {
    try {
        const { fecha } = req.params;
        const tandaDoc = await db.collection(COL_TANDAS).doc(fecha).get();
        const snap = await db.collection(COL_REPARTOS).where('tandaFecha', '==', fecha).get();
        const items = snap.docs
            .map(d => ({ id: d.id, ...d.data(), createdAt: tsToMillis(d.data().createdAt) }))
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        res.json({ success: true, fecha, token: tandaDoc.exists ? tandaDoc.data().token : null, items });
    } catch (e) {
        console.error('[REPARTOS-MTY] admin tanda', e.message);
        res.status(500).json({ success: false, message: 'Error al cargar la tanda.' });
    }
});

router.delete('/admin/entrega/:id', requireAdmin, async (req, res) => {
    try {
        await db.collection(COL_REPARTOS).doc(req.params.id).delete();
        res.json({ success: true });
    } catch (e) {
        console.error('[REPARTOS-MTY] delete', e.message);
        res.status(500).json({ success: false, message: 'Error al eliminar.' });
    }
});

// --- Admin: editar una entrega (cookie) --------------------------------------
router.put('/admin/entrega/:id', requireAdmin, async (req, res) => {
    try {
        const b = req.body || {};
        const campos = ['nombre', 'telefono', 'calle', 'numExterior', 'numInterior', 'entreCalles', 'colonia', 'cp', 'referencia', 'comentarios', 'contenido'];
        const update = {};
        for (const k of campos) if (k in b) update[k] = String(b[k] ?? '').trim();
        if ('telefono' in update) update.telefono = update.telefono.replace(/\D/g, '');
        if ('cp' in update) update.cp = update.cp.replace(/\D/g, '');
        if ('precio' in b) update.precio = Number(b.precio) || 0;
        if ('piezas' in b) update.piezas = Math.max(1, parseInt(b.piezas, 10) || 1);
        // Asignar/editar el número de pedido (clave del export y del lookup CRM).
        if ('numeroPedido' in b) {
            const np = String(b.numeroPedido || '').toUpperCase().trim();
            if (np && !/^DH\d+$/.test(np)) {
                return res.status(400).json({ success: false, message: 'El número de pedido debe ser DH seguido de números.' });
            }
            update.numeroPedido = np;
            const digits = np.replace(/\D/g, '');
            update.consecutiveOrderNumber = digits ? parseInt(digits, 10) : null;
        }

        if (!Object.keys(update).length) {
            return res.status(400).json({ success: false, message: 'Nada que actualizar.' });
        }
        update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection(COL_REPARTOS).doc(req.params.id).update(update);
        res.json({ success: true });
    } catch (e) {
        console.error('[REPARTOS-MTY] edit', e.message);
        res.status(500).json({ success: false, message: 'Error al guardar los cambios.' });
    }
});

// --- CRM: enviar al cliente el enlace del formulario MTY (botón del chat) ----
// Manda el enlace /mty/DHxxxx (entrega local en Monterrey) al chat del cliente.
router.post('/pedir-datos/:contactId', async (req, res) => {
    try {
        const { contactId } = req.params;

        // El pedido ya NO es obligatorio: si el contacto tiene uno, prellenamos el
        // enlace (/mty/DHxxxx) y el mensaje; si no, mandamos el enlace genérico
        // (/mty) y el número se asigna después en /admon/repartos.
        let orderNumber = '';
        try {
            const ordersSnap = await db.collection('pedidos').where('telefono', '==', contactId).get();
            const orders = ordersSnap.docs.map(d => d.data())
                .filter(o => o.consecutiveOrderNumber)
                .sort((a, b) => (b.consecutiveOrderNumber || 0) - (a.consecutiveOrderNumber || 0));
            if (orders.length) orderNumber = `DH${orders[0].consecutiveOrderNumber}`;
        } catch (_) { /* sin pedido: enlace genérico */ }

        const BASE = (process.env.PUBLIC_APP_URL || 'https://app.dekoormx.com').replace(/\/$/, '');
        const link = orderNumber ? `${BASE}/mty/${orderNumber}` : `${BASE}/mty`;

        // Si existe una respuesta rápida "Datos MTY" se usa (permite personalizar el
        // texto); si no, se manda un mensaje por defecto con el enlace.
        let messageText, fileUrl = null, fileType = null;
        const allQrs = await db.collection('quick_replies').get();
        let qr = allQrs.docs.find(d => (d.data().shortcut || '').toLowerCase() === 'datos mty');
        if (!qr) qr = allQrs.docs.find(d => { const sc = (d.data().shortcut || '').toLowerCase(); return sc.includes('datos') && sc.includes('mty'); });
        if (qr) {
            const q = qr.data();
            messageText = (q.message || '')
                .replace(/\*\*/g, orderNumber)
                .replace(/(https?:\/\/[^\/\s]+\/mty)\/?(?=\s|$)/gi, orderNumber ? `$1/${orderNumber}` : '$1')
                .replace(/ {2,}/g, ' ');
            if (!/\/mty(\/|\b)/i.test(messageText)) messageText += `\n${link}`;
            fileUrl = q.fileUrl || null;
            fileType = q.fileType || null;
        } else {
            messageText = orderNumber
                ? `📦✨ Para enviarte tu pedido *${orderNumber}* necesitamos tu dirección de entrega en Nuevo León 📍🚚\n\nPor favor llénala en este enlace 👇😊\n${link}`
                : `📦✨ Para enviarte tu pedido necesitamos tu dirección de entrega en Nuevo León 📍🚚\n\nPor favor llénala en este enlace 👇😊\n${link}`;
        }

        const { sendAdvancedWhatsAppMessage } = require('../services');
        const sentData = await sendAdvancedWhatsAppMessage(contactId, { text: messageText, fileUrl, fileType });

        const messageToSave = {
            from: process.env.PHONE_NUMBER_ID,
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: sentData?.id || null,
            text: messageText,
        };
        if (fileUrl) messageToSave.fileUrl = fileUrl;
        if (fileType) messageToSave.fileType = fileType;

        await db.collection('contacts_whatsapp').doc(contactId).collection('messages').add(messageToSave);
        await db.collection('contacts_whatsapp').doc(contactId).update({
            lastMessage: messageText.substring(0, 100),
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            unreadCount: 0,
        });

        res.json({ success: true, orderNumber, link, message: 'Solicitud de datos MTY enviada correctamente.' });
    } catch (error) {
        console.error('[REPARTOS-MTY] pedir-datos', error);
        res.status(500).json({ success: false, message: 'Error al enviar la solicitud de datos.', error: error.message });
    }
});

module.exports = router;
// Reutilizado por el módulo DGO (dgoRoutes.js): mismo lookup del CRM.
module.exports.lookupPedido = lookupPedido;
