const express = require('express');
const router = express.Router();
const multer = require('multer');
const { asyncHandler } = require('./metaAdsHelpers');
const svc = require('./metaAdsService');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// ===================== ACCOUNTS =====================

router.get('/accounts', asyncHandler(async (req, res) => {
    const data = await svc.listAdAccounts(req.query.accountId);
    res.json(data);
}));

router.get('/accounts/active', asyncHandler(async (req, res) => {
    const settings = await svc.getActiveAccount();
    res.json(settings || {});
}));

router.post('/accounts/active', asyncHandler(async (req, res) => {
    const { accountId, accountName } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId es requerido' });
    const result = await svc.setActiveAccount(accountId, accountName);
    res.json(result);
}));

router.post('/accounts/:id/token', asyncHandler(async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token es requerido' });
    await svc.storeAccountToken(req.params.id, token);
    res.json({ success: true });
}));

router.post('/token', asyncHandler(async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token es requerido' });
    await svc.storeGlobalToken(token);
    res.json({ success: true });
}));

// ===================== CAMPAIGNS =====================

router.get('/campaigns', asyncHandler(async (req, res) => {
    const { accountId, status, date_from, date_to, limit, after } = req.query;
    const data = await svc.listCampaigns(accountId, {
        status, dateFrom: date_from, dateTo: date_to,
        limit: limit ? parseInt(limit) : undefined, after
    });
    res.json(data);
}));

router.get('/campaigns/:id', asyncHandler(async (req, res) => {
    const { date_from, date_to } = req.query;
    const data = await svc.getCampaign(req.params.id, { dateFrom: date_from, dateTo: date_to });
    res.json(data);
}));

router.post('/campaigns', asyncHandler(async (req, res) => {
    const { accountId, name, objective, status, daily_budget, lifetime_budget, special_ad_categories } = req.body;
    if (!accountId || !name || !objective) {
        return res.status(400).json({ error: 'accountId, name y objective son requeridos' });
    }
    const data = await svc.createCampaign(accountId, { name, objective, status, daily_budget, lifetime_budget, special_ad_categories });
    res.json(data);
}));

router.put('/campaigns/:id', asyncHandler(async (req, res) => {
    const { accountId, ...updates } = req.body;
    const data = await svc.updateCampaign(req.params.id, updates, accountId);
    res.json(data);
}));

router.delete('/campaigns/:id', asyncHandler(async (req, res) => {
    const data = await svc.deleteCampaign(req.params.id, req.query.accountId);
    res.json(data);
}));

router.post('/campaigns/:id/status', asyncHandler(async (req, res) => {
    const { status, accountId } = req.body;
    if (!status) return res.status(400).json({ error: 'status es requerido (ACTIVE o PAUSED)' });
    const data = await svc.updateCampaign(req.params.id, { status }, accountId);
    res.json(data);
}));

// ===================== AD SETS =====================

router.get('/adsets', asyncHandler(async (req, res) => {
    const { accountId, campaignId, status, date_from, date_to, limit, after } = req.query;
    const data = await svc.listAdSets(accountId, {
        campaignId, status, dateFrom: date_from, dateTo: date_to,
        limit: limit ? parseInt(limit) : undefined, after
    });
    res.json(data);
}));

router.get('/adsets/:id', asyncHandler(async (req, res) => {
    const { date_from, date_to } = req.query;
    const data = await svc.getAdSet(req.params.id, { dateFrom: date_from, dateTo: date_to });
    res.json(data);
}));

router.post('/adsets', asyncHandler(async (req, res) => {
    const { accountId, name, campaign_id, optimization_goal } = req.body;
    if (!accountId || !name || !campaign_id) {
        return res.status(400).json({ error: 'accountId, name y campaign_id son requeridos' });
    }
    const data = await svc.createAdSet(accountId, req.body);
    res.json(data);
}));

router.put('/adsets/:id', asyncHandler(async (req, res) => {
    const { accountId, ...updates } = req.body;
    const data = await svc.updateAdSet(req.params.id, updates, accountId);
    res.json(data);
}));

router.delete('/adsets/:id', asyncHandler(async (req, res) => {
    const data = await svc.deleteAdSet(req.params.id, req.query.accountId);
    res.json(data);
}));

