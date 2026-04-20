import { elements, state } from './state.js';
import { formatCurrency, autoCategorize, capitalize, getAllCategories, getExpenseParts, computePayrollFromChecador, getChecadorPeriodLabel, getChecadorPeriodRange } from './utils.js';
import * as services from './services.js';

/**
 * @file Módulo de gestión de la interfaz de usuario (UI).
 */


export function cacheElements() {
    elements.uploadBtn = document.getElementById('upload-btn');
    elements.uploadInput = document.getElementById('file-upload-input');
    elements.dataTableBody = document.querySelector('#data-table tbody');
    elements.dataTableFooter = document.querySelector('#data-table tfoot');
    elements.emptyState = document.getElementById('empty-state');
    elements.summarySection = document.querySelector('.summary-section');
    elements.modal = document.getElementById('modal');
    elements.modalTitle = document.getElementById('modal-title');
    elements.modalBody = document.getElementById('modal-body');
    elements.modalConfirmBtn = document.getElementById('modal-confirm-btn');
    elements.modalCancelBtn = document.getElementById('modal-cancel-btn');
    elements.tabs = document.querySelectorAll('.tab');
    elements.tabContents = document.querySelectorAll('.tab-content');
    elements.addManualBtn = document.getElementById('add-manual-btn');
    elements.deleteCurrentMonthBtn = document.getElementById('delete-current-month-btn');
    elements.deletePreviousMonthBtn = document.getElementById('delete-previous-month-btn');
    elements.exportBtn = document.getElementById('export-btn');
    elements.dateRangeFilter = document.getElementById('date-range-filter');
    elements.categoryFilter = document.getElementById('category-filter');
    elements.actionsContainer = document.getElementById('actions-container');
    elements.monthFilterSelect = document.getElementById('month-filter-select');
    elements.dataTableContainer = document.getElementById('data-table-container');
    elements.chartContexts = {
        pie: document.getElementById("pieChart")?.getContext("2d"),
        category: document.getElementById("categoryChart")?.getContext("2d"),
        compare: document.getElementById("compareChart")?.getContext("2d"),
        leadsTrend: document.getElementById("leadsTrendChart")?.getContext("2d"),
        incomeVsAdCost: document.getElementById("incomeVsAdCostChart")?.getContext("2d"),
    };
    
    elements.sueldosTableContainer = document.getElementById('sueldos-table-container');
    elements.sueldosEmptyState = document.getElementById('sueldos-empty-state');
    elements.sueldosPeriodToggle = document.getElementById('sueldos-period-toggle');
    elements.sueldosPeriodLabel = document.getElementById('sueldos-period-label');
    elements.sueldosAdjModal = document.getElementById('sueldos-adj-modal');
    elements.sueldosAdjModalTitle = document.getElementById('sueldos-adj-modal-title');
    elements.sueldosAdjModalClose = document.getElementById('sueldos-adj-modal-close');
    elements.sueldosAdjAmount = document.getElementById('sueldos-adj-amount');
    elements.sueldosAdjConcept = document.getElementById('sueldos-adj-concept');
    elements.sueldosAdjExisting = document.getElementById('sueldos-adj-existing');
    elements.sueldosAdjSaveBtn = document.getElementById('sueldos-adj-save-btn');
    elements.sueldosAdjTypeBtns = document.querySelectorAll('.sueldos-adj-type-btn');
    elements.sueldosVacModal = document.getElementById('sueldos-vac-modal');
    elements.sueldosVacModalTitle = document.getElementById('sueldos-vac-modal-title');
    elements.sueldosVacModalClose = document.getElementById('sueldos-vac-modal-close');
    elements.sueldosVacDesde = document.getElementById('sueldos-vac-desde');
    elements.sueldosVacHasta = document.getElementById('sueldos-vac-hasta');
    elements.sueldosVacSaveBtn = document.getElementById('sueldos-vac-save-btn');
    elements.sueldosVacRemoveBtn = document.getElementById('sueldos-vac-remove-btn');
    elements.sueldosDetailModal = document.getElementById('sueldos-detail-modal');
    elements.sueldosDetailModalTitle = document.getElementById('sueldos-detail-modal-title');
    elements.sueldosDetailModalClose = document.getElementById('sueldos-detail-modal-close');
    elements.sueldosDetailBody = document.getElementById('sueldos-detail-body');
    elements.sueldosEditLogModal = document.getElementById('sueldos-edit-log-modal');
    elements.sueldosEditLogTitle = document.getElementById('sueldos-edit-log-title');
    elements.sueldosEditLogClose = document.getElementById('sueldos-edit-log-close');
    elements.sueldosEditLogSubtitle = document.getElementById('sueldos-edit-log-subtitle');
    elements.sueldosEditLogEntries = document.getElementById('sueldos-edit-log-entries');
    elements.sueldosAddLogIn = document.getElementById('sueldos-add-log-in');
    elements.sueldosAddLogOut = document.getElementById('sueldos-add-log-out');
    elements.sueldosSaveEditLog = document.getElementById('sueldos-save-edit-log');
    elements.sueldosPinModal = document.getElementById('sueldos-pin-modal');
    elements.sueldosPinInput = document.getElementById('sueldos-pin-input');
    elements.sueldosPinCancel = document.getElementById('sueldos-pin-cancel');
    elements.sueldosPinConfirm = document.getElementById('sueldos-pin-confirm');

    elements.healthDateRangeFilter = document.getElementById('health-date-range-filter');
    elements.resetHealthFilterBtn = document.getElementById('reset-health-filter-btn');
    elements.leadsChartToggle = document.getElementById('leads-chart-toggle');
    elements.leadsChartTitle = document.getElementById('leads-chart-title');
    elements.thermometerBar = document.getElementById('thermometer-bar');
    elements.thermometerPercentage = document.getElementById('thermometer-percentage');
    elements.kpiTotalRevenue = document.getElementById('kpi-total-revenue');
    elements.kpiSalesRevenue = document.getElementById('kpi-sales-revenue');
    elements.kpiCosts = document.getElementById('kpi-costs');
    elements.kpiOperatingProfit = document.getElementById('kpi-operating-profit');
    elements.kpiOwnerDraw = document.getElementById('kpi-owner-draw');
    elements.kpiNetProfit = document.getElementById('kpi-net-profit');
    elements.kpiLeads = document.getElementById('kpi-leads');
    elements.kpiPaidOrders = document.getElementById('kpi-paid-orders');
    elements.kpiAvgTicketSales = document.getElementById('kpi-avg-ticket-sales');
    elements.kpiConversionRate = document.getElementById('kpi-conversion-rate');

    elements.kpiSummaryTitle = document.getElementById('kpi-summary-title'); 
    elements.kpiTotalLeads = document.getElementById('kpi-total-leads');
    elements.kpiTotalPaidLeads = document.getElementById('kpi-total-paid-leads');
    elements.kpiTotalCancelledLeads = document.getElementById('kpi-total-cancelled-leads');
    elements.kpiTotalRevenueKpis = document.getElementById('kpi-total-revenue-kpis');
    elements.kpiTotalAdCost = document.getElementById('kpi-total-ad-cost');
    elements.kpiAvgCpl = document.getElementById('kpi-avg-cpl');
    elements.kpiAvgCpvKpis = document.getElementById('kpi-avg-cpv-kpis');
    elements.kpiAvgConversionRateKpis = document.getElementById('kpi-avg-conversion-rate-kpis');
    
    elements.addKpiBtn = document.getElementById('add-kpi-btn');
    elements.syncMetaBtn = document.getElementById('sync-meta-btn');
    elements.kpisTableBody = document.querySelector('#kpis-table tbody');
    elements.kpisEmptyState = document.getElementById('kpis-empty-state');

    elements.notesEditor = document.getElementById('notes-editor');
    elements.notesToolbar = document.getElementById('notes-toolbar');
    elements.notesSaveStatus = document.getElementById('notes-save-status');

    elements.promptModal = document.getElementById('prompt-modal');
    elements.promptModalTitle = document.getElementById('prompt-modal-title');
    elements.promptModalInput = document.getElementById('prompt-modal-input');
    elements.promptModalForm = document.getElementById('prompt-modal-form');
    elements.promptModalConfirmBtn = document.getElementById('prompt-modal-confirm-btn');
    elements.promptModalCancelBtn = document.getElementById('prompt-modal-cancel-btn');
}

