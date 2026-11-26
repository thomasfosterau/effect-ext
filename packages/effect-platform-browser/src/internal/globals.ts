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
import type * as Stream from "effect/Stream";
import type { AudioElementLike, AudioOutputLike } from "../AudioOutput.ts";
import type { BatteryManagerLike } from "../Battery.ts";
import type { BluetoothLike } from "../Bluetooth.ts";
import type {
  CredentialLike,
  IdentityCredentialStaticsLike,
  PasswordData,
  WebAuthnLike,
} from "../Credentials.ts";
import type { FilePickerLike } from "../FilePicker.ts";
import type { AnimationFramesLike, IdleCallbacksLike } from "../Frames.ts";
import type { MediaDevicesLike, MediaRecorderFactoryLike } from "../MediaDevices.ts";
import type { IdleDetectorLike } from "../IdleDetection.ts";
import type { InstallEventLike, LaunchQueueLike, RelatedAppLike } from "../InstalledApp.ts";
import type { NavigationLike } from "../Navigation.ts";
import type { RecognitionLike, SpeechRecognitionFactoryLike } from "../SpeechRecognition.ts";
import type { SpeechSynthesisLike, UtteranceLike } from "../SpeechSynthesis.ts";

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

/**
 * The `Audio` constructor and `URL`'s object-URL functions, where the
 * context has both (a window).
 */
export const ambientAudioOutput = (): Option.Option<AudioOutputLike> =>
  Option.map(
    Option.all([
      Option.fromUndefinedOr<typeof globalThis.Audio>(globalThis.Audio),
      Option.fromUndefinedOr<typeof globalThis.URL>(globalThis.URL),
    ]),
    ([Audio, Url]) => ({
      element: (): AudioElementLike => new Audio(),
      createObjectURL: (blob: Blob) => Url.createObjectURL(blob),
      revokeObjectURL: (url: string) => Url.revokeObjectURL(url),
    }),
  );

/**
 * `globalThis.speechSynthesis` and the utterance constructor, where the
 * context has both (a window).
 */
export const ambientSpeechSynthesis = (): Option.Option<{
  readonly synthesis: SpeechSynthesisLike;
  readonly utterance: (text: string) => UtteranceLike;
}> =>
  Option.map(
    Option.all([
      Option.fromUndefinedOr<SpeechSynthesis>(globalThis.speechSynthesis),
      Option.fromUndefinedOr<typeof globalThis.SpeechSynthesisUtterance>(
        globalThis.SpeechSynthesisUtterance,
      ),
    ]),
    ([synthesis, Utterance]) => ({
      synthesis,
      utterance: (text: string) => new Utterance(text),
    }),
  );

/**
 * `globalThis.SpeechRecognition`, or Chromium's and Safari's prefixed
 * `webkitSpeechRecognition`, as a factory, where the context has one.
 */
export const ambientSpeechRecognition = (): Option.Option<SpeechRecognitionFactoryLike> => {
  // The DOM lib has no `SpeechRecognition`; `navigator` keeps the type from
  // being weak, as for `ambientIdleDetector`.
  const scope: Partial<
    Record<"SpeechRecognition" | "webkitSpeechRecognition", new () => RecognitionLike>
  > &
    Pick<typeof globalThis, "navigator"> = globalThis;
  return Option.map(
    Option.orElse(Option.fromUndefinedOr(scope.SpeechRecognition), () =>
      Option.fromUndefinedOr(scope.webkitSpeechRecognition),
    ),
    (Recognition): SpeechRecognitionFactoryLike =>
      () =>
        new Recognition(),
  );
};

/**
 * WebAuthn: `navigator.credentials` and `PublicKeyCredential`, where the
 * context has both (a secure window), with `PasswordCredential` and
 * `IdentityCredential` where it has them.
 */
