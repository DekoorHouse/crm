import { state } from './state.js';

/**
 * @file Módulo de funciones de utilidad.
 * @description Contiene funciones puras y reutilizables para tareas comunes.
 */

const DEFAULT_CATEGORIES = ['Alex', 'Chris', 'Sueldos', 'Publicidad', 'Envios', 'Local', 'Material', 'Tecnologia', 'Deudas', 'Devoluciones', 'GastosFinancieros', 'Ganancia', 'SinCategorizar'];

export function getAllCategories() {
    return [...new Set([
        ...DEFAULT_CATEGORIES,
        ...state.customCategories,
        ...state.expenses.map(e => e.category).filter(Boolean)
    ])].sort();
}

/**
 * Devuelve las partes de categoría/monto de un gasto.
 * Si tiene splits, devuelve los splits. Si no, devuelve el cargo original con su categoría.
 */
export function getExpenseParts(expense) {
    if (expense.splits && expense.splits.length > 0) {
        return expense.splits.map(s => ({ category: s.category, amount: s.amount }));
    }
    const charge = parseFloat(expense.charge) || 0;
    if (charge > 0) {
        return [{ category: expense.category || 'SinCategorizar', amount: charge }];
    }
    return [];
}

/**
 * Formatea un número como una cadena de moneda en formato MXN.
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
}

/**
 * Convierte la primera letra de una cadena a mayúscula.
 */
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Genera una firma única para un registro de gasto.
 */
export function getExpenseSignature(expense) {
  const concept = (expense.concept || '').trim();
  const charge = parseFloat(expense.charge) || 0;
  const credit = parseFloat(expense.credit) || 0;
  return `${expense.date}|${concept}|${charge}|${credit}`;
}

/**
 * Genera un código hash numérico.
 */
export function hashCode(str) {
  let hash = 0;
  if (str.length === 0) return String(hash);
  for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; 
  }
  return String(hash);
}

/**
 * Convierte un número de serie de fecha de Excel a un objeto Date de JavaScript.
 */
function convertExcelDate(excelDate) {
    const jsDate = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    return new Date(jsDate.getTime() + (jsDate.getTimezoneOffset() * 60000));
}

/**
 * Parsea los datos de gastos desde un array JSON.
 */
export function parseExpensesData(jsonData, fileType) {
    const rowsToProcess = jsonData.slice(4); 

    const mappedExpenses = rowsToProcess.map((row) => {
        const rawDate = row[0];
        const concept = String(row[1] || '').trim();
        const charge = String(row[2] || '0').replace(/[^0-9.-]+/g, "");
        const credit = String(row[3] || '0').replace(/[^0-9.-]+/g, "");

        let dateValue = '';
        if (rawDate instanceof Date) {
            const d = new Date(Date.UTC(rawDate.getFullYear(), rawDate.getMonth(), rawDate.getDate()));
            if (!isNaN(d)) dateValue = d.toISOString().split('T')[0];
        } else if (typeof rawDate === 'number') {
            const d = convertExcelDate(rawDate);
            if (!isNaN(d)) dateValue = d.toISOString().split('T')[0];
        } else if (typeof rawDate === 'string') {
            const parts = rawDate.match(/(\d+)/g);
            if (parts && parts.length === 3) {
                const d = new Date(Date.UTC(parts[2], parts[1] - 1, parts[0]));
                 if (!isNaN(d)) dateValue = d.toISOString().split('T')[0];
            }
        }

        if (!dateValue || !concept) return null;
        
        const chargeValue = Math.abs(parseFloat(charge) || 0);
        const creditValue = parseFloat(credit) || 0;

        return {
            date: dateValue,
            concept: concept,
            charge: chargeValue,
            credit: creditValue,
            category: creditValue > 0 ? '' : autoCategorize(concept),
            channel: '',
            type: 'operativo',
            sub_type: '',
            source: fileType || 'xls'
        };
    });

    return mappedExpenses.filter(e => e && (e.charge > 0 || e.credit > 0));
}

/**
 * Calcula la diferencia en minutos entre una hora de entrada y una de salida.
 */
export function calculateMinutesFromEntryExit(entrada, salida) {
  if (!entrada || !salida) return 0;
  const timePattern = /\d{1,2}:\d{2}/;
  const entradaMatch = entrada.match(timePattern);
  const salidaMatch = salida.match(timePattern);
  if (!entradaMatch || !salidaMatch) return 0;

  const [startH, startM] = entradaMatch[0].split(':').map(Number);
  const [endH, endM] = salidaMatch[0].split(':').map(Number);
  const startTotalMinutes = startH * 60 + startM;
  const endTotalMinutes = endH * 60 + endM;

  return endTotalMinutes >= startTotalMinutes ? endTotalMinutes - startTotalMinutes : 0;
}

/**
 * Categoriza un gasto automáticamente.
 */
export function autoCategorize(concept) {
    const lowerConcept = String(concept).toLowerCase();
    if (state.manualCategories.has(lowerConcept)) {
        return state.manualCategories.get(lowerConcept);
    }
    return autoCategorizeWithRulesOnly(concept);
}

