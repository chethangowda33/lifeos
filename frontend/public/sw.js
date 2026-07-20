/* LifeOS service worker — app-shell offline support.
 * Bump CACHE version whenever the caching strategy changes to force a refresh. */
const CACHE = "lifeos-v3";
const SHELL = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/favicon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Background push — fires with the app CLOSED, unlike hooks/useTrainReminder.js
   which only works while a tab is open. iOS delivers these only to a PWA the user
   has actually added to the Home Screen. */
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* keep defaults */ }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Time to train 🏋️", {
      body: payload.body || "Your next session is ready.",
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
      tag: payload.tag || "lifeos-train-reminder",
      data: { url: payload.url || "/workout" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/workout";
  // Focus an existing tab if one is already open rather than stacking new ones.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      const open = tabs.find((t) => t.url.includes(target));
      if (open) return open.focus();
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache API calls — they need auth + fresh data. Let them hit the network.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api")) return;

  // App navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Same-origin static assets (JS/CSS/img/fonts): stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
