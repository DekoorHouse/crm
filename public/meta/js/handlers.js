import { state, elements } from './state.js';
import * as api from './api.js';
import * as ui from './ui.js';
import * as charts from './charts.js';

// ========== NAVIGATION ==========

export function navigateTo(view) {
    state.currentView = view;

    // Hide all sub-views in campaigns tab
    elements.campaignsView.style.display = 'none';
    elements.adsetsView.style.display = 'none';
    elements.adsView.style.display = 'none';

    switch (view) {
        case 'dashboard':
            switchTab('dashboard');
            break;
        case 'campaigns':
            switchTab('campaigns');
            elements.campaignsView.style.display = 'block';
            loadCampaigns();
            break;
        case 'adsets':
            switchTab('campaigns');
            elements.adsetsView.style.display = 'block';
            loadAdSets();
            break;
        case 'ads':
            switchTab('campaigns');
            elements.adsView.style.display = 'block';
            loadAds();
            break;
        case 'creatives':
            switchTab('creatives');
            loadCreatives();
            break;
    }
    ui.renderBreadcrumb();
}

function switchTab(tabName) {
    state.currentTab = tabName;
    elements.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    elements.tabContents.forEach(c => c.classList.toggle('active', c.id === `${tabName}-tab`));
}

// ========== DATE HELPERS ==========

function getDateRange() {
    return {
        dateFrom: state.dateRange.since,
        dateTo: state.dateRange.until
    };
}

// ========== DASHBOARD ==========

export async function loadDashboard() {
    if (!state.selectedAccountId) return;
    const { dateFrom, dateTo } = getDateRange();
    if (!dateFrom || !dateTo) return;

    ui.setLoading('dashboard', true);
    try {
        // Fetch aggregate insights
        const [aggregateRes, dailyRes, ageRes, genderRes, platformRes] = await Promise.all([
            api.fetchAccountInsights(state.selectedAccountId, { dateFrom, dateTo }),
            api.fetchAccountInsights(state.selectedAccountId, { dateFrom, dateTo, timeIncrement: 1 }),
            api.fetchAccountInsights(state.selectedAccountId, { dateFrom, dateTo, breakdowns: 'age' }),
            api.fetchAccountInsights(state.selectedAccountId, { dateFrom, dateTo, breakdowns: 'gender' }),
            api.fetchAccountInsights(state.selectedAccountId, { dateFrom, dateTo, breakdowns: 'publisher_platform' })
        ]);

        // Render KPIs
        ui.renderKPIs(aggregateRes.data || []);

        // Render daily chart
        state.dailyInsights = dailyRes.data || [];
        charts.renderSpendConversionsChart(
            elements.spendConversionsChart.getContext('2d'),
            state.dailyInsights
        );

        // Fetch campaign-level spend for bar chart
        const campaignsRes = await api.fetchCampaigns(state.selectedAccountId, { dateFrom, dateTo, limit: 20 });
        const campaignSpend = (campaignsRes.data || []).map(c => {
            const ins = c.insights?.data?.[0];
            return { name: c.name, spend: parseFloat(ins?.spend) || 0 };
        }).filter(c => c.spend > 0);
        charts.renderSpendByCampaignChart(
            elements.spendByCampaignChart.getContext('2d'),
            campaignSpend
        );

        // Render breakdowns
        const mapBreakdown = (data, labelField) => (data || []).map(row => ({
            label: row[labelField] || '--',
            spend: row.spend, clicks: row.clicks, ctr: row.ctr
        }));
        ui.renderBreakdownTable(elements.breakdownAge, mapBreakdown(ageRes.data, 'age'));
        ui.renderBreakdownTable(elements.breakdownGender, mapBreakdown(genderRes.data, 'gender'));
        ui.renderBreakdownTable(elements.breakdownPlatform, mapBreakdown(platformRes.data, 'publisher_platform'));

    } catch (err) {
        console.error('[Dashboard]', err);
        ui.showToast(err.message, 'error');
    } finally {
        ui.setLoading('dashboard', false);
    }
}

