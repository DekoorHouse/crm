const express = require('express');
const axios = require('axios');
const router = express.Router();
const { db, bucket } = require('../config');
const { markCartConverted } = require('../carritos/carritosRoutes');

const crypto = require('crypto');
const bwipjs = require('bwip-js');
const sharp = require('sharp');

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_API = 'https://api.mercadopago.com';
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';
// MP_SANDBOX=true cuando se usen credenciales de prueba (TESTUSER + APP_USR de test)
const MP_SANDBOX = process.env.MP_SANDBOX === 'true';

const BASE_URL = process.env.API_URL || 'https://app.dekoormx.com';

// Email generico requerido por MP para pagos OXXO (Dekoor no usa email del cliente,
// la referencia se comparte por WhatsApp directamente).
const OXXO_GENERIC_EMAIL = 'pagos@dekoormx.com';

// Numero del admin que recibe alertas cuando un pago OXXO se acredita.
// Formato internacional sin '+' (52 = Mexico, 1 = celular). Se puede override con env.
const ADMIN_ALERT_PHONE = process.env.ADMIN_ALERT_PHONE || '5216182297167';

// --- PRECIOS AUTORITATIVOS DEL SERVIDOR ---
// El cliente NO puede modificar estos precios; siempre se calculan aquí.
// Fuente unica: server/prices.js
const PRICES = require('../prices');
const PRODUCT_UNIT_PRICE = PRICES.productUnitPrice;
const SHIPPING_DHL_COST = PRICES.shippingDhlCost;
const SHIPPING_JT_COST = PRICES.shippingJtCost;
const MAX_QTY = PRICES.maxQty;

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
            address
        } = req.body;

        if (!customerName || !customerPhone) {
            return res.status(400).json({ error: 'Nombre y teléfono son requeridos' });
        }

        // Email obligatorio (MP lo necesita para enviar comprobante OXXO/SPEI)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!customerEmail || !emailRegex.test(customerEmail.trim())) {
            return res.status(400).json({ error: 'Email valido es requerido' });
        }

        // Calculo de precios AUTORITATIVO en servidor (no confiar en el cliente)
        const qty = Math.max(1, Math.min(MAX_QTY, parseInt(qtyRaw) || 1));
        const isDHL = shipping === 'dhl';
        const shippingCost = isDHL ? SHIPPING_DHL_COST : SHIPPING_JT_COST;
        const unitPrice = PRODUCT_UNIT_PRICE;
        const subtotal = unitPrice * qty;
        const total = subtotal + shippingCost;

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

        // En sandbox NO enviamos payer porque MP valida contra el TESTUSER logueado
        // y bloquea el boton Pagar si no coinciden. El cliente entra su email en MP.
        const preferencePayload = {
            items,
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
                customer_email: customerEmail || '',
                address_street: address?.street || '',
                address_colonia: address?.colonia || '',
                address_city: address?.city || '',
                address_state: address?.state || '',
                address_zip: address?.zip || ''
            }
        };

        // En produccion agregamos payer info para mejor UX (autorelleno del cliente)
        if (!MP_SANDBOX) {
            preferencePayload.payer = {
                name: firstName,
                surname: lastName,
                email: customerEmail.trim(),
                phone: { area_code: areaCode, number: phoneNumber },
                identification: { type: 'RFC', number: 'XAXX010101000' },
                address: {
                    zip_code: address?.zip || '',
                    street_name: address?.street || '',
                    street_number: ''
                }
            };
        }

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

