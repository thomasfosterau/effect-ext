/**
 * Unit tests for `SchemaMatch.schemaMatch` and `SchemaMatch.schemaMatchValue`.
 *
 * @module tests/scorers/schema-match
 */

import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { SchemaMatch } from "../../../src/evals/index.ts";

const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite });

class TransformationBug extends Schema.TaggedError<TransformationBug>()("TransformationBug", {
  message: Schema.String,
}) {}

/** A schema whose decode transformation dies: a bug, not a decode failure. */
const Exploding = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformEffect(() =>
      Effect.die(new TransformationBug({ message: "boom: transformation bug" })),
    ),
    encode: SchemaGetter.passthrough(),
  }),
);

const expectDie = (program: Effect.Effect<unknown>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(program);
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(String(Cause.squash(exit.cause))).toContain("boom: transformation bug");
  });

describe("SchemaMatch.schemaMatch", () => {
  it.effect("scores 1 when output decodes against the schema", () =>
    Effect.gen(function* () {
      const scorer = SchemaMatch.schemaMatch(Person);
      const score = yield* scorer.evaluate({ output: '{"name":"Alice","age":30}' });
      expect(score).toEqual({ score: 1 });
    }),
  );

  it.effect("scores 0 with the decode error as reason when a field is missing", () =>
    Effect.gen(function* () {
      const scorer = SchemaMatch.schemaMatch(Person);
      const score = yield* scorer.evaluate({ output: '{"name":"Alice"}' });
      expect(score.score).toBe(0);
      expect(score.reason).toBeTruthy();
    }),
  );

  it.effect("scores 0 with the decode error as reason when a field has the wrong type", () =>
    Effect.gen(function* () {
      const scorer = SchemaMatch.schemaMatch(Person);
      const score = yield* scorer.evaluate({ output: '{"name":"Alice","age":"thirty"}' });
      expect(score.score).toBe(0);
      expect(score.reason).toBeTruthy();
    }),
  );

  it.effect("scores 0 when output isn't valid JSON at all", () =>
    Effect.gen(function* () {
      const scorer = SchemaMatch.schemaMatch(Person);
      const score = yield* scorer.evaluate({ output: "not json" });
      expect(score.score).toBe(0);
      expect(score.reason).toBeTruthy();
    }),
  );

  it.effect("dies, rather than scoring 0, when the schema's transformation dies", () =>
    expectDie(SchemaMatch.schemaMatch(Exploding).evaluate({ output: '"x"' })),
  );
});

describe("SchemaMatch.schemaMatchValue", () => {
  it.effect("scores 1 when an already-structured output decodes against the schema", () =>
    Effect.gen(function* () {
      const scorer = SchemaMatch.schemaMatchValue(Person);
      const score = yield* scorer.evaluate({ output: { name: "Alice", age: 30 } });
      expect(score).toEqual({ score: 1 });
    }),
  );

  it.effect("scores 0 with the decode error as reason when a field is missing", () =>
    Effect.gen(function* () {
      const scorer = SchemaMatch.schemaMatchValue(Person);
      const score = yield* scorer.evaluate({ output: { name: "Alice" } });
      expect(score.score).toBe(0);
      expect(score.reason).toBeTruthy();
    }),
  );

  it.effect("scores 0 with the decode error as reason when a field has the wrong type", () =>
    Effect.gen(function* () {
      const scorer = SchemaMatch.schemaMatchValue(Person);
      const score = yield* scorer.evaluate({ output: { name: "Alice", age: "thirty" } });
      expect(score.score).toBe(0);
      expect(score.reason).toBeTruthy();
    }),
  );

  it.effect(
    "never round-trips through JSON.stringify — a value with a non-serializable field still decodes",
    () =>
      Effect.gen(function* () {
        const WithDate = Schema.Struct({ name: Schema.String, seenAt: Schema.Unknown });
        const scorer = SchemaMatch.schemaMatchValue(WithDate);
        const nonSerializable = {
          name: "Alice",
          seenAt: DateTime.toDateUtc(DateTime.makeUnsafe(0)),
        };
        const score = yield* scorer.evaluate({ output: nonSerializable });
        expect(score).toEqual({ score: 1 });
      }),
  );

  it.effect("dies, rather than scoring 0, when the schema's transformation dies", () =>
    expectDie(SchemaMatch.schemaMatchValue(Exploding).evaluate({ output: "x" })),
  );
});
