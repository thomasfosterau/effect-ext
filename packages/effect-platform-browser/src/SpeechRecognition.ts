/**
 * Speech to text from the microphone (`SpeechRecognition`, prefixed
 * `webkitSpeechRecognition` in Chromium and Safari), as an Effect service.
 *
 * The platform listens only to the live microphone, and some engines send
 * the audio to a remote service unless `processLocally` is set. It cannot
 * transcribe audio bytes, so effect-ext's `TranscriptionModel` is not
 * something it can stand in for.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ambientSpeechRecognition } from "./internal/globals.ts";

/**
 * The structural slice of a `SpeechRecognition` this module sets and calls.
 * `processLocally` is Chromium's on-device switch; other engines ignore it.
 *
 * @since 0.1.0
 * @category models
 */
export interface RecognitionLike extends Stream.EventListener {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
}

/**
 * Makes a fresh recognition session: `new SpeechRecognition()` as a
 * function.
 *
 * @since 0.1.0
 * @category models
 */
export type SpeechRecognitionFactoryLike = () => RecognitionLike;

/**
 * One way the engine heard a phrase, with its confidence from 0 to 1 (0
 * where the engine does not say).
 *
 * @since 0.1.0
 * @category models
 */
export interface Alternative {
  readonly transcript: string;
  readonly confidence: number;
}

/**
 * The engine's current reading of one phrase. `index` numbers the phrase
 * within the session: an interim result (`isFinal: false`) is replaced by
 * later ones with the same `index`, until a final one settles it.
 * `transcript` and `confidence` are the best alternative's.
 *
 * @since 0.1.0
 * @category models
 */
export interface Result {
  readonly index: number;
  readonly isFinal: boolean;
  readonly transcript: string;
  readonly confidence: number;
  readonly alternatives: ReadonlyArray<Alternative>;
}

/**
 * How to listen.
 *
 * - `lang` — the BCP 47 language to expect; by default the page's.
 * - `continuous` — keep listening across pauses (by default the session
 *   ends after the first phrase).
 * - `interimResults` — report readings before a phrase is final.
 * - `maxAlternatives` — how many alternatives to report per phrase.
 * - `processLocally` — recognise on the device, never a remote service
 *   (Chromium; elsewhere ignored).
 * - `until` — stops listening when it completes; the engine reports what
 *   it has already heard before the stream ends.
 *
 * @since 0.1.0
 * @category models
 */
export interface ListenOptions {
  readonly lang?: string;
  readonly continuous?: boolean;
  readonly interimResults?: boolean;
  readonly maxAlternatives?: number;
  readonly processLocally?: boolean;
  readonly until?: Effect.Effect<void>;
}

/**
 * Why a session failed.
 *
 * - `Unsupported` — the agent has no `SpeechRecognition`.
 * - `NotAllowed` — the user or the agent refused the microphone or the
 *   recognition service.
 * - `AudioCapture` — no microphone, or it could not be opened.
 * - `Network` — the remote recognition service could not be reached.
 * - `LanguageNotSupported` — the engine does not recognise `lang`.
 * - `Aborted` — the session was aborted from outside.
 * - `Failed` — anything else; `cause` carries the event.
 *
 * @since 0.1.0
 * @category errors
 */
export type SpeechRecognitionErrorReason =
  | "Unsupported"
  | "NotAllowed"
  | "AudioCapture"
  | "Network"
  | "LanguageNotSupported"
  | "Aborted"
  | "Failed";

/**
 * A recognition session that failed.
 *
 * @example
 * ```ts
 * import { SpeechRecognition } from "@thomasfosterau/effect-platform-browser"
 *
 * const error = new SpeechRecognition.SpeechRecognitionError({
 *   reason: "NotAllowed",
 *   message: "speech recognition: NotAllowed",
 *   cause: undefined,
 * })
 * console.log(error.reason) // "NotAllowed"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class SpeechRecognitionError extends Schema.TaggedError<
  SpeechRecognitionError,
  { readonly brand: unique symbol }
>()("SpeechRecognitionError", {
  reason: Schema.Literals([
    "Unsupported",
    "NotAllowed",
    "AudioCapture",
    "Network",
    "LanguageNotSupported",
    "Aborted",
    "Failed",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const recognitionError = (reason: SpeechRecognitionErrorReason, cause: unknown) =>
  new SpeechRecognitionError({ reason, cause, message: `speech recognition: ${reason}` });

/** `SpeechRecognitionErrorEvent.error` codes onto reasons; the rest are `Failed`. */
const ERROR_CODES: ReadonlyArray<readonly [string, SpeechRecognitionErrorReason]> = [
  ["not-allowed", "NotAllowed"],
  ["service-not-allowed", "NotAllowed"],
  ["audio-capture", "AudioCapture"],
  ["network", "Network"],
  ["language-not-supported", "LanguageNotSupported"],
  ["aborted", "Aborted"],
];

