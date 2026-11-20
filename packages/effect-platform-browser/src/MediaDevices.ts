/**
 * Cameras, microphones and screen capture (`navigator.mediaDevices`) as an
 * Effect service, with `MediaRecorder` as a stream of chunks.
 *
 * A captured stream is a scoped resource: closing its scope stops every
 * track, so the camera light goes off with the fiber that asked for it.
 * {@link record} turns a stream into the `Blob` chunks a `MediaRecorder`
 * delivers: the audio a transcription model takes, or a clip to upload.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equivalence from "effect/Equivalence";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { reasonOf } from "./internal/dom.ts";
import { ambientMediaDevices, ambientMediaRecorder } from "./internal/globals.ts";

/**
 * The structural slice of a `MediaStreamTrack` this module uses.
 *
 * @since 0.1.0
 * @category models
 */
export interface MediaStreamTrackLike extends Stream.EventListener {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly readyState: "live" | "ended";
  stop(): void;
}

/**
 * The structural slice of a `MediaStream` this module uses. A stream the
 * service returns is the platform's own `MediaStream`: hand it to a
 * `<video>` through {@link attach}.
 *
 * @since 0.1.0
 * @category models
 */
export interface MediaStreamLike {
  readonly id: string;
  getTracks(): ReadonlyArray<MediaStreamTrackLike>;
}

/**
 * The structural slice of a `MediaDeviceInfo` this module reads.
 *
 * @since 0.1.0
 * @category models
 */
export interface DeviceInfoLike {
  readonly deviceId: string;
  readonly groupId: string;
  readonly kind: Device["kind"];
  readonly label: string;
}

/**
 * The structural slice of `navigator.mediaDevices` this module calls.
 * `getDisplayMedia` is missing on mobile browsers.
 *
 * @since 0.1.0
 * @category models
 */
export interface MediaDevicesLike extends Stream.EventListener {
  getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStreamLike>;
  getDisplayMedia?(options?: DisplayMediaStreamOptions): Promise<MediaStreamLike>;
  enumerateDevices(): Promise<ReadonlyArray<DeviceInfoLike>>;
  getSupportedConstraints(): MediaTrackSupportedConstraints;
}

/**
 * The structural slice of a `MediaRecorder` this module uses. Its
 * `dataavailable` events carry the chunk as `data`.
 *
 * @since 0.1.0
 * @category models
 */
export interface MediaRecorderLike extends Stream.EventListener {
  readonly state: "inactive" | "recording" | "paused";
  readonly mimeType: string;
  start(timeslice?: number): void;
  stop(): void;
}

/**
 * The `MediaRecorder` constructor and its `isTypeSupported`, as this module
 * calls them.
 *
 * @since 0.1.0
 * @category models
 */
export interface MediaRecorderFactoryLike {
  make(stream: MediaStreamLike, options: MediaRecorderOptions): MediaRecorderLike;
  isTypeSupported(mimeType: string): boolean;
}

/**
 * A media input or output device. `label` is empty until the page has been
 * granted access to a device of that kind.
 *
 * @since 0.1.0
 * @category models
 */
export interface Device {
  readonly deviceId: string;
  readonly groupId: string;
  readonly kind: "audioinput" | "audiooutput" | "videoinput";
  readonly label: string;
}

/**
 * Why a capture was not granted.
 *
 * - `Unsupported` — the agent has no `navigator.mediaDevices` (an insecure
 *   context), or no `getDisplayMedia`.
 * - `NotAllowed` — the user or a permissions policy refused.
 * - `NotFound` — no device of the kind asked for.
 * - `NotReadable` — the device is in use, or the OS refused it.
 * - `Overconstrained` — no device meets the constraints; `constraint` names
 *   the one that failed.
 * - `Aborted` — the capture was cancelled.
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.1.0
 * @category errors
 */
export type MediaDevicesErrorReason =
  | "Unsupported"
  | "NotAllowed"
  | "NotFound"
  | "NotReadable"
  | "Overconstrained"
  | "Aborted"
  | "Failed";

