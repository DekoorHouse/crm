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
}

/**
 * Renderiza la tabla principal de gastos con los datos filtrados.
 */
export function renderTable(expenses) {
    elements.dataTableBody.innerHTML = '';
    const sorted = [...expenses].sort((a,b) => (b.date > a.date) ? 1 : -1);
    sorted.forEach(expense => {
        const tr = document.createElement('tr');
        tr.dataset.id = expense.id;
        tr.innerHTML = `
            <td>${expense.date}</td>
            <td>${expense.concept}</td>
            <td>${formatCurrency(expense.charge)}</td>
            <td>${formatCurrency(expense.credit)}</td>
            <td>
                <select class="category-dropdown" data-expense-id="${expense.id}">
                    <!-- Options will be populated here -->
                </select>
            </td>
            <td>
                <button class="btn btn-sm btn-outline edit-btn"><i class="fas fa-pencil-alt"></i></button>
                <button class="btn btn-sm btn-danger delete-btn"><i class="fas fa-trash-alt"></i></button>
            </td>
        `;
        const categorySelect = tr.querySelector('.category-dropdown');
        const categories = [...new Set(state.expenses.map(e => e.category).filter(Boolean))];
        const allPossibleCategories = ['SinCategorizar', 'Alex', 'Chris', 'Sueldos', 'Publicidad', 'Envios', 'Local', 'Material', 'Tecnologia', 'Deudas', 'Devoluciones', 'GastosFinancieros', ...categories].filter((v, i, a) => a.indexOf(v) === i);
        allPossibleCategories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = capitalize(cat);
            if ((expense.category || 'SinCategorizar') === cat) {
                option.selected = true;
            }
            categorySelect.appendChild(option);
        });
        elements.dataTableBody.appendChild(tr);
    });
}
  
/**
 * Actualiza los totales en el pie de la tabla principal de gastos.
 */
export function updateTableTotals(expenses) {
    const { totalCharge, totalCredit } = expenses.reduce((acc, exp) => {
        acc.totalCharge += parseFloat(exp.charge) || 0;
        acc.totalCredit += parseFloat(exp.credit) || 0;
        return acc;
    }, { totalCharge: 0, totalCredit: 0 });

    elements.dataTableFooter.innerHTML = `
        <tr>
            <th>Total</th>
            <th></th>
            <th>${formatCurrency(totalCharge)}</th>
            <th>${formatCurrency(totalCredit)}</th>
            <th colspan="2"></th>
        </tr>
    `;
}

/**
 * Renderiza la sección de resumen con tarjetas para cada categoría.
 */
export function updateSummary(getFilteredExpenses) {
    const operationalExpenses = getFilteredExpenses().filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses');
    
    const summaryData = operationalExpenses.reduce((acc, exp) => {
        const charge = parseFloat(exp.charge) || 0;
        const credit = parseFloat(exp.credit) || 0;
        const category = exp.category || 'SinCategorizar';

        acc.TotalCargos = (acc.TotalCargos || 0) + charge;
        acc.TotalIngresos = (acc.TotalIngresos || 0) + credit;
        
        if (charge > 0) {
            acc[category] = (acc[category] || 0) + charge;
        }

        return acc;
    }, {});
    
    summaryData.TotalNeto = summaryData.TotalIngresos - summaryData.TotalCargos;

    elements.summarySection.innerHTML = '';
    const sortedEntries = Object.entries(summaryData).sort(([, a], [, b]) => b - a);

    sortedEntries.forEach(([key, value]) => {
        if (value !== 0) {
            const isClickable = !['TotalNeto', 'TotalCargos', 'TotalIngresos'].includes(key);
            const card = createSummaryCard(key, value, isClickable);
            elements.summarySection.appendChild(card);
        }
    });
}
  
