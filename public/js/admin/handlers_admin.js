import { elements, state, app } from './state_admin.js';
import { getFilteredExpenses, parseSueldosData, recalculatePayment, generateWhatsAppMessage, formatCurrency } from './utils_admin.js';
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
 * Procesa el archivo de sueldos cargado por el usuario.
 * Lee la segunda hoja del excel, la parsea y la guarda en Firestore.
 * @param {Event} e - El evento 'change' del input de archivo.
 */
async function handleSueldosFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    ui.showModal({
        title: "Procesando Archivo...",
        body: '<p><i class="fas fa-spinner fa-spin"></i> Por favor, espera mientras se procesa el archivo de sueldos.</p>',
        showConfirm: false,
        showCancel: false
    });

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            // El usuario especificó que los datos están en la segunda hoja.
            if (workbook.SheetNames.length < 2) {
                throw new Error("El archivo Excel no tiene una segunda hoja. Asegúrate de que los datos de asistencia estén en la segunda hoja del archivo.");
            }
            const sheetName = workbook.SheetNames[1];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length < 2) { // Debe tener al menos encabezados y una fila de datos
                throw new Error("La segunda hoja del archivo está vacía o no tiene el formato correcto.");
            }

            // Parsear los datos usando la utilidad
            const newEmployees = parseSueldosData(jsonData);

            // Combinar con datos existentes (actualizar o agregar)
            const existingEmployees = state.sueldosData || [];
            const mergedEmployees = [...existingEmployees];

            newEmployees.forEach(newEmp => {
                const existingIndex = mergedEmployees.findIndex(emp => emp.id === newEmp.id);
                if (existingIndex > -1) {
                    // Actualizar los registros del empleado existente
                    mergedEmployees[existingIndex].registros = newEmp.registros;
                    recalculatePayment(mergedEmployees[existingIndex]);
                } else {
                    // Agregar como un nuevo empleado
                    mergedEmployees.push(newEmp);
                }
            });

            // Guardar los datos combinados en Firestore
            await services.saveSueldosDataToFirestore(mergedEmployees);

            ui.showModal({
                title: 'Éxito',
                body: `Se cargaron y procesaron correctamente los datos de ${newEmployees.length} empleados.`,
                confirmText: 'Entendido',
                showCancel: false
            });

        } catch (error) {
            console.error("Error procesando el archivo de sueldos:", error);
            ui.showModal({
                title: 'Error al Cargar',
                body: `No se pudo procesar el archivo. <br><br><strong>Detalle:</strong> ${error.message}`,
                confirmText: 'Cerrar',
                showCancel: false
            });
        } finally {
            // Limpiar el input para permitir volver a subir el mismo archivo
            e.target.value = '';
        }
    };
    reader.onerror = (error) => {
         ui.showModal({
            title: 'Error de Lectura',
            body: `Hubo un error al leer el archivo. Intenta de nuevo.`,
            confirmText: 'Cerrar',
            showCancel: false
        });
        e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
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
        if (e.target.closest('.toggle-details-btn')) {
            toggleEmployeeCard(employeeCard);
        }
    });

    // FIX: Changed event from 'change' to 'input' for instant recalculation.
    elements.sueldosTableContainer.addEventListener('input', (e) => {
        if (e.target.classList.contains('hourly-rate-input')) {
            const employeeId = e.target.closest('.employee-card').dataset.employeeId;
            const newRate = parseFloat(e.target.value);
            // No need to check for NaN, updateEmployeeRate will handle it
            updateEmployeeRate(employeeId, newRate);
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

function confirmCloseWeek() { console.log('Confirm close week'); }
function confirmDeleteSueldosData() { 
    ui.showModal({
        title: "Confirmar Eliminación",
        body: "¿Estás seguro de que quieres borrar TODOS los datos de sueldos? Esta acción es irreversible.",
        confirmText: "Sí, Borrar Todo",
        confirmClass: "btn-danger",
        onConfirm: () => services.deleteSueldosData()
    });
}
function sendWhatsAppMessage(employee) {
    const message = generateWhatsAppMessage(employee);
    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
}

/**
 * Handles updates when a user finishes editing an entry/exit time cell.
 * @param {HTMLElement} cell - The TD element that was edited.
 */
function updateSchedule(cell) {
    const day = cell.closest('tr').cells[0].textContent;
    const type = cell.dataset.type; // 'entrada' or 'salida'
    const newValue = cell.textContent.trim();
    const employeeId = cell.closest('.employee-card').dataset.employeeId;

    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (!employee) return;

    let registro = employee.registros.find(r => r.day === day);
    if (!registro) {
        // If the day doesn't exist in records, create it
        registro = { day: day, entrada: '', salida: '', horas: '0.00' };
        employee.registros.push(registro);
    }
    
    // Update the value
    registro[type] = newValue;

    // Recalculate everything for this employee
    recalculatePayment(employee);

    // Update UI for this employee card
    const employeeCard = elements.sueldosTableContainer.querySelector(`.employee-card[data-employee-id="${employeeId}"]`);
    if (employeeCard) {
        // Find the specific row for the day and update its hours
        const row = Array.from(employeeCard.querySelectorAll('tbody tr')).find(r => r.cells[0].textContent === day);
        if (row) {
            const updatedRegistro = employee.registros.find(r => r.day === day);
            if (updatedRegistro) {
                row.cells[3].textContent = updatedRegistro.horas; // Update hours cell
            }
        }
        
        // Update the summary values
        const totalHoursEl = employeeCard.querySelector('.payment-value-total-hours');
        const subtotalEl = employeeCard.querySelector('.payment-value-subtotal');
        const finalPaymentEl = employeeCard.querySelector('.payment-value-final');
        
        if (totalHoursEl) totalHoursEl.textContent = employee.totalHoursFormatted || '0.00';
        if (subtotalEl) subtotalEl.textContent = formatCurrency(employee.subtotal || 0);
        if (finalPaymentEl) finalPaymentEl.textContent = formatCurrency(employee.pago || 0);
    }

    // Save all data to Firestore
    services.saveSueldosDataToFirestore(state.sueldosData);
}


/**
 * Updates an employee's hourly rate, recalculates their payment, updates the UI, and saves to Firestore.
 * @param {string} employeeId - The ID of the employee to update.
 * @param {number} newRate - The new hourly rate.
 */
function updateEmployeeRate(employeeId, newRate) {
    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (!employee) return;
    
    // If the input is empty or not a valid number, use the previous rate or default
    const validRate = (!isNaN(newRate)) ? newRate : (employee.ratePerHour || 70);

    // 1. Update the rate in the application state
    employee.ratePerHour = validRate;

    // 2. Recalculate payment using the logic from the utils module
    recalculatePayment(employee);

    // 3. Update the UI for this specific employee card without a full re-render
    const employeeCard = elements.sueldosTableContainer.querySelector(`.employee-card[data-employee-id="${employeeId}"]`);
    if (employeeCard) {
        const subtotalEl = employeeCard.querySelector('.payment-value-subtotal');
        const finalPaymentEl = employeeCard.querySelector('.payment-value-final');
        
        if (subtotalEl) subtotalEl.textContent = formatCurrency(employee.subtotal || 0);
        if (finalPaymentEl) finalPaymentEl.textContent = formatCurrency(employee.pago || 0);
    }
    
    // 4. Save the entire updated payroll data to Firestore
    services.saveSueldosDataToFirestore(state.sueldosData);
}

/**
 * Toggles the visibility of an employee card's body.
 * @param {HTMLElement} cardElement - The employee card element.
 */
function toggleEmployeeCard(cardElement) {
    cardElement.classList.toggle('collapsed');
    const button = cardElement.querySelector('.toggle-details-btn');
    const icon = button.querySelector('i');
    const isExpanded = !cardElement.classList.contains('collapsed');

    button.setAttribute('aria-expanded', isExpanded);
    if (isExpanded) {
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
    } else {
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
    }
}

/**
 * Shows a confirmation modal before deleting an adjustment.
 * @param {string} employeeId - The ID of the employee.
 * @param {number} adjustmentId - The index of the adjustment.
 * @param {string} type - The type of adjustment ('bono' or 'gasto').
 */
function confirmDeleteAdjustment(employeeId, adjustmentId, type) {
    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (!employee) return;

    const list = type === 'bono' ? employee.bonos : employee.descuentos;
    const adjustment = list[adjustmentId];
    if (!adjustment) return;
    
    ui.showModal({
        title: `Confirmar Eliminación`,
        body: `¿Estás seguro de que quieres borrar el ${type} de "${adjustment.concept}" por ${formatCurrency(adjustment.amount)}?`,
        confirmText: "Sí, Eliminar",
        confirmClass: "btn-danger",
        onConfirm: () => services.deleteAdjustment(employeeId, parseInt(adjustmentId), type)
    });
}

