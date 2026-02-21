// ============================================================
// OPENCLAW AI — SERVICE WORKER v2.0
// Save Point: Section 8A
// ============================================================

const CACHE_NAME = "openclaw-v2";
const RUNTIME_CACHE = "openclaw-runtime-v2";

// Assets to precache on install
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/static/js/main.chunk.js",
  "/static/js/bundle.js",
  "/manifest.json",
  "https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Syne:wght@400;600;700;800&display=swap",
];

// ---- INSTALL ----
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Precaching app shell");
      // Cache what we can, ignore failures for CDN assets
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(e => console.warn("[SW] Could not cache:", url, e))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ---- ACTIVATE ----
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map(name => {
            console.log("[SW] Deleting old cache:", name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ---- FETCH STRATEGY ----
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept API calls to Anthropic
  if (url.hostname === "api.anthropic.com") return;

  // Never intercept chrome-extension or non-http
  if (!request.url.startsWith("http")) return;

  // Fonts — cache first, long TTL
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // HTML — network first, fallback to cache
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(request, CACHE_NAME));
    return;
  }

  // JS/CSS — stale while revalidate
  if (url.pathname.match(/\.(js|css)$/)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Everything else — network first
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ---- CACHE STRATEGIES ----

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Offline fallback for HTML
    const offlineFallback = await caches.match("/");
    return offlineFallback || new Response(offlinePage(), {
      headers: { "Content-Type": "text/html" }
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await networkPromise || new Response("", { status: 503 });
}

// ---- OFFLINE FALLBACK PAGE ----
function offlinePage() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenClaw AI — Offline</title>
  <style>
    body { background: #080C10; color: #E6EDF3; font-family: sans-serif;
           display: flex; align-items: center; justify-content: center;
           height: 100vh; margin: 0; text-align: center; }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { color: #7D8590; font-size: 14px; }
  </style>
</head>
<body>
  <div>
    <div class="icon">🦾</div>
    <h1>You're offline</h1>
    <p>OpenClaw needs a connection to reach the AI.<br>Check your network and try again.</p>
  </div>
</body>
</html>`;
}

// ---- BACKGROUND SYNC (queue failed messages) ----
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-messages") {
    event.waitUntil(syncPendingMessages());
  }
});

async function syncPendingMessages() {
  // Notify all clients that sync is available
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: "SYNC_READY" }));
}

// ---- PUSH NOTIFICATIONS (scaffold) ----
self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || "OpenClaw AI", {
      body: data.body || "You have a new message",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag: "openclaw-notification",
      renotify: true,
      data: { url: data.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || "/")
  );
});

// ---- MESSAGE HANDLER ----
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CACHE_URLS") {
    caches.open(RUNTIME_CACHE).then(cache => cache.addAll(event.data.urls));
  }
});

console.log("[SW] OpenClaw Service Worker v2.0 loaded");
