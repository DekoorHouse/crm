/**
 * Carritos abandonados - API
 * Captura leads cuando el cliente llena form del carrito pero no completa compra.
 * Collection Firestore: abandoned_carts
 */
const express = require('express');
const router = express.Router();
const { db, admin } = require('../config');

// Normaliza telefono MX a formato 10 digitos (para matching)
function normalizePhone(raw) {
    const digits = (raw || '').replace(/\D/g, '');
    return digits.slice(-10);
}

// POST /api/carritos-abandonados - Captura el lead
router.post('/', async (req, res) => {
    try {
        const {
            customerName, customerPhone, customerEmail,
            items,
            subtotal,
            shipping,
            address
        } = req.body;

        if (!customerPhone || !customerName) {
            return res.status(400).json({ error: 'Nombre y telefono son requeridos' });
        }

        const phone10 = normalizePhone(customerPhone);
        if (phone10.length !== 10) {
            return res.status(400).json({ error: 'Telefono invalido (10 digitos)' });
        }

        const now = new Date();
        const addr = address || {};

        // Upsert por telefono: si ya existe un carrito pendiente del mismo numero
        // en las ultimas 24h, lo actualizamos. Asi evitamos duplicados cuando
        // el cliente re-submitea el form.
        const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const existingSnap = await db.collection('abandoned_carts')
            .where('phone10', '==', phone10)
            .where('status', '==', 'pending')
            .where('createdAt', '>=', since)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        const payload = {
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim(),
            phone10,
            customerEmail: (customerEmail || '').trim() || null,
            items: Array.isArray(items) ? items : [],
            subtotal: Number(subtotal) || 0,
            shipping: shipping || 'jt',
            address: {
                street: addr.street || '',
                colonia: addr.colonia || '',
                city: addr.city || '',
                state: addr.state || '',
                zip: addr.zip || ''
            },
            status: 'pending', // pending | converted | messaged | discarded
            updatedAt: now
        };

        let docId;
        if (!existingSnap.empty) {
            docId = existingSnap.docs[0].id;
            await db.collection('abandoned_carts').doc(docId).update(payload);
        } else {
            payload.createdAt = now;
            const docRef = await db.collection('abandoned_carts').add(payload);
            docId = docRef.id;
        }

        console.log(`[CARRITO] ${phone10} - ${customerName} - $${subtotal} (${existingSnap.empty ? 'nuevo' : 'actualizado'})`);

        res.json({ id: docId, status: 'pending' });
    } catch (error) {
        console.error('[CARRITO] Error al capturar:', error.message);
        res.status(500).json({ error: 'Error al capturar carrito' });
    }
});

// GET /api/carritos-abandonados - Lista para CRM
// Query params: status (default: pending), limit (default: 100)
router.get('/', async (req, res) => {
    try {
        const status = req.query.status || 'pending';
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);

        const snap = await db.collection('abandoned_carts')
            .where('status', '==', status)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        const carts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ carts, count: carts.length });
    } catch (error) {
        console.error('[CARRITO] Error al listar:', error.message);
        res.status(500).json({ error: 'Error al listar carritos' });
    }
});

// PUT /api/carritos-abandonados/:id - Actualizar estado manualmente (CRM)
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        const validStatuses = ['pending', 'converted', 'messaged', 'discarded'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Status invalido' });
        }
        const update = { updatedAt: new Date() };
        if (status) update.status = status;
        if (notes !== undefined) update.notes = notes;
        await db.collection('abandoned_carts').doc(id).update(update);
        res.json({ id, ...update });
    } catch (error) {
        console.error('[CARRITO] Error al actualizar:', error.message);
        res.status(500).json({ error: 'Error al actualizar carrito' });
    }
});

// Helper compartido: marca como 'converted' cualquier carrito pendiente del mismo
// telefono en las ultimas N horas. Se llama desde los webhooks de MP y transferencia.
async function markCartConverted(phone, orderNumber) {
    try {
        const phone10 = normalizePhone(phone);
        if (phone10.length !== 10) return;
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 dias

        const snap = await db.collection('abandoned_carts')
            .where('phone10', '==', phone10)
            .where('status', '==', 'pending')
            .where('createdAt', '>=', since)
            .get();

        if (snap.empty) return;

        const batch = db.batch();
        snap.docs.forEach(doc => {
            batch.update(doc.ref, {
                status: 'converted',
                convertedAt: new Date(),
                orderNumber: orderNumber || null
            });
        });
        await batch.commit();
        console.log(`[CARRITO] ${snap.size} carritos marcados como convertidos para ${phone10} -> ${orderNumber}`);
    } catch (e) {
        console.warn('[CARRITO] Error marcando convertido:', e.message);
    }
}

module.exports = router;
module.exports.markCartConverted = markCartConverted;
module.exports.normalizePhone = normalizePhone;
