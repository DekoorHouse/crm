import { elements, state } from './state_admin.js';
import { formatCurrency, autoCategorize, capitalize } from './utils_admin.js';
import * as services from './services_admin.js';

/**
 * @file Módulo de gestión de la interfaz de usuario (UI).
 * @description Contiene todas las funciones que manipulan directamente el DOM,
 * como renderizar tablas, actualizar vistas, mostrar y ocultar modales.
 */

/**
 * Almacena en caché los elementos del DOM en el objeto 'elements'.
 */
export function cacheElements() {
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
    
    // KPIs Tab elements
    elements.addKpiBtn = document.getElementById('add-kpi-btn');
    elements.kpisTableBody = document.querySelector('#kpis-table tbody');
    elements.kpisEmptyState = document.getElementById('kpis-empty-state');
}

/**
 * Renderiza la tabla principal de gastos con los datos filtrados.
 * @param {Array<object>} expenses - Un array de objetos de gastos para mostrar.
 */
export function renderTable(expenses) {
    elements.dataTableBody.innerHTML = '';
    const sorted = [...expenses].sort((a,b) => (b.date > a.date) ? 1 : -1);
    
    // Get all unique categories for the dropdown
    const allCategories = [...new Set([...state.expenses.map(e => e.category), 'Alex', 'Chris', 'Sueldos', 'Publicidad', 'Envios', 'Local', 'Material', 'Tecnologia', 'Deudas', 'Devoluciones', 'GastosFinancieros', 'SinCategorizar'].filter(Boolean))].sort();

    sorted.forEach(expense => {
        const tr = document.createElement('tr');
        tr.dataset.id = expense.id;
        const charge = parseFloat(expense.charge) || 0;
        const credit = parseFloat(expense.credit) || 0;
        
        let categoryContent = '';
        let subcategoryContent = '';
        const isOperationalCharge = (expense.type === 'operativo' || !expense.type) && charge > 0;

        if (isOperationalCharge) {
            const categoryOptions = allCategories.map(cat => `<option value="${cat}" ${expense.category === cat ? 'selected' : ''}>${cat}</option>`).join('');
            categoryContent = `<select class="category-dropdown" data-expense-id="${expense.id}">${categoryOptions}</select>`;

            // Subcategory dropdown logic
            const parentCategory = expense.category;
            const subcategoriesForParent = state.subcategories[parentCategory] || [];
            if (parentCategory && parentCategory !== 'SinCategorizar') {
                 let subcategoryOptions = subcategoriesForParent
                    .map(sub => `<option value="${sub}" ${expense.subcategory === sub ? 'selected' : ''}>${sub}</option>`)
                    .join('');
                
                // Add "create new" option
                subcategoryOptions += `<option value="__add_new__" style="font-weight: bold; color: var(--primary);">+ Crear nueva...</option>`;
                
                subcategoryContent = `<select class="subcategory-dropdown" data-expense-id="${expense.id}">
                                        <option value="">-- Seleccionar --</option>
                                        ${subcategoryOptions}
                                      </select>`;
            } else {
                 subcategoryContent = 'N/A';
            }

        } else {
            // For credits or non-operational expenses
            categoryContent = expense.category || (credit > 0 ? (expense.channel || '') : 'N/A');
            subcategoryContent = expense.subcategory || 'N/A';
        }

        tr.innerHTML = `
            <td>${expense.date || ''}</td>
            <td>${expense.concept || ''}</td>
            <td>${charge > 0 ? formatCurrency(charge) : ''}</td>
            <td>${credit > 0 ? formatCurrency(credit) : ''}</td>
            <td>${categoryContent}</td>
            <td>${subcategoryContent}</td>
            <td class="btn-group">
                <button class="btn btn-outline btn-sm edit-btn"><i class="fas fa-pencil-alt"></i></button>
                <button class="btn btn-outline btn-sm delete-btn" style="color:var(--danger);"><i class="fas fa-trash"></i></button>
            </td>
        `;
        
        elements.dataTableBody.appendChild(tr);
    });
}
  
/**
 * Actualiza los totales en el pie de la tabla principal de gastos.
 * @param {Array<object>} expenses - El array de gastos que se está mostrando actualmente.
 */
