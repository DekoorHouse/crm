import { state, elements } from './state.js';

// ========== UTILITIES ==========

export function formatNumber(n) {
    if (n == null || isNaN(n)) return '--';
    return Number(n).toLocaleString('es-MX');
}

export function formatCurrency(n) {
    if (n == null || isNaN(n)) return '--';
    return '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPercent(n) {
    if (n == null || isNaN(n)) return '--';
    return Number(n).toFixed(2) + '%';
}

export function formatBudget(cents) {
    if (!cents) return '--';
    return formatCurrency(cents / 100);
}

function getConversions(actions) {
    if (!actions) return 0;
    const conv = actions.find(a => a.action_type === 'offsite_conversion.fb_pixel_purchase' || a.action_type === 'purchase' || a.action_type === 'omni_purchase');
    return conv ? parseInt(conv.value) : 0;
}

function extractInsightData(item) {
    const ins = item.insights?.data?.[0] || {};
    return {
        spend: parseFloat(ins.spend) || 0,
        impressions: parseInt(ins.impressions) || 0,
        clicks: parseInt(ins.clicks) || 0,
        ctr: parseFloat(ins.ctr) || 0,
        cpc: parseFloat(ins.cpc) || 0,
        cpm: parseFloat(ins.cpm) || 0,
        reach: parseInt(ins.reach) || 0,
        conversions: getConversions(ins.actions)
    };
}

// ========== DARK MODE ==========

export function initDarkMode() {
    const btn = elements.themeToggle;
    const isDark = localStorage.getItem('metaDarkMode') === 'true';
    if (isDark) {
        document.body.classList.add('dark-mode');
        if (btn) btn.innerHTML = '<i class="fas fa-sun"></i>';
    }
    if (btn) {
        btn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isNowDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('metaDarkMode', isNowDark);
            btn.innerHTML = isNowDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        });
    }
}

// ========== TOAST ==========

export function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'exclamation-triangle';
    toast.innerHTML = `<i class="fas fa-${icon}"></i> ${message}`;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => { toast.classList.add('hide'); setTimeout(() => toast.remove(), 300); }, 4000);
}

// ========== MODAL ==========

export function showModal({ title, body, onConfirm, onModalOpen, confirmText = 'Confirmar', confirmClass = '', showCancel = true, showConfirm = true }) {
    elements.modalTitle.textContent = title;
    elements.modalBody.innerHTML = body;
    elements.modalConfirmBtn.textContent = confirmText;
    elements.modalConfirmBtn.className = `btn ${confirmClass}`;
    elements.modalConfirmBtn.style.display = showConfirm ? 'inline-flex' : 'none';
    elements.modalCancelBtn.style.display = showCancel ? 'inline-flex' : 'none';
    elements.modalConfirmBtn.onclick = onConfirm || (() => hideModal());
    elements.modalCancelBtn.onclick = () => hideModal();
    elements.modal.classList.add('visible');
    if (onModalOpen) onModalOpen();
}

export function hideModal() {
    elements.modal.classList.remove('visible');
}

// ========== BREADCRUMB ==========

export function renderBreadcrumb() {
    const parts = [{ label: 'Meta Ads', view: 'dashboard', tab: 'dashboard' }];

    if (state.currentView === 'campaigns' || state.currentView === 'adsets' || state.currentView === 'ads') {
        parts.push({ label: 'Campanas', view: 'campaigns', tab: 'campaigns' });
    }
    if ((state.currentView === 'adsets' || state.currentView === 'ads') && state.selectedCampaign) {
        parts.push({ label: state.selectedCampaign.name, view: 'adsets', tab: 'campaigns' });
    }
    if (state.currentView === 'ads' && state.selectedAdSet) {
        parts.push({ label: state.selectedAdSet.name, view: 'ads', tab: 'campaigns' });
    }

    elements.breadcrumb.innerHTML = parts.map((p, i) => {
        const isLast = i === parts.length - 1;
        return isLast
            ? `<span class="breadcrumb-current">${p.label}</span>`
            : `<a class="breadcrumb-link" data-view="${p.view}" data-tab="${p.tab}">${p.label}</a><span class="breadcrumb-sep">/</span>`;
    }).join('');
}

