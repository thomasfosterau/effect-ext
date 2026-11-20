# @thomasfosterau/effect-platform-browser

Browser main-thread APIs as Effect values, beyond what `@effect/platform-browser` ships: the page side of a service worker (`ServiceWorkerContainer`) and Web Push subscriptions (`PushManager`) today, and the services tracked in issue #152. Code that runs inside a worker belongs in the worker packages; an API a worker scope also exposes belongs in `effect-platform-worker-shared`, with only its window-side layer here.

## Boundary

Peer: `effect`. Dependency: `@thomasfosterau/effect-platform-worker-shared` (`.fallowrc.json` zone `browser`, allowed into `worker-shared` only). `ServiceWorkerContainer` builds its controller endpoint on `WorkerMessaging`. `PushManager` imports no module here: it reads a registration structurally, so a `ServiceWorkerContainer.RegistrationLike` from a real browser and a test stub both fit.

## Invariants

- **No global is read at import.** A platform object the page reads ambiently (`navigator.serviceWorker`) is a `Context.Reference` of an `Option`, defaulting to the global on first read and `none` where it is missing (an insecure origin, Node), so every call fails `Unsupported` rather than throwing.
- **Structural types, `dom` lib.** Each platform object is a `*Like` interface, the slice the code calls, so a test hands in an `EventTarget` and the real object stays assignable.
- **The `*Like` interfaces keep the platform's `T | null` / `T | undefined`** where the DOM spells it so (`controller`, `installing` / `waiting` / `active`, `getRegistration`, `getSubscription`); every reading past the adapter is an `Option`.
- **Rejections map onto reasons by `DOMException` name** (`internal/dom.ts` `reasonOf`), read structurally; anything unmapped is `Failed` with the `cause` kept.
- **Messages go through `WorkerMessaging`**, never a second encoder; a received message is decoded against the caller's schema and dropped, with a warning log, if it does not decode.

## Terms

- **Controller** — the service worker controlling this page (`navigator.serviceWorker.controller`); `None` on a first load or a hard reload.
- **Waiting worker** — an installed worker held back until the old one's pages close or it calls `skipWaiting`: "a new version is ready".
