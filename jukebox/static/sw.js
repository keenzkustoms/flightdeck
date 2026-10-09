// Minimal service worker — enables PWA installability only.
// No caching: Cindy Vinyl needs a live connection to the Pi / Navidrome.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));
