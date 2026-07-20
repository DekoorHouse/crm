// =================================================================
// Corte A/B de la prueba de ANTICIPO ($300 para registrar)
// =================================================================
// Uso: node scripts/anticipo-test-corte.js
// Grupo A = anticipo obligatorio (RI versión anticipo + sin comprobante no hay
// registro); grupo B = flujo normal. Qué mide:
//   - Cuántas ventas mata el anticipo (conversión a lead y a pago vs control)
//   - Cuánta caja adelanta (anticipos cobrados aunque el resto no caiga aún)
//   - Cuántas cancelaciones evita (quien ya pagó $300 rara vez cancela)
// Decide el $ COBRADO POR CONVERSACIÓN + la tasa de cancelación, no la
// conversión sola. Referencia: el canal anticipo con ads propios dio 40
// conversaciones y 0 pedidos — este corte confirma o refuta eso con control.
const { db } = require('../server/config');

const ANTICIPO = 300;

(async () => {
    const f = t => t && t.toDate ? t.toDate().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : '-';
    try {
        const cfg = (await db.collection('crm_settings').doc('anticipo_test').get()).data() || {};
        console.log(`Switch anticipo: enabled=${cfg.enabled === true} | encendido: ${f(cfg.enabledAt)} | apagado: ${f(cfg.disabledAt)}\n`);
    } catch (_) {}

    console.log('=== CORTE PRUEBA DE ANTICIPO (A = $300 obligatorio, B = flujo normal) ===\n');
    const stats = {};
    for (const g of ['A', 'B']) {
        const contactos = await db.collection('contacts_whatsapp').where('anticipoTest', '==', g).get();
        let conRespuesta = 0;
        for (const d of contactos.docs) {
            const cli = await d.ref.collection('messages').where('from', '==', d.id).limit(3).get();
            if (cli.size > 1) conRespuesta++;
        }
        const pedidos = await db.collection('pedidos').where('anticipoTest', '==', g).get();
        const datos = pedidos.docs.map(p => p.data());
        const pagados = datos.filter(d => d.metaPurchaseSentAt);
        const cancelados = datos.filter(d => d.estatus === 'Cancelado').length;
        // Caja: pagos completos valen su precio; en A, los registrados sin pago completo
        // ya dejaron el anticipo en caja (Andrea solo registra con comprobante).
        let caja = pagados.reduce((s, d) => s + (Number(d.precio) || 0), 0);
        if (g === 'A') caja += datos.filter(d => !d.metaPurchaseSentAt && d.estatus !== 'Cancelado').length * ANTICIPO;
        const conv = contactos.size;
        stats[g] = { conv, conRespuesta, leads: pedidos.size, pagados: pagados.length, cancelados, caja };

        console.log(`--- GRUPO ${g} ---`);
        console.log(`Conversaciones: ${conv} | con respuesta real: ${conRespuesta} (${conv ? (conRespuesta / conv * 100).toFixed(0) : 0}%)`);
        console.log(`Leads registrados: ${pedidos.size} (${conv ? (pedidos.size / conv * 100).toFixed(1) : 0}%)${g === 'A' ? ' ← en A, lead = anticipo YA cobrado' : ''}`);
        console.log(`Pagos completos: ${pagados.length} | Cancelados: ${cancelados}`);
        console.log(`▶ CAJA COBRADA: $${caja} | $ por conversación: $${conv ? (caja / conv).toFixed(1) : '—'}\n`);
    }

    const A = stats.A, B = stats.B;
    console.log('=== VEREDICTO ===');
    if (!A.conv || !B.conv || (A.leads + B.leads) < 15) {
        console.log('⏳ Muestra insuficiente. Deja correr la prueba (ideal ~300+ conversaciones por grupo y ~1 semana');
        console.log('   para que los pagos y cancelaciones maduren) antes de concluir.');
    } else {
        const dpcA = A.conv ? A.caja / A.conv : 0, dpcB = B.conv ? B.caja / B.conv : 0;
        console.log(`$ por conversación:  A=$${dpcA.toFixed(1)}  vs  B=$${dpcB.toFixed(1)}`);
        console.log(`Conversión a lead:   A=${(A.leads / A.conv * 100).toFixed(1)}%  vs  B=${(B.leads / B.conv * 100).toFixed(1)}%`);
        console.log(`Cancelación:         A=${A.leads ? (A.cancelados / A.leads * 100).toFixed(0) : 0}%  vs  B=${B.leads ? (B.cancelados / B.leads * 100).toFixed(0) : 0}%`);
        if (dpcA >= dpcB) {
            console.log('✅ El anticipo NO está costando dinero (y adelanta caja + evita cancelaciones). Considera adoptarlo.');
        } else {
            console.log('❌ El anticipo mata más ventas de las que compensa la caja adelantada. Apágalo (confirma el dato del canal anticipo).');
        }
        console.log('\n⚠️ Espera a que los pagos maduren (~1 semana) antes de decidir: al inicio A se ve mejor de lo real');
        console.log('   (sus anticipos entran de inmediato y los pagos completos de B tardan días en caer).');
    }
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
