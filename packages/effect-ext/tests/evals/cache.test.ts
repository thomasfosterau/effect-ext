/**
 * Unit tests for `Cache`: deterministic key hashing, and `layerMemory` as a
 * working `KeyValueStore`.
 *
 * @module tests/cache
 */

import { describe, expect, it } from "@effect/vitest";
import { layerPerTest } from "./helpers/layerPerTest.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Cache } from "../../src/evals/index.ts";

const hash = (input: Cache.CacheKeyInput) => Cache.hashKey(input);

describe("Cache.hashKey", () => {
  const base = {
    golden: { input: "Bonjour" },
    taskId: "translate@v1",
    metric: "exact-match",
    trial: 1,
  };

  const withDate = (date: Date) => ({ ...base, golden: { askedAt: date } });

  const withMap = (entries: Array<[string, string]>) => ({
    ...base,
    golden: { tags: new Map(entries) },
  });

  const withSet = (values: Array<string>) => ({ ...base, golden: { tags: new Set(values) } });

  it.effect("is a full SHA-256 hex digest, not a small structural hash", () =>
    Effect.gen(function* () {
      expect(yield* hash(base)).toMatch(/^[0-9a-f]{64}$/);
    }),
  );

  it.effect(
    "keys a BigInt as its digits, where JSON.stringify would throw, distinct from the number and the string",
    () =>
      Effect.gen(function* () {
        const big = yield* hash({ ...base, golden: { input: 1n } });
        expect(big).toMatch(/^[0-9a-f]{64}$/);
        expect(big).toBe(yield* hash({ ...base, golden: { input: 1n } }));
        expect(big).not.toBe(yield* hash({ ...base, golden: { input: 1 } }));
        expect(big).not.toBe(yield* hash({ ...base, golden: { input: "1" } }));
      }),
  );

  it.effect(
    "keeps the digest of a varied golden pinned, so existing cache entries stay addressable",
    () =>
      Effect.gen(function* () {
        const golden = {
          b: 2,
          a: [
            1,
            "x",
            null,
            undefined,
            () => 1,
            Symbol("s"),
            DateTime.toDateUtc(DateTime.makeUnsafe(0)),
          ],
          m: new Map<unknown, unknown>([["k", { z: 1, y: [new Set([1, 2])] }]]),
          f: () => 2,
          u: undefined,
          n: { d: DateTime.toDateUtc(DateTime.makeUnsafe(86400000)), e: true },
        };
        expect(yield* hash({ golden, taskId: "t@v1", trial: 2, metric: "m" })).toBe(
          "a8b2f547bbad801e410ff90962419c384ff47772926185330d6a4f3f704fe37f",
        );
      }),
  );

  it.effect("is deterministic for identical inputs", () =>
    Effect.gen(function* () {
      expect(yield* hash(base)).toBe(yield* hash({ ...base }));
    }),
  );

  it.effect("is independent of object key order", () =>
    Effect.gen(function* () {
      const reordered = {
        trial: 1,
        metric: "exact-match",
        taskId: "translate@v1",
        golden: { input: "Bonjour" },
      };
      expect(yield* hash(base)).toBe(yield* hash(reordered));
    }),
  );

  it.effect("changes when the golden changes", () =>
    Effect.gen(function* () {
      expect(yield* hash(base)).not.toBe(yield* hash({ ...base, golden: { input: "Ciao" } }));
    }),
  );

  it.effect("changes when the trial changes", () =>
    Effect.gen(function* () {
      expect(yield* hash(base)).not.toBe(yield* hash({ ...base, trial: 2 }));
    }),
  );

  it.effect("changes when the metric changes", () =>
    Effect.gen(function* () {
      expect(yield* hash(base)).not.toBe(yield* hash({ ...base, metric: "other-metric" }));
    }),
  );

  it.effect("changes when the judge model id changes", () =>
    Effect.gen(function* () {
      expect(yield* hash(base)).not.toBe(yield* hash({ ...base, judgeModelId: "claude-sonnet-5" }));
    }),
  );

  it.effect("distinguishes goldens that differ only by a Date field", () =>
    Effect.gen(function* () {
      expect(yield* hash(withDate(DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01"))))).not.toBe(
        yield* hash(withDate(DateTime.toDateUtc(DateTime.makeUnsafe("2026-07-16")))),
      );
    }),
  );

  it.effect("distinguishes goldens that differ only by a Map's contents", () =>
    Effect.gen(function* () {
      expect(yield* hash(withMap([["a", "1"]]))).not.toBe(yield* hash(withMap([["a", "2"]])));
    }),
  );

  it.effect("distinguishes goldens that differ only by a Set's contents", () =>
    Effect.gen(function* () {
      expect(yield* hash(withSet(["a"]))).not.toBe(yield* hash(withSet(["b"])));
    }),
  );
});

describe("Cache.layerMemory", () => {
  layerPerTest(Cache.layerMemory)((t) => {
    t.effect("round-trips a set value through get", () =>
      Effect.gen(function* () {
        const kv = yield* Cache.KeyValueStore.KeyValueStore;
        yield* kv.set("key", "value");
        expect(yield* kv.get("key")).toBe("value");
      }),
    );

    t.effect("returns undefined for a missing key", () =>
      Effect.gen(function* () {
        const kv = yield* Cache.KeyValueStore.KeyValueStore;
        expect(yield* kv.get("missing")).toBeUndefined();
      }),
    );
  });

  it.effect("starts fresh on every independent run, even from the same layer constant", () =>
    Effect.gen(function* () {
      const first = yield* Layer.build(Cache.layerMemory);
      yield* Effect.gen(function* () {
        const kv = yield* Cache.KeyValueStore.KeyValueStore;
        yield* kv.set("key", "from-first-run");
      }).pipe(Effect.provideContext(first));

      const second = yield* Layer.build(Cache.layerMemory);
      const value = yield* Effect.gen(function* () {
        const kv = yield* Cache.KeyValueStore.KeyValueStore;
        return yield* kv.get("key");
      }).pipe(Effect.provideContext(second));
      expect(value).toBeUndefined();
    }),
  );
});
