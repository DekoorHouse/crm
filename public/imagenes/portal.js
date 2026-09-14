(() => {
    'use strict';

    // El tiempo de vuelo usa 3× el ritmo del primer preview del portal.
    const SPEED = 3;
    const COLORS = ['#c5f67a', '#78e6df', '#ac96ff'];
    const OUTLINE = Array.from({ length: 97 }, (_, j) => {
        const theta = j / 96 * Math.PI * 2, cs = Math.cos(theta), sn = Math.sin(theta);
        return { x: Math.sign(cs) * Math.pow(Math.abs(cs), .55), y: Math.sign(sn) * Math.pow(Math.abs(sn), .55) * .78 };
    });
    const STARS = Array.from({ length: 90 }, (_, i) => ({
        x: ((i * 127.31 + 23) % 997) / 997, y: ((i * 331.17 + 91) % 991) / 991,
        r: i % 4 === 0 ? 1.4 : .65, phase: i * 2.37,
    }));
    const rgba = (hex, alpha) => `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')},${alpha})`;

    window.createImageStudioPortal = ({ canvas, field, pauseButton, pauseStatus }) => {
        const ctx = canvas.getContext('2d');
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        let active = false, viewVisible = true, intersecting = true, pageVisible = true;
        let paused = reduced.matches, frame = 0, previousTime = null, time = 0, width = 1, height = 1;
        pauseButton.hidden = !ctx;
        if (!ctx) return { setActive() {}, setVisible() {} };

        function draw() {
            ctx.fillStyle = '#080d17'; ctx.fillRect(0, 0, width, height);
            const glow = ctx.createRadialGradient(width * .5, height * .52, 0, width * .5, height * .52, width * .65);
            glow.addColorStop(0, '#201336'); glow.addColorStop(1, '#080d17');
            ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
            for (const star of STARS) {
                ctx.globalAlpha = .25 + .4 * (.5 + .5 * Math.sin(time * .5 + star.phase));
                ctx.fillStyle = star.phase % 3 > 1 ? '#a0bce6' : '#e0f8ef';
                ctx.beginPath(); ctx.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 1;
            // Trayectoria automática: ninguna interacción del puntero controla el vuelo.
            const px = Math.sin(time * .19) * .25, py = Math.cos(time * .17) * .2;
            const centerX = width * (.5 + px * .13), centerY = height * (.47 + py * .12);
            const extent = Math.hypot(width, height) * .8;
            for (let i = 31; i >= 0; i--) {
                const depth = (i / 32 + time * .036) % 1, radius = 7 + Math.pow(depth, 2.4) * extent;
                const x = centerX + px * depth * width * .32, y = centerY + py * depth * height * .3;
                const angle = time * .12 + depth * 2.9, cs = Math.cos(angle), sn = Math.sin(angle);
                const color = COLORS[i % COLORS.length];
                ctx.strokeStyle = rgba(color, .14 + depth * .58); ctx.lineWidth = .8 + depth * 1.5;
                ctx.shadowBlur = depth > .33 ? 9 : 4; ctx.shadowColor = color;
                ctx.beginPath();
                OUTLINE.forEach((point, j) => {
                    const vx = x + radius * (point.x * cs - point.y * sn);
                    const vy = y + radius * (point.x * sn + point.y * cs);
                    if (j === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                });
                ctx.stroke();
            }
            ctx.shadowBlur = 0;
            const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 35);
            core.addColorStop(0, '#deccff'); core.addColorStop(.12, '#a297ffbb');
            core.addColorStop(.5, '#765cff22'); core.addColorStop(1, '#765cff00');
            ctx.fillStyle = core; ctx.beginPath(); ctx.arc(centerX, centerY, 35, 0, Math.PI * 2); ctx.fill();
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
            const dt = previousTime === null ? 0 : Math.min((now - previousTime) / 1000, .1);
            previousTime = now; time += dt * SPEED;
            draw(); schedule();
        }
        function resize() {
            if (!active || !viewVisible) return;
            const rect = field.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            width = rect.width; height = rect.height;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
