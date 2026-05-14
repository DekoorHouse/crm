/**
 * @file js/tests-bbva.js
 * @description Suite de pruebas para la lógica de duplicados y conciliación.
 *
 *   Cómo correrlas:
 *   1. Abre la app en el navegador y haz login.
 *   2. Abre DevTools → Console.
 *   3. Pega en la consola:
 *        import('./js/tests-bbva.js').then(m => m.runAllTests());
 *      (también puedes cargar la página con ?runTests=1 para auto-ejecutar)
 *
 *   Las pruebas son puras: no tocan Firestore ni el estado global, sólo
 *   verifican que las funciones de `bbva-parser.js` se comporten según los
 *   casos definidos en el README del proyecto.
 */

import {
    normalizeConcept,
    normalizeAmount,
    getStrictSignature,
    getSoftSignature,
    attachSignatures,
    classifyForImport,
    calculateExpectedBalance,
    reconcileBalance,
    detectBBVAHeader,
    parseBBVARow
} from './bbva-parser.js';

// ---------------------------------------------------------------------------
//  Mini runner (sin dependencias)
// ---------------------------------------------------------------------------

const results = [];

function assert(label, condition, details = '') {
    const ok = !!condition;
    results.push({ label, ok, details });
    const tag = ok ? '%c✓ PASS' : '%c✗ FAIL';
    const color = ok ? 'color:#16a34a;font-weight:bold;' : 'color:#dc2626;font-weight:bold;';
    console.log(`${tag} %c${label}`, color, 'color:inherit;font-weight:normal;', details);
}

function test(name, fn) {
    console.group(`%c▶ ${name}`, 'color:#6366f1;font-weight:bold;');
    try { fn(); } catch (err) {
        assert(`${name} — sin excepciones`, false, err && err.message);
    }
    console.groupEnd();
}

// ---------------------------------------------------------------------------
//  Caso 1: Dos pagos REALES idénticos de Facebook el mismo día deben poder
//          importarse ambos si el usuario los confirma.
// ---------------------------------------------------------------------------

function caso1_pagosRealesIdenticos() {
    // BBVA exporta dos pagos a Facebook el mismo día por $2,000 cada uno.
    // En el XLS real cada uno trae AUT distinto en el concepto.
    const fb1 = attachSignatures({
        date: '2026-05-10', concept: 'PAY PAL*FACEBOOK / ****1234 AUT: 998877', charge: 2000, credit: 0
    });
    const fb2 = attachSignatures({
        date: '2026-05-10', concept: 'PAY PAL*FACEBOOK / ****1234 AUT: 998878', charge: 2000, credit: 0
    });

    // strictSig DEBE ser distinta porque el AUT es distinto.
    assert('Caso 1.a — strictSig distintas si AUT difiere',
        fb1.strictSignature !== fb2.strictSignature,
        `${fb1.strictSignature} vs ${fb2.strictSignature}`);

    // softSig DEBE ser igual: mismo comercio, monto y fecha.
    assert('Caso 1.b — softSig iguales si comercio/monto/fecha coinciden',
        fb1.softSignature === fb2.softSignature,
        fb1.softSignature);

    // classifyForImport los marca como sospechosos pero los importa ambos.
    const result = classifyForImport([fb1, fb2], []);
    assert('Caso 1.c — ambos van a newUnique', result.newUnique.length === 2);
    assert('Caso 1.d — quedan marcados como suspect_repeated',
        fb1.duplicateStatus === 'suspect_repeated' && fb2.duplicateStatus === 'suspect_repeated');
    assert('Caso 1.e — no van a intraFile ni existingExact',
        result.intraFileDuplicates.length === 0 && result.existingExact.length === 0);

    // Caso especial: PAY PAL*FACEBOOK está en la lista SPECIAL_RECURRING.
    // Si vinieran con AUT idéntico (strict iguales) la lógica especial igual
    // permitiría importar ambas copias.
    const fbSame1 = attachSignatures({
        date: '2026-05-10', concept: 'PAY PAL*FACEBOOK / mismo', charge: 2000, credit: 0
    });
    const fbSame2 = attachSignatures({
        date: '2026-05-10', concept: 'PAY PAL*FACEBOOK / mismo', charge: 2000, credit: 0
    });
    const rSpecial = classifyForImport([fbSame1, fbSame2], []);
    assert('Caso 1.f — concepto especial (PAY PAL*FACEBOOK) permite duplicar aún con strict idéntico',
        rSpecial.newUnique.length === 2);
}

