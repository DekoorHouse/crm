import { elements, state } from './state.js';
import * as utils from './utils.js';
import * as ui from './ui-manager.js';
import * as services from './services.js';
import * as charts from './charts.js';
import { classifyForImport, computeFileHash, generateImportBatchId, calculateExpectedBalance, reconcileBalance, detectBBVAHeader } from './bbva-parser.js';
import { isTestMode } from './config.js';

/**
 * Verifica que la librería XLSX (SheetJS) esté disponible en `window.XLSX`.
 * Si no, muestra un modal con diagnóstico claro y devuelve false.
 *
 * Este guard se ejecuta al inicio de TODA función que use XLSX: handleFileUpload
 * (carga normal), handleFileUpload con dry-run, y handleSueldosFileUpload.
 */
function ensureXLSXLoaded() {
    if (typeof XLSX !== 'undefined' && XLSX && typeof XLSX.read === 'function') {
        return true;
    }
    ui.showModal({
        title: 'Falta la librería XLSX',
        body: `<p>No se pudo cargar <code>js/vendor/xlsx.full.min.js</code>. Sin esa librería el sistema no puede leer archivos Excel.</p>
               <p><strong>Pasos para corregir:</strong></p>
               <ol style="margin-left:18px;font-size:13px;">
                   <li>Verifica que el archivo existe abriendo
                       <code>${location.origin}/admon/js/vendor/xlsx.full.min.js</code>
                       en una pestaña nueva. Debe mostrar código JavaScript empezando con <code>/*! xlsx.js</code>.</li>
                   <li>Si responde 404, falta subir el archivo al servidor. Revisa que la carpeta
                       <code>public/admon/js/vendor/</code> esté en el repo y desplegada.</li>
                   <li>Recarga la página con <kbd>Ctrl+Shift+R</kbd> (hard reload) para evitar caché.</li>
                   <li>Abre la consola del navegador (F12). Deberías ver el mensaje
                       <em>"[admon] Dependencias críticas OK: XLSX, Chart"</em>. Si no, la librería
                       no cargó.</li>
               </ol>`,
        confirmText: 'Cerrar',
        showCancel: false
    });
    return false;
}

/**
 * @file Módulo de manejadores de eventos.
 * @description Conecta las interacciones del usuario en la UI con la lógica de la aplicación
 * definida en otros módulos.
 */

/**
 * Persiste un lote ya clasificado en Firestore y muestra el flujo de
 * post-importación (revisión de omitidos + modal de éxito).
 *
 * Esta función centraliza el "qué hacer después de clasificar", para que
 * tanto el flujo normal como la promoción desde Vista Previa (dry-run →
 * "Importar este archivo") la puedan reusar sin duplicar código.
 *
 * @param {{ newUnique:Array, intraFileDuplicates:Array, existingExact:Array, suspectRepeated:Array, importMeta:object }} classified
 */
async function persistClassifiedImport(classified) {
    const { newUnique, intraFileDuplicates, existingExact, suspectRepeated, importMeta } = classified;

    // newUnique ya incluye los `suspect_repeated` (se importan, pero marcados
    // para que el panel de Conciliación los pueda listar).
    if (newUnique.length > 0) {
        await services.saveBulkExpenses(newUnique);
    }

    const totalSkipped = intraFileDuplicates.length + existingExact.length;

    if (totalSkipped > 0 || suspectRepeated.length > 0) {
        ui.showOmittedReviewModal({
            importedCount: newUnique.length,
            suspectCount: suspectRepeated.length,
            skippedIntraFile: intraFileDuplicates,
            skippedExisting: existingExact,
            suspectRepeated,
            importMeta,
            onConfirm: async (selectedExpenses) => {
                if (selectedExpenses.length > 0) {
                    // Marcamos los confirmados manualmente como `confirmed_real`
                    // para que la limpieza automática no los borre.
                    selectedExpenses.forEach(exp => { exp.duplicateStatus = 'confirmed_real'; });
                    await services.saveBulkExpenses(selectedExpenses);
                }
                const totalImported = newUnique.length + selectedExpenses.length;
                const discarded = totalSkipped - selectedExpenses.length;
                ui.showModal({
                    title: 'Importación completada',
                    body:
                        `<p><strong>${totalImported}</strong> movimiento${totalImported !== 1 ? 's' : ''} importado${totalImported !== 1 ? 's' : ''} en total.</p>` +
                        (selectedExpenses.length > 0
                            ? `<p>Incluyendo <strong>${selectedExpenses.length}</strong> confirmado${selectedExpenses.length !== 1 ? 's' : ''} de los sospechosos.</p>` : '') +
                        (suspectRepeated.length > 0
                            ? `<p><strong>${suspectRepeated.length}</strong> marcado${suspectRepeated.length !== 1 ? 's' : ''} como "posible repetido real" — se importaron pero quedan para revisión en Conciliación.</p>` : '') +
                        (discarded > 0
                            ? `<p><strong>${discarded}</strong> descartado${discarded !== 1 ? 's' : ''}.</p>` : ''),
                    confirmText: 'Entendido',
                    showCancel: false
                });
            }
        });
    } else {
        ui.showModal({
            title: newUnique.length > 0 ? 'Importación completada' : 'Sin registros nuevos',
            body: newUnique.length > 0
                ? `<p><strong>${newUnique.length}</strong> movimiento${newUnique.length !== 1 ? 's' : ''} nuevo${newUnique.length !== 1 ? 's' : ''} importado${newUnique.length !== 1 ? 's' : ''}.</p>`
                : '<p>No se encontraron registros válidos en el archivo.</p>',
            confirmText: 'Entendido',
            showCancel: false
        });
    }
}

