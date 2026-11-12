/**
 * Tests for `bin/effect-evals.js`'s Node flags (#81): the bin hides Node's
 * `ExperimentalWarning`s (`fs.promises.glob` and type stripping still emit
 * one on Node 23.x and early 24.x, inside the CLI's `>=22.18` range) and
 * nothing else, so a `DeprecationWarning` raised while a consumer's
 * `*.eval.ts` file loads still reaches stderr. `--no-warnings=…` would hide
 * it: Node ignores that flag's value and silences every warning, which is how
 * DEP0205 (#72) stayed hidden for CLI users.
 *
 * The unit-test job runs without a build, so the real bin and loader are
 * copied into a scratch package whose `dist/evals/cli/main.js` imports the CLI's
 * TypeScript source (type-stripped by Node, as it is outside `node_modules`).
 * The bin's own argv is what runs; only the entry it launches is swapped.
 * `vp run check:dist` covers the built entry from an installed path.
 *
 * The bin also refuses a Node older than the CLI's 22.18 floor before it
 * spawns anything (#71); the library's own `engines.node` floor is lower. A
 * preload stands in for the old Node by overriding `process.versions.node`.
 *
 * @module tests/cli/bin
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

const source = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "effect-evals-bin-"));
  ["bin", "src/evals/cli", "dist/evals/cli"].forEach((dir) => {
    mkdirSync(path.join(scratch, dir), { recursive: true });
  });
  // As in the published package: without it, a Node older than 22.7 (no
  // ESM syntax detection) cannot even parse the bin to run its version check.
  writeFileSync(path.join(scratch, "package.json"), '{ "type": "module" }\n');
  copyFileSync(
    source("../../../bin/effect-evals.js"),
    path.join(scratch, "bin", "effect-evals.js"),
  );
  copyFileSync(
    source("../../../src/evals/cli/loader.mjs"),
    path.join(scratch, "src", "evals", "cli", "loader.mjs"),
  );
  const main = new URL("../../../src/evals/cli/main.ts", import.meta.url).href;
  writeFileSync(
    path.join(scratch, "dist", "evals", "cli", "main.js"),
    `import ${Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(main)};\n`,
  );
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Runs the bin with `--help`, as though on Node `version` (#71). */
const runAs = (version: string) =>
  spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,Object.defineProperty(process.versions,"node",{value:"${version}"})`,
      path.join(scratch, "bin", "effect-evals.js"),
      "--help",
    ],
    { cwd: scratch, encoding: "utf8" },
  );

describe("bin/effect-evals", () => {
  it("lets a DeprecationWarning from an eval file reach stderr", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(scratch, "bin", "effect-evals.js"), "run", source("../fixtures/warning.eval.ts")],
      // The CLI writes `.effect-evals/` under its cwd; keep it in the scratch dir.
      { cwd: scratch, encoding: "utf8" },
    );

    expect(result.stderr).toContain("DeprecationWarning: effect-evals fixture warning");
    expect(result.stderr).not.toContain("ExperimentalWarning");
    expect(result.status).toBe(0);
  });

  it("refuses a Node older than 22.18 with a message naming the floor", () => {
    const result = runAs("22.17.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("needs Node 22.18 or later");
    expect(result.stderr).toContain("this is Node 22.17.1");
  });

  it.each(["22.18.0", "23.0.0", "24.11.0"])("runs on Node %s", (version) => {
    const result = runAs(version);
    expect(result.stderr).not.toContain("needs Node");
    expect(result.status).toBe(0);
  });
});
