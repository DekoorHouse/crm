// --- Gesto/botón "Atrás" de Android dentro de la PWA ------------------------------------------
// Problema: en la PWA instalada, si el gesto atrás no encuentra historial dentro de la app,
// Android CIERRA toda la PWA. Aquí interceptamos ese "atrás" para que cierre lo que esté abierto
// DENTRO de la app (modal → chat en móvil → menú lateral) en vez de salir.
//
// Técnica: mantenemos UNA entrada "trampa" en el historial mientras haya algo abierto. Al presionar
// atrás se dispara `popstate`, cerramos la capa de más arriba y re-armamos la trampa si aún quedan
// capas. Si no hay nada que cerrar (o una capa no se pudo cerrar), soltamos la trampa para permitir
// que el siguiente atrás sí salga de la app. Es a prueba de loops (firma de estado).
(function () {
    'use strict';
    if (window.__crmBackGesture) return; // evitar doble init
    window.__crmBackGesture = { loaded: true };

    var EXCLUDE_IDS = { 'sidebar-overlay': 1, 'loading-overlay': 1, 'app-container': 1 };

    function elVisible(el) {
        if (!el) return false;
        if (el.classList && el.classList.contains('hidden')) return false;
        var cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
        var r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
    }

    // ¿Es un backdrop de modal? fixed + fondo semitransparente (scrim) o clase/id de modal.
    function looksLikeModal(el, cs) {
        if (EXCLUDE_IDS[el.id]) return false;
        if (cs.position !== 'fixed') return false;
        var m = (cs.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
        var isScrim = false;
        if (m) {
            var parts = m[1].split(',');
            var a = parts.length > 3 ? parseFloat(parts[3]) : 1;
            isScrim = a > 0.05 && a < 1;
        }
        var name = (el.id || '') + ' ' + (el.className || '');
        var namedModal = /modal|backdrop/i.test(name);
        var r = el.getBoundingClientRect();
        var coversMost = r.width >= window.innerWidth * 0.7 && r.height >= window.innerHeight * 0.7;
        return (isScrim || namedModal) && coversMost;
    }

    // El overlay/modal visible con mayor z-index (entre .modal-backdrop, .image-modal-backdrop y
    // los overlays dinámicos que se anexan como hijos directos del body).
    function topOverlay() {
        var seen = [];
        document.querySelectorAll('.modal-backdrop, .image-modal-backdrop').forEach(function (e) { seen.push(e); });
        var kids = document.body ? document.body.children : [];
        for (var i = 0; i < kids.length; i++) { if (kids[i].nodeType === 1 && seen.indexOf(kids[i]) === -1) seen.push(kids[i]); }
        var best = null, bestZ = -1;
        for (var j = 0; j < seen.length; j++) {
            var el = seen[j];
            if (EXCLUDE_IDS[el.id]) continue;
            if (!elVisible(el)) continue;
            var cs = window.getComputedStyle(el);
            if (!looksLikeModal(el, cs)) continue;
            var z = parseInt(cs.zIndex, 10) || 0;
            if (z >= bestZ) { bestZ = z; best = el; }
        }
        return best;
    }

    function sidebarOpen() {
        var sb = document.getElementById('main-sidebar');
        var ov = document.getElementById('sidebar-overlay');
        return (!!(sb && sb.classList.contains('mobile-open'))) || (!!(ov && ov.classList.contains('active')));
    }

    // Cierra un overlay usando su propio mecanismo (botón de cierre → click en backdrop → forzar).
    function closeOverlay(el) {
        var btn = el.querySelector('.modal-close-btn,.close-modal,.modal-close,[data-dismiss],[data-close],[aria-label="Cerrar"],[title^="Cerrar"]');
        if (btn) { btn.click(); if (!elVisible(el)) return; }
        try { el.click(); } catch (e) {}          // dispara handlers de "click en el backdrop cierra"
        if (!elVisible(el)) return;
        // Último recurso: ocultar (equivale a lo que hacen las funciones close() del CRM).
        el.classList.add('hidden');
        el.style.display = 'none';
        document.body.classList.remove('modal-open');
    }

    // Firma del estado actual de capas (para detectar si un "atrás" logró cerrar algo).
    function signature() {
        var ov = topOverlay();
        return [
            document.getElementById('_cm_cancel') ? 'cm' : '',
            ov ? ('ov:' + (ov.id || ov.className || 'x').toString().slice(0, 24)) : '',
            document.body.classList.contains('chat-open') ? 'chat' : '',
            sidebarOpen() ? 'sb' : ''
        ].join('|');
    }
    function anyLayerOpen() { return signature() !== '|||'; }

    // Cierra la capa de más arriba (prioridad: confirm tematizado → modal → chat móvil → sidebar).
    function closeTopLayer() {
        var cm = document.getElementById('_cm_cancel'); // modal de confirmación tematizado
        if (cm) { cm.click(); return; }

        var ov = topOverlay();
        if (ov) { closeOverlay(ov); return; }

        if (document.body.classList.contains('chat-open')) { // chat abierto en móvil → volver a la lista
            if (typeof window.closeChatOnMobile === 'function') window.closeChatOnMobile();
            else document.body.classList.remove('chat-open');
            return;
        }

        if (sidebarOpen()) { // menú lateral en móvil
            var sb = document.getElementById('main-sidebar');
            var sov = document.getElementById('sidebar-overlay');
            if (sb) sb.classList.remove('mobile-open');
            if (sov) sov.classList.remove('active');
            return;
        }
    }

    var guardArmed = false;
    var stuckSig = null; // firma de una capa que NO se pudo cerrar (para no re-atrapar y permitir salir)

    function armGuard() {
        if (guardArmed) return;
        try { history.pushState({ crmBackGuard: true }, ''); guardArmed = true; } catch (e) {}
    }

    // Mantiene la trampa armada mientras haya una capa cerrable abierta.
    function syncGuard() {
        var sig = signature();
        if (sig !== stuckSig) stuckSig = null; // la capa atorada cambió/cerró
        if (sig !== '|||' && sig !== stuckSig) armGuard();
    }

    window.addEventListener('popstate', function () {
        var before = signature();
        if (before === '|||') { guardArmed = false; return; } // nada abierto → dejar salir
        closeTopLayer();
        var after = signature();
        if (after !== before && after !== '|||') {
            // Cerró una capa y aún quedan otras → re-armar para el próximo atrás.
            guardArmed = false; armGuard();
        } else if (after === '|||') {
            // Cerró todo → soltar; syncGuard re-armará si el usuario abre algo nuevo.
            guardArmed = false; stuckSig = null;
        } else {
            // No hubo progreso (capa atorada) → soltar y no re-atrapar por esa misma capa.
            guardArmed = false; stuckSig = after;
        }
    });

    function start() {
        try {
            var mo = new MutationObserver(function () { syncGuard(); });
            mo.observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true, subtree: false });
        } catch (e) {}
        // Respaldo: tras cualquier click, sincronizamos (cubre modales que abren por opacidad/estilo).
        document.addEventListener('click', function () { setTimeout(syncGuard, 0); }, true);
        syncGuard();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    // Expuesto para depurar/probar (no es API pública del CRM).
    window.__crmBackGesture.closeTopLayer = closeTopLayer;
    window.__crmBackGesture.signature = signature;
    window.__crmBackGesture.syncGuard = syncGuard;
    window.__crmBackGesture.topOverlay = topOverlay;
})();