// ========== ACCOUNT SELECTOR ==========

export function renderAccountSelector(accounts) {
    const sel = elements.accountSelector;
    sel.innerHTML = '';
    if (!accounts || accounts.length === 0) {
        sel.innerHTML = '<option value="">No se encontraron cuentas</option>';
        return;
    }
    accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.account_id || acc.id;
        opt.textContent = `${acc.name || 'Sin nombre'} (${acc.account_id || acc.id})`;
        sel.appendChild(opt);
    });
    // Restore saved selection
    const saved = localStorage.getItem('metaSelectedAccount');
    if (saved && [...sel.options].some(o => o.value === saved)) {
        sel.value = saved;
    }
    state.selectedAccountId = sel.value;
}

// ========== KPI CARDS ==========

export function renderKPIs(data) {
    if (!data || data.length === 0) {
        [elements.kpiSpend, elements.kpiImpressions, elements.kpiClicks, elements.kpiCtr, elements.kpiCpc, elements.kpiCpm, elements.kpiReach, elements.kpiConversions].forEach(el => { if (el) el.textContent = '--'; });
        return;
    }
    // Aggregate all rows
    let spend = 0, impressions = 0, clicks = 0, reach = 0, conversions = 0;
    data.forEach(row => {
        spend += parseFloat(row.spend) || 0;
        impressions += parseInt(row.impressions) || 0;
        clicks += parseInt(row.clicks) || 0;
        reach += parseInt(row.reach) || 0;
        conversions += getConversions(row.actions);
    });
    const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
    const cpc = clicks > 0 ? (spend / clicks) : 0;
    const cpm = impressions > 0 ? (spend / impressions * 1000) : 0;

    elements.kpiSpend.textContent = formatCurrency(spend);
    elements.kpiImpressions.textContent = formatNumber(impressions);
    elements.kpiClicks.textContent = formatNumber(clicks);
    elements.kpiCtr.textContent = formatPercent(ctr);
    elements.kpiCpc.textContent = formatCurrency(cpc);
    elements.kpiCpm.textContent = formatCurrency(cpm);
    elements.kpiReach.textContent = formatNumber(reach);
    elements.kpiConversions.textContent = formatNumber(conversions);
}

// ========== BREAKDOWN TABLES ==========

export function renderBreakdownTable(tbodyEl, data) {
    if (!data || data.length === 0) {
        tbodyEl.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">Sin datos</td></tr>';
        return;
    }
    tbodyEl.innerHTML = data.map(row => `
        <tr>
            <td>${row.label || row.age || row.gender || row.publisher_platform || '--'}</td>
            <td class="metric">${formatCurrency(parseFloat(row.spend) || 0)}</td>
            <td class="metric">${formatNumber(parseInt(row.clicks) || 0)}</td>
            <td class="metric">${formatPercent(parseFloat(row.ctr) || 0)}</td>
        </tr>
    `).join('');
}

// ========== STATUS BADGE ==========

function statusBadge(status, effectiveStatus) {
    const display = effectiveStatus || status;
    const isActive = display === 'ACTIVE';
    const isPaused = display === 'PAUSED';
    const cls = isActive ? 'active' : isPaused ? 'paused' : 'other';
    const icon = isActive ? 'fa-circle' : isPaused ? 'fa-pause-circle' : 'fa-circle';
    const label = isActive ? 'Activo' : isPaused ? 'Pausado' : display;
    return `<span class="status-badge ${cls}" data-status="${status}" title="Click para cambiar"><i class="fas ${icon}" style="font-size:8px;"></i> ${label}</span>`;
}

function objectiveBadge(objective) {
    if (!objective) return '--';
    const map = {
        'OUTCOME_SALES': 'Ventas',
        'OUTCOME_LEADS': 'Leads',
        'OUTCOME_AWARENESS': 'Reconocimiento',
        'OUTCOME_TRAFFIC': 'Trafico',
        'OUTCOME_ENGAGEMENT': 'Interaccion',
        'OUTCOME_APP_PROMOTION': 'App'
    };
    return `<span class="objective-badge">${map[objective] || objective}</span>`;
}

