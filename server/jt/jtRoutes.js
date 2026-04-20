const express = require('express');
const router = express.Router();
const { db } = require('../config');
const jtService = require('./jtService');

// GET /api/jt-guias/status — Verificar si J&T está configurado
router.get('/status', (req, res) => {
    res.json({ configured: jtService.isConfigured() });
});

// GET /api/jt-guias/diagnostic — Verificar qué variables tiene cargadas el server (enmascaradas)
router.get('/diagnostic', (req, res) => {
    const mask = (val) => {
        if (!val) return null;
        if (val.length <= 4) return '***';
        return val.substring(0, 4) + '***' + val.substring(val.length - 2);
    };
    res.json({
        configured: jtService.isConfigured(),
        env: {
            JT_API_ACCOUNT: mask(process.env.JT_API_ACCOUNT),
            JT_PRIVATE_KEY: mask(process.env.JT_PRIVATE_KEY),
            JT_CUSTOMER_CODE: mask(process.env.JT_CUSTOMER_CODE),
            JT_PASSWORD: mask(process.env.JT_PASSWORD),
            JT_SENDER_ADDRESS: process.env.JT_SENDER_ADDRESS || null,
            JT_USE_TEST: process.env.JT_USE_TEST || null,
            JT_SENDER_NAME: process.env.JT_SENDER_NAME || '(default: Dekoor MX)',
            JT_SENDER_PHONE: process.env.JT_SENDER_PHONE || '(default: 6181333519)',
            JT_SENDER_STATE: process.env.JT_SENDER_STATE || '(default: Durango)',
            JT_SENDER_CITY: process.env.JT_SENDER_CITY || '(default: Durango)',
            JT_SENDER_AREA: process.env.JT_SENDER_AREA || '(default: Durango)',
            JT_SENDER_ZIP: process.env.JT_SENDER_ZIP || '(default: 34000)',
        },
        targetUrl: process.env.JT_USE_TEST === 'true'
            ? 'https://demoopenapi.jtjms-mx.com/webopenplatformapi/api'
            : 'https://openapi.jtjms-mx.com/webopenplatformapi/api',
    });
});

// POST /api/jt-guias/crear — Crear guía de envío J&T
router.post('/crear', async (req, res) => {
    try {
        const {
            orderNumber, receiverName, receiverPhone,
            street, colonia, city, state, zip,
            reference, productName, weight, quantity, itemValue
        } = req.body;

        // Validaciones
        if (!orderNumber || !receiverName || !receiverPhone || !street || !colonia || !city || !state || !zip) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
        }

        if (!/^\d{10}$/.test(receiverPhone)) {
            return res.status(400).json({ success: false, message: 'El teléfono debe tener 10 dígitos.' });
        }

        if (!/^\d{5}$/.test(zip)) {
            return res.status(400).json({ success: false, message: 'El código postal debe tener 5 dígitos.' });
        }

        // Verificar que no exista ya una guía para este pedido
        const existingSnap = await db.collection('guias_jt')
            .where('orderNumber', '==', orderNumber)
            .where('status', '!=', 'cancelled')
            .limit(1)
            .get();

        if (!existingSnap.empty) {
            const existing = existingSnap.docs[0].data();
            return res.status(409).json({
                success: false,
                message: `Ya existe una guía para el pedido ${orderNumber}: ${existing.waybillNo}`,
                waybillNo: existing.waybillNo,
            });
        }

        // Crear guía en J&T
        const result = await jtService.createOrder({
            orderNumber, receiverName, receiverPhone,
            street, colonia, city, state, zip,
            reference, productName, weight, quantity, itemValue
        });

        if (result.success) {
            // Guardar en Firestore
            await db.collection('guias_jt').add({
                orderNumber,
                waybillNo: result.waybillNo,
                receiverName,
                receiverPhone,
                address: `${street}, ${colonia}, ${city}, ${state} C.P. ${zip}`,
                reference: reference || '',
                productName: productName || 'Lámpara 3D Personalizada',
                status: 'created',
                createdAt: new Date(),
            });

            // Actualizar el pedido si existe
            try {
                const pedidoRef = db.collection('pedidos').doc(orderNumber);
                const pedidoDoc = await pedidoRef.get();
                if (pedidoDoc.exists) {
                    await pedidoRef.update({
                        guiaJT: result.waybillNo,
                        guiaCreatedAt: new Date(),
                    });
                }
            } catch (e) {
                console.warn(`[J&T] No se pudo actualizar pedido ${orderNumber}:`, e.message);
            }

            console.log(`[J&T] Guía creada: ${result.waybillNo} para pedido ${orderNumber}`);
        }

        res.status(result.success ? 201 : 400).json(result);

    } catch (error) {
        console.error('[J&T] Error creando guía:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno al crear la guía de J&T.',
            error: error.message,
        });
    }
});

