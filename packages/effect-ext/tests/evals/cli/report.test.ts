/**
 * Unit tests for `cli/Report.writeJsonReport`: creates the output's parent
 * directory when missing, writes the `CliReport` as JSON (with an
 * all-errored metric's `summary` as `null`, matching `Reporter.json`'s own
 * convention), and never fails the run — a write failure logs a warning
 * instead.
 *
 * @module tests/cli/report
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import type { CliReport } from "../../../src/evals/cli/Report.ts";
import { writeJsonReport } from "../../../src/evals/cli/Report.ts";
import { runTest } from "../helpers/effect.ts";

const passingReport: CliReport = {
  ran: [
    {
      file: "packages/jobs/evals/translate.eval.ts",
      suites: [
        {
          suite: "translation-quality",
          passed: true,
          durationMillis: 5,
          cases: [],
        },
      ],
    },
  ],
  skipped: [
    {
      file: "packages/ai/evals/rag.eval.ts",
      suites: ["rag-quality"],
      reason: "missing CF_AIG_TOKEN",
    },
  ],
  failed: [],
  passed: true,
};

describe("Report.writeJsonReport", () => {
  it("writes the report as JSON, ensuring the parent directory exists first", async () => {
    const created: Array<string> = [];
    const written: Array<{ path: string; content: string }> = [];

    const testFs = FileSystem.layerNoop({
      makeDirectory: (path) =>
        Effect.sync(() => {
          created.push(path);
        }),
      writeFileString: (path, content) =>
        Effect.sync(() => {
          written.push({ path, content });
        }),
    });

    await runTest(
      writeJsonReport(".effect-evals/results.json", passingReport).pipe(
        Effect.provide(Layer.merge(testFs, Path.layer)),
      ),
    );

    expect(created).toEqual([".effect-evals"]);
    expect(written.map((file) => file.path)).toEqual([".effect-evals/results.json"]);
    expect(
      written.map((file) => Schema.decodeSync(Schema.fromJsonString(Schema.Unknown))(file.content)),
    ).toEqual([passingReport]);
  });

  it("does not create a directory when the output path has no directory component", async () => {
    let createCalled = false;
    const written: Array<{ path: string; content: string }> = [];

    const testFs = FileSystem.layerNoop({
      makeDirectory: () =>
        Effect.sync(() => {
          createCalled = true;
        }),
      writeFileString: (path, content) =>
        Effect.sync(() => {
          written.push({ path, content });
        }),
    });

    await runTest(
      writeJsonReport("results.json", passingReport).pipe(
        Effect.provide(Layer.merge(testFs, Path.layer)),
      ),
    );

    expect(createCalled).toBe(false);
    expect(written.map((file) => file.path)).toEqual(["results.json"]);
  });

  it("logs a warning instead of failing when the write itself fails", async () => {
    const testFs = FileSystem.layerNoop({
      makeDirectory: () => Effect.void,
      writeFileString: () =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "Unknown",
            module: "FileSystem",
            method: "writeFileString",
          }),
        ),
    });

    // Should not throw — writeJsonReport's error channel is `never`.
    await expect(
      runTest(
        writeJsonReport("out.json", passingReport).pipe(
          Effect.provide(Layer.merge(testFs, Path.layer)),
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