/**
 * Crea y devuelve un elemento HTMLElement para una tarjeta de resumen.
 * @param {string} title - El título de la tarjeta.
 * @param {number} amount - La cantidad a mostrar.
 * @param {boolean} isClickable - Si la tarjeta debe tener la clase 'clickable'.
 * @returns {HTMLElement} El elemento de la tarjeta creado.
 */
export function createSummaryCard(title, amount, isClickable) {
      const icons = {
        TotalNeto: "fas fa-balance-scale", TotalCargos: "fas fa-arrow-up-from-bracket", TotalIngresos: "fas fa-hand-holding-usd", Alex: "fas fa-user", Chris: "fas fa-user-friends",
        Sueldos: "fas fa-money-check-alt", Publicidad: "fas fa-bullhorn", Envios: "fas fa-truck", Local: "fas fa-store-alt",
        Material: "fas fa-box-open", Tecnologia: "fas fa-laptop-code", Deudas: "fas fa-credit-card", Devoluciones: "fas fa-undo-alt",
        GastosFinancieros: "fas fa-percent", SinCategorizar: "fas fa-question-circle"
      };
      
      const card = document.createElement('div');
      const titleKey = title.replace(/\s+/g, '');
      card.className = `summary-card ${titleKey} ${isClickable ? 'clickable' : ''}`;
      if (isClickable) card.dataset.category = title;

      const iconClass = icons[titleKey] || 'fas fa-dollar-sign';
      const displayTitle = capitalize(title);

      card.innerHTML = `
        <div class="icon-container">
          <i class="${iconClass}"></i>
        </div>
        <div>
            <div class="summary-card-title">${displayTitle}</div>
            <div class="summary-card-value">${formatCurrency(amount)}</div>
        </div>`;
      return card;
}
  
/**
 * Muestra un modal con el desglose de gastos para una categoría específica.
 */
export function showCategoryDetailsModal(category, getFilteredExpenses) {
    const categoryExpenses = getFilteredExpenses().filter(e => (e.category || 'SinCategorizar') === category && (parseFloat(e.charge) || 0) > 0);
    let total = 0;
    
    const rows = categoryExpenses.map(exp => {
        total += exp.charge;
        return `<tr><td>${exp.date}</td><td>${exp.concept}</td><td style="text-align: right;">${formatCurrency(exp.charge)}</td></tr>`;
    }).join('');

    const tableHtml = `
        <div class="table-container">
            <table>
                <thead><tr><th>Fecha</th><th>Concepto</th><th style="text-align: right;">Monto</th></tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr><th colspan="2">Total</th><th style="text-align: right;">${formatCurrency(total)}</th></tr></tfoot>
            </table>
        </div>`;
    showModal({ title: `Detalles de: ${category}`, body: tableHtml, confirmText: 'Cerrar', showCancel: false });
}
  
/**
 * Muestra u oculta el modal principal, configurando su contenido y acciones.
 */
export function showModal({ show = true, title, body, onConfirm, onModalOpen, confirmText = 'Confirmar', confirmClass = '', showCancel = true, showConfirm = true }) {
      if (!show) { elements.modal.classList.remove('visible'); return; }
      elements.modalTitle.textContent = title;
      elements.modalBody.innerHTML = body;
      elements.modalConfirmBtn.textContent = confirmText;
      elements.modalConfirmBtn.className = `btn ${confirmClass}`;
      elements.modalConfirmBtn.style.display = showConfirm ? 'inline-flex' : 'none';
      elements.modalCancelBtn.style.display = showCancel ? 'inline-flex' : 'none';
      
      // Re-attach the event listener to avoid stacking them up
      const newConfirmBtn = elements.modalConfirmBtn.cloneNode(true);
      elements.modalConfirmBtn.parentNode.replaceChild(newConfirmBtn, elements.modalConfirmBtn);
      elements.modalConfirmBtn = newConfirmBtn;
      
      if (onConfirm) elements.modalConfirmBtn.addEventListener('click', onConfirm);
      
      const newCancelBtn = elements.modalCancelBtn.cloneNode(true);
      elements.modalCancelBtn.parentNode.replaceChild(newCancelBtn, elements.modalCancelBtn);
      elements.modalCancelBtn = newCancelBtn;
      elements.modalCancelBtn.addEventListener('click', () => showModal({ show: false }));

      elements.modal.classList.add('visible');
      if (onModalOpen) onModalOpen();
}

