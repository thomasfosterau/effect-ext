# @thomasfosterau/effect-platform-service-worker

[Effect](https://effect.website) utilities for code running inside a service worker: Cache Storage and the standard caching strategies, a route table for `fetch`, `install` / `activate` / `message` listeners, persistent notifications, and the worker's clients. Everything here runs in the worker; the page's side (`navigator.serviceWorker`: registering, updates, the controller) belongs with the browser main-thread APIs. It builds on [`@thomasfosterau/effect-platform-worker-shared`](../effect-platform-worker-shared).

> [!CAUTION]
> Experimental and pre-1.0. APIs may change between minor versions; pin what you use.

## Install

```sh
pnpm add @thomasfosterau/effect-platform-service-worker effect
```

`effect` (`^4.0.0`) is a peer dependency: keep a single copy in your app. `@thomasfosterau/effect-platform-worker-shared` comes with it.

## Example

An offline-first worker. Listeners must be added while the script first evaluates, so the effect that builds them runs synchronously:

```ts
/// <reference lib="webworker" />
import { Effect, Schema } from "effect";
import {
  Caches,
  Clients,
  Events,
  Fetch,
  Notifications,
} from "@thomasfosterau/effect-platform-service-worker";

declare const self: ServiceWorkerGlobalScope;
const SHELL = "shell-v3";

const listeners = Effect.gen(function* () {
  const onInstall = yield* Events.extendableListener(() =>
    Fetch.precache(SHELL, ["/", "/offline", "/app.css"]),
  );
  const onActivate = yield* Events.extendableListener(() =>
    Caches.deleteCachesExcept([SHELL, "pages", "assets"]),
  );
  const onFetch = yield* Fetch.fetchListener([
    Fetch.route(
      Fetch.isNavigationRequest,
      Fetch.networkFirst({ cacheName: "pages", timeout: "3 seconds" }),
    ),
    Fetch.route(
      (request) => new URL(request.url).pathname.startsWith("/_app/immutable/"),
      Fetch.cacheFirst({ cacheName: "assets" }),
    ),
  ]);
  const onMessage = yield* Events.messageListener(
    Schema.Struct({ type: Schema.Literal("SKIP_WAITING") }),
    () => Effect.promise(() => self.skipWaiting()),
  );
  const onClick = yield* Notifications.notificationClickListener(
    Schema.Struct({ url: Schema.String }),
    ({ url }, event) => {
      event.notification.close();
      return Clients.focusOrOpen(url, self.location.href);
    },
  );
  return { onInstall, onActivate, onFetch, onMessage, onClick };
});

const { onInstall, onActivate, onFetch, onMessage, onClick } = Effect.runSync(listeners);
self.addEventListener("install", onInstall);
self.addEventListener("activate", onActivate);
self.addEventListener("fetch", onFetch);
self.addEventListener("message", onMessage);
self.addEventListener("notificationclick", onClick);
```

## Modules

| Module | What it is |
| --- | --- |
| `Caches` | The Cache Storage API as typed effects (`openCache`, `deleteCache`, `cacheNames`, `deleteCachesExcept` for the `activate` sweep), every rejection a `CacheError`; `memoryCacheStorage` for tests. |
| `Fetch` | `fetchRequest` through `FetchHttpClient.Fetch`; the five strategies (`cacheFirst`, `networkFirst` with an optional timeout, `staleWhileRevalidate`, `cacheOnly`, `networkOnly`); `precache`, which writes only once every URL is a `200`; and `route` / `fetchListener`, whose synchronous `match` decides whether to call `respondWith`. |
| `Events` | `extendableListener` (`install`, `activate`: the effect's promise goes to `waitUntil`), `messageListener` (decodes `event.data`, drops and logs what does not decode), and `EventLifetime`, where background work such as a cache write goes. |
| `Notifications` | `showNotification` / `getNotifications` through `self.registration`, failing with `ShowNotificationError`; `notificationClickListener` / `notificationCloseListener` decode `notification.data` first. |
| `Clients` | `self.clients`: `get`, `matchAll`, `windows`, `claim`, `openWindow`, `focus`, `navigate`, `focusOrOpen`, and schema-typed `postTo` / `broadcast`. |

Each platform object (`caches`, `fetch`, `self.registration`, `self.clients`) is a context reference with the worker's own as its default, read on first use, so a worker provides nothing and a test provides a stub.

These modules were effect-ext's `ServiceWorker` subpath, split by event: replace `@thomasfosterau/effect-ext/ServiceWorker` with the module each name now lives in. `FetchFailed` is now `Fetch.FetchFailed` (same tag and fields as effect-ext `Net`'s), and the `Registration` default is `none` outside a `ServiceWorkerGlobalScope`.