export function renderTable(expenses) {
    elements.dataTableBody.innerHTML = '';
    const sorted = [...expenses].sort((a,b) => (b.date > a.date) ? 1 : -1);
    
    sorted.forEach(expense => {
        const tr = document.createElement('tr');
        tr.dataset.id = expense.id;
        const charge = parseFloat(expense.charge) || 0;
        const credit = parseFloat(expense.credit) || 0;
        
        let displayCategory = 'N/A';
        const isOperational = expense.type === 'operativo' || !expense.type; 

        if (isOperational && credit > 0) {
            displayCategory = expense.channel || ''; 
        } else if (isOperational || expense.sub_type === 'pago_intereses') {
            displayCategory = expense.category || 'SinCategorizar';
        }
        
        let categoryHtml;
        if (expense.splits && expense.splits.length > 0) {
            categoryHtml = expense.splits.map(s => {
                const subTxt = s.subcategory ? ` <span style="opacity:0.7;">(${s.subcategory})</span>` : '';
                return `<div style="font-size:12px;">${s.category}${subTxt}: ${formatCurrency(s.amount)}</div>`;
            }).join('');
        } else if (displayCategory === 'SinCategorizar') {
            const allCategories = getAllCategories();
            const categoryOptions = allCategories.map(cat => `<option value="${cat}" ${cat === 'SinCategorizar' ? 'selected' : ''}>${cat}</option>`).join('');
            categoryHtml = `<select class="category-dropdown" data-expense-id="${expense.id}">${categoryOptions}<option value="" disabled>──────────</option><option value="__add_new_category__">+ Nueva categoría...</option></select>`;
        } else {
            categoryHtml = displayCategory;
        }

        let subcategoryHtml = 'N/A';
        const categoriesWithoutSubcategory = ['Alex', 'Chris', 'Publicidad'];

        if (credit > 0 || categoriesWithoutSubcategory.includes(displayCategory)) {
            subcategoryHtml = ''; 
        } else if (displayCategory !== 'N/A' && displayCategory !== '' && displayCategory !== 'SinCategorizar') {
            const availableSubcategories = state.subcategories[displayCategory] || [];
            const subcategoryOptions = availableSubcategories.map(sub => `<option value="${sub}" ${expense.subcategory === sub ? 'selected' : ''}>${sub}</option>`).join('');
            
            subcategoryHtml = `
                <select class="subcategory-dropdown" data-expense-id="${expense.id}" data-category="${displayCategory}">
                    <option value="">-- Seleccionar --</option>
                    ${subcategoryOptions}
                    <option value="" disabled>──────────</option>
                    <option value="__add_new__">+ Crear nueva...</option>
                </select>
            `;
        }

        tr.innerHTML = `
            <td>${expense.date || ''}</td>
            <td>${expense.concept || ''}</td>
            <td>${charge > 0 ? formatCurrency(charge) : ''}</td>
            <td>${credit > 0 ? formatCurrency(credit) : ''}</td>
            <td>${categoryHtml}</td>
            <td>${subcategoryHtml}</td>
            <td class="btn-group">
                ${charge > 0 ? '<button class="btn btn-outline btn-sm split-btn" title="Dividir gasto"><i class="fas fa-cut"></i></button>' : ''}
                <button class="btn btn-outline btn-sm edit-btn"><i class="fas fa-pencil-alt"></i></button>
                <button class="btn btn-outline btn-sm delete-btn" style="color:var(--danger);"><i class="fas fa-trash"></i></button>
            </td>
        `;
        
        elements.dataTableBody.appendChild(tr);
    });
}
  
export function updateTableTotals(expenses) {
    const { totalCharge, totalCredit } = expenses.reduce((acc, exp) => {
        acc.totalCharge += parseFloat(exp.charge) || 0;
        acc.totalCredit += parseFloat(exp.credit) || 0;
        return acc;
    }, { totalCharge: 0, totalCredit: 0 });
    elements.dataTableFooter.innerHTML = `
        <tr>
            <th colspan="2">Totales (Vista Actual):</th>
            <th>${formatCurrency(totalCharge)}</th>
            <th>${formatCurrency(totalCredit)}</th>
            <th colspan="3"></th>
        </tr>
    `;
}

