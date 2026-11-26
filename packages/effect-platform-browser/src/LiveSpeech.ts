/**
 * effect-ext's `Speaker` and `Dictation` over this package's services: the
 * browser's own voices (`SpeechSynthesis`), any `SpeechModel` played through
 * {@link AudioOutput}, and the browser's own recogniser
 * (`SpeechRecognition`).
 *
 * Each layer maps its service's failures onto `AiError` reasons, so a program
 * written against `Speaker` or `Dictation` handles one error type whichever
 * layer it is given.
 *
 * @since 0.2.0
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import { AiError } from "effect/ai";
import * as Dictation from "@thomasfosterau/effect-ext/Dictation";
import * as Speaker from "@thomasfosterau/effect-ext/Speaker";
import * as SpeechModel from "@thomasfosterau/effect-ext/SpeechModel";
import { AudioOutput, type AudioOutputError } from "./AudioOutput.ts";
import {
  type ListenOptions,
  SpeechRecognition,
  type SpeechRecognitionError,
} from "./SpeechRecognition.ts";
import {
  SpeechSynthesis,
  type SpeechSynthesisError,
  type UtteranceOptions,
} from "./SpeechSynthesis.ts";

type BrowserSpeechError = SpeechSynthesisError | SpeechRecognitionError | AudioOutputError;

type ReasonKind = "permission" | "request" | "provider" | "unknown";

/** Each browser failure reason's `AiError` reason kind. */
const KINDS = {
  NotAllowed: "permission",
  VoiceUnavailable: "request",
  LanguageUnavailable: "request",
  LanguageNotSupported: "request",
  TextTooLong: "request",
  NotSupported: "request",
  Unsupported: "provider",
  AudioBusy: "provider",
  AudioCapture: "provider",
  Network: "provider",
  Interrupted: "unknown",
  Aborted: "unknown",
  Failed: "unknown",
} as const satisfies Record<BrowserSpeechError["reason"], ReasonKind>;

/** Builds each kind's `AiError` reason around the browser's message. */
const REASONS: Record<ReasonKind, (description: string) => AiError.AiErrorReason> = {
  permission: (description) =>
    new AiError.AuthenticationError({ kind: "InsufficientPermissions", description }),
  request: (description) => new AiError.InvalidRequestError({ description }),
  provider: (description) => new AiError.InternalProviderError({ description }),
  unknown: (description) => new AiError.UnknownError({ description }),
};

/** The utterance options for a `Speaker` call, with only the members it was given. */
const utteranceOptions = (voice?: string, language?: string): UtteranceOptions => {
  const options: Types.Mutable<UtteranceOptions> = {};
  if (voice !== undefined) options.voice = voice;
  if (language !== undefined) options.lang = language;
  return options;
};

/** The recognition options for a `Dictation` session: continuous, plus what it was given. */
const recognitionOptions = ({
  language,
  interimResults,
}: Dictation.ProviderOptions): ListenOptions => {
  const options: Types.Mutable<ListenOptions> = { continuous: true };
  if (language !== undefined) options.lang = language;
  if (interimResults !== undefined) options.interimResults = interimResults;
  return options;
};

const toAiError =
  (module: string, method: string) =>
  (error: BrowserSpeechError): AiError.AiError =>
    AiError.make({ module, method, reason: REASONS[KINDS[error.reason]](error.message) });

