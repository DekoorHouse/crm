// =================================================================
// MIGRACIÓN: referencias OXXO (Mercado Pago) que quedaron en docs sueltos
// =================================================================
// Uso: node scripts/oxxo-migrar-docs-sueltos.js            (solo muestra, no toca nada)
//      node scripts/oxxo-migrar-docs-sueltos.js --apply    (mueve y borra los sueltos)
//
// Qué pasó: el módulo de Mercado Pago escribía la referencia OXXO en
// `pedidos/DH1234` (por número), pero los docs de `pedidos` tienen id aleatorio
// y el número vive en `consecutiveOrderNumber`. Resultado: 72 docs sueltos con
// solo el campo `oxxo` (+ `pagoOxxoAcreditado` en 42 que sí se pagaron) y los
// pedidos REALES nunca se enteraron. El código ya escribe en el doc correcto
// (findPedidoRefByNumber); este script arregla lo histórico:
//   1. copia `oxxo`, `pagoOxxoAcreditado` y `pagoOxxoFecha` al pedido real
//      (sin pisar una referencia más nueva que ya tenga el pedido real), y
//   2. borra el doc suelto.
const { db } = require('../server/config');

const APPLY = process.argv.includes('--apply');

(async () => {
    const mp = await db.collection('mp_orders').where('paymentMethod', '==', 'oxxo').get();
    const nums = [...new Set(mp.docs.map(d => d.data().crmOrderNumber).filter(Boolean))];
    let sueltos = 0, migrados = 0, sinPedidoReal = 0, borrados = 0;
    for (const n of nums) {
        const strayRef = db.collection('pedidos').doc(n);
        const stray = await strayRef.get();
        if (!stray.exists || stray.data().consecutiveOrderNumber != null) continue; // no es suelto
        sueltos++;
        const sd = stray.data();
        const num = Number(String(n).replace(/\D/g, ''));
        const real = await db.collection('pedidos').where('consecutiveOrderNumber', '==', num).limit(1).get();
        if (real.empty) {
            sinPedidoReal++;
            console.log(`  ${n}: suelto SIN pedido real (se deja como está)`);
            continue;
        }
        const realDoc = real.docs[0];
        const rd = realDoc.data();
        const strayMs = sd.oxxo && sd.oxxo.createdAt && sd.oxxo.createdAt.toMillis ? sd.oxxo.createdAt.toMillis() : 0;
        const realMs = rd.oxxo && rd.oxxo.createdAt && rd.oxxo.createdAt.toMillis ? rd.oxxo.createdAt.toMillis() : 0;
        const payload = {};
        if (sd.oxxo && strayMs >= realMs) payload.oxxo = sd.oxxo;
        if (sd.pagoOxxoAcreditado) { payload.pagoOxxoAcreditado = true; payload.pagoOxxoFecha = sd.pagoOxxoFecha || null; }
        console.log(`  ${n} → ${realDoc.id} (${rd.estatus || 'Sin estatus'}): ${Object.keys(payload).join(', ') || 'nada que copiar'}${sd.pagoOxxoAcreditado ? ' [PAGADO por OXXO]' : ''}`);
        if (APPLY) {
            if (Object.keys(payload).length) await realDoc.ref.set(payload, { merge: true });
            await strayRef.delete();
            migrados++; borrados++;
        }
    }
    console.log({ referencias: nums.length, sueltos, sinPedidoReal, migrados, borrados, modo: APPLY ? 'APLICADO' : 'solo lectura (usa --apply)' });
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
