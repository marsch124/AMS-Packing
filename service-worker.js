// service-worker.js — offline app shell caching.
// Bump CACHE when you change any of the cached files to force an update.
const CACHE = 'ams-packing-list-v77';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/model.js',
  './js/db.js',
  './js/seed.js',
  './js/xlsx.js',
  './js/weather.js',
  './js/worldmap.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // Fetch fresh from the network (bypass the HTTP cache) so a new version never
  // caches stale files.
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for our own assets; network fallback for everything else.
// Cross-origin calls (e.g. the Open-Meteo weather API) are never cached, and a
// failed one rejects normally — only page navigations fall back to the shell.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const sameOrigin = new URL(request.url).origin === location.origin;
  e.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok && sameOrigin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    }).catch((err) => {
      if (request.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }))
  );
});
