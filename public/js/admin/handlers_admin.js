import { elements, state, app } from './state_admin.js';
import { getFilteredExpenses, parseSueldosData, recalculatePayment, generateWhatsAppMessage } from './utils_admin.js';
import * as ui from './ui-manager_admin.js';
import * as services from './services_admin.js';

/**
 * @file Módulo de manejadores de eventos.
 * @description Conecta las interacciones del usuario en la UI con la lógica de la aplicación
 * definida en otros módulos.
 */

/**
 * Exports the currently filtered data to an Excel file.
 * This function was missing, causing the ReferenceError.
 */
function exportToExcel() {
    const expensesToExport = getFilteredExpenses();
    if (expensesToExport.length === 0) {
        ui.showModal({
            title: 'No hay datos',
            body: 'No hay datos en la vista actual para exportar.',
            showCancel: false,
            confirmText: 'Entendido'
        });
        return;
    }

    const worksheetData = expensesToExport.map(exp => ({
        Fecha: exp.date,
        Concepto: exp.concept,
        Cargo: exp.charge || 0,
        Ingreso: exp.credit || 0,
        Categoria: exp.category || 'Sin Categorizar',
        Canal: exp.channel || '',
        Tipo: exp.type || 'operativo',
        'Sub-tipo': exp.sub_type || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Gastos');

    // Generate filename with date range
    const { start, end } = state.dateFilter;
    let datePart = 'todos-los-datos';
    if (start && end) {
        const startDateStr = start.toISOString().split('T')[0];
        const endDateStr = end.toISOString().split('T')[0];
        datePart = `${startDateStr}_a_${endDateStr}`;
    }
    
    XLSX.writeFile(workbook, `Reporte_Gastos_${datePart}.xlsx`);
}

/**
 * Inicializa todos los event listeners de la aplicación.
 */
export function initEventListeners() {
    // Listeners generales de la aplicación
    elements.uploadBtn.addEventListener('click', () => elements.uploadInput.click());
    elements.uploadInput.addEventListener('change', handleFileUpload);
    elements.tabs.forEach(tab => tab.addEventListener('click', () => handleTabClick(tab)));
    elements.addManualBtn.addEventListener('click', () => ui.openExpenseModal());
    elements.addFinancialBtn.addEventListener('click', () => ui.openFinancialModal());
    elements.deleteDataBtn.addEventListener('click', confirmDeleteAllData);
    elements.deleteCurrentMonthBtn.addEventListener('click', confirmDeleteCurrentMonth);
    elements.deletePreviousMonthBtn.addEventListener('click', confirmDeletePreviousMonth);
    elements.exportBtn.addEventListener('click', exportToExcel);
    elements.removeDuplicatesBtn.addEventListener('click', confirmRemoveDuplicates);
    elements.categoryFilter.addEventListener('change', handleFilterChange);
    
    // Listener para el modal
    elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) ui.showModal({ show: false });
    });
    
    // Listener para el cuerpo de la tabla de datos (delegación de eventos)
    elements.dataTableBody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-btn');
        const deleteBtn = e.target.closest('.delete-btn');
        if (editBtn) {
            const expenseId = e.target.closest('tr').querySelector('.category-dropdown')?.dataset.expenseId || state.expenses.find(exp => exp.id === e.target.closest('tr').dataset.id)?.id;
            const expense = state.expenses.find(exp => exp.id === expenseId);
            if (expense) ui.openExpenseModal(expense);
        }
        if (deleteBtn) {
            const expenseId = e.target.closest('tr').querySelector('.category-dropdown')?.dataset.expenseId || state.expenses.find(exp => exp.id === e.target.closest('tr').dataset.id)?.id;
            if (expenseId) confirmDeleteExpense(expenseId);
        }
    });
    
    elements.dataTableBody.addEventListener('change', (e) => {
        if (e.target.classList.contains('category-dropdown')) {
            handleCategoryChange(e);
        }
    });
    
    // Listener para la sección de resumen (delegación de eventos)
    elements.summarySection.addEventListener('click', (e) => {
        const card = e.target.closest('.summary-card.clickable');
        if (card) {
            ui.showCategoryDetailsModal(card.dataset.category, getFilteredExpenses);
        }
    });

    // Listeners para la pestaña de Sueldos
    elements.addEmployeeBtn.addEventListener('click', () => ui.openAddEmployeeModal());
    elements.sueldosUploadBtn.addEventListener('click', () => elements.sueldosUploadInput.click());
    elements.sueldosUploadInput.addEventListener('change', handleSueldosFileUpload);
    elements.resetSueldosFilterBtn.addEventListener('click', () => app.resetSueldosFilter());
    elements.closeWeekBtn.addEventListener('click', confirmCloseWeek);
    elements.deleteSueldosBtn.addEventListener('click', confirmDeleteSueldosData);

    // Delegación de eventos para las tarjetas de empleados
    elements.sueldosTableContainer.addEventListener('click', (e) => {
        const employeeCard = e.target.closest('.employee-card');
        if (!employeeCard) return;
        const employeeId = employeeCard.dataset.employeeId;

        if (e.target.closest('.add-bono-btn')) ui.openBonoModal(employeeId);
        if (e.target.closest('.add-gasto-btn')) ui.openGastoModal(employeeId);
        if (e.target.closest('.share-text-btn')) {
            const employee = state.sueldosData.find(emp => emp.id === employeeId);
            if(employee) sendWhatsAppMessage(employee);
        }
        if (e.target.closest('.download-pdf-btn')) {
             const employee = state.sueldosData.find(emp => emp.id === employeeId);
            if(employee) ui.generateReportPdf(employee);
        }
        if (e.target.closest('.delete-adjustment-btn')) {
            const { adjustmentId, adjustmentType } = e.target.closest('.delete-adjustment-btn').dataset;
            confirmDeleteAdjustment(employeeId, adjustmentId, adjustmentType);
        }
    });

    elements.sueldosTableContainer.addEventListener('change', (e) => {
        if (e.target.classList.contains('hourly-rate-input')) {
            const employeeId = e.target.closest('.employee-card').dataset.employeeId;
            const newRate = parseFloat(e.target.value);
            const employee = state.sueldosData.find(emp => emp.id === employeeId);
            if (!isNaN(newRate) && newRate >= 0) {
                updateEmployeeRate(employeeId, newRate);
            } else if (employee) {
                e.target.value = employee.ratePerHour || 70;
            }
        }
    });

    elements.sueldosTableContainer.addEventListener('blur', (e) => {
        if (e.target.matches('td[contenteditable="true"]')) {
            updateSchedule(e.target);
        }
    }, true); // Use capturing to catch blur events

    elements.sueldosTableContainer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && e.target.matches('td[contenteditable="true"]')) {
            e.preventDefault();
            e.target.blur();
        }
    });

    // Listeners para la pestaña de Salud Financiera
    elements.resetHealthFilterBtn.addEventListener('click', () => {
        if (app.healthPicker) app.healthPicker.clearSelection();
    });
    elements.leadsChartToggle.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button && !button.classList.contains('active')) {
            elements.leadsChartToggle.querySelector('.active').classList.remove('active');
            button.classList.add('active');
            state.financials.leadsChartTimeframe = button.dataset.timeframe;
            ui.updateLeadsTrendChart();
        }
    });
    
    // Listener de teclado global
    window.addEventListener('keydown', (e) => {
        if (elements.modal.classList.contains('visible')) {
            if (e.key === 'Escape') { e.preventDefault(); elements.modalCancelBtn.click(); }
            if (e.key === 'Enter') { 
                e.preventDefault(); 
                if (elements.modalConfirmBtn.style.display !== 'none') elements.modalConfirmBtn.click();
            }
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            services.undoLastAction();
        }
    });
}

