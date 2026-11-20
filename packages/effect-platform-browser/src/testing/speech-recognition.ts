/**
 * A controllable `SpeechRecognition` for tests of code that uses
 * `SpeechRecognition`: {@link layer} provides the real adapter over an
 * in-memory recogniser, plus {@link Control} to script what the user says,
 * fail a session, and read how each session was set up.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  make as makeSpeechRecognition,
  type RecognitionLike,
  SpeechRecognition,
} from "../SpeechRecognition.ts";

/**
 * The in-memory recogniser's starting state. `supported: false` builds
 * the unsupported service.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
}

/**
 * How the code under test set up one session.
 *
 * @since 0.1.0
 * @category models
 */
export interface Session {
  readonly lang: string;
  readonly continuous: boolean;
  readonly interimResults: boolean;
  readonly maxAlternatives: number;
  readonly processLocally: Option.Option<boolean>;
}

/**
 * Drives the in-memory recogniser.
 *
 * - `say` — the user says one phrase, given as the engine's successive
 *   readings of it, the last one final. A session listening now hears it
 *   at once; otherwise the next session does. A session that is not
 *   `continuous` ends after one phrase; one that starts with nothing to
 *   hear ends with `no-speech`, unless it is `continuous`.
 * - `failNext` — the next session fails with this
 *   `SpeechRecognitionErrorEvent` code (`"not-allowed"`, `"network"`, …).
 * - `listening` — whether a session is running.
 * - `sessions` — every session started, in order.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly say: (readings: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly failNext: (code: string) => Effect.Effect<void>;
    readonly listening: Effect.Effect<boolean>;
    readonly sessions: Effect.Effect<ReadonlyArray<Session>>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/SpeechRecognitionControl") {}

/**
 * What {@link make} builds: the `SpeechRecognition` service over the
 * in-memory recogniser, and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly speechRecognition: SpeechRecognition["Service"];
  readonly control: Control["Service"];
}

/** What every session of one recogniser shares. */
interface Platform {
  readonly pending: Array<ReadonlyArray<string>>;
  readonly sessions: Array<Session>;
  failure: Option.Option<string>;
  active: Option.Option<FakeRecognition>;
}

type FakeResult = ReadonlyArray<{ readonly transcript: string; readonly confidence: number }> & {
  readonly isFinal: boolean;
};

/** The fields a fired event carries beside its type. */
interface EventFields {
  readonly error?: string;
  readonly resultIndex?: number;
  readonly results?: ReadonlyArray<FakeResult>;
}

class FakeRecognition extends EventTarget implements RecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  processLocally?: boolean;
  #ended = false;
  readonly #results: Array<FakeResult> = [];
  readonly #platform: Platform;
  constructor(platform: Platform) {
    super();
    this.#platform = platform;
  }
  start(): void {
    this.#platform.active = Option.some(this);
    this.#platform.sessions.push({
      lang: this.lang,
      continuous: this.continuous,
      interimResults: this.interimResults,
      maxAlternatives: this.maxAlternatives,
      processLocally: Option.fromUndefinedOr(this.processLocally),
    });
    queueMicrotask(() => this.#run());
  }
  stop(): void {
    this.#end();
  }
  abort(): void {
    this.#fire("error", { error: "aborted" });
    this.#end();
  }
  drain(): void {
    if (this.#ended) return;
    const readings = this.#platform.pending.shift();
    if (readings === undefined) return;
    this.#hear(readings);
    this.drain();
  }
  #run(): void {
    if (this.#ended) return;
    const failure = this.#platform.failure;
    this.#platform.failure = Option.none();
    if (Option.isSome(failure)) {
      this.#fire("error", { error: failure.value });
      this.#end();
      return;
    }
    this.drain();
    if (!this.continuous && !this.#ended) {
      this.#fire("error", { error: "no-speech" });
      this.#end();
    }
  }
  #hear(readings: ReadonlyArray<string>): void {
    const index = this.#results.length;
    Arr.forEach(readings, (transcript, n) => {
      const isFinal = n === readings.length - 1;
      if (!isFinal && !this.interimResults) return;
      this.#results[index] = Object.assign([{ transcript, confidence: 0.9 }], { isFinal });
      this.#fire("result", { resultIndex: index, results: [...this.#results] });
    });
    if (!this.continuous) this.#end();
  }
  #end(): void {
    this.#ended = true;
    this.#platform.active = Option.none();
    this.#fire("end");
  }
  #fire(type: string, fields: EventFields = {}): void {
    this.dispatchEvent(Object.assign(new Event(type), fields));
  }
}

/**
 * Builds the `SpeechRecognition` service over a fresh in-memory
 * recogniser, and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestSpeechRecognition } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { speechRecognition, control } = TestSpeechRecognition.make()
 * const program = Effect.gen(function* () {
 *   yield* control.failNext("not-allowed")
 *   return yield* Effect.flip(speechRecognition.once())
 * })
 * Effect.runPromise(program).then((error) => console.log(error.reason)) // "NotAllowed"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const platform: Platform = {
    pending: [],
    sessions: [],
    failure: Option.none(),
    active: Option.none(),
  };
  return {
    speechRecognition: makeSpeechRecognition(
      options?.supported === false ? undefined : () => new FakeRecognition(platform),
    ),
    control: Control.of({
      say: (readings) =>
        Effect.sync(() => {
          platform.pending.push(readings);
          Option.map(platform.active, (session) => session.drain());
        }),
      failNext: (code) =>
        Effect.sync(() => {
          platform.failure = Option.some(code);
        }),
      listening: Effect.sync(() => Option.isSome(platform.active)),
      sessions: Effect.sync(() => [...platform.sessions]),
    }),
  };
};

/**
 * {@link make}, as a layer providing both the `SpeechRecognition` service
 * and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { SpeechRecognition } from "@thomasfosterau/effect-platform-browser"
 * import { TestSpeechRecognition } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * // Nobody speaks: the session ends with nothing heard.
 * const program = SpeechRecognition.once()
 * Effect.runPromise(Effect.provide(program, TestSpeechRecognition.layer())).then(console.log)
 * // { _id: "Option", _tag: "None" }
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<SpeechRecognition | Control> =>
  Layer.syncContext(() => {
    const { speechRecognition, control } = make(options);
    return Context.make(SpeechRecognition, speechRecognition).pipe(Context.add(Control, control));
  });