// ========== CAMPAIGNS ==========

export async function loadCampaigns(append = false) {
    if (!state.selectedAccountId) return;
    const { dateFrom, dateTo } = getDateRange();
    const status = elements.campaignsStatusFilter?.value || '';

    ui.setLoading('campaigns', true);
    try {
        const cursor = append ? state.campaignsPaging?.cursors?.after : undefined;
        const res = await api.fetchCampaigns(state.selectedAccountId, {
            status: status || undefined, dateFrom, dateTo, after: cursor
        });
        state.campaigns = append ? [...state.campaigns, ...(res.data || [])] : (res.data || []);
        state.campaignsPaging = res.paging;
        ui.renderCampaignsTable(append ? res.data : state.campaigns, append);
        elements.campaignsLoadMore.style.display = res.paging?.next ? 'block' : 'none';
    } catch (err) {
        console.error('[Campaigns]', err);
        ui.showToast(err.message, 'error');
    } finally {
        ui.setLoading('campaigns', false);
    }
}

async function handleToggleCampaignStatus(id) {
    const campaign = state.campaigns.find(c => c.id === id);
    if (!campaign) return;
    const newStatus = campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
        await api.toggleCampaignStatus(id, newStatus, state.selectedAccountId);
        campaign.status = newStatus;
        ui.showToast(`Campana ${newStatus === 'ACTIVE' ? 'activada' : 'pausada'}`, 'success');
        loadCampaigns();
    } catch (err) {
        ui.showToast(err.message, 'error');
    }
}

function showCampaignForm(campaign = null) {
    const isEdit = !!campaign;
    ui.showModal({
        title: isEdit ? 'Editar Campana' : 'Nueva Campana',
        body: ui.getCampaignFormHTML(campaign),
        confirmText: isEdit ? 'Guardar' : 'Crear',
        onConfirm: async () => {
            const name = document.getElementById('form-campaign-name').value.trim();
            const objective = document.getElementById('form-campaign-objective').value;
            const budgetInput = document.getElementById('form-campaign-budget').value;
            const special = document.getElementById('form-campaign-special').value;

            if (!name) return ui.showToast('El nombre es requerido', 'warning');

            try {
                if (isEdit) {
                    const updates = { name, accountId: state.selectedAccountId };
                    if (budgetInput) updates.daily_budget = Math.round(parseFloat(budgetInput) * 100);
                    await api.updateCampaign(campaign.id, updates);
                    ui.showToast('Campana actualizada', 'success');
                } else {
                    const data = {
                        accountId: state.selectedAccountId,
                        name, objective, status: 'PAUSED',
                        special_ad_categories: special ? [special] : []
                    };
                    if (budgetInput) data.daily_budget = Math.round(parseFloat(budgetInput) * 100);
                    await api.createCampaign(data);
                    ui.showToast('Campana creada', 'success');
                }
                ui.hideModal();
                loadCampaigns();
            } catch (err) {
                ui.showToast(err.message, 'error');
            }
        }
    });
}

async function handleDeleteCampaign(id) {
    const campaign = state.campaigns.find(c => c.id === id);
    ui.showModal({
        title: 'Eliminar Campana',
        body: `<p>Estas seguro de eliminar <strong>${campaign?.name || id}</strong>? Esta accion no se puede deshacer.</p>`,
        confirmText: 'Eliminar',
        confirmClass: 'btn-danger',
        onConfirm: async () => {
            try {
                await api.deleteCampaign(id, state.selectedAccountId);
                ui.showToast('Campana eliminada', 'success');
                ui.hideModal();
                loadCampaigns();
            } catch (err) {
                ui.showToast(err.message, 'error');
            }
        }
    });
}

// ========== AD SETS ==========