/**
 * A capture or device query that failed. `cause` carries the browser's
 * rejection, where there was one.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 *
 * const error = new MediaDevices.MediaDevicesError({
 *   reason: "Overconstrained",
 *   constraint: Option.some("width"),
 *   message: "media devices: Overconstrained",
 *   cause: undefined,
 * })
 * console.log(error.constraint) // { _tag: "Some", value: "width" }
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class MediaDevicesError extends Schema.TaggedError<MediaDevicesError>()(
  "MediaDevicesError",
  {
    reason: Schema.Literals([
      "Unsupported",
      "NotAllowed",
      "NotFound",
      "NotReadable",
      "Overconstrained",
      "Aborted",
      "Failed",
    ]),
    constraint: Schema.Option(Schema.String),
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

/**
 * Why a recording failed.
 *
 * - `Unsupported` — the agent has no `MediaRecorder`.
 * - `NotSupported` — the recorder cannot produce the `mimeType` asked for,
 *   or cannot record this stream.
 * - `Failed` — the recorder reported an error mid-recording; `cause`
 *   carries it.
 *
 * @since 0.1.0
 * @category errors
 */
export type MediaRecorderErrorReason = "Unsupported" | "NotSupported" | "Failed";

/**
 * A recording that could not start or did not finish.
 *
 * @example
 * ```ts
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 *
 * const error = new MediaDevices.MediaRecorderError({
 *   reason: "NotSupported",
 *   message: "media recorder: NotSupported",
 *   cause: undefined,
 * })
 * console.log(error.reason) // "NotSupported"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class MediaRecorderError extends Schema.TaggedError<MediaRecorderError>()(
  "MediaRecorderError",
  {
    reason: Schema.Literals(["Unsupported", "NotSupported", "Failed"]),
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

const CAPTURE_REASONS = {
  NotAllowedError: "NotAllowed",
  SecurityError: "NotAllowed",
  NotFoundError: "NotFound",
  NotReadableError: "NotReadable",
  OverconstrainedError: "Overconstrained",
  AbortError: "Aborted",
} satisfies Readonly<Record<string, MediaDevicesErrorReason>>;

const devicesError = (
  reason: MediaDevicesErrorReason,
  cause: unknown,
  constraint: Option.Option<string> = Option.none(),
) => new MediaDevicesError({ reason, constraint, cause, message: `media devices: ${reason}` });

/** The rejection as an error: an `OverconstrainedError` names its constraint. */
const fromRejection = (cause: unknown) =>
  devicesError(
    reasonOf(cause, CAPTURE_REASONS, "Failed"),
    cause,
    P.hasProperty(cause, "constraint") && P.isString(cause.constraint) && cause.constraint !== ""
      ? Option.some(cause.constraint)
      : Option.none(),
  );

const recorderError = (reason: MediaRecorderErrorReason, cause: unknown) =>
  new MediaRecorderError({ reason, cause, message: `media recorder: ${reason}` });

const toDevice = (info: DeviceInfoLike): Device => ({
  deviceId: info.deviceId,
  groupId: info.groupId,
  kind: info.kind,
  label: info.label,
});

const sameDevices: Equivalence.Equivalence<ReadonlyArray<Device>> = Arr.makeEquivalence(
  Equivalence.Struct({
    deviceId: Equivalence.String,
    groupId: Equivalence.String,
    kind: Equivalence.String,
    label: Equivalence.String,
  }),
);

/** The constraint names the DOM lib knows, which `supportedConstraints` reports on. */
const CONSTRAINT_NAMES: ReadonlyArray<keyof MediaTrackSupportedConstraints> = [
  "aspectRatio",
  "autoGainControl",
  "backgroundBlur",
  "channelCount",
  "deviceId",
  "displaySurface",
  "echoCancellation",
  "facingMode",
  "frameRate",
  "groupId",
  "height",
  "noiseSuppression",
  "sampleRate",
  "sampleSize",
  "width",
];

/** Stops every track of `stream`: what closing a capture's scope does. */
const stopAll = (stream: MediaStreamLike) =>
  Effect.sync(() => Arr.forEach(stream.getTracks(), (track) => track.stop()));

/**
 * Options for {@link MediaDevices}' `record`: the recorder's own options,
 * plus `timeslice` (how often a chunk is delivered; by default one chunk at
 * the end) and `until`, which stops the recording gracefully when it
 * completes, so the last chunk is delivered before the stream ends.
 *
 * @since 0.1.0
 * @category models
 */
export interface RecordOptions extends MediaRecorderOptions {
  readonly timeslice?: Duration.Input;
  readonly until?: Effect.Effect<void>;
}

