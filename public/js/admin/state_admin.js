/**
 * @file Módulo para la gestión del estado de la aplicación del panel de administración.
 * @description Centraliza todos los datos dinámicos, referencias a elementos del DOM
 * y variables de estado que la aplicación necesita para funcionar.
 */

/**
 * Almacena todas las referencias a los elementos del DOM cacheados para un acceso rápido.
 * Este objeto es poblado por la función `cacheElements` en `main_admin.js`.
 * @type {Object<string, HTMLElement>}
 */
export const elements = {};

/**
 * Contiene el estado dinámico de la aplicación, como los datos obtenidos de la base de datos
 * y los filtros seleccionados por el usuario.
 * @type {object}
 */
export const state = {
  expenses: [],
  manualCategories: new Map(), // Almacena categorías asignadas manualmente
  dateFilter: { start: null, end: null },
  categoryFilter: 'all',
  sueldosData: [],
  sueldosDateFilter: { start: null, end: null },
  kpis: [],
  financials: {
      dateFilter: { start: null, end: null }, 
      allOrders: [],
      totalOrdersCount: 0,
      paidOrdersCount: 0, 
      paidOrdersRevenue: 0,
      leadsChartTimeframe: 'daily',
  }
};

/**
 * Almacena las instancias de las gráficas de Chart.js para poder actualizarlas o destruirlas.
 * @type {object}
 */
export const charts = { 
  pieChart: null,
  categoryChart: null,
  compareChart: null,
  leadsTrendChart: null,
};

/**
 * Referencia a la función para cancelar la suscripción al listener de pedidos de Firestore.
 * Se utiliza para detener la escucha de cambios cuando ya no es necesaria.
 * @type {Function|null}
 */
export let ordersUnsubscribe = null;

/**
 * Permite establecer una nueva función de cancelación de suscripción.
 * @param {Function} newUnsubscribe La nueva función de cancelación.
 */
export function setOrdersUnsubscribe(newUnsubscribe) {
    ordersUnsubscribe = newUnsubscribe;
}

/**
 * Un array que almacena "instantáneas" del estado de los gastos antes de cada modificación.
 * Se utiliza para implementar la funcionalidad de "deshacer".
 * @type {Array<object>}
 */
export const actionHistory = [];

// FIX: Export the 'app' object to resolve the import error in other modules.
/**
 * The main application object, to be populated by the main script.
 * @type {object}
 */
export const app = {};

