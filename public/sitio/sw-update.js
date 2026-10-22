/* ============================================================
   DEKOOR · Registro del service worker + auto-actualización
   Cuando se publica una versión nueva (CACHE_NAME en /sw.js), el SW
   nuevo toma el control y esta página se recarga sola para mostrarla.
   - Si el cambio llega en los primeros segundos de la visita, recarga
     de inmediato (el cliente apenas abrió el link).
   - Si llega más tarde, espera a que la pestaña vuelva a primer plano
     para no recargar mientras alguien está escribiendo.
   ============================================================ */
(function () {
    'use strict';
    if (!('serviceWorker' in navigator)) return;

    var loadedAt = Date.now();
    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    var pendingReload = false;

    function reload() {
        if (reloading) return;
        reloading = true;
        window.location.reload();
    }

    navigator.serviceWorker.addEventListener('controllerchange', function () {
        // Primera visita: el SW toma control por primera vez, la página ya es la actual
        if (!hadController) { hadController = true; return; }
        if (Date.now() - loadedAt < 8000 || document.visibilityState === 'hidden') reload();
        else pendingReload = true;
    });

    navigator.serviceWorker.register('/sw.js').then(function (reg) {
        // Al volver a la pestaña (p. ej. el cliente regresa a WhatsApp y vuelve), buscar versión nueva
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible') return;
            if (pendingReload) { reload(); return; }
            reg.update().catch(function () {});
        });
    }).catch(function () {});
})();
