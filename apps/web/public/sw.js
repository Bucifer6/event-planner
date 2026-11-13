/* EventDesk service worker — offline shell only (R0-08; the briefing download is B-11).
 *
 * Privacy rules this file must keep:
 *  - NEVER cache signed-in HTML: navigations always go to the network; only when the
 *    network is unreachable is the pre-cached, public /offline page shown.
 *  - NEVER touch /api/*, /mcp, server actions (POST) or anything cross-origin.
 *  - The only things cached are /offline, the icons and Next's immutable, content-hashed
 *    build files (/_next/static/*), which contain no user data.
 */
const VERSION = "ed-shell-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
      // The offline page needs its stylesheet and scripts while offline: cache the build
      // files it references.
      const page = await cache.match(OFFLINE_URL);
      if (page) {
        const html = await page.text();
        const assets = new Set();
        for (const m of html.matchAll(/["'(](\/_next\/static\/[^"'()\s\\]+)/g)) assets.add(m[1]);
        await Promise.all(
          [...assets].map((url) => cache.add(url).catch(() => undefined)),
        );
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== VERSION) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp")) return;

  // Immutable build files: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  // Page navigations: network only; the offline page when there is no network.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(VERSION);
          return (
            (await cache.match(OFFLINE_URL)) ||
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
          );
        }
      })(),
    );
  }
  // Everything else (RSC payloads, images): default browser behaviour, never cached here.
});