export function updateSummary(getFilteredExpenses) {
    const filteredOperationalExpenses = getFilteredExpenses().filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses');
    
    const summaryData = filteredOperationalExpenses.reduce((acc, exp) => {
        const charge = parseFloat(exp.charge) || 0;
        const credit = parseFloat(exp.credit) || 0;

        if (credit > 0) {
            acc.TotalIngresos += credit;
        }
        if (charge > 0) {
            acc.TotalCargos += charge;
            const parts = getExpenseParts(exp);
            parts.forEach(p => {
                if (!acc[p.category]) acc[p.category] = 0;
                acc[p.category] += p.amount;
            });
        }
        return acc;
    }, { TotalCargos: 0, TotalIngresos: 0 });

    // Utilidad Operativa: solo marzo-abril 2026 porque los meses anteriores tienen datos incorrectos
    // Incluye tipo 'ajuste_saldo' (conciliación bancaria) — este tipo se excluye de Ingresos/Cargos
    const NETO_FROM = '2026-03-01';
    const NETO_TO = '2026-04-30';
    const netoExpenses = state.expenses.filter(e =>
        (e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses' || e.type === 'ajuste_saldo') &&
        e.date >= NETO_FROM && e.date <= NETO_TO
    );
    const totalOverallIncome = netoExpenses.reduce((sum, exp) => sum + (parseFloat(exp.credit) || 0), 0);
    const totalOverallCharges = netoExpenses.reduce((sum, exp) => sum + (parseFloat(exp.charge) || 0), 0);

    summaryData.TotalNeto = totalOverallIncome - totalOverallCharges;
    
    elements.summarySection.innerHTML = '';
    const summaryOrder = ['TotalNeto', 'TotalIngresos', 'TotalCargos'];
    const sortedSummary = Object.entries(summaryData).sort(([keyA], [keyB]) => {
        const indexA = summaryOrder.indexOf(keyA);
        const indexB = summaryOrder.indexOf(keyB);
        if (indexA > -1 && indexB > -1) return indexA - indexB;
        if (indexA > -1) return -1;
        if (indexB > -1) return 1;
        return keyA.localeCompare(keyB);
    });
    sortedSummary.forEach(([key, value]) => {
        if (key.startsWith('Total') || value > 0) {
            const isClickable = !key.startsWith('Total');
            const card = createSummaryCard(key, value, isClickable);
            elements.summarySection.appendChild(card);
        }
    });
}
  
export function createSummaryCard(title, amount, isClickable) {
      const icons = {
        TotalNeto: "fas fa-balance-scale", TotalCargos: "fas fa-arrow-up-from-bracket", TotalIngresos: "fas fa-hand-holding-usd", Alex: "fas fa-user", Chris: "fas fa-user-friends",
        Sueldos: "fas fa-coins", Deudas: "fas fa-credit-card", Publicidad: "fas fa-bullhorn", Envios: "fas fa-shipping-fast",
        Local: "fas fa-building", Material: "fas fa-box-open", Tecnologia: "fas fa-laptop-code", Devoluciones: "fas fa-undo", GastosFinancieros: "fas fa-percentage", SinCategorizar: "fas fa-question-circle"
      };
      const card = document.createElement('div');
      let displayTitle = title;
      if (title === 'TotalNeto') displayTitle = 'Utilidad Operativa';
      if (title === 'TotalIngresos') displayTitle = 'Ingresos Operativos';
      if (title === 'TotalCargos') displayTitle = 'Cargos Operativos';
      
      card.className = `summary-card ${title.replace(" ", "")} ${isClickable ? 'clickable' : ''}`;
      card.dataset.category = title;
      card.innerHTML = `
        <div class="icon-container"><i class="${icons[title] || 'fas fa-tag'}"></i></div>
        <div> <div class="summary-card-title">${displayTitle}</div> <div class="summary-card-value">${formatCurrency(amount)}</div> </div>`;
      return card;
}
  
export function showCategoryDetailsModal(category, getFilteredExpenses) {
    const allExpenses = getFilteredExpenses().filter(e => (parseFloat(e.charge) || 0) > 0);
    let total = 0;
    const rows = [];
    allExpenses.forEach(e => {
        const parts = getExpenseParts(e);
        parts.forEach(p => {
            if (p.category === category) {
                total += p.amount;
                rows.push(`<tr> <td>${e.date}</td> <td>${e.concept}</td> <td style="text-align: right;">${formatCurrency(p.amount)}</td> </tr>`);
            }
        });
    });
    const tableHtml = `
        <div class="table-container">
            <table>
                <thead> <tr> <th>Fecha</th> <th>Concepto</th> <th style="text-align: right;">Cargo</th> </tr> </thead>
                <tbody>${rows.join('')}</tbody>
                <tfoot> <tr> <td colspan="2">Total</td> <td style="text-align: right;">${formatCurrency(total)}</td> </tr> </tfoot>
            </table>
        </div>`;
    showModal({ title: `Detalles de: ${category}`, body: tableHtml, confirmText: 'Cerrar', showCancel: false });
}
  
export function showModal({ show = true, title, body, onConfirm, onModalOpen, confirmText = 'Confirmar', confirmClass = '', showCancel = true, showConfirm = true }) {
      if (!show) { elements.modal.classList.remove('visible'); return; }
      elements.modalTitle.textContent = title;
      elements.modalBody.innerHTML = body;
      elements.modalConfirmBtn.textContent = confirmText;
      elements.modalConfirmBtn.className = `btn ${confirmClass}`;
      elements.modalConfirmBtn.style.display = showConfirm ? 'inline-flex' : 'none';
      elements.modalCancelBtn.style.display = showCancel ? 'inline-flex' : 'none';
      elements.modalConfirmBtn.onclick = onConfirm ? onConfirm : () => showModal({ show: false });
      elements.modalCancelBtn.onclick = () => showModal({ show: false });
      elements.modal.classList.add('visible');
      if (onModalOpen) onModalOpen();
}

export function showPromptModal({ title, placeholder = '', confirmText = 'Aceptar', value = '' }) {
    return new Promise((resolve) => {
        const { 
            promptModal, promptModalTitle, promptModalInput, promptModalForm, 
            promptModalConfirmBtn, promptModalCancelBtn 
        } = elements;

        promptModalTitle.textContent = title;
        promptModalInput.placeholder = placeholder;
        promptModalInput.value = value;
        promptModalConfirmBtn.textContent = confirmText;

        const cleanup = () => {
            promptModal.classList.remove('visible');
            promptModalForm.onsubmit = null;
            promptModalConfirmBtn.onclick = null;
            promptModalCancelBtn.onclick = null;
            promptModal.onclick = null;
        };

        const handleConfirm = (e) => {
            if (e) e.preventDefault();
            const inputValue = promptModalInput.value.trim();
            if (inputValue) {
                cleanup();
                resolve(inputValue);
            } else {
                promptModalInput.focus();
            }
        };

        const handleCancel = () => {
            cleanup();
            resolve(null);
        };

        promptModalForm.onsubmit = handleConfirm;
        promptModalConfirmBtn.onclick = handleConfirm;
        promptModalCancelBtn.onclick = handleCancel;
        promptModal.onclick = (e) => {
            if (e.target === promptModal) {
                handleCancel();
            }
        };

        promptModal.classList.add('visible');
        setTimeout(() => {
            promptModalInput.focus();
            promptModalInput.select();
        }, 50);
    });
}
  
export function openSplitModal(expense) {
    const total = parseFloat(expense.charge) || 0;
    const existingSplits = expense.splits && expense.splits.length > 0
        ? expense.splits
        : [{ amount: total, category: expense.category || 'SinCategorizar', subcategory: expense.subcategory || '' }];
    const categories = getAllCategories();
    const categoriesWithoutSubcategory = ['Alex', 'Chris', 'Publicidad'];

    const buildCategoryOptions = (selectedCat) => {
        return categories.map(cat => `<option value="${cat}" ${selectedCat === cat ? 'selected' : ''}>${cat}</option>`).join('')
            + '<option value="" disabled>──────────</option><option value="__add_new_category__">+ Nueva categoría...</option>';
    };

    const buildSubcategoryOptions = (category, selectedSub) => {
        if (!category || category === 'SinCategorizar' || categoriesWithoutSubcategory.includes(category)) {
            return null;
        }
        const available = state.subcategories[category] || [];
        let html = '<option value="">-- Seleccionar --</option>';
        html += available.map(sub => `<option value="${sub}" ${selectedSub === sub ? 'selected' : ''}>${sub}</option>`).join('');
        html += '<option value="" disabled>──────────</option>';
        html += '<option value="__add_new__">+ Crear nueva...</option>';
        return html;
    };

    const buildRowHtml = (s, isOnly) => {
        const catOptions = buildCategoryOptions(s.category);
        const subOptionsHtml = buildSubcategoryOptions(s.category, s.subcategory);
        const subSelectHtml = subOptionsHtml
            ? `<select class="modal-input split-subcategory" data-category="${s.category}">${subOptionsHtml}</select>`
            : `<select class="modal-input split-subcategory" data-category="${s.category || ''}" style="display:none;"></select>`;
        return `<div class="split-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
            <input type="number" step="0.01" class="modal-input split-amount" value="${s.amount}" style="width:110px;" placeholder="$0.00">
            <select class="modal-input split-category" style="flex:1;min-width:140px;">${catOptions}</select>
            ${subSelectHtml}
            ${!isOnly ? `<button type="button" class="btn btn-sm remove-split-btn" style="color:var(--danger);padding:4px 8px;"><i class="fas fa-times"></i></button>` : ''}
        </div>`;
    };

    const renderSplitRows = (splits) => splits.map(s => buildRowHtml(s, splits.length === 1)).join('');

    showModal({
        title: `Dividir: ${formatCurrency(total)}`,
        body: `<div style="margin-bottom:12px;font-size:13px;color:var(--text-secondary);">${expense.concept}</div>
               <div id="splits-container">${renderSplitRows(existingSplits)}</div>
               <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
                   <button type="button" id="add-split-btn" class="btn btn-outline btn-sm"><i class="fas fa-plus"></i> Agregar parte</button>
                   <div id="split-remaining" style="font-weight:600;"></div>
               </div>`,
        confirmText: 'Guardar División',
        onConfirm: () => {
            const rows = document.querySelectorAll('.split-row');
            const splits = [];
            rows.forEach(row => {
                const amount = parseFloat(row.querySelector('.split-amount').value) || 0;
                const category = row.querySelector('.split-category').value;
                const subSelect = row.querySelector('.split-subcategory');
                const subcategory = subSelect && subSelect.style.display !== 'none' ? (subSelect.value || '') : '';
                if (amount > 0 && category) splits.push({ amount, category, subcategory });
            });
            const sumSplits = splits.reduce((s, p) => s + p.amount, 0);
            if (Math.abs(sumSplits - total) > 0.02) {
                showToast(`La suma (${formatCurrency(sumSplits)}) no coincide con el total (${formatCurrency(total)})`, 'warning');
                return;
            }
            if (splits.length < 2) {
                // Si queda una sola parte, quitar splits y restaurar categoría normal
                const only = splits[0];
                services.saveExpense({
                    ...expense,
                    splits: null,
                    category: only?.category || expense.category,
                    subcategory: only?.subcategory || ''
                }, expense.category);
            } else {
                services.saveExpense({ ...expense, splits }, expense.category);
            }
        },
        onModalOpen: () => {
            const container = document.getElementById('splits-container');
            const remainingEl = document.getElementById('split-remaining');

            const updateRemaining = () => {
                const amounts = [...container.querySelectorAll('.split-amount')].map(i => parseFloat(i.value) || 0);
                const sum = amounts.reduce((a, b) => a + b, 0);
                const diff = total - sum;
                remainingEl.textContent = `Restante: ${formatCurrency(diff)}`;
                remainingEl.style.color = Math.abs(diff) < 0.02 ? 'var(--success)' : 'var(--danger)';
            };

            const refreshSubcategorySelect = (row) => {
                const catSelect = row.querySelector('.split-category');
                const subSelect = row.querySelector('.split-subcategory');
                const category = catSelect.value;
                const subOptions = buildSubcategoryOptions(category, subSelect.value);
                if (subOptions) {
                    subSelect.innerHTML = subOptions;
                    subSelect.dataset.category = category;
                    subSelect.style.display = '';
                } else {
                    subSelect.innerHTML = '';
                    subSelect.dataset.category = category || '';
                    subSelect.style.display = 'none';
                }
            };

            container.addEventListener('input', updateRemaining);

            container.addEventListener('click', (e) => {
                if (e.target.closest('.remove-split-btn')) {
                    e.target.closest('.split-row').remove();
                    updateRemaining();
                }
            });

            document.getElementById('add-split-btn').addEventListener('click', () => {
                container.insertAdjacentHTML('beforeend', buildRowHtml({ amount: '', category: 'SinCategorizar', subcategory: '' }, false));
                updateRemaining();
            });

            // Handle category / subcategory changes (incl. "+ Nueva..." entries)
            container.addEventListener('change', async (e) => {
                const row = e.target.closest('.split-row');
                if (!row) return;

                if (e.target.classList.contains('split-category')) {
                    if (e.target.value === '__add_new_category__') {
                        const newName = await showPromptModal({ title: 'Nueva categoría', placeholder: 'Nombre', confirmText: 'Crear' });
                        if (newName && newName.trim()) {
                            const trimmed = newName.trim();
                            await services.saveNewCategory(trimmed);
                            if (!state.customCategories.includes(trimmed)) {
                                state.customCategories.push(trimmed);
                                state.customCategories.sort();
                            }
                            // Add to all split category selects
                            container.querySelectorAll('.split-category').forEach(sel => {
                                const opt = document.createElement('option');
                                opt.value = trimmed;
                                opt.textContent = trimmed;
                                sel.insertBefore(opt, sel.querySelector('option[disabled]'));
                            });
                            e.target.value = trimmed;
                        } else {
                            e.target.value = 'SinCategorizar';
                        }
                    }
                    refreshSubcategorySelect(row);
                    return;
                }

                if (e.target.classList.contains('split-subcategory') && e.target.value === '__add_new__') {
                    const parentCategory = e.target.dataset.category;
                    const newSubName = await showPromptModal({
                        title: `Nueva subcategoría para "${parentCategory}"`,
                        placeholder: 'Nombre de la subcategoría',
                        confirmText: 'Crear'
                    });
                    if (newSubName && newSubName.trim()) {
                        const trimmed = newSubName.trim();
                        await services.saveNewSubcategory(trimmed, parentCategory);
                        if (!state.subcategories[parentCategory]) state.subcategories[parentCategory] = [];
                        if (!state.subcategories[parentCategory].includes(trimmed)) {
                            state.subcategories[parentCategory].push(trimmed);
                            state.subcategories[parentCategory].sort();
                        }
                        refreshSubcategorySelect(row);
                        e.target.value = trimmed;
                    } else {
                        e.target.value = '';
                    }
                }
            });

            updateRemaining();
        }
    });
}

export function openExpenseModal(expense = {}) {
    const isEditing = !!expense.id;
    const title = isEditing ? 'Editar Movimiento' : 'Agregar Movimiento Operativo';
    const originalCategory = expense.category || 'SinCategorizar';

    const isFinancial = expense.type === 'financiero';

    const categories = getAllCategories();
    const categoryOptions = categories.map(cat => `<option value="${cat}" ${expense.category === cat ? 'selected' : ''}>${cat}</option>`).join('') + '<option value="" disabled>──────────</option><option value="__add_new_category__">+ Nueva categoría...</option>';

    const channels = ['WhatsApp', 'Instagram', 'Facebook', 'Grupo de Clientes', 'Grupo de Referencias', 'Otro'];
    const channelOptions = channels.map(c => `<option value="${c}" ${expense.channel === c ? 'selected' : ''}>${c}</option>`).join('');

    showModal({
        title: title,
        body: `<form id="expense-form" style="display: grid; gap: 15px;">
                    <div class="form-group">
                        <label for="expense-date">Fecha</label>
                        <input type="date" id="expense-date" class="modal-input" value="${expense.date || new Date().toISOString().split('T')[0]}" required>
                    </div>
                    <div class="form-group">
                        <label for="expense-concept">Concepto</label>
                        <input type="text" id="expense-concept" class="modal-input" placeholder="Concepto del movimiento" value="${expense.concept || ''}" required>
                    </div>
                    <div class="form-group">
                        <label for="expense-charge">Cargo ($)</label>
                        <input type="number" step="0.01" id="expense-charge" class="modal-input" placeholder="$0.00" value="${expense.charge || ''}">
                    </div>
                    <div class="form-group">
                        <label for="expense-credit">Ingreso ($)</label>
                        <input type="number" step="0.01" id="expense-credit" class="modal-input" placeholder="$0.00" value="${expense.credit || ''}">
                    </div>
                    <div class="form-group" id="category-form-group">
                        <label for="expense-category">Categoría</label>
                        <select id="expense-category" class="modal-input">${categoryOptions}</select>
                    </div>
                     <div class="form-group" id="subcategory-form-group" style="display: none;">
                        <label for="expense-subcategory">Subcategoría</label>
                        <select id="expense-subcategory" class="modal-input"></select>
                    </div>
                    <div class="form-group" id="channel-form-group" style="display: none;">
                        <label for="expense-channel">Canal de Venta</label>
                        <select id="expense-channel" class="modal-input">
                            <option value="">No aplica</option>
                            ${channelOptions}
                        </select>
                    </div>
               </form>`,
        confirmText: 'Guardar',
        onConfirm: () => {
            const form = document.getElementById('expense-form');
            if (form.reportValidity()) {
                const creditValue = parseFloat(document.getElementById('expense-credit').value) || 0;
                
                const expenseData = {
                    ...expense, 
                    date: document.getElementById('expense-date').value,
                    concept: document.getElementById('expense-concept').value,
                    charge: parseFloat(document.getElementById('expense-charge').value) || 0,
                    credit: creditValue,
                    type: expense.type || 'operativo',
                    category: '',
                    subcategory: document.getElementById('expense-subcategory')?.value || '',
                    channel: document.getElementById('expense-channel')?.value || '',
                    source: 'manual'
                };
                
                if (expenseData.sub_type === 'pago_intereses') {
                     expenseData.category = 'Gastos Financieros';
                } else if (expenseData.type === 'operativo') {
                     expenseData.category = creditValue > 0 ? '' : document.getElementById('expense-category').value;
                } else {
                    expenseData.category = '';
                }
                
                if (isEditing) expenseData.id = expense.id;
                
                services.saveExpense(expenseData, originalCategory);
            }
        },
        onModalOpen: () => {
            const categoryGroup = document.getElementById('category-form-group');
            const categorySelect = document.getElementById('expense-category');
            const subcategoryGroup = document.getElementById('subcategory-form-group');
            const subcategorySelect = document.getElementById('expense-subcategory');
            const conceptInput = document.getElementById('expense-concept');
            const creditInput = document.getElementById('expense-credit');
            const channelGroup = document.getElementById('channel-form-group');

            const populateSubcategories = () => {
                const selectedCategory = categorySelect.value;
                subcategorySelect.innerHTML = '';
                if (selectedCategory && selectedCategory !== 'SinCategorizar') {
                    const availableSubcategories = state.subcategories[selectedCategory] || [];
                    let optionsHtml = '<option value="">-- Seleccionar --</option>';
                    optionsHtml += availableSubcategories.map(sub => `<option value="${sub}" ${expense.subcategory === sub ? 'selected' : ''}>${sub}</option>`).join('');
                    
                    optionsHtml += '<option value="" disabled>──────────</option>';
                    optionsHtml += '<option value="__add_new__">+ Crear nueva...</option>';
                    
                    subcategorySelect.innerHTML = optionsHtml;
                    subcategorySelect.dataset.category = selectedCategory; 
                    subcategoryGroup.style.display = 'block';
                } else {
                    subcategoryGroup.style.display = 'none';
                }
            };

            const toggleFieldVisibility = () => {
                const creditValue = parseFloat(creditInput.value) || 0;
                const isIncome = creditValue > 0;

                channelGroup.style.display = isIncome ? 'block' : 'none';
                categoryGroup.style.display = isIncome || isFinancial ? 'none' : 'block';
                
                if (isIncome || isFinancial) {
                    subcategoryGroup.style.display = 'none';
                } else {
                    populateSubcategories();
                }

                if(isFinancial && expense.sub_type === 'pago_intereses') {
                    categoryGroup.style.display = 'block';
                    categorySelect.value = 'Gastos Financieros';
                    categorySelect.disabled = true;
                } else if (!isFinancial) {
                    categorySelect.disabled = false;
                }
            };
            
            creditInput.addEventListener('input', toggleFieldVisibility);
            categorySelect.addEventListener('change', async () => {
                if (categorySelect.value === '__add_new_category__') {
                    const newCategoryName = await showPromptModal({
                        title: 'Nueva categoría de gasto',
                        placeholder: 'Nombre de la categoría',
                        confirmText: 'Crear'
                    });
                    if (newCategoryName && newCategoryName.trim() !== '') {
                        const trimmedName = newCategoryName.trim();
                        await services.saveNewCategory(trimmedName);
                        if (!state.customCategories.includes(trimmedName)) {
                            state.customCategories.push(trimmedName);
                            state.customCategories.sort();
                        }
                        const cats = getAllCategories();
                        const opts = cats.map(cat => `<option value="${cat}" ${trimmedName === cat ? 'selected' : ''}>${cat}</option>`).join('') + '<option value="" disabled>──────────</option><option value="__add_new_category__">+ Nueva categoría...</option>';
                        categorySelect.innerHTML = opts;
                        categorySelect.value = trimmedName;
                    } else {
                        categorySelect.value = expense.category || 'SinCategorizar';
                    }
                }
                populateSubcategories();
            });

            subcategorySelect.addEventListener('change', async (e) => {
                if (e.target.value === '__add_new__') {
                    const parentCategory = e.target.dataset.category;
                    const originalSubcategory = expense.subcategory || '';
                    const newSubcategoryName = await showPromptModal({
                        title: `Nueva subcategoría para "${parentCategory}"`,
                        placeholder: 'Nombre de la subcategoría',
                        confirmText: 'Crear'
                    });

                    if (newSubcategoryName) {
                        const trimmedName = newSubcategoryName.trim();
                        await services.saveNewSubcategory(trimmedName, parentCategory);
                        if (!state.subcategories[parentCategory]) {
                           state.subcategories[parentCategory] = [];
                        }
                        if (!state.subcategories[parentCategory].includes(trimmedName)) {
                            state.subcategories[parentCategory].push(trimmedName);
                            state.subcategories[parentCategory].sort();
                        }
                        
                        populateSubcategories();
                        e.target.value = trimmedName;
                    } else {
                        e.target.value = originalSubcategory; 
                    }
                }
            });

            conceptInput.addEventListener('input', () => {
                if (!isFinancial && !(parseFloat(creditInput.value) > 0)) {
                    categorySelect.value = autoCategorize(conceptInput.value);
                    populateSubcategories(); 
                }
            });

            toggleFieldVisibility();
        }
    });
}

export function renderMonthFilter() {
    const select = elements.monthFilterSelect;
    if (!select) return;

    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const today = new Date();
    let optionsHtml = '<option value="" disabled selected>Mes...</option>';

    for (let i = 0; i < 12; i++) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthIndex = date.getMonth();
        const year = date.getFullYear();
        
        const isActive = state.activeMonth && 
                         monthIndex === state.activeMonth.month && 
                         year === state.activeMonth.year;

        const val = `${monthIndex}-${year}`;
        const label = `${monthNames[monthIndex]} '${year.toString().slice(-2)}`;
        
        optionsHtml += `<option value="${val}" ${isActive ? 'selected' : ''}>${label}</option>`;
    }
    
    select.innerHTML = optionsHtml;
}

