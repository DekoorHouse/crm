let spendConversionsChart = null;
let spendByCampaignChart = null;

function getChartColors() {
    const isDark = document.body.classList.contains('dark-mode');
    return {
        textColor: isDark ? '#b0b3b8' : '#65676b',
        gridColor: isDark ? 'rgba(58,59,60,0.4)' : 'rgba(226,232,240,0.6)',
        spendColor: '#1877f2',
        conversionsColor: '#42b72a',
        barColors: ['#1877f2', '#42b72a', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']
    };
}

function baseOptions(colors) {
    return {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: { labels: { color: colors.textColor, font: { family: 'Inter', size: 12 } } }
        },
        scales: {
            x: { ticks: { color: colors.textColor, font: { size: 11 } }, grid: { color: colors.gridColor } },
            y: { ticks: { color: colors.textColor, font: { size: 11 } }, grid: { color: colors.gridColor } }
        }
    };
}

export function renderSpendConversionsChart(ctx, dailyData) {
    if (spendConversionsChart) spendConversionsChart.destroy();
    if (!dailyData || dailyData.length === 0) return;

    const colors = getChartColors();
    const labels = dailyData.map(d => d.date_start ? new Date(d.date_start).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }) : '');
    const spendData = dailyData.map(d => parseFloat(d.spend) || 0);
    const convData = dailyData.map(d => {
        if (!d.actions) return 0;
        const c = d.actions.find(a => a.action_type === 'offsite_conversion.fb_pixel_purchase' || a.action_type === 'purchase' || a.action_type === 'omni_purchase');
        return c ? parseInt(c.value) : 0;
    });

    const opts = baseOptions(colors);
    opts.scales.y = { type: 'linear', position: 'left', title: { display: true, text: 'Gasto ($)', color: colors.textColor }, ticks: { color: colors.textColor }, grid: { color: colors.gridColor } };
    opts.scales.y1 = { type: 'linear', position: 'right', title: { display: true, text: 'Conversiones', color: colors.textColor }, ticks: { color: colors.textColor }, grid: { drawOnChartArea: false } };

    spendConversionsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Gasto ($)',
                    data: spendData,
                    borderColor: colors.spendColor,
                    backgroundColor: colors.spendColor + '20',
                    fill: true,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: 'Conversiones',
                    data: convData,
                    borderColor: colors.conversionsColor,
                    backgroundColor: colors.conversionsColor + '20',
                    fill: false,
                    tension: 0.3,
                    yAxisID: 'y1'
                }
            ]
        },
        options: { ...opts, plugins: { ...opts.plugins, tooltip: { mode: 'index', intersect: false } } }
    });
}

export function renderSpendByCampaignChart(ctx, campaignData) {
    if (spendByCampaignChart) spendByCampaignChart.destroy();
    if (!campaignData || campaignData.length === 0) return;

    const colors = getChartColors();
    const sorted = [...campaignData].sort((a, b) => b.spend - a.spend).slice(0, 10);
    const labels = sorted.map(c => c.name.length > 25 ? c.name.slice(0, 25) + '...' : c.name);
    const data = sorted.map(c => c.spend);

    const opts = baseOptions(colors);
    opts.indexAxis = 'y';
    opts.plugins.legend = { display: false };

    spendByCampaignChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors.barColors.slice(0, sorted.length),
                borderRadius: 6,
                barThickness: 24
            }]
        },
        options: opts
    });
}

export function destroyAll() {
    if (spendConversionsChart) { spendConversionsChart.destroy(); spendConversionsChart = null; }
    if (spendByCampaignChart) { spendByCampaignChart.destroy(); spendByCampaignChart = null; }
}