export function updateTableTotals(expenses) {
    const { totalCharge, totalCredit } = expenses.reduce((acc, exp) => {
        acc.totalCharge += parseFloat(exp.charge) || 0;
        acc.totalCredit += parseFloat(exp.credit) || 0;
        return acc;
    }, { totalCharge: 0, totalCredit: 0 });
    elements.dataTableFooter.innerHTML = `
        <tr>
            <th colspan="2">Totales (Vista Actual):</th>
            <th>${formatCurrency(totalCharge)}</th>
            <th>${formatCurrency(totalCredit)}</th>
            <th colspan="3"></th>
        </tr>
    `;
}

/**
 * Renderiza la sección de resumen con tarjetas para cada categoría.
 * @param {Function} getFilteredExpenses - Función para obtener los gastos filtrados.
 */
export function updateSummary(getFilteredExpenses) {
    const operationalExpenses = getFilteredExpenses().filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses');
    
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
    
    elements.summarySection.innerHTML = '';
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
            const card = createSummaryCard(key, value, isClickable);
            elements.summarySection.appendChild(card);
        }
    });
}
  
/**
 * Crea el HTML para una tarjeta de resumen individual.
 * @param {string} title - El título de la tarjeta (generalmente la categoría).
 * @param {number} amount - El monto total para esa categoría.
 * @param {boolean} isClickable - Si la tarjeta debe tener la clase 'clickable'.
 * @returns {HTMLElement} El elemento de la tarjeta creado.
 */
export function createSummaryCard(title, amount, isClickable) {
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
      card.dataset.category = title;
      card.innerHTML = `
        <div class="icon-container"><i class="${icons[title] || 'fas fa-tag'}"></i></div>
        <div> <div class="summary-card-title">${displayTitle}</div> <div class="summary-card-value">${formatCurrency(amount)}</div> </div>`;
      return card;
}
  
/**
 * Muestra un modal con el desglose de gastos para una categoría específica.
 * @param {string} category - La categoría a detallar.
 * @param {Function} getFilteredExpenses - Función para obtener los gastos filtrados.
 */
export function showCategoryDetailsModal(category, getFilteredExpenses) {
    const categoryExpenses = getFilteredExpenses().filter(e => (e.category || 'SinCategorizar') === category && (parseFloat(e.charge) || 0) > 0);
    let total = 0;
    const rows = categoryExpenses.map(e => {
        const charge = parseFloat(e.charge) || 0;
        total += charge;
        return `<tr> <td>${e.date}</td> <td>${e.concept}</td> <td style="text-align: right;">${formatCurrency(charge)}</td> </tr>`;
    }).join('');
    const tableHtml = `
        <div class="table-container">
            <table>
                <thead> <tr> <th>Fecha</th> <th>Concepto</th> <th style="text-align: right;">Cargo</th> </tr> </thead>
                <tbody>${rows}</tbody>
                <tfoot> <tr> <td colspan="2">Total</td> <td style="text-align: right;">${formatCurrency(total)}</td> </tr> </tfoot>
            </table>
        </div>`;
    showModal({ title: `Detalles de: ${category}`, body: tableHtml, confirmText: 'Cerrar', showCancel: false });
}
  
/**
 * Muestra u oculta el modal principal, configurando su contenido y acciones.
 * @param {object} options - Las opciones para configurar el modal.
 */
export function showModal({ show = true, title, body, onConfirm, onModalOpen, confirmText = 'Confirmar', confirmClass = '', showCancel = true, showConfirm = true }) {
      if (!show) { elements.modal.classList.remove('visible'); return; }
      elements.modalTitle.textContent = title;
      elements.modalBody.innerHTML = body;
      elements.modalConfirmBtn.textContent = confirmText;
      elements.modalConfirmBtn.className = `btn ${confirmClass}`;
      elements.modalConfirmBtn.style.display = showConfirm ? 'inline-flex' : 'none';
      elements.modalCancelBtn.style.display = showCancel ? 'inline-flex' : 'none';
      elements.modalConfirmBtn.onclick = onConfirm ? onConfirm : () => showModal({ show: false });
      elements.modalCancelBtn.onclick = () => showModal({ show: false });
      elements.modal.classList.add('visible');
      if (onModalOpen) onModalOpen();
}
  
/**
 * Abre el modal para agregar o editar un movimiento operativo.
 * @param {object} [expense={}] - El objeto de gasto a editar. Si está vacío, se crea uno nuevo.
 */
