/**
 * Repartos DGO — Entregas locales en Durango por repartidor propio.
 *
 * A diferencia de MTY (que agrupa en "tandas" en su propia colección), aquí el
 * cliente llena su dirección y el registro cae DIRECTO en la colección
 * `entregas_repartidor` — la misma que escucha la app del repartidor y que se
 * llena a mano desde /repartidor. Así "aparece en la app como cuando uno de
 * nosotros llena la web".
 *
 * Rutas (montadas en /api/repartos-dgo):
 *   GET  /pedido/:numero        -> lookup CRM para autollenar el formulario (público)
 *   POST /                      -> el cliente guarda su dirección + ubicación (público)
 *   POST /pedir-datos/:contactId-> el CRM manda el enlace /dgo/DHxxxx por WhatsApp
 */
const express = require('express');
const router = express.Router();
const { db, admin } = require('../config');
const { lookupPedido } = require('./repartosRoutes');

// Misma colección que escucha la app del repartidor (y /repartidor).
const COL_ENTREGAS = 'entregas_repartidor';
const TZ = 'America/Monterrey'; // Durango: zona centro, UTC-6 todo el año.

// Fecha YYYY-MM-DD en horario de Durango.
function fechaDGO(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date || new Date());
}

// Junta calle/número/colonia/CP/ciudad en una sola línea (campo `direccion`
// que muestra la app del repartidor).
function componerDireccion({ calle, numExterior, numInterior, colonia, cp, ciudad }) {
    const linea1 = [calle, numExterior].filter(Boolean).join(' ')
        + (numInterior ? ` Int. ${numInterior}` : '');
    return [linea1.trim(), colonia, cp ? `C.P. ${cp}` : '', ciudad]
        .map(s => String(s || '').trim()).filter(Boolean).join(', ');
}

// Indicaciones para el repartidor = entre calles + referencia + notas del CRM.
function componerIndicaciones({ entreCalles, referencia, comentarios }) {
    return [
        entreCalles ? `Entre ${entreCalles}` : '',
        referencia || '',
        comentarios || '',
    ].map(s => String(s || '').trim()).filter(Boolean).join(' · ');
}

// Siguiente posición en la ruta: detrás de las entregas pendientes (igual que
// /repartidor: max(ordenRuta de pendientes) + 1).
async function siguienteOrdenRuta() {
    const snap = await db.collection(COL_ENTREGAS).get();
    const pend = snap.docs.map(d => d.data()).filter(e => e.estado !== 'ENTREGADO');
    if (!pend.length) return 0;
    return Math.max(...pend.map(e => Number(e.ordenRuta) || 0)) + 1;
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
        console.error('[REPARTOS-DGO] lookup', e.message);
        res.status(500).json({ success: false, message: 'Error al verificar el pedido.' });
    }
});

