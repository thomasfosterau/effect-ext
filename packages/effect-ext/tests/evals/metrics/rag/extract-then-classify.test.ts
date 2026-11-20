/**
 * Unit tests for the shared `ExtractThenClassify` primitive: the ratio and
 * reason-summary pure functions directly, and `extractThenClassifyRatio`'s
 * end-to-end wiring (extract → classify → score) including its
 * no-statements-found short-circuit.
 *
 * @module tests/metrics/rag/extract-then-classify
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AiError, LanguageModel } from "effect/ai";
import { ExtractThenClassify } from "../../../../src/evals/index.ts";
import { expectFailureInstanceOf } from "../../helpers/effect.ts";
import { makeJudgeStub, provideJudge } from "./helpers.ts";

describe("ExtractThenClassify.ratioScore", () => {
  it("scores the fraction of yes verdicts", () => {
    const score = ExtractThenClassify.ratioScore([
      { statement: "a", verdict: "yes", reason: Option.none() },
      { statement: "b", verdict: "yes", reason: Option.none() },
      { statement: "c", verdict: "no", reason: Option.none() },
      { statement: "d", verdict: "no", reason: Option.none() },
    ]);
    expect(score).toBe(0.5);
  });

  it("is vacuously 1 with no verdicts", () => {
    expect(ExtractThenClassify.ratioScore([])).toBe(1);
  });

  it("scores a perfect match as 1 and a total miss as 0", () => {
    expect(
      ExtractThenClassify.ratioScore([{ statement: "a", verdict: "yes", reason: Option.none() }]),
    ).toBe(1);
    expect(
      ExtractThenClassify.ratioScore([{ statement: "a", verdict: "no", reason: Option.none() }]),
    ).toBe(0);
  });
});

describe("ExtractThenClassify.summarizeVerdicts", () => {
  it("reports a pass count with no failure detail when everything passes", () => {
    expect(
      ExtractThenClassify.summarizeVerdicts([
        { statement: "a", verdict: "yes", reason: Option.none() },
        { statement: "b", verdict: "yes", reason: Option.none() },
      ]),
    ).toBe("2/2 statements passed.");
  });

  it("lists each failing statement with its reason", () => {
    expect(
      ExtractThenClassify.summarizeVerdicts([
        { statement: "a", verdict: "yes", reason: Option.none() },
        { statement: "b", verdict: "no", reason: Option.some("contradicted by context") },
      ]),
    ).toBe("1/2 statements passed.\n- b: contradicted by context");
  });

  it("lists a failing statement without a reason using just the statement text", () => {
    expect(
      ExtractThenClassify.summarizeVerdicts([
        { statement: "b", verdict: "no", reason: Option.none() },
      ]),
    ).toBe("0/1 statements passed.\n- b");
  });

  it("reports nothing to evaluate when there are no verdicts", () => {
    expect(ExtractThenClassify.summarizeVerdicts([])).toBe("No statements to evaluate.");
  });
});

describe("ExtractThenClassify.classifyStatements", () => {
  it.effect("labels the classified items 'statements' by default", () =>
    Effect.gen(function* () {
      const { model, calls } = yield* makeJudgeStub([
        () => ({ verdicts: [{ statement: "a", verdict: "yes" }] }),
      ]);

      yield* ExtractThenClassify.classifyStatements({
        instructions: "classify",
        statements: ["a"],
        referenceLabel: "context",
        referenceText: "the context text",
      }).pipe(provideJudge(model));

      expect(calls[0]?.user).toContain("statements:\n1. a");
    }),
  );

  it.effect(
    "uses a custom itemsLabel when given, for classifying non-statement items (e.g. ranked chunks)",
    () =>
      Effect.gen(function* () {
        const { model, calls } = yield* makeJudgeStub([
          () => ({ verdicts: [{ statement: "a", verdict: "yes" }] }),
        ]);

        yield* ExtractThenClassify.classifyStatements({
          instructions: "classify",
          statements: ["a"],
          referenceLabel: "context",
          referenceText: "the context text",
          itemsLabel: "retrieved context chunks",
        }).pipe(provideJudge(model));

        expect(calls[0]?.user).toContain("retrieved context chunks:\n1. a");
        expect(calls[0]?.user).not.toContain("statements:");
      }),
  );

  it.effect(
    "fails with VerdictCountMismatchError, rather than returning a misaligned array, when the judge returns too few verdicts",
    () =>
      Effect.gen(function* () {
        const { model } = yield* makeJudgeStub([
          () => ({ verdicts: [{ statement: "a", verdict: "yes" }] }),
        ]);

        const failure = yield* expectFailureInstanceOf(
          ExtractThenClassify.classifyStatements({
            instructions: "classify",
            statements: ["a", "b", "c"],
            referenceLabel: "context",
            referenceText: "the context text",
          }).pipe(provideJudge(model), Effect.asVoid),
          ExtractThenClassify.VerdictCountMismatchError,
        );

        expect(failure.expected).toBe(3);
        expect(failure.actual).toBe(1);
      }),
  );

  it.effect("fails with VerdictCountMismatchError when the judge returns too many verdicts", () =>
    Effect.gen(function* () {
      const { model } = yield* makeJudgeStub([
        () => ({
          verdicts: [
            { statement: "a", verdict: "yes" },
            { statement: "b", verdict: "yes" },
          ],
        }),
      ]);

      const failure = yield* expectFailureInstanceOf(
        ExtractThenClassify.classifyStatements({
          instructions: "classify",
          statements: ["a"],
          referenceLabel: "context",
          referenceText: "the context text",
        }).pipe(provideJudge(model), Effect.asVoid),
        ExtractThenClassify.VerdictCountMismatchError,
      );

      expect(failure.expected).toBe(1);
      expect(failure.actual).toBe(2);
    }),
  );
});

describe("ExtractThenClassify.extractThenClassifyRatio", () => {
  it.effect("extracts, then classifies, then scores the ratio with verdicts in metadata", () =>
    Effect.gen(function* () {
      const { model, calls } = yield* makeJudgeStub([
        () => ({ statements: ["claim one", "claim two"] }),
        () => ({
          verdicts: [
            { statement: "claim one", verdict: "yes", reason: "supported" },
            { statement: "claim two", verdict: "no", reason: "contradicted" },
          ],
        }),
      ]);

      const score = yield* ExtractThenClassify.extractThenClassifyRatio({
        extract: { instructions: "extract", label: "output", text: "the output text" },
        classify: {
          instructions: "classify",
          referenceLabel: "context",
          referenceText: "the context text",
        },
      }).pipe(provideJudge(model));

      expect(score.score).toBe(0.5);
      expect(score.reason).toBe("1/2 statements passed.\n- claim two: contradicted");
      expect(score.metadata?.statements).toEqual(["claim one", "claim two"]);
      expect(score.metadata?.verdicts).toEqual([
        { statement: "claim one", verdict: "yes", reason: "supported" },
        { statement: "claim two", verdict: "no", reason: "contradicted" },
      ]);
      expect(calls[0]?.user).toContain("output:\nthe output text");
      expect(calls[1]?.user).toContain("context:\nthe context text");
      expect(calls[1]?.user).toContain("1. claim one");
      expect(calls[1]?.user).toContain("2. claim two");
    }),
  );

  it.effect("skips the classify call and scores a vacuous 1 when no statements are extracted", () =>
    Effect.gen(function* () {
      const { model, calls } = yield* makeJudgeStub([() => ({ statements: [] })]);

      const score = yield* ExtractThenClassify.extractThenClassifyRatio({
        extract: { instructions: "extract", label: "output", text: "nothing here" },
        classify: {
          instructions: "classify",
          referenceLabel: "context",
          referenceText: "the context text",
        },
      }).pipe(provideJudge(model));

      expect(score).toEqual({
        score: 1,
        reason: "No statements to evaluate.",
        metadata: { statements: [], verdicts: [] },
      });
      expect(calls).toHaveLength(1);
    }),
  );

  it.effect("propagates a judge failure as the typed AiError", () =>
    Effect.gen(function* () {
      const model = yield* LanguageModel.make({
        generateText: () =>
          Effect.fail(
            AiError.make({
              module: "test",
              method: "generateText",
              reason: new AiError.UnknownError({ description: "stubbed failure" }),
            }),
          ),
        streamText: () => Stream.die("not used"),
      });

      yield* expectFailureInstanceOf(
        ExtractThenClassify.extractThenClassifyRatio({
          extract: { instructions: "extract", label: "output", text: "the output text" },
          classify: {
            instructions: "classify",
            referenceLabel: "context",
            referenceText: "the context text",
          },
        }).pipe(provideJudge(model), Effect.asVoid),
        AiError.AiError,
      );
    }),
  );
});
