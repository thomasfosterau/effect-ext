/**
 * The only place this package's services read ambient globals. Every live
 * `layer` reads through here, inside its build (never at import), so the
 * modules stay importable — and their layers buildable — in a server render,
 * a worker or a test runner, where a global may be missing.
 *
 * The DOM lib types these globals as always present; at runtime they are
 * not (reading a missing one off `globalThis` is `undefined`, never a
 * throw), so each read is an `Option`, `None` where the global is missing.
 */
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import type { BatteryManagerLike } from "../Battery.ts";
import type { FilePickerLike } from "../FilePicker.ts";
import type { MediaDevicesLike, MediaRecorderFactoryLike } from "../MediaDevices.ts";
import type { IdleDetectorLike } from "../IdleDetection.ts";
import type { NavigationLike } from "../Navigation.ts";

/** `globalThis.navigator`, where the context has one. */
export const ambientNavigator = (): Option.Option<Navigator> =>
  Option.fromUndefinedOr(globalThis.navigator);

/** `globalThis.document`, where the context has one (a window, not a worker). */
export const ambientDocument = (): Option.Option<Document> =>
  Option.fromUndefinedOr(globalThis.document);

/** `globalThis.matchMedia`, bound to `globalThis`, where the context has one. */
export const ambientMatchMedia = (): Option.Option<(query: string) => MediaQueryList> =>
  Option.map(
    Option.fromUndefinedOr<typeof globalThis.matchMedia>(globalThis.matchMedia),
    (matchMedia) => (query: string) => matchMedia.call(globalThis, query),
  );

/** `globalThis.BroadcastChannel`, where the context has one. */
export const ambientBroadcastChannel = (): Option.Option<typeof globalThis.BroadcastChannel> =>
  Option.fromUndefinedOr(globalThis.BroadcastChannel);

/**
 * `globalThis` as the event target `online` / `offline` / `languagechange`
 * fire on (the window, or a worker's global scope); `None` where it is
 * not one.
 */
export const ambientEventTarget = (): Option.Option<EventTarget> =>
  P.isFunction(globalThis.addEventListener) ? Option.some(globalThis) : Option.none();

/** `globalThis.IdleDetector`, where the agent has one (Chromium, in a window or a dedicated worker). */
export const ambientIdleDetector = (): Option.Option<IdleDetectorLike> => {
  // The DOM lib has no `IdleDetector`; the `navigator` member only stops the
  // annotation reading as a weak type (one with no member in common).
  const scope: { readonly IdleDetector?: IdleDetectorLike } & Pick<typeof globalThis, "navigator"> =
    globalThis;
  return Option.fromUndefinedOr(scope.IdleDetector);
};

/** `navigator.getBattery`, bound to `navigator`, where the agent has it (Chromium). */
export const ambientGetBattery = (): Option.Option<() => Promise<BatteryManagerLike>> =>
  Option.flatMap(ambientNavigator(), (navigator) => {
    // The DOM lib has no `getBattery`; `userAgent` as for `ambientIdleDetector`.
    const withBattery: { getBattery?: () => Promise<BatteryManagerLike> } & Pick<
      Navigator,
      "userAgent"
    > = navigator;
    const getBattery = withBattery.getBattery;
    return Option.map(Option.fromUndefinedOr(getBattery), (fn) => () => fn.call(navigator));
  });

/** `globalThis.screen.orientation`, where the context has one (a window, in an agent that ships it). */
export const ambientScreenOrientation = (): Option.Option<ScreenOrientation> =>
  Option.flatMap(Option.fromUndefinedOr(globalThis.screen), (screen) =>
    Option.fromUndefinedOr(screen.orientation),
  );

/** `globalThis.Notification`, where the context has one (a window, or a dedicated worker). */
export const ambientNotification = (): Option.Option<typeof globalThis.Notification> =>
  Option.fromUndefinedOr(globalThis.Notification);

/** `globalThis.IntersectionObserver`, where the context has one (a window). */
export const ambientIntersectionObserver = (): Option.Option<
  typeof globalThis.IntersectionObserver
> => Option.fromUndefinedOr(globalThis.IntersectionObserver);

/** `globalThis.ResizeObserver`, where the context has one (a window). */
export const ambientResizeObserver = (): Option.Option<typeof globalThis.ResizeObserver> =>
  Option.fromUndefinedOr(globalThis.ResizeObserver);

/** `globalThis.MutationObserver`, where the context has one (a window). */
export const ambientMutationObserver = (): Option.Option<typeof globalThis.MutationObserver> =>
  Option.fromUndefinedOr(globalThis.MutationObserver);

/** `globalThis.navigation`, the Navigation API, where the agent has it (a window). */
export const ambientNavigation = (): Option.Option<NavigationLike> =>
  Option.fromUndefinedOr<NavigationLike>(globalThis.navigation);

/** `globalThis.history`, where the context has one (a window). */
export const ambientHistory = (): Option.Option<History> =>
  Option.fromUndefinedOr(globalThis.history);

/** `globalThis.location`, where the context is a window (a worker's has no `assign`). */
export const ambientLocation = (): Option.Option<Location> =>
  Option.filter(Option.fromUndefinedOr(globalThis.location), (location) =>
    P.hasProperty(location, "assign"),
  );

/**
 * The File System Access pickers, bound to `globalThis`, where the agent has
 * all three (Chromium, in a window).
 */
export const ambientFilePicker = (): Option.Option<FilePickerLike> => {
  // The DOM lib has no pickers; `navigator` as for `ambientIdleDetector`.
  const scope: Partial<FilePickerLike> & Pick<typeof globalThis, "navigator"> = globalThis;
  return Option.map(
    Option.all([
      Option.fromUndefinedOr(scope.showOpenFilePicker),
      Option.fromUndefinedOr(scope.showSaveFilePicker),
      Option.fromUndefinedOr(scope.showDirectoryPicker),
    ]),
    ([open, save, directory]): FilePickerLike => ({
      showOpenFilePicker: (options) => open.call(globalThis, options),
      showSaveFilePicker: (options) => save.call(globalThis, options),
      showDirectoryPicker: (options) => directory.call(globalThis, options),
    }),
  );
};

/** `navigator.mediaDevices`, where the context has one (a secure window). */
export const ambientMediaDevices = (): Option.Option<MediaDevicesLike> =>
  Option.flatMap(ambientNavigator(), (navigator) =>
    Option.fromUndefinedOr<MediaDevicesLike>(navigator.mediaDevices),
  );

/** `globalThis.MediaRecorder`, as a factory, where the context has one. */
export const ambientMediaRecorder = (): Option.Option<MediaRecorderFactoryLike> =>
  Option.map(
    Option.fromUndefinedOr<typeof globalThis.MediaRecorder>(globalThis.MediaRecorder),
    (Recorder): MediaRecorderFactoryLike => ({
      // SAFETY: the stream came from this agent's own `getUserMedia` /
      // `getDisplayMedia`, so it is the platform's `MediaStream`.
      make: (stream, options) => new Recorder(stream as MediaStream, options),
      isTypeSupported: (mimeType) => Recorder.isTypeSupported(mimeType),
    }),
  );
