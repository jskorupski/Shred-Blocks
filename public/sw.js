/* ==========================================================================
   ShredBlocks: Color Jam — Offline-First Service Worker (STOR-03)
   ========================================================================== */

const CACHE_VERSION = 'shredblocks-v1.1.0';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/version.json',
  '/icon.svg',
  '/icon-maskable.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(APP_SHELL_URLS);

      // Pre-cache hashed /assets/* JS/CSS bundles referenced by /index.html on first install
      const indexRes = await cache.match('/index.html');
      if (indexRes) {
        try {
          const html = await indexRes.clone().text();
          const assetMatches = html.match(/\/assets\/[^"'\s>]+/g) || [];
          const uniqueAssets = [...new Set(assetMatches)];
          if (uniqueAssets.length > 0) {
            await cache.addAll(uniqueAssets);
          }
        } catch {
          // Ignore in dev mode where /assets/* bundles are served unbundled
        }
      }

      // STOR-03 Safe Update Lifecycle:
      // Only skipWaiting automatically on the very first install when no active SW controls the page.
      // When upgrading an existing installation, wait for explicit 'SKIP_WAITING' message from the UI
      // so we never interrupt or reload the player mid-drag!
      if (!self.registration.active) {
        await self.skipWaiting();
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE && key !== RUNTIME_CACHE) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1. Navigation requests (HTML documents): Stale-While-Revalidate with guaranteed offline shell fallback
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      (async () => {
        const shellCache = await caches.open(SHELL_CACHE);
        const cachedIndex =
          (await shellCache.match('/index.html')) || (await shellCache.match('/'));

        const networkFetch = fetch(request)
          .then(async (response) => {
            if (response && response.ok) {
              await shellCache.put('/index.html', response.clone());
            }
            return response;
          })
          .catch(() => null);

        if (cachedIndex) {
          event.waitUntil(networkFetch);
          return cachedIndex;
        }

        const networkResponse = await networkFetch;
        if (networkResponse) return networkResponse;

        return (
          (await caches.match('/index.html')) ||
          new Response('Offline - ShredBlocks App Shell', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          })
        );
      })()
    );
    return;
  }

  // 2. Hashed /assets/* bundles and static shell resources: Cache-First with dynamic runtime caching
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) {
        return cached;
      }

      try {
        const response = await fetch(request);
        if (response && response.ok && response.type === 'basic') {
          const targetCacheName = APP_SHELL_URLS.includes(url.pathname)
            ? SHELL_CACHE
            : RUNTIME_CACHE;
          const cache = await caches.open(targetCacheName);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        const fallback = await caches.match(url.pathname);
        if (fallback) return fallback;
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })()
  );
});
