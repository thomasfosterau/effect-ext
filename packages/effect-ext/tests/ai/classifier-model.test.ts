/**
 * Unit tests for the `ClassifierModel` abstraction (`src/ClassifierModel.ts`)
 * and its `fromLanguageModel` adapter.
 *
 * The provider is stubbed at the `make` seam; the adapter is exercised over a
 * hand-built `LanguageModel` layer returning a canned structured object. No
 * network is reached in either path.
 *
 * @module tests/unit/classifier-model
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AiError, LanguageModel } from "effect/ai";
import {
  ClassScore,
  fromLanguageModel,
  make,
  type ProviderOptions,
  type ProviderResponse,
  type Service,
} from "@thomasfosterau/effect-ext/ClassifierModel";
import { expectFailureInstanceOf } from "./helpers/effect";
import { failingLanguageModel, stubLanguageModel } from "./helpers/language-model";

const noUsage = { inputTokens: Option.none() } as const;

const expectAiError = <A, R>(program: Effect.Effect<A, AiError.AiError, R>) =>
  Effect.map(expectFailureInstanceOf(program, AiError.AiError), (failure) => failure.message);

const makeStub = (
  behaviour:
    | { readonly respond: (options: ProviderOptions) => ProviderResponse }
    | { readonly fail: true },
): Effect.Effect<{ readonly model: Service; readonly calls: ProviderOptions[] }> =>
  Effect.gen(function* () {
    const calls: ProviderOptions[] = [];
    const model = yield* make({
      classify: (options) =>
        Effect.gen(function* () {
          if ("fail" in behaviour) {
            return yield* AiError.make({
              module: "test",
              method: "classify",
              reason: new AiError.UnknownError({ description: "stubbed failure" }),
            });
          }
          calls.push(options);
          return behaviour.respond(options);
        }),
    });
    return { model, calls };
  });

describe("ClassifierModel", () => {
  it.effect("returns classes sorted by descending score with usage propagated", () =>
    Effect.gen(function* () {
      const response = yield* Effect.gen(function* () {
        const { model } = yield* makeStub({
          respond: () => ({
            classifications: [
              {
                classes: [
                  { label: "spam", score: 0.2 },
                  { label: "ham", score: 0.8 },
                ],
              },
            ],
            usage: { inputTokens: Option.some(11) },
          }),
        });
        return yield* model.classify({ inputs: ["hello"] });
      });

      expect(response.classifications[0].classes).toEqual([
        new ClassScore({ label: "ham", score: 0.8 }),
        new ClassScore({ label: "spam", score: 0.2 }),
      ]);
      expect(response.usage.inputTokens).toStrictEqual(Option.some(11));
    }),
  );

  it.effect("passes normalised provider options through (multiLabel defaults to false)", () =>
    Effect.gen(function* () {
      const calls = yield* Effect.gen(function* () {
        const { model, calls: stubCalls } = yield* makeStub({
          respond: () => ({
            classifications: [{ classes: [{ label: "a", score: 1 }] }],
            usage: noUsage,
          }),
        });
        yield* model.classify({ inputs: ["x"], labels: ["a", "b"] });
        return stubCalls;
      });

      expect(calls).toEqual([{ inputs: ["x"], labels: ["a", "b"], multiLabel: false }]);
    }),
  );

  it.effect("returns an empty response for empty inputs without calling the provider", () =>
    Effect.gen(function* () {
      const { response, callCount } = yield* Effect.gen(function* () {
        const { model, calls } = yield* makeStub({
          respond: () => ({ classifications: [], usage: { inputTokens: Option.some(1) } }),
        });
        const result = yield* model.classify({ inputs: [] });
        return { response: result, callCount: calls.length };
      });

      expect(response.classifications).toEqual([]);
      expect(response.usage.inputTokens).toStrictEqual(Option.none());
      expect(callCount).toBe(0);
    }),
  );

  it.effect("fails with AiError when the classification count does not match the input count", () =>
    Effect.gen(function* () {
      const message = yield* expectAiError(
        Effect.gen(function* () {
          const { model } = yield* makeStub({
            respond: () => ({ classifications: [], usage: noUsage }),
          });
          return yield* model.classify({ inputs: ["one"] });
        }),
      );

      expect(message).toContain("expected 1");
    }),
  );

  it.effect("fails with AiError when a returned label is outside the requested set", () =>
    Effect.gen(function* () {
      const message = yield* expectAiError(
        Effect.gen(function* () {
          const { model } = yield* makeStub({
            respond: () => ({
              classifications: [{ classes: [{ label: "other", score: 0.9 }] }],
              usage: noUsage,
            }),
          });
          return yield* model.classify({ inputs: ["x"], labels: ["a", "b"] });
        }),
      );

      expect(message).toContain("'other'");
    }),
  );

  it.effect("fails with AiError when a score is not finite", () =>
    Effect.gen(function* () {
      const message = yield* expectAiError(
        Effect.gen(function* () {
          const { model } = yield* makeStub({
            respond: () => ({
              classifications: [{ classes: [{ label: "a", score: Number.POSITIVE_INFINITY }] }],
              usage: noUsage,
            }),
          });
          return yield* model.classify({ inputs: ["x"] });
        }),
      );

      expect(message).toContain("non-finite score");
    }),
  );

  it.effect("propagates provider failures as AiError", () =>
    Effect.gen(function* () {
      const message = yield* expectAiError(
        Effect.gen(function* () {
          const { model } = yield* makeStub({ fail: true });
          return yield* model.classify({ inputs: ["x"] });
        }),
      );

      expect(message).toContain("stubbed failure");
    }),
  );

  describe("fromLanguageModel", () => {
    it.effect("classifies via structured output and reuses the validation path", () =>
      Effect.gen(function* () {
        const captured: Array<{ readonly prompt: unknown; readonly objectName: unknown }> = [];
        const response = yield* Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.classify({
            inputs: ["great product"],
            labels: ["positive", "negative"],
          });
        }).pipe(
          Effect.provideService(
            LanguageModel.LanguageModel,
            stubLanguageModel(
              {
                classifications: [
                  {
                    classes: [
                      { label: "negative", score: 0.1 },
                      { label: "positive", score: 0.9 },
                    ],
                  },
                ],
              },
              (request) => {
                captured.push(request);
              },
            ),
          ),
        );

        expect(response.classifications[0].classes[0]).toEqual(
          new ClassScore({ label: "positive", score: 0.9 }),
        );
        expect(captured.map((request) => request.objectName)).toEqual(["classification"]);
        expect(captured.map((request) => String(request.prompt)).join("\n")).toContain(
          "positive, negative",
        );
      }),
    );

    it.effect("quotes each few-shot example in the prompt as JSON", () =>
      Effect.gen(function* () {
        const captured: Array<{ readonly prompt: unknown; readonly objectName: unknown }> = [];
        yield* Effect.gen(function* () {
          const model = yield* fromLanguageModel;
          return yield* model.classify({
            inputs: ["fine"],
            examples: [{ text: 'said "great"', label: "positive" }],
          });
        }).pipe(
          Effect.provideService(
            LanguageModel.LanguageModel,
            stubLanguageModel(
              { classifications: [{ classes: [{ label: "neutral", score: 0.6 }] }] },
              (request) => {
                captured.push(request);
              },
            ),
          ),
        );

        expect(captured.map((request) => String(request.prompt)).join("\n")).toContain(
          'Examples:\n- "said \\"great\\"" => positive',
        );
      }),
    );

    it.effect("surfaces a language-model failure as AiError", () =>
      Effect.gen(function* () {
        const message = yield* expectAiError(
          Effect.gen(function* () {
            const model = yield* fromLanguageModel;
            return yield* model.classify({ inputs: ["x"] });
          }).pipe(Effect.provideService(LanguageModel.LanguageModel, failingLanguageModel())),
        );

        expect(message).toContain("stubbed failure");
      }),
    );

    it.effect("validates language-model output against the requested labels", () =>
      Effect.gen(function* () {
        const message = yield* expectAiError(
          Effect.gen(function* () {
            const model = yield* fromLanguageModel;
            return yield* model.classify({ inputs: ["x"], labels: ["a"] });
          }).pipe(
            Effect.provideService(
              LanguageModel.LanguageModel,
              stubLanguageModel({
                classifications: [{ classes: [{ label: "bogus", score: 0.5 }] }],
              }),
            ),
          ),
        );

        expect(message).toContain("'bogus'");
      }),
    );
  });
});
