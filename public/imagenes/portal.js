(() => {
    'use strict';

    // Animación mientras se genera: un láser grabando diseños en un disco de acrílico sobre su base de LED,
    // como las lámparas de Dekoor. Ligera a propósito: la versión anterior (shadowBlur en 32 anillos a 60 fps)
    // llegó a colgar el driver de gráficas integradas AMD en generaciones largas. Aquí el brillo es una segunda
    // línea ancha y tenue, a 30 fps y con resolución máxima de 1.5×.
    const SPEED = 1;
    const FRAME_MS = 1000 / 30;
    const MAX_DPR = 1.5;
    const DRAW_TIME = 3.4, HOLD_TIME = 1.3, FADE_TIME = .7, CYCLE = DRAW_TIME + HOLD_TIME + FADE_TIME;
    const ENGRAVE = '#7ff3ff', LASER = '#c5f67a', BASE = '#ac96ff', SPARKS = ['#c5f67a', '#ffd27a', '#ffffff'];
    const MAX_SPARKS = 70;
    const rgba = (hex, alpha) => `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')},${alpha})`;
    const sample = (count, fn) => Array.from({ length: count + 1 }, (_, i) => fn(i / count));
    // Centra cada diseño y lo lleva a [-1, 1] para que todos ocupen lo mismo dentro del disco.
    function normalize(points) {
        const xs = points.map(p => p.x), ys = points.map(p => p.y);
        const midX = (Math.max(...xs) + Math.min(...xs)) / 2, midY = (Math.max(...ys) + Math.min(...ys)) / 2;
        const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
        return points.map(p => ({ x: (p.x - midX) / half, y: (p.y - midY) / half }));
    }
    const starPoint = k => { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? .42 : 1; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; };
    const DESIGNS = [
        // Infinito, como la lámpara infinito personalizada.
        normalize(sample(220, t => { const a = t * Math.PI * 2, d = 1 + Math.sin(a) ** 2; return { x: Math.cos(a) / d, y: Math.sin(a) * Math.cos(a) / d }; })),
        normalize(sample(200, t => { const a = t * Math.PI * 2; return { x: 16 * Math.sin(a) ** 3, y: -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) }; })),
        normalize(sample(200, t => { const i = Math.min(Math.floor(t * 10), 9), f = t * 10 - i, p = starPoint(i), q = starPoint(i + 1); return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f }; })),
        normalize(sample(260, t => { const a = t * Math.PI * 2, r = .35 + .65 * Math.abs(Math.cos(a * 2.5)); return { x: Math.cos(a) * r, y: Math.sin(a) * r }; })),
    ];

    window.createImageStudioPortal = ({ canvas, field, pauseButton, pauseStatus }) => {
        const ctx = canvas.getContext('2d');
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        let active = false, viewVisible = true, intersecting = true, pageVisible = true;
        let paused = reduced.matches, frame = 0, previousTime = null, time = 0, width = 1, height = 1;
        let sparks = [], sparkTime = null;
        pauseButton.hidden = !ctx;
        if (!ctx) return { setActive() {}, setVisible() {} };

        function glowStroke(color, alpha, lineWidth, glow) {
            ctx.strokeStyle = rgba(color, alpha * .18); ctx.lineWidth = lineWidth + glow; ctx.stroke();
            ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = lineWidth; ctx.stroke();
        }
        function updateSparks(x, y, emitting) {
            const step = sparkTime === null ? 0 : Math.max(0, Math.min(time - sparkTime, .1));
            sparkTime = time;
            if (emitting) for (const color of SPARKS) if (sparks.length < MAX_SPARKS) {
                sparks.push({ x, y, vx: (Math.random() - .5) * 170, vy: -20 - Math.random() * 150, life: .35 + Math.random() * .45, color });
            }
            sparks = sparks.filter(spark => (spark.life -= step) > 0);
            for (const color of SPARKS) {
                ctx.beginPath();
                for (const spark of sparks) {
                    if (spark.color !== color) continue;
                    spark.vy += 380 * step; spark.x += spark.vx * step; spark.y += spark.vy * step;
                    ctx.moveTo(spark.x, spark.y); ctx.lineTo(spark.x - spark.vx * .025, spark.y - spark.vy * .025);
                }
                ctx.strokeStyle = rgba(color, .85); ctx.lineWidth = 1.3; ctx.stroke();
            }
        }
        function draw() {
            const radius = Math.min(width * .3, height * .37), cx = width / 2, cy = height * .45;
            ctx.fillStyle = '#070b14'; ctx.fillRect(0, 0, width, height);
            const halo = ctx.createRadialGradient(cx, cy, radius * .2, cx, cy, radius * 1.7);
            halo.addColorStop(0, '#11253a'); halo.addColorStop(1, '#070b14');
            ctx.fillStyle = halo; ctx.fillRect(0, 0, width, height);
            // Cuadrícula tenue de la cama del láser.
            ctx.beginPath();
            for (let x = (width % 34) / 2; x < width; x += 34) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
            for (let y = (height % 34) / 2; y < height; y += 34) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
            ctx.strokeStyle = 'rgba(128,140,162,.05)'; ctx.lineWidth = 1; ctx.stroke();

            // Con movimiento reducido se muestra un diseño terminado, sin láser.
            const clock = reduced.matches ? DRAW_TIME + .2 : time;
            const cycle = clock % CYCLE, design = DESIGNS[Math.floor(clock / CYCLE) % DESIGNS.length];
            const progress = Math.min(cycle / DRAW_TIME, 1);
            const fade = cycle > DRAW_TIME + HOLD_TIME ? 1 - (cycle - DRAW_TIME - HOLD_TIME) / FADE_TIME : 1;
            const pulse = progress < 1 ? 1 : .85 + .15 * Math.sin((cycle - DRAW_TIME) * 6);

            ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fillStyle = rgba(ENGRAVE, .025); ctx.fill();
            glowStroke(ENGRAVE, .32, 1.2, 5);
            // Base de LED: cuerpo oscuro con su tira de luz, que brilla más cuando el diseño está terminado.
            const baseWidth = radius * 1.15, baseHeight = radius * .3, baseY = cy + radius * .88, glow = .45 + .35 * fade * pulse;
            ctx.fillStyle = '#18202f'; ctx.fillRect(cx - baseWidth / 2, baseY, baseWidth, baseHeight);
            ctx.fillStyle = '#222c3e'; ctx.fillRect(cx - baseWidth / 2, baseY, baseWidth, 3);
            ctx.fillStyle = rgba(BASE, glow * .5); ctx.fillRect(cx - baseWidth * .32, baseY + baseHeight * .45, baseWidth * .64, 2);
            ctx.beginPath(); ctx.moveTo(cx - baseWidth / 2, baseY); ctx.lineTo(cx + baseWidth / 2, baseY);
            glowStroke(BASE, glow, 1.5, 6);

            const scale = radius * .62, point = p => [cx + p.x * scale, cy + p.y * scale];
            const count = Math.max(2, Math.round(progress * (design.length - 1)) + 1);
            ctx.beginPath();
            for (let i = 0; i < count; i++) { const [x, y] = point(design[i]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
            glowStroke(ENGRAVE, .9 * fade * pulse, progress < 1 ? 1.8 : 2.2, progress < 1 ? 7 : 9);

            const drawing = progress < 1;
            const [headX, headY] = point(design[count - 1]);
            if (drawing) {
                // Riel, cabezal y rayo del láser.
                ctx.fillStyle = '#1b2433'; ctx.fillRect(0, 14, width, 4);
                ctx.fillStyle = '#c9d4e1'; ctx.fillRect(headX - 9, 8, 18, 14);
                ctx.beginPath(); ctx.moveTo(headX, 22); ctx.lineTo(headX, headY);
                glowStroke(LASER, .55, 1, 5);
                const spot = ctx.createRadialGradient(headX, headY, 0, headX, headY, 16);
                spot.addColorStop(0, 'rgba(255,255,255,.95)'); spot.addColorStop(.25, rgba(LASER, .8)); spot.addColorStop(1, rgba(LASER, 0));
                ctx.fillStyle = spot; ctx.beginPath(); ctx.arc(headX, headY, 16, 0, Math.PI * 2); ctx.fill();
            }
            updateSparks(headX, headY, drawing && !reduced.matches);
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
            const rect = field.getBoundingClientRect();
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
        new IntersectionObserver(entries => { intersecting = entries[0].isIntersecting; stop(); schedule(); }, { threshold: .05 }).observe(field);
        new ResizeObserver(resize).observe(field);
        renderPause();
        return {
            setActive(value) { active = !!value; if (active) resize(); else stop(); },
            setVisible(value) { viewVisible = !!value; if (viewVisible) resize(); else stop(); },
        };
    };
})();
