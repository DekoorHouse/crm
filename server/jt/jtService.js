const axios = require('axios');
const crypto = require('crypto');

// --- Configuración J&T Open Platform Mexico ---
const JT_API_BASE = 'https://openapi.jtjms-mx.com/webopenplatformapi/api';
const JT_API_BASE_TEST = 'https://demoopenapi.jtjms-mx.com/webopenplatformapi/api';
const JT_API_ACCOUNT = process.env.JT_API_ACCOUNT || '';
const JT_PRIVATE_KEY = process.env.JT_PRIVATE_KEY || '';
const JT_CUSTOMER_CODE = process.env.JT_CUSTOMER_CODE || '';
const JT_PASSWORD = process.env.JT_PASSWORD || '';  // Cleartext password del Open Platform
const JT_USE_TEST = process.env.JT_USE_TEST === 'true';

// Datos del remitente (Dekoor - Durango)
const SENDER_DEFAULTS = {
    name: process.env.JT_SENDER_NAME || 'Dekoor MX',
    phone: process.env.JT_SENDER_PHONE || '6181333519',
    prov: process.env.JT_SENDER_STATE || 'Durango',
    city: process.env.JT_SENDER_CITY || 'Durango',
    area: process.env.JT_SENDER_AREA || 'Durango',
    address: process.env.JT_SENDER_ADDRESS || '',
    postCode: process.env.JT_SENDER_ZIP || '34000',
};

/**
 * Genera el digest del Header:
 * base64(md5(bizContent_json_string + privateKey))
 */
function generateHeaderDigest(bizContentJson) {
    const raw = bizContentJson + JT_PRIVATE_KEY;
    const md5Bytes = crypto.createHash('md5').update(raw).digest();
    return md5Bytes.toString('base64');
}

/**
 * Genera el digest dentro del bizContent.
 * Según el manual oficial de J&T México:
 *   1. cyphertext = MD5(plaintext_password + "jadada236t2") → hex uppercase
 *   2. digest = Base64(MD5(customerCode + cyphertext + privateKey))
 */
function generateBizDigest() {
    // Paso 1: generar cyphertext del password
    const cyphertext = crypto.createHash('md5')
        .update(JT_PASSWORD + 'jadada236t2')
        .digest('hex')
        .toUpperCase();
    // Paso 2: digest = Base64(MD5(customerCode + cyphertext + privateKey))
    const raw = JT_CUSTOMER_CODE + cyphertext + JT_PRIVATE_KEY;
    const md5Bytes = crypto.createHash('md5').update(raw).digest();
    return md5Bytes.toString('base64');
}

/**
 * Envía una petición a la API de J&T.
 */
