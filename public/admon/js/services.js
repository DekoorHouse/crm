import { db } from './firebase.js';
import { collection, doc, addDoc, getDocs, writeBatch, onSnapshot, updateDoc, deleteDoc, query, where, setDoc, Timestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state, actionHistory, setOrdersUnsubscribe } from './state.js';
import { autoCategorize, autoCategorizeWithRulesOnly, getExpenseSignature, hashCode, recalculatePayment, extractMerchantKey } from './utils.js';
import { getStrictSignature, getSoftSignature } from './bbva-parser.js';
import { collectionName } from './config.js';
import { showModal } from './ui-manager.js';

// Helpers para alias corto en este módulo. La función `EXP()` resuelve al
// nombre real de la colección de gastos según el modo (prod o test). Mismo
// patrón para checkpoints. Cualquier escritura/lectura de gastos pasa por
// aquí — no usar literales 'expenses' directos.
const EXP = () => collectionName('expenses');
const CHK = () => collectionName('balance_checkpoints');

/**
 * @file Módulo de servicios de datos.
 * @description Contiene toda la lógica para interactuar con Firestore,
 * incluyendo listeners en tiempo real, y operaciones de creación, lectura,
 * actualización y borrado (CRUD).
 */

// --- LISTENERS EN TIEMPO REAL ---

