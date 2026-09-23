import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RASTER_MODEL, RASTER_PROMPT, rasterModel, rasterize } from '../public/editor-v2/rasterize.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('the raster conversion sends the image to GPT Image 2.5 Sunburst and waits for the result', async t => {
    const calls = [];
    let polls = 0;
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
        calls.push({ url, init });
        if (url === '/api/imagenes/generations') return json({ success: true, job: { id: 'job-1', status: 'generating' } }, 202);
        polls++;
        return json({ success: true, job: polls < 2 ? { id: 'job-1', status: 'generating' } : { id: 'job-1', status: 'completed', cost: .04, images: [{ fullUrl: 'https://example.com/r.png', width: 1024, height: 1024 }] } });
    });
    t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
    const image = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const result = await rasterize({ image, prompt: RASTER_PROMPT, aspectRatio: '', token: async () => 'token-1' });
    assert.deepEqual(result, { url: 'https://example.com/r.png', width: 1024, height: 1024, cost: .04 });
    const sent = calls[0].init.body;
    assert.equal(sent.get('model'), RASTER_MODEL);
    assert.equal(sent.get('prompt'), 'dame el diseño de la imagen con rellenos blancos y fondos negros. En raster engrave con degradado en trama');
    // "Automático" sends no ratio; the model decides.
    assert.equal(sent.get('aspect_ratio'), null);
    assert.equal(sent.get('references').type, 'image/png');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer token-1');
    assert.equal(calls.length, 3);
});

test('a failed generation, a missing model and a missing session give clear messages', async t => {
    t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 0; });
    const image = new Blob(['x'], { type: 'image/png' });
    t.mock.method(globalThis, 'fetch', async url => url === '/api/imagenes/generations'
        ? json({ success: true, job: { id: 'job-2', status: 'generating' } }, 202)
        : json({ success: true, job: { id: 'job-2', status: 'failed', error: 'No hay saldo suficiente en OpenRouter.' } }));
    await assert.rejects(rasterize({ image, prompt: 'x', token: async () => null }), /saldo/);
    t.mock.method(globalThis, 'fetch', async () => json({ success: true, connected: true, models: [], linkedIds: [] }));
    await assert.rejects(rasterModel(null), /no está disponible/);
    t.mock.method(globalThis, 'fetch', async () => json({ success: false, error: 'No autorizado' }, 401));
    await assert.rejects(rasterModel(null), error => error.login === true);
});
