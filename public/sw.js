/* NES Enerji — service worker.
 * 1) Anlık bildirimleri gösterir, tıklanınca ilgili ekranı açar.
 * 2) Çevrimdışı çalışma (sahada keşif): sayfalar ÖNCE AĞDAN alınır (güncel
 *    sürüm), ağ yoksa son açılan hali gösterilir. Derlenmiş dosyalar
 *    (/assets) kalıcı önbellekten gelir. Supabase ve /api istekleri hiç
 *    önbelleğe alınmaz. */
const PAGE_CACHE = "nes-pages-v1";
const ASSET_CACHE = "nes-assets-v1";

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/oauth")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(PAGE_CACHE);
          return (
            (await cache.match(url.pathname)) ||
            (await cache.match("/kesif")) ||
            (await cache.match("/dashboard")) ||
            new Response(
              "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><body style=\"font-family:sans-serif;padding:24px\"><h2>İnternet yok</h2><p>Bu sayfa daha önce açılmadığı için gösterilemiyor. Keşif ekranını internet varken bir kez açın; sonra internetsiz de çalışır.</p></body>",
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          );
        }),
    );
    return;
  }

  const isAsset =
    url.pathname.startsWith("/assets/") ||
    /.(js|css|woff2?|png|svg|webp|ico|json|webmanifest)$/.test(url.pathname);
  if (!isAsset) return;
  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      // /assets dosya adları sürüme göre değişir: önbellekteki hemen kullanılır.
      return cached || network;
    }),
  );
});
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "NES Enerji", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "NES Enerji";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/app-icon-192.png",
      badge: "/app-icon-192.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || "/dashboard",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if (
            client.url.startsWith(self.location.origin) &&
            "focus" in client
          ) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
