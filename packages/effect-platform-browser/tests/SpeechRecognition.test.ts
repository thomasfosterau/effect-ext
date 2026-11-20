import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { SpeechRecognition } from "@thomasfosterau/effect-platform-browser";
import { TestSpeechRecognition } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const control = Effect.service(TestSpeechRecognition.Control);

/** Yields until `check` holds: the double starts on a microtask. */
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

const isListening = Effect.flatMap(control, (c) => c.listening);

/** A recogniser that fires `script`'s events as soon as it starts. */
const scripted =
  (script: (recognition: EventTarget) => void): SpeechRecognition.SpeechRecognitionFactoryLike =>
  () =>
    Object.assign(new EventTarget(), {
      lang: "",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
      start(this: EventTarget) {
        queueMicrotask(() => script(this));
      },
      stop: () => {},
      abort: () => {},
    });

/** A recogniser whose `start` throws, as one already started does. */
const refusing: SpeechRecognition.SpeechRecognitionFactoryLike = () =>
  Object.assign(scripted(() => {})(), {
    start: () => {
      throw new DOMException("already started", "InvalidStateError");
    },
  });

const fire = (target: EventTarget, type: string, fields: Readonly<Record<string, unknown>> = {}) =>
  target.dispatchEvent(Object.assign(new Event(type), fields));

describe("SpeechRecognition.make", () => {
  it.effect("fails Unsupported without the API", () =>
    Effect.gen(function* () {
      const unsupported = SpeechRecognition.make();
      expect(unsupported.supported).toBe(false);
      const reasons = yield* Effect.forEach(
        [Stream.runDrain(unsupported.listen()), Effect.asVoid(unsupported.once())],
        (effect) => Effect.map(Effect.flip(effect), (error) => error.reason),
        { concurrency: 1 },
      );
      expect(reasons).toEqual(["Unsupported", "Unsupported"]);
    }),
  );

  it.effect("fails Failed when the session will not start", () =>
    Effect.gen(function* () {
      const service = SpeechRecognition.make(refusing);
      expect((yield* Effect.flip(service.once())).reason).toBe("Failed");
    }),
  );

  it.effect("reads results structurally, and fails Failed for an unknown error", () =>
    Effect.gen(function* () {
      const service = SpeechRecognition.make(
        scripted((recognition) => {
          fire(recognition, "result");
          fire(recognition, "result", { resultIndex: 0, results: {} });
          fire(recognition, "result", {
            resultIndex: 0,
            results: [Object.assign([], { isFinal: false })],
          });
          fire(recognition, "error");
        }),
      );
      const results: Array<SpeechRecognition.Result> = [];
      const error = yield* Effect.flip(
        Stream.runForEach(service.listen(), (result) => Effect.sync(() => results.push(result))),
      );
      expect(results).toEqual([
        { index: 0, isFinal: false, transcript: "", confidence: 0, alternatives: [] },
      ]);
      expect(error.reason).toBe("Failed");
    }),
  );
});

describe("TestSpeechRecognition", () => {
  it.effect("reports interim readings, then the final one", () =>
    Effect.gen(function* () {
      yield* (yield* control).say(["turn on", "turn on the lights"]);
      const results = yield* Stream.runCollect(SpeechRecognition.listen({ interimResults: true }));
      expect(results.map((result) => [result.index, result.transcript, result.isFinal])).toEqual([
        [0, "turn on", false],
        [0, "turn on the lights", true],
      ]);
      expect(results[1]?.alternatives).toEqual([
        { transcript: "turn on the lights", confidence: 0.9 },
      ]);
    }).pipe(Effect.provide(TestSpeechRecognition.layer())),
  );

  it.effect("hears one phrase, or nothing, and sets each session up as asked", () =>
    Effect.gen(function* () {
      const c = yield* control;
      yield* c.say(["search", "search for cafes"]);
      expect(yield* SpeechRecognition.once({ lang: "en-AU", processLocally: true })).toEqual(
        Option.some("search for cafes"),
      );
      expect(yield* SpeechRecognition.once()).toEqual(Option.none());
      expect(yield* c.sessions).toEqual([
        {
          lang: "en-AU",
          continuous: false,
          interimResults: false,
          maxAlternatives: 1,
          processLocally: Option.some(true),
        },
        {
          lang: "",
          continuous: false,
          interimResults: false,
          maxAlternatives: 1,
          processLocally: Option.none(),
        },
      ]);
    }).pipe(Effect.provide(TestSpeechRecognition.layer())),
  );

  it.effect("keeps listening while continuous, until told to stop", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const stop = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          SpeechRecognition.listen({
            continuous: true,
            maxAlternatives: 2,
            until: Deferred.await(stop),
          }),
        ),
      );
      yield* eventually(isListening);
      yield* c.say(["lights on"]);
      yield* c.say(["lights off"]);
      yield* Deferred.succeed(stop, undefined);
      const results = yield* Fiber.join(fiber);
      expect(results.map((result) => [result.index, result.transcript])).toEqual([
        [0, "lights on"],
        [1, "lights off"],
      ]);
      expect(yield* c.listening).toBe(false);
      expect((yield* c.sessions)[0]?.maxAlternatives).toBe(2);
    }).pipe(Effect.provide(TestSpeechRecognition.layer())),
  );

  it.effect("aborts the session when the stream is interrupted", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const fiber = yield* Effect.forkChild(
        Stream.runDrain(SpeechRecognition.listen({ continuous: true })),
      );
      yield* eventually(isListening);
      yield* Fiber.interrupt(fiber);
      expect(yield* c.listening).toBe(false);
    }).pipe(Effect.provide(TestSpeechRecognition.layer())),
  );

  it.effect("maps the platform's error codes onto reasons", () =>
    Effect.gen(function* () {
      const codes = [
        "not-allowed",
        "service-not-allowed",
        "audio-capture",
        "network",
        "language-not-supported",
        "aborted",
        "bad-grammar",
      ];
      const reasons = yield* Effect.forEach(
        codes,
        (code) =>
          Effect.gen(function* () {
            yield* (yield* control).failNext(code);
            return (yield* Effect.flip(SpeechRecognition.once())).reason;
          }),
        { concurrency: 1 },
      );
      expect(reasons).toEqual([
        "NotAllowed",
        "NotAllowed",
        "AudioCapture",
        "Network",
        "LanguageNotSupported",
        "Aborted",
        "Failed",
      ]);
    }).pipe(Effect.provide(TestSpeechRecognition.layer())),
  );

  it.effect("builds the unsupported service when switched off", () =>
    Effect.gen(function* () {
      expect((yield* SpeechRecognition.SpeechRecognition).supported).toBe(false);
    }).pipe(Effect.provide(TestSpeechRecognition.layer({ supported: false }))),
  );
});
