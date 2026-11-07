import { describe, expect, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import * as Allocator from "@thomasfosterau/effect-ext/Allocator";

describe("Allocator", () => {
  it.effect("defaults to the heap allocator", () =>
    Effect.gen(function* () {
      const allocator = yield* Allocator.Allocator;
      expect(allocator.name).toBe("heap");
      const block = yield* Allocator.allocate(16);
      expect(block.byteLength).toBe(16);
      expect(Allocator.bytes(block).every((b) => b === 0)).toBe(true);
    }),
  );

  it.effect("heap reallocate preserves contents and detaches the old buffer", () =>
    Effect.gen(function* () {
      const block = yield* Effect.fromResult(Allocator.heap.allocate(4, 4));
      Allocator.bytes(block).set([1, 2, 3, 4]);
      const grown = yield* Effect.fromResult(Allocator.heap.reallocate(block, 8, 4));
      expect(Array.from(Allocator.bytes(grown))).toEqual([1, 2, 3, 4, 0, 0, 0, 0]);
      expect(block.buffer.detached).toBe(true);
      Allocator.heap.deallocate(grown);
      expect(grown.buffer.detached).toBe(true);
    }),
  );

  it("AllocationError is a tagged error with a descriptive message", () => {
    const error = new Allocator.AllocationError({ size: 16, align: 8, reason: "out of memory" });
    expect(error._tag).toBe("AllocationError");
    expect(error.message).toBe("Failed to allocate 16 bytes (align 8): out of memory");
  });

  it("rejects invalid requests", () => {
    expect(Result.isFailure(Allocator.heap.allocate(-1, 8))).toBe(true);
    expect(Result.isFailure(Allocator.heap.allocate(8, 3))).toBe(true);
  });

  describe("arena", () => {
    it.effect("bumps with alignment", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(64);
        const a = yield* Effect.fromResult(arena.allocate(3, 1));
        const b = yield* Effect.fromResult(arena.allocate(8, 8));
        expect(a.byteOffset).toBe(0);
        expect(b.byteOffset).toBe(8);
        expect(arena.used).toBe(16);
      }),
    );

    it("fails when exhausted", () => {
      const arena = Allocator.makeArenaUnsafe(8);
      expect(Result.isSuccess(arena.allocate(8, 1))).toBe(true);
      const result = arena.allocate(1, 1);
      expect(Result.isFailure(result) && result.failure._tag).toBe("AllocationError");
    });

    it.effect("grows the last block in place", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(64);
        const a = yield* Effect.fromResult(arena.allocate(8, 8));
        Allocator.bytes(a).fill(7);
        const grown = yield* Effect.fromResult(arena.reallocate(a, 16, 8));
        expect(grown.byteOffset).toBe(a.byteOffset);
        expect(Array.from(Allocator.bytes(grown))).toEqual([
          ...Array(8).fill(7),
          ...Array(8).fill(0),
        ]);
      }),
    );

    it.effect("moves non-last blocks when growing", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(64);
        const a = yield* Effect.fromResult(arena.allocate(4, 4));
        Allocator.bytes(a).set([1, 2, 3, 4]);
        yield* Effect.fromResult(arena.allocate(4, 4));
        const grown = yield* Effect.fromResult(arena.reallocate(a, 8, 4));
        expect(grown.byteOffset).toBe(8);
        expect(Array.from(Allocator.bytes(grown))).toEqual([1, 2, 3, 4, 0, 0, 0, 0]);
      }),
    );

    it.effect("pops the last block and resets", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(64);
        const a = yield* Effect.fromResult(arena.allocate(8, 8));
        arena.deallocate(a);
        expect(arena.used).toBe(0);
        yield* Effect.fromResult(arena.allocate(8, 8));
        yield* Effect.fromResult(arena.allocate(8, 8));
        arena.reset();
        expect(arena.used).toBe(0);
      }),
    );

    layer(Allocator.layerArena(1024))("in an arena of 1024 bytes", (arena) => {
      arena.effect("can be installed as a layer", () =>
        Effect.gen(function* () {
          const allocator = yield* Allocator.Allocator;
          expect(allocator.name).toBe("arena");
          const exit = yield* Effect.exit(Allocator.allocate(2048));
          expect(Exit.isFailure(exit)).toBe(true);
        }),
      );
    });
  });

  describe("tracked (effect-ext#18)", () => {
    it.effect("counts a double free once and reports it, never going negative", () =>
      Effect.gen(function* () {
        const tracked = Allocator.tracked(Allocator.heap);
        const block = yield* Effect.fromResult(tracked.allocate(8, 8));
        tracked.deallocate(block);
        tracked.deallocate(block);
        expect(tracked.stats()).toEqual({
          liveBlocks: 0,
          liveBytes: 0,
          allocations: 1,
          reallocations: 0,
          deallocations: 1,
          invalidDeallocations: 1,
        });
      }),
    );

    it.effect("tracks several blocks and a reallocated one by identity", () =>
      Effect.gen(function* () {
        const tracked = Allocator.tracked(Allocator.heap);
        const a = yield* Effect.fromResult(tracked.allocate(8, 8));
        const b = yield* Effect.fromResult(tracked.allocate(16, 8));
        const grown = yield* Effect.fromResult(tracked.reallocate(a, 32, 8));
        // The block `reallocate` replaced is no longer live.
        tracked.deallocate(a);
        expect(tracked.stats()).toMatchObject({
          liveBlocks: 2,
          liveBytes: 48,
          deallocations: 0,
          invalidDeallocations: 1,
        });
        tracked.deallocate(grown);
        tracked.deallocate(b);
        expect(tracked.stats()).toMatchObject({ liveBlocks: 0, liveBytes: 0, deallocations: 2 });
      }),
    );

    it.effect("ignores a block it never handed out, and does not pass it on", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(16);
        const tracked = Allocator.tracked(arena);
        const foreign = yield* Effect.fromResult(arena.allocate(8, 1));
        tracked.deallocate(foreign);
        expect(arena.used).toBe(8);
        expect(tracked.stats()).toMatchObject({ liveBlocks: 0, invalidDeallocations: 1 });
      }),
    );

    it.effect("keeps a stale double free from releasing the arena block now at the top", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(16);
        const tracked = Allocator.tracked(arena);
        const first = yield* Effect.fromResult(tracked.allocate(8, 1));
        tracked.deallocate(first);
        const second = yield* Effect.fromResult(tracked.allocate(8, 1));
        expect(second.byteOffset).toBe(first.byteOffset);
        tracked.deallocate(first);
        expect(arena.used).toBe(8);
        expect(tracked.stats()).toMatchObject({ liveBlocks: 1, liveBytes: 8 });
      }),
    );
  });

  describe("arena capacity and large offsets (effect-ext#19)", () => {
    it("rejects a capacity that is not a non-negative integer", () => {
      expect(() => Allocator.makeArenaUnsafe(1.5)).toThrow(Allocator.AllocationError);
      expect(() => Allocator.makeArenaUnsafe(-1)).toThrow(
        "capacity must be a non-negative integer",
      );
    });

    it.effect("makeArena fails with AllocationError for a fractional capacity", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Allocator.makeArena(1.5));
        expect(error).toBeInstanceOf(Allocator.AllocationError);
        expect(error.reason).toBe("capacity must be a non-negative integer");
      }),
    );

    it.effect("says the same thing when full, whether growing in place or bumping", () =>
      Effect.gen(function* () {
        const arena = Allocator.makeArenaUnsafe(8);
        const block = yield* Effect.fromResult(arena.allocate(4, 1));
        const grow = arena.reallocate(block, 16, 1);
        const bump = arena.allocate(16, 1);
        expect(Result.isFailure(grow) && grow.failure.reason).toBe(
          "arena exhausted (4 of 8 bytes free)",
        );
        expect(Result.isFailure(bump) && bump.failure.reason).toBe(
          "arena exhausted (4 of 8 bytes free)",
        );
      }),
    );

    it("accepts an alignment of 2^31 and beyond", () => {
      expect(Result.isSuccess(Allocator.heap.allocate(0, 2 ** 31))).toBe(true);
      expect(Result.isSuccess(Allocator.heap.allocate(0, 2 ** 40))).toBe(true);
      expect(Result.isFailure(Allocator.heap.allocate(0, 2 ** 40 + 2))).toBe(true);
    });
  });

  it.effect("allocateScoped deallocates when the scope closes", () =>
    Effect.gen(function* () {
      const tracked = Allocator.tracked(Allocator.heap);
      yield* Effect.scoped(Allocator.allocateScoped(32)).pipe(Allocator.withAllocator(tracked));
      expect(tracked.stats()).toMatchObject({ liveBlocks: 0, liveBytes: 0, allocations: 1 });
    }),
  );
});
