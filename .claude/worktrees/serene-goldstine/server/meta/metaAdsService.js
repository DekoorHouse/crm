const axios = require('axios');
const { db } = require('../config');
const {
    META_API_BASE, DEFAULT_ACCOUNT_ID, DEFAULT_INSIGHT_FIELDS,
    CAMPAIGN_FIELDS, ADSET_FIELDS, AD_FIELDS, CREATIVE_FIELDS,
    CONFIG_COLLECTION, resolveToken, normalizeAccountId
} = require('./metaAdsHelpers');

// ===================== CORE HELPERS =====================

async function metaGet(path, params = {}, accountId) {
    const token = await resolveToken(accountId);
    const response = await axios.get(`${META_API_BASE}/${path}`, {
        params: { ...params, access_token: token }
    });
    return response.data;
}

async function metaPost(path, data = {}, accountId) {
    const token = await resolveToken(accountId);
    const response = await axios.post(`${META_API_BASE}/${path}`, {
        ...data, access_token: token
    });
    return response.data;
}

async function metaDelete(path, params = {}, accountId) {
    const token = await resolveToken(accountId);
    const response = await axios.delete(`${META_API_BASE}/${path}`, {
        params: { ...params, access_token: token }
    });
    return response.data;
}

// ===================== ACCOUNTS =====================

async function listAdAccounts(accountId) {
    const token = await resolveToken(accountId);
    const response = await axios.get(`${META_API_BASE}/me/adaccounts`, {
        params: {
            fields: 'name,account_id,account_status,currency,timezone_name,business{name}',
            limit: 100,
            access_token: token
        }
    });
    return response.data;
}

async function getActiveAccount() {
    const doc = await db.collection(CONFIG_COLLECTION).doc('settings').get();
    if (!doc.exists) return null;
    return doc.data();
}

async function setActiveAccount(accountId, accountName) {
    await db.collection(CONFIG_COLLECTION).doc('settings').set({
        activeAccountId: accountId,
        activeAccountName: accountName,
        updatedAt: new Date()
    }, { merge: true });
    return { accountId, accountName };
}

async function storeAccountToken(accountId, token) {
    const cleanId = accountId.replace('act_', '');
    await db.collection(CONFIG_COLLECTION).doc(cleanId).set({
        accountId: cleanId,
        accessToken: token,
        updatedAt: new Date()
    }, { merge: true });
}

async function storeGlobalToken(token) {
    await db.collection(CONFIG_COLLECTION).doc('settings').set({
        accessToken: token,
        updatedAt: new Date()
    }, { merge: true });
}

// ===================== CAMPAIGNS =====================

async function listCampaigns(accountId, { status, dateFrom, dateTo, limit = 50, after } = {}) {
    const actId = normalizeAccountId(accountId);
    const params = { fields: CAMPAIGN_FIELDS, limit };

    // Agregar insights inline si hay rango de fechas
    if (dateFrom && dateTo) {
        params.fields = `${CAMPAIGN_FIELDS},insights.time_range({"since":"${dateFrom}","until":"${dateTo}"}).fields(${DEFAULT_INSIGHT_FIELDS})`;
    }
    if (status) {
        params.filtering = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: Array.isArray(status) ? status : [status] }]);
    }
    if (after) params.after = after;

    return metaGet(`${actId}/campaigns`, params, accountId);
}

async function getCampaign(campaignId, { dateFrom, dateTo } = {}) {
    let fields = CAMPAIGN_FIELDS;
    if (dateFrom && dateTo) {
        fields = `${CAMPAIGN_FIELDS},insights.time_range({"since":"${dateFrom}","until":"${dateTo}"}).fields(${DEFAULT_INSIGHT_FIELDS})`;
    }
    return metaGet(campaignId, { fields });
}