export function populateCategoryFilter() {
    const categories = getAllCategories();
    const currentCategory = elements.categoryFilter.value;
    elements.categoryFilter.innerHTML = `<option value="all">Todas las categorías</option>`;
    const addNew = document.createElement('option');
    addNew.value = '__add_new_category__';
    addNew.textContent = '+ Nueva categoría...';
    elements.categoryFilter.appendChild(addNew);
    const separator = document.createElement('option');
    separator.disabled = true;
    separator.textContent = '──────────';
    elements.categoryFilter.appendChild(separator);
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        elements.categoryFilter.appendChild(option);
    });
    elements.categoryFilter.value = currentCategory;
}

export function initDateRangePicker(callback) {
    if (elements.dateRangeFilter) {
        return new Litepicker({
            element: elements.dateRangeFilter,
            singleMode: false,
            format: 'MMM D, YYYY',
            plugins: ['ranges'],
            setup: (picker) => {
                picker.on('selected', (date1, date2) => {
                    callback();
                });
            }
        });
    }
}

export function initHealthDateRangePicker(callback) {
    if (elements.healthDateRangeFilter) {
        return new Litepicker({
            element: elements.healthDateRangeFilter,
            singleMode: false,
            format: 'MMM D, YYYY',
            plugins: ['ranges'],
            setup: (picker) => {
                picker.on('selected', (date1, date2) => {
                    callback();
                });
            }
        });
    }
}

export function initSueldosDateRangePicker(callback) {
    if (elements.sueldosDateRangeFilter) {
        return new Litepicker({
            element: elements.sueldosDateRangeFilter,
            singleMode: false,
            format: 'MMM D, YYYY',
            plugins: ['ranges'],
            setup: (picker) => {
                picker.on('selected', (date1, date2) => {
                    callback();
                });
            }
        });
    }
}

