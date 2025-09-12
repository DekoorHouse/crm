import { db } from './firebase_admin.js';
import { collection, doc, addDoc, getDocs, writeBatch, onSnapshot, updateDoc, deleteDoc, query, where, setDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state, actionHistory, setOrdersUnsubscribe } from './state_admin.js';
import { autoCategorize, autoCategorizeWithRulesOnly, getExpenseSignature, hashCode, recalculatePayment } from './utils_admin.js';
import { showModal } from './ui-manager_admin.js';

/**
 * @file Módulo de servicios de datos.
 * @description Contiene toda la lógica para interactuar con Firestore,
 * incluyendo listeners en tiempo real, y operaciones de creación, lectura,
 * actualización y borrado (CRUD).
 */

// --- LISTENERS EN TIEMPO REAL ---

/**
 * Configura un listener en tiempo real para la colección 'expenses'.
 * Actualiza el estado de la aplicación cuando hay cambios.
 * @param {Function} onDataChange - Callback que se ejecuta cuando los datos cambian.
 */
export function listenForExpenses(onDataChange) {
    return onSnapshot(collection(db, "expenses"), (snapshot) => {
        state.expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        onDataChange();
    }, (error) => console.error("Expenses Listener Error:", error));
}

/**
 * Configura un listener en tiempo real para las categorías manuales.
 * @param {Function} onDataChange - Callback que se ejecuta cuando los datos cambian.
 */
export function listenForManualCategories(onDataChange) {
    return onSnapshot(collection(db, "manualCategories"), (snapshot) => {
        state.manualCategories.clear();
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            state.manualCategories.set(data.concept.toLowerCase(), data.category);
        });
        onDataChange();
    }, (error) => console.error("Manual Categories Listener Error:", error));
}

/**
 * Configura un listener en tiempo real para los datos de sueldos.
 * @param {Function} onDataChange - Callback que se ejecuta cuando los datos cambian.
 */
export function listenForSueldos(onDataChange) {
     return onSnapshot(doc(db, "sueldos", "main"), (docSnap) => {
        if (docSnap.exists()) {
            state.sueldosData = docSnap.data().employees || [];
        } else {
            state.sueldosData = [];
        }
        onDataChange();
    }, (error) => console.error("Payroll Listener Error:", error));
}


/**
 * Configura o reconfigura el listener para la colección de pedidos, aplicando los filtros de fecha actuales.
 * @param {Function} onDataChange - Callback que se ejecuta al recibir nuevos datos de pedidos.
 */
export function setupOrdersListener(onDataChange) {
    // Si ya hay un listener activo, lo cancelamos para crear uno nuevo con los filtros actualizados.
    if (typeof ordersUnsubscribe === 'function') {
        ordersUnsubscribe();
    }

    const { start, end } = state.financials.dateFilter;
    const queries = [];

    if (start) {
        queries.push(where("createdAt", ">=", Timestamp.fromDate(start)));
    }
    if (end) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 999);
        queries.push(where("createdAt", "<=", Timestamp.fromDate(endOfDay)));
    }
    
    const ordersQuery = query(collection(db, "pedidos"), ...queries);

    const newUnsubscribe = onSnapshot(ordersQuery, (snapshot) => {
        const allDocs = snapshot.docs;
        const paidDocs = allDocs.filter(doc => doc.data().estatus === 'Pagado');
        
        state.financials.allOrders = allDocs;
        state.financials.totalOrdersCount = allDocs.length;
        state.financials.paidOrdersCount = paidDocs.length;
        state.financials.paidOrdersRevenue = paidDocs.reduce((sum, doc) => sum + (parseFloat(doc.data().precio) || 0), 0);
        
        onDataChange();
    }, (error) => console.error("Orders Listener Error:", error));
    
    // Guardamos la nueva función de cancelación.
    setOrdersUnsubscribe(newUnsubscribe);
}


// --- OPERACIONES CRUD ---

/**
 * Guarda un nuevo gasto o actualiza uno existente en Firestore.
 * También gestiona las categorías manuales.
 * @param {object} expenseData - Los datos del gasto a guardar.
 * @param {string} originalCategory - La categoría original antes de la edición.
 */
