'use strict';
const { createHash } = require('crypto');
const { svgAutoEligibility, personajeEligibility, forcedDesignFields, autoBlocked,
    isVideoCorregir, quejaDeDatosAbierta, ESTATUS_TERMINAL, AUTO_DESDE_MS,
    invalidaMarcasAnteriores } = require('./svgAuto');

const ms = v => !v ? 0 : v.toMillis ? v.toMillis() : v instanceof Date ? +v : typeof v === 'number' ? v : Date.parse(v) || 0;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const currentCut = o => ms(o.svgCorteAt) > Math.max(0, invalidaMarcasAnteriores(o));
// Ignore our bookkeeping, but invalidate a plan if any business data or its mockup changes.
function revision(o, previews) {
    const canonical = v => {
        if (v?.toMillis) return v.toMillis();
        if (v instanceof Date) return +v;
        if (Array.isArray(v)) return v.map(canonical);
        if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
        return v;
    };
    const business = Object.fromEntries(Object.entries(o).filter(([k]) => !['id', 'svgCorteStartedAt', 'svgServerJob', 'svgCorteServerFails'].includes(k)));
    return hash(canonical({ business, previews }));
}

function lampsForOrder(o, previews, cfg = {}, now = Date.now()) {
    if (o.svgServerJob || o.svgCorteReviewRequired || o.svgCorteSubidaDudosa || o.svgCorteParcialAt
        || ms(o.svgCorteStartedAt) > now - 30 * 60000) return [];
    const est = String(o.estatus || '').trim().toLowerCase(), video = isVideoCorregir(o);
    const forced = o.svgServerRequest?.status === 'queued';
    if (o.ocultoDeEnvios || /cancel/.test(est) || currentCut(o)) return [];
    if (!forced) {
        if (cfg.serverAutoGenerate === false || o.iaForce || o.svgServerRequest || Number(o.svgCorteServerFails) >= 3) return [];
        if (quejaDeDatosAbierta(o)) return [];
        if (video) { if (cfg.videoAutoCut === false || o.svgCorteAt) return []; }
        else if (autoBlocked(o) || ESTATUS_TERMINAL.has(est) || (est !== 'fabricar' && ms(o.comprobanteValidadoAt) < AUTO_DESDE_MS)) return [];
    }
    const base = { orderId: String(o.id), dh: 'DH' + (o.consecutiveOrderNumber || o.id),
        contactId: o.contactId || o.telefono || null, video, forced,
        revision: revision(o, previews), paidMs: ms(o.comprobanteValidadoAt) || ms(o.confirmedAt) || ms(o.createdAt) };
    const heart = forced ? forcedDesignFields(o, previews) : svgAutoEligibility(o, previews);
    if (forced ? heart.ok : heart.eligible) {
        if (o.items?.length > 1) {
            if (forced) throw new Error('Varias personalizaciones en un pedido requieren revisión manual.');
            return [];
        }
        const fields = forced && o.svgServerRequest.overrideLines ? { ...heart.fields, ...o.svgServerRequest.overrideLines } : heart.fields;
        const count = Number(o.items?.[0]?.cantidad || 1);
        if (!Number.isInteger(count) || count < 1 || count > 6) {
            if (forced) throw new Error('La cantidad requiere revisión manual (de 1 a 6 piezas por pedido).');
            return [];
        }
        return Array.from({ length: count }, (_, piece) => ({ ...base, model: 'infinito', fields, piece, total: count }));
    }
    if (forced) throw new Error('El pedido requiere revisión manual: ' + (heart.reason || 'datos incompletos'));
    if (cfg.personajeAutoCut === false || (est === 'corregir' && !video) || quejaDeDatosAbierta(o) || Number(o.svgCortePersonajeFails) >= 3) return [];
    const el = personajeEligibility(o, previews);
    if (!el.eligible || !el.completo) return [];
    return el.lamparas.map((l, piece) => ({ ...base, model: l.tpl, fields: { nombre: l.nombre }, piece, total: el.lamparas.length }));
}

function completeSheets(sheets) {
    for (;;) {
        const counts = new Map();
        sheets.flat().forEach(l => counts.set(l.orderId, (counts.get(l.orderId) || 0) + 1));
        const incomplete = new Set(sheets.flat().filter(l => counts.get(l.orderId) < l.total).map(l => l.orderId));
        if (!incomplete.size) return sheets;
        sheets = sheets.filter(s => !s.some(l => incomplete.has(l.orderId)));
    }
}

// Connected sheets must finish together, including orders spanning different models.
function groupBlocks(sheets) {
    const blocks = [];
    for (const sheet of sheets) {
        const ids = new Set(sheet.map(l => l.orderId));
        const touching = blocks.filter(b => [...ids].some(id => b.ids.has(id)));
        const block = { ids, sheets: [sheet] };
        for (const b of touching) { b.ids.forEach(id => ids.add(id)); block.sheets.push(...b.sheets); blocks.splice(blocks.indexOf(b), 1); }
        blocks.push(block);
    }
    return blocks.map(b => b.sheets);
}

function planSheets(lamps, { now = Date.now(), maxSheets = 2, single = false } = {}) {
    const sheets = [];
    lamps = [...lamps].sort((a, b) => Number(b.forced) - Number(a.forced) || Number(b.video) - Number(a.video)
        || a.paidMs - b.paidMs || a.orderId.localeCompare(b.orderId) || a.piece - b.piece);
    for (const model of ['infinito', 'spiderman', 'rex']) {
        const group = lamps.filter(l => l.model === model);
        for (let i = 0; i < group.length; i += 2) {
            const sheet = group.slice(i, i + 2), solo = sheet[0];
            if (sheet.length === 2 || single || solo.video || solo.forced || now - solo.paidMs >= 12 * 36e5) sheets.push(sheet);
        }
    }
    const blocks = groupBlocks(completeSheets(sheets)), selected = [];
    let used = 0;
    for (const block of blocks) { if (used >= maxSheets) break; selected.push(block); used += block.length; }
    return selected;
}
module.exports = { ms, hash, revision, currentCut, lampsForOrder, completeSheets, groupBlocks, planSheets };
