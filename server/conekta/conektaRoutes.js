const express = require('express');
const axios = require('axios');
const router = express.Router();
const { db } = require('../config');

const CONEKTA_PRIVATE_KEY = process.env.CONEKTA_PRIVATE_KEY;
const CONEKTA_API = 'https://api.conekta.io';
const CONEKTA_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.conekta-v2.2.0+json',
    'Authorization': `Bearer ${CONEKTA_PRIVATE_KEY}`
};

const BASE_URL = process.env.API_URL || 'https://app.dekoormx.com';

// POST /api/conekta/checkout — Create a Conekta hosted checkout session
router.post('/checkout', async (req, res) => {
    try {
        const { customerName, customerEmail, customerPhone, productName, collection, imageUrl, shipping, address } = req.body;

        if (!customerName || !customerPhone) {
            return res.status(400).json({ error: 'Nombre y teléfono son requeridos' });
        }

        // Clean phone: ensure +52 prefix
        let phone = customerPhone.replace(/\D/g, '');
        if (phone.length === 10) phone = '52' + phone;
        if (!phone.startsWith('+')) phone = '+' + phone;

        // Shipping cost
        const isDHL = shipping === 'dhl';
        const shippingCost = isDHL ? 16000 : 0; // in centavos
        const productPrice = 65000; // $650 MXN in centavos

        // Expires in 72 hours
        const expiresAt = Math.floor(Date.now() / 1000) + (72 * 60 * 60);

        if (!CONEKTA_PRIVATE_KEY) {
            console.error('[CONEKTA] CONEKTA_PRIVATE_KEY not set');
            return res.status(500).json({ error: 'Pasarela de pago no configurada' });
        }

        const lineItems = [{
            name: productName || 'Lámpara 3D Personalizada',
            unit_price: productPrice,
            quantity: 1
        }];

        const orderPayload = {
            currency: 'MXN',
            customer_info: {
                name: customerName,
                email: customerEmail || `${phone.replace('+', '')}@dekoor.mx`,
                phone: phone
            },
            line_items: lineItems,
            shipping_lines: [{
                amount: shippingCost
            }],
            shipping_contact: {
                phone: phone,
                receiver: customerName,
                address: {
                    street1: address ? `${address.street}, ${address.colonia}` : '',
                    city: address?.city || '',
                    state: address?.state || '',
                    country: 'MX',
                    postal_code: address?.zip || '00000'
                }
            },
            checkout: {
                type: 'Integration',
                allowed_payment_methods: ['cash', 'card', 'bank_transfer', 'bnpl', 'pay_by_bank'],
                expires_at: expiresAt
            },
            metadata: {
                collection: collection || '',
                image_url: imageUrl || '',
                shipping: isDHL ? 'DHL Express' : 'J&T Express',
                source: 'sitio_web'
            }
        };

        console.log('[CONEKTA] Creating order with expires_at:', expiresAt);

        const response = await axios.post(`${CONEKTA_API}/orders`, orderPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.conekta-v2.2.0+json',
                'Authorization': `Bearer ${CONEKTA_PRIVATE_KEY}`
            }
        });

        const order = response.data;
        const checkoutRequestId = order.checkout?.id;
        const orderId = order.id;

        const totalAmount = (productPrice + shippingCost) / 100;

        // Save pending order to Firestore
        await db.collection('conekta_orders').doc(orderId).set({
            conektaOrderId: orderId,
            checkoutRequestId,
            customerName,
            customerEmail: customerEmail || null,
            customerPhone: phone,
            productName: productName || 'Lámpara 3D Personalizada',
            collection: collection || '',
            amount: totalAmount,
            productPrice: 650,
            shippingMethod: isDHL ? 'DHL Express' : 'J&T Express',
            shippingCost: isDHL ? 160 : 0,
            address: address || null,
            status: 'pending',
            createdAt: new Date(),
            imageUrl: imageUrl || null
        });

        console.log(`[CONEKTA] Checkout created: ${orderId} (checkout: ${checkoutRequestId}) for ${customerName}`);
        res.json({ checkoutRequestId, orderId });

    } catch (error) {
        console.error('[CONEKTA] Error creating checkout:', error.response?.data || error.message);
        res.status(500).json({ error: 'Error al crear la sesión de pago', details: error.response?.data });
    }
});

// POST /api/conekta/webhook — Receive Conekta payment events
router.post('/webhook', async (req, res) => {
    try {
        const event = req.body;
        console.log(`[CONEKTA WEBHOOK] Event: ${event.type}`);

        if (event.type === 'order.paid') {
            const order = event.data?.object;
            const conektaOrderId = order?.id;

            if (!conektaOrderId) {
                console.error('[CONEKTA WEBHOOK] No order ID in event');
                return res.sendStatus(200);
            }

            // Update Conekta order in Firestore
            const conektaRef = db.collection('conekta_orders').doc(conektaOrderId);
            const conektaDoc = await conektaRef.get();

            if (!conektaDoc.exists) {
                console.error(`[CONEKTA WEBHOOK] Order ${conektaOrderId} not found in Firestore`);
                return res.sendStatus(200);
            }

            const conektaData = conektaDoc.data();
            await conektaRef.update({ status: 'paid', paidAt: new Date() });

            // Create order in pedidos collection (same format as existing orders)
            const counterRef = db.collection('counters').doc('orders');
            const newOrderNumber = await db.runTransaction(async (t) => {
                const counterDoc = await t.get(counterRef);
                const lastNum = counterDoc.exists ? counterDoc.data().lastOrderNumber : 1000;
                const next = lastNum + 1;
                t.set(counterRef, { lastOrderNumber: next }, { merge: true });
                return next;
            });

            const orderNumber = `DH${newOrderNumber}`;
            const addr = conektaData.address;
            const addressStr = addr ? `${addr.street}, ${addr.colonia}, ${addr.city}, ${addr.state} C.P. ${addr.zip}` : '';
            const pedido = {
                consecutiveOrderNumber: orderNumber,
                contactId: null,
                producto: conektaData.productName,
                telefono: conektaData.customerPhone,
                precio: conektaData.amount,
                datosProducto: `Colección: ${conektaData.collection}`,
                datosPromocion: '',
                comentarios: `Pago online via Conekta (${conektaOrderId}). Cliente: ${conektaData.customerName}. Envío: ${conektaData.shippingMethod || 'J&T Express'}. Dirección: ${addressStr}`,
                fotoUrls: conektaData.imageUrl ? [conektaData.imageUrl] : [],
                fotoPromocionUrls: [],
                estatus: 'Confirmado',
                createdAt: new Date(),
                confirmedAt: new Date(),
                telefonoVerificado: true,
                estatusVerificado: false,
                pagoConekta: true,
                conektaOrderId,
                shippingMethod: conektaData.shippingMethod || 'J&T Express',
                shippingCost: conektaData.shippingCost || 0,
                address: conektaData.address || null
            };

            await db.collection('pedidos').doc(orderNumber).set(pedido);
            await conektaRef.update({ internalOrderNumber: orderNumber });

            console.log(`[CONEKTA WEBHOOK] Order ${orderNumber} created from payment ${conektaOrderId}`);
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('[CONEKTA WEBHOOK] Error:', error.message);
        res.sendStatus(200); // Always return 200 to Conekta
    }
});

// GET /api/conekta/order/:id — Check order status
router.get('/order/:id', async (req, res) => {
    try {
        const doc = await db.collection('conekta_orders').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Orden no encontrada' });
        const data = doc.data();
        res.json({
            status: data.status,
            orderNumber: data.internalOrderNumber || null,
            customerName: data.customerName
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
