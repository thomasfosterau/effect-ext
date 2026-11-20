/**
 * Unit tests for `EmbeddingSimilarity.embeddingSimilarity`. `EmbeddingModel`
 * lives in `R`, so these stub the service directly with `EmbeddingModel.make`
 * (the package takes no provider dependency).
 *
 * @module tests/scorers/embedding-similarity
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AiError, EmbeddingModel } from "effect/ai";
import { EmbeddingSimilarity } from "../../../src/evals/index.ts";
import { expectFailureInstanceOf } from "../helpers/effect.ts";

/** Stubs `EmbeddingModel` to return a fixed vector per input text, recording every `embedMany` call. */
const stubEmbeddingModel = (vectors: Record<string, ReadonlyArray<number>>) => {
  const calls: ReadonlyArray<string>[] = [];
  const withModel = Effect.provideServiceEffect(
    EmbeddingModel.EmbeddingModel,
    EmbeddingModel.make({
      embedMany: ({ inputs }) => {
        calls.push(inputs);
        return Effect.succeed({
          results: inputs.map((input) => [...(vectors[input] ?? [])]),
          usage: { inputTokens: undefined },
        });
      },
    }),
  );
  return { withModel, calls };
};

const withFailingModel = Effect.provideServiceEffect(
  EmbeddingModel.EmbeddingModel,
  EmbeddingModel.make({
    embedMany: () =>
      Effect.fail(
        AiError.make({
          module: "Test",
          method: "embedMany",
          reason: new AiError.UnknownError({ description: "provider unreachable" }),
        }),
      ),
  }),
);

describe("EmbeddingSimilarity.embeddingSimilarity", () => {
  it.effect("scores 1 for identical-direction vectors", () =>
    Effect.gen(function* () {
      const { withModel, calls } = stubEmbeddingModel({ same: [1, 0] });

      const score = yield* EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: { expected: "same" }, output: "same" })
        .pipe(withModel);

      expect(score.score).toBeCloseTo(1);
      expect(calls).toEqual([["same", "same"]]);
    }),
  );

  it.effect("scores 0.5 for orthogonal vectors", () =>
    Effect.gen(function* () {
      const { withModel } = stubEmbeddingModel({ output: [1, 0], expected: [0, 1] });

      const score = yield* EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: { expected: "expected" }, output: "output" })
        .pipe(withModel);

      expect(score.score).toBeCloseTo(0.5);
    }),
  );

  it.effect("scores 0 for opposite-direction vectors, clamped at the floor", () =>
    Effect.gen(function* () {
      const { withModel } = stubEmbeddingModel({ output: [1, 0], expected: [-1, 0] });

      const score = yield* EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: { expected: "expected" }, output: "output" })
        .pipe(withModel);

      expect(score.score).toBeCloseTo(0);
    }),
  );

  it.effect("embeds output and expected together, in that order", () =>
    Effect.gen(function* () {
      const { withModel, calls } = stubEmbeddingModel({ hello: [1, 1], world: [1, -1] });

      yield* EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: { expected: "world" }, output: "hello" })
        .pipe(withModel);

      expect(calls).toEqual([["hello", "world"]]);
    }),
  );

  it.effect("scores 0 without calling the model when golden has no expected output", () =>
    Effect.gen(function* () {
      const { withModel, calls } = stubEmbeddingModel({});

      const score = yield* EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: {}, output: "anything" })
        .pipe(withModel);

      expect(score).toEqual({ score: 0, reason: "golden.expected is undefined" });
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("surfaces the model's typed AiError rather than throwing", () =>
    expectFailureInstanceOf(
      EmbeddingSimilarity.embeddingSimilarity
        .evaluate({ golden: { expected: "expected" }, output: "output" })
        .pipe(withFailingModel, Effect.asVoid),
      AiError.AiError,
    ),
  );
});