// ---------------------------------------------------------------------------
//  Caso 2: El mismo archivo BBVA importado dos veces NO debe duplicar todos
//          los movimientos sin advertencia.
// ---------------------------------------------------------------------------

function caso2_reimportacionMismoArchivo() {
    // Movimientos como salieron del archivo
    const tx = (i) => attachSignatures({
        date: '2026-05-01', concept: `OXXO COMPRA ${i} / ****1111`, charge: 100 + i, credit: 0
    });
    const newTxs = [tx(1), tx(2), tx(3)];

    // Simular que ya están en la base (1ª importación)
    const existing = newTxs.map(t => ({...t}));

    // 2ª importación del mismo archivo
    const result = classifyForImport(newTxs, existing);

    assert('Caso 2.a — newUnique vacío en reimportación', result.newUnique.length === 0);
    assert('Caso 2.b — los 3 caen en existingExact', result.existingExact.length === 3);
    assert('Caso 2.c — ningún sospechoso', result.suspectRepeated.length === 0);
}

// ---------------------------------------------------------------------------
//  Caso 3: Un archivo con filas duplicadas exactas debe marcarlas como
//          sospechosas (intra-file).
// ---------------------------------------------------------------------------

function caso3_filasDuplicadasExactas() {
    const a = attachSignatures({ date: '2026-05-02', concept: 'PAGO LUZ CFE / 9001', charge: 850, credit: 0 });
    const b = attachSignatures({ date: '2026-05-02', concept: 'PAGO LUZ CFE / 9001', charge: 850, credit: 0 });
    const c = attachSignatures({ date: '2026-05-02', concept: 'PAGO LUZ CFE / 9001', charge: 850, credit: 0 });
    const other = attachSignatures({ date: '2026-05-02', concept: 'WALMART / 5512', charge: 530, credit: 0 });

    const result = classifyForImport([a, b, c, other], []);

    assert('Caso 3.a — importa sólo una copia del grupo duplicado',
        result.newUnique.filter(t => t.strictSignature === a.strictSignature).length === 1);
    assert('Caso 3.b — las otras 2 quedan en intraFileDuplicates', result.intraFileDuplicates.length === 2);
    assert('Caso 3.c — copyIndex va 2 y 3 de 3',
        result.intraFileDuplicates[0].copyIndex === 2 && result.intraFileDuplicates[0].totalCopies === 3);
    assert('Caso 3.d — el movimiento distinto sí se importa',
        result.newUnique.some(t => t.strictSignature === other.strictSignature));
}

// ---------------------------------------------------------------------------
//  Caso 4: saldo inicial 10,000 + abonos 5,000 - cargos 3,000 = saldo 12,000
// ---------------------------------------------------------------------------

function caso4_calculoDeSaldo() {
    const txs = [
        { date: '2026-05-01', concept: 'A', charge: 0,    credit: 3000 },
        { date: '2026-05-02', concept: 'B', charge: 1500, credit: 0    },
        { date: '2026-05-03', concept: 'C', charge: 0,    credit: 2000 },
        { date: '2026-05-04', concept: 'D', charge: 1500, credit: 0    },
    ];
    const r = calculateExpectedBalance(txs, 10000);
    assert('Caso 4.a — totalCredits = 5000', r.totalCredits === 5000, r.totalCredits);
    assert('Caso 4.b — totalCharges = 3000', r.totalCharges === 3000, r.totalCharges);
    assert('Caso 4.c — expectedBalance = 12000', r.expectedBalance === 12000, r.expectedBalance);

    const rec = reconcileBalance(12000, 12000);
    assert('Caso 4.d — conciliado cuando real coincide', rec.isReconciled && rec.difference === 0);

    const rec2 = reconcileBalance(12000, 11950);
    assert('Caso 4.e — diferencia detectada cuando real difiere',
        !rec2.isReconciled && Math.abs(rec2.difference + 50) < 0.001, rec2.difference);
}

// ---------------------------------------------------------------------------
//  Caso 5: Cargos negativos / con comas / con signos de pesos / con espacios
//          deben normalizarse correctamente.
// ---------------------------------------------------------------------------