export const ambientWebAuthn = (): Option.Option<WebAuthnLike> =>
  Option.map(
    Option.all([
      Option.flatMap(ambientNavigator(), (navigator) =>
        Option.fromUndefinedOr<CredentialsContainer>(navigator.credentials),
      ),
      Option.fromUndefinedOr<typeof globalThis.PublicKeyCredential>(globalThis.PublicKeyCredential),
    ]),
    ([container, statics]): WebAuthnLike => {
      const scope: Partial<Pick<typeof globalThis, "location">> & {
        readonly PasswordCredential?: new (
          data: PasswordData & { readonly origin: string },
        ) => CredentialLike;
        readonly IdentityCredential?: IdentityCredentialStaticsLike;
      } = globalThis;
      const passwordCredential = Option.map(
        Option.all([
          Option.fromUndefinedOr(scope.PasswordCredential),
          Option.fromUndefinedOr(scope.location),
        ]),
        ([PasswordCredential, location]) =>
          (data: PasswordData) =>
            new PasswordCredential({ ...data, origin: location.origin }),
      );
      return {
        container,
        statics,
        passwordCredential: Option.getOrUndefined(passwordCredential),
        identityCredential: scope.IdentityCredential,
      };
    },
  );

/** `requestAnimationFrame` and `cancelAnimationFrame`, called on `globalThis`, where the context has them (a window). */
export const ambientAnimationFrames = (): Option.Option<AnimationFramesLike> => {
  const scope: Partial<Pick<typeof globalThis, "requestAnimationFrame" | "cancelAnimationFrame">> =
    globalThis;
  return Option.map(
    Option.all([
      Option.fromUndefinedOr(scope.requestAnimationFrame),
      Option.fromUndefinedOr(scope.cancelAnimationFrame),
    ]),
    ([request, cancel]): AnimationFramesLike => ({
      requestAnimationFrame: (callback) => request.call(globalThis, callback),
      cancelAnimationFrame: (handle) => cancel.call(globalThis, handle),
    }),
  );
};

/** `requestIdleCallback` and `cancelIdleCallback`, called on `globalThis`, where the context has them (a window, not Safari's). */
export const ambientIdleCallbacks = (): Option.Option<IdleCallbacksLike> => {
  const scope: Partial<Pick<typeof globalThis, "requestIdleCallback" | "cancelIdleCallback">> =
    globalThis;
  return Option.map(
    Option.all([
      Option.fromUndefinedOr(scope.requestIdleCallback),
      Option.fromUndefinedOr(scope.cancelIdleCallback),
    ]),
    ([request, cancel]): IdleCallbacksLike => ({
      requestIdleCallback: (callback, options) =>
        options === undefined
          ? request.call(globalThis, callback)
          : request.call(globalThis, callback, options),
      cancelIdleCallback: (handle) => cancel.call(globalThis, handle),
    }),
  );
};

/** `globalThis` as the target `beforeinstallprompt` and `appinstalled` fire on, where the agent has install prompts (Chromium). */
export const ambientInstallEvents = (): Option.Option<Stream.EventListener<InstallEventLike>> =>
  "onbeforeinstallprompt" in globalThis ? ambientEventTarget() : Option.none();

/** `globalThis.launchQueue`, where the agent has one (Chromium, in an installed app's window). */
export const ambientLaunchQueue = (): Option.Option<LaunchQueueLike> => {
  const scope: { readonly launchQueue?: LaunchQueueLike } & Pick<typeof globalThis, "navigator"> =
    globalThis;
  return Option.fromUndefinedOr(scope.launchQueue);
};

/** `navigator.getInstalledRelatedApps`, bound to `navigator`, where the agent has it (Chromium). */
export const ambientRelatedApps = (): Option.Option<() => Promise<ReadonlyArray<RelatedAppLike>>> =>
  Option.flatMap(ambientNavigator(), (navigator) => {
    const related: {
      readonly getInstalledRelatedApps?: () => Promise<ReadonlyArray<RelatedAppLike>>;
    } & Pick<Navigator, "onLine"> = navigator;
    return Option.map(
      Option.fromUndefinedOr(related.getInstalledRelatedApps),
      (get) => () => get.call(navigator),
    );
  });

/** `navigator.bluetooth`, where the agent has Web Bluetooth (Chromium, in a window). */
export const ambientBluetooth = (): Option.Option<BluetoothLike> =>
  Option.flatMap(ambientNavigator(), (navigator) => {
    // The DOM lib has no Web Bluetooth; `onLine` as for `ambientRelatedApps`.
    const withBluetooth: { readonly bluetooth?: BluetoothLike } & Pick<Navigator, "onLine"> =
      navigator;
    return Option.fromUndefinedOr(withBluetooth.bluetooth);
  });