const reasonOfCode = (code: string): SpeechRecognitionErrorReason =>
  Option.match(
    Arr.findFirst(ERROR_CODES, ([known]) => known === code),
    { onNone: () => "Failed", onSome: ([, reason]) => reason },
  );

const codeOf = (event: unknown): string =>
  P.hasProperty(event, "error") && P.isString(event.error) ? event.error : "";

/** The structural shape of a `SpeechRecognitionEvent`'s results. */
interface ResultListLike {
  readonly length: number;
  readonly [index: number]: {
    readonly isFinal: boolean;
    readonly length: number;
    readonly [index: number]: Alternative;
  };
}

/**
 * Whether `value` is a result list. Only `length` is checked: a
 * `SpeechRecognitionEvent`'s `results` is always a
 * `SpeechRecognitionResultList`, the one array-like it carries.
 */
const isResultList = (value: unknown): value is ResultListLike =>
  P.hasProperty(value, "length") && P.isNumber(value.length);

/** `from`, `from + 1`, …, up to but excluding `to`. */
const indices = (from: number, to: number): ReadonlyArray<number> =>
  to > from ? Arr.range(from, to - 1) : [];

/** The results a `result` event reports: those from `resultIndex` on. */
const resultsOf = (event: unknown): ReadonlyArray<Result> => {
  if (
    !P.hasProperty(event, "resultIndex") ||
    !P.isNumber(event.resultIndex) ||
    !P.hasProperty(event, "results") ||
    !isResultList(event.results)
  ) {
    return [];
  }
  const results = event.results;
  return Arr.map(indices(event.resultIndex, results.length), (index) => {
    const result = results[index];
    const alternatives = Arr.map(indices(0, result.length), (n): Alternative => ({
      transcript: result[n].transcript,
      confidence: result[n].confidence,
    }));
    const best = Option.getOrElse(Arr.head(alternatives), () => ({
      transcript: "",
      confidence: 0,
    }));
    return { index, isFinal: result.isFinal, ...best, alternatives };
  });
};

/**
 * The speech-recognition service. Provide {@link layer} in a page, or
 * `TestSpeechRecognition.layer` from `@thomasfosterau/effect-platform-browser/BrowserTesting` in tests.
 *
 * - `supported` — whether the agent has `SpeechRecognition`.
 * - `listen` — listens to the microphone, as the engine's results; ends
 *   when the session does, and ending the stream early aborts it.
 * - `once` — listens for one phrase: its final transcript, or `None` if
 *   the user said nothing.
 *
 * @since 0.1.0
 * @category services
 */
export class SpeechRecognition extends Context.Service<
  SpeechRecognition,
  {
    readonly supported: boolean;
    readonly listen: (options?: ListenOptions) => Stream.Stream<Result, SpeechRecognitionError>;
    readonly once: (
      options?: Pick<ListenOptions, "lang" | "processLocally">,
    ) => Effect.Effect<Option.Option<string>, SpeechRecognitionError>;
  }
>()("@thomasfosterau/effect-platform-browser/SpeechRecognition") {}

/** The session's event listeners, feeding `queue`. */
const sessionListeners = (
  queue: Queue.Enqueue<Result, SpeechRecognitionError | Cause.Done>,
  state: { ended: boolean },
) => ({
  result: (event: unknown): void => {
    Arr.forEach(resultsOf(event), (result) => Queue.offerUnsafe(queue, result));
  },
  error: (event: unknown): void => {
    const code = codeOf(event);
    // Silence is not a failure: the session ends, and `end` follows.
    if (code === "no-speech") return;
    state.ended = true;
    Queue.failCauseUnsafe(queue, Cause.fail(recognitionError(reasonOfCode(code), event)));
  },
  end: (): void => {
    state.ended = true;
    Queue.endUnsafe(queue);
  },
});

/** Applies `options` to a fresh session, leaving the engine's defaults where unset. */
const configure = (recognition: RecognitionLike, options: ListenOptions): void => {
  if (options.lang !== undefined) recognition.lang = options.lang;
  if (options.continuous !== undefined) recognition.continuous = options.continuous;
  if (options.interimResults !== undefined) recognition.interimResults = options.interimResults;
  if (options.maxAlternatives !== undefined) recognition.maxAlternatives = options.maxAlternatives;
  if (options.processLocally !== undefined) recognition.processLocally = options.processLocally;
};

