const CACHE_NAME = 'hymnvault-static-v1';
const RUNTIME_CACHE = 'hymnvault-runtime-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/style.min.css',
  '/script.js',
  '/script.min.js',
  '/firebase-init.js',
  '/firebase-init.min.js',
  '/manifest.json',
  '/service-worker.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        // Best-effort precache; continue even if some resources fail.
        console.warn('SW: precache failed', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Simple caching strategy:
// - Serve navigation requests from cache (offline fallback to index.html)
// - Serve same-origin static assets from cache first, update in background
// - Cache third-party fonts (fonts.gstatic.com / fonts.googleapis.com) with runtime cache-first
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Handle cross-origin font requests (runtime cache-first)
  if (url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const resp = await fetch(request, { mode: 'cors' });
          if (resp && resp.status === 200) cache.put(request, resp.clone());
          return resp;
        } catch (e) {
          return cached || fetch(request).catch(() => new Response(null, { status: 503 }));
        }
      })
    );
    return;
  }

  // Navigation requests -> serve shell (index.html) from cache as fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedIndex = await cache.match('/index.html');
        try {
          const networkResponse = await fetch(request);
          // Update cache with latest navigation response for next time
          if (networkResponse && networkResponse.status === 200) cache.put('/index.html', networkResponse.clone());
          return networkResponse;
        } catch (err) {
          return cachedIndex || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  // Same-origin static assets -> cache-first, update in background
  if (url.origin === location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          // Update cache in background
          event.waitUntil(
            fetch(request).then((resp) => {
              if (resp && resp.status === 200) cache.put(request, resp.clone());
            }).catch(() => {})
          );
          return cached;
        }
        try {
          const response = await fetch(request);
          if (response && response.status === 200) cache.put(request, response.clone());
          return response;
        } catch (err) {
          return new Response(null, { status: 503 });
        }
      })
    );
    return;
  }

  // Fallback: default network
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
