import { state } from './state_admin.js';

/**
 * @file Módulo de funciones de utilidad para la aplicación de administración.
 * @description Contiene funciones puras y reutilizables para tareas comunes como
 * formateo de datos, cálculos y categorización automática.
 */

// --- INICIO DE LA CORRECCIÓN ---
// Esta función ha sido reescrita para que coincida con la lógica
// de la versión anterior que funcionaba correctamente.
/**
 * Parsea los datos de gastos desde un array de arrays (proveniente de una hoja de cálculo).
 * @param {Array<Array<string|number>>} jsonData - Los datos crudos de la hoja.
 * @param {string} fileType - La extensión del archivo ('xls' o 'xlsx').
 * @returns {Array<object>} Un array de objetos de gasto formateados.
 */
export function parseExpensesData(jsonData) {
    // Se salta las primeras 4 filas, igual que en el código antiguo.
    const rowsToProcess = jsonData.slice(4);

    return rowsToProcess.map(row => {
        // Accede a los datos por el índice de la columna, no por el nombre del encabezado.
        const rawDate = row[0];
        const concept = String(row[1] || '').trim();
        const charge = String(row[2] || '0').replace(/[^0-9.-]+/g, "");
        const credit = String(row[3] || '0').replace(/[^0--9.]+/g, "");

        let dateValue = '';
        if (rawDate instanceof Date) {
            // Asegura que la fecha se maneje correctamente sin problemas de zona horaria.
            const d = new Date(Date.UTC(rawDate.getFullYear(), rawDate.getMonth(), rawDate.getDate()));
            if (!isNaN(d)) {
                dateValue = d.toISOString().split('T')[0];
            }
        } else if (typeof rawDate === 'number') {
            const d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
            if (!isNaN(d)) {
                const userTimezoneOffset = d.getTimezoneOffset() * 60000;
                dateValue = new Date(d.getTime() + userTimezoneOffset).toISOString().split('T')[0];
            }
        }

        if (!dateValue || !concept) {
            return null; // Si falta la fecha o el concepto, la fila es inválida.
        }
        
        const chargeValue = Math.abs(parseFloat(charge) || 0);
        const creditValue = parseFloat(credit) || 0;

        const expense = {
            date: dateValue,
            concept: concept,
            charge: chargeValue,
            credit: creditValue,
            category: creditValue > 0 ? '' : autoCategorize(concept),
            channel: '',
            type: 'operativo',
            sub_type: '',
            source: 'xls'
        };

        return expense;
    }).filter(e => e && (e.charge > 0 || e.credit > 0)); // Filtra filas inválidas y sin valores
}
// --- FIN DE LA CORRECCIÓN ---


/**
 * Formatea un número como una cadena de moneda en formato MXN.
 * @param {number} amount - La cantidad numérica a formatear.
 * @returns {string} La cantidad formateada como moneda (ej. "$1,234.50").
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
}

/**
 * Convierte la primera letra de una cadena a mayúscula.
 * @param {string} str - La cadena de texto a capitalizar.
 * @returns {string} La cadena con la primera letra en mayúscula.
 */
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Genera una firma única para un registro de gasto basada en sus propiedades clave.
 * Se utiliza para detectar duplicados.
 * @param {object} expense - El objeto de gasto.
 * @returns {string} Una cadena que representa la firma única del gasto.
 */
export function getExpenseSignature(expense) {
  const concept = (expense.concept || '').trim();
  const charge = parseFloat(expense.charge) || 0;
  const credit = parseFloat(expense.credit) || 0;
  return `${expense.date}|${concept}|${charge}|${credit}`;
}

/**
 * Genera un código hash numérico a partir de una cadena.
 * Se utiliza para crear IDs de documentos predecibles para las categorías manuales.
 * @param {string} str - La cadena de entrada.
 * @returns {string} El código hash generado como una cadena.
 */
export function hashCode(str) {
  let hash = 0;
  if (str.length === 0) return String(hash);
  for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
  }
  return String(hash);
}

/**
 * Convierte un número de serie de fecha de Excel a un objeto Date de JavaScript.
 * @param {number} excelDate - El número de serie de la fecha de Excel.
 * @returns {Date} El objeto Date correspondiente.
 */
function convertExcelDate(excelDate) {
    const jsDate = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    return new Date(jsDate.getTime() + (jsDate.getTimezoneOffset() * 60000));
}


/**
 * Calcula la diferencia en minutos entre una hora de entrada y una de salida.
 * @param {string} entrada - La hora de entrada (ej. "09:00").
 * @param {string} salida - La hora de salida (ej. "17:30").
 * @returns {number} El número total de minutos trabajados.
 */
export function calculateMinutesFromEntryExit(entrada, salida) {
  if (!entrada || !salida) return 0;
  
  const timePattern = /\d{1,2}:\d{2}/;
  const entradaMatch = entrada.match(timePattern);
  const salidaMatch = salida.match(timePattern);

  if (!entradaMatch || !salidaMatch) return 0;

  const [startH, startM] = entradaMatch[0].split(':').map(Number);
  const [endH, endM] = salidaMatch[0].split(':').map(Number);
  
  if ([startH, startM, endH, endM].some(isNaN)) return 0;

  const startTotalMinutes = startH * 60 + startM;
  const endTotalMinutes = endH * 60 + endM;

  return endTotalMinutes >= startTotalMinutes ? endTotalMinutes - startTotalMinutes : 0;
}