export async function loadAdSets(append = false) {
    if (!state.selectedAccountId || !state.selectedCampaign) return;
    const { dateFrom, dateTo } = getDateRange();

    ui.setLoading('adsets', true);
    try {
        const cursor = append ? state.adSetsPaging?.cursors?.after : undefined;
        const res = await api.fetchAdSets(state.selectedAccountId, {
            campaignId: state.selectedCampaign.id, dateFrom, dateTo, after: cursor
        });
        state.adSets = append ? [...state.adSets, ...(res.data || [])] : (res.data || []);
        state.adSetsPaging = res.paging;
        ui.renderAdSetsTable(append ? res.data : state.adSets, append);
        elements.adsetsLoadMore.style.display = res.paging?.next ? 'block' : 'none';
    } catch (err) {
        console.error('[AdSets]', err);
        ui.showToast(err.message, 'error');
    } finally {
        ui.setLoading('adsets', false);
    }
}

async function handleToggleAdSetStatus(id) {
    const adset = state.adSets.find(a => a.id === id);
    if (!adset) return;
    const newStatus = adset.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
        await api.toggleAdSetStatus(id, newStatus, state.selectedAccountId);
        adset.status = newStatus;
        ui.showToast(`Conjunto ${newStatus === 'ACTIVE' ? 'activado' : 'pausado'}`, 'success');
        loadAdSets();
    } catch (err) {
        ui.showToast(err.message, 'error');
    }
}

let selectedInterests = [];

function showAdSetForm(adset = null) {
    const isEdit = !!adset;
    selectedInterests = [];
    if (isEdit && adset.targeting?.flexible_spec?.length) {
        selectedInterests = adset.targeting.flexible_spec.flatMap(s => s.interests || []).map(i => ({ id: i.id, name: i.name }));
    }

    ui.showModal({
        title: isEdit ? 'Editar Conjunto' : 'Nuevo Conjunto de Anuncios',
        body: ui.getAdSetFormHTML(adset),
        confirmText: isEdit ? 'Guardar' : 'Crear',
        onModalOpen: () => {
            renderInterestTags();
            const searchBtn = document.getElementById('form-adset-interest-search-btn');
            const searchInput = document.getElementById('form-adset-interest-search');
            if (searchBtn) searchBtn.onclick = () => searchInterests(searchInput.value);
            if (searchInput) searchInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); searchInterests(searchInput.value); } };
        },
        onConfirm: async () => {
            const name = document.getElementById('form-adset-name').value.trim();
            const budget = document.getElementById('form-adset-budget').value;
            const optimization = document.getElementById('form-adset-optimization').value;
            const ageMin = parseInt(document.getElementById('form-adset-age-min').value) || 18;
            const ageMax = parseInt(document.getElementById('form-adset-age-max').value) || 65;
            const genderVal = document.getElementById('form-adset-gender').value;
            const countries = document.getElementById('form-adset-countries').value.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
            const startTime = document.getElementById('form-adset-start').value;
            const endTime = document.getElementById('form-adset-end').value;

            if (!name) return ui.showToast('El nombre es requerido', 'warning');

            const targeting = {
                age_min: ageMin,
                age_max: ageMax,
                geo_locations: { countries: countries.length ? countries : ['MX'] }
            };
            if (genderVal) targeting.genders = [parseInt(genderVal)];
            if (selectedInterests.length > 0) {
                targeting.flexible_spec = [{ interests: selectedInterests }];
            }

            try {
                if (isEdit) {
                    const updates = { name, targeting, optimization_goal: optimization, accountId: state.selectedAccountId };
                    if (budget) updates.daily_budget = Math.round(parseFloat(budget) * 100);
                    if (startTime) updates.start_time = new Date(startTime).toISOString();
                    if (endTime) updates.end_time = new Date(endTime).toISOString();
                    await api.updateAdSet(adset.id, updates);
                    ui.showToast('Conjunto actualizado', 'success');
                } else {
                    const data = {
                        accountId: state.selectedAccountId,
                        campaign_id: state.selectedCampaign.id,
                        name, targeting,
                        optimization_goal: optimization,
                        billing_event: 'IMPRESSIONS',
                        status: 'PAUSED'
                    };
                    if (budget) data.daily_budget = Math.round(parseFloat(budget) * 100);
                    if (startTime) data.start_time = new Date(startTime).toISOString();
                    if (endTime) data.end_time = new Date(endTime).toISOString();
                    await api.createAdSet(data);
                    ui.showToast('Conjunto creado', 'success');
                }
                ui.hideModal();
                loadAdSets();
            } catch (err) {
                ui.showToast(err.message, 'error');
            }
        }
    });
}

