import { describe, expect, it, layer } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Allocator from "@thomasfosterau/effect-ext/Allocator";
import * as Layout from "@thomasfosterau/effect-ext/Layout";
import * as Vec from "@thomasfosterau/effect-ext/Vec";

const Point = Layout.struct({ x: Layout.i32, y: Layout.i32 });

/** The heap, refusing any block larger than `limit` bytes. */
const capped = (limit: number): Allocator.Allocator => ({
  name: "capped",
  allocate: (size, align) =>
    size > limit
      ? Result.fail(new Allocator.AllocationError({ size, align, reason: "over the cap" }))
      : Allocator.heap.allocate(size, align),
  reallocate: (block, size, align) =>
    size > limit
      ? Result.fail(new Allocator.AllocationError({ size, align, reason: "over the cap" }))
      : Allocator.heap.reallocate(block, size, align),
  deallocate: Allocator.heap.deallocate,
});

describe("Vec", () => {
  it.effect("push, get, length and capacity", () =>
    Effect.gen(function* () {
      const v = yield* Vec.make(Layout.u16);
      expect(v.capacity).toBe(0);
      yield* Effect.forEach(Arr.range(0, 9), (i) => Vec.push(v, i * 3), {
        concurrency: 1,
        discard: true,
      });
      expect(v.length).toBe(10);
      expect(v.capacity).toBeGreaterThanOrEqual(10);
      expect(Vec.get(v, 3)).toEqual(Option.some(9));
      expect(Vec.get(v, 10)).toEqual(Option.none());
      expect(() => Vec.getUnsafe(v, -1)).toThrow(RangeError);
    }),
  );

  it.effect("fromIterable, toArray and typedArray", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Layout.f64, [1.5, 2.5, 3.5]);
      expect(Vec.toArray(v)).toEqual([1.5, 2.5, 3.5]);
      const array: Float64Array = Vec.typedArray(v);
      expect(Array.from(array)).toEqual([1.5, 2.5, 3.5]);
      array[0] = 10;
      expect(Vec.getUnsafe(v, 0)).toBe(10);
    }),
  );

  it.effect("set, pop, remove, swapRemove, insert", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Layout.i32, [0, 1, 2, 3, 4]);
      expect(Vec.set(v, 1, 10)).toBe(true);
      expect(Vec.set(v, 5, 10)).toBe(false);
      expect(Vec.pop(v)).toEqual(Option.some(4));
      expect(Vec.remove(v, 0)).toEqual(Option.some(0));
      expect(Vec.toArray(v)).toEqual([10, 2, 3]);
      expect(Vec.swapRemove(v, 0)).toEqual(Option.some(10));
      expect(Vec.toArray(v)).toEqual([3, 2]);
      yield* Vec.insert(v, 1, 99);
      yield* Vec.insert(v, 3, 100);
      expect(Vec.toArray(v)).toEqual([3, 99, 2, 100]);
      const exit = yield* Effect.exit(Vec.insert(v, 10, 0));
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("truncate, clear, reserve and shrinkToFit", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Layout.u8, [1, 2, 3, 4, 5]);
      Vec.truncate(v, 2);
      expect(Vec.toArray(v)).toEqual([1, 2]);
      yield* Vec.reserve(v, 100);
      expect(v.capacity).toBeGreaterThanOrEqual(102);
      yield* Vec.shrinkToFit(v);
      expect(v.capacity).toBe(2);
      expect(Vec.toArray(v)).toEqual([1, 2]);
      Vec.clear(v);
      expect(Vec.isEmpty(v)).toBe(true);
    }),
  );

  it.effect("struct elements and element views", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Point, [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]);
      expect(Vec.toArray(v)).toEqual([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]);
      const p = yield* Effect.fromOption(Vec.at(v, 1));
      p.y = 40;
      expect(Vec.getUnsafe(v, 1)).toEqual({ x: 3, y: 40 });
      expect(Vec.bytes(v).byteLength).toBe(16);
    }),
  );

  layer(Allocator.layerArena(64))("in an arena of 64 bytes", (arena) => {
    arena.effect("works with an arena and fails cleanly when it is exhausted", () =>
      Effect.gen(function* () {
        const v = yield* Vec.make(Layout.u32);
        yield* Vec.extend(v, [1, 2, 3, 4, 5, 6, 7, 8]);
        expect(v.allocator.name).toBe("arena");
        const exit = yield* Effect.exit(Vec.reserve(v, 1000));
        expect(Exit.isFailure(exit)).toBe(true);
        expect(Vec.toArray(v)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      }),
    );
  });

  it.effect("makeScoped frees on scope close", () =>
    Effect.gen(function* () {
      const tracked = Allocator.tracked(Allocator.heap);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const v = yield* Vec.makeScoped(Layout.f32);
          yield* Vec.extend(v, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
          expect(tracked.stats().liveBlocks).toBe(1);
        }),
      ).pipe(Allocator.withAllocator(tracked));
      expect(tracked.stats()).toMatchObject({ liveBlocks: 0, liveBytes: 0 });
    }),
  );

  it.effect("supports pipe and iteration", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Layout.i8, [-1, 0, 1]);
      expect([...v]).toEqual([-1, 0, 1]);
      expect(v.pipe(Vec.get(0))).toEqual(Option.some(-1));
      expect(v.toJSON()).toEqual({ _id: "Vec", layout: "i8", values: [-1, 0, 1] });
    }),
  );

  describe("synchronous append", () => {
    it.effect("pushResult grows from zero capacity", () =>
      Effect.gen(function* () {
        const v = yield* Vec.make(Layout.u32);
        expect(v.capacity).toBe(0);
        Arr.range(0, 9).forEach((i) =>
          expect(Result.isSuccess(Vec.pushResult(v, i * 7))).toBe(true),
        );
        expect(Vec.toArray(v)).toEqual(Arr.range(0, 9).map((i) => i * 7));
        expect(v.capacity).toBeGreaterThanOrEqual(10);
        expect(Result.isSuccess(v.pipe(Vec.pushResult(70)))).toBe(true);
        expect(Vec.getUnsafe(v, 10)).toBe(70);
      }),
    );

    it.effect("pushResult reports allocation failure and leaves the vector unchanged", () =>
      Effect.gen(function* () {
        const v = yield* Vec.make(Layout.u32).pipe(Allocator.withAllocator(capped(16)));
        Arr.range(1, 4).forEach((i) => expect(Result.isSuccess(Vec.pushResult(v, i))).toBe(true));
        expect(v.capacity).toBe(4);
        const result = Vec.pushResult(v, 5);
        expect(Result.isFailure(result) && result.failure._tag).toBe("AllocationError");
        expect(Vec.toArray(v)).toEqual([1, 2, 3, 4]);
        expect(v.capacity).toBe(4);
      }),
    );

    it.effect("reserveResult reserves synchronously, and fails cleanly", () =>
      Effect.gen(function* () {
        const v = yield* Vec.make(Point).pipe(Allocator.withAllocator(capped(80)));
        expect(Result.isSuccess(Vec.reserveResult(v, 0))).toBe(true);
        expect(v.capacity).toBe(0);
        expect(Result.isSuccess(v.pipe(Vec.reserveResult(10)))).toBe(true);
        expect(v.capacity).toBe(10);
        expect(Result.isFailure(Vec.reserveResult(v, 11))).toBe(true);
        expect(v.capacity).toBe(10);
        expect(v.length).toBe(0);
      }),
    );

    it.effect("pushUnsafe fills reserved capacity and throws when full", () =>
      Effect.gen(function* () {
        const empty = yield* Vec.make(Point);
        expect(() => Vec.pushUnsafe(empty, { x: 0, y: 0 })).toThrow(RangeError);
        const v = yield* Vec.make(Point, { capacity: 2 });
        Vec.pushUnsafe(v, { x: 1, y: 2 });
        v.pipe(Vec.pushUnsafe({ x: 3, y: 4 }));
        expect(() => Vec.pushUnsafe(v, { x: 5, y: 6 })).toThrow(RangeError);
        expect(Vec.toArray(v)).toEqual([
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ]);
      }),
    );

    it.effect("growth keeps the elements written through reserve", () =>
      Effect.gen(function* () {
        const v = yield* Vec.make(Layout.f64);
        yield* Effect.fromResult(Vec.reserveResult(v, 3));
        [0.5, 1.5, 2.5].forEach((x) => Vec.pushUnsafe(v, x));
        yield* Effect.fromResult(Vec.reserveResult(v, 100));
        expect(v.capacity).toBeGreaterThanOrEqual(103);
        Vec.pushUnsafe(v, 3.5);
        expect(Vec.toArray(v)).toEqual([0.5, 1.5, 2.5, 3.5]);
      }),
    );
  });

  describe("spare capacity", () => {
    it.effect("is empty with no capacity and when full", () =>
      Effect.gen(function* () {
        const v = yield* Vec.make(Layout.u16);
        expect(Vec.spareCapacity(v)).toEqual(new Uint16Array(0));
        expect(Vec.spareBytes(v).byteLength).toBe(0);
        yield* Vec.extend(v, [1, 2, 3, 4]);
        yield* Vec.shrinkToFit(v);
        expect(Vec.spareCapacity(v).length).toBe(0);
        expect(Vec.spareBytes(v).byteLength).toBe(0);
      }),
    );

    it.effect("views the slots past the length, which setLenUnsafe then adopts", () =>
      Effect.gen(function* () {
        const v = yield* Vec.fromIterable(Layout.i16, [-1]);
        yield* Effect.fromResult(Vec.reserveResult(v, 4));
        const spare = Vec.spareCapacity(v);
        expect(spare.length).toBe(v.capacity - 1);
        spare.set([-2, -3, -4, -5]);
        expect(Vec.toArray(v)).toEqual([-1]);
        Vec.setLenUnsafe(v, 5);
        expect(Vec.toArray(v)).toEqual([-1, -2, -3, -4, -5]);
        expect(Vec.typedArray(v)).toEqual(Int16Array.of(-1, -2, -3, -4, -5));
      }),
    );

    it.effect("spareBytes fills a vector of structs at the layout stride", () =>
      Effect.gen(function* () {
        const v = yield* Vec.fromIterable(Point, [{ x: 1, y: 1 }]);
        yield* Effect.fromResult(Vec.reserveResult(v, 2));
        const bytes = Vec.spareBytes(v);
        expect(bytes.byteLength).toBe((v.capacity - 1) * Point.size);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        Point.write(view, 0, { x: 2, y: -2 });
        Point.write(view, Point.size, { x: 3, y: -3 });
        v.pipe(Vec.setLenUnsafe(3));
        expect(Vec.toArray(v)).toEqual([
          { x: 1, y: 1 },
          { x: 2, y: -2 },
          { x: 3, y: -3 },
        ]);
      }),
    );

    it.effect("setLenUnsafe beyond the capacity, negative or fractional is a defect", () =>
      Effect.gen(function* () {
        const v = yield* Vec.make(Layout.u8, { capacity: 4 });
        expect(() => Vec.setLenUnsafe(v, 5)).toThrow(RangeError);
        expect(() => Vec.setLenUnsafe(v, -1)).toThrow(RangeError);
        expect(() => Vec.setLenUnsafe(v, 1.5)).toThrow(RangeError);
        expect(() => Vec.setLenUnsafe(v, Number.NaN)).toThrow(RangeError);
        const exit = yield* Effect.exit(Effect.sync(() => Vec.setLenUnsafe(v, 5)));
        expect(Exit.hasDies(exit)).toBe(true);
        Vec.setLenUnsafe(v, 4);
        expect(v.length).toBe(4);
        Vec.setLenUnsafe(v, 0);
        expect(Vec.isEmpty(v)).toBe(true);
        const empty = yield* Vec.make(Layout.u8);
        Vec.setLenUnsafe(empty, 0);
        expect(() => Vec.setLenUnsafe(empty, 1)).toThrow(RangeError);
      }),
    );

    it.effect("free resets the capacity the synchronous API sees", () =>
      Effect.gen(function* () {
        const v = yield* Vec.fromIterable(Layout.u8, [1, 2, 3]);
        yield* Vec.free(v);
        expect(v.capacity).toBe(0);
        expect(() => Vec.pushUnsafe(v, 1)).toThrow(RangeError);
        expect(() => Vec.setLenUnsafe(v, 1)).toThrow(RangeError);
        expect(Result.isSuccess(Vec.pushResult(v, 9))).toBe(true);
        expect(Vec.toArray(v)).toEqual([9]);
      }),
    );
  });
});
