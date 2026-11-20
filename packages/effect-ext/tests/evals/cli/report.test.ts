/**
 * Unit tests for `cli/Report.writeJsonReport`: creates the output's parent
 * directory when missing, writes the `CliReport` as JSON (with an
 * all-errored metric's `summary` as `null`, matching `Reporter.json`'s own
 * convention), and never fails the run — a write failure logs a warning
 * instead.
 *
 * @module tests/cli/report
 */

import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import type { CliReport } from "../../../src/evals/cli/Report.ts";
import { writeJsonReport } from "../../../src/evals/cli/Report.ts";

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

layer(Path.layer)("Report.writeJsonReport", (t) => {
  t.effect("writes the report as JSON, ensuring the parent directory exists first", () =>
    Effect.gen(function* () {
      const created: Array<string> = [];
      const written: Array<{ path: string; content: string }> = [];

      const testFs = FileSystem.makeNoop({
        makeDirectory: (path) =>
          Effect.sync(() => {
            created.push(path);
          }),
        writeFileString: (path, content) =>
          Effect.sync(() => {
            written.push({ path, content });
          }),
      });

      yield* writeJsonReport(".effect-evals/results.json", passingReport).pipe(
        Effect.provideService(FileSystem.FileSystem, testFs),
      );

      expect(created).toEqual([".effect-evals"]);
      expect(written.map((file) => file.path)).toEqual([".effect-evals/results.json"]);
      expect(
        written.map((file) =>
          Schema.decodeSync(Schema.fromJsonString(Schema.Unknown))(file.content),
        ),
      ).toEqual([passingReport]);
    }),
  );

  t.effect("does not create a directory when the output path has no directory component", () =>
    Effect.gen(function* () {
      let createCalled = false;
      const written: Array<{ path: string; content: string }> = [];

      const testFs = FileSystem.makeNoop({
        makeDirectory: () =>
          Effect.sync(() => {
            createCalled = true;
          }),
        writeFileString: (path, content) =>
          Effect.sync(() => {
            written.push({ path, content });
          }),
      });

      yield* writeJsonReport("results.json", passingReport).pipe(
        Effect.provideService(FileSystem.FileSystem, testFs),
      );

      expect(createCalled).toBe(false);
      expect(written.map((file) => file.path)).toEqual(["results.json"]);
    }),
  );

  t.effect("logs a warning instead of failing when the write itself fails", () =>
    Effect.gen(function* () {
      const testFs = FileSystem.makeNoop({
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
      expect(
        yield* writeJsonReport("out.json", passingReport).pipe(
          Effect.provideService(FileSystem.FileSystem, testFs),
        ),
      ).toBeUndefined();
    }),
  );
});
