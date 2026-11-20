# @thomasfosterau/effect-platform-browser

[Effect](https://effect.website) services for browser main-thread APIs that `@effect/platform-browser` does not cover. Today: the page's side of a service worker (registering, updates, the controller as a schema-typed endpoint) and Web Push subscriptions. It builds on [`@thomasfosterau/effect-platform-worker-shared`](../effect-platform-worker-shared); the worker's side is [`@thomasfosterau/effect-platform-service-worker`](../effect-platform-service-worker).

> [!CAUTION]
> Experimental and pre-1.0. APIs may change between minor versions; pin what you use.

## Install

```sh
pnpm add @thomasfosterau/effect-platform-browser effect
```

`effect` (`^4.0.0`) is a peer dependency: keep a single copy in your app. `@thomasfosterau/effect-platform-worker-shared` comes with it.

## Example

Register a worker, offer an update when one is waiting, and subscribe to push:

```ts
import { Effect } from "effect";
import { PushManager, ServiceWorkerContainer } from "@thomasfosterau/effect-platform-browser";

// Your server's VAPID public key, base64url.
const VAPID_KEY = "BEl6...";

const program = Effect.gen(function* () {
  const registration = yield* ServiceWorkerContainer.register("/sw.js", { type: "module" });

  // Resolves once a new version has installed; the worker's message
  // listener calls `self.skipWaiting()`.
  yield* Effect.forkDetach(
    Effect.gen(function* () {
      const next = yield* ServiceWorkerContainer.waitingWorker(registration);
      if (confirm("A new version is ready. Reload?")) next.postMessage({ type: "SKIP_WAITING" });
    }),
  );

  const active = yield* ServiceWorkerContainer.ready;
  const subscription = yield* PushManager.subscribe(active, { applicationServerKey: VAPID_KEY });
  return yield* PushManager.toJson(subscription); // POST this to your server
});
```

## Modules

| Module | What it is |
| --- | --- |
| `ServiceWorkerContainer` | `navigator.serviceWorker` as typed effects: `register`, `ready`, `getRegistration`, `update`, `unregister`; the `controller` and `controllerChanges`; `waitingWorker` ("a new version is ready"); and `controllerEndpoint`, the controller as a `WorkerMessaging` endpoint. Every failure is a `ContainerError`. |
| `PushManager` | `registration.pushManager`: `subscribe`, `getSubscription`, `unsubscribe`, `permissionState`, and `toJson` checked against the `SubscriptionJson` schema a server can decode with too. Every failure is a `PushError`. |

`ServiceWorkerContainer.Container` is a context reference defaulting to `navigator.serviceWorker`, read on first use, so a page provides nothing and a test provides a stub.

More services are planned in [#152](https://github.com/thomasfosterau/effect-ext/issues/152).