export function autoCategorizeWithRulesOnly(concept) {
    const lowerConcept = String(concept).toLowerCase();
    const rules = {
        Ganancia: ['xciento'],
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
 * Recalcula el pago de un empleado.
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

    const rate = employee.ratePerHour || 70;
    const subtotal = totalHours * rate;
    const totalBonos = (employee.bonos || []).reduce((sum, b) => sum + (parseFloat(b.amount) || 0), 0);
    const totalGastos = (employee.descuentos || []).reduce((sum, g) => sum + (parseFloat(g.amount) || 0), 0);
    
    employee.subtotal = subtotal;
    employee.totalBonos = totalBonos;
    employee.totalGastos = totalGastos;
    employee.pago = subtotal + totalBonos - totalGastos;
}

/**
 * Parsea los datos de sueldos (asistencia).
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
        if (match) {
            const dateParts = match[0].split('-').map(Number);
            startDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
        }
    }

    if (!startDate || isNaN(startDate.getTime())) {
        throw new Error("No se pudo encontrar la fecha de inicio en C3.");
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
                                employee.registros.push({ day: dayName, entrada: times[0], salida: times[times.length - 1] });
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
    return employees;
}

/**
 * Genera el mensaje de WhatsApp.
 */
export function generateWhatsAppMessage(employee) {
    if (!employee) return "";
    let message = `*Resumen de Pago para ${employee.name}*\n\n`;
    message += `*Horas trabajadas:* ${employee.totalHoursFormatted || '0.00'} hrs\n`;
    message += `*Tarifa por hora:* ${formatCurrency(employee.ratePerHour || 70)}\n`;
    message += `*Subtotal:* ${formatCurrency(employee.subtotal || 0)}\n\n`;
    if (employee.bonos?.length > 0) {
        message += "*Bonos:*\n";
        employee.bonos.forEach(b => message += `- ${b.concept}: ${formatCurrency(b.amount)}\n`);
        message += `*Total Bonos:* ${formatCurrency(employee.totalBonos)}\n\n`;
    }
    if (employee.descuentos?.length > 0) {
        message += "*Gastos/Descuentos:*\n";
        employee.descuentos.forEach(g => message += `- ${g.concept}: ${formatCurrency(g.amount)}\n`);
        message += `*Total Gastos:* ${formatCurrency(employee.totalGastos)}\n\n`;
    }
    message += `*TOTAL A PAGAR:* *${formatCurrency(employee.pago || 0)}*`;
    return message;
}

/**
 * Filtra los gastos basándose en fecha y categoría.
 * MEJORA: Comparación exacta por timestamps UTC.
 */
export function getFilteredExpenses(includeFinancial = false) {
    if (includeFinancial) return [...state.expenses];

    const { start, end } = state.dateFilter;
    const categoryFilter = state.categoryFilter;

    // Normalizar filtros a timestamps a las 00:00:00 UTC para comparación pura
    const startTs = start ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())).getTime() : null;
    const endTs = end ? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())).getTime() : null;

    return state.expenses.filter(expense => {
        if (!expense.date) return false;

        // Parsear la fecha del gasto YYYY-MM-DD
        const parts = expense.date.split('-');
        const expenseTs = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))).getTime();

        // Comparar milisegundos (Timestamps)
        const dateMatch = (!startTs || expenseTs >= startTs) && (!endTs || expenseTs <= endTs);
        if (!dateMatch) return false;

        // Filtro de categoría: cuando se activa, solo muestra gastos (cargos), no ingresos
        if (categoryFilter && categoryFilter !== 'all') {
            const charge = parseFloat(expense.charge) || 0;
            if (charge <= 0) return false;

            if (expense.splits && expense.splits.length > 0) {
                return expense.splits.some(s => s.category === categoryFilter);
            }
            const expenseCategory = expense.category || 'SinCategorizar';
            return expenseCategory === categoryFilter;
        }

        return true;
    });
}

/**
 * Filtra los sueldos por rango de fecha.
 * MEJORA: Uso de timestamps normalizados.
 */
export function filterSueldos() {
    const { start, end } = state.sueldosDateFilter;
    if (!start || !end) return state.sueldosData;

    const startTs = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())).getTime();
    const endTs = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())).getTime();

    return JSON.parse(JSON.stringify(state.sueldosData)).map(employee => {
        employee.bonos = (employee.bonos || []).filter(b => {
            if(!b.date) return false;
            const parts = b.date.split('-');
            const bTs = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))).getTime();
            return bTs >= startTs && bTs <= endTs;
        });
        employee.descuentos = (employee.descuentos || []).filter(g => {
            if(!g.date) return false;
            const parts = g.date.split('-');
            const gTs = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))).getTime();
            return gTs >= startTs && gTs <= endTs;
        });
        recalculatePayment(employee);
        return employee;
    });
}

export function migrateSueldosDataStructure() {}
export function addManualEmployees() {}