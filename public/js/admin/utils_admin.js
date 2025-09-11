import { state } from './state_admin.js';

/**
 * @file Módulo de funciones de utilidad para la aplicación de administración.
 * @description Contiene funciones puras y reutilizables para tareas comunes como
 * formateo de datos, cálculos y categorización automática.
 */

/**
 * Formatea un número como una cadena de moneda en formato MXN.
 * @param {number} amount - La cantidad numérica a formatear.
 * @returns {string} La cantidad formateada como moneda (ej. "$1,234.50").
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
}

/**
 * Convierte la primera letra de una cadena a mayúscula.
 * @param {string} str - La cadena de texto a capitalizar.
 * @returns {string} La cadena con la primera letra en mayúscula.
 */
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Genera una firma única para un registro de gasto basada en sus propiedades clave.
 * Se utiliza para detectar duplicados.
 * @param {object} expense - El objeto de gasto.
 * @returns {string} Una cadena que representa la firma única del gasto.
 */
export function getExpenseSignature(expense) {
  const concept = (expense.concept || '').trim();
  const charge = parseFloat(expense.charge) || 0;
  const credit = parseFloat(expense.credit) || 0;
  return `${expense.date}|${concept}|${charge}|${credit}`;
}

/**
 * Genera un código hash numérico a partir de una cadena.
 * Se utiliza para crear IDs de documentos predecibles para las categorías manuales.
 * @param {string} str - La cadena de entrada.
 * @returns {string} El código hash generado como una cadena.
 */
export function hashCode(str) {
  let hash = 0;
  if (str.length === 0) return String(hash);
  for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
  }
  return String(hash);
}

/**
 * Calcula la diferencia en minutos entre una hora de entrada y una de salida.
 * @param {string} entrada - La hora de entrada (ej. "09:00").
 * @param {string} salida - La hora de salida (ej. "17:30").
 * @returns {number} El número total de minutos trabajados.
 */
export function calculateMinutesFromEntryExit(entrada, salida) {
  if (!entrada || !salida) return 0;
  
  const timePattern = /\d{1,2}:\d{2}/;
  const entradaMatch = entrada.match(timePattern);
  const salidaMatch = salida.match(timePattern);

  if (!entradaMatch || !salidaMatch) return 0;

  const [startH, startM] = entradaMatch[0].split(':').map(Number);
  const [endH, endM] = salidaMatch[0].split(':').map(Number);
  
  if ([startH, startM, endH, endM].some(isNaN)) return 0;

  const startTotalMinutes = startH * 60 + startM;
  const endTotalMinutes = endH * 60 + endM;

  return endTotalMinutes >= startTotalMinutes ? endTotalMinutes - startTotalMinutes : 0;
}

/**
 * Categoriza un gasto automáticamente, priorizando las categorías manuales sobre las reglas.
 * @param {string} concept - El concepto del gasto a categorizar.
 * @returns {string} La categoría asignada o 'SinCategorizar'.
 */
export function autoCategorize(concept) {
    const lowerConcept = concept.toLowerCase();
    if (state.manualCategories.has(lowerConcept)) {
        return state.manualCategories.get(lowerConcept);
    }
    return autoCategorizeWithRulesOnly(concept);
}

/**
 * Categoriza un gasto basándose únicamente en un conjunto de reglas predefinidas.
 * @param {string} concept - El concepto del gasto a categorizar.
 * @returns {string} La categoría asignada según las reglas, o 'SinCategorizar'.
 */
export function autoCategorizeWithRulesOnly(concept) {
    const lowerConcept = concept.toLowerCase();
    const rules = {
        Chris: ['chris', 'moises', 'wm max llc', 'stori', 'jessica', 'yannine', 'recargas y paquetes bmov / ******6530', 'recargas y paquetes bmov / ******7167'], 
        Alex: ['alex', 'bolt'], 
        Publicidad: ['facebook'],
        Material: ['material', 'raza', 'c00008749584'], 
        Envios: ['guias'], 
        Sueldos: ['diego', 'catalina', 'rosario', 'erika', 'catarina', 'maria gua', 'karla', 'lupita', 'recargas y paquetes bmov / ******0030'],
        Tecnologia: ['openai', 'claude', 'whaticket', 'hostinger'], 
        Local: ['local', 'renta', 'valeria'], 
        Deudas: ['saldos vencidos'], 
        Devoluciones: ['devolucion'],
        GastosFinancieros: ['interes', 'comision']
    };
    for (const category in rules) {
        if (rules[category].some(keyword => lowerConcept.includes(keyword))) return category;
    }
    return 'SinCategorizar';
}
