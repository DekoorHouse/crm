const CACHE_NAME = 'dekoor-v28';
const STATIC_ASSETS = [
    '/sitio/',
    '/sitio/style.css',
    '/sitio/premium.css',
    '/sitio/script.js',
    '/sitio/cart.js',
    '/sitio/img/logo-dekoor.webp',
    '/favicon.png',
    '/404.html'
];

// Install: pre-cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        // cache: 'reload' salta la caché HTTP: si no, el SW nuevo podía precachear el CSS/JS viejo
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: Network first for HTML/CSS/JS, Cache first for images/fonts
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // El estudio debe cargar la versión actual junto con sus rutas de generación.
    if (url.pathname === '/imagenes' || url.pathname.startsWith('/imagenes/')) return;

    // Skip API calls, webhooks, and external URLs
    if (url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/webhook') ||
        url.pathname.startsWith('/env-config') ||
        url.origin !== self.location.origin) return;

    // Images, fonts: Cache first (rarely change)
    if (url.pathname.match(/\.(webp|png|jpg|jpeg|gif|svg|ico|woff|woff2)$/)) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // CSS, JS: Network first (revalidando contra el servidor) con la caché solo como respaldo sin red.
    // Antes era stale-while-revalidate y el cliente veía la versión anterior hasta su siguiente visita.
    if (url.pathname.match(/\.(css|js)$/)) {
        event.respondWith(
            fetch(event.request.mode === 'navigate' ? event.request : new Request(event.request, { cache: 'no-cache' }))
                .then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // HTML pages: Network first with cache fallback
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request).then(cached => cached || caches.match('/404.html')))
    );
});

// Push notifications
self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Dekoor';
    const options = {
        body: data.body || 'Tienes una nueva notificación',
        icon: '/favicon.png',
        badge: '/favicon.png',
        data: { url: data.url || '/sitio/' }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || '/sitio/';
    event.waitUntil(clients.openWindow(url));
});
