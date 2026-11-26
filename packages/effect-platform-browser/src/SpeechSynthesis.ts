/**
 * Text to speech through the browser's own voices (`speechSynthesis`), as
 * an Effect service.
 *
 * The platform keeps one utterance queue per page. `speak` takes a turn on
 * it: concurrent calls play one after another, and interrupting one cancels
 * only its own utterance. Interrupting a fiber that is speaking stops the
 * voice mid-word.
 *
 * This plays audio; it does not return it. effect-ext's `SpeechModel`
 * returns audio bytes, which the platform does not expose, so the two are
 * not interchangeable.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equivalence from "effect/Equivalence";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { watch } from "./internal/dom.ts";
import { ambientSpeechSynthesis } from "./internal/globals.ts";

/**
 * The structural slice of a `SpeechSynthesisVoice` this module reads.
 *
 * @since 0.1.0
 * @category models
 */
export interface VoiceLike {
  readonly voiceURI: string;
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly default: boolean;
}

/**
 * The structural slice of a `SpeechSynthesisUtterance` this module sets
 * and listens to.
 *
 * @since 0.1.0
 * @category models
 */
export interface UtteranceLike extends Stream.EventListener {
  lang: string;
  pitch: number;
  rate: number;
  volume: number;
  voice: VoiceLike | null;
}

/**
 * The structural slice of `speechSynthesis` this module calls, and the
 * `SpeechSynthesisUtterance` constructor as a function.
 *
 * @since 0.1.0
 * @category models
 */
export interface SpeechSynthesisLike extends Stream.EventListener {
  getVoices(): ReadonlyArray<VoiceLike>;
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
}

/**
 * A voice the agent can speak with. `voiceURI` identifies it; `localService`
 * is `false` for a voice that sends the text to a remote service.
 *
 * @since 0.1.0
 * @category models
 */
export interface Voice {
  readonly voiceURI: string;
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly default: boolean;
}

/**
 * How to speak: a BCP 47 `lang`, a `voice` (its `voiceURI` or `name`),
 * `pitch` (0 to 2), `rate` (0.1 to 10) and `volume` (0 to 1), each at the
 * platform's default when omitted.
 *
 * @since 0.1.0
 * @category models
 */
export interface UtteranceOptions {
  readonly lang?: string;
  readonly voice?: string;
  readonly pitch?: number;
  readonly rate?: number;
  readonly volume?: number;
}

/**
 * A word or sentence boundary reached while speaking: `charIndex` and
 * `charLength` locate it in the text (UTF-16 units, as the platform counts),
 * `elapsedTime` is milliseconds since the utterance started.
 *
 * @since 0.1.0
 * @category models
 */
export interface Boundary {
  readonly name: "word" | "sentence";
  readonly charIndex: number;
  readonly charLength: number;
  readonly elapsedTime: number;
}

/**
 * Why an utterance was not spoken to the end.
 *
 * - `Unsupported` — the agent has no `speechSynthesis`.
 * - `NotAllowed` — refused, usually for want of a user gesture.
 * - `VoiceUnavailable` — the voice asked for is not installed.
 * - `LanguageUnavailable` — no voice speaks the language.
 * - `TextTooLong` — the text is longer than the engine accepts.
 * - `AudioBusy` — the audio output is in use or missing.
 * - `Network` — a remote voice could not be reached.
 * - `Interrupted` — another caller cancelled the whole queue.
 * - `Failed` — anything else; `cause` carries the event.
 *
 * @since 0.1.0
 * @category errors
 */
export type SpeechSynthesisErrorReason =
  | "Unsupported"
  | "NotAllowed"
  | "VoiceUnavailable"
  | "LanguageUnavailable"
  | "TextTooLong"
  | "AudioBusy"
  | "Network"
  | "Interrupted"
  | "Failed";

