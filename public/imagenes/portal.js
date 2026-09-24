(() => {
    'use strict';

    // Pantalla de carga mientras se genera: una nube de pixeles de ruido que una línea de luz va "revelando" en una
    // imagen suave, como un modelo de difusión que parte de ruido. Se sostiene, se disuelve y vuelve a empezar con otra
    // paleta. La nube no tiene bordes rectos: su contorno respira y en la orilla los pixeles se desintegran.
    // Ligera a propósito: una versión anterior con shadowBlur a 60 fps colgaba el driver de gráficas integradas AMD.
    // Aquí solo hay rectángulos, sin desenfoque, a 30 fps y con resolución máxima de 1.5×.
    const SPEED = 1;
    const FRAME_MS = 1000 / 30;
    const MAX_DPR = 1.5;
    const CELL = 12, BAND = .12;
    const SWEEP = 3.2, HOLD = 1.6, DISSOLVE = .9, CYCLE = SWEEP + HOLD + DISSOLVE;
    const hex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
    const PALETTES = [
        ['#0b1020', '#3b2f8f', '#6b5cff', '#78e6df', '#c5f67a'],
        ['#0b1020', '#15465a', '#78e6df', '#ac96ff', '#f3eeff'],
        ['#0b1020', '#1e3a1f', '#6fae45', '#c5f67a', '#fff3b0'],
    ].map(stops => stops.map(hex));
    const clamp = value => Math.max(0, Math.min(1, value));
    function colorAt(stops, value, alpha) {
        const position = clamp(value) * (stops.length - 1), i = Math.min(Math.floor(position), stops.length - 2), f = position - i;
        const a = stops[i], b = stops[i + 1];
        return `rgba(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)},${alpha.toFixed(2)})`;
    }
    // Contorno de la nube: un círculo que ondula lento en tres frecuencias.
    function edge(angle, t) {
        return .36 + .045 * Math.sin(3 * angle + t * .8) + .035 * Math.sin(5 * angle - t * 1.1) + .025 * Math.sin(2 * angle + t * .5);
    }
    // Imagen "limpia": ondas suaves y un punto de luz que se pasea.
    function field(nx, ny, t) {
        const bx = .5 + .3 * Math.sin(t * .6), by = .5 + .25 * Math.cos(t * .45);
        const dx = nx - bx, dy = (ny - by) * .7;
        return .42 + .22 * Math.sin(nx * 6 + t * .9) + .14 * Math.sin(ny * 7 - t * 1.2 + nx * 3)
            + .08 * Math.sin((nx + ny) * 10 + t * 1.7) + .3 * Math.exp(-(dx * dx + dy * dy) * 14);
    }

    window.createImageStudioPortal = ({ canvas, field: container, pauseButton, pauseStatus }) => {
        const ctx = canvas.getContext('2d');
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        let active = false, viewVisible = true, intersecting = true, pageVisible = true;
        let paused = reduced.matches, frame = 0, previousTime = null, time = 0, width = 1, height = 1;
        let noise = [], seeds = [];
        pauseButton.hidden = !ctx;
        if (!ctx) return { setActive() {}, setVisible() {} };

        function draw() {
            const cols = Math.max(1, Math.ceil(width / CELL)), rows = Math.max(1, Math.ceil(height / CELL)), total = cols * rows;
            if (noise.length !== total) { noise = Array.from({ length: total }, Math.random); seeds = Array.from({ length: total }, Math.random); }
            // Grano: una parte del ruido cambia en cada cuadro.
            for (let n = Math.ceil(total * .18); n > 0; n--) noise[Math.floor(Math.random() * total)] = Math.random();

            const clock = reduced.matches ? SWEEP + .5 : time;
            const cycle = clock % CYCLE, stops = PALETTES[Math.floor(clock / CYCLE) % PALETTES.length];
            const sweeping = cycle < SWEEP, dissolving = cycle > SWEEP + HOLD;
            const front = sweeping ? cycle / SWEEP * (1 + BAND * 2) - BAND : 2;
            const dissolve = dissolving ? (cycle - SWEEP - HOLD) / DISSOLVE : 0;
            // Posiciones enteras y sin separación: así no aparecen líneas entre los cuadros.
            const offsetX = Math.floor((width - cols * CELL) / 2), offsetY = Math.floor((height - rows * CELL) / 2);

            // Fondo transparente: la nube flota sobre la cuadrícula de la vista previa.
            ctx.clearRect(0, 0, width, height);
            // Un poco arriba del centro: abajo flotan el título, el tiempo y el botón.
            const unit = Math.min(width, height), centerY = height * .42;
            for (let y = 0; y < rows; y++) {
                const ny = (y + .5) / rows, py = offsetY + (y + .5) * CELL - centerY;
                for (let x = 0; x < cols; x++) {
                    const i = y * cols + x, nx = (x + .5) / cols, px = offsetX + (x + .5) * CELL - width / 2;
                    const distance = Math.hypot(px, py) / unit;
                    const alpha = clamp((edge(Math.atan2(py, px), clock) - distance) / .07 + (seeds[i] - .5) * .9);
                    if (alpha < .03) continue;
                    let k = sweeping ? clamp((front - nx) / BAND) : 1;
                    if (dissolving) k = clamp((1 - dissolve) * 1.4 - seeds[i] * .4);
                    let value = k * field(nx, ny, clock) + (1 - k) * noise[i] * .8;
                    // La línea de luz: los pixeles junto al frente del barrido brillan.
                    if (sweeping) { const d = (nx - front) / .025; value += .6 * Math.exp(-d * d); }
                    ctx.fillStyle = colorAt(stops, value, alpha);
                    ctx.fillRect(offsetX + x * CELL, offsetY + y * CELL, CELL, CELL);
                }
            }
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
