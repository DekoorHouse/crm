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

// ===================== KPI SYNC (auto) =====================

/**
 * Sincroniza daily_kpis.costo_publicidad con el gasto diario de Meta Ads,
 * usando la cuenta activa ya configurada en Firestore (no requiere credenciales).
 * Query params opcionales: date_from, date_to (YYYY-MM-DD). Default: mes actual.
 */
router.post('/sync-kpis', asyncHandler(async (req, res) => {
    const { db } = require('../config');
    const settings = await svc.getActiveAccount();
    const accountId = req.body?.accountId || req.query.accountId || settings?.activeAccountId;
    if (!accountId) {
        return res.status(400).json({ success: false, error: 'No hay cuenta Meta activa. Configura una en el panel de Meta.' });
    }

    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const dateFrom = req.body?.date_from || req.query.date_from || firstOfMonth.toISOString().split('T')[0];
    const dateTo = req.body?.date_to || req.query.date_to || today.toISOString().split('T')[0];

    let insights;
    try {
        insights = await svc.getInsights('account', null, accountId, {
            dateFrom, dateTo,
            fields: 'spend,date_start',
            timeIncrement: 1,
            limit: 500
        });
    } catch (err) {
        console.error('Meta insights error:', err.response?.data || err.message);
        return res.status(500).json({ success: false, error: err.response?.data?.error?.message || err.message });
    }

    const data = insights?.data || [];
    const updates = [];
    for (const row of data) {
        const fecha = row.date_start; // YYYY-MM-DD
        const spend = parseFloat(row.spend) || 0;
        if (!fecha) continue;
        const existing = await db.collection('daily_kpis').where('fecha', '==', fecha).limit(1).get();
        if (!existing.empty) {
            await existing.docs[0].ref.update({ costo_publicidad: spend, metaSyncedAt: new Date() });
        } else {
            await db.collection('daily_kpis').add({ fecha, costo_publicidad: spend, metaSyncedAt: new Date() });
        }
        updates.push({ fecha, spend });
    }

    res.json({ success: true, dateFrom, dateTo, accountId, count: updates.length, updates });
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