// ========== CAMPAIGNS TABLE ==========

export function renderCampaignsTable(campaigns, append = false) {
    const tbody = elements.campaignsTableBody;
    if (!append) tbody.innerHTML = '';

    if (!campaigns || campaigns.length === 0) {
        if (!append) {
            elements.campaignsEmpty.style.display = 'block';
            tbody.parentElement.parentElement.style.display = 'none';
        }
        return;
    }

    elements.campaignsEmpty.style.display = 'none';
    tbody.parentElement.parentElement.style.display = 'block';

    campaigns.forEach(c => {
        const ins = extractInsightData(c);
        const budget = c.daily_budget ? `${formatBudget(c.daily_budget)}/dia` : c.lifetime_budget ? `${formatBudget(c.lifetime_budget)} total` : '--';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="name-cell" data-id="${c.id}" data-action="drill-campaign">${c.name}</td>
            <td data-id="${c.id}" data-action="toggle-campaign">${statusBadge(c.status, c.effective_status?.[0] || c.effective_status)}</td>
            <td>${objectiveBadge(c.objective)}</td>
            <td class="metric">${budget}</td>
            <td class="metric">${formatCurrency(ins.spend)}</td>
            <td class="metric">${formatNumber(ins.impressions)}</td>
            <td class="metric">${formatNumber(ins.clicks)}</td>
            <td class="metric">${formatPercent(ins.ctr)}</td>
            <td class="metric">${formatCurrency(ins.cpc)}</td>
            <td class="metric">${formatNumber(ins.conversions)}</td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" data-action="edit-campaign" data-id="${c.id}" title="Editar"><i class="fas fa-pen"></i></button>
                    <button class="action-btn danger" data-action="delete-campaign" data-id="${c.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ========== AD SETS TABLE ==========

export function renderAdSetsTable(adsets, append = false) {
    const tbody = elements.adsetsTableBody;
    if (!append) tbody.innerHTML = '';

    if (!adsets || adsets.length === 0) {
        if (!append) {
            elements.adsetsEmpty.style.display = 'block';
            tbody.parentElement.parentElement.style.display = 'none';
        }
        return;
    }

    elements.adsetsEmpty.style.display = 'none';
    tbody.parentElement.parentElement.style.display = 'block';

    adsets.forEach(a => {
        const ins = extractInsightData(a);
        const budget = a.daily_budget ? `${formatBudget(a.daily_budget)}/dia` : a.lifetime_budget ? `${formatBudget(a.lifetime_budget)} total` : '--';
        const targeting = summarizeTargeting(a.targeting);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="name-cell" data-id="${a.id}" data-action="drill-adset">${a.name}</td>
            <td data-id="${a.id}" data-action="toggle-adset">${statusBadge(a.status, a.effective_status?.[0] || a.effective_status)}</td>
            <td class="metric">${budget}</td>
            <td style="max-width:180px; font-size:12px; color: var(--text-secondary);" title="${targeting}">${targeting}</td>
            <td class="metric">${formatCurrency(ins.spend)}</td>
            <td class="metric">${formatNumber(ins.impressions)}</td>
            <td class="metric">${formatNumber(ins.clicks)}</td>
            <td class="metric">${formatPercent(ins.ctr)}</td>
            <td class="metric">${formatCurrency(ins.cpc)}</td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" data-action="edit-adset" data-id="${a.id}" title="Editar"><i class="fas fa-pen"></i></button>
                    <button class="action-btn danger" data-action="delete-adset" data-id="${a.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function summarizeTargeting(targeting) {
    if (!targeting) return '--';
    const parts = [];
    if (targeting.age_min || targeting.age_max) parts.push(`${targeting.age_min || 18}-${targeting.age_max || 65}+`);
    if (targeting.genders?.length) {
        const g = targeting.genders.map(v => v === 1 ? 'H' : v === 2 ? 'M' : '?').join(',');
        parts.push(g);
    }
    if (targeting.geo_locations?.countries?.length) parts.push(targeting.geo_locations.countries.join(','));
    if (targeting.flexible_spec?.length) {
        const interests = targeting.flexible_spec.flatMap(s => s.interests || []).map(i => i.name).slice(0, 2);
        if (interests.length) parts.push(interests.join(', '));
    }
    return parts.join(' | ') || '--';
}

// ========== ADS TABLE ==========

export function renderAdsTable(ads, append = false) {
    const tbody = elements.adsTableBody;
    if (!append) tbody.innerHTML = '';

    if (!ads || ads.length === 0) {
        if (!append) {
            elements.adsEmpty.style.display = 'block';
            tbody.parentElement.parentElement.style.display = 'none';
        }
        return;
    }

    elements.adsEmpty.style.display = 'none';
    tbody.parentElement.parentElement.style.display = 'block';

    ads.forEach(ad => {
        const ins = extractInsightData(ad);
        const thumb = ad.creative?.thumbnail_url || ad.creative?.image_url || '';
        const thumbHtml = thumb ? `<img src="${thumb}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;">` : '<i class="fas fa-image" style="color:var(--text-muted);"></i>';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600;">${ad.name}</td>
            <td data-id="${ad.id}" data-action="toggle-ad">${statusBadge(ad.status, ad.effective_status?.[0] || ad.effective_status)}</td>
            <td>${thumbHtml}</td>
            <td class="metric">${formatCurrency(ins.spend)}</td>
            <td class="metric">${formatNumber(ins.impressions)}</td>
            <td class="metric">${formatNumber(ins.clicks)}</td>
            <td class="metric">${formatPercent(ins.ctr)}</td>
            <td class="metric">${formatCurrency(ins.cpc)}</td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" data-action="edit-ad" data-id="${ad.id}" title="Editar"><i class="fas fa-pen"></i></button>
                    <button class="action-btn danger" data-action="delete-ad" data-id="${ad.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ========== CREATIVES GRID ==========

export function renderCreativesGrid(creatives, append = false) {
    const grid = elements.creativesGrid;
    if (!append) grid.innerHTML = '';

    if (!creatives || creatives.length === 0) {
        if (!append) {
            elements.creativesEmpty.style.display = 'block';
            grid.style.display = 'none';
        }
        return;
    }

    elements.creativesEmpty.style.display = 'none';
    grid.style.display = 'grid';

    creatives.forEach(c => {
        const imgUrl = c.thumbnail_url || c.image_url || '';
        const card = document.createElement('div');
        card.className = 'creative-card';
        card.dataset.id = c.id;
        card.innerHTML = `
            ${imgUrl ? `<img src="${imgUrl}" alt="${c.name || 'Creative'}">` : '<div style="height:180px;display:flex;align-items:center;justify-content:center;background:var(--bg-main);"><i class="fas fa-image" style="font-size:48px;color:var(--text-muted);opacity:0.3;"></i></div>'}
            <div class="creative-info">
                <div class="creative-name">${c.name || 'Sin nombre'}</div>
                <div class="creative-id">${c.id}</div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ========== LOADING STATES ==========

export function setLoading(section, loading) {
    state.loading[section] = loading;
    const loadingEl = elements[`${section}Loading`];
    if (loadingEl) loadingEl.style.display = loading ? 'block' : 'none';
}

// ========== CAMPAIGN FORM HTML ==========

export function getCampaignFormHTML(campaign = null) {
    const isEdit = !!campaign;
    return `
        <label class="form-label" style="margin-top:0;">Nombre de la Campana</label>
        <input type="text" id="form-campaign-name" class="modal-input" value="${isEdit ? campaign.name : ''}" placeholder="Mi campana de ventas" required>

        <label class="form-label">Objetivo</label>
        <select id="form-campaign-objective" class="modal-input" ${isEdit ? 'disabled' : ''}>
            <option value="OUTCOME_SALES" ${campaign?.objective === 'OUTCOME_SALES' ? 'selected' : ''}>Ventas</option>
            <option value="OUTCOME_LEADS" ${campaign?.objective === 'OUTCOME_LEADS' ? 'selected' : ''}>Leads</option>
            <option value="OUTCOME_TRAFFIC" ${campaign?.objective === 'OUTCOME_TRAFFIC' ? 'selected' : ''}>Trafico</option>
            <option value="OUTCOME_AWARENESS" ${campaign?.objective === 'OUTCOME_AWARENESS' ? 'selected' : ''}>Reconocimiento</option>
            <option value="OUTCOME_ENGAGEMENT" ${campaign?.objective === 'OUTCOME_ENGAGEMENT' ? 'selected' : ''}>Interaccion</option>
            <option value="OUTCOME_APP_PROMOTION" ${campaign?.objective === 'OUTCOME_APP_PROMOTION' ? 'selected' : ''}>Promocion de App</option>
        </select>

        <label class="form-label">Presupuesto Diario (MXN)</label>
        <input type="number" id="form-campaign-budget" class="modal-input" value="${isEdit && campaign.daily_budget ? campaign.daily_budget / 100 : ''}" placeholder="100.00" step="1" min="1">
        <p class="form-help">Deja vacio si usaras presupuesto a nivel de conjunto de anuncios.</p>

        <label class="form-label">Categorias Especiales</label>
        <select id="form-campaign-special" class="modal-input">
            <option value="">Ninguna</option>
            <option value="HOUSING">Vivienda</option>
            <option value="EMPLOYMENT">Empleo</option>
            <option value="CREDIT">Credito</option>
            <option value="ISSUES_ELECTIONS_POLITICS">Politica</option>
        </select>
    `;
}

// ========== ADSET FORM HTML ==========

export function getAdSetFormHTML(adset = null) {
    const isEdit = !!adset;
    return `
        <label class="form-label" style="margin-top:0;">Nombre</label>
        <input type="text" id="form-adset-name" class="modal-input" value="${isEdit ? adset.name : ''}" placeholder="Conjunto - Mexico 25-45" required>

        <div class="form-row">
            <div>
                <label class="form-label">Presupuesto Diario (MXN)</label>
                <input type="number" id="form-adset-budget" class="modal-input" value="${isEdit && adset.daily_budget ? adset.daily_budget / 100 : ''}" placeholder="50.00" step="1" min="1">
            </div>
            <div>
                <label class="form-label">Objetivo de Optimizacion</label>
                <select id="form-adset-optimization" class="modal-input">
                    <option value="OFFSITE_CONVERSIONS" ${adset?.optimization_goal === 'OFFSITE_CONVERSIONS' ? 'selected' : ''}>Conversiones</option>
                    <option value="LINK_CLICKS" ${adset?.optimization_goal === 'LINK_CLICKS' ? 'selected' : ''}>Clicks en enlace</option>
                    <option value="IMPRESSIONS" ${adset?.optimization_goal === 'IMPRESSIONS' ? 'selected' : ''}>Impresiones</option>
                    <option value="REACH" ${adset?.optimization_goal === 'REACH' ? 'selected' : ''}>Alcance</option>
                    <option value="LANDING_PAGE_VIEWS" ${adset?.optimization_goal === 'LANDING_PAGE_VIEWS' ? 'selected' : ''}>Vistas de pagina</option>
                </select>
            </div>
        </div>

        <h4 style="margin-top: 20px; font-size: 14px; font-weight: 700; color: var(--text-primary);">Segmentacion</h4>

        <div class="form-row">
            <div>
                <label class="form-label">Edad Min</label>
                <input type="number" id="form-adset-age-min" class="modal-input" value="${isEdit ? adset.targeting?.age_min || 18 : 18}" min="18" max="65">
            </div>
            <div>
                <label class="form-label">Edad Max</label>
                <input type="number" id="form-adset-age-max" class="modal-input" value="${isEdit ? adset.targeting?.age_max || 65 : 65}" min="18" max="65">
            </div>
        </div>

        <label class="form-label">Genero</label>
        <select id="form-adset-gender" class="modal-input">
            <option value="" ${!adset?.targeting?.genders?.length ? 'selected' : ''}>Todos</option>
            <option value="1" ${adset?.targeting?.genders?.[0] === 1 ? 'selected' : ''}>Hombres</option>
            <option value="2" ${adset?.targeting?.genders?.[0] === 2 ? 'selected' : ''}>Mujeres</option>
        </select>

        <label class="form-label">Paises (codigos separados por coma)</label>
        <input type="text" id="form-adset-countries" class="modal-input" value="${isEdit ? adset.targeting?.geo_locations?.countries?.join(', ') || 'MX' : 'MX'}" placeholder="MX, US, CO">

        <label class="form-label">Intereses (buscar y agregar)</label>
        <div style="display:flex; gap:8px;">
            <input type="text" id="form-adset-interest-search" class="modal-input" placeholder="Buscar intereses..." style="flex:1;">
            <button type="button" id="form-adset-interest-search-btn" class="btn btn-sm">Buscar</button>
        </div>
        <div id="form-adset-interest-results" style="margin-top:8px; max-height:120px; overflow-y:auto;"></div>
        <div id="form-adset-interest-tags" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px;"></div>

        <div class="form-row" style="margin-top:16px;">
            <div>
                <label class="form-label">Fecha Inicio</label>
                <input type="datetime-local" id="form-adset-start" class="modal-input" value="${isEdit && adset.start_time ? new Date(adset.start_time).toISOString().slice(0, 16) : ''}">
            </div>
            <div>
                <label class="form-label">Fecha Fin (opcional)</label>
                <input type="datetime-local" id="form-adset-end" class="modal-input" value="${isEdit && adset.end_time ? new Date(adset.end_time).toISOString().slice(0, 16) : ''}">
            </div>
        </div>
    `;
}

// ========== AD FORM HTML ==========

export function getAdFormHTML(ad = null) {
    const isEdit = !!ad;
    return `
        <label class="form-label" style="margin-top:0;">Nombre del Anuncio</label>
        <input type="text" id="form-ad-name" class="modal-input" value="${isEdit ? ad.name : ''}" placeholder="Anuncio - Oferta especial" required>

        <label class="form-label">ID del Creativo</label>
        <input type="text" id="form-ad-creative-id" class="modal-input" value="${isEdit ? ad.creative?.id || '' : ''}" placeholder="Pega el ID del creativo aqui" required>
        <p class="form-help">Puedes encontrar los IDs en la pestana de Creativos.</p>
    `;
}

// ========== CREATIVE FORM HTML ==========

export function getCreativeFormHTML() {
    return `
        <label class="form-label" style="margin-top:0;">Nombre del Creativo</label>
        <input type="text" id="form-creative-name" class="modal-input" placeholder="Creativo - Promo Marzo" required>

        <label class="form-label">ID de Pagina de Facebook</label>
        <input type="text" id="form-creative-page-id" class="modal-input" placeholder="110927358587213" value="${localStorage.getItem('metaPageId') || ''}" required>

        <label class="form-label">URL de la Imagen</label>
        <input type="text" id="form-creative-image-url" class="modal-input" placeholder="https://..." required>

        <label class="form-label">Texto del Anuncio</label>
        <textarea id="form-creative-message" class="modal-input" rows="3" placeholder="Descubre nuestra nueva coleccion..."></textarea>

        <label class="form-label">Titulo del Enlace</label>
        <input type="text" id="form-creative-link-title" class="modal-input" placeholder="Compra Ahora">

        <label class="form-label">URL de Destino</label>
        <input type="text" id="form-creative-link-url" class="modal-input" placeholder="https://www.tutienda.com">

        <label class="form-label">Call to Action</label>
        <select id="form-creative-cta" class="modal-input">
            <option value="SHOP_NOW">Comprar Ahora</option>
            <option value="LEARN_MORE">Mas Informacion</option>
            <option value="SIGN_UP">Registrarse</option>
            <option value="CONTACT_US">Contactanos</option>
            <option value="GET_OFFER">Obtener Oferta</option>
            <option value="ORDER_NOW">Ordenar Ahora</option>
        </select>
    `;
}