/**
 * Procesa el archivo de gastos (.xls o .xlsx) cargado por el usuario.
 *
 * Flujo nuevo (auditable y conservador):
 *   1. Calculamos un fingerprint SHA-256 del archivo y un id de lote.
 *   2. Parseamos las filas con detección dinámica de encabezados (utils.parseExpensesData).
 *   3. Clasificamos los movimientos en 4 grupos con `classifyForImport`:
 *        - newUnique           → importar directo
 *        - intraFileDuplicates → mostrar como sospechosos del mismo archivo
 *        - existingExact       → mostrar como ya existentes en DB
 *        - suspectRepeated     → se importan, pero marcados para revisión
 *   4. Sólo los movimientos del grupo 1 (+ los sospechosos repetidos) se
 *      guardan automáticamente. Los grupos 2 y 3 se muestran al usuario
 *      para que decida si los agrega o los descarta.
 *   5. Si options.dryRun=true: NO persiste; muestra Vista previa con opción
 *      de "Importar este archivo" (que entonces sí llama a persistClassifiedImport).
 *
 * @param {Event} e
 * @param {{ dryRun?:boolean }} [options]
 */
async function handleFileUpload(e, options = {}) {
    const file = e.target.files[0];
    if (!file) return;
    const dryRun = !!options.dryRun;

    // Guard de dependencias: si XLSX no cargó, abortar con mensaje claro.
    if (!ensureXLSXLoaded()) {
        e.target.value = '';
        return;
    }

    ui.showModal({
        title: dryRun ? "Analizando archivo (sin guardar)..." : "Procesando Archivo...",
        body: '<p><i class="fas fa-spinner fa-spin"></i> Por favor, espera mientras se leen los datos del archivo.</p>',
        showConfirm: false,
        showCancel: false
    });

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const arrayBuffer = event.target.result;
            const data = new Uint8Array(arrayBuffer);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            if (jsonData.length === 0) {
                throw new Error("El archivo Excel está vacío o no tiene el formato correcto.");
            }

            // Metadata del lote — necesaria para auditoría y para que la
            // función `removeDuplicates` segura pueda agrupar movimientos
            // del mismo archivo.
            const sourceFileHash = await computeFileHash(arrayBuffer);
            const importBatchId = generateImportBatchId();
            const importedAt = Date.now();
            const sourceFileExt = (file.name.split('.').pop() || 'xls').toLowerCase();
            const importMeta = {
                sourceFileName: file.name,
                sourceFileHash,
                importBatchId,
                importedAt,
                sourceFileExt
            };

            // Detección de encabezados (la usamos también para el reporte de dry-run)
            const headerInfo = detectBBVAHeader(jsonData);
            const newExpenses = utils.parseExpensesData(jsonData, importMeta);
            if (newExpenses.length === 0) {
                ui.showModal({
                    title: 'Sin Datos Válidos',
                    body: 'No se encontraron registros válidos en el archivo. Revisa que tenga columnas Fecha/Concepto/Cargo/Abono.',
                    confirmText: 'Entendido',
                    showCancel: false
                });
                return;
            }

            // Clasificación con firmas estricta+suave. Esto es lo que decide
            // qué se importa automático y qué se muestra al usuario.
            const { newUnique, intraFileDuplicates, existingExact, suspectRepeated } =
                classifyForImport(newExpenses, state.expenses);

            // ============================================================
            //  DRY-RUN: NO se persiste nada. El usuario puede pulsar
            //  "Importar este archivo" dentro del modal para promover el
            //  resultado a una importación real, usando los mismos
            //  movimientos ya clasificados (sin re-parsear el XLS).
            // ============================================================
            if (dryRun) {
                ui.showDryRunReportModal({
                    file,
                    headerInfo,
                    totalParsedRows: newExpenses.length,
                    newUnique,
                    intraFileDuplicates,
                    existingExact,
                    suspectRepeated,
                    importMeta,
                    calculateExpectedBalance,
                    reconcileBalance,
                    getExpenses: () => state.expenses,
                    onImport: async (classified) => {
                        ui.showModal({ show: false });
                        await persistClassifiedImport(classified);
                    }
                });
                return;
            }

            await persistClassifiedImport({ newUnique, intraFileDuplicates, existingExact, suspectRepeated, importMeta });

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
    reader.onerror = () => {
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

    if (!ensureXLSXLoaded()) {
        e.target.value = '';
        return;
    }

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

    // Botones de Conciliación y limpieza de duplicados exactos. Si no existen
    // en el HTML (versión vieja) simplemente se ignoran — no rompe nada.
    const reconcileBtn = document.getElementById('reconcile-btn');
    if (reconcileBtn) reconcileBtn.addEventListener('click', openReconciliation);
    const removeDupsBtn = document.getElementById('remove-duplicates-btn');
    if (removeDupsBtn) removeDupsBtn.addEventListener('click', confirmRemoveDuplicates);

    // Vista previa sin guardar (dry-run). Usa un input separado para no
    // interferir con el flujo normal; al elegir un XLS dispara el mismo
    // parser+clasificador pero NO llama a Firestore.
    const dryRunBtn = document.getElementById('dry-run-btn');
    const dryRunInput = document.getElementById('dry-run-input');
    if (dryRunBtn && dryRunInput) {
        dryRunBtn.addEventListener('click', () => dryRunInput.click());
        dryRunInput.addEventListener('change', (ev) => handleFileUpload(ev, { dryRun: true }));
    }

    // Exportar KPIs a Excel (3 hojas: Diarios + Mensual + Por Cuenta).
    // El boton vive en la pestana KPI's al lado de "Sincronizar con Meta".
    const exportKpisBtn = document.getElementById('export-kpis-btn');
    if (exportKpisBtn) exportKpisBtn.addEventListener('click', handleExportKpis);

    // Modal de reglas de categorizacion (keyword -> categoria, editable).
    const rulesBtn = document.getElementById('rules-btn');
    if (rulesBtn) rulesBtn.addEventListener('click', () => ui.openRulesModal());

    // Pestaña Campañas: calcular reporte + configurar regiones.
    const campCalcBtn = document.getElementById('camp-calc-btn');
    if (campCalcBtn) campCalcBtn.addEventListener('click', loadCampaignsReport);
    const campRegionsBtn = document.getElementById('camp-regions-btn');
    if (campRegionsBtn) campRegionsBtn.addEventListener('click', () => ui.openRegionsModal({ onSaved: loadCampaignsReport }));
    const campExportBtn = document.getElementById('camp-export-btn');
    if (campExportBtn) campExportBtn.addEventListener('click', handleExportCampaigns);

    // Toggle de modo prueba (banner + botón). Lo conecta `ui-manager.js`
    // al renderizar el banner; nada que hacer aquí.
    
    elements.tabs.forEach(tab => tab.addEventListener('click', () => handleTabClick(tab)));
    elements.addManualBtn.addEventListener('click', () => ui.openExpenseModal());
    elements.deleteCurrentMonthBtn.addEventListener('click', confirmDeleteCurrentMonth);
    elements.deletePreviousMonthBtn.addEventListener('click', confirmDeletePreviousMonth);
    elements.exportBtn.addEventListener('click', exportToExcel);
    elements.categoryFilter.addEventListener('change', handleFilterChange);

    // Custom dropdown picker para filtro Categoría
    const categoryFilterBtn = document.getElementById('category-filter-btn');
    const categoryPickerModal = document.getElementById('category-picker-modal');
    const categoryPickerClose = document.getElementById('category-picker-close');
    const categoryPickerList = document.getElementById('category-picker-list');

    if (categoryFilterBtn) {
        categoryFilterBtn.addEventListener('click', () => ui.openCategoryPicker());
    }
    if (categoryPickerClose) {
        categoryPickerClose.addEventListener('click', () => ui.closeCategoryPicker());
    }
    if (categoryPickerModal) {
        categoryPickerModal.addEventListener('click', (e) => {
            if (e.target === categoryPickerModal) ui.closeCategoryPicker();
        });
    }
    if (categoryPickerList) {
        categoryPickerList.addEventListener('click', (e) => {
            const item = e.target.closest('.custom-picker-item');
            if (!item) return;
            const value = item.dataset.value;
            if (value === '__add_new_category__') {
                // Cierra picker y dispara el flujo de "nueva categoría" del select original
                ui.closeCategoryPicker();
                elements.categoryFilter.value = '__add_new_category__';
                elements.categoryFilter.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }
            elements.categoryFilter.value = value;
            elements.categoryFilter.dispatchEvent(new Event('change', { bubbles: true }));
            ui.syncCategoryPickerUI();
            ui.closeCategoryPicker();
        });
    }
    
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
        if (!card) return;
        // Caso especial: la tarjeta "Saldo BBVA Estimado" abre el modal de
        // configuración del saldo inicial de ajuste, NO el detalle de
        // categoría (no es una categoría).
        if (card.dataset.category === 'SaldoBBVAEstimado') {
            ui.openBalanceConfigModal();
            return;
        }
        ui.showCategoryDetailsModal(card.dataset.category, utils.getFilteredExpenses);
    });

    // Sueldos period toggle
    elements.sueldosPeriodToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-period]');
        if (!btn || btn.classList.contains('active')) return;
        elements.sueldosPeriodToggle.querySelectorAll('button').forEach(b => {
            b.classList.remove('active');
            b.classList.add('btn-outline');
        });
        btn.classList.add('active');
        btn.classList.remove('btn-outline');
        state.sueldosPeriod = btn.dataset.period;
        ui.renderSueldosData();
    });

    // Sueldos adjustments (bono/descuento) + vacaciones + detalle
    elements.sueldosTableContainer.addEventListener('click', async (e) => {
        const addBtn = e.target.closest('.sueldos-adj-add-btn');
        if (addBtn) {
            ui.openSueldosAdjModal(addBtn.dataset.name);
            return;
        }
        const delBtn = e.target.closest('.sueldos-adj-delete-btn');
        if (delBtn) {
            const docId = delBtn.dataset.docId;
            try {
                await services.deleteChecadorAdjustment(docId);
                ui.showToast('Ajuste eliminado', 'success');
            } catch (err) {
                console.error(err);
                ui.showToast('No se pudo eliminar el ajuste', 'error');
            }
            return;
        }
        const vacBtn = e.target.closest('.sueldos-vac-btn');
        if (vacBtn) {
            ui.openSueldosVacModal(vacBtn.dataset.name);
            return;
        }
        const detailBtn = e.target.closest('.sueldos-detail-btn');
        if (detailBtn) {
            ui.openSueldosDetailModal(detailBtn.dataset.name);
        }
    });

    // Modal de detalle (ver registros por día)
    if (elements.sueldosDetailModalClose) {
        elements.sueldosDetailModalClose.addEventListener('click', () => ui.closeSueldosDetailModal());
    }
    if (elements.sueldosDetailModal) {
        elements.sueldosDetailModal.addEventListener('click', (e) => {
            if (e.target.id === 'sueldos-detail-modal') ui.closeSueldosDetailModal();
        });
    }
    if (elements.sueldosDetailBody) {
        elements.sueldosDetailBody.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.sueldos-edit-day-btn');
            if (editBtn) {
                const date = editBtn.dataset.date;
                const name = state.sueldosDetailCurrentName;
                ui.requirePinThen(() => ui.openSueldosEditLogModal(name, date));
                return;
            }
            const addBtn = e.target.closest('.sueldos-add-day-btn');
            if (addBtn) {
                const name = state.sueldosDetailCurrentName;
                ui.requirePinThen(() => ui.openSueldosEditLogModal(name, ''));
            }
        });
    }

    // PIN modal
    if (elements.sueldosPinCancel) {
        elements.sueldosPinCancel.addEventListener('click', () => ui.closeSueldosPinModal());
    }
    if (elements.sueldosPinConfirm) {
        elements.sueldosPinConfirm.addEventListener('click', () => ui.tryConfirmPin());
    }
    if (elements.sueldosPinInput) {
        elements.sueldosPinInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); ui.tryConfirmPin(); }
            if (e.key === 'Escape') ui.closeSueldosPinModal();
        });
    }
    if (elements.sueldosPinModal) {
        elements.sueldosPinModal.addEventListener('click', (e) => {
            if (e.target.id === 'sueldos-pin-modal') ui.closeSueldosPinModal();
        });
    }

    // Modal de editar registros
    if (elements.sueldosEditLogClose) {
        elements.sueldosEditLogClose.addEventListener('click', () => ui.closeSueldosEditLogModal());
    }
    if (elements.sueldosEditLogModal) {
        elements.sueldosEditLogModal.addEventListener('click', (e) => {
            if (e.target.id === 'sueldos-edit-log-modal') ui.closeSueldosEditLogModal();
        });
    }
    if (elements.sueldosAddLogIn) {
        elements.sueldosAddLogIn.addEventListener('click', () => ui.addSueldosLogEntry('IN'));
    }
    if (elements.sueldosAddLogOut) {
        elements.sueldosAddLogOut.addEventListener('click', () => ui.addSueldosLogEntry('OUT'));
    }
    if (elements.sueldosEditLogEntries) {
        elements.sueldosEditLogEntries.addEventListener('input', (e) => {
            const inp = e.target.closest('.sueldos-log-time-input');
            if (inp) {
                const idx = parseInt(inp.dataset.idx);
                if (!isNaN(idx) && state.sueldosEditLogEntries[idx]) {
                    state.sueldosEditLogEntries[idx].time = inp.value;
                }
            }
        });
        elements.sueldosEditLogEntries.addEventListener('click', (e) => {
            const delBtn = e.target.closest('.sueldos-log-del-btn');
            if (delBtn) {
                const idx = parseInt(delBtn.dataset.idx);
                if (!isNaN(idx) && state.sueldosEditLogEntries[idx]) {
                    state.sueldosEditLogEntries[idx].isDeleted = true;
                    ui.renderSueldosEditLogEntries();
                }
            }
        });
    }
    if (elements.sueldosSaveEditLog) {
        elements.sueldosSaveEditLog.addEventListener('click', async () => {
            const btn = elements.sueldosSaveEditLog;
            const orig = btn.textContent;
            btn.disabled = true; btn.textContent = 'Guardando...';
            try {
                await services.saveChecadorLogEntries({
                    name: state.sueldosEditLogName,
                    empId: state.sueldosEditLogEmpId,
                    date: state.sueldosEditLogDate,
                    entries: state.sueldosEditLogEntries
                });
                ui.showToast('Registros guardados', 'success');
                ui.closeSueldosEditLogModal();
                // El listener en tiempo real refresca la tabla y el detalle si sigue abierto
                if (elements.sueldosDetailModal && elements.sueldosDetailModal.style.display === 'flex') {
                    ui.renderSueldosDetailBody();
                }
            } catch (err) {
                console.error(err);
                ui.showToast('No se pudieron guardar los cambios', 'error');
            } finally {
                btn.disabled = false; btn.textContent = orig;
            }
        });
    }

    // Vacaciones modal listeners
    if (elements.sueldosVacModalClose) {
        elements.sueldosVacModalClose.addEventListener('click', () => ui.closeSueldosVacModal());
    }
    if (elements.sueldosVacModal) {
        elements.sueldosVacModal.addEventListener('click', (e) => {
            if (e.target.id === 'sueldos-vac-modal') ui.closeSueldosVacModal();
        });
    }
    if (elements.sueldosVacSaveBtn) {
        elements.sueldosVacSaveBtn.addEventListener('click', async () => {
            const desde = elements.sueldosVacDesde.value;
            const hasta = elements.sueldosVacHasta.value;
            if (!desde || !hasta) { ui.showToast('Selecciona ambas fechas', 'error'); return; }
            if (hasta < desde) { ui.showToast('La fecha fin debe ser igual o posterior al inicio', 'error'); return; }
            const btn = elements.sueldosVacSaveBtn;
            const orig = btn.textContent;
            btn.disabled = true; btn.textContent = 'Guardando...';
            try {
                await services.saveEmployeeVacation(state.sueldosVacCurrentDocId, desde, hasta);
                ui.showToast('Vacaciones guardadas 🏖', 'success');
                ui.closeSueldosVacModal();
            } catch (err) {
                console.error(err);
                ui.showToast('No se pudo guardar', 'error');
            } finally {
                btn.disabled = false; btn.textContent = orig;
            }
        });
    }
    if (elements.sueldosVacRemoveBtn) {
        elements.sueldosVacRemoveBtn.addEventListener('click', async () => {
            const btn = elements.sueldosVacRemoveBtn;
            const orig = btn.textContent;
            btn.disabled = true; btn.textContent = 'Quitando...';
            try {
                await services.removeEmployeeVacation(state.sueldosVacCurrentDocId);
                ui.showToast('Vacaciones removidas', 'success');
                ui.closeSueldosVacModal();
            } catch (err) {
                console.error(err);
                ui.showToast('No se pudo quitar', 'error');
            } finally {
                btn.disabled = false; btn.textContent = orig;
            }
        });
    }

    if (elements.sueldosAdjModalClose) {
        elements.sueldosAdjModalClose.addEventListener('click', () => ui.closeSueldosAdjModal());
    }
    if (elements.sueldosAdjModal) {
        elements.sueldosAdjModal.addEventListener('click', (e) => {
            if (e.target.id === 'sueldos-adj-modal') ui.closeSueldosAdjModal();
        });
    }
    elements.sueldosAdjTypeBtns?.forEach(btn => {
        btn.addEventListener('click', () => {
            state.sueldosAdjCurrentType = btn.dataset.type;
            ui.updateSueldosAdjTypeButtons();
        });
    });
    if (elements.sueldosAdjExisting) {
        elements.sueldosAdjExisting.addEventListener('click', async (e) => {
            const delBtn = e.target.closest('.sueldos-adj-modal-delete-btn');
            if (!delBtn) return;
            const docId = delBtn.dataset.docId;
            try {
                await services.deleteChecadorAdjustment(docId);
                ui.showToast('Ajuste eliminado', 'success');
                ui.renderSueldosAdjExisting();
            } catch (err) {
                console.error(err);
                ui.showToast('No se pudo eliminar el ajuste', 'error');
            }
        });
    }
    if (elements.sueldosAdjSaveBtn) {
        elements.sueldosAdjSaveBtn.addEventListener('click', async () => {
            const amount = parseInt(elements.sueldosAdjAmount.value, 10);
            const concept = elements.sueldosAdjConcept.value.trim();
            if (!amount || amount <= 0) {
                ui.showToast('Ingresa un monto válido', 'error');
                return;
            }
            const btn = elements.sueldosAdjSaveBtn;
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Guardando...';
            try {
                await services.saveChecadorAdjustment({
                    name: state.sueldosAdjCurrentName,
                    type: state.sueldosAdjCurrentType,
                    amount,
                    concept
                });
                const label = state.sueldosAdjCurrentType === 'bono' ? 'Bono' : 'Descuento';
                ui.showToast(`${label} de $${amount} agregado`, 'success');
                elements.sueldosAdjAmount.value = '';
                elements.sueldosAdjConcept.value = '';
                ui.renderSueldosAdjExisting();
            } catch (err) {
                console.error(err);
                ui.showToast('No se pudo guardar el ajuste', 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });
    }

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

    // Filtro de mes en KPIs
    if (elements.kpiMonthFilter) {
        elements.kpiMonthFilter.addEventListener('change', (e) => ui.changeKpiMonth(e.target.value));
    }
    if (elements.kpiMonthPrev) {
        elements.kpiMonthPrev.addEventListener('click', () => ui.shiftKpiMonth(-1));
    }
    if (elements.kpiMonthNext) {
        elements.kpiMonthNext.addEventListener('click', () => ui.shiftKpiMonth(1));
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

    // Auto-refresh de Meta al abrir la pestaña KPIs (rate-limited a 5 min)
    if (tab.dataset.tab === 'kpis') {
        const last = parseInt(localStorage.getItem('lastMetaSyncTs') || '0', 10);
        if (Date.now() - last > 5 * 60 * 1000) {
            localStorage.setItem('lastMetaSyncTs', String(Date.now()));
            services.autoSyncMetaKpis().catch(() => {});
        }
    }

    // Pestaña Campañas: sembrar fechas (últimos 30 días) y cargar una vez.
    if (tab.dataset.tab === 'campaigns') {
        const fromEl = document.getElementById('camp-date-from');
        const toEl = document.getElementById('camp-date-to');
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (fromEl && toEl && (!fromEl.value || !toEl.value)) {
            const today = new Date();
            fromEl.value = fmt(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000));
            toEl.value = fmt(today);
        }
        if (!_campaignsLoadedOnce) { _campaignsLoadedOnce = true; loadCampaignsReport(); }
    }
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

// (Fase A.4 — 2026-05-15) Función `confirmDeleteAllData()` eliminada por
// huérfana: no estaba conectada a ningún botón de UI y además llamaba a
// `services.deleteAllData()` que tampoco existe. Riesgo de uso accidental
// desde la consola del navegador.

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

/**
 * Pide confirmación y dispara el barrido seguro de duplicados.
 * "Seguro" significa: SOLO se borran movimientos con la misma firma estricta
 * (fecha + concepto completo + montos), conservando el primero. No se tocan
 * los que sólo comparten la firma suave (mismo comercio, mismo monto, misma
 * fecha) porque pueden ser pagos reales separados — esos se reportan al
 * usuario por separado.
 */
function confirmRemoveDuplicates() {
    ui.showModal({
        title: "Buscar y eliminar duplicados exactos",
        body:
            "<p>El sistema busca movimientos con <strong>firma estricta idéntica</strong> " +
            "(misma fecha, mismo concepto exacto, mismo cargo y mismo abono) y conserva " +
            "sólo el primero de cada grupo.</p>" +
            "<p style='color:var(--text-secondary); font-size:13px;'>Los movimientos que sólo coinciden por fecha/comercio/monto " +
            "(mismo softSignature pero AUT/RFC distinto) NO se borran — se consideran " +
            "pagos reales separados. Para revisarlos usa el panel de Conciliación.</p>" +
            "<p><strong>Esta acción no se puede deshacer.</strong> ¿Continuar?</p>",
        confirmText: "Sí, Eliminar Duplicados Exactos",
        confirmClass: 'btn-danger',
        onConfirm: async () => {
            try {
                const deleted = await services.removeDuplicates();
                ui.showModal({
                    title: 'Listo',
                    body: deleted > 0
                        ? `<p>Se eliminaron <strong>${deleted}</strong> movimientos duplicados exactos.</p>`
                        : '<p>No se encontraron duplicados exactos. Tu cuenta ya está limpia.</p>',
                    confirmText: 'Entendido',
                    showCancel: false
                });
            } catch (err) {
                console.error('removeDuplicates error', err);
                ui.showModal({
                    title: 'Error',
                    body: `<p>No se pudieron eliminar los duplicados: ${err.message}</p>`,
                    confirmText: 'Cerrar',
                    showCancel: false
                });
            }
        }
    });
}

// ============================================================================
//  Exportación de KPIs a Excel
// ============================================================================

/**
 * Mapping de account IDs (limpios) a etiquetas legibles.
 * Mantenerlo aquí en lugar de Firestore por simplicidad. Si más adelante
 * necesitas configurarlo desde UI, mover a Firestore meta_ads_config.
 */
const KPI_ACCOUNT_LABELS = {
    '3508971206028730': 'Cuenta 1',
    '673591711813934':  'Cuenta 2',
    '523786137191565':  'Cuenta 3',
    '674668798389910':  'Cuenta 4',
    '1890131678412987': 'Cuenta 5',
    '1396578534439909': 'Dekoor Advance'
};

/**
 * Genera y descarga un reporte XLSX con todos los datos históricos de KPIs.
 *
 * Hojas:
 *   1. "KPIs Diarios"    — una fila por día con métricas básicas + breakdown por cuenta.
 *   2. "Resumen Mensual" — agregado por mes.
 *   3. "Por Cuenta Meta" — suma total por cada cuenta.
 *
 * Lee directamente:
 *   - Colección 'pedidos' (todos) para leads/pagados/ingresos/cancelados.
 *   - state.kpis (ya cargado por listener) para costo_publicidad y breakdown.
 */
async function handleExportKpis() {
    if (!ensureXLSXLoaded()) return;

    ui.showModal({
        title: 'Generando reporte...',
        body: '<p><i class="fas fa-spinner fa-spin"></i> Leyendo pedidos y KPIs. Esto puede tardar unos segundos.</p>',
        showConfirm: false,
        showCancel: false
    });

    try {
        // 1. Leer todos los pedidos (no sólo el mes actual)
        const allPedidos = await services.fetchAllPedidos();

        // 2. state.kpis ya tiene todos los daily_kpis (via listenForKpis)
        const allKpis = state.kpis || [];

        // 3. Indexar pedidos por fecha (formato YYYY-MM-DD UTC)
        const pedidosByDate = {};
        for (const p of allPedidos) {
            if (!p.createdAt || typeof p.createdAt.toDate !== 'function') continue;
            const d = p.createdAt.toDate();
            const fecha = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
            if (!pedidosByDate[fecha]) pedidosByDate[fecha] = { leads: 0, paid: 0, cancelled: 0, revenue: 0 };
            pedidosByDate[fecha].leads++;
            if (p.estatus === 'Pagado' || p.estatus === 'Fabricar') {
                pedidosByDate[fecha].paid++;
                pedidosByDate[fecha].revenue += parseFloat(p.precio) || 0;
            }
            if (p.estatus === 'Cancelado') {
                pedidosByDate[fecha].cancelled++;
            }
        }

        // 4. Indexar daily_kpis por fecha
        const kpisByDate = {};
        for (const k of allKpis) {
            if (k && k.fecha) kpisByDate[k.fecha] = k;
        }

        const ACCOUNT_IDS = Object.keys(KPI_ACCOUNT_LABELS);
        const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

        // 5. Unir todas las fechas (de pedidos y de daily_kpis) y ordenar
        const allDatesSet = new Set([...Object.keys(pedidosByDate), ...Object.keys(kpisByDate)]);
        const sortedDates = [...allDatesSet].filter(Boolean).sort();

        // 6. Hoja 1 — KPIs Diarios
        const dailyRows = sortedDates.map(fecha => {
            const orders = pedidosByDate[fecha] || { leads: 0, paid: 0, cancelled: 0, revenue: 0 };
            const kpi = kpisByDate[fecha] || {};
            const breakdown = kpi.costo_publicidad_breakdown || {};
            const costo = parseFloat(kpi.costo_publicidad) || 0;

            const row = {
                'Fecha':              fecha,
                'Leads':              orders.leads,
                'Leads Pagados':      orders.paid,
                'Cancelados':         orders.cancelled,
                'Ingresos ($)':       round2(orders.revenue),
                'Costo Publicidad ($)': round2(costo),
                'CPL ($)':            orders.leads > 0 ? round2(costo / orders.leads) : 0,
                'CPV ($)':            orders.paid  > 0 ? round2(costo / orders.paid)  : 0,
                'Tasa Cierre (%)':    orders.leads > 0 ? round2((orders.paid / orders.leads) * 100) : 0,
            };
            for (const accId of ACCOUNT_IDS) {
                row[`Spend ${KPI_ACCOUNT_LABELS[accId]} ($)`] = round2(breakdown[accId] || 0);
            }
            return row;
        });

        // 7. Hoja 2 — Resumen Mensual
        const monthlyMap = {};
        for (const r of dailyRows) {
            const mes = r['Fecha'].slice(0, 7);
            if (!monthlyMap[mes]) {
                monthlyMap[mes] = { Mes: mes, Leads: 0, 'Leads Pagados': 0, Cancelados: 0, 'Ingresos ($)': 0, 'Costo Publicidad ($)': 0 };
            }
            monthlyMap[mes]['Leads']               += r['Leads'];
            monthlyMap[mes]['Leads Pagados']       += r['Leads Pagados'];
            monthlyMap[mes]['Cancelados']          += r['Cancelados'];
            monthlyMap[mes]['Ingresos ($)']        += r['Ingresos ($)'];
            monthlyMap[mes]['Costo Publicidad ($)'] += r['Costo Publicidad ($)'];
        }
        const monthlyRows = Object.values(monthlyMap)
            .sort((a, b) => a.Mes.localeCompare(b.Mes))
            .map(m => ({
                'Mes':                  m.Mes,
                'Leads':                m['Leads'],
                'Leads Pagados':        m['Leads Pagados'],
                'Cancelados':           m['Cancelados'],
                'Ingresos ($)':         round2(m['Ingresos ($)']),
                'Costo Publicidad ($)': round2(m['Costo Publicidad ($)']),
                'CPL ($)':              m['Leads']         > 0 ? round2(m['Costo Publicidad ($)'] / m['Leads'])         : 0,
                'CPV ($)':              m['Leads Pagados'] > 0 ? round2(m['Costo Publicidad ($)'] / m['Leads Pagados']) : 0,
                'Tasa Cierre (%)':      m['Leads']         > 0 ? round2((m['Leads Pagados'] / m['Leads']) * 100)        : 0,
            }));

        // 8. Hoja 3 — Por Cuenta Meta
        const accountTotals = {};
        for (const accId of ACCOUNT_IDS) accountTotals[accId] = 0;
        for (const r of dailyRows) {
            for (const accId of ACCOUNT_IDS) {
                accountTotals[accId] += r[`Spend ${KPI_ACCOUNT_LABELS[accId]} ($)`] || 0;
            }
        }
        const totalSpend = Object.values(accountTotals).reduce((s, v) => s + v, 0);
        const accountRows = ACCOUNT_IDS.map(accId => ({
            'Account ID':      accId,
            'Etiqueta':        KPI_ACCOUNT_LABELS[accId],
            'Spend Total ($)': round2(accountTotals[accId]),
            '% del Total':     totalSpend > 0 ? round2((accountTotals[accId] / totalSpend) * 100) : 0
        }));
        accountRows.push({
            'Account ID':      '',
            'Etiqueta':        'TOTAL',
            'Spend Total ($)': round2(totalSpend),
            '% del Total':     100
        });

        // 9. Generar libro Excel y descargar
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows),   'KPIs Diarios');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlyRows), 'Resumen Mensual');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(accountRows), 'Por Cuenta Meta');

        const dateFrom = sortedDates[0] || 'inicio';
        const dateTo   = sortedDates[sortedDates.length - 1] || 'hoy';
        const filename = `KPIs_${dateFrom}_a_${dateTo}.xlsx`;
        XLSX.writeFile(wb, filename);

        ui.showModal({
            title: 'Reporte descargado',
            body:
                `<p>Archivo: <strong>${filename}</strong></p>` +
                `<ul style="margin:8px 0 8px 20px; font-size:13px;">` +
                `  <li><strong>${dailyRows.length}</strong> días en hoja "KPIs Diarios"</li>` +
                `  <li><strong>${monthlyRows.length}</strong> meses en hoja "Resumen Mensual"</li>` +
                `  <li><strong>${ACCOUNT_IDS.length}</strong> cuentas + total en hoja "Por Cuenta Meta"</li>` +
                `  <li>Rango: <code>${dateFrom}</code> → <code>${dateTo}</code></li>` +
                `</ul>` +
                `<p style="font-size:12px;color:var(--text-secondary);">Revisa la carpeta de Descargas del navegador.</p>`,
            confirmText: 'Entendido',
            showCancel: false
        });
    } catch (err) {
        console.error('Error generando reporte KPIs:', err);
        ui.showModal({
            title: 'Error al generar reporte',
            body: `<p>No se pudo generar el archivo: <strong>${err.message}</strong></p>` +
                  `<p style="font-size:12px;color:var(--text-secondary);">Revisa la consola del navegador para más detalles.</p>`,
            confirmText: 'Cerrar',
            showCancel: false
        });
    }
}

