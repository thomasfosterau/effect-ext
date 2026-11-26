# @thomasfosterau/effect-platform-service-worker

[Effect](https://effect.website) utilities for code running inside a service worker: Cache Storage and the standard caching strategies, a route table for `fetch`, navigation preload, listeners for `install` / `activate` / `message` / `push` / `sync` / `periodicsync`, persistent notifications, the worker's clients, and an `effect/workers` runner so pages can call the worker over RPC. Everything here runs in the worker; the page's side (`navigator.serviceWorker`: registering, updates, the controller) belongs with the browser main-thread APIs. It builds on [`@thomasfosterau/effect-platform-worker-shared`](../effect-platform-worker-shared).

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
| `Fetch` | `fetchRequest` through `FetchHttpClient.Fetch`; `withNavigationPreload`; the five strategies (`cacheFirst`, `networkFirst` with an optional timeout, `staleWhileRevalidate`, `cacheOnly`, `networkOnly`); `precache`, which writes only once every URL is a `200`; and `route` / `fetchListener`, whose synchronous `match` decides whether to call `respondWith`. |
| `Events` | `extendableListener` (`install`, `activate`: the effect's promise goes to `waitUntil`), `messageListener` and `pushListener` (decode the payload, drop and log what does not decode), `syncListener` / `periodicSyncListener` (a handler per tag), and `EventLifetime`, where background work such as a cache write goes. |
| `CookieSubscriptions` | `subscribe`, `unsubscribe` and `subscriptions` over `self.registration.cookies`, and `cookieChangeListener`, which hands each `cookiechange` to a handler as a `CookieStore.CookieChange`; `memoryCookieSubscriptions` for tests. |
| `NavigationPreload` | `enable`, `disable`, `setHeaderValue` and `state` over `self.registration.navigationPreload`; `Fetch.withNavigationPreload` answers a navigation with the preload. |
| `ServiceWorkerRunner` | A `WorkerRunnerPlatform` (`make`, `layer`) whose clients are pages, each on its own `MessagePort`, for `RpcServer.layerProtocolWorkerRunner`. |
| `Notifications` | `showNotification` / `getNotifications` through `self.registration`, failing with `ShowNotificationError`; `notificationClickListener` / `notificationCloseListener` decode `notification.data` first. |
| `Clients` | `self.clients`: `get`, `matchAll`, `windows`, `claim`, `openWindow`, `focus`, `navigate`, `focusOrOpen`, and schema-typed `postTo` / `broadcast`. |

## RPC from a page

The worker serves an `effect/workers` protocol over `ServiceWorkerRunner.layer`, as a dedicated worker would over `BrowserWorkerRunner.layer`. A page connects with a port of its own, then uses `@effect/platform-browser`'s `BrowserWorker` unchanged:

```ts
import { BrowserWorker } from "@effect/platform-browser";

const { port1, port2 } = new MessageChannel();
const registration = await navigator.serviceWorker.ready;
registration.active?.postMessage(
  "@thomasfosterau/effect-platform-service-worker/ServiceWorkerRunner/connect",
  [port2],
);
const WorkerLayer = BrowserWorker.layer(() => port1);
```

A port message is no event to the worker, so the runner holds the `message` event that connected the page open until the page disconnects. Browsers cap how long one event may run (about five minutes in Chrome); after that the worker may stop, so a long-lived page should reconnect.

Each platform object (`caches`, `fetch`, `self.registration`, `self.clients`) is a context reference with the worker's own as its default, read on first use, so a worker provides nothing and a test provides a stub.

These modules were effect-ext's `ServiceWorker` subpath, split by event: replace `@thomasfosterau/effect-ext/ServiceWorker` with the module each name now lives in. `FetchFailed` is now `Fetch.FetchFailed` (same tag and fields as effect-ext `Net`'s), and the `Registration` default is `none` outside a `ServiceWorkerGlobalScope`.
