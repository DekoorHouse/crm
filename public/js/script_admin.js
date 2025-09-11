import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, doc, addDoc, getDocs, writeBatch, onSnapshot, updateDoc, deleteDoc, query, where, setDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
    authDomain: "pedidos-con-gemini.firebaseapp.com",
    projectId: "pedidos-con-gemini",
    storageBucket: "pedidos-con-gemini.appspot.com",
    messagingSenderId: "300825194175",
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a",
    measurementId: "G-FTCDCMZB1S"
};

const app = {
  db: null,
  auth: null,
  picker: null,
  healthPicker: null, 
  sueldosPicker: null, 
  ordersUnsubscribe: null,
  actionHistory: [], 
  state: {
    expenses: [],
    manualCategories: new Map(), // To store manual categories
    dateFilter: { start: null, end: null },
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
    }
  },
  charts: { 
    pieChart: null,
    categoryChart: null,
    compareChart: null,
    leadsTrendChart: null,
  },
  elements: {},
  
  init() {
    try {
        this.cacheElements();
        this.initEventListeners();
        this.initFirebase();
    } catch (error) {
        console.error("Error fatal durante la inicialización:", error);
        document.body.innerHTML = '<div style="text-align: center; padding: 50px;"><h1>Error</h1><p>Ocurrió un error al cargar la aplicación. Por favor, intente recargar la página.</p></div>';
    }
  },

  cacheElements() {
    this.elements = {
        // General elements
        uploadBtn: document.getElementById('upload-btn'),
        uploadInput: document.getElementById('file-upload-input'),
        dataTableBody: document.querySelector('#data-table tbody'),
        dataTableFooter: document.querySelector('#data-table tfoot'),
        emptyState: document.getElementById('empty-state'),
        summarySection: document.querySelector('.summary-section'),
        modal: document.getElementById('modal'),
        modalTitle: document.getElementById('modal-title'),
        modalBody: document.getElementById('modal-body'),
        modalConfirmBtn: document.getElementById('modal-confirm-btn'),
        modalCancelBtn: document.getElementById('modal-cancel-btn'),
        tabs: document.querySelectorAll('.tab'),
        tabContents: document.querySelectorAll('.tab-content'),
        addManualBtn: document.getElementById('add-manual-btn'),
        addFinancialBtn: document.getElementById('add-financial-btn'),
        deleteDataBtn: document.getElementById('delete-data-btn'),
        deleteCurrentMonthBtn: document.getElementById('delete-current-month-btn'),
        deletePreviousMonthBtn: document.getElementById('delete-previous-month-btn'), // New button
        exportBtn: document.getElementById('export-btn'),
        removeDuplicatesBtn: document.getElementById('remove-duplicates-btn'), 
        dateRangeFilter: document.getElementById('date-range-filter'),
        categoryFilter: document.getElementById('category-filter'),
        actionsContainer: document.getElementById('actions-container'),
        dataTableContainer: document.getElementById('data-table-container'),
        chartContexts: {
            pie: document.getElementById("pieChart")?.getContext("2d"),
            category: document.getElementById("categoryChart")?.getContext("2d"),
            compare: document.getElementById("compareChart")?.getContext("2d"),
            leadsTrend: document.getElementById("leadsTrendChart")?.getContext("2d"),
        },
        
        // Sueldos tab elements
        addEmployeeBtn: document.getElementById('add-employee-btn'),
        sueldosUploadBtn: document.getElementById('sueldos-upload-btn'),
        sueldosUploadInput: document.getElementById('sueldos-file-upload-input'),
        sueldosTableContainer: document.getElementById('sueldos-table-container'),
        sueldosEmptyState: document.getElementById('sueldos-empty-state'),
        sueldosFilterCard: document.getElementById('sueldos-filter-card'),
        sueldosDateRangeFilter: document.getElementById('sueldos-date-range-filter'),
        resetSueldosFilterBtn: document.getElementById('reset-sueldos-filter-btn'),
        closeWeekBtn: document.getElementById('close-week-btn'),
        deleteSueldosBtn: document.getElementById('delete-sueldos-btn'),

        // Financial Health elements
        healthDateRangeFilter: document.getElementById('health-date-range-filter'),
        resetHealthFilterBtn: document.getElementById('reset-health-filter-btn'),
        leadsChartToggle: document.getElementById('leads-chart-toggle'),
        leadsChartTitle: document.getElementById('leads-chart-title'),
        thermometerBar: document.getElementById('thermometer-bar'),
        thermometerPercentage: document.getElementById('thermometer-percentage'),
        kpiTotalRevenue: document.getElementById('kpi-total-revenue'),
        kpiSalesRevenue: document.getElementById('kpi-sales-revenue'),
        kpiCosts: document.getElementById('kpi-costs'),
        kpiOperatingProfit: document.getElementById('kpi-operating-profit'),
        kpiOwnerDraw: document.getElementById('kpi-owner-draw'),
        kpiNetProfit: document.getElementById('kpi-net-profit'),
        kpiLeads: document.getElementById('kpi-leads'),
        kpiPaidOrders: document.getElementById('kpi-paid-orders'),
        kpiAvgTicketSales: document.getElementById('kpi-avg-ticket-sales'),
        kpiConversionRate: document.getElementById('kpi-conversion-rate'),
    };
  },

  initEventListeners() {
    this.elements.uploadInput.addEventListener('change', (e) => this.handleFileUpload(e));
    this.elements.uploadBtn.addEventListener('click', () => this.elements.uploadInput.click());
    this.elements.tabs.forEach(tab => tab.addEventListener('click', (e) => this.handleTabClick(e.currentTarget)));
    this.elements.addManualBtn.addEventListener('click', () => this.openExpenseModal());
    this.elements.addFinancialBtn.addEventListener('click', () => this.openFinancialModal());
    this.elements.deleteDataBtn.addEventListener('click', () => this.confirmDeleteAllData());
    this.elements.deleteCurrentMonthBtn.addEventListener('click', () => this.confirmDeleteCurrentMonth());
    this.elements.deletePreviousMonthBtn.addEventListener('click', () => this.confirmDeletePreviousMonth()); // New listener
    this.elements.exportBtn.addEventListener('click', () => this.exportToExcel());
    this.elements.removeDuplicatesBtn.addEventListener('click', () => this.confirmRemoveDuplicates());
    this.elements.categoryFilter.addEventListener('change', () => {
        this.state.categoryFilter = this.elements.categoryFilter.value;
        this.renderAll();
    });
    
    this.elements.modal.addEventListener('click', (e) => {
        if (e.target === this.elements.modal) this.showModal({ show: false });
    });

    window.addEventListener('keydown', (e) => {
        if (this.elements.modal.classList.contains('visible')) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.elements.modalCancelBtn.click();
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (this.elements.modalConfirmBtn.style.display !== 'none') {
                    this.elements.modalConfirmBtn.click();
                }
            }
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            this.undoLastAction();
        }
    });

    this.elements.addEmployeeBtn.addEventListener('click', () => this.openAddEmployeeModal());
    this.elements.sueldosUploadBtn.addEventListener('click', () => this.elements.sueldosUploadInput.click());
    this.elements.sueldosUploadInput.addEventListener('change', (e) => this.handleSueldosFileUpload(e));
    this.elements.resetSueldosFilterBtn.addEventListener('click', () => this.resetSueldosFilter());
    this.elements.closeWeekBtn.addEventListener('click', () => this.confirmCloseWeek());
    this.elements.deleteSueldosBtn.addEventListener('click', () => this.confirmDeleteSueldosData());

    // Financial Health Listeners
    this.elements.resetHealthFilterBtn.addEventListener('click', () => {
        if (this.healthPicker) {
            this.healthPicker.clearSelection();
        }
    });
    this.elements.leadsChartToggle.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button && !button.classList.contains('active')) {
            this.elements.leadsChartToggle.querySelector('.active').classList.remove('active');
            button.classList.add('active');
            this.state.financials.leadsChartTimeframe = button.dataset.timeframe;
            this.updateLeadsTrendChart();
        }
    });
  },
  
  initFirebase() {
    try {
        const firebaseApp = initializeApp(firebaseConfig);
        this.db = getFirestore(firebaseApp);
        this.auth = getAuth(firebaseApp);
        signInAnonymously(this.auth).then(() => {
            this.setupRealtimeListeners();
            this.initDateRangePicker();
            this.initHealthDateRangePicker();
            this.initSueldosDateRangePicker();
        }).catch(error => console.error("Auth Error:", error));
    } catch (error) {
        console.error("Firebase Init Error:", error);
    }
  },

  setupRealtimeListeners() {
      // Listener for main expense data
      onSnapshot(collection(this.db, "expenses"), (snapshot) => {
          this.state.expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          this.populateCategoryFilter();
          this.renderAll();
      }, (error) => console.error("Expenses Listener Error:", error));
      
      // Listener for persistent manual categories
      onSnapshot(collection(this.db, "manualCategories"), (snapshot) => {
          this.state.manualCategories.clear();
          snapshot.docs.forEach(doc => {
              const data = doc.data();
              this.state.manualCategories.set(data.concept.toLowerCase(), data.category);
          });
          this.renderAll();
      }, (error) => console.error("Manual Categories Listener Error:", error));

      // Listener for sueldos data
      onSnapshot(doc(this.db, "sueldos", "main"), (docSnap) => {
          if (docSnap.exists()) {
              this.state.sueldosData = docSnap.data().employees || [];
          } else {
              this.state.sueldosData = [];
          }
          this.migrateSueldosDataStructure();
          this.addManualEmployees();
          this.filterSueldos(); 
          this.elements.sueldosFilterCard.style.display = this.state.sueldosData.length > 0 ? 'block' : 'none';
          this.elements.sueldosEmptyState.style.display = this.state.sueldosData.length === 0 ? 'block' : 'none';
          this.elements.sueldosEmptyState.innerHTML = '<p>No payroll data loaded. Upload a file to start.</p>';
      }, (error) => console.error("Payroll Listener Error:", error));

      this.setupOrdersListener();
  },

  addManualEmployees() {
    const manualEmployees = [
        { nombre: 'Jovita', id: 'MANUAL-JOVITA', departamento: 'Manual', registros: [], descuentos: [], bonos: [], ratePerHour: 70 },
        { nombre: 'Erika', id: 'MANUAL-ERIKA', departamento: 'Manual', registros: [], descuentos: [], bonos: [], ratePerHour: 70 },
        { nombre: 'Rosario', id: 'MANUAL-ROSARIO', departamento: 'Manual', registros: [], descuentos: [], bonos: [], ratePerHour: 70 },
        { nombre: 'Diego', id: 'MANUAL-DIEGO', departamento: 'Manual', registros: [], descuentos: [], bonos: [], ratePerHour: 70 },
    ];

    // Remove Dania
    this.state.sueldosData = this.state.sueldosData.filter(emp => emp.nombre !== 'Dania');

    manualEmployees.forEach(manualEmp => {
        const exists = this.state.sueldosData.some(emp => emp.id === manualEmp.id);
        if (!exists) {
            this.state.sueldosData.push(manualEmp);
        }
    });
  },

  setupOrdersListener() {
    if (this.ordersUnsubscribe) {
        this.ordersUnsubscribe();
    }

    const { start, end } = this.state.financials.dateFilter;
    const queries = [];

    if (start) {
        queries.push(where("createdAt", ">=", Timestamp.fromDate(start)));
    }
    if (end) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 999);
        queries.push(where("createdAt", "<=", Timestamp.fromDate(endOfDay)));
    }
    
    const ordersQuery = query(collection(this.db, "pedidos"), ...queries);

    this.ordersUnsubscribe = onSnapshot(ordersQuery, (snapshot) => {
        const allDocs = snapshot.docs;
        const paidDocs = allDocs.filter(doc => doc.data().estatus === 'Pagado');
        
        this.state.financials.allOrders = allDocs;
        this.state.financials.totalOrdersCount = allDocs.length;
        this.state.financials.paidOrdersCount = paidDocs.length;
        this.state.financials.paidOrdersRevenue = paidDocs.reduce((sum, doc) => sum + (parseFloat(doc.data().precio) || 0), 0);
        
        this.updateFinancialHealthDashboard();
    }, (error) => console.error("Orders Listener Error:", error));
  },

  renderAll() {
      const filteredExpenses = this.getFilteredExpenses();
      this.renderTable(filteredExpenses);
      this.updateTableTotals(filteredExpenses);
      this.updateAllCharts(); 
      this.elements.emptyState.style.display = filteredExpenses.length === 0 ? 'block' : 'none';
      this.updateSummary(); 
      this.updateFinancialHealthDashboard(); 
  },
  
  initDateRangePicker() {
      this.picker = new Litepicker({
          element: this.elements.dateRangeFilter,
          singleMode: false, autoApply: true, lang: 'es-MX', format: 'YYYY-MM-DD',
          setup: (picker) => {
              picker.on('selected', (date1, date2) => {
                  this.state.dateFilter.start = date1 ? date1.dateInstance : null;
                  this.state.dateFilter.end = date2 ? date2.dateInstance : null;
                  this.renderAll();
              });
               picker.on('clear:selection', () => {
                  this.state.dateFilter.start = null;
                  this.state.dateFilter.end = null;
                  this.renderAll();
              });
          }
      });
  },

  initHealthDateRangePicker() {
      this.healthPicker = new Litepicker({
          element: this.elements.healthDateRangeFilter,
          singleMode: false, autoApply: true, lang: 'es-MX', format: 'YYYY-MM-DD',
          setup: (picker) => {
              picker.on('selected', (date1, date2) => {
                  this.state.financials.dateFilter.start = date1.dateInstance;
                  this.state.financials.dateFilter.end = date2.dateInstance;
                  this.setupOrdersListener();
                  this.updateFinancialHealthDashboard();
              });
               picker.on('clear:selection', () => {
                  this.state.financials.dateFilter.start = null;
                  this.state.financials.dateFilter.end = null;
                  this.setupOrdersListener();
                  this.updateFinancialHealthDashboard();
               });
          }
      });
  },

  populateCategoryFilter() {
    const categories = [...new Set(this.state.expenses
        .filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses') 
        .map(e => e.category).filter(Boolean))];
    categories.sort();
    const currentCategory = this.elements.categoryFilter.value;
    this.elements.categoryFilter.innerHTML = `<option value="all">Todas las categorías</option>`;
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        this.elements.categoryFilter.appendChild(option);
    });
    this.elements.categoryFilter.value = currentCategory;
  },
  
  getFilteredExpenses(useHealthFilter = false) {
    const dateFilter = useHealthFilter ? this.state.financials.dateFilter : this.state.dateFilter;
    const categoryFilter = useHealthFilter ? 'all' : this.state.categoryFilter;
    
    const { start, end } = dateFilter;

    return this.state.expenses.filter(expense => {
        const expenseDate = new Date(expense.date); // Directly use the string
        const startDate = start ? new Date(start) : null;
        const endDate = end ? new Date(end) : null;

        if(startDate) startDate.setUTCHours(0,0,0,0);
        if(endDate) endDate.setUTCHours(23, 59, 59, 999);

        const dateMatch = (!startDate || expenseDate >= startDate) && (!endDate || expenseDate <= endDate);

        let categoryMatch = true;
        if (categoryFilter !== 'all') {
            const isIncome = (parseFloat(expense.credit) || 0) > 0;
            if (isIncome) {
                categoryMatch = false;
            } else {
                categoryMatch = (expense.category || 'SinCategorizar') === categoryFilter;
            }
        }
        
        return dateMatch && categoryMatch;
    });
  },

  renderTable(expenses) {
      this.elements.dataTableBody.innerHTML = '';
      const sorted = [...expenses].sort((a,b) => (b.date > a.date) ? 1 : -1);
      
      sorted.forEach(expense => {
          const tr = document.createElement('tr');
          const charge = parseFloat(expense.charge) || 0;
          const credit = parseFloat(expense.credit) || 0;
          
          let displayCategory = 'N/A';
          const isOperational = expense.type === 'operativo' || !expense.type; 

          if (isOperational && credit > 0) {
              displayCategory = expense.channel || ''; // Show channel or blank
          } else if (isOperational || expense.sub_type === 'pago_intereses') {
              displayCategory = expense.category || 'SinCategorizar';
          }
          
          let categoryHtml;
          // NEW: If category is 'SinCategorizar', show a dropdown
          if (displayCategory === 'SinCategorizar') {
              const allCategories = [...new Set([...this.state.expenses.map(e => e.category), 'Alex', 'Chris', 'Sueldos', 'Publicidad', 'Envios', 'Local', 'Material', 'Tecnologia', 'Deudas', 'Devoluciones', 'GastosFinancieros', 'SinCategorizar'].filter(Boolean))].sort();
              const categoryOptions = allCategories.map(cat => `<option value="${cat}" ${cat === 'SinCategorizar' ? 'selected' : ''}>${cat}</option>`).join('');
              categoryHtml = `<select class="category-dropdown" data-expense-id="${expense.id}">${categoryOptions}</select>`;
          } else {
              categoryHtml = displayCategory;
          }

          tr.innerHTML = `
              <td>${expense.date || ''}</td>
              <td>${expense.concept || ''}</td>
              <td>${charge > 0 ? this.formatCurrency(charge) : ''}</td>
              <td>${credit > 0 ? this.formatCurrency(credit) : ''}</td>
              <td>${categoryHtml}</td>
              <td class="btn-group">
                  <button class="btn btn-outline btn-sm edit-btn"><i class="fas fa-pencil-alt"></i></button>
                  <button class="btn btn-outline btn-sm delete-btn" style="color:var(--danger);"><i class="fas fa-trash"></i></button>
              </td>
          `;
          
          // Add event listeners
          tr.querySelector('.edit-btn').addEventListener('click', () => this.openExpenseModal(expense));
          tr.querySelector('.delete-btn').addEventListener('click', () => this.confirmDeleteExpense(expense.id));
          
          const dropdown = tr.querySelector('.category-dropdown');
          if (dropdown) {
              dropdown.addEventListener('change', (e) => this.handleCategoryChange(e));
          }

          this.elements.dataTableBody.appendChild(tr);
      });
  },
  
  async handleCategoryChange(e) {
    const selectElement = e.target;
    const expenseId = selectElement.dataset.expenseId;
    const newCategory = selectElement.value;

    if (!expenseId || !newCategory) return;

    const expense = this.state.expenses.find(exp => exp.id === expenseId);
    if (!expense) return;
    
    this.saveStateToHistory(); // Save state before making a change
    try {
        const concept = (expense.concept || '').toLowerCase();

        // Update the main expense document
        await updateDoc(doc(this.db, "expenses", expenseId), { category: newCategory });

        // Check if a manual override is needed
        const ruleBasedCategory = this.autoCategorizeWithRulesOnly(concept);
        if (newCategory !== ruleBasedCategory && newCategory !== 'SinCategorizar') {
            const docId = this.hashCode(concept);
            const manualCategoryRef = doc(this.db, "manualCategories", docId);
            await setDoc(manualCategoryRef, { concept: concept, category: newCategory });
        }
        // The onSnapshot listener will automatically re-render the table.
    } catch (error) {
        console.error("Error updating category:", error);
        this.actionHistory.pop(); // Revert history if save fails
        this.showModal({ title: 'Error', body: 'No se pudo actualizar la categoría.' });
    }
  },

  updateTableTotals(expenses) {
    const { totalCharge, totalCredit } = expenses.reduce((acc, exp) => {
        acc.totalCharge += parseFloat(exp.charge) || 0;
        acc.totalCredit += parseFloat(exp.credit) || 0;
        return acc;
    }, { totalCharge: 0, totalCredit: 0 });
    this.elements.dataTableFooter.innerHTML = `
        <tr>
            <th colspan="2">Totales (Vista Actual):</th>
            <th>${this.formatCurrency(totalCharge)}</th>
            <th>${this.formatCurrency(totalCredit)}</th>
            <th colspan="2"></th>
        </tr>
    `;
  },

  updateSummary() {
    const operationalExpenses = this.getFilteredExpenses().filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses');
    
    const summaryData = operationalExpenses.reduce((acc, exp) => {
        const charge = parseFloat(exp.charge) || 0;
        const credit = parseFloat(exp.credit) || 0;
        const category = exp.category || 'SinCategorizar';
        
        if (credit > 0) {
            acc.TotalIngresos += credit;
        }
        if (charge > 0) {
            acc.TotalCargos += charge;
            if (!acc[category]) acc[category] = 0;
            acc[category] += charge;
        }
        return acc;
    }, { TotalCargos: 0, TotalIngresos: 0 });
    
    summaryData.TotalNeto = summaryData.TotalIngresos - summaryData.TotalCargos;
    
    this.elements.summarySection.innerHTML = '';
    const summaryOrder = ['TotalNeto', 'TotalIngresos', 'TotalCargos'];
    const sortedSummary = Object.entries(summaryData).sort(([keyA], [keyB]) => {
        const indexA = summaryOrder.indexOf(keyA);
        const indexB = summaryOrder.indexOf(keyB);
        if (indexA > -1 && indexB > -1) return indexA - indexB;
        if (indexA > -1) return -1;
        if (indexB > -1) return 1;
        return keyA.localeCompare(keyB);
    });
    sortedSummary.forEach(([key, value]) => {
        if (key.startsWith('Total') || value > 0) {
            const isClickable = !key.startsWith('Total');
            const card = this.createSummaryCard(key, value, isClickable);
            if (isClickable) card.addEventListener('click', () => this.showCategoryDetailsModal(key));
            this.elements.summarySection.appendChild(card);
        }
    });
  },
  
  createSummaryCard(title, amount, isClickable) {
      const icons = {
        TotalNeto: "fas fa-balance-scale", TotalCargos: "fas fa-arrow-up-from-bracket", TotalIngresos: "fas fa-hand-holding-usd", Alex: "fas fa-user", Chris: "fas fa-user-friends",
        Sueldos: "fas fa-coins", Deudas: "fas fa-credit-card", Publicidad: "fas fa-bullhorn", Envios: "fas fa-shipping-fast",
        Local: "fas fa-building", Material: "fas fa-box-open", Tecnologia: "fas fa-laptop-code", Devoluciones: "fas fa-undo", GastosFinancieros: "fas fa-percentage", SinCategorizar: "fas fa-question-circle"
      };
      const card = document.createElement('div');
      let displayTitle = title;
      if (title === 'TotalNeto') displayTitle = 'Utilidad Operativa';
      if (title === 'TotalIngresos') displayTitle = 'Ingresos Operativos';
      if (title === 'TotalCargos') displayTitle = 'Cargos Operativos';
      
      card.className = `summary-card ${title.replace(" ", "")} ${isClickable ? 'clickable' : ''}`;
      card.innerHTML = `
        <div class="icon-container"><i class="${icons[title] || 'fas fa-tag'}"></i></div>
        <div> <div class="summary-card-title">${displayTitle}</div> <div class="summary-card-value">${this.formatCurrency(amount)}</div> </div>`;
      return card;
  },
  
  showCategoryDetailsModal(category) {
    const categoryExpenses = this.getFilteredExpenses().filter(e => (e.category || 'SinCategorizar') === category && (parseFloat(e.charge) || 0) > 0);
    let total = 0;
    const rows = categoryExpenses.map(e => {
        const charge = parseFloat(e.charge) || 0;
        total += charge;
        return `<tr> <td>${e.date}</td> <td>${e.concept}</td> <td style="text-align: right;">${this.formatCurrency(charge)}</td> </tr>`;
    }).join('');
    const tableHtml = `
        <div class="table-container">
            <table>
                <thead> <tr> <th>Fecha</th> <th>Concepto</th> <th style="text-align: right;">Cargo</th> </tr> </thead>
                <tbody>${rows}</tbody>
                <tfoot> <tr> <td colspan="2">Total</td> <td style="text-align: right;">${this.formatCurrency(total)}</td> </tr> </tfoot>
            </table>
        </div>`;
    this.showModal({ title: `Detalles de: ${category}`, body: tableHtml, confirmText: 'Cerrar', showCancel: false });
  },
  
  saveStateToHistory() {
    const snapshot = JSON.parse(JSON.stringify(this.state.expenses)).map(exp => { delete exp.id; return exp; });
    this.actionHistory.push(snapshot);
  },

  async undoLastAction() {
    if (this.actionHistory.length === 0) {
        this.showModal({ title: 'Información', body: 'No hay más acciones que deshacer.', showCancel: false, confirmText: 'Entendido' });
        return;
    }
    const previousExpenses = this.actionHistory.pop();
    try {
        const batch = writeBatch(this.db);
        const querySnapshot = await getDocs(collection(this.db, "expenses"));
        querySnapshot.forEach(doc => batch.delete(doc.ref));
        previousExpenses.forEach(expense => batch.set(doc(collection(this.db, "expenses")), expense));
        await batch.commit();
        this.showModal({ title: 'Éxito', body: 'La última acción ha sido deshecha.', showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error during undo:", error);
        this.showModal({ title: 'Error', body: 'No se pudo deshacer la acción.', showCancel: false, confirmText: 'Entendido' });
    }
  },

  _getExpenseSignature(expense) {
    const concept = (expense.concept || '').trim();
    const charge = parseFloat(expense.charge) || 0;
    const credit = parseFloat(expense.credit) || 0;
    return `${expense.date}|${concept}|${charge}|${credit}`;
  },

  async handleFileUpload(e) {
    this.saveStateToHistory();
    const file = e.target.files[0];
    if (!file) {
        this.actionHistory.pop();
        return;
    }
    const reader = new FileReader();
    reader.onload = async (event) => {
        let totalRows = 0;
        let newRowsCount = 0;
        let duplicateRowsCount = 0;
        const invalidRows = [];
        const duplicateRowsData = []; // To store duplicate rows for display

        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
            const rowsToProcess = jsonData.slice(4);
            totalRows = rowsToProcess.length;

            const existingSignatures = new Set(this.state.expenses.map(exp => this._getExpenseSignature(exp)));
            const expensesToUpload = [];

            rowsToProcess.forEach((row, index) => {
                let dateValue = '';
                const rawDate = row[0];

                if (rawDate instanceof Date) {
                    const d = new Date(Date.UTC(rawDate.getFullYear(), rawDate.getMonth(), rawDate.getDate()));
                    if (!isNaN(d)) dateValue = d.toISOString().split('T')[0];
                } else if (typeof rawDate === 'number') {
                    const d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
                    if (!isNaN(d)) {
                        const userTimezoneOffset = d.getTimezoneOffset() * 60000;
                        dateValue = new Date(d.getTime() + userTimezoneOffset).toISOString().split('T')[0];
                    }
                } else if (typeof rawDate === 'string' && rawDate.trim() !== '') {
                    const parts = rawDate.split(/[/\-]/);
                    let d;
                    if (parts.length === 3) {
                        const p1 = parseInt(parts[0], 10), p2 = parseInt(parts[1], 10), p3 = parseInt(parts[2], 10);
                        if (p1 > 1000) {
                            d = new Date(Date.UTC(p1, p2 - 1, p3));
                        } else {
                            d = new Date(Date.UTC(p3, p2 - 1, p1));
                        }
                        if (!isNaN(d)) dateValue = d.toISOString().split('T')[0];
                    }
                }

                const conceptValue = String(row[1] || '').trim();
                
                if (!dateValue || !conceptValue) {
                    invalidRows.push({ rowNum: index + 5, data: row });
                    return;
                }
                
                const chargeValue = Math.abs(parseFloat(String(row[2] || '0').replace(/,/g, '')) || 0);
                const creditValue = parseFloat(String(row[3] || '0').replace(/,/g, '')) || 0;
                
                const newExpense = {
                    date: dateValue,
                    concept: conceptValue,
                    charge: chargeValue,
                    credit: creditValue,
                    category: creditValue > 0 ? '' : this.autoCategorize(conceptValue),
                    channel: '',
                    type: 'operativo',
                    sub_type: '',
                    source: 'xls' // Distinguish source
                };

                const signature = this._getExpenseSignature(newExpense);
                const isException = newExpense.concept.includes('PAYPAL *FACEBOOK CR') || newExpense.concept.includes('Stripe');

                if (isException || !existingSignatures.has(signature)) {
                    expensesToUpload.push(newExpense);
                    if (!isException) {
                       existingSignatures.add(signature);
                    }
                    newRowsCount++;
                } else {
                    duplicateRowsCount++;
                    duplicateRowsData.push({ rowNum: index + 5, data: row });
                }
            });

            if (expensesToUpload.length > 0) {
                const batch = writeBatch(this.db);
                expensesToUpload.forEach(expense => batch.set(doc(collection(this.db, "expenses")), expense));
                await batch.commit();
            } else {
                this.actionHistory.pop();
            }

            let reportBody = `
                <p><strong>Resumen de la Carga:</strong></p>
                <ul style="list-style-position: inside; padding-left: 0;">
                    <li>Filas totales procesadas: <strong>${totalRows}</strong></li>
                    <li>Registros nuevos agregados: <strong style="color:var(--success);">${newRowsCount}</strong></li>
                    <li>Registros duplicados omitidos: <strong style="color:var(--warning);">${duplicateRowsCount}</strong></li>
                    <li>Filas inválidas o vacías omitidas: <strong>${invalidRows.length}</strong></li>
                </ul>`;
            
            if (duplicateRowsData.length > 0) {
                reportBody += `
                    <hr style="margin: 15px 0;">
                    <p><strong>Se omitieron las siguientes filas duplicadas (se muestran las primeras 20):</strong></p>
                    <div style="max-height: 150px; overflow-y: auto; border: 1px solid var(--gray-medium); border-radius: 6px; padding: 10px; background-color: #fafafa;">
                        <table style="width: 100%; font-size: 12px;">
                            <thead>
                                <tr>
                                    <th style="text-align: left;">Fila #</th>
                                    <th style="text-align: left;">Fecha</th>
                                    <th style="text-align: left;">Concepto</th>
                                    <th style="text-align: left;">Monto</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${duplicateRowsData.slice(0, 20).map(item => `
                                    <tr>
                                        <td>${item.rowNum}</td>
                                        <td>${item.data[0] || ''}</td>
                                        <td>${item.data[1] || ''}</td>
                                        <td>${this.formatCurrency(parseFloat(item.data[2] || item.data[3] || 0))}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        ${duplicateRowsData.length > 20 ? `<p style="text-align: center; font-size: 12px; margin-top: 10px;">... y ${duplicateRowsData.length - 20} más.</p>` : ''}
                    </div>`;
            }

            if (invalidRows.length > 0) {
                reportBody += `
                    <hr style="margin: 15px 0;">
                    <p><strong>Se omitieron las siguientes filas por tener una fecha o concepto inválido (se muestran las primeras 20):</strong></p>
                    <div style="max-height: 150px; overflow-y: auto; border: 1px solid var(--gray-medium); border-radius: 6px; padding: 10px; background-color: #fafafa;">
                        <table style="width: 100%; font-size: 12px;">
                            <thead>
                                <tr>
                                    <th style="text-align: left;">Fila #</th>
                                    <th style="text-align: left;">Dato en Col. Fecha</th>
                                    <th style="text-align: left;">Dato en Col. Concepto</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${invalidRows.slice(0, 20).map(item => `
                                    <tr>
                                        <td>${item.rowNum}</td>
                                        <td>${item.data[0] || '<em>Vacío</em>'}</td>
                                        <td>${item.data[1] || '<em>Vacío</em>'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        ${invalidRows.length > 20 ? `<p style="text-align: center; font-size: 12px; margin-top: 10px;">... y ${invalidRows.length - 20} más.</p>` : ''}
                    </div>`;
            }

            this.showModal({
                title: "Proceso de Carga Completado",
                body: reportBody,
                showCancel: false,
                confirmText: 'Entendido'
            });

        } catch (error) {
            console.error("Error al procesar el archivo:", error);
            this.actionHistory.pop();
            this.showModal({
                title: "Error de Carga",
                body: `Ocurrió un error al procesar el archivo: ${error.message}`,
                showCancel: false,
                confirmText: 'Entendido'
            });
        } finally {
            e.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
  },

  confirmRemoveDuplicates() {
    this.showModal({
        title: 'Confirmar Limpieza de Duplicados',
        body: '¿Estás seguro de que quieres buscar y eliminar todos los registros duplicados? Se considera un duplicado si la <strong>fecha, concepto, cargo e ingreso son idénticos</strong> (ignorando espacios extra). Esta acción es irreversible.',
        confirmText: 'Sí, limpiar duplicados',
        confirmClass: 'btn-danger',
        onConfirm: () => this.removeDuplicates()
    });
  },

  async removeDuplicates() {
    this.showModal({ show: false }); 
    const expenses = this.state.expenses;
    if (expenses.length < 2) {
        this.showModal({ title: 'Información', body: 'No hay suficientes registros para buscar duplicados.', showCancel: false, confirmText: 'Entendido' });
        return;
    }

    const seen = new Map();
    const duplicatesToDelete = [];
    const sortedExpenses = [...expenses].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedExpenses.forEach(expense => {
        const signature = this._getExpenseSignature(expense);
        if (seen.has(signature)) {
            duplicatesToDelete.push(expense.id);
        } else {
            seen.set(signature, expense.id);
        }
    });

    if (duplicatesToDelete.length === 0) {
        this.showModal({ title: 'Sin Duplicados', body: '¡Buenas noticias! No se encontraron registros duplicados.', showCancel: false, confirmText: 'Entendido' });
        return;
    }

    try {
        this.saveStateToHistory();
        const batch = writeBatch(this.db);
        duplicatesToDelete.forEach(id => batch.delete(doc(this.db, "expenses", id)));
        await batch.commit();
        this.showModal({ title: 'Limpieza Exitosa', body: `Se eliminaron ${duplicatesToDelete.length} registros duplicados. La tabla se actualizará automáticamente.`, showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error removing duplicates:", error);
        this.actionHistory.pop();
        this.showModal({ title: 'Error', body: 'Ocurrió un error al eliminar los duplicados.', showCancel: false, confirmText: 'Entendido' });
    }
  },
  
  async saveExpense(expenseData, originalCategory) {
    this.saveStateToHistory();
    try {
        const concept = (expenseData.concept || '').toLowerCase();
        const newCategory = expenseData.category;
        const isCharge = (expenseData.charge || 0) > 0;
        const categoryChanged = originalCategory !== newCategory;

        if (isCharge && newCategory && newCategory !== 'SinCategorizar' && (categoryChanged || !expenseData.id)) {
            const ruleBasedCategory = this.autoCategorizeWithRulesOnly(concept);
            if (newCategory !== ruleBasedCategory) {
                const docId = this.hashCode(concept);
                const manualCategoryRef = doc(this.db, "manualCategories", docId);
                await setDoc(manualCategoryRef, { concept: concept, category: newCategory });
            }
        }
        
        if (expenseData.id) {
            const { id, ...dataToUpdate } = expenseData;
            await updateDoc(doc(this.db, "expenses", id), dataToUpdate);
        } else {
            await addDoc(collection(this.db, "expenses"), expenseData);
        }
        this.showModal({ show: false });
    } catch(error) {
        console.error("Error saving expense:", error);
        this.actionHistory.pop();
    }
  },
  
  autoCategorize(concept) {
      const lowerConcept = concept.toLowerCase();
      if (this.state.manualCategories.has(lowerConcept)) {
          return this.state.manualCategories.get(lowerConcept);
      }
      return this.autoCategorizeWithRulesOnly(concept);
  },

  autoCategorizeWithRulesOnly(concept) {
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
  },
  
  hashCode(str) {
    let hash = 0, i, chr;
    if (str.length === 0) return String(hash);
    for (i = 0; i < str.length; i++) {
        chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return String(hash);
  },
  
  confirmDeleteAllData() {
    this.showModal({
        title: 'Confirmar Borrado de Datos',
        body: '¿Estás seguro de que quieres borrar <strong>todos los registros de la tabla EXCEPTO los ingresos de tipo "Ajuste"</strong>? <br><br><strong>Importante:</strong> Las categorías que asignaste manually <strong>NO se borrarán</strong> y se aplicarán a futuros archivos.',
        confirmText: 'Sí, borrar datos', confirmClass: 'btn-danger',
        onConfirm: () => this.deleteAllData()
    });
  },

  async deleteAllData() {
    const expensesToDelete = this.state.expenses.filter(e => e.concept !== 'Ajuste');
    if (expensesToDelete.length === 0) {
        this.showModal({ title: 'Información', body: 'No hay datos para borrar (excluyendo los ajustes).', showCancel: false, confirmText: 'Entendido' });
        return;
    }
    this.saveStateToHistory();
    this.showModal({ show: false });
    try {
        const batch = writeBatch(this.db);
        const q = query(collection(this.db, "expenses"), where("concept", "!=", "Ajuste"));
        const querySnapshot = await getDocs(q);
        
        querySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        await batch.commit();
        this.showModal({ title: 'Éxito', body: `Se han borrado ${querySnapshot.size} registros. Los ingresos de tipo "Ajuste" se han conservado.`, showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error borrando todos los datos:", error);
        this.actionHistory.pop();
        this.showModal({ title: 'Error', body: 'No se pudieron borrar los datos.', showCancel: false, confirmText: 'Entendido' });
    }
  },

  confirmDeleteCurrentMonth() {
    const today = new Date();
    const monthName = today.toLocaleString('es-MX', { month: 'long' });
    const year = today.getFullYear();
    this.showModal({
        title: 'Confirmar Borrado del Mes Actual',
        body: `¿Estás seguro de que quieres borrar <strong>todos los movimientos de ${monthName} de ${year}</strong>? Esta acción no se puede deshacer.`,
        confirmText: 'Sí, borrar mes actual',
        confirmClass: 'btn-danger',
        onConfirm: () => this.deleteCurrentMonthData()
    });
  },

  async deleteCurrentMonthData() {
    this.saveStateToHistory();
    this.showModal({ show: false });

    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();

    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);

    // Format dates to YYYY-MM-DD strings for Firestore query
    const startDateString = startDate.toISOString().split('T')[0];
    const endDateString = endDate.toISOString().split('T')[0];

    try {
        const batch = writeBatch(this.db);
        const q = query(collection(this.db, "expenses"), 
            where("date", ">=", startDateString),
            where("date", "<=", endDateString)
        );
        
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            this.showModal({ title: 'Información', body: 'No se encontraron registros en el mes actual para borrar.', showCancel: false, confirmText: 'Entendido' });
            this.actionHistory.pop(); // No changes were made, so remove the history entry
            return;
        }

        querySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        await batch.commit();
        this.showModal({ title: 'Éxito', body: `Se han borrado ${querySnapshot.size} registros del mes actual.`, showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error deleting current month data:", error);
        this.actionHistory.pop();
        this.showModal({ title: 'Error', body: 'No se pudieron borrar los datos del mes actual.', showCancel: false, confirmText: 'Entendido' });
    }
  },
  
  confirmDeletePreviousMonth() {
    const today = new Date();
    const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthName = prevMonthDate.toLocaleString('es-MX', { month: 'long' });
    const year = prevMonthDate.getFullYear();
    this.showModal({
        title: 'Confirmar Borrado del Mes Anterior',
        body: `¿Estás seguro de que quieres borrar todos los movimientos de <strong>${this.capitalize(monthName)} de ${year}</strong> que fueron cargados desde un archivo XLS? <br><br>Los datos agregados manualmente no serán eliminados. Esta acción no se puede deshacer.`,
        confirmText: 'Sí, borrar mes anterior',
        confirmClass: 'btn-danger',
        onConfirm: () => this.deletePreviousMonthData()
    });
  },

  confirmDeleteSueldosData() {
    this.showModal({
        title: 'Confirmar Borrado Total de Sueldos',
        body: '¿Estás seguro de que quieres borrar <strong>todos los datos de sueldos</strong>? Esto incluye empleados, registros de horas, bonos, descuentos e historial de pagos. Esta acción es irreversible.',
        confirmText: 'Sí, borrar todo',
        confirmClass: 'btn-danger',
        onConfirm: () => this.deleteSueldosData()
    });
  },

  async deleteSueldosData() {
    this.showModal({ show: false });
    try {
        // Overwrite the document with an empty employees array
        await setDoc(doc(this.db, "sueldos", "main"), { employees: [] });
        this.showModal({ 
            title: 'Éxito', 
            body: 'Todos los datos de sueldos han sido eliminados.', 
            showCancel: false, 
            confirmText: 'Entendido' 
        });
        // The onSnapshot listener will handle the UI update
    } catch (error) {
        console.error("Error deleting payroll data:", error);
        this.showModal({ 
            title: 'Error', 
            body: 'No se pudieron borrar los datos de sueldos.', 
            showCancel: false, 
            confirmText: 'Entendido' 
        });
    }
  },

  async deletePreviousMonthData() {
      this.saveStateToHistory();
      this.showModal({ show: false });

      const today = new Date();
      const year = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
      const month = today.getMonth() === 0 ? 11 : today.getMonth() - 1;

      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);

      const startDateString = startDate.toISOString().split('T')[0];
      const endDateString = endDate.toISOString().split('T')[0];

      try {
          const batch = writeBatch(this.db);
          const q = query(collection(this.db, "expenses"), 
              where("date", ">=", startDateString),
              where("date", "<=", endDateString)
          );
          
          const querySnapshot = await getDocs(q);
          let deletedCount = 0;

          if (querySnapshot.empty) {
              this.showModal({ title: 'Información', body: 'No se encontraron registros en el mes anterior para borrar.', showCancel: false, confirmText: 'Entendido' });
              this.actionHistory.pop();
              return;
          }

          querySnapshot.forEach(doc => {
              const data = doc.data();
              // Delete if source is NOT 'manual'. This includes undefined source (old data) and 'xls' source.
              if (data.source !== 'manual') {
                  batch.delete(doc.ref);
                  deletedCount++;
              }
          });

          if (deletedCount === 0) {
              this.showModal({ title: 'Información', body: 'No se encontraron registros cargados por archivo en el mes anterior. Todos los registros eran manuales y se conservaron.', showCancel: false, confirmText: 'Entendido' });
              this.actionHistory.pop();
              return;
          }
          
          await batch.commit();
          this.showModal({ title: 'Éxito', body: `Se han borrado ${deletedCount} registros del mes anterior.`, showCancel: false, confirmText: 'Entendido' });
      } catch (error) {
          console.error("Error deleting previous month data:", error);
          this.actionHistory.pop();
          this.showModal({ title: 'Error', body: 'No se pudieron borrar los datos del mes anterior.', showCancel: false, confirmText: 'Entendido' });
      }
  },

  openExpenseModal(expense = {}) {
    const isEditing = !!expense.id;
    const title = isEditing ? 'Editar Movimiento' : 'Agregar Movimiento Operativo';
    const originalCategory = expense.category || 'SinCategorizar';

    const isFinancial = expense.type === 'financiero';

    const categories = [...new Set([...this.state.expenses.map(e => e.category), 'Alex', 'Chris', 'Sueldos', 'Publicidad', 'Envios', 'Local', 'Material', 'Tecnologia', 'Deudas', 'Devoluciones', 'SinCategorizar', 'Gastos Financieros'].filter(Boolean))].sort();
    const categoryOptions = categories.map(cat => `<option value="${cat}" ${expense.category === cat ? 'selected' : ''}>${cat}</option>`).join('');

    const channels = ['WhatsApp', 'Instagram', 'Facebook', 'Grupo de Clientes', 'Grupo de Referencias', 'Otro'];
    const channelOptions = channels.map(c => `<option value="${c}" ${expense.channel === c ? 'selected' : ''}>${c}</option>`).join('');

    this.showModal({
        title: title,
        body: `<form id="expense-form" style="display: grid; gap: 15px;">
                    <div class="form-group">
                        <label for="expense-date">Fecha</label>
                        <input type="date" id="expense-date" class="modal-input" value="${expense.date || new Date().toISOString().split('T')[0]}" required>
                    </div>
                    <div class="form-group">
                        <label for="expense-concept">Concepto</label>
                        <input type="text" id="expense-concept" class="modal-input" placeholder="Concepto del movimiento" value="${expense.concept || ''}" required>
                    </div>
                    <div class="form-group">
                        <label for="expense-charge">Cargo ($)</label>
                        <input type="number" step="0.01" id="expense-charge" class="modal-input" placeholder="$0.00" value="${expense.charge || ''}">
                    </div>
                    <div class="form-group">
                        <label for="expense-credit">Ingreso ($)</label>
                        <input type="number" step="0.01" id="expense-credit" class="modal-input" placeholder="$0.00" value="${expense.credit || ''}">
                    </div>
                    <div class="form-group" id="category-form-group">
                        <label for="expense-category">Categoría</label>
                        <select id="expense-category" class="modal-input">${categoryOptions}</select>
                    </div>
                    <div class="form-group" id="channel-form-group" style="display: none;">
                        <label for="expense-channel">Canal de Venta</label>
                        <select id="expense-channel" class="modal-input">
                            <option value="">No aplica</option>
                            ${channelOptions}
                        </select>
                    </div>
               </form>`,
        confirmText: 'Guardar',
        onConfirm: () => {
            const form = document.getElementById('expense-form');
            if (form.reportValidity()) {
                const creditValue = parseFloat(document.getElementById('expense-credit').value) || 0;
                
                const expenseData = {
                    ...expense, 
                    date: document.getElementById('expense-date').value,
                    concept: document.getElementById('expense-concept').value,
                    charge: parseFloat(document.getElementById('expense-charge').value) || 0,
                    credit: creditValue,
                    type: expense.type || 'operativo',
                    category: '',
                    channel: document.getElementById('expense-channel')?.value || '',
                    source: 'manual' // Distinguish source
                };
                
                if (expenseData.sub_type === 'pago_intereses') {
                     expenseData.category = 'Gastos Financieros';
                } else if (expenseData.type === 'operativo') {
                     expenseData.category = creditValue > 0 ? '' : document.getElementById('expense-category').value;
                } else {
                    expenseData.category = '';
                }
                
                if (isEditing) {
                    expenseData.id = expense.id;
                }
                
                this.saveExpense(expenseData, originalCategory);
            }
        },
        onModalOpen: () => {
            const categoryGroup = document.getElementById('category-form-group');
            const categorySelect = document.getElementById('expense-category');
            const conceptInput = document.getElementById('expense-concept');
            const creditInput = document.getElementById('expense-credit');
            const channelGroup = document.getElementById('channel-form-group');

            const toggleFieldVisibility = () => {
                const creditValue = parseFloat(creditInput.value) || 0;
                const isIncome = creditValue > 0;

                channelGroup.style.display = isIncome ? 'block' : 'none';
                categoryGroup.style.display = isIncome || isFinancial ? 'none' : 'block';
                
                if(isFinancial && expense.sub_type === 'pago_intereses') {
                    categoryGroup.style.display = 'block';
                    categorySelect.value = 'Gastos Financieros';
                    categorySelect.disabled = true;
                } else if (!isFinancial) {
                    categorySelect.disabled = false;
                }
            };
            
            creditInput.addEventListener('input', toggleFieldVisibility);
            
            conceptInput.addEventListener('input', () => {
                if (!isFinancial && !(parseFloat(creditInput.value) > 0)) {
                    categorySelect.value = this.autoCategorize(conceptInput.value);
                }
            });

            toggleFieldVisibility();
        }
    });
  },
  
  openFinancialModal() {
    const body = `
        <form id="financial-form" style="display: grid; gap: 15px;">
            <div class="form-group">
                <label for="financial-date">Fecha</label>
                <input type="date" id="financial-date" class="modal-input" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-group">
                <label for="financial-type">Tipo de Movimiento</label>
                <select id="financial-type" class="modal-input">
                    <option value="entrada_prestamo">Entrada de Préstamo</option>
                    <option value="pago_prestamo">Pago de Préstamo</option>
                </select>
            </div>
            <div class="form-group">
                <label for="financial-concept">Concepto (Ej: Préstamo BBVA, Pago semanal)</label>
                <input type="text" id="financial-concept" class="modal-input" placeholder="Concepto" required>
            </div>
            <div id="entrada-fields">
                <div class="form-group">
                    <label for="financial-credit">Monto del Préstamo Recibido ($)</label>
                    <input type="number" step="0.01" id="financial-credit" class="modal-input" placeholder="$5,000.00">
                </div>
            </div>
            <div id="pago-fields" style="display: none;">
                <div class="form-group">
                    <label for="financial-capital">Pago a Capital ($)</label>
                    <input type="number" step="0.01" id="financial-capital" class="modal-input" placeholder="$1,000.00">
                </div>
                <div class="form-group">
                    <label for="financial-interest">Pago de Intereses ($)</label>
                    <input type="number" step="0.01" id="financial-interest" class="modal-input" placeholder="$150.00">
                </div>
            </div>
        </form>
    `;

    this.showModal({
        title: 'Registrar Movimiento Financiero',
        body: body,
        confirmText: 'Guardar Movimiento',
        onConfirm: () => this.saveFinancialTransaction(),
        onModalOpen: () => {
            const typeSelect = document.getElementById('financial-type');
            const entradaFields = document.getElementById('entrada-fields');
            const pagoFields = document.getElementById('pago-fields');
            typeSelect.addEventListener('change', (e) => {
                if (e.target.value === 'entrada_prestamo') {
                    entradaFields.style.display = 'block';
                    pagoFields.style.display = 'none';
                } else {
                    entradaFields.style.display = 'none';
                    pagoFields.style.display = 'block';
                }
            });
        }
    });
  },
  
  async saveFinancialTransaction() {
    const form = document.getElementById('financial-form');
    if (!form.reportValidity()) return;

    const date = document.getElementById('financial-date').value;
    const concept = document.getElementById('financial-concept').value;
    const type = document.getElementById('financial-type').value;

    this.saveStateToHistory();
    const batch = writeBatch(this.db);

    if (type === 'entrada_prestamo') {
        const amount = parseFloat(document.getElementById('financial-credit').value) || 0;
        if (amount <= 0) {
            this.showModal({title: 'Dato Inválido', body: 'El monto del préstamo debe ser mayor a cero.', confirmText: 'Entendido', showCancel: false});
            this.actionHistory.pop();
            return;
        }
        const newEntry = {
            date, concept, charge: 0, credit: amount,
            type: 'financiero', sub_type: 'entrada_prestamo', category: '', channel: '',
            source: 'manual' // Distinguish source
        };
        batch.set(doc(collection(this.db, "expenses")), newEntry);
    } else if (type === 'pago_prestamo') {
        const capitalAmount = parseFloat(document.getElementById('financial-capital').value) || 0;
        const interestAmount = parseFloat(document.getElementById('financial-interest').value) || 0;

        if (capitalAmount <= 0 && interestAmount <= 0) {
            this.showModal({title: 'Datos Incompletos', body: 'Debe ingresar un monto para capital y/o intereses.', confirmText: 'Entendido', showCancel: false});
            this.actionHistory.pop();
            return;
        }

        if (capitalAmount > 0) {
            const capitalEntry = {
                date, concept: `Pago a capital: ${concept}`, charge: capitalAmount, credit: 0,
                type: 'financiero', sub_type: 'pago_capital', category: '', channel: '',
                source: 'manual' // Distinguish source
            };
            batch.set(doc(collection(this.db, "expenses")), capitalEntry);
        }
        if (interestAmount > 0) {
            const interestEntry = {
                date, concept: `Intereses: ${concept}`, charge: interestAmount, credit: 0,
                type: 'financiero', sub_type: 'pago_intereses', category: 'Gastos Financieros', channel: '',
                source: 'manual' // Distinguish source
            };
            batch.set(doc(collection(this.db, "expenses")), interestEntry);
        }
    }
    
    try {
        await batch.commit();
        this.showModal({ show: false });
    } catch(error) {
        console.error("Error saving financial transaction:", error);
        this.actionHistory.pop();
    }
  },

  async deleteExpense(id) {
    this.saveStateToHistory();
    try {
        await deleteDoc(doc(this.db, "expenses", id));
        this.showModal({ show: false });
    } catch (error) {
        console.error("Error borrando el registro:", error);
        this.actionHistory.pop();
        this.showModal({ title: 'Error', body: 'No se pudo borrar el registro.', showCancel: false });
    }
  },

  confirmDeleteExpense(id) {
      this.showModal({
          title: "Confirmar Eliminación", body: "¿Estás seguro de que quieres borrar este registro único?",
          confirmText: "Eliminar", confirmClass: 'btn-danger',
          onConfirm: () => this.deleteExpense(id)
      });
  },

  showModal({ show = true, title, body, onConfirm, onModalOpen, confirmText = 'Confirmar', confirmClass = '', showCancel = true, showConfirm = true }) {
      if (!show) { this.elements.modal.classList.remove('visible'); return; }
      this.elements.modalTitle.textContent = title;
      this.elements.modalBody.innerHTML = body;
      this.elements.modalConfirmBtn.textContent = confirmText;
      this.elements.modalConfirmBtn.className = `btn ${confirmClass}`;
      this.elements.modalConfirmBtn.style.display = showConfirm ? 'inline-flex' : 'none';
      this.elements.modalCancelBtn.style.display = showCancel ? 'inline-flex' : 'none';
      this.elements.modalConfirmBtn.onclick = onConfirm ? onConfirm : () => this.showModal({ show: false });
      this.elements.modalCancelBtn.onclick = () => this.showModal({ show: false });
      this.elements.modal.classList.add('visible');
      if (onModalOpen) onModalOpen();
  },
  
  handleTabClick(tab) {
      this.elements.tabs.forEach(t => t.classList.remove('active'));
      this.elements.tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
      if (tab.dataset.tab === 'charts') this.updateAllCharts();
      if (tab.dataset.tab === 'health') this.updateFinancialHealthDashboard();
  },

  exportToExcel() {
      const data = this.getFilteredExpenses().map(e => ({ Fecha: e.date, Concepto: e.concept, Cargo: e.charge, Ingreso: e.credit, Categoría: e.category, Canal: e.channel }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Gastos");
      XLSX.writeFile(wb, "gastos.xlsx");
  },
  
  updateAllCharts() {
    const expenses = this.getFilteredExpenses().filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses');
    
    const totalIncome = expenses.reduce((acc, exp) => acc + (parseFloat(exp.credit) || 0), 0);

    const categories = {};
    expenses.forEach(expense => {
        const charge = parseFloat(expense.charge) || 0;
        if (charge > 0) {
            const category = expense.category || 'SinCategorizar';
            if (!categories[category]) categories[category] = 0;
            categories[category] += charge;
        }
    });
    
    const sorted = Object.entries(categories).sort(([,a],[,b]) => b-a);
    const labels = sorted.map(([key]) => key);
    const values = sorted.map(([,val]) => val);
    const colors = labels.map(label => getComputedStyle(document.documentElement).getPropertyValue(`--c-${label.toLowerCase().replace(/ /g, '')}`).trim() || '#9ca3af');
    
    if (this.elements.chartContexts.pie) {
        if (this.charts.pieChart) this.charts.pieChart.destroy();
        this.charts.pieChart = new Chart(this.elements.chartContexts.pie, this.getChartConfig('pie', labels, values, colors, 'Distribución de Gastos Operativos', totalIncome));
    }
    if (this.elements.chartContexts.category) {
        if (this.charts.categoryChart) this.charts.categoryChart.destroy();
         this.charts.categoryChart = new Chart(this.elements.chartContexts.category, this.getChartConfig('bar', labels, values, colors, 'Gastos Operativos por Categoría'));
    }
    if (this.elements.chartContexts.compare) {
        if (this.charts.compareChart) this.charts.compareChart.destroy();
        this.charts.compareChart = new Chart(this.elements.chartContexts.compare, this.getCompareChartConfig(categories['Alex'] || 0, categories['Chris'] || 0));
    }
  },

  getChartConfig(type, labels, values, colors, title, totalForPercentage) {
      const totalExpenses = values.reduce((acc, value) => acc + value, 0);
      const totalForCalc = (totalForPercentage !== undefined && totalForPercentage > 0) ? totalForPercentage : totalExpenses;

      return {
          type: type,
          data: {
              labels: labels,
              datasets: [{ label: 'Total', data: values, backgroundColor: colors, borderColor: type === 'pie' || type === 'doughnut' ? '#fff' : 'transparent', borderWidth: 2 }]
          },
          options: {
              responsive: true, maintainAspectRatio: false,
              plugins: {
                  legend: { 
                      display: type === 'pie' || type === 'doughnut', 
                      position: 'right' 
                  },
                  title: { 
                      display: true, 
                      text: title, 
                      font: { size: 16 } 
                  },
                  tooltip: {
                      callbacks: {
                          label: (context) => {
                              const label = context.label || '';
                              const value = context.raw;
                              const percentage = totalForCalc > 0 ? ((value / totalForCalc) * 100).toFixed(2) : 0;
                              return `${label}: ${this.formatCurrency(value)} (${percentage}%)`;
                          }
                      }
                  }
              },
              scales: { 
                  y: { beginAtZero: true, display: type !== 'pie' && type !== 'doughnut' }, 
                  x: { display: type !== 'pie' && type !== 'doughnut' } 
              }
          }
      }
  },
  
  getCompareChartConfig(alexTotal, chrisTotal) {
      return {
          type: 'bar',
          data: {
              labels: ['Alex', 'Chris'],
              datasets: [{ label: 'Total Gasto', data: [alexTotal, chrisTotal], backgroundColor: [getComputedStyle(document.documentElement).getPropertyValue('--c-alex').trim(), getComputedStyle(document.documentElement).getPropertyValue('--c-chris').trim()] }]
          },
          options: {
              responsive: true, maintainAspectRatio: false, indexAxis: 'y',
              plugins: { legend: { display: false }, title: { display: true, text: 'Comparación: Alex vs Chris', font: { size: 16 } },
                  tooltip: { callbacks: { label: c => this.formatCurrency(c.raw) } }
              },
              scales: { x: { ticks: { callback: v => this.formatCurrency(v) } } } 
          }
      };
  },

  updateFinancialHealthDashboard() {
    const expenses = this.getFilteredExpenses(true);
    const { totalOrdersCount, paidOrdersCount, paidOrdersRevenue } = this.state.financials;
    const cogsCategories = ['Material', 'Sueldos'];
    const drawCategories = ['Alex', 'Chris'];

    const incomeTransactions = expenses.filter(exp => {
        const isOperational = exp.type === 'operativo' || !exp.type;
        return isOperational && (parseFloat(exp.credit) || 0) > 0;
    });

    const totalAccountingRevenue = incomeTransactions.reduce((acc, exp) => acc + exp.credit, 0);
    
    let ownerDraw = 0;
    let cogs = 0;
    let operatingExpenses = 0;

    expenses.forEach(exp => {
        const charge = parseFloat(exp.charge) || 0;
        if (charge > 0) {
            const isOperational = exp.type === 'operativo' || !exp.type;
            if (drawCategories.includes(exp.category)) {
                ownerDraw += charge;
            } 
            else if (isOperational || exp.sub_type === 'pago_intereses') {
                if (cogsCategories.includes(exp.category)) {
                    cogs += charge;
                } else {
                    operatingExpenses += charge;
                }
            }
        }
    });
    
    const totalBusinessCosts = cogs + operatingExpenses;
    const operatingProfit = totalAccountingRevenue - totalBusinessCosts; 
    const netProfit = operatingProfit - ownerDraw; 
    const operatingMargin = totalAccountingRevenue === 0 ? 0 : (operatingProfit / totalAccountingRevenue) * 100;

    const avgTicketSales = paidOrdersCount > 0 ? paidOrdersRevenue / paidOrdersCount : 0;
    const conversionRate = totalOrdersCount > 0 ? (paidOrdersCount / totalOrdersCount) * 100 : 0;

    // Update KPI cards
    this.elements.kpiTotalRevenue.textContent = this.formatCurrency(totalAccountingRevenue);
    this.elements.kpiSalesRevenue.textContent = this.formatCurrency(paidOrdersRevenue);
    this.elements.kpiCosts.textContent = this.formatCurrency(totalBusinessCosts);
    this.elements.kpiOperatingProfit.textContent = this.formatCurrency(operatingProfit);
    this.elements.kpiOwnerDraw.textContent = this.formatCurrency(ownerDraw);
    this.elements.kpiNetProfit.textContent = this.formatCurrency(netProfit);
    this.elements.kpiLeads.textContent = totalOrdersCount;
    this.elements.kpiPaidOrders.textContent = paidOrdersCount;
    this.elements.kpiAvgTicketSales.textContent = this.formatCurrency(avgTicketSales); 
    this.elements.kpiConversionRate.textContent = `${conversionRate.toFixed(2)}%`; 

    // Update KPI card colors
    this.elements.kpiOperatingProfit.classList.toggle('positive', operatingProfit >= 0);
    this.elements.kpiOperatingProfit.classList.toggle('negative', operatingProfit < 0);
    this.elements.kpiNetProfit.classList.toggle('positive', netProfit >= 0);
    this.elements.kpiNetProfit.classList.toggle('negative', netProfit < 0);

    // Update Thermometer
    const thermometerPercentage = 50 + (operatingMargin * 2.5);
    const clampedPercentage = Math.max(0, Math.min(100, thermometerPercentage));
    this.elements.thermometerBar.style.width = `${clampedPercentage}%`;
    this.elements.thermometerPercentage.textContent = `${operatingMargin.toFixed(1)}%`;
    
    this.updateLeadsTrendChart();
  },
  
  updateLeadsTrendChart() {
    if (!this.elements.chartContexts.leadsTrend) return;
    if (this.charts.leadsTrendChart) {
        this.charts.leadsTrendChart.destroy();
    }
    
    const allOrders = this.state.financials.allOrders || [];
    const timeframe = this.state.financials.leadsChartTimeframe;
    
    let leadsByTime = {};
    let paidByTime = {};
    let title;

    if (timeframe === 'daily') {
        title = 'Tendencia de Leads vs. Pagados (Diario)';
        allOrders.forEach(doc => {
            const data = doc.data();
            if (data.createdAt && data.createdAt.toDate) {
                const date = data.createdAt.toDate();
                // FIX: Use local date parts to avoid UTC conversion issues with toISOString()
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const dayOfMonth = String(date.getDate()).padStart(2, '0');
                const day = `${year}-${month}-${dayOfMonth}`;
                
                leadsByTime[day] = (leadsByTime[day] || 0) + 1;
                if (data.estatus === 'Pagado') {
                    paidByTime[day] = (paidByTime[day] || 0) + 1;
                }
            }
        });
    } else { // monthly
        title = 'Tendencia de Leads vs. Pagados (Mensual)';
        allOrders.forEach(doc => {
            const data = doc.data();
            if (data.createdAt && data.createdAt.toDate) {
                const date = data.createdAt.toDate();
                const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                leadsByTime[month] = (leadsByTime[month] || 0) + 1;
                 if (data.estatus === 'Pagado') {
                    paidByTime[month] = (paidByTime[month] || 0) + 1;
                }
            }
        });
    }

    const sortedLabels = Object.keys(leadsByTime).sort((a, b) => new Date(a) - new Date(b));
    const leadsData = sortedLabels.map(label => leadsByTime[label] || 0);
    const paidData = sortedLabels.map(label => paidByTime[label] || 0);

    this.charts.leadsTrendChart = new Chart(this.elements.chartContexts.leadsTrend, {
        type: 'bar',
        data: {
            labels: sortedLabels,
            datasets: [
                {
                    label: 'Leads',
                    data: leadsData,
                    backgroundColor: 'rgba(59, 130, 246, 0.7)',
                    borderColor: 'var(--primary)',
                    borderWidth: 1
                },
                {
                    label: 'Pagados',
                    data: paidData,
                    backgroundColor: 'rgba(22, 163, 74, 0.7)',
                    borderColor: 'var(--success)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: false },
                legend: { display: true, position: 'top' }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
    this.elements.leadsChartTitle.textContent = title;
},

  formatCurrency(amount) {
      return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
  },

  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  },
  
   async handleSueldosFileUpload(e) {
    const file = e.dataTransfer ? e.dataTransfer.files[0] : e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const worksheet = workbook.Sheets[workbook.SheetNames[1]];
            if (!worksheet) {
                this.showModal({title: 'Error de Archivo', body: 'El archivo no contiene una segunda hoja de cálculo para los sueldos.', confirmText: 'Cerrar', showCancel: false});
                return;
            }
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
            
            const newEmployees = this.parseSueldosData(jsonData);
            this.mergeAndSaveSueldosData(newEmployees);

        } catch (error) {
            console.error("Error al procesar el archivo de sueldos:", error);
            this.showModal({title: 'Error', body: `Ocurrió un error al procesar el archivo de sueldos: ${error.message}`, confirmText: 'Cerrar', showCancel: false});
        } finally {
            if (e.target) e.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
},

async mergeAndSaveSueldosData(newEmployees) {
    const existingEmployees = JSON.parse(JSON.stringify(this.state.sueldosData));
    const employeeMap = new Map(existingEmployees.map(emp => [emp.id, emp]));
    let newCount = 0;
    let updatedCount = 0;

    newEmployees.forEach(newEmp => {
        const existingEmp = employeeMap.get(newEmp.id);
        if (existingEmp) {
            let updated = false;
            newEmp.registros.forEach(newReg => {
                const existingReg = existingEmp.registros.find(r => r.day === newReg.day);
                if (existingReg) {
                    if (existingReg.entrada !== newReg.entrada || existingReg.salida !== newReg.salida) {
                        existingReg.entrada = newReg.entrada;
                        existingReg.salida = newReg.salida;
                        updated = true;
                    }
                } else {
                    existingEmp.registros.push(newReg);
                    updated = true;
                }
            });
            if (updated) updatedCount++;
        } else {
            employeeMap.set(newEmp.id, newEmp);
            newCount++;
        }
    });

    this.state.sueldosData = Array.from(employeeMap.values());
    await this.saveSueldosDataToFirestore();
    this.showModal({
        title: 'Carga de Sueldos Completa',
        body: `Se agregaron ${newCount} empleados nuevos y se actualizaron los registros de ${updatedCount} empleados existentes.`,
        showCancel: false,
        confirmText: 'Entendido'
    });
},

async saveSueldosDataToFirestore(dataToSave) {
    try {
        const data = dataToSave || this.state.sueldosData;
        data.forEach(emp => {
            if (!emp.registros) emp.registros = [];
            if (!emp.descuentos) emp.descuentos = [];
            if (!emp.bonos) emp.bonos = [];
            if (!emp.paymentHistory) emp.paymentHistory = [];
        });
        await setDoc(doc(this.db, "sueldos", "main"), { employees: data });
    } catch (error) {
        console.error("Error saving sueldos data:", error);
        this.showModal({ title: 'Error', body: 'No se pudieron guardar los datos de sueldos.' });
    }
},

migrateSueldosDataStructure() {
    let needsUpdate = false;
    this.state.sueldosData.forEach(employee => {
        (employee.registros || []).forEach(registro => {
            if (registro.hasOwnProperty('horarios') && (!registro.hasOwnProperty('entrada') || !registro.hasOwnProperty('salida'))) {
                const timePattern = /\d{1,2}:\d{2}/g;
                const times = (registro.horarios || '').match(timePattern);
                registro.entrada = times && times[0] ? times[0] : '';
                registro.salida = times && times[1] ? times[1] : '';
                delete registro.horarios;
                needsUpdate = true;
            }
        });
    });

    if (needsUpdate) {
        this.saveSueldosDataToFirestore();
    }
},

filterSueldos() {
    const { start, end } = this.state.sueldosDateFilter;
    let baseData = JSON.parse(JSON.stringify(this.state.sueldosData));

    baseData.forEach(emp => {
        if (emp.departamento === 'Manual') {
            this.populateMonthForManualEmployee(emp);
        }
    });

    let employeesToDisplay;

    if (start && end) {
        const startDate = new Date(start);
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(end);
        endDate.setUTCHours(23, 59, 59, 999);

        employeesToDisplay = baseData.map(employee => {
            const filteredEmployee = { ...employee };

            // IMPROVEMENT: Fixed bug where payroll records were miscalculated when a week crossed over into a new month.
            filteredEmployee.registros = (employee.registros || []).filter(registro => {
                const day = parseInt(registro.day, 10);
                if (isNaN(day)) return false;

                let recordDate;
                // If the range is in a single month, the logic is simple.
                if (startDate.getUTCMonth() === endDate.getUTCMonth()) {
                    recordDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), day));
                } else {
                    // If range spans months, determine if the day belongs to the start or end month.
                    // This assumes a pay period doesn't span more than two months.
                    if (day >= startDate.getUTCDate()) {
                        recordDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), day));
                    } else {
                        recordDate = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), day));
                    }
                }
                return recordDate >= startDate && recordDate <= endDate;
            });

            filteredEmployee.descuentos = (employee.descuentos || []).filter(gasto => {
                const gastoDate = new Date(gasto.fecha + 'T00:00:00Z');
                return gastoDate >= startDate && gastoDate <= endDate;
            });

            filteredEmployee.bonos = (employee.bonos || []).filter(bono => {
                const bonoDate = new Date(bono.fecha + 'T00:00:00Z');
                return bonoDate >= startDate && bonoDate <= endDate;
            });
            
            return filteredEmployee;
        });
    } else {
        employeesToDisplay = baseData;
    }

    employeesToDisplay.forEach(emp => this.recalculatePayment(emp));

    this.renderSueldosData(employeesToDisplay, (start && end));
},

populateMonthForManualEmployee(employee) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const existingDays = new Set(employee.registros.map(r => r.day));

    for (let day = 1; day <= daysInMonth; day++) {
        if (!existingDays.has(String(day))) {
            employee.registros.push({
                day: String(day),
                entrada: '',
                salida: '',
                horas: '00:00'
            });
        }
    }
    employee.registros.sort((a,b) => parseInt(a.day) - parseInt(b.day));
},

resetSueldosFilter() {
    if (this.sueldosPicker) this.sueldosPicker.clearSelection();
    this.state.sueldosDateFilter.start = null;
    this.state.sueldosDateFilter.end = null;
    this.filterSueldos();
},

calculateMinutesFromEntryExit(entrada, salida) {
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
},


recalculatePayment(employee) {
    let totalMinutes = 0;
    const ratePerHour = employee.ratePerHour || 70; 
    
    (employee.registros || []).forEach(r => {
        const dailyMinutes = this.calculateMinutesFromEntryExit(r.entrada, r.salida);
        r.totalMinutos = dailyMinutes;
        const h = Math.floor(dailyMinutes / 60);
        const m = Math.round(dailyMinutes % 60);
        r.horas = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        totalMinutes += dailyMinutes;
    });
    
    const totalHours = Math.floor(totalMinutes / 60);
    const totalMins = Math.round(totalMinutes % 60);
    employee.totalHoursFormatted = `${totalHours}:${String(totalMins).padStart(2, '0')}`;
    employee.totalHoursDecimal = totalMinutes / 60;
    
    employee.totalDescuentos = (employee.descuentos || []).reduce((acc, gasto) => acc + (parseFloat(gasto.cantidad) || 0), 0);
    employee.totalBonos = (employee.bonos || []).reduce((acc, bono) => acc + (parseFloat(bono.cantidad) || 0), 0);
    const grossPayment = employee.totalHoursDecimal * ratePerHour;
    employee.pago = (grossPayment - employee.totalDescuentos) + employee.totalBonos;
},

renderSueldosData(employeesToRender, isFiltered = false) {
    if (!employeesToRender || employeesToRender.length === 0) {
        this.elements.sueldosTableContainer.innerHTML = '';
        if (!isFiltered) {
             this.elements.sueldosEmptyState.style.display = 'block';
        }
        return;
    }

    this.elements.sueldosEmptyState.style.display = 'none';
    this.elements.sueldosTableContainer.innerHTML = '';

    employeesToRender.forEach((employee) => {
        const card = document.createElement('div');
        card.className = 'employee-card';
        card.dataset.employeeId = employee.id;

        const registrosHtml = (employee.registros && employee.registros.length > 0) ?
            employee.registros.map((r) => `
            <tr>
                <td>${r.day}</td>
                <td contenteditable="true" data-type="entrada">${r.entrada || ''}</td>
                <td contenteditable="true" data-type="salida">${r.salida || ''}</td>
                <td>${r.horas || '00:00'}</td>
            </tr>
            `).join('') :
            '<tr><td colspan="4" style="text-align:center; padding: 10px;">Sin registros de horas en este período.</td></tr>';

        const paymentLabel = isFiltered ? " (filtrado)" : "";
        
        const allAdjustments = [
            ...((employee.descuentos || []).map(d => ({...d, type: 'gasto'}))),
            ...((employee.bonos || []).map(b => ({...b, type: 'bono'})))
        ].sort((a,b) => a.fecha.localeCompare(b.fecha));

        const adjustmentsListHtml = allAdjustments.length > 0 ?
            allAdjustments.map(adj => `
                <div class="adjustment-item ${adj.type}">
                    <span class="date">${new Date(adj.fecha + 'T00:00:00Z').toLocaleDateString('es-MX', {timeZone: 'UTC'})}</span>
                    <span class="concept">${adj.concepto}</span>
                    <span class="amount">${adj.type === 'gasto' ? '-' : '+'} ${this.formatCurrency(adj.cantidad)}</span>
                    <button class="delete-adjustment-btn" data-employee-id="${employee.id}" data-adjustment-id="${adj.id}" data-adjustment-type="${adj.type}"><i class="fas fa-times-circle"></i></button>
                </div>
            `).join('') :
            '<p style="font-size:13px; color: var(--text-secondary); text-align:center;">Sin bonos ni descuentos en este período.</p>';
        
        const historyHtml = (employee.paymentHistory && employee.paymentHistory.length > 0) ?
            [...employee.paymentHistory].sort((a, b) => b.startDate.localeCompare(a.startDate)).map(h => `
                <tr>
                    <td>${new Date(h.startDate + 'T00:00:00Z').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })} - ${new Date(h.endDate + 'T00:00:00Z').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })}</td>
                    <td style="text-align: right;">${this.formatCurrency(h.netPay)}</td>
                </tr>
            `).join('') :
            '<tr><td colspan="2" style="text-align:center; padding: 10px;">Sin historial de pagos.</td></tr>';


        card.innerHTML = `
            <div class="employee-header">
                <div>
                    <h3>${employee.nombre}</h3>
                </div>
                <div class="employee-header-rate">
                    <label for="rate-${employee.id}">Pago por hora:</label>
                    <div class="rate-input-wrapper">
                        <span class="rate-input-symbol">$</span>
                        <input type="number" class="hourly-rate-input" id="rate-${employee.id}" value="${employee.ratePerHour || 70}" step="1" min="0">
                    </div>
                </div>
            </div>
            <div class="employee-body">
                <div class="table-container">
                    <table>
                        <thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th>Total Horas</th></tr></thead>
                        <tbody>${registrosHtml}</tbody>
                    </table>
                </div>
                
                <div class="employee-payment-summary">
                    <div class="payment-row">
                        <strong>Horas Totales${paymentLabel}:</strong>
                        <span>${employee.totalHoursFormatted || '0:00'}</span>
                    </div>
                    <div class="adjustments-list">
                        <h6>Bonos y Descuentos Aplicados</h6>
                        ${adjustmentsListHtml}
                    </div>
                    <div class="payment-row" style="margin-top: 5px;">
                        <strong>Subtotal Bonos:</strong>
                        <span style="color: var(--success);">${this.formatCurrency(employee.totalBonos || 0)}</span>
                    </div>
                    <div class="payment-row">
                        <strong>Subtotal Descuentos:</strong>
                        <span style="color: var(--danger);">${this.formatCurrency(employee.totalDescuentos || 0)}</span>
                    </div>
                    <div class="payment-row final-payment">
                        <strong>Pago Neto:</strong>
                        <span>${this.formatCurrency(employee.pago || 0)}</span>
                    </div>
                </div>
                <div class="payment-history-container">
                    <h6>Historial de Pagos</h6>
                    <div class="table-container" style="max-height: 200px;">
                        <table>
                            <thead>
                                <tr>
                                    <th>Periodo</th>
                                    <th style="text-align: right;">Pago Neto</th>
                                </tr>
                            </thead>
                            <tbody>
                               ${historyHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div class="employee-actions btn-group" style="padding: 0 16px 16px; justify-content: flex-end;">
                <button class="btn btn-sm btn-success add-bono-btn"><i class="fas fa-gift"></i> Agregar Bono</button>
                <button class="btn btn-sm btn-danger add-gasto-btn" style="background-color: var(--danger-light); border-color: transparent; color: var(--danger);"><i class="fas fa-minus-circle"></i> Agregar Gasto</button>
                <button class="btn btn-sm btn-outline share-text-btn"><i class="fab fa-whatsapp"></i> Compartir</button>
                <button class="btn btn-sm btn-primary download-pdf-btn"><i class="fas fa-file-pdf"></i> PDF</button>
            </div>
        `;
        this.elements.sueldosTableContainer.appendChild(card);
        
        card.querySelector('.add-bono-btn').addEventListener('click', () => this.openBonoModal(employee.id));
        card.querySelector('.add-gasto-btn').addEventListener('click', () => this.openGastoModal(employee.id));
        card.querySelector('.share-text-btn').addEventListener('click', () => this.sendWhatsAppMessage(employee));
        card.querySelector('.download-pdf-btn').addEventListener('click', () => this.generateReportPdf(employee));
        card.querySelector('.hourly-rate-input').addEventListener('change', (e) => {
            const newRate = parseFloat(e.target.value);
            if (!isNaN(newRate) && newRate >= 0) {
                this.updateEmployeeRate(employee.id, newRate);
            } else {
                e.target.value = employee.ratePerHour || 70;
            }
        });

        // Add event listeners for the new delete buttons
        card.querySelectorAll('.delete-adjustment-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const { employeeId, adjustmentId, adjustmentType } = e.currentTarget.dataset;
                this.confirmDeleteAdjustment(employeeId, adjustmentId, adjustmentType);
            });
        });
    });
    
    document.querySelectorAll('#sueldos-table-container td[contenteditable="true"]').forEach(cell => {
        cell.addEventListener('blur', (e) => this.updateSchedule(e.target));
        cell.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { // Allow Shift+Enter for new lines
                e.preventDefault();
                cell.blur();
            }
        });
    });
},