// ============================================================================
//  Pestaña Campañas — carga del reporte por región
// ============================================================================

let _campaignsLoadedOnce = false;
let _lastCampaignsData = null; // { report, paidInRange } del último Calcular (para exportar)

/**
 * Lee pedidos pagados del rango, saca sus attributedAdId, pide al backend el
 * gasto por campaña + el mapa anuncio→campaña, y renderiza el reporte por
 * región. Todo on-demand (no listener) — pesado pero acotado al rango.
 */
async function loadCampaignsReport() {
    const out = document.getElementById('campaigns-content');
    if (!out) return;
    const dateFrom = document.getElementById('camp-date-from')?.value;
    const dateTo   = document.getElementById('camp-date-to')?.value;
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
        ui.showToast('Verifica las fechas (desde ≤ hasta)', 'warning');
        return;
    }

    out.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> Cargando campañas y pedidos… (puede tardar unos segundos)</p>';
    try {
        const allPedidos = await services.fetchAllPedidos();
        const inRange = allPedidos.filter(p => {
            if (!(p.estatus === 'Pagado' || p.estatus === 'Fabricar')) return false;
            if (!p.createdAt || typeof p.createdAt.toDate !== 'function') return false;
            const d = p.createdAt.toDate();
            const f = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            return f >= dateFrom && f <= dateTo;
        });
        const adIds = [...new Set(inRange.map(p => p.attributedAdId).filter(Boolean).map(String))];

        const report = await services.fetchRegionReport({ dateFrom, dateTo, adIds });
        _lastCampaignsData = { report, paidInRange: inRange };
        ui.renderCampaignsReport(out, { report, paidInRange: inRange });
    } catch (err) {
        console.error('Error cargando reporte de campañas:', err);
        out.innerHTML = `<p style="color:var(--danger);">Error: ${err.message}</p>`;
    }
}

