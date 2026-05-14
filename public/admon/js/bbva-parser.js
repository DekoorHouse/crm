/**
 * @file js/bbva-parser.js
 * @description Módulo de funciones puras para parseo y clasificación de
 *              movimientos bancarios BBVA. Todo aquí es determinista, sin
 *              dependencias del estado global ni de la UI. Esto facilita
 *              probar la lógica de forma aislada y reusarla.
 *
 * Conceptos clave:
 *  - strictSignature: firma "fuerte" usada para detectar duplicados EXACTOS
 *    (mismo archivo importado dos veces, o filas duplicadas exactas en el XLS).
 *    Incluye el concepto COMPLETO tal como lo entrega BBVA (con AUT/RFC/hora),
 *    así que dos movimientos reales del mismo comercio NUNCA chocan aquí
 *    porque BBVA les asigna un AUT distinto.
 *
 *  - softSignature: firma "suave" basada en fecha + merchantKey + montos.
 *    Sirve sólo para SEÑALAR movimientos sospechosamente repetidos.
 *    NUNCA se usa para borrar automáticamente.
 *
 *  Importante: si el XLS de BBVA no trae AUT/referencia/hora/saldo, no se
 *  puede saber con certeza si dos movimientos idénticos son duplicados o
 *  pagos reales separados. La decisión es del usuario.
 */

// ---------------------------------------------------------------------------
//  Normalización
// ---------------------------------------------------------------------------

/**
 * Normaliza un concepto bancario: trim, colapsa espacios, lowercase.
 * Mantiene el cuerpo del texto (incluido AUT/RFC), no recorta nada.
 * @param {string} concept
 * @returns {string}
 */