function caso5_normalizacionDeMontos() {
    assert('Caso 5.a — "$2,000.00" → 2000', normalizeAmount('$2,000.00') === 2000);
    assert('Caso 5.b — "  -1,234.56  " → 1234.56 (Math.abs)',
        Math.abs(normalizeAmount('  -1,234.56  ') - 1234.56) < 1e-9);
    assert('Caso 5.c — "1.234,56" (europeo) → 1234.56',
        Math.abs(normalizeAmount('1.234,56') - 1234.56) < 1e-9);
    assert('Caso 5.d — 2000 → 2000', normalizeAmount(2000) === 2000);
    assert('Caso 5.e — -2000 → 2000 (abs)', normalizeAmount(-2000) === 2000);
    assert('Caso 5.f — null/undefined/"" → 0',
        normalizeAmount(null) === 0 && normalizeAmount(undefined) === 0 && normalizeAmount('') === 0);
    assert('Caso 5.g — texto basura → 0', normalizeAmount('---abc---') === 0);

    // normalizeConcept colapsa espacios
    assert('Caso 5.h — "  HOLA   MUNDO  " → "hola mundo"',
        normalizeConcept('  HOLA   MUNDO  ') === 'hola mundo');
}

// ---------------------------------------------------------------------------
//  Caso 6 (bonus): detectBBVAHeader encuentra encabezados aunque cambien
//                  las filas previas (BBVA varía cuántas filas de logo / fechas
//                  incluye al inicio).
// ---------------------------------------------------------------------------

function caso6_deteccionEncabezadosRobusta() {
    // Simulamos un XLS con 7 filas de cabecera en vez de las 4 tradicionales.
    const data = [
        ['BBVA México'],
        ['Estado de cuenta'],
        ['Periodo: 01/05/2026 - 31/05/2026'],
        ['Cliente: Fulano'],
        ['Cuenta: 0123 4567'],
        [],
        ['FECHA', 'DESCRIPCIÓN', 'CARGO', 'ABONO'],
        ['01/05/2026', 'OXXO / 1234', 100, 0],
        ['02/05/2026', 'Depósito / 5678', 0, 5000],
    ];
    const det = detectBBVAHeader(data);
    assert('Caso 6.a — headerFound=true', det.headerFound === true);
    assert('Caso 6.b — headerRowIndex=6', det.headerRowIndex === 6, det.headerRowIndex);
    assert('Caso 6.c — columnMap correcto',
        det.columnMap.date === 0 && det.columnMap.concept === 1 &&
        det.columnMap.charge === 2 && det.columnMap.credit === 3);

    const tx = parseBBVARow(data[7], 7, det.columnMap, {
        sourceFileName: 'mock.xlsx', sourceFileHash: 'abc', importBatchId: 'b1', importedAt: 12345
    });
    assert('Caso 6.d — fila parseada', tx && tx.date === '2026-05-01' && tx.charge === 100);
    assert('Caso 6.e — metadata adjunta',
        tx.sourceFileName === 'mock.xlsx' && tx.sourceRowIndex === 7 && tx.importBatchId === 'b1');
}

// ---------------------------------------------------------------------------
//  Runner público
// ---------------------------------------------------------------------------

export function runAllTests() {
    results.length = 0;
    console.log('%c=== Pruebas BBVA-Parser ===', 'font-size:14px;font-weight:bold;color:#6366f1;');

    test('Caso 1: pagos reales idénticos de Facebook (mismo día, mismo monto)', caso1_pagosRealesIdenticos);
    test('Caso 2: reimportación del mismo archivo BBVA', caso2_reimportacionMismoArchivo);
    test('Caso 3: filas duplicadas exactas dentro del archivo', caso3_filasDuplicadasExactas);
    test('Caso 4: saldo esperado = inicial + abonos - cargos', caso4_calculoDeSaldo);
    test('Caso 5: normalización de montos (comas, $, signos, espacios)', caso5_normalizacionDeMontos);
    test('Caso 6: detección robusta de encabezados BBVA', caso6_deteccionEncabezadosRobusta);

    const pass = results.filter(r => r.ok).length;
    const fail = results.length - pass;
    console.log(
        `%c=== Resultado: ${pass}/${results.length} OK${fail ? ` · ${fail} fallos` : ''} ===`,
        `font-size:14px;font-weight:bold;color:${fail ? '#dc2626' : '#16a34a'};`
    );
    return { pass, fail, total: results.length, results: [...results] };
}

// Auto-run si la URL incluye ?runTests=1
if (typeof window !== 'undefined' && /[?&]runTests=1/.test(window.location.search)) {
    window.addEventListener('load', () => setTimeout(runAllTests, 500));
}
