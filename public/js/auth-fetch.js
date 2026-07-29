/**
 * auth-fetch.js — Parche global de window.fetch: a toda llamada que vaya a /api le
 * adjunta `Authorization: Bearer <Firebase ID token>` del usuario logueado. Es lo
 * que exige el middleware del servidor (server/apiAuth.js) en modo enforce, sin
 * tener que tocar los cientos de fetch() repartidos por el CRM vanilla.
 *
 * Cómo obtiene el token, en orden:
 *   1. window.__API_AUTH_GET_TOKEN__() — gancho que definen las páginas que usan
 *      Firebase MODULAR (editor, pedidos, dia-padre, inventario), porque ahí no
 *      existe el global `firebase`.
 *   2. firebase.auth().currentUser.getIdToken() — páginas con SDK compat
 *      (CRM principal, auth-guard.js, checador, moderación).
 *
 * Reglas: solo URLs de /api (mismo origen, o el dominio de window.API_BASE_URL si
 * está configurado); respeta un header Authorization ya puesto; espera hasta 3 s a
 * que Firebase restaure la sesión; ante cualquier error la llamada sale sin token
 * (el servidor decide: en modo log pasa, en enforce responde 401).
 *
 * Incluir DESPUÉS de los <script> de Firebase y ANTES de los scripts de la app.
 */
(function () {
    'use strict';
    if (window.__apiAuthFetchInstalled) return;
    window.__apiAuthFetchInstalled = true;

    var originalFetch = window.fetch.bind(window);
    var authReadyPromise = null;

    // Resuelve cuando Firebase compat emite su primer estado de sesión (tope 3 s).
    function authReady() {
        if (!authReadyPromise) {
            authReadyPromise = new Promise(function (resolve) {
                var timer = setTimeout(resolve, 3000);
                var done = function () { clearTimeout(timer); resolve(); };
                try {
                    var off = firebase.auth().onAuthStateChanged(
                        function () { off(); done(); },
                        function () { off(); done(); }
                    );
                } catch (e) { done(); }
            });
        }
        return authReadyPromise;
    }

    function isApiUrl(input) {
        try {
            var raw = typeof input === 'string' ? input : (input && input.url) || String(input);
            var u = new URL(raw, window.location.origin);
            var sameOrigin = u.origin === window.location.origin;
            var apiBase = String(window.API_BASE_URL || '');
            var baseMatch = apiBase !== '' && u.href.indexOf(apiBase) === 0;
            return (sameOrigin || baseMatch) && (u.pathname === '/api' || u.pathname.indexOf('/api/') === 0);
        } catch (e) { return false; }
    }

    function getToken() {
        try {
            if (typeof window.__API_AUTH_GET_TOKEN__ === 'function') {
                return Promise.resolve(window.__API_AUTH_GET_TOKEN__()).catch(function () { return null; });
            }
            if (!window.firebase || !firebase.auth) return Promise.resolve(null);
            return authReady().then(function () {
                var user = firebase.auth().currentUser;
                return user ? user.getIdToken() : null;
            }).catch(function () { return null; });
        } catch (e) { return Promise.resolve(null); }
    }

    window.fetch = function (input, init) {
        if (!isApiUrl(input)) return originalFetch(input, init);
        return getToken().then(function (token) {
            try {
                var headers = new Headers((init && init.headers) || (input && input.headers) || undefined);
                if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
                return originalFetch(input, Object.assign({}, init || {}, { headers: headers }));
            } catch (e) {
                return originalFetch(input, init);
            }
        });
    };
})();
