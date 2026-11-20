/**
 * Every live service in this package in one layer, together with the
 * `@effect/platform-browser` services they sit beside.
 *
 * @since 0.1.0
 */
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as Geolocation from "@effect/platform-browser/Geolocation";
import * as Permissions from "@effect/platform-browser/Permissions";
import * as Layer from "effect/Layer";
import * as Battery from "./Battery.ts";
import * as Broadcast from "./Broadcast.ts";
import * as Credentials from "./Credentials.ts";
import * as DomObservers from "./DomObservers.ts";
import * as FilePicker from "./FilePicker.ts";
import * as Fullscreen from "./Fullscreen.ts";
import * as IdleDetection from "./IdleDetection.ts";
import * as Locks from "./Locks.ts";
import * as MediaDevices from "./MediaDevices.ts";
import * as MediaQuery from "./MediaQuery.ts";
import * as Navigation from "./Navigation.ts";
import * as Navigator from "./Navigator.ts";
import * as Notifications from "./Notifications.ts";
import * as PageVisibility from "./PageVisibility.ts";
import * as ScreenOrientation from "./ScreenOrientation.ts";
import * as SpeechRecognition from "./SpeechRecognition.ts";
import * as SpeechSynthesis from "./SpeechSynthesis.ts";
import * as WakeLock from "./WakeLock.ts";

/**
 * Every live service this package defines (`Battery`, `Broadcast`,
 * `Credentials`, `DomObservers`, `FilePicker`, `Fullscreen`, `IdleDetection`, `Locks`, `MediaDevices`, `MediaQuery`, `Navigation`, `Navigator`,
 * `Notifications`, `PageVisibility`, `ScreenOrientation`, `SpeechRecognition`, `SpeechSynthesis`, `WakeLock`) and the
 * `@effect/platform-browser` `Clipboard`, `Geolocation` and `Permissions`
 * services, over the ambient globals. Each degrades where its API is
 * missing, so the layer builds in any context — but provide only the
 * services a program uses where bundle size matters: this layer keeps
 * every adapter in the bundle.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Browser, Locks, Navigator } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.gen(function* () {
 *   const locks = yield* Locks.Locks
 *   const online = yield* Navigator.onLine
 *   return { locks: locks.supported, online }
 * })
 * Effect.runPromise(Effect.provide(program, Browser.layer)).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<
  | Battery.Battery
  | Broadcast.Broadcast
  | Credentials.Credentials
  | DomObservers.DomObservers
  | FilePicker.FilePicker
  | Fullscreen.Fullscreen
  | IdleDetection.IdleDetection
  | Locks.Locks
  | MediaDevices.MediaDevices
  | MediaQuery.MediaQuery
  | Navigation.Navigation
  | Navigator.Navigator
  | Notifications.Notifications
  | PageVisibility.PageVisibility
  | ScreenOrientation.ScreenOrientation
  | SpeechRecognition.SpeechRecognition
  | SpeechSynthesis.SpeechSynthesis
  | WakeLock.WakeLock
  | Clipboard.Clipboard
  | Geolocation.Geolocation
  | Permissions.Permissions
> = Layer.mergeAll(
  Battery.layer,
  Broadcast.layer,
  Credentials.layer,
  DomObservers.layer,
  FilePicker.layer,
  Fullscreen.layer,
  IdleDetection.layer,
  Locks.layer,
  MediaDevices.layer,
  MediaQuery.layer,
  Navigation.layer,
  Navigator.layer,
  Notifications.layer,
  PageVisibility.layer,
  ScreenOrientation.layer,
  SpeechRecognition.layer,
  SpeechSynthesis.layer,
  WakeLock.layer,
  Clipboard.layer,
  Geolocation.layer,
  Permissions.layer,
);