router.post('/adsets/:id/status', asyncHandler(async (req, res) => {
    const { status, accountId } = req.body;
    if (!status) return res.status(400).json({ error: 'status es requerido' });
    const data = await svc.updateAdSet(req.params.id, { status }, accountId);
    res.json(data);
}));

// ===================== ADS =====================

router.get('/ads', asyncHandler(async (req, res) => {
    const { accountId, adsetId, status, date_from, date_to, limit, after } = req.query;
    const data = await svc.listAds(accountId, {
        adsetId, status, dateFrom: date_from, dateTo: date_to,
        limit: limit ? parseInt(limit) : undefined, after
    });
    res.json(data);
}));

router.get('/ads/:id', asyncHandler(async (req, res) => {
    const { date_from, date_to } = req.query;
    const data = await svc.getAd(req.params.id, { dateFrom: date_from, dateTo: date_to });
    res.json(data);
}));

router.post('/ads', asyncHandler(async (req, res) => {
    const { accountId, adset_id, name, creative_id } = req.body;
    if (!accountId || !adset_id || !name || !creative_id) {
        return res.status(400).json({ error: 'accountId, adset_id, name y creative_id son requeridos' });
    }
    const data = await svc.createAd(accountId, req.body);
    res.json(data);
}));

router.put('/ads/:id', asyncHandler(async (req, res) => {
    const { accountId, ...updates } = req.body;
    const data = await svc.updateAd(req.params.id, updates, accountId);
    res.json(data);
}));

router.delete('/ads/:id', asyncHandler(async (req, res) => {
    const data = await svc.deleteAd(req.params.id, req.query.accountId);
    res.json(data);
}));

router.post('/ads/:id/status', asyncHandler(async (req, res) => {
    const { status, accountId } = req.body;
    if (!status) return res.status(400).json({ error: 'status es requerido' });
    const data = await svc.updateAd(req.params.id, { status }, accountId);
    res.json(data);
}));

router.get('/ads/:id/preview', asyncHandler(async (req, res) => {
    const { ad_format, accountId } = req.query;
    const data = await svc.getAdPreview(req.params.id, ad_format, accountId);
    res.json(data);
}));

// ===================== CREATIVES =====================

router.get('/creatives', asyncHandler(async (req, res) => {
    const { accountId, limit, after } = req.query;
    const data = await svc.listCreatives(accountId, {
        limit: limit ? parseInt(limit) : undefined, after
    });
    res.json(data);
}));

router.get('/creatives/:id', asyncHandler(async (req, res) => {
    const data = await svc.getCreative(req.params.id, req.query.accountId);
    res.json(data);
}));

router.post('/creatives', asyncHandler(async (req, res) => {
    const { accountId, name, object_story_spec } = req.body;
    if (!accountId || !name || !object_story_spec) {
        return res.status(400).json({ error: 'accountId, name y object_story_spec son requeridos' });
    }
    const data = await svc.createCreative(accountId, { name, object_story_spec });
    res.json(data);
}));

router.post('/creatives/upload-image', upload.single('image'), asyncHandler(async (req, res) => {
    const { accountId } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Se requiere un archivo de imagen' });
    const base64 = req.file.buffer.toString('base64');
    const data = await svc.uploadAdImage(accountId, base64, req.file.originalname);
    res.json(data);
}));

router.get('/creatives/:id/preview', asyncHandler(async (req, res) => {
    const { ad_format, accountId } = req.query;
    const data = await svc.getCreativePreview(req.params.id, ad_format, accountId);
    res.json(data);
}));

// ===================== INSIGHTS =====================

router.get('/insights/account', asyncHandler(async (req, res) => {
    const { accountId, date_from, date_to, fields, breakdowns, time_increment, limit, after } = req.query;
    const data = await svc.getInsights('account', null, accountId, {
        dateFrom: date_from, dateTo: date_to, fields, breakdowns, timeIncrement: time_increment,
        limit: limit ? parseInt(limit) : undefined, after
    });
    res.json(data);
}));

router.get('/insights/campaigns/:id', asyncHandler(async (req, res) => {
    const { accountId, date_from, date_to, fields, breakdowns, time_increment } = req.query;
    const data = await svc.getInsights('campaign', req.params.id, accountId, {
        dateFrom: date_from, dateTo: date_to, fields, breakdowns, timeIncrement: time_increment
    });
    res.json(data);
}));

