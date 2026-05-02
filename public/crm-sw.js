/**
 * Service Worker para Dekoor CRM PWA
 *
 * Estrategia:
 * - Network-first para HTML y APIs (siempre datos frescos cuando hay red)
 * - Cache-first para assets estaticos (JS, CSS, imagenes, fuentes)
 * - Fallback a cache cuando no hay red
 */

const CACHE_NAME = 'dekoor-crm-v1';
const STATIC_ASSETS = [
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.png'
];

// Install: pre-cache de assets criticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] install error:', err))
  );
});

// Activate: limpiar caches viejas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('dekoor-crm-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: estrategia hibrida
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo manejamos GET; POST/PUT van directo a red
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // No cachear cross-origin (Firebase, fonts, etc.) — dejar que el browser maneje
  if (url.origin !== self.location.origin) return;

  // No cachear APIs (siempre red, sin fallback de cache para evitar datos stale)
  if (url.pathname.startsWith('/api/')) return;

  // Network-first para HTML (rutas del CRM)
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Cachear la respuesta para uso offline
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/crm/chats.html')))
    );
    return;
  }

  // Cache-first para assets estaticos (_next/static, iconos, etc.)
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
