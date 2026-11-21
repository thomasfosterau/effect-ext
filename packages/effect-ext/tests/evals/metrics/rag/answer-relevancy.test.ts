/**
 * Unit tests for `AnswerRelevancy.answerRelevancy`: extracts statements from
 * `output`, classifies each against `input`, scores the fraction relevant.
 *
 * @module tests/metrics/rag/answer-relevancy
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  AnswerRelevancy,
  EvalCase,
  GEval,
  Golden,
  Metric,
  Threshold,
} from "../../../../src/evals/index.ts";
import { expectFailureInstanceOf } from "../../helpers/effect.ts";
import { unsafeCoerce } from "../../helpers/unsafe.ts";
import { deadJudge, makeJudgeStub, provideJudge } from "./helpers.ts";

const RagGolden = Golden.Golden(Schema.String, Schema.String);
const RagTestCase = EvalCase.EvalCase(RagGolden, Schema.String);
type RagTestCase = typeof RagTestCase.Type;

const ragCase: RagTestCase = {
  golden: { input: "What is the capital of France?" },
  output: "Paris is the capital of France. Paris also hosted the 1900 Olympics.",
};

describe("AnswerRelevancy.answerRelevancy", () => {
  it.effect("scores the fraction of extracted statements relevant to input", () =>
    Effect.gen(function* () {
      const metric = AnswerRelevancy.answerRelevancy({ threshold: Threshold.minScore(0.5) });

      const { model, calls } = yield* makeJudgeStub([
        () => ({
          statements: ["Paris is the capital of France.", "Paris hosted the 1900 Olympics."],
        }),
        () => ({
          verdicts: [
            { statement: "Paris is the capital of France.", verdict: "yes" },
            {
              statement: "Paris hosted the 1900 Olympics.",
              verdict: "no",
              reason: "off-topic trivia",
            },
          ],
        }),
      ]);

      const result = yield* Metric.evaluate(metric, ragCase).pipe(provideJudge(model));

      expect(result.score.score).toBe(0.5);
      expect(result.score.reason).toBe(
        "1/2 statements passed.\n- Paris hosted the 1900 Olympics.: off-topic trivia",
      );
      expect(calls[0]?.user).toContain(
        "output:\nParis is the capital of France. Paris also hosted the 1900 Olympics.",
      );
      expect(calls[1]?.user).toContain("input:\nWhat is the capital of France?");
    }),
  );

  it.effect("fails with the typed error, never calling the judge, when output is absent", () =>
    Effect.gen(function* () {
      const metric = AnswerRelevancy.answerRelevancy({ threshold: Threshold.minScore(0.5) });
      const caseWithoutOutput = unsafeCoerce<RagTestCase>({ golden: { input: "x" } });

      const model = yield* deadJudge;

      const failure = yield* expectFailureInstanceOf(
        Metric.evaluate(metric, caseWithoutOutput).pipe(provideJudge(model), Effect.asVoid),
        GEval.MissingEvaluationParamError,
      );

      expect(failure.param).toBe("output");
      expect(failure.metric).toBe("answer-relevancy");
    }),
  );
});