/**
 * Muestra un modal para que el usuario revise los duplicados encontrados.
 * @param {Array<object>} duplicates - Array de gastos duplicados.
 * @param {Array<object>} uniqueNewExpenses - Array de gastos nuevos y únicos.
 * @param {Function} onProcessCallback - La función a llamar con la lista final de gastos a guardar.
 */
export function showDuplicateReviewModal(duplicates, uniqueNewExpenses, onProcessCallback) {
    const rowsHtml = duplicates.map((exp, index) => `
        <tr>
            <td><input type="checkbox" class="duplicate-checkbox" data-index="${index}" checked></td>
            <td>${exp.date}</td>
            <td>${exp.concept}</td>
            <td style="text-align: right;">${formatCurrency(exp.charge)}</td>
            <td style="text-align: right;">${formatCurrency(exp.credit)}</td>
        </tr>
    `).join('');

    const body = `
        <p>Se encontraron <strong>${duplicates.length} registros</strong> que ya existen o están repetidos en el archivo. Por defecto, se omitirán.</p>
        <p style="font-size: 13px; color: var(--text-secondary); margin-top: 5px;">Desmarca las filas que SÍ quieras cargar a pesar de ser repetidas.</p>
        <div class="table-container" style="max-height: 40vh; margin-top: 15px;">
            <table>
                <thead>
                    <tr>
                        <th>Omitir</th>
                        <th>Fecha</th>
                        <th>Concepto</th>
                        <th style="text-align: right;">Cargo</th>
                        <th style="text-align: right;">Ingreso</th>
                    </tr>
                </thead>
                <tbody id="duplicates-table-body">${rowsHtml}</tbody>
            </table>
        </div>
    `;

    showModal({
        title: 'Revisar Registros Repetidos',
        body: body,
        confirmText: 'Cargar (Omitiendo marcados)',
        showCancel: true,
        onConfirm: () => {
            const checkboxes = document.querySelectorAll('.duplicate-checkbox');
            const expensesToLoad = [...uniqueNewExpenses];
            checkboxes.forEach(cb => {
                if (!cb.checked) { // Solo se añaden los que el usuario desmarcó para "no omitir"
                    const index = parseInt(cb.dataset.index);
                    expensesToLoad.push(duplicates[index]);
                }
            });
            onProcessCallback(expensesToLoad);
        },
        onModalOpen: () => {
            const footer = elements.modal.querySelector('.modal-footer');
            const confirmBtn = elements.modalConfirmBtn;

            const loadAllBtn = document.createElement('button');
            loadAllBtn.className = 'btn btn-outline';
            loadAllBtn.textContent = 'Cargar Todo (Incluir Repetidos)';
            loadAllBtn.style.marginRight = 'auto'; // Empuja este botón a la izquierda
            loadAllBtn.onclick = () => {
                const allExpenses = [...uniqueNewExpenses, ...duplicates];
                onProcessCallback(allExpenses);
            };
            
            // Reorganiza los botones en el pie del modal
            footer.innerHTML = ''; 
            footer.appendChild(loadAllBtn);
            footer.appendChild(elements.modalCancelBtn);
            footer.appendChild(confirmBtn);
        }
    });
}
  
/**
 * Abre el modal para agregar o editar un movimiento operativo.
 */
