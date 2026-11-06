/**
 * `@thomasfosterau/effect-utilities/BrowserTesting` — in-memory doubles for every
 * `@thomasfosterau/effect-utilities/Browser` service and for the
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
 * - `TestNavigator`, `TestPageVisibility`, `TestMediaQuery`, `TestWakeLock`,
 *   `TestBroadcast`, `TestIdleDetection`, `TestBattery`, `TestFullscreen`,
 *   `TestScreenOrientation`, `TestNotifications` — the `Browser` services.
 * - `TestPermissions`, `TestClipboard`, `TestGeolocation` — the
 *   `@effect/platform-browser` services.
 *
 * Requires the optional peer `@effect/platform-browser`.
 *
 * @since 0.2.0
 */
export { layer } from "./browser-testing/layer.ts";
export { observe } from "./browser-testing/stream.ts";
export * as TestBattery from "./browser-testing/battery.ts";
export * as TestBroadcast from "./browser-testing/broadcast.ts";
export * as TestClipboard from "./browser-testing/clipboard.ts";
export * as TestFullscreen from "./browser-testing/fullscreen.ts";
export * as TestGeolocation from "./browser-testing/geolocation.ts";
export * as TestIdleDetection from "./browser-testing/idle-detection.ts";
export * as TestLocks from "./browser-testing/locks.ts";
export * as TestMediaQuery from "./browser-testing/media-query.ts";
export * as TestNavigator from "./browser-testing/navigator.ts";
export * as TestNotifications from "./browser-testing/notifications.ts";
export * as TestPageVisibility from "./browser-testing/page-visibility.ts";
export * as TestPermissions from "./browser-testing/permissions.ts";
export * as TestScreenOrientation from "./browser-testing/screen-orientation.ts";
export * as TestWakeLock from "./browser-testing/wake-lock.ts";