/**
 * A `Speaker` over the browser's own voices. `voice` picks a voice by its
 * `voiceURI` or `name`; `language` sets the utterance's language.
 *
 * Failures become `AiError` reasons: `NotAllowed` an `AuthenticationError`
 * (`InsufficientPermissions`); a missing voice or language, or text too long,
 * an `InvalidRequestError`; no engine, busy audio or a network failure an
 * `InternalProviderError`; anything else an `UnknownError`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import { Speaker } from "@thomasfosterau/effect-ext"
 * import { LiveSpeech } from "@thomasfosterau/effect-platform-browser"
 * import { TestSpeechSynthesis } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* Speaker.say({ text: "Your order is ready", language: "en-AU" })
 *   const control = yield* TestSpeechSynthesis.Control
 *   return yield* control.spoken
 * })
 * const layer = LiveSpeech.speakerFromSynthesis.pipe(Layer.provideMerge(TestSpeechSynthesis.layer()))
 * Effect.runPromise(Effect.provide(program, layer)).then((spoken) =>
 *   console.log(spoken.map((utterance) => utterance.lang)), // ["en-AU"]
 * )
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const speakerFromSynthesis: Layer.Layer<Speaker.Speaker, never, SpeechSynthesis> =
  Layer.effect(
    Speaker.Speaker,
    Effect.gen(function* () {
      const synthesis = yield* SpeechSynthesis;
      return yield* Speaker.make({
        say: ({ text, voice, language }) =>
          synthesis
            .speak(text, utteranceOptions(voice, language))
            .pipe(Effect.mapError(toAiError("LiveSpeech", "speakerFromSynthesis"))),
      });
    }),
  );

/**
 * A `Speaker` that synthesises with a `SpeechModel` and plays the audio
 * through {@link AudioOutput}. `voice` passes to the model; `language` is
 * not a `SpeechModel` option and is not sent.
 *
 * The model's own `AiError`s pass through. Playback failures become `AiError`
 * reasons: `NotAllowed` an `AuthenticationError` (`InsufficientPermissions`),
 * a media type the agent cannot play an `InvalidRequestError`, no audio
 * output an `InternalProviderError`, anything else an `UnknownError`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import * as Option from "effect/Option"
 * import * as Stream from "effect/Stream"
 * import { Speaker, SpeechModel } from "@thomasfosterau/effect-ext"
 * import { LiveSpeech } from "@thomasfosterau/effect-platform-browser"
 * import { TestAudioOutput } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const model = Layer.effect(
 *   SpeechModel.SpeechModel,
 *   SpeechModel.make({
 *     generate: () =>
 *       Effect.succeed({
 *         audio: new Uint8Array([1, 2, 3]),
 *         mediaType: "audio/mpeg",
 *         usage: { inputCharacters: Option.none() },
 *       }),
 *     stream: () => Stream.empty,
 *   }),
 * )
 * const program = Effect.gen(function* () {
 *   yield* Speaker.say({ text: "Hello" })
 *   const control = yield* TestAudioOutput.Control
 *   return yield* control.played
 * })
 * const layer = LiveSpeech.speakerFromModel.pipe(
 *   Layer.provideMerge(Layer.merge(model, TestAudioOutput.layer())),
 * )
 * Effect.runPromise(Effect.provide(program, layer)).then((played) =>
 *   console.log(played.map((clip) => clip.byteLength)), // [3]
 * )
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const speakerFromModel: Layer.Layer<
  Speaker.Speaker,
  never,
  SpeechModel.SpeechModel | AudioOutput
> = Layer.effect(
  Speaker.Speaker,
  Effect.gen(function* () {
    const model = yield* SpeechModel.SpeechModel;
    const output = yield* AudioOutput;
    return yield* Speaker.make({
      say: ({ text, voice }) =>
        model
          .generate(voice === undefined ? { text } : { text, voice })
          .pipe(
            Effect.flatMap((response) =>
              output
                .play(response.audio, response.mediaType)
                .pipe(Effect.mapError(toAiError("LiveSpeech", "speakerFromModel"))),
            ),
          ),
    });
  }),
);

/**
 * A `Dictation` over the browser's own recogniser. It listens continuously
 * until the stream ends, in `language` where given, and reports interim
 * readings when `interimResults` is set.
 *
 * Failures become `AiError` reasons: `NotAllowed` an `AuthenticationError`
 * (`InsufficientPermissions`), an unsupported language an
 * `InvalidRequestError`; no recogniser, no microphone or a network failure
 * an `InternalProviderError`; anything else an `UnknownError`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import * as Stream from "effect/Stream"
 * import { Dictation } from "@thomasfosterau/effect-ext"
 * import { LiveSpeech } from "@thomasfosterau/effect-platform-browser"
 * import { TestSpeechRecognition } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestSpeechRecognition.Control
 *   yield* control.say(["turn on", "turn on the lights"])
 *   return yield* Stream.runCollect(Dictation.listen())
 * })
 * const layer = LiveSpeech.dictationFromRecognition.pipe(
 *   Layer.provideMerge(TestSpeechRecognition.layer()),
 * )
 * Effect.runPromise(Effect.provide(program, layer)).then((heard) =>
 *   console.log(heard.map((reading) => reading.text)), // ["turn on the lights"]
 * )
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const dictationFromRecognition: Layer.Layer<Dictation.Dictation, never, SpeechRecognition> =
  Layer.effect(
    Dictation.Dictation,
    Effect.gen(function* () {
      const recognition = yield* SpeechRecognition;
      return yield* Dictation.make({
        listen: (options) =>
          recognition.listen(recognitionOptions(options)).pipe(
            Stream.map((result) => ({
              index: result.index,
              text: result.transcript,
              isFinal: result.isFinal,
            })),
            Stream.mapError(toAiError("LiveSpeech", "dictationFromRecognition")),
          ),
      });
    }),
  );