async function searchInterests(query) {
    if (!query || query.length < 2) return;
    try {
        const res = await api.searchTargeting(query, 'adinterest', state.selectedAccountId);
        const resultsDiv = document.getElementById('form-adset-interest-results');
        if (!resultsDiv) return;
        if (!res.data?.length) {
            resultsDiv.innerHTML = '<p style="font-size:12px;color:var(--text-muted);">Sin resultados</p>';
            return;
        }
        resultsDiv.innerHTML = res.data.slice(0, 10).map(i =>
            `<div style="padding:6px 10px;cursor:pointer;border-radius:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center;"
                  onmouseover="this.style.background='var(--bg-main)'" onmouseout="this.style.background=''"
                  data-interest-id="${i.id}" data-interest-name="${i.name}">
                <span>${i.name}</span>
                <span style="color:var(--text-muted);font-size:11px;">${i.audience_size_lower_bound ? Number(i.audience_size_lower_bound).toLocaleString() + '+' : ''}</span>
            </div>`
        ).join('');
        resultsDiv.querySelectorAll('[data-interest-id]').forEach(el => {
            el.onclick = () => {
                const id = el.dataset.interestId;
                const name = el.dataset.interestName;
                if (!selectedInterests.find(i => i.id === id)) {
                    selectedInterests.push({ id, name });
                    renderInterestTags();
                }
            };
        });
    } catch (err) {
        ui.showToast('Error buscando intereses: ' + err.message, 'error');
    }
}

function renderInterestTags() {
    const container = document.getElementById('form-adset-interest-tags');
    if (!container) return;
    container.innerHTML = selectedInterests.map((i, idx) =>
        `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(24,119,242,0.1);color:var(--primary);border-radius:9999px;font-size:12px;font-weight:600;">
            ${i.name}
            <span style="cursor:pointer;font-weight:800;" data-remove-idx="${idx}">&times;</span>
        </span>`
    ).join('');
    container.querySelectorAll('[data-remove-idx]').forEach(el => {
        el.onclick = () => { selectedInterests.splice(parseInt(el.dataset.removeIdx), 1); renderInterestTags(); };
    });
}

async function handleDeleteAdSet(id) {
    const adset = state.adSets.find(a => a.id === id);
    ui.showModal({
        title: 'Eliminar Conjunto',
        body: `<p>Estas seguro de eliminar <strong>${adset?.name || id}</strong>?</p>`,
        confirmText: 'Eliminar',
        confirmClass: 'btn-danger',
        onConfirm: async () => {
            try {
                await api.deleteAdSet(id, state.selectedAccountId);
                ui.showToast('Conjunto eliminado', 'success');
                ui.hideModal();
                loadAdSets();
            } catch (err) {
                ui.showToast(err.message, 'error');
            }
        }
    });
}

// ========== ADS ==========

