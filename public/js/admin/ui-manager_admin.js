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
// ... existing code ...
export function cacheElements() {
    elements.uploadBtn = document.getElementById('upload-btn');
    elements.uploadInput = document.getElementById('file-upload-input');
// ... existing code ...
    elements.kpiAvgTicketSales = document.getElementById('kpi-avg-ticket-sales');
    elements.kpiConversionRate = document.getElementById('kpi-conversion-rate');
}

/**
 * Renderiza la tabla principal de gastos con los datos filtrados.
// ... existing code ...
 */
export function renderTable(expenses) {
    elements.dataTableBody.innerHTML = '';
    const sorted = [...expenses].sort((a,b) => (b.date > a.date) ? 1 : -1);
// ... existing code ...
// ... existing code ...
        elements.dataTableBody.appendChild(tr);
    });
}
  
/**
 * Actualiza los totales en el pie de la tabla principal de gastos.
// ... existing code ...
 */
export function updateTableTotals(expenses) {
    const { totalCharge, totalCredit } = expenses.reduce((acc, exp) => {
        acc.totalCharge += parseFloat(exp.charge) || 0;
// ... existing code ...
// ... existing code ...
        </tr>
    `;
}

/**
 * Renderiza la sección de resumen con tarjetas para cada categoría.
// ... existing code ...
 */
export function updateSummary(getFilteredExpenses) {
    const operationalExpenses = getFilteredExpenses().filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses');
    
    const summaryData = operationalExpenses.reduce((acc, exp) => {
// ... existing code ...
// ... existing code ...
            const card = createSummaryCard(key, value, isClickable);
            elements.summarySection.appendChild(card);
        }
    });
}
  
/**
// ... existing code ...
 * @param {boolean} isClickable - Si la tarjeta debe tener la clase 'clickable'.
 * @returns {HTMLElement} El elemento de la tarjeta creado.
 */
export function createSummaryCard(title, amount, isClickable) {
      const icons = {
        TotalNeto: "fas fa-balance-scale", TotalCargos: "fas fa-arrow-up-from-bracket", TotalIngresos: "fas fa-hand-holding-usd", Alex: "fas fa-user", Chris: "fas fa-user-friends",
// ... existing code ...
// ... existing code ...
        <div> <div class="summary-card-title">${displayTitle}</div> <div class="summary-card-value">${formatCurrency(amount)}</div> </div>`;
      return card;
}
  
/**
 * Muestra un modal con el desglose de gastos para una categoría específica.
// ... existing code ...
 */
export function showCategoryDetailsModal(category, getFilteredExpenses) {
    const categoryExpenses = getFilteredExpenses().filter(e => (e.category || 'SinCategorizar') === category && (parseFloat(e.charge) || 0) > 0);
    let total = 0;
// ... existing code ...
// ... existing code ...
        </div>`;
    showModal({ title: `Detalles de: ${category}`, body: tableHtml, confirmText: 'Cerrar', showCancel: false });
}
  
/**
 * Muestra u oculta el modal principal, configurando su contenido y acciones.
// ... existing code ...
 */
export function showModal({ show = true, title, body, onConfirm, onModalOpen, confirmText = 'Confirmar', confirmClass = '', showCancel = true, showConfirm = true }) {
      if (!show) { elements.modal.classList.remove('visible'); return; }
      elements.modalTitle.textContent = title;
// ... existing code ...
// ... existing code ...
      elements.modal.classList.add('visible');
      if (onModalOpen) onModalOpen();
}

/**
 * NUEVA FUNCIÓN: Muestra un modal para que el usuario revise los duplicados encontrados.
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
// ... existing code ...
 */
export function openExpenseModal(expense = {}) {
    const isEditing = !!expense.id;
    const title = isEditing ? 'Editar Movimiento' : 'Agregar Movimiento Operativo';
// ... existing code ...
// ... existing code ...
            toggleFieldVisibility();
        }
    });
}
  
/**
// ... existing code ...
 */
export function openFinancialModal() {
    const body = `
        <form id="financial-form" style="display: grid; gap: 15px;">
// ... existing code ...
// ... existing code ...
                }
            });
        }
    });
}

/**
 * Rellena el select de filtro de categorías con las categorías existentes.
// ... existing code ...
 */
export function populateCategoryFilter() {
    const categories = [...new Set(state.expenses
        .filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses') 
// ... existing code ...
// ... existing code ...
    elements.categoryFilter.value = currentCategory;
}

// --- Litepicker Initialization ---
export function initDateRangePicker(callback) {
// ... existing code ...
// ... existing code ...
        });
    }
}

export function initHealthDateRangePicker(callback) {
    if (elements.healthDateRangeFilter) {
        return new Litepicker({
// ... existing code ...
// ... existing code ...
        });
    }
}

export function initSueldosDateRangePicker(callback) {
    if (elements.sueldosDateRangeFilter) {
        return new Litepicker({
// ... existing code ...
// ... existing code ...
        });
    }
}

export function renderSueldosData(employees, isFiltered) {
    elements.sueldosTableContainer.innerHTML = '';
// ... existing code ...
// ... existing code ...
        elements.sueldosTableContainer.appendChild(card);
    });
}

/**
 * Opens a modal to add a bonus or an expense/discount for an employee.
// ... existing code ...
 */
function openAdjustmentModal(employeeId, type) {
    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (!employee) return;
// ... existing code ...
// ... existing code ...
                services.saveAdjustment(employeeId, type, adjustmentData);
            }
        }
    });
}

/**
 * Opens the modal specifically for adding a bonus.
// ... existing code ...
 */
export function openBonoModal(employeeId) {
    openAdjustmentModal(employeeId, 'bono');
}

/**
 * Opens the modal specifically for adding an expense/discount.
// ... existing code ...
 */
export function openGastoModal(employeeId) {
    openAdjustmentModal(employeeId, 'gasto');
}
