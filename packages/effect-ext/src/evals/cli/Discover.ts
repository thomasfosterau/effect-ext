/**
 * Glob discovery of `*.eval.ts` files for the `run` command, through the
 * `FileSystem` and `Path` services.
 *
 * @module cli/Discover
 *
 * @copyright Thomas Foster
 */

import * as Order from "effect/Order";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/** A glob pattern failed to evaluate (a malformed pattern, an unreadable directory, …). */
export class GlobError extends Schema.TaggedError<GlobError, { readonly brand: unique symbol }>()(
  "GlobError",
  {
    patterns: Schema.Array(Schema.String),
    cause: Schema.Defect(),
  },
) {}

/** Never searched: dependencies and git internals (dot-directories are skipped already). */
const EXCLUDE = ["**/node_modules", "**/.git"];

/**
 * Resolves every file matching any of `patterns` (relative to `cwd`,
 * default `process.cwd()`) to an absolute path, deduplicated and sorted for
 * deterministic run order. `node_modules` and `.git` are always excluded.
 */
export const findEvalFiles = (
  patterns: ReadonlyArray<string>,
  cwd: string = process.cwd(),
): Effect.Effect<ReadonlyArray<string>, GlobError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const matches = yield* Effect.forEach(
      patterns,
      (pattern) => fs.glob(pattern, { root: cwd, exclude: EXCLUDE }),
      { concurrency: "unbounded" },
    ).pipe(Effect.mapError((cause) => new GlobError({ patterns: [...patterns], cause })));
    return Arr.sort(
      Arr.dedupe(Arr.map(Arr.flatten(matches), (match) => path.resolve(cwd, match))),
      Order.String,
    );
  });
