// Minimal service worker — enables PWA installability only.
// No caching: PrintShelf requires a live connection to the Pi.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
