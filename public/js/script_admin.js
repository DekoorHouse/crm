import { elements, state } from './state_admin.js';
import * as utils from './utils_admin.js';
import * as ui from './ui-manager_admin.js';
import * as services from './services_admin.js';
import * as charts from './charts_admin.js';
import { initEventListeners } from './handlers_admin.js';
import { auth } from './firebase_admin.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/**
 * @file Punto de entrada y orquestador principal del panel de administración.
 * @description Este archivo reconstruye el objeto 'app' principal, delegando
 * la lógica a los módulos importados para mantener una estructura organizada.
 */

const app = {
    // Propiedades de estado y referencias
    state,
    elements,
    isInitialized: false, // Bandera para prevenir inicializaciones múltiples

    // Método principal de inicialización
    init() {
        this.handleAuthState();
    },

    // Maneja los cambios en el estado de autenticación
    handleAuthState() {
        onAuthStateChanged(auth, user => {
            const loginSection = document.getElementById('login-section');
            const adminPanel = document.getElementById('admin-panel');

            if (user) {
                if (loginSection) loginSection.style.display = 'none';
                if (adminPanel) adminPanel.style.display = 'block';
                
                const userEmailDisplay = document.getElementById('user-email');
                if(userEmailDisplay) userEmailDisplay.textContent = user.email;

                // Inicializa la lógica principal de la app solo una vez
                if (!this.isInitialized) {
                    this.initializeAppLogic();
                    this.isInitialized = true;
                }
                
                const logoutBtn = document.getElementById('logout-btn');
                if (logoutBtn) {
                    // Previene listeners duplicados
                    logoutBtn.replaceWith(logoutBtn.cloneNode(true));
                    document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
                }

            } else {
                // Si no hay usuario, muestra el login
                if (loginSection) loginSection.style.display = 'flex';
                if (adminPanel) adminPanel.style.display = 'none';
                
                const loginForm = document.getElementById('login-form');
                if(loginForm) {
                    // Asigna el evento de login
                    const boundLoginHandler = this.handleLogin.bind(this);
                    loginForm.addEventListener('submit', boundLoginHandler);
                }
                this.isInitialized = false; // Resetea para el próximo inicio de sesión
            }
        });
    },

    // Maneja el envío del formulario de login
    handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const errorMessage = document.getElementById('login-error-message');
        const submitButton = e.target.querySelector('button[type="submit"]');

        if(errorMessage) errorMessage.textContent = '';
        if(submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ingresando...';
        }

        signInWithEmailAndPassword(auth, email, password)
            .catch(error => {
                let friendlyMessage = 'Ocurrió un error.';
                switch (error.code) {
                    case 'auth/user-not-found':
                    case 'auth/wrong-password':
                    case 'auth/invalid-credential':
                        friendlyMessage = 'Correo o contraseña incorrectos.';
                        break;
                    case 'auth/invalid-email':
                        friendlyMessage = 'El formato del correo es incorrecto.';
                        break;
                    default:
                        friendlyMessage = 'Error al intentar iniciar sesión.';
                        console.error("Login Error:", error);
                }
                if(errorMessage) errorMessage.textContent = friendlyMessage;
            })
            .finally(() => {
                if(submitButton) {
                    submitButton.disabled = false;
                    submitButton.innerHTML = 'Ingresar';
                }
            });
    },
    
    // Lógica central de la aplicación que se ejecuta tras una autenticación exitosa
    initializeAppLogic() {
        try {
            this.cacheElements();
            initEventListeners(this);
            this.onFirebaseReady();
        } catch (error) {
            console.error("Error fatal durante la inicialización de la lógica de la aplicación:", error);
            const adminPanel = document.getElementById('admin-panel');
            if(adminPanel) adminPanel.innerHTML = '<div style="text-align: center; padding: 50px;"><h1>Error</h1><p>Ocurrió un error al cargar los componentes de la aplicación. Por favor, intente recargar la página.</p></div>';
        }
    },
    
    cacheElements() { ui.cacheElements(); },

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
            this.renderKpis();
        };
        services.listenForExpenses(onDataChange);
        services.listenForManualCategories(onDataChange);
        services.listenForSueldos(() => this.onSueldosDataChange());
        services.listenForKpis(onDataChange);
        services.listenForAllPedidos();
        services.setupOrdersListener(() => this.renderFinancialHealth());
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
        ui.renderKpiTable(state.kpis);
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
        if (this.picker) this.picker.destroy();
        this.picker = ui.initDateRangePicker(() => {
            state.dateFilter.start = this.picker.getStartDate()?.dateInstance || null;
            state.dateFilter.end = this.picker.getEndDate()?.dateInstance || null;
            this.renderData();
            this.renderSummary();
            this.renderAllCharts();
        });
    },

    initHealthDateRangePicker() {
        if (this.healthPicker) this.healthPicker.destroy();
        this.healthPicker = ui.initHealthDateRangePicker(() => {
            state.financials.dateFilter.start = this.healthPicker.getStartDate()?.dateInstance || null;
            state.financials.dateFilter.end = this.healthPicker.getEndDate()?.dateInstance || null;
            services.setupOrdersListener(() => this.renderFinancialHealth());
        });
    },

    initSueldosDateRangePicker() {
        if (this.sueldosPicker) this.sueldosPicker.destroy();
        this.sueldosPicker = ui.initSueldosDateRangePicker(() => {
            state.sueldosDateFilter.start = this.sueldosPicker.getStartDate()?.dateInstance || null;
            state.sueldosDateFilter.end = this.sueldosPicker.getEndDate()?.dateInstance || null;
            this.filterSueldos();
        });
    }
};

// Punto de entrada de la aplicación
app.init();