async function jtRequest(endpoint, bizContent) {
    const bizContentJson = JSON.stringify(bizContent);
    const headerDigest = generateHeaderDigest(bizContentJson);
    const baseUrl = JT_USE_TEST ? JT_API_BASE_TEST : JT_API_BASE;
    const fullUrl = `${baseUrl}${endpoint}`;

    console.log(`[J&T REQUEST] POST ${fullUrl}`);
    console.log(`[J&T REQUEST] Headers: apiAccount=${JT_API_ACCOUNT}, digest=${headerDigest}, timezone=GMT-6`);
    console.log(`[J&T REQUEST] bizContent: ${bizContentJson}`);

    try {
        const response = await axios.post(
            fullUrl,
            `bizContent=${encodeURIComponent(bizContentJson)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'apiAccount': JT_API_ACCOUNT,
                    'digest': headerDigest,
                    'timestamp': String(Date.now()),
                    'timezone': 'GMT-6',
                },
                timeout: 15000,
                validateStatus: () => true,  // Aceptar cualquier código HTTP para parsearlo
            }
        );

        console.log(`[J&T RESPONSE] Status: ${response.status}`);
        console.log(`[J&T RESPONSE] Body:`, JSON.stringify(response.data));

        return response.data;
    } catch (err) {
        console.error(`[J&T ERROR] ${err.message}`);
        if (err.response) {
            console.error(`[J&T ERROR] Status: ${err.response.status}, Body:`, JSON.stringify(err.response.data));
            return {
                code: '0',
                msg: `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`,
            };
        }
        return {
            code: '0',
            msg: `Network error: ${err.message}`,
        };
    }
}

/**
 * Crea una orden/guía de envío en J&T Express Mexico.
 */
async function createOrder(params) {
    if (!JT_API_ACCOUNT || !JT_PRIVATE_KEY || !JT_CUSTOMER_CODE || !JT_PASSWORD) {
        throw new Error('Credenciales de J&T no configuradas. Configura JT_API_ACCOUNT, JT_PRIVATE_KEY, JT_CUSTOMER_CODE y JT_PASSWORD en las variables de entorno.');
    }

    const {
        orderNumber,
        receiverName,
        receiverPhone,
        street,
        colonia,
        city,
        state,
        zip,
        reference = '',
        productName = 'Lámpara 3D Personalizada',
        weight = 1,
        quantity = 1,
        itemValue = 650,
    } = params;

    const bizContent = {
        customerCode: JT_CUSTOMER_CODE,
        digest: generateBizDigest(),
        txlogisticId: orderNumber,
        expressType: 'EZ',
        orderType: '2',         // 2 = Monthly settlement
        serviceType: '01',      // 01 = Door-to-door pickup
        deliveryType: '03',     // 03 = Home delivery
        payType: 'PP_PM',       // Monthly payment
        sender: {
            name: SENDER_DEFAULTS.name,
            postCode: SENDER_DEFAULTS.postCode,
            mobile: SENDER_DEFAULTS.phone,
            phone: SENDER_DEFAULTS.phone,
            countryCode: 'MEXICO',
            prov: SENDER_DEFAULTS.prov,
            city: SENDER_DEFAULTS.city,
            area: SENDER_DEFAULTS.area,
            address: SENDER_DEFAULTS.address,
        },
        receiver: {
            name: receiverName,
            postCode: zip,
            mobile: receiverPhone,
            phone: receiverPhone,
            countryCode: 'MEXICO',
            prov: state,
            city: city,
            area: colonia,
            address: `${street}${reference ? ', Ref: ' + reference : ''}`,
        },
        goodsType: 'bm000006',     // Others
        weight: String(weight),
        totalQuantity: 1,
        itemsValue: String(itemValue),
        priceCurrency: 'MX',
        items: [{
            itemType: 'bm000006',
            itemName: productName,
            number: quantity,
            itemValue: String(itemValue),
        }],
        operateType: 1,             // 1 = Adding
    };

    console.log(`[J&T CREATE] Creando guía para pedido ${orderNumber} → ${receiverName}, ${city}, ${state}`);

    const result = await jtRequest('/order/addOrder', bizContent);
    console.log(`[J&T CREATE] Respuesta:`, JSON.stringify(result));

    // Respuesta exitosa: { code: "1", msg: "success", data: { billCode, txlogisticId, createOrderTime } }
    if (result.code === '1' && result.data) {
        return {
            success: true,
            waybillNo: result.data.billCode || '',
            orderId: result.data.txlogisticId || orderNumber,
            message: result.msg || 'Guía creada exitosamente',
        };
    }

    return {
        success: false,
        message: result.msg || 'Error al crear la guía en J&T',
        code: result.code,
        raw: result,
    };
}

/**
 * Cancela una orden/guía en J&T Express.
 */
async function cancelOrder(orderNumber, reason = 'Cancelación solicitada por el cliente') {
    if (!JT_API_ACCOUNT || !JT_PRIVATE_KEY || !JT_CUSTOMER_CODE || !JT_PASSWORD) {
        throw new Error('Credenciales de J&T no configuradas.');
    }

    const bizContent = {
        customerCode: JT_CUSTOMER_CODE,
        digest: generateBizDigest(),
        txlogisticId: orderNumber,
        orderType: '2',
        reason,
    };

    console.log(`[J&T CANCEL] Cancelando guía para pedido ${orderNumber}`);
    return await jtRequest('/order/cancelOrder', bizContent);
}

/**
 * Verifica si las credenciales de J&T están configuradas.
 */
function isConfigured() {
    return !!(JT_API_ACCOUNT && JT_PRIVATE_KEY && JT_CUSTOMER_CODE && JT_PASSWORD);
}

module.exports = { createOrder, cancelOrder, isConfigured };
