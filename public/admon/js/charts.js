import { elements, state, charts } from './state.js';
import { formatCurrency } from './utils.js';

/**
 * @file Módulo de gestión de gráficas.
 */

// Valor de ajuste solicitado para visualización de ingresos
const INCOME_ADJUSTMENT = 19183.22;

/**
 * Actualiza todas las gráficas principales de la aplicación.
 */
export function updateAllCharts(getFilteredExpenses) {
    const expenses = getFilteredExpenses().filter(e => e.type === 'operativo' || !e.type || e.sub_type === 'pago_intereses');
    
    // AJUSTE: Reflejar la resta en el total usado para porcentajes en gráficas
    const totalIncomeRaw = expenses.reduce((acc, exp) => acc + (parseFloat(exp.credit) || 0), 0);
    const totalIncomeAdjusted = Math.max(0, totalIncomeRaw - INCOME_ADJUSTMENT);

    const categories = {};
    expenses.forEach(expense => {
        const charge = parseFloat(expense.charge) || 0;
        if (charge > 0) {
            const category = expense.category || 'SinCategorizar';
            if (!categories[category]) categories[category] = 0;
            categories[category] += charge;
        }
    });
    
    const sorted = Object.entries(categories).sort(([,a],[,b]) => b-a);
    const labels = sorted.map(([key]) => key);
    const values = sorted.map(([,val]) => val);
    const colors = labels.map(label => getComputedStyle(document.documentElement).getPropertyValue(`--c-${label.toLowerCase().replace(/ /g, '')}`).trim() || '#9ca3af');
    
    if (elements.chartContexts.pie) {
        if (charts.pieChart) charts.pieChart.destroy();
        charts.pieChart = new Chart(elements.chartContexts.pie, getChartConfig('pie', labels, values, colors, 'Distribución de Gastos Operativos', totalIncomeAdjusted));
    }
    if (elements.chartContexts.category) {
        if (charts.categoryChart) charts.categoryChart.destroy();
         charts.categoryChart = new Chart(elements.chartContexts.category, getChartConfig('bar', labels, values, colors, 'Gastos Operativos por Categoría'));
    }
    if (elements.chartContexts.compare) {
        if (charts.compareChart) charts.compareChart.destroy();
        charts.compareChart = new Chart(elements.chartContexts.compare, getCompareChartConfig(categories['Alex'] || 0, categories['Chris'] || 0));
    }
}

function getChartConfig(type, labels, values, colors, title, totalForPercentage) {
    const totalExpenses = values.reduce((acc, value) => acc + value, 0);
    const totalForCalc = (totalForPercentage !== undefined && totalForPercentage > 0) ? totalForPercentage : totalExpenses;

    return {
        type: type,
        data: {
            labels: labels,
            datasets: [{ label: 'Total', data: values, backgroundColor: colors, borderColor: type === 'pie' || type === 'doughnut' ? '#fff' : 'transparent', borderWidth: 2 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { 
                    display: type === 'pie' || type === 'doughnut', 
                    position: 'right' 
                },
                title: { 
                    display: true, 
                    text: title, 
                    font: { size: 16 } 
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.label || '';
                            const value = context.raw;
                            const percentage = totalForCalc > 0 ? ((value / totalForCalc) * 100).toFixed(2) : 0;
                            return `${label}: ${formatCurrency(value)} (${percentage}%)`;
                        }
                    }
                }
            },
            scales: { 
                y: { beginAtZero: true, display: type !== 'pie' && type !== 'doughnut' }, 
                x: { display: type !== 'pie' && type !== 'doughnut' } 
            }
        }
    }
}
  