export function listenForExpenses(onDataChange) {
    return onSnapshot(collection(db, EXP()), (snapshot) => {
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

export function listenForCustomCategories(onDataChange) {
    return onSnapshot(collection(db, "custom_categories"), (snapshot) => {
        state.customCategories = snapshot.docs.map(doc => doc.data().name).filter(Boolean).sort();
        onDataChange();
    }, (error) => console.error("Custom Categories Listener Error:", error));
}

export async function saveNewCategory(categoryName) {
    try {
        const categoryId = categoryName.toLowerCase().replace(/\s+/g, '_');
        const docRef = doc(db, "custom_categories", categoryId);
        await setDoc(docRef, { name: categoryName });
    } catch (error) {
        console.error("Error saving new category:", error);
    }
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

// NUEVO: Listener para Notas
export function listenForNotes(onDataChange) {
    const notesDocRef = doc(db, "admin_data", "notes");
    return onSnapshot(notesDocRef, (docSnap) => {
        if (docSnap.exists()) {
            state.notes = docSnap.data().content || '';
        } else {
            state.notes = 'Escribe tus ideas aquí...'; // Default text
        }
        onDataChange(state.notes); // Pass the notes content to the callback
    }, (error) => console.error("Notes Listener Error:", error));
}


export function listenForKpis(onDataChange) {
    return onSnapshot(collection(db, "daily_kpis"), (snapshot) => {
        state.kpis = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        onDataChange();
    }, (error) => console.error("KPIs Listener Error:", error));
}

// Listeners unificados de KPIs por mes (suscripción dinámica al cambiar de mes)
let _kpiMonthUnsub = null;

export function subscribeToKpiMonth(monthStr, onDataChange) {
    // monthStr en formato YYYY-MM. Cancela suscripcion previa si existe.
    if (typeof _kpiMonthUnsub === 'function') {
        try { _kpiMonthUnsub(); } catch (_) {}
        _kpiMonthUnsub = null;
    }
    if (!monthStr || monthStr.length < 7) return;
    const [year, month] = monthStr.split('-').map(Number);
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const endOfMonth = new Date(Date.UTC(year, month, 1));

    const q = query(collection(db, "pedidos"),
        where("createdAt", ">=", Timestamp.fromDate(startOfMonth)),
        where("createdAt", "<", Timestamp.fromDate(endOfMonth))
    );

    const paidStatuses = ["Pagado", "Fabricar"];
    _kpiMonthUnsub = onSnapshot(q, (snapshot) => {
        const leads = {}, paid = {}, revenue = {}, cancelled = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (!data.createdAt || !data.createdAt.toDate) return;
            const date = data.createdAt.toDate();
            const dateString = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
            leads[dateString] = (leads[dateString] || 0) + 1;
            if (paidStatuses.includes(data.estatus)) {
                paid[dateString] = (paid[dateString] || 0) + 1;
                revenue[dateString] = (revenue[dateString] || 0) + (parseFloat(data.precio) || 0);
            }
            if (data.estatus === "Cancelado") {
                cancelled[dateString] = (cancelled[dateString] || 0) + 1;
            }
        });
        state.monthlyLeads = leads;
        state.monthlyPaidLeads = paid;
        state.monthlyPaidRevenue = revenue;
        state.monthlyCancelledLeads = cancelled;
        onDataChange();
    }, (error) => console.error("KPI Month Listener Error:", error));
}

export function listenForMonthlyLeads(onDataChange) {
    // MODIFICADO: Carga el mes actual dinámicamente
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth(); // 0-indexed
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
    // MODIFICADO: Carga el mes actual dinámicamente
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth(); // 0-indexed
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
    // MODIFICADO: Carga el mes actual dinámicamente
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth(); // 0-indexed
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

export function listenForChecadorEmployees(onDataChange) {
    return onSnapshot(collection(db, "checador_employees"), (snapshot) => {
        // Usar _docId para el Firestore doc ID. El campo `id` en los datos es
        // el id interno del empleado (diferente del doc ID).
        state.checadorEmployees = snapshot.docs.map(d => ({ _docId: d.id, ...d.data() }));
        onDataChange();
    }, (error) => console.error("Checador Employees Listener Error:", error));
}

export function listenForChecadorLogs(onDataChange) {
    return onSnapshot(collection(db, "checador_logs"), (snapshot) => {
        state.checadorLogs = snapshot.docs.map(d => ({ docId: d.id, ...d.data() }));
        onDataChange();
    }, (error) => console.error("Checador Logs Listener Error:", error));
}

export function listenForChecadorAdjustments(onDataChange) {
    return onSnapshot(collection(db, "checador_adjustments"), (snapshot) => {
        state.checadorAdjustments = snapshot.docs.map(d => ({ docId: d.id, ...d.data() }));
        onDataChange();
    }, (error) => console.error("Checador Adjustments Listener Error:", error));
}

export async function saveChecadorAdjustment({ name, type, amount, concept }) {
    return addDoc(collection(db, "checador_adjustments"), {
        name,
        type,
        amount,
        concept: concept || '',
        timestamp: Date.now()
    });
}

export async function deleteChecadorAdjustment(docId) {
    return deleteDoc(doc(db, "checador_adjustments", docId));
}

export async function saveEmployeeVacation(docId, desde, hasta) {
    return updateDoc(doc(db, "checador_employees", docId), {
        vacaciones: true,
        vacacionesDesde: desde,
        vacacionesHasta: hasta
    });
}

export async function removeEmployeeVacation(docId) {
    return updateDoc(doc(db, "checador_employees", docId), {
        vacaciones: false,
        vacacionesDesde: '',
        vacacionesHasta: ''
    });
}

/**
 * Persiste cambios a checador_logs para un empleado en un día específico.
 * @param {Object} params
 * @param {string} params.name - Nombre del empleado
 * @param {string} params.empId - ID interno del empleado (checador_employees.id)
 * @param {string} params.date - DD/MM/YYYY
 * @param {Array}  params.entries - [{ _docId, type, time, isNew, isDeleted }]
 */
export async function saveChecadorLogEntries({ name, empId, date, entries }) {
    const parts = String(date).split('/');
    if (parts.length !== 3) throw new Error('Fecha inválida');
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const year = parseInt(parts[2]);

    const batch = writeBatch(db);
    for (const entry of entries) {
        if (!entry) continue;
        const [hh, mm] = String(entry.time || '00:00').split(':').map(n => parseInt(n) || 0);
        const timestamp = new Date(year, month - 1, day, hh, mm, 0).getTime();

        if (entry.isDeleted && !entry.isNew && entry._docId) {
            batch.delete(doc(db, 'checador_logs', entry._docId));
        } else if (!entry.isDeleted && entry.isNew) {
            const ref = doc(collection(db, 'checador_logs'));
            batch.set(ref, {
                id: empId || '',
                name,
                type: entry.type,
                time: entry.time,
                date,
                timestamp
            });
        } else if (!entry.isDeleted && !entry.isNew && entry._docId) {
            batch.update(doc(db, 'checador_logs', entry._docId), {
                time: entry.time,
                timestamp
            });
        }
    }
    await batch.commit();
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


// --- REGLAS DE CATEGORIZACIÓN (editables desde el modal "Reglas") ---

/**
 * Escucha el doc `admin_data/categorization_rules`. Si existe y trae un
 * array `rules` válido, lo vuelca a state.categorizationRules (las reglas
 * dinámicas mandan). Si no existe, deja null → utils.js usa las
 * DEFAULT_KEYWORD_RULES hardcodeadas como fallback.
 */
export function listenForCategorizationRules(onDataChange) {
    const ref = doc(db, "admin_data", "categorization_rules");
    return onSnapshot(ref, (snap) => {
        if (snap.exists() && Array.isArray(snap.data().rules)) {
            state.categorizationRules = snap.data().rules;
        } else {
            state.categorizationRules = null;
        }
        onDataChange();
    }, (error) => console.error("Categorization Rules Listener Error:", error));
}

/**
 * Reemplaza el set completo de reglas dinámicas. El array debe venir ya
 * validado por la UI (keywords normalizadas a minúsculas, >= 3 chars).
 * El listener actualiza state automáticamente tras el guardado.
 *
 * @param {Array<{keyword:string, category:string}>} rules
 * @returns {Promise<number>} cantidad de reglas guardadas
 */
export async function saveCategorizationRules(rules) {
    if (!Array.isArray(rules)) throw new Error('rules debe ser un array');
    await setDoc(doc(db, "admin_data", "categorization_rules"), {
        version: 1,
        rules,
        updatedAt: Timestamp.now()
    });
    return rules.length;
}

// --- REGIONES DE CAMPAÑAS (pestaña Campañas) ---

/** Escucha admin_data/campaign_regions → state.campaignRegions (null si no existe). */
export function listenForCampaignRegions(onDataChange) {
    const ref = doc(db, "admin_data", "campaign_regions");
    return onSnapshot(ref, (snap) => {
        state.campaignRegions = snap.exists() ? snap.data() : null;
        onDataChange();
    }, (error) => console.error("Campaign Regions Listener Error:", error));
}

/** Guarda la config de regiones (reglas keyword + overrides por campaña + default). */
export async function saveCampaignRegions(config) {
    await setDoc(doc(db, "admin_data", "campaign_regions"), {
        rules: Array.isArray(config.rules) ? config.rules : [],
        overrides: (config.overrides && typeof config.overrides === 'object') ? config.overrides : {},
        defaultRegion: config.defaultRegion || 'Nacional',
        updatedAt: Timestamp.now()
    });
}

/**
 * Llama al backend POST /api/meta-ads/region-report con el rango y los adIds
 * (attributedAdId distintos de los pedidos pagados del rango). Devuelve
 * { campaigns, adToCampaign, adsResolved, adsRequested, errors }.
 */
export async function fetchRegionReport({ dateFrom, dateTo, adIds }) {
    const resp = await fetch('/api/meta-ads/region-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_from: dateFrom, date_to: dateTo, adIds: adIds || [] })
    });
    if (!resp.ok) throw new Error('El servidor respondió ' + resp.status + ' (¿desplegaste el backend de region-report?)');
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'region-report falló');
    return data;
}

// --- OVERRIDES (manualCategories): gestión desde el modal Reglas ---

/**
 * Lee TODOS los overrides de manualCategories con su docId real (la Map de
 * state.manualCategories pierde el docId y el kind, que aquí necesitamos
 * para poder borrar). Lectura bajo demanda — se invoca al expandir la
 * sección "Overrides" del modal, no como listener.
 */
export async function fetchAllManualCategories() {
    const snap = await getDocs(collection(db, "manualCategories"));
    return snap.docs.map(d => ({ docId: d.id, ...d.data() }));
}

export async function deleteManualCategory(docId) {
    return deleteDoc(doc(db, "manualCategories", docId));
}

export async function deleteManualCategoriesBulk(docIds) {
    if (!Array.isArray(docIds) || docIds.length === 0) return 0;
    const CHUNK = 400;
    for (let i = 0; i < docIds.length; i += CHUNK) {
        const batch = writeBatch(db);
        docIds.slice(i, i + CHUNK).forEach(id => batch.delete(doc(db, "manualCategories", id)));
        await batch.commit();
    }
    return docIds.length;
}

// --- APLICAR REGLA A MOVIMIENTOS EXISTENTES ---

/**
 * Calcula (sin tocar nada) qué pasaría al aplicar la regla keyword→categoría
 * sobre los movimientos YA guardados. Protecciones que espejan el
 * comportamiento de importación:
 *
 *   - Sólo CARGOS (charge > 0). Las reglas nunca aplican a abonos: si no
 *     se omitieran aquí, una keyword tipo "chris" arrastraría los cientos de
 *     ingresos "SPEI RECIBIDO ... christian" a una categoría de gasto.
 *   - Se omiten movimientos con splits (su categoría vive en las partes).
 *   - Se omiten manuales/editados (source manual|modified): son decisiones
 *     explícitas del usuario; se reportan en el conteo para que decida
 *     cambiarlos uno a uno si quiere.
 *
 * Además detecta overrides de manualCategories cuyo concepto CONTIENE la
 * keyword pero apuntan a OTRA categoría — esos seguirían ganando sobre la
 * regla en futuras importaciones, así que se reportan para ofrecer borrarlos.
 *
 * @returns {Promise<{toUpdate:Array, skippedManual:number, skippedSplits:number,
 *                    skippedCredits:number, conflictingOverrides:Array}>}
 */
export async function previewRuleApplication(keyword, targetCategory) {
    const kw = String(keyword || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!kw || kw.length < 3) throw new Error('Keyword inválida (mínimo 3 caracteres)');
    if (!targetCategory) throw new Error('Falta la categoría destino');

    const snap = await getDocs(collection(db, EXP()));
    const toUpdate = [];
    let skippedManual = 0, skippedSplits = 0, skippedCredits = 0;

    snap.docs.forEach(d => {
        const e = d.data();
        const c = String(e.concept || '').toLowerCase().replace(/\s+/g, ' ');
        if (!c.includes(kw)) return;
        if ((e.category || 'SinCategorizar') === targetCategory) return;
        if (!((parseFloat(e.charge) || 0) > 0)) { skippedCredits++; return; }
        if (e.splits && e.splits.length) { skippedSplits++; return; }
        if (e.source === 'manual' || e.source === 'modified') { skippedManual++; return; }
        toUpdate.push({
            id: d.id, date: e.date, concept: e.concept,
            charge: e.charge, category: e.category || 'SinCategorizar'
        });
    });

    const mc = await getDocs(collection(db, "manualCategories"));
    const conflictingOverrides = mc.docs
        .map(d => ({ docId: d.id, ...d.data() }))
        .filter(o => String(o.concept || '').includes(kw) && o.category !== targetCategory);

    return { toUpdate, skippedManual, skippedSplits, skippedCredits, conflictingOverrides };
}

/**
 * Aplica el resultado del preview: actualiza en lote los movimientos a la
 * categoría destino. Marca source='modified' (protege contra "Borrar Mes"
 * y contra futuros re-apply masivos).
 */
export async function commitRuleApplication(expenseIds, targetCategory) {
    if (!Array.isArray(expenseIds) || expenseIds.length === 0) return 0;
    saveStateToHistory();
    const CHUNK = 400;
    for (let i = 0; i < expenseIds.length; i += CHUNK) {
        const batch = writeBatch(db);
        expenseIds.slice(i, i + CHUNK).forEach(id => batch.update(doc(db, EXP(), id), {
            category: targetCategory,
            subcategory: '',
            source: 'modified'
        }));
        await batch.commit();
    }
    return expenseIds.length;
}

// --- OPERACIONES CRUD ---

export async function saveExpense(expenseData, originalCategory) {
    saveStateToHistory();
    try {
        const rawConcept = expenseData.concept || '';
        const concept = rawConcept.toLowerCase();
        const merchantKey = extractMerchantKey(rawConcept);
        const newCategory = expenseData.category;
        const categoryChanged = originalCategory !== newCategory;

        // Persistir el cambio manual de categoría POR COMERCIO (parte antes de "/").
        // Asi una sola categorizacion aplica a todos los movimientos del mismo
        // comercio aunque cada uno tenga AUT/RFC distinto en el concepto.
        //
        // FIX RAIZ (2026-05-27): los conceptos de transferencia bancaria NO
        // generan override de comercio. Su "comercio" (ej. "spei enviado albo")
        // es el BANCO, no el destinatario — un override ahí captura TODAS las
        // transferencias de ese banco sin importar a quién van (causa del bug
        // albo→Alex que mandaba transferencias de chris y jovita a Alex).
        // El movimiento individual SÍ conserva la categoría que el usuario
        // eligió; sólo se omite la regla automática de comercio.
        const BANK_TRANSFER_PREFIXES = ['spei enviado', 'spei recibido', 'pago cuenta de tercero', 'spei retornado'];
        const isBankTransfer = merchantKey && BANK_TRANSFER_PREFIXES.some(p => merchantKey.startsWith(p));

        if (newCategory && newCategory !== 'SinCategorizar' && categoryChanged && merchantKey) {
            const ruleBasedCategory = autoCategorizeWithRulesOnly(concept);
            if (newCategory !== ruleBasedCategory && !isBankTransfer) {
                await setDoc(doc(db, "manualCategories", hashCode(merchantKey)), {
                    concept: merchantKey,
                    category: newCategory,
                    kind: 'merchant'
                });
            } else {
                // Si el usuario vuelve a la categoría que la regla ya produce,
                // elimina cualquier override previo (tanto merchant como exacto).
                try { await deleteDoc(doc(db, "manualCategories", hashCode(merchantKey))); } catch (_) {}
                try { await deleteDoc(doc(db, "manualCategories", hashCode(concept))); } catch (_) {}
            }
        }
        
        const dataToSave = { ...expenseData };
        if (dataToSave.splits === null && dataToSave.id) {
            dataToSave.splits = deleteField();
        }

        // Recalcular firmas para que coincidan con los datos finales. Si el
        // usuario edita un movimiento (cambia monto, concepto o fecha) las
        // firmas viejas dejarían de ser correctas y romperían la detección
        // de duplicados.
        dataToSave.strictSignature = getStrictSignature(dataToSave);
        dataToSave.softSignature   = getSoftSignature(dataToSave);
        // Marcar como modificado si fue editado (preserva manualidad y evita
        // que `deleteCurrentMonthData` lo borre).
        if (dataToSave.id && !dataToSave.source) dataToSave.source = 'modified';

        if (dataToSave.id) {
            await updateDoc(doc(db, EXP(), dataToSave.id), dataToSave);
        } else {
            if (dataToSave.splits && typeof dataToSave.splits === 'object' && dataToSave.splits._methodName) {
                delete dataToSave.splits;
            }
            await addDoc(collection(db, EXP()), dataToSave);
        }
        showModal({ show: false });
    } catch(error) {
        console.error("Error saving expense:", error);
        actionHistory.pop();
    }
}

// NUEVO: Función para guardar notas
export async function saveNotes(content) {
    try {
        const notesDocRef = doc(db, "admin_data", "notes");
        await setDoc(notesDocRef, { content: content }, { merge: true });
        return true; // Indicate success
    } catch (error) {
        console.error("Error saving notes:", error);
        return false; // Indicate failure
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
        // showModal({ show: false }); // Comentado para permitir llamadas batch sin cerrar modales prematuramente si se usa externamente
    } catch (error) {
        console.error("Error saving KPI:", error);
        showModal({ title: 'Error', body: 'No se pudo guardar el registro de KPI.' });
    }
}

/**
 * Auto-sincroniza el gasto publicitario llamando al endpoint del servidor
 * (que usa la cuenta Meta ya configurada en Firestore — sin pedir credenciales).
 * Silencioso: errores van a console, no a UI.
 */
export async function autoSyncMetaKpis({ dateFrom, dateTo } = {}) {
    try {
        const body = {};
        if (dateFrom) body.date_from = dateFrom;
        if (dateTo) body.date_to = dateTo;
        const resp = await fetch('/api/meta-ads/sync-kpis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (!data.success) {
            console.warn('Meta auto-sync:', data.error || 'sin cuenta activa');
            return null;
        }
        return data;
    } catch (err) {
        console.warn('Meta auto-sync falló:', err.message);
        return null;
    }
}

/**
 * Sincroniza el gasto publicitario desde la API de Meta.
 */
export async function syncMetaSpend(accountId, token, startDate, endDate) {
    showModal({ 
        title: 'Sincronizando...', 
        body: '<p><i class="fas fa-spinner fa-spin"></i> Conectando con Meta Graph API...</p>', 
        showConfirm: false, showCancel: false 
    });

    try {
        // Construir URL para Insights API (desglose diario)
        // time_increment=1 asegura que nos de el gasto por día
        const url = `https://graph.facebook.com/v19.0/${accountId}/insights?level=account&fields=spend,date_start&time_increment=1&time_range={'since':'${startDate}','until':'${endDate}'}&access_token=${token}`;

        const response = await fetch(url);
        const json = await response.json();

        if (json.error) {
            throw new Error(json.error.message);
        }

        const data = json.data || [];
        let updatedCount = 0;

        // Procesar cada día devuelto por Meta
        for (const dayData of data) {
            const fecha = dayData.date_start; // Formato YYYY-MM-DD
            const spend = parseFloat(dayData.spend) || 0;

            if (spend > 0) {
                // Buscar si ya existe el KPI para esta fecha
                const q = query(collection(db, "daily_kpis"), where("fecha", "==", fecha));
                const querySnapshot = await getDocs(q);
                
                if (!querySnapshot.empty) {
                    const docSnap = querySnapshot.docs[0];
                    await updateDoc(docSnap.ref, { costo_publicidad: spend });
                } else {
                    await addDoc(collection(db, "daily_kpis"), {
                        fecha: fecha,
                        costo_publicidad: spend
                    });
                }
                updatedCount++;
            }
        }

        showModal({ 
            title: 'Sincronización Exitosa', 
            body: `Se actualizaron los costos de publicidad para <strong>${updatedCount}</strong> días desde Meta Ads.`,
            confirmText: 'Cerrar',
            showCancel: false
        });

    } catch (error) {
        console.error("Meta Sync Error:", error);
        showModal({ 
            title: 'Error de Conexión', 
            body: `No se pudo obtener datos de Meta: <br><strong>${error.message}</strong><br><br>Verifica que el ID de cuenta comience con "act_" y el token sea válido.`,
            confirmText: 'Cerrar'
        });
    }
}

export async function deleteExpense(id) {
    saveStateToHistory();
    try {
        await deleteDoc(doc(db, EXP(), id));
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

export async function closeWeek() {
    saveStateToHistory('sueldos');
    try {
        const today = new Date();
        // Label format: DD/MM/YYYY
        const weekLabel = today.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
        
        const updatedEmployees = JSON.parse(JSON.stringify(state.sueldosData)).map(emp => {
            // Recalculate everything before closing to be sure
            recalculatePayment(emp);
            
            const historyEntry = {
                week: weekLabel,
                hours: parseFloat(emp.totalHours) || 0,
                payment: parseFloat(emp.pago) || 0,
                timestamp: Timestamp.now()
            };
            
            if (!emp.paymentHistory) emp.paymentHistory = [];
            emp.paymentHistory.unshift(historyEntry); // Add to the top of history
            
            // Clear current week
            emp.registros = [];
            emp.bonos = [];
            emp.descuentos = [];
            
            // Recalculate once more (should result in 0s)
            recalculatePayment(emp);
            
            return emp;
        });
        
        await saveSueldosDataToFirestore(updatedEmployees);
        return true;
    } catch (error) {
        console.error("Error closing week:", error);
        return false;
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
    const CHUNK_SIZE = 400; // Firestore batch limit is 500
    try {
        for (let i = 0; i < expenses.length; i += CHUNK_SIZE) {
            const chunk = expenses.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);
            chunk.forEach(expense => {
                batch.set(doc(collection(db, EXP())), expense);
            });
            await batch.commit();
        }
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
        const q = query(collection(db, EXP()), where("date", ">=", start), where("date", "<=", end));
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
          const q = query(collection(db, EXP()), where("date", ">=", start), where("date", "<=", end));
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

export async function deleteEmployee(employeeId) {
    saveStateToHistory('sueldos');
    try {
        const updatedEmployees = state.sueldosData.filter(e => e.id !== employeeId);
        await saveSueldosDataToFirestore(updatedEmployees);
        showModal({ show: false });
    } catch (error) {
        console.error("Error al eliminar empleado:", error);
        actionHistory.pop();
        showModal({ title: 'Error', body: 'No se pudo eliminar el empleado.', showCancel: false });
    }
}

// --- GESTIÓN DEL HISTORIAL (UNDO) ---

// ---------------------------------------------------------------------------
//  Lectura completa de pedidos (para reportes / exportación)
// ---------------------------------------------------------------------------

/**
 * Lee TODOS los documentos de la colección `pedidos` sin filtros.
 * Útil para exportar reportes históricos (KPIs a Excel).
 *
 * IMPORTANTE: se invoca bajo demanda, no como listener. Si la colección
 * crece a decenas de miles, considerar paginación o `where` por fechas.
 *
 * @returns {Promise<Array<object>>} array de pedidos crudos
 */
export async function fetchAllPedidos() {
    const snap = await getDocs(collection(db, "pedidos"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------------
//  Eliminación SEGURA de duplicados exactos
// ---------------------------------------------------------------------------

/**
 * Elimina duplicados EXACTOS de Firestore. La regla de seguridad es:
 *
 *   1. Sólo se eliminan movimientos con la misma firma ESTRICTA
 *      (fecha + concepto completo + montos). Los que sólo comparten
 *      firma suave (mismo merchant, mismo monto, misma fecha pero AUT
 *      distinto) NO se tocan, porque pueden ser pagos reales separados.
 *
 *   2. Si un grupo contiene un movimiento manual o `confirmed_real`, ése
 *      se conserva como sobreviviente. El usuario lo marcó como real, así
 *      que tiene prioridad sobre las importaciones.
 *
 *   3. Si no hay manual/confirmed, se conserva el de menor `importedAt`
 *      (el más antiguo). Esto preserva la categorización original.
 *
 *   4. Movimientos con source 'manual' o 'modified' nunca se eliminan,
 *      aunque haya duplicados — quedaría un manual + el primer import.
 *
 * @returns {Promise<number>}  cantidad de documentos eliminados
 */
export async function removeDuplicates() {
    saveStateToHistory();

    const snapshot = await getDocs(collection(db, EXP()));
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Agrupar por strictSignature (calcular on-the-fly si el doc no la tiene)
    const groups = new Map();
    for (const d of docs) {
        const sig = d.strictSignature || getStrictSignature(d);
        if (!groups.has(sig)) groups.set(sig, []);
        groups.get(sig).push(d);
    }

    const PROTECTED_SOURCES = new Set(['manual', 'modified']);
    const PROTECTED_STATUSES = new Set(['confirmed_real']);

    const toDelete = [];

    for (const group of groups.values()) {
        if (group.length < 2) continue;

        // Ordenar: manuales/modified primero, luego confirmed_real, luego por
        // importedAt ascendente (más antiguo primero).
        group.sort((a, b) => {
            const aMan = PROTECTED_SOURCES.has(a.source) ? 0 : 1;
            const bMan = PROTECTED_SOURCES.has(b.source) ? 0 : 1;
            if (aMan !== bMan) return aMan - bMan;
            const aConf = PROTECTED_STATUSES.has(a.duplicateStatus) ? 0 : 1;
            const bConf = PROTECTED_STATUSES.has(b.duplicateStatus) ? 0 : 1;
            if (aConf !== bConf) return aConf - bConf;
            const aT = Number(a.importedAt) || 0;
            const bT = Number(b.importedAt) || 0;
            return aT - bT;
        });

        // Conservar el primero. De los restantes, sólo eliminar los que NO
        // estén protegidos (no son manual/modified ni confirmed_real).
        for (let i = 1; i < group.length; i++) {
            const cand = group[i];
            if (PROTECTED_SOURCES.has(cand.source)) continue;
            if (PROTECTED_STATUSES.has(cand.duplicateStatus)) continue;
            toDelete.push(cand.id);
        }
    }

    if (toDelete.length === 0) return 0;

    const CHUNK = 400;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
        const chunk = toDelete.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        chunk.forEach(id => batch.delete(doc(db, EXP(), id)));
        await batch.commit();
    }
    return toDelete.length;
}

// ---------------------------------------------------------------------------
//  Conciliación bancaria
// ---------------------------------------------------------------------------

/**
 * Guarda un "checkpoint" de saldo real BBVA capturado por el usuario.
 * Se persiste en la colección `balance_checkpoints` con id `YYYY-MM-DD`
 * para que regrabar el mismo día sobreescriba el valor anterior.
 *
 * @param {{ date:string, realBalance:number, openingBalance?:number,
 *           expectedBalance?:number, difference?:number, note?:string }} checkpoint
 */
export async function saveBalanceCheckpoint(checkpoint) {
    if (!checkpoint || !checkpoint.date) {
        throw new Error('Falta la fecha del checkpoint');
    }
    const data = {
        date: checkpoint.date,
        realBalance: Number(checkpoint.realBalance) || 0,
        openingBalance: Number(checkpoint.openingBalance) || 0,
        expectedBalance: Number(checkpoint.expectedBalance) || 0,
        difference: Number(checkpoint.difference) || 0,
        note: checkpoint.note || '',
        createdAt: Timestamp.now()
    };
    const id = String(checkpoint.date);
    await setDoc(doc(db, CHK(), id), data, { merge: true });
    return id;
}

/**
 * Lee todos los checkpoints guardados (una sola lectura, sin listener).
 * @returns {Promise<Array<object>>}
 */
export async function listBalanceCheckpoints() {
    const snap = await getDocs(collection(db, CHK()));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---------------------------------------------------------------------------
//  Configuración del saldo inicial de ajuste (admin_data/balance_config)
// ---------------------------------------------------------------------------
//  La usa el Resumen para calcular "Saldo BBVA Estimado". Es un singleton:
//  un solo documento, editable desde la tarjeta del Resumen.
//
//  Se mantiene en `admin_data/balance_config` (mismo "namespace" que
//  `admin_data/notes`). No se aísla con el sufijo `_test` — la configuración
//  de saldo inicial debe ser la misma en prod y en modo prueba, porque es
//  un dato del negocio, no de la base de movimientos.
//
//  Si el documento no existe, el listener deja el fallback histórico
//  (`state.balanceConfig.openingBalance = 2471.45`) y marca isConfigured=false
//  para que la UI muestre "Configura saldo inicial".

export function listenForBalanceConfig(onDataChange) {
    const ref = doc(db, "admin_data", "balance_config");
    return onSnapshot(ref, (snap) => {
        if (snap.exists()) {
            const d = snap.data() || {};
            state.balanceConfig = {
                openingBalance: Number(d.openingBalance) || 0,
                openingDate: d.openingDate || '2026-03-01',
                isConfigured: true,
                updatedAt: d.updatedAt || null
            };
        } else {
            // Sin doc → fallback en state.balanceConfig (definido en state.js).
            state.balanceConfig.isConfigured = false;
        }
        if (typeof onDataChange === 'function') onDataChange();
    }, (error) => console.error("Balance Config Listener Error:", error));
}

/**
 * Guarda la configuración del saldo inicial de ajuste.
 *
 * @param {{ openingBalance:number, openingDate?:string }} cfg
 */
export async function saveBalanceConfig(cfg) {
    if (cfg == null || typeof cfg.openingBalance !== 'number' || !Number.isFinite(cfg.openingBalance)) {
        throw new Error('openingBalance inválido');
    }
    const ref = doc(db, "admin_data", "balance_config");
    await setDoc(ref, {
        openingBalance: Number(cfg.openingBalance),
        openingDate: cfg.openingDate || state.balanceConfig.openingDate || '2026-03-01',
        updatedAt: Timestamp.now()
    }, { merge: true });
}

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
            const snapshot = await getDocs(collection(db, EXP()));
            snapshot.forEach(doc => batch.delete(doc.ref));
            lastAction.data.forEach(exp => batch.set(doc(collection(db, EXP())), exp));
            await batch.commit();
        }
        showModal({ title: 'Éxito', body: 'La última acción ha sido deshecha.', showCancel: false, confirmText: 'Entendido' });
    } catch (error) {
        console.error("Error during undo:", error);
    }
}