async updateEmployeeRate(employeeId, newRate) {
    const employee = this.state.sueldosData.find(emp => emp.id == employeeId);
    if (employee) {
        employee.ratePerHour = newRate;
        await this.saveSueldosDataToFirestore();
    }
},

async updateSchedule(cell) {
    // 1. Sanitize the input to ensure it's a valid time format.
    const originalText = cell.textContent;
    let sanitizedText = originalText.replace(/[^0-9:]/g, '');
    const parts = sanitizedText.split(':');
    if (parts.length > 2) {
        sanitizedText = parts.slice(0, 2).join(':');
    }
    if (sanitizedText !== originalText) {
        cell.textContent = sanitizedText;
    }

    // 2. Get the context (employee, specific day record).
    const card = cell.closest('.employee-card');
    const employeeId = card.dataset.employeeId;
    const employee = this.state.sueldosData.find(emp => emp.id == employeeId);
    if (!employee) return;

    const tr = cell.closest('tr');
    const day = tr.cells[0].textContent;
    const registro = employee.registros.find(r => r.day == day);
    if (!registro) return;

    // 3. Update the local state from the table's content.
    registro.entrada = tr.querySelector('[data-type="entrada"]').textContent;
    registro.salida = tr.querySelector('[data-type="salida"]').textContent;

    // 4. Recalculate everything for this employee based on the new data.
    this.recalculatePayment(employee);

    // 5. Update the user interface immediately with the new calculations.
    tr.cells[3].textContent = registro.horas; // Update "Total Horas" in the specific row.
    const totalHoursSpan = card.querySelector('.employee-payment-summary .payment-row:first-child span');
    totalHoursSpan.textContent = employee.totalHoursFormatted; // Update total hours in the summary.
    const netPaySpan = card.querySelector('.payment-row.final-payment span');
    netPaySpan.textContent = this.formatCurrency(employee.pago); // Update net pay in the summary.

    // 6. Save the updated employee data to Firestore.
    await this.saveSueldosDataToFirestore();
},

