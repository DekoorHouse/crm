import { elements, state, app } from './state_admin.js';
import * as utils from './utils_admin.js';
import * as ui from './ui-manager_admin.js';
import * as services from './services_admin.js';
import * as charts from './charts_admin.js'; // Assuming you have this module for charts

/**
 * @file Módulo de manejadores de eventos.
 * @description Conecta las interacciones del usuario en la UI con la lógica de la aplicación
 * definida en otros módulos.
 */

/**
 * Procesa el archivo de gastos (.xls o .xlsx) cargado por el usuario.
 * @param {Event} e - El evento 'change' del input de archivo.
 */
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    console.log(`[LOG] Iniciando carga del archivo: ${file.name}, Tipo: ${file.type}, Tamaño: ${file.size} bytes`);

    ui.showModal({
        title: "Procesando Archivo...",
        body: '<p><i class="fas fa-spinner fa-spin"></i> Por favor, espera mientras se leen los datos del archivo.</p>',
        showConfirm: false,
        showCancel: false
    });

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            console.log('[LOG] FileReader onload - Archivo leído en memoria.');
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            console.log(`[LOG] Hoja de cálculo seleccionada: "${sheetName}"`);
            
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            console.log(`[LOG] Datos crudos extraídos de Excel (primeras 10 filas):`, JSON.parse(JSON.stringify(jsonData.slice(0, 10))));

            if (jsonData.length === 0) {
                throw new Error("El archivo Excel está vacío o no tiene el formato correcto.");
            }

            console.log('[LOG] Llamando a utils.parseExpensesData...');
            const newExpenses = utils.parseExpensesData(jsonData, file.name.split('.').pop());
            console.log(`[LOG] Datos parseados por parseExpensesData. Total de registros válidos: ${newExpenses.length}`);
            
            if (newExpenses.length === 0) {
                ui.showModal({
                    title: 'Sin Datos Válidos',
                    body: 'No se encontraron registros de gastos válidos en el archivo para procesar.',
                    confirmText: 'Entendido',
                    showCancel: false
                });
                return;
            }

            // --- LÓGICA DE DETECCIÓN DE DUPLICADOS ---
            const existingSignatures = new Set(state.expenses.map(exp => utils.getExpenseSignature(exp)));
            const newExpensesBySig = new Map();

            newExpenses.forEach(expense => {
                const sig = utils.getExpenseSignature(expense);
                if (!newExpensesBySig.has(sig)) {
                    newExpensesBySig.set(sig, []);
                }
                newExpensesBySig.get(sig).push(expense);
            });

            const nonDuplicates = [];
            const duplicateGroups = [];

            for (const [sig, group] of newExpensesBySig.entries()) {
                const isExisting = existingSignatures.has(sig);
                const isIntraFile = group.length > 1;

                if (isExisting || isIntraFile) {
                    let reason = '';
                    if (isExisting && isIntraFile) reason = 'Ya existe en la base de datos Y en el archivo';
                    else if (isExisting) reason = 'Ya existe en la base de datos';
                    else if (isIntraFile) reason = 'Duplicado dentro del archivo';
                    
                    duplicateGroups.push({
                        signature: sig,
                        expenses: group,
                        reason: reason
                    });
                } else {
                    nonDuplicates.push(group[0]);
                }
            }

            // --- PUNTO DE DECISIÓN ---
            if (duplicateGroups.length > 0) {
                // Mostrar modal para que el usuario elija
                ui.showDuplicateSelectionModal(duplicateGroups, nonDuplicates);
            } else {
                // Sin duplicados, guardar directamente
                await services.saveBulkExpenses(nonDuplicates);
                ui.showModal({
                    title: 'Éxito',
                    body: `Se cargaron y procesaron correctamente ${nonDuplicates.length} registros del archivo. No se encontraron duplicados.`,
                    confirmText: 'Entendido',
                    showCancel: false
                });
            }

        } catch (error) {
            // Log a more detailed error
            console.error("Error detallado al procesar el archivo de gastos:", {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            ui.showModal({
                title: 'Error al Cargar',
                body: `No se pudo procesar el archivo. Revisa la consola para más detalles. <br><br><strong>Detalle:</strong> ${error.message}`,
                confirmText: 'Cerrar',
                showCancel: false
            });
        } finally {
            e.target.value = ''; // Reset input
        }
    };
    reader.onerror = (error) => {
         console.error('[LOG] FileReader onerror - Error de lectura:', error);
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

            if (workbook.SheetNames.length < 2) {
                throw new Error("El archivo Excel no tiene una segunda hoja. Asegúrate de que los datos de asistencia estén en la segunda hoja del archivo.");
            }
            const sheetName = workbook.SheetNames[1];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length < 2) { 
                throw new Error("La segunda hoja del archivo está vacía o no tiene el formato correcto.");
            }

            const newEmployees = utils.parseSueldosData(jsonData);
            const existingEmployees = state.sueldosData || [];
            const mergedEmployees = [...existingEmployees];

            newEmployees.forEach(newEmp => {
                const existingIndex = mergedEmployees.findIndex(emp => emp.id === newEmp.id);
                if (existingIndex > -1) {
                    mergedEmployees[existingIndex].registros = newEmp.registros;
                    utils.recalculatePayment(mergedEmployees[existingIndex]);
                } else {
                    mergedEmployees.push(newEmp);
                }
            });

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
    elements.addKpiBtn.addEventListener('click', () => ui.openKpiModal());
    
    elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) ui.showModal({ show: false });
    });
    
    elements.dataTableBody.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;

        const editBtn = e.target.closest('.edit-btn');
        const deleteBtn = e.target.closest('.delete-btn');
        const expenseId = row.querySelector('.category-dropdown')?.dataset.expenseId || state.expenses.find(exp => exp.id === row.dataset.id)?.id;

        if (editBtn && expenseId) {
            const expense = state.expenses.find(exp => exp.id === expenseId);
            if (expense) ui.openExpenseModal(expense);
        }
        if (deleteBtn && expenseId) {
            confirmDeleteExpense(expenseId);
        }
    });
    
    elements.kpiTableBody.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;

        const editBtn = e.target.closest('.edit-kpi-btn');
        const deleteBtn = e.target.closest('.delete-kpi-btn');
        const kpiId = row.dataset.id;

        if (editBtn && kpiId) {
            const kpi = state.kpis.find(k => k.id === kpiId);
            if (kpi) ui.openKpiModal(kpi);
        }
        if (deleteBtn && kpiId) {
            confirmDeleteKpi(kpiId);
        }
    });

    elements.dataTableBody.addEventListener('change', (e) => {
        if (e.target.classList.contains('category-dropdown')) {
            handleCategoryChange(e);
        }
    });
    
    elements.summarySection.addEventListener('click', (e) => {
        const card = e.target.closest('.summary-card.clickable');
        if (card) {
            ui.showCategoryDetailsModal(card.dataset.category, utils.getFilteredExpenses);
        }
    });

    elements.addEmployeeBtn.addEventListener('click', () => ui.openAddEmployeeModal());
    elements.sueldosUploadBtn.addEventListener('click', () => elements.sueldosUploadInput.click());
    elements.sueldosUploadInput.addEventListener('change', handleSueldosFileUpload);
    elements.resetSueldosFilterBtn.addEventListener('click', () => app.resetSueldosFilter());
    elements.closeWeekBtn.addEventListener('click', confirmCloseWeek);
    elements.deleteSueldosBtn.addEventListener('click', confirmDeleteSueldosData);

    elements.sueldosTableContainer.addEventListener('click', (e) => {
        const employeeCard = e.target.closest('.employee-card');
        if (!employeeCard) return;
        const employeeId = employeeCard.dataset.employeeId;
        const employee = state.sueldosData.find(emp => emp.id === employeeId);

        if (e.target.closest('.add-bono-btn')) ui.openBonoModal(employeeId);
        if (e.target.closest('.add-gasto-btn')) ui.openGastoModal(employeeId);
        if (e.target.closest('.share-text-btn') && employee) sendWhatsAppMessage(employee);
        if (e.target.closest('.download-pdf-btn') && employee) ui.generateReportPdf(employee);
        if (e.target.closest('.delete-adjustment-btn')) {
            const { adjustmentId, adjustmentType } = e.target.closest('.delete-adjustment-btn').dataset;
            confirmDeleteAdjustment(employeeId, adjustmentId, adjustmentType);
        }
        if (e.target.closest('.toggle-details-btn')) {
            toggleEmployeeCard(employeeCard);
        }
    });

    elements.sueldosTableContainer.addEventListener('input', (e) => {
        if (e.target.classList.contains('hourly-rate-input')) {
            const employeeId = e.target.closest('.employee-card').dataset.employeeId;
            updateEmployeeRate(employeeId, parseFloat(e.target.value));
        }
    });
    
    elements.sueldosTableContainer.addEventListener('blur', (e) => {
        if (e.target.matches('td[contenteditable="true"]')) {
            updateSchedule(e.target);
        }
    }, true);

    elements.sueldosTableContainer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && e.target.matches('td[contenteditable="true"]')) {
            e.preventDefault();
            e.target.blur();
        }
    });

    elements.resetHealthFilterBtn.addEventListener('click', () => {
        if (app.healthPicker) app.healthPicker.clearSelection();
    });
    elements.leadsChartToggle.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button && !button.classList.contains('active')) {
            elements.leadsChartToggle.querySelector('.active').classList.remove('active');
            button.classList.add('active');
            state.financials.leadsChartTimeframe = button.dataset.timeframe;
            charts.updateLeadsTrendChart();
        }
    });
    
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

