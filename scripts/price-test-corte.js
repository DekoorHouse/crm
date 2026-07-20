// =================================================================
// Corte A/B de la prueba de PRECIO ($850/$950 vs $750 control)
// =================================================================
// Uso: node scripts/price-test-corte.js
// Grupo A = precio variante; grupo B = $750 control. Métrica clave: ingreso por
// conversación (aquí sí importa el precio, no solo la tasa) — un precio más alto
// puede bajar la conversión pero subir el ticket; lo que gana es el $ por conversación.
const { db } = require('../server/config');

(async () => {
    // Ventana del experimento (hora de encendido, si el switch la selló).
    try {
        const cfg = (await db.collection('crm_settings').doc('price_test').get()).data() || {};
        const f = t => t && t.toDate ? t.toDate().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : '-';
        console.log(`Switch precio: enabled=${cfg.enabled === true}, price=$${cfg.price || '?'} | encendido: ${f(cfg.enabledAt)} | apagado: ${f(cfg.disabledAt)}\n`);
    } catch (_) {}

    console.log('=== CORTE PRUEBA DE PRECIO (A = variante, B = $750 control) ===\n');
    for (const g of ['A', 'B']) {
        const contactos = await db.collection('contacts_whatsapp').where('priceTest', '==', g).get();
        let conRespuesta = 0;
        for (const d of contactos.docs) {
            const cli = await d.ref.collection('messages').where('from', '==', d.id).get();
            if (cli.size > 1) conRespuesta++;
        }
        const pedidos = await db.collection('pedidos').where('priceTest', '==', g).get();
        const pagados = pedidos.docs.map(p => p.data()).filter(d => d.metaPurchaseSentAt);
        const cobrado = pagados.reduce((s, d) => s + (Number(d.precio) || 0), 0);
        // ¿Los pedidos del grupo A traen el precio variante correcto?
        const precios = [...new Set(pedidos.docs.map(p => Number(p.data().precio)).filter(Boolean))];

        console.log(`--- GRUPO ${g} ---`);
        console.log(`Conversaciones: ${contactos.size} | con respuesta real (>1 msj): ${conRespuesta} (${contactos.size ? (conRespuesta / contactos.size * 100).toFixed(0) : 0}%)`);
        console.log(`Leads: ${pedidos.size} (${contactos.size ? (pedidos.size / contactos.size * 100).toFixed(1) : 0}%) | precios de pedido vistos: ${precios.map(p => '$' + p).join(', ') || '—'}`);
        console.log(`Pagados: ${pagados.length} | cobrado: $${cobrado}`);
        console.log(`Ingreso por conversación: $${contactos.size ? (cobrado / contactos.size).toFixed(1) : '—'} ← LA MÉTRICA QUE DECIDE\n`);
    }
    console.log('Nota: el precio alto puede bajar la conversión pero subir el ticket. Gana el que da más $ por conversación.');
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
