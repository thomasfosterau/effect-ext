/**
 * End-to-end tests for the `run` command (`cli/RunCommand.ts`) as a whole:
 * flags parsed through `Command.runWith`, real fixture files loaded and run
 * through a stubbed `LanguageModel` and an in-memory cache (no network,
 * no real disk — the JSON reporter's `FileSystem` is `FileSystem.makeNoop`,
 * captured in-memory), terminal + skip/fail line output, and
 * `process.exitCode` set iff the run failed.
 *
 * @module tests/cli/run-command
 */

import { afterEach, beforeEach, expect, vi } from "@effect/vitest";
import { describeLayerPerTest } from "../helpers/layerPerTest.ts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Command } from "effect/cli";
import { NodeServices } from "@effect/platform-node";
import { Cache } from "../../../src/evals/index.ts";
import { runCommand } from "../../../src/evals/cli/RunCommand.ts";

const FIXTURES = new URL("../fixtures/", import.meta.url);
const fixture = (name: string): string => new URL(name, FIXTURES).pathname;

/** The slice of the JSON report these tests read; other fields pass through undecoded. */
const RunReport = Schema.Struct({
  isPassed: Schema.Boolean,
  ran: Schema.Array(
    Schema.Struct({ suites: Schema.Array(Schema.Struct({ suite: Schema.String })) }),
  ),
}).pipe(Schema.encodeKeys({ isPassed: "passed" }));

let originalExitCode: typeof process.exitCode;

beforeEach(() => {
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
});

/** Runs `run` with `args`, with a captured, disk-free `FileSystem` for JSON output. */
const runCli = (
  args: ReadonlyArray<string>,
  writes: Array<{ path: string; content: string }> = [],
) =>
  Effect.gen(function* () {
    // The suite's `describeLayerPerTest(...)` block provides the real Node services;
    // discovery globs through them, and this double, the innermost provider,
    // keeps the JSON report off the disk.
    const nodeFs = yield* FileSystem.FileSystem;
    const testFs = FileSystem.makeNoop({
      glob: nodeFs.glob,
      writeFileString: (path, content) =>
        Effect.sync(() => {
          writes.push({ path: path, content });
        }),
      makeDirectory: () => Effect.void,
    });
    return yield* Command.runWith(runCommand, { version: "0.0.0" })(args).pipe(
      Effect.provideService(FileSystem.FileSystem, testFs),
    );
  });

describeLayerPerTest(Layer.merge(NodeServices.layer, Cache.layerMemory), { live: true })(
  "cli/RunCommand — run",
  (t) => {
    t.effect("prints the terminal report and leaves exitCode unset for a passing run", () =>
      Effect.gen(function* () {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        yield* runCli(["run", fixture("sample.eval.ts"), "--reporter", "terminal"]);

        const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
        expect(output).toContain("fixture-greetings");
        expect(output).toContain("PASS");
        expect(process.exitCode).toBeUndefined();
      }),
    );

    t.effect("sets exitCode to 1 when an executed suite fails its threshold", () =>
      Effect.gen(function* () {
        vi.spyOn(console, "log").mockImplementation(() => {});

        yield* runCli(["run", fixture("failing.eval.ts"), "--reporter", "terminal"]);

        expect(process.exitCode).toBe(1);
      }),
    );

    t.effect("prints a SKIP line for a credential-gated file and leaves exitCode unset", () =>
      Effect.gen(function* () {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        yield* runCli(["run", fixture("config-gated.eval.ts")]);

        const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
        expect(output).toContain("SKIP");
        expect(output).toContain("config-gated.eval.ts");
        expect(output).toContain("EFFECT_EVALS_FIXTURE_NEVER_SET_TOKEN");
        expect(process.exitCode).toBeUndefined();
      }),
    );

    t.effect("prints a FAIL line and sets exitCode for a file that fails to load", () =>
      Effect.gen(function* () {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        yield* runCli(["run", fixture("invalid.eval.ts")]);

        const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
        expect(output).toContain("FAIL");
        expect(output).toContain("invalid.eval.ts");
        expect(process.exitCode).toBe(1);
      }),
    );

    t.effect("--reporter json writes the combined report and skips the terminal table", () =>
      Effect.gen(function* () {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const writes: Array<{ path: string; content: string }> = [];

        yield* runCli(
          ["run", fixture("sample.eval.ts"), "--reporter", "json", "--out", "out.json"],
          writes,
        );

        expect(writes).toHaveLength(1);
        expect(writes[0]?.path).toBe("out.json");
        const parsed = yield* Schema.decodeEffect(Schema.fromJsonString(RunReport))(
          writes[0]?.content ?? "{}",
        );
        expect(parsed.isPassed).toBe(true);
        expect(parsed.ran[0]?.suites[0]?.suite).toBe("fixture-greetings");

        const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
        expect(output).not.toContain("fixture-greetings");
      }),
    );

    t.effect("defaults to both terminal and json when --reporter is omitted", () =>
      Effect.gen(function* () {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const writes: Array<{ path: string; content: string }> = [];

        yield* runCli(["run", fixture("sample.eval.ts")], writes);

        expect(writes).toHaveLength(1);
        const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
        expect(output).toContain("fixture-greetings");
      }),
    );
  },
);