// =====================================================================
// Genera una imagen tipo "ticket" con los datos del pago OXXO + codigo
// de barras Code128. La sube a Firebase Storage y devuelve la URL
// publica para mandarla al cliente por WhatsApp como imagen.
// =====================================================================
async function generateOxxoTicketImage({ barcodeContent, amount, customerName, expirationDate, orderNumber }) {
    if (!barcodeContent) return null;

    try {
        // 1) Generar PNG del codigo de barras (Code128)
        const barcodePng = await bwipjs.toBuffer({
            bcid: 'code128',
            text: barcodeContent,
            scale: 3,
            height: 14,
            includetext: true,
            textxalign: 'center',
            textsize: 9,
            backgroundcolor: 'FFFFFF',
            paddingwidth: 10,
            paddingheight: 6
        });
        const barcodeMeta = await sharp(barcodePng).metadata();

        // 2) Componer ticket: encabezado rojo + datos + barcode
        const ticketWidth = Math.max(720, barcodeMeta.width + 80);
        const monto = `$${Number(amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`;
        const venceTxt = expirationDate
            ? new Date(expirationDate).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
            : '';
        const cliente = (customerName || 'Cliente Dekoor').slice(0, 40);
        const pedidoLine = orderNumber ? `Pedido ${orderNumber}` : 'Pago Dekoor';

        // SVG de la parte superior (texto + estilos)
        const headerHeight = 320;
        const totalHeight = headerHeight + barcodeMeta.height + 90;

        const svg = `
            <svg width="${ticketWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
                <style>
                    .bg { fill: #ffffff; }
                    .header { fill: #e2231a; }
                    .title { font: bold 38px sans-serif; fill: #ffffff; }
                    .subtitle { font: 600 18px sans-serif; fill: #ffe5e3; }
                    .label { font: 600 14px sans-serif; fill: #888; text-transform: uppercase; letter-spacing: 1px; }
                    .value { font: bold 28px sans-serif; fill: #111; }
                    .amount { font: bold 48px sans-serif; fill: #e2231a; }
                    .ref { font: bold 22px monospace; fill: #222; }
                    .footer { font: 500 13px sans-serif; fill: #666; }
                    .divider { stroke: #eee; stroke-width: 1; stroke-dasharray: 4 4; }
                </style>
                <rect class="bg" x="0" y="0" width="${ticketWidth}" height="${totalHeight}"/>
                <rect class="header" x="0" y="0" width="${ticketWidth}" height="100"/>
                <text class="title" x="32" y="55">PAGO EN OXXO</text>
                <text class="subtitle" x="32" y="82">${pedidoLine} · Dekoor</text>

                <text class="label" x="32" y="140">Monto a pagar</text>
                <text class="amount" x="32" y="185">${monto}</text>

                <text class="label" x="32" y="225">Cliente</text>
                <text class="value" x="32" y="255">${cliente}</text>

                ${venceTxt ? `<text class="label" x="32" y="290">Vence</text>
                <text class="value" x="32" y="320" style="font-size:22px;">${venceTxt}</text>` : ''}

                <line class="divider" x1="32" y1="${headerHeight - 10}" x2="${ticketWidth - 32}" y2="${headerHeight - 10}"/>

                <text class="footer" x="32" y="${totalHeight - 22}">Acude a cualquier OXXO con esta referencia. Pago se acredita en hasta 48h.</text>
            </svg>
        `;

        // 3) Componer imagen final con sharp
        const ticketBuffer = await sharp({
            create: {
                width: ticketWidth,
                height: totalHeight,
                channels: 3,
                background: '#ffffff'
            }
        })
        .composite([
            { input: Buffer.from(svg), top: 0, left: 0 },
            { input: barcodePng, top: headerHeight + 10, left: Math.floor((ticketWidth - barcodeMeta.width) / 2) }
        ])
        .png()
        .toBuffer();

        // 4) Subir a Firebase Storage publico
        const ts = Date.now();
        const id = ts + '_' + Math.random().toString(36).slice(2, 8);
        const filePath = `oxxo-tickets/${id}.png`;
        const file = bucket.file(filePath);
        await file.save(ticketBuffer, {
            metadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000' },
            public: true
        });
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
        return publicUrl;
    } catch (err) {
        console.error('[OXXO IMG] Error generando ticket:', err.message);
        return null;
    }
}