async function createCampaign(accountId, { name, objective, status = 'PAUSED', daily_budget, lifetime_budget, special_ad_categories = [] }) {
    const actId = normalizeAccountId(accountId);
    const data = { name, objective, status, special_ad_categories };
    if (daily_budget) data.daily_budget = daily_budget;
    if (lifetime_budget) data.lifetime_budget = lifetime_budget;
    return metaPost(`${actId}/campaigns`, data, accountId);
}

async function updateCampaign(campaignId, updates, accountId) {
    return metaPost(campaignId, updates, accountId);
}

async function deleteCampaign(campaignId, accountId) {
    return metaDelete(campaignId, {}, accountId);
}

// ===================== AD SETS =====================

async function listAdSets(accountId, { campaignId, status, dateFrom, dateTo, limit = 50, after } = {}) {
    const actId = normalizeAccountId(accountId);
    const params = { fields: ADSET_FIELDS, limit };

    if (dateFrom && dateTo) {
        params.fields = `${ADSET_FIELDS},insights.time_range({"since":"${dateFrom}","until":"${dateTo}"}).fields(${DEFAULT_INSIGHT_FIELDS})`;
    }
    if (status) {
        params.filtering = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: Array.isArray(status) ? status : [status] }]);
    }
    if (after) params.after = after;

    // Si hay campaignId, usar la ruta de la campana
    const path = campaignId ? `${campaignId}/adsets` : `${actId}/adsets`;
    return metaGet(path, params, accountId);
}

async function getAdSet(adsetId, { dateFrom, dateTo } = {}) {
    let fields = ADSET_FIELDS;
    if (dateFrom && dateTo) {
        fields = `${ADSET_FIELDS},insights.time_range({"since":"${dateFrom}","until":"${dateTo}"}).fields(${DEFAULT_INSIGHT_FIELDS})`;
    }
    return metaGet(adsetId, { fields });
}

async function createAdSet(accountId, data) {
    const actId = normalizeAccountId(accountId);
    const payload = {
        name: data.name,
        campaign_id: data.campaign_id,
        status: data.status || 'PAUSED',
        optimization_goal: data.optimization_goal,
        billing_event: data.billing_event || 'IMPRESSIONS',
        targeting: data.targeting
    };
    if (data.daily_budget) payload.daily_budget = data.daily_budget;
    if (data.lifetime_budget) payload.lifetime_budget = data.lifetime_budget;
    if (data.start_time) payload.start_time = data.start_time;
    if (data.end_time) payload.end_time = data.end_time;
    if (data.bid_amount) payload.bid_amount = data.bid_amount;
    return metaPost(`${actId}/adsets`, payload, accountId);
}

async function updateAdSet(adsetId, updates, accountId) {
    return metaPost(adsetId, updates, accountId);
}

async function deleteAdSet(adsetId, accountId) {
    return metaDelete(adsetId, {}, accountId);
}

// ===================== ADS =====================

async function listAds(accountId, { adsetId, status, dateFrom, dateTo, limit = 50, after } = {}) {
    const actId = normalizeAccountId(accountId);
    const params = { fields: AD_FIELDS, limit };

    if (dateFrom && dateTo) {
        params.fields = `${AD_FIELDS},insights.time_range({"since":"${dateFrom}","until":"${dateTo}"}).fields(${DEFAULT_INSIGHT_FIELDS})`;
    }
    if (status) {
        params.filtering = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: Array.isArray(status) ? status : [status] }]);
    }
    if (after) params.after = after;

    const path = adsetId ? `${adsetId}/ads` : `${actId}/ads`;
    return metaGet(path, params, accountId);
}

async function getAd(adId, { dateFrom, dateTo } = {}) {
    let fields = AD_FIELDS;
    if (dateFrom && dateTo) {
        fields = `${AD_FIELDS},insights.time_range({"since":"${dateFrom}","until":"${dateTo}"}).fields(${DEFAULT_INSIGHT_FIELDS})`;
    }
    return metaGet(adId, { fields });
}