parseSueldosData(data) {
    const employees = [];
    const namesToHide = ['alex', 'jovita', 'victoria', 'chris'];
    // Assuming day numbers are in the second row (index 1)
    const daysRow = data.find(row => Array.isArray(row) && row.length > 5 && !isNaN(parseInt(row[0]))) || data[1];

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!Array.isArray(row)) continue;

        // Find rows that look like employee headers
        const idCellIndex = row.findIndex(cell => String(cell).toLowerCase().includes('id'));
        const nameCellIndex = row.findIndex(cell => String(cell).toLowerCase().includes('nombre'));

        if (idCellIndex === -1 || nameCellIndex === -1) continue;
        
        const employeeName = this.capitalize(String(row[nameCellIndex + 1] || 'N/A'));
        const employeeId = String(row[idCellIndex + 1] || 'N/A');
        const deptCellIndex = row.findIndex(cell => String(cell).toLowerCase().includes('dept'));
        const employeeDept = deptCellIndex > -1 ? String(row[deptCellIndex + 1] || 'N/A') : 'N/A';

        if (namesToHide.includes(employeeName.toLowerCase())) continue;
        
        const employee = { 
            nombre: employeeName, 
            id: employeeId, 
            departamento: employeeDept, 
            registros: [], 
            descuentos: [], 
            bonos: [],
            ratePerHour: 70 
        };
        
        // Find the corresponding 'Entrada' and 'Salida' rows for this employee
        const entradaRow = data.find((r, index) => index > i && String(r[0]).toLowerCase().trim() === 'entrada');
        const salidaRow = data.find((r, index) => index > i && String(r[0]).toLowerCase().trim() === 'salida');

        if (entradaRow && salidaRow) {
            for (let j = 1; j < daysRow.length; j++) { // Start from 1 to skip header
                const day = daysRow[j];
                if (day) {
                     employee.registros.push({ 
                        day: String(day), 
                        entrada: String(entradaRow[j] || ''),
                        salida: String(salidaRow[j] || '')
                    });
                }
            }
        }
        
        if (employee.id !== 'N/A') {
            employees.push(employee);
        }
    }
    return employees;
},


