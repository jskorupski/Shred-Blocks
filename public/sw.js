/* ==========================================================================
   ShredBlocks: Color Jam — Offline-First Service Worker (STOR-03)
   ========================================================================== */

const CACHE_VERSION = 'shredblocks-v1.2.2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/version.json',
  '/icon.svg',
  '/icon-maskable.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/fonts/fraunces-latin-var.woff2',
  '/fonts/plus-jakarta-sans-latin-var.woff2',
];

/**
 * Strips the `redirected: true` flag from any fetched Response before caching or
 * returning it for a `mode: 'navigate'` request. Per the WHATWG Fetch spec, top-level
 * browser navigations use `redirect: 'manual'`, so returning a cached Response with
 * `response.redirected === true` causes Chromium/Android WebAPK to briefly flash
 * `ERR_FAILED` ("Can't reach this page") before retrying.
 */
async function stripRedirectFlag(response) {
  if (!response?.redirected) {
    return response;
  }
  const body = await response.clone().arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);

      await Promise.all(
        APP_SHELL_URLS.map(async (url) => {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res?.ok) {
            const cleanRes = await stripRedirectFlag(res);
            await cache.put(url, cleanRes);
          }
        })
      );

      // Pre-cache hashed /assets/* JS/CSS bundles referenced by the root HTML shell on first install
      const indexRes = await cache.match('/');
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
  if (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return;
  }

  // 1. Navigation requests (HTML documents): Offline-First Atomic Shell with network fallback
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      (async () => {
        const shellCache = await caches.open(SHELL_CACHE);
        const cachedRoot = await shellCache.match('/');
        if (cachedRoot) {
          return stripRedirectFlag(cachedRoot);
        }

        const networkResponse = await fetch(request)
          .then(async (response) => {
            if (response?.ok) {
              const cleanResponse = await stripRedirectFlag(response);
              await shellCache.put('/', cleanResponse.clone());
              return cleanResponse;
            }
            return response;
          })
          .catch(() => null);

        if (networkResponse) return stripRedirectFlag(networkResponse);

        const anyCachedShell = (await caches.match('/')) || (await caches.match('/index.html'));
        if (anyCachedShell) {
          return stripRedirectFlag(anyCachedShell);
        }

        return new Response('Offline - ShredBlocks App Shell', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      })()
    );
    return;
  }

  // 2. Hashed /assets/* bundles and static shell resources: Cache-First with dynamic runtime caching
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) {
        return stripRedirectFlag(cached);
      }

      try {
        const response = await fetch(request);
        if (response?.ok && response.type === 'basic') {
          const cleanResponse = await stripRedirectFlag(response);
          const targetCacheName = APP_SHELL_URLS.includes(url.pathname) ? SHELL_CACHE : RUNTIME_CACHE;
          const cache = await caches.open(targetCacheName);
          await cache.put(request, cleanResponse.clone());
          return cleanResponse;
        }
        return response;
      } catch {
        const fallback = await caches.match(url.pathname);
        if (fallback) return stripRedirectFlag(fallback);
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })()
  );
});
