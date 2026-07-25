// =================================================================
// TABLERO DIARIO — el único número que hay que ver para llegar a 50 anticipos/día
// =================================================================
// Uso: node scripts/tablero-diario.js [días]        (default 14)
//
// La meta se descompone en una sola ecuación:
//     anticipos/día = conversaciones/día × (conversación → anticipo)
// y el techo lo pone la economía unitaria: cuánto puedes pagar por anticipo.
//
// Compara los DOS flujos en el mismo eje:
//   - ANTICIPO (depto "Lamparas Corazon anticipo"): solo se fabrica lo que ya
//     pagó $300 → casi no hay producción desperdiciada ni cobranza.
//   - NORMAL (paga al ver la foto): se fabrica casi todo y paga ~44% → cada
//     lámpara hecha y no cobrada se come material y mano de obra.
// La métrica que decide NO es la conversión: es el MARGEN POR CONVERSACIÓN.
//
// ⚠️ OJO con dos trampas de los datos (medidas, no supuestas):
//   1. `metaPurchaseSentAt` NO significa "pagado": se dispara al entrar al
//      estatus "Fabricar". Como el equipo suele saltarse ese estatus, ~36% de
//      las ventas COBRADAS nunca mandaron el evento Purchase a Meta. Aquí el
//      cobro se decide por ESTATUS_PAGADO y el evento se mide aparte.
//   2. Los días recientes SIEMPRE se ven peor: los pagos tardan días en caer.
//      Las tasas se calculan solo con pedidos MADUROS y la tabla marca "~".
const fs = require('fs');
const path = require('path');
const { db } = require('../server/config');

// --- Economía unitaria (ajusta aquí si cambian los números del negocio) ------
const PRECIO = 750;              // precio de 1 pieza
const ANTICIPO = 300;            // lo que se cobra para apartar y registrar
const MARGEN_LIBRE = 500;        // libre por lámpara VENDIDA (sin contar ads)
const COSTO_VARIABLE = PRECIO - MARGEN_LIBRE;  // material + mano de obra + envío
const COSTO_SIN_ENVIO = COSTO_VARIABLE - 50;   // la que se fabrica y no se envía
const META_DIARIA = 50;          // objetivo de anticipos por día

// --- Semántica de estatus (confirmar con operación si cambia) ---------------
const ESTATUS_PAGADO = ['Pagado', 'Enviado', 'Entregado'];
const ESTATUS_FABRICADO = ['Fabricar', 'Corregir', 'Foto enviada', 'Mns Amenazador', 'Esperando pago', ...ESTATUS_PAGADO];

const DEPT_ANTICIPO = 'r6VSzBKpxDxygazz1qdr';   // "Lamparas Corazon anticipo"
const MADURACION_DIAS = 8;        // flujo normal: 90% de los que pagan, pagan antes del día 8
const MADURACION_ANTICIPO = 1;    // flujo anticipo: liquidan el mismo día o al siguiente (medido)