function getCompareChartConfig(alexTotal, chrisTotal) {
    return {
        type: 'bar',
        data: {
            labels: ['Alex', 'Chris'],
            datasets: [{ label: 'Total Gasto', data: [alexTotal, chrisTotal], backgroundColor: [getComputedStyle(document.documentElement).getPropertyValue('--c-alex').trim(), getComputedStyle(document.documentElement).getPropertyValue('--c-chris').trim()] }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            plugins: { legend: { display: false }, title: { display: true, text: 'Comparación: Alex vs Chris', font: { size: 16 } },
                tooltip: { callbacks: { label: c => formatCurrency(c.raw) } }
            },
            scales: { x: { ticks: { callback: v => formatCurrency(v) } } } 
        }
    };
}

/**
 * Actualiza el dashboard de salud financiera.
 */
export function updateFinancialHealthDashboard(getFilteredExpenses) {
    const expenses = getFilteredExpenses(true);
    const { totalOrdersCount, paidOrdersCount, paidOrdersRevenue, totalLeads } = state.financials;
    const cogsCategories = ['Material', 'Sueldos'];
    const drawCategories = ['Alex', 'Chris'];

    const incomeTransactions = expenses.filter(exp => {
        const isOperational = exp.type === 'operativo' || !exp.type;
        return isOperational && (parseFloat(exp.credit) || 0) > 0;
    });

    const totalRawRevenue = incomeTransactions.reduce((acc, exp) => acc + exp.credit, 0);
    // AJUSTE: Restar visualmente en el Dashboard de Salud Financiera
    const totalAccountingRevenue = Math.max(0, totalRawRevenue - INCOME_ADJUSTMENT);
    
    let ownerDraw = 0;
    let cogs = 0;
    let operatingExpenses = 0;

    expenses.forEach(exp => {
        const charge = parseFloat(exp.charge) || 0;
        if (charge > 0) {
            const isOperational = exp.type === 'operativo' || !exp.type;
            if (drawCategories.includes(exp.category)) {
                ownerDraw += charge;
            } 
            else if (isOperational || exp.sub_type === 'pago_intereses') {
                if (cogsCategories.includes(exp.category)) {
                    cogs += charge;
                } else {
                    operatingExpenses += charge;
                }
            }
        }
    });
    
    const totalBusinessCosts = cogs + operatingExpenses;
    const operatingProfit = totalAccountingRevenue - totalBusinessCosts; 
    const netProfit = operatingProfit - ownerDraw; 
    const operatingMargin = totalAccountingRevenue === 0 ? 0 : (operatingProfit / totalAccountingRevenue) * 100;

    const avgTicketSales = paidOrdersCount > 0 ? paidOrdersRevenue / paidOrdersCount : 0;
    const conversionRate = totalOrdersCount > 0 ? (paidOrdersCount / totalOrdersCount) * 100 : 0;

    elements.kpiTotalRevenue.textContent = formatCurrency(totalAccountingRevenue);
    elements.kpiSalesRevenue.textContent = formatCurrency(paidOrdersRevenue);
    elements.kpiCosts.textContent = formatCurrency(totalBusinessCosts);
    elements.kpiOperatingProfit.textContent = formatCurrency(operatingProfit);
    elements.kpiOwnerDraw.textContent = formatCurrency(ownerDraw);
    elements.kpiNetProfit.textContent = formatCurrency(netProfit);
    elements.kpiLeads.textContent = totalLeads;
    elements.kpiPaidOrders.textContent = paidOrdersCount;
    elements.kpiAvgTicketSales.textContent = formatCurrency(avgTicketSales); 
    elements.kpiConversionRate.textContent = `${conversionRate.toFixed(2)}%`; 

    elements.kpiOperatingProfit.classList.toggle('positive', operatingProfit >= 0);
    elements.kpiOperatingProfit.classList.toggle('negative', operatingProfit < 0);
    elements.kpiNetProfit.classList.toggle('positive', netProfit >= 0);
    elements.kpiNetProfit.classList.toggle('negative', netProfit < 0);

    const thermometerPercentage = 50 + (operatingMargin * 2.5);
    const clampedPercentage = Math.max(0, Math.min(100, thermometerPercentage));
    elements.thermometerBar.style.width = `${clampedPercentage}%`;
    elements.thermometerPercentage.textContent = `${operatingMargin.toFixed(1)}%`;
    
    updateLeadsTrendChart();
    updateIncomeVsAdCostChart();
}
  
export function updateLeadsTrendChart() {
    if (!elements.chartContexts.leadsTrend) return;
    if (charts.leadsTrendChart) {
        charts.leadsTrendChart.destroy();
    }
    
    const allOrders = state.financials.allOrders || [];
    const timeframe = state.financials.leadsChartTimeframe;
    
    let leadsByTime = {};
    let paidByTime = {};
    let title;

    if (timeframe === 'daily') {
        title = 'Tendencia de Leads vs. Pagados (Diario)';
        allOrders.forEach(doc => {
            const data = doc.data();
            if (data.createdAt && data.createdAt.toDate) {
                const date = data.createdAt.toDate();
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const dayOfMonth = String(date.getDate()).padStart(2, '0');
                const day = `${year}-${month}-${dayOfMonth}`;
                
                leadsByTime[day] = (leadsByTime[day] || 0) + 1;
                if (data.estatus === 'Pagado') {
                    paidByTime[day] = (paidByTime[day] || 0) + 1;
                }
            }
        });
    } else { 
        title = 'Tendencia de Leads vs. Pagados (Mensual)';
        allOrders.forEach(doc => {
            const data = doc.data();
            if (data.createdAt && data.createdAt.toDate) {
                const date = data.createdAt.toDate();
                const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                leadsByTime[month] = (leadsByTime[month] || 0) + 1;
                 if (data.estatus === 'Pagado') {
                    paidByTime[month] = (paidByTime[month] || 0) + 1;
                }
            }
        });
    }

    const sortedLabels = Object.keys(leadsByTime).sort((a, b) => new Date(a) - new Date(b));
    const leadsData = sortedLabels.map(label => leadsByTime[label] || 0);
    const paidData = sortedLabels.map(label => paidByTime[label] || 0);

    charts.leadsTrendChart = new Chart(elements.chartContexts.leadsTrend, {
        type: 'bar',
        data: {
            labels: sortedLabels,
            datasets: [
                {
                    label: 'Leads',
                    data: leadsData,
                    backgroundColor: 'rgba(59, 130, 246, 0.7)',
                    borderColor: 'var(--primary)',
                    borderWidth: 1
                },
                {
                    label: 'Pagados',
                    data: paidData,
                    backgroundColor: 'rgba(22, 163, 74, 0.7)',
                    borderColor: 'var(--success)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: false },
                legend: { display: true, position: 'top' }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
    elements.leadsChartTitle.textContent = title;
}

export function updateIncomeVsAdCostChart() {
    if (!elements.chartContexts.incomeVsAdCost) return;
    if (charts.incomeVsAdCostChart) {
        charts.incomeVsAdCostChart.destroy();
    }

    const allDates = new Set([
        ...Object.keys(state.monthlyPaidRevenue),
        ...state.kpis.map(k => k.fecha)
    ]);

    const sortedLabels = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));

    const revenueData = sortedLabels.map(date => {
        const rawRevenue = state.monthlyPaidRevenue[date] || 0;
        // AJUSTE: Podríamos restar el ajuste proporcionalmente o dejarlo igual.
        // Por consistencia visual, aquí también aplicamos la resta si es el total.
        // Como este gráfico suele ser por día, la resta global aquí no se aplica directamente
        // pero podemos restar el INCOME_ADJUSTMENT si es la vista de resumen mensual.
        return Math.max(0, rawRevenue); 
    });

    const adCostData = sortedLabels.map(date => {
        const kpi = state.kpis.find(k => k.fecha === date);
        return kpi ? (kpi.costo_publicidad || 0) : 0;
    });
    
    charts.incomeVsAdCostChart = new Chart(elements.chartContexts.incomeVsAdCost, {
        type: 'bar',
        data: {
            labels: sortedLabels,
            datasets: [
                {
                    label: 'Ingresos',
                    data: revenueData,
                    backgroundColor: 'rgba(22, 163, 74, 0.7)',
                    yAxisID: 'y',
                },
                {
                    label: 'Costo Publicidad',
                    data: adCostData,
                    backgroundColor: 'rgba(239, 68, 68, 0.7)',
                    yAxisID: 'y',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: { display: false },
                legend: { display: true, position: 'top' }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                },
            }
        }
    });
}