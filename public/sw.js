const CACHE_NAME = 'dekoor-v3';
const STATIC_ASSETS = [
    '/sitio/',
    '/sitio/style.css',
    '/sitio/script.js',
    '/sitio/cart.js',
    '/sitio/img/logo-dekoor.webp',
    '/favicon.png',
    '/404.html'
];

// Install: pre-cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
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

// Fetch: Network first for API/HTML, Cache first for static assets
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

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

    // CSS, JS: Stale-while-revalidate (fast load + background update)
    if (url.pathname.match(/\.(css|js)$/)) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                const fetchPromise = fetch(event.request).then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                });
                return cached || fetchPromise;
            })
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
