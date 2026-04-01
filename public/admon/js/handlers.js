import { elements, state } from './state.js';
import * as utils from './utils.js';
import * as ui from './ui-manager.js';
import * as services from './services.js';
import * as charts from './charts.js';

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

    ui.showModal({
        title: "Procesando Archivo...",
        body: '<p><i class="fas fa-spinner fa-spin"></i> Por favor, espera mientras se leen los datos del archivo.</p>',
        showConfirm: false,
        showCancel: false
    });

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length === 0) {
                throw new Error("El archivo Excel está vacío o no tiene el formato correcto.");
            }

            const newExpenses = utils.parseExpensesData(jsonData, file.name.split('.').pop());
            
            if (newExpenses.length === 0) {
                ui.showModal({
                    title: 'Sin Datos Válidos',
                    body: 'No se encontraron registros de gastos válidos en el archivo para procesar.',
                    confirmText: 'Entendido',
                    showCancel: false
                });
                return;
            }

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
                const firstExpense = group[0];
                const concept = (firstExpense.concept || '').toUpperCase();
                
                // Conceptos especiales que permitimos duplicar
                const isSpecialConcept = concept.includes("SU PAGO EN EFECTIVO") || 
                                       concept.includes("PAY PAL*FACEBOOK");

                const isExisting = existingSignatures.has(sig);
                const isIntraFile = group.length > 1;

                if (!isSpecialConcept && (isExisting || isIntraFile)) {
                    let reason = isExisting ? 'Ya existe en la base de datos' : 'Duplicado dentro del archivo';
                    duplicateGroups.push({ signature: sig, expenses: group, reason: reason });
                } else {
                    // Agregamos todos los del grupo (sean 1 o varios) a los procesables
                    group.forEach(expense => nonDuplicates.push(expense));
                }
            }

            if (duplicateGroups.length > 0) {
                ui.showDuplicateSelectionModal(duplicateGroups, nonDuplicates);
            } else {
                await services.saveBulkExpenses(nonDuplicates);
                ui.showModal({
                    title: 'Éxito',
                    body: `Se cargaron y procesaron correctamente ${nonDuplicates.length} registros.`,
                    confirmText: 'Entendido',
                    showCancel: false
                });
            }

        } catch (error) {
            console.error("Error al procesar el archivo de gastos:", error);
            ui.showModal({
                title: 'Error al Cargar',
                body: `No se pudo procesar el archivo. <br><br><strong>Detalle:</strong> ${error.message}`,
                confirmText: 'Cerrar',
                showCancel: false
            });
        } finally {
            e.target.value = ''; // Reset input
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
 * Procesa el archivo de sueldos cargado por el usuario.
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
                throw new Error("El archivo Excel no tiene una segunda hoja para los datos de asistencia.");
            }
            const sheetName = workbook.SheetNames[1];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length < 2) { 
                throw new Error("La segunda hoja del archivo está vacía o no tiene el formato correcto.");
            }

            const newEmployees = utils.parseSueldosData(jsonData);
            const mergedEmployees = [...(state.sueldosData || [])];

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
    elements.deleteCurrentMonthBtn.addEventListener('click', confirmDeleteCurrentMonth);
    elements.deletePreviousMonthBtn.addEventListener('click', confirmDeletePreviousMonth);
    elements.exportBtn.addEventListener('click', exportToExcel);
    elements.categoryFilter.addEventListener('change', handleFilterChange);
    
    elements.modal.addEventListener('click', (e) => {
        if (e.target.closest('.modal-cancel-btn')) { // Ensure cancel button in modal closes it
            ui.showModal({ show: false });
            return;
        }
        // Click outside modal no longer closes it
    });
    
    elements.dataTableBody.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;
        const expenseId = row.dataset.id;
        const expense = state.expenses.find(exp => exp.id === expenseId);

        if (e.target.closest('.split-btn') && expense) {
            ui.openSplitModal(expense);
        }
        if (e.target.closest('.edit-btn') && expense) {
            ui.openExpenseModal(expense);
        }
        if (e.target.closest('.delete-btn') && expenseId) {
            confirmDeleteExpense(expenseId);
        }
    });
    
    elements.dataTableBody.addEventListener('change', (e) => {
        if (e.target.classList.contains('category-dropdown')) {
            handleCategoryChange(e);
        }
        if (e.target.classList.contains('subcategory-dropdown')) {
            handleSubcategoryChange(e);
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
    elements.resetSueldosFilterBtn.addEventListener('click', () => window.app.resetSueldosFilter()); // CORREGIDO: usar window.app
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
        if (e.target.closest('.delete-employee-btn')) {
            confirmDeleteEmployee(employeeId);
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
        if (window.app.healthPicker) window.app.healthPicker.clearSelection(); // CORREGIDO: usar window.app
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

    if (elements.monthFilterSelect) {
        elements.monthFilterSelect.addEventListener('change', handleMonthFilterChange);
    }

    // KPI Listeners
    if (elements.addKpiBtn) {
        elements.addKpiBtn.addEventListener('click', () => ui.openKpiModal());
    }
    
    // NUEVO: Listener para botón de Meta (Corregido y reforzado)
    const syncMetaBtn = elements.syncMetaBtn || document.getElementById('sync-meta-btn');
    if (syncMetaBtn) {
        syncMetaBtn.addEventListener('click', () => {
            console.log("Click en botón Sincronizar Meta"); // Log para debug
            ui.openMetaSyncModal();
        });
    } else {
        console.warn("No se encontró el botón de Sincronizar con Meta");
    }

    if (elements.kpisTableBody) {
        elements.kpisTableBody.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.edit-kpi-btn');
            const deleteBtn = e.target.closest('.delete-kpi-btn');

            if (editBtn) {
                const fecha = editBtn.dataset.fecha;
                const leads = state.monthlyLeads[fecha] || 0;
                const paidLeads = state.monthlyPaidLeads[fecha] || 0;
                const manualKpi = state.kpis.find(k => k.fecha === fecha) || {};
                const kpiData = {
                    ...manualKpi,
                    fecha: fecha,
                    leads: leads,
                    paidLeads: paidLeads
                };
                ui.openKpiModal(kpiData);
            }

            if (deleteBtn && !deleteBtn.disabled) {
                const kpiId = deleteBtn.dataset.id;
                if (kpiId) {
                    confirmDeleteKpi(kpiId);
                }
            }
        });
    }

    // --- NUEVO: Listeners para Notas ---
    if (elements.notesEditor) {
        let saveTimeout;
        elements.notesEditor.addEventListener('input', () => {
            ui.showNotesSaveStatus('Escribiendo...');
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                ui.showNotesSaveStatus('Guardando...');
                const content = elements.notesEditor.innerHTML;
                const success = await services.saveNotes(content);
                if (success) {
                    ui.showNotesSaveStatus('Guardado');
                } else {
                    ui.showNotesSaveStatus('Error al guardar');
                }
            }, 1000); // Guardar 1 segundo después de dejar de escribir
        });
    }

    if (elements.notesToolbar) {
        elements.notesToolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (btn) {
                const command = btn.dataset.command;
                if (command) {
                    document.execCommand(command, false, null);
                    elements.notesEditor.focus();
                }
            }
        });
    }
    
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
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
            // Activar botón de carga con Ctrl+I, excepto si se está escribiendo
            const activeEl = document.activeElement;
            const isInput = activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable;
            if (!isInput) {
                e.preventDefault();
                if (elements.uploadBtn) elements.uploadBtn.click();
            }
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
    let datePart = start && end ? `${start.toISOString().split('T')[0]}_a_${end.toISOString().split('T')[0]}` : 'todos-los-datos';
    
    XLSX.writeFile(workbook, `Reporte_Gastos_${datePart}.xlsx`);
}

