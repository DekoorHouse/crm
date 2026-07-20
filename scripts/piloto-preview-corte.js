// =================================================================
// Corte A/B del piloto "preview del diseño + cobro inmediato"
// =================================================================
// Uso: node scripts/piloto-preview-corte.js
// Brief del piloto: docs/plan-preview-diseno.md
//
// Compara los tres niveles por grupo:
//   1) Conversaciones selladas (contactos con pilotoPreview)
//   2) Cierre: contactos con pedido / conversaciones
//   3) Pago: pedidos pagados (metaPurchaseSentAt) / pedidos, tiempos y $ por conversación
// Nota: mockupPaymentSentAt (momento del envío foto/preview+cobro desde la sección
// Mockup) existe para AMBOS grupos; los B enviados a mano desde el chat no lo traen.
const { db } = require('../server/config');

const horas = (a, b) => (a && b && a.toDate && b.toDate) ? (b.toDate() - a.toDate()) / 3600000 : null;
const mediana = arr => {
    const s = arr.filter(x => x != null).sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)].toFixed(1) : '—';
};

(async () => {
    console.log('=== CORTE PILOTO PREVIEW (A = flujo nuevo, B = control) ===\n');
    for (const g of ['A', 'B']) {
        const contactos = await db.collection('contacts_whatsapp').where('pilotoPreview', '==', g).get();
        const pedidos = await db.collection('pedidos').where('pilotoPreview', '==', g).get();

        const conPedido = new Set(pedidos.docs.map(p => p.data().contactId).filter(Boolean));
        const pagados = pedidos.docs.map(p => p.data()).filter(d => d.metaPurchaseSentAt);
        const cobrado = pagados.reduce((s, d) => s + (Number(d.precio) || 0), 0);

        const tRegPago = pagados.map(d => horas(d.createdAt, d.metaPurchaseSentAt));
        const conEnvio = pedidos.docs.map(p => p.data()).filter(d => d.mockupPaymentSentAt);
        const tRegEnvio = conEnvio.map(d => horas(d.createdAt, d.mockupPaymentSentAt));
        const tEnvioPago = pagados.filter(d => d.mockupPaymentSentAt).map(d => horas(d.mockupPaymentSentAt, d.metaPurchaseSentAt));

        console.log(`--- GRUPO ${g} ---`);
        console.log(`Conversaciones selladas: ${contactos.size}`);
        console.log(`Cierre: ${conPedido.size} contactos con pedido (${contactos.size ? (conPedido.size / contactos.size * 100).toFixed(1) : 0}%) | ${pedidos.size} pedidos`);
        console.log(`Pago: ${pagados.length} pagados (${pedidos.size ? (pagados.length / pedidos.size * 100).toFixed(0) : 0}% de los pedidos) | $${cobrado}`);
        console.log(`$ por conversación: $${contactos.size ? (cobrado / contactos.size).toFixed(1) : '—'}`);
        console.log(`Tiempos (mediana hrs): registro→envío foto/preview ${mediana(tRegEnvio)} | envío→pago ${mediana(tEnvioPago)} | registro→pago ${mediana(tRegPago)}`);
        console.log(`(pedidos con envío desde sección Mockup: ${conEnvio.length} de ${pedidos.size})\n`);
    }
    console.log('Recordatorios: A cierra igual o mejor = verde; A cierra >2 pts abajo sostenido = revisar copy.');
    console.log('Vigilar B: su registro→envío debe seguir ~8h (si baja mucho, el control se contaminó).');
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
