import { describe, expect, it } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Allocator from "../src/Allocator.ts"
import * as Layout from "../src/Layout.ts"
import * as Vec from "../src/Vec.ts"

const Point = Layout.struct({ x: Layout.i32, y: Layout.i32 })

describe("Vec", () => {
  it.effect("push, get, length and capacity", () =>
    Effect.gen(function* () {
      const v = yield* Vec.make(Layout.u16)
      expect(v.capacity).toBe(0)
      yield* Effect.forEach(Arr.range(0, 9), (i) => Vec.push(v, i * 3), {
        concurrency: 1,
        discard: true,
      })
      expect(v.length).toBe(10)
      expect(v.capacity).toBeGreaterThanOrEqual(10)
      expect(Vec.get(v, 3)).toEqual(Option.some(9))
      expect(Vec.get(v, 10)).toEqual(Option.none())
      expect(() => Vec.getUnsafe(v, -1)).toThrow(RangeError)
    }),
  )

  it.effect("fromIterable, toArray and typedArray", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Layout.f64, [1.5, 2.5, 3.5])
      expect(Vec.toArray(v)).toEqual([1.5, 2.5, 3.5])
      const array: Float64Array = Vec.typedArray(v)
      expect(Array.from(array)).toEqual([1.5, 2.5, 3.5])
      array[0] = 10
      expect(Vec.getUnsafe(v, 0)).toBe(10)
    }),
  )

  it.effect("set, pop, remove, swapRemove, insert", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Layout.i32, [0, 1, 2, 3, 4])
      expect(Vec.set(v, 1, 10)).toBe(true)
      expect(Vec.set(v, 5, 10)).toBe(false)
      expect(Vec.pop(v)).toEqual(Option.some(4))
      expect(Vec.remove(v, 0)).toEqual(Option.some(0))
      expect(Vec.toArray(v)).toEqual([10, 2, 3])
      expect(Vec.swapRemove(v, 0)).toEqual(Option.some(10))
      expect(Vec.toArray(v)).toEqual([3, 2])
      yield* Vec.insert(v, 1, 99)
      yield* Vec.insert(v, 3, 100)
      expect(Vec.toArray(v)).toEqual([3, 99, 2, 100])
      const exit = yield* Effect.exit(Vec.insert(v, 10, 0))
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("truncate, clear, reserve and shrinkToFit", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Layout.u8, [1, 2, 3, 4, 5])
      Vec.truncate(v, 2)
      expect(Vec.toArray(v)).toEqual([1, 2])
      yield* Vec.reserve(v, 100)
      expect(v.capacity).toBeGreaterThanOrEqual(102)
      yield* Vec.shrinkToFit(v)
      expect(v.capacity).toBe(2)
      expect(Vec.toArray(v)).toEqual([1, 2])
      Vec.clear(v)
      expect(Vec.isEmpty(v)).toBe(true)
    }),
  )

  it.effect("struct elements and element views", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Point, [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ])
      expect(Vec.toArray(v)).toEqual([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ])
      const p = yield* Effect.fromOption(Vec.at(v, 1))
      p.y = 40
      expect(Vec.getUnsafe(v, 1)).toEqual({ x: 3, y: 40 })
      expect(Vec.bytes(v).byteLength).toBe(16)
    }),
  )

  it.effect("works with an arena and fails cleanly when it is exhausted", () =>
    Effect.gen(function* () {
      const v = yield* Vec.make(Layout.u32)
      yield* Vec.extend(v, [1, 2, 3, 4, 5, 6, 7, 8])
      expect(v.allocator.name).toBe("arena")
      const exit = yield* Effect.exit(Vec.reserve(v, 1000))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(Vec.toArray(v)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    }).pipe(Effect.provide(Allocator.layerArena(64))),
  )

  it.effect("makeScoped frees on scope close", () =>
    Effect.gen(function* () {
      const tracked = Allocator.tracked(Allocator.heap)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const v = yield* Vec.makeScoped(Layout.f32)
          yield* Vec.extend(v, [1, 2, 3, 4, 5, 6, 7, 8, 9])
          expect(tracked.stats().liveBlocks).toBe(1)
        }),
      ).pipe(Allocator.withAllocator(tracked))
      expect(tracked.stats()).toMatchObject({ liveBlocks: 0, liveBytes: 0 })
    }),
  )

  it.effect("supports pipe and iteration", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Layout.i8, [-1, 0, 1])
      expect([...v]).toEqual([-1, 0, 1])
      expect(v.pipe(Vec.get(0))).toEqual(Option.some(-1))
      expect(v.toJSON()).toEqual({ _id: "Vec", layout: "i8", values: [-1, 0, 1] })
    }),
  )
})
