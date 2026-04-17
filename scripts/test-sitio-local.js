/**
 * Mini-server local para probar el sitio /sitio/ y /datos-envio/ sin Firebase.
 * Mockea los endpoints que el frontend usa. Persiste ordenes de transferencia
 * en memoria para probar el flujo end-to-end (checkout -> form pre-llenado).
 * Uso: node scripts/test-sitio-local.js
 */
const express = require('express');
const path = require('path');
const PRICES = require('../server/prices');

const app = express();
app.use(express.json());

// Mock store (en memoria)
const mockOrders = new Map(); // orderNumber -> pedido
const mockCarts = []; // abandoned carts
let nextOrderNumber = 9000;
let nextCartId = 1;

// Mock de colonias por CP (muestra basica)
const MOCK_CPS = {
    '34188': { estado: 'Durango', colonias: ['Juan Lira Bracho', 'Centro', 'Del Valle'] },
    '34000': { estado: 'Durango', colonias: ['Centro', 'Los Pinos', 'Morelos'] },
    '06000': { estado: 'Ciudad de México', colonias: ['Centro', 'Juárez'] },
    '44100': { estado: 'Jalisco', colonias: ['Centro', 'Americana'] }
};

// env-config.js (para DekoorConfig / API_BASE_URL)
app.get('/env-config.js', (_req, res) => {
    res.type('application/javascript');
    res.send('window.API_BASE_URL = "";');
});

// GET /api/config/prices
app.get('/api/config/prices', (_req, res) => {
    res.json(PRICES);
});

// GET /api/codigo-postal/:cp (usado por datos-envio/)
app.get('/api/codigo-postal/:cp', (req, res) => {
    const data = MOCK_CPS[req.params.cp];
    if (data) {
        return res.json({ success: true, estado: data.estado, colonias: data.colonias });
    }
    res.json({ success: false, colonias: [] });
});

// POST /api/pagos/transferencia (MOCK)
app.post('/api/pagos/transferencia', (req, res) => {
    const body = req.body || {};
    const phone = (body.customerPhone || '').replace(/\D/g, '');
    const normalizedPhone = phone.length === 10 ? '52' + phone : phone;
    const last4 = (phone.slice(-4) || '0000').padStart(4, '0');
    const last4ts = String(Date.now()).slice(-4);
    const reference = `DK-${last4}-${last4ts}`;
    const qty = Math.max(1, parseInt(body.qty) || 1);
    const isDHL = body.shipping === 'dhl';
    const total = PRICES.productUnitPrice * qty + (isDHL ? PRICES.shippingDhlCost : 0);

    nextOrderNumber += 1;
    const orderNumber = `DH${nextOrderNumber}`;
    const addr = body.address || {};

    // Simular pedido guardado en Firestore
    mockOrders.set(orderNumber, {
        consecutiveOrderNumber: nextOrderNumber,
        telefono: normalizedPhone,
        envioPrefill: {
            nombreCompleto: body.customerName || '',
            telefono: normalizedPhone,
            email: body.customerEmail || '',
            direccion: addr.street || '',
            colonia: addr.colonia || '',
            ciudad: addr.city || '',
            estado: addr.state || '',
            codigoPostal: addr.zip || '',
            metodoEnvio: isDHL ? 'dhl' : 'jt',
            source: 'web_checkout_transferencia'
        }
    });

    console.log(`[MOCK TRANSFER] ${reference} - ${body.customerName} - ${orderNumber} - $${total}`);

    res.json({
        reference,
        orderNumber,
        externalReference: `mock_${Date.now()}`,
        total,
        bank: {
            bank: 'BBVA',
            holder: 'Christian Morales Villanueva',
            cardNumber: '4152314570690670'
        },
        whatsapp: '5216181333519'
    });
});

// GET /api/jt-guias/verificar-pedido/:orderNumber (MOCK)
app.get('/api/jt-guias/verificar-pedido/:orderNumber', (req, res) => {
    const { orderNumber } = req.params;
    if (!/^DH\d+$/i.test(orderNumber)) {
        return res.status(400).json({
            success: false,
            code: 'FORMATO_INVALIDO',
            message: 'El numero de pedido debe comenzar con DH seguido de numeros (ej: DH1042).'
        });
    }

    const pedido = mockOrders.get(orderNumber.toUpperCase());
    if (!pedido) {
        return res.status(404).json({
            success: false,
            code: 'PEDIDO_NO_ENCONTRADO',
            message: `No encontramos el pedido ${orderNumber}. (En local: primero crea uno via checkout con transferencia.)`
        });
    }

    const telefonoLimpio = String(pedido.telefono || '').replace(/\D/g, '').slice(-10);
    const telefonoMasked = telefonoLimpio.length >= 4 ? `******${telefonoLimpio.slice(-4)}` : '****';

    res.json({
        success: true,
        orderNumber: orderNumber.toUpperCase(),
        telefonoMasked,
        telefonoCompleto: telefonoLimpio,
        envioPrefill: pedido.envioPrefill || null
    });
});

// POST /api/carritos-abandonados (MOCK)
app.post('/api/carritos-abandonados', (req, res) => {
    const body = req.body || {};
    const phone10 = (body.customerPhone || '').replace(/\D/g, '').slice(-10);
    const id = 'cart_' + nextCartId++;
    mockCarts.push({
        id,
        ...body,
        phone10,
        status: 'pending',
        createdAt: new Date().toISOString()
    });
    console.log(`[MOCK CART] ${body.customerName} (${phone10}) - $${body.subtotal}`);
    res.json({ id, status: 'pending' });
});

// GET /api/carritos-abandonados (MOCK)
app.get('/api/carritos-abandonados', (req, res) => {
    const status = req.query.status || 'pending';
    const carts = mockCarts.filter(c => c.status === status);
    res.json({ carts, count: carts.length });
});

// PUT /api/carritos-abandonados/:id (MOCK)
app.put('/api/carritos-abandonados/:id', (req, res) => {
    const cart = mockCarts.find(c => c.id === req.params.id);
    if (!cart) return res.status(404).json({ error: 'No encontrado' });
    if (req.body.status) cart.status = req.body.status;
    res.json({ id: cart.id, status: cart.status });
});

// POST /api/mercadopago/checkout (MOCK)
app.post('/api/mercadopago/checkout', (_req, res) => {
    res.json({
        init_point: 'https://example.com/mock-mp-checkout',
        preference_id: 'MOCK_PREF',
        external_reference: 'mock_ref'
    });
});

// Serve datos-envio/index.html for /datos-envio/DH#### (like en produccion con Firebase hosting rewrite)
app.get(/^\/datos-envio\/DH\d+\/?$/i, (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'datos-envio', 'index.html'));
});

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n  ✅ Mock server corriendo en http://localhost:${PORT}\n`);
    console.log(`  1) Checkout: http://localhost:${PORT}/sitio/checkout/?name=Christian&phone=6182297167&email=test@test.com&shipping=dhl&product=Lampara+3D&collection=Pareja&subtotal=650&qty=1&street=Juan+Lira+519&colonia=Juan+Lira+Bracho&city=Durango&state=Durango&zip=34188`);
    console.log(`  2) Despues de crear orden: http://localhost:${PORT}/datos-envio/DH9001 (o el numero que muestre el console log)\n`);
});
