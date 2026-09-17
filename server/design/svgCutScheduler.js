'use strict';
let timer, running = false;
async function tick() {
    if (running) return;
    running = true;
    try {
        const result = await require('./svgCutWorker').productionWorker().run();
        if (!result.skipped) console.log('[SVG CORTE]', JSON.stringify(result));
    } catch (e) { console.error('[SVG CORTE]', e.message); }
    finally { running = false; }
}
function startSvgCutScheduler() {
    if (timer) return;
    timer = setInterval(tick, 2 * 60000); timer.unref();
    const first = setTimeout(tick, 30000); first.unref();
    console.log('[SVG CORTE] Motor del servidor disponible; activación y candado en Firestore.');
}
module.exports = { startSvgCutScheduler, tick };
