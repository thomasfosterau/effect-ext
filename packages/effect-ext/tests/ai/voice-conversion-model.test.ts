/**
 * Unit tests for the `VoiceConversionModel` abstraction
 * (`src/VoiceConversionModel.ts`). The provider is stubbed at the `make` seam.
 *
 * @module tests/unit/voice-conversion-model
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AiError } from "effect/ai";
import {
  make,
  type ProviderOptions,
  type ProviderResponse,
  type Service,
} from "@thomasfosterau/effect-ext/VoiceConversionModel";
import { expectFailureInstanceOf } from "./helpers/effect";

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
      convert: (options) =>
        Effect.gen(function* () {
          if ("fail" in behaviour) {
            return yield* AiError.make({
              module: "test",
              method: "convert",
              reason: new AiError.UnknownError({ description: "stubbed failure" }),
            });
          }
          calls.push(options);
          return behaviour.respond(options);
        }),
    });
    return { model, calls };
  });

const audio = new Uint8Array([1, 2, 3]);

describe("VoiceConversionModel", () => {
  it.effect("returns the converted audio, media type, and usage; passes options through", () =>
    Effect.gen(function* () {
      const { response, calls } = yield* Effect.gen(function* () {
        const { model, calls: stubCalls } = yield* makeStub({
          respond: () => ({
            audio: new Uint8Array([4, 5]),
            mediaType: "audio/mpeg",
            usage: { durationSeconds: Option.some(2) },
          }),
        });
        const result = yield* model.convert({ audio, targetVoice: "nova", format: "mp3" });
        return { response: result, calls: stubCalls };
      });

      expect(Array.from(response.audio)).toEqual([4, 5]);
      expect(response.mediaType).toBe("audio/mpeg");
      expect(response.usage.durationSeconds).toStrictEqual(Option.some(2));
      expect(calls).toEqual([{ audio, targetVoice: "nova", format: "mp3" }]);
    }),
  );

  it.effect("fails with AiError when the provider returns empty audio", () =>
    Effect.gen(function* () {
      const message = yield* expectAiError(
        Effect.gen(function* () {
          const { model } = yield* makeStub({
            respond: () => ({
              audio: new Uint8Array([]),
              mediaType: "audio/mpeg",
              usage: { durationSeconds: Option.none() },
            }),
          });
          return yield* model.convert({ audio, targetVoice: "nova" });
        }),
      );

      expect(message).toContain("empty audio");
    }),
  );

  it.effect("propagates provider failures as AiError", () =>
    Effect.gen(function* () {
      const message = yield* expectAiError(
        Effect.gen(function* () {
          const { model } = yield* makeStub({ fail: true });
          return yield* model.convert({ audio, targetVoice: "nova" });
        }),
      );

      expect(message).toContain("stubbed failure");
    }),
  );
});
