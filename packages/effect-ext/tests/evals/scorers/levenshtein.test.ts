/**
 * Unit tests for `Levenshtein.levenshtein` / `Levenshtein.levenshteinSimilarity`.
 *
 * @module tests/scorers/levenshtein
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { Levenshtein } from "../../../src/evals/index.ts";

describe("Levenshtein.levenshteinSimilarity", () => {
  it("is 1 for identical strings", () => {
    expect(Levenshtein.levenshteinSimilarity("kitten", "kitten")).toBe(1);
  });

  it("is 1 for two empty strings", () => {
    expect(Levenshtein.levenshteinSimilarity("", "")).toBe(1);
  });

  it("is 0 for a maximally different pair (fully consumed by the longer length)", () => {
    expect(Levenshtein.levenshteinSimilarity("", "abc")).toBe(0);
    expect(Levenshtein.levenshteinSimilarity("abc", "")).toBe(0);
  });

  it("computes the classic kitten/sitting distance of 3", () => {
    // 3 edits over a length-7 comparison base (max("kitten".length, "sitting".length))
    expect(Levenshtein.levenshteinSimilarity("kitten", "sitting")).toBeCloseTo(1 - 3 / 7);
  });

  it("is symmetric", () => {
    expect(Levenshtein.levenshteinSimilarity("flaw", "lawn")).toBe(
      Levenshtein.levenshteinSimilarity("lawn", "flaw"),
    );
  });
});

describe("Levenshtein.levenshtein", () => {
  it.effect("scores the normalised similarity between output and golden.expected", () =>
    Effect.gen(function* () {
      const score = yield* Levenshtein.levenshtein.evaluate({
        golden: { expected: "kitten" },
        output: "sitting",
      });
      expect(score.score).toBeCloseTo(1 - 3 / 7);
    }),
  );

  it.effect("scores 1 for an exact match", () =>
    Effect.gen(function* () {
      const score = yield* Levenshtein.levenshtein.evaluate({
        golden: { expected: "same" },
        output: "same",
      });
      expect(score.score).toBe(1);
    }),
  );

  it.effect("scores 0 when golden has no expected output", () =>
    Effect.gen(function* () {
      const score = yield* Levenshtein.levenshtein.evaluate({ golden: {}, output: "anything" });
      expect(score).toEqual({ score: 0, reason: "golden.expected is undefined" });
    }),
  );
});