export function openExpenseModal(expense = {}) {
    const isEditing = !!expense.id;
    const title = isEditing ? 'Editar Movimiento' : 'Agregar Movimiento Operativo';
    const body = `
        <form id="expense-form" style="display: grid; gap: 15px;">
            <input type="hidden" id="expense-id" value="${expense.id || ''}">
            <div class="form-group">
                <label for="expense-date">Fecha</label>
                <input type="date" id="expense-date" class="modal-input" value="${expense.date || new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-group">
                <label for="expense-concept">Concepto</label>
                <input type="text" id="expense-concept" class="modal-input" value="${expense.concept || ''}" required>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <div class="form-group">
                    <label for="expense-charge">Cargo ($)</label>
                    <input type="number" id="expense-charge" class="modal-input" value="${expense.charge || ''}" placeholder="0.00">
                </div>
                <div class="form-group">
                    <label for="expense-credit">Ingreso ($)</label>
                    <input type="number" id="expense-credit" class="modal-input" value="${expense.credit || ''}" placeholder="0.00">
                </div>
            </div>
            <div class="form-group" id="category-group" style="display: ${ (expense.charge || 0) > 0 ? 'block' : 'none' };">
                <label for="expense-category">Categoría</label>
                <select id="expense-category" class="modal-input"></select>
            </div>
        </form>
    `;
    
    showModal({
        title, body, confirmText: isEditing ? 'Guardar Cambios' : 'Agregar',
        onConfirm: () => {
            const updatedExpense = {
                id: document.getElementById('expense-id').value,
                date: document.getElementById('expense-date').value,
                concept: document.getElementById('expense-concept').value,
                charge: parseFloat(document.getElementById('expense-charge').value) || 0,
                credit: parseFloat(document.getElementById('expense-credit').value) || 0,
                category: document.getElementById('expense-category').value,
                type: 'operativo', source: 'manual'
            };
            services.saveExpense(updatedExpense, expense.category);
        },
        onModalOpen: () => {
            const chargeInput = document.getElementById('expense-charge');
            const categoryGroup = document.getElementById('category-group');
            const categorySelect = document.getElementById('expense-category');
            
            const categories = [...new Set(state.expenses.map(e => e.category).filter(Boolean))];
            const allPossibleCategories = ['SinCategorizar', 'Alex', 'Chris', 'Sueldos', 'Publicidad', 'Envios', 'Local', 'Material', 'Tecnologia', 'Deudas', 'Devoluciones', 'GastosFinancieros', ...categories].filter((v, i, a) => a.indexOf(v) === i);
            allPossibleCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat;
                option.textContent = capitalize(cat);
                categorySelect.appendChild(option);
            });
            categorySelect.value = expense.category || autoCategorize(expense.concept || '');

            const toggleCategory = () => {
                const chargeValue = parseFloat(chargeInput.value) || 0;
                categoryGroup.style.display = chargeValue > 0 ? 'block' : 'none';
            };
            
            chargeInput.addEventListener('input', toggleCategory);
            toggleCategory();
        }
    });
}
  
/**
 * Abre el modal para agregar una transacción financiera (préstamo o pago).
 */
export function openFinancialModal() {
    const body = `
        <form id="financial-form" style="display: grid; gap: 15px;">
            <div class="form-group">
                <label for="financial-type">Tipo de Movimiento</label>
                <select id="financial-type" class="modal-input">
                    <option value="entrada_prestamo">Entrada de Préstamo</option>
                    <option value="pago_deuda">Pago de Deuda</option>
                </select>
            </div>
            <div class="form-group">
                <label for="financial-date">Fecha</label>
                <input type="date" id="financial-date" class="modal-input" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-group">
                <label for="financial-concept">Concepto (Ej: Préstamo Banorte)</label>
                <input type="text" id="financial-concept" class="modal-input" required>
            </div>
            <div class="form-group" id="credit-field">
                <label for="financial-credit">Monto del Préstamo ($)</label>
                <input type="number" id="financial-credit" class="modal-input" placeholder="0.00">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;" id="charge-fields">
                <div class="form-group">
                    <label for="financial-capital">Pago a Capital ($)</label>
                    <input type="number" id="financial-capital" class="modal-input" placeholder="0.00">
                </div>
                <div class="form-group">
                    <label for="financial-interest">Pago de Intereses ($)</label>
                    <input type="number" id="financial-interest" class="modal-input" placeholder="0.00">
                </div>
            </div>
        </form>
    `;

    showModal({
        title: 'Agregar Movimiento Financiero',
        body,
        confirmText: 'Guardar',
        onConfirm: () => services.saveFinancialTransaction(),
        onModalOpen: () => {
            const typeSelect = document.getElementById('financial-type');
            const creditField = document.getElementById('credit-field');
            const chargeFields = document.getElementById('charge-fields');

            const toggleFieldVisibility = () => {
                const isLoan = typeSelect.value === 'entrada_prestamo';
                creditField.style.display = isLoan ? 'block' : 'none';
                chargeFields.style.display = isLoan ? 'none' : 'grid';
            };

            typeSelect.addEventListener('change', toggleFieldVisibility);
            toggleFieldVisibility(); // Initial call
        }
    });
}