export async function loadAds(append = false) {
    if (!state.selectedAccountId || !state.selectedAdSet) return;
    const { dateFrom, dateTo } = getDateRange();

    ui.setLoading('ads', true);
    try {
        const cursor = append ? state.adsPaging?.cursors?.after : undefined;
        const res = await api.fetchAds(state.selectedAccountId, {
            adsetId: state.selectedAdSet.id, dateFrom, dateTo, after: cursor
        });
        state.ads = append ? [...state.ads, ...(res.data || [])] : (res.data || []);
        state.adsPaging = res.paging;
        ui.renderAdsTable(append ? res.data : state.ads, append);
        elements.adsLoadMore.style.display = res.paging?.next ? 'block' : 'none';
    } catch (err) {
        console.error('[Ads]', err);
        ui.showToast(err.message, 'error');
    } finally {
        ui.setLoading('ads', false);
    }
}

async function handleToggleAdStatus(id) {
    const ad = state.ads.find(a => a.id === id);
    if (!ad) return;
    const newStatus = ad.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
        await api.toggleAdStatus(id, newStatus, state.selectedAccountId);
        ad.status = newStatus;
        ui.showToast(`Anuncio ${newStatus === 'ACTIVE' ? 'activado' : 'pausado'}`, 'success');
        loadAds();
    } catch (err) {
        ui.showToast(err.message, 'error');
    }
}

function showAdForm(ad = null) {
    const isEdit = !!ad;
    ui.showModal({
        title: isEdit ? 'Editar Anuncio' : 'Nuevo Anuncio',
        body: ui.getAdFormHTML(ad),
        confirmText: isEdit ? 'Guardar' : 'Crear',
        onConfirm: async () => {
            const name = document.getElementById('form-ad-name').value.trim();
            const creativeId = document.getElementById('form-ad-creative-id').value.trim();

            if (!name) return ui.showToast('El nombre es requerido', 'warning');
            if (!isEdit && !creativeId) return ui.showToast('El ID del creativo es requerido', 'warning');

            try {
                if (isEdit) {
                    await api.updateAd(ad.id, { name, accountId: state.selectedAccountId });
                    ui.showToast('Anuncio actualizado', 'success');
                } else {
                    await api.createAd({
                        accountId: state.selectedAccountId,
                        adset_id: state.selectedAdSet.id,
                        name, creative_id: creativeId,
                        status: 'PAUSED'
                    });
                    ui.showToast('Anuncio creado', 'success');
                }
                ui.hideModal();
                loadAds();
            } catch (err) {
                ui.showToast(err.message, 'error');
            }
        }
    });
}

async function handleDeleteAd(id) {
    const ad = state.ads.find(a => a.id === id);
    ui.showModal({
        title: 'Eliminar Anuncio',
        body: `<p>Estas seguro de eliminar <strong>${ad?.name || id}</strong>?</p>`,
        confirmText: 'Eliminar',
        confirmClass: 'btn-danger',
        onConfirm: async () => {
            try {
                await api.deleteAd(id, state.selectedAccountId);
                ui.showToast('Anuncio eliminado', 'success');
                ui.hideModal();
                loadAds();
            } catch (err) {
                ui.showToast(err.message, 'error');
            }
        }
    });
}

// ========== CREATIVES ==========

export async function loadCreatives(append = false) {
    if (!state.selectedAccountId) return;

    ui.setLoading('creatives', true);
    try {
        const cursor = append ? state.creativesPaging?.cursors?.after : undefined;
        const res = await api.fetchCreatives(state.selectedAccountId, { after: cursor });
        state.creatives = append ? [...state.creatives, ...(res.data || [])] : (res.data || []);
        state.creativesPaging = res.paging;
        ui.renderCreativesGrid(append ? res.data : state.creatives, append);
        elements.creativesLoadMore.style.display = res.paging?.next ? 'block' : 'none';
    } catch (err) {
        console.error('[Creatives]', err);
        ui.showToast(err.message, 'error');
    } finally {
        ui.setLoading('creatives', false);
    }
}

