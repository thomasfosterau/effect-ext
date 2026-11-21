/**
 * Every `BrowserTesting` double in one layer.
 *
 * @since 0.1.0
 */
import * as Layer from "effect/Layer";
import * as TestAppBadge from "./app-badge.ts";
import * as TestBattery from "./battery.ts";
import * as TestBroadcast from "./broadcast.ts";
import * as TestClipboard from "./clipboard.ts";
import * as TestCookieStore from "./cookie-store.ts";
import * as TestCredentials from "./credentials.ts";
import * as TestDomObservers from "./dom-observers.ts";
import * as TestEventSource from "./event-source.ts";
import * as TestFilePicker from "./file-picker.ts";
import * as TestFrames from "./frames.ts";
import * as TestInstalledApp from "./installed-app.ts";
import * as TestFullscreen from "./fullscreen.ts";
import * as TestGeolocation from "./geolocation.ts";
import * as TestIdleDetection from "./idle-detection.ts";
import * as TestLocks from "./locks.ts";
import * as TestMediaDevices from "./media-devices.ts";
import * as TestMediaQuery from "./media-query.ts";
import * as TestNavigation from "./navigation.ts";
import * as TestNavigator from "./navigator.ts";
import * as TestNotifications from "./notifications.ts";
import * as TestPerformance from "./performance.ts";
import * as TestPageVisibility from "./page-visibility.ts";
import * as TestPermissions from "./permissions.ts";
import * as TestScreenOrientation from "./screen-orientation.ts";
import * as TestSerial from "./serial.ts";
import * as TestSpeechRecognition from "./speech-recognition.ts";
import * as TestSpeechSynthesis from "./speech-synthesis.ts";
import * as TestUsb from "./usb.ts";
import * as TestWakeLock from "./wake-lock.ts";

/**
 * Every service `layer` from `@thomasfosterau/effect-platform-browser` provides,
 * each over a fresh in-memory double in its default state, together with
 * every double's `Control`. The test counterpart of that layer: provide it
 * once, then reach for a `Control` (`TestNavigator.Control`, …) to drive
 * the platform.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigator } from "@thomasfosterau/effect-platform-browser"
 * import { TestNavigator, layer } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestNavigator.Control
 *   yield* control.setOnLine(false)
 *   return yield* Navigator.onLine
 * })
 * Effect.runPromise(Effect.provide(program, layer)).then(console.log) // false
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = Layer.mergeAll(
  TestAppBadge.layer(),
  TestBattery.layer(),
  TestBroadcast.layer,
  TestClipboard.layer(),
  TestCookieStore.layer(),
  TestCredentials.layer(),
  TestDomObservers.layer(),
  TestEventSource.layer(),
  TestFilePicker.layer(),
  TestFrames.layer(),
  TestInstalledApp.layer(),
  TestFullscreen.layer(),
  TestGeolocation.layer(),
  TestIdleDetection.layer(),
  TestLocks.layer(),
  TestMediaDevices.layer(),
  TestMediaQuery.layer(),
  TestNavigation.layer(),
  TestNavigator.layer(),
  TestNotifications.layer(),
  TestPageVisibility.layer(),
  TestPerformance.layer(),
  TestPermissions.layer(),
  TestScreenOrientation.layer(),
  TestSerial.layer(),
  TestSpeechRecognition.layer(),
  TestSpeechSynthesis.layer(),
  TestUsb.layer(),
  TestWakeLock.layer(),
);
