/**
 * Trip timeline service worker.
 * Offline is a hard requirement: the app is used at ticket gates with no signal.
 * Precache everything on install, serve cache-first.
 */
const VERSION = 'tripline-v1';

// The app itself. The trip's own files come from trip.json (tripAssets below), so a new
// trip never means editing this list.
const ASSETS = [
  // The shell is './', never 'index.html'. Hosting's cleanUrls answers /index.html with a
  // 301 to /, and Chrome refuses a redirected response for a navigation — cached under
  // that name, the first launch with no signal after an update would not open at all.
  './', 'styles.css', 'app.js', 'data/trip.json', 'data/forecast.json', 'manifest.webmanifest',
  'assets/favicon.svg',
  'assets/icons/maps.svg', 'assets/icons/train.svg', 'assets/icons/flight.svg',
  'assets/icons/pdf.svg', 'assets/icons/ticket.svg', 'assets/icons/cam.svg',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-512-maskable.png', 'assets/apple-touch-icon.png',
];

/** Every image, QR code and file an event names. check.mjs reads trip.json the same way. */
async function tripAssets() {
  const trip = await fetch('data/trip.json', { cache: 'reload' }).then((r) => r.json());
  const paths = trip.days.flatMap((d) => d.events).flatMap((e) => [
    e.image?.src, ...(e.qr ?? []).map((q) => q.src), ...(e.files ?? []).map((f) => f.src),
  ]);
  return [...new Set(paths.filter(Boolean))];
}

self.addEventListener('install', (e) => {
  // No skipWaiting() here on purpose. A new worker must not take over while the open
  // page is still running the previous app.js — that mismatch is what produced
  // "the page renders but nothing works". It waits until the page asks.
  e.waitUntil((async () => {
    const all = [...ASSETS, ...await tripAssets()];
    const cache = await caches.open(VERSION);
    // `cache: 'reload'` bypasses the HTTP cache, so a stale copy can never be
    // baked into a fresh precache on install.
    await cache.addAll(all.map((u) => new Request(u, { cache: 'reload' })));
  })());
});

// The page posts this once the user accepts the update.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // never touch maps or anything external

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);

    // Navigations: network-first so a redeploy is picked up, the cached shell as the
    // safety net — but never a long wait for it. One bar of signal can hold a request
    // open for a minute, so after three seconds the shell already on the phone opens,
    // and a page that turns up later still replaces it for next time.
    if (request.mode === 'navigate') {
      const network = fetch(request).then((fresh) => {
        // An error page must never replace a shell that works.
        if (fresh.ok) e.waitUntil(cache.put('./', fresh.clone()));
        return fresh;
      });
      e.waitUntil(network.catch(() => {}));
      const shell = await cache.match('./');
      if (!shell) return network.catch(() => Response.error());
      const slow = new Promise((resolve) => setTimeout(resolve, 3000, shell));
      return Promise.race([network.then((r) => (r.ok ? r : shell), () => shell), slow]);
    }

    // Everything else: cache-first, refresh in the background.
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) {
      e.waitUntil(fetch(request).then((r) => r.ok && cache.put(request, r.clone())).catch(() => {}));
      return hit;
    }
    try {
      const res = await fetch(request);
      if (res.ok) cache.put(request, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
