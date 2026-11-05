
const CACHE = "duochat-v6";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(["/", "/style.css", "/manifest.webmanifest"])
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (
    event.request.method === "GET" &&
    new URL(event.request.url).origin === location.origin
  ) {
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(event.request);

        if (cached) return cached;

        const response = await fetch(event.request);

        if (response.ok) {
          cache.put(event.request, response.clone());
        }

        return response;
      })
    );
  }
});