/**
 * Rellena el select de filtro de categorías con las categorías existentes.
 */
export function populateCategoryFilter() {
    const currentCategory = elements.categoryFilter.value;
    elements.categoryFilter.innerHTML = '<option value="all">Todas las categorías</option>';
    
    const categories = [...new Set(state.expenses
        .filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses') 
        .map(e => e.category || 'SinCategorizar')
        .sort((a, b) => a.localeCompare(b))
    )];

    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = capitalize(cat);
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
            autoApply: true,
            plugins: ['ranges'],
            ranges: {
                position: 'left'
            },
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
            autoApply: true,
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
            autoApply: true,
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
    if (employees.length === 0 && !isFiltered) {
        // Handled by sueldos-empty-state
        return;
    }
    if (employees.length === 0 && isFiltered) {
        elements.sueldosTableContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No hay datos para el rango de fechas seleccionado.</p>';
        return;
    }

    employees.forEach(employee => {
        const card = document.createElement('div');
        card.className = 'employee-card';
        card.dataset.employeeId = employee.id;
        card.innerHTML = `
            <!-- Employee card content will be generated here -->
        `;
        elements.sueldosTableContainer.appendChild(card);
    });
}

/**
 * Opens a modal to add a bonus or an expense/discount for an employee.
 */
function openAdjustmentModal(employeeId, type) {
    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (!employee) return;
    
    const title = type === 'bono' ? 'Agregar Bono' : 'Agregar Gasto/Descuento';
    const body = `
        <form id="adjustment-form" style="display: grid; gap: 15px;">
            <div class="form-group">
                <label for="adj-date">Fecha</label>
                <input type="date" id="adj-date" class="modal-input" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-group">
                <label for="adj-concept">Concepto</label>
                <input type="text" id="adj-concept" class="modal-input" required>
            </div>
            <div class="form-group">
                <label for="adj-amount">Monto ($)</label>
                <input type="number" id="adj-amount" class="modal-input" placeholder="0.00" required>
            </div>
        </form>
    `;

    showModal({
        title: `${title} para ${employee.name}`,
        body,
        confirmText: 'Guardar',
        onConfirm: () => {
            const form = document.getElementById('adjustment-form');
            if (form.reportValidity()) {
                const adjustmentData = {
                    date: document.getElementById('adj-date').value,
                    concept: document.getElementById('adj-concept').value,
                    amount: parseFloat(document.getElementById('adj-amount').value) || 0
                };
                services.saveAdjustment(employeeId, type, adjustmentData);
            }
        }
    });
}

/**
 * Opens the modal specifically for adding a bonus.
 */
export function openBonoModal(employeeId) {
    openAdjustmentModal(employeeId, 'bono');
}

/**
 * Opens the modal specifically for adding an expense/discount.
 */
export function openGastoModal(employeeId) {
    openAdjustmentModal(employeeId, 'gasto');
}