openGastoModal(employeeId) {
    const employee = this.state.sueldosData.find(emp => emp.id == employeeId);
    if (!employee) return;

    const today = new Date().toISOString().split('T')[0];
    const title = `Agregar Gasto para ${employee.nombre}`;
    const bodyHtml = `
        <div class="form-group">
            <label for="gasto-fecha">Fecha del Gasto:</label>
            <input type="date" id="gasto-fecha" class="modal-input" value="${today}">
        </div>
        <div class="form-group">
            <label for="gasto-concepto">Concepto:</label>
            <input type="text" id="gasto-concepto" class="modal-input" placeholder="Ej: Préstamo, adelanto, etc.">
        </div>
        <div class="form-group">
            <label for="gasto-cantidad">Cantidad ($):</label>
            <input type="number" id="gasto-cantidad" class="modal-input" placeholder="Ej: $50.00" step="0.01">
        </div>
    `;
    
    this.showModal({ title: title, body: bodyHtml, onConfirm: () => this.handleGastoSubmit(employeeId), confirmText: 'Agregar Gasto' });
},

async handleGastoSubmit(employeeId) {
    const fecha = this.elements.modalBody.querySelector('#gasto-fecha').value;
    const cantidad = parseFloat(this.elements.modalBody.querySelector('#gasto-cantidad').value);
    const concepto = this.elements.modalBody.querySelector('#gasto-concepto').value.trim();

    if (!fecha || isNaN(cantidad) || cantidad <= 0 || !concepto) {
        this.showModal({title: 'Datos incompletos', body: 'Por favor, completa todos los campos con valores válidos.', confirmText: 'Cerrar', showCancel: false});
        return;
    }

    const employee = this.state.sueldosData.find(emp => emp.id == employeeId);
    if (employee) {
        if (!employee.descuentos) employee.descuentos = [];
        const newGasto = { id: Date.now().toString(), fecha, concepto, cantidad };
        employee.descuentos.push(newGasto);

        // IMPROVEMENT: Also add the loan/advance as an expense in the main table for better tracking.
        const expenseData = {
            date: fecha,
            concept: `Adelanto/Préstamo a ${employee.nombre}: ${concepto}`,
            charge: cantidad,
            credit: 0,
            category: 'Sueldos', // This links it to payroll expenses.
            type: 'operativo',
            sub_type: 'adelanto_sueldo',
            source: 'manual-sueldos' 
        };
        
        try {
            await addDoc(collection(this.db, "expenses"), expenseData);
            await this.saveSueldosDataToFirestore();
        } catch (error) {
            console.error("Error saving gasto/expense:", error);
            this.showModal({title: 'Error', body: 'No se pudo guardar el gasto. Inténtalo de nuevo.', confirmText: 'Cerrar', showCancel: false});
            return; // Stop if saving fails
        }
    }
    this.showModal({ show: false });
},