// GET /api/jt-guias — Listar guías creadas
router.get('/', async (req, res) => {
    try {
        const snapshot = await db.collection('guias_jt').orderBy('createdAt', 'desc').get();
        const guias = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json({ success: true, data: guias });
    } catch (error) {
        console.error('[J&T] Error listando guías:', error.message);
        res.status(500).json({ success: false, message: 'Error al obtener las guías.' });
    }
});

// DELETE /api/jt-guias/:id — Cancelar/eliminar guía
router.delete('/:id', async (req, res) => {
    try {
        const docRef = db.collection('guias_jt').doc(req.params.id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Guía no encontrada.' });
        }

        const guia = doc.data();

        // Intentar cancelar en J&T
        try {
            await jtService.cancelOrder(guia.orderNumber);
        } catch (e) {
            console.warn(`[J&T] No se pudo cancelar en J&T (${guia.orderNumber}):`, e.message);
        }

        await docRef.update({ status: 'cancelled', cancelledAt: new Date() });
        res.json({ success: true, message: 'Guía cancelada.' });
    } catch (error) {
        console.error('[J&T] Error cancelando guía:', error.message);
        res.status(500).json({ success: false, message: 'Error al cancelar la guía.' });
    }
});

// POST /api/jt-guias/desde-pedido/:orderNumber — Crear guía desde datos de un pedido existente
router.post('/desde-pedido/:orderNumber', async (req, res) => {
    try {
        const { orderNumber } = req.params;

        // Buscar datos de envío del pedido
        const envioSnap = await db.collection('datos_envio')
            .where('numeroPedido', '==', orderNumber)
            .limit(1)
            .get();

        if (envioSnap.empty) {
            return res.status(404).json({
                success: false,
                message: `No se encontraron datos de envío para el pedido ${orderNumber}.`,
            });
        }

        const envio = envioSnap.docs[0].data();

        // Buscar info del pedido para nombre del producto
        let productName = 'Lámpara 3D Personalizada';
        try {
            const pedidoDoc = await db.collection('pedidos').doc(orderNumber).get();
            if (pedidoDoc.exists) {
                productName = pedidoDoc.data().producto || productName;
            }
        } catch (e) { /* usar default */ }

        // Crear guía con los datos encontrados
        const result = await jtService.createOrder({
            orderNumber,
            receiverName: envio.nombreCompleto,
            receiverPhone: envio.telefono,
            street: envio.direccion,
            colonia: envio.colonia,
            city: envio.ciudad,
            state: envio.estado,
            zip: envio.codigoPostal,
            reference: envio.referencia || '',
            productName,
        });

        if (result.success) {
            await db.collection('guias_jt').add({
                orderNumber,
                waybillNo: result.waybillNo,
                receiverName: envio.nombreCompleto,
                receiverPhone: envio.telefono,
                address: `${envio.direccion}, ${envio.colonia}, ${envio.ciudad}, ${envio.estado} C.P. ${envio.codigoPostal}`,
                reference: envio.referencia || '',
                productName,
                status: 'created',
                createdAt: new Date(),
            });

            try {
                await db.collection('pedidos').doc(orderNumber).update({
                    guiaJT: result.waybillNo,
                    guiaCreatedAt: new Date(),
                });
            } catch (e) { /* ignore */ }
        }

        res.status(result.success ? 201 : 400).json(result);

    } catch (error) {
        console.error('[J&T] Error creando guía desde pedido:', error.message);
        res.status(500).json({ success: false, message: 'Error al crear la guía.', error: error.message });
    }
});

