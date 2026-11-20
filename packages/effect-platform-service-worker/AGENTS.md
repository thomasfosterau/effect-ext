# @thomasfosterau/effect-platform-service-worker

Service workers, from the inside: only APIs a `ServiceWorkerGlobalScope` exposes (`Caches`, `Fetch`, `Events`, `Notifications`, `Clients`). Nothing here runs on a page's main thread: `navigator.serviceWorker` (registration, updates, the controller) belongs with the browser main-thread APIs, not this package. A test may fake the worker's globals.

## Boundary

Peer: `effect`. Dependency: `@thomasfosterau/effect-platform-worker-shared` (`.fallowrc.json` zone `service-worker`, allowed into `worker-shared` only). `Fetch` imports `Caches`; `Fetch`, `Events` and `Notifications` share `internal/events.ts` (the `EventLifetime` reference and the listener plumbing), which imports no module here.

## Invariants

- The shared package's invariants hold here: no global read at import or in a constructor, structural `*Like` types under the `dom` lib, each platform object a `Context.Reference` read on first use. `caches`, `fetch` (Effect's `FetchHttpClient.Fetch`), `self.registration` and `self.clients` are the references; the last two are an `Option` that is `none` outside a `ServiceWorkerGlobalScope`, so every call fails `Unsupported` rather than throwing.
- **A listener is built synchronously**, by running an effect while the script first evaluates: the browser dispatches only to listeners added then.
- **A route's `match` is synchronous.** `respondWith` must be called during dispatch, so whether a route answers can never wait on an effect; no match means no `respondWith`, and the browser fetches the request itself.
- **The page never waits on a cache write.** Strategies clone the response and hand the `put` to `EventLifetime`, which inside a listener is bound to the event's `waitUntil`; a background failure is logged, never served.
- **A received payload is untrusted.** `messageListener` and the notification listeners decode with the caller's schema and drop, with a warning log, what does not decode.
- **Rejections map onto reasons by `DOMException` name** (`internal/dom.ts` `reasonOf`), read structurally; anything unmapped is `Failed` with the `cause` kept.
- **The `*Like` interfaces keep the platform's `T | null` / `T | undefined`** where the DOM spells it so (`openWindow`, `navigate`, `Clients.get`, `Cache.match`), so the real objects stay assignable; every reading past the adapter is an `Option`.
- **Messages go through `WorkerMessaging`**: `postTo` and `broadcast` are its `sender`, never a second encoder.

## Terms

- **Strategy** — `(request: Request) => Effect<Response, E, R>`: how one request is answered. The five standard ones are built from `StrategyOptions`; any function of that shape is one.
- **Event lifetime** — `EventLifetime`: where background work goes. Inside a listener it is the event's `waitUntil`; outside one, a detached fiber.
