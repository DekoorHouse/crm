// Service Worker para CRM Admon (PWA)
// Estrategia:
//  - HTML/navegación: network-first con fallback a cache
//  - JS/CSS/Img estáticos: cache-first con actualización en background
//  - API/Firestore/Firebase: passthrough (sin cachear)

// v8 (2026-05-18): Font Awesome también se mueve a copia local
// (js/vendor/fontawesome/). Antes venía de cdnjs y los iconos no cargaban
// en producción. Bump fuerza refresh.
const CACHE_VERSION = 'admon-v8';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;

const PRECACHE_URLS = [
    '/admon/',
    '/admon/index.html',
    '/admon/login.html',
    '/admon/style.css',
    // Librerías críticas locales (sin CDN). Precachearlas hace que la app
    // funcione aunque haya degradación de red en el primer load.
    '/admon/js/vendor/xlsx.full.min.js',
    '/admon/js/vendor/chart.min.js',
    '/admon/js/vendor/fontawesome/css/all.min.css',
    '/admon/js/vendor/fontawesome/webfonts/fa-solid-900.woff2',
    '/admon/js/vendor/fontawesome/webfonts/fa-regular-400.woff2',
    '/admon/js/vendor/fontawesome/webfonts/fa-brands-400.woff2',
    '/manifest.json',
    '/favicon.png',
    '/favicon-192.png'
];

// --- INSTALL: precache de archivos críticos ---
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(PRECACHE_URLS).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

// --- ACTIVATE: limpiar caches viejos ---
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(k => !k.startsWith(CACHE_VERSION))
                    .map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// --- FETCH: enrutador por tipo de request ---
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Pasar a red sin cachear: APIs, Firebase/Firestore, sockets
    if (
        url.pathname.startsWith('/api/') ||
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('identitytoolkit') ||
        url.hostname.includes('securetoken')
    ) {
        return; // dejar que el browser haga la request normal
    }

    // Navegación (HTML): network-first con fallback a cache
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
        event.respondWith(
            fetch(req)
                .then(res => {
                    const copy = res.clone();
                    caches.open(PAGE_CACHE).then(c => c.put(req, copy)).catch(() => {});
                    return res;
                })
                .catch(() => caches.match(req).then(r => r || caches.match('/admon/index.html')))
        );
        return;
    }

    // Estáticos (js/css/img/fonts): cache-first con revalidación en bg
    event.respondWith(
        caches.match(req).then(cached => {
            const fetchPromise = fetch(req).then(res => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(STATIC_CACHE).then(c => c.put(req, copy)).catch(() => {});
                }
                return res;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});

// --- MESSAGE: permitir actualizar sin esperar ---
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