// POST /api/jt-guias/cancelar-por-contacto/:contactId — Cancela la guía activa del último pedido del contacto
router.post('/cancelar-por-contacto/:contactId', async (req, res) => {
    try {
        const { contactId } = req.params;

        // 1. Buscar el último pedido del contacto
        const ordersSnap = await db.collection('pedidos')
            .where('telefono', '==', contactId)
            .get();

        if (ordersSnap.empty) {
            return res.status(404).json({ success: false, message: 'Este contacto no tiene pedidos registrados.' });
        }

        const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(o => o.consecutiveOrderNumber)
            .sort((a, b) => (b.consecutiveOrderNumber || 0) - (a.consecutiveOrderNumber || 0));

        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: 'Este contacto no tiene pedidos con número.' });
        }

        const orderNumber = `DH${orders[0].consecutiveOrderNumber}`;

        // 2. Buscar guía activa para ese pedido
        const guiaSnap = await db.collection('guias_jt')
            .where('orderNumber', '==', orderNumber)
            .where('status', '!=', 'cancelled')
            .get();

        if (guiaSnap.empty) {
            return res.status(404).json({ success: false, message: `No hay guía activa para el pedido ${orderNumber}.` });
        }

        const docRef = guiaSnap.docs[0].ref;
        const guia = guiaSnap.docs[0].data();

        // 3. Intentar cancelar en J&T
        try {
            await jtService.cancelOrder(guia.orderNumber);
        } catch (e) {
            console.warn(`[J&T] No se pudo cancelar en J&T (${guia.orderNumber}):`, e.message);
        }

        await docRef.update({ status: 'cancelled', cancelledAt: new Date() });

        res.json({ success: true, orderNumber, message: `Guía del pedido ${orderNumber} cancelada.` });
    } catch (error) {
        console.error('[J&T] Error en cancelar-por-contacto:', error);
        res.status(500).json({ success: false, message: 'Error al cancelar la guía.', error: error.message });
    }
});

// POST /api/jt-guias/pedir-datos/:contactId — Envía respuesta rápida "Datos J&T" al cliente
router.post('/pedir-datos/:contactId', async (req, res) => {
    try {
        const { contactId } = req.params;
        const { shortcut = 'datos' } = req.body || {};

        // 1. Buscar el último pedido del contacto
        const ordersSnap = await db.collection('pedidos')
            .where('telefono', '==', contactId)
            .get();

        if (ordersSnap.empty) {
            return res.status(404).json({
                success: false,
                message: 'Este contacto no tiene pedidos registrados.',
            });
        }

        const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(o => o.consecutiveOrderNumber)
            .sort((a, b) => (b.consecutiveOrderNumber || 0) - (a.consecutiveOrderNumber || 0));

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Este contacto no tiene pedidos con número.',
            });
        }

        const lastOrder = orders[0];
        const orderNumber = `DH${lastOrder.consecutiveOrderNumber}`;

        // 2. Buscar la respuesta rápida "Datos J&T"
        const allQrs = await db.collection('quick_replies').get();
        const target = shortcut.toLowerCase();
        // Primero intentar match exacto (case-insensitive)
        let found = allQrs.docs.find(d =>
            (d.data().shortcut || '').toLowerCase() === target
        );
        // Fallback: buscar shortcut que contenga "datos" Y "j&t"
        if (!found) {
            found = allQrs.docs.find(d => {
                const sc = (d.data().shortcut || '').toLowerCase();
                return sc.includes('datos') && sc.includes('j&t');
            });
        }
        if (!found) {
            return res.status(404).json({
                success: false,
                message: 'No se encontró la respuesta rápida "Datos J&T". Créala primero.',
            });
        }
        const qr = found.data();

        // 3. Reemplazar ** con el número de pedido en el mensaje
        let messageText = qr.message || '';
        messageText = messageText.replace(/\*\*/g, orderNumber);
        // Auto-inyectar el pedido en URLs /datos-envio/ para que el formulario lo auto-llene
        // y el cliente no pueda equivocarse tecleando el número.
        messageText = messageText.replace(
            /(https?:\/\/[^\/\s]+\/datos-envio)\/?(?=\s|$)/gi,
            `$1/${orderNumber}`
        );

        // 4. Enviar el mensaje usando sendAdvancedWhatsAppMessage
        const { sendAdvancedWhatsAppMessage } = require('../services');
        const sentData = await sendAdvancedWhatsAppMessage(contactId, {
            text: messageText,
            fileUrl: qr.fileUrl || null,
            fileType: qr.fileType || null,
        });

        // 5. Guardar en Firestore
        const admin = require('firebase-admin');
        const messageToSave = {
            from: process.env.PHONE_NUMBER_ID,
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            id: sentData?.id || null,
            text: messageText,
        };
        if (qr.fileUrl) messageToSave.fileUrl = qr.fileUrl;
        if (qr.fileType) messageToSave.fileType = qr.fileType;

        await db.collection('contacts_whatsapp').doc(contactId)
            .collection('messages').add(messageToSave);

        await db.collection('contacts_whatsapp').doc(contactId).update({
            lastMessage: messageText.substring(0, 100),
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            unreadCount: 0,
        });

        res.json({
            success: true,
            orderNumber,
            message: 'Solicitud de datos enviada correctamente.',
        });
    } catch (error) {
        console.error('[J&T] Error en pedir-datos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al enviar la solicitud de datos.',
            error: error.message,
        });
    }
});

