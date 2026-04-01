const axios = require('axios');
const crypto = require('crypto');

// --- Configuración J&T Open Platform ---
const JT_API_URL = process.env.JT_API_URL || 'https://open.jtjms-mx.com/api';
const JT_COMPANY_ID = process.env.JT_COMPANY_ID || '';
const JT_CUSTOMER_ID = process.env.JT_CUSTOMER_ID || '';
const JT_API_KEY = process.env.JT_API_KEY || '';

// Datos del remitente (Dekoor - Durango)
const SENDER_DEFAULTS = {
    name: process.env.JT_SENDER_NAME || 'Dekoor MX',
    phone: process.env.JT_SENDER_PHONE || '6181333519',
    province: process.env.JT_SENDER_STATE || 'Durango',
    city: process.env.JT_SENDER_CITY || 'Durango',
    area: process.env.JT_SENDER_AREA || 'Durango',
    address: process.env.JT_SENDER_ADDRESS || '',
    postCode: process.env.JT_SENDER_ZIP || '34000',
};

/**
 * Genera la firma (data_digest) para la API de J&T.
 * Formato: base64(md5(logistics_interface + api_key))
 */
function generateSignature(logisticsInterface) {
    const raw = logisticsInterface + JT_API_KEY;
    const md5Hash = crypto.createHash('md5').update(raw).digest();
    return md5Hash.toString('base64');
}

/**
 * Crea una orden/guía de envío en J&T Express.
 * @param {Object} params
 * @param {string} params.orderNumber - Número de pedido interno (ej: DH1042)
 * @param {string} params.receiverName - Nombre del destinatario
 * @param {string} params.receiverPhone - Teléfono del destinatario (10 dígitos)
 * @param {string} params.street - Calle y número
 * @param {string} params.colonia - Colonia
 * @param {string} params.city - Ciudad
 * @param {string} params.state - Estado
 * @param {string} params.zip - Código postal (5 dígitos)
 * @param {string} [params.reference] - Referencia de la dirección
 * @param {string} [params.productName] - Descripción del producto
 * @param {number} [params.weight] - Peso en kg (default 1)
 * @param {number} [params.quantity] - Cantidad de paquetes (default 1)
 * @param {number} [params.itemValue] - Valor del producto en MXN (default 650)
 * @returns {Promise<Object>} Respuesta de J&T con awb_no (número de guía)
 */
async function createOrder(params) {
    if (!JT_COMPANY_ID || !JT_CUSTOMER_ID || !JT_API_KEY) {
        throw new Error('Credenciales de J&T no configuradas. Configura JT_COMPANY_ID, JT_CUSTOMER_ID y JT_API_KEY.');
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

    // Construir el JSON de la orden
    const orderData = {
        eccompanyid: JT_COMPANY_ID,
        customerid: JT_CUSTOMER_ID,
        txlogisticid: orderNumber,
        orderType: '1',
        serviceType: '1',
        goodsType: '2',
        totalQuantity: String(quantity),
        weight: String(weight),
        itemsValue: String(itemValue),
        goodsDescription: productName,
        sender: {
            name: SENDER_DEFAULTS.name,
            phone: SENDER_DEFAULTS.phone,
            mobile: SENDER_DEFAULTS.phone,
            province: SENDER_DEFAULTS.province,
            city: SENDER_DEFAULTS.city,
            area: SENDER_DEFAULTS.area,
            address: SENDER_DEFAULTS.address,
            postCode: SENDER_DEFAULTS.postCode,
        },
        receiver: {
            name: receiverName,
            phone: receiverPhone,
            mobile: receiverPhone,
            province: state,
            city: city,
            area: colonia,
            address: `${street}, ${colonia}${reference ? '. Ref: ' + reference : ''}`,
            postCode: zip,
        },
        items: [{
            itemName: productName,
            itemValue: String(itemValue),
            number: String(quantity),
        }],
    };

    const logisticsInterface = JSON.stringify(orderData);
    const dataDigest = generateSignature(logisticsInterface);

    const payload = {
        logistics_interface: logisticsInterface,
        data_digest: dataDigest,
        msg_type: 'ORDERCREATE',
        eccompanyid: JT_COMPANY_ID,
    };

    console.log(`[J&T CREATE] Creando guía para pedido ${orderNumber} → ${receiverName}, ${city}, ${state}`);

    const response = await axios.post(`${JT_API_URL}/order/createOrder`, payload, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        transformRequest: [(data) => {
            return Object.entries(data)
                .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
                .join('&');
        }],
        timeout: 15000,
    });

    const result = response.data;
    console.log(`[J&T CREATE] Respuesta:`, JSON.stringify(result));

    if (result.responseitems && result.responseitems.length > 0) {
        const item = result.responseitems[0];
        if (item.success === 'true' || item.success === true) {
            return {
                success: true,
                waybillNo: item.billcode || item.awb_no || '',
                orderId: item.txlogisticid || orderNumber,
                message: item.reason || 'Guía creada exitosamente',
            };
        } else {
            return {
                success: false,
                message: item.reason || 'Error al crear la guía en J&T',
                orderId: orderNumber,
            };
        }
    }

    // Formato alternativo de respuesta
    if (result.success === true || result.success === 'true') {
        const detail = result.detail?.[0] || {};
        return {
            success: true,
            waybillNo: detail.awb_no || detail.billcode || '',
            orderId: detail.orderid || orderNumber,
            message: result.desc || 'Guía creada exitosamente',
        };
    }

    return {
        success: false,
        message: result.desc || result.msg || 'Respuesta inesperada de J&T',
        raw: result,
    };
}

/**
 * Cancela una orden/guía en J&T Express.
 */
async function cancelOrder(orderNumber) {
    if (!JT_COMPANY_ID || !JT_API_KEY) {
        throw new Error('Credenciales de J&T no configuradas.');
    }

    const orderData = {
        eccompanyid: JT_COMPANY_ID,
        customerid: JT_CUSTOMER_ID,
        txlogisticid: orderNumber,
        orderType: '2',
    };

    const logisticsInterface = JSON.stringify(orderData);
    const dataDigest = generateSignature(logisticsInterface);

    const payload = {
        logistics_interface: logisticsInterface,
        data_digest: dataDigest,
        msg_type: 'ORDERCANCEL',
        eccompanyid: JT_COMPANY_ID,
    };

    console.log(`[J&T CANCEL] Cancelando guía para pedido ${orderNumber}`);

    const response = await axios.post(`${JT_API_URL}/order/cancelOrder`, payload, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        transformRequest: [(data) => {
            return Object.entries(data)
                .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
                .join('&');
        }],
        timeout: 15000,
    });

    return response.data;
}

/**
 * Verifica si las credenciales de J&T están configuradas.
 */
function isConfigured() {
    return !!(JT_COMPANY_ID && JT_CUSTOMER_ID && JT_API_KEY);
}

module.exports = { createOrder, cancelOrder, isConfigured, generateSignature };
