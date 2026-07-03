/**
 * Prueba de conexión con T1 Envíos (script temporal de diagnóstico).
 * Uso:  node scripts/t1-test.js [CP_DESTINO]
 * Lee T1_EMAIL / T1_PASSWORD del .env. NO crea guías (eso consume saldo).
 */
require('dotenv').config();
const t1 = require('../server/t1/t1Client');

(async () => {
    console.log('== T1 Envíos: prueba de conexión ==');
    console.log('Config:', {
        base: t1._config.T1_API_BASE,
        shop_id: t1._config.T1_SHOP_ID,
        comercio_id: t1._config.T1_COMERCIO_ID,
        email_set: !!process.env.T1_EMAIL,
        pass_set: !!process.env.T1_PASSWORD,
    });

    // 1) TOKEN
    try {
        const token = await t1.getToken();
        console.log('\n[1] TOKEN OK — length:', token.length, '(oculto por seguridad)');
    } catch (e) {
        console.error('\n[1] TOKEN error:', e.response?.status, JSON.stringify(e.response?.data || e.message));
        console.error('    → Revisa T1_EMAIL / T1_PASSWORD en .env. Fin.');
        process.exit(1);
    }

    // 2) SALDO
    try {
        const saldo = await t1.consultarSaldo();
        console.log('\n[2] SALDO:', JSON.stringify(saldo));
    } catch (e) {
        console.log('\n[2] SALDO error:', e.response?.status, JSON.stringify(e.response?.data || e.message));
    }

    // 3) COTIZACIÓN (descubre tipo_servicio de DHL + costo). CP destino de prueba (arg o 06700).
    const cpDestino = process.argv[2] || '06700';
    try {
        const q = await t1.cotizar({ cpDestino, valorPaquete: 750 });
        console.log('\n[3] COTIZACIÓN', t1._config.DATOS_ORIGEN.codigo_postal, '→', cpDestino);
        const result = Array.isArray(q.result) ? q.result : (Array.isArray(q.data) ? q.data : []);
        if (!result.length) console.log('   (sin result; raw:)', JSON.stringify(q).slice(0, 1200));
        result.forEach((r) => {
            const servicios = r.cotizacion?.servicios || {};
            Object.entries(servicios).forEach(([k, s]) => {
                console.log(`   ${r.comercio || r.clave} | ${k} | servicio=${s.servicio} | tipo_servicio=${s.tipo_servicio} | costo=$${s.costo_total} | ${s.dias_entrega} días`);
            });
        });
    } catch (e) {
        console.log('\n[3] COTIZACIÓN error:', e.response?.status, JSON.stringify(e.response?.data || e.message));
    }

    console.log('\n== Fin. NO se creó ninguna guía (eso consume saldo; se hace aparte con tu OK). ==');
    process.exit(0);
})();
