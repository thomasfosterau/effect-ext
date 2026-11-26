/**
 * Unit tests for the `Speaker` abstraction (`src/Speaker.ts`), stubbed at
 * the `make` seam.
 *
 * @module tests/ai/speaker
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AiError } from "effect/ai";
import * as Speaker from "@thomasfosterau/effect-ext/Speaker";
import { expectFailureInstanceOf } from "./helpers/effect";

const makeStub = (
  say: (options: Speaker.ProviderOptions) => Effect.Effect<void, AiError.AiError> = () =>
    Effect.void,
) =>
  Effect.gen(function* () {
    const calls: Array<Speaker.ProviderOptions> = [];
    const speaker = yield* Speaker.make({
      say: (options) =>
        Effect.andThen(
          Effect.sync(() => calls.push(options)),
          say(options),
        ),
    });
    return { speaker, calls };
  });

describe("Speaker", () => {
  it.effect("passes the text, voice and language through", () =>
    Effect.gen(function* () {
      const { speaker, calls } = yield* makeStub();
      yield* speaker.say({ text: "Hello", voice: "Karen", language: "en-AU" });
      expect(calls).toEqual([{ text: "Hello", voice: "Karen", language: "en-AU" }]);
    }),
  );

  it.effect("never sends empty or blank text to the provider", () =>
    Effect.gen(function* () {
      const { speaker, calls } = yield* makeStub();
      yield* speaker.say({ text: "" });
      yield* speaker.say({ text: " \n\t" });
      expect(calls).toEqual([]);
    }),
  );

  it.effect("fails with the provider's AiError", () =>
    Effect.gen(function* () {
      const { speaker } = yield* makeStub(() =>
        Effect.fail(
          AiError.make({
            module: "Test",
            method: "say",
            reason: new AiError.UnknownError({ description: "boom" }),
          }),
        ),
      );
      const failure = yield* expectFailureInstanceOf(
        speaker.say({ text: "Hello" }),
        AiError.AiError,
      );
      expect(failure.reason._tag).toBe("UnknownError");
    }),
  );

  it.effect("says through the Speaker in context", () =>
    Effect.gen(function* () {
      const { speaker, calls } = yield* makeStub();
      yield* Effect.provideService(Speaker.say({ text: "Ready" }), Speaker.Speaker, speaker);
      expect(calls).toEqual([{ text: "Ready" }]);
    }),
  );
});
