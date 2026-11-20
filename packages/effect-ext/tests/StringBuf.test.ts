import { describe, expect, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Allocator from "@thomasfosterau/effect-ext/Allocator";
import * as Str from "@thomasfosterau/effect-ext/Str";
import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf";

describe("StringBuf", () => {
  it.effect("make, from, toString and len", () =>
    Effect.gen(function* () {
      const empty = yield* StringBuf.make();
      expect(StringBuf.isEmpty(empty)).toBe(true);
      expect(StringBuf.capacity(empty)).toBe(0);
      const s = yield* StringBuf.from("héllo");
      expect(s.toString()).toBe("héllo");
      expect(StringBuf.len(s)).toBe(6);
      expect(StringBuf.isStringBuf(s)).toBe(true);
      expect(s.toJSON()).toEqual({ _id: "StringBuf", value: "héllo" });
    }),
  );

  it.effect("withCapacity, reserve, reserveExact, shrinkTo and shrinkToFit", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.withCapacity(10);
      expect(StringBuf.len(s)).toBe(0);
      expect(StringBuf.capacity(s)).toBeGreaterThanOrEqual(10);
      yield* StringBuf.pushStr(s, "abc");
      yield* StringBuf.shrinkToFit(s);
      expect(StringBuf.capacity(s)).toBe(3);
      yield* StringBuf.reserveExact(s, 7);
      expect(StringBuf.capacity(s)).toBe(10);
      yield* StringBuf.reserve(s, 100);
      expect(StringBuf.capacity(s)).toBeGreaterThanOrEqual(103);
      yield* StringBuf.shrinkTo(s, 20);
      expect(StringBuf.capacity(s)).toBe(20);
      yield* StringBuf.shrinkTo(s, 0);
      expect(StringBuf.capacity(s)).toBe(3);
      expect(s.toString()).toBe("abc");
    }),
  );

  it.effect("push and pop", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.from("abc");
      yield* StringBuf.push(s, "1");
      yield* StringBuf.push(s, "2");
      yield* StringBuf.push(s, "🦀");
      expect(s.toString()).toBe("abc12🦀");
      const t = yield* StringBuf.from("abč");
      expect([StringBuf.pop(t), StringBuf.pop(t), StringBuf.pop(t), StringBuf.pop(t)]).toEqual([
        Option.some("č"),
        Option.some("b"),
        Option.some("a"),
        Option.none(),
      ]);
    }),
  );

  it.effect("push rejects anything but a single character", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.make();
      const exit = yield* Effect.exit(StringBuf.push(s, "ab"));
      expect(Exit.hasDies(exit)).toBe(true);
      expect(Exit.hasDies(yield* Effect.exit(StringBuf.push(s, "")))).toBe(true);
    }),
  );

  it.effect("insert and insertStr", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.make();
      yield* StringBuf.insert(s, 0, "o");
      yield* StringBuf.insert(s, 0, "o");
      yield* StringBuf.insert(s, 0, "f");
      expect(s.toString()).toBe("foo");
      const t = yield* StringBuf.from("bar");
      yield* StringBuf.insertStr(t, 0, "foo");
      yield* StringBuf.insertStr(t, 6, Str.fromString("!"));
      expect(t.toString()).toBe("foobar!");
      const u = yield* StringBuf.from("é");
      expect(Exit.hasDies(yield* Effect.exit(StringBuf.insertStr(u, 1, "x")))).toBe(true);
      expect(u.toString()).toBe("é");
    }),
  );

  it.effect("remove, truncate and clear", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.from("abç");
      expect(StringBuf.remove(s, 0)).toEqual(Option.some("a"));
      expect(StringBuf.remove(s, 1)).toEqual(Option.some("ç"));
      expect(StringBuf.remove(s, 1)).toEqual(Option.none());
      expect(StringBuf.remove(s, 0)).toEqual(Option.some("b"));
      const t = yield* StringBuf.from("héllo");
      expect(StringBuf.truncate(t, 2)).toBe(false);
      expect(t.toString()).toBe("héllo");
      expect(StringBuf.truncate(t, 3)).toBe(true);
      expect(t.toString()).toBe("hé");
      expect(StringBuf.truncate(t, 100)).toBe(true);
      StringBuf.clear(t);
      expect(StringBuf.isEmpty(t)).toBe(true);
      expect(StringBuf.capacity(t)).toBeGreaterThan(0);
    }),
  );

  it.effect("retain", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.from("f_o_ob_ar");
      StringBuf.retain(s, (c) => c !== "_");
      expect(s.toString()).toBe("foobar");
      const t = yield* StringBuf.from("a🦀b🦀c");
      StringBuf.retain(t, (c) => c === "🦀");
      expect(t.toString()).toBe("🦀🦀");
    }),
  );

  it.effect("drain and replaceRange", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.from("α is alpha, β is beta");
      const beta = Option.getOrElse(StringBuf.find(s, "β"), () => -1);
      const drained = yield* Effect.fromOption(StringBuf.drain(s, 0, beta));
      expect(drained.toString()).toBe("α is alpha, ");
      expect(s.toString()).toBe("β is beta");
      expect(StringBuf.drain(s, 1)).toEqual(Option.none());
      const rest = yield* Effect.fromOption(StringBuf.drain(s, 0));
      expect(rest.toString()).toBe("β is beta");
      expect(StringBuf.isEmpty(s)).toBe(true);

      const t = yield* StringBuf.from("α is alpha, β is beta");
      const at = Option.getOrElse(StringBuf.find(t, "β"), () => -1);
      yield* StringBuf.replaceRange(t, 0, at, "Α is capital alpha; ");
      expect(t.toString()).toBe("Α is capital alpha; β is beta");
      expect(Exit.hasDies(yield* Effect.exit(StringBuf.replaceRange(t, 1, 2, "x")))).toBe(true);
    }),
  );

  it.effect("splitOff", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.from("Hello, World!");
      const world = yield* StringBuf.splitOff(s, 7);
      expect(s.toString()).toBe("Hello, ");
      expect(world.toString()).toBe("World!");
      expect(world.allocator).toBe(s.allocator);
    }),
  );

  it.effect("extend and fromIterable", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.fromIterable(["a", Str.fromString("bc"), "🦀"]);
      expect(s.toString()).toBe("abc🦀");
      yield* StringBuf.extend(s, "dé");
      expect(s.toString()).toBe("abc🦀dé");
    }),
  );

  it.effect("fromUtf8 and fromUtf8Lossy", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.fromUtf8(new Uint8Array([0xf0, 0x9f, 0x92, 0x96]));
      expect(s.toString()).toBe("💖");
      const error = yield* Effect.flip(StringBuf.fromUtf8(new Uint8Array([0, 159, 146, 150])));
      expect(error._tag).toBe("Utf8Error");
      const lossy = yield* StringBuf.fromUtf8Lossy(new Uint8Array([0x61, 0xff, 0x62]));
      expect(lossy.toString()).toBe("a�b");
    }),
  );

  it.effect("read-only queries", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.from("Löwe 老虎 Léopard");
      expect(StringBuf.find(s, "é")).toEqual(Option.some(14));
      expect(StringBuf.rfind(s, "L")).toEqual(Option.some(13));
      expect(StringBuf.contains(s, "老虎")).toBe(true);
      expect(StringBuf.startsWith(s, (c) => c === "L")).toBe(true);
      expect(StringBuf.endsWith(s, "pard")).toBe(true);
      expect(StringBuf.isCharBoundary(s, 2)).toBe(false);
      expect(Option.map(StringBuf.get(s, 6, 12), (x) => x.toString())).toEqual(Option.some("老虎"));
      expect(StringBuf.get(s, 6, 8)).toEqual(Option.none());
      expect([...StringBuf.chars(yield* StringBuf.from("hé"))]).toEqual(["h", "é"]);
      expect([...StringBuf.charIndices(yield* StringBuf.from("hé!"))]).toEqual([
        [0, "h"],
        [1, "é"],
        [3, "!"],
      ]);
      expect(StringBuf.equals(s, "Löwe 老虎 Léopard")).toBe(true);
      expect(StringBuf.equals(s, Str.fromString("Löwe"))).toBe(false);
      expect(StringBuf.equals(s, yield* StringBuf.from("Löwe 老虎 Léopard"))).toBe(true);
    }),
  );

  it.effect("toStr and get return snapshots unaffected by later mutation", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.from("hello");
      const snapshot = StringBuf.toStr(s);
      const slice = yield* Effect.fromOption(StringBuf.get(s, 1, 3));
      StringBuf.makeAsciiUppercase(s);
      yield* StringBuf.pushStr(s, " WORLD, AND MORE TEXT TO FORCE A REALLOCATION");
      expect(snapshot.toString()).toBe("hello");
      expect(slice.toString()).toBe("el");
      expect(Str.split(StringBuf.toStr(s), " ")[0].toString()).toBe("HELLO");
      StringBuf.makeAsciiLowercase(s);
      expect(StringBuf.startsWith(s, "hello world")).toBe(true);
    }),
  );

  it.effect("iterating sees in-place changes", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.from("abc");
      const iter = StringBuf.chars(s);
      expect(iter.next().value).toBe("a");
      StringBuf.truncate(s, 2);
      expect([...iter]).toEqual(["b"]);
    }),
  );

  it.effect("pushStr of its own bytes is safe", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.from("ab");
      yield* StringBuf.pushStr(s, Str.fromUtf8Unsafe(StringBuf.asBytes(s)));
      yield* StringBuf.pushStr(s, Str.fromUtf8Unsafe(StringBuf.asBytes(s)));
      expect(s.toString()).toBe("abababab");
    }),
  );

  layer(Allocator.layerArena(64))("in an arena of 64 bytes", (arena) => {
    arena.effect("uses the current allocator and fails cleanly when it is exhausted", () =>
      Effect.gen(function* () {
        const s = yield* StringBuf.from("abc");
        expect(s.allocator.name).toBe("arena");
        const exit = yield* Effect.exit(StringBuf.pushStr(s, "x".repeat(100)));
        expect(Exit.isFailure(exit) && !Exit.hasDies(exit)).toBe(true);
        expect(s.toString()).toBe("abc");
        const extended = yield* Effect.exit(StringBuf.extend(s, ["d", "x".repeat(100)]));
        expect(Exit.isFailure(extended)).toBe(true);
        expect(s.toString()).toBe("abc");
      }),
    );
  });

  it.effect("makeScoped and free return memory to the allocator", () =>
    Effect.gen(function* () {
      const tracked = Allocator.tracked(Allocator.heap);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const s = yield* StringBuf.makeScoped();
          yield* StringBuf.pushStr(s, "hello, world");
          expect(tracked.stats().liveBlocks).toBe(1);
        }),
      ).pipe(Allocator.withAllocator(tracked));
      expect(tracked.stats()).toMatchObject({ liveBlocks: 0, liveBytes: 0 });
    }),
  );
});
