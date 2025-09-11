// Módulos de la aplicación
import { initFirebase } from './firebase_admin.js';
import { elements } from './state_admin.js';
import * as Handlers from './event-handlers_admin.js';

/**
 * @namespace app
 * @description El objeto principal que encapsula la lógica de la aplicación del panel de administración.
 */
const app = {
  
  /**
   * Inicializa la aplicación.
   * Se encarga de cachear los elementos del DOM, configurar los listeners de eventos
   * e iniciar la conexión con Firebase.
   */
  init() {
    try {
        this.cacheElements();
        this.initEventListeners();
        initFirebase();
    } catch (error) {
        console.error("Error fatal durante la inicialización:", error);
        document.body.innerHTML = '<div style="text-align: center; padding: 50px;"><h1>Error</h1><p>Ocurrió un error al cargar la aplicación. Por favor, intente recargar la página.</p></div>';
    }
  },

  /**
   * Selecciona y almacena las referencias a los elementos del DOM para un acceso rápido.
   * Los elementos se guardan en el objeto `elements` importado desde `state_admin.js`.
   */
  cacheElements() {
    elements.uploadBtn = document.getElementById('upload-btn');
    elements.uploadInput = document.getElementById('file-upload-input');
    elements.dataTableBody = document.querySelector('#data-table tbody');
    elements.dataTableFooter = document.querySelector('#data-table tfoot');
    elements.emptyState = document.getElementById('empty-state');
    elements.summarySection = document.querySelector('.summary-section');
    elements.modal = document.getElementById('modal');
    elements.modalTitle = document.getElementById('modal-title');
    elements.modalBody = document.getElementById('modal-body');
    elements.modalConfirmBtn = document.getElementById('modal-confirm-btn');
    elements.modalCancelBtn = document.getElementById('modal-cancel-btn');
    elements.tabs = document.querySelectorAll('.tab');
    elements.tabContents = document.querySelectorAll('.tab-content');
    elements.addManualBtn = document.getElementById('add-manual-btn');
    elements.addFinancialBtn = document.getElementById('add-financial-btn');
    elements.deleteDataBtn = document.getElementById('delete-data-btn');
    elements.deleteCurrentMonthBtn = document.getElementById('delete-current-month-btn');
    elements.deletePreviousMonthBtn = document.getElementById('delete-previous-month-btn');
    elements.exportBtn = document.getElementById('export-btn');
    elements.removeDuplicatesBtn = document.getElementById('remove-duplicates-btn'); 
    elements.dateRangeFilter = document.getElementById('date-range-filter');
    elements.categoryFilter = document.getElementById('category-filter');
    elements.actionsContainer = document.getElementById('actions-container');
    elements.dataTableContainer = document.getElementById('data-table-container');
    elements.chartContexts = {
        pie: document.getElementById("pieChart")?.getContext("2d"),
        category: document.getElementById("categoryChart")?.getContext("2d"),
        compare: document.getElementById("compareChart")?.getContext("2d"),
        leadsTrend: document.getElementById("leadsTrendChart")?.getContext("2d"),
    };
    
    // Sueldos tab elements
    elements.addEmployeeBtn = document.getElementById('add-employee-btn');
    elements.sueldosUploadBtn = document.getElementById('sueldos-upload-btn');
    elements.sueldosUploadInput = document.getElementById('sueldos-file-upload-input');
    elements.sueldosTableContainer = document.getElementById('sueldos-table-container');
    elements.sueldosEmptyState = document.getElementById('sueldos-empty-state');
    elements.sueldosFilterCard = document.getElementById('sueldos-filter-card');
    elements.sueldosDateRangeFilter = document.getElementById('sueldos-date-range-filter');
    elements.resetSueldosFilterBtn = document.getElementById('reset-sueldos-filter-btn');
    elements.closeWeekBtn = document.getElementById('close-week-btn');
    elements.deleteSueldosBtn = document.getElementById('delete-sueldos-btn');

    // Financial Health elements
    elements.healthDateRangeFilter = document.getElementById('health-date-range-filter');
    elements.resetHealthFilterBtn = document.getElementById('reset-health-filter-btn');
    elements.leadsChartToggle = document.getElementById('leads-chart-toggle');
    elements.leadsChartTitle = document.getElementById('leads-chart-title');
    elements.thermometerBar = document.getElementById('thermometer-bar');
    elements.thermometerPercentage = document.getElementById('thermometer-percentage');
    elements.kpiTotalRevenue = document.getElementById('kpi-total-revenue');
    elements.kpiSalesRevenue = document.getElementById('kpi-sales-revenue');
    elements.kpiCosts = document.getElementById('kpi-costs');
    elements.kpiOperatingProfit = document.getElementById('kpi-operating-profit');
    elements.kpiOwnerDraw = document.getElementById('kpi-owner-draw');
    elements.kpiNetProfit = document.getElementById('kpi-net-profit');
    elements.kpiLeads = document.getElementById('kpi-leads');
    elements.kpiPaidOrders = document.getElementById('kpi-paid-orders');
    elements.kpiAvgTicketSales = document.getElementById('kpi-avg-ticket-sales');
    elements.kpiConversionRate = document.getElementById('kpi-conversion-rate');
  },

  /**
   * Asigna los manejadores de eventos a los elementos del DOM.
   * Utiliza funciones importadas desde `event-handlers_admin.js`.
   */
  initEventListeners() {
    elements.uploadInput.addEventListener('change', (e) => Handlers.handleFileUpload(e));
    elements.uploadBtn.addEventListener('click', () => elements.uploadInput.click());
    elements.tabs.forEach(tab => tab.addEventListener('click', (e) => Handlers.handleTabClick(e.currentTarget)));
    elements.addManualBtn.addEventListener('click', () => Handlers.openExpenseModal());
    elements.addFinancialBtn.addEventListener('click', () => Handlers.openFinancialModal());
    elements.deleteDataBtn.addEventListener('click', () => Handlers.confirmDeleteAllData());
    elements.deleteCurrentMonthBtn.addEventListener('click', () => Handlers.confirmDeleteCurrentMonth());
    elements.deletePreviousMonthBtn.addEventListener('click', () => Handlers.confirmDeletePreviousMonth());
    elements.exportBtn.addEventListener('click', () => Handlers.exportToExcel());
    elements.removeDuplicatesBtn.addEventListener('click', () => Handlers.confirmRemoveDuplicates());
    elements.categoryFilter.addEventListener('change', Handlers.handleCategoryFilterChange);
    
    elements.modal.addEventListener('click', (e) => Handlers.handleModalClick(e));

    window.addEventListener('keydown', (e) => Handlers.handleKeyDown(e));

    elements.addEmployeeBtn.addEventListener('click', () => Handlers.openAddEmployeeModal());
    elements.sueldosUploadBtn.addEventListener('click', () => elements.sueldosUploadInput.click());
    elements.sueldosUploadInput.addEventListener('change', (e) => Handlers.handleSueldosFileUpload(e));
    elements.resetSueldosFilterBtn.addEventListener('click', () => Handlers.resetSueldosFilter());
    elements.closeWeekBtn.addEventListener('click', () => Handlers.confirmCloseWeek());
    elements.deleteSueldosBtn.addEventListener('click', () => Handlers.confirmDeleteSueldosData());

    // Financial Health Listeners
    elements.resetHealthFilterBtn.addEventListener('click', () => Handlers.resetHealthFilter());
    elements.leadsChartToggle.addEventListener('click', (e) => Handlers.handleLeadsChartToggle(e));
  },
};

// Inicia la aplicación una vez que el contenido del DOM está completamente cargado.
document.addEventListener('DOMContentLoaded', () => app.init());