/**
 * Categoriza un gasto automáticamente, priorizando las categorías manuales sobre las reglas.
 * @param {string} concept - El concepto del gasto a categorizar.
 * @returns {string} La categoría asignada o 'SinCategorizar'.
 */
export function autoCategorize(concept) {
    const lowerConcept = String(concept).toLowerCase();
    if (state.manualCategories.has(lowerConcept)) {
        return state.manualCategories.get(lowerConcept);
    }
    return autoCategorizeWithRulesOnly(concept);
}

/**
 * Categoriza un gasto basándose únicamente en un conjunto de reglas predefinidas.
 * @param {string} concept - El concepto del gasto a categorizar.
 * @returns {string} La categoría asignada según las reglas, o 'SinCategorizar'.
 */
export function autoCategorizeWithRulesOnly(concept) {
    const lowerConcept = String(concept).toLowerCase();
    const rules = {
        Chris: ['chris', 'moises', 'wm max llc', 'stori', 'jessica', 'yannine', 'recargas y paquetes bmov / ******6530', 'recargas y paquetes bmov / ******7167'], 
        Alex: ['alex', 'bolt'], 
        Publicidad: ['facebook'],
        Material: ['material', 'raza', 'c00008749584'], 
        Envios: ['guias'], 
        Sueldos: ['diego', 'catalina', 'rosario', 'erika', 'catarina', 'maria gua', 'karla', 'lupita', 'recargas y paquetes bmov / ******0030'],
        Tecnologia: ['openai', 'claude', 'whaticket', 'hostinger'], 
        Local: ['local', 'renta', 'valeria'], 
        Deudas: ['saldos vencidos'], 
        Devoluciones: ['devolucion'],
        GastosFinancieros: ['interes', 'comision']
    };
    for (const category in rules) {
        if (rules[category].some(keyword => lowerConcept.includes(keyword))) return category;
    }
    return 'SinCategorizar';
}

/**
 * Recalcula el pago total de un empleado basándose en sus registros de horas, bonos y gastos.
 * Modifica el objeto del empleado directamente.
 * @param {object} employee - El objeto del empleado a recalcular.
 */
export function recalculatePayment(employee) {
    if (!employee || !employee.registros) return;

    let totalMinutes = 0;
    employee.registros.forEach(registro => {
        const minutes = calculateMinutesFromEntryExit(registro.entrada, registro.salida);
        registro.minutos = minutes;
        registro.horas = (minutes / 60).toFixed(2);
        totalMinutes += minutes;
    });

    const totalHours = totalMinutes / 60;
    employee.totalMinutes = totalMinutes;
    employee.totalHours = totalHours;
    employee.totalHoursFormatted = totalHours.toFixed(2);

    const rate = employee.ratePerHour || 70; // Default rate
    const subtotal = totalHours * rate;
    const totalBonos = (employee.bonos || []).reduce((sum, b) => sum + (parseFloat(b.amount) || 0), 0);
    const totalGastos = (employee.descuentos || []).reduce((sum, g) => sum + (parseFloat(g.amount) || 0), 0);
    
    employee.subtotal = subtotal;
    employee.totalBonos = totalBonos;
    employee.totalGastos = totalGastos;
    employee.pago = subtotal + totalBonos - totalGastos;
}

/**
 * Parsea los datos de sueldos desde un array JSON (proveniente de una hoja de cálculo).
 * @param {Array<Array<string|number>>} jsonData - Los datos crudos de la hoja.
 * @returns {Array<object>} Un array de objetos de empleado.
 */