function exportToExcel() {
    const expensesToExport = utils.getFilteredExpenses();
    if (expensesToExport.length === 0) {
        ui.showModal({
            title: 'No hay datos',
            body: 'No hay datos en la vista actual para exportar.',
            showCancel: false, confirmText: 'Entendido'
        });
        return;
    }

    const worksheetData = expensesToExport.map(exp => ({
        Fecha: exp.date, Concepto: exp.concept,
        Cargo: exp.charge || 0, Ingreso: exp.credit || 0,
        Categoria: exp.category || 'Sin Categorizar', Canal: exp.channel || '',
        Tipo: exp.type || 'operativo', 'Sub-tipo': exp.sub_type || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Gastos');

    const { start, end } = state.dateFilter;
    let datePart = 'todos-los-datos';
    if (start && end) {
        datePart = `${start.toISOString().split('T')[0]}_a_${end.toISOString().split('T')[0]}`;
    }
    
    XLSX.writeFile(workbook, `Reporte_Gastos_${datePart}.xlsx`);
}

function handleTabClick(tab) {
    elements.tabs.forEach(t => t.classList.remove('active'));
    elements.tabContents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
}

function confirmDeleteAllData() {
    ui.showModal({
        title: "Confirmar Borrado Total",
        body: "<strong>¡Atención!</strong> Estás a punto de borrar TODOS los registros de gastos. Esta acción es irreversible. <br><br>¿Estás completamente seguro?",
        confirmText: "Sí, Borrar Todo",
        confirmClass: 'btn-danger',
        onConfirm: () => services.deleteAllData()
    });
}

function confirmDeleteKpi(id) {
    ui.showModal({
        title: "Confirmar Eliminación",
        body: "¿Estás seguro de que quieres borrar este registro de KPI?",
        confirmText: "Eliminar",
        confirmClass: 'btn-danger',
        onConfirm: () => services.deleteKpi(id)
    });
}

function confirmDeleteCurrentMonth() {
    ui.showModal({
        title: "Confirmar Borrado",
        body: "Vas a borrar todos los registros del mes actual. Esta acción no se puede deshacer. <br><br>¿Continuar?",
        confirmText: "Borrar Mes Actual",
        confirmClass: 'btn-danger',
        onConfirm: () => services.deleteCurrentMonthData()
    });
}

function confirmDeletePreviousMonth() {
    ui.showModal({
        title: "Confirmar Borrado",
        body: "Vas a borrar todos los registros del mes anterior. Esta acción no se puede deshacer. <br><br>¿Continuar?",
        confirmText: "Borrar Mes Anterior",
        confirmClass: 'btn-danger',
        onConfirm: () => services.deletePreviousMonthData()
    });
}

function confirmRemoveDuplicates() {
    ui.showModal({
        title: "Confirmar Eliminación de Duplicados",
        body: "El sistema buscará y eliminará registros duplicados basados en fecha, concepto y montos. Esta acción no se puede deshacer. <br><br>¿Deseas continuar?",
        confirmText: "Sí, Eliminar Duplicados",
        confirmClass: 'btn-danger',
        onConfirm: () => services.removeDuplicates()
    });
}

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
        confirmText: "Sí, Borrar Todo", confirmClass: "btn-danger",
        onConfirm: () => services.deleteSueldosData()
    });
}

