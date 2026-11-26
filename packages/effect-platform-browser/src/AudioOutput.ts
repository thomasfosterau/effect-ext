/**
 * Plays audio bytes on the page's speakers through an `<audio>` element, as
 * an Effect service: the sink a `SpeechModel`'s audio plays into.
 *
 * `play` succeeds once the audio has played to the end. Interrupting it
 * pauses playback, and its blob URL is revoked either way.
 *
 * @since 0.2.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";
import { reasonOf } from "./internal/dom.ts";
import { ambientAudioOutput } from "./internal/globals.ts";

/**
 * The structural slice of an `HTMLAudioElement` this module sets, calls and
 * listens to.
 *
 * @since 0.2.0
 * @category models
 */
export interface AudioElementLike extends Stream.EventListener {
  src: string;
  play(): PromiseLike<void>;
  pause(): void;
}

/**
 * What playing needs from the platform: a fresh audio element (`new
 * Audio()` as a function), and `URL.createObjectURL` /
 * `URL.revokeObjectURL`.
 *
 * @since 0.2.0
 * @category models
 */
export interface AudioOutputLike {
  readonly element: () => AudioElementLike;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
}

/**
 * Why audio did not play to the end.
 *
 * - `Unsupported` — the context has no `Audio` (a worker, a server render).
 * - `NotAllowed` — the agent refused to play, usually for want of a user
 *   gesture.
 * - `NotSupported` — the agent cannot play this media type.
 * - `Failed` — anything else, a decode error included; `cause` carries it.
 *
 * @since 0.2.0
 * @category errors
 */
export type AudioOutputErrorReason = "Unsupported" | "NotAllowed" | "NotSupported" | "Failed";

/**
 * Audio that did not play to the end.
 *
 * @example
 * ```ts
 * import { AudioOutput } from "@thomasfosterau/effect-platform-browser"
 *
 * const error = new AudioOutput.AudioOutputError({
 *   reason: "NotAllowed",
 *   message: "audio output: NotAllowed",
 *   cause: undefined,
 * })
 * console.log(error.reason) // "NotAllowed"
 * ```
 *
 * @since 0.2.0
 * @category errors
 */
export class AudioOutputError extends Schema.TaggedError<
  AudioOutputError,
  { readonly brand: unique symbol }
>()("AudioOutputError", {
  reason: Schema.Literals(["Unsupported", "NotAllowed", "NotSupported", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const outputError = (reason: AudioOutputErrorReason, cause: unknown) =>
  new AudioOutputError({ reason, cause, message: `audio output: ${reason}` });

/** `play()` rejections by `DOMException` name; the rest are `Failed`. */
const REJECTION_REASONS = {
  NotAllowedError: "NotAllowed",
  NotSupportedError: "NotSupported",
} as const satisfies Partial<Record<string, AudioOutputErrorReason>>;

/**
 * The audio-output service. Provide {@link layer} in a page, or
 * `TestAudioOutput.layer` from `@thomasfosterau/effect-platform-browser/BrowserTesting` in tests.
 *
 * - `supported` — whether the context can play audio.
 * - `play` — plays `audio` (of IANA media type `mediaType`) to the end;
 *   interrupting it stops playback.
 *
 * @since 0.2.0
 * @category services
 */
export class AudioOutput extends Context.Service<
  AudioOutput,
  {
    readonly supported: boolean;
    readonly play: (audio: Uint8Array, mediaType: string) => Effect.Effect<void, AudioOutputError>;
  }
>()("@thomasfosterau/effect-platform-browser/AudioOutput") {}

/**
 * Builds the {@link AudioOutput} service over the platform's audio element
 * and object URLs; `undefined` builds the unsupported service. {@link layer}
 * passes the ambient ones.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { AudioOutput } from "@thomasfosterau/effect-platform-browser"
 *
 * const output = AudioOutput.make()
 * Effect.runPromise(Effect.flip(output.play(new Uint8Array([1]), "audio/mpeg"))).then((error) =>
 *   console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (platform?: AudioOutputLike): AudioOutput["Service"] => {
  if (platform === undefined) {
    const unsupported = outputError("Unsupported", undefined);
    return AudioOutput.of({ supported: false, play: () => Effect.fail(unsupported) });
  }
  const play = (audio: Uint8Array, mediaType: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const url = yield* Effect.acquireRelease(
          Effect.sync(() =>
            platform.createObjectURL(new Blob([new Uint8Array(audio)], { type: mediaType })),
          ),
          (created) => Effect.sync(() => platform.revokeObjectURL(created)),
        );
        const element = platform.element();
        const state = { ended: false };
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (!state.ended) element.pause();
          }),
        );
        const finished = Effect.callback<void, AudioOutputError>((resume) => {
          const listeners: ReadonlyArray<readonly [string, (event: unknown) => void]> = [
            [
              "ended",
              () => {
                state.ended = true;
                resume(Effect.void);
              },
            ],
            [
              "error",
              (event) => {
                state.ended = true;
                resume(Effect.fail(outputError("Failed", event)));
              },
            ],
          ];
          Arr.forEach(listeners, ([type, f]) => element.addEventListener(type, f));
          return Effect.sync(() =>
            Arr.forEach(listeners, ([type, f]) => element.removeEventListener(type, f)),
          );
        });
        element.src = url;
        const started = Effect.tryPromise({
          try: () => Promise.resolve(element.play()),
          catch: (cause) => outputError(reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
        });
        // Listen before starting, so an `ended` that fires at once is heard.
        yield* Effect.raceFirst(finished, Effect.andThen(started, Effect.never));
      }),
    );
  return AudioOutput.of({ supported: true, play });
};

/**
 * The {@link AudioOutput} service over the ambient `Audio` and `URL`;
 * reports `supported: false` where there is no `Audio`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { AudioOutput } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.map(AudioOutput.AudioOutput, (output) => output.supported)
 * Effect.runPromise(Effect.provide(program, AudioOutput.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<AudioOutput> = Layer.sync(AudioOutput, () =>
  make(Option.getOrUndefined(ambientAudioOutput())),
);

/**
 * Plays `audio` to the end.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { AudioOutput } from "@thomasfosterau/effect-platform-browser"
 * import { TestAudioOutput } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* AudioOutput.play(new Uint8Array([1, 2, 3]), "audio/mpeg")
 *   const control = yield* TestAudioOutput.Control
 *   return yield* control.played
 * })
 * Effect.runPromise(Effect.provide(program, TestAudioOutput.layer())).then((played) =>
 *   console.log(played.map((clip) => clip.mediaType)), // ["audio/mpeg"]
 * )
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const play = (
  audio: Uint8Array,
  mediaType: string,
): Effect.Effect<void, AudioOutputError, AudioOutput> =>
  Effect.flatMap(AudioOutput, (output) => output.play(audio, mediaType));
