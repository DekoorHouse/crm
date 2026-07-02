/**
 * Script de pruebas de sandbox J&T Express México
 * Ejecuta 3+ llamadas exitosas por API para completar el "Online joint debugging"
 */
const crypto = require('crypto');
const axios = require('axios');

// Credenciales de sandbox (del manual oficial)
const API_ACCOUNT = '292508153084379141';
const PRIVATE_KEY = 'a0a1047cce70493c9d5d29704f05d0d9';
const CUSTOMER_CODE = 'J0086024119';
const PASSWORD = 'W261smo0';
const BASE_URL = 'https://demoopenapi.jtjms-mx.com/webopenplatformapi/api';
const UUID = 'c53079e7fe7d47e9a12545f4b0eae080';

function generateHeaderDigest(bizContentJson) {
    const raw = bizContentJson + PRIVATE_KEY;
    return crypto.createHash('md5').update(raw).digest().toString('base64');
}

function generateBizDigest() {
    const cyphertext = crypto.createHash('md5')
        .update(PASSWORD + 'jadada236t2')
        .digest('hex')
        .toUpperCase();
    const raw = CUSTOMER_CODE + cyphertext + PRIVATE_KEY;
    return crypto.createHash('md5').update(raw).digest().toString('base64');
}

async function jtRequest(endpoint, bizContent) {
    const bizContentJson = JSON.stringify(bizContent);
    const headerDigest = generateHeaderDigest(bizContentJson);

    console.log(`\n--- POST ${endpoint} ---`);
    try {
        const response = await axios.post(
            `${BASE_URL}${endpoint}?uuid=${UUID}`,
            `bizContent=${encodeURIComponent(bizContentJson)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'apiAccount': API_ACCOUNT,
                    'digest': headerDigest,
                    'timestamp': String(Date.now()),
                    'timezone': 'GMT-6',
                },
                timeout: 15000,
                validateStatus: () => true,
            }
        );
        console.log(`Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (err) {
        console.error(`ERROR: ${err.message}`);
        return null;
    }
}

// --- Test 1: Create Order ---
async function testCreateOrder(orderNum) {
    const bizContent = {
        customerCode: CUSTOMER_CODE,
        digest: generateBizDigest(),
        txlogisticId: orderNum,
        expressType: 'EZ',
        orderType: '2',
        serviceType: '01',
        deliveryType: '03',
        payType: 'PP_PM',
        sender: {
            name: 'Dekoor MX',
            postCode: '34190',
            mobile: '6181333519',
            phone: '6181333519',
            countryCode: 'MEXICO',
            prov: 'Durango',
            city: 'Durango',
            area: 'Azteca',
            address: 'Hilario Moreno 206',
        },
        receiver: {
            name: 'Cliente Prueba',
            postCode: '06600',
            mobile: '5551234567',
            phone: '5551234567',
            countryCode: 'MEXICO',
            prov: 'Ciudad de Mexico',
            city: 'Ciudad de Mexico',
            area: 'Juarez',
            address: 'Av. Reforma 100',
        },
        goodsType: 'bm000006',
        weight: '1',
        totalQuantity: 1,
        itemsValue: '650',
        priceCurrency: 'MX',
        items: [{
            itemType: 'bm000006',
            itemName: 'Lampara 3D Personalizada',
            number: 1,
            itemValue: '650',
        }],
        operateType: 1,
    };

    console.log(`\n========== CREATE ORDER: ${orderNum} ==========`);
    return await jtRequest('/order/addOrder', bizContent);
}

// --- Test 2: Checking Order ---
async function testCheckOrder(billCode) {
    const bizContent = {
        customerCode: CUSTOMER_CODE,
        digest: generateBizDigest(),
        billCode: billCode,
    };

    console.log(`\n========== CHECK ORDER: ${billCode} ==========`);
    return await jtRequest('/order/getOrders', bizContent);
}

// --- Test 3: Cancel Order ---
async function testCancelOrder(orderNum) {
    const bizContent = {
        customerCode: CUSTOMER_CODE,
        digest: generateBizDigest(),
        txlogisticId: orderNum,
        orderType: '2',
        reason: 'Prueba de cancelacion sandbox',
    };

    console.log(`\n========== CANCEL ORDER: ${orderNum} ==========`);
    return await jtRequest('/order/cancelOrder', bizContent);
}

// --- Test 4: Logistics Track Query ---
async function testTrackQuery(waybillNo) {
    const bizContent = {
        customerCode: CUSTOMER_CODE,
        digest: generateBizDigest(),
        billCodes: waybillNo,
    };

    console.log(`\n========== TRACK QUERY: ${waybillNo} ==========`);
    return await jtRequest('/logistics/trace', bizContent);
}

// --- Test 5: Logistics Track Subscription ---
async function testTrackSubscription(waybillNo) {
    const bizContent = {
        customerCode: CUSTOMER_CODE,
        digest: generateBizDigest(),
        billCode: waybillNo,
    };

    console.log(`\n========== TRACK SUBSCRIPTION: ${waybillNo} ==========`);
    return await jtRequest('/trace/subscribe', bizContent);
}

// --- Ejecutar todas las pruebas (3 rondas) ---
async function runAllTests() {
    console.log('='.repeat(60));
    console.log('  J&T Express Mexico - Sandbox Testing');
    console.log('  Se ejecutarán 3 rondas de pruebas');
    console.log('='.repeat(60));

    const waybills = [];

    for (let round = 1; round <= 3; round++) {
        console.log(`\n${'#'.repeat(60)}`);
        console.log(`  RONDA ${round} de 3`);
        console.log(`${'#'.repeat(60)}`);

        const orderNum = `TEST-DEKOOR-${Date.now()}-${round}`;

        // 1. Crear orden
        const createResult = await testCreateOrder(orderNum);
        const waybill = createResult?.data?.billCode || '';
        if (waybill) waybills.push(waybill);
        console.log(`>> Guía generada: ${waybill || 'N/A'}`);

        // 2. Consultar orden (con billCode/guía)
        await testCheckOrder(waybill || orderNum);

        // 3. Rastreo (con la guía generada o un dummy)
        await testTrackQuery(waybill || 'TEST000000000');

        // 4. Suscripción a rastreo
        await testTrackSubscription(waybill || 'TEST000000000');

        // 5. Cancelar orden
        await testCancelOrder(orderNum);

        // Pausa entre rondas
        if (round < 3) {
            console.log('\n>> Esperando 2 segundos antes de la siguiente ronda...');
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('  PRUEBAS COMPLETADAS');
    console.log(`  Guías generadas: ${waybills.join(', ') || 'ninguna'}`);
    console.log('  Revisa la plataforma de J&T para ver si las pruebas');
    console.log('  aparecen como "Success" en Sandbox management.');
    console.log(`${'='.repeat(60)}`);
}

runAllTests().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
