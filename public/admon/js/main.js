// Módulos de la aplicación
import { initFirebase } from './firebase.js';
import * as ui from './ui-manager.js';
import * as Handlers from './handlers.js';
import * as services from './services.js';
import * as charts from './charts.js';
import * as utils from './utils.js';
import { state, elements } from './state.js';

function initializeAppUI() {
    console.log("Usuario autenticado. Inicializando UI...");

    const onDataChange = () => {
        const filtered = utils.getFilteredExpenses();
        
        if (state.expenses.length > 0) {
            ui.renderTable(filtered);
            ui.updateTableTotals(filtered);
            ui.populateCategoryFilter();
            elements.emptyState.style.display = 'none';
            elements.dataTableContainer.style.display = 'block';
        } else {
            elements.emptyState.style.display = 'block';
            elements.dataTableContainer.style.display = 'none';
        }
        
        ui.updateSummary(utils.getFilteredExpenses);
        charts.updateAllCharts(utils.getFilteredExpenses);
        charts.updateFinancialHealthDashboard(utils.getFilteredExpenses);

        if (state.sueldosData.length > 0) {
             elements.sueldosEmptyState.style.display = 'none';
             elements.sueldosFilterCard.style.display = 'block';
             const filteredSueldos = utils.filterSueldos();
             ui.renderSueldosData(filteredSueldos, !!(state.sueldosDateFilter.start && state.sueldosDateFilter.end));
        } else {
            elements.sueldosEmptyState.style.display = 'block';
            elements.sueldosFilterCard.style.display = 'none';
            ui.renderSueldosData([]);
        }

        ui.renderKpisTable();
    };

    services.listenForExpenses(onDataChange);
    services.listenForManualCategories(onDataChange);
    services.listenForSubcategories(onDataChange);
    services.listenForSueldos(onDataChange);
    services.listenForKpis(onDataChange);
    services.listenForMonthlyLeads(onDataChange);
    services.listenForMonthlyPaidLeads(onDataChange);
    services.listenForMonthlyCancelledLeads(onDataChange);
    services.listenForAllTimeLeads();
    services.setupOrdersListener(onDataChange);
    services.listenForNotes(ui.renderNotes);

    ui.renderMonthFilter();
    
    app.picker = ui.initDateRangePicker(() => app.handleDateFilterChange(app.picker));
    app.healthPicker = ui.initHealthDateRangePicker(() => app.handleHealthDateFilterChange(app.healthPicker));
    app.sueldosPicker = ui.initSueldosDateRangePicker(() => app.handleSueldosDateFilterChange(app.sueldosPicker));

    onDataChange();
}

const app = {
  picker: null,
  healthPicker: null,
  sueldosPicker: null,

  init() {
    try {
        ui.cacheElements();
        ui.initDarkMode(); // Inicializar el Dark Mode
        Handlers.initEventListeners();
        initFirebase(initializeAppUI);
        
        // Registrar Service Worker para PWA
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('SW registrado con éxito:', registration);
            })
            .catch(error => {
                console.log('Fallo el registro del SW:', error);
            });
        }
    } catch (error) {
        console.error("Error fatal:", error);
    }
  },

  renderData: () => {
      const filtered = utils.getFilteredExpenses();
      ui.renderTable(filtered);
      ui.updateTableTotals(filtered);
  },
  renderSummary: () => ui.updateSummary(utils.getFilteredExpenses),
  renderAllCharts: () => charts.updateAllCharts(utils.getFilteredExpenses),

  /**
   * Maneja el cambio de fecha principal.
   * MEJORA: Asegurar que el objeto Date es limpio de horas locales.
   */
  handleDateFilterChange(picker) {
      const start = picker.getStartDate();
      const end = picker.getEndDate();

      if (start && end) {
          // Normalizar a UTC para evitar desfases por hora local del navegador
          state.dateFilter.start = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
          state.dateFilter.end = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()));
          
          state.activeMonth = null;
          ui.renderMonthFilter();
          this.renderData();
          this.renderSummary();
          this.renderAllCharts();
      }
  },
  
  handleHealthDateFilterChange(picker) {
      const start = picker.getStartDate();
      const end = picker.getEndDate();
      if (start && end) {
          state.financials.dateFilter.start = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
          state.financials.dateFilter.end = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()));
      } else {
           state.financials.dateFilter.start = null;
           state.financials.dateFilter.end = null;
      }
      services.setupOrdersListener(initializeAppUI);
  },

  handleSueldosDateFilterChange(picker) {
      const start = picker.getStartDate();
      const end = picker.getEndDate();
      if (start && end) {
          state.sueldosDateFilter.start = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
          state.sueldosDateFilter.end = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()));
      }
      initializeAppUI();
  },

  resetSueldosFilter() {
      if (app.sueldosPicker) app.sueldosPicker.clearSelection();
      state.sueldosDateFilter = { start: null, end: null };
      initializeAppUI();
  }
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());