function sendWhatsAppMessage(employee) {
    const message = utils.generateWhatsAppMessage(employee);
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
}

function updateSchedule(cell) {
    const employeeId = cell.closest('.employee-card').dataset.employeeId;
    services.updateEmployeeTime(employeeId);
}

function updateEmployeeRate(employeeId, newRate) {
    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (employee && !isNaN(newRate) && newRate >= 0) {
        services.updateEmployeeField(employeeId, 'ratePerHour', newRate);
    } else if (employee) {
        const rateInput = document.querySelector(`.employee-card[data-employee-id="${employeeId}"] .hourly-rate-input`);
        if(rateInput) rateInput.value = employee.ratePerHour || 70;
    }
}

function confirmDeleteAdjustment(empId, adjId, type) {
    ui.showModal({
        title: "Confirmar Eliminación",
        body: `¿Estás seguro de que quieres eliminar este ${type === 'bono' ? 'bono' : 'gasto'}?`,
        confirmText: "Eliminar", confirmClass: "btn-danger",
        onConfirm: () => services.deleteAdjustment(empId, type, parseInt(adjId))
    });
}

function toggleEmployeeCard(card) {
    const body = card.querySelector('.employee-body');
    const button = card.querySelector('.toggle-details-btn');
    const icon = button.querySelector('i');
    const isExpanded = button.getAttribute('aria-expanded') === 'true';

    button.setAttribute('aria-expanded', !isExpanded);
    body.style.display = isExpanded ? 'none' : 'grid';
    icon.classList.toggle('fa-chevron-up', !isExpanded);
    icon.classList.toggle('fa-chevron-down', isExpanded);
    card.querySelector('.employee-header-rate').style.display = isExpanded ? 'none' : 'flex';
}

