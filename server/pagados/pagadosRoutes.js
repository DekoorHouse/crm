const express = require('express');
const router = express.Router();
const { db } = require('../config');

// CDMX no cambia de horario desde 2022, así que un offset fijo alcanza. Hace falta:
// filtrando en UTC, un pedido registrado a las 7 pm cae en el día siguiente.
const TZ = '-06:00';
const MAX_ROWS = 4000;   // techo del barrido; si se alcanza, el front avisa que hay más

const dayStart = k => new Date(`${k}T00:00:00.000${TZ}`);
const dayEnd = k => new Date(`${k}T23:59:59.999${TZ}`);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const dayKey = d => new Date(d.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
const toIso = ts => (ts && typeof ts.toDate === 'function') ? ts.toDate().toISOString() : null;

/**
 * Resume los productos del pedido en una línea. `items` es el formato canónico que
 * normaliza createOrderCore; `producto` es el campo legacy de los pedidos viejos que
 * no traen el array.
 */
function resumenProductos(d) {
    if (Array.isArray(d.items) && d.items.length) {
        return d.items.map(it => {
            const qty = Number(it.cantidad) || 1;
            return `${qty > 1 ? `${qty}× ` : ''}${it.producto || 'Sin producto'}`;
        }).join(', ');
    }
    return d.producto || 'Sin producto';
}

// GET /api/pagados/pedidos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Pedidos registrados en el rango (por `createdAt`, en hora CDMX) con lo necesario para
// auditar el evento Purchase de Meta. El filtro por evento/estatus lo aplica el front
// sobre esta misma ventana: Firestore no puede consultar "campo ausente" y así los
// contadores se recalculan sin volver a pegarle a la base.
router.get('/pedidos', async (req, res) => {
    try {
        const hasta = isDay(req.query.hasta) ? req.query.hasta : dayKey(new Date());
        const desde = isDay(req.query.desde)
            ? req.query.desde
            : dayKey(new Date(dayStart(hasta).getTime() - 29 * 86400000));

        if (dayStart(desde) > dayEnd(hasta)) {
            return res.status(400).json({ success: false, message: 'El rango de fechas está invertido.' });
        }

        const snap = await db.collection('pedidos')
            .where('createdAt', '>=', dayStart(desde))
            .where('createdAt', '<=', dayEnd(hasta))
            .orderBy('createdAt', 'desc')
            .limit(MAX_ROWS + 1)
            .get();

        const truncado = snap.size > MAX_ROWS;
        const docs = truncado ? snap.docs.slice(0, MAX_ROWS) : snap.docs;

        const data = docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                numero: d.consecutiveOrderNumber ? `DH${d.consecutiveOrderNumber}` : '—',
                consecutivo: Number(d.consecutiveOrderNumber) || 0,
                precio: Number(d.precio) || 0,
                producto: resumenProductos(d),
                estatus: d.estatus || 'Sin estatus',
                registradoAt: toIso(d.createdAt),
                metaPurchaseSentAt: toIso(d.metaPurchaseSentAt)
            };
        });

        res.json({ success: true, desde, hasta, truncado, max: MAX_ROWS, data });
    } catch (error) {
        console.error('[PAGADOS] Error listando pedidos:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
