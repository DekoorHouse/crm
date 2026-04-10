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

        // 1. Guardar datos de envío
        await db.collection('datos_envio').add({
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

        // 2. Crear guía J&T
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

        // 3. Enviar WhatsApp al cliente
        const trackUrl = `https://app.dekoormx.com/jt-rastreo/?waybill=${result.waybillNo}`;
        const waMessage = `Hola ${nombreCompleto.split(' ')[0]}! 📦\n\n`
            + `Tu guia de envio para el pedido *${numeroPedido}* ha sido creada.\n\n`
            + `📋 *No. de guia:* ${result.waybillNo}\n`
            + `🚚 *Paqueteria:* J&T Express\n\n`
            + `Puedes rastrear tu envio aqui:\n${trackUrl}\n\n`
            + `Gracias por tu compra! 🧡`;

        try {
            const { sendAdvancedWhatsAppMessage } = require('../services');
            const waId = '52' + telefono; // Agregar código de país México
            await sendAdvancedWhatsAppMessage(waId, { text: waMessage });
            console.log(`[J&T] WhatsApp enviado a ${waId} para pedido ${numeroPedido}`);
        } catch (waErr) {
            console.warn(`[J&T] No se pudo enviar WhatsApp a ${telefono}:`, waErr.message);
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
