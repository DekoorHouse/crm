/* Service Worker · DeKoor Pendientes · scope /pendientes/
   App 100% autocontenida (HTML/CSS/JS inline) → cacheable y usable offline. */
const CACHE = 'pendientes-v2';

const PRECACHE = [
  '/pendientes/',
  '/pendientes/index.html',
  '/pendientes/manifest.json',
  '/pendientes/icon-192.png',
  '/pendientes/icon-512.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // add() una por una para tolerar fallos puntuales de red.
      Promise.all(PRECACHE.map(u => c.add(u).catch(() => null)))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k.startsWith('pendientes-')).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Solo gestionamos nuestro propio scope + los íconos de marca.
  const inScope = url.origin === location.origin &&
    (url.pathname.startsWith('/pendientes/') || url.pathname === '/favicon.png' || url.pathname === '/favicon-192.png');
  if (!inScope) return;

  // Navegación / HTML → network-first con fallback a caché (para recibir actualizaciones).
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match('/pendientes/index.html')))
    );
    return;
  }

  // Estáticos del scope → cache-first con revalidación en segundo plano.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