/**
 * Builds the {@link SpeechRecognition} service over a recognition factory;
 * `undefined` builds the unsupported service. {@link layer} passes the
 * ambient one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { SpeechRecognition } from "@thomasfosterau/effect-platform-browser"
 *
 * const recognition = SpeechRecognition.make()
 * Effect.runPromise(Effect.flip(recognition.once())).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (factory?: SpeechRecognitionFactoryLike): SpeechRecognition["Service"] => {
  if (factory === undefined) {
    const unsupported = recognitionError("Unsupported", undefined);
    return SpeechRecognition.of({
      supported: false,
      listen: () => Stream.fail(unsupported),
      once: () => Effect.fail(unsupported),
    });
  }
  const listen = (options?: ListenOptions) =>
    Stream.callback<Result, SpeechRecognitionError>((queue) => {
      const state = { ended: false };
      const listeners = R.toEntries(sessionListeners(queue, state));
      return Effect.acquireRelease(
        Effect.try({
          try: () => {
            const recognition = factory();
            configure(recognition, options ?? {});
            Arr.forEach(listeners, ([type, f]) => recognition.addEventListener(type, f));
            recognition.start();
            return recognition;
          },
          catch: (cause) => recognitionError("Failed", cause),
        }),
        (recognition) =>
          Effect.sync(() => {
            Arr.forEach(listeners, ([type, f]) => recognition.removeEventListener(type, f));
            if (!state.ended) recognition.abort();
          }),
      ).pipe(
        Effect.tap((recognition) =>
          options?.until === undefined
            ? Effect.void
            : Effect.forkScoped(
                Effect.andThen(
                  options.until,
                  Effect.sync(() => recognition.stop()),
                ),
              ),
        ),
      );
    });
  return SpeechRecognition.of({
    supported: true,
    listen,
    once: (options) =>
      listen({ ...options, continuous: false, interimResults: false }).pipe(
        Stream.filter((result) => result.isFinal),
        Stream.runHead,
        Effect.map(Option.map((result) => result.transcript)),
      ),
  });
};

/**
 * The {@link SpeechRecognition} service over the ambient
 * `SpeechRecognition`; reports `supported: false` where there is none.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { SpeechRecognition } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.map(SpeechRecognition.SpeechRecognition, (speech) => speech.supported)
 * Effect.runPromise(Effect.provide(program, SpeechRecognition.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<SpeechRecognition> = Layer.sync(SpeechRecognition, () =>
  make(Option.getOrUndefined(ambientSpeechRecognition())),
);

/**
 * Listens to the microphone, as the engine's results.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { SpeechRecognition } from "@thomasfosterau/effect-platform-browser"
 * import { TestSpeechRecognition } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestSpeechRecognition.Control
 *   yield* control.say(["turn on", "turn on the lights"])
 *   const results = SpeechRecognition.listen({ interimResults: true })
 *   return yield* Stream.runCollect(results)
 * })
 * Effect.runPromise(Effect.provide(program, TestSpeechRecognition.layer())).then((results) =>
 *   console.log(results.map((result) => [result.transcript, result.isFinal])),
 *   // [["turn on", false], ["turn on the lights", true]]
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const listen = (
  options?: ListenOptions,
): Stream.Stream<Result, SpeechRecognitionError, SpeechRecognition> =>
  Stream.unwrap(Effect.map(SpeechRecognition, (speech) => speech.listen(options)));

/**
 * Listens for one phrase: its final transcript, or `None` if the user said
 * nothing.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { SpeechRecognition } from "@thomasfosterau/effect-platform-browser"
 * import { TestSpeechRecognition } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestSpeechRecognition.Control
 *   yield* control.say(["search for cafes"])
 *   return yield* SpeechRecognition.once({ lang: "en-AU" })
 * })
 * Effect.runPromise(Effect.provide(program, TestSpeechRecognition.layer())).then(console.log)
 * // { _id: "Option", _tag: "Some", value: "search for cafes" }
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const once = (
  options?: Pick<ListenOptions, "lang" | "processLocally">,
): Effect.Effect<Option.Option<string>, SpeechRecognitionError, SpeechRecognition> =>
  Effect.flatMap(SpeechRecognition, (speech) => speech.once(options));
