/**
 * Test stub for the upstream `LanguageModel` service.
 *
 * The `fromLanguageModel` adapters draw a `LanguageModel` from context and call
 * `generateObject`. These helpers provide a hand-built `LanguageModel` service
 * layer whose `generateObject` returns a canned structured value (or fails),
 * so the adapter tests exercise the real prompt/validation path with no network.
 *
 * The services are hand-built rather than made with `LanguageModel.make`: `make`
 * routes `generateObject` through a `generateText` hook that sees only the
 * normalised `ProviderOptions` (a `Prompt`, not the caller's prompt string) and
 * must return the encoded wire payload. The stubs need the caller's raw
 * `prompt` / `objectName` / `schema` and return an already-decoded value, so
 * they implement the `LanguageModel` interface directly, brand included.
 *
 * @module tests/unit/helpers/language-model
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AiError, LanguageModel, type Response } from "effect/ai";

/** The defect a stub raises when a test reaches a method it did not stub. */
class NotStubbed extends Schema.TaggedError<NotStubbed, { readonly brand: unique symbol }>()(
  "NotStubbed",
  {
    method: Schema.String,
  },
) {}

/**
 * A `LanguageModel` service whose `generateObject` resolves to the given value,
 * wrapped in a `GenerateObjectResponse` carrying `content` (response parts
 * such as metadata). `onCall` captures each request's
 * `prompt`, `objectName` and `schema` for pass-through assertions (the
 * schema lets a test decode a raw wire payload the way a real
 * `LanguageModel` would).
 */
export const stubLanguageModel = (
  value: unknown,
  onCall?: (request: {
    readonly prompt: unknown;
    readonly objectName: unknown;
    readonly schema: Schema.Codec<unknown, unknown>;
  }) => void,
  content: ReadonlyArray<Response.AnyPart> = [],
): LanguageModel.LanguageModel =>
  LanguageModel.LanguageModel.of({
    [LanguageModel.TypeId]: LanguageModel.TypeId,
    // SAFETY: `generateObject` is generic in the caller's schema; this stub
    // answers every instantiation with the one value the test supplied.
    generateObject: ((options: {
      prompt: unknown;
      objectName: unknown;
      schema: Schema.Codec<unknown, unknown>;
    }) => {
      onCall?.({
        prompt: options.prompt,
        objectName: options.objectName,
        schema: options.schema,
      });
      // SAFETY: the parts are the test's own `Response.AnyPart`s, which the
      // response's part type (generic in the toolkit) cannot name here.
      return Effect.succeed(new LanguageModel.GenerateObjectResponse(value, [...content] as never));
    }) as never,
    generateText: () => Effect.die(new NotStubbed({ method: "generateText" })),
    streamText: () => Stream.die(new NotStubbed({ method: "streamText" })),
  });

/** A `LanguageModel` service whose `generateObject` fails with an `AiError`. */
export const failingLanguageModel = (): LanguageModel.LanguageModel =>
  LanguageModel.LanguageModel.of({
    [LanguageModel.TypeId]: LanguageModel.TypeId,
    // SAFETY: a failure is valid for every instantiation of the generic `generateObject`.
    generateObject: (() =>
      Effect.fail(
        AiError.make({
          module: "test",
          method: "generateObject",
          reason: new AiError.UnknownError({ description: "stubbed failure" }),
        }),
      )) as never,
    generateText: () => Effect.die(new NotStubbed({ method: "generateText" })),
    streamText: () => Stream.die(new NotStubbed({ method: "streamText" })),
  });