openBonoModal(employeeId) {
    const employee = this.state.sueldosData.find(emp => emp.id == employeeId);
    if (!employee) return;

    const today = new Date().toISOString().split('T')[0];
    const title = `Agregar Bono para ${employee.nombre}`;
    const bodyHtml = `
        <div class="form-group">
            <label for="bono-fecha">Fecha del Bono:</label>
            <input type="date" id="bono-fecha" class="modal-input" value="${today}">
        </div>
        <div class="form-group">
            <label for="bono-concepto">Concepto:</label>
            <input type="text" id="bono-concepto" class="modal-input" placeholder="Ej: Puntualidad, desempeño, etc.">
        </div>
        <div class="form-group">
            <label for="bono-cantidad">Cantidad ($):</label>
            <input type="number" id="bono-cantidad" class="modal-input" placeholder="Ej: $100.00" step="0.01">
        </div>
    `;

    this.showModal({title: title, body: bodyHtml, onConfirm: () => this.handleBonoSubmit(employeeId), confirmText: 'Agregar Bono'});
},

async handleBonoSubmit(employeeId) {
    const fecha = this.elements.modalBody.querySelector('#bono-fecha').value;
    const cantidad = parseFloat(this.elements.modalBody.querySelector('#bono-cantidad').value);
    const concepto = this.elements.modalBody.querySelector('#bono-concepto').value.trim();

    if (!fecha || isNaN(cantidad) || cantidad <= 0 || !concepto) {
        this.showModal({title: 'Datos incompletos', body: 'Por favor, completa todos los campos con valores válidos.', confirmText: 'Cerrar', showCancel: false});
        return;
    }

    const employee = this.state.sueldosData.find(emp => emp.id == employeeId);
    if (employee) {
        if (!employee.bonos) employee.bonos = [];
        const newBono = { id: Date.now().toString(), fecha, concepto, cantidad };
        employee.bonos.push(newBono);
        await this.saveSueldosDataToFirestore();
    }
    this.showModal({ show: false });
},

 confirmDeleteAdjustment(employeeId, adjustmentId, adjustmentType) {
    this.showModal({
        title: 'Confirmar Eliminación',
        body: '¿Estás seguro de que quieres eliminar este ajuste? Esta acción no se puede deshacer.',
        confirmText: 'Sí, Eliminar',
        confirmClass: 'btn-danger',
        onConfirm: () => this.handleDeleteAdjustment(employeeId, adjustmentId, adjustmentType)
    });
},

