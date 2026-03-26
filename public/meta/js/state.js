export const elements = {};

export const state = {
    currentUser: null,

    // Accounts
    accounts: [],
    selectedAccountId: null,

    // Date range
    dateRange: { since: null, until: null },

    // Dashboard
    dashboardInsights: null,
    dailyInsights: [],
    campaignInsights: [],
    breakdowns: { age: [], gender: [], platform: [] },

    // Campaigns hierarchy
    campaigns: [],
    campaignsPaging: null,
    adSets: [],
    adSetsPaging: null,
    ads: [],
    adsPaging: null,

    // Filters
    campaignStatusFilter: '',

    // Navigation
    currentView: 'dashboard',
    currentTab: 'dashboard',
    selectedCampaign: null,
    selectedAdSet: null,

    // Creatives
    creatives: [],
    creativesPaging: null,

    // Loading
    loading: {
        dashboard: false,
        campaigns: false,
        adsets: false,
        ads: false,
        creatives: false,
    }
};

export function cacheElements() {
    // Login
    elements.loginView = document.getElementById('login-view');
    elements.mainContainer = document.querySelector('.container');
    elements.loginForm = document.getElementById('login-form');
    elements.loginEmail = document.getElementById('login-email');
    elements.loginPassword = document.getElementById('login-password');
    elements.loginButton = document.getElementById('login-button');
    elements.loginError = document.getElementById('login-error-message');
    elements.logoutBtn = document.getElementById('logout-btn');

    // Top bar
    elements.accountSelector = document.getElementById('account-selector');
    elements.dateRangePicker = document.getElementById('date-range-picker');
    elements.settingsBtn = document.getElementById('settings-btn');

    // Breadcrumb
    elements.breadcrumb = document.getElementById('breadcrumb');

    // Tabs
    elements.tabs = document.querySelectorAll('.tab');
    elements.tabContents = document.querySelectorAll('.tab-content');

    // Dashboard
    elements.kpiSpend = document.getElementById('kpi-spend');
    elements.kpiImpressions = document.getElementById('kpi-impressions');
    elements.kpiClicks = document.getElementById('kpi-clicks');
    elements.kpiCtr = document.getElementById('kpi-ctr');
    elements.kpiCpc = document.getElementById('kpi-cpc');
    elements.kpiCpm = document.getElementById('kpi-cpm');
    elements.kpiReach = document.getElementById('kpi-reach');
    elements.kpiConversions = document.getElementById('kpi-conversions');

    // Charts
    elements.spendConversionsChart = document.getElementById('spend-conversions-chart');
    elements.spendByCampaignChart = document.getElementById('spend-by-campaign-chart');

    // Breakdown tables
    elements.breakdownAge = document.querySelector('#breakdown-age-table tbody');
    elements.breakdownGender = document.querySelector('#breakdown-gender-table tbody');
    elements.breakdownPlatform = document.querySelector('#breakdown-platform-table tbody');

    // Campaigns
    elements.campaignsView = document.getElementById('campaigns-view');
    elements.campaignsTableBody = document.getElementById('campaigns-table-body');
    elements.campaignsEmpty = document.getElementById('campaigns-empty');
    elements.campaignsLoading = document.getElementById('campaigns-loading');
    elements.campaignsLoadMore = document.getElementById('campaigns-load-more');
    elements.campaignsStatusDropdown = document.getElementById('campaigns-status-dropdown');
    elements.createCampaignBtn = document.getElementById('create-campaign-btn');

    // Ad Sets
    elements.adsetsView = document.getElementById('adsets-view');
    elements.adsetsTableBody = document.getElementById('adsets-table-body');
    elements.adsetsEmpty = document.getElementById('adsets-empty');
    elements.adsetsLoading = document.getElementById('adsets-loading');
    elements.adsetsLoadMore = document.getElementById('adsets-load-more');
    elements.createAdsetBtn = document.getElementById('create-adset-btn');

    // Ads
    elements.adsView = document.getElementById('ads-view');
    elements.adsTableBody = document.getElementById('ads-table-body');
    elements.adsEmpty = document.getElementById('ads-empty');
    elements.adsLoading = document.getElementById('ads-loading');
    elements.adsLoadMore = document.getElementById('ads-load-more');
    elements.createAdBtn = document.getElementById('create-ad-btn');

    // Creatives
    elements.creativesGrid = document.getElementById('creatives-grid');
    elements.creativesEmpty = document.getElementById('creatives-empty');
    elements.creativesLoading = document.getElementById('creatives-loading');
    elements.creativesLoadMore = document.getElementById('creatives-load-more');
    elements.uploadCreativeBtn = document.getElementById('upload-creative-btn');
    elements.createCreativeBtn = document.getElementById('create-creative-btn');
    elements.imageUploadInput = document.getElementById('image-upload-input');

    // Modal
    elements.modal = document.getElementById('modal');
    elements.modalTitle = document.getElementById('modal-title');
    elements.modalBody = document.getElementById('modal-body');
    elements.modalConfirmBtn = document.getElementById('modal-confirm-btn');
    elements.modalCancelBtn = document.getElementById('modal-cancel-btn');

    // Settings modal
    elements.settingsModal = document.getElementById('settings-modal');
    elements.settingsTokenInput = document.getElementById('settings-token-input');
    elements.settingsSaveBtn = document.getElementById('settings-save-btn');
    elements.settingsCancelBtn = document.getElementById('settings-cancel-btn');

    // Toast
    elements.toastContainer = document.getElementById('toast-container');
}
