const { db } = require('../config');

const META_API_BASE = 'https://graph.facebook.com/v22.0';
const DEFAULT_ACCOUNT_ID = '1890131678412987';

const DEFAULT_INSIGHT_FIELDS = 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type';
const CAMPAIGN_FIELDS = 'id,name,objective,status,daily_budget,lifetime_budget,budget_remaining,created_time,updated_time,effective_status';
const ADSET_FIELDS = 'id,name,campaign_id,status,daily_budget,lifetime_budget,start_time,end_time,targeting,optimization_goal,billing_event,bid_amount,effective_status';
const AD_FIELDS = 'id,name,adset_id,status,creative{id,name,title,body,image_url,thumbnail_url,object_story_spec},created_time,updated_time,effective_status';
const CREATIVE_FIELDS = 'id,name,title,body,image_url,thumbnail_url,object_story_spec,asset_feed_spec';

const CONFIG_COLLECTION = 'meta_ads_config';

/**
 * Resuelve el access token para una cuenta publicitaria.
 * Cascada: Firestore per-account > META_ADS_TOKEN env > META_GRAPH_TOKEN env
 */
async function resolveToken(accountId) {
    // 1. Token especifico de la cuenta en Firestore
    if (accountId) {
        const cleanId = accountId.replace('act_', '');
        const doc = await db.collection(CONFIG_COLLECTION).doc(cleanId).get();
        if (doc.exists && doc.data().accessToken) return doc.data().accessToken;
    }
    // 2. Token global de settings en Firestore
    const settingsDoc = await db.collection(CONFIG_COLLECTION).doc('settings').get();
    if (settingsDoc.exists && settingsDoc.data().accessToken) return settingsDoc.data().accessToken;
    // 3. Variables de entorno
    if (process.env.META_ADS_TOKEN) return process.env.META_ADS_TOKEN;
    if (process.env.META_GRAPH_TOKEN) return process.env.META_GRAPH_TOKEN;
    throw new Error('No hay token de Meta Ads configurado. Configura uno en Ajustes o en variables de entorno.');
}

/**
 * Normaliza el ID de cuenta con prefijo act_
 */
function normalizeAccountId(accountId) {
    const id = accountId || DEFAULT_ACCOUNT_ID;
    return id.startsWith('act_') ? id : `act_${id}`;
}

/**
 * Formatea errores de la Meta API para respuestas consistentes
 */
function formatMetaError(error) {
    if (error.response?.data?.error) {
        const metaErr = error.response.data.error;
        return {
            statusCode: error.response.status || 500,
            error: metaErr.message,
            code: metaErr.code,
            type: metaErr.type,
            fbtrace_id: metaErr.fbtrace_id
        };
    }
    return {
        statusCode: 500,
        error: error.message
    };
}

/**
 * Wrapper para manejar errores async en rutas Express
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(err => {
            const formatted = formatMetaError(err);
            console.error(`[META ADS] Error:`, formatted.error);
            res.status(formatted.statusCode).json(formatted);
        });
    };
}

module.exports = {
    META_API_BASE,
    DEFAULT_ACCOUNT_ID,
    DEFAULT_INSIGHT_FIELDS,
    CAMPAIGN_FIELDS,
    ADSET_FIELDS,
    AD_FIELDS,
    CREATIVE_FIELDS,
    CONFIG_COLLECTION,
    resolveToken,
    normalizeAccountId,
    formatMetaError,
    asyncHandler
};
