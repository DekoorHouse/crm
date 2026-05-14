/**
 * @file js/config.js
 * @description Configuración runtime de la app: principalmente el "modo
 *              prueba", que enruta TODAS las lecturas/escrituras de Firestore
 *              hacia colecciones con sufijo `_test` (p.ej. `expenses_test`,
 *              `balance_checkpoints_test`), dejando las colecciones reales
 *              de producción intactas.
 *
 *  Cómo activarlo:
 *    1. URL: añade `?testMode=1` (queda persistente vía localStorage).
 *    2. Programáticamente: `setTestMode(true)` desde la consola.
 *    3. UI: botón "Modo Prueba" en el header (lo agrega ui-manager).
 *
 *  Cómo salir:
 *    1. URL: `?testMode=0` (limpia localStorage).
 *    2. UI: click en el banner amarillo "MODO PRUEBA → Salir".
 *    3. Consola: `setTestMode(false)`.
 *
 *  IMPORTANTE: si activas el modo prueba, los listeners de Firestore se
 *  reapuntan al recargar la página. Por eso el helper `setTestMode()` también
 *  recarga la URL.
 */

const TEST_MODE_KEY = 'admonTestMode';
const TEST_SUFFIX = '_test';

// Colecciones que SÍ migran al modo test. El resto (sueldos, kpis, pedidos,
// manualCategories, etc.) se mantiene en producción para no duplicar
// configuración. Sólo aislamos lo que toca el flujo de revisión.
const TEST_COLLECTIONS = new Set([
    'expenses',
    'balance_checkpoints'
]);

let _testMode = false;

// Inicialización: ejecutar una sola vez al importar el módulo.
(function initFromEnvironment() {
    if (typeof window === 'undefined') return;

    // 1. Query string tiene la última palabra.
    const match = window.location.search.match(/[?&]testMode=([01])/);
    if (match) {
        _testMode = match[1] === '1';
        try {
            if (_testMode) localStorage.setItem(TEST_MODE_KEY, '1');
            else           localStorage.removeItem(TEST_MODE_KEY);
        } catch (_) { /* ignore */ }
        return;
    }

    // 2. Persistencia previa en localStorage.
    try {
        _testMode = localStorage.getItem(TEST_MODE_KEY) === '1';
    } catch (_) {
        _testMode = false;
    }
})();

/**
 * @returns {boolean} true si la app está corriendo en modo prueba.
 */
export function isTestMode() {
    return _testMode;
}

/**
 * Activa o desactiva el modo prueba. Por defecto recarga la página para que
 * los listeners de Firestore se re-suscriban a la colección correcta.
 *
 * @param {boolean} value
 * @param {{ reload?:boolean }} [opts]
 */
export function setTestMode(value, opts = {}) {
    const reload = opts.reload !== false;  // default true
    _testMode = !!value;
    try {
        if (_testMode) localStorage.setItem(TEST_MODE_KEY, '1');
        else           localStorage.removeItem(TEST_MODE_KEY);
    } catch (_) { /* ignore */ }

    if (reload && typeof window !== 'undefined') {
        // Limpia el parámetro testMode de la URL para evitar conflictos.
        const url = new URL(window.location.href);
        url.searchParams.delete('testMode');
        window.location.replace(url.toString());
    }
}

/**
 * Devuelve el nombre real de la colección Firestore que debemos usar dado el
 * modo actual. Aísla SÓLO las colecciones que figuran en TEST_COLLECTIONS;
 * el resto pasa sin cambios.
 *
 * @param {string} base nombre de la colección de producción
 * @returns {string} nombre efectivo
 */
export function collectionName(base) {
    if (!_testMode) return base;
    return TEST_COLLECTIONS.has(base) ? `${base}${TEST_SUFFIX}` : base;
}

/**
 * Util para escribir banners/avisos.
 * @returns {{ testMode:boolean, isolatedCollections:string[] }}
 */
export function describeMode() {
    return {
        testMode: _testMode,
        isolatedCollections: [...TEST_COLLECTIONS].map(c => _testMode ? `${c}${TEST_SUFFIX}` : c)
    };
}

// Expone para debug desde la consola.
if (typeof window !== 'undefined') {
    window.__admonConfig = { isTestMode, setTestMode, collectionName, describeMode };
}
