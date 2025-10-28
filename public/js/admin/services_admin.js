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

export function listenForExpenses(onDataChange) {
    return onSnapshot(collection(db, "expenses"), (snapshot) => {
        state.expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        onDataChange();
    }, (error) => console.error("Expenses Listener Error:", error));
}

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

export function listenForSubcategories(onDataChange) {
    return onSnapshot(collection(db, "subcategories"), (snapshot) => {
        state.subcategories = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.name && data.parentCategory) {
                if (!state.subcategories[data.parentCategory]) {
                    state.subcategories[data.parentCategory] = [];
                }
                if (!state.subcategories[data.parentCategory].includes(data.name)) {
                    state.subcategories[data.parentCategory].push(data.name);
                }
            }
        });
        // Sort each subcategory array
        for (const category in state.subcategories) {
            state.subcategories[category].sort();
        }
        onDataChange();
    }, (error) => console.error("Subcategories Listener Error:", error));
}


export function listenForKpis(onDataChange) {
    return onSnapshot(collection(db, "daily_kpis"), (snapshot) => {
        state.kpis = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        onDataChange();
    }, (error) => console.error("KPIs Listener Error:", error));
}

export function listenForMonthlyLeads(onDataChange) {
    const year = 2025;
    const month = 8; // Septiembre es el mes 8 (0-indexed)
    const startOfMonth = new Date(Date.UTC(year, month, 1));
    const endOfMonth = new Date(Date.UTC(year, month + 1, 1));

    const q = query(collection(db, "pedidos"), 
        where("createdAt", ">=", Timestamp.fromDate(startOfMonth)),
        where("createdAt", "<", Timestamp.fromDate(endOfMonth))
    );

    return onSnapshot(q, (snapshot) => {
        const leadsCount = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.createdAt && data.createdAt.toDate) {
                const date = data.createdAt.toDate();
                // Formato YYYY-MM-DD
                const dateString = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
                leadsCount[dateString] = (leadsCount[dateString] || 0) + 1;
            }
        });
        state.monthlyLeads = leadsCount;
        onDataChange();
    }, (error) => console.error("Monthly Leads Listener Error:", error));
}

export function listenForMonthlyPaidLeads(onDataChange) {
    const year = 2025;
    const month = 8; // Septiembre es el mes 8 (0-indexed)
    const startOfMonth = new Date(Date.UTC(year, month, 1));
    const endOfMonth = new Date(Date.UTC(year, month + 1, 1));

    const q = query(collection(db, "pedidos"),
        where("createdAt", ">=", Timestamp.fromDate(startOfMonth)),
        where("createdAt", "<", Timestamp.fromDate(endOfMonth))
    );

    return onSnapshot(q, (snapshot) => {
        const leadsCount = {};
        const revenueCount = {};
        const paidStatuses = ["Pagado", "Fabricar"];

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (paidStatuses.includes(data.estatus)) {
                if (data.createdAt && data.createdAt.toDate) {
                    const date = data.createdAt.toDate();
                    const dateString = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
                    leadsCount[dateString] = (leadsCount[dateString] || 0) + 1;
                    revenueCount[dateString] = (revenueCount[dateString] || 0) + (parseFloat(data.precio) || 0);
                }
            }
        });
        state.monthlyPaidLeads = leadsCount;
        state.monthlyPaidRevenue = revenueCount;
        onDataChange();
    }, (error) => console.error("Monthly Paid Leads Listener Error:", error));
}

export function listenForMonthlyCancelledLeads(onDataChange) {
    const year = 2025;
    const month = 8; // Septiembre es el mes 8 (0-indexed)
    const startOfMonth = new Date(Date.UTC(year, month, 1));
    const endOfMonth = new Date(Date.UTC(year, month + 1, 1));

    // Query only by date to avoid needing a composite index
    const q = query(collection(db, "pedidos"),
        where("createdAt", ">=", Timestamp.fromDate(startOfMonth)),
        where("createdAt", "<", Timestamp.fromDate(endOfMonth))
    );

    return onSnapshot(q, (snapshot) => {
        const cancelledCount = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            // Filter for "Cancelado" status on the client side
            if (data.estatus === "Cancelado") {
                if (data.createdAt && data.createdAt.toDate) {
                    const date = data.createdAt.toDate();
                    const dateString = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
                    cancelledCount[dateString] = (cancelledCount[dateString] || 0) + 1;
                }
            }
        });
        state.monthlyCancelledLeads = cancelledCount;
        onDataChange();
    }, (error) => console.error("Monthly Cancelled Leads Listener Error:", error));
}


export function listenForAllTimeLeads() {
    return onSnapshot(collection(db, "pedidos"), (snapshot) => {
        state.totalLeads = snapshot.size;
    }, (error) => console.error("All Time Leads Listener Error:", error));
}


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

