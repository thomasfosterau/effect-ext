import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { SpeechSynthesis } from "@thomasfosterau/effect-platform-browser";
import {
  observe,
  TestSpeechSynthesis,
} from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const control = Effect.service(TestSpeechSynthesis.Control);
const speech = Effect.service(SpeechSynthesis.SpeechSynthesis);

/** Yields until `check` holds: a forked fiber needs a few turns to start speaking. */
const eventually = <R>(
  check: Effect.Effect<boolean, never, R>,
  tries = 100,
): Effect.Effect<void, never, R> =>
  Effect.flatMap(check, (holds) =>
    holds || tries === 0
      ? Effect.void
      : Effect.andThen(
          Effect.yieldNow,
          Effect.suspend(() => eventually(check, tries - 1)),
        ),
  );

const isSpeaking = Effect.map(
  Effect.flatMap(control, (c) => c.speaking),
  Option.isSome,
);

/** A synthesiser whose utterances fire `script`'s events as soon as they are queued. */
const scripted = (
  script: (utterance: EventTarget) => void,
): Parameters<typeof SpeechSynthesis.make>[0] => {
  const utterances: Array<EventTarget> = [];
  return {
    synthesis: Object.assign(new EventTarget(), {
      getVoices: () => [],
      speak: () =>
        Arr.forEach(utterances.splice(0), (utterance) => queueMicrotask(() => script(utterance))),
      cancel: () => {},
      pause: () => {},
      resume: () => {},
    }),
    utterance: () => {
      const utterance = Object.assign(new EventTarget(), {
        lang: "",
        pitch: 1,
        rate: 1,
        volume: 1,
        voice: null,
      });
      utterances.push(utterance);
      return utterance;
    },
  };
};

const fire = (target: EventTarget, type: string, fields: Readonly<Record<string, unknown>> = {}) =>
  target.dispatchEvent(Object.assign(new Event(type), fields));

describe("SpeechSynthesis.make", () => {
  it.effect("fails Unsupported without the API, and reads no voices", () =>
    Effect.gen(function* () {
      const unsupported = SpeechSynthesis.make();
      expect(unsupported.supported).toBe(false);
      const reasons = yield* Effect.forEach(
        [unsupported.speak("hi"), Stream.runDrain(unsupported.boundaries("hi"))],
        (effect) => Effect.map(Effect.flip(effect), (error) => error.reason),
        { concurrency: 1 },
      );
      expect(reasons).toEqual(["Unsupported", "Unsupported"]);
      expect(yield* unsupported.voices).toEqual([]);
      expect(yield* Stream.runCollect(unsupported.voiceChanges)).toEqual([[]]);
      yield* unsupported.pause;
      yield* unsupported.resume;
      yield* unsupported.cancel;
    }),
  );

  it.effect("reads boundaries structurally, skipping what is not a word or sentence", () =>
    Effect.gen(function* () {
      const service = SpeechSynthesis.make(
        scripted((utterance) => {
          fire(utterance, "boundary", { name: "mark", charIndex: 0 });
          fire(utterance, "boundary", { name: "word" });
          fire(utterance, "boundary", { name: "sentence", charIndex: 4 });
          fire(utterance, "end");
        }),
      );
      expect(yield* Stream.runCollect(service.boundaries("Hi. There."))).toEqual([
        { name: "sentence", charIndex: 4, charLength: 0, elapsedTime: 0 },
      ]);
    }),
  );

  it.effect("fails Failed for an error event without a known code", () =>
    Effect.gen(function* () {
      const service = SpeechSynthesis.make(scripted((utterance) => fire(utterance, "error")));
      expect((yield* Effect.flip(service.speak("hi"))).reason).toBe("Failed");
    }),
  );
});

