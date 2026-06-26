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

// ===================== KPI ACCOUNTS (lista de cuentas que suman al daily_kpis.costo_publicidad) =====================

/**
 * Devuelve la lista de Ad Account IDs (limpios, sin prefijo act_) que deben
 * sumar para el calculo diario de costo_publicidad. Si nunca se configuro,
 * devuelve un array vacio y /sync-kpis cae al comportamiento legacy
 * (cuenta activa unica de settings.activeAccountId).
 *
 * Storage: meta_ads_config/settings.kpiAccountIds: string[]
 */
async function getKpiAccountIds() {
    const doc = await db.collection(CONFIG_COLLECTION).doc('settings').get();
    if (!doc.exists) return [];
    const ids = doc.data()?.kpiAccountIds;
    if (!Array.isArray(ids)) return [];
    return ids.map(id => String(id).replace('act_', ''));
}

/**
 * Reemplaza por completo la lista de Ad Account IDs que suman al KPI diario.
 * Normaliza removiendo el prefijo "act_" si lo trae cada ID.
 * Lanza error si accountIds no es array.
 */
async function setKpiAccountIds(accountIds) {
    if (!Array.isArray(accountIds)) {
        throw new Error('accountIds debe ser un array');
    }
    const clean = accountIds
        .filter(id => typeof id === 'string' && id.trim().length > 0)
        .map(id => String(id).replace('act_', '').trim());
    await db.collection(CONFIG_COLLECTION).doc('settings').set({
        kpiAccountIds: clean,
        kpiAccountIdsUpdatedAt: new Date()
    }, { merge: true });
    return clean;
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
    // Destinos de mensajeria (click-to-WhatsApp/Messenger): Meta exige
    // destination_type + promoted_object.page_id en el conjunto de anuncios.
    if (data.destination_type) payload.destination_type = data.destination_type;
    if (data.promoted_object) payload.promoted_object = data.promoted_object;
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

/**
 * Trae insights agrupados por entidad (ad/adset/campaign) en un rango de fechas.
 * Pagina automáticamente y devuelve un array plano de filas con los IDs/nombres.
 *
 * @param {string|null} accountId - Cuenta publicitaria. Si es null usa la default.
 * @param {'ad'|'adset'|'campaign'} level - Nivel de agrupación.
 * @param {string} dateFrom - YYYY-MM-DD
 * @param {string} dateTo - YYYY-MM-DD
 * @returns {Promise<Array<{spend:number, ad_id?:string, ad_name?:string, adset_id?:string, adset_name?:string, campaign_id?:string, campaign_name?:string}>>}
 */
async function getInsightsByLevel(accountId, level, dateFrom, dateTo) {
    const actId = normalizeAccountId(accountId);

    const fieldsByLevel = {
        ad: 'spend,impressions,clicks,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name',
        adset: 'spend,impressions,clicks,adset_id,adset_name,campaign_id,campaign_name',
        campaign: 'spend,impressions,clicks,campaign_id,campaign_name'
    };

    const fields = fieldsByLevel[level];
    if (!fields) throw new Error(`Nivel de insights no válido: ${level}`);

    const baseParams = {
        fields,
        level,
        time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
        limit: 500
    };

    const allRows = [];
    let after = null;
    let safety = 20; // máximo 20 páginas (10k rows)
    do {
        const params = { ...baseParams };
        if (after) params.after = after;
        const data = await metaGet(`${actId}/insights`, params, accountId);
        if (Array.isArray(data.data)) allRows.push(...data.data);
        after = (data.paging && data.paging.next && data.paging.cursors && data.paging.cursors.after) || null;
        safety--;
    } while (after && safety > 0);

    // Normalizar spend a número
    return allRows.map(r => ({ ...r, spend: Number(r.spend) || 0 }));
}

/**
 * Trae gasto diario total de la cuenta en un rango.
 * @returns {Promise<Array<{date:string, spend:number}>>}
 */
async function getDailySpend(accountId, dateFrom, dateTo) {
    const actId = normalizeAccountId(accountId);
    const baseParams = {
        fields: 'spend',
        level: 'account',
        time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
        time_increment: 1,
        limit: 500
    };

    const allRows = [];
    let after = null;
    let safety = 20;
    do {
        const params = { ...baseParams };
        if (after) params.after = after;
        const data = await metaGet(`${actId}/insights`, params, accountId);
        if (Array.isArray(data.data)) allRows.push(...data.data);
        after = (data.paging && data.paging.next && data.paging.cursors && data.paging.cursors.after) || null;
        safety--;
    } while (after && safety > 0);

    return allRows.map(r => ({
        date: r.date_start,
        spend: Number(r.spend) || 0
    }));
}

// ===================== REPORTE POR REGION (gasto por campana + mapa ad->campana) =====================

/**
 * Gasto por campana de varias cuentas en un rango. Reusa getInsightsByLevel
 * a nivel 'campaign' (ya paginado) por cada cuenta. Si una cuenta falla, se
 * registra el error y se continua con las demas.
 *
 * @param {string[]} accountIds  IDs limpios (sin act_)
 * @param {string} dateFrom YYYY-MM-DD
 * @param {string} dateTo   YYYY-MM-DD
 * @returns {Promise<{campaigns:Array<{accountId,campaignId,campaignName,spend}>, errors:Array}>}
 */
async function getCampaignSpendForAccounts(accountIds, dateFrom, dateTo) {
    const campaigns = [];
    const errors = [];
    for (const accId of accountIds) {
        try {
            const rows = await getInsightsByLevel(accId, 'campaign', dateFrom, dateTo);
            rows.forEach(r => campaigns.push({
                accountId: String(accId).replace('act_', ''),
                campaignId: r.campaign_id,
                campaignName: r.campaign_name,
                spend: Number(r.spend) || 0
            }));
        } catch (err) {
            errors.push({ accountId: accId, error: err.response?.data?.error?.message || err.message });
        }
    }
    return { campaigns, errors };
}

/**
 * Resuelve una lista de Ad IDs a su campana usando el batch-read de Meta
 * (GET /?ids=ad1,ad2,...&fields=campaign{id,name}, max 50 por llamada).
 * Los anuncios borrados o sin acceso simplemente no aparecen en el mapa.
 *
 * @param {string[]} adIds
 * @returns {Promise<Object<string,{campaignId,campaignName}>>}
 */
async function resolveAdsToCampaigns(adIds) {
    const map = {};
    const unique = [...new Set((adIds || []).filter(Boolean).map(String))];
    const token = await resolveToken(null);
    const BATCH = 50;
    for (let i = 0; i < unique.length; i += BATCH) {
        const slice = unique.slice(i, i + BATCH);
        // Batch API REAL de Meta: cada sub-request es independiente, asi que un
        // anuncio borrado NO tumba al resto del lote (a diferencia de /?ids=,
        // que falla entero y obligaba a reintentar 1x1 -> lentisimo). 50/lote.
        const batch = slice.map(id => ({ method: 'GET', relative_url: `${id}?fields=campaign{id,name}` }));
        try {
            const resp = await axios.post(`${META_API_BASE}/`, {
                access_token: token,
                batch: JSON.stringify(batch)
            });
            const results = Array.isArray(resp.data) ? resp.data : [];
            results.forEach((r, idx) => {
                if (!r || r.code !== 200 || !r.body) return; // anuncio borrado/sin acceso
                try {
                    const obj = JSON.parse(r.body);
                    if (obj && obj.campaign) {
                        map[slice[idx]] = { campaignId: obj.campaign.id, campaignName: obj.campaign.name };
                    }
                } catch (_) { /* body no parseable */ }
            });
        } catch (err) {
            console.error('[META] batch resolve ads error:', err.response?.data || err.message);
        }
    }
    return map;
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

// ===================== PAGES (paginas promocionables de la cuenta) =====================

/**
 * Lista las paginas de Facebook que se pueden promocionar bajo una cuenta
 * publicitaria. Se usan como object_story_spec.page_id / promoted_object.page_id
 * al crear anuncios de click-to-WhatsApp.
 */
async function listPromotePages(accountId, { limit = 50 } = {}) {
    const actId = normalizeAccountId(accountId);
    return metaGet(`${actId}/promote_pages`, { fields: 'id,name', limit }, accountId);
}

// ===================== CREACION RAPIDA: ANUNCIO CLICK-TO-WHATSAPP =====================

/**
 * Crea de una sola vez un anuncio completo de "click to WhatsApp":
 * campaña → conjunto de anuncios → creativo → anuncio.
 *
 * Modelo de presupuesto: ABO (el presupuesto vive en el conjunto de anuncios),
 * por eso la campaña NO lleva budget.
 *
 * Si algo falla a mitad del proceso, intenta borrar la campaña recién creada
 * (Meta cascadea a sus conjuntos/anuncios) para no dejar entidades ACTIVAS
 * gastando dinero a medias. El creativo huérfano no gasta y es inofensivo.
 *
 * @param {string} accountId  Cuenta publicitaria (con o sin prefijo act_).
 * @param {object} opts
 * @param {string} opts.objective         'OUTCOME_ENGAGEMENT' (Mensajes) | 'OUTCOME_SALES' (Ventas)
 * @param {string} opts.name              Nombre base (campaña/conjunto/anuncio).
 * @param {string} opts.pageId            ID de la página de Facebook.
 * @param {string} opts.whatsappNumber    Número de WhatsApp (solo dígitos, con país).
 * @param {number} opts.dailyBudgetCents  Presupuesto diario en centavos de la moneda de la cuenta.
 * @param {object} opts.targeting         Spec de targeting (geo_locations, age_min/max, genders, flexible_spec...).
 * @param {string} opts.primaryText       Texto principal (cuerpo arriba de la imagen).
 * @param {string} [opts.headline]        Título.
 * @param {string} [opts.description]     Descripción.
 * @param {string} opts.imageHash         Hash de imagen ya subida (via uploadAdImage).
 * @param {string} [opts.ctaType]         Tipo de CTA (default 'WHATSAPP_MESSAGE').
 * @param {string} [opts.status]          'ACTIVE' (en vivo) | 'PAUSED' (borrador). Default 'PAUSED'.
 * @param {string} [opts.instagramActorId] ID de cuenta de IG para entregar también en Instagram.
 * @returns {Promise<{campaignId,adsetId,creativeId,adId}>}
 */
async function quickCreateCtwaAd(accountId, opts) {
    const {
        objective, name, pageId, whatsappNumber, dailyBudgetCents,
        targeting, primaryText, headline, description, imageHash,
        ctaType = 'WHATSAPP_MESSAGE', status = 'PAUSED', instagramActorId
    } = opts || {};

    if (!pageId) throw new Error('Falta la página de Facebook (pageId).');
    if (!whatsappNumber) throw new Error('Falta el número de WhatsApp.');
    if (!imageHash) throw new Error('Falta la imagen del anuncio.');
    if (!primaryText) throw new Error('Falta el texto principal del anuncio.');
    if (!dailyBudgetCents || dailyBudgetCents <= 0) throw new Error('Presupuesto diario inválido.');

    // 1. Campaña (ABO: sin presupuesto a nivel campaña).
    const campaign = await createCampaign(accountId, {
        name,
        objective,
        status,
        special_ad_categories: []
    });

    let adset, creative, ad;
    try {
        // 2. Conjunto de anuncios (destino WhatsApp, optimiza conversaciones).
        adset = await createAdSet(accountId, {
            name: `${name} · Conjunto`,
            campaign_id: campaign.id,
            status,
            optimization_goal: 'CONVERSATIONS',
            billing_event: 'IMPRESSIONS',
            destination_type: 'WHATSAPP',
            promoted_object: { page_id: pageId },
            daily_budget: dailyBudgetCents,
            targeting
        });

        // 3. Creativo (link_data click-to-WhatsApp).
        const waLink = `https://api.whatsapp.com/send?phone=${whatsappNumber}`;
        const link_data = {
            link: waLink,
            message: primaryText,
            image_hash: imageHash,
            call_to_action: {
                type: ctaType,
                value: { app_destination: 'WHATSAPP', link: waLink }
            }
        };
        if (headline) link_data.name = headline;
        if (description) link_data.description = description;

        const object_story_spec = { page_id: pageId, link_data };
        if (instagramActorId) object_story_spec.instagram_actor_id = instagramActorId;

        creative = await createCreative(accountId, {
            name: `${name} · Creativo`,
            object_story_spec
        });

        // 4. Anuncio.
        ad = await createAd(accountId, {
            adset_id: adset.id,
            name: `${name} · Anuncio`,
            creative_id: creative.id,
            status
        });
    } catch (err) {
        // Rollback: borra la campaña para no dejar entidades a medias gastando.
        try { await deleteCampaign(campaign.id, accountId); } catch (_) { /* best-effort */ }
        throw err;
    }

    return {
        campaignId: campaign.id,
        adsetId: adset.id,
        creativeId: creative.id,
        adId: ad.id
    };
}

module.exports = {
    // Accounts
    listAdAccounts, getActiveAccount, setActiveAccount, storeAccountToken, storeGlobalToken,
    // KPI Accounts (lista que suma al daily_kpis.costo_publicidad)
    getKpiAccountIds, setKpiAccountIds,
    // Campaigns
    listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
    // Ad Sets
    listAdSets, getAdSet, createAdSet, updateAdSet, deleteAdSet,
    // Ads
    listAds, getAd, createAd, updateAd, deleteAd, getAdPreview,
    // Creatives
    listCreatives, getCreative, createCreative, uploadAdImage, getCreativePreview,
    // Insights
    getInsights, getInsightsByLevel, getDailySpend,
    // Reporte por region
    getCampaignSpendForAccounts, resolveAdsToCampaigns,
    // Audiences
    searchTargeting, listCustomAudiences,
    // Pages
    listPromotePages,
    // Creacion rapida click-to-WhatsApp
    quickCreateCtwaAd
};
