import { describe, expect, it } from "@effect/vitest"
import * as Layout from "../src/Layout.ts"

describe("Layout", () => {
  it("primitives have matching size and alignment", () => {
    expect([Layout.u8, Layout.i16, Layout.u32, Layout.f64, Layout.i64].map((l) => l.size)).toEqual([
      1, 2, 4, 8, 8,
    ])
    expect(Layout.bool.size).toBe(1)
  })

  it("primitives round-trip little-endian", () => {
    const view = new DataView(new ArrayBuffer(8))
    Layout.u32.write(view, 0, 0x01020304)
    expect(new Uint8Array(view.buffer).slice(0, 4)).toEqual(new Uint8Array([4, 3, 2, 1]))
    Layout.i64.write(view, 0, -5n)
    expect(Layout.i64.read(view, 0)).toBe(-5n)
    Layout.bool.write(view, 7, true)
    expect(Layout.bool.read(view, 7)).toBe(true)
  })

  it("struct computes C-like offsets, alignment and padding", () => {
    const S = Layout.struct({ a: Layout.u8, b: Layout.u32, c: Layout.u16 })
    expect(S.offsets).toEqual({ a: 0, b: 4, c: 8 })
    expect(S.align).toBe(4)
    expect(S.size).toBe(12)
  })

  it("packed struct has no padding", () => {
    const S = Layout.struct({ a: Layout.u8, b: Layout.u32, c: Layout.u16 }, { packed: true })
    expect(S.offsets).toEqual({ a: 0, b: 1, c: 5 })
    expect(S.align).toBe(1)
    expect(S.size).toBe(7)
  })

  it("nested structs and fixed arrays round-trip", () => {
    const Vec2 = Layout.struct({ x: Layout.f32, y: Layout.f32 })
    const S = Layout.struct({
      position: Vec2,
      tags: Layout.array(Layout.u8, 3),
      id: Layout.u64,
    })
    expect(S.offsets).toEqual({ position: 0, tags: 8, id: 16 })
    expect(S.size).toBe(24)
    const view = new DataView(new ArrayBuffer(S.size))
    const value = { position: { x: 1.5, y: -2 }, tags: [1, 2, 3], id: 42n }
    S.write(view, 0, value)
    expect(S.read(view, 0)).toEqual(value)
  })

  it("fixed array rejects wrong lengths", () => {
    const A = Layout.array(Layout.u8, 2)
    expect(() => A.write(new DataView(new ArrayBuffer(2)), 0, [1])).toThrow(RangeError)
  })

  it("guards", () => {
    expect(Layout.isPrimitive(Layout.f32)).toBe(true)
    expect(Layout.isStruct(Layout.f32)).toBe(false)
    expect(Layout.isStruct(Layout.struct({}))).toBe(true)
    expect(Layout.isLayout({})).toBe(false)
  })
})
