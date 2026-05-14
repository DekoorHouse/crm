import { state } from './state.js';
import {
    detectBBVAHeader,
    parseBBVARow,
    attachSignatures,
    getStrictSignature as parserGetStrictSignature,
    getSoftSignature as parserGetSoftSignature,
    normalizeConcept as parserNormalizeConcept,
    normalizeAmount as parserNormalizeAmount,
    getMerchantKey as parserGetMerchantKey
} from './bbva-parser.js';

/**
 * @file Módulo de funciones de utilidad.
 * @description Contiene funciones puras y reutilizables para tareas comunes.
 */

// Re-exportamos las firmas y normalizadores del parser para que el resto
// del código (handlers, services) tenga un único punto de entrada.
export const getStrictSignature = parserGetStrictSignature;
export const getSoftSignature   = parserGetSoftSignature;
export const normalizeConcept   = parserNormalizeConcept;
export const normalizeAmount    = parserNormalizeAmount;
export const getMerchantKey     = parserGetMerchantKey;

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
        return expense.splits.map(s => ({ category: s.category, subcategory: s.subcategory || '', amount: s.amount }));
    }
    const charge = parseFloat(expense.charge) || 0;
    if (charge > 0) {
        return [{ category: expense.category || 'SinCategorizar', subcategory: expense.subcategory || '', amount: charge }];
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
 * Extrae el "merchant key" de un concepto: la parte antes del primer "/"
 * normalizada. Por ejemplo:
 *   "COPPEL PLAZA MADERO    / ******0670 RFC: COP..." -> "coppel plaza madero"
 *   "DLO DIDI FOOD MX       / ******8493 RFC: ..."     -> "dlo didi food mx"
 *   "GROK XAI               / ******8493 USD 30.00..." -> "grok xai"
 * Permite categorizar una vez y aplicar a todos los futuros movimientos
 * del mismo comercio (cada uno tiene AUT distinto en su concepto).
 */
export function extractMerchantKey(concept) {
    const lower = String(concept || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const slashIdx = lower.indexOf('/');
    return slashIdx >= 0 ? lower.substring(0, slashIdx).trim() : lower;
}

/**
 * Genera una firma única para un registro de gasto.
 *
 * NOTA: Históricamente esta firma se construía con `date | concept | charge | credit`
 * sin normalizar el concepto. Eso causaba colisiones falsas (espacios extra) y
 * además se usaba indistintamente para "duplicados exactos" y "movimientos
 * sospechosamente repetidos". A partir de esta versión `getExpenseSignature`
 * está aliasado a `getStrictSignature` (concepto COMPLETO normalizado, monto
 * con 2 decimales). El concepto completo incluye el AUT/RFC que BBVA inyecta
 * por cada movimiento, así que dos pagos reales del mismo comercio no chocan.
 * Para detectar "movimientos sospechosamente repetidos" use `getSoftSignature`.
 */
export function getExpenseSignature(expense) {
    return getStrictSignature(expense);
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
 * Parsea los datos de gastos desde un array JSON exportado por XLSX.
 *
 * Cambios respecto a la versión anterior:
 *   1. Ya no se asume que los datos empiezan en la fila 5 (`slice(4)`):
 *      ahora `detectBBVAHeader` busca dinámicamente la fila de encabezado
 *      ("FECHA", "DESCRIPCIÓN/CONCEPTO", "CARGO", "ABONO") y devuelve un
 *      mapa de columnas. Si no encuentra encabezados (archivo raro o sin
 *      cabecera) hace fallback a la heurística vieja.
 *   2. Cada movimiento queda con metadata de auditoría: archivo, hash,
 *      número de fila, batch de importación, fecha de importación,
 *      firmas estricta/suave y duplicateStatus.
 *
 * @param {Array<Array>} jsonData
 * @param {string|Object} fileMetaOrExt  Si se pasa un objeto con
 *        { sourceFileName, sourceFileHash, importBatchId, importedAt, sourceFileExt }
 *        se usa como metadata. Si se pasa un string (compatibilidad con la
 *        firma vieja) se interpreta como la extensión del archivo.
 * @returns {Array<object>}  transacciones normalizadas con firmas adjuntas
 */
export function parseExpensesData(jsonData, fileMetaOrExt) {
    if (!Array.isArray(jsonData) || jsonData.length === 0) return [];

    const meta = (typeof fileMetaOrExt === 'string' || !fileMetaOrExt)
        ? { sourceFileExt: fileMetaOrExt || 'xls' }
        : fileMetaOrExt;

    const { headerRowIndex, columnMap } = detectBBVAHeader(jsonData);
    const startRow = headerRowIndex + 1;

    const expenses = [];
    for (let i = startRow; i < jsonData.length; i++) {
        const tx = parseBBVARow(jsonData[i], i, columnMap, meta);
        if (!tx) continue;

        // Auto-categorización: a los abonos no les aplicamos reglas por
        // substring (están diseñadas para gastos). Sólo respetamos lo que ya
        // exista en `state.manualCategories` para ese concepto/comercio.
        if (tx.credit > 0) {
            const lowerConcept = tx.concept.toLowerCase();
            const merchantKey = extractMerchantKey(tx.concept);
            tx.category = state.manualCategories.get(lowerConcept)
                       || state.manualCategories.get(merchantKey)
                       || '';
        } else {
            tx.category = autoCategorize(tx.concept);
        }

        attachSignatures(tx);
        expenses.push(tx);
    }

    return expenses;
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
    // 1. Match exacto del concepto completo (compatibilidad con entradas viejas)
    if (state.manualCategories.has(lowerConcept)) {
        return state.manualCategories.get(lowerConcept);
    }
    // 2. Match por comercio (parte antes del "/") — clave para que persista entre transacciones
    const merchantKey = extractMerchantKey(concept);
    if (merchantKey && state.manualCategories.has(merchantKey)) {
        return state.manualCategories.get(merchantKey);
    }
    return autoCategorizeWithRulesOnly(concept);
}

export function autoCategorizeWithRulesOnly(concept) {
    const lowerConcept = String(concept).toLowerCase().replace(/\s+/g, ' ');
    const rules = {
        Ganancia: ['xciento'],
        Chris: ['chris', 'moises', 'wm max llc', 'stori', 'jessica', 'yannine', 'recargas y paquetes bmov / ******6530', 'recargas y paquetes bmov / ******7167', 'carniceria las pradera', 'minisuper natalia', 'temu', 'alsuper plus mezquital', 'alsuper plus d arrieta', 'fruteria alvarez'],
        Alex: ['alex', 'bolt', 'retiro sin tarjeta / ******0670'],
        Publicidad: ['facebook'],
        Material: ['material', 'raza', 'c00008749584', 'acrilico', 'mercadolibre', 'psa computo'],
        Envios: ['guias'], 
        Sueldos: ['diego', 'catalina', 'rosario', 'erika', 'catarina', 'maria gua', 'karla', 'lupita', 'recargas y paquetes bmov / ******0030'],
        Tecnologia: ['openai', 'claude', 'whaticket', 'hostinger', 'payu *google cloud', 'tripo ai'],
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
 * Calcula la nómina a partir de los datos del checador.
 * @param {'semanal'|'mensual'} period
 * @returns {Array} Datos de nómina por empleado.
 */
export function computePayrollFromChecador(period) {
    const { start, end } = getChecadorPeriodRange(period);
    const logs = state.checadorLogs;
    const employees = state.checadorEmployees;
    const adjustments = state.checadorAdjustments;

    // Parse log date (DD/MM/YYYY) to Date
    const parseLogDate = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return null;
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    };

    // Resolve employee name (handle id-based names)
    const resolveLogName = (log) => {
        if (log.name) return log.name;
        const emp = employees.find(e => e.id === log.id);
        return emp ? emp.name : (log.id || 'Desconocido');
    };

    // Filter logs by period
    const filtered = logs.filter(log => {
        const d = parseLogDate(log.date);
        return d && d >= start && d <= end;
    });

    // Group by employee-date
    const dayGroups = {};
    filtered.forEach(log => {
        const name = resolveLogName(log);
        const key = `${name.toLowerCase()}-${log.date}`;
        if (!dayGroups[key]) dayGroups[key] = { name, events: [] };
        dayGroups[key].events.push(log);
    });

    // Aggregate per employee
    const byEmployee = {};
    Object.values(dayGroups).forEach(group => {
        const k = group.name.toLowerCase();
        if (!byEmployee[k]) byEmployee[k] = { name: group.name, minutes: 0, days: 0 };
        let mins = 0, lastIn = null, hasIn = false;
        [...group.events].sort((a, b) => a.timestamp - b.timestamp).forEach(e => {
            if (e.type === 'IN') { lastIn = e.timestamp; hasIn = true; }
            else if (e.type === 'OUT' && lastIn) {
                mins += Math.floor((e.timestamp - lastIn) / 60000);
                lastIn = null;
            }
        });
        // Active shift — only count if today
        if (lastIn) {
            const logDate = parseLogDate(group.events[0]?.date);
            const today = new Date();
            if (logDate && logDate.toDateString() === today.toDateString()) {
                mins += Math.floor((Date.now() - lastIn) / 60000);
            }
        }
        if (hasIn) { byEmployee[k].minutes += mins; byEmployee[k].days += 1; }
    });

    // Add vacation days (cuenta todos los días del rango, aunque sean futuros)
    employees.forEach(emp => {
        if (!emp.vacaciones || !emp.vacacionesDesde || !emp.vacacionesHasta) return;
        const k = emp.name.toLowerCase();
        if (!byEmployee[k]) byEmployee[k] = { name: emp.name, minutes: 0, days: 0 };
        const cur = new Date(start);
        while (cur <= end) {
            const desde = new Date(emp.vacacionesDesde + 'T00:00:00');
            const hasta = new Date(emp.vacacionesHasta + 'T23:59:59');
            const check = new Date(cur); check.setHours(12, 0, 0, 0);
            if (check >= desde && check <= hasta) {
                const dayKey = `${k}-${cur.getDate()}/${cur.getMonth()+1}/${cur.getFullYear()}`;
                if (!dayGroups[dayKey]) {
                    const dow = cur.getDay();
                    let vacMins = 0;
                    if (dow >= 1 && dow <= 5) vacMins = 360; // L-V: 6h (9am-3pm)
                    else if (dow === 6) vacMins = 240;        // Sab: 4h (9am-1pm)
                    if (vacMins > 0) { byEmployee[k].minutes += vacMins; byEmployee[k].days += 1; }
                }
            }
            cur.setDate(cur.getDate() + 1);
        }
    });

    // Get rate per employee from checador_employees or sueldosData
    const getRate = (name) => {
        const sueldo = state.sueldosData.find(e => e.name.toLowerCase() === name.toLowerCase());
        return (sueldo && sueldo.ratePerHour) || 70;
    };

    // Build result with adjustments
    return Object.values(byEmployee).map(emp => {
        const rate = getRate(emp.name);
        const basePay = Math.round((emp.minutes / 60) * rate);
        const empAdjs = adjustments.filter(a => {
            if ((a.name || '').toLowerCase() !== emp.name.toLowerCase()) return false;
            const d = a.timestamp ? new Date(a.timestamp) : null;
            return d && d >= start && d <= end;
        });
        const adjSum = empAdjs.reduce((s, a) => s + (a.type === 'bono' ? a.amount : -a.amount), 0);
        return {
            name: emp.name,
            days: emp.days,
            minutes: emp.minutes,
            totalStr: `${Math.floor(emp.minutes / 60)}h ${emp.minutes % 60}m`,
            rate,
            basePay,
            adjustments: empAdjs,
            adjSum,
            finalPay: basePay + adjSum,
        };
    }).sort((a, b) => b.minutes - a.minutes);
}

/**
 * Calcula rango de fechas para un período.
 */
export function getChecadorPeriodRange(period) {
    const now = new Date();
    let start, end;
    if (period === 'semanal') {
        const day = now.getDay();
        const diff = (day === 0) ? -6 : 1 - day;
        start = new Date(now);
        start.setDate(now.getDate() + diff);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(start.getDate() + 5); // Lunes a Sábado
        end.setHours(23, 59, 59, 999);
    } else {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }
    return { start, end };
}

/**
 * Genera label legible para el período.
 */
export function getChecadorPeriodLabel(period) {
    const { start, end } = getChecadorPeriodRange(period);
    const fmt = d => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    if (period === 'semanal') return `${fmt(start)} – ${fmt(end)}`;
    return start.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
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