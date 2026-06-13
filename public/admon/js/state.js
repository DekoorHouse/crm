/**
 * @file Módulo para la gestión del estado de la aplicación.
 */

const today = new Date();
const currentYear = today.getUTCFullYear();
const currentMonthIndex = today.getUTCMonth(); 

// Inicializar con fechas en UTC puro
const firstDayOfMonth = new Date(Date.UTC(currentYear, currentMonthIndex, 1));
const lastDayOfMonth = new Date(Date.UTC(currentYear, currentMonthIndex + 1, 0));

export const elements = {};

export const state = {
  expenses: [],
  manualCategories: new Map(),
  subcategories: {},
  customCategories: [],
  
  dateFilter: { 
    start: firstDayOfMonth, 
    end: lastDayOfMonth 
  },
  
  activeMonth: { 
    month: currentMonthIndex, 
    year: currentYear 
  },

  categoryFilter: 'all',
  sueldosData: [],
  sueldosDateFilter: { start: null, end: null },
  checadorEmployees: [],
  checadorLogs: [],
  checadorAdjustments: [],
  sueldosPeriod: 'semanal',
  sueldosAdjCurrentName: '',
  sueldosAdjCurrentType: 'bono',
  sueldosVacCurrentDocId: '',
  sueldosVacCurrentName: '',
  kpiMonth: '', // YYYY-MM (vacío = mes actual)
  sueldosDetailCurrentName: '',
  sueldosEditLogName: '',
  sueldosEditLogEmpId: '',
  sueldosEditLogDate: '', // formato DD/MM/YYYY
  sueldosEditLogEntries: [], // [{ _docId, type, time, isNew, isDeleted }]
  sueldosPinOnConfirm: null,
  financials: {
      dateFilter: { start: null, end: null }, 
      allOrders: [],
      totalOrdersCount: 0,
      paidOrdersCount: 0, 
      paidOrdersRevenue: 0,
      leadsChartTimeframe: 'daily',
  },
  kpis: [],
  monthlyLeads: {},
  monthlyPaidLeads: {},
  monthlyPaidRevenue: {},
  monthlyCancelledLeads: {},
  totalLeads: 0,

  /**
   * Configuración del saldo inicial de ajuste, usada para calcular el
   * "Saldo BBVA Estimado" en el Resumen:
   *   saldoBBVAEstimado = openingBalance + utilidadOperativa
   *
   * El valor real viene del documento Firestore `admin_data/balance_config`.
   * Si ese doc no existe, dejamos el fallback histórico (saldo previo conocido
   * al 2026-03-01) y marcamos `isConfigured = false` para que la UI muestre
   * un aviso "Configura saldo inicial".
   */
  balanceConfig: {
    openingBalance: 2471.45,
    openingDate: '2026-03-01',
    isConfigured: false,
    updatedAt: null
  },

  /**
   * Reglas de categorización por keyword, editables desde la UI (modal
   * "Reglas"). Vienen del doc Firestore `admin_data/categorization_rules`.
   * Formato: [{ keyword: 'jovita', category: 'Sueldos' }, ...] — el orden
   * del array es el orden de evaluación (primera que matchea gana).
   *
   * null = el doc no existe todavía → utils.js usa las reglas hardcodeadas
   * (DEFAULT_KEYWORD_RULES) como fallback. Imposible quedarse sin reglas.
   */
  categorizationRules: null,

  /**
   * Configuración de regiones para la pestaña Campañas. Viene del doc
   * Firestore `admin_data/campaign_regions`:
   *   { rules:[{keyword,region}], overrides:{campaignId:region}, defaultRegion }
   * null = no configurado → utils usa DEFAULT_REGION_RULES / 'Nacional'.
   */
  campaignRegions: null
};

export const charts = { 
  pieChart: null,
  categoryChart: null,
  compareChart: null,
  leadsTrendChart: null,
  incomeVsAdCostChart: null,
};

export let ordersUnsubscribe = null;

export function setOrdersUnsubscribe(newUnsubscribe) {
    ordersUnsubscribe = newUnsubscribe;
}

export const actionHistory = [];
export const app = {};