const CACHE_NAME = 'flux-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './apple-touch-icon.png',
  './brand/flux-lockup.png',
  './brand/flux-mark.png',
  './avatars/avatar-bun-mask.png',
  './avatars/avatar-short-hair-mask.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    // Vite gives JS and CSS content hashes at build time. Discover them from
    // the built index so the complete UI works after the very first visit.
    const index = await cache.match('./index.html');
    const html = index ? await index.clone().text() : '';
    const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => new URL(match[1], self.registration.scope))
      .filter((url) => url.origin === self.location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname))
      .map((url) => url.href);
    const uniqueAssets = [...new Set(assetUrls)];
    if (uniqueAssets.length) await cache.addAll(uniqueAssets);

    // Supabase and the scanner are lazy chunks. They are referenced from the
    // entry script rather than index.html, so follow dynamic imports too.
    const scriptsToInspect = uniqueAssets.filter((url) => url.endsWith('.js'));
    const discoveredScripts = new Set(scriptsToInspect);
    while (scriptsToInspect.length) {
      const scriptUrl = scriptsToInspect.shift();
      const response = await cache.match(scriptUrl);
      if (!response) continue;
      const source = await response.clone().text();
      const imports = [...source.matchAll(/import\(["'`]([^"'`]+\.js)["'`]\)/g)]
        .map((match) => new URL(match[1], scriptUrl).href)
        .filter((url) => url.startsWith(self.registration.scope));
      for (const importUrl of imports) {
        if (discoveredScripts.has(importUrl)) continue;
        discoveredScripts.add(importUrl);
        await cache.add(importUrl);
        scriptsToInspect.push(importUrl);
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(request, 3500)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