function handleTabClick(tab) {
    elements.tabs.forEach(t => t.classList.remove('active'));
    elements.tabContents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
}

/**
 * Maneja el clic en un botón de filtro de mes.
 * @param {Event} e - El evento de clic.
 */
/**
 * Maneja el cambio en el selector de filtro de mes.
 * @param {Event} e - El evento de cambio.
 */
function handleMonthFilterChange(e) {
    const select = e.target;
    if (!select.value) return;

    if (window.app.picker) {
        window.app.picker.clearSelection();
    }

    const [month, year] = select.value.split('-').map(Number);

    state.activeMonth = { month, year };
    
    // Crear la fecha de inicio en UTC
    state.dateFilter.start = new Date(Date.UTC(year, month, 1));
    
    // Crear la fecha de fin en UTC (fin de mes)
    const endDate = new Date(Date.UTC(year, month + 1, 0));
    endDate.setUTCHours(23, 59, 59, 999);
    state.dateFilter.end = endDate;

    window.app.renderData();
    window.app.renderSummary();
    window.app.renderAllCharts();
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

function confirmDeleteCurrentMonth() {
    ui.showModal({
        title: "Confirmar Borrado",
        body: "Vas a borrar todos los registros del mes actual que no hayan sido agregados manualmente. Esta acción no se puede deshacer. <br><br>¿Continuar?",
        confirmText: "Borrar Mes Actual",
        confirmClass: 'btn-danger',
        onConfirm: () => services.deleteCurrentMonthData()
    });
}

function confirmDeletePreviousMonth() {
    ui.showModal({
        title: "Confirmar Borrado",
        body: "Vas a borrar todos los registros del mes anterior que no hayan sido agregados manualmente. Esta acción no se puede deshacer. <br><br>¿Continuar?",
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

async function handleFilterChange(e) {
    if (e.target.value === '__add_new_category__') {
        const newCategoryName = await ui.showPromptModal({
            title: 'Nueva categoría de gasto',
            placeholder: 'Nombre de la categoría',
            confirmText: 'Crear'
        });
        if (newCategoryName && newCategoryName.trim() !== '') {
            await services.saveNewCategory(newCategoryName.trim());
            ui.showToast(`Categoría "${newCategoryName.trim()}" creada`, 'success');
        }
        e.target.value = state.categoryFilter || 'all';
        return;
    }
    state.categoryFilter = e.target.value;
    window.app.renderData(); // CORREGIDO: usar window.app
    window.app.renderSummary(); // CORREGIDO: usar window.app
    window.app.renderAllCharts(); // CORREGIDO: usar window.app
}

async function handleCategoryChange(e) {
    const select = e.target;
    const expenseId = select.dataset.expenseId;
    const newCategory = select.value;
    const expense = state.expenses.find(exp => exp.id === expenseId);

    if (newCategory === '__add_new_category__') {
        const newCategoryName = await ui.showPromptModal({
            title: 'Nueva categoría de gasto',
            placeholder: 'Nombre de la categoría',
            confirmText: 'Crear'
        });
        if (newCategoryName && newCategoryName.trim() !== '') {
            const trimmedName = newCategoryName.trim();
            await services.saveNewCategory(trimmedName);
            if (expense) {
                services.saveExpense({...expense, category: trimmedName, subcategory: ''}, expense.category);
            }
        } else {
            select.value = expense ? (expense.category || 'SinCategorizar') : 'SinCategorizar';
        }
        return;
    }

    if(expense) {
        // When category changes, reset subcategory
        services.saveExpense({...expense, category: newCategory, subcategory: ''}, expense.category);
    }
}

async function handleSubcategoryChange(e) {
    const select = e.target;
    const expenseId = select.dataset.expenseId;
    const parentCategory = select.dataset.category;
    const newSubcategory = select.value;
    const expense = state.expenses.find(exp => exp.id === expenseId);

    if (newSubcategory === '__add_new__') {
        if (!parentCategory) {
            ui.showToast("Primero debe seleccionar una categoría principal.", "warning");
            select.value = expense.subcategory || '';
            return;
        }
        const newSubcategoryName = await ui.showPromptModal({
            title: `Nueva subcategoría para "${parentCategory}"`,
            placeholder: 'Nombre de la subcategoría',
            confirmText: 'Crear'
        });
        
        if (newSubcategoryName && newSubcategoryName.trim() !== '') {
            const trimmedName = newSubcategoryName.trim();
            // Guardar la nueva subcategoría con su categoría padre
            await services.saveNewSubcategory(trimmedName, parentCategory);
            // Guardar el gasto con la nueva subcategoría. El listener actualizará la UI.
            await services.saveExpense({...expense, subcategory: trimmedName}, expense.category);
        } else {
            // Reset dropdown si el usuario cancela
            select.value = expense.subcategory || '';
        }
        return;
    }

    if(expense && expense.subcategory !== newSubcategory) {
        services.saveExpense({...expense, subcategory: newSubcategory}, expense.category);
    }
}

function confirmDeleteExpense(id) {
    ui.showModal({
        title: "Confirmar Eliminación", body: "¿Estás seguro de que quieres borrar este registro único?",
        confirmText: "Eliminar", confirmClass: 'btn-danger',
        onConfirm: () => services.deleteExpense(id)
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


function confirmCloseWeek() { 
    ui.showModal({
        title: "Cerrar Semana",
        body: "Esta acción guardará los totales actuales en el historial de cada empleado y limpiará los registros de asistencia, bonos y descuentos para iniciar una nueva semana. <br><br>¿Estás seguro?",
        confirmText: "Sí, Cerrar Semana",
        confirmClass: "btn-success",
        onConfirm: async () => {
            ui.showModal({ title: "Procesando...", body: "Cerrando semana y guardando historial...", showConfirm: false, showCancel: false });
            const success = await services.closeWeek();
            if (success) {
                ui.showModal({ title: "¡Semana Cerrada!", body: "El historial se ha actualizado y los registros semanales se han limpiado.", confirmText: "Entendido", showCancel: false });
            } else {
                ui.showModal({ title: "Error", body: "Hubo un problema al cerrar la semana. Por favor intenta de nuevo.", confirmText: "Cerrar", showCancel: false });
            }
        }
    });
}

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

function confirmDeleteEmployee(employeeId) {
    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (!employee) return;
    ui.showModal({
        title: "Eliminar Empleado",
        body: `¿Estás seguro de que quieres eliminar a <strong>${utils.capitalize(employee.name)}</strong> y todo su historial de esta semana? Esta acción es irreversible.`,
        confirmText: "Eliminar", confirmClass: "btn-danger",
        onConfirm: () => services.deleteEmployee(employeeId)
    });
}

function toggleEmployeeCard(card) {
    card.classList.toggle('collapsed');
}