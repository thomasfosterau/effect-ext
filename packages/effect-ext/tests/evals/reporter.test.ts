/**
 * Unit tests for `Reporter`: the terminal table formatter, `terminal`'s
 * stdout sink, and `json`'s `FileSystem`-backed write (stubbed via
 * `FileSystem.makeNoop` — no real disk I/O).
 *
 * @module tests/reporter
 */

import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { Reporter, Result } from "../../src/evals/index.ts";

const parseJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const passingSummary = { mean: 0.9, variance: 0.01, stddev: 0.1, min: 0.8, max: 1 };

const passingResult: Result.SuiteResult = {
  suite: "greetings",
  passed: true,
  durationMillis: 42,
  cases: [
    {
      golden: { input: "Bonjour" },
      trials: 2,
      passed: true,
      taskOutputs: [],
      taskFailures: [],
      metrics: [
        {
          metric: "exact-match",
          passed: true,
          errorCount: 0,
          summary: Option.some(passingSummary),
          trials: [
            { _tag: "Scored", trial: 1, cached: false, score: { score: 0.8, reason: "close" } },
            { _tag: "Scored", trial: 2, cached: true, score: { score: 1, reason: "exact" } },
          ],
        },
      ],
    },
  ],
};

describe("Reporter.formatTerminalTable", () => {
  it("renders the suite verdict, each case, and each metric row", () => {
    const table = Reporter.formatTerminalTable(passingResult);
    expect(table).toContain("greetings");
    expect(table).toContain("PASS");
    expect(table).toContain("exact-match");
    expect(table).toContain("exact");
  });

  it("surfaces task failures and errored metric trials", () => {
    const table = Reporter.formatTerminalTable({
      suite: "greetings",
      passed: false,
      durationMillis: 10,
      cases: [
        {
          golden: { input: "Bonjour" },
          trials: 1,
          passed: false,
          taskOutputs: [],
          taskFailures: [{ trial: 1, error: "boom" }],
          metrics: [
            {
              metric: "exact-match",
              passed: false,
              errorCount: 1,
              summary: Option.none(),
              trials: [{ _tag: "Errored", trial: 1, cached: false, error: "judge unavailable" }],
            },
          ],
        },
      ],
    });
    expect(table).toContain("FAIL");
    expect(table).toContain("boom");
    expect(table).toContain("judge unavailable");
  });
});

describe("Reporter.terminal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.live("logs the formatted table to stdout", () =>
    Effect.gen(function* () {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      yield* Reporter.terminal.report(passingResult);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain("greetings");
    }),
  );
});

describe("Reporter.json", () => {
  it.effect("writes the result as JSON to the given path", () =>
    Effect.gen(function* () {
      const written: Array<{ path: string; content: string }> = [];
      const testFs = FileSystem.makeNoop({
        writeFileString: (path, content) =>
          Effect.sync(() => {
            written.push({ path, content });
          }),
      });

      yield* Reporter.json("./results.json")
        .report(passingResult)
        .pipe(Effect.provideService(FileSystem.FileSystem, testFs));

      expect(written.map((file) => file.path)).toEqual(["./results.json"]);
      // The summary is written as the summary itself, not as an `Option` envelope.
      expect(written.map((file) => parseJson(file.content))).toEqual([
        {
          ...passingResult,
          cases: [
            {
              ...passingResult.cases[0],
              metrics: [{ ...passingResult.cases[0]?.metrics[0], summary: passingSummary }],
            },
          ],
        },
      ]);
    }),
  );

  it.effect("writes an all-errored metric's summary as null, not an omitted key", () =>
    Effect.gen(function* () {
      const erroredResult: Result.SuiteResult = {
        suite: "greetings",
        passed: false,
        durationMillis: 5,
        cases: [
          {
            golden: { input: "Bonjour" },
            trials: 1,
            passed: false,
            taskOutputs: [],
            taskFailures: [],
            metrics: [
              {
                metric: "exact-match",
                passed: false,
                errorCount: 1,
                summary: Option.none(),
                trials: [{ _tag: "Errored", trial: 1, cached: false, error: "judge unavailable" }],
              },
            ],
          },
        ],
      };

      let written = "";
      const testFs = FileSystem.makeNoop({
        writeFileString: (_path, content) =>
          Effect.sync(() => {
            written = content;
          }),
      });

      yield* Reporter.json("./results.json")
        .report(erroredResult)
        .pipe(Effect.provideService(FileSystem.FileSystem, testFs));

      const parsed = parseJson(written) as {
        cases: Array<{ metrics: Array<Record<string, unknown>> }>;
      };
      expect(parsed.cases[0]?.metrics[0]).toHaveProperty("summary", null);
    }),
  );

  it.effect("logs a warning instead of failing when the write fails", () =>
    Effect.gen(function* () {
      const testFs = FileSystem.makeNoop({
        writeFileString: () =>
          Effect.fail(
            PlatformError.systemError({
              _tag: "Unknown",
              module: "FileSystem",
              method: "writeFileString",
            }),
          ),
      });

      // Should not throw — the reporter's error channel is `never`.
      expect(
        yield* Reporter.json("./results.json")
          .report(passingResult)
          .pipe(Effect.provideService(FileSystem.FileSystem, testFs)),
      ).toBeUndefined();
    }),
  );
});
