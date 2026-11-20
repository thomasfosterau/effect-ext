# @thomasfosterau/effect-platform-service-worker

[Effect](https://effect.website) utilities for code running inside a service worker: its clients (find, focus, open, claim, message). Everything here runs in the worker; the page's side (`navigator.serviceWorker`: registering, updates, the controller) belongs with the browser main-thread APIs. It builds on [`@thomasfosterau/effect-platform-worker-shared`](../effect-platform-worker-shared).

> [!CAUTION]
> Experimental and pre-1.0. APIs may change between minor versions; pin what you use.

## Install

```sh
pnpm add @thomasfosterau/effect-platform-service-worker effect
```

`effect` (`^4.0.0`) is a peer dependency: keep a single copy in your app. `@thomasfosterau/effect-platform-worker-shared` comes with it.

## Example

Focus or open the inbox when a notification is clicked:

```ts
import { Effect } from "effect";
import { Clients } from "@thomasfosterau/effect-platform-service-worker";

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(Effect.runPromise(Clients.focusOrOpen("/inbox", self.location.href)));
});
```

## Modules

| Module | What it is |
| --- | --- |
| `Clients` | `self.clients` as a stubbable reference: `get`, `matchAll`, `windows`, `claim`, `openWindow`, `focus`, `navigate`, `focusOrOpen`, and schema-typed `postTo` / `broadcast`. |