/**
 * Which parts of the API the agent has.
 *
 * @since 0.1.0
 * @category models
 */
export interface Supported {
  readonly userMedia: boolean;
  readonly displayMedia: boolean;
  readonly recorder: boolean;
}

/**
 * The media-devices service. Provide {@link layer} in a page, or
 * `TestMediaDevices.layer` from `@thomasfosterau/effect-platform-browser/BrowserTesting` in tests.
 *
 * - `supported` — which parts of the API the agent has.
 * - `userMedia` — a camera and/or microphone stream, stopped when the scope
 *   closes.
 * - `displayMedia` — a screen, window or tab capture, stopped likewise.
 * - `devices` — the devices now present.
 * - `deviceChanges` — the devices now present, then again on each change.
 * - `supportedConstraints` — the constraint names the agent understands.
 * - `isTypeSupported` — whether the recorder can produce a MIME type.
 * - `record` — a stream's recording, as the recorder's chunks.
 *
 * @since 0.1.0
 * @category services
 */
export class MediaDevices extends Context.Service<
  MediaDevices,
  {
    readonly supported: Supported;
    readonly userMedia: (
      constraints: MediaStreamConstraints,
    ) => Effect.Effect<MediaStreamLike, MediaDevicesError, Scope.Scope>;
    readonly displayMedia: (
      options?: DisplayMediaStreamOptions,
    ) => Effect.Effect<MediaStreamLike, MediaDevicesError, Scope.Scope>;
    readonly devices: Effect.Effect<ReadonlyArray<Device>, MediaDevicesError>;
    readonly deviceChanges: Stream.Stream<ReadonlyArray<Device>, MediaDevicesError>;
    readonly supportedConstraints: Effect.Effect<ReadonlyArray<string>>;
    readonly isTypeSupported: (mimeType: string) => Effect.Effect<boolean>;
    readonly record: (
      stream: MediaStreamLike,
      options?: RecordOptions,
    ) => Stream.Stream<Blob, MediaRecorderError>;
  }
>()("@thomasfosterau/effect-platform-browser/MediaDevices") {}

/** A capture through `run`, held until the scope closes. */
const capture = (run: () => Promise<MediaStreamLike>) =>
  Effect.acquireRelease(Effect.tryPromise({ try: run, catch: fromRejection }), stopAll);

/** The recorder's event listeners, feeding `queue`. */
const recorderListeners = (queue: Queue.Enqueue<Blob, MediaRecorderError | Cause.Done>) => ({
  dataavailable: (event: unknown): void => {
    if (P.hasProperty(event, "data") && event.data instanceof Blob && event.data.size > 0) {
      Queue.offerUnsafe(queue, event.data);
    }
  },
  error: (event: unknown): void => {
    Queue.failCauseUnsafe(
      queue,
      Cause.fail(recorderError("Failed", P.hasProperty(event, "error") ? event.error : event)),
    );
  },
  stop: (): void => {
    Queue.endUnsafe(queue);
  },
});

const stopIfRecording = (recorder: MediaRecorderLike): void => {
  if (recorder.state !== "inactive") recorder.stop();
};

/** The chunks of a recording, as `dataavailable` delivers them. */
const recording = (
  factory: MediaRecorderFactoryLike,
  stream: MediaStreamLike,
  options?: RecordOptions,
): Stream.Stream<Blob, MediaRecorderError> =>
  Stream.callback<Blob, MediaRecorderError>((queue) =>
    Effect.gen(function* () {
      const { timeslice, until, ...recorderOptions } = options ?? {};
      const listeners = R.toEntries(recorderListeners(queue));
      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const recorder = factory.make(stream, recorderOptions);
            Arr.forEach(listeners, ([type, listener]) => recorder.addEventListener(type, listener));
            recorder.start(timeslice === undefined ? undefined : Duration.toMillis(timeslice));
            return recorder;
          },
          catch: (cause) => recorderError("NotSupported", cause),
        }),
        (recorder) =>
          Effect.sync(() => {
            Arr.forEach(listeners, ([type, listener]) =>
              recorder.removeEventListener(type, listener),
            );
            stopIfRecording(recorder);
          }),
      ).pipe(
        Effect.tap((recorder) =>
          until === undefined
            ? Effect.void
            : Effect.forkScoped(
                Effect.andThen(
                  until,
                  Effect.sync(() => stopIfRecording(recorder)),
                ),
              ),
        ),
      );
    }),
  );