router.get('/insights/adsets/:id', asyncHandler(async (req, res) => {
    const { accountId, date_from, date_to, fields, breakdowns, time_increment } = req.query;
    const data = await svc.getInsights('adset', req.params.id, accountId, {
        dateFrom: date_from, dateTo: date_to, fields, breakdowns, timeIncrement: time_increment
    });
    res.json(data);
}));

router.get('/insights/ads/:id', asyncHandler(async (req, res) => {
    const { accountId, date_from, date_to, fields, breakdowns, time_increment } = req.query;
    const data = await svc.getInsights('ad', req.params.id, accountId, {
        dateFrom: date_from, dateTo: date_to, fields, breakdowns, timeIncrement: time_increment
    });
    res.json(data);
}));

// ===================== KPI ACCOUNTS (gestion de la lista que suma) =====================

/**
 * GET /api/meta-ads/kpi-accounts
 * Devuelve la lista de account IDs (limpios) configurados para sumar al
 * daily_kpis.costo_publicidad. Si nunca se configuro, devuelve [].
 */
router.get('/kpi-accounts', asyncHandler(async (req, res) => {
    const ids = await svc.getKpiAccountIds();
    res.json({ success: true, accountIds: ids });
}));

/**
 * PUT /api/meta-ads/kpi-accounts
 * Reemplaza la lista de cuentas KPI por la que se reciba en el body.
 * Body: { accountIds: ["123...", "act_456...", ...] }   (prefijo act_ opcional)
 */
router.put('/kpi-accounts', asyncHandler(async (req, res) => {
    const ids = req.body?.accountIds;
    if (!Array.isArray(ids)) {
        return res.status(400).json({ success: false, error: 'accountIds debe ser un array' });
    }
    const saved = await svc.setKpiAccountIds(ids);
    res.json({ success: true, accountIds: saved });
}));

// ===================== KPI SYNC (auto) =====================

/**
 * Sincroniza daily_kpis.costo_publicidad con el gasto diario de Meta Ads.
 *
 * Comportamiento:
 *   1. Si settings.kpiAccountIds esta configurado y tiene >=1 ID, itera TODAS
 *      esas cuentas, suma su spend diario y guarda el total en
 *      daily_kpis.costo_publicidad. Ademas guarda el desglose por cuenta en
 *      daily_kpis.costo_publicidad_breakdown: { accountId: spend }.
 *   2. Si la lista esta vacia o no existe, cae al comportamiento legacy:
 *      usa la cuenta unica de settings.activeAccountId.
 *
 * Query/body params opcionales: date_from, date_to (YYYY-MM-DD).
 * Default: mes actual.
 *
 * Respuesta: { success, dateFrom, dateTo, accountIds, count, updates, errors? }
 */
