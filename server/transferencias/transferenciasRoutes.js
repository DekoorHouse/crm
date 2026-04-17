const express = require('express');
const router = express.Router();
const { db } = require('../config');
const PRICES = require('../prices');

// Datos bancarios (se muestran al cliente).
// La CLABE no se proporciono; si se desea agregar, poner aqui.
const BANK_INFO = {
    bank: 'BBVA',
    holder: 'Christian Morales Villanueva',
    cardNumber: '4152314570690670'
};

const WA_NUMBER = '5216181333519';

// Genera referencia corta: DK-{ultimos4telefono}-{ultimos4timestamp}
function generateReference(phone) {
    const clean = (phone || '').replace(/\D/g, '');
    const last4Phone = (clean.slice(-4) || '0000').padStart(4, '0');
    const last4Ts = String(Date.now()).slice(-4);
    return `DK-${last4Phone}-${last4Ts}`;
}

// GET /api/pagos/transferencia/info - Datos bancarios (no sensibles)
router.get('/info', (_req, res) => {
    res.json({
        bank: BANK_INFO,
        whatsapp: WA_NUMBER
    });
});

// POST /api/pagos/transferencia - Crear orden pendiente de transferencia
router.post('/', async (req, res) => {
    try {
        const {
            customerName,
            customerPhone,
            customerEmail,
            productName,
            collection,
            imageUrl,
            shipping,
            qty: qtyRaw,
            address
        } = req.body;

        if (!customerName || !customerPhone) {
            return res.status(400).json({ error: 'Nombre y telefono son requeridos' });
        }

        // Calculo de precios AUTORITATIVO en servidor (no confiar en el cliente)
        const qty = Math.max(1, Math.min(PRICES.maxQty, parseInt(qtyRaw) || 1));
        const isDHL = shipping === 'dhl';
        const shippingCost = isDHL ? PRICES.shippingDhlCost : PRICES.shippingJtCost;
        const subtotal = PRICES.productUnitPrice * qty;
        const total = subtotal + shippingCost;

        // Normalizar telefono MX
        let phone = (customerPhone || '').replace(/\D/g, '');
        if (phone.length === 10) phone = '52' + phone;

        // Generar referencia unica
        const reference = generateReference(phone);
        const externalReference = `transfer_${reference}_${Date.now()}`;

        const addr = address || {};
        const addressStr = addr.street
            ? `${addr.street}, ${addr.colonia}, ${addr.city}, ${addr.state} C.P. ${addr.zip}`
            : '';

        // Generar numero consecutivo (mismo contador que pedidos MP)
        const counterRef = db.collection('counters').doc('orders');
        const newOrderNumber = await db.runTransaction(async (t) => {
            const counterDoc = await t.get(counterRef);
            const lastNum = counterDoc.exists ? counterDoc.data().lastOrderNumber : 1000;
            const next = lastNum + 1;
            t.set(counterRef, { lastOrderNumber: next }, { merge: true });
            return next;
        });
        const orderNumber = `DH${newOrderNumber}`;

        // Crear pedido con estatus "Pendiente Transferencia"
        // El operador lo mueve a "Confirmado" cuando recibe el comprobante.
        const pedido = {
            consecutiveOrderNumber: orderNumber,
            contactId: null,
            producto: productName || 'Lampara 3D Personalizada',
            telefono: phone,
            precio: total,
            datosProducto: `Coleccion: ${collection || 'N/A'}`,
            datosPromocion: '',
            comentarios: [
                `PAGO POR TRANSFERENCIA BBVA (ESPERANDO COMPROBANTE)`,
                `Referencia: ${reference}`,
                `Cliente: ${customerName}`,
                `Email: ${customerEmail || 'N/A'}`,
                `Envio: ${isDHL ? 'DHL Express' : 'J&T Express'}`,
                `Direccion: ${addressStr}`
            ].join('\n'),
            fotoUrls: imageUrl ? [imageUrl] : [],
            fotoPromocionUrls: [],
            estatus: 'Pendiente Transferencia',
            createdAt: new Date(),
            telefonoVerificado: false,
            estatusVerificado: false,
            pagoTransferencia: true,
            transferenciaReferencia: reference,
            transferenciaExternalRef: externalReference
        };

        await db.collection('pedidos').doc(orderNumber).set(pedido);

        // Tambien en coleccion separada para tracking/filtrado
        await db.collection('transfer_orders').doc(externalReference).set({
            externalReference,
            reference,
            orderNumber,
            customerName,
            customerPhone: phone,
            customerEmail: customerEmail || null,
            productName: productName || 'Lampara 3D Personalizada',
            collection: collection || '',
            qty,
            subtotal,
            shippingCost,
            shippingMethod: isDHL ? 'DHL Express' : 'J&T Express',
            total,
            address: addr,
            imageUrl: imageUrl || null,
            status: 'pending_proof',
            createdAt: new Date()
        });

        console.log(`[TRANSFER] Orden ${orderNumber} creada con referencia ${reference} (total: $${total})`);

        res.json({
            reference,
            orderNumber,
            externalReference,
            total,
            bank: BANK_INFO,
            whatsapp: WA_NUMBER
        });

    } catch (error) {
        console.error('[TRANSFER] Error creando orden:', error.message, error.stack);
        res.status(500).json({ error: 'Error al crear orden de transferencia' });
    }
});

module.exports = router;
