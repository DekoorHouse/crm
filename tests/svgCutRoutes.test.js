'use strict';
const mockDb = require('./helpers/svgCutFirestore')();
jest.mock('../server/config', () => ({ db: mockDb, admin: { firestore: { FieldValue: { serverTimestamp: () => Date.now() } } } }));
const express = require('express');
let server, base;
beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/cut', require('../server/design/svgCutRoutes'));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/cut`;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => mockDb.reset());
const activate = body => fetch(base + '/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: 'server-svg-v1', ...body }) });

test('migration disables the old auto queue and drains old runs before starting the server', async () => {
    mockDb.seed('svg_corte_config/settings', { autoGenerate: true, personajeAutoCut: false });
    expect((await activate({})).ok).toBe(true);
    const cfg = mockDb.read('svg_corte_config/settings');
    expect(cfg).toMatchObject({ autoGenerate: false, serverAutoGenerate: true, serverEnabled: true, personajeAutoCut: false });
    expect(cfg.serverStartAfter).toBeGreaterThan(Date.now() + 59 * 60000);
    await activate({}); expect(mockDb.read('svg_corte_config/settings').serverStartAfter).toBe(cfg.serverStartAfter);
});

test('an intentionally disabled automatic queue stays disabled after migration', async () => {
    mockDb.seed('svg_corte_config/settings', { autoGenerate: false });
    await activate({ legacyWorkerStopped: true });
    const cfg = mockDb.read('svg_corte_config/settings');
    expect(cfg.serverAutoGenerate).toBe(false); expect(cfg.serverStartAfter).toBeLessThanOrEqual(Date.now());
});

test('pause stops the server without re-enabling Corel', async () => {
    await activate({ legacyWorkerStopped: true });
    await fetch(base + '/pause', { method: 'POST' });
    const cfg = mockDb.read('svg_corte_config/settings'); expect(cfg.serverEnabled).toBe(false); expect(cfg.autoGenerate).toBe(false);
});

test('status is available before activation and malformed preview input is rejected', async () => {
    const status = await (await fetch(base + '/status')).json();
    expect(status).toMatchObject({ engine: 'server-svg-v1', enabled: false, legacyRequests: [], activeJobs: [] });
    const r = await fetch(base + '/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'unknown', lamps: [] }) });
    expect(r.status).toBe(400);
});

test('confirming a legacy preview retains its exact text and line breaks', () => {
    const { approvedPreviewFields, requestBlocked } = require('../server/design/svgCutRequests');
    const lines = { nombre1: 'José\nLuis', nombre2: 'Ana', fecha: '' };
    const o = { iaForce: { status: 'staged', requestedAt: Date.now(), lines } };
    expect(approvedPreviewFields(o)).toEqual(lines); expect(requestBlocked(o)).toBe(false);
    expect(requestBlocked({ iaForce: { status: 'queued' } })).toBe(true);
    expect(requestBlocked({ iaForce: { status: 'approved' } })).toBe(true);
    expect(() => approvedPreviewFields({ ...o, svgCorteAt: Date.now() })).toThrow('ya tiene corte');
    expect(() => approvedPreviewFields({ iaForce: { status: 'staged' } })).toThrow('no conserva los textos');
    expect(() => approvedPreviewFields({ ...o, datoCorregidoAt: Date.now() + 1000 })).toThrow('cambió desde este previo');
});
