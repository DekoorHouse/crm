// =================================================================
// Checkpoint de la campaña "Ventas 1407//Corazones//4ads//" (jul-2026)
// =================================================================
// Uso: node scripts/checkpoint-campana-4ads.js
//
// Contexto: presupuesto $4k/día; subió a $5k el lun 20-jul 00:00.
// Decisión del lun 20-jul 23:00: ¿subir a $6k desde el mar 21 00:00?
// Criterios (cohortes por fecha de REGISTRO, solo campaña), calibrados a la CURVA
// de pago medida (39% de los registrados pagan al madurar; de los que pagan:
// 50% en <0.6 días, 75% en <4.8, 90% en <8). A la hora de la decisión:
//   - Viernes 17 (edad ~3.3 días → en curva ≈ 10 pagos de 38):
//       ≥12 = VERDE (arriba de curva), 10-11 = AMARILLO (en curva), <10 = ROJO
//   - Sábado 18 (edad ~2.3 días → en curva ≈ 8 pagos de 34):
//       ≥9 = VERDE, 7-8 = AMARILLO, <7 = ROJO
//   - Regla: al menos un VERDE y ningún ROJO → subir a $6k; doble AMARILLO →
//     en curva pero sin holgura: esperar un día y re-checar el martes 23:00;
//     cualquier ROJO → no subir (revisar cobranza/flujo de pago, no el presupuesto).
// Del lado de Meta (ver en Ads Manager o por MCP): costo/conversación ≤ ~$12,
// CPM ~$23 estable, frecuencia < 2. La cuenta es "Cuenta Dekoor X"
// (996454109981623), campaña id 52533504914365.
const { db } = require('../server/config');
const ADS = new Set(['52533506989965', '52533506865965', '52533506628165', '52533504914165']);

async function cohorte(nombre, ini, fin) {
    const snap = await db.collection('pedidos')
        .where('createdAt', '>=', new Date(ini)).where('createdAt', '<', new Date(fin)).get();
    let reg = 0, pag = 0, monto = 0;
    for (const p of snap.docs) {
        const d = p.data();
        if (!ADS.has(String(d.attributedAdId || ''))) continue;
        reg++;
        if (d.metaPurchaseSentAt) { pag++; monto += Number(d.precio) || 0; }
    }
    return { nombre, reg, pag, monto, pct: reg ? Math.round(pag / reg * 100) : 0 };
}

function semaforo(pag, verde, amarillo) {
    return pag >= verde ? '🟢 VERDE' : pag >= amarillo ? '🟡 AMARILLO' : '🔴 ROJO';
}

(async () => {
    const dias = [
        ['Viernes 17', '2026-07-17T00:00:00-06:00', '2026-07-18T00:00:00-06:00'],
        ['Sábado 18 ', '2026-07-18T00:00:00-06:00', '2026-07-19T00:00:00-06:00'],
        ['Domingo 19', '2026-07-19T00:00:00-06:00', '2026-07-20T00:00:00-06:00'],
        ['Lunes 20  ', '2026-07-20T00:00:00-06:00', '2026-07-21T00:00:00-06:00'],
    ];
    const res = [];
    for (const [n, a, b] of dias) res.push(await cohorte(n, a, b));

    console.log('=== CHECKPOINT CAMPAÑA 4ADS ===\n');
    for (const r of res) {
        console.log(`${r.nombre}: ${r.reg} registrados | ${r.pag} pagados (${r.pct}%) | $${r.monto} cobrados`);
    }
    const vie = res[0], sab = res[1];
    console.log(`\nSemáforo viernes (verde ≥12, en curva 10-11): ${semaforo(vie.pag, 12, 10)}`);
    console.log(`Semáforo sábado  (verde ≥9,  en curva 7-8):   ${semaforo(sab.pag, 9, 7)}`);
    const vVerde = vie.pag >= 12, vOk = vie.pag >= 10, sVerde = sab.pag >= 9, sOk = sab.pag >= 7;
    let decision;
    if (!vOk || !sOk) decision = '🛑 NO SUBIR: hay rojo — primero revisar cobranza/flujo de pago, no el presupuesto';
    else if (vVerde || sVerde) decision = '✅ SUBIR a $6,000 desde el martes 00:00';
    else decision = '⏸️ EN CURVA pero sin holgura (doble amarillo): esperar un día y re-checar el martes 23:00';
    console.log(`\nDECISIÓN SUGERIDA: ${decision}`);
    console.log('\n(Complementar con Meta: costo/conversación ≤ $12, CPM ~$23, frecuencia < 2 en el día a $5k.)');
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