export function setupOrdersListener(onDataChange) {
    if (typeof ordersUnsubscribe === 'function') {
        ordersUnsubscribe();
    }

    const { start, end } = state.financials.dateFilter;
    let queries = [];
    if (start) queries.push(where("createdAt", ">=", Timestamp.fromDate(start)));
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
    
    setOrdersUnsubscribe(newUnsubscribe);
}


// --- OPERACIONES CRUD ---

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
                await setDoc(doc(db, "manualCategories", hashCode(concept)), { concept: concept, category: newCategory });
            }
        }
        
        if (expenseData.id) {
            await updateDoc(doc(db, "expenses", expenseData.id), expenseData);
        } else {
            await addDoc(collection(db, "expenses"), expenseData);
        }
        showModal({ show: false });
    } catch(error) {
        console.error("Error saving expense:", error);
        actionHistory.pop();
    }
}

export async function saveNewSubcategory(subcategoryName, parentCategory) {
    try {
        // ID único basado en el padre y el nombre de la subcategoría
        const subcategoryId = `${parentCategory.toLowerCase()}_${subcategoryName.toLowerCase()}`;
        const docRef = doc(db, "subcategories", subcategoryId);

        await setDoc(docRef, { 
            name: subcategoryName, 
            parentCategory: parentCategory 
        });
    } catch (error) {
        console.error("Error saving new subcategory:", error);
    }
}


export async function saveKpi(kpiData) {
    try {
        const dataToSave = { ...kpiData };
        delete dataToSave.id; // No guardar el ID dentro del documento
        delete dataToSave.leads; // No guardar el campo de leads
        delete dataToSave.paidLeads; // No guardar el campo de leads pagados
        delete dataToSave.revenue; // No guardar el campo de ingresos

        if (kpiData.id) {
            const docRef = doc(db, "daily_kpis", kpiData.id);
            await updateDoc(docRef, dataToSave);
        } else {
            // Revisar si ya existe un registro para esta fecha para evitar duplicados
            const q = query(collection(db, "daily_kpis"), where("fecha", "==", kpiData.fecha));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                // Existe, así que se actualiza en lugar de crear uno nuevo
                const docToUpdate = querySnapshot.docs[0];
                await updateDoc(docToUpdate.ref, dataToSave);
            } else {
                // No existe, se crea uno nuevo
                await addDoc(collection(db, "daily_kpis"), dataToSave);
            }
        }
        showModal({ show: false });
    } catch (error) {
        console.error("Error saving KPI:", error);
        showModal({ title: 'Error', body: 'No se pudo guardar el registro de KPI.' });
    }
}

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

export async function deleteKpi(id) {
    try {
        await deleteDoc(doc(db, "daily_kpis", id));
        showModal({ show: false });
    } catch (error) {
        console.error("Error deleting KPI:", error);
        showModal({ title: 'Error', body: 'No se pudo borrar el registro de KPI.', showCancel: false });
    }
}

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

export async function saveAdjustment(employeeId, type, adjustmentData) {
    saveStateToHistory('sueldos'); 
    try {
        const employeeIndex = state.sueldosData.findIndex(e => e.id === employeeId);
        if (employeeIndex === -1) throw new Error("Empleado no encontrado");

        const updatedEmployees = JSON.parse(JSON.stringify(state.sueldosData));
        const employee = updatedEmployees[employeeIndex];
        const collectionName = type === 'bono' ? 'bonos' : 'descuentos';
        
        if (!employee[collectionName]) employee[collectionName] = [];
        employee[collectionName].push(adjustmentData);
        
        recalculatePayment(employee);

        await saveSueldosDataToFirestore(updatedEmployees);
        showModal({ show: false });
    } catch (error) {
        console.error(`Error al guardar ${type}:`, error);
        actionHistory.pop(); 
        showModal({ title: 'Error', body: `No se pudo guardar el ${type}. Inténtalo de nuevo.`, showCancel: false });
    }
}

export async function deleteAdjustment(employeeId, type, adjustmentIndex) {
    saveStateToHistory('sueldos');
    try {
        const employeeIndex = state.sueldosData.findIndex(e => e.id === employeeId);
        if (employeeIndex === -1) throw new Error("Empleado no encontrado");

        const updatedEmployees = JSON.parse(JSON.stringify(state.sueldosData));
        const employee = updatedEmployees[employeeIndex];
        const collectionName = type === 'bono' ? 'bonos' : 'descuentos';

        if (employee[collectionName] && employee[collectionName][adjustmentIndex]) {
            employee[collectionName].splice(adjustmentIndex, 1);
            recalculatePayment(employee);
            await saveSueldosDataToFirestore(updatedEmployees);
            showModal({ show: false });
        } else {
            throw new Error("Ajuste no encontrado para eliminar.");
        }
    } catch (error) {
        console.error(`Error al eliminar ${type}:`, error);
        actionHistory.pop();
        showModal({ title: 'Error', body: `No se pudo eliminar el ${type}.`, showCancel: false });
    }
}


