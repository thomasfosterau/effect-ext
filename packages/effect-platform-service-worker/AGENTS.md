# @thomasfosterau/effect-platform-service-worker

Service workers: the worker's own APIs (`Clients`) and the page's (`ServiceWorkerContainer`).

## Boundary

Peer: `effect`. Dependency: `@thomasfosterau/effect-platform-worker-shared` (`.fallowrc.json` zone `service-worker`, allowed into `worker-shared` only).

## Invariants

- The shared package's invariants hold here: no global read at import or in a constructor, structural `*Like` types under the `dom` lib, each platform object a `Context.Reference` of an `Option` that is `none` where the API is missing, so every call fails `Unsupported` rather than throwing.
- **Rejections map onto reasons by `DOMException` name** (`internal/dom.ts` `reasonOf`), read structurally; anything unmapped is `Failed` with the `cause` kept.
- **The `*Like` interfaces keep the platform's `T | null` / `T | undefined`** where the DOM spells it so (a registration's workers, `openWindow`, `navigate`, `getRegistration`), so the real objects stay assignable; every reading past the adapter is an `Option`.
- **Messages go through `WorkerMessaging`**: `postTo`, `broadcast` and `controllerEndpoint` are its `sender` / `endpoint`, never a second encoder.