function showCreativeForm() {
    ui.showModal({
        title: 'Crear Creativo',
        body: ui.getCreativeFormHTML(),
        confirmText: 'Crear',
        onConfirm: async () => {
            const name = document.getElementById('form-creative-name').value.trim();
            const pageId = document.getElementById('form-creative-page-id').value.trim();
            const imageUrl = document.getElementById('form-creative-image-url').value.trim();
            const message = document.getElementById('form-creative-message').value.trim();
            const linkTitle = document.getElementById('form-creative-link-title').value.trim();
            const linkUrl = document.getElementById('form-creative-link-url').value.trim();
            const cta = document.getElementById('form-creative-cta').value;

            if (!name || !pageId || !imageUrl) return ui.showToast('Nombre, Page ID y URL de imagen son requeridos', 'warning');

            // Save pageId for future use
            localStorage.setItem('metaPageId', pageId);

            const object_story_spec = {
                page_id: pageId,
                link_data: {
                    image_url: imageUrl,
                    link: linkUrl || imageUrl,
                    message: message || '',
                    name: linkTitle || name,
                    call_to_action: { type: cta, value: { link: linkUrl || imageUrl } }
                }
            };

            try {
                await api.createCreative({ accountId: state.selectedAccountId, name, object_story_spec });
                ui.showToast('Creativo creado', 'success');
                ui.hideModal();
                loadCreatives();
            } catch (err) {
                ui.showToast(err.message, 'error');
            }
        }
    });
}

async function handleUploadImage() {
    elements.imageUploadInput.click();
}

// ========== SETTINGS ==========

function showSettings() {
    elements.settingsModal.classList.add('visible');
    elements.settingsTokenInput.value = '';
}

function hideSettings() {
    elements.settingsModal.classList.remove('visible');
}

async function saveToken() {
    const token = elements.settingsTokenInput.value.trim();
    if (!token) return ui.showToast('Ingresa un token', 'warning');
    try {
        await api.saveGlobalToken(token);
        ui.showToast('Token guardado exitosamente', 'success');
        hideSettings();
        // Reload accounts with new token
        loadAccounts();
    } catch (err) {
        ui.showToast(err.message, 'error');
    }
}

// ========== ACCOUNTS ==========

export async function loadAccounts() {
    try {
        const [accountsRes, activeRes] = await Promise.all([
            api.fetchAccounts(),
            api.getActiveAccount()
        ]);

        state.accounts = accountsRes.data || [];
        ui.renderAccountSelector(state.accounts);

        // If there's a saved active account, select it
        if (activeRes?.activeAccountId) {
            const exists = state.accounts.find(a => (a.account_id || a.id) === activeRes.activeAccountId);
            if (exists) {
                elements.accountSelector.value = activeRes.activeAccountId;
                state.selectedAccountId = activeRes.activeAccountId;
            }
        }
        // Also check localStorage
        const saved = localStorage.getItem('metaSelectedAccount');
        if (saved) {
            const exists = state.accounts.find(a => (a.account_id || a.id) === saved);
            if (exists) {
                elements.accountSelector.value = saved;
                state.selectedAccountId = saved;
            }
        }

        if (state.selectedAccountId) {
            loadDashboard();
        }
    } catch (err) {
        console.error('[Accounts]', err);
        // Don't show error toast for accounts - might just need token setup
        elements.accountSelector.innerHTML = '<option value="">Configura tu token en Ajustes</option>';
    }
}

// ========== EVENT LISTENERS ==========