describe("TestSpeechSynthesis", () => {
  it.effect("speaks with the options given, word by word", () =>
    Effect.gen(function* () {
      const words = yield* Stream.runCollect(
        SpeechSynthesis.boundaries("Bonjour à tous", {
          lang: "fr-FR",
          voice: "fr-FR-voice",
          pitch: 1.5,
          rate: 0.8,
          volume: 0.5,
        }),
      );
      expect(words.map((word) => [word.charIndex, word.charLength])).toEqual([
        [0, 7],
        [8, 1],
        [10, 4],
      ]);
      yield* SpeechSynthesis.speak("Hello", { voice: "Karen" });
      expect(yield* (yield* control).spoken).toEqual([
        {
          text: "Bonjour à tous",
          lang: "fr-FR",
          voice: Option.some("fr-FR-voice"),
          pitch: 1.5,
          rate: 0.8,
          volume: 0.5,
        },
        {
          text: "Hello",
          lang: "",
          voice: Option.some("en-AU-voice"),
          pitch: 1,
          rate: 1,
          volume: 1,
        },
      ]);
    }).pipe(Effect.provide(TestSpeechSynthesis.layer())),
  );

  it.effect("fails VoiceUnavailable for a voice not installed, speaking nothing", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(SpeechSynthesis.speak("Hi", { voice: "Nobody" }));
      expect(error.reason).toBe("VoiceUnavailable");
      expect(yield* (yield* control).spoken).toEqual([]);
    }).pipe(Effect.provide(TestSpeechSynthesis.layer())),
  );

  it.effect("maps the platform's error codes onto reasons", () =>
    Effect.gen(function* () {
      const codes = [
        "not-allowed",
        "voice-unavailable",
        "language-unavailable",
        "text-too-long",
        "audio-busy",
        "audio-hardware",
        "network",
        "canceled",
        "synthesis-failed",
      ];
      const reasons = yield* Effect.forEach(
        codes,
        (code) =>
          Effect.gen(function* () {
            yield* (yield* control).failNext(code);
            return (yield* Effect.flip(SpeechSynthesis.speak("Hi"))).reason;
          }),
        { concurrency: 1 },
      );
      expect(reasons).toEqual([
        "NotAllowed",
        "VoiceUnavailable",
        "LanguageUnavailable",
        "TextTooLong",
        "AudioBusy",
        "AudioBusy",
        "Network",
        "Interrupted",
        "Failed",
      ]);
      yield* SpeechSynthesis.speak("Recovered");
    }).pipe(Effect.provide(TestSpeechSynthesis.layer())),
  );

  it.effect("takes turns: a second caller speaks after the first finishes", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const first = yield* Effect.forkChild(SpeechSynthesis.speak("first"));
      yield* eventually(isSpeaking);
      const second = yield* Effect.forkChild(SpeechSynthesis.speak("second"));
      yield* Effect.yieldNow;
      expect(yield* c.speaking).toEqual(Option.some("first"));
      yield* c.finish;
      yield* Fiber.join(first);
      yield* eventually(isSpeaking);
      expect(yield* c.speaking).toEqual(Option.some("second"));
      yield* c.finish;
      yield* Fiber.join(second);
      expect((yield* c.spoken).map((spoken) => spoken.text)).toEqual(["first", "second"]);
    }).pipe(Effect.provide(TestSpeechSynthesis.layer({ hold: true }))),
  );

  it.effect("stops the voice when the speaking fiber is interrupted", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const fiber = yield* Effect.forkChild(SpeechSynthesis.speak("a long story"));
      yield* eventually(isSpeaking);
      yield* Fiber.interrupt(fiber);
      expect(yield* c.speaking).toEqual(Option.none());
      const next = yield* Effect.forkChild(SpeechSynthesis.speak("next"));
      yield* eventually(isSpeaking);
      yield* c.finish;
      yield* Fiber.join(next);
    }).pipe(Effect.provide(TestSpeechSynthesis.layer({ hold: true }))),
  );

  it.effect("fails Interrupted when the queue is cancelled, and pauses and resumes it", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const fiber = yield* Effect.forkChild(SpeechSynthesis.speak("a long story"));
      yield* eventually(isSpeaking);
      yield* (yield* speech).pause;
      expect(yield* c.paused).toBe(true);
      yield* (yield* speech).resume;
      expect(yield* c.paused).toBe(false);
      yield* (yield* speech).cancel;
      expect((yield* Effect.flip(Fiber.join(fiber))).reason).toBe("Interrupted");
    }).pipe(Effect.provide(TestSpeechSynthesis.layer({ hold: true }))),
  );

  it.effect("lists the voices, and follows changes to them", () =>
    Effect.gen(function* () {
      expect((yield* SpeechSynthesis.voices).map((voice) => voice.name)).toEqual([
        "Karen",
        "Amélie",
      ]);
      const seen = yield* observe((yield* speech).voiceChanges, 2);
      const c = yield* control;
      // The same voices again is no change; none at all is.
      yield* c.setVoices(yield* SpeechSynthesis.voices);
      yield* c.setVoices([]);
      expect((yield* Fiber.join(seen)).map((voices) => voices.length)).toEqual([2, 0]);
    }).pipe(Effect.provide(TestSpeechSynthesis.layer())),
  );

  it.effect("waits for voices that load late", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(SpeechSynthesis.voices);
      yield* Effect.yieldNow;
      yield* (yield* control).setVoices([
        { voiceURI: "late", name: "Late", lang: "en-GB", localService: false, default: true },
      ]);
      expect((yield* Fiber.join(fiber)).map((voice) => voice.voiceURI)).toEqual(["late"]);
    }).pipe(Effect.provide(TestSpeechSynthesis.layer({ lateVoices: true }))),
  );

  it.effect("reports no voices once the grace period passes", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(SpeechSynthesis.voices);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1 second");
      expect(yield* Fiber.join(fiber)).toEqual([]);
    }).pipe(Effect.provide(TestSpeechSynthesis.layer({ lateVoices: true }))),
  );

  it.effect("builds the unsupported service when switched off", () =>
    Effect.gen(function* () {
      expect((yield* speech).supported).toBe(false);
    }).pipe(Effect.provide(TestSpeechSynthesis.layer({ supported: false }))),
  );
});