export function openExpenseModal(expense = {}) {
    const isEditing = !!expense.id;
    const title = isEditing ? 'Editar Movimiento' : 'Agregar Movimiento Operativo';
    const originalCategory = expense.category || 'SinCategorizar';

    const isFinancial = expense.type === 'financiero';

    const categories = [...new Set([...state.expenses.map(e => e.category), 'Alex', 'Chris', 'Sueldos', 'Publicidad', 'Envios', 'Local', 'Material', 'Tecnologia', 'Deudas', 'Devoluciones', 'SinCategorizar', 'Gastos Financieros'].filter(Boolean))].sort();
    const categoryOptions = categories.map(cat => `<option value="${cat}" ${expense.category === cat ? 'selected' : ''}>${cat}</option>`).join('');

    const channels = ['WhatsApp', 'Instagram', 'Facebook', 'Grupo de Clientes', 'Grupo de Referencias', 'Otro'];
    const channelOptions = channels.map(c => `<option value="${c}" ${expense.channel === c ? 'selected' : ''}>${c}</option>`).join('');

    showModal({
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
                    <div class="form-group" id="subcategory-form-group" style="display: none;">
                        <label for="expense-subcategory">Subcategoría</label>
                        <select id="expense-subcategory" class="modal-input"></select>
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
                    subcategory: document.getElementById('expense-subcategory')?.value || '',
                    channel: document.getElementById('expense-channel')?.value || '',
                    source: 'manual'
                };
                
                if (expenseData.sub_type === 'pago_intereses') {
                     expenseData.category = 'Gastos Financieros';
                } else if (expenseData.type === 'operativo') {
                     expenseData.category = creditValue > 0 ? '' : document.getElementById('expense-category').value;
                } else {
                    expenseData.category = '';
                }
                
                if (isEditing) expenseData.id = expense.id;
                
                services.saveExpense(expenseData, originalCategory);
            }
        },
        onModalOpen: () => {
            const categoryGroup = document.getElementById('category-form-group');
            const categorySelect = document.getElementById('expense-category');
            const subcategoryGroup = document.getElementById('subcategory-form-group');
            const subcategorySelect = document.getElementById('expense-subcategory');
            const conceptInput = document.getElementById('expense-concept');
            const creditInput = document.getElementById('expense-credit');
            const channelGroup = document.getElementById('channel-form-group');

            function populateSubcategories(parentCategory) {
                const subcategoriesForParent = state.subcategories[parentCategory] || [];
                if (subcategoriesForParent.length > 0) {
                    let subcategoryOptions = subcategoriesForParent
                        .map(sub => `<option value="${sub}" ${expense.subcategory === sub ? 'selected' : ''}>${sub}</option>`)
                        .join('');
                    subcategorySelect.innerHTML = `<option value="">-- Seleccionar --</option>${subcategoryOptions}`;
                    subcategoryGroup.style.display = 'block';
                } else {
                    subcategorySelect.innerHTML = '';
                    subcategoryGroup.style.display = 'none';
                }
            }

            const toggleFieldVisibility = () => {
                const creditValue = parseFloat(creditInput.value) || 0;
                const isIncome = creditValue > 0;
                const selectedCategory = categorySelect.value;

                channelGroup.style.display = isIncome ? 'block' : 'none';
                categoryGroup.style.display = isIncome || isFinancial ? 'none' : 'block';
                
                if (!isIncome && !isFinancial) {
                    populateSubcategories(selectedCategory);
                } else {
                    subcategoryGroup.style.display = 'none';
                }
                
                if(isFinancial && expense.sub_type === 'pago_intereses') {
                    categoryGroup.style.display = 'block';
                    categorySelect.value = 'Gastos Financieros';
                    categorySelect.disabled = true;
                } else if (!isFinancial) {
                    categorySelect.disabled = false;
                }
            };
            
            creditInput.addEventListener('input', toggleFieldVisibility);
            categorySelect.addEventListener('change', toggleFieldVisibility);
            conceptInput.addEventListener('input', () => {
                if (!isFinancial && !(parseFloat(creditInput.value) > 0)) {
                    categorySelect.value = autoCategorize(conceptInput.value);
                }
            });

            toggleFieldVisibility();
        }
    });
}
  