async handleDeleteAdjustment(employeeId, adjustmentId, adjustmentType) {
    const updatedSueldosData = this.state.sueldosData.map(emp => {
        if (String(emp.id) === String(employeeId)) {
            const updatedEmp = { ...emp };
            if (adjustmentType === 'gasto' && updatedEmp.descuentos) {
                updatedEmp.descuentos = updatedEmp.descuentos.filter(d => String(d.id) !== String(adjustmentId));
            } else if (adjustmentType === 'bono' && updatedEmp.bonos) {
                updatedEmp.bonos = updatedEmp.bonos.filter(b => String(b.id) !== String(adjustmentId));
            }
            return updatedEmp;
        }
        return emp;
    });
    
    await this.saveSueldosDataToFirestore(updatedSueldosData);
    this.showModal({ show: false });
},

confirmCloseWeek() {
    const today = new Date();
    const dayOfWeek = today.getDay(); // Sunday = 0, Monday = 1, etc.
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMonday);
    
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    const formatDate = (date) => date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });

    this.showModal({
        title: 'Confirmar Cierre de Semana',
        body: `¿Estás seguro de que quieres cerrar y guardar el pago para la semana del <strong>${formatDate(monday)}</strong> al <strong>${formatDate(friday)}</strong>? <br><br>Esta acción calculará el pago neto de este período para cada empleado y lo guardará en su historial. No se puede deshacer.`,
        confirmText: 'Sí, Cerrar Semana',
        confirmClass: 'btn-success',
        onConfirm: () => this.closeWeek(monday, friday)
    });
},

