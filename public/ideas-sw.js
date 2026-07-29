// Service worker mínimo de la pizarra de Ideas.
// Solo existe para que la PWA sea instalable; no cachea nada (la app es
// online-first: Firestore ya maneja su propio estado offline).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