export async function saveExpense(expenseData, originalCategory) {
    saveStateToHistory();
    try {
        const concept = (expenseData.concept || '').toLowerCase();
        const newCategory = expenseData.category;
        const isCharge = (expenseData.charge || 0) > 0;
        const categoryChanged = originalCategory !== newCategory;

        if (isCharge && newCategory && newCategory !== 'SinCategorizar' && (categoryChanged || !expenseData.id)) {
            const ruleBasedCategory = autoCategorizeWithRulesOnly(concept);
            if (newCategory !== ruleBasedCategory) {
                const docId = hashCode(concept);
                const manualCategoryRef = doc(db, "manualCategories", docId);
                await setDoc(manualCategoryRef, { concept: concept, category: newCategory });
            }
        }
        
        if (expenseData.id) {
            const { id, ...dataToUpdate } = expenseData;
            await updateDoc(doc(db, "expenses", id), dataToUpdate);
        } else {
            await addDoc(collection(db, "expenses"), expenseData);
        }
        showModal({ show: false });
    } catch(error) {
        console.error("Error saving expense:", error);
        actionHistory.pop();
    }
}

/**
 * Guarda una transacción financiera (préstamo o pago) en Firestore.
 */
export async function saveFinancialTransaction() {
    const form = document.getElementById('financial-form');
    if (!form.reportValidity()) return;

    const date = document.getElementById('financial-date').value;
    const concept = document.getElementById('financial-concept').value;
    const type = document.getElementById('financial-type').value;

    saveStateToHistory();
    const batch = writeBatch(db);

    if (type === 'entrada_prestamo') {
        const amount = parseFloat(document.getElementById('financial-credit').value) || 0;
        if (amount <= 0) {
            showModal({title: 'Dato Inválido', body: 'El monto del préstamo debe ser mayor a cero.', confirmText: 'Entendido', showCancel: false});
            actionHistory.pop();
            return;
        }
        const newEntry = {
            date, concept, charge: 0, credit: amount,
            type: 'financiero', sub_type: 'entrada_prestamo', category: '', channel: '',
            source: 'manual'
        };
        batch.set(doc(collection(db, "expenses")), newEntry);
    } else if (type === 'pago_prestamo') {
        const capitalAmount = parseFloat(document.getElementById('financial-capital').value) || 0;
        const interestAmount = parseFloat(document.getElementById('financial-interest').value) || 0;

        if (capitalAmount <= 0 && interestAmount <= 0) {
            showModal({title: 'Datos Incompletos', body: 'Debe ingresar un monto para capital y/o intereses.', confirmText: 'Entendido', showCancel: false});
            actionHistory.pop();
            return;
        }

        if (capitalAmount > 0) {
            const capitalEntry = {
                date, concept: `Pago a capital: ${concept}`, charge: capitalAmount, credit: 0,
                type: 'financiero', sub_type: 'pago_capital', category: '', channel: '',
                source: 'manual'
            };
            batch.set(doc(collection(db, "expenses")), capitalEntry);
        }
        if (interestAmount > 0) {
            const interestEntry = {
                date, concept: `Intereses: ${concept}`, charge: interestAmount, credit: 0,
                type: 'financiero', sub_type: 'pago_intereses', category: 'Gastos Financieros', channel: '',
                source: 'manual'
            };
            batch.set(doc(collection(db, "expenses")), interestEntry);
        }
    }
    
    try {
        await batch.commit();
        showModal({ show: false });
    } catch(error) {
        console.error("Error saving financial transaction:", error);
        actionHistory.pop();
    }
}


/**
 * Elimina un único registro de gasto de Firestore.
 * @param {string} id - El ID del documento a eliminar.
 */
export async function deleteExpense(id) {
    saveStateToHistory();
    try {
        await deleteDoc(doc(db, "expenses", id));
        showModal({ show: false });
    } catch (error) {
        console.error("Error borrando el registro:", error);
        actionHistory.pop();
        showModal({ title: 'Error', body: 'No se pudo borrar el registro.', showCancel: false });
    }
}

/**
 * Guarda los datos de sueldos en un único documento en Firestore.
 * @param {Array<object>} [dataToSave] - Los datos a guardar. Si no se proveen, se usa el estado actual.
 */
export async function saveSueldosDataToFirestore(dataToSave) {
    try {
        const data = dataToSave || state.sueldosData;
        data.forEach(emp => {
            if (!emp.registros) emp.registros = [];
            if (!emp.descuentos) emp.descuentos = [];
            if (!emp.bonos) emp.bonos = [];
            if (!emp.paymentHistory) emp.paymentHistory = [];
        });
        await setDoc(doc(db, "sueldos", "main"), { employees: data });
    } catch (error) {
        console.error("Error saving sueldos data:", error);
        showModal({ title: 'Error', body: 'No se pudieron guardar los datos de sueldos.' });
    }
}

