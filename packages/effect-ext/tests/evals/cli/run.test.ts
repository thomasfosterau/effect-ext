/**
 * Unit tests for `cli/Run.runEvals`: the framework-agnostic orchestration
 * behind the `run` command, against the real fixture files in
 * `tests/fixtures/`. Covers the pass/fail/skip/failed-to-load outcomes, the
 * `--filter` substring match, `--trials` propagation, and `--force`
 * bypassing the cache — end to end, with an in-memory cache and a stubbed
 * `LanguageModel` (no network reached).
 *
 * @module tests/cli/run
 */

import { expect } from "@effect/vitest";
import { describeLayerPerTest } from "../helpers/layerPerTest.ts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Cache } from "../../../src/evals/index.ts";
import { runEvals } from "../../../src/evals/cli/Run.ts";

/** The in-memory result cache plus the `Path` service discovery and loading read. */
const testLayer = Layer.mergeAll(Cache.layerMemory, NodeFileSystem.layer, NodePath.layer);

const FIXTURES = new URL("../fixtures/", import.meta.url);
const fixture = (name: string): string => new URL(name, FIXTURES).pathname;

const baseConfig = {
  trials: Option.none<number>(),
  concurrency: Option.none<number>(),
  force: false,
  filter: Option.none<string>(),
};

describeLayerPerTest(testLayer)("cli/Run.runEvals", (t) => {
  t.effect("runs a passing suite through a stubbed LanguageModel layer", () =>
    Effect.gen(function* () {
      const report = yield* runEvals({ ...baseConfig, globs: [fixture("sample.eval.ts")] });

      expect(report.passed).toBe(true);
      expect(report.skipped).toEqual([]);
      expect(report.failed).toEqual([]);
      expect(report.ran).toHaveLength(1);
      expect(report.ran[0]?.suites[0]?.suite).toBe("fixture-greetings");
      expect(report.ran[0]?.suites[0]?.passed).toBe(true);
    }),
  );

  t.effect("reports a layer failure that is neither an Error nor a string as JSON", () =>
    Effect.gen(function* () {
      const report = yield* runEvals({
        ...baseConfig,
        globs: [fixture("object-layer-failure.eval.ts")],
      });

      expect(report.passed).toBe(false);
      expect(report.failed).toEqual([
        { file: fixture("object-layer-failure.eval.ts"), error: '{"code":42}' },
      ]);
    }),
  );

  t.effect("falls back to String(value) for a layer failure JSON cannot serialise", () =>
    Effect.gen(function* () {
      const report = yield* runEvals({
        ...baseConfig,
        globs: [fixture("bigint-layer-failure.eval.ts")],
      });

      expect(report.failed).toEqual([
        { file: fixture("bigint-layer-failure.eval.ts"), error: "1" },
      ]);
    }),
  );

  t.effect("marks the run failed when an executed suite misses its threshold", () =>
    Effect.gen(function* () {
      const report = yield* runEvals({ ...baseConfig, globs: [fixture("failing.eval.ts")] });

      expect(report.passed).toBe(false);
      expect(report.ran).toHaveLength(1);
      expect(report.ran[0]?.suites[0]?.passed).toBe(false);
      expect(report.failed).toEqual([]);
      expect(report.skipped).toEqual([]);
    }),
  );

  t.effect(
    "skips a file whose layer fails with a ConfigError, naming the missing config, and does not fail the run",
    () =>
      Effect.gen(function* () {
        const report = yield* runEvals({
          ...baseConfig,
          globs: [fixture("config-gated.eval.ts")],
        });

        expect(report.ran).toEqual([]);
        expect(report.failed).toEqual([]);
        expect(report.skipped).toHaveLength(1);
        expect(report.skipped[0]?.suites).toEqual(["config-gated-suite"]);
        expect(report.skipped[0]?.reason).toContain("EFFECT_EVALS_FIXTURE_NEVER_SET_TOKEN");
        expect(report.passed).toBe(true);
      }),
  );

  t.effect("records a file that fails to load/validate as failed, and fails the run", () =>
    Effect.gen(function* () {
      const report = yield* runEvals({ ...baseConfig, globs: [fixture("invalid.eval.ts")] });

      expect(report.ran).toEqual([]);
      expect(report.skipped).toEqual([]);
      expect(report.failed).toHaveLength(1);
      expect(report.passed).toBe(false);
    }),
  );

  t.effect("--filter excludes files whose every suite name misses the substring", () =>
    Effect.gen(function* () {
      const report = yield* runEvals({
        ...baseConfig,
        globs: [fixture("sample.eval.ts")],
        filter: Option.some("does-not-match-anything"),
      });

      expect(report.ran).toEqual([]);
      expect(report.skipped).toEqual([]);
      expect(report.failed).toEqual([]);
      expect(report.passed).toBe(true);
    }),
  );

  t.effect("--filter runs only suites whose name contains the substring", () =>
    Effect.gen(function* () {
      const report = yield* runEvals({
        ...baseConfig,
        globs: [fixture("sample.eval.ts")],
        filter: Option.some("fixture-greet"),
      });

      expect(report.ran).toHaveLength(1);
      expect(report.ran[0]?.suites[0]?.suite).toBe("fixture-greetings");
    }),
  );

  t.effect("--trials overrides the eval file's own default", () =>
    Effect.gen(function* () {
      const report = yield* runEvals({
        ...baseConfig,
        globs: [fixture("sample.eval.ts")],
        trials: Option.some(3),
      });

      expect(report.ran[0]?.suites[0]?.cases[0]?.trials).toBe(3);
    }),
  );

  t.effect("force: true bypasses the cache even after a prior run populated it", () =>
    Effect.gen(function* () {
      const config = { ...baseConfig, globs: [fixture("sample.eval.ts")] };

      const [first, second, third] = yield* Effect.gen(function* () {
        const r1 = yield* runEvals(config);
        const r2 = yield* runEvals(config);
        const r3 = yield* runEvals({ ...config, force: true });
        return [r1, r2, r3] as const;
      });

      const trialOf = (report: typeof first) =>
        report.ran[0]?.suites[0]?.cases[0]?.metrics[0]?.trials[0];

      expect(trialOf(first)).toMatchObject({ cached: false });
      expect(trialOf(second)).toMatchObject({ cached: true });
      expect(trialOf(third)).toMatchObject({ cached: false });
    }),
  );

  t.effect(
    "returns a failed-run report instead of throwing when glob discovery itself errors",
    () =>
      Effect.gen(function* () {
        const report = yield* runEvals({ ...baseConfig, globs: [fixture("sample.eval.ts")] }).pipe(
          Effect.provideService(
            FileSystem.FileSystem,
            FileSystem.makeNoop({
              glob: () =>
                Effect.fail(
                  PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "glob",
                  }),
                ),
            }),
          ),
        );

        expect(report.passed).toBe(false);
        expect(report.failed).toHaveLength(1);
      }),
  );
});
