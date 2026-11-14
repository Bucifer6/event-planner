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
        if (key !== VERSION && key !== "ed-operate-v1") await caches.delete(key); // "ed-operate-v1": RELEASE E block below
      }
      await self.clients.claim();
    })(),
  );
});

/* ── RELEASE E (E-03): limited offline capture — the ONLY exception to "never cache signed-in
 * HTML". Two screens must open without network once they were loaded during an event:
 *   /occasions/<id>/operate/checkin     (arrivals)
 *   /occasions/<id>/operate/checklist   (the person's own checklist ticks)
 * Their HTML is the app shell only: the roster and the checklist are NOT in it — the page
 * keeps them in IndexedDB ("ed-offline") with an expiry, and the queue is sent by the page.
 * Rules kept here:
 *   - network first; the cached copy is served only when the network is unreachable;
 *   - nothing else under /occasions (or anywhere signed-in) is ever cached;
 *   - a copy older than 48 hours is deleted instead of served;
 *   - arriving on /sign-in (signed out, or the session ended) deletes this cache and the
 *     stored rosters/checklists; captured-but-unsent queue items (ids and counts only) stay
 *     so that an arrival is never lost.
 */
const OPERATE_CACHE = "ed-operate-v1";
const OPERATE_RE = /^\/occasions\/[a-z0-9]+\/operate\/(checkin|checklist)\/?$/;
const OPERATE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function clearOperateData() {
  return Promise.all([
    caches.delete(OPERATE_CACHE),
    new Promise((resolve) => {
      try {
        const open = indexedDB.open("ed-offline");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("bundles")) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction("bundles", "readwrite");
          tx.objectStore("bundles").clear();
          tx.oncomplete = tx.onerror = tx.onabort = () => {
            db.close();
            resolve();
          };
        };
        open.onerror = () => resolve();
      } catch {
        resolve();
      }
    }),
  ]);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/sign-in")) {
    event.waitUntil(clearOperateData());
    return; // the handler below answers
  }
  if (!OPERATE_RE.test(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(OPERATE_CACHE);
      const key = url.origin + url.pathname; // no query string: one copy per screen
      try {
        const response = await fetch(request);
        if (response.redirected && new URL(response.url).pathname.startsWith("/sign-in")) {
          await clearOperateData();
        } else if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
          const copy = response.clone();
          const headers = new Headers(copy.headers);
          headers.set("x-ed-cached-at", String(Date.now()));
          await cache.put(key, new Response(await copy.blob(), { status: copy.status, statusText: copy.statusText, headers }));
        }
        return response;
      } catch {
        const hit = await cache.match(key);
        if (hit) {
          const at = Number(hit.headers.get("x-ed-cached-at") || 0);
          if (Date.now() - at < OPERATE_MAX_AGE_MS) return hit;
          await cache.delete(key);
        }
        const shell = await caches.open(VERSION);
        return (await shell.match(OFFLINE_URL)) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })(),
  );
});
/* ── end of RELEASE E block ─────────────────────────────────────────────── */

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp")) return;
  if (request.mode === "navigate" && OPERATE_RE.test(url.pathname)) return; // answered by the RELEASE E block above

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
