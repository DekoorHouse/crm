import './admin/firebase_admin.js'; // Import for initialization
import { app as appState, state, elements } from './admin/state_admin.js';
import * as utils from './admin/utils_admin.js';
import * as ui from './admin/ui-manager_admin.js';
import * as services from './admin/services_admin.js';
import * as charts from './admin/charts_admin.js';
import { initEventListeners } from './admin/handlers_admin.js';

/**
 * @file Punto de entrada y orquestador principal del panel de administración.
 * @description Este archivo reconstruye el objeto 'app' principal, delegando
 * la lógica a los módulos importados para mantener una estructura organizada.
 */

const app = {
    ...appState,
    state,
    elements,

    init() {
        try {
            this.cacheElements();
            initEventListeners(this);
            this.onFirebaseReady();
        } catch (error) {
            console.error("Error fatal durante la inicialización:", error);
            document.body.innerHTML = '<div style="text-align: center; padding: 50px;"><h1>Error</h1><p>Ocurrió un error al cargar la aplicación.</p></div>';
        }
    },

    cacheElements() {
        ui.cacheElements();
    },

    onFirebaseReady() {
        this.setupRealtimeListeners();
        this.initDateRangePicker();
        this.initHealthDateRangePicker();
        this.initSueldosDateRangePicker();
    },
    
    setupRealtimeListeners() {
        const onDataChange = () => {
            ui.populateCategoryFilter();
            this.renderData();
            this.renderSummary();
            this.renderAllCharts();
            this.renderFinancialHealth();
        };
        services.listenForExpenses(onDataChange);
        services.listenForManualCategories(onDataChange);
        services.listenForSueldos(() => this.onSueldosDataChange());
        services.setupOrdersListener(() => this.renderFinancialHealth());
        services.listenForAllTimeLeads(() => this.renderFinancialHealth());
        services.listenForKpis(() => this.renderKpis());
    },
    
    onSueldosDataChange() {
        utils.migrateSueldosDataStructure();
        utils.addManualEmployees();
        this.filterSueldos();
        elements.sueldosFilterCard.style.display = state.sueldosData.length > 0 ? 'block' : 'none';
        elements.sueldosEmptyState.style.display = state.sueldosData.length === 0 ? 'block' : 'none';
        elements.sueldosEmptyState.innerHTML = '<p>No se han cargado datos de nómina. Sube un archivo para empezar.</p>';
    },
    
    renderData() {
        const filteredExpenses = utils.getFilteredExpenses(false);
        ui.renderTable(filteredExpenses);
        ui.updateTableTotals(filteredExpenses);
        elements.emptyState.style.display = filteredExpenses.length === 0 ? 'block' : 'none';
    },

    renderSummary() {
        ui.updateSummary(() => utils.getFilteredExpenses(false));
    },

    renderAllCharts() {
        charts.updateAllCharts(() => utils.getFilteredExpenses(false));
    },

    renderFinancialHealth() {
        charts.updateFinancialHealthDashboard(() => utils.getFilteredExpenses(true));
    },

    renderKpis() {
        ui.renderKpisTable();
    },

    filterSueldos() {
        const employeesToDisplay = utils.filterSueldos();
        const isFiltered = !!(state.sueldosDateFilter.start && state.sueldosDateFilter.end);
        ui.renderSueldosData(employeesToDisplay, isFiltered);
    },

    resetSueldosFilter() {
        if (this.sueldosPicker) this.sueldosPicker.clearSelection();
        state.sueldosDateFilter.start = null;
        state.sueldosDateFilter.end = null;
        this.filterSueldos();
    },

    initDateRangePicker() {
        this.picker = ui.initDateRangePicker(() => {
            state.dateFilter.start = this.picker.getStartDate()?.dateInstance || null;
            state.dateFilter.end = this.picker.getEndDate()?.dateInstance || null;
            this.renderData();
            this.renderSummary();
            this.renderAllCharts();
        });
    },

    initHealthDateRangePicker() {
        this.healthPicker = ui.initHealthDateRangePicker(() => {
            state.financials.dateFilter.start = this.healthPicker.getStartDate()?.dateInstance || null;
            state.financials.dateFilter.end = this.healthPicker.getEndDate()?.dateInstance || null;
            services.setupOrdersListener(() => this.renderFinancialHealth());
        });
    },

    initSueldosDateRangePicker() {
        this.sueldosPicker = ui.initSueldosDateRangePicker(() => {
            state.sueldosDateFilter.start = this.sueldosPicker.getStartDate()?.dateInstance || null;
            state.sueldosDateFilter.end = this.sueldosPicker.getEndDate()?.dateInstance || null;
            this.filterSueldos();
        });
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());

