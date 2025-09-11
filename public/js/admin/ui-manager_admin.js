import { elements, state } from './state_admin.js';
import { formatCurrency, autoCategorize, capitalize } from './utils_admin.js';
import { saveExpense, saveFinancialTransaction } from './services_admin.js'; // Necesario para los modales que guardan datos

/**
 * @file Módulo de gestión de la interfaz de usuario (UI).
 * @description Contiene todas las funciones que manipulan directamente el DOM,
 * como renderizar tablas, actualizar vistas, mostrar y ocultar modales.
 */

/**
 * Renderiza la tabla principal de gastos con los datos filtrados.
 * @param {Array<object>} expenses - Un array de objetos de gastos para mostrar.
 */
export function renderTable(expenses) {
    elements.dataTableBody.innerHTML = '';
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
        if (displayCategory === 'SinCategorizar') {
            const allCategories = [...new Set([...state.expenses.map(e => e.category), 'Alex', 'Chris', 'Sueldos', 'Publicidad', 'Envios', 'Local', 'Material', 'Tecnologia', 'Deudas', 'Devoluciones', 'GastosFinancieros', 'SinCategorizar'].filter(Boolean))].sort();
            const categoryOptions = allCategories.map(cat => `<option value="${cat}" ${cat === 'SinCategorizar' ? 'selected' : ''}>${cat}</option>`).join('');
            categoryHtml = `<select class="category-dropdown" data-expense-id="${expense.id}">${categoryOptions}</select>`;
        } else {
            categoryHtml = displayCategory;
        }

        tr.innerHTML = `
            <td>${expense.date || ''}</td>
            <td>${expense.concept || ''}</td>
            <td>${charge > 0 ? formatCurrency(charge) : ''}</td>
            <td>${credit > 0 ? formatCurrency(credit) : ''}</td>
            <td>${categoryHtml}</td>
            <td class="btn-group">
                <button class="btn btn-outline btn-sm edit-btn"><i class="fas fa-pencil-alt"></i></button>
                <button class="btn btn-outline btn-sm delete-btn" style="color:var(--danger);"><i class="fas fa-trash"></i></button>
            </td>
        `;
        
        // Los event listeners se añadirán en `handlers_admin.js`
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
            <th colspan="2"></th>
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
            // El event listener se añadirá en `handlers_admin.js`
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
      card.dataset.category = title; // Se añade para el handler
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
                    <!-- Form fields -->
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
                
                saveExpense(expenseData, originalCategory);
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
        onConfirm: () => saveFinancialTransaction(),
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
