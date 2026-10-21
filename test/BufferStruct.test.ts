import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Allocator from "../src/Allocator.ts"
import * as BufferStruct from "../src/BufferStruct.ts"
import * as Layout from "../src/Layout.ts"

const Vec2 = Layout.struct({ x: Layout.f64, y: Layout.f64 })
const Body = Layout.struct({ position: Vec2, mass: Layout.f32, alive: Layout.bool })

describe("BufferStruct", () => {
  it.effect("make initialises fields and exposes them as properties", () =>
    Effect.gen(function* () {
      const p = yield* BufferStruct.make(Vec2, { x: 1, y: 2 })
      expect(p.x).toBe(1)
      p.x += 10
      expect(BufferStruct.toObject(p)).toEqual({ x: 11, y: 2 })
      expect(Object.keys(p)).toEqual([])
      expect(BufferStruct.isBufferStruct(p)).toBe(true)
    }),
  )

  it.effect("make without init is zeroed", () =>
    Effect.gen(function* () {
      const b = yield* BufferStruct.make(Body)
      expect(BufferStruct.toObject(b)).toEqual({ position: { x: 0, y: 0 }, mass: 0, alive: false })
    }),
  )

  it.effect("nested structs are live views", () =>
    Effect.gen(function* () {
      const b = yield* BufferStruct.make(Body, { position: { x: 1, y: 2 }, mass: 3, alive: true })
      b.position.y = 5
      expect(b.position.y).toBe(5)
      BufferStruct.set(b, "position", { x: 7, y: 8 })
      expect(BufferStruct.get(b, "position")).toEqual({ x: 7, y: 8 })
    }),
  )

  it("view reads and writes existing memory", () => {
    const buffer = new ArrayBuffer(32)
    const p = BufferStruct.view(Vec2, buffer, 16)
    p.y = 3.25
    expect(new Float64Array(buffer)[3]).toBe(3.25)
    expect(() => BufferStruct.view(Vec2, buffer, 24)).toThrow(RangeError)
  })

  it.effect("pipe, get, set and assign", () =>
    Effect.gen(function* () {
      const p = yield* BufferStruct.make(Vec2, { x: 1, y: 2 })
      const x = p.pipe(BufferStruct.set("x", 4), BufferStruct.get("x"))
      expect(x).toBe(4)
      BufferStruct.assign(p, { x: 9, y: 9 })
      expect(BufferStruct.toObject(p)).toEqual({ x: 9, y: 9 })
    }),
  )

  it.effect("clone copies memory", () =>
    Effect.gen(function* () {
      const p = yield* BufferStruct.make(Vec2, { x: 1, y: 2 })
      const q = yield* BufferStruct.clone(p)
      q.x = 100
      expect(p.x).toBe(1)
    }),
  )

  it.effect("makeScoped frees on scope close", () =>
    Effect.gen(function* () {
      const tracked = Allocator.tracked(Allocator.heap)
      yield* Effect.scoped(BufferStruct.makeScoped(Vec2, { x: 1, y: 2 })).pipe(
        Allocator.withAllocator(tracked),
      )
      expect(tracked.stats().liveBlocks).toBe(0)
    }),
  )

  it("rejects reserved field names", () => {
    const Bad = Layout.struct({ pipe: Layout.u8 })
    expect(() => BufferStruct.view(Bad, new ArrayBuffer(1))).toThrow(TypeError)
  })

  it("is inspectable", () => {
    const p = BufferStruct.view(Vec2, new ArrayBuffer(16))
    expect(p.toJSON()).toEqual({ _id: "BufferStruct", x: 0, y: 0 })
  })
})
