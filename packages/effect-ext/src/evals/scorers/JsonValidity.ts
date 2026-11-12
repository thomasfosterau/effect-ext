/**
 * `jsonValidity` — does a case's `output` parse as JSON at all? The cheapest
 * possible sanity check before a stricter {@link SchemaMatch.schemaMatch}
 * decode (autoevals' `JSONDiff` family starts from the same "is it even
 * JSON" question). An unparseable `output` (the `SyntaxError` `JSON.parse`
 * throws) scores `0` with the parse error as `reason`. Anything else thrown
 * while parsing is not a verdict on the output, so it is a defect that
 * fails the run rather than a silent `0` (#98).
 *
 * @module scorers/JsonValidity
 *
 * @copyright Thomas Foster
 *
 * @since 0.1.0
 */

import * as Effect from "effect/Effect";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Scorer from "../Scorer.ts";

/**
 * The shape `jsonValidity` needs from a case: a string `output` to attempt to parse.
 *
 * @since 0.1.0
 */
export interface JsonCase {
  readonly output: string;
}

/** `JSON.parse` threw; `syntax` is whether it was the `SyntaxError` unparseable text raises. */
class JsonParseFailed extends Schema.TaggedError<
  JsonParseFailed,
  { readonly brand: unique symbol }
>()("JsonParseFailed", { message: Schema.String, syntax: Schema.Boolean }) {}

/**
 * Whether `evalCase.output` parses as JSON.
 *
 * @since 0.1.0
 */
export const jsonValidity: Scorer.Scorer<JsonCase> = Scorer.makeScorer({
  name: "json-validity",
  evaluate: (evalCase) =>
    Effect.try({
      try: (): void => {
        JSON.parse(evalCase.output);
      },
      catch: (cause) =>
        new JsonParseFailed({
          message: P.isError(cause) ? cause.message : String(cause),
          syntax: cause instanceof SyntaxError,
        }),
    }).pipe(
      Effect.map(() => ({ score: 1 })),
      Effect.catchIf(
        (error) => error.syntax,
        (error) => Effect.succeed({ score: 0, reason: error.message }),
      ),
      Effect.orDie,
    ),
});
