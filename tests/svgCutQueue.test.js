'use strict';
const { lampsForOrder, planSheets, revision } = require('../server/design/svgCutQueue');
const { isAutoWaiting } = require('../server/design/svgAuto');
const NOW = Date.parse('2026-09-17T12:00:00Z');
const heart = extra => ({ id: 'a', estatus: 'Fabricar', createdAt: NOW - 24 * 36e5, producto: 'Lámpara de corazones',
    datosProducto: 'Nombres: Ana y Luis | Fecha: 17-09-2026', ...extra });
const previews = [{ fields: { nombre1: 'Ana', nombre2: 'Luis', fecha: '17-09-2026' }, layout: { ok: true, izquierdo: ['Ana'], derecho: ['Luis'], fecha: ['17-09-2026'] } }];
const lamp = (id, piece = 0, total = 1, model = 'spiderman', extra = {}) => ({ orderId: id, piece, total, model, paidMs: NOW - 24 * 36e5, ...extra });

test('uses approved line breaks and emits every identical paid piece', () => {
    const p = [{ ...previews[0], layout: { ...previews[0].layout, derecho: ['José', 'Miguel'] } }];
    const lamps = lampsForOrder(heart({ items: [{ producto: 'Lámpara de corazones', cantidad: 3 }] }), p, {}, NOW);
    expect(lamps).toHaveLength(3); expect(lamps[0].fields.nombre2).toBe('José\nMiguel');
    expect(planSheets(lamps, { now: NOW, maxSheets: 1 })[0].flat()).toHaveLength(3);
});

test.each([
    { ocultoDeEnvios: true }, { estatus: 'Cancelado' }, { disenoListoAt: NOW },
    { svgCorteAt: NOW }, { svgServerJob: 'owned' }, { svgCorteReviewRequired: { jobId: 'x' } },
    { iaForce: { status: 'queued' } }, { svgCorteServerFails: 3 },
    { datosProducto: 'Nombres: Ana y Luis | Foto grabada' }
])('keeps protected or manual orders out: %j', extra => {
    expect(lampsForOrder(heart(extra), previews, {}, NOW)).toHaveLength(0);
});

test('a corrected old SVG does not block a new design', () => {
    expect(lampsForOrder(heart({ svgCorteAt: NOW - 5000, datoCorregidoAt: NOW - 1000 }), previews, {}, NOW)).toHaveLength(1);
});

test('honors automatic switches while allowing an explicit CRM request', () => {
    expect(lampsForOrder(heart(), previews, { serverAutoGenerate: false }, NOW)).toHaveLength(0);
    expect(lampsForOrder(heart({ svgServerRequest: { status: 'queued', overrideLines: { nombre1: 'Eva' } } }), previews, { serverAutoGenerate: false }, NOW)[0].fields.nombre1).toBe('Eva');
});

test('video keeps priority and does not wait for a partner', () => {
    const lamps = lampsForOrder(heart({ estatus: 'Corregir', corregirMotivo: 'video', createdAt: NOW }), previews, {}, NOW);
    expect(planSheets(lamps, { now: NOW })[0][0][0].video).toBe(true);
    expect(lampsForOrder(heart({ estatus: 'Corregir', corregirMotivo: 'video' }), previews, { videoAutoCut: false }, NOW)).toEqual([]);
});

test('a three-piece order awaiting its last partner produces no partial sheet', () => {
    const lamps = [0, 1, 2].map(i => lamp('a', i, 3, 'infinito', { paidMs: NOW }));
    expect(planSheets(lamps, { now: NOW })).toEqual([]);
});

test('never mixes models and includes all sheets of a connected multi-model order', () => {
    const blocks = planSheets([lamp('a', 0, 2), lamp('a', 1, 2, 'rex'), lamp('b'), lamp('c', 0, 1, 'rex')], { now: NOW, maxSheets: 1 });
    expect(blocks).toHaveLength(1); expect(blocks[0]).toHaveLength(2);
    for (const s of blocks[0]) expect(new Set(s.map(l => l.model)).size).toBe(1);
});

test('bookkeeping does not invalidate a claim; new cut, cancellation and mockup changes do', () => {
    const o = heart(), original = revision(o, previews);
    expect(revision({ ...o, svgServerJob: 'job', svgCorteStartedAt: NOW }, previews)).toBe(original);
    expect(revision({ ...o, svgCorteAt: NOW }, previews)).not.toBe(original);
    expect(revision({ ...o, estatus: 'Cancelado' }, previews)).not.toBe(original);
    expect(revision(o, [])).not.toBe(original);
    expect(isAutoWaiting({ ...o, svgServerJob: 'job' }, previews)).toBe(true);
});
