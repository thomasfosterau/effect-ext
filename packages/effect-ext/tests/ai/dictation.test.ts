/**
 * Unit tests for the `Dictation` abstraction (`src/Dictation.ts`), stubbed
 * at the `make` seam.
 *
 * @module tests/ai/dictation
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AiError } from "effect/ai";
import * as Dictation from "@thomasfosterau/effect-ext/Dictation";
import { expectFailureInstanceOf } from "./helpers/effect";

const READINGS: ReadonlyArray<Dictation.ProviderTranscript> = [
  { index: 0, text: "turn on", isFinal: false },
  { index: 0, text: "turn on the lights", isFinal: true },
  { index: 1, text: "please", isFinal: true },
];

const makeStub = (readings: ReadonlyArray<Dictation.ProviderTranscript> = READINGS) =>
  Effect.gen(function* () {
    const calls: Array<Dictation.ProviderOptions> = [];
    const dictation = yield* Dictation.make({
      listen: (options) => {
        calls.push(options);
        return Stream.fromIterable(readings);
      },
    });
    return { dictation, calls };
  });

const texts = <R>(stream: Stream.Stream<Dictation.Transcript, AiError.AiError, R>) =>
  Effect.map(Stream.runCollect(stream), (readings) => readings.map((reading) => reading.text));

describe("Dictation", () => {
  it.effect("reports only final readings by default", () =>
    Effect.gen(function* () {
      const { dictation, calls } = yield* makeStub();
      expect(yield* texts(dictation.listen())).toEqual(["turn on the lights", "please"]);
      expect(calls).toEqual([{}]);
    }),
  );

  it.effect("reports interim readings when asked, as Transcripts", () =>
    Effect.gen(function* () {
      const { dictation, calls } = yield* makeStub();
      const readings = yield* Stream.runCollect(
        dictation.listen({ language: "en-AU", interimResults: true }),
      );
      expect(readings.map((reading) => [reading.index, reading.text, reading.isFinal])).toEqual([
        [0, "turn on", false],
        [0, "turn on the lights", true],
        [1, "please", true],
      ]);
      expect(readings[0]).toBeInstanceOf(Dictation.Transcript);
      expect(calls).toEqual([{ language: "en-AU", interimResults: true }]);
    }),
  );

  it.effect("fails a reading whose index is negative, fractional or NaN", () =>
    Effect.forEach(
      [-1, 0.5, Number.NaN],
      (index) =>
        Effect.gen(function* () {
          const { dictation } = yield* makeStub([{ index, text: "x", isFinal: true }]);
          const failure = yield* expectFailureInstanceOf(
            Stream.runDrain(dictation.listen()),
            AiError.AiError,
          );
          expect(failure.reason._tag, `index ${index}`).toBe("InvalidOutputError");
        }),
      { concurrency: 1 },
    ),
  );

  it.effect("listens through the Dictation in context", () =>
    Effect.gen(function* () {
      const { dictation } = yield* makeStub();
      const heard = yield* Effect.provideService(
        texts(Dictation.listen()),
        Dictation.Dictation,
        dictation,
      );
      expect(heard).toEqual(["turn on the lights", "please"]);
    }),
  );
});