/**
 * Adds a new adjustment (bonus or expense) to an employee and saves the data.
 * @param {string} employeeId - The ID of the employee.
 * @param {string} type - The type of adjustment ('bono' or 'gasto').
 * @param {object} adjustmentData - The data for the new adjustment.
 */
export async function saveAdjustment(employeeId, type, adjustmentData) {
    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (!employee) {
        showModal({ title: 'Error', body: 'Empleado no encontrado.' });
        return;
    }

    if (type === 'bono') {
        if (!employee.bonos) employee.bonos = [];
        employee.bonos.push(adjustmentData);
    } else if (type === 'gasto') {
        if (!employee.descuentos) employee.descuentos = [];
        employee.descuentos.push(adjustmentData);
    }

    // Recalculate totals for the employee
    recalculatePayment(employee);
    
    // Save the entire sueldos data back to Firestore
    await saveSueldosDataToFirestore();

    // Close the modal and the UI will update via the realtime listener
    showModal({ show: false });
}


// --- OPERACIONES EN LOTE (BULK) ---

/**
 * Elimina todos los registros de la colección 'expenses', excepto los de tipo 'Ajuste'.
 */
export async function deleteAllData() {
    const expensesToDelete = state.expenses.filter(e => e.concept !== 'Ajuste');
    if (expensesToDelete.length === 0) {
        showModal({ title: 'Información', body: 'No hay datos para borrar (excluyendo los ajustes).', showCancel: false, confirmText: 'Entendido' });
        return;
    }
    saveStateToHistory();
    showModal({ show: false });
    try {
        const batch = writeBatch(db);
        const q = query(collection(db, "expenses"), where("concept", "!=", "Ajuste"));
        const querySnapshot = await getDocs(q);
        
        querySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        await batch.commit();
        showModal({ title: 'Éxito', body: `Se han borrado ${querySnapshot.size} registros. Los ingresos de tipo "Ajuste" se han conservado.`, showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error borrando todos los datos:", error);
        actionHistory.pop();
        showModal({ title: 'Error', body: 'No se pudieron borrar los datos.', showCancel: false, confirmText: 'Entendido' });
    }
}

/**
 * Elimina todos los registros de gastos del mes en curso.
 */
export async function deleteCurrentMonthData() {
    saveStateToHistory();
    showModal({ show: false });

    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const startDateString = startDate.toISOString().split('T')[0];
    const endDateString = endDate.toISOString().split('T')[0];

    try {
        const batch = writeBatch(db);
        const q = query(collection(db, "expenses"), 
            where("date", ">=", startDateString),
            where("date", "<=", endDateString)
        );
        
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            showModal({ title: 'Información', body: 'No se encontraron registros en el mes actual para borrar.', showCancel: false, confirmText: 'Entendido' });
            actionHistory.pop();
            return;
        }

        querySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        await batch.commit();
        showModal({ title: 'Éxito', body: `Se han borrado ${querySnapshot.size} registros del mes actual.`, showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error deleting current month data:", error);
        actionHistory.pop();
        showModal({ title: 'Error', body: 'No se pudieron borrar los datos del mes actual.', showCancel: false, confirmText: 'Entendido' });
    }
}

/**
 * Elimina los registros del mes anterior que fueron cargados desde un archivo XLS.
 */
export async function deletePreviousMonthData() {
      saveStateToHistory();
      showModal({ show: false });

      const today = new Date();
      const year = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
      const month = today.getMonth() === 0 ? 11 : today.getMonth() - 1;

      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);

      const startDateString = startDate.toISOString().split('T')[0];
      const endDateString = endDate.toISOString().split('T')[0];

      try {
          const batch = writeBatch(db);
          const q = query(collection(db, "expenses"), 
              where("date", ">=", startDateString),
              where("date", "<=", endDateString)
          );
          
          const querySnapshot = await getDocs(q);
          let deletedCount = 0;

          if (querySnapshot.empty) {
              showModal({ title: 'Información', body: 'No se encontraron registros en el mes anterior para borrar.', showCancel: false, confirmText: 'Entendido' });
              actionHistory.pop();
              return;
          }

          querySnapshot.forEach(doc => {
              const data = doc.data();
              if (data.source !== 'manual') {
                  batch.delete(doc.ref);
                  deletedCount++;
              }
          });

          if (deletedCount === 0) {
              showModal({ title: 'Información', body: 'No se encontraron registros cargados por archivo en el mes anterior. Todos los registros eran manuales y se conservaron.', showCancel: false, confirmText: 'Entendido' });
              actionHistory.pop();
              return;
          }
          
          await batch.commit();
          showModal({ title: 'Éxito', body: `Se han borrado ${deletedCount} registros del mes anterior.`, showCancel: false, confirmText: 'Entendido' });
      } catch (error) {
          console.error("Error deleting previous month data:", error);
          actionHistory.pop();
          showModal({ title: 'Error', body: 'No se pudieron borrar los datos del mes anterior.', showCancel: false, confirmText: 'Entendido' });
      }
}

/**
 * Busca y elimina registros de gastos duplicados en toda la colección.
 */
export async function removeDuplicates() {
    showModal({ show: false }); 
    const expenses = state.expenses;
    if (expenses.length < 2) {
        showModal({ title: 'Información', body: 'No hay suficientes registros para buscar duplicados.', showCancel: false, confirmText: 'Entendido' });
        return;
    }

    const seen = new Map();
    const duplicatesToDelete = [];
    const sortedExpenses = [...expenses].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedExpenses.forEach(expense => {
        const signature = getExpenseSignature(expense);
        if (seen.has(signature)) {
            duplicatesToDelete.push(expense.id);
        } else {
            seen.set(signature, expense.id);
        }
    });

    if (duplicatesToDelete.length === 0) {
        showModal({ title: 'Sin Duplicados', body: '¡Buenas noticias! No se encontraron registros duplicados.', showCancel: false, confirmText: 'Entendido' });
        return;
    }

    try {
        saveStateToHistory();
        const batch = writeBatch(db);
        duplicatesToDelete.forEach(id => batch.delete(doc(db, "expenses", id)));
        await batch.commit();
        showModal({ title: 'Limpieza Exitosa', body: `Se eliminaron ${duplicatesToDelete.length} registros duplicados.`, showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error removing duplicates:", error);
        actionHistory.pop();
        showModal({ title: 'Error', body: 'Ocurrió un error al eliminar los duplicados.', showCancel: false, confirmText: 'Entendido' });
    }
}

/**
 * Elimina todos los datos de sueldos, reseteando el documento a un estado vacío.
 */
export async function deleteSueldosData() {
    showModal({ show: false });
    try {
        await setDoc(doc(db, "sueldos", "main"), { employees: [] });
        showModal({ 
            title: 'Éxito', 
            body: 'Todos los datos de sueldos han sido eliminados.', 
            showCancel: false, 
            confirmText: 'Entendido' 
        });
    } catch (error) {
        console.error("Error deleting payroll data:", error);
        showModal({ 
            title: 'Error', 
            body: 'No se pudieron borrar los datos de sueldos.', 
            showCancel: false, 
            confirmText: 'Entendido' 
        });
    }
}


// --- GESTIÓN DEL HISTORIAL (UNDO) ---

/**
 * Guarda una copia del estado actual de los gastos en el historial de acciones.
 */
export function saveStateToHistory() {
    const snapshot = JSON.parse(JSON.stringify(state.expenses)).map(exp => { delete exp.id; return exp; });
    actionHistory.push(snapshot);
}

/**
 * Restaura el estado de los gastos al estado anterior guardado en el historial.
 */
export async function undoLastAction() {
    if (actionHistory.length === 0) {
        showModal({ title: 'Información', body: 'No hay más acciones que deshacer.', showCancel: false, confirmText: 'Entendido' });
        return;
    }
    const previousExpenses = actionHistory.pop();
    try {
        const batch = writeBatch(db);
        const querySnapshot = await getDocs(collection(db, "expenses"));
        querySnapshot.forEach(doc => batch.delete(doc.ref));
        previousExpenses.forEach(expense => batch.set(doc(collection(db, "expenses")), expense));
        await batch.commit();
        showModal({ title: 'Éxito', body: 'La última acción ha sido deshecha.', showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error during undo:", error);
        showModal({ title: 'Error', body: 'No se pudo deshacer la acción.', showCancel: false, confirmText: 'Entendido' });
    }
}
