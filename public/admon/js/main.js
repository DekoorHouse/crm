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

        ui.renderSueldosData();

        if (elements.sueldosAdjModal && elements.sueldosAdjModal.style.display === 'flex') {
            ui.renderSueldosAdjExisting();
        }

        if (elements.sueldosDetailModal && elements.sueldosDetailModal.style.display === 'flex') {
            ui.renderSueldosDetailBody();
        }

        ui.renderKpisTable();
    };

    services.listenForExpenses(onDataChange);
    services.listenForManualCategories(onDataChange);
    services.listenForCustomCategories(onDataChange);
    services.listenForSubcategories(onDataChange);
    services.listenForSueldos(onDataChange);
    services.listenForChecadorEmployees(onDataChange);
    services.listenForChecadorLogs(onDataChange);
    services.listenForChecadorAdjustments(onDataChange);
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

    onDataChange();
}

const app = {
  picker: null,
  healthPicker: null,

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

  handleSueldosDateFilterChange() {
      // No longer used - period toggle handles this
  }
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());