/**
 * Exporta el reporte por región a Excel (2 hojas: Por Región + Por Campaña)
 * usando los datos del último Calcular. No vuelve a llamar al backend.
 */
function handleExportCampaigns() {
    if (!ensureXLSXLoaded()) return;
    if (!_lastCampaignsData) {
        ui.showToast('Primero pulsa Calcular para generar el reporte', 'warning');
        return;
    }
    const { report, paidInRange } = _lastCampaignsData;
    const agg = utils.buildRegionReport(report, paidInRange);
    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const roas = (rev, sp) => sp > 0 ? round2(rev / sp) : '';
    const cpa  = (sp, ord) => ord > 0 ? round2(sp / ord) : '';

    // Hoja 1 — Por Región
    const regionRows = agg.regionList.map(r => ({
        'Región': r.region, 'Gasto': round2(r.spend), 'Venta': round2(r.revenue),
        'Pedidos': r.orders, 'ROAS': roas(r.revenue, r.spend), 'CPA': cpa(r.spend, r.orders)
    }));
    regionRows.push({ 'Región': 'Orgánico (sin anuncio)', 'Gasto': 0, 'Venta': round2(agg.organic.revenue), 'Pedidos': agg.organic.orders, 'ROAS': '', 'CPA': '' });
    if (agg.unattributed.orders > 0) {
        regionRows.push({ 'Región': 'Sin atribuir (anuncio borrado)', 'Gasto': 0, 'Venta': round2(agg.unattributed.revenue), 'Pedidos': agg.unattributed.orders, 'ROAS': '', 'CPA': '' });
    }
    regionRows.push({
        'Región': 'TOTAL', 'Gasto': round2(agg.totals.spend), 'Venta': round2(agg.totals.revenue),
        'Pedidos': agg.totals.adOrders + agg.organic.orders + agg.unattributed.orders,
        'ROAS': roas(agg.totals.adRevenue, agg.totals.spend), 'CPA': ''
    });

    // Hoja 2 — Por Campaña
    const campRows = [];
    agg.regionList.forEach(r => r.campaigns.forEach(c => campRows.push({
        'Región': r.region, 'Campaña': c.name, 'Cuenta': c.accountId || '',
        'Gasto': round2(c.spend), 'Venta': round2(c.revenue), 'Pedidos': c.orders,
        'ROAS': roas(c.revenue, c.spend), 'CPA': cpa(c.spend, c.orders)
    })));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(regionRows), 'Por Región');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(campRows), 'Por Campaña');
    XLSX.writeFile(wb, `ReporteCampanas_${report.dateFrom}_a_${report.dateTo}.xlsx`);
    ui.showToast('Reporte exportado', 'success');
}

/**
 * Abre el panel de conciliación bancaria. El usuario captura el saldo
 * inicial y el saldo real (lo que ve en su app BBVA) para un rango de
 * fechas, y el sistema calcula la diferencia.
 */
function openReconciliation() {
    ui.openReconciliationModal({
        getExpenses: () => state.expenses,
        calculateExpectedBalance,
        reconcileBalance,
        onSaveCheckpoint: async (checkpoint) => services.saveBalanceCheckpoint(checkpoint)
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