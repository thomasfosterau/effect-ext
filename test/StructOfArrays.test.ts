import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import * as Allocator from "../src/Allocator.ts"
import * as Layout from "../src/Layout.ts"
import * as StructOfArrays from "../src/StructOfArrays.ts"

const Particle = {
  id: Layout.u16,
  x: Layout.f64,
  alive: Layout.bool,
  y: Layout.f32,
}

describe("StructOfArrays", () => {
  it.effect("push, get and columns", () =>
    Effect.gen(function* () {
      const soa = yield* StructOfArrays.make(Particle)
      for (let i = 0; i < 9; i++) {
        yield* StructOfArrays.push(soa, { id: i, x: i * 1.5, alive: i % 2 === 0, y: -i })
      }
      expect(soa.length).toBe(9)
      expect(StructOfArrays.get(soa, 2)).toEqual(Option.some({ id: 2, x: 3, alive: true, y: -2 }))
      const xs: Float64Array = StructOfArrays.column(soa, "x")
      expect(Array.from(xs)).toEqual([0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12])
      expect(Array.from(StructOfArrays.column(soa, "id"))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
      expect(Array.from(StructOfArrays.column(soa, "alive"))).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1])
      expect(Array.from(StructOfArrays.values(soa, "y"))).toEqual([
        -0, -1, -2, -3, -4, -5, -6, -7, -8,
      ])
    }),
  )

  it.effect("columns survive growth and shrinking", () =>
    Effect.gen(function* () {
      const records = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        x: i / 2,
        alive: i % 3 === 0,
        y: i * 2,
      }))
      const soa = yield* StructOfArrays.fromIterable(Particle, records.slice(0, 3))
      yield* StructOfArrays.extend(soa, records.slice(3))
      expect(StructOfArrays.toArray(soa)).toEqual(records)
      yield* StructOfArrays.reserve(soa, 1000)
      expect(StructOfArrays.toArray(soa)).toEqual(records)
      StructOfArrays.truncate(soa, 10)
      yield* StructOfArrays.shrinkToFit(soa)
      expect(soa.capacity).toBe(10)
      expect(StructOfArrays.toArray(soa)).toEqual(records.slice(0, 10))
    }),
  )

  it.effect("fields, set, pop and swapRemove", () =>
    Effect.gen(function* () {
      const soa = yield* StructOfArrays.fromIterable(
        Layout.struct({ a: Layout.u8, b: Layout.i32 }),
        [
          { a: 1, b: 10 },
          { a: 2, b: 20 },
          { a: 3, b: 30 },
        ],
      )
      StructOfArrays.setField(soa, 0, "b", 11)
      expect(StructOfArrays.getField(soa, 0, "b")).toBe(11)
      expect(() => StructOfArrays.getField(soa, 3, "b")).toThrow(RangeError)
      expect(StructOfArrays.set(soa, 1, { a: 9, b: 90 })).toBe(true)
      expect(StructOfArrays.swapRemove(soa, 0)).toEqual(Option.some({ a: 1, b: 11 }))
      expect(StructOfArrays.toArray(soa)).toEqual([
        { a: 3, b: 30 },
        { a: 9, b: 90 },
      ])
      expect(StructOfArrays.pop(soa)).toEqual(Option.some({ a: 9, b: 90 }))
      expect(soa.length).toBe(1)
    }),
  )

  it.effect("supports nested struct fields", () =>
    Effect.gen(function* () {
      const soa = yield* StructOfArrays.make({
        position: Layout.struct({ x: Layout.f32, y: Layout.f32 }),
        id: Layout.u32,
      })
      yield* StructOfArrays.push(soa, { position: { x: 1, y: 2 }, id: 7 })
      expect(StructOfArrays.getUnsafe(soa, 0)).toEqual({ position: { x: 1, y: 2 }, id: 7 })
    }),
  )

  it.effect("grows in place inside an arena", () =>
    Effect.gen(function* () {
      const soa = yield* StructOfArrays.make(Particle)
      const records = Array.from({ length: 20 }, (_, i) => ({
        id: i,
        x: i,
        alive: true,
        y: i,
      }))
      yield* StructOfArrays.extend(soa, records)
      expect(StructOfArrays.toArray(soa)).toEqual(records)
    }).pipe(Effect.provide(Allocator.layerArena(4096))),
  )

  it.effect("free releases memory", () =>
    Effect.gen(function* () {
      const tracked = Allocator.tracked(Allocator.heap)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const soa = yield* StructOfArrays.makeScoped(Particle, { capacity: 8 })
          yield* StructOfArrays.push(soa, { id: 1, x: 1, alive: true, y: 1 })
        }),
      ).pipe(Allocator.withAllocator(tracked))
      expect(tracked.stats()).toMatchObject({ liveBlocks: 0, liveBytes: 0 })
    }),
  )
})
