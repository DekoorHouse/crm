// =================================================================
// Corte A/B de la prueba de PRECIO ($850/$950 vs $750 control)
// =================================================================
// Uso: node scripts/price-test-corte.js
// Grupo A = precio variante; grupo B = $750 control.
//
// LA MÉTRICA QUE DECIDE: MARGEN por conversación = tasa de pago × (precio − costo).
// No la conversión sola (a mayor precio bajan las ventas pero sube el margen por venta),
// ni el ingreso sin restar costo. Gana el grupo con más margen por conversación.
//
// Regla de oro: como cada venta a $850 deja $600 de margen vs $500 a $750, $850 gana
// mientras conserve al menos 500/600 = 83% de la conversión de $750.
//
// ⚠️ Dos correcciones medidas el 24-jul-2026 (ver scripts/tablero-diario.js):
//   1. `metaPurchaseSentAt` NO significa pagado (se dispara al entrar a "Fabricar"). El cobro
//      se lee de `comprobanteValidadoAt` o del estatus "Pagado". En el flujo de anticipo TODOS
//      los pedidos traen metaPurchaseSentAt desde el registro: usarlo daba 100% de pago.
//   2. El costo se paga en TODO lo que se fabrica, no solo en lo cobrado: el flujo normal
//      fabrica ~el 100% de los registros y cobra ~44%.
const { db } = require('../server/config');

const COSTO_PRODUCTO = 250;   // material + envío por pedido (dato de Alex)
const ANTICIPO = 300;         // en el scope 'anticipo', un registro = $300 ya en caja
const ESTATUS_PAGADO = ['Pagado', 'Enviado', 'Entregado'];
const liquido = d => !!d.comprobanteValidadoAt || ESTATUS_PAGADO.includes(d.estatus);

(async () => {
    let f = t => t && t.toDate ? t.toDate().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : '-';
    let esAnticipo = false;
    try {
        const cfg = (await db.collection('crm_settings').doc('price_test').get()).data() || {};
        esAnticipo = cfg.scope === 'anticipo';
        console.log(`Switch precio: enabled=${cfg.enabled === true}, price=$${cfg.price || '?'}, scope=${cfg.scope || 'corazones'} | encendido: ${f(cfg.enabledAt)} | apagado: ${f(cfg.disabledAt)}`);
        if (esAnticipo) console.log(`(scope anticipo: un registro = $${ANTICIPO} ya cobrados; el resto entra al liquidar.)`);
        console.log('');
    } catch (_) {}

    console.log('=== CORTE PRUEBA DE PRECIO (A = variante, B = $750 control) ===\n');
    const stats = {};
    for (const g of ['A', 'B']) {
        const contactos = await db.collection('contacts_whatsapp').where('priceTest', '==', g).get();
        const pedidos = await db.collection('pedidos').where('priceTest', '==', g).get();
        const datos = pedidos.docs.map(p => p.data());
        const noCancelados = datos.filter(d => d.estatus !== 'Cancelado');
        const pagados = datos.filter(liquido);
        // Caja: el que liquidó deja su precio completo; en el scope anticipo, el que registró
        // y no ha liquidado ya dejó el anticipo.
        let cobrado = pagados.reduce((s, d) => s + (Number(d.precio) || 0), 0);
        if (esAnticipo) cobrado += noCancelados.filter(d => !liquido(d)).length * ANTICIPO;
        // El costo se paga en todo lo que se fabrica (no cancelado), aunque no se cobre.
        const margen = cobrado - COSTO_PRODUCTO * noCancelados.length;
        const conv = contactos.size;
        const tasaPago = conv ? pagados.length / conv : 0;
        const margenPorConv = conv ? margen / conv : 0;
        const margenPorVenta = pagados.length ? margen / pagados.length : 0;
        stats[g] = { conv, leads: pedidos.size, pagados: pagados.length, cobrado, margen, tasaPago, margenPorConv, margenPorVenta };

        console.log(`--- GRUPO ${g} ---`);
        console.log(`Conversaciones: ${conv} | Leads: ${pedidos.size} | Liquidados: ${pagados.length} (tasa de pago ${(tasaPago * 100).toFixed(2)}%)`);
        console.log(`Cobrado: $${cobrado} | Margen (cobrado − $${COSTO_PRODUCTO}×${noCancelados.length} fabricados): $${margen}`);
        console.log(`▶ MARGEN POR CONVERSACIÓN: $${margenPorConv.toFixed(2)}\n`);
    }

    // Veredicto
    const A = stats.A, B = stats.B;
    console.log('=== VEREDICTO ===');
    if (!A.conv || !B.conv || (A.pagados + B.pagados) < 20) {
        console.log('⏳ Muestra insuficiente. Espera a tener ~300+ conversaciones por grupo Y a que los pagos maduren');
        console.log('   (una conversación de hoy tarda días en terminar de pagar). Corte confiable: ~1 semana.');
    } else {
        const ratio = B.tasaPago ? A.tasaPago / B.tasaPago : 0;
        // Umbral de empate calculado con los márgenes REALES medidos, no el 83% fijo de $850.
        const umbral = A.margenPorVenta ? B.margenPorVenta / A.margenPorVenta : 0;
        console.log(`Margen/conv:  A=$${A.margenPorConv.toFixed(2)}  vs  B=$${B.margenPorConv.toFixed(2)}`);
        console.log(`Margen/venta: A=$${A.margenPorVenta.toFixed(2)}  vs  B=$${B.margenPorVenta.toFixed(2)}`);
        console.log(`Conversión A conserva el ${(ratio * 100).toFixed(0)}% de la de B (umbral de empate: ${(umbral * 100).toFixed(0)}%).`);
        if (A.margenPorConv > B.margenPorConv) {
            console.log(`✅ GANA EL PRECIO VARIANTE: deja $${(A.margenPorConv - B.margenPorConv).toFixed(2)} más de margen por conversación. Súbelo.`);
        } else {
            console.log(`❌ GANA $750: el precio alto bajó la conversión de más ($${(B.margenPorConv - A.margenPorConv).toFixed(2)}/conv por debajo). Regrésalo.`);
        }
        console.log('\n⚠️ Ojo: solo concluye si los pagos ya maduraron (~1 semana desde el sellado). Si el grupo A');
        console.log('   se selló hace poco, sus pagos aún no terminan de caer y el veredicto puede cambiar.');
    }
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