export function normalizeConcept(concept) {
    return String(concept || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Extrae la "clave de comercio" — la parte antes del primer "/" — normalizada.
 *   "FACEBOOK MX / ******1234 RFC: ..." → "facebook mx"
 *   "PAY PAL*FACEBOOK / 1234 RFC: ..."  → "pay pal*facebook"
 *
 * @param {string} concept
 * @returns {string}
 */
export function getMerchantKey(concept) {
    const lower = normalizeConcept(concept);
    const slashIdx = lower.indexOf('/');
    return slashIdx >= 0 ? lower.substring(0, slashIdx).trim() : lower;
}

/**
 * Convierte cualquier representación de monto a Number positivo.
 * Soporta:
 *   - Números: 2000, -2000, 2000.5
 *   - Strings: "2000", "-2,000.00", "$2,000.00", "2 000.00", "  $2.000,50  " (es-MX)
 *   - null/undefined/empty → 0
 *
 * @param {*} value
 * @returns {number}  número, NUNCA NaN, NUNCA negativo (Math.abs)
 */
export function normalizeAmount(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.abs(value) : 0;

    let s = String(value).trim();
    if (!s) return 0;

    // Detectar formato europeo (1.234,56) vs anglosajón (1,234.56). Heurística:
    // si hay coma y punto y la coma está después del último punto, asumir europeo.
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastComma > lastDot && lastComma > -1) {
        // Formato europeo: punto = miles, coma = decimal
        s = s.replace(/\./g, '').replace(',', '.');
    } else {
        // Formato anglosajón: coma = miles, punto = decimal
        s = s.replace(/,/g, '');
    }

    // Quitar todo lo que no sea dígito, signo o punto
    s = s.replace(/[^0-9.\-]/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.abs(n) : 0;
}

// ---------------------------------------------------------------------------
//  Fechas
// ---------------------------------------------------------------------------

/**
 * Convierte un número de serie de fecha Excel a Date (UTC, hora 00:00).
 * Excel cuenta días desde 1900-01-01 (con bug de año bisiesto 1900).
 * Para evitar desfase por zona horaria usamos UTC.
 *
 * @param {number} serial
 * @returns {Date|null}
 */
export function excelSerialToUTCDate(serial) {
    if (typeof serial !== 'number' || !Number.isFinite(serial)) return null;
    const epochMs = (serial - 25569) * 86400 * 1000;  // 25569 = 1970-01-01 en serial Excel
    const d = new Date(epochMs);
    if (isNaN(d.getTime())) return null;
    // Normalizar a 00:00 UTC del día correspondiente
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Convierte un valor cualquiera (Date | number | string) a "YYYY-MM-DD" en UTC.
 * Acepta strings como "DD/MM/YYYY", "YYYY-MM-DD", "D-M-YY", etc.
 *
 * @param {*} raw
 * @returns {string}  cadena vacía si no se puede parsear
 */
export function toISODate(raw) {
    if (raw instanceof Date) {
        if (isNaN(raw.getTime())) return '';
        const d = new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
        return d.toISOString().split('T')[0];
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const d = excelSerialToUTCDate(raw);
        return d ? d.toISOString().split('T')[0] : '';
    }
    if (typeof raw === 'string') {
        const s = raw.trim();
        // YYYY-MM-DD
        const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (iso) {
            const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
            return isNaN(d) ? '' : d.toISOString().split('T')[0];
        }
        // DD/MM/YYYY o D/M/YY (formato BBVA típico es DD/MM/YYYY)
        const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
        if (dmy) {
            let year = +dmy[3];
            if (year < 100) year += 2000;
            const d = new Date(Date.UTC(year, +dmy[2] - 1, +dmy[1]));
            return isNaN(d) ? '' : d.toISOString().split('T')[0];
        }
    }
    return '';
}

// ---------------------------------------------------------------------------
//  Detección de encabezados BBVA
// ---------------------------------------------------------------------------

/**
 * BBVA exporta XLS con N filas de cabecera (logo, fechas del estado de cuenta,
 * etc.) antes de los movimientos. La fila de encabezados típicamente contiene
 * las palabras "FECHA", "DESCRIPCIÓN" o "CONCEPTO", "CARGO", "ABONO".
 *
 * Esta función busca la fila de encabezado y devuelve:
 *   { headerRowIndex, columnMap: { date, concept, charge, credit } }
 *
 * Si no encuentra encabezado válido, hace fallback a la heurística vieja
 * (saltar 4 filas y asumir las primeras 4 columnas).
 *
 * @param {Array<Array>} jsonData  array de filas
 * @returns {{ headerRowIndex: number, columnMap: { date:number, concept:number, charge:number, credit:number }, headerFound: boolean }}
 */
export function detectBBVAHeader(jsonData) {
    const FALLBACK = {
        headerRowIndex: 3,  // los datos arrancan en la fila 5 (índice 4)
        columnMap: { date: 0, concept: 1, charge: 2, credit: 3 },
        headerFound: false
    };

    if (!Array.isArray(jsonData) || jsonData.length === 0) return FALLBACK;

    const MAX_SCAN = Math.min(jsonData.length, 30);
    const dateRe = /fecha/i;
    const conceptRe = /(descripci[oó]n|concepto|detalle)/i;
    const chargeRe = /(cargo|d[eé]bito|retiro)/i;
    const creditRe = /(abono|cr[eé]dito|dep[oó]sito)/i;

    for (let i = 0; i < MAX_SCAN; i++) {
        const row = jsonData[i];
        if (!Array.isArray(row)) continue;

        let dateCol = -1, conceptCol = -1, chargeCol = -1, creditCol = -1;
        for (let c = 0; c < row.length; c++) {
            const cell = String(row[c] || '').trim();
            if (!cell) continue;
            if (dateCol === -1 && dateRe.test(cell)) dateCol = c;
            else if (conceptCol === -1 && conceptRe.test(cell)) conceptCol = c;
            else if (chargeCol === -1 && chargeRe.test(cell)) chargeCol = c;
            else if (creditCol === -1 && creditRe.test(cell)) creditCol = c;
        }
        // Necesitamos al menos fecha + concepto + (cargo o abono) para considerar
        // que es una fila de encabezado válida.
        if (dateCol >= 0 && conceptCol >= 0 && (chargeCol >= 0 || creditCol >= 0)) {
            return {
                headerRowIndex: i,
                columnMap: {
                    date: dateCol,
                    concept: conceptCol,
                    // si una de las dos columnas falta, asumir la siguiente al concept
                    charge: chargeCol >= 0 ? chargeCol : conceptCol + 1,
                    credit: creditCol >= 0 ? creditCol : conceptCol + 2,
                },
                headerFound: true
            };
        }
    }

    return FALLBACK;
}

// ---------------------------------------------------------------------------
//  Parseo de una fila BBVA
// ---------------------------------------------------------------------------

/**
 * Convierte una fila cruda en un objeto transaction normalizado, con metadata
 * de importación lista para guardar en Firestore.
 *
 * @param {Array} row              fila cruda del XLS
 * @param {number} sourceRowIndex  índice 0-based dentro del archivo
 * @param {{ date:number, concept:number, charge:number, credit:number }} columnMap
 * @param {object} importMeta      { sourceFileName, sourceFileHash, importBatchId, importedAt }
 * @returns {object|null}          objeto normalizado o null si la fila no es válida
 */
export function parseBBVARow(row, sourceRowIndex, columnMap, importMeta = {}) {
    if (!Array.isArray(row)) return null;

    const rawDate = row[columnMap.date];
    const rawConcept = row[columnMap.concept];
    const rawCharge = row[columnMap.charge];
    const rawCredit = row[columnMap.credit];

    const date = toISODate(rawDate);
    const concept = String(rawConcept || '').trim();
    const charge = normalizeAmount(rawCharge);
    const credit = normalizeAmount(rawCredit);

    // Sin fecha o sin concepto → fila no parseable (probablemente título,
    // total final, fila vacía, etc.). Descartar silenciosamente.
    if (!date || !concept) return null;
    // Sin ningún monto → no es un movimiento real.
    if (charge <= 0 && credit <= 0) return null;

    return {
        // Datos del movimiento
        date,
        concept,
        charge,
        credit,
        category: '',         // se llena después por reglas/categorizador
        channel: '',
        type: 'operativo',
        sub_type: '',
        source: importMeta.sourceFileExt || 'xls',

        // --- Metadata de importación (auditoría) ---
        sourceFileName: importMeta.sourceFileName || '',
        sourceFileHash: importMeta.sourceFileHash || '',
        importBatchId:  importMeta.importBatchId  || '',
        importedAt:     importMeta.importedAt     || Date.now(),
        sourceRowIndex,

        // Firmas (se rellenan abajo)
        strictSignature: '',
        softSignature: '',
        duplicateStatus: 'new'   // 'new' | 'suspect_repeated' | 'skipped_intrafile' | 'skipped_existing' | 'confirmed_real'
    };
}

// ---------------------------------------------------------------------------
//  Firmas
// ---------------------------------------------------------------------------

/**
 * Firma estricta: detecta duplicados EXACTOS. Si BBVA re-exporta el mismo
 * archivo o el XLS trae una fila duplicada idéntica, esta firma será igual.
 *
 * Usa el concepto COMPLETO (con AUT/RFC/hora si vienen incluidos). Eso
 * garantiza que dos movimientos reales distintos del mismo comercio NUNCA
 * choquen aquí — BBVA les pone un AUT diferente.
 *
 * @param {{ date:string, concept:string, charge:number, credit:number }} tx
 * @returns {string}
 */
export function getStrictSignature(tx) {
    const concept = normalizeConcept(tx.concept);
    const charge = (Number(tx.charge) || 0).toFixed(2);
    const credit = (Number(tx.credit) || 0).toFixed(2);
    return `S|${tx.date}|${concept}|${charge}|${credit}`;
}

/**
 * Firma suave: detecta movimientos que PUEDEN ser duplicados o pagos
 * reales repetidos. Se ignora el AUT/RFC/hora del concepto.
 *
 * Solo sirve para mostrar al usuario un grupo de "sospechosos repetidos".
 * NO se usa para borrar nada.
 *
 * @param {{ date:string, concept:string, charge:number, credit:number }} tx
 * @returns {string}
 */
export function getSoftSignature(tx) {
    const merchant = getMerchantKey(tx.concept);
    const charge = (Number(tx.charge) || 0).toFixed(2);
    const credit = (Number(tx.credit) || 0).toFixed(2);
    return `s|${tx.date}|${merchant}|${charge}|${credit}`;
}

/**
 * Adjunta strictSignature y softSignature a un objeto transaction
 * (modifica el objeto in place y lo devuelve).
 */
export function attachSignatures(tx) {
    tx.strictSignature = getStrictSignature(tx);
    tx.softSignature = getSoftSignature(tx);
    return tx;
}

// ---------------------------------------------------------------------------
//  Clasificación de duplicados
// ---------------------------------------------------------------------------

/**
 * Toma un set de transacciones nuevas (recién importadas de un XLS) y un set
 * de transacciones existentes (lo que ya hay en la base) y devuelve cuatro
 * categorías que la UI puede mostrar al usuario:
 *
 *   - newUnique: movimientos sin choque alguno → IMPORTAR directo.
 *   - intraFileDuplicates: filas con misma strictSignature dentro del mismo
 *     archivo (típico cuando BBVA exporta filas duplicadas). Se importa el
 *     primero por default y se muestran los demás como "omitidos".
 *   - existingExact: misma strictSignature que un movimiento ya guardado →
 *     se omite por default (probablemente reimportación del archivo).
 *   - suspectRepeated: el mismo softSig aparece varias veces (entre nuevos o
 *     contra DB) pero con strictSig distintas → probablemente movimientos
 *     reales separados (tienen AUT diferente). Se IMPORTAN todos y se marcan
 *     con duplicateStatus='suspect_repeated' para revisión en conciliación.
 *
 * @param {Array<object>} newTxs       transacciones nuevas (con firmas)
 * @param {Array<object>} existingTxs  transacciones ya guardadas (con firmas)
 * @returns {{
 *   newUnique: Array<object>,
 *   intraFileDuplicates: Array<{ expense:object, copyIndex:number, totalCopies:number, sig:string }>,
 *   existingExact: Array<{ expense:object, sig:string }>,
 *   suspectRepeated: Array<{ expense:object, sig:string, peers:number }>
 * }}
 */
export function classifyForImport(newTxs, existingTxs) {
    // Indexar existentes por firma estricta
    const existingByStrict = new Set();
    const existingBySoft = new Map(); // softSig → cantidad
    for (const e of existingTxs) {
        const ss = e.strictSignature || getStrictSignature(e);
        existingByStrict.add(ss);
        const sf = e.softSignature || getSoftSignature(e);
        existingBySoft.set(sf, (existingBySoft.get(sf) || 0) + 1);
    }

    // Agrupar nuevos por firma estricta
    const newByStrict = new Map();
    for (const tx of newTxs) {
        const ss = tx.strictSignature || getStrictSignature(tx);
        if (!newByStrict.has(ss)) newByStrict.set(ss, []);
        newByStrict.get(ss).push(tx);
    }

    // Conceptos especiales que SIEMPRE permitimos duplicar (pagos recurrentes
    // que BBVA marca con el mismo concepto exacto). Históricamente la lista
    // se mantenía hardcoded en handlers.js; la dejamos aquí como configuración.
    const SPECIAL_RECURRING = ['su pago en efectivo', 'pay pal*facebook'];
    const isSpecial = (concept) => {
        const lower = normalizeConcept(concept);
        return SPECIAL_RECURRING.some(k => lower.includes(k));
    };

    const newUnique = [];
    const intraFileDuplicates = [];
    const existingExact = [];

    for (const [ss, group] of newByStrict.entries()) {
        const first = group[0];
        const inDB = existingByStrict.has(ss);

        if (isSpecial(first.concept)) {
            // Permitir todas las copias para movimientos recurrentes conocidos.
            // Aún así, si todas ya están en DB las marcamos como omitidas.
            if (inDB) {
                group.forEach(tx => existingExact.push({ expense: tx, sig: ss }));
            } else {
                group.forEach(tx => newUnique.push(tx));
            }
            continue;
        }

        if (inDB) {
            group.forEach(tx => existingExact.push({ expense: tx, sig: ss }));
        } else {
            newUnique.push(first);
            for (let i = 1; i < group.length; i++) {
                intraFileDuplicates.push({
                    expense: group[i],
                    sig: ss,
                    copyIndex: i + 1,
                    totalCopies: group.length
                });
            }
        }
    }

    // Detectar suspects: entre los movimientos que SÍ vamos a importar (newUnique)
    // ver cuáles comparten softSignature con otros (entre los nuevos o ya en DB).
    const newBySoft = new Map();
    for (const tx of newUnique) {
        const sf = tx.softSignature || getSoftSignature(tx);
        if (!newBySoft.has(sf)) newBySoft.set(sf, []);
        newBySoft.get(sf).push(tx);
    }

    const suspectRepeated = [];
    for (const [sf, txs] of newBySoft.entries()) {
        const existingPeers = existingBySoft.get(sf) || 0;
        const totalPeers = existingPeers + txs.length;
        if (totalPeers > 1) {
            txs.forEach(tx => {
                tx.duplicateStatus = 'suspect_repeated';
                suspectRepeated.push({ expense: tx, sig: sf, peers: totalPeers });
            });
        }
    }

    return { newUnique, intraFileDuplicates, existingExact, suspectRepeated };
}

// ---------------------------------------------------------------------------
//  Conciliación bancaria
// ---------------------------------------------------------------------------

/**
 * Calcula el saldo esperado a partir de un saldo inicial y una lista de
 * movimientos: saldo + Σ abonos − Σ cargos.
 *
 * @param {Array<{ charge:number, credit:number }>} transactions
 * @param {number} openingBalance
 * @returns {{ openingBalance:number, totalCharges:number, totalCredits:number, expectedBalance:number, count:number }}
 */
export function calculateExpectedBalance(transactions, openingBalance = 0) {
    let totalCharges = 0;
    let totalCredits = 0;
    for (const t of transactions) {
        totalCharges += Number(t.charge) || 0;
        totalCredits += Number(t.credit) || 0;
    }
    const expectedBalance = (Number(openingBalance) || 0) + totalCredits - totalCharges;
    return {
        openingBalance: Number(openingBalance) || 0,
        totalCharges,
        totalCredits,
        expectedBalance,
        count: transactions.length
    };
}

/**
 * Compara saldo esperado vs saldo real BBVA.
 *
 * @param {number} expectedBalance
 * @param {number} realBalance
 * @param {number} [tolerance=0.01]  diferencia menor a esto se considera conciliado
 * @returns {{ expectedBalance:number, realBalance:number, difference:number, isReconciled:boolean }}
 */
export function reconcileBalance(expectedBalance, realBalance, tolerance = 0.01) {
    const exp = Number(expectedBalance) || 0;
    const real = Number(realBalance) || 0;
    const difference = real - exp;
    return {
        expectedBalance: exp,
        realBalance: real,
        difference,
        isReconciled: Math.abs(difference) <= tolerance
    };
}

// ---------------------------------------------------------------------------
//  Utilidades (hash de archivo, IDs de lote)
// ---------------------------------------------------------------------------

/**
 * Genera un ID corto para un lote de importación. No es criptográfico; solo
 * sirve para correlacionar movimientos del mismo XLS.
 * @returns {string}
 */
export function generateImportBatchId() {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);
    return `imp_${t}_${r}`;
}

/**
 * Calcula SHA-256 del contenido del archivo (ArrayBuffer) y devuelve hex.
 * Fallback a un hash débil si el navegador no soporta SubtleCrypto.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<string>}
 */
export async function computeFileHash(arrayBuffer) {
    try {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuffer);
            const arr = Array.from(new Uint8Array(hashBuf));
            return arr.map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (_) { /* fall through */ }

    // Fallback: hash débil (Java hashCode) sobre la longitud + primeros bytes.
    // Suficiente para distinguir archivos en uso casual pero no criptográfico.
    const view = new Uint8Array(arrayBuffer);
    let hash = view.length | 0;
    const step = Math.max(1, Math.floor(view.length / 4096));
    for (let i = 0; i < view.length; i += step) {
        hash = ((hash << 5) - hash) + view[i];
        hash |= 0;
    }
    return 'fb_' + (hash >>> 0).toString(16);
}
