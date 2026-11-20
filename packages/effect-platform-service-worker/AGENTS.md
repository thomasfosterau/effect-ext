# @thomasfosterau/effect-platform-service-worker

Service workers, from the inside: only APIs a `ServiceWorkerGlobalScope` exposes (`Clients`). Nothing here runs on a page's main thread: `navigator.serviceWorker` (registration, updates, the controller) belongs with the browser main-thread APIs, not this package. A test may fake the worker's globals.

## Boundary

Peer: `effect`. Dependency: `@thomasfosterau/effect-platform-worker-shared` (`.fallowrc.json` zone `service-worker`, allowed into `worker-shared` only).

## Invariants

- The shared package's invariants hold here: no global read at import or in a constructor, structural `*Like` types under the `dom` lib, each platform object a `Context.Reference` of an `Option` that is `none` where the API is missing, so every call fails `Unsupported` rather than throwing.
- **Rejections map onto reasons by `DOMException` name** (`internal/dom.ts` `reasonOf`), read structurally; anything unmapped is `Failed` with the `cause` kept.
- **The `*Like` interfaces keep the platform's `T | null` / `T | undefined`** where the DOM spells it so (`openWindow`, `navigate`, `Clients.get`), so the real objects stay assignable; every reading past the adapter is an `Option`.
- **Messages go through `WorkerMessaging`**: `postTo` and `broadcast` are its `sender`, never a second encoder.
