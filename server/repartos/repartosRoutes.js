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

// Busca el pedido en el CRM y extrae precio, comentarios, contenido y piezas.
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

    const tel = String(data.telefono || '').replace(/\D/g, '').slice(-10);
    return {
        numeroPedido: 'DH' + digits,
        consecutiveOrderNumber: num,
        precio: Number(data.precio) || 0,
        comentarios: data.comentarios || '',
        contenido,
        piezas,
        telefono: tel,
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
        // No exponemos precio ni teléfono completo al cliente.
        res.json({
            success: true,
            numeroPedido: p.numeroPedido,
            contenido: p.contenido,
            piezas: p.piezas,
            telefonoMasked: p.telefonoMasked,
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

        if (!numeroPedido || !nombre || !telefono || !calle || !colonia || !cp) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
        }
        if (!/^DH\d+$/.test(numeroPedido)) {
            return res.status(400).json({ success: false, message: 'El número de pedido debe ser DH seguido de números.' });
        }
        if (!/^\d{10}$/.test(telefono)) {
            return res.status(400).json({ success: false, message: 'El teléfono debe tener 10 dígitos.' });
        }
        if (!/^\d{5}$/.test(cp)) {
            return res.status(400).json({ success: false, message: 'El código postal debe tener 5 dígitos.' });
        }

        const crm = await lookupPedido(numeroPedido);
        if (!crm) {
            return res.status(404).json({ success: false, message: `No encontramos el pedido ${numeroPedido}.` });
        }

        // Snapshot del CRM + datos capturados por el cliente.
        const baseData = {
            numeroPedido,
            consecutiveOrderNumber: crm.consecutiveOrderNumber,
            nombre, telefono, calle, numExterior, numInterior, entreCalles, colonia, cp, referencia,
            ciudad: String(b.ciudad || '').trim(),
            estado: String(b.estado || 'Nuevo León').trim(),
            precio: crm.precio,
            comentarios: crm.comentarios,
            contenido: crm.contenido,
            piezas: crm.piezas,
        };

        // Si el pedido ya tiene dirección registrada, la actualizamos (sin duplicar).
        const existing = await db.collection(COL_REPARTOS)
            .where('numeroPedido', '==', numeroPedido).limit(1).get();

        if (!existing.empty) {
            const exRef = existing.docs[0].ref;
            await exRef.update({ ...baseData, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            return res.json({ success: true, id: exRef.id, updated: true, message: 'Actualizamos tu dirección. ¡Gracias!' });
        }

        const fecha = fechaMTY();
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

module.exports = router;