/**
 * Abre el modal para registrar un movimiento financiero (préstamos, pagos).
 */
export function openFinancialModal() {
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

    showModal({
        title: 'Registrar Movimiento Financiero',
        body: body,
        confirmText: 'Guardar Movimiento',
        onConfirm: () => services.saveFinancialTransaction(),
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
}

/**
 * Rellena el select de filtro de categorías con las categorías existentes.
 */
export function populateCategoryFilter() {
    const categories = [...new Set(state.expenses
        .filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses') 
        .map(e => e.category).filter(Boolean))];
    categories.sort();
    const currentCategory = elements.categoryFilter.value;
    elements.categoryFilter.innerHTML = `<option value="all">Todas las categorías</option>`;
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        elements.categoryFilter.appendChild(option);
    });
    elements.categoryFilter.value = currentCategory;
}

// --- Litepicker Initialization ---
export function initDateRangePicker(callback) {
    if (elements.dateRangeFilter) {
        return new Litepicker({
            element: elements.dateRangeFilter,
            singleMode: false,
            format: 'MMM D, YYYY',
            plugins: ['ranges'],
            setup: (picker) => {
                picker.on('selected', (date1, date2) => {
                    callback();
                });
            }
        });
    }
}

export function initHealthDateRangePicker(callback) {
    if (elements.healthDateRangeFilter) {
        return new Litepicker({
            element: elements.healthDateRangeFilter,
            singleMode: false,
            format: 'MMM D, YYYY',
            plugins: ['ranges'],
            setup: (picker) => {
                picker.on('selected', (date1, date2) => {
                    callback();
                });
            }
        });
    }
}

export function initSueldosDateRangePicker(callback) {
    if (elements.sueldosDateRangeFilter) {
        return new Litepicker({
            element: elements.sueldosDateRangeFilter,
            singleMode: false,
            format: 'MMM D, YYYY',
            plugins: ['ranges'],
            setup: (picker) => {
                picker.on('selected', (date1, date2) => {
                    callback();
                });
            }
        });
    }
}

