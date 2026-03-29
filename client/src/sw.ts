/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, NavigationRoute, Route } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST);

const navigationRoute = new NavigationRoute(
  new NetworkFirst({
    cacheName: "navigation-cache",
    networkTimeoutSeconds: 3,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  {
    denylist: [/^\/api\//, /^\/uploads\//],
  }
);

navigationRoute.setCatchHandler(async () => {
  const cache = await caches.open("offline-fallback");
  const cached = await cache.match("/offline.html");
  if (cached) return cached;
  return Response.error();
});

registerRoute(navigationRoute);

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open("offline-fallback").then((cache) => cache.add("/offline.html"))
  );
});

registerRoute(
  new Route(
    ({ url }) => url.origin === "https://fonts.googleapis.com",
    new CacheFirst({
      cacheName: "google-fonts-cache",
      plugins: [
        new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
        new CacheableResponsePlugin({ statuses: [0, 200] }),
      ],
    })
  )
);

registerRoute(
  new Route(
    ({ url }) => url.origin === "https://fonts.gstatic.com",
    new CacheFirst({
      cacheName: "gstatic-fonts-cache",
      plugins: [
        new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
        new CacheableResponsePlugin({ statuses: [0, 200] }),
      ],
    })
  )
);

registerRoute(
  new Route(
    ({ url }) => url.pathname.startsWith("/api/"),
    new NetworkFirst({
      cacheName: "api-cache",
      networkTimeoutSeconds: 10,
      plugins: [
        new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 5 }),
        new CacheableResponsePlugin({ statuses: [0, 200] }),
      ],
    })
  )
);

registerRoute(
  new Route(
    ({ request }) =>
      request.destination === "script" ||
      request.destination === "style" ||
      request.destination === "image" ||
      request.destination === "font",
    new CacheFirst({
      cacheName: "static-assets-cache",
      plugins: [
        new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }),
        new CacheableResponsePlugin({ statuses: [0, 200] }),
      ],
    })
  )
);
