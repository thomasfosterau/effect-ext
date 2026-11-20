/**
 * Controllable cameras, microphones and a `MediaRecorder` for tests of
 * code that uses `MediaDevices`: {@link layer} provides the real adapter
 * over an in-memory `navigator.mediaDevices`, plus {@link Control} to plug
 * devices in, refuse or fail a capture, end tracks as the platform does,
 * and feed the recorder.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  type Device,
  make as makeMediaDevices,
  MediaDevices,
  type MediaDevicesLike,
  type MediaRecorderFactoryLike,
  type MediaStreamLike,
} from "../MediaDevices.ts";

/**
 * The in-memory platform's starting state. Each part is supported unless
 * set `false`: `mediaDevices` (all of `navigator.mediaDevices`),
 * `displayMedia` (just `getDisplayMedia`, missing on mobile) and
 * `recorder`. `devices` defaults to a microphone, a camera and a speaker;
 * `mimeTypes`, what the recorder can produce, to `audio/webm` and
 * `video/webm`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly mediaDevices?: boolean;
  readonly displayMedia?: boolean;
  readonly recorder?: boolean;
  readonly devices?: ReadonlyArray<Device>;
  readonly mimeTypes?: ReadonlyArray<string>;
}

/**
 * One capture the code under test asked for.
 *
 * @since 0.1.0
 * @category models
 */
export interface Request {
  readonly method: "getUserMedia" | "getDisplayMedia";
  readonly constraints: Option.Option<MediaStreamConstraints | DisplayMediaStreamOptions>;
}

/**
 * Drives the in-memory platform.
 *
 * - `setDevices` — replaces the devices present and fires `devicechange`.
 * - `failNext` — the next capture rejects with this `DOMException` name
 *   (and, for `OverconstrainedError`, `constraint`).
 * - `live` — how many captured tracks are still live.
 * - `endTracks` — ends every live track (of a kind), firing `ended`: an
 *   unplugged device, or the user stopping a screen share. A recorder
 *   whose tracks have all ended stops, as the platform's does.
 * - `deliver` — media for the recorders: a recorder with a `timeslice`
 *   delivers it as a chunk at once, one without delivers it on stop.
 * - `failRecording` — every recorder fires `error`.
 * - `recording` — how many recorders are recording.
 * - `requests` — every capture asked for.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly setDevices: (devices: ReadonlyArray<Device>) => Effect.Effect<void>;
    readonly failNext: (name: string, constraint?: string) => Effect.Effect<void>;
    readonly live: Effect.Effect<number>;
    readonly endTracks: (kind?: "audio" | "video") => Effect.Effect<void>;
    readonly deliver: (data: string | Uint8Array<ArrayBuffer>) => Effect.Effect<void>;
    readonly failRecording: Effect.Effect<void>;
    readonly recording: Effect.Effect<number>;
    readonly requests: Effect.Effect<ReadonlyArray<Request>>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/MediaDevicesControl") {}

/**
 * What {@link make} builds: the `MediaDevices` service over the in-memory
 * platform, and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly mediaDevices: MediaDevices["Service"];
  readonly control: Control["Service"];
}

/** An in-memory track: `stop` ends it silently, `end` as the platform does. */
class FakeTrack extends EventTarget {
  readonly id: string;
  readonly kind: "audio" | "video";
  readonly label: string;
  readyState: "live" | "ended" = "live";
  constructor(id: string, kind: "audio" | "video", label: string) {
    super();
    this.id = id;
    this.kind = kind;
    this.label = label;
  }
  stop(): void {
    this.readyState = "ended";
  }
  end(): void {
    if (this.readyState === "ended") return;
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

class FakeStream implements MediaStreamLike {
  readonly id: string;
  readonly tracks: ReadonlyArray<FakeTrack>;
  constructor(id: string, tracks: ReadonlyArray<FakeTrack>) {
    this.id = id;
    this.tracks = tracks;
  }
  getTracks(): ReadonlyArray<FakeTrack> {
    return this.tracks;
  }
}

/** An in-memory recorder: buffers delivered media, flushes it as a chunk. */
class FakeRecorder extends EventTarget {
  state: "inactive" | "recording" | "paused" = "inactive";
  readonly mimeType: string;
  readonly stream: FakeStream;
  #timeslice: Option.Option<number> = Option.none();
  #buffered: Array<string | Uint8Array<ArrayBuffer>> = [];
  readonly #recorders: Array<FakeRecorder>;
  constructor(stream: FakeStream, mimeType: string, recorders: Array<FakeRecorder>) {
    super();
    this.stream = stream;
    this.mimeType = mimeType;
    this.#recorders = recorders;
  }
  start(timeslice?: number): void {
    if (Arr.every(this.stream.tracks, (track) => track.readyState === "ended")) {
      throw new DOMException("the stream is inactive", "NotSupportedError");
    }
    this.state = "recording";
    this.#timeslice = Option.fromUndefinedOr(timeslice);
    this.#recorders.push(this);
  }
  stop(): void {
    this.state = "inactive";
    this.#recorders.splice(this.#recorders.indexOf(this), 1);
    this.#flush();
    this.dispatchEvent(new Event("stop"));
  }
  deliver(data: string | Uint8Array<ArrayBuffer>): void {
    this.#buffered.push(data);
    if (Option.isSome(this.#timeslice)) this.#flush();
  }
  fail(): void {
    this.dispatchEvent(
      Object.assign(new Event("error"), { error: new DOMException("Recording failed") }),
    );
  }
  #flush(): void {
    const data = new Blob(this.#buffered, { type: this.mimeType });
    this.#buffered = [];
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data }));
  }
}

const DEFAULT_DEVICES: ReadonlyArray<Device> = [
  { deviceId: "microphone", groupId: "built-in", kind: "audioinput", label: "Microphone" },
  { deviceId: "camera", groupId: "built-in", kind: "videoinput", label: "Camera" },
  { deviceId: "speaker", groupId: "built-in", kind: "audiooutput", label: "Speaker" },
];

const SUPPORTED_CONSTRAINTS: MediaTrackSupportedConstraints = {
  deviceId: true,
  facingMode: true,
  height: true,
  width: true,
  echoCancellation: true,
  sampleRate: false,
};

/**
 * Builds the in-memory platform: the `MediaDevices` service over it, and
 * its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestMediaDevices } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { mediaDevices, control } = TestMediaDevices.make()
 * const program = Effect.gen(function* () {
 *   yield* control.failNext("NotAllowedError")
 *   const error = yield* Effect.flip(Effect.scoped(mediaDevices.userMedia({ video: true })))
 *   return error.reason
 * })
 * Effect.runPromise(program).then(console.log) // "NotAllowed"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const state = {
    devices: options?.devices ?? DEFAULT_DEVICES,
    failure: Option.none<DOMException>(),
    count: 0,
  };
  const mimeTypes = options?.mimeTypes ?? ["audio/webm", "video/webm"];
  const tracks: Array<FakeTrack> = [];
  const recorders: Array<FakeRecorder> = [];
  const requests: Array<Request> = [];
  const events = new EventTarget();

  /** Rejects with a queued failure, if there is one, or else builds the stream. */
  const capture = (kinds: ReadonlyArray<"audio" | "video">, source: string) => {
    const failure = state.failure;
    state.failure = Option.none();
    if (Option.isSome(failure)) return Promise.reject(failure.value);
    const created = Arr.map(kinds, (kind) => {
      state.count += 1;
      return new FakeTrack(`track-${state.count}`, kind, `${source} ${kind}`);
    });
    tracks.push(...created);
    return Promise.resolve(new FakeStream(`stream-${state.count}`, created));
  };