async function createAd(accountId, { adset_id, name, creative_id, status = 'PAUSED' }) {
    const actId = normalizeAccountId(accountId);
    return metaPost(`${actId}/ads`, {
        name,
        adset_id,
        creative: { creative_id },
        status
    }, accountId);
}

async function updateAd(adId, updates, accountId) {
    return metaPost(adId, updates, accountId);
}

async function deleteAd(adId, accountId) {
    return metaDelete(adId, {}, accountId);
}

async function getAdPreview(adId, adFormat = 'DESKTOP_FEED_STANDARD', accountId) {
    return metaGet(`${adId}/previews`, { ad_format: adFormat }, accountId);
}

// ===================== CREATIVES =====================

async function listCreatives(accountId, { limit = 50, after } = {}) {
    const actId = normalizeAccountId(accountId);
    const params = { fields: CREATIVE_FIELDS, limit };
    if (after) params.after = after;
    return metaGet(`${actId}/adcreatives`, params, accountId);
}

async function getCreative(creativeId, accountId) {
    return metaGet(creativeId, { fields: CREATIVE_FIELDS }, accountId);
}

async function createCreative(accountId, { name, object_story_spec }) {
    const actId = normalizeAccountId(accountId);
    return metaPost(`${actId}/adcreatives`, { name, object_story_spec }, accountId);
}

async function uploadAdImage(accountId, imageBytes, fileName) {
    const actId = normalizeAccountId(accountId);
    const token = await resolveToken(accountId);
    const response = await axios.post(`${META_API_BASE}/${actId}/adimages`, {
        bytes: imageBytes,
        name: fileName,
        access_token: token
    });
    return response.data;
}

async function getCreativePreview(creativeId, adFormat = 'DESKTOP_FEED_STANDARD', accountId) {
    return metaGet(`${creativeId}/previews`, { ad_format: adFormat }, accountId);
}

// ===================== INSIGHTS =====================

async function getInsights(level, entityId, accountId, { dateFrom, dateTo, fields, breakdowns, timeIncrement, limit = 100, after } = {}) {
    const insightFields = fields || DEFAULT_INSIGHT_FIELDS;
    const params = { fields: insightFields, limit };

    if (dateFrom && dateTo) {
        params.time_range = JSON.stringify({ since: dateFrom, until: dateTo });
    }
    if (breakdowns) params.breakdowns = breakdowns;
    if (timeIncrement) params.time_increment = timeIncrement;
    if (after) params.after = after;

    // level: 'account' usa el actId, otros usan el entityId directamente
    let path;
    if (level === 'account') {
        const actId = normalizeAccountId(accountId);
        path = `${actId}/insights`;
    } else {
        path = `${entityId}/insights`;
    }

    return metaGet(path, params, accountId);
}

// ===================== AUDIENCES / TARGETING =====================

async function searchTargeting(query, type = 'adinterest', accountId) {
    const token = await resolveToken(accountId);
    const response = await axios.get(`${META_API_BASE}/search`, {
        params: {
            type,
            q: query,
            access_token: token
        }
    });
    return response.data;
}

async function listCustomAudiences(accountId, { limit = 50, after } = {}) {
    const actId = normalizeAccountId(accountId);
    const params = { fields: 'id,name,approximate_count,description,subtype', limit };
    if (after) params.after = after;
    return metaGet(`${actId}/customaudiences`, params, accountId);
}

module.exports = {
    // Accounts
    listAdAccounts, getActiveAccount, setActiveAccount, storeAccountToken, storeGlobalToken,
    // Campaigns
    listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
    // Ad Sets
    listAdSets, getAdSet, createAdSet, updateAdSet, deleteAdSet,
    // Ads
    listAds, getAd, createAd, updateAd, deleteAd, getAdPreview,
    // Creatives
    listCreatives, getCreative, createCreative, uploadAdImage, getCreativePreview,
    // Insights
    getInsights,
    // Audiences
    searchTargeting, listCustomAudiences
};
