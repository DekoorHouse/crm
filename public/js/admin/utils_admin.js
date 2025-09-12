import { state } from './state_admin.js';

/**
 * @file Módulo de funciones de utilidad para la aplicación de administración.
 * @description Contiene funciones puras y reutilizables para tareas comunes como
 * formateo de datos, cálculos y categorización automática.
 */

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
    const lowerConcept = concept.toLowerCase();
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
    const lowerConcept = concept.toLowerCase();
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
 * @param {Array<Array<string>>} jsonData - Los datos crudos de la hoja.
 * @returns {Array<object>} Un array de objetos de empleado.
 */
export function parseSueldosData(jsonData) {
    const employees = [];
    if (jsonData.length < 2) return employees;

    const headers = jsonData[0].map(h => h.trim());
    const nameIndex = headers.findIndex(h => h.toLowerCase().includes('nombre'));
    
    if (nameIndex === -1) {
        throw new Error("La columna 'Nombre' no se encontró en el archivo de sueldos.");
    }
    
    const dayColumns = headers.map((header, index) => {
        const dayMatch = header.match(/(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo)/i);
        if (dayMatch) {
            return { day: dayMatch[0], index };
        }
        return null;
    }).filter(Boolean);

    for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        const name = row[nameIndex];
        if (!name) continue;

        const employeeId = name.toLowerCase().replace(/\s+/g, '_');
        const employee = {
            id: employeeId,
            name: name,
            registros: [],
            bonos: [],
            descuentos: [],
            paymentHistory: []
        };
        
        dayColumns.forEach(col => {
            const entryExit = row[col.index];
            if (entryExit && typeof entryExit === 'string' && entryExit.includes('-')) {
                const [entrada, salida] = entryExit.split('-').map(s => s.trim());
                if (entrada && salida) {
                    employee.registros.push({
                        day: col.day,
                        entrada: entrada,
                        salida: salida
                    });
                }
            }
        });
        
        recalculatePayment(employee);
        employees.push(employee);
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
    if (includeFinancial) {
        return [...state.expenses];
    }
    const { start, end } = state.dateFilter;
    const category = state.categoryFilter;

    return state.expenses.filter(expense => {
        // Match date
        const expenseDate = new Date(expense.date);
        expenseDate.setUTCHours(0, 0, 0, 0);
        const dateMatch = (!start || expenseDate >= start) && (!end || expenseDate <= end);
        if (!dateMatch) return false;

        // Match category
        if (category && category !== 'all') {
            const expenseCategory = expense.category || 'SinCategorizar';
            return expenseCategory === category;
        }

        return true; // If category is 'all'
    });
}
