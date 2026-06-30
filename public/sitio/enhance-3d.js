/* ============================================================
   DEKOOR · Mejoras 3D / animadas (vanilla JS, sin librerías)
   - Tilt 3D interactivo en tarjetas de colección y carrusel
   - Partículas/bokeh flotantes en el hero
   Aditivo: no depende de script.js ni lo modifica.
   ============================================================ */
(function () {
  'use strict';

  // Respetar a quien prefiere menos movimiento
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* ----------------------------------------------------------
     1) TILT 3D
     ---------------------------------------------------------- */
  function makeTilt(el, opts) {
    opts = opts || {};
    var max = opts.max || 9;     // grados de inclinación
    var lift = opts.lift || 8;   // px que "se levanta"
    var scale = opts.scale || 1.02;

    el.classList.add('tilt3d');
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

    // capa de brillo
    var glare = document.createElement('span');
    glare.className = 'tilt3d-glare';
    el.appendChild(glare);

    var rect = null;
    var raf = null;
    var state = { rx: 0, ry: 0, gx: 50, gy: 50, on: false };

    function apply() {
      raf = null;
      el.style.transform =
        'perspective(900px) rotateX(' + state.rx.toFixed(2) + 'deg) rotateY(' +
        state.ry.toFixed(2) + 'deg) translateY(' + (state.on ? -lift : 0) + 'px) scale(' +
        (state.on ? scale : 1) + ')';
      glare.style.setProperty('--gx', state.gx.toFixed(1) + '%');
      glare.style.setProperty('--gy', state.gy.toFixed(1) + '%');
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(apply); }

    el.addEventListener('pointerenter', function () {
      rect = el.getBoundingClientRect();
      state.on = true;
      el.classList.add('is-tilting');
    });
    el.addEventListener('pointermove', function (e) {
      if (!rect) rect = el.getBoundingClientRect();
      var px = (e.clientX - rect.left) / rect.width;   // 0..1
      var py = (e.clientY - rect.top) / rect.height;   // 0..1
      px = Math.min(1, Math.max(0, px));
      py = Math.min(1, Math.max(0, py));
      state.ry = (px - 0.5) * 2 * max;
      state.rx = (py - 0.5) * -2 * max;
      state.gx = px * 100;
      state.gy = py * 100;
      schedule();
    });
    el.addEventListener('pointerleave', function () {
      state.on = false; state.rx = 0; state.ry = 0; rect = null;
      el.classList.remove('is-tilting');
      schedule();
    });
  }

  function initTilt() {
    // Solo en dispositivos con mouse real (evita interferir con tap/scroll en móvil)
    if (window.matchMedia && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var cards = document.querySelectorAll('.collection-card-v2');
    for (var i = 0; i < cards.length; i++) makeTilt(cards[i], { max: 10, lift: 10, scale: 1.03 });

    var carousel = document.querySelector('.hero-visual .carousel');
    if (carousel) makeTilt(carousel, { max: 7, lift: 4, scale: 1.0 });
  }

  /* ----------------------------------------------------------
     2) PARTÍCULAS / BOKEH EN EL HERO
     ---------------------------------------------------------- */
  function initParticles() {
    var hero = document.querySelector('.hero');
    if (!hero) return;

    var canvas = document.createElement('canvas');
    canvas.className = 'hero-particles';
    hero.insertBefore(canvas, hero.firstChild);
    var ctx = canvas.getContext('2d');

    // colores de marca: naranja (#D4722C) y teal (#1B4D5C)
    var COLORS = ['212,114,44', '27,77,92', '212,114,44', '42,107,126'];
    var W = 0, H = 0, dots = [], dpr = Math.min(window.devicePixelRatio || 1, 2);

    function build() {
      W = hero.clientWidth;
      H = hero.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var n = Math.max(10, Math.min(26, Math.floor(W / 55)));
      dots = [];
      for (var i = 0; i < n; i++) {
        dots.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 24 + Math.random() * 70,
          c: COLORS[i % COLORS.length],
          a: 0.05 + Math.random() * 0.07,
          dx: (Math.random() - 0.5) * 0.28,
          dy: (Math.random() - 0.5) * 0.28
        });
      }
    }

    function frame() {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        d.x += d.dx; d.y += d.dy;
        if (d.x < -90) d.x = W + 90; else if (d.x > W + 90) d.x = -90;
        if (d.y < -90) d.y = H + 90; else if (d.y > H + 90) d.y = -90;
        var g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
        g.addColorStop(0, 'rgba(' + d.c + ',' + d.a + ')');
        g.addColorStop(1, 'rgba(' + d.c + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }

    build();
    requestAnimationFrame(function () { canvas.classList.add('on'); });
    frame();

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(build, 200);
    });
  }

  /* ---------------------------------------------------------- */
  function init() { initTilt(); initParticles(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