// --- OPERACIONES EN LOTE (BULK) ---

/**
 * Guarda un lote de nuevos gastos en Firestore.
 * @param {Array<object>} expenses - Un array de objetos de gasto para guardar.
 */
export async function saveBulkExpenses(expenses) {
    if (!expenses || expenses.length === 0) return;
    saveStateToHistory();
    const batch = writeBatch(db);
    try {
        expenses.forEach(expense => {
            batch.set(doc(collection(db, "expenses")), expense);
        });
        await batch.commit();
    } catch (error) {
        console.error("Error saving bulk expenses:", error);
        actionHistory.pop();
        throw new Error("No se pudieron guardar los registros en la base de datos.");
    }
}

export async function deleteCurrentMonthData() {
    saveStateToHistory();
    showModal({ show: false });
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
    try {
        const batch = writeBatch(db);
        const q = query(collection(db, "expenses"), where("date", ">=", start), where("date", "<=", end));
        const snapshot = await getDocs(q);
        let deletedCount = 0;
        if (snapshot.empty) {
            showModal({ title: 'Información', body: 'No hay registros en el mes actual.', showCancel: false, confirmText: 'Entendido' });
            actionHistory.pop(); return;
        }
        snapshot.forEach(doc => {
            if (doc.data().source !== 'manual' && doc.data().source !== 'modified') {
                batch.delete(doc.ref);
                deletedCount++;
            }
        });
         if (deletedCount === 0) {
            showModal({ title: 'Información', body: 'No hay registros de archivo para borrar en el mes actual.', showCancel: false, confirmText: 'Entendido' });
            actionHistory.pop(); return;
        }
        await batch.commit();
        showModal({ title: 'Éxito', body: `Se borraron ${deletedCount} registros del mes actual.`, showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error deleting current month data:", error);
        actionHistory.pop();
    }
}

export async function deletePreviousMonthData() {
      saveStateToHistory();
      showModal({ show: false });
      const today = new Date();
      const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
      const m = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
      const start = new Date(y, m, 1).toISOString().split('T')[0];
      const end = new Date(y, m + 1, 0).toISOString().split('T')[0];
      try {
          const batch = writeBatch(db);
          const q = query(collection(db, "expenses"), where("date", ">=", start), where("date", "<=", end));
          const snapshot = await getDocs(q);
          let deletedCount = 0;
          if (snapshot.empty) {
              showModal({ title: 'Información', body: 'No hay registros del mes anterior.', showCancel: false, confirmText: 'Entendido' });
              actionHistory.pop(); return;
          }
          snapshot.forEach(doc => {
            if (doc.data().source !== 'manual' && doc.data().source !== 'modified') {
                  batch.delete(doc.ref);
                  deletedCount++;
              }
          });
          if (deletedCount === 0) {
              showModal({ title: 'Información', body: 'No hay registros de archivo para borrar en el mes anterior.', showCancel: false, confirmText: 'Entendido' });
              actionHistory.pop(); return;
          }
          await batch.commit();
          showModal({ title: 'Éxito', body: `Se borraron ${deletedCount} registros del mes anterior.`, showCancel: false, confirmText: 'Entendido' });
      } catch (error) {
          console.error("Error deleting previous month data:", error);
          actionHistory.pop();
      }
}

export async function deleteSueldosData() {
    showModal({ show: false });
    try {
        await setDoc(doc(db, "sueldos", "main"), { employees: [] });
        showModal({ title: 'Éxito', body: 'Datos de sueldos eliminados.', showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error deleting payroll data:", error);
    }
}

// --- GESTIÓN DEL HISTORIAL (UNDO) ---

export function saveStateToHistory(dataType = 'expenses') {
    const snapshot = (dataType === 'sueldos')
        ? JSON.parse(JSON.stringify(state.sueldosData))
        : JSON.parse(JSON.stringify(state.expenses)).map(exp => { delete exp.id; return exp; });
    actionHistory.push({ type: dataType, data: snapshot });
}

export async function undoLastAction() {
    if (actionHistory.length === 0) {
        showModal({ title: 'Información', body: 'No hay más acciones que deshacer.', showCancel: false, confirmText: 'Entendido' });
        return;
    }
    const lastAction = actionHistory.pop();
    try {
        if (lastAction.type === 'sueldos') {
            await saveSueldosDataToFirestore(lastAction.data);
        } else {
            const batch = writeBatch(db);
            const snapshot = await getDocs(collection(db, "expenses"));
            snapshot.forEach(doc => batch.delete(doc.ref));
            lastAction.data.forEach(exp => batch.set(doc(collection(db, "expenses")), exp));
            await batch.commit();
        }
        showModal({ title: 'Éxito', body: 'La última acción ha sido deshecha.', showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error during undo:", error);
    }
}
