import { initFirebase } from './firebase.js';
import { cacheElements, state } from './state.js';
import * as ui from './ui.js';
import * as handlers from './handlers.js';

function initializeApp() {
    console.log('[Meta Ads] Usuario autenticado. Inicializando...');

    handlers.initEventListeners();

    // Initialize date range picker (default: last 7 days)
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    state.dateRange.since = formatDate(sevenDaysAgo);
    state.dateRange.until = formatDate(today);

    const picker = new Litepicker({
        element: document.getElementById('date-range-picker'),
        singleMode: false,
        format: 'MMM D, YYYY',
        startDate: sevenDaysAgo,
        endDate: today,
        plugins: ['ranges'],
        ranges: {
            customRanges: {
                'Hoy': [today, today],
                'Ayer': [new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1), new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)],
                'Ultimos 7 dias': [sevenDaysAgo, today],
                'Ultimos 14 dias': [new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14), today],
                'Ultimos 30 dias': [new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30), today],
                'Este mes': [new Date(today.getFullYear(), today.getMonth(), 1), today],
                'Mes pasado': [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)]
            }
        },
        setup: (picker) => {
            picker.on('selected', (date1, date2) => {
                state.dateRange.since = formatDate(date1.dateInstance);
                state.dateRange.until = formatDate(date2.dateInstance);
                // Reload current view with new dates
                if (state.currentTab === 'dashboard') handlers.loadDashboard();
                else if (state.currentView === 'campaigns') handlers.loadCampaigns();
                else if (state.currentView === 'adsets') handlers.loadAdSets();
                else if (state.currentView === 'ads') handlers.loadAds();
            });
        }
    });

    // Load accounts and dashboard
    handlers.loadAccounts();
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    ui.initDarkMode();
    initFirebase(initializeApp);
});
