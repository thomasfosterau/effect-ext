/**
 * In-memory doubles for every service in this package and for the
 * `@effect/platform-browser` `Clipboard`, `Geolocation` and `Permissions`
 * services, runnable under Node with no DOM.
 *
 * Each module has the same shape: `make` builds the double — the real
 * adapter over an in-memory platform object, so a test exercises the code
 * that runs in the browser — together with its `Control` service, which
 * drives the platform (go offline, hide the page, steal a lock) through the
 * events the browser would fire, and reads back what the code under test
 * asked of it (beacons, shares, posted messages). `layer` provides both.
 * The top-level `layer` provides every double at once, and `observe`
 * subscribes to a change stream before a test drives the change.
 *
 * - `TestLocks` — a lock manager following the Web Locks request algorithm;
 *   share one between layers to model several tabs.
 * - `TestDomObservers` — intersection, resize and mutation observers.
 * - `TestPerformance` — a performance timeline on a manual clock, for
 *   `Performance` (from `effect-platform-worker-shared`) and `WebVitals`.
 * - `TestNavigator`, `TestPageVisibility`, `TestMediaQuery`, `TestWakeLock`,
 *   `TestBroadcast`, `TestIdleDetection`, `TestBattery`, `TestFullscreen`,
 *   `TestScreenOrientation`, `TestNotifications` — this package's services.
 * - `TestPermissions`, `TestClipboard`, `TestGeolocation` — the
 *   `@effect/platform-browser` services.
 *
 * @since 0.1.0
 */
export { layer } from "./testing/layer.ts";
export { observe } from "./testing/stream.ts";
export * as TestBattery from "./testing/battery.ts";
export * as TestBroadcast from "./testing/broadcast.ts";
export * as TestClipboard from "./testing/clipboard.ts";
export * as TestDomObservers from "./testing/dom-observers.ts";
export * as TestFullscreen from "./testing/fullscreen.ts";
export * as TestGeolocation from "./testing/geolocation.ts";
export * as TestIdleDetection from "./testing/idle-detection.ts";
export * as TestLocks from "./testing/locks.ts";
export * as TestMediaQuery from "./testing/media-query.ts";
export * as TestNavigator from "./testing/navigator.ts";
export * as TestNotifications from "./testing/notifications.ts";
export * as TestPerformance from "./testing/performance.ts";
export * as TestPageVisibility from "./testing/page-visibility.ts";
export * as TestPermissions from "./testing/permissions.ts";
export * as TestScreenOrientation from "./testing/screen-orientation.ts";
export * as TestWakeLock from "./testing/wake-lock.ts";
