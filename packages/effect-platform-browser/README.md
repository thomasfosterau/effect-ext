# @thomasfosterau/effect-platform-browser

[Effect](https://effect.website) services for browser main-thread APIs that `@effect/platform-browser` does not cover: Web Locks, `navigator`, page visibility, media queries, the screen wake lock, `BroadcastChannel`, idle detection, the battery, fullscreen, screen orientation, the page's notifications and permission state, plus the page's side of a service worker (registering, updates, the controller as a schema-typed endpoint) and Web Push subscriptions. Every service has an in-memory double in `BrowserTesting`. It builds on [`@thomasfosterau/effect-platform-worker-shared`](../effect-platform-worker-shared); the worker's side of a service worker is [`@thomasfosterau/effect-platform-service-worker`](../effect-platform-service-worker).

> [!CAUTION]
> Experimental and pre-1.0. APIs may change between minor versions; pin what you use.

## Install

```sh
pnpm add @thomasfosterau/effect-platform-browser @effect/platform-browser effect
```

`effect` and `@effect/platform-browser` (`^4.0.0`) are peer dependencies: keep a single copy of each in your app. `@thomasfosterau/effect-platform-worker-shared` comes with it.

The platform services were `@thomasfosterau/effect-ext/Browser` and `/BrowserTesting`. Each service is now its own subpath and a namespace on the barrel (`import { Locks } from "@thomasfosterau/effect-platform-browser"`), the all-services `layer` is `Browser.layer`, and the doubles are `@thomasfosterau/effect-platform-browser/BrowserTesting`. Each service's `Context` key moved too (`@thomasfosterau/effect-ext/Browser/Locks` is now `@thomasfosterau/effect-platform-browser/Locks`), so move every import at once.

## Modules

| Module | What it is |
| --- | --- |
| `Locks`, `Navigator`, `PageVisibility`, `MediaQuery`, `WakeLock`, `Broadcast`, `IdleDetection`, `Battery`, `Fullscreen`, `ScreenOrientation`, `Notifications`, `PermissionStatus` | One platform service each; see [Platform services](#platform-services). |
| `Browser` | `layer`: every live service, plus `@effect/platform-browser`'s `Clipboard`, `Geolocation` and `Permissions`. |
| `BrowserTesting` | In-memory doubles for every service, each with a `Control`; `observe`. Not on the barrel. |
| `ServiceWorkerContainer` | `navigator.serviceWorker` as typed effects: `register`, `ready`, `getRegistration`, `update`, `unregister`; the `controller` and `controllerChanges`; `waitingWorker` ("a new version is ready"); and `controllerEndpoint`, the controller as a `WorkerMessaging` endpoint. Every failure is a `ContainerError`. |
| `PushManager` | `registration.pushManager`: `subscribe`, `getSubscription`, `unsubscribe`, `permissionState`, and `toJson` checked against the `SubscriptionJson` schema a server can decode with too. Every failure is a `PushError`. |

`ServiceWorkerContainer.Container` is a context reference defaulting to `navigator.serviceWorker`, read on first use, so a page provides nothing and a test provides a stub.

More services are planned in [#152](https://github.com/thomasfosterau/effect-ext/issues/152).

## Usage

Every service module has the same shape: a `Context.Service` tag, a `make` over a structural `*Like` slice of the platform object (omit the argument for the unsupported service), a live `layer` that reads the ambient global when it is built (never at import), a tagged error whose `reason` maps the platform's `DOMException` names, and accessors. A live layer builds in any context — a missing API degrades (`supported: false`, an `Unsupported` failure, `Option.none()`) rather than failing the layer — so one layer serves every browser, a worker and a server render.

```ts
import * as Effect from "effect/Effect";
import { Browser, Locks, Navigator, PageVisibility } from "@thomasfosterau/effect-platform-browser";

// One tab refreshes the session on behalf of every tab of the origin.
const refresh = Effect.gen(function* () {
  yield* Navigator.awaitOnLine;
  return yield* fetchFreshToken; // your effect
}).pipe(Locks.withLock("auth-refresh"));

// Poll only while somebody can see the page.
const poll = PageVisibility.whileVisible(syncInbox.pipe(Effect.repeat(everyMinute)));

Effect.runFork(Effect.provide(Effect.all([refresh, poll], { concurrency: 2 }), Browser.layer));
```

## Testing browser code

`BrowserTesting`'s doubles run the **real** adapter over an in-memory platform object, so a test exercises the code that runs in the browser. Each module's `layer` provides the service and its `Control`; drive the platform through the `Control` (the double fires the events the browser would), and read back what the code under test asked of it.

```ts
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { Navigator } from "@thomasfosterau/effect-platform-browser";
import { TestNavigator, observe } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const program = Effect.gen(function* () {
  const control = yield* TestNavigator.Control;
  // Subscribe first: `observe` returns once the stream has emitted its current value.
  const seen = yield* observe(Navigator.onLineChanges, 2);
  yield* control.setOnLine(false);
  return yield* Fiber.join(seen); // [true, false]
});

Effect.runPromise(Effect.provide(program, TestNavigator.layer()));
```

Fork-then-sleep is a race (the child may not have subscribed yet); `observe` is the sync point. `TestLocks.makeLockManager()` is one origin: build several `Locks` services over it (`Locks.make(manager.forClient("tab-b"))`) to test contention between tabs.

## Platform services

Each module is a namespace on the barrel and its own subpath: `import { Locks } from "@thomasfosterau/effect-platform-browser"`, then `Locks.Locks` (the tag), `Locks.layer`, `Locks.make`, `Locks.withLock`, ….

- `Locks` — Web Locks. `acquire(name, { mode?, steal? }): Effect<HeldLock, LockError, Scope>` holds an origin-wide lock until the scope closes; waiting is interruptible (the request is withdrawn), and closing the scope waits for the browser to report the release. `tryAcquire` is `ifAvailable` (`None` instead of queueing). `withLock(name, options?)` runs an effect under the lock and, if another context steals it, interrupts the effect and fails `Stolen`; `withLockIfAvailable` runs it only when the lock is free (leader election). `query` is a diagnostic snapshot. `LockError.reason`: `Unsupported`, `Stolen`, `InvalidRequest`, `NotAllowed`, `InvalidState`, `Failed`.
- `Navigator` — `info` (user agent, languages, `hardwareConcurrency`, `deviceMemoryGiB`, touch points, cookies, `webdriver`, Global Privacy Control); `onLine` / `onLineChanges` / `awaitOnLine`; `languages` / `languageChanges`; `connection` / `connectionChanges` (Network Information, `None` where missing); `userActivation`; `canShare` / `share`; `sendBeacon`; `vibrate`; `storage.estimate` / `persisted` / `persist`. `NavigatorError` carries the `operation` and a `reason` (`Unsupported`, `NotAllowed`, `Aborted` — the user dismissed the share sheet, `InvalidData`, `InvalidState`, `Rejected` — the beacon was not queued, `Failed`).
- `PageVisibility` — `state`, `changes`, `awaitVisible`, and `whileVisible(effect)`: started whenever the page becomes visible, interrupted whenever it is hidden.
- `MediaQuery` — `matches(query)`, `changes(query)`, and the preference streams `colorScheme`, `reducedMotion`, `moreContrast`, `reducedData`.
- `WakeLock` — the Screen Wake Lock. `acquire` is scoped; `keepAwake(effect)` holds one lock for the effect and fails `WakeLockError` without one; `keepAwakeWhileVisible(effect)` re-acquires each time the page returns (the browser drops the lock on hide) and never fails the effect over a lock it could not get.
- `IdleDetection` — `IdleDetector` (Chromium-only, behind a permission: treat it as optional; `supported: false` is the common case). `requestPermission` (from a user gesture) returns `"granted" | "denied"`; `watch({ threshold })` is a `Stream<IdleState, IdleError>` of `{ user: "active" | "idle", screen: "locked" | "unlocked" }`, current state first, and its detector is aborted when the stream ends. `threshold` is a `Duration.Input` of at least `minimumThreshold` (one minute). `IdleError.reason`: `Unsupported`, `NotAllowed` (permission not granted, or no activation to ask with), `InvalidRequest` (threshold under a minute), `Failed`.
- `Battery` — `navigator.getBattery()` (Chromium-only; Firefox and Safari removed it). Its own service, not part of `Navigator`, because the manager is promise-acquired (once, on the first reading). `status` is an `Option<BatteryState>` — `{ charging, level (0–1), chargingTime, dischargingTime }`, the times `Option<Duration>` with the API's `Infinity` (unknown) as `None` — and `changes` follows the four change events; `None` / empty where the API is missing or `getBattery()` rejects.
- `Fullscreen` — `enter(element, options?): Effect<void, FullscreenError, Scope>` shows an element fullscreen; closing the scope calls `exitFullscreen()` only if that element is still the fullscreen one. `withFullscreen(element, options?)` is the combinator form (the user leaving with Esc does not interrupt it). `element` (`Option`) and `changes` follow `fullscreenchange`. Unprefixed API only; Safari on iPhone reads as unsupported. `FullscreenError.reason`: `Unsupported` (no API, or `fullscreenEnabled` is `false`), `NotAllowed` (no user activation, a permissions policy), `Failed`.
- `ScreenOrientation` — `type`, `angle` (`Option`), `current`, and `changes` (follows `change`; empty where missing). `lock(orientation)` is scoped and unlocks when the scope closes; `withLock(orientation)` is the combinator form, and composes inside `Fullscreen.withFullscreen`, where browsers allow a lock. `OrientationError.reason`: `Unsupported` (no API or no `lock`, or a `NotSupportedError` refusal), `NotAllowed` (`SecurityError`), `Aborted` (a newer lock superseded it), `Failed`.
- `Notifications` — the page's own `Notification`s. `permission` (`None` where unsupported); `requestPermission` returns the user's answer and fails `NotAllowed` without transient user activation; `show(title, options?): Effect<ShownNotification, NotificationError, Scope>` closes the notification when the scope closes, and its `clicks` / `closes` streams replay from when it was shown, end once it closes and fail `Failed` on the browser's `error` event; `permissionChanges` follows `PermissionStatus.changes("notifications")`. `NotificationError.reason`: `Unsupported`, `NotAllowed` (not yet granted, or no activation), `Denied`, `InvalidData`, `Failed`. Service-worker-registration notifications (`registration.showNotification`, `notificationclick`) are not here: they outlive the page and their events reach the worker, so they belong with [`@thomasfosterau/effect-platform-service-worker`](../effect-platform-service-worker)'s `Notifications`.
- `Broadcast` — `BroadcastChannel`. `channel(name, schema)` opens a scoped channel whose `publish` encodes and whose messages are decoded through the schema (an undecodable message from another tab — an older deploy — is dropped with a warning log). `subscribe` starts listening when it runs, so nothing posted before the stream is consumed is lost; `messages` listens from when it runs. `open(name)` is the undecoded form.
- `PermissionStatus` — over `@effect/platform-browser`'s `Permissions`: `state(name)`, `changes(name)` (follows the status's `change` event), `awaitGranted(name)`.
- `Browser.layer` — every live service above plus `@effect/platform-browser`'s `Clipboard`, `Geolocation` and `Permissions`. Prefer the per-service layers where bundle size matters.

## `BrowserTesting` — doubles

- `TestLocks` — `makeLockManager({ clientId? })`, an in-memory lock manager following the Web Locks request algorithm (FIFO per name, shared/exclusive, `ifAvailable`, `steal`, `signal`, `query`), with `forClient(id)` views for other tabs; `layer(manager?)`.
- `TestNavigator` — `layer(options?)` / `make(options?)` with `Control`: `setOnLine`, `setLanguages`, `setConnection`, `setUserActivation`, and the recorded `shares`, `beacons`, `vibrations`. Options choose how `share` (`succeed` / `abort` / `deny` / `unsupported`) and `sendBeacon` (`queue` / `reject` / `unsupported`) answer.
- `TestPageVisibility`, `TestMediaQuery`, `TestWakeLock` (`held`, `requests`, `releaseAll`, `setDenied`), `TestBroadcast` (an in-memory hub with structured-clone semantics; `posted`, `deliver` a message from "another context").
- `TestIdleDetection` — `Control`: `setUser`, `setScreen` (fire `change` on running detectors), `setPermission`, `setAnswer`, `running`, `thresholds`. `TestBattery` — `Control`: `set({ charging?, level?, chargingTime?, dischargingTime? })` (fires the matching events), `requests`; options set the readings, `supported` and `reject`.
- `TestFullscreen` — `Control`: `element(id)`, `setAllowed`, `exit` (the user pressing Esc), `requests`. `TestScreenOrientation` — `Control`: `rotate(type, angle?)`, `locked`, `setRefusal(refusal?)` (no argument grants locks again); options choose the starting orientation and whether `lock` exists.
- `TestNotifications` — `layer(options?)` / `make(options?)` with `Control`: `setPermission`, `setAnswer` (what a prompt resolves to), `setUserActivation`, `click` / `dismiss` / `fail` the `index`th notification, and the recorded `shown` (each entry's `options` is an `Option`) and `requests`.
- `TestPermissions`, `TestClipboard`, `TestGeolocation` — doubles for the `@effect/platform-browser` services.
- `layer` — every double and every `Control` at once. `observe(stream, count)` — forks the first `count` elements and returns once the first is out.

## Service workers and push

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
