/**
 * Unit tests for `JsonValidity.jsonValidity`.
 *
 * @module tests/scorers/json-validity
 */

import { describe, expect, it } from "@effect/vitest";
import { describeLayerPerTest } from "../helpers/layerPerTest.ts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import {
  Cache,
  Dataset,
  JsonValidity,
  Metric,
  Runner,
  Scorer,
  Threshold,
} from "../../../src/evals/index.ts";

/**
 * A case whose `output` cannot even be read: the getter throws a plain
 * `Error`, not the `SyntaxError` of unparseable text. It stands in for a
 * failure that is no verdict on the output (a bug in a case adapter).
 */
class AdapterBug extends Schema.TaggedError<AdapterBug>()("AdapterBug", {
  message: Schema.String,
}) {}

const unreadableCase = (): JsonValidity.JsonCase => ({
  get output(): string {
    throw new AdapterBug({ message: "boom: unreadable output" });
  },
});

const jsonSuite = (
  toCase: (evalCase: Runner.EvaluatedCase<string, string>) => JsonValidity.JsonCase,
) =>
  Runner.makeSuite({
    name: "json",
    dataset: Dataset.fromArray("json", ["{not valid json"]),
    task: Runner.makeTask<string, string>({ id: "json@v1", run: Effect.succeed }),
    metrics: [
      Metric.makeMetric({
        name: "json-validity",
        scorer: Scorer.contramap(JsonValidity.jsonValidity, toCase),
        threshold: Threshold.strict,
      }),
    ],
  });

describe("JsonValidity.jsonValidity", () => {
  it.effect("scores 1 for a valid JSON object", () =>
    Effect.gen(function* () {
      const score = yield* JsonValidity.jsonValidity.evaluate({
        output: '{"name":"Alice","age":30}',
      });
      expect(score).toEqual({ score: 1 });
    }),
  );

  it.effect("scores 1 for a valid JSON scalar", () =>
    Effect.gen(function* () {
      const score = yield* JsonValidity.jsonValidity.evaluate({ output: "42" });
      expect(score).toEqual({ score: 1 });
    }),
  );

  it.effect("scores 0 with the parse error as reason for invalid JSON", () =>
    Effect.gen(function* () {
      const score = yield* JsonValidity.jsonValidity.evaluate({ output: "{not valid json" });
      expect(score.score).toBe(0);
      expect(score.reason).toBeTruthy();
    }),
  );

  it.effect("reports the SyntaxError's own message as the reason", () =>
    Effect.gen(function* () {
      const score = yield* JsonValidity.jsonValidity.evaluate({ output: "{not valid json" });
      expect(score.reason).toMatch(/JSON/);
    }),
  );

  it.effect("dies, rather than scoring 0, when parsing throws anything but a SyntaxError", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(JsonValidity.jsonValidity.evaluate(unreadableCase()));
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) return;
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(String(Cause.squash(exit.cause))).toContain("boom: unreadable output");
    }),
  );

  it.effect("scores 0 for an empty string", () =>
    Effect.gen(function* () {
      const score = yield* JsonValidity.jsonValidity.evaluate({ output: "" });
      expect(score.score).toBe(0);
    }),
  );
});

describeLayerPerTest(Cache.layerMemory)("JsonValidity.jsonValidity — inside a run", (t) => {
  t.effect("an unparseable output scores 0 and the run completes", () =>
    Effect.gen(function* () {
      const result = yield* Runner.runSuite(
        jsonSuite((evalCase) => ({ output: evalCase.output })),
        { bypassCache: true },
      );
      expect(result.passed).toBe(false);
      expect(result.cases[0]?.metrics[0]?.trials[0]).toMatchObject({
        _tag: "Scored",
        score: { score: 0 },
      });
    }),
  );

  t.effect("an unexpected parse failure fails the run instead of scoring 0", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Runner.runSuite(jsonSuite(unreadableCase), { bypassCache: true }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) return;
      expect(Cause.hasDies(exit.cause)).toBe(true);
    }),
  );
});
