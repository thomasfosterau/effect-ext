# @thomasfosterau/effect-platform-service-worker

[Effect](https://effect.website) utilities for service workers, on both sides: in the worker, its clients (find, focus, open, claim, message); on the page, registering it, following its updates and control, and talking to the controller through a schema-typed endpoint. It builds on [`@thomasfosterau/effect-platform-worker-shared`](../effect-platform-worker-shared).

> [!CAUTION]
> Experimental and pre-1.0. APIs may change between minor versions; pin what you use.

## Install

```sh
pnpm add @thomasfosterau/effect-platform-service-worker effect
```

`effect` (`^4.0.0`) is a peer dependency: keep a single copy in your app. `@thomasfosterau/effect-platform-worker-shared` comes with it.

## Example

On the page, prompt when a new version is waiting and hand over to it:

```ts
import { Effect, Schema } from "effect";
import { ServiceWorkerContainer } from "@thomasfosterau/effect-platform-service-worker";

const SkipWaiting = Schema.Struct({ type: Schema.Literal("SKIP_WAITING") });

const program = Effect.gen(function* () {
  const registration = yield* ServiceWorkerContainer.register("/sw.js", { type: "module" });
  const next = yield* ServiceWorkerContainer.waitingWorker(registration);
  if (confirm("A new version is ready. Reload?")) {
    next.postMessage({ type: "SKIP_WAITING" } satisfies typeof SkipWaiting.Type, []);
  }
});
```

## Modules

| Module | What it is |
| --- | --- |
| `Clients` | `self.clients` as a stubbable reference: `get`, `matchAll`, `windows`, `claim`, `openWindow`, `focus`, `navigate`, `focusOrOpen`, and schema-typed `postTo` / `broadcast`. |
| `ServiceWorkerContainer` | `navigator.serviceWorker` as a stubbable reference: `register`, `ready`, `getRegistration`, `update`, `unregister`, the controller and its changes, `waitingWorker`, and `controllerEndpoint`. |
