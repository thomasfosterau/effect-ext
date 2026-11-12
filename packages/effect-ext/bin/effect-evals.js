#!/usr/bin/env node
/**
 * The `effect-evals` bin. A plain, flagless `node` launcher that re-execs
 * itself as `node --disable-warning=ExperimentalWarning
 * --import <loader.mjs> <dist/evals/cli/main.js> …argv`. The CLI itself is BUILT
 * JavaScript (`dist/evals/cli/main.js`) because Node refuses to type-strip anything
 * under `node_modules` (issue #42); the loader hook plus Node's native type
 * stripping exist only for the consumer's own `*.eval.ts` files, which live
 * outside `node_modules`. Flags and the loader import are literal argv on this
 * one `node` invocation — never tsx and never `NODE_OPTIONS`, because the
 * flags must be literal argv on that one hop — and this is the ONLY hop, so
 * nothing downstream can lose them.
 *
 * `--disable-warning=ExperimentalWarning` hides only that warning type: on
 * Node 23.x and early 24.x, inside the CLI's `>=22.18` range,
 * `fs.promises.glob` and type stripping each still print one on every run.
 * Never `--no-warnings=…`: Node ignores its value and hides every warning,
 * `DeprecationWarning`s included (#81).
 *
 * The library's `engines.node` floor is 22.0, but the CLI needs 22.18: type
 * stripping is on by default from 22.18, and the loader hook uses
 * `module.registerHooks()` (22.15). `engines` cannot be set per entry point,
 * so the bin checks the version itself, before it spawns anything, and exits
 * with a message that names the requirement (#71).
 *
 * Run `vp run -r build` before using the bin from the workspace.
 *
 * @module bin/effect-evals
 *
 * @copyright Thomas Foster
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The oldest Node the CLI runs on: `[major, minor]`. */
const NODE_FLOOR = [22, 18];
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < NODE_FLOOR[0] || (major === NODE_FLOOR[0] && minor < NODE_FLOOR[1])) {
  console.error(
    `effect-evals: needs Node ${NODE_FLOOR.join(".")} or later (it type-strips *.eval.ts files), but this is Node ${process.versions.node}.`,
  );
  process.exit(1);
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const loader = path.join(dir, "..", "src", "evals", "cli", "loader.mjs");
const entry = path.join(dir, "..", "dist", "evals", "cli", "main.js");

if (!existsSync(entry)) {
  console.error(
    `effect-evals: ${entry} does not exist. In the workspace, run \`vp run -r build\` first.`,
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", "--import", loader, entry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
