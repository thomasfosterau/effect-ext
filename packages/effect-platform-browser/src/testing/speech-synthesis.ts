/**
 * A controllable `speechSynthesis` for tests of code that uses
 * `SpeechSynthesis`: {@link layer} provides the real adapter over an
 * in-memory synthesiser that "speaks" each utterance at once, word by word,
 * plus {@link Control} to install voices, hold or fail an utterance, and
 * read what was said.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  make as makeSpeechSynthesis,
  SpeechSynthesis,
  type SpeechSynthesisLike,
  type UtteranceLike,
  type Voice,
  type VoiceLike,
} from "../SpeechSynthesis.ts";

/**
 * The in-memory synthesiser's starting state. `supported: false` builds
 * the unsupported service. `voices` defaults to an Australian English and
 * a French voice; `lateVoices` hides them until {@link Control}'s
 * `setVoices`, as Chromium does until its voice list loads. `hold` keeps
 * each utterance speaking until `finish`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
  readonly voices?: ReadonlyArray<Voice>;
  readonly lateVoices?: boolean;
  readonly hold?: boolean;
}

/**
 * One utterance the code under test spoke, or began to.
 *
 * @since 0.1.0
 * @category models
 */
export interface Spoken {
  readonly text: string;
  readonly lang: string;
  readonly voice: Option.Option<string>;
  readonly pitch: number;
  readonly rate: number;
  readonly volume: number;
}

/**
 * Drives the in-memory synthesiser.
 *
 * - `setVoices` — replaces the installed voices and fires `voiceschanged`.
 * - `failNext` — the next utterance fails with this
 *   `SpeechSynthesisErrorEvent` code (`"not-allowed"`, `"network"`, …).
 * - `speaking` — the text being spoken now, if any.
 * - `finish` — finishes the utterance being spoken (with `hold`).
 * - `paused` — whether the queue is paused.
 * - `spoken` — every utterance that started, in order.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly setVoices: (voices: ReadonlyArray<Voice>) => Effect.Effect<void>;
    readonly failNext: (code: string) => Effect.Effect<void>;
    readonly speaking: Effect.Effect<Option.Option<string>>;
    readonly finish: Effect.Effect<void>;
    readonly paused: Effect.Effect<boolean>;
    readonly spoken: Effect.Effect<ReadonlyArray<Spoken>>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/SpeechSynthesisControl") {}

/**
 * What {@link make} builds: the `SpeechSynthesis` service over the
 * in-memory synthesiser, and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly speechSynthesis: SpeechSynthesis["Service"];
  readonly control: Control["Service"];
}

/** The fields a fired event carries beside its type. */
interface EventFields {
  readonly error?: string;
  readonly name?: string;
  readonly charIndex?: number;
  readonly charLength?: number;
  readonly elapsedTime?: number;
}

class FakeUtterance extends EventTarget implements UtteranceLike {
  readonly text: string;
  lang = "";
  pitch = 1;
  rate = 1;
  volume = 1;
  voice: VoiceLike | null = null;
  constructor(text: string) {
    super();
    this.text = text;
  }
  fire(type: string, fields: EventFields = {}): void {
    this.dispatchEvent(Object.assign(new Event(type), fields));
  }
}

/** Each word of `text` with its UTF-16 offset. */
const words = (text: string): ReadonlyArray<{ readonly index: number; readonly word: string }> =>
  Arr.map(Array.from(text.matchAll(/\S+/gu)), (match) => ({
    index: match.index,
    word: match[0],
  }));

/**
 * Speaks one utterance at a time, starting it as soon as it is queued: the
 * adapter takes turns, so the platform's queue never holds more than one.
 */
