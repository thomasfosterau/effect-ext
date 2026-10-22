import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Result from "effect/Result"
import * as Allocator from "../src/Allocator.ts"

describe("Allocator", () => {
  it.effect("defaults to the heap allocator", () =>
    Effect.gen(function* () {
      const allocator = yield* Allocator.Allocator
      expect(allocator.name).toBe("heap")
      const block = yield* Allocator.allocate(16)
      expect(block.byteLength).toBe(16)
      expect(Allocator.bytes(block).every((b) => b === 0)).toBe(true)
    }),
  )

  it.effect("heap reallocate preserves contents and detaches the old buffer", () =>
    Effect.gen(function* () {
      const block = yield* Effect.fromResult(Allocator.heap.allocate(4, 4))
      Allocator.bytes(block).set([1, 2, 3, 4])
      const grown = yield* Effect.fromResult(Allocator.heap.reallocate(block, 8, 4))
      expect(Array.from(Allocator.bytes(grown))).toEqual([1, 2, 3, 4, 0, 0, 0, 0])
      expect(block.buffer.detached).toBe(true)
      Allocator.heap.deallocate(grown)
      expect(grown.buffer.detached).toBe(true)
    }),
  )

  it("AllocationError is a tagged error with a descriptive message", () => {
    const error = new Allocator.AllocationError({ size: 16, align: 8, reason: "out of memory" })
    expect(error._tag).toBe("AllocationError")
    expect(error.message).toBe("Failed to allocate 16 bytes (align 8): out of memory")
  })

  it("rejects invalid requests", () => {
    expect(Result.isFailure(Allocator.heap.allocate(-1, 8))).toBe(true)
    expect(Result.isFailure(Allocator.heap.allocate(8, 3))).toBe(true)
  })

  describe("arena", () => {
    it.effect("bumps with alignment", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(64)
        const a = yield* Effect.fromResult(arena.allocate(3, 1))
        const b = yield* Effect.fromResult(arena.allocate(8, 8))
        expect(a.byteOffset).toBe(0)
        expect(b.byteOffset).toBe(8)
        expect(arena.used).toBe(16)
      }),
    )

    it("fails when exhausted", () => {
      const arena = Allocator.makeArenaUnsafe(8)
      expect(Result.isSuccess(arena.allocate(8, 1))).toBe(true)
      const result = arena.allocate(1, 1)
      expect(Result.isFailure(result) && result.failure._tag).toBe("AllocationError")
    })

    it.effect("grows the last block in place", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(64)
        const a = yield* Effect.fromResult(arena.allocate(8, 8))
        Allocator.bytes(a).fill(7)
        const grown = yield* Effect.fromResult(arena.reallocate(a, 16, 8))
        expect(grown.byteOffset).toBe(a.byteOffset)
        expect(Array.from(Allocator.bytes(grown))).toEqual([
          ...Array(8).fill(7),
          ...Array(8).fill(0),
        ])
      }),
    )

    it.effect("moves non-last blocks when growing", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(64)
        const a = yield* Effect.fromResult(arena.allocate(4, 4))
        Allocator.bytes(a).set([1, 2, 3, 4])
        yield* Effect.fromResult(arena.allocate(4, 4))
        const grown = yield* Effect.fromResult(arena.reallocate(a, 8, 4))
        expect(grown.byteOffset).toBe(8)
        expect(Array.from(Allocator.bytes(grown))).toEqual([1, 2, 3, 4, 0, 0, 0, 0])
      }),
    )

    it.effect("pops the last block and resets", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(64)
        const a = yield* Effect.fromResult(arena.allocate(8, 8))
        arena.deallocate(a)
        expect(arena.used).toBe(0)
        yield* Effect.fromResult(arena.allocate(8, 8))
        yield* Effect.fromResult(arena.allocate(8, 8))
        arena.reset()
        expect(arena.used).toBe(0)
      }),
    )

    it.effect("can be installed as a layer", () =>
      Effect.gen(function* () {
        const allocator = yield* Allocator.Allocator
        expect(allocator.name).toBe("arena")
        const exit = yield* Effect.exit(Allocator.allocate(2048))
        expect(Exit.isFailure(exit)).toBe(true)
      }).pipe(Effect.provide(Allocator.layerArena(1024))),
    )
  })

  it.effect("allocateScoped deallocates when the scope closes", () =>
    Effect.gen(function* () {
      const tracked = Allocator.tracked(Allocator.heap)
      yield* Effect.scoped(Allocator.allocateScoped(32)).pipe(Allocator.withAllocator(tracked))
      expect(tracked.stats()).toMatchObject({ liveBlocks: 0, liveBytes: 0, allocations: 1 })
    }),
  )
})
