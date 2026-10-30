import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Allocator from "../src/Allocator.ts"
import * as Str from "../src/Str.ts"
import * as String from "../src/String.ts"

describe("String", () => {
  it.effect("make, from, toString and len", () =>
    Effect.gen(function* () {
      const empty = yield* String.make()
      expect(String.isEmpty(empty)).toBe(true)
      expect(String.capacity(empty)).toBe(0)
      const s = yield* String.from("héllo")
      expect(s.toString()).toBe("héllo")
      expect(String.len(s)).toBe(6)
      expect(String.isString(s)).toBe(true)
      expect(s.toJSON()).toEqual({ _id: "String", value: "héllo" })
    }),
  )

  it.effect("withCapacity, reserve, reserveExact, shrinkTo and shrinkToFit", () =>
    Effect.gen(function* () {
      const s = yield* String.withCapacity(10)
      expect(String.len(s)).toBe(0)
      expect(String.capacity(s)).toBeGreaterThanOrEqual(10)
      yield* String.pushStr(s, "abc")
      yield* String.shrinkToFit(s)
      expect(String.capacity(s)).toBe(3)
      yield* String.reserveExact(s, 7)
      expect(String.capacity(s)).toBe(10)
      yield* String.reserve(s, 100)
      expect(String.capacity(s)).toBeGreaterThanOrEqual(103)
      yield* String.shrinkTo(s, 20)
      expect(String.capacity(s)).toBe(20)
      yield* String.shrinkTo(s, 0)
      expect(String.capacity(s)).toBe(3)
      expect(s.toString()).toBe("abc")
    }),
  )

  it.effect("push and pop", () =>
    Effect.gen(function* () {
      const s = yield* String.from("abc")
      yield* String.push(s, "1")
      yield* String.push(s, "2")
      yield* String.push(s, "🦀")
      expect(s.toString()).toBe("abc12🦀")
      const t = yield* String.from("abč")
      expect([String.pop(t), String.pop(t), String.pop(t), String.pop(t)]).toEqual([
        Option.some("č"),
        Option.some("b"),
        Option.some("a"),
        Option.none(),
      ])
    }),
  )

  it.effect("push rejects anything but a single character", () =>
    Effect.gen(function* () {
      const s = yield* String.make()
      const exit = yield* Effect.exit(String.push(s, "ab"))
      expect(Exit.hasDies(exit)).toBe(true)
      expect(Exit.hasDies(yield* Effect.exit(String.push(s, "")))).toBe(true)
    }),
  )

  it.effect("insert and insertStr", () =>
    Effect.gen(function* () {
      const s = yield* String.make()
      yield* String.insert(s, 0, "o")
      yield* String.insert(s, 0, "o")
      yield* String.insert(s, 0, "f")
      expect(s.toString()).toBe("foo")
      const t = yield* String.from("bar")
      yield* String.insertStr(t, 0, "foo")
      yield* String.insertStr(t, 6, Str.fromString("!"))
      expect(t.toString()).toBe("foobar!")
      const u = yield* String.from("é")
      expect(Exit.hasDies(yield* Effect.exit(String.insertStr(u, 1, "x")))).toBe(true)
      expect(u.toString()).toBe("é")
    }),
  )

  it.effect("remove, truncate and clear", () =>
    Effect.gen(function* () {
      const s = yield* String.from("abç")
      expect(String.remove(s, 0)).toEqual(Option.some("a"))
      expect(String.remove(s, 1)).toEqual(Option.some("ç"))
      expect(String.remove(s, 1)).toEqual(Option.none())
      expect(String.remove(s, 0)).toEqual(Option.some("b"))
      const t = yield* String.from("héllo")
      expect(String.truncate(t, 2)).toBe(false)
      expect(t.toString()).toBe("héllo")
      expect(String.truncate(t, 3)).toBe(true)
      expect(t.toString()).toBe("hé")
      expect(String.truncate(t, 100)).toBe(true)
      String.clear(t)
      expect(String.isEmpty(t)).toBe(true)
      expect(String.capacity(t)).toBeGreaterThan(0)
    }),
  )

  it.effect("retain", () =>
    Effect.gen(function* () {
      const s = yield* String.from("f_o_ob_ar")
      String.retain(s, (c) => c !== "_")
      expect(s.toString()).toBe("foobar")
      const t = yield* String.from("a🦀b🦀c")
      String.retain(t, (c) => c === "🦀")
      expect(t.toString()).toBe("🦀🦀")
    }),
  )

  it.effect("drain and replaceRange", () =>
    Effect.gen(function* () {
      const s = yield* String.from("α is alpha, β is beta")
      const beta = Option.getOrElse(String.find(s, "β"), () => -1)
      const drained = yield* Effect.fromOption(String.drain(s, 0, beta))
      expect(drained.toString()).toBe("α is alpha, ")
      expect(s.toString()).toBe("β is beta")
      expect(String.drain(s, 1)).toEqual(Option.none())
      const rest = yield* Effect.fromOption(String.drain(s, 0))
      expect(rest.toString()).toBe("β is beta")
      expect(String.isEmpty(s)).toBe(true)

      const t = yield* String.from("α is alpha, β is beta")
      const at = Option.getOrElse(String.find(t, "β"), () => -1)
      yield* String.replaceRange(t, 0, at, "Α is capital alpha; ")
      expect(t.toString()).toBe("Α is capital alpha; β is beta")
      expect(Exit.hasDies(yield* Effect.exit(String.replaceRange(t, 1, 2, "x")))).toBe(true)
    }),
  )

  it.effect("splitOff", () =>
    Effect.gen(function* () {
      const s = yield* String.from("Hello, World!")
      const world = yield* String.splitOff(s, 7)
      expect(s.toString()).toBe("Hello, ")
      expect(world.toString()).toBe("World!")
      expect(world.allocator).toBe(s.allocator)
    }),
  )

  it.effect("extend and fromIterable", () =>
    Effect.gen(function* () {
      const s = yield* String.fromIterable(["a", Str.fromString("bc"), "🦀"])
      expect(s.toString()).toBe("abc🦀")
      yield* String.extend(s, "dé")
      expect(s.toString()).toBe("abc🦀dé")
    }),
  )

  it.effect("fromUtf8 and fromUtf8Lossy", () =>
    Effect.gen(function* () {
      const s = yield* String.fromUtf8(new Uint8Array([0xf0, 0x9f, 0x92, 0x96]))
      expect(s.toString()).toBe("💖")
      const error = yield* Effect.flip(String.fromUtf8(new Uint8Array([0, 159, 146, 150])))
      expect(error._tag).toBe("Utf8Error")
      const lossy = yield* String.fromUtf8Lossy(new Uint8Array([0x61, 0xff, 0x62]))
      expect(lossy.toString()).toBe("a�b")
    }),
  )

  it.effect("read-only queries", () =>
    Effect.gen(function* () {
      const s = yield* String.from("Löwe 老虎 Léopard")
      expect(String.find(s, "é")).toEqual(Option.some(14))
      expect(String.rfind(s, "L")).toEqual(Option.some(13))
      expect(String.contains(s, "老虎")).toBe(true)
      expect(String.startsWith(s, (c) => c === "L")).toBe(true)
      expect(String.endsWith(s, "pard")).toBe(true)
      expect(String.isCharBoundary(s, 2)).toBe(false)
      expect(Option.map(String.get(s, 6, 12), (x) => x.toString())).toEqual(Option.some("老虎"))
      expect(String.get(s, 6, 8)).toEqual(Option.none())
      expect([...String.chars(yield* String.from("hé"))]).toEqual(["h", "é"])
      expect([...String.charIndices(yield* String.from("hé!"))]).toEqual([
        [0, "h"],
        [1, "é"],
        [3, "!"],
      ])
      expect(String.equals(s, "Löwe 老虎 Léopard")).toBe(true)
      expect(String.equals(s, Str.fromString("Löwe"))).toBe(false)
      expect(String.equals(s, yield* String.from("Löwe 老虎 Léopard"))).toBe(true)
    }),
  )

  it.effect("toStr and get return snapshots unaffected by later mutation", () =>
    Effect.gen(function* () {
      const s = yield* String.from("hello")
      const snapshot = String.toStr(s)
      const slice = yield* Effect.fromOption(String.get(s, 1, 3))
      String.makeAsciiUppercase(s)
      yield* String.pushStr(s, " WORLD, AND MORE TEXT TO FORCE A REALLOCATION")
      expect(snapshot.toString()).toBe("hello")
      expect(slice.toString()).toBe("el")
      expect(Str.split(String.toStr(s), " ")[0].toString()).toBe("HELLO")
      String.makeAsciiLowercase(s)
      expect(String.startsWith(s, "hello world")).toBe(true)
    }),
  )

  it.effect("iterating sees in-place changes", () =>
    Effect.gen(function* () {
      const s = yield* String.from("abc")
      const iter = String.chars(s)
      expect(iter.next().value).toBe("a")
      String.truncate(s, 2)
      expect([...iter]).toEqual(["b"])
    }),
  )

  it.effect("pushStr of its own bytes is safe", () =>
    Effect.gen(function* () {
      const s = yield* String.from("ab")
      yield* String.pushStr(s, Str.fromUtf8Unsafe(String.asBytes(s)))
      yield* String.pushStr(s, Str.fromUtf8Unsafe(String.asBytes(s)))
      expect(s.toString()).toBe("abababab")
    }),
  )

  it.effect("uses the current allocator and fails cleanly when it is exhausted", () =>
    Effect.gen(function* () {
      const s = yield* String.from("abc")
      expect(s.allocator.name).toBe("arena")
      const exit = yield* Effect.exit(String.pushStr(s, "x".repeat(100)))
      expect(Exit.isFailure(exit) && !Exit.hasDies(exit)).toBe(true)
      expect(s.toString()).toBe("abc")
      const extended = yield* Effect.exit(String.extend(s, ["d", "x".repeat(100)]))
      expect(Exit.isFailure(extended)).toBe(true)
      expect(s.toString()).toBe("abc")
    }).pipe(Effect.provide(Allocator.layerArena(64))),
  )

  it.effect("makeScoped and free return memory to the allocator", () =>
    Effect.gen(function* () {
      const tracked = Allocator.tracked(Allocator.heap)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const s = yield* String.makeScoped()
          yield* String.pushStr(s, "hello, world")
          expect(tracked.stats().liveBlocks).toBe(1)
        }),
      ).pipe(Allocator.withAllocator(tracked))
      expect(tracked.stats()).toMatchObject({ liveBlocks: 0, liveBytes: 0 })
    }),
  )
})
