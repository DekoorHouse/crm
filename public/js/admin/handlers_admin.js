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

// --- HANDLERS ---

function handleTabClick(tab) {
    elements.tabs.forEach(t => t.classList.remove('active'));
    elements.tabContents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
    
    if (tab.dataset.tab === 'charts') app.renderAllCharts();
    if (tab.dataset.tab === 'health') app.renderFinancialHealth();
}

function handleFilterChange() {
    state.categoryFilter = elements.categoryFilter.value;
    app.renderData();
}

async function handleFileUpload(e) {
    services.saveStateToHistory();
    const file = e.target.files[0];
    if (!file) {
        actionHistory.pop();
        return;
    }
    const reader = new FileReader();
    reader.onload = async (event) => {
        // ... (el resto de la lógica de handleFileUpload) ...
    };
    reader.readAsArrayBuffer(file);
}


async function handleSueldosFileUpload(e) {
    const file = e.dataTransfer ? e.dataTransfer.files[0] : e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const worksheet = workbook.Sheets[workbook.SheetNames[1]];
            if (!worksheet) {
                ui.showModal({title: 'Error de Archivo', body: 'El archivo no contiene una segunda hoja de cálculo para los sueldos.', confirmText: 'Cerrar', showCancel: false});
                return;
            }
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
            
            const newEmployees = parseSueldosData(jsonData);
            await mergeAndSaveSueldosData(newEmployees);

        } catch (error) {
            console.error("Error al procesar el archivo de sueldos:", error);
            ui.showModal({title: 'Error', body: `Ocurrió un error al procesar el archivo de sueldos: ${error.message}`, confirmText: 'Cerrar', showCancel: false});
        } finally {
            if (e.target) e.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

async function mergeAndSaveSueldosData(newEmployees) {
    const existingEmployees = JSON.parse(JSON.stringify(state.sueldosData));
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

    await services.saveSueldosDataToFirestore(Array.from(employeeMap.values()));
    ui.showModal({
        title: 'Carga de Sueldos Completa',
        body: `Se agregaron ${newCount} empleados nuevos y se actualizaron los registros de ${updatedCount} empleados existentes.`,
        showCancel: false,
        confirmText: 'Entendido'
    });
}


async function handleCategoryChange(e) {
    const selectElement = e.target;
    const expenseId = selectElement.dataset.expenseId;
    const newCategory = selectElement.value;

    if (!expenseId || !newCategory) return;

    const expense = state.expenses.find(exp => exp.id === expenseId);
    if (!expense) return;
    
    services.saveStateToHistory();
    try {
        await services.updateExpenseCategory(expense, newCategory);
    } catch (error) {
        console.error("Error updating category:", error);
        actionHistory.pop();
        ui.showModal({ title: 'Error', body: 'No se pudo actualizar la categoría.' });
    }
}

// --- CONFIRMATION HANDLERS ---
function confirmDeleteExpense(id) {
    ui.showModal({
        title: "Confirmar Eliminación", body: "¿Estás seguro de que quieres borrar este registro único?",
        confirmText: "Eliminar", confirmClass: 'btn-danger',
        onConfirm: () => services.deleteExpense(id)
    });
}

function confirmDeleteAllData() {
    ui.showModal({
        title: 'Confirmar Borrado de Datos',
        body: '¿Estás seguro de que quieres borrar <strong>todos los registros de la tabla EXCEPTO los ingresos de tipo "Ajuste"</strong>?',
        confirmText: 'Sí, borrar datos', confirmClass: 'btn-danger',
        onConfirm: () => services.deleteAllData()
    });
}

function confirmDeleteCurrentMonth() {
    // ...
    ui.showModal({
        // ...
        onConfirm: () => services.deleteCurrentMonthData()
    });
}

function confirmDeletePreviousMonth() {
    // ...
    ui.showModal({
        // ...
        onConfirm: () => services.deletePreviousMonthData()
    });
}

function confirmRemoveDuplicates() {
    ui.showModal({
        title: 'Confirmar Limpieza de Duplicados',
        body: '¿Estás seguro de que quieres buscar y eliminar todos los registros duplicados?',
        confirmText: 'Sí, limpiar duplicados',
        confirmClass: 'btn-danger',
        onConfirm: () => services.removeDuplicates()
    });
}

// ... Otros handlers para sueldos, etc. ...

async function updateSchedule(cell) {
    const originalText = cell.textContent;
    let sanitizedText = originalText.replace(/[^0-9:]/g, '');
    if (sanitizedText !== originalText) {
        cell.textContent = sanitizedText;
    }

    const card = cell.closest('.employee-card');
    const employeeId = card.dataset.employeeId;
    const employee = state.sueldosData.find(emp => emp.id == employeeId);
    if (!employee) return;

    const tr = cell.closest('tr');
    const day = tr.cells[0].textContent;
    const registro = employee.registros.find(r => r.day == day);
    if (!registro) return;

    registro.entrada = tr.querySelector('[data-type="entrada"]').textContent;
    registro.salida = tr.querySelector('[data-type="salida"]').textContent;

    recalculatePayment(employee);

    tr.cells[3].textContent = registro.horas;
    card.querySelector('.payment-row:first-child span').textContent = employee.totalHoursFormatted;
    card.querySelector('.final-payment span').textContent = formatCurrency(employee.pago);

    await services.saveSueldosDataToFirestore();
}

function sendWhatsAppMessage(employee) {
    const message = generateWhatsAppMessage(employee);
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
}
