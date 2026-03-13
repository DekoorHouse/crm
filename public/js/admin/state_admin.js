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