// GET /api/jt-guias/verificar-pedido/:orderNumber — Verifica pedido y devuelve teléfono
router.get('/verificar-pedido/:orderNumber', async (req, res) => {
    try {
        const { orderNumber } = req.params;

        // Validar formato DH***
        if (!/^DH\d+$/i.test(orderNumber)) {
            return res.status(400).json({
                success: false,
                code: 'FORMATO_INVALIDO',
                message: 'El número de pedido debe comenzar con DH seguido de números (ej: DH1042).',
            });
        }

        // Verificar si ya existe guía para este pedido
        const guiaSnap = await db.collection('guias_jt')
            .where('orderNumber', '==', orderNumber)
            .where('status', '!=', 'cancelled')
            .limit(1)
            .get();

        if (!guiaSnap.empty) {
            const existing = guiaSnap.docs[0].data();
            return res.status(409).json({
                success: false,
                code: 'GUIA_EXISTENTE',
                message: `Ya existe una guía de envío para el pedido ${orderNumber}. Si necesitas ayuda, contactanos por WhatsApp.`,
                waybillNo: existing.waybillNo,
            });
        }

        // Verificar si ya existen datos de envío registrados (evita duplicados del formulario)
        const datosSnap = await db.collection('datos_envio')
            .where('numeroPedido', '==', orderNumber)
            .limit(1)
            .get();

        if (!datosSnap.empty) {
            return res.status(409).json({
                success: false,
                code: 'DATOS_YA_ENVIADOS',
                message: `Ya recibimos tus datos de envío para el pedido ${orderNumber}. Si necesitas hacer un cambio, contáctanos por WhatsApp.`,
            });
        }

        // Buscar el pedido y su teléfono
        // Los pedidos tienen consecutiveOrderNumber como número (ej: 10952)
        let telefono = null;
        const orderNumInt = parseInt(orderNumber.replace(/^DH/i, ''), 10);

        if (!isNaN(orderNumInt)) {
            const byField = await db.collection('pedidos')
                .where('consecutiveOrderNumber', '==', orderNumInt)
                .limit(1)
                .get();
            if (!byField.empty) {
                telefono = byField.docs[0].data().telefono || null;
            }
        }

        // Fallback: buscar por doc ID
        if (!telefono) {
            const pedidoDoc = await db.collection('pedidos').doc(orderNumber).get();
            if (pedidoDoc.exists) {
                telefono = pedidoDoc.data().telefono || null;
            }
        }

        if (!telefono) {
            return res.status(404).json({
                success: false,
                code: 'PEDIDO_NO_ENCONTRADO',
                message: `No encontramos el pedido ${orderNumber}. Verifica que sea correcto o contactanos por WhatsApp.`,
            });
        }

        // Enmascarar el teléfono para confirmación (mostrar solo últimos 4 dígitos)
        const telefonoLimpio = String(telefono).replace(/\D/g, '').slice(-10);
        const telefonoMasked = telefonoLimpio.length >= 4
            ? `******${telefonoLimpio.slice(-4)}`
            : '****';

        res.json({
            success: true,
            orderNumber,
            telefonoMasked,
            telefonoCompleto: telefonoLimpio,
        });
    } catch (error) {
        console.error('[J&T] Error verificando pedido:', error.message);
        res.status(500).json({ success: false, message: 'Error al verificar el pedido.', error: error.message });
    }
});

