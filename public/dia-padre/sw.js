/* Service Worker · DeKoor Día del Padre 2026 · scope /dia-padre/ */
const CACHE = 'dia-padre-v1';

// Shell propio + íconos + SDK de Firebase (versionado → seguro cachear para uso offline).
const PRECACHE = [
  '/dia-padre/',
  '/dia-padre/index.html',
  '/dia-padre/manifest.json',
  '/favicon-192.png',
  '/favicon.png',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // addAll falla si UNA falla; cacheamos una por una para tolerar fallos de red.
      Promise.all(PRECACHE.map(u => c.add(u).catch(() => null)))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k.startsWith('dia-padre-')).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Llamadas reales de autenticación / APIs → siempre red (no cachear).
  if (/identitytoolkit|securetoken|googleapis\.com|\/api\//.test(url.href)) return;

  // SDK de Firebase (gstatic, versionado) → cache-first.
  if (url.href.startsWith('https://www.gstatic.com/firebasejs/')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // Solo gestionamos nuestro propio scope para el resto.
  if (url.origin === location.origin && url.pathname.startsWith('/dia-padre/')) {
    // Navegación / HTML → network-first con fallback a caché.
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      e.respondWith(
        fetch(req).then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        }).catch(() => caches.match(req).then(hit => hit || caches.match('/dia-padre/index.html')))
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
  }
});