async closeWeek(monday, friday) {
    const startDate = monday.toISOString().split('T')[0];
    const endDate = friday.toISOString().split('T')[0];
    let updatedCount = 0;

    this.state.sueldosData.forEach(employee => {
        if (!employee.paymentHistory) employee.paymentHistory = [];

        const historyExists = employee.paymentHistory.some(h => h.startDate === startDate);
        if (historyExists) return;

        const tempEmployee = JSON.parse(JSON.stringify(employee));
        
        const startDateTime = new Date(startDate + 'T00:00:00Z');
    const endDateTime = new Date(endDate + 'T23:59:59Z');

    tempEmployee.registros = (tempEmployee.registros || []).filter(registro => {
        const day = parseInt(registro.day, 10);
        if (isNaN(day)) return false;
        
        // IMPROVEMENT: Fixed bug for month crossovers, same as in filterSueldos.
        let recordDate;
        if (startDateTime.getUTCMonth() === endDateTime.getUTCMonth()) {
            recordDate = new Date(Date.UTC(startDateTime.getUTCFullYear(), startDateTime.getUTCMonth(), day));
        } else {
            if (day >= startDateTime.getUTCDate()) {
                recordDate = new Date(Date.UTC(startDateTime.getUTCFullYear(), startDateTime.getUTCMonth(), day));
            } else {
                recordDate = new Date(Date.UTC(endDateTime.getUTCFullYear(), endDateTime.getUTCMonth(), day));
            }
        }
        return recordDate >= startDateTime && recordDate <= endDateTime;
    });
    tempEmployee.descuentos = (tempEmployee.descuentos || []).filter(gasto => {
        const gastoDate = new Date(gasto.fecha + 'T00:00:00Z');
            return gastoDate >= startDateTime && gastoDate <= endDateTime;
        });
        tempEmployee.bonos = (tempEmployee.bonos || []).filter(bono => {
            const bonoDate = new Date(bono.fecha + 'T00:00:00Z');
            return bonoDate >= startDateTime && bonoDate <= endDateTime;
        });

        this.recalculatePayment(tempEmployee);

        const historyRecord = {
            startDate: startDate,
            endDate: endDate,
            netPay: tempEmployee.pago
        };
        
        employee.paymentHistory.push(historyRecord);
        updatedCount++;
    });

    if (updatedCount > 0) {
        await this.saveSueldosDataToFirestore();
        this.showModal({ title: 'Semana Cerrada', body: `Se ha guardado el historial de pago para ${updatedCount} empleado(s).`, showCancel: false, confirmText: 'Entendido' });
    } else {
        this.showModal({ title: 'Información', body: 'El historial de pago para esta semana ya ha sido guardado previamente para todos los empleados.', showCancel: false, confirmText: 'Entendido' });
    }
},