export function parseSueldosData(jsonData) {
    const employees = [];
    if (!jsonData || jsonData.length < 4) return employees;

    let startDate = null;
    const dateCell = jsonData[2] ? jsonData[2][2] : null;

    if (typeof dateCell === 'number') {
        startDate = convertExcelDate(dateCell);
    } else if (typeof dateCell === 'string') {
        const match = dateCell.match(/(\d{4}-\d{2}-\d{2})/);
        const cleanedDateString = match ? match[0] : null; 
        if (cleanedDateString) {
            const dateParts = cleanedDateString.split('-').map(Number);
            startDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
        }
    }

    if (!startDate || isNaN(startDate.getTime())) {
        throw new Error("No se pudo encontrar o interpretar la fecha de inicio en la celda C3.");
    }

    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!Array.isArray(row)) continue;

        let name = null;
        for (let j = 0; j < row.length; j++) {
            if (typeof row[j] === 'string' && row[j].toLowerCase().includes('nombre')) {
                for (let k = j + 1; k < row.length; k++) {
                    if (row[k] && typeof row[k] === 'string' && row[k].trim() !== '') {
                        name = row[k];
                        break;
                    }
                }
                break;
            }
        }

        if (name) {
            const employeeId = String(name).toLowerCase().replace(/\s+/g, '_');
            const employee = {
                id: employeeId,
                name: String(name),
                registros: [], bonos: [], descuentos: [], paymentHistory: []
            };

            const dayHeaderRow = jsonData[i - 1];
            const attendanceRow = jsonData[i + 1];

            if (dayHeaderRow && attendanceRow) {
                for (let k = 0; k < dayHeaderRow.length; k++) {
                    const dayNumber = dayHeaderRow[k];
                    if (typeof dayNumber === 'number' && dayNumber >= 1 && dayNumber <= 31) {
                        const recordDate = new Date(startDate.getTime());
                        recordDate.setUTCDate(startDate.getUTCDate() + dayNumber - 1);
                        const dayName = dayNames[recordDate.getUTCDay()];
                        const timesCell = attendanceRow[k];
                        if (timesCell && typeof timesCell === 'string') {
                            const times = timesCell.split('\n').map(t => t.trim()).filter(t => /\d{1,2}:\d{2}/.test(t));
                            if (times.length > 0) {
                                times.sort(); 
                                const entrada = times[0];
                                const salida = times[times.length - 1];
                                employee.registros.push({ day: dayName, entrada, salida });
                            }
                        }
                    }
                }
            }
            
            recalculatePayment(employee);
            employees.push(employee);
            i += 1; 
        }
    }

    if (employees.length === 0) {
        throw new Error("No se encontraron empleados en el archivo. Verifica el formato.");
    }
    
    return employees;
}


/**
 * Genera un mensaje de texto formateado para WhatsApp con el resumen de pago de un empleado.
 * @param {object} employee - El objeto del empleado.
 * @returns {string} El mensaje formateado.
 */
export function generateWhatsAppMessage(employee) {
    if (!employee) return "Error: No se proporcionaron datos del empleado.";

    let message = `*Resumen de Pago para ${employee.name}*\n\n`;
    message += `*Horas trabajadas:* ${employee.totalHoursFormatted || '0.00'} hrs\n`;
    message += `*Tarifa por hora:* ${formatCurrency(employee.ratePerHour || 70)}\n`;
    message += `*Subtotal:* ${formatCurrency(employee.subtotal || 0)}\n\n`;

    if (employee.bonos && employee.bonos.length > 0) {
        message += "*Bonos:*\n";
        employee.bonos.forEach(bono => {
            message += `- ${bono.concept}: ${formatCurrency(bono.amount)}\n`;
        });
        message += `*Total Bonos:* ${formatCurrency(employee.totalBonos)}\n\n`;
    }

    if (employee.descuentos && employee.descuentos.length > 0) {
        message += "*Gastos/Descuentos:*\n";
        employee.descuentos.forEach(gasto => {
            message += `- ${gasto.concept}: ${formatCurrency(gasto.amount)}\n`;
        });
        message += `*Total Gastos:* ${formatCurrency(employee.totalGastos)}\n\n`;
    }

    message += `*TOTAL A PAGAR:* *${formatCurrency(employee.pago || 0)}*`;

    return message;
}

/**
 * Filtra la lista global de gastos basándose en los filtros de fecha y categoría activos.
 * @param {boolean} includeFinancial - Si es true, se ignoran los filtros y se devuelven todos los gastos.
 * @returns {Array<object>} Un array de gastos filtrados.
 */
export function getFilteredExpenses(includeFinancial = false) {
    if (includeFinancial) return [...state.expenses];

    const { start, end } = state.dateFilter;
    const category = state.categoryFilter;

    return state.expenses.filter(expense => {
        const expenseDate = new Date(expense.date);
        expenseDate.setUTCHours(0, 0, 0, 0);
        const dateMatch = (!start || expenseDate >= start) && (!end || expenseDate <= end);
        if (!dateMatch) return false;

        if (category && category !== 'all') {
            return (expense.category || 'SinCategorizar') === category;
        }

        return true;
    });
}

/**
 * Placeholder function to handle potential future data migrations for payroll.
 */
export function migrateSueldosDataStructure() {
    // console.log("Checking sueldos data structure...");
}

/**
 * Placeholder function to add manually tracked employees to the payroll data.
 */
export function addManualEmployees() {
    // console.log("Checking for manual employees to add...");
}

/**
 * Filters the payroll data based on the selected date range in the state.
 * @returns {Array<object>} An array of employee objects with filtered adjustments.
 */
export function filterSueldos() {
    const { start, end } = state.sueldosDateFilter;
    if (!start || !end) return state.sueldosData;

    return JSON.parse(JSON.stringify(state.sueldosData)).map(employee => {
        employee.bonos = (employee.bonos || []).filter(bono => {
            if (!bono.date) return false;
            const bonoDate = new Date(bono.date);
            return bonoDate >= start && bonoDate <= end;
        });
        employee.descuentos = (employee.descuentos || []).filter(gasto => {
            if (!gasto.date) return false;
            const gastoDate = new Date(gasto.date);
            return gastoDate >= start && gastoDate <= end;
        });
        recalculatePayment(employee);
        return employee;
    });
}
