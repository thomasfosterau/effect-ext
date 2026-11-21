/**
 * Unit tests for `ExactMatch.exactMatch` / `ExactMatch.normalizedMatch`.
 *
 * @module tests/scorers/exact-match
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ExactMatch } from "../../../src/evals/index.ts";

describe("ExactMatch.exactMatch", () => {
  it.effect("scores 1 when output matches golden.expected exactly", () =>
    Effect.gen(function* () {
      const score = yield* ExactMatch.exactMatch.evaluate({
        golden: { expected: "Hello" },
        output: "Hello",
      });
      expect(score).toEqual({ score: 1, reason: "matched" });
    }),
  );

  it.effect("scores 0 when output differs from golden.expected", () =>
    Effect.gen(function* () {
      const score = yield* ExactMatch.exactMatch.evaluate({
        golden: { expected: "Hello" },
        output: "hello",
      });
      expect(score).toEqual({ score: 0, reason: "mismatched" });
    }),
  );

  it.effect("scores 0 when golden has no expected output", () =>
    Effect.gen(function* () {
      const score = yield* ExactMatch.exactMatch.evaluate({ golden: {}, output: "Hello" });
      expect(score).toEqual({ score: 0, reason: "golden.expected is undefined" });
    }),
  );
});

describe("ExactMatch.normalizedMatch", () => {
  it.effect("behaves like exactMatch with no options", () =>
    Effect.gen(function* () {
      const scorer = ExactMatch.normalizedMatch();
      const score = yield* scorer.evaluate({ golden: { expected: "Hello" }, output: "hello" });
      expect(score.score).toBe(0);
    }),
  );

  it.effect("ignores surrounding whitespace when trim is set", () =>
    Effect.gen(function* () {
      const scorer = ExactMatch.normalizedMatch({ trim: true });
      const score = yield* scorer.evaluate({ golden: { expected: "Hello" }, output: "  Hello  " });
      expect(score).toEqual({ score: 1, reason: "matched" });
    }),
  );

  it.effect("ignores case when caseInsensitive is set", () =>
    Effect.gen(function* () {
      const scorer = ExactMatch.normalizedMatch({ caseInsensitive: true });
      const score = yield* scorer.evaluate({
        golden: { expected: "Hello World" },
        output: "HELLO WORLD",
      });
      expect(score).toEqual({ score: 1, reason: "matched" });
    }),
  );

  it.effect("combines trim and caseInsensitive", () =>
    Effect.gen(function* () {
      const scorer = ExactMatch.normalizedMatch({ trim: true, caseInsensitive: true });
      const score = yield* scorer.evaluate({ golden: { expected: "Hello" }, output: "  HELLO  " });
      expect(score).toEqual({ score: 1, reason: "matched" });
    }),
  );

  it.effect("still fails when normalisation isn't enough", () =>
    Effect.gen(function* () {
      const scorer = ExactMatch.normalizedMatch({ trim: true, caseInsensitive: true });
      const score = yield* scorer.evaluate({ golden: { expected: "Hello" }, output: "Goodbye" });
      expect(score).toEqual({ score: 0, reason: "mismatched" });
    }),
  );

  it.effect("scores 0 when golden has no expected output", () =>
    Effect.gen(function* () {
      const scorer = ExactMatch.normalizedMatch({ trim: true });
      const score = yield* scorer.evaluate({ golden: {}, output: "Hello" });
      expect(score).toEqual({ score: 0, reason: "golden.expected is undefined" });
    }),
  );
});