/**
 * An utterance that was not spoken to the end.
 *
 * @example
 * ```ts
 * import { SpeechSynthesis } from "@thomasfosterau/effect-platform-browser"
 *
 * const error = new SpeechSynthesis.SpeechSynthesisError({
 *   reason: "VoiceUnavailable",
 *   message: "speech synthesis: VoiceUnavailable",
 *   cause: undefined,
 * })
 * console.log(error.reason) // "VoiceUnavailable"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class SpeechSynthesisError extends Schema.TaggedError<
  SpeechSynthesisError,
  { readonly brand: unique symbol }
>()("SpeechSynthesisError", {
  reason: Schema.Literals([
    "Unsupported",
    "NotAllowed",
    "VoiceUnavailable",
    "LanguageUnavailable",
    "TextTooLong",
    "AudioBusy",
    "Network",
    "Interrupted",
    "Failed",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const synthesisError = (reason: SpeechSynthesisErrorReason, cause: unknown) =>
  new SpeechSynthesisError({ reason, cause, message: `speech synthesis: ${reason}` });

/** `SpeechSynthesisErrorEvent.error` codes onto reasons; the rest are `Failed`. */
const ERROR_CODES: ReadonlyArray<readonly [string, SpeechSynthesisErrorReason]> = [
  ["not-allowed", "NotAllowed"],
  ["voice-unavailable", "VoiceUnavailable"],
  ["language-unavailable", "LanguageUnavailable"],
  ["text-too-long", "TextTooLong"],
  ["audio-busy", "AudioBusy"],
  ["audio-hardware", "AudioBusy"],
  ["network", "Network"],
  ["canceled", "Interrupted"],
  ["interrupted", "Interrupted"],
];

const reasonOfEvent = (event: unknown): SpeechSynthesisErrorReason => {
  const code = P.hasProperty(event, "error") && P.isString(event.error) ? event.error : "";
  return Option.match(
    Arr.findFirst(ERROR_CODES, ([known]) => known === code),
    { onNone: () => "Failed", onSome: ([, reason]) => reason },
  );
};

const toVoice = (voice: VoiceLike): Voice => ({
  voiceURI: voice.voiceURI,
  name: voice.name,
  lang: voice.lang,
  localService: voice.localService,
  default: voice.default,
});

const sameVoices: Equivalence.Equivalence<ReadonlyArray<Voice>> = Arr.makeEquivalence(
  Equivalence.mapInput(Equivalence.String, (voice: Voice) => voice.voiceURI),
);

/** A boundary event's position, read structurally. */
const boundaryOf = (event: unknown): Option.Option<Boundary> =>
  P.hasProperty(event, "name") &&
  (event.name === "word" || event.name === "sentence") &&
  P.hasProperty(event, "charIndex") &&
  P.isNumber(event.charIndex)
    ? Option.some({
        name: event.name,
        charIndex: event.charIndex,
        charLength:
          P.hasProperty(event, "charLength") && P.isNumber(event.charLength) ? event.charLength : 0,
        elapsedTime:
          P.hasProperty(event, "elapsedTime") && P.isNumber(event.elapsedTime)
            ? event.elapsedTime
            : 0,
      })
    : Option.none();

/**
 * The speech-synthesis service. Provide {@link layer} in a page, or
 * `TestSpeechSynthesis.layer` from `@thomasfosterau/effect-platform-browser/BrowserTesting` in tests.
 *
 * - `supported` — whether the agent has `speechSynthesis`.
 * - `voices` — the installed voices; where the agent loads them late
 *   (Chromium), waits up to a second for them to arrive.
 * - `voiceChanges` — the voices now, then again each time the list changes.
 * - `speak` — speaks `text` to the end; interrupting it stops the voice.
 * - `boundaries` — speaks `text`, as the word and sentence boundaries it
 *   reaches, ending when it finishes.
 * - `pause` / `resume` / `cancel` — the whole queue, every caller's.
 *
 * @since 0.1.0
 * @category services
 */
