/**
 * Scorer composition and `Metric.evaluate` tests: a scorer's judge dependency
 * lives in `R` and its failure is typed in `E`, exercised end to end through
 * a metric's threshold policy.
 *
 * @module tests/metric
 */

import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EvalCase, Golden, Metric, Scorer, Threshold } from "../../src/evals/index.ts";
import { expectFailureInstanceOf } from "./helpers/effect.ts";

const TranslationGolden = Golden.Golden(Schema.String, Schema.String);
const TranslationCase = EvalCase.EvalCase(TranslationGolden, Schema.String);
type TranslationCase = typeof TranslationCase.Type;

const golden: typeof TranslationGolden.Type = { input: "Bonjour", expected: "Hello" };
const matchingCase: TranslationCase = { golden, output: "Hello" };
const mismatchingCase: TranslationCase = { golden, output: "Bonjour" };

describe("Scorer + Metric — dependency-free scorer", () => {
  const exactMatchScorer: Scorer.Scorer<TranslationCase> = Scorer.makeScorer({
    name: "exact-match",
    evaluate: (evalCase) =>
      Effect.succeed(
        evalCase.golden.expected === evalCase.output
          ? { score: 1, reason: "matched" }
          : { score: 0, reason: "mismatched" },
      ),
  });

  const metric = Metric.makeMetric({
    name: "exact-match",
    scorer: exactMatchScorer,
    threshold: Threshold.strict,
  });

  it.effect("passes a matching case under a strict threshold", () =>
    Effect.gen(function* () {
      const result = yield* Metric.evaluate(metric, matchingCase);
      expect(result.score.score).toBe(1);
      expect(result.passed).toBe(true);
    }),
  );

  it.effect("fails a mismatching case under a strict threshold", () =>
    Effect.gen(function* () {
      const result = yield* Metric.evaluate(metric, mismatchingCase);
      expect(result.score.score).toBe(0);
      expect(result.passed).toBe(false);
    }),
  );
});

class JudgeError {
  readonly _tag = "JudgeError";
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

interface JudgeService {
  readonly rate: (output: string, expected: string) => Effect.Effect<number, JudgeError>;
}

class Judge extends Context.Service<Judge, JudgeService>()("tests/Metric/Judge") {}

describe("Scorer + Metric — judge-backed scorer", () => {
  const judgeScorer: Scorer.Scorer<TranslationCase, JudgeError, Judge> = Scorer.makeScorer({
    name: "judge-similarity",
    evaluate: (evalCase) =>
      Effect.gen(function* () {
        const judge = yield* Judge;
        const score = yield* judge.rate(evalCase.output, evalCase.golden.expected ?? "");
        return { score };
      }),
  });

  const metric = Metric.makeMetric({
    name: "judge-similarity",
    scorer: judgeScorer,
    threshold: Threshold.minScore(0.5),
  });

  it.effect("resolves the judge from R and applies the threshold to its score", () =>
    Effect.gen(function* () {
      const judge = { rate: () => Effect.succeed(0.8) };

      const result = yield* Metric.evaluate(metric, matchingCase).pipe(
        Effect.provideService(Judge, judge),
      );
      expect(result.score.score).toBe(0.8);
      expect(result.passed).toBe(true);
    }),
  );

  it.effect("surfaces the judge's typed failure rather than throwing", () =>
    Effect.gen(function* () {
      const judge = { rate: () => Effect.fail(new JudgeError("timeout")) };

      yield* expectFailureInstanceOf(
        Metric.evaluate(metric, matchingCase).pipe(
          Effect.provideService(Judge, judge),
          Effect.asVoid,
        ),
        JudgeError,
      );
    }),
  );
});

/** A differently-shaped case a `TranslationCase`-scoped scorer/metric can be `contramap`ped from, into. */
interface RatingCase {
  readonly text: string;
  readonly reference: string;
}

const toRatingCase = (evalCase: TranslationCase): RatingCase => ({
  text: evalCase.output,
  reference: evalCase.golden.expected ?? "",
});

const ratingScorer: Scorer.Scorer<RatingCase, JudgeError, Judge> = Scorer.makeScorer({
  name: "rating",
  evaluate: (ratingCase) =>
    Effect.gen(function* () {
      const judge = yield* Judge;
      const score = yield* judge.rate(ratingCase.text, ratingCase.reference);
      return { score };
    }),
});

describe("Scorer.contramap", () => {
  const adapted: Scorer.Scorer<TranslationCase, JudgeError, Judge> = Scorer.contramap(
    ratingScorer,
    toRatingCase,
  );

  it("preserves the underlying scorer's name", () => {
    expect(adapted.name).toBe("rating");
  });

  it.effect("maps the input case through `from` before delegating to the underlying scorer", () =>
    Effect.gen(function* () {
      const judge = { rate: () => Effect.succeed(0.8) };

      const score = yield* adapted.evaluate(matchingCase).pipe(Effect.provideService(Judge, judge));
      expect(score.score).toBe(0.8);
    }),
  );

  it.effect("surfaces the underlying scorer's typed failure rather than throwing", () =>
    Effect.gen(function* () {
      const judge = { rate: () => Effect.fail(new JudgeError("timeout")) };

      yield* expectFailureInstanceOf(
        adapted.evaluate(matchingCase).pipe(Effect.provideService(Judge, judge), Effect.asVoid),
        JudgeError,
      );
    }),
  );
});

describe("Metric.contramap", () => {
  const ratingMetric = Metric.makeMetric({
    name: "rating",
    scorer: ratingScorer,
    threshold: Threshold.minScore(0.5),
  });

  const adaptedMetric: Metric.Metric<TranslationCase, JudgeError, Judge> = Metric.contramap(
    ratingMetric,
    toRatingCase,
  );

  it("preserves the underlying metric's name and threshold", () => {
    expect(adaptedMetric.name).toBe("rating");
    expect(adaptedMetric.threshold).toBe(ratingMetric.threshold);
  });

  it.effect(
    "adapts the scorer, applying the (unchanged) threshold to the mapped case's score",
    () =>
      Effect.gen(function* () {
        const judge = { rate: () => Effect.succeed(0.8) };

        const result = yield* Metric.evaluate(adaptedMetric, matchingCase).pipe(
          Effect.provideService(Judge, judge),
        );
        expect(result.score.score).toBe(0.8);
        expect(result.passed).toBe(true);
      }),
  );

  it.effect("surfaces the underlying metric's typed failure rather than throwing", () =>
    Effect.gen(function* () {
      const judge = { rate: () => Effect.fail(new JudgeError("timeout")) };

      yield* expectFailureInstanceOf(
        Metric.evaluate(adaptedMetric, matchingCase).pipe(
          Effect.provideService(Judge, judge),
          Effect.asVoid,
        ),
        JudgeError,
      );
    }),
  );
});
