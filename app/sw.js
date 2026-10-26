// Service worker: lets the phone install the page as an app and open it without a connection.
// The app's own files are fetched fresh from the server first (so an upload reaches everyone the
// next time they open the app) and only fall back to the saved copy when offline. The web
// shop's API and card pictures are never touched here.
const CACHE = "magic-kort";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "index.html", "app.js", "qr.js", "magic.json", "manifest.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