// =====================================================================
// POST /api/mercadopago/oxxo
// Genera una referencia OXXO directa via /v1/payments (sin Checkout Pro).
// Pensado para uso interno desde el CRM: el admin captura monto + datos
// del cliente, recibe la referencia y la comparte por WhatsApp.
// =====================================================================
router.post('/oxxo', async (req, res) => {
    try {
        if (!MP_ACCESS_TOKEN) {
            return res.status(500).json({ error: 'Pasarela de pago no configurada' });
        }

        const {
            amount,                 // Monto a cobrar (MXN)
            customerName,           // Nombre del cliente (opcional)
            customerPhone,          // Telefono (para vincular al pedido)
            orderNumber,            // # de pedido del CRM (DH1234) si aplica
            productName,            // Concepto/descripcion del cobro
            note                    // Nota interna (opcional)
        } = req.body;

        const monto = Number(amount);
        if (!monto || isNaN(monto) || monto <= 0) {
            return res.status(400).json({ error: 'Monto invalido' });
        }

        // Limpia telefono: 10 digitos + lada Mexico
        let phone = (customerPhone || '').replace(/\D/g, '');
        if (phone.length === 10) phone = '52' + phone;

        // Split nombre
        const cleanName = (customerName || 'Cliente Dekoor').trim();
        const nameParts = cleanName.split(' ');
        const firstName = nameParts[0] || cleanName;
        const lastName = nameParts.slice(1).join(' ') || nameParts[0] || 'Dekoor';

        // External reference para vincular webhook con esta orden
        const externalReference = `oxxo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        // OXXO expira en 3 dias (default MP). Configurable por env si hace falta.
        const expirationDays = parseInt(process.env.OXXO_EXPIRATION_DAYS) || 3;
        const expirationDate = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);

        const description = productName ||
            (orderNumber ? `Pedido ${orderNumber} - Dekoor` : 'Pago Dekoor');

        const paymentPayload = {
            transaction_amount: Math.round(monto * 100) / 100,
            description,
            payment_method_id: 'oxxo',
            external_reference: externalReference,
            date_of_expiration: expirationDate.toISOString().replace('Z', '-06:00'),
            notification_url: `${BASE_URL}/api/mercadopago/webhook`,
            payer: {
                email: OXXO_GENERIC_EMAIL,
                first_name: firstName,
                last_name: lastName,
                identification: { type: 'RFC', number: 'XAXX010101000' }
            },
            metadata: {
                source: 'crm_oxxo_manual',
                order_number: orderNumber || '',
                customer_phone: phone,
                customer_name: cleanName,
                note: note || ''
            }
        };

        console.log(`[MP OXXO] Generando referencia $${monto} para ${cleanName} (${phone}) pedido=${orderNumber || 'N/A'}`);

        // Idempotency-Key obligatoria para /v1/payments
        const idempotencyKey = crypto.randomUUID();

        const response = await axios.post(`${MP_API}/v1/payments`, paymentPayload, {
            headers: {
                ...mpHeaders(),
                'X-Idempotency-Key': idempotencyKey
            }
        });

        const pago = response.data;

        // Extrae datos del voucher OXXO
        const voucherUrl = pago?.transaction_details?.external_resource_url || null;
        const barcodeContent = pago?.barcode?.content || null;

        // Genera imagen tipo "ticket" con codigo de barras y subela a Storage
        const ticketImageUrl = await generateOxxoTicketImage({
            barcodeContent,
            amount: monto,
            customerName: cleanName,
            expirationDate,
            orderNumber
        });

        // Guarda en mp_orders para que el webhook pueda hacer match
        await db.collection('mp_orders').doc(externalReference).set({
            externalReference,
            paymentId: pago.id,
            paymentMethod: 'oxxo',
            paymentType: 'ticket',
            customerName: cleanName,
            customerPhone: phone,
            customerEmail: OXXO_GENERIC_EMAIL,
            productName: description,
            qty: 1,
            subtotal: monto,
            shippingCost: 0,
            total: monto,
            address: null,
            status: pago.status || 'pending',
            source: 'crm_oxxo_manual',
            crmOrderNumber: orderNumber || null,
            voucherUrl,
            barcodeContent,
            ticketImageUrl,
            expirationDate,
            note: note || '',
            createdAt: new Date()
        });

        // Si viene de un pedido del CRM, lo marcamos para verlo en el pedido
        if (orderNumber) {
            await db.collection('pedidos').doc(orderNumber).set({
                oxxo: {
                    paymentId: pago.id,
                    externalReference,
                    voucherUrl,
                    barcodeContent,
                    ticketImageUrl,
                    amount: monto,
                    status: pago.status || 'pending',
                    createdAt: new Date(),
                    expirationDate
                }
            }, { merge: true }).catch(err => {
                console.warn('[MP OXXO] No se pudo actualizar pedido', orderNumber, err.message);
            });
        }

        res.json({
            paymentId: pago.id,
            externalReference,
            status: pago.status,
            voucherUrl,
            barcodeContent,
            ticketImageUrl,
            amount: monto,
            expirationDate: expirationDate.toISOString()
        });

    } catch (error) {
        console.error('[MP OXXO] Error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Error al generar referencia OXXO',
            details: error.response?.data || error.message
        });
    }
});

// Verifica la firma HMAC del webhook segun el protocolo de Mercado Pago.
// Docs: https://www.mercadopago.com.mx/developers/es/docs/your-integrations/notifications/webhooks
function verifyMpSignature(req) {
    if (!MP_WEBHOOK_SECRET) {
        // Si no hay secret configurado, no podemos validar — log y dejar pasar.
        // En produccion DEBE estar seteado.
        console.warn('[MP WEBHOOK] MP_WEBHOOK_SECRET no configurado, omitiendo validacion de firma');
        return true;
    }

    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];
    if (!xSignature || !xRequestId) {
        console.error('[MP WEBHOOK] Headers x-signature o x-request-id ausentes');
        return false;
    }

    // x-signature tiene formato: "ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839"
    const parts = String(xSignature).split(',').reduce((acc, p) => {
        const [k, v] = p.split('=').map(s => s && s.trim());
        if (k && v) acc[k] = v;
        return acc;
    }, {});

    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1) {
        console.error('[MP WEBHOOK] x-signature mal formado');
        return false;
    }

    // El "data.id" puede venir en query (?data.id=) o en el body
    const dataId = (req.query && (req.query['data.id'] || req.query.id)) ||
                   (req.body && req.body.data && req.body.data.id) || '';
    if (!dataId) {
        console.error('[MP WEBHOOK] No se encontro data.id para validar firma');
        return false;
    }

    // Manifest exacto que MP firma: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const expected = crypto
        .createHmac('sha256', MP_WEBHOOK_SECRET)
        .update(manifest)
        .digest('hex');

    try {
        const a = Buffer.from(expected, 'hex');
        const b = Buffer.from(v1, 'hex');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

// POST /api/mercadopago/webhook — Receive Mercado Pago payment notifications
router.post('/webhook', async (req, res) => {
    // Validar firma ANTES de procesar para evitar abuso
    if (!verifyMpSignature(req)) {
        console.error('[MP WEBHOOK] Firma invalida, rechazando');
        return res.status(401).send('invalid signature');
    }

    // Responder 200 rapido a MP, procesamos en background
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
            await db.collection('mp_webhook_errors').add({
                reason: 'no_external_reference',
                paymentId,
                payment,
                createdAt: new Date()
            }).catch(() => {});
            return;
        }

        const mpRef = db.collection('mp_orders').doc(externalReference);
        const mpDoc = await mpRef.get();

        if (!mpDoc.exists) {
            console.error(`[MP WEBHOOK] Order ${externalReference} not found in Firestore`);
            await db.collection('mp_webhook_errors').add({
                reason: 'order_not_found',
                externalReference,
                paymentId,
                status,
                amount: payment.transaction_amount || null,
                payerEmail: payment.payer?.email || null,
                createdAt: new Date()
            }).catch(() => {});
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

        // Si es un OXXO generado manualmente desde el CRM, NO creamos un pedido nuevo
        // (ya existe en la coleccion pedidos). Solo actualizamos el pedido y alertamos
        // al admin de que el pago se acredito.
        if (mpData.source === 'crm_oxxo_manual') {
            console.log(`[MP WEBHOOK] OXXO manual del CRM acreditado: ${externalReference} (pedido ${mpData.crmOrderNumber || 'N/A'})`);

            // Actualizar el pedido del CRM con el estatus "Pagado"
            if (mpData.crmOrderNumber) {
                await db.collection('pedidos').doc(mpData.crmOrderNumber).set({
                    'oxxo.status': 'approved',
                    'oxxo.paidAt': new Date(),
                    pagoOxxoAcreditado: true,
                    pagoOxxoFecha: new Date()
                }, { merge: true }).catch(err => {
                    console.warn('[MP WEBHOOK] No se pudo actualizar pedido CRM:', err.message);
                });
            }

            // Alerta al admin via WhatsApp
            await notifyAdminOxxoApproved({
                amount: mpData.total,
                customerName: mpData.customerName,
                customerPhone: mpData.customerPhone,
                orderNumber: mpData.crmOrderNumber,
                paymentId
            }).catch(err => console.error('[MP WEBHOOK] Error alertando admin:', err.message));

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
            mpExternalReference: externalReference,
            // Datos para pre-llenar el formulario de guia J&T
            envioPrefill: {
                nombreCompleto: mpData.customerName || '',
                telefono: mpData.customerPhone || '',
                email: mpData.customerEmail || '',
                direccion: addr.street || '',
                colonia: addr.colonia || '',
                ciudad: addr.city || '',
                estado: addr.state || '',
                codigoPostal: addr.zip || '',
                metodoEnvio: (mpData.shippingMethod || '').includes('DHL') ? 'dhl' : 'jt',
                source: 'web_checkout_mp'
            }
        };

        await db.collection('pedidos').doc(orderNumber).set(pedido);
        await mpRef.update({ internalOrderNumber: orderNumber });

        // Marcar carrito abandonado como convertido (si existe)
        markCartConverted(mpData.customerPhone, orderNumber).catch(() => {});

        console.log(`[MP WEBHOOK] Order ${orderNumber} created from payment ${paymentId}`);

        // Alerta al admin via WhatsApp (incluye pagos OXXO/SPEI/tarjeta del checkout publico)
        await notifyAdminOxxoApproved({
            amount: mpData.total,
            customerName: mpData.customerName,
            customerPhone: mpData.customerPhone,
            orderNumber,
            paymentId,
            paymentMethod: payment.payment_method_id
        }).catch(err => console.error('[MP WEBHOOK] Error alertando admin:', err.message));

    } catch (error) {
        console.error('[MP WEBHOOK] Error:', error.response?.data || error.message);
        await db.collection('mp_webhook_errors').add({
            reason: 'unhandled_exception',
            error: error.message || String(error),
            details: error.response?.data || null,
            stack: error.stack || null,
            createdAt: new Date()
        }).catch(() => {});
    }
});

// =====================================================================
// Envia una alerta por WhatsApp al admin cuando un pago se acredita.
// Usa sendAdvancedWhatsAppMessage del services.js (require lazy para
// evitar dependencias circulares en el arranque).
// =====================================================================
async function notifyAdminOxxoApproved({ amount, customerName, customerPhone, orderNumber, paymentId, paymentMethod }) {
    try {
        const { sendAdvancedWhatsAppMessage } = require('../services');
        const metodoLabel = paymentMethod
            ? (paymentMethod === 'oxxo' ? 'OXXO' :
               paymentMethod === 'pse' || paymentMethod === 'spei' ? 'SPEI' :
               paymentMethod.toUpperCase())
            : 'OXXO';

        const lineas = [
            `💰 *Pago ${metodoLabel} acreditado*`,
            ``,
            `*Cliente:* ${customerName || 'Sin nombre'}`,
            customerPhone ? `*Tel:* ${customerPhone}` : '',
            orderNumber ? `*Pedido:* ${orderNumber}` : '',
            `*Monto:* $${Number(amount).toLocaleString('es-MX')} MXN`,
            `*MP ID:* ${paymentId}`,
            ``,
            `Ya puedes preparar el pedido. ✅`
        ].filter(Boolean);

        const text = lineas.join('\n');
        await sendAdvancedWhatsAppMessage(ADMIN_ALERT_PHONE, { text });
        console.log(`[MP WEBHOOK] Alerta enviada al admin (${ADMIN_ALERT_PHONE}) por pago ${paymentId}`);
    } catch (error) {
        console.error('[MP WEBHOOK] No se pudo enviar alerta al admin:', error.message);
    }
}

// POST /api/mercadopago/oxxo/send-to-customer
// Envia la imagen del ticket OXXO al WhatsApp del cliente directamente,
// con un caption corto. Usa sendAdvancedWhatsAppMessage del services.
router.post('/oxxo/send-to-customer', async (req, res) => {
    try {
        const { externalReference, customerPhone } = req.body;
        if (!externalReference) return res.status(400).json({ error: 'externalReference requerido' });

        const doc = await db.collection('mp_orders').doc(externalReference).get();
        if (!doc.exists) return res.status(404).json({ error: 'Orden no encontrada' });

        const o = doc.data();
        const phone = (customerPhone || o.customerPhone || '').replace(/\D/g, '');
        if (!phone) return res.status(400).json({ error: 'Telefono del cliente no disponible' });

        if (!o.ticketImageUrl) {
            return res.status(400).json({ error: 'Esta orden no tiene imagen del ticket. Vuelve a generarla.' });
        }

        const venceTxt = o.expirationDate
            ? new Date(o.expirationDate.toDate ? o.expirationDate.toDate() : o.expirationDate)
                .toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
            : '';

        const firstName = (o.customerName || '').split(' ')[0];
        const caption = [
            `Hola${firstName ? ' ' + firstName : ''}, aquí está tu referencia para pagar en OXXO 🏪`,
            `Monto: $${Number(o.total).toLocaleString('es-MX')} MXN${venceTxt ? ' · Vence ' + venceTxt : ''}`,
            `Muestra esta imagen en caja. Te aviso cuando se acredite. ¡Gracias!`
        ].join('\n');

        const { sendAdvancedWhatsAppMessage } = require('../services');
        await sendAdvancedWhatsAppMessage(phone, {
            text: caption,
            fileUrl: o.ticketImageUrl,
            fileType: 'image/png'
        });

        // Tambien guardar el mensaje en la coleccion de mensajes del contacto
        // (sendAdvancedWhatsAppMessage solo manda a Meta; aqui lo guardamos para
        // que aparezca en el chat del CRM de inmediato)
        try {
            await db.collection('contacts_whatsapp').doc(phone).collection('messages').add({
                from_me: true,
                text: caption,
                fileUrl: o.ticketImageUrl,
                fileType: 'image/png',
                type: 'image',
                timestamp: new Date(),
                status: 'sent',
                origin: 'crm_oxxo'
            });
            await db.collection('contacts_whatsapp').doc(phone).set({
                lastMessage: '🏪 Referencia OXXO enviada',
                lastMessageTimestamp: new Date()
            }, { merge: true });
        } catch (e) {
            console.warn('[OXXO SEND] No se pudo guardar mensaje en CRM:', e.message);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[OXXO SEND] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/mercadopago/contact-latest-order/:contactId
// Devuelve el ultimo pedido (mayor consecutiveOrderNumber) del contacto y
// si ya tiene una referencia OXXO activa. Lo usa el panel del CRM para
// pre-llenar el modal de generacion de OXXO.
router.get('/contact-latest-order/:contactId', async (req, res) => {
    try {
        const { contactId } = req.params;
        const snap = await db.collection('pedidos')
            .where('telefono', '==', contactId)
            .get();

        if (snap.empty) return res.json({ found: false });

        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(o => o.consecutiveOrderNumber)
            .sort((a, b) => (b.consecutiveOrderNumber || 0) - (a.consecutiveOrderNumber || 0));

        if (orders.length === 0) return res.json({ found: false });

        const o = orders[0];
        res.json({
            found: true,
            orderNumber: `DH${o.consecutiveOrderNumber}`,
            consecutiveOrderNumber: o.consecutiveOrderNumber,
            productName: o.producto || '',
            precio: Number(o.precio) || 0,
            telefono: o.telefono || contactId,
            oxxo: o.oxxo || null,
            estatus: o.estatus || null
        });
    } catch (error) {
        console.error('[MP] contact-latest-order error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/mercadopago/oxxo/list — Lista de OXXO (admin panel)
router.get('/oxxo/list', async (req, res) => {
    try {
        const status = req.query.status; // 'pending' | 'approved' | undefined
        let q = db.collection('mp_orders').where('source', '==', 'crm_oxxo_manual');
        if (status) q = q.where('status', '==', status);
        const snap = await q.orderBy('createdAt', 'desc').limit(100).get();
        const items = snap.docs.map(d => {
            const v = d.data();
            return {
                externalReference: v.externalReference,
                paymentId: v.paymentId,
                status: v.status,
                customerName: v.customerName,
                customerPhone: v.customerPhone,
                total: v.total,
                voucherUrl: v.voucherUrl,
                barcodeContent: v.barcodeContent,
                crmOrderNumber: v.crmOrderNumber,
                productName: v.productName,
                note: v.note,
                createdAt: v.createdAt,
                paidAt: v.paidAt || null,
                expirationDate: v.expirationDate || null
            };
        });
        res.json({ items });
    } catch (error) {
        console.error('[MP OXXO LIST] Error:', error.message);
        res.status(500).json({ error: error.message });
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
