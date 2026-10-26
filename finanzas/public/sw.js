// Service worker de Finanzas en Pareja: caché del shell y de las pantallas para abrir la app sin conexión.
// Los datos sin conexión salen de la copia del celular (IndexedDB) y los movimientos nuevos van a una cola.
const VERSION = "finanzas-v1";
const SHELL = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase y fuentes externas: directo a la red
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Archivos estáticos con hash: primero caché
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Páginas: primero la red (los datos siempre vienen de Supabase); sin red, la última copia
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match(url.pathname)).then((hit) => hit || caches.match("/offline.html")),
        ),
    );
  }
});

// La app pide guardar sus pantallas principales para poder abrirlas sin conexión (con la sesión de la persona).
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type !== "warm" || !Array.isArray(msg.urls)) return;
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(
        msg.urls
          .filter((u) => typeof u === "string" && u.startsWith("/") && !u.startsWith("//"))
          .map((u) =>
            fetch(u, { credentials: "same-origin" })
              .then((res) => (res.ok && !res.redirected ? cache.put(u, res) : undefined))
              .catch(() => {}),
          ),
      ),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Finanzas en Pareja";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      
      tag: data.tag,
      lang: "es-CO",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          w.navigate(destino).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});

// Notificaciones Web Push: la tarea diaria envía { title, body, url, tag }.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Finanzas en Pareja", body: event.data ? event.data.text() : "" };
  }
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
  event.waitUntil(
    self.registration.showNotification(data.title || "Finanzas en Pareja", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || undefined,
      data: { url },
    }),
  );
});

// Al tocar la notificación: abre la app en la pantalla del aviso (o la enfoca si ya estaba abierta).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          return w.focus().then((c) => (c && "navigate" in c ? c.navigate(url) : c));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