/**
 * Builds the {@link MediaDevices} service over `navigator.mediaDevices` and
 * the `MediaRecorder`; either missing builds that part unsupported.
 * {@link layer} passes the ambient ones.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 *
 * const media = MediaDevices.make()
 * const camera = Effect.scoped(media.userMedia({ video: true }))
 * Effect.runPromise(Effect.flip(camera)).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (
  mediaDevices?: MediaDevicesLike,
  recorder?: MediaRecorderFactoryLike,
): MediaDevices["Service"] => {
  const unsupported = Effect.fail(devicesError("Unsupported", undefined));
  const record =
    recorder === undefined
      ? () => Stream.fail(recorderError("Unsupported", undefined))
      : (stream: MediaStreamLike, options?: RecordOptions) => recording(recorder, stream, options);
  const isTypeSupported = (mimeType: string) =>
    Effect.sync(() => recorder !== undefined && recorder.isTypeSupported(mimeType));
  if (mediaDevices === undefined) {
    return MediaDevices.of({
      supported: { userMedia: false, displayMedia: false, recorder: recorder !== undefined },
      userMedia: () => unsupported,
      displayMedia: () => unsupported,
      devices: unsupported,
      deviceChanges: Stream.fromEffect(unsupported),
      supportedConstraints: Effect.succeed([]),
      isTypeSupported,
      record,
    });
  }
  const devices = Effect.tryPromise({
    try: () => mediaDevices.enumerateDevices(),
    catch: fromRejection,
  }).pipe(Effect.map(Arr.map(toDevice)));
  const getDisplayMedia = Option.fromUndefinedOr(mediaDevices.getDisplayMedia?.bind(mediaDevices));
  return MediaDevices.of({
    supported: {
      userMedia: true,
      displayMedia: Option.isSome(getDisplayMedia),
      recorder: recorder !== undefined,
    },
    userMedia: (constraints) => capture(() => mediaDevices.getUserMedia(constraints)),
    displayMedia: (options) =>
      Option.match(getDisplayMedia, {
        onNone: () => unsupported,
        onSome: (display) => capture(() => display(options)),
      }),
    devices,
    deviceChanges: Stream.callback<void>(
      (queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const onChange = (): void => {
              Queue.offerUnsafe(queue, undefined);
            };
            mediaDevices.addEventListener("devicechange", onChange);
            Queue.offerUnsafe(queue, undefined);
            return onChange;
          }),
          (onChange) =>
            Effect.sync(() => mediaDevices.removeEventListener("devicechange", onChange)),
        ),
      { bufferSize: 1, strategy: "sliding" },
    ).pipe(
      Stream.mapEffect(() => devices),
      Stream.changesWith(sameDevices),
    ),
    supportedConstraints: Effect.sync(() => {
      const supported = mediaDevices.getSupportedConstraints();
      return Arr.filter(CONSTRAINT_NAMES, (name) => supported[name] === true);
    }),
    isTypeSupported,
    record,
  });
};

/**
 * The {@link MediaDevices} service over the ambient `navigator.mediaDevices`
 * and `MediaRecorder`; reports what is missing as unsupported.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.map(MediaDevices.MediaDevices, (media) => media.supported.userMedia)
 * Effect.runPromise(Effect.provide(program, MediaDevices.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<MediaDevices> = Layer.sync(MediaDevices, () =>
  make(Option.getOrUndefined(ambientMediaDevices()), Option.getOrUndefined(ambientMediaRecorder())),
);

/**
 * A camera and/or microphone stream for the life of the scope.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 * import { TestMediaDevices } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.scoped(
 *   Effect.map(MediaDevices.userMedia({ audio: true }), (stream) =>
 *     stream.getTracks().map((track) => track.kind),
 *   ),
 * )
 * Effect.runPromise(Effect.provide(program, TestMediaDevices.layer())).then(console.log) // ["audio"]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const userMedia = (
  constraints: MediaStreamConstraints,
): Effect.Effect<MediaStreamLike, MediaDevicesError, MediaDevices | Scope.Scope> =>
  Effect.flatMap(MediaDevices, (media) => media.userMedia(constraints));

/**
 * A screen, window or tab capture for the life of the scope.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 * import { TestMediaDevices } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.scoped(
 *   Effect.map(MediaDevices.displayMedia({ video: true }), (stream) => stream.getTracks().length),
 * )
 * Effect.runPromise(Effect.provide(program, TestMediaDevices.layer())).then(console.log) // 1
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const displayMedia = (
  options?: DisplayMediaStreamOptions,
): Effect.Effect<MediaStreamLike, MediaDevicesError, MediaDevices | Scope.Scope> =>
  Effect.flatMap(MediaDevices, (media) => media.displayMedia(options));

/**
 * The devices now present.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 * import { TestMediaDevices } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.map(MediaDevices.devices, (devices) => devices.map((device) => device.kind))
 * Effect.runPromise(Effect.provide(program, TestMediaDevices.layer())).then(console.log)
 * // ["audioinput", "videoinput", "audiooutput"]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const devices: Effect.Effect<
  ReadonlyArray<Device>,
  MediaDevicesError,
  MediaDevices
> = Effect.flatMap(MediaDevices, (media) => media.devices);

/**
 * The devices now present, then again each time one is plugged in or
 * removed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 * import { TestMediaDevices } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Stream.runHead(MediaDevices.deviceChanges)
 * Effect.runPromise(Effect.provide(program, TestMediaDevices.layer())).then((first) =>
 *   console.log(first._tag), // "Some"
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const deviceChanges: Stream.Stream<
  ReadonlyArray<Device>,
  MediaDevicesError,
  MediaDevices
> = Stream.unwrap(Effect.map(MediaDevices, (media) => media.deviceChanges));

/**
 * Records `stream` with the agent's `MediaRecorder`, as its chunks. The
 * stream ends when the recorder stops: when every track has ended, or when
 * `until` completes; ending it early stops the recorder without its last
 * chunk.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 * import { TestMediaDevices } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * // Record the microphone until the user presses stop (here, after 10 ms).
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const control = yield* TestMediaDevices.Control
 *     const microphone = yield* MediaDevices.userMedia({ audio: true })
 *     const stopPressed = Effect.andThen(control.deliver("audio"), Effect.sleep("10 millis"))
 *     const chunks = yield* Stream.runCollect(
 *       MediaDevices.record(microphone, { mimeType: "audio/webm", until: stopPressed }),
 *     )
 *     return chunks.map((chunk) => chunk.type)
 *   }),
 * )
 * Effect.runPromise(Effect.provide(program, TestMediaDevices.layer())).then(console.log) // ["audio/webm"]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const record = (
  stream: MediaStreamLike,
  options?: RecordOptions,
): Stream.Stream<Blob, MediaRecorderError, MediaDevices> =>
  Stream.unwrap(Effect.map(MediaDevices, (media) => media.record(stream, options)));

/**
 * Completes when `track` ends from the platform's side: the device was
 * unplugged, permission was revoked, or the user stopped sharing their
 * screen. (Stopping a track yourself does not fire `ended`.)
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 * import { TestMediaDevices } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const control = yield* TestMediaDevices.Control
 *     const screen = yield* MediaDevices.displayMedia()
 *     const [track] = screen.getTracks()
 *     yield* control.endTracks("video")
 *     yield* MediaDevices.trackEnded(track)
 *     return "sharing stopped"
 *   }),
 * )
 * Effect.runPromise(Effect.provide(program, TestMediaDevices.layer())).then(console.log) // "sharing stopped"
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const trackEnded = (track: MediaStreamTrackLike): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const onEnded = (): void => {
      resume(Effect.void);
    };
    track.addEventListener("ended", onEnded, { once: true });
    if (track.readyState === "ended") resume(Effect.void);
    return Effect.sync(() => track.removeEventListener("ended", onEnded));
  });

/**
 * Shows `stream` in a `<video>` or `<audio>` element for the life of the
 * scope, clearing it when the scope closes.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 * import { TestMediaDevices } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const video: { srcObject: unknown } = { srcObject: null }
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const camera = yield* MediaDevices.userMedia({ video: true })
 *     yield* MediaDevices.attach(video, camera)
 *     return video.srcObject === camera
 *   }),
 * )
 * Effect.runPromise(Effect.provide(program, TestMediaDevices.layer())).then(console.log) // true
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const attach = (
  element: { srcObject: unknown },
  stream: MediaStreamLike,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      element.srcObject = stream;
    }),
    () =>
      Effect.sync(() => {
        if (element.srcObject === stream) element.srcObject = null;
      }),
  );
