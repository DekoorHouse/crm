import { elements, state, app } from './state_admin.js';
import * as utils from './utils_admin.js';
import * as ui from './ui-manager_admin.js';
import * as services from './services_admin.js';
import * as charts from './charts_admin.js';

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

export function handleTabClick(tab) {
    elements.tabs.forEach(t => t.classList.remove('active'));
    elements.tabContents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
}

export function confirmDeleteAllData() {
    ui.showModal({
        title: "Confirmar Borrado Total",
        body: "<strong>¡Atención!</strong> Estás a punto de borrar TODOS los registros de gastos. Esta acción es irreversible. <br><br>¿Estás completamente seguro?",
        confirmText: "Sí, Borrar Todo",
        confirmClass: 'btn-danger',
        onConfirm: () => services.deleteAllData()
    });
}

export function confirmDeleteCurrentMonth() {
    ui.showModal({
        title: "Confirmar Borrado",
        body: "Vas a borrar todos los registros del mes actual. Esta acción no se puede deshacer. <br><br>¿Continuar?",
        confirmText: "Borrar Mes Actual",
        confirmClass: 'btn-danger',
        onConfirm: () => services.deleteCurrentMonthData()
    });
}

export function confirmDeletePreviousMonth() {
    ui.showModal({
        title: "Confirmar Borrado",
        body: "Vas a borrar todos los registros del mes anterior. Esta acción no se puede deshacer. <br><br>¿Continuar?",
        confirmText: "Borrar Mes Anterior",
        confirmClass: 'btn-danger',
        onConfirm: () => services.deletePreviousMonthData()
    });
}

export function confirmRemoveDuplicates() {
    ui.showModal({
        title: "Confirmar Eliminación de Duplicados",
        body: "El sistema buscará y eliminará registros duplicados basados en fecha, concepto y montos. Esta acción no se puede deshacer. <br><br>¿Deseas continuar?",
        confirmText: "Sí, Eliminar Duplicados",
        confirmClass: 'btn-danger',
        onConfirm: () => services.removeDuplicates()
    });
}

export function handleFilterChange() {
    app.renderData();
}

export function handleCategoryChange(e) {
    const select = e.target;
    const expenseId = select.dataset.expenseId;
    const newCategory = select.value;
    const expense = state.expenses.find(exp => exp.id === expenseId);
    if(expense) services.saveExpense({...expense, category: newCategory}, expense.category);
}

export function confirmDeleteExpense(id) {
    ui.showModal({
        title: "Confirmar Eliminación",
        body: "¿Estás seguro de que quieres borrar este registro único?",
        confirmText: "Eliminar",
        confirmClass: 'btn-danger',
        onConfirm: () => services.deleteExpense(id)
    });
}

export function handleModalClick(e) {
    if (e.target === elements.modal) {
        ui.showModal({ show: false });
    }
}

export function handleKeyDown(e) {
    if (elements.modal.classList.contains('visible')) {
        if (e.key === 'Escape') {
            e.preventDefault();
            elements.modalCancelBtn.click();
        }
        if (e.key === 'Enter' && !e.target.matches('textarea')) { 
            e.preventDefault();
            if (elements.modalConfirmBtn.style.display !== 'none') {
                elements.modalConfirmBtn.click();
            }
        }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        services.undoLastAction();
    }
}

export function openAddEmployeeModal() {
    ui.showModal({
        title: "Agregar Nuevo Empleado",
        body: `
            <form id="add-employee-form">
                <div class="form-group">
                    <label for="employee-name">Nombre del Empleado</label>
                    <input type="text" id="employee-name" class="modal-input" required>
                </div>
                 <div class="form-group">
                    <label for="employee-rate">Tarifa por Hora ($)</label>
                    <input type="number" id="employee-rate" class="modal-input" value="70" step="0.01" required>
                </div>
            </form>`,
        confirmText: 'Agregar',
        onConfirm: () => {
            const nameInput = document.getElementById('employee-name');
            const rateInput = document.getElementById('employee-rate');
            const name = nameInput.value.trim();
            const rate = parseFloat(rateInput.value);
            if (name && !isNaN(rate) && rate > 0) {
                services.addEmployee(name, rate);
            } else {
                alert("Por favor, ingresa un nombre y una tarifa válida.");
            }
        }
    });
}

export function confirmCloseWeek() {
    ui.showModal({
        title: "Confirmar Cierre de Semana",
        body: `
            <p>Estás a punto de cerrar la semana. Esto hará lo siguiente:</p>
            <ul>
                <li>- Guardará los pagos finales en el historial de cada empleado.</li>
                <li>- Registrará los pagos como gastos en la pestaña de 'Datos'.</li>
                <li>- Reiniciará las horas, bonos y descuentos para la nueva semana.</li>
            </ul>
            <p><strong>Esta acción no se puede deshacer.</strong> ¿Continuar?</p>`,
        confirmText: 'Sí, Cerrar Semana',
        confirmClass: 'btn-success',
        onConfirm: () => services.closeWeek()
    });
}

export function confirmDeleteSueldosData() {
    ui.showModal({
        title: "Confirmar Eliminación Total",
        body: "¿Estás seguro de que quieres borrar TODOS los datos de sueldos? Esto incluye empleados, registros, bonos y gastos. Esta acción es irreversible.",
        confirmText: "Sí, Borrar Todo",
        confirmClass: "btn-danger",
        onConfirm: () => services.deleteSueldosData()
    });
}

export function sendWhatsAppMessage(employee) {
    const message = utils.generateWhatsAppMessage(employee);
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
}

export function updateSchedule(cell) {
    const employeeId = cell.closest('.employee-card').dataset.employeeId;
    const type = cell.dataset.type;
    const day = cell.closest('tr').querySelector('td:first-child').textContent;
    const value = cell.textContent;
    services.updateEmployeeTime(employeeId, day, type, value);
}

export function updateEmployeeRate(employeeId, newRate) {
    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (employee && !isNaN(newRate) && newRate >= 0) {
        services.updateEmployeeField(employeeId, 'ratePerHour', newRate);
    } else if (employee) {
        const rateInput = document.querySelector(`.employee-card[data-employee-id="${employeeId}"] .hourly-rate-input`);
        if(rateInput) rateInput.value = employee.ratePerHour || 70;
    }
}

export function confirmDeleteAdjustment(empId, adjId, type) {
    ui.showModal({
        title: "Confirmar Eliminación",
        body: `¿Estás seguro de que quieres eliminar este ${type === 'bono' ? 'bono' : 'gasto'}?`,
        confirmText: "Eliminar",
        confirmClass: "btn-danger",
        onConfirm: () => services.deleteAdjustment(empId, type, parseInt(adjId))
    });
}

export function toggleEmployeeCard(card) {
    card.classList.toggle('collapsed');
    const isCollapsed = card.classList.contains('collapsed');
    const button = card.querySelector('.toggle-details-btn');
    if (button) {
        button.setAttribute('aria-expanded', !isCollapsed);
    }
}

export function handleLeadsChartToggle(e) {
    const button = e.target.closest('button');
    if (button && !button.classList.contains('active')) {
        elements.leadsChartToggle.querySelector('.active').classList.remove('active');
        button.classList.add('active');
        state.financials.leadsChartTimeframe = button.dataset.timeframe;
        charts.updateLeadsTrendChart();
    }
}

export function resetSueldosFilter() {
    if (app.sueldosPicker) {
        app.sueldosPicker.clearSelection();
    }
}

export function resetHealthFilter() {
     if (app.healthPicker) {
        app.healthPicker.clearSelection();
    }
}