// --- Público: el cliente guarda su dirección + ubicación ---------------------
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
        const ciudad = String(b.ciudad || 'Durango').trim();
        const referencia = String(b.referencia || '').trim();
        const lat = Number(b.lat);
        const lng = Number(b.lng);

        if (!numeroPedido || !nombre || !telefono || !calle || !colonia) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
        }
        if (!/^DH\d+$/.test(numeroPedido)) {
            return res.status(400).json({ success: false, message: 'El número de pedido debe ser DH seguido de números.' });
        }
        if (!/^\d{10}$/.test(telefono)) {
            return res.status(400).json({ success: false, message: 'El teléfono debe tener 10 dígitos.' });
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({ success: false, message: 'Marca la ubicación de la entrega en el mapa.' });
        }

        const crm = await lookupPedido(numeroPedido);
        if (!crm) {
            return res.status(404).json({ success: false, message: `No encontramos el pedido ${numeroPedido}.` });
        }

        const direccion = componerDireccion({ calle, numExterior, numInterior, colonia, cp, ciudad });
        const indicaciones = componerIndicaciones({ entreCalles, referencia, comentarios: crm.comentarios });

        // Datos del pedido (del CRM) + lo capturado por el cliente, en el formato
        // exacto que espera la app del repartidor.
        const baseData = {
            numeroPedido,
            cliente: nombre,
            telefono,
            direccion,
            producto: crm.contenido || '',
            monto: Number(crm.precio) || 0, // COD: el precio del pedido.
            indicaciones,
            fechaEntrega: fechaDGO(),
            lat,
            lng,
            // Campos extra (no los usa la app, pero ayudan a depurar/editar).
            colonia, cp, ciudad,
            origen: 'cliente-dgo',
        };

        // Si el pedido ya tiene una entrega NO entregada, la actualizamos (sin
        // duplicar en la ruta del repartidor).
        const existing = await db.collection(COL_ENTREGAS)
            .where('numeroPedido', '==', numeroPedido).get();
        const abierta = existing.docs.find(d => d.data().estado !== 'ENTREGADO');

        if (abierta) {
            await abierta.ref.update({ ...baseData, actualizadoEn: Date.now() });
            return res.json({ success: true, id: abierta.id, updated: true, message: 'Actualizamos tu dirección. ¡Gracias!' });
        }

        const ref = await db.collection(COL_ENTREGAS).add({
            ...baseData,
            estado: 'PENDIENTE',
            ordenRuta: await siguienteOrdenRuta(),
            minutosEstimados: 0,
            creadoEn: Date.now(),
        });
        res.status(201).json({ success: true, id: ref.id, message: '¡Gracias! Tu dirección fue registrada.' });
    } catch (e) {
        console.error('[REPARTOS-DGO] submit', e);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// --- CRM: enviar al cliente el enlace del formulario DGO (botón del chat) -----
// Mismo patrón que /api/repartos-mty/pedir-datos, pero manda /dgo/DHxxxx.
router.post('/pedir-datos/:contactId', async (req, res) => {
    try {
        const { contactId } = req.params;

        const ordersSnap = await db.collection('pedidos').where('telefono', '==', contactId).get();
        if (ordersSnap.empty) {
            return res.status(404).json({ success: false, message: 'Este contacto no tiene pedidos registrados.' });
        }
        const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(o => o.consecutiveOrderNumber)
            .sort((a, b) => (b.consecutiveOrderNumber || 0) - (a.consecutiveOrderNumber || 0));
        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'Este contacto no tiene pedidos con número.' });
        }
        const orderNumber = `DH${orders[0].consecutiveOrderNumber}`;

        const BASE = (process.env.PUBLIC_APP_URL || 'https://app.dekoormx.com').replace(/\/$/, '');
        const link = `${BASE}/dgo/${orderNumber}`;

        // Respuesta rápida "Datos DGO" si existe; si no, mensaje por defecto.
        let messageText, fileUrl = null, fileType = null;
        const allQrs = await db.collection('quick_replies').get();
        let qr = allQrs.docs.find(d => (d.data().shortcut || '').toLowerCase() === 'datos dgo');
        if (!qr) qr = allQrs.docs.find(d => { const sc = (d.data().shortcut || '').toLowerCase(); return sc.includes('datos') && sc.includes('dgo'); });
        if (qr) {
            const q = qr.data();
            messageText = (q.message || '')
                .replace(/\*\*/g, orderNumber)
                .replace(/(https?:\/\/[^\/\s]+\/dgo)\/?(?=\s|$)/gi, `$1/${orderNumber}`);
            if (!/\/dgo\//i.test(messageText)) messageText += `\n${link}`;
            fileUrl = q.fileUrl || null;
            fileType = q.fileType || null;
        } else {
            messageText = `📦✨ Para enviarte tu pedido *${orderNumber}* necesitamos tu dirección de entrega en Durango 📍🚚\n\nPor favor llénala en este enlace 👇😊\n${link}`;
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

        res.json({ success: true, orderNumber, link, message: 'Solicitud de datos DGO enviada correctamente.' });
    } catch (error) {
        console.error('[REPARTOS-DGO] pedir-datos', error);
        res.status(500).json({ success: false, message: 'Error al enviar la solicitud de datos.', error: error.message });
    }
});

module.exports = router;
