// =================================================================
// Corte A/B de la prueba de RI (mensaje inicial)
// =================================================================
// Uso: node scripts/ri-test-corte.js
// Experimento: grupo A recibió la RI nueva; el resto del flujo es el original.
// Métrica clave: conversación → lead (registró pedido) → pago, por grupo.
const { db } = require('../server/config');
const horas = (a, b) => (a && b && a.toDate && b.toDate) ? (b.toDate() - a.toDate()) / 3600000 : null;
const mediana = arr => { const s = arr.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)].toFixed(1) : '—'; };

(async () => {
    console.log('=== CORTE PRUEBA DE RI (A = RI nueva, B = RI original) ===\n');
    for (const g of ['A', 'B']) {
        const contactos = await db.collection('contacts_whatsapp').where('riTest', '==', g).get();
        // Interacción: nº de contactos con más de 1 mensaje del cliente (ida y vuelta real).
        let conRespuesta = 0, msjsCliente = 0;
        const conIds = [];
        for (const d of contactos.docs) {
            conIds.push(d.id);
            const cli = await d.ref.collection('messages').where('from', '==', d.id).get();
            msjsCliente += cli.size;
            if (cli.size > 1) conRespuesta++;
        }
        const pedidos = await db.collection('pedidos').where('riTest', '==', g).get();
        const pagados = pedidos.docs.map(p => p.data()).filter(d => d.metaPurchaseSentAt);
        const cobrado = pagados.reduce((s, d) => s + (Number(d.precio) || 0), 0);
        const tRegPago = pagados.map(d => horas(d.createdAt, d.metaPurchaseSentAt));

        console.log(`--- GRUPO ${g} ---`);
        console.log(`Conversaciones selladas: ${contactos.size}`);
        console.log(`Con respuesta real (>1 msj del cliente): ${conRespuesta} (${contactos.size ? (conRespuesta / contactos.size * 100).toFixed(0) : 0}%) | ${msjsCliente} msjs, ${contactos.size ? (msjsCliente / contactos.size).toFixed(1) : 0} por conv`);
        console.log(`Leads (pedido registrado): ${pedidos.size} (${contactos.size ? (pedidos.size / contactos.size * 100).toFixed(1) : 0}% de las conversaciones)`);
        console.log(`Pagados: ${pagados.length} | $${cobrado} | $ por conversación: $${contactos.size ? (cobrado / contactos.size).toFixed(1) : '—'}`);
        console.log(`Tiempo registro→pago (mediana hrs): ${mediana(tRegPago)}\n`);
    }
    console.log('Nota: comparar sobre todo conversación→lead (ahí pega la RI). El pago casi no lo mueve la RI.');
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