class FakeSynthesis extends EventTarget implements SpeechSynthesisLike {
  voices: ReadonlyArray<Voice>;
  failure = Option.none<string>();
  paused = false;
  current = Option.none<FakeUtterance>();
  readonly #hold: boolean;
  readonly spoken: Array<Spoken> = [];
  constructor(voices: ReadonlyArray<Voice>, hold: boolean) {
    super();
    this.voices = voices;
    this.#hold = hold;
  }
  getVoices(): ReadonlyArray<Voice> {
    return this.voices;
  }
  speak(utterance: FakeUtterance): void {
    this.spoken.push({
      text: utterance.text,
      lang: utterance.lang,
      voice: Option.map(Option.fromNullishOr(utterance.voice), (voice) => voice.voiceURI),
      pitch: utterance.pitch,
      rate: utterance.rate,
      volume: utterance.volume,
    });
    const failure = this.failure;
    this.failure = Option.none();
    if (Option.isSome(failure)) {
      utterance.fire("error", { error: failure.value });
      return;
    }
    this.current = Option.some(utterance);
    utterance.fire("start");
    Arr.forEach(words(utterance.text), ({ index, word }) =>
      utterance.fire("boundary", {
        name: "word",
        charIndex: index,
        charLength: word.length,
        elapsedTime: index * 50,
      }),
    );
    if (!this.#hold) this.finish();
  }
  cancel(): void {
    Option.map(this.current, (utterance) => {
      this.current = Option.none();
      utterance.fire("error", { error: "interrupted" });
    });
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  finish(): void {
    Option.map(this.current, (utterance) => {
      this.current = Option.none();
      utterance.fire("end");
    });
  }
}

const DEFAULT_VOICES: ReadonlyArray<Voice> = [
  { voiceURI: "en-AU-voice", name: "Karen", lang: "en-AU", localService: true, default: true },
  { voiceURI: "fr-FR-voice", name: "Amélie", lang: "fr-FR", localService: true, default: false },
];

/**
 * Builds the `SpeechSynthesis` service over a fresh in-memory synthesiser,
 * and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestSpeechSynthesis } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { speechSynthesis, control } = TestSpeechSynthesis.make()
 * const program = Effect.gen(function* () {
 *   yield* control.failNext("not-allowed")
 *   return yield* Effect.flip(speechSynthesis.speak("Hello"))
 * })
 * Effect.runPromise(program).then((error) => console.log(error.reason)) // "NotAllowed"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const voices = options?.voices ?? DEFAULT_VOICES;
  const synthesis = new FakeSynthesis(
    options?.lateVoices === true ? [] : voices,
    options?.hold === true,
  );
  return {
    speechSynthesis: makeSpeechSynthesis(
      options?.supported === false
        ? undefined
        : { synthesis, utterance: (text) => new FakeUtterance(text) },
    ),
    control: Control.of({
      setVoices: (next) =>
        Effect.sync(() => {
          synthesis.voices = next;
          synthesis.dispatchEvent(new Event("voiceschanged"));
        }),
      failNext: (code) =>
        Effect.sync(() => {
          synthesis.failure = Option.some(code);
        }),
      speaking: Effect.sync(() => Option.map(synthesis.current, (utterance) => utterance.text)),
      finish: Effect.sync(() => synthesis.finish()),
      paused: Effect.sync(() => synthesis.paused),
      spoken: Effect.sync(() => [...synthesis.spoken]),
    }),
  };
};

/**
 * {@link make}, as a layer providing both the `SpeechSynthesis` service
 * and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { SpeechSynthesis } from "@thomasfosterau/effect-platform-browser"
 * import { TestSpeechSynthesis } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* SpeechSynthesis.speak("Bonjour", { voice: "Amélie", rate: 0.8 })
 *   const control = yield* TestSpeechSynthesis.Control
 *   return yield* control.spoken
 * })
 * Effect.runPromise(Effect.provide(program, TestSpeechSynthesis.layer())).then((spoken) =>
 *   console.log(spoken[0]?.rate), // 0.8
 * )
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<SpeechSynthesis | Control> =>
  Layer.syncContext(() => {
    const { speechSynthesis, control } = make(options);
    return Context.make(SpeechSynthesis, speechSynthesis).pipe(Context.add(Control, control));
  });