async generateReportPdf(employee) {
    const { jsPDF } = window.jspdf;
    const cardElement = document.querySelector(`.employee-card[data-employee-id="${employee.id}"]`);
    if (!cardElement) return;

    const clone = cardElement.cloneNode(true);
    clone.style.width = '800px'; 
    clone.style.boxShadow = 'none';
    document.body.appendChild(clone);

    try {
        const canvas = await html2canvas(clone, { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL('image/png');
        
        const pdf = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'letter'
        });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        
        pdf.addImage(imgData, 'PNG', 10, 10, pdfWidth - 20, pdfHeight);
        pdf.save(`Reporte-${employee.nombre.replace(/ /g, '_')}.pdf`);

        this.showPdfInstructionModal(employee);
    } catch(error) {
        console.error("Error generating PDF:", error);
        this.showModal({title: 'Error de PDF', body: "Hubo un error al generar el PDF.", confirmText: 'Cerrar', showCancel: false});
    } finally {
        document.body.removeChild(clone); 
    }
},

showPdfInstructionModal(employee) {
    const title = "PDF Generado";
    let bodyHtml = `<p>El reporte en PDF para <strong>${employee.nombre}</strong> se ha descargado exitosamente.</p>`;
    
    if (employee.nombre.toLowerCase() === 'diego') {
        const phoneNumber = '5216182297167'; 
        const whatsappUrl = `https://wa.me/${phoneNumber}`;
        bodyHtml += `<p style="margin-top:15px;">Ahora puedes enviarlo por WhatsApp. Haz clic en el botón para abrir la conversación y adjunta el archivo PDF descargado.</p>
                    <br>
                    <a href="${whatsappUrl}" target="_blank" class="btn btn-whatsapp" style="width: 100%; text-align: center; justify-content: center;"><i class="fab fa-whatsapp"></i> Abrir chat con Diego</a>`;
        this.showModal({title: title, body: bodyHtml, confirmText: 'Cerrar', showCancel: false, showConfirm: false});
    } else {
        this.showModal({title: title, body: bodyHtml, confirmText: 'Cerrar', showCancel: false});
    }
},

generateWhatsAppMessage(employee) {
    let message = `*Resumen de Pago para ${employee.nombre}*\n\n`;

    if (this.state.sueldosDateFilter.start && this.state.sueldosDateFilter.end) {
        const start = this.state.sueldosDateFilter.start.toLocaleDateString('es-MX', { timeZone: 'UTC' });
        const end = this.state.sueldosDateFilter.end.toLocaleDateString('es-MX', { timeZone: 'UTC' });
        message += `*Período:* ${start} al ${end}\n`;
    }
    
    message += `--------------------------------------\n`;
    message += `*Horas Trabajadas:* ${employee.totalHoursFormatted}\n`;
    message += `*Tarifa:* ${this.formatCurrency(employee.ratePerHour || 70)} / hora\n`;
    const pagoPorHoras = employee.totalHoursDecimal * (employee.ratePerHour || 70);
    message += `*Pago por Horas:* ${this.formatCurrency(pagoPorHoras)}\n`;
    
    if (employee.bonos && employee.bonos.length > 0) {
        message += `\n*Bonos:*\n`;
        employee.bonos.forEach(bono => {
            message += `  - ${bono.concepto}: ${this.formatCurrency(bono.cantidad)}\n`;
        });
        message += `*Subtotal Bonos:* ${this.formatCurrency(employee.totalBonos)}\n`;
    }

    if (employee.descuentos && employee.descuentos.length > 0) {
        message += `\n*Descuentos:*\n`;
        employee.descuentos.forEach(gasto => {
            message += `  - ${gasto.concepto}: -${this.formatCurrency(gasto.cantidad)}\n`;
        });
        message += `*Subtotal Descuentos:* -${this.formatCurrency(employee.totalDescuentos)}\n`;
    }
    
    message += `--------------------------------------\n`;
    message += `*PAGO NETO TOTAL:* *${this.formatCurrency(employee.pago)}*\n`;

    return message;
},

sendWhatsAppMessage(employee) {
    const message = this.generateWhatsAppMessage(employee);
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
},

initSueldosDateRangePicker() {
    this.sueldosPicker = new Litepicker({
        element: this.elements.sueldosDateRangeFilter,
        singleMode: false, autoApply: true, lang: 'es-MX', format: 'DD/MM/YYYY',
        setup: (p) => {
            p.on('selected', (d1, d2) => {
                this.state.sueldosDateFilter.start = d1.dateInstance;
                this.state.sueldosDateFilter.end = d2.dateInstance;
                this.filterSueldos();
            });
            p.on('clear:selection', () => this.resetSueldosFilter());
        }
    });
},

openAddEmployeeModal() {
    const title = 'Agregar Nuevo Empleado';
    const bodyHtml = `
        <div class="form-group">
            <label for="emp-name">Nombre:</label>
            <input type="text" id="emp-name" class="modal-input" placeholder="Nombre completo">
        </div>
        <div class="form-group">
            <label for="emp-id">ID:</label>
            <input type="text" id="emp-id" class="modal-input" placeholder="ID único del empleado">
        </div>
        <div class="form-group">
            <label for="emp-dept">Departamento:</label>
            <input type="text" id="emp-dept" class="modal-input" placeholder="Ej: Sam, Manual">
        </div>
         <div class="form-group">
            <label for="emp-rate">Pago por Hora ($):</label>
            <input type="number" id="emp-rate" class="modal-input" value="70">
        </div>
    `;
    
    this.showModal({ 
        title: title, 
        body: bodyHtml, 
        onConfirm: () => this.handleSaveNewEmployee(), 
        confirmText: 'Guardar Empleado' 
    });
},

async handleSaveNewEmployee() {
    const nombre = document.getElementById('emp-name').value.trim();
    const id = document.getElementById('emp-id').value.trim();
    const departamento = document.getElementById('emp-dept').value.trim();
    const ratePerHour = parseFloat(document.getElementById('emp-rate').value) || 70;

    if (!nombre || !id || !departamento) {
        this.showModal({title: 'Datos Incompletos', body: 'Por favor, completa todos los campos.', confirmText: 'Cerrar', showCancel: false});
        return;
    }

    const employeeExists = this.state.sueldosData.some(emp => emp.id === id);
    if (employeeExists) {
        this.showModal({title: 'ID Duplicado', body: 'Ya existe un empleado con ese ID. Por favor, usa uno diferente.', confirmText: 'Cerrar', showCancel: false});
        return;
    }

    const newEmployee = {
        nombre: this.capitalize(nombre),
        id,
        departamento,
        ratePerHour,
        registros: [],
        descuentos: [],
        bonos: [],
        paymentHistory: []
    };

    const updatedSueldos = [...this.state.sueldsData, newEmployee];
    await this.saveSueldosDataToFirestore(updatedSueldos);
    this.showModal({ show: false });
},
};

document.addEventListener('DOMContentLoaded', () => app.init());

