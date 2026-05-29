/**
 * Service Worker para la PWA "Dekoor Retargeting"
 * (Audiencias, Cobranza, Retargeting, Campañas)
 *
 * Estrategia:
 * - Network-first para HTML (siempre datos frescos cuando hay red, fallback a cache offline)
 * - Sin cache para /api/ (siempre red, evita datos viejos)
 * - Cache-first para assets estáticos
 */

const CACHE_NAME = 'dekoor-retargeting-v1';
const STATIC_ASSETS = [
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[retargeting-sw] install error:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('dekoor-retargeting-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // No tocar cross-origin (Firebase, fonts, CDNs)
  if (url.origin !== self.location.origin) return;

  // APIs siempre a red, sin cache
  if (url.pathname.startsWith('/api/')) return;

  // Network-first para navegación (HTML)
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/audiencias/')))
    );
    return;
  }

  // Cache-first para assets estáticos
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
