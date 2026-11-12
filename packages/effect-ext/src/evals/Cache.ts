/**
 * Content-hash result caching, built directly on `effect`'s own
 * `KeyValueStore` (`effect/persistence`): a cache hit lets
 * {@link Runner.runSuite} skip both the task (SUT) call and a metric's judge
 * call for that trial. A task-level key hashes the golden, the task's
 * identifier, and the trial number; a metric-level key adds the metric name
 * and judge model id — so re-running an unchanged suite reproduces the exact
 * same per-trial results, not just the same mean (see
 * {@link Result.MetricAggregate}).
 *
 * Cache invalidation is **manual, by identifier** — the same convention as a
 * cache-busting query string. Neither key hashes a task's `run` closure nor a
 * metric's `scorer`/`threshold` (both are opaque code, not data), so editing
 * a task's behavior or a scorer's judging without bumping its name/id (e.g.
 * `"translate@v1"` → `"translate@v2"`) silently serves a stale cached result.
 * Cached values also round-trip through `JSON.stringify`/`JSON.parse` with no
 * schema check, so a `TaskDefinition`'s `Output` (or a metric's `Score`)
 * containing non-JSON-safe values (`Date`, `Map`, `Set`, class instances)
 * will not survive a cache hit faithfully — stick to plain JSON-shaped data
 * for cached tasks and scorers.
 *
 * Only `effect` and the platform-standard `crypto.subtle` global (present in
 * Node 19+ and Workers, no import needed) are used here, because the
 * package's core depends on `effect` alone (website#922): the
 * concrete `FileSystem`/`Path` layer for {@link layerFileSystem} is supplied
 * by the caller (a test or the CLI) — exactly like a judge `LanguageModel` is
 * provided to a {@link Scorer.Scorer}.
 *
 * @module Cache
 *
 * @copyright Thomas Foster
 *
 * @since 0.1.0
 */

import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import { KeyValueStore } from "effect/persistence";

export {
  /** @since 0.1.0 */
  KeyValueStore,
};

/**
 * The default cache directory, relative to wherever the runner executes — gitignored.
 *
 * @since 0.1.0
 */
export const defaultDirectory = ".effect-evals/cache";

/**
 * A process-local in-memory cache — the default for tests, and for runs with no persistence.
 *
 * @since 0.1.0
 */
export const layerMemory = KeyValueStore.layerMemory;

/**
 * A filesystem-backed cache under `directory`, created on first use.
 *
 * @since 0.1.0
 */
export const layerFileSystem = KeyValueStore.layerFileSystem;

/**
 * The components a cache key is hashed from: a task-level key (golden + task
 * id + trial) when `metric` is omitted, or a metric-level key (adding the
 * metric name and judge model id) when it's given.
 *
 * @since 0.1.0
 */
export interface CacheKeyInput {
  readonly golden: unknown;
  readonly taskId: string;
  readonly trial: number;
  readonly metric?: string;
  readonly judgeModelId?: string;
}

/**
 * Normalises a value into `Schema.Json` with every object's keys sorted, so
 * the JSON it encodes to is stable across key insertion order. It writes
 * exactly what `JSON.stringify` would for the input, so existing cache keys
 * keep their digests, with three additions:
 *
 * - `Date`, `Map` and `Set` are spelled out (`{ __date }`, `{ __map }`,
 *   `{ __set }`): left to `JSON.stringify`, all three become `{}`, which would
 *   collide two keys that differ only in one of them.
 * - A `bigint` is `{ __bigint: "<digits>" }`, where `JSON.stringify` throws.
 * - A value JSON has no spelling for (`undefined`, a function, a symbol) is
 *   `None`: an object omits its key and an array slot reads `null`, as
 *   `JSON.stringify` does.
 */
const canonicalize = (value: unknown): Option.Option<Schema.Json> => {
  if (P.isString(value) || P.isNumber(value) || P.isBoolean(value) || P.isNull(value)) {
    return Option.some(value);
  }
  if (P.isBigInt(value)) return Option.some({ __bigint: value.toString() });
  if (!P.isObjectOrArray(value)) return Option.none();
  if (value instanceof Date) return Option.some({ __date: value.toISOString() });
  if (value instanceof Map) {
    return Option.some({
      __map: Array.from(value, ([k, v]) => [slot(canonicalize(k)), slot(canonicalize(v))]),
    });
  }
  if (value instanceof Set)
    return Option.some({ __set: Array.from(value, (item) => slot(canonicalize(item))) });
  if (Array.isArray(value)) return Option.some(value.map((item) => slot(canonicalize(item))));
  return Option.some(
    R.fromEntries(
      Arr.getSomes(
        Arr.map(Arr.sort(R.keys(value), Order.String), (key) =>
          Option.map(canonicalize(value[key]), (json) => [key, json] as const),
        ),
      ),
    ),
  );
};

/** An array slot's JSON: `null` where {@link canonicalize} found no spelling, as `JSON.stringify` writes. */
const slot = (json: Option.Option<Schema.Json>): Schema.Json =>
  Option.getOrElse(json, (): Schema.Json => null);

/** `JSON.stringify` as a codec, for the canonical form of a cache key's inputs. */
const encodeCanonicalJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const encoder = new TextEncoder();
const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The digest call rejected; `hashKey` turns it into a defect. */
class DigestFailed extends Schema.TaggedError<DigestFailed, { readonly brand: unique symbol }>()(
  "DigestFailed",
  {
    detail: Schema.Unknown,
  },
) {}

/**
 * A deterministic cache key for the given inputs — stable across process
 * runs. A full SHA-256 hex digest (not a 32-bit structural hash — this key
 * addresses entries in a persistent, cross-run filesystem cache, where a
 * small hash's collision odds are a real correctness risk, not just a
 * theoretical one).
 *
 * @since 0.1.0
 */
export const hashKey = (input: CacheKeyInput): Effect.Effect<string> =>
  encodeCanonicalJson(slot(canonicalize(input))).pipe(
    Effect.flatMap((json) =>
      Effect.tryPromise({
        try: () => crypto.subtle.digest("SHA-256", encoder.encode(json)),
        catch: (cause) => new DigestFailed({ detail: cause }),
      }),
    ),
    Effect.map(toHex),
    // An input `JSON.stringify` cannot serialise (a cycle, a `BigInt`) is a
    // caller bug, and SHA-256 over bytes cannot fail, so either is a defect.
    Effect.orDie,
  );
