/**
 * Unit tests for the `run` command's flag/argument parsing (`cli/Flags.ts`):
 * defaults, `--trials`/`--concurrency` as optional integers, `--force`,
 * repeatable `--reporter`, `--filter`, and `--out`. Parses through a probe
 * command sharing the real `Flags` definitions with a trivial handler that
 * just captures the parsed config — so this never touches file discovery,
 * loading, or suite execution (see `tests/cli/run.test.ts` for that).
 *
 * @module tests/cli/flags
 */

import { assert, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command } from "effect/cli";
import { NodeServices } from "@effect/platform-node";
import * as Flags from "../../../src/evals/cli/Flags.ts";

interface Captured {
  readonly globs: ReadonlyArray<string>;
  readonly trials: Option.Option<number>;
  readonly concurrency: Option.Option<number>;
  readonly force: boolean;
  readonly reporter: ReadonlyArray<"json" | "terminal">;
  readonly filter: Option.Option<string>;
  readonly out: string;
}

let captured = Option.none<Captured>();

const probeCommand = Command.make(
  "probe",
  {
    globs: Flags.globs,
    trials: Flags.trials,
    concurrency: Flags.concurrency,
    force: Flags.force,
    reporter: Flags.reporter,
    filter: Flags.filter,
    out: Flags.out,
  },
  (config) =>
    Effect.sync(() => {
      captured = Option.some(config);
    }),
);

/** The config the probe captured on the last {@link parse}; fails the test if the probe never ran. */
const parsed = (): Captured => {
  assert(Option.isSome(captured), "the probe command never ran");
  return captured.value;
};

const parse = (args: ReadonlyArray<string>) =>
  Command.runWith(probeCommand, { version: "0.0.0" })(args);

layer(NodeServices.layer)("cli/Flags — run command parsing", (t) => {
  t.effect(
    "defaults: no globs, no trials/concurrency/filter override, force off, no reporter selection, default out",
    () =>
      Effect.gen(function* () {
        yield* parse([]);

        expect(parsed().globs).toEqual([]);
        expect(Option.isNone(parsed().trials)).toBe(true);
        expect(Option.isNone(parsed().concurrency)).toBe(true);
        expect(parsed().force).toBe(false);
        expect(parsed().reporter).toEqual([]);
        expect(Option.isNone(parsed().filter)).toBe(true);
        expect(parsed().out).toBe(".effect-evals/results.json");
      }),
  );

  t.effect("parses variadic positional globs", () =>
    Effect.gen(function* () {
      yield* parse(["packages/jobs/evals/*.eval.ts", "packages/ai/evals/*.eval.ts"]);

      expect(parsed().globs).toEqual([
        "packages/jobs/evals/*.eval.ts",
        "packages/ai/evals/*.eval.ts",
      ]);
    }),
  );

  t.effect("parses --trials and --concurrency as integers", () =>
    Effect.gen(function* () {
      yield* parse(["--trials", "5", "--concurrency", "2"]);

      expect(Option.getOrUndefined(parsed().trials)).toBe(5);
      expect(Option.getOrUndefined(parsed().concurrency)).toBe(2);
    }),
  );

  t.effect("parses --force", () =>
    Effect.gen(function* () {
      yield* parse(["--force"]);
      expect(parsed().force).toBe(true);
    }),
  );

  t.effect("parses repeated --reporter flags", () =>
    Effect.gen(function* () {
      yield* parse(["--reporter", "terminal", "--reporter", "json"]);
      expect(parsed().reporter).toEqual(["terminal", "json"]);
    }),
  );

  t.effect("parses --filter", () =>
    Effect.gen(function* () {
      yield* parse(["--filter", "translation"]);
      expect(Option.getOrUndefined(parsed().filter)).toBe("translation");
    }),
  );

  t.effect("parses --out, overriding the default", () =>
    Effect.gen(function* () {
      yield* parse(["--out", "./tmp/report.json"]);
      expect(parsed().out).toBe("./tmp/report.json");
    }),
  );

  t.effect("parses flags together with globs", () =>
    Effect.gen(function* () {
      yield* parse(["--trials", "3", "--force", "packages/jobs/evals/*.eval.ts"]);

      expect(Option.getOrUndefined(parsed().trials)).toBe(3);
      expect(parsed().force).toBe(true);
      expect(parsed().globs).toEqual(["packages/jobs/evals/*.eval.ts"]);
    }),
  );
});