  const hasInput = (kind: Device["kind"]) => Arr.some(state.devices, (d) => d.kind === kind);

  const platform: MediaDevicesLike = {
    addEventListener: (type, listener) => events.addEventListener(type, listener),
    removeEventListener: (type, listener) => events.removeEventListener(type, listener),
    getUserMedia: (constraints) => {
      requests.push({ method: "getUserMedia", constraints: Option.fromUndefinedOr(constraints) });
      const kinds = Arr.filter(["audio", "video"] as const, (kind) => Boolean(constraints?.[kind]));
      const missing = Arr.some(
        kinds,
        (kind) => !hasInput(kind === "audio" ? "audioinput" : "videoinput"),
      );
      return Option.isNone(state.failure) && missing
        ? Promise.reject(new DOMException("Requested device not found", "NotFoundError"))
        : capture(kinds, "Device");
    },
    enumerateDevices: () => Promise.resolve(state.devices),
    getSupportedConstraints: () => SUPPORTED_CONSTRAINTS,
  };

  if (options?.displayMedia !== false) {
    platform.getDisplayMedia = (display) => {
      requests.push({ method: "getDisplayMedia", constraints: Option.fromUndefinedOr(display) });
      return capture(display?.audio === true ? ["video", "audio"] : ["video"], "Screen");
    };
  }

  const recorder: MediaRecorderFactoryLike = {
    make: (stream, recorderOptions) => {
      const mimeType = recorderOptions.mimeType ?? "video/webm";
      if (!mimeTypes.includes(mimeType) || !(stream instanceof FakeStream)) {
        throw new DOMException(`cannot record ${mimeType}`, "NotSupportedError");
      }
      return new FakeRecorder(stream, mimeType, recorders);
    },
    isTypeSupported: (mimeType) => mimeTypes.includes(mimeType),
  };

  return {
    mediaDevices: makeMediaDevices(
      options?.mediaDevices === false ? undefined : platform,
      options?.recorder === false ? undefined : recorder,
    ),
    control: Control.of({
      setDevices: (devices) =>
        Effect.sync(() => {
          state.devices = devices;
          events.dispatchEvent(new Event("devicechange"));
        }),
      failNext: (name, constraint) =>
        Effect.sync(() => {
          state.failure = Option.some(
            Object.assign(new DOMException(`capture failed: ${name}`, name), {
              constraint: constraint ?? "",
            }),
          );
        }),
      live: Effect.sync(() => Arr.filter(tracks, (track) => track.readyState === "live").length),
      endTracks: (kind) =>
        Effect.sync(() => {
          Arr.forEach(tracks, (track) => {
            if (kind === undefined || track.kind === kind) track.end();
          });
          Arr.forEach([...recorders], (active) => {
            if (Arr.every(active.stream.tracks, (track) => track.readyState === "ended")) {
              active.stop();
            }
          });
        }),
      deliver: (data) =>
        Effect.sync(() => Arr.forEach(recorders, (active) => active.deliver(data))),
      failRecording: Effect.sync(() => Arr.forEach([...recorders], (active) => active.fail())),
      recording: Effect.sync(() => recorders.length),
      requests: Effect.sync(() => [...requests]),
    }),
  };
};

/**
 * Provides `MediaDevices` over a fresh in-memory platform, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaDevices } from "@thomasfosterau/effect-platform-browser"
 * import { TestMediaDevices } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestMediaDevices.Control
 *   yield* Effect.scoped(MediaDevices.userMedia({ video: true }))
 *   return yield* control.live
 * })
 * Effect.runPromise(Effect.provide(program, TestMediaDevices.layer())).then(console.log) // 0
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<MediaDevices | Control> =>
  Layer.syncContext(() => {
    const { mediaDevices, control } = make(options);
    return Context.make(MediaDevices, mediaDevices).pipe(Context.add(Control, control));
  });