const TZ = '-06:00';              // CDMX (sin horario de verano desde 2022)
const dayKey = d => new Date(d.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
const dayStart = k => new Date(`${k}T00:00:00${TZ}`);
const money = n => '$' + Math.round(n).toLocaleString('es-MX');
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
const pad = (s, n, left = false) => left ? String(s).padStart(n) : String(s).padEnd(n);

(async () => {
    const dias = Math.max(1, Math.min(90, parseInt(process.argv[2], 10) || 14));
    const lookback = dias + 21;   // ventana extra para medir maduración

    const hoyKey = dayKey(new Date());
    const keys = [];
    for (let i = dias - 1; i >= 0; i--) {
        keys.push(dayKey(new Date(dayStart(hoyKey).getTime() - i * 86400000)));
    }
    const desdeTabla = dayStart(keys[0]);
    const desdeQuery = new Date(dayStart(hoyKey).getTime() - lookback * 86400000);

    // ---------- 1. Pedidos --------------------------------------------------
    const pedSnap = await db.collection('pedidos').where('createdAt', '>=', desdeQuery).get();
    const pedidos = [];
    const contactIds = new Set();
    for (const doc of pedSnap.docs) {
        const d = doc.data();
        if (!d.createdAt || !d.createdAt.toDate) continue;
        const creado = d.createdAt.toDate();
        const estatus = d.estatus || 'Sin estatus';
        pedidos.push({
            contactId: d.contactId,
            creado,
            departmentId: String(d.departmentId || ''),   // sello del momento del registro
            anticipoCobrado: Number(d.anticipoCobrado) || 0,
            dia: dayKey(creado),
            edadDias: (Date.now() - creado.getTime()) / 86400000,
            precio: Number(d.precio) || 0,
            estatus,
            // Cobrado = liquidó TODO. `comprobanteValidadoAt` es la señal dura (la pone el
            // flujo /comprobante al validar el pago y mandar el formulario de envío); el
            // estatus "Pagado" es el respaldo para los pedidos viejos. Hace falta el primero
            // porque en el flujo de anticipo el estatus se queda en la etapa de producción
            // ("Fabricar", "Diseñado por IA") aunque el cliente ya haya liquidado.
            cobrado: !!d.comprobanteValidadoAt || ESTATUS_PAGADO.includes(estatus),
            fabricado: ESTATUS_FABRICADO.includes(estatus),
            cancelado: estatus === 'Cancelado',
            eventoMeta: !!d.metaPurchaseSentAt,
        });
        if (d.contactId) contactIds.add(d.contactId);
    }

    // ---------- 2. ¿Qué pedidos son del flujo de anticipo? -------------------
    // Regla: cuenta si el pedido se REGISTRÓ estando ya en el depto de anticipo
    // (o sea, con anticipo cobrado). No basta con que el contacto esté hoy en ese
    // depto: los contactos se reasignan al reescribir desde otro anuncio, y un
    // cliente del flujo viejo que ya tenía pedido acaba contaminando la cuenta.
    // Desde 24-jul-2026 el pedido trae el sello `departmentId`; para los de antes
    // se cae al historial de anuncios del contacto (el pedido debe ser POSTERIOR
    // a que el contacto viera por primera vez el anuncio de anticipo).
    const deptDe = new Map();
    const anticipoDesde = new Map();
    const ids = [...contactIds];
    for (let i = 0; i < ids.length; i += 300) {
        const refs = ids.slice(i, i + 300).map(id => db.collection('contacts_whatsapp').doc(id));
        const docs = await db.getAll(...refs);
        for (const d of docs) {
            if (!d.exists) continue;
            const x = d.data();
            deptDe.set(d.id, String(x.assignedDepartmentId || ''));
            const hist = Array.isArray(x.adReferralHistory) ? x.adReferralHistory : [];
            const ant = hist.find(a => a && /anticipo/i.test(String(a.ad_name || '')));
            if (ant && ant.firstSeenAt && ant.firstSeenAt.toDate) anticipoDesde.set(d.id, ant.firstSeenAt.toDate());
        }
    }
    let legacyDescartados = 0;
    for (const p of pedidos) {
        if (p.departmentId) {                       // sellado: la verdad exacta
            p.esAnticipo = p.departmentId === DEPT_ANTICIPO;
            continue;
        }
        if (deptDe.get(p.contactId) !== DEPT_ANTICIPO) { p.esAnticipo = false; continue; }
        const desde = anticipoDesde.get(p.contactId);
        p.esAnticipo = !desde || p.creado >= desde;  // sin sello: ¿el pedido es posterior al flujo?
        if (!p.esAnticipo) legacyDescartados++;
    }
    if (legacyDescartados) {
        console.log(`\n(${legacyDescartados} pedido(s) del depto descartado(s): se registraron ANTES de que el cliente entrara al flujo de anticipo.)`);
    }

    // ---------- 3. Conversaciones nuevas desde anuncio, por día -------------
    const convDia = {}, convDiaAnt = {};
    try {
        const cSnap = await db.collection('contacts_whatsapp')
            .where('adReferral.firstSeenAt', '>=', desdeTabla)
            .select('assignedDepartmentId', 'adReferral').get();
        for (const doc of cSnap.docs) {
            const d = doc.data();
            const ts = d.adReferral && d.adReferral.firstSeenAt;
            if (!ts || !ts.toDate) continue;
            const k = dayKey(ts.toDate());
            convDia[k] = (convDia[k] || 0) + 1;
            if (String(d.assignedDepartmentId || '') === DEPT_ANTICIPO) convDiaAnt[k] = (convDiaAnt[k] || 0) + 1;
        }
    } catch (e) {
        console.warn(`⚠️  No se pudieron contar conversaciones (${e.message}).\n`);
    }

    // ---------- 4. Gasto diario en ads -------------------------------------
    // Meta en vivo → respaldo manual (scripts/data/gasto-diario.json) → daily_kpis.
    const gastoDia = {};
    let fuenteGasto = 'ninguna';
    try {
        const meta = require('../server/meta/metaAdsService');
        let cuentas = await meta.getKpiAccountIds();
        if (!cuentas || !cuentas.length) {
            const act = await meta.getActiveAccount();
            const id = act && (act.accountId || act.id);
            cuentas = id ? [id] : [];
        }
        for (const cuenta of cuentas) {
            const filas = await meta.getDailySpend(cuenta, keys[0], keys[keys.length - 1]);
            for (const f of filas || []) {
                const k = String(f.date || f.date_start || '').slice(0, 10);
                if (k) gastoDia[k] = (gastoDia[k] || 0) + (Number(f.spend) || 0);
            }
        }
        if (Object.keys(gastoDia).length) fuenteGasto = 'Meta en vivo';
    } catch (e) { /* sin token local: se usa el respaldo */ }
    if (!Object.keys(gastoDia).length) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'gasto-diario.json'), 'utf8'));
            for (const [k, v] of Object.entries(j)) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) gastoDia[k] = Number(v) || 0;
            if (Object.keys(gastoDia).length) fuenteGasto = `respaldo manual (actualizado ${j._actualizado || '?'})`;
        } catch (_) {}
    }
    if (!Object.keys(gastoDia).length) {
        try {
            const kSnap = await db.collection('daily_kpis').where('fecha', '>=', keys[0]).get();
            for (const doc of kSnap.docs) {
                const d = doc.data();
                gastoDia[String(d.fecha || doc.id).slice(0, 10)] = Number(d.costo_publicidad) || 0;
            }
            if (Object.keys(gastoDia).length) fuenteGasto = 'daily_kpis';
        } catch (_) {}
    }

    // ---------- 5. Tabla diaria --------------------------------------------
    console.log(`\n=== TABLERO DIARIO — últimos ${dias} días (CDMX) ===`);
    console.log(`Meta: ${META_DIARIA} anticipos/día. "~" = el día aún no madura (faltan pagos por caer).`);
    console.log(`Anticipos = pedidos del depto "Lamparas Corazon anticipo" | gasto: ${fuenteGasto}\n`);
    console.log(pad('Día', 11) + pad('Gasto', 10, true) + pad('Conv', 7, true) + pad('$/conv', 8, true) +
        pad('Antic', 7, true) + pad('$/antic', 10, true) + pad('Otros', 7, true) + pad('Cobrados', 10, true) + pad('Cobrado', 11, true));
    console.log('-'.repeat(81));

    let totGasto = 0, totConv = 0, totAnt = 0, totOtros = 0;
    for (const k of keys) {
        const delDia = pedidos.filter(p => p.dia === k);
        const ant = delDia.filter(p => p.esAnticipo);
        const otros = delDia.filter(p => !p.esAnticipo);
        const cobrados = delDia.filter(p => p.cobrado);
        const caja = cobrados.reduce((s, p) => s + p.precio, 0) +
            ant.filter(p => !p.cobrado && !p.cancelado).length * ANTICIPO;
        const gasto = gastoDia[k];
        const conv = convDia[k] || 0;
        const joven = delDia.some(p => p.edadDias < MADURACION_DIAS);

        totGasto += gasto || 0; totConv += conv; totAnt += ant.length; totOtros += otros.length;

        console.log(
            pad(k + (joven ? ' ~' : '  '), 11) +
            pad(gasto == null ? '—' : money(gasto), 10, true) +
            pad(conv || '—', 7, true) +
            pad(gasto != null && conv ? '$' + (gasto / conv).toFixed(1) : '—', 8, true) +
            pad(ant.length, 7, true) +
            pad(ant.length && gasto != null ? money(gasto / ant.length) : '—', 10, true) +
            pad(otros.length, 7, true) +
            pad(cobrados.length, 10, true) +
            pad(money(caja), 11, true)
        );
    }
    console.log('-'.repeat(81));
    console.log(pad('TOTAL', 11) + pad(money(totGasto), 10, true) + pad(totConv, 7, true) +
        pad(totConv ? '$' + (totGasto / totConv).toFixed(1) : '—', 8, true) +
        pad(totAnt, 7, true) + pad(totAnt && totGasto ? money(totGasto / totAnt) : '—', 10, true) +
        pad(totOtros, 7, true));

    // ---------- 6. Embudo real y fuga de conversiones a Meta ----------------
    // El flujo de anticipo madura mucho más rápido (liquidan en horas, no en días),
    // así que exigirle los 8 días del flujo normal lo haría ver como 0/0 para siempre.
    const madAnt = pedidos.filter(p => p.esAnticipo && p.edadDias >= MADURACION_ANTICIPO);
    const madNor = pedidos.filter(p => !p.esAnticipo && p.edadDias >= MADURACION_DIAS);

    const cruz = {};
    for (const p of madNor) {
        cruz[p.estatus] = cruz[p.estatus] || { n: 0, ev: 0 };
        cruz[p.estatus].n++;
        if (p.eventoMeta) cruz[p.estatus].ev++;
    }
    console.log(`\n=== EMBUDO REAL: ${madNor.length} registros maduros (≥${MADURACION_DIAS} días) del flujo normal ===`);
    console.log(`  ${pad('estatus', 24)}${pad('pedidos', 9, true)}${pad('%', 8, true)}${pad('evento a Meta', 16, true)}`);
    Object.entries(cruz).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) =>
        console.log(`  ${pad(k, 24)}${pad(v.n, 9, true)}${pad(pct(v.n, madNor.length), 8, true)}${pad(`${v.ev} (${pct(v.ev, v.n)})`, 16, true)}`));

    const cobradosNor = madNor.filter(p => p.cobrado);
    const cobradosSinEvento = cobradosNor.filter(p => !p.eventoMeta);
    console.log(`\n  🔴 FUGA A META: ${cobradosSinEvento.length} de ${cobradosNor.length} ventas COBRADAS no mandaron evento Purchase`);
    console.log(`     = ${pct(cobradosSinEvento.length, cobradosNor.length)} de tus ventas reales que el algoritmo nunca vio.`);
    console.log(`     Causa: el Purchase solo se dispara al ENTRAR al estatus "Fabricar" y el equipo se lo salta.`);

    const desperdicio = madNor.filter(p => p.fabricado && !p.cobrado).length;
    console.log(`\n  Producción desperdiciada: ${desperdicio} lámparas fabricadas y NO cobradas (${pct(desperdicio, madNor.length)} de los registros).`);

    // ---------- 7. Tasas de pago -------------------------------------------
    const tasa = arr => arr.length ? arr.filter(p => p.cobrado).length / arr.length : null;
    const tNor = tasa(madNor);
    // Para el anticipo se cuentan TODOS (no solo los maduros): con muestra chica es más
    // informativo ver cuántos liquidaron y qué tan frescos son los que faltan.
    const todosAnt = pedidos.filter(p => p.esAnticipo);
    const antLiq = todosAnt.filter(p => p.cobrado);
    const tAnt = todosAnt.length >= 3 ? antLiq.length / todosAnt.length : null;
    console.log(`\n=== ¿CUÁNTOS PAGAN? ===`);
    console.log(`Flujo ANTICIPO: ${antLiq.length}/${todosAnt.length} ya liquidaron los $${PRECIO - ANTICIPO} restantes → ${todosAnt.length ? pct(antLiq.length, todosAnt.length) : '—'}`);
    for (const p of todosAnt.filter(x => !x.cobrado)) {
        console.log(`   ⏳ pendiente: registrado hace ${p.edadDias < 1 ? (p.edadDias * 24).toFixed(0) + ' h' : p.edadDias.toFixed(1) + ' días'} (estatus: ${p.estatus})`);
    }
    console.log(`Flujo NORMAL:   ${cobradosNor.length}/${madNor.length} pagaron (maduros ≥${MADURACION_DIAS} días) → ${tNor == null ? '—' : pct(cobradosNor.length, madNor.length)}`);

    // ---------- 8. Economía unitaria y techo de gasto -----------------------
    const margenAnt = t => t * MARGEN_LIBRE + (1 - t) * (ANTICIPO - COSTO_SIN_ENVIO);
    const tasaDesperdicio = madNor.length ? desperdicio / madNor.length : 0;
    const margenNor = t => t * MARGEN_LIBRE - tasaDesperdicio * COSTO_SIN_ENVIO;

    console.log(`\n=== ECONOMÍA UNITARIA (precio ${money(PRECIO)}, libre ${money(MARGEN_LIBRE)}, anticipo ${money(ANTICIPO)}) ===`);
    const tA = tAnt == null ? 0.75 : tAnt, tN = tNor == null ? 0.44 : tNor;
    if (tAnt == null) console.log(`⚠️  SUPUESTO: 75% de los anticipos completan el resto (aún no medido — es el número más importante que falta).`);
    const mA = margenAnt(tA), mN = margenNor(tN);
    console.log(`Margen por ANTICIPO cobrado:        ${money(mA)}   ← tu CPA de EQUILIBRIO`);
    console.log(`Margen por registro flujo NORMAL:   ${money(mN)}`);

    const convAnt7 = keys.slice(-7).reduce((s, k) => s + (convDiaAnt[k] || 0), 0);
    const ant7 = pedidos.filter(p => p.esAnticipo && keys.slice(-7).includes(p.dia)).length;
    const nor7 = pedidos.filter(p => !p.esAnticipo && keys.slice(-7).includes(p.dia)).length;
    const conv7 = keys.slice(-7).reduce((s, k) => s + (convDia[k] || 0), 0);
    const gasto7 = keys.slice(-7).reduce((s, k) => s + (gastoDia[k] || 0), 0);
    const costoConv = conv7 ? gasto7 / conv7 : null;
    const tasaAnt = convAnt7 ? ant7 / convAnt7 : null;
    const tasaNor = (conv7 - convAnt7) ? nor7 / (conv7 - convAnt7) : null;

    if (costoConv && tasaAnt && tasaNor) {
        console.log(`\n--- Margen por 100 CONVERSACIONES (así se comparan de verdad) ---`);
        const netoAnt = 100 * tasaAnt * mA - 100 * costoConv;
        const netoNor = 100 * tasaNor * mN - 100 * costoConv;
        console.log(`Flujo ANTICIPO: 100 conv × ${(tasaAnt * 100).toFixed(1)}% = ${(100 * tasaAnt).toFixed(1)} anticipos × ${money(mA)} − ads ${money(100 * costoConv)} = ${money(netoAnt)}`);
        console.log(`Flujo NORMAL:   100 conv × ${(tasaNor * 100).toFixed(1)}% = ${(100 * tasaNor).toFixed(1)} registros × ${money(mN)} − ads ${money(100 * costoConv)} = ${money(netoNor)}`);
        console.log(netoAnt > netoNor
            ? `✅ El anticipo gana: ${money(netoAnt - netoNor)} más por cada 100 conversaciones (+${((netoAnt / netoNor - 1) * 100).toFixed(0)}%).`
            : `❌ El flujo normal sigue ganando por ${money(netoNor - netoAnt)} por cada 100 conversaciones.`);
        // La regla de decisión: a qué conversión empata el anticipo al flujo normal.
        const equilibrio = (tasaNor * mN) / mA;
        console.log(`\n▶ REGLA DE DECISIÓN: el anticipo empata al flujo normal en ${(equilibrio * 100).toFixed(1)}% de conversación→anticipo.`);
        console.log(`  Medido ahora: ${(tasaAnt * 100).toFixed(1)}% ${tasaAnt >= equilibrio ? '→ ✅ arriba del empate' : '→ ⚠️ abajo del empate (pero ojo con la madurez del tráfico de hoy)'}`);
        console.log(`  Vigila ESE número. Si se asienta arriba de ${(equilibrio * 100).toFixed(1)}%, migra todo el tráfico; si abajo, el anticipo cuesta más de lo que adelanta.`);
    }

    // ---------- 9. Camino a la meta ----------------------------------------
    console.log(`\n=== CAMINO A ${META_DIARIA} ANTICIPOS/DÍA ===`);
    const antDia = ant7 / 7;
    console.log(`Hoy: ${antDia.toFixed(1)} anticipos/día (promedio 7 días). Faltan ${Math.max(0, META_DIARIA - antDia).toFixed(1)}.`);
    if (tasaAnt && costoConv) {
        const convNec = META_DIARIA / tasaAnt;
        const gastoNec = convNec * costoConv;
        const convHoy = conv7 / 7;
        console.log(`Costo por conversación: $${costoConv.toFixed(2)} | conversación→anticipo: ${(tasaAnt * 100).toFixed(1)}%`);
        console.log(`Costo por anticipo implícito: ${money(costoConv / tasaAnt)}  (techo ${money(mA)}, objetivo ≤ ${money(mA / 2.5)})`);
        console.log(`\nPara ${META_DIARIA}/día necesitas ${Math.round(convNec)} conversaciones/día → ${money(gastoNec)}/día en ads`);
        console.log(`Tráfico total HOY: ${Math.round(convHoy)} conversaciones/día → falta un factor de ${(convNec / convHoy).toFixed(1)}x`);
        console.log(`  (no son ${(convNec / (convAnt7 / 7)).toFixed(0)}x: el tráfico ya existe, hay que MIGRARLO al flujo de anticipo)`);
        console.log(`Resultado esperado: ${money(META_DIARIA * mA)}/día de margen − ${money(gastoNec)}/día de ads = ${money(META_DIARIA * mA - gastoNec)}/día limpios`);
    }
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
