/**
 * Unit tests for `cli/LoadEvalFile`: `validateEvalFile`'s structural checks
 * against plain candidate objects (every branch — malformed `suites`,
 * `layer`, and `options`), and `loadEvalFile`'s dynamic-import path — a
 * valid fixture loads, a missing file and a contract-violating default
 * export both fail with typed errors instead of throwing.
 *
 * @module tests/cli/load-eval-file
 */

import { describe, expect, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { NodePath } from "@effect/platform-node";
import {
  EvalFileImportError,
  InvalidEvalFileError,
  loadEvalFile,
  validateEvalFile,
} from "../../../src/evals/cli/LoadEvalFile.ts";
import { expectFailureInstanceOf } from "../helpers/effect.ts";

const validSuite = { name: "s", dataset: {}, task: {}, metrics: [] };

/** A `Path` whose `toFileUrl` rejects every path. */
const rejectingToFileUrl = Layer.effect(
  Path.Path,
  Effect.map(Path.Path, (path) =>
    Path.Path.of({
      ...path,
      toFileUrl: () =>
        Effect.fail(
          new PlatformError.BadArgument({
            module: "Path",
            method: "toFileUrl",
            description: "stub",
          }),
        ),
    }),
  ),
).pipe(Layer.provide(NodePath.layer));

const FIXTURES = new URL("../fixtures/", import.meta.url);
const fixture = (name: string): string => new URL(name, FIXTURES).pathname;

describe("LoadEvalFile.loadEvalFile", () => {
  layer(NodePath.layer)((t) => {
    t.effect("loads a valid eval file's default export", () =>
      Effect.gen(function* () {
        const evalFile = yield* loadEvalFile(fixture("sample.eval.ts"));

        expect(evalFile.suites).toHaveLength(1);
        expect(evalFile.suites[0]?.name).toBe("fixture-greetings");
        expect(evalFile.layer).toBeDefined();
      }),
    );

    t.effect("fails with EvalFileImportError for a file that doesn't exist", () =>
      Effect.gen(function* () {
        const error = yield* expectFailureInstanceOf(
          loadEvalFile(fixture("does-not-exist.eval.ts")),
          EvalFileImportError,
        );
        expect(error.file).toBe(fixture("does-not-exist.eval.ts"));
      }),
    );
  });

  layer(rejectingToFileUrl)((t) => {
    t.effect("fails with EvalFileImportError when the path cannot become a file URL", () =>
      Effect.gen(function* () {
        const error = yield* expectFailureInstanceOf(
          loadEvalFile(fixture("sample.eval.ts")),
          EvalFileImportError,
        );
        expect(error.file).toBe(fixture("sample.eval.ts"));
        expect(error.cause).toBeInstanceOf(PlatformError.BadArgument);
      }),
    );
  });

  layer(NodePath.layer)((t) => {
    t.effect(
      "fails with InvalidEvalFileError when the default export doesn't satisfy the contract",
      () =>
        Effect.gen(function* () {
          const error = yield* expectFailureInstanceOf(
            loadEvalFile(fixture("invalid.eval.ts")),
            InvalidEvalFileError,
          );
          expect(error.reason).toContain("layer");
        }),
    );
  });
});

describe("LoadEvalFile.validateEvalFile", () => {
  it("accepts a well-formed eval file, with and without options", () => {
    expect(validateEvalFile({ suites: [validSuite], layer: Layer.empty })).toBe(true);
    expect(validateEvalFile({ suites: [validSuite], layer: Layer.empty, options: {} })).toBe(true);
  });

  it("rejects non-object candidates", () => {
    expect(validateEvalFile(undefined)).toBe(false);
    expect(validateEvalFile(null)).toBe(false);
    expect(validateEvalFile("not an object")).toBe(false);
  });

  it("rejects a missing or non-array suites", () => {
    expect(validateEvalFile({ layer: Layer.empty })).toBe(false);
    expect(validateEvalFile({ suites: "not-an-array", layer: Layer.empty })).toBe(false);
  });

  it("rejects a suites array containing a non-Suite element", () => {
    expect(validateEvalFile({ suites: [{ name: "s" }], layer: Layer.empty })).toBe(false);
    expect(validateEvalFile({ suites: [validSuite, {}], layer: Layer.empty })).toBe(false);
  });

  it("rejects a missing or non-Layer layer", () => {
    expect(validateEvalFile({ suites: [validSuite] })).toBe(false);
    expect(validateEvalFile({ suites: [validSuite], layer: {} })).toBe(false);
    expect(validateEvalFile({ suites: [validSuite], layer: "not-a-layer" })).toBe(false);
  });

  it("rejects a non-object options", () => {
    expect(validateEvalFile({ suites: [validSuite], layer: Layer.empty, options: "nope" })).toBe(
      false,
    );
  });
});
