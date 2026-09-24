(() => {
    'use strict';

    // Pantalla de carga mientras se genera: un orbe fluido, como el de un asistente de voz, cuyo contorno ondula en
    // ráfagas. Cada ciclo arranca con grano (ruido) que se va limpiando, como un modelo de difusión, y cambia de paleta.
    // Se calcula en un búfer a 1/4 de resolución y se amplía suavizado: miles de pixeles sin dibujar cuadro por cuadro.
    // Ligera a propósito: una versión anterior con shadowBlur a 60 fps colgaba el driver de gráficas integradas AMD.
    // Aquí la gráfica solo amplía una imagen dos veces por cuadro (orbe y halo), a 30 fps y con resolución máxima 1.5×.
    const SPEED = 1;
    const FRAME_MS = 1000 / 30;
    const MAX_DPR = 1.5;
    const SCALE = 4, CENTER_Y = .42, SOFT_EDGE = .035;
    const CLEAN = 4, HOLD = 1.5, GRAIN = 1, CYCLE = CLEAN + HOLD + GRAIN, MAX_GRAIN = .6;
    const hex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
    // Tablas de 256 colores por paleta, para no armar colores pixel por pixel.
    const PALETTES = [
        ['#1d1760', '#6b5cff', '#78e6df', '#c5f67a', '#f4ffd9'],
        ['#14304a', '#3f8fb0', '#78e6df', '#ac96ff', '#f3eeff'],
        ['#16361c', '#4f9a3c', '#c5f67a', '#78e6df', '#fff6c8'],
    ].map(stops => {
        const rgb = stops.map(hex), table = new Uint8Array(256 * 3);
        for (let i = 0; i < 256; i++) {
            const position = i / 255 * (rgb.length - 1), k = Math.min(Math.floor(position), rgb.length - 2), f = position - k;
            for (let c = 0; c < 3; c++) table[i * 3 + c] = Math.round(rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f);
        }
        return table;
    });

    window.createImageStudioPortal = ({ canvas, field: container, pauseButton, pauseStatus }) => {
        const ctx = canvas.getContext('2d');
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        let active = false, viewVisible = true, intersecting = true, pageVisible = true;
        let paused = reduced.matches, frame = 0, previousTime = null, time = 0, width = 1, height = 1;
        let buffer = null, bufferCtx = null, image = null, geometry = null;
        pauseButton.hidden = !ctx;
        if (!ctx) return { setActive() {}, setVisible() {} };

        // Distancia al centro y ángulos de cada pixel del búfer: no cambian mientras no cambie el tamaño.
        function prepare(w, h) {
            buffer = document.createElement('canvas'); buffer.width = w; buffer.height = h;
            bufferCtx = buffer.getContext('2d'); image = bufferCtx.createImageData(w, h);
            const size = w * h, unit = Math.min(w, h), arrays = () => new Float32Array(size);
            geometry = { w, h, dist: arrays(), s2: arrays(), c2: arrays(), s3: arrays(), c3: arrays(), s5: arrays(), c5: arrays(),
                sx3: new Float32Array(w), cx3: new Float32Array(w), sx10: new Float32Array(w), cx10: new Float32Array(w), wave: new Float32Array(w) };
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = y * w + x, dx = x + .5 - w / 2, dy = y + .5 - h * CENTER_Y, a = Math.atan2(dy, dx);
                    geometry.dist[i] = Math.hypot(dx, dy) / unit;
                    geometry.s2[i] = Math.sin(2 * a); geometry.c2[i] = Math.cos(2 * a);
                    geometry.s3[i] = Math.sin(3 * a); geometry.c3[i] = Math.cos(3 * a);
                    geometry.s5[i] = Math.sin(5 * a); geometry.c5[i] = Math.cos(5 * a);
                }
            }
            for (let x = 0; x < w; x++) {
                const nx = (x + .5) / w;
                geometry.sx3[x] = Math.sin(nx * 3); geometry.cx3[x] = Math.cos(nx * 3);
                geometry.sx10[x] = Math.sin(nx * 10); geometry.cx10[x] = Math.cos(nx * 10);
            }
        }
        function render(t) {
            const { w, h, dist, s2, c2, s3, c3, s5, c5, sx3, cx3, sx10, cx10, wave } = geometry, data = image.data;
            // "Voz": una envolvente lenta con ráfagas rápidas hace que el contorno se agite como al hablar.
            const voice = .5 + .5 * Math.sin(t * 2.1) * Math.sin(t * .73 + .5), burst = .5 + .5 * Math.sin(t * 9.3) * Math.sin(t * 6.1);
            const amp = .008 + .02 * voice + .007 * burst, radius = .31 + .02 * voice, limit = radius + amp * 2.4 + SOFT_EDGE;
            const k1c = Math.cos(t * .8), k1s = Math.sin(t * .8), k2c = Math.cos(-t * 1.1), k2s = Math.sin(-t * 1.1), k3c = Math.cos(t * .5), k3s = Math.sin(t * .5);
            const cycle = t % CYCLE, table = PALETTES[Math.floor(t / CYCLE) % PALETTES.length];
            const grain = cycle < CLEAN ? MAX_GRAIN * (1 - cycle / CLEAN) ** 1.5 : cycle < CLEAN + HOLD ? 0 : MAX_GRAIN * (cycle - CLEAN - HOLD) / GRAIN;
            const bx = .5 + .18 * Math.sin(t * .6), by = CENTER_Y + .16 * Math.cos(t * .45);
            for (let x = 0; x < w; x++) wave[x] = Math.sin((x + .5) / w * 6 + t * .9);
            data.fill(0);
            for (let y = 0; y < h; y++) {
                const ny = (y + .5) / h, sa = Math.sin(ny * 7 - t * 1.2), ca = Math.cos(ny * 7 - t * 1.2);
                const sb = Math.sin(ny * 10 + t * 1.7), cb = Math.cos(ny * 10 + t * 1.7), gy = (ny - by) * .7;
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    if (dist[i] > limit) continue;
                    const r = radius + amp * (s3[i] * k1c + c3[i] * k1s) + amp * .8 * (s5[i] * k2c + c5[i] * k2s) + amp * .6 * (s2[i] * k3c + c2[i] * k3s);
                    const alpha = (r - dist[i]) / SOFT_EDGE;
                    if (alpha <= 0) continue;
                    const gx = (x + .5) / w - bx;
                    let value = .36 + .22 * wave[x] + .14 * (sa * cx3[x] + ca * sx3[x]) + .08 * (sb * cx10[x] + cb * sx10[x]) + .3 * Math.exp(-(gx * gx + gy * gy) * 14);
                    if (grain) value += grain * (Math.random() - .5) * 2;
                    const c = (value <= 0 ? 0 : value >= 1 ? 255 : value * 255 | 0) * 3, o = i * 4;
                    data[o] = table[c]; data[o + 1] = table[c + 1]; data[o + 2] = table[c + 2]; data[o + 3] = alpha >= 1 ? 255 : alpha * 255;
                }
            }
            bufferCtx.putImageData(image, 0, 0);
        }
        function draw() {
            const w = Math.max(1, Math.ceil(width / SCALE)), h = Math.max(1, Math.ceil(height / SCALE));
            if (!geometry || geometry.w !== w || geometry.h !== h) prepare(w, h);
            render(reduced.matches ? CLEAN + .5 : time);
            const drawWidth = w * SCALE, drawHeight = h * SCALE, cx = drawWidth / 2, cy = drawHeight * CENTER_Y, halo = 1.2;
            ctx.clearRect(0, 0, width, height);
            ctx.imageSmoothingEnabled = true;
            // Halo: la misma imagen, más grande y tenue. Sin desenfoque.
            ctx.globalAlpha = .2; ctx.drawImage(buffer, cx - cx * halo, cy - cy * halo, drawWidth * halo, drawHeight * halo);
            ctx.globalAlpha = 1; ctx.drawImage(buffer, 0, 0, drawWidth, drawHeight);
        }
        function stop() {
            if (frame) cancelAnimationFrame(frame);
            frame = 0; previousTime = null;
        }
        function canRun() {
            return active && viewVisible && intersecting && pageVisible && !paused && !document.hidden && canvas.isConnected;
        }
        function schedule() { if (!frame && canRun()) frame = requestAnimationFrame(tick); }
        function tick(now) {
            frame = 0;
            if (!canRun()) { previousTime = null; return; }
            if (previousTime !== null && now - previousTime < FRAME_MS) { schedule(); return; }
            const dt = previousTime === null ? 0 : Math.min((now - previousTime) / 1000, .1);
            previousTime = now; time += dt * SPEED;
            draw(); schedule();
        }
        function resize() {
            if (!active || !viewVisible) return;
            const rect = container.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            width = rect.width; height = rect.height;
            const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
            canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); schedule();
        }
        function renderPause() {
            pauseButton.textContent = paused ? 'Reanudar animación' : 'Pausar animación';
            pauseStatus.hidden = !paused;
            if (paused) stop(); else schedule();
        }
        pauseButton.addEventListener('click', () => { paused = !paused; previousTime = null; renderPause(); });
        reduced.addEventListener('change', event => { if (event.matches) { paused = true; renderPause(); } });
        document.addEventListener('visibilitychange', () => { stop(); schedule(); });
        window.addEventListener('pagehide', () => { pageVisible = false; stop(); });
        window.addEventListener('pageshow', () => { pageVisible = true; schedule(); });
        new IntersectionObserver(entries => { intersecting = entries[0].isIntersecting; stop(); schedule(); }, { threshold: .05 }).observe(container);
        new ResizeObserver(resize).observe(container);
        renderPause();
        return {
            setActive(value) { active = !!value; if (active) resize(); else stop(); },
            setVisible(value) { viewVisible = !!value; if (viewVisible) resize(); else stop(); },
        };
    };
})();
