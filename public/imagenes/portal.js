(() => {
    'use strict';

    // Pantalla de carga mientras se genera: un orbe fluido como una lámpara de lava. Mini orbes se desprenden del
    // central, flotan y vuelven a fundirse (metaballs: la silueta es donde la suma de sus campos pasa un umbral, así se
    // unen con un "cuello" suave). Cada campo tiene alcance limitado (1.5× su radio) para que puedan soltarse del todo.
    // Los colores fluyen por dentro y cambian de paleta con una transición suave.
    // Se calcula en un búfer a 1/4 de resolución y se amplía suavizado: miles de pixeles sin dibujar cuadro por cuadro.
    // Ligera a propósito: una versión anterior con shadowBlur a 60 fps colgaba el driver de gráficas integradas AMD.
    // Aquí la gráfica solo amplía una imagen por cuadro, a 30 fps y con resolución máxima 1.5×.
    const SPEED = 1;
    const FRAME_MS = 1000 / 30;
    const MAX_DPR = 1.5;
    const SCALE = 4, CENTER_Y = .45, RADIUS = .27, REACH = 2.25, SOFT = .12;
    // Umbral: donde un orbe solo tiene su borde, a exactamente su radio.
    const EDGE = (1 - 1 / REACH) ** 2;
    const PALETTE_TIME = 8, BLEND_TIME = 2;
    // Mini orbes: dirección de salida, vaivén, velocidad, desfase y tamaño relativo al orbe central.
    const MINIS = [
        { angle: -.4, sway: .25, speed: .42, phase: 0, size: .4 },
        { angle: Math.PI + .3, sway: .3, speed: .35, phase: 2.1, size: .34 },
        { angle: .5, sway: .2, speed: .5, phase: 4.2, size: .3 },
        { angle: Math.PI - .55, sway: .25, speed: .3, phase: 1.2, size: .42 },
    ];
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
        const minis = MINIS.map(() => ({ x: 0, y: 0, r2: 0 }));
        pauseButton.hidden = !ctx;
        if (!ctx) return { setActive() {}, setVisible() {} };

        // Posición de cada pixel del búfer respecto al centro y ángulos para la ondulación: no cambian con el tiempo.
        function prepare(w, h) {
            buffer = document.createElement('canvas'); buffer.width = w; buffer.height = h;
            bufferCtx = buffer.getContext('2d'); image = bufferCtx.createImageData(w, h);
            const size = w * h, unit = Math.min(w, h), arrays = () => new Float32Array(size);
            geometry = { w, h, px: arrays(), py: arrays(), d2: arrays(), s2: arrays(), c2: arrays(), s3: arrays(), c3: arrays(),
                sx3: new Float32Array(w), cx3: new Float32Array(w), sx10: new Float32Array(w), cx10: new Float32Array(w), wave: new Float32Array(w) };
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = y * w + x, px = (x + .5 - w / 2) / unit, py = (y + .5 - h * CENTER_Y) / unit, a = Math.atan2(py, px);
                    geometry.px[i] = px; geometry.py[i] = py; geometry.d2[i] = px * px + py * py;
                    geometry.s2[i] = Math.sin(2 * a); geometry.c2[i] = Math.cos(2 * a);
                    geometry.s3[i] = Math.sin(3 * a); geometry.c3[i] = Math.cos(3 * a);
                }
            }
            for (let x = 0; x < w; x++) {
                const nx = (x + .5) / w;
                geometry.sx3[x] = Math.sin(nx * 3); geometry.cx3[x] = Math.cos(nx * 3);
                geometry.sx10[x] = Math.sin(nx * 10); geometry.cx10[x] = Math.cos(nx * 10);
            }
        }
        function render(t) {
            const { w, h, px, py, d2, s2, c2, s3, c3, sx3, cx3, sx10, cx10, wave } = geometry, data = image.data;
            // El orbe central respira y ondula suave; los mini orbes salen hasta separarse y regresan a fundirse.
            const breath = .5 + .5 * Math.sin(t * 1.3) * Math.sin(t * .6 + .5);
            const radius = RADIUS + .012 * breath, amp = .006 + .01 * breath;
            const k1c = Math.cos(t * .8), k1s = Math.sin(t * .8), k2c = Math.cos(t * .5), k2s = Math.sin(t * .5);
            MINIS.forEach((mini, n) => {
                const reach = .5 - .5 * Math.cos(t * mini.speed + mini.phase), angle = mini.angle + mini.sway * Math.sin(t * .3 + mini.phase);
                const distance = radius * (.2 + 1.9 * reach), size = radius * mini.size;
                minis[n].x = Math.cos(angle) * distance; minis[n].y = Math.sin(angle) * distance; minis[n].r2 = size * size * REACH;
            });
            const round = Math.floor(t / PALETTE_TIME), into = t % PALETTE_TIME;
            const from = PALETTES[round % PALETTES.length], to = PALETTES[(round + 1) % PALETTES.length];
            const blend = into > PALETTE_TIME - BLEND_TIME ? (into - PALETTE_TIME + BLEND_TIME) / BLEND_TIME : 0;
            const bx = .5 + .18 * Math.sin(t * .6), by = CENTER_Y + .16 * Math.cos(t * .45);
            for (let x = 0; x < w; x++) wave[x] = Math.sin((x + .5) / w * 6 + t * .9);
            data.fill(0);
            for (let y = 0; y < h; y++) {
                const ny = (y + .5) / h, sa = Math.sin(ny * 7 - t * 1.2), ca = Math.cos(ny * 7 - t * 1.2);
                const sb = Math.sin(ny * 10 + t * 1.7), cb = Math.cos(ny * 10 + t * 1.7), gy = (ny - by) * .7;
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    const main = radius + amp * (s3[i] * k1c + c3[i] * k1s) + amp * .7 * (s2[i] * k2c + c2[i] * k2s);
                    // Campo de cada orbe: (1 - d²/alcance²)², cero fuera de su alcance.
                    let k = 1 - d2[i] / (main * main * REACH), energy = k > 0 ? k * k : 0;
                    for (let n = 0; n < minis.length; n++) {
                        const dx = px[i] - minis[n].x, dy = py[i] - minis[n].y;
                        k = 1 - (dx * dx + dy * dy) / minis[n].r2;
                        if (k > 0) energy += k * k;
                    }
                    const alpha = (energy - EDGE) / SOFT;
                    if (alpha <= 0) continue;
                    const gx = (x + .5) / w - bx;
                    const value = .36 + .22 * wave[x] + .14 * (sa * cx3[x] + ca * sx3[x]) + .08 * (sb * cx10[x] + cb * sx10[x]) + .3 * Math.exp(-(gx * gx + gy * gy) * 14);
                    const c = (value <= 0 ? 0 : value >= 1 ? 255 : value * 255 | 0) * 3, o = i * 4;
                    data[o] = from[c] + (to[c] - from[c]) * blend;
                    data[o + 1] = from[c + 1] + (to[c + 1] - from[c + 1]) * blend;
                    data[o + 2] = from[c + 2] + (to[c + 2] - from[c + 2]) * blend;
                    data[o + 3] = alpha >= 1 ? 255 : alpha * 255;
                }
            }
            bufferCtx.putImageData(image, 0, 0);
        }
        function draw() {
            const w = Math.max(1, Math.ceil(width / SCALE)), h = Math.max(1, Math.ceil(height / SCALE));
            if (!geometry || geometry.w !== w || geometry.h !== h) prepare(w, h);
            render(reduced.matches ? 2.5 : time);
            ctx.clearRect(0, 0, width, height);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(buffer, 0, 0, w * SCALE, h * SCALE);
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
