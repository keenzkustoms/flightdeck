// Minimal service worker — enables PWA installability only.
// No caching: Flightdeck requires a live connection to the Pi.
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