router.post('/sync-kpis', asyncHandler(async (req, res) => {
    const { db } = require('../config');

    // 1. Resolver lista de cuentas a sincronizar.
    let accountIds = await svc.getKpiAccountIds();
    if (accountIds.length === 0) {
        // Fallback legacy: cuenta activa unica.
        const settings = await svc.getActiveAccount();
        const fallback = req.body?.accountId || req.query.accountId || settings?.activeAccountId;
        if (fallback) {
            accountIds = [String(fallback).replace('act_', '')];
        }
    }
    if (accountIds.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'No hay cuentas Meta configuradas. Define settings.kpiAccountIds (PUT /api/meta-ads/kpi-accounts) o una cuenta activa.'
        });
    }

    // 2. Rango de fechas (default: mes actual).
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const dateFrom = req.body?.date_from || req.query.date_from || firstOfMonth.toISOString().split('T')[0];
    const dateTo   = req.body?.date_to   || req.query.date_to   || today.toISOString().split('T')[0];

    // 3. Iterar cada cuenta, acumular spend por fecha.
    const dailyMap = new Map(); // fecha -> { total, breakdown: { accountId: spend } }
    const errors = [];

    for (const accId of accountIds) {
        try {
            const insights = await svc.getInsights('account', null, accId, {
                dateFrom, dateTo,
                fields: 'spend,date_start',
                timeIncrement: 1,
                limit: 500
            });
            const rows = insights?.data || [];
            for (const row of rows) {
                const fecha = row.date_start; // YYYY-MM-DD
                const spend = parseFloat(row.spend) || 0;
                if (!fecha || spend <= 0) continue;

                if (!dailyMap.has(fecha)) {
                    dailyMap.set(fecha, { total: 0, breakdown: {} });
                }
                const entry = dailyMap.get(fecha);
                entry.total += spend;
                entry.breakdown[accId] = spend;
            }
        } catch (err) {
            const msg = err.response?.data?.error?.message || err.message;
            errors.push({ accountId: accId, error: msg });
            console.error(`Meta sync-kpis error for account ${accId}:`, err.response?.data || err.message);
        }
    }

    // 4. Upsert daily_kpis con total + breakdown por cuenta.
    const updates = [];
    for (const [fecha, { total, breakdown }] of dailyMap.entries()) {
        const existing = await db.collection('daily_kpis').where('fecha', '==', fecha).limit(1).get();
        const payload = {
            costo_publicidad: Math.round(total * 100) / 100,
            costo_publicidad_breakdown: breakdown,
            metaSyncedAt: new Date()
        };
        if (!existing.empty) {
            await existing.docs[0].ref.update(payload);
        } else {
            await db.collection('daily_kpis').add({ fecha, ...payload });
        }
        updates.push({
            fecha,
            total: payload.costo_publicidad,
            accounts: Object.keys(breakdown).length
        });
    }

    res.json({
        success: true,
        dateFrom, dateTo,
        accountIds,
        count: updates.length,
        updates,
        errors: errors.length ? errors : undefined
    });
}));

// ===================== REPORTE POR REGION (campanas: gasto + atribucion) =====================

/**
 * POST /api/meta-ads/region-report
 *
 * Devuelve lo necesario para la pestana "Campanas" del admon: gasto por
 * campana de las 6 cuentas KPI en un rango, y (si el cliente manda adIds)
 * el mapa adId->campana para atribuir las ventas de pedidos.
 *
 * Body: { date_from?, date_to?, adIds?: string[] }
 *   - date_from/date_to: YYYY-MM-DD (default: mes actual)
 *   - adIds: lista de attributedAdId distintos sacados de pedidos pagados
 *
 * Respuesta: {
 *   success, dateFrom, dateTo, accountIds,
 *   campaigns: [{ accountId, campaignId, campaignName, spend }],
 *   adToCampaign: { [adId]: { campaignId, campaignName } },
 *   errors?
 * }
 *
 * El token Meta queda server-side (no se expone al cliente).
 */
router.post('/region-report', asyncHandler(async (req, res) => {
    const accountIds = await svc.getKpiAccountIds();
    if (accountIds.length === 0) {
        return res.status(400).json({ success: false, error: 'No hay cuentas KPI configuradas (settings.kpiAccountIds).' });
    }

    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const dateFrom = req.body?.date_from || firstOfMonth.toISOString().split('T')[0];
    const dateTo   = req.body?.date_to   || today.toISOString().split('T')[0];
    const adIds = Array.isArray(req.body?.adIds) ? req.body.adIds : [];

    const { campaigns, errors } = await svc.getCampaignSpendForAccounts(accountIds, dateFrom, dateTo);
    const adToCampaign = adIds.length ? await svc.resolveAdsToCampaigns(adIds) : {};

    res.json({
        success: true,
        dateFrom, dateTo, accountIds,
        campaigns,
        adToCampaign,
        adsResolved: Object.keys(adToCampaign).length,
        adsRequested: [...new Set(adIds.filter(Boolean).map(String))].length,
        errors: errors.length ? errors : undefined
    });
}));

// ===================== AUDIENCES / TARGETING =====================

router.get('/audiences/targeting-search', asyncHandler(async (req, res) => {
    const { q, type, accountId } = req.query;
    if (!q) return res.status(400).json({ error: 'q (query) es requerido' });
    const data = await svc.searchTargeting(q, type, accountId);
    res.json(data);
}));

router.get('/audiences/custom', asyncHandler(async (req, res) => {
    const { accountId, limit, after } = req.query;
    const data = await svc.listCustomAudiences(accountId, {
        limit: limit ? parseInt(limit) : undefined, after
    });
    res.json(data);
}));

module.exports = router;
