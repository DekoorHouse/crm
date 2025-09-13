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

            const allNewExpenses = utils.parseExpensesData(jsonData, file.name.split('.').pop());

            // --- NUEVA LÓGICA DE DETECCIÓN DE DUPLICADOS ---
            const { duplicates, uniqueNew } = utils.findDuplicates(allNewExpenses, state.expenses);

            if (duplicates.length > 0) {
                console.log(`[LOG] Se encontraron ${duplicates.length} posibles duplicados.`);
                
                // Esta función se pasará al modal para que la ejecute al confirmar.
                const processExpensesCallback = async (expensesToSave) => {
                    if (expensesToSave.length > 0) {
                        console.log(`[LOG] Guardando ${expensesToSave.length} registros en Firestore...`);
                        await services.saveBulkExpenses(expensesToSave);
                    }
                    const omittedCount = allNewExpenses.length - expensesToSave.length;
                    ui.showModal({
                        title: 'Éxito',
                        body: `Se cargaron y procesaron correctamente <strong>${expensesToSave.length}</strong> registros. Se omitieron <strong>${omittedCount}</strong> duplicados.`,
                        confirmText: 'Entendido',
                        showCancel: false
                    });
                };
                
                ui.showDuplicateReviewModal(duplicates, uniqueNew, processExpensesCallback);

            } else {
                console.log('[LOG] No se encontraron duplicados. Guardando todos los registros nuevos.');
                if (allNewExpenses.length > 0) {
                    await services.saveBulkExpenses(allNewExpenses);
                }
                ui.showModal({
                    title: 'Éxito',
                    body: `Se cargaron y procesaron correctamente ${allNewExpenses.length} registros del archivo. No se encontraron duplicados.`,
                    confirmText: 'Entendido',
                    showCancel: false
                });
            }
            // --- FIN DE LA NUEVA LÓGICA ---

        } catch (error) {
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
// ... existing code ...
async function handleSueldosFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    ui.showModal({
// ... existing code ...