export class SpeechSynthesis extends Context.Service<
  SpeechSynthesis,
  {
    readonly supported: boolean;
    readonly voices: Effect.Effect<ReadonlyArray<Voice>>;
    readonly voiceChanges: Stream.Stream<ReadonlyArray<Voice>>;
    readonly speak: (
      text: string,
      options?: UtteranceOptions,
    ) => Effect.Effect<void, SpeechSynthesisError>;
    readonly boundaries: (
      text: string,
      options?: UtteranceOptions,
    ) => Stream.Stream<Boundary, SpeechSynthesisError>;
    readonly pause: Effect.Effect<void>;
    readonly resume: Effect.Effect<void>;
    readonly cancel: Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-platform-browser/SpeechSynthesis") {}

/** How long `voices` waits for a late voice list before reporting none. */
const VOICES_GRACE = "1 second";

/**
 * Builds the {@link SpeechSynthesis} service over `speechSynthesis` and the
 * utterance constructor; `undefined` builds the unsupported service.
 * {@link layer} passes the ambient ones.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { SpeechSynthesis } from "@thomasfosterau/effect-platform-browser"
 *
 * const speech = SpeechSynthesis.make()
 * Effect.runPromise(Effect.flip(speech.speak("Hello"))).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (platform?: {
  readonly synthesis: SpeechSynthesisLike;
  readonly utterance: (text: string) => UtteranceLike;
}): SpeechSynthesis["Service"] => {
  if (platform === undefined) {
    const unsupported = synthesisError("Unsupported", undefined);
    return SpeechSynthesis.of({
      supported: false,
      voices: Effect.succeed([]),
      voiceChanges: Stream.make([]),
      speak: () => Effect.fail(unsupported),
      boundaries: () => Stream.fail(unsupported),
      pause: Effect.void,
      resume: Effect.void,
      cancel: Effect.void,
    });
  }
  const { synthesis, utterance: makeUtterance } = platform;
  const turn = Semaphore.makeUnsafe(1);
  const read = () => Arr.map(synthesis.getVoices(), toVoice);
  const voiceChanges = watch(synthesis, ["voiceschanged"], read, sameVoices);
  const voices = Effect.suspend(() => {
    const now = read();
    return Arr.isReadonlyArrayNonEmpty(now)
      ? Effect.succeed(now)
      : voiceChanges.pipe(
          Stream.filter(Arr.isReadonlyArrayNonEmpty),
          Stream.runHead,
          Effect.timeoutOption(VOICES_GRACE),
          Effect.map((found) => Option.getOrElse(Option.flatten(found), () => now)),
        );
  });

  const configure = (text: string, options?: UtteranceOptions) =>
    Effect.suspend(() => {
      const utterance = makeUtterance(text);
      if (options?.lang !== undefined) utterance.lang = options.lang;
      if (options?.pitch !== undefined) utterance.pitch = options.pitch;
      if (options?.rate !== undefined) utterance.rate = options.rate;
      if (options?.volume !== undefined) utterance.volume = options.volume;
      const wanted = options?.voice;
      if (wanted === undefined) return Effect.succeed(utterance);
      return Option.match(
        Arr.findFirst(
          synthesis.getVoices(),
          (voice) => voice.voiceURI === wanted || voice.name === wanted,
        ),
        {
          onNone: () => Effect.fail(synthesisError("VoiceUnavailable", wanted)),
          onSome: (voice) => {
            utterance.voice = voice;
            return Effect.succeed(utterance);
          },
        },
      );
    });

  const boundaries = (text: string, options?: UtteranceOptions) =>
    Stream.callback<Boundary, SpeechSynthesisError>((queue) =>
      Effect.gen(function* () {
        yield* turn.takeScoped(1);
        const utterance = yield* configure(text, options);
        const state = { done: false };
        const listeners: ReadonlyArray<readonly [string, (event: unknown) => void]> = [
          [
            "boundary",
            (event) => {
              Option.map(boundaryOf(event), (boundary) => Queue.offerUnsafe(queue, boundary));
            },
          ],
          [
            "end",
            () => {
              state.done = true;
              Queue.endUnsafe(queue);
            },
          ],
          [
            "error",
            (event) => {
              state.done = true;
              Queue.failCauseUnsafe(queue, Cause.fail(synthesisError(reasonOfEvent(event), event)));
            },
          ],
        ];
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            Arr.forEach(listeners, ([type, f]) => utterance.addEventListener(type, f));
            synthesis.speak(utterance);
          }),
          () =>
            Effect.sync(() => {
              Arr.forEach(listeners, ([type, f]) => utterance.removeEventListener(type, f));
              // Ours is the only utterance queued (the turn is held), so
              // cancelling the queue stops just this one.
              if (!state.done) synthesis.cancel();
            }),
        );
      }),
    );

  return SpeechSynthesis.of({
    supported: true,
    voices,
    voiceChanges,
    speak: (text, options) => Stream.runDrain(boundaries(text, options)),
    boundaries,
    pause: Effect.sync(() => synthesis.pause()),
    resume: Effect.sync(() => synthesis.resume()),
    cancel: Effect.sync(() => synthesis.cancel()),
  });
};

/**
 * The {@link SpeechSynthesis} service over the ambient `speechSynthesis`;
 * reports `supported: false` where there is none.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { SpeechSynthesis } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.map(SpeechSynthesis.SpeechSynthesis, (speech) => speech.supported)
 * Effect.runPromise(Effect.provide(program, SpeechSynthesis.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<SpeechSynthesis> = Layer.sync(SpeechSynthesis, () =>
  make(Option.getOrUndefined(ambientSpeechSynthesis())),
);

/**
 * Speaks `text` to the end.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { SpeechSynthesis } from "@thomasfosterau/effect-platform-browser"
 * import { TestSpeechSynthesis } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* SpeechSynthesis.speak("Your order is ready", { lang: "en-AU" })
 *   const control = yield* TestSpeechSynthesis.Control
 *   return yield* control.spoken
 * })
 * Effect.runPromise(Effect.provide(program, TestSpeechSynthesis.layer())).then((spoken) =>
 *   console.log(spoken.map((utterance) => utterance.text)), // ["Your order is ready"]
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const speak = (
  text: string,
  options?: UtteranceOptions,
): Effect.Effect<void, SpeechSynthesisError, SpeechSynthesis> =>
  Effect.flatMap(SpeechSynthesis, (speech) => speech.speak(text, options));

/**
 * Speaks `text`, as the word and sentence boundaries it reaches: what a
 * read-along highlight follows.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { SpeechSynthesis } from "@thomasfosterau/effect-platform-browser"
 * import { TestSpeechSynthesis } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Stream.runCollect(SpeechSynthesis.boundaries("Hello there"))
 * Effect.runPromise(Effect.provide(program, TestSpeechSynthesis.layer())).then((words) =>
 *   console.log(words.map((word) => word.charIndex)), // [0, 6]
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const boundaries = (
  text: string,
  options?: UtteranceOptions,
): Stream.Stream<Boundary, SpeechSynthesisError, SpeechSynthesis> =>
  Stream.unwrap(Effect.map(SpeechSynthesis, (speech) => speech.boundaries(text, options)));

/**
 * The installed voices.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { SpeechSynthesis } from "@thomasfosterau/effect-platform-browser"
 * import { TestSpeechSynthesis } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.map(SpeechSynthesis.voices, (voices) => voices.map((voice) => voice.lang))
 * Effect.runPromise(Effect.provide(program, TestSpeechSynthesis.layer())).then(console.log) // ["en-AU", "fr-FR"]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const voices: Effect.Effect<ReadonlyArray<Voice>, never, SpeechSynthesis> = Effect.flatMap(
  SpeechSynthesis,
  (speech) => speech.voices,
);
