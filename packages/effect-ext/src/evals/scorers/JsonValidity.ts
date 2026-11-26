/**
 * `jsonValidity` — does a case's `output` parse as JSON at all? The cheapest
 * possible sanity check before a stricter {@link SchemaMatch.schemaMatch}
 * decode (autoevals' `JSONDiff` family starts from the same "is it even
 * JSON" question). An unparseable `output` scores `0` with the parse error
 * as `reason`. Anything thrown while reading the case is not a verdict on the
 * output, so it is a defect that fails the run rather than a silent `0`.
 *
 * @module scorers/JsonValidity
 *
 * @copyright Thomas Foster
 *
 * @since 0.1.0
 */

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { Score } from "../Score.ts";
import * as Scorer from "../Scorer.ts";

/**
 * The shape `jsonValidity` needs from a case: a string `output` to attempt to parse.
 *
 * @since 0.1.0
 */
export interface JsonCase {
  readonly output: string;
}

const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

/**
 * Whether `evalCase.output` parses as JSON.
 *
 * @since 0.1.0
 */
export const jsonValidity: Scorer.Scorer<JsonCase> = Scorer.makeScorer({
  name: "json-validity",
  evaluate: (evalCase) =>
    Effect.sync(() =>
      Result.match(decodeJson(evalCase.output), {
        onSuccess: (): Score => ({ score: 1 }),
        onFailure: (error): Score => ({ score: 0, reason: error.message }),
      }),
    ),
});