export function initEventListeners() {
    // Tab clicks
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            if (tabName === 'dashboard') navigateTo('dashboard');
            else if (tabName === 'campaigns') navigateTo('campaigns');
            else if (tabName === 'creatives') navigateTo('creatives');
        });
    });

    // Breadcrumb clicks (event delegation)
    elements.breadcrumb.addEventListener('click', (e) => {
        const link = e.target.closest('.breadcrumb-link');
        if (!link) return;
        const view = link.dataset.view;
        if (view === 'dashboard') { state.selectedCampaign = null; state.selectedAdSet = null; navigateTo('dashboard'); }
        else if (view === 'campaigns') { state.selectedCampaign = null; state.selectedAdSet = null; navigateTo('campaigns'); }
        else if (view === 'adsets') { state.selectedAdSet = null; navigateTo('adsets'); }
        else if (view === 'ads') navigateTo('ads');
    });

    // Account selector
    elements.accountSelector.addEventListener('change', (e) => {
        state.selectedAccountId = e.target.value;
        localStorage.setItem('metaSelectedAccount', state.selectedAccountId);
        const account = state.accounts.find(a => (a.account_id || a.id) === state.selectedAccountId);
        api.setActiveAccount(state.selectedAccountId, account?.name || '');
        // Reload current view
        if (state.currentTab === 'dashboard') loadDashboard();
        else if (state.currentView === 'campaigns') loadCampaigns();
        else if (state.currentView === 'creatives') loadCreatives();
    });

    // Campaign status filter
    elements.campaignsStatusFilter.addEventListener('change', () => loadCampaigns());

    // Create buttons
    elements.createCampaignBtn.addEventListener('click', () => showCampaignForm());
    elements.createAdsetBtn.addEventListener('click', () => showAdSetForm());
    elements.createAdBtn.addEventListener('click', () => showAdForm());
    elements.uploadCreativeBtn.addEventListener('click', handleUploadImage);
    elements.createCreativeBtn.addEventListener('click', showCreativeForm);

    // Load more buttons
    elements.campaignsLoadMore.addEventListener('click', () => loadCampaigns(true));
    elements.adsetsLoadMore.addEventListener('click', () => loadAdSets(true));
    elements.adsLoadMore.addEventListener('click', () => loadAds(true));
    elements.creativesLoadMore.addEventListener('click', () => loadCreatives(true));

    // Settings
    elements.settingsBtn.addEventListener('click', showSettings);
    elements.settingsCancelBtn.addEventListener('click', hideSettings);
    elements.settingsSaveBtn.addEventListener('click', saveToken);

    // Image upload handler
    elements.imageUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            ui.showToast('Subiendo imagen...', 'warning');
            await api.uploadImage(state.selectedAccountId, file);
            ui.showToast('Imagen subida exitosamente', 'success');
            loadCreatives();
        } catch (err) {
            ui.showToast(err.message, 'error');
        } finally {
            e.target.value = '';
        }
    });

    // Table click delegation (campaigns, adsets, ads)
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        const id = target.dataset.id;

        switch (action) {
            // Campaigns
            case 'drill-campaign': {
                const campaign = state.campaigns.find(c => c.id === id);
                if (campaign) { state.selectedCampaign = campaign; navigateTo('adsets'); }
                break;
            }
            case 'toggle-campaign': handleToggleCampaignStatus(id); break;
            case 'edit-campaign': {
                const c = state.campaigns.find(c => c.id === id);
                if (c) showCampaignForm(c);
                break;
            }
            case 'delete-campaign': handleDeleteCampaign(id); break;

            // Ad Sets
            case 'drill-adset': {
                const adset = state.adSets.find(a => a.id === id);
                if (adset) { state.selectedAdSet = adset; navigateTo('ads'); }
                break;
            }
            case 'toggle-adset': handleToggleAdSetStatus(id); break;
            case 'edit-adset': {
                const a = state.adSets.find(a => a.id === id);
                if (a) showAdSetForm(a);
                break;
            }
            case 'delete-adset': handleDeleteAdSet(id); break;

            // Ads
            case 'toggle-ad': handleToggleAdStatus(id); break;
            case 'edit-ad': {
                const ad = state.ads.find(a => a.id === id);
                if (ad) showAdForm(ad);
                break;
            }
            case 'delete-ad': handleDeleteAd(id); break;
        }
    });

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('visible');
            }
        });
    });
}
