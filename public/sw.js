// Basic Service Worker
self.addEventListener('install', event => {
  console.log('SW instalado');
});

self.addEventListener('fetch', event => {
  // Pass-through for now
});
