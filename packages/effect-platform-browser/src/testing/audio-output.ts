/**
 * A controllable audio output for tests of code that uses `AudioOutput`:
 * {@link layer} provides the real adapter over an in-memory audio element
 * that plays each clip to the end at once, plus {@link Control} to hold or
 * fail playback and read what was played.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as MutableHashSet from "effect/MutableHashSet";
import * as Option from "effect/Option";
import { AudioOutput, type AudioElementLike, make as makeAudioOutput } from "../AudioOutput.ts";

/**
 * The in-memory output's starting state. `supported: false` builds the
 * unsupported service; `hold` keeps each clip playing until `finish`.
 *
 * @since 0.2.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
  readonly hold?: boolean;
}

/**
 * One clip the code under test handed to the output, whether or not it
 * then played.
 *
 * @since 0.2.0
 * @category models
 */
export interface Played {
  readonly mediaType: string;
  readonly byteLength: number;
}

/**
 * Drives the in-memory output.
 *
 * - `refuseNext` — the next `play()` rejects with a `DOMException` of this
 *   name (`"NotAllowedError"`, `"NotSupportedError"`, …).
 * - `failCurrent` — the clip playing now fires `error`, as a decode
 *   failure does.
 * - `finish` — the clip playing now plays to the end (with `hold`).
 * - `playing` — whether a clip is playing now.
 * - `played` — every clip handed to the output, in order.
 * - `openUrls` — how many blob URLs are still unrevoked.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly refuseNext: (name: string) => Effect.Effect<void>;
    readonly failCurrent: Effect.Effect<void>;
    readonly finish: Effect.Effect<void>;
    readonly playing: Effect.Effect<boolean>;
    readonly played: Effect.Effect<ReadonlyArray<Played>>;
    readonly openUrls: Effect.Effect<number>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/AudioOutputControl") {}

/**
 * What {@link make} builds: the `AudioOutput` service over the in-memory
 * output, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly audioOutput: AudioOutput["Service"];
  readonly control: Control["Service"];
}

/** The output's unrevoked object URLs, and the one audio device. */
class FakeSpeakers {
  readonly urls = MutableHashSet.empty<string>();
  readonly played: Array<Played> = [];
  refusal = Option.none<string>();
  current = Option.none<FakeAudio>();
  next = 0;
  readonly hold: boolean;
  constructor(hold: boolean) {
    this.hold = hold;
  }
  /** Ends the clip playing now, if any. */
  end(type: "ended" | "error"): void {
    Option.map(this.current, (audio) => audio.end(type));
  }
}

class FakeAudio extends EventTarget implements AudioElementLike {
  src = "";
  readonly #speakers: FakeSpeakers;
  constructor(speakers: FakeSpeakers) {
    super();
    this.#speakers = speakers;
  }
  play(): Promise<void> {
    const speakers = this.#speakers;
    const refusal = speakers.refusal;
    speakers.refusal = Option.none();
    if (Option.isSome(refusal)) {
      return Promise.reject(new DOMException("refused", refusal.value));
    }
    speakers.current = Option.some(this);
    if (!speakers.hold) queueMicrotask(() => speakers.end("ended"));
    return Promise.resolve();
  }
  pause(): void {
    this.#release();
  }
  /** Plays to the end, or fails: only ever called on the clip playing now. */
  end(type: "ended" | "error"): void {
    this.#speakers.current = Option.none();
    this.dispatchEvent(new Event(type));
  }
  #release(): void {
    if (Option.contains(this.#speakers.current, this)) this.#speakers.current = Option.none();
  }
}

/**
 * Builds the `AudioOutput` service over a fresh in-memory output, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestAudioOutput } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { audioOutput, control } = TestAudioOutput.make()
 * const program = Effect.gen(function* () {
 *   yield* control.refuseNext("NotAllowedError")
 *   return yield* Effect.flip(audioOutput.play(new Uint8Array([1]), "audio/mpeg"))
 * })
 * Effect.runPromise(program).then((error) => console.log(error.reason)) // "NotAllowed"
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const speakers = new FakeSpeakers(options?.hold === true);
  return {
    audioOutput: makeAudioOutput(
      options?.supported === false
        ? undefined
        : {
            element: () => new FakeAudio(speakers),
            createObjectURL: (blob) => {
              const url = `blob:test/${speakers.next++}`;
              MutableHashSet.add(speakers.urls, url);
              speakers.played.push({ mediaType: blob.type, byteLength: blob.size });
              return url;
            },
            revokeObjectURL: (url) => {
              MutableHashSet.remove(speakers.urls, url);
            },
          },
    ),
    control: Control.of({
      refuseNext: (name) =>
        Effect.sync(() => {
          speakers.refusal = Option.some(name);
        }),
      failCurrent: Effect.sync(() => speakers.end("error")),
      finish: Effect.sync(() => speakers.end("ended")),
      playing: Effect.sync(() => Option.isSome(speakers.current)),
      played: Effect.sync(() => [...speakers.played]),
      openUrls: Effect.sync(() => MutableHashSet.size(speakers.urls)),
    }),
  };
};

/**
 * {@link make}, as a layer providing both the `AudioOutput` service and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { AudioOutput } from "@thomasfosterau/effect-platform-browser"
 * import { TestAudioOutput } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* AudioOutput.play(new Uint8Array([1, 2]), "audio/wav")
 *   const control = yield* TestAudioOutput.Control
 *   return yield* control.openUrls
 * })
 * Effect.runPromise(Effect.provide(program, TestAudioOutput.layer())).then(console.log) // 0
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<AudioOutput | Control> =>
  Layer.syncContext(() => {
    const { audioOutput, control } = make(options);
    return Context.make(AudioOutput, audioOutput).pipe(Context.add(Control, control));
  });