// NOTE: The following functions are placeholders to avoid further reference errors.
// Their full implementation might be in other files or needs to be developed.
function handleFileUpload(e) { console.log("File upload handled", e.target.files[0]); }
function handleTabClick(tab) {
    elements.tabs.forEach(t => t.classList.remove('active'));
    elements.tabContents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
}
function confirmDeleteAllData() { services.deleteAllData(); }
function confirmDeleteCurrentMonth() { services.deleteCurrentMonthData(); }
function confirmDeletePreviousMonth() { services.deletePreviousMonthData(); }
function confirmRemoveDuplicates() { services.removeDuplicates(); }
function handleFilterChange() { app.renderData(); }
function handleCategoryChange(e) {
    const select = e.target;
    const expenseId = select.dataset.expenseId;
    const newCategory = select.value;
    const expense = state.expenses.find(exp => exp.id === expenseId);
    if(expense) services.saveExpense({...expense, category: newCategory}, expense.category);
}
function confirmDeleteExpense(id) {
    ui.showModal({
        title: "Confirmar Eliminación", body: "¿Estás seguro de que quieres borrar este registro único?",
        confirmText: "Eliminar", confirmClass: 'btn-danger',
        onConfirm: () => services.deleteExpense(id)
    });
}
function handleSueldosFileUpload(e) { console.log('Sueldos file upload handled'); }
function confirmCloseWeek() { console.log('Confirm close week'); }
function confirmDeleteSueldosData() { services.deleteSueldosData(); }
function sendWhatsAppMessage(employee) {
    const message = generateWhatsAppMessage(employee);
    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
}
function updateSchedule(cell) { console.log('Schedule updated'); }
function updateEmployeeRate(id, rate) { console.log(`Rate updated for ${id}`); }
function confirmDeleteAdjustment(empId, adjId, type) { console.log('Delete adjustment'); }