// POST /api/jt-guias/cliente — Flujo completo: guardar datos + crear guía + WhatsApp
router.post('/cliente', async (req, res) => {
    try {
        const {
            numeroPedido, nombreCompleto, telefono,
            direccion, colonia, ciudad, estado, codigoPostal, referencia
        } = req.body;

        // Validaciones
        if (!numeroPedido || !nombreCompleto || !telefono || !direccion || !colonia || !ciudad || !estado || !codigoPostal) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
        }
        if (!/^\d{10}$/.test(telefono)) {
            return res.status(400).json({ success: false, message: 'El telefono debe tener 10 digitos.' });
        }
        if (!/^\d{5}$/.test(codigoPostal)) {
            return res.status(400).json({ success: false, message: 'El codigo postal debe tener 5 digitos.' });
        }

        // Validar formato del número de pedido (DH seguido de números)
        if (!/^DH\d+$/i.test(numeroPedido)) {
            return res.status(400).json({
                success: false,
                message: 'El número de pedido debe comenzar con DH seguido de números (ej: DH1042).',
            });
        }

        // Validar que no exista ya una guía activa para este pedido
        const existingSnap = await db.collection('guias_jt')
            .where('orderNumber', '==', numeroPedido)
            .where('status', '!=', 'cancelled')
            .limit(1)
            .get();

        if (!existingSnap.empty) {
            const existing = existingSnap.docs[0].data();
            return res.status(409).json({
                success: false,
                code: 'GUIA_EXISTENTE',
                message: `Ya existe una guía de envío para el pedido ${numeroPedido}. Si necesitas ayuda, contactanos por WhatsApp.`,
                waybillNo: existing.waybillNo,
            });
        }

        // Validar que no existan ya datos de envío registrados para este pedido (duplicados)
        const existingDatosSnap = await db.collection('datos_envio')
            .where('numeroPedido', '==', numeroPedido)
            .limit(1)
            .get();

        if (!existingDatosSnap.empty) {
            return res.status(409).json({
                success: false,
                code: 'DATOS_YA_ENVIADOS',
                message: `Ya recibimos tus datos de envío para el pedido ${numeroPedido}. Si necesitas hacer un cambio, contáctanos por WhatsApp.`,
            });
        }

        // 1. Guardar datos de envío — usar numeroPedido como doc ID para garantizar unicidad atómica
        try {
            await db.collection('datos_envio').doc(numeroPedido).create({
                numeroPedido,
                nombreCompleto,
                telefono,
                direccion,
                colonia,
                ciudad,
                estado,
                codigoPostal,
                referencia: referencia || '',
                createdAt: new Date(),
                source: 'cliente',
            });
        } catch (err) {
            // Firestore ALREADY_EXISTS (code 6) — protección contra race conditions
            if (err.code === 6 || /already exists/i.test(err.message || '')) {
                return res.status(409).json({
                    success: false,
                    code: 'DATOS_YA_ENVIADOS',
                    message: `Ya recibimos tus datos de envío para el pedido ${numeroPedido}. Si necesitas hacer un cambio, contáctanos por WhatsApp.`,
                });
            }
            throw err;
        }

        // 2. Crear guía J&T (peso fijo 1kg, remark = número de pedido)
        const result = await jtService.createOrder({
            orderNumber: numeroPedido,
            receiverName: nombreCompleto,
            receiverPhone: telefono,
            street: direccion,
            colonia,
            city: ciudad,
            state: estado,
            zip: codigoPostal,
            reference: referencia || '',
            weight: 1,
            remark: `Pedido ${numeroPedido}`,
        });

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message || 'Error al crear la guia en J&T.',
                datosGuardados: true,
            });
        }

        // Guardar guía en Firestore
        await db.collection('guias_jt').add({
            orderNumber: numeroPedido,
            waybillNo: result.waybillNo,
            receiverName: nombreCompleto,
            receiverPhone: telefono,
            address: `${direccion}, ${colonia}, ${ciudad}, ${estado} C.P. ${codigoPostal}`,
            reference: referencia || '',
            status: 'created',
            createdAt: new Date(),
        });

        // Actualizar pedido si existe
        try {
            const pedidoRef = db.collection('pedidos').doc(numeroPedido);
            const pedidoDoc = await pedidoRef.get();
            if (pedidoDoc.exists) {
                await pedidoRef.update({ guiaJT: result.waybillNo, guiaCreatedAt: new Date() });
            }
        } catch (e) { /* ignore */ }

        // 3. Enviar WhatsApp al cliente (plantilla guia_envio_creada)
        try {
            const axios = require('axios');
            const waId = '52' + telefono;
            const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
            const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

            const templatePayload = {
                messaging_product: 'whatsapp',
                to: waId,
                type: 'template',
                template: {
                    name: 'guia_envio_creada',
                    language: { code: 'es_MX' },
                    components: [
                        {
                            type: 'body',
                            parameters: [
                                { type: 'text', text: nombreCompleto.split(' ')[0] },  // {{1}} nombre
                                { type: 'text', text: numeroPedido },                   // {{2}} pedido
                                { type: 'text', text: result.waybillNo },               // {{3}} guia
                            ],
                        },
                        {
                            type: 'button',
                            sub_type: 'url',
                            index: '0',
                            parameters: [
                                { type: 'text', text: result.waybillNo },  // {{1}} del URL dinámico
                            ],
                        },
                    ],
                },
            };

            const waResp = await axios.post(
                `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
                templatePayload,
                { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
            );
            const sentMessageId = waResp.data?.messages?.[0]?.id;

            // Registrar envio en el historial del chat del CRM
            try {
                const admin = require('firebase-admin');
                const firstName = (nombreCompleto || 'Cliente').split(' ')[0];
                const previewText =
                    `Hola ${firstName}! 📦\n\n` +
                    `Tu guía de envío para el pedido ${numeroPedido} ha sido creada.\n\n` +
                    `📋 No. de guía: ${result.waybillNo}\n` +
                    `🚚 Paquetería: J&T Express\n\n` +
                    `Puedes rastrear tu envío aquí:\n` +
                    `https://app.dekoormx.com/jt-rastreo/?waybill=${result.waybillNo}\n\n` +
                    `Gracias por tu compra! ❤️`;

                // Resolver id de contacto probando formatos MX 521XXX y 52XXX
                const digits = waId.replace(/\D/g, '');
                const last10 = digits.slice(-10);
                const candidates = ['521' + last10, '52' + last10, digits];
                let resolvedId = '521' + last10;
                const seen = new Set();
                for (const c of candidates) {
                    if (!c || seen.has(c)) continue;
                    seen.add(c);
                    try {
                        const doc = await db.collection('contacts_whatsapp').doc(c).get();
                        if (doc.exists) { resolvedId = c; break; }
                    } catch (_) { /* ignore */ }
                }

                const contactRef = db.collection('contacts_whatsapp').doc(resolvedId);
                const messageDoc = {
                    from: PHONE_NUMBER_ID,
                    status: 'sent',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    text: previewText,
                };
                if (sentMessageId) messageDoc.id = sentMessageId;
                await contactRef.collection('messages').doc().set(messageDoc);
                await contactRef.set({
                    lastMessage: previewText,
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
                console.log(`[J&T] Mensaje registrado en contacto ${resolvedId} para ${numeroPedido}`);
            } catch (logErr) {
                console.warn(`[J&T] No se pudo registrar plantilla en historial de chat:`, logErr.message);
            }

            console.log(`[J&T] WhatsApp plantilla enviada a ${waId} para pedido ${numeroPedido}`);
        } catch (waErr) {
            console.warn(`[J&T] No se pudo enviar WhatsApp a ${telefono}:`, waErr.response?.data || waErr.message);
        }

        res.status(201).json({
            success: true,
            waybillNo: result.waybillNo,
            orderId: numeroPedido,
            message: 'Guia creada y datos registrados exitosamente.',
        });

    } catch (error) {
        console.error('[J&T] Error en flujo cliente:', error.message);
        res.status(500).json({ success: false, message: 'Error al procesar tu solicitud.', error: error.message });
    }
});

module.exports = router;
