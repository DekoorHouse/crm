const express = require('express');
const axios = require('axios');
const router = express.Router();
const { db } = require('../config');

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_API = 'https://api.mercadopago.com';
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';
// MP_SANDBOX=true cuando se usen credenciales de prueba (TESTUSER + APP_USR de test)
const MP_SANDBOX = process.env.MP_SANDBOX === 'true';

const BASE_URL = process.env.API_URL || 'https://app.dekoormx.com';

function mpHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
    };
}

// POST /api/mercadopago/checkout — Create a Mercado Pago Checkout Pro preference
router.post('/checkout', async (req, res) => {
    try {
        if (!MP_ACCESS_TOKEN) {
            console.error('[MP] MP_ACCESS_TOKEN not set');
            return res.status(500).json({ error: 'Pasarela de pago no configurada' });
        }

        const {
            customerName,
            customerEmail,
            customerPhone,
            productName,
            collection,
            imageUrl,
            shipping,
            qty: qtyRaw,
            subtotal: subtotalRaw,
            total: totalRaw,
            address
        } = req.body;

        if (!customerName || !customerPhone) {
            return res.status(400).json({ error: 'Nombre y teléfono son requeridos' });
        }

        const qty = parseInt(qtyRaw) || 1;
        const subtotal = parseInt(subtotalRaw) || (650 * qty);
        const total = parseInt(totalRaw) || subtotal;
        const isDHL = shipping === 'dhl';
        const shippingCost = isDHL ? 160 : 0;
        const unitPrice = subtotal / qty;

        // Clean phone: ensure 10 digits + area code
        let phone = (customerPhone || '').replace(/\D/g, '');
        if (phone.length === 10) phone = '52' + phone;
        const areaCode = phone.substring(0, 2);
        const phoneNumber = phone.substring(2);

        // Build line items
        const items = [{
            id: `lampara-${(collection || 'general').toLowerCase()}`,
            title: productName || 'Lámpara 3D Personalizada',
            description: collection ? `Colección ${collection}` : 'Lámpara 3D personalizada con grabado láser',
            picture_url: imageUrl || undefined,
            category_id: 'art',
            quantity: qty,
            currency_id: 'MXN',
            unit_price: unitPrice
        }];

        if (isDHL) {
            items.push({
                id: 'envio-dhl',
                title: 'Envío DHL Express',
                description: 'Entrega en 2-3 días hábiles',
                category_id: 'services',
                quantity: 1,
                currency_id: 'MXN',
                unit_price: shippingCost
            });
        }

        // Build preference
        const externalReference = `dekoor_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        // Split first/last name for MP
        const nameParts = customerName.trim().split(' ');
        const firstName = nameParts[0] || customerName;
        const lastName = nameParts.slice(1).join(' ') || nameParts[0] || '';

        const preferencePayload = {
            items,
            payer: {
                name: firstName,
                surname: lastName,
                email: customerEmail || `${phone}@dekoor.mx`,
                phone: { area_code: areaCode, number: phoneNumber },
                identification: { type: 'RFC', number: 'XAXX010101000' },
                address: {
                    zip_code: address?.zip || '',
                    street_name: address?.street || '',
                    street_number: ''
                }
            },
            back_urls: {
                success: `${BASE_URL}/sitio/pago-exitoso`,
                failure: `${BASE_URL}/sitio/pago-fallido`,
                pending: `${BASE_URL}/sitio/pago-pendiente`
            },
            auto_return: 'approved',
            binary_mode: false,
            statement_descriptor: 'DEKOOR',
            external_reference: externalReference,
            notification_url: `${BASE_URL}/api/mercadopago/webhook`,
            metadata: {
                collection: collection || '',
                image_url: imageUrl || '',
                shipping_method: isDHL ? 'DHL Express' : 'J&T Express',
                source: 'sitio_web',
                customer_phone: phone,
                customer_name: customerName,
                address_street: address?.street || '',
                address_colonia: address?.colonia || '',
                address_city: address?.city || '',
                address_state: address?.state || '',
                address_zip: address?.zip || ''
            }
        };

        console.log('[MP] Creating preference for', customerName, 'total:', total);

        const response = await axios.post(`${MP_API}/checkout/preferences`, preferencePayload, {
            headers: mpHeaders()
        });

        const pref = response.data;

        // Save pending order to Firestore
        await db.collection('mp_orders').doc(externalReference).set({
            externalReference,
            preferenceId: pref.id,
            initPoint: pref.init_point,
            sandboxInitPoint: pref.sandbox_init_point,
            customerName,
            customerEmail: customerEmail || null,
            customerPhone: phone,
            productName: productName || 'Lámpara 3D Personalizada',
            collection: collection || '',
            qty,
            subtotal,
            shippingCost,
            shippingMethod: isDHL ? 'DHL Express' : 'J&T Express',
            total,
            address: address || null,
            status: 'pending',
            createdAt: new Date(),
            imageUrl: imageUrl || null
        });

        console.log(`[MP] Preference created: ${pref.id} (ext: ${externalReference}) sandbox=${MP_SANDBOX}`);

        // En modo sandbox usar sandbox_init_point para que el TESTUSER pueda completar el pago
        const checkoutUrl = MP_SANDBOX ? pref.sandbox_init_point : pref.init_point;

        res.json({
            init_point: checkoutUrl,
            preference_id: pref.id,
            external_reference: externalReference
        });

    } catch (error) {
        console.error('[MP] Error creating preference:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Error al crear la sesión de pago',
            details: error.response?.data || error.message
        });
    }
});

// POST /api/mercadopago/webhook — Receive Mercado Pago payment notifications
router.post('/webhook', async (req, res) => {
    // Always respond 200 immediately to MP
    res.sendStatus(200);

    try {
        const event = req.body;
        console.log(`[MP WEBHOOK] Event type: ${event.type || event.action}`);

        // MP sends notifications with type "payment" and resource ID
        if (event.type !== 'payment') {
            console.log('[MP WEBHOOK] Ignoring non-payment event');
            return;
        }

        const paymentId = event.data?.id;
        if (!paymentId) {
            console.error('[MP WEBHOOK] No payment ID in event');
            return;
        }

        // Fetch full payment details from MP
        const paymentRes = await axios.get(`${MP_API}/v1/payments/${paymentId}`, {
            headers: mpHeaders()
        });
        const payment = paymentRes.data;

        const externalReference = payment.external_reference;
        const status = payment.status; // approved, pending, rejected, etc

        console.log(`[MP WEBHOOK] Payment ${paymentId} status: ${status}, ref: ${externalReference}`);

        if (!externalReference) {
            console.error('[MP WEBHOOK] No external_reference in payment');
            return;
        }

        const mpRef = db.collection('mp_orders').doc(externalReference);
        const mpDoc = await mpRef.get();

        if (!mpDoc.exists) {
            console.error(`[MP WEBHOOK] Order ${externalReference} not found in Firestore`);
            return;
        }

        const mpData = mpDoc.data();

        // Update MP order with payment info
        await mpRef.update({
            status,
            paymentId,
            paymentMethod: payment.payment_method_id,
            paymentType: payment.payment_type_id,
            paidAt: status === 'approved' ? new Date() : null,
            updatedAt: new Date()
        });

        // Only create internal order if payment is approved
        if (status !== 'approved') {
            console.log(`[MP WEBHOOK] Payment not approved (${status}), skipping order creation`);
            return;
        }

        // Avoid duplicate order creation (idempotency)
        if (mpData.internalOrderNumber) {
            console.log(`[MP WEBHOOK] Order ${mpData.internalOrderNumber} already created for ${externalReference}`);
            return;
        }

        // Generate consecutive order number
        const counterRef = db.collection('counters').doc('orders');
        const newOrderNumber = await db.runTransaction(async (t) => {
            const counterDoc = await t.get(counterRef);
            const lastNum = counterDoc.exists ? counterDoc.data().lastOrderNumber : 1000;
            const next = lastNum + 1;
            t.set(counterRef, { lastOrderNumber: next }, { merge: true });
            return next;
        });

        const orderNumber = `DH${newOrderNumber}`;
        const addr = mpData.address || {};
        const addressStr = addr.street
            ? `${addr.street}, ${addr.colonia}, ${addr.city}, ${addr.state} C.P. ${addr.zip}`
            : '';

        const pedido = {
            consecutiveOrderNumber: orderNumber,
            contactId: null,
            producto: mpData.productName,
            telefono: mpData.customerPhone,
            precio: mpData.total,
            datosProducto: `Colección: ${mpData.collection}`,
            datosPromocion: '',
            comentarios: `Pago online via Mercado Pago (${paymentId}). Cliente: ${mpData.customerName}. Envio: ${mpData.shippingMethod}. Direccion: ${addressStr}`,
            fotoUrls: mpData.imageUrl ? [mpData.imageUrl] : [],
            fotoPromocionUrls: [],
            estatus: 'Confirmado',
            createdAt: new Date(),
            confirmedAt: new Date(),
            telefonoVerificado: true,
            estatusVerificado: false,
            pagoMercadoPago: true,
            mpPaymentId: paymentId,
            mpExternalReference: externalReference
        };

        await db.collection('pedidos').doc(orderNumber).set(pedido);
        await mpRef.update({ internalOrderNumber: orderNumber });

        console.log(`[MP WEBHOOK] Order ${orderNumber} created from payment ${paymentId}`);

    } catch (error) {
        console.error('[MP WEBHOOK] Error:', error.response?.data || error.message);
    }
});

// GET /api/mercadopago/order/:ref — Check order status by external reference
router.get('/order/:ref', async (req, res) => {
    try {
        const doc = await db.collection('mp_orders').doc(req.params.ref).get();
        if (!doc.exists) return res.status(404).json({ error: 'Orden no encontrada' });
        const data = doc.data();
        res.json({
            status: data.status,
            orderNumber: data.internalOrderNumber || null,
            customerName: data.customerName,
            total: data.total,
            paymentId: data.paymentId || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
