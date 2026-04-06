const BASE = window.API_BASE_URL || '';
const API = `${BASE}/api/meta-ads`;

async function request(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
}

// ========== ACCOUNTS ==========

export async function fetchAccounts() {
    return request(`${API}/accounts`);
}

export async function getActiveAccount() {
    return request(`${API}/accounts/active`);
}

export async function setActiveAccount(accountId, accountName) {
    return request(`${API}/accounts/active`, {
        method: 'POST',
        body: JSON.stringify({ accountId, accountName })
    });
}

export async function saveGlobalToken(token) {
    return request(`${API}/token`, {
        method: 'POST',
        body: JSON.stringify({ token })
    });
}

// ========== CAMPAIGNS ==========

export async function fetchCampaigns(accountId, { status, dateFrom, dateTo, limit, after } = {}) {
    const params = new URLSearchParams();
    if (accountId) params.set('accountId', accountId);
    if (status) params.set('status', status);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    return request(`${API}/campaigns?${params}`);
}

export async function createCampaign(data) {
    return request(`${API}/campaigns`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateCampaign(id, data) {
    return request(`${API}/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteCampaign(id, accountId) {
    return request(`${API}/campaigns/${id}?accountId=${accountId || ''}`, { method: 'DELETE' });
}

export async function toggleCampaignStatus(id, status, accountId) {
    return request(`${API}/campaigns/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, accountId })
    });
}

// ========== AD SETS ==========

export async function fetchAdSets(accountId, { campaignId, status, dateFrom, dateTo, limit, after } = {}) {
    const params = new URLSearchParams();
    if (accountId) params.set('accountId', accountId);
    if (campaignId) params.set('campaignId', campaignId);
    if (status) params.set('status', status);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    return request(`${API}/adsets?${params}`);
}

export async function createAdSet(data) {
    return request(`${API}/adsets`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateAdSet(id, data) {
    return request(`${API}/adsets/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteAdSet(id, accountId) {
    return request(`${API}/adsets/${id}?accountId=${accountId || ''}`, { method: 'DELETE' });
}

export async function toggleAdSetStatus(id, status, accountId) {
    return request(`${API}/adsets/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, accountId })
    });
}

// ========== ADS ==========

export async function fetchAds(accountId, { adsetId, status, dateFrom, dateTo, limit, after } = {}) {
    const params = new URLSearchParams();
    if (accountId) params.set('accountId', accountId);
    if (adsetId) params.set('adsetId', adsetId);
    if (status) params.set('status', status);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    return request(`${API}/ads?${params}`);
}

export async function createAd(data) {
    return request(`${API}/ads`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateAd(id, data) {
    return request(`${API}/ads/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteAd(id, accountId) {
    return request(`${API}/ads/${id}?accountId=${accountId || ''}`, { method: 'DELETE' });
}

export async function toggleAdStatus(id, status, accountId) {
    return request(`${API}/ads/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, accountId })
    });
}

// ========== CREATIVES ==========

export async function fetchCreatives(accountId, { limit, after } = {}) {
    const params = new URLSearchParams();
    if (accountId) params.set('accountId', accountId);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    return request(`${API}/creatives?${params}`);
}

export async function createCreative(data) {
    return request(`${API}/creatives`, { method: 'POST', body: JSON.stringify(data) });
}

export async function uploadImage(accountId, file) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('accountId', accountId);
    const res = await fetch(`${API}/creatives/upload-image`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
}

// ========== INSIGHTS ==========

export async function fetchAccountInsights(accountId, { dateFrom, dateTo, fields, breakdowns, timeIncrement } = {}) {
    const params = new URLSearchParams();
    if (accountId) params.set('accountId', accountId);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (fields) params.set('fields', fields);
    if (breakdowns) params.set('breakdowns', breakdowns);
    if (timeIncrement) params.set('time_increment', timeIncrement);
    return request(`${API}/insights/account?${params}`);
}

// ========== AUDIENCES ==========

export async function searchTargeting(query, type = 'adinterest', accountId) {
    const params = new URLSearchParams({ q: query, type });
    if (accountId) params.set('accountId', accountId);
    return request(`${API}/audiences/targeting-search?${params}`);
}
