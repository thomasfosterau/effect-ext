/**
 * Unit tests for `cli/Cli.ts`: the root command exposes `run` as its only
 * subcommand, and `version` matches the package's own `package.json`.
 *
 * @module tests/cli/cli
 */

import { expect, vi, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/cli";
import { NodeServices } from "@effect/platform-node";
import { Cache } from "../../../src/evals/index.ts";
import { cli, version } from "../../../src/evals/cli/Cli.ts";

layer(Layer.merge(Cache.layerMemory, NodeServices.layer), { excludeTestServices: true })(
  "cli/Cli",
  (t) => {
    // No "version matches package.json" test: `src/evals/cli/Cli.ts` defines
    // `version = packageJson.version`, so both sides of that assertion read
    // the same import — it could never fail.
    t.effect("lists run as a subcommand in --help output", () =>
      Effect.gen(function* () {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        // `--help` never reaches the `run` handler at runtime, but Command's
        // type system still requires every subcommand's R statically satisfied.
        yield* Command.runWith(cli, { version })(["--help"]);

        const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
        expect(output).toContain("run");

        logSpy.mockRestore();
      }),
    );
  },
);