export function renderSueldosData() {
    const data = computePayrollFromChecador(state.sueldosPeriod);
    const container = elements.sueldosTableContainer;
    container.innerHTML = '';

    // Update period label
    if (elements.sueldosPeriodLabel) {
        elements.sueldosPeriodLabel.textContent = getChecadorPeriodLabel(state.sueldosPeriod);
    }

    if (data.length === 0) {
        elements.sueldosEmptyState.style.display = 'block';
        return;
    }
    elements.sueldosEmptyState.style.display = 'none';

    let totalMins = 0, totalBasePay = 0, totalAdjSum = 0, totalFinal = 0;

    const rows = data.map(emp => {
        totalMins += emp.minutes;
        totalBasePay += emp.basePay;
        totalAdjSum += emp.adjSum;
        totalFinal += emp.finalPay;

        const adjLabel = emp.adjSum !== 0
            ? `<span style="color:${emp.adjSum > 0 ? 'var(--success)' : 'var(--danger)'}; font-weight:600;">${emp.adjSum > 0 ? '+' : ''}${formatCurrency(emp.adjSum)}</span>`
            : '<span style="color:var(--text-secondary);">—</span>';
        const adjItems = emp.adjustments.map(a => `
            <span style="display:inline-flex; align-items:center; gap:4px; padding:2px 6px; margin:2px 3px 0 0; background:rgba(148,163,184,0.12); border-radius:6px; font-size:11px;">
                <span style="color:${a.type === 'bono' ? 'var(--success)' : 'var(--danger)'}; font-weight:600;">${a.type === 'bono' ? '+' : '-'}$${a.amount}</span>
                ${a.concept ? `<span style="color:var(--text-secondary);">${a.concept}</span>` : ''}
                <button class="sueldos-adj-delete-btn" data-doc-id="${a.docId}" title="Eliminar" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:13px; line-height:1; padding:0 2px;">&times;</button>
            </span>
        `).join('');
        const adjDetail = adjItems ? `<div style="margin-top:4px;">${adjItems}</div>` : '';
        const addBtn = `<button class="sueldos-adj-add-btn" data-name="${emp.name.replace(/"/g, '&quot;')}" title="Agregar bono o descuento" style="margin-left:8px; background:rgba(99,102,241,0.12); color:var(--primary); border:1px solid var(--primary); border-radius:6px; padding:2px 8px; font-size:12px; font-weight:700; cursor:pointer;">+/-</button>`;

        // Botón vacaciones
        const empDoc = state.checadorEmployees.find(e => e.name && e.name.toLowerCase() === emp.name.toLowerCase());
        const hasVac = empDoc && empDoc.vacaciones && empDoc.vacacionesDesde && empDoc.vacacionesHasta;
        const vacLabel = hasVac
            ? `🏖 ${empDoc.vacacionesDesde.slice(5)} → ${empDoc.vacacionesHasta.slice(5)}`
            : '🏖';
        const vacStyle = hasVac
            ? 'background:linear-gradient(135deg,#f59e0b,#d97706); color:#fff; border:none;'
            : 'background:rgba(245,158,11,0.12); color:#d97706; border:1px solid #f59e0b;';
        const vacBtn = `<button class="sueldos-vac-btn" data-name="${emp.name.replace(/"/g, '&quot;')}" title="Vacaciones" style="margin-left:6px; ${vacStyle} border-radius:6px; padding:2px 8px; font-size:12px; font-weight:600; cursor:pointer;">${vacLabel}</button>`;

        return `<tr>
            <td style="font-weight:600;">${capitalize(emp.name)}${vacBtn}</td>
            <td>${emp.days} día${emp.days !== 1 ? 's' : ''}</td>
            <td><button class="sueldos-detail-btn" data-name="${emp.name.replace(/"/g, '&quot;')}" title="Ver detalle de entradas y salidas" style="background:none; border:none; color:var(--primary); font-weight:bold; cursor:pointer; padding:0; text-decoration:underline dotted; text-underline-offset:3px;">${emp.totalStr}</button></td>
            <td style="font-size:12px;color:var(--text-secondary);">$${emp.rate}/hr</td>
            <td>${formatCurrency(emp.basePay)}</td>
            <td>${adjLabel}${addBtn}${adjDetail}</td>
            <td style="font-weight:bold; color:var(--success);">${formatCurrency(emp.finalPay)}</td>
        </tr>`;
    }).join('');

    const totalAdjLabel = totalAdjSum !== 0
        ? `<span style="color:${totalAdjSum > 0 ? 'var(--success)' : 'var(--danger)'}; font-weight:600;">${totalAdjSum > 0 ? '+' : ''}${formatCurrency(totalAdjSum)}</span>`
        : '—';

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>Días</th>
                        <th>Total Horas</th>
                        <th>Tarifa</th>
                        <th>Pago Horas</th>
                        <th>Ajustes</th>
                        <th>Pago Final</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr style="border-top:2px solid var(--border-color);">
                        <td style="font-weight:bold; color:var(--text-secondary);">TOTAL</td>
                        <td></td>
                        <td style="font-weight:bold; color:var(--primary);">${Math.floor(totalMins / 60)}h ${totalMins % 60}m</td>
                        <td></td>
                        <td style="font-weight:600;">${formatCurrency(totalBasePay)}</td>
                        <td>${totalAdjLabel}</td>
                        <td style="font-weight:bold; color:var(--success);">${formatCurrency(totalFinal)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

export function openSueldosAdjModal(name) {
    state.sueldosAdjCurrentName = name;
    state.sueldosAdjCurrentType = 'bono';
    if (elements.sueldosAdjModalTitle) elements.sueldosAdjModalTitle.textContent = capitalize(name);
    if (elements.sueldosAdjAmount) elements.sueldosAdjAmount.value = '';
    if (elements.sueldosAdjConcept) elements.sueldosAdjConcept.value = '';
    updateSueldosAdjTypeButtons();
    renderSueldosAdjExisting();
    if (elements.sueldosAdjModal) elements.sueldosAdjModal.style.display = 'flex';
    setTimeout(() => elements.sueldosAdjAmount?.focus(), 50);
}

export function closeSueldosAdjModal() {
    if (elements.sueldosAdjModal) elements.sueldosAdjModal.style.display = 'none';
}

export function updateSueldosAdjTypeButtons() {
    const type = state.sueldosAdjCurrentType;
    elements.sueldosAdjTypeBtns?.forEach(btn => {
        const isActive = btn.dataset.type === type;
        if (isActive) {
            btn.style.background = type === 'bono'
                ? 'linear-gradient(135deg,#10b981,#059669)'
                : 'linear-gradient(135deg,#ef4444,#dc2626)';
            btn.style.color = '#fff';
            btn.style.border = 'none';
        } else {
            btn.style.background = 'rgba(148,163,184,0.15)';
            btn.style.color = 'var(--text-primary)';
            btn.style.border = '1px solid var(--border-color)';
        }
    });
}

// ========== DETALLE DE ENTRADAS/SALIDAS ==========

const SUELDOS_EDIT_PIN = '0708';

function parseLogDateToParts(dateStr) {
    // "DD/MM/YYYY" -> { d, m, y }
    const parts = String(dateStr || '').split('/');
    if (parts.length !== 3) return null;
    return { d: parseInt(parts[0]), m: parseInt(parts[1]), y: parseInt(parts[2]) };
}

function logDateToDate(dateStr) {
    const p = parseLogDateToParts(dateStr);
    if (!p) return null;
    return new Date(p.y, p.m - 1, p.d);
}

function formatDayLabel(dateStr) {
    const d = logDateToDate(dateStr);
    if (!d) return dateStr;
    const opts = { weekday: 'short', day: 'numeric', month: 'short' };
    return d.toLocaleDateString('es-MX', opts);
}

function getEmployeeDayGroups(name, period) {
    const { start, end } = getChecadorPeriodRange(period);
    const logs = state.checadorLogs;
    const employees = state.checadorEmployees;

    const resolveLogName = (log) => {
        if (log.name) return log.name;
        const emp = employees.find(e => e.id === log.id);
        return emp ? emp.name : (log.id || 'Desconocido');
    };

    const groups = {};
    logs.forEach(log => {
        const logName = resolveLogName(log);
        if ((logName || '').toLowerCase() !== name.toLowerCase()) return;
        const p = parseLogDateToParts(log.date);
        if (!p) return;
        const d = new Date(p.y, p.m - 1, p.d);
        if (d < start || d > end) return;
        if (!groups[log.date]) groups[log.date] = { date: log.date, events: [] };
        groups[log.date].events.push(log);
    });

    // Calcular minutos por día
    return Object.values(groups).map(group => {
        const events = [...group.events].sort((a, b) => a.timestamp - b.timestamp);
        let mins = 0, lastIn = null, hasIn = false;
        events.forEach(e => {
            if (e.type === 'IN') { lastIn = e.timestamp; hasIn = true; }
            else if (e.type === 'OUT' && lastIn) {
                mins += Math.floor((e.timestamp - lastIn) / 60000);
                lastIn = null;
            }
        });
        if (lastIn) {
            const p = parseLogDateToParts(group.date);
            const today = new Date();
            if (p && today.getFullYear() === p.y && today.getMonth() === p.m - 1 && today.getDate() === p.d) {
                mins += Math.floor((Date.now() - lastIn) / 60000);
            }
        }
        return { date: group.date, events, mins, hasIn };
    }).sort((a, b) => {
        const da = logDateToDate(a.date), db = logDateToDate(b.date);
        return db - da; // descendente
    });
}

export function openSueldosDetailModal(name) {
    state.sueldosDetailCurrentName = name;
    if (elements.sueldosDetailModalTitle) {
        elements.sueldosDetailModalTitle.textContent = `Registros — ${capitalize(name)}`;
    }
    renderSueldosDetailBody();
    if (elements.sueldosDetailModal) elements.sueldosDetailModal.style.display = 'flex';
}

export function closeSueldosDetailModal() {
    if (elements.sueldosDetailModal) elements.sueldosDetailModal.style.display = 'none';
}

export function renderSueldosDetailBody() {
    const name = state.sueldosDetailCurrentName;
    if (!name || !elements.sueldosDetailBody) return;
    const groups = getEmployeeDayGroups(name, state.sueldosPeriod);

    if (groups.length === 0) {
        elements.sueldosDetailBody.innerHTML = `
            <p style="color:var(--text-secondary); font-size:0.9rem; margin-bottom:12px;">Sin registros en este período.</p>
            <button class="sueldos-add-day-btn" style="padding:10px 14px; background:var(--primary); color:#fff; border:none; border-radius:10px; cursor:pointer; font-weight:600;">+ Agregar registro</button>
        `;
        return;
    }

    elements.sueldosDetailBody.innerHTML = groups.map(g => {
        const hrs = Math.floor(g.mins / 60);
        const mn = g.mins % 60;
        const entriesHtml = g.events.map(e => {
            const d = new Date(e.timestamp);
            const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            const color = e.type === 'IN' ? 'var(--success)' : '#d97706';
            return `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; margin:2px 3px 0 0; background:rgba(148,163,184,0.12); border-radius:6px; font-size:12px;">
                <span style="color:${color}; font-weight:700;">${e.type}</span>
                <span>${time}</span>
            </span>`;
        }).join('');
        return `<div style="padding:12px; background:rgba(148,163,184,0.06); border:1px solid var(--border-color); border-radius:10px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <div>
                    <strong>${formatDayLabel(g.date)}</strong>
                    <span style="color:var(--text-secondary); font-size:12px; margin-left:8px;">${g.date}</span>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <span style="color:var(--primary); font-weight:700;">${hrs}h ${mn}m</span>
                    <button class="sueldos-edit-day-btn" data-date="${g.date}" style="padding:4px 10px; background:rgba(99,102,241,0.12); color:var(--primary); border:1px solid var(--primary); border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;">Editar</button>
                </div>
            </div>
            <div>${entriesHtml || '<span style="color:var(--text-secondary); font-size:12px;">Sin registros</span>'}</div>
        </div>`;
    }).join('') + `
        <button class="sueldos-add-day-btn" style="margin-top:8px; padding:10px 14px; background:var(--primary); color:#fff; border:none; border-radius:10px; cursor:pointer; font-weight:600;">+ Agregar día</button>
    `;
}

// ========== PIN ==========

export function requirePinThen(callback) {
    state.sueldosPinOnConfirm = callback;
    if (elements.sueldosPinInput) elements.sueldosPinInput.value = '';
    if (elements.sueldosPinModal) elements.sueldosPinModal.style.display = 'flex';
    setTimeout(() => elements.sueldosPinInput?.focus(), 50);
}

export function closeSueldosPinModal() {
    if (elements.sueldosPinModal) elements.sueldosPinModal.style.display = 'none';
    state.sueldosPinOnConfirm = null;
}

export function tryConfirmPin() {
    const val = (elements.sueldosPinInput?.value || '').trim();
    if (val !== SUELDOS_EDIT_PIN) {
        showToast('PIN incorrecto', 'error');
        if (elements.sueldosPinInput) { elements.sueldosPinInput.value = ''; elements.sueldosPinInput.focus(); }
        return;
    }
    const cb = state.sueldosPinOnConfirm;
    closeSueldosPinModal();
    if (typeof cb === 'function') cb();
}

// ========== EDITAR REGISTROS DE UN DÍA ==========

function toHHMM(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

export function openSueldosEditLogModal(name, dateStr /* DD/MM/YYYY */) {
    state.sueldosEditLogName = name;
    state.sueldosEditLogDate = dateStr || '';

    // Resolver empId
    const empDoc = state.checadorEmployees.find(e => e.name && e.name.toLowerCase() === name.toLowerCase());
    state.sueldosEditLogEmpId = empDoc ? empDoc.id : '';

    // Si no hay fecha, usar hoy
    if (!state.sueldosEditLogDate) {
        const now = new Date();
        state.sueldosEditLogDate = `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;
    }

    // Cargar entries existentes
    const logs = state.checadorLogs.filter(l => {
        const lname = l.name || (empDoc && l.id === empDoc.id ? empDoc.name : '');
        return (lname || '').toLowerCase() === name.toLowerCase() && l.date === state.sueldosEditLogDate;
    });
    state.sueldosEditLogEntries = logs
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(l => ({ _docId: l.docId, type: l.type, time: toHHMM(l.timestamp), isNew: false, isDeleted: false }));

    if (elements.sueldosEditLogTitle) elements.sueldosEditLogTitle.textContent = `Editar — ${capitalize(name)}`;
    if (elements.sueldosEditLogSubtitle) elements.sueldosEditLogSubtitle.textContent = `Fecha: ${formatDayLabel(state.sueldosEditLogDate)} (${state.sueldosEditLogDate})`;
    renderSueldosEditLogEntries();
    if (elements.sueldosEditLogModal) elements.sueldosEditLogModal.style.display = 'flex';
}

export function closeSueldosEditLogModal() {
    if (elements.sueldosEditLogModal) elements.sueldosEditLogModal.style.display = 'none';
    state.sueldosEditLogEntries = [];
}

export function renderSueldosEditLogEntries() {
    const container = elements.sueldosEditLogEntries;
    if (!container) return;
    const visible = state.sueldosEditLogEntries
        .map((e, idx) => ({ e, idx }))
        .filter(({ e }) => !e.isDeleted);
    if (visible.length === 0) {
        container.innerHTML = `<p style="color:var(--text-secondary); font-size:0.85rem; text-align:center; padding:16px 0;">Sin registros. Usa los botones de abajo para agregar.</p>`;
        return;
    }
    container.innerHTML = visible.map(({ e, idx }) => {
        const color = e.type === 'IN' ? 'var(--success)' : '#d97706';
        return `<div style="display:flex; align-items:center; gap:10px; padding:10px; background:rgba(148,163,184,0.08); border:1px solid var(--border-color); border-radius:10px; margin-bottom:6px;">
            <span style="color:${color}; font-weight:700; width:55px; font-size:0.85rem;">${e.type}</span>
            <input type="time" class="sueldos-log-time-input" data-idx="${idx}" value="${e.time}" style="flex:1; padding:8px; font-size:0.95rem; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-input, transparent); color:inherit;">
            <button class="sueldos-log-del-btn" data-idx="${idx}" title="Eliminar" style="background:rgba(239,68,68,0.12); color:var(--danger); border:1px solid var(--danger); border-radius:6px; padding:4px 10px; cursor:pointer; font-weight:700;">✕</button>
        </div>`;
    }).join('');
}

export function addSueldosLogEntry(type) {
    const now = new Date();
    state.sueldosEditLogEntries.push({
        _docId: null,
        type,
        time: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
        isNew: true,
        isDeleted: false
    });
    renderSueldosEditLogEntries();
}

export function openSueldosVacModal(name) {
    const empDoc = state.checadorEmployees.find(e => e.name && e.name.toLowerCase() === name.toLowerCase());
    if (!empDoc) {
        showToast(`${capitalize(name)} no está registrado en checador — agrégalo ahí primero`, 'error');
        return;
    }
    state.sueldosVacCurrentDocId = empDoc.id;
    state.sueldosVacCurrentName = empDoc.name;
    if (elements.sueldosVacModalTitle) elements.sueldosVacModalTitle.textContent = `🏖 Vacaciones — ${capitalize(empDoc.name)}`;
    if (elements.sueldosVacDesde) elements.sueldosVacDesde.value = empDoc.vacacionesDesde || '';
    if (elements.sueldosVacHasta) elements.sueldosVacHasta.value = empDoc.vacacionesHasta || '';
    if (elements.sueldosVacRemoveBtn) {
        elements.sueldosVacRemoveBtn.style.display = (empDoc.vacaciones && empDoc.vacacionesDesde) ? 'inline-block' : 'none';
    }
    if (elements.sueldosVacModal) elements.sueldosVacModal.style.display = 'flex';
    setTimeout(() => elements.sueldosVacDesde?.focus(), 50);
}

export function closeSueldosVacModal() {
    if (elements.sueldosVacModal) elements.sueldosVacModal.style.display = 'none';
}

export function renderSueldosAdjExisting() {
    const container = elements.sueldosAdjExisting;
    if (!container) return;
    const name = state.sueldosAdjCurrentName || '';
    const { start, end } = getChecadorPeriodRange(state.sueldosPeriod);
    const adjs = state.checadorAdjustments.filter(a => {
        if ((a.name || '').toLowerCase() !== name.toLowerCase()) return false;
        const d = a.timestamp ? new Date(a.timestamp) : null;
        return d && d >= start && d <= end;
    });

    if (adjs.length === 0) {
        container.innerHTML = '';
        return;
    }

    const periodLabel = state.sueldosPeriod === 'semanal' ? 'esta semana' : 'este mes';
    container.innerHTML = `<div style="font-size:0.7rem; color:var(--text-secondary); margin-bottom:6px; text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Ajustes ${periodLabel}</div>` +
        adjs.map(a => {
            const isBono = a.type === 'bono';
            return `<div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(148,163,184,0.08); border:1px solid var(--border-color); border-radius:8px; margin-bottom:4px; font-size:0.85rem;">
                <div style="flex:1;">
                    <span style="color:${isBono ? 'var(--success)' : 'var(--danger)'}; font-weight:700;">${isBono ? '+' : '-'}$${a.amount}</span>
                    <span style="color:var(--text-secondary); margin-left:8px;">${a.concept || ''}</span>
                </div>
                <button class="sueldos-adj-modal-delete-btn" data-doc-id="${a.docId}" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:1rem; padding:2px 6px;" title="Eliminar">&times;</button>
            </div>`;
        }).join('');
}


export function renderKpisTable() {
    if (!elements.kpisTableBody) return;

    if (elements.kpiSummaryTitle) {
        const today = new Date();
        const monthName = today.toLocaleString('es-MX', { month: 'long' });
        const year = today.getFullYear();
        elements.kpiSummaryTitle.textContent = `Resumen de KPIs del Mes (${capitalize(monthName)} ${year})`;
    }

    elements.kpisTableBody.innerHTML = '';

    const allDates = new Set([
        ...Object.keys(state.monthlyLeads),
        ...Object.keys(state.monthlyPaidLeads),
        ...Object.keys(state.monthlyCancelledLeads),
        ...state.kpis.map(k => k.fecha)
    ]);

    if (allDates.size === 0) {
        elements.kpisEmptyState.style.display = 'block';
        calculateAndDisplayAverages([]); 
        return;
    }

    const combinedData = Array.from(allDates).map(dateString => {
        const leads = state.monthlyLeads[dateString] || 0;
        const paidLeads = state.monthlyPaidLeads[dateString] || 0;
        const cancelledLeads = state.monthlyCancelledLeads[dateString] || 0;
        const revenue = state.monthlyPaidRevenue[dateString] || 0;
        const manualKpi = state.kpis.find(k => k.fecha === dateString) || {};

        return {
            id: manualKpi.id || null,
            fecha: dateString,
            leads: leads,
            paidLeads: paidLeads,
            cancelledLeads: cancelledLeads,
            revenue: revenue,
            costo_publicidad: manualKpi.costo_publicidad || 0
        };
    });
    
    combinedData.sort((a, b) => b.fecha.localeCompare(a.fecha));

    elements.kpisEmptyState.style.display = 'none';

    combinedData.forEach(kpi => {
        const tr = document.createElement('tr');
        const leads = Number(kpi.leads);
        const paidLeads = Number(kpi.paidLeads);
        const cancelledLeads = Number(kpi.cancelledLeads);
        const revenue = Number(kpi.revenue);
        const costoPublicidad = Number(kpi.costo_publicidad);

        const conversionRate = leads > 0 ? ((paidLeads / leads) * 100).toFixed(2) : '0.00';
        const cpl = leads > 0 ? (costoPublicidad / leads).toFixed(2) : '0.00';
        const cpv = paidLeads > 0 ? (costoPublicidad / paidLeads).toFixed(2) : '0.00';

        tr.innerHTML = `
            <td>${kpi.fecha}</td>
            <td>${leads}</td>
            <td>${paidLeads}</td>
            <td>${cancelledLeads}</td>
            <td>${formatCurrency(revenue)}</td>
            <td>${formatCurrency(costoPublicidad)}</td>
            <td>${formatCurrency(cpl)}</td>
            <td>${formatCurrency(cpv)}</td>
            <td>${conversionRate}%</td>
            <td class="btn-group">
                <button class="btn btn-outline btn-sm edit-kpi-btn" data-fecha="${kpi.fecha}"><i class="fas fa-pencil-alt"></i></button>
                <button class="btn btn-outline btn-sm delete-kpi-btn" data-id="${kpi.id || ''}" style="color:var(--danger);" ${!kpi.id ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
            </td>
        `;
        elements.kpisTableBody.appendChild(tr);
    });

    calculateAndDisplayAverages(combinedData);
}

function calculateAndDisplayAverages(data) {
    if (data.length === 0) {
        if (elements.kpiTotalLeads) elements.kpiTotalLeads.textContent = '0';
        if (elements.kpiTotalPaidLeads) elements.kpiTotalPaidLeads.textContent = '0';
        if (elements.kpiTotalCancelledLeads) elements.kpiTotalCancelledLeads.textContent = '0';
        if (elements.kpiTotalRevenueKpis) elements.kpiTotalRevenueKpis.textContent = formatCurrency(0);
        if (elements.kpiTotalAdCost) elements.kpiTotalAdCost.textContent = formatCurrency(0);
        if (elements.kpiAvgCpl) elements.kpiAvgCpl.textContent = formatCurrency(0);
        if (elements.kpiAvgCpvKpis) elements.kpiAvgCpvKpis.textContent = formatCurrency(0);
        if (elements.kpiAvgConversionRateKpis) elements.kpiAvgConversionRateKpis.textContent = '0%';
        return;
    }

    const totals = data.reduce((acc, day) => {
        acc.leads += day.leads;
        acc.paidLeads += day.paidLeads;
        acc.cancelledLeads += day.cancelledLeads;
        acc.revenue += day.revenue;
        acc.adCost += day.costo_publicidad;
        return acc;
    }, { leads: 0, paidLeads: 0, revenue: 0, adCost: 0, cancelledLeads: 0 });

    const avgCpl = totals.leads > 0 ? totals.adCost / totals.leads : 0;
    const avgCpv = totals.paidLeads > 0 ? totals.adCost / totals.paidLeads : 0;
    const avgConversionRate = totals.leads > 0 ? (totals.paidLeads / totals.leads) * 100 : 0;

    if (elements.kpiTotalLeads) elements.kpiTotalLeads.textContent = totals.leads;
    if (elements.kpiTotalPaidLeads) elements.kpiTotalPaidLeads.textContent = totals.paidLeads;
    if (elements.kpiTotalCancelledLeads) elements.kpiTotalCancelledLeads.textContent = totals.cancelledLeads;
    
    if (elements.kpiTotalRevenueKpis) elements.kpiTotalRevenueKpis.textContent = formatCurrency(totals.revenue);
    if (elements.kpiTotalAdCost) elements.kpiTotalAdCost.textContent = formatCurrency(totals.adCost);

    if (elements.kpiAvgCpl) elements.kpiAvgCpl.textContent = formatCurrency(avgCpl);
    if (elements.kpiAvgCpvKpis) elements.kpiAvgCpvKpis.textContent = formatCurrency(avgCpv);
    if (elements.kpiAvgConversionRateKpis) elements.kpiAvgConversionRateKpis.textContent = `${avgConversionRate.toFixed(2)}%`;
}

export function openKpiModal(kpi = {}) {
    const isEditing = !!kpi.id;
    const title = isEditing ? `Editar Registro de KPI para ${kpi.fecha}` : `Agregar Registro para ${kpi.fecha}`;
    const revenueFromState = state.monthlyPaidRevenue[kpi.fecha] || 0;

    showModal({
        title: title,
        body: `<form id="kpi-form" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <input type="hidden" id="kpi-fecha" value="${kpi.fecha}">
                    <div class="form-group">
                        <label for="kpi-leads">Leads (Automático)</label>
                        <input type="number" id="kpi-leads" class="modal-input" value="${kpi.leads || 0}" disabled>
                    </div>
                    <div class="form-group">
                        <label for="kpi-paid-leads">Leads Pagados (Automático)</label>
                        <input type="number" id="kpi-paid-leads" class="modal-input" value="${kpi.paidLeads || 0}" disabled>
                    </div>
                     <div class="form-group">
                        <label for="kpi-revenue">Ingresos (Automático)</label>
                        <input type="text" id="kpi-revenue" class="modal-input" value="${formatCurrency(revenueFromState)}" disabled>
                    </div>
                    <div class="form-group">
                        <label for="kpi-costo">Costo Publicidad ($)</label>
                        <input type="number" step="0.01" id="kpi-costo" class="modal-input" placeholder="0.00" value="${kpi.costo_publicidad || ''}">
                    </div>
               </form>`,
        confirmText: 'Guardar',
        onConfirm: () => {
            const form = document.getElementById('kpi-form');
            if (form.reportValidity()) {
                const kpiData = {
                    id: kpi.id,
                    fecha: document.getElementById('kpi-fecha').value,
                    costo_publicidad: Number(document.getElementById('kpi-costo').value) || 0,
                };
                services.saveKpi(kpiData);
            }
        }
    });
}

export function openMetaSyncModal() {
    const savedAdAccount = localStorage.getItem('meta_ad_account_id') || '';
    const savedToken = localStorage.getItem('meta_access_token') || '';
    
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

    showModal({
        title: 'Sincronizar Gastos de Meta Ads',
        body: `
            <div style="margin-bottom: 15px; font-size: 13px; color: var(--text-secondary);">
                Ingresa tu ID de cuenta publicitaria (ej. <code>act_12345678</code>) y tu Token de Acceso (System User o Graph API Explorer).
            </div>
            <form id="meta-sync-form" style="display: grid; gap: 15px;">
                <div class="form-group">
                    <label for="meta-account-id">Ad Account ID (comienza con 'act_')</label>
                    <input type="text" id="meta-account-id" class="modal-input" placeholder="act_1234567890" value="${savedAdAccount}" required>
                </div>
                <div class="form-group">
                    <label for="meta-token">Access Token</label>
                    <input type="password" id="meta-token" class="modal-input" placeholder="EAA..." value="${savedToken}" required>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div class="form-group">
                        <label for="meta-start-date">Desde</label>
                        <input type="date" id="meta-start-date" class="modal-input" value="${firstDay}" required>
                    </div>
                    <div class="form-group">
                        <label for="meta-end-date">Hasta</label>
                        <input type="date" id="meta-end-date" class="modal-input" value="${lastDay}" required>
                    </div>
                </div>
            </form>
        `,
        confirmText: 'Sincronizar',
        onConfirm: async () => {
            const form = document.getElementById('meta-sync-form');
            if (form.reportValidity()) {
                const accountId = document.getElementById('meta-account-id').value.trim();
                const token = document.getElementById('meta-token').value.trim();
                const startDate = document.getElementById('meta-start-date').value;
                const endDate = document.getElementById('meta-end-date').value;

                localStorage.setItem('meta_ad_account_id', accountId);
                localStorage.setItem('meta_access_token', token);

                await services.syncMetaSpend(accountId, token, startDate, endDate);
            }
        }
    });
}

function openAdjustmentModal(employeeId, type) {
    const employee = state.sueldosData.find(emp => emp.id === employeeId);
    if (!employee) return;

    const isBono = type === 'bono';
    const title = isBono ? 'Agregar Bono' : 'Agregar Gasto/Descuento';
    const amountLabel = isBono ? 'Monto del Bono ($)' : 'Monto del Gasto ($)';

    const body = `
        <form id="adjustment-form" style="display: grid; gap: 15px;">
            <input type="hidden" id="adjustment-employee-id" value="${employeeId}">
            <div class="form-group">
                <label for="adjustment-date">Fecha</label>
                <input type="date" id="adjustment-date" class="modal-input" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-group">
                <label for="adjustment-concept">Concepto</label>
                <input type="text" id="adjustment-concept" class="modal-input" placeholder="${isBono ? 'Ej: Bono de puntualidad' : 'Ej: Adelanto de sueldo'}" required>
            </div>
            <div class="form-group">
                <label for="adjustment-amount">${amountLabel}</label>
                <input type="number" step="0.01" id="adjustment-amount" class="modal-input" placeholder="$0.00" required>
            </div>
        </form>
    `;

    showModal({
        title: `${title} para ${capitalize(employee.name)}`,
        body: body,
        confirmText: 'Guardar',
        onConfirm: () => {
            const form = document.getElementById('adjustment-form');
            if (form.reportValidity()) {
                const adjustmentData = {
                    date: document.getElementById('adjustment-date').value,
                    concept: document.getElementById('adjustment-concept').value,
                    amount: parseFloat(document.getElementById('adjustment-amount').value) || 0,
                };
                services.saveAdjustment(employeeId, type, adjustmentData);
            }
        }
    });
}

export function openBonoModal(employeeId) {
    openAdjustmentModal(employeeId, 'bono');
}

export function openGastoModal(employeeId) {
    openAdjustmentModal(employeeId, 'gasto');
}

export function openAddEmployeeModal() {
    showModal({
        title: 'Agregar Nuevo Empleado',
        body: `
            <div class="form-group">
                <label for="new-employee-name">Nombre Completo</label>
                <input type="text" id="new-employee-name" class="modal-input" placeholder="Nombre completo del empleado" required>
            </div>
            <div class="form-group" style="margin-top: 15px;">
                <label for="new-employee-rate">Tarifa por Hora ($)</label>
                <input type="number" id="new-employee-rate" class="modal-input" value="70" step="0.01">
            </div>
        `,
        confirmText: 'Agregar',
        onConfirm: async () => {
            const nameInput = document.getElementById('new-employee-name');
            const name = nameInput.value.trim();
            const rate = parseFloat(document.getElementById('new-employee-rate').value) || 70;
            
            if (!name) {
                nameInput.classList.add('error');
                return;
            }
            
            const employeeId = name.toLowerCase().replace(/\s+/g, '_');
            
            // Check if already exists
            if (state.sueldosData.find(e => e.id === employeeId)) {
                showToast("Este empleado ya existe.", "warning");
                return;
            }
            
            const newEmployee = {
                id: employeeId,
                name: name,
                ratePerHour: rate,
                registros: [],
                bonos: [],
                descuentos: [],
                paymentHistory: []
            };
            
            const updatedEmployees = [...state.sueldosData, newEmployee];
            await services.saveSueldosDataToFirestore(updatedEmployees);
            showModal({ show: false });
            showToast(`Empleado ${name} agregado.`);
        }
    });
}

export function generateReportPdf(employee) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const margin = 20;
    let y = 30;

    // Header
    doc.setFontSize(22);
    doc.setTextColor(30, 64, 175); // Primary color
    doc.text("Resumen de Pago", margin, y);
    y += 15;

    doc.setFontSize(12);
    doc.setTextColor(100, 116, 139);
    doc.text(`Empleado: ${employee.name}`, margin, y);
    doc.text(`Fecha: ${new Date().toLocaleDateString()}`, doc.internal.pageSize.getWidth() - margin - 40, y);
    y += 20;

    // Table Header
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    doc.text("Detalle de Asistencia", margin, y);
    y += 10;

    doc.setFontSize(10);
    doc.text("Día", margin, y);
    doc.text("Entrada", margin + 40, y);
    doc.text("Salida", margin + 80, y);
    doc.text("Horas", margin + 120, y);
    y += 5;
    doc.line(margin, y, doc.internal.pageSize.getWidth() - margin, y);
    y += 10;

    const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    dayNames.forEach(day => {
        const reg = (employee.registros || []).find(r => r.day === day) || { entrada: '--', salida: '--', horas: '0.00' };
        doc.text(day, margin, y);
        doc.text(reg.entrada, margin + 40, y);
        doc.text(reg.salida, margin + 80, y);
        doc.text(reg.horas, margin + 120, y);
        y += 8;
    });

    y += 10;
    doc.line(margin, y, doc.internal.pageSize.getWidth() - margin, y);
    y += 15;

    // Totals
    doc.setFontSize(14);
    doc.text("Resumen Económico", margin, y);
    y += 10;

    doc.setFontSize(11);
    doc.text(`Total Horas: ${employee.totalHoursFormatted || '0.00'} hrs`, margin, y);
    doc.text(`Subtotal: ${formatCurrency(employee.subtotal || 0)}`, margin + 80, y);
    y += 10;

    if (employee.bonos?.length > 0) {
        doc.text(`Bonos: ${formatCurrency(employee.totalBonos)}`, margin + 80, y);
        y += 8;
    }
    if (employee.descuentos?.length > 0) {
        doc.text(`Descuentos: -${formatCurrency(employee.totalGastos)}`, margin + 80, y);
        y += 8;
    }

    y += 5;
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(`TOTAL A PAGAR: ${formatCurrency(employee.pago || 0)}`, margin + 80, y);

    // Save
    doc.save(`Recibo_Pago_${employee.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast("PDF generado con éxito.");
}

export function renderNotes(content) {
    if (elements.notesEditor && elements.notesEditor.innerHTML !== content) {
        elements.notesEditor.innerHTML = content;
    }
}

export function showNotesSaveStatus(text) {
    if (!elements.notesSaveStatus) return;
    const statusEl = elements.notesSaveStatus;
    statusEl.textContent = text;
    statusEl.style.opacity = '1';
    
    if (text === 'Guardado') {
        setTimeout(() => {
            if (statusEl.textContent === 'Guardado') {
                 statusEl.style.opacity = '0';
            }
        }, 2000); 
    }
}

export function showDuplicateSelectionModal(duplicateGroups, nonDuplicates) {
    let duplicateHtml = duplicateGroups.map((group, index) => {
        const header = `
            <tr class="group-header">
                <td colspan="5">
                    <strong>${group.reason}</strong> (Firma: ${group.signature})
                </td>
            </tr>`;
        const rows = group.expenses.map((exp, expIndex) => `
            <tr data-group-index="${index}" data-expense-index="${expIndex}">
                <td><input type="checkbox" class="duplicate-checkbox" data-expense-sig="${group.signature}"></td>
                <td>${exp.date}</td>
                <td>${exp.concept}</td>
                <td>${formatCurrency(exp.charge)}</td>
                <td>${formatCurrency(exp.credit)}</td>
            </tr>`).join('');
        return header + rows;
    }).join('');

    const body = `
        <p>Se encontraron ${duplicateGroups.length} grupos de registros duplicados. Por favor, revisa y selecciona los que deseas importar.</p>
        <div class="table-container" style="max-height: 40vh; margin-top: 15px;">
            <table class="duplicate-table">
                <thead>
                    <tr>
                        <th><input type="checkbox" id="select-all-duplicates"></th>
                        <th>Fecha</th>
                        <th>Concepto</th>
                        <th>Cargo</th>
                        <th>Ingreso</th>
                    </tr>
                </thead>
                <tbody>
                    ${duplicateHtml}
                </tbody>
            </table>
        </div>
        <p style="margin-top: 10px;">Se importarán <strong>${nonDuplicates.length}</strong> registros no duplicados automáticamente.</p>
    `;

    showModal({
        title: 'Confirmar Duplicados',
        body: body,
        confirmText: 'Importar Selección',
        showCancel: true,
        onConfirm: async () => {
            const expensesToAddFromDuplicates = [];
            
            document.querySelectorAll('.duplicate-checkbox:checked').forEach(checkbox => {
                const row = checkbox.closest('tr');
                const groupIndex = row.dataset.groupIndex;
                const expenseIndex = row.dataset.expenseIndex;
                
                if (groupIndex !== undefined && expenseIndex !== undefined) {
                    const group = duplicateGroups[groupIndex];
                    const expense = group.expenses[expenseIndex];
                    if (expense && !expensesToAddFromDuplicates.includes(expense)) {
                       expensesToAddFromDuplicates.push(expense);
                    }
                }
            });

            try {
                await services.saveBulkExpenses([...nonDuplicates, ...expensesToAddFromDuplicates]);
                showModal({
                    title: 'Éxito',
                    body: `Se importaron ${nonDuplicates.length} registros únicos y ${expensesToAddFromDuplicates.length} duplicados seleccionados.`,
                    confirmText: 'Entendido',
                    showCancel: false
                });
            } catch (e) {
                 showModal({
                    title: 'Error',
                    body: `Error al guardar: ${e.message}`,
                    confirmText: 'Cerrar',
                    showCancel: false
                });
            }
        },
        onModalOpen: () => {
            document.getElementById('select-all-duplicates').addEventListener('change', (e) => {
                document.querySelectorAll('.duplicate-checkbox').forEach(cb => {
                    cb.checked = e.target.checked;
                });
            });
        }
    });
}

// --- TOAST NOTIFICATIONS --- //
export function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // Iconos según el tipo
    let iconClass = 'fas fa-check-circle'; // success by default
    if (type === 'error') iconClass = 'fas fa-exclamation-circle';
    if (type === 'warning') iconClass = 'fas fa-exclamation-triangle';

    toast.innerHTML = `<i class="${iconClass}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    // Ocultar e inyectar animación de salida despues de 3 segundos
    setTimeout(() => {
        toast.classList.add('hide');
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, 3000);
}

// --- DARK MODE & THEME PICKER --- //
export function initDarkMode() {
    const toggleBtn = document.getElementById('theme-toggle');
    const body = document.body;
    const isDark = localStorage.getItem('darkMode') === 'true';

    // Aplicar estado inicial dark mode
    if (isDark) {
        body.classList.add('dark-mode');
        if(toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            body.classList.toggle('dark-mode');
            const isNowDark = body.classList.contains('dark-mode');
            localStorage.setItem('darkMode', isNowDark);
            toggleBtn.innerHTML = isNowDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        });
    }

    // --- Theme Picker ---
    const pickerBtn = document.getElementById('theme-picker-btn');
    const dropdown = document.getElementById('theme-picker-dropdown');
    if (!pickerBtn || !dropdown) return;

    // Aplicar tema guardado
    const savedTheme = localStorage.getItem('colorTheme') || 'default';
    applyColorTheme(savedTheme);

    pickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    dropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.theme-option');
        if (!option) return;
        const theme = option.dataset.theme;
        applyColorTheme(theme);
        localStorage.setItem('colorTheme', theme);
        dropdown.classList.remove('open');
    });

    // Cerrar dropdown al hacer clic fuera
    document.addEventListener('click', () => dropdown.classList.remove('open'));
}

function applyColorTheme(theme) {
    const body = document.body;
    const allThemes = ['theme-blue', 'theme-emerald', 'theme-charcoal'];
    body.classList.remove(...allThemes);

    if (theme !== 'default') {
        body.classList.add(`theme-${theme}`);
    }

    // Actualizar estado activo en el dropdown
    const options = document.querySelectorAll('.theme-option');
    options.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.theme === theme);
    });
}