export function renderSueldosData(employees, isFiltered) {
    elements.sueldosTableContainer.innerHTML = '';
    if (employees.length === 0 && isFiltered) {
        elements.sueldosTableContainer.innerHTML = '<p>No se encontraron registros para el rango de fechas seleccionado.</p>';
        return;
    }
    
    employees.forEach(employee => {
        const card = document.createElement('div');
        card.className = 'employee-card';
        card.dataset.employeeId = employee.id;

        const bonosHtml = (employee.bonos || []).map((bono, index) => `
            <div class="adjustment-item bono">
                <span class="date">${bono.date || ''}</span>
                <span class="concept">${bono.concept}</span>
                <span class="amount">${formatCurrency(bono.amount)}</span>
                <button class="delete-adjustment-btn" data-adjustment-id="${index}" data-adjustment-type="bono" title="Eliminar">&times;</button>
            </div>
        `).join('');

        const gastosHtml = (employee.descuentos || []).map((gasto, index) => `
            <div class="adjustment-item gasto">
                 <span class="date">${gasto.date || ''}</span>
                <span class="concept">${gasto.concept}</span>
                <span class="amount">-${formatCurrency(gasto.amount)}</span>
                <button class="delete-adjustment-btn" data-adjustment-id="${index}" data-adjustment-type="gasto" title="Eliminar">&times;</button>
            </div>
        `).join('');

        const historyHtml = (employee.paymentHistory || []).map(p => `
            <tr>
                <td>${p.week}</td>
                <td>${p.hours.toFixed(2)}</td>
                <td>${formatCurrency(p.payment)}</td>
            </tr>
        `).join('');

        card.innerHTML = `
            <div class="employee-header">
                <h3>${capitalize(employee.name)}</h3>
                <div class="employee-header-rate">
                    <div class="rate-input-wrapper">
                        <span class="rate-input-symbol">$</span>
                        <input type="number" class="hourly-rate-input" value="${employee.ratePerHour || 70}" min="0">
                        <span>/hr</span>
                    </div>
                </div>
                <button class="toggle-details-btn" aria-expanded="true">
                    <i class="fas fa-chevron-up"></i>
                </button>
            </div>
            <div class="employee-body">
                <div class="table-container">
                    <table>
                        <thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th>Hrs</th></tr></thead>
                        <tbody>
                            ${['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map(day => {
                                const registro = employee.registros?.find(r => r.day === day) || { entrada: '', salida: '', horas: '0.00' };
                                return `
                                    <tr>
                                        <td>${day}</td>
                                        <td contenteditable="true" data-type="entrada">${registro.entrada}</td>
                                        <td contenteditable="true" data-type="salida">${registro.salida}</td>
                                        <td>${registro.horas}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="payment-history-container">
                    <h6>Historial de Pagos</h6>
                    <div class="table-container" style="max-height: 200px;">
                        <table>
                            <thead><tr><th>Semana</th><th>Horas</th><th>Pago</th></tr></thead>
                            <tbody>${historyHtml}</tbody>
                        </table>
                    </div>
                </div>
                <div>
                    <div class="employee-payment-summary">
                        <div class="payment-row"><span>Total Horas:</span><span class="payment-value-total-hours">${employee.totalHoursFormatted || '0.00'}</span></div>
                        <div class="payment-row"><span>Subtotal:</span><span class="payment-value-subtotal">${formatCurrency(employee.subtotal || 0)}</span></div>
                    </div>
                    <div class="adjustments-list">
                        <h6>Bonos</h6>
                        <div class="adjustments-list-content">
                            ${bonosHtml || '<p style="text-align:center; font-size:12px; color:#9ca3af;">Sin bonos</p>'}
                        </div>
                    </div>
                    <div class="adjustments-list">
                        <h6>Gastos/Descuentos</h6>
                        <div class="adjustments-list-content">
                            ${gastosHtml || '<p style="text-align:center; font-size:12px; color:#9ca3af;">Sin gastos</p>'}
                        </div>
                    </div>
                    <div class="employee-payment-summary">
                         <div class="payment-row final-payment"><span>Pago Final:</span><span class="payment-value-final">${formatCurrency(employee.pago || 0)}</span></div>
                    </div>
                     <div class="btn-group" style="margin-top: 15px;">
                        <button class="btn btn-sm add-bono-btn"><i class="fas fa-plus"></i> Bono</button>
                        <button class="btn btn-sm add-gasto-btn"><i class="fas fa-minus"></i> Gasto</button>
                        <button class="btn btn-sm btn-outline share-text-btn"><i class="fab fa-whatsapp"></i></button>
                        <button class="btn btn-sm btn-outline download-pdf-btn"><i class="fas fa-file-pdf"></i></button>
                    </div>
                </div>
            </div>
        `;
        elements.sueldosTableContainer.appendChild(card);
    });
}

export function renderKpisTable() {
    if (!elements.kpisTableBody) return;
    elements.kpisTableBody.innerHTML = '';

    const today = new Date();
    const year = 2025; // Año fijo
    const month = 9;   // Septiembre (fijo)
    const currentDay = today.getFullYear() === year && today.getMonth() + 1 === month ? today.getDate() : 30;

    const combinedData = [];

    for (let i = 1; i <= currentDay; i++) {
        const dateString = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        
        const leads = state.monthlyLeads[dateString] || 0;
        const paidLeads = state.monthlyPaidLeads[dateString] || 0;
        const revenue = state.monthlyPaidRevenue[dateString] || 0;
        const manualKpi = state.kpis.find(k => k.fecha === dateString) || {};

        combinedData.push({
            id: manualKpi.id || null,
            fecha: dateString,
            leads: leads,
            paidLeads: paidLeads,
            revenue: revenue,
            costo_publicidad: manualKpi.costo_publicidad || 0
        });
    }
    
    combinedData.sort((a, b) => b.fecha.localeCompare(a.fecha));

    if (combinedData.length === 0) {
        elements.kpisEmptyState.style.display = 'block';
        return;
    }
    elements.kpisEmptyState.style.display = 'none';

    combinedData.forEach(kpi => {
        const tr = document.createElement('tr');
        const leads = Number(kpi.leads);
        const paidLeads = Number(kpi.paidLeads);
        const revenue = Number(kpi.revenue);
        const costoPublicidad = Number(kpi.costo_publicidad);

        const conversionRate = leads > 0 ? ((paidLeads / leads) * 100).toFixed(2) : '0.00';
        const cpl = leads > 0 ? (costoPublicidad / leads).toFixed(2) : '0.00';
        const cpv = paidLeads > 0 ? (costoPublicidad / paidLeads).toFixed(2) : '0.00';

        tr.innerHTML = `
            <td>${kpi.fecha}</td>
            <td>${leads}</td>
            <td>${paidLeads}</td>
            <td>${formatCurrency(revenue)}</td>
            <td>${formatCurrency(costoPublicidad)}</td>
            <td>${formatCurrency(cpl)}</td>
            <td>${formatCurrency(cpv)}</td>
            <td>${conversionRate}%</td>
            <td class="btn-group">
                <button class="btn btn-outline btn-sm edit-kpi-btn" data-fecha="${kpi.fecha}"><i class="fas fa-pencil-alt"></i></button>
                <button class="btn btn-outline btn-sm delete-kpi-btn" data-id="${kpi.id || ''}" style="color:var(--danger);" ${!kpi.id ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
            </td>
        `;
        elements.kpisTableBody.appendChild(tr);
    });
}

export function openKpiModal(kpi = {}) {
    const isEditing = !!kpi.id;
    const title = isEditing ? `Editar Registro de KPI para ${kpi.fecha}` : `Agregar Registro para ${kpi.fecha}`;
    const revenueFromState = state.monthlyPaidRevenue[kpi.fecha] || 0;

    showModal({
        title: title,
        body: `<form id="kpi-form" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <input type="hidden" id="kpi-fecha" value="${kpi.fecha}">
                    <div class="form-group">
                        <label for="kpi-leads">Leads (Automático)</label>
                        <input type="number" id="kpi-leads" class="modal-input" value="${kpi.leads || 0}" disabled>
                    </div>
                    <div class="form-group">
                        <label for="kpi-paid-leads">Leads Pagados (Automático)</label>
                        <input type="number" id="kpi-paid-leads" class="modal-input" value="${kpi.paidLeads || 0}" disabled>
                    </div>
                     <div class="form-group">
                        <label for="kpi-revenue">Ingresos (Automático)</label>
                        <input type="text" id="kpi-revenue" class="modal-input" value="${formatCurrency(revenueFromState)}" disabled>
                    </div>
                    <div class="form-group">
                        <label for="kpi-costo">Costo Publicidad ($)</label>
                        <input type="number" step="0.01" id="kpi-costo" class="modal-input" placeholder="0.00" value="${kpi.costo_publicidad || ''}">
                    </div>
               </form>`,
        confirmText: 'Guardar',
        onConfirm: () => {
            const form = document.getElementById('kpi-form');
            if (form.reportValidity()) {
                const kpiData = {
                    id: kpi.id,
                    fecha: document.getElementById('kpi-fecha').value,
                    costo_publicidad: Number(document.getElementById('kpi-costo').value) || 0,
                };
                services.saveKpi(kpiData);
            }
        }
    });
}


/**
 * Opens a modal to add a bonus or an expense/discount for an employee.
 * @param {string} employeeId - The ID of the employee.
 * @param {string} type - The type of adjustment ('bono' or 'gasto').
 */
function openAdjustmentModal(employeeId, type) {
    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (!employee) return;

    const isBono = type === 'bono';
    const title = isBono ? 'Agregar Bono' : 'Agregar Gasto/Descuento';
    const amountLabel = isBono ? 'Monto del Bono ($)' : 'Monto del Gasto ($)';

    const body = `
        <form id="adjustment-form" style="display: grid; gap: 15px;">
            <input type="hidden" id="adjustment-employee-id" value="${employeeId}">
            <div class="form-group">
                <label for="adjustment-date">Fecha</label>
                <input type="date" id="adjustment-date" class="modal-input" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-group">
                <label for="adjustment-concept">Concepto</label>
                <input type="text" id="adjustment-concept" class="modal-input" placeholder="${isBono ? 'Ej: Bono de puntualidad' : 'Ej: Adelanto de sueldo'}" required>
            </div>
            <div class="form-group">
                <label for="adjustment-amount">${amountLabel}</label>
                <input type="number" step="0.01" id="adjustment-amount" class="modal-input" placeholder="$0.00" required>
            </div>
        </form>
    `;

    showModal({
        title: `${title} para ${capitalize(employee.name)}`,
        body: body,
        confirmText: 'Guardar',
        onConfirm: () => {
            const form = document.getElementById('adjustment-form');
            if (form.reportValidity()) {
                const adjustmentData = {
                    date: document.getElementById('adjustment-date').value,
                    concept: document.getElementById('adjustment-concept').value,
                    amount: parseFloat(document.getElementById('adjustment-amount').value) || 0,
                };
                services.saveAdjustment(employeeId, type, adjustmentData);
            }
        }
    });
}

/**
 * Opens the modal specifically for adding a bonus.
 * @param {string} employeeId - The ID of the employee.
 */
export function openBonoModal(employeeId) {
    openAdjustmentModal(employeeId, 'bono');
}

/**
 * Opens the modal specifically for adding an expense/discount.
 * @param {string} employeeId - The ID of the employee.
 */
export function openGastoModal(employeeId) {
    openAdjustmentModal(employeeId, 'gasto');
}

/**
 * Muestra un modal para que el usuario seleccione qué registros duplicados desea importar.
 * @param {Array<object>} duplicateGroups - Grupos de gastos duplicados encontrados.
 * @param {Array<object>} nonDuplicates - Gastos que no son duplicados y se importarán.
 */
export function showDuplicateSelectionModal(duplicateGroups, nonDuplicates) {
    let tableRows = '';
    duplicateGroups.forEach((group, groupIndex) => {
        tableRows += `
            <tr class="group-header">
                <td colspan="6">
                    <strong>Grupo Duplicado ${groupIndex + 1}</strong> (${group.reason})
                    <br><em>${group.signature.replace(/\|/g, ' | ')}</em>
                </td>
            </tr>
        `;
        group.expenses.forEach((expense, expenseIndex) => {
            const charge = parseFloat(expense.charge) || 0;
            const credit = parseFloat(expense.credit) || 0;
            tableRows += `
                <tr>
                    <td><input type="checkbox" class="duplicate-checkbox" data-group-index="${groupIndex}" data-expense-index="${expenseIndex}" checked></td>
                    <td>${expense.date}</td>
                    <td>${expense.concept}</td>
                    <td>${charge > 0 ? formatCurrency(charge) : ''}</td>
                    <td>${credit > 0 ? formatCurrency(credit) : ''}</td>
                    <td>${expense.category}</td>
                </tr>
            `;
        });
    });

    const body = `
        <p>Se encontraron registros que parecen ser duplicados (ya sea dentro del archivo o con datos existentes). Por favor, selecciona los registros que deseas importar y haz clic en "Confirmar Selección".</p>
        <div class="table-container" style="max-height: 40vh; margin-top: 15px;">
            <table class="duplicate-table">
                <thead>
                    <tr>
                        <th><input type="checkbox" id="select-all-duplicates" checked></th>
                        <th>Fecha</th>
                        <th>Concepto</th>
                        <th>Cargo</th>
                        <th>Ingreso</th>
                        <th>Categoría</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>
    `;

    showModal({
        title: 'Seleccionar Duplicados para Importar',
        body: body,
        confirmText: 'Confirmar Selección',
        showCancel: true,
        onConfirm: async () => {
            const selectedExpenses = [...nonDuplicates];
            document.querySelectorAll('.duplicate-checkbox:checked').forEach(checkbox => {
                const groupIndex = checkbox.dataset.groupIndex;
                const expenseIndex = checkbox.dataset.expenseIndex;
                selectedExpenses.push(duplicateGroups[groupIndex].expenses[expenseIndex]);
            });

            if (selectedExpenses.length > 0) {
                try {
                    await services.saveBulkExpenses(selectedExpenses);
                    showModal({
                        title: 'Éxito',
                        body: `Se importaron ${selectedExpenses.length} registros seleccionados.`,
                        confirmText: 'Entendido',
                        showCancel: false
                    });
                } catch (error) {
                     showModal({
                        title: 'Error al Guardar',
                        body: `No se pudieron guardar los registros. Detalle: ${error.message}`,
                        confirmText: 'Cerrar',
                        showCancel: false
                    });
                }
            } else {
                showModal({ show: false }); // Just close if nothing was selected
            }
        },
        onModalOpen: () => {
            document.getElementById('select-all-duplicates').addEventListener('change', (e) => {
                document.querySelectorAll('.duplicate-checkbox').forEach(checkbox => {
                    checkbox.checked = e.target.checked;
                });
            });
        }
    });
}


