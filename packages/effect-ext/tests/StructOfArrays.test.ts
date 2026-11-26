import { describe, expect, it, layer } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Allocator from "@thomasfosterau/effect-ext/Allocator";
import * as Layout from "@thomasfosterau/effect-ext/Layout";
import * as StructOfArrays from "@thomasfosterau/effect-ext/StructOfArrays";
import * as Panic from "@thomasfosterau/effect-ext/Panic";

const Particle = {
  id: Layout.u16,
  x: Layout.f64,
  alive: Layout.bool,
  y: Layout.f32,
};

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

const Token = { kind: Layout.u32, next: Layout.u32, start: Layout.u32, end: Layout.u32 };

describe("StructOfArrays", () => {
  it.effect("push, get and columns", () =>
    Effect.gen(function* () {
      const soa = yield* StructOfArrays.make(Particle);
      yield* Effect.forEach(
        Arr.range(0, 8),
        (i) => StructOfArrays.push(soa, { id: i, x: i * 1.5, alive: i % 2 === 0, y: -i }),
        { concurrency: 1, discard: true },
      );
      expect(soa.length).toBe(9);
      expect(StructOfArrays.get(soa, 2)).toEqual(Option.some({ id: 2, x: 3, alive: true, y: -2 }));
      const xs: Float64Array = StructOfArrays.column(soa, "x");
      expect(Array.from(xs)).toEqual([0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12]);
      expect(Array.from(StructOfArrays.column(soa, "id"))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(Array.from(StructOfArrays.column(soa, "alive"))).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1]);
      expect(Array.from(StructOfArrays.values(soa, "y"))).toEqual([
        -0, -1, -2, -3, -4, -5, -6, -7, -8,
      ]);
    }),
  );

  it.effect("columns survive growth and shrinking", () =>
    Effect.gen(function* () {
      const records = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        x: i / 2,
        alive: i % 3 === 0,
        y: i * 2,
      }));
      const soa = yield* StructOfArrays.fromIterable(Particle, records.slice(0, 3));
      yield* StructOfArrays.extend(soa, records.slice(3));
      expect(StructOfArrays.toArray(soa)).toEqual(records);
      yield* StructOfArrays.reserve(soa, 1000);
      expect(StructOfArrays.toArray(soa)).toEqual(records);
      StructOfArrays.truncate(soa, 10);
      yield* StructOfArrays.shrinkToFit(soa);
      expect(soa.capacity).toBe(10);
      expect(StructOfArrays.toArray(soa)).toEqual(records.slice(0, 10));
    }),
  );

  it.effect("fields, set, pop and swapRemove", () =>
    Effect.gen(function* () {
      const soa = yield* StructOfArrays.fromIterable(
        Layout.struct({ a: Layout.u8, b: Layout.i32 }),
        [
          { a: 1, b: 10 },
          { a: 2, b: 20 },
          { a: 3, b: 30 },
        ],
      );
      StructOfArrays.setField(soa, 0, "b", 11);
      expect(StructOfArrays.getField(soa, 0, "b")).toBe(11);
      expect(() => StructOfArrays.getField(soa, 3, "b")).toThrow(Panic.IndexOutOfBoundsError);
      expect(StructOfArrays.set(soa, 1, { a: 9, b: 90 })).toBe(true);
      expect(StructOfArrays.swapRemove(soa, 0)).toEqual(Option.some({ a: 1, b: 11 }));
      expect(StructOfArrays.toArray(soa)).toEqual([
        { a: 3, b: 30 },
        { a: 9, b: 90 },
      ]);
      expect(StructOfArrays.pop(soa)).toEqual(Option.some({ a: 9, b: 90 }));
      expect(soa.length).toBe(1);
    }),
  );

  it.effect("supports nested struct fields", () =>
    Effect.gen(function* () {
      const soa = yield* StructOfArrays.make({
        position: Layout.struct({ x: Layout.f32, y: Layout.f32 }),
        id: Layout.u32,
      });
      yield* StructOfArrays.push(soa, { position: { x: 1, y: 2 }, id: 7 });
      expect(StructOfArrays.getUnsafe(soa, 0)).toEqual({ position: { x: 1, y: 2 }, id: 7 });
    }),
  );

  layer(Allocator.layerArena(4096))("in an arena of 4096 bytes", (arena) => {
    arena.effect("grows in place inside an arena", () =>
      Effect.gen(function* () {
        const soa = yield* StructOfArrays.make(Particle);
        const records = Array.from({ length: 20 }, (_, i) => ({
          id: i,
          x: i,
          alive: true,
          y: i,
        }));
        yield* StructOfArrays.extend(soa, records);
        expect(StructOfArrays.toArray(soa)).toEqual(records);
      }),
    );
  });

  it.effect("free releases memory", () =>
    Effect.gen(function* () {
      const tracked = Allocator.tracked(Allocator.heap);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const soa = yield* StructOfArrays.makeScoped(Particle, { capacity: 8 });
          yield* StructOfArrays.push(soa, { id: 1, x: 1, alive: true, y: 1 });
        }),
      ).pipe(Allocator.withAllocator(tracked));
      expect(tracked.stats()).toMatchObject({ liveBlocks: 0, liveBytes: 0 });
    }),
  );

  describe("synchronous append", () => {
    it.effect("pushResult grows from zero capacity across reallocations", () =>
      Effect.gen(function* () {
        const soa = yield* StructOfArrays.make(Particle);
        const records = Arr.range(0, 20).map((i) => ({
          id: i,
          x: i / 4,
          alive: i % 3 === 0,
          y: i * 2,
        }));
        records.forEach((record) =>
          expect(Result.isSuccess(StructOfArrays.pushResult(soa, record))).toBe(true),
        );
        expect(StructOfArrays.toArray(soa)).toEqual(records);
        expect(StructOfArrays.column(soa, "x")).toEqual(Float64Array.from(records, (r) => r.x));
        expect(Result.isSuccess(soa.pipe(StructOfArrays.pushResult(records[0])))).toBe(true);
        expect(soa.length).toBe(22);
      }),
    );

    it.effect("pushResult reports allocation failure and leaves the container unchanged", () =>
      Effect.gen(function* () {
        // 16 bytes a record: four fit in 64 bytes, eight do not.
        const soa = yield* StructOfArrays.make(Token).pipe(Allocator.withAllocator(capped(64)));
        const records = Arr.range(0, 3).map((i) => ({ kind: i, next: i + 1, start: i, end: i }));
        records.forEach((record) =>
          expect(Result.isSuccess(StructOfArrays.pushResult(soa, record))).toBe(true),
        );
        const result = StructOfArrays.pushResult(soa, records[0]);
        expect(Result.isFailure(result) && result.failure._tag).toBe("AllocationError");
        expect(StructOfArrays.toArray(soa)).toEqual(records);
        expect(soa.capacity).toBe(4);
      }),
    );

    it.effect("reserveResult reserves synchronously, and fails cleanly", () =>
      Effect.gen(function* () {
        const soa = yield* StructOfArrays.make(Token).pipe(Allocator.withAllocator(capped(160)));
        expect(Result.isSuccess(StructOfArrays.reserveResult(soa, 0))).toBe(true);
        expect(soa.capacity).toBe(0);
        expect(Result.isSuccess(soa.pipe(StructOfArrays.reserveResult(10)))).toBe(true);
        expect(soa.capacity).toBe(10);
        expect(Result.isFailure(StructOfArrays.reserveResult(soa, 11))).toBe(true);
        expect(soa.capacity).toBe(10);
      }),
    );

    it.effect("pushUnsafe fills reserved capacity and throws when full", () =>
      Effect.gen(function* () {
        const empty = yield* StructOfArrays.make(Token);
        const record = { kind: 1, next: 2, start: 3, end: 4 };
        expect(() => StructOfArrays.pushUnsafe(empty, record)).toThrow(Panic.CapacityError);
        const soa = yield* StructOfArrays.make(Token, { capacity: 2 });
        StructOfArrays.pushUnsafe(soa, record);
        soa.pipe(StructOfArrays.pushUnsafe({ ...record, kind: 9 }));
        expect(() => StructOfArrays.pushUnsafe(soa, record)).toThrow(Panic.CapacityError);
        expect(StructOfArrays.column(soa, "kind")).toEqual(Uint32Array.of(1, 9));
        expect(StructOfArrays.getUnsafe(soa, 1)).toEqual({ ...record, kind: 9 });
      }),
    );

    it.effect("a record read keeps the fields' key order, not the column order", () =>
      Effect.gen(function* () {
        const soa = yield* StructOfArrays.fromIterable(Particle, [
          { id: 1, x: 2, alive: true, y: 3 },
        ]);
        expect(R.keys(StructOfArrays.getUnsafe(soa, 0))).toEqual(["id", "x", "alive", "y"]);
      }),
    );
  });

  describe("spare columns", () => {
    it.effect("are empty with no capacity and when full", () =>
      Effect.gen(function* () {
        const soa = yield* StructOfArrays.make(Particle);
        expect(StructOfArrays.spareColumn(soa, "x")).toEqual(new Float64Array(0));
        yield* StructOfArrays.extend(soa, [{ id: 1, x: 1, alive: true, y: 1 }]);
        yield* StructOfArrays.shrinkToFit(soa);
        expect(soa.pipe(StructOfArrays.spareColumn("id")).length).toBe(0);
      }),
    );

    it.effect("view each column past the length, which setLenUnsafe then adopts", () =>
      Effect.gen(function* () {
        const soa = yield* StructOfArrays.fromIterable(Particle, [
          { id: 7, x: 0.5, alive: true, y: 1 },
        ]);
        yield* Effect.fromResult(StructOfArrays.reserveResult(soa, 3));
        const spare = soa.capacity - 1;
        const id = StructOfArrays.spareColumn(soa, "id");
        const x = StructOfArrays.spareColumn(soa, "x");
        const alive = StructOfArrays.spareColumn(soa, "alive");
        const y = StructOfArrays.spareColumn(soa, "y");
        expect([id.length, x.length, alive.length, y.length]).toEqual([spare, spare, spare, spare]);
        id.set([8, 9]);
        x.set([1.5, 2.5]);
        alive.set([0, 1]);
        y.set([2, 3]);
        expect(soa.length).toBe(1);
        StructOfArrays.setLenUnsafe(soa, 3);
        expect(StructOfArrays.toArray(soa)).toEqual([
          { id: 7, x: 0.5, alive: true, y: 1 },
          { id: 8, x: 1.5, alive: false, y: 2 },
          { id: 9, x: 2.5, alive: true, y: 3 },
        ]);
      }),
    );

    it.effect("setLenUnsafe beyond the capacity, negative or fractional is a defect", () =>
      Effect.gen(function* () {
        const soa = yield* StructOfArrays.make(Token, { capacity: 4 });
        expect(() => StructOfArrays.setLenUnsafe(soa, 5)).toThrow(Panic.CapacityError);
        expect(() => StructOfArrays.setLenUnsafe(soa, -1)).toThrow(Panic.CapacityError);
        expect(() => StructOfArrays.setLenUnsafe(soa, 0.5)).toThrow(Panic.CapacityError);
        const exit = yield* Effect.exit(Effect.sync(() => StructOfArrays.setLenUnsafe(soa, 5)));
        expect(Exit.hasDies(exit)).toBe(true);
        soa.pipe(StructOfArrays.setLenUnsafe(4));
        expect(soa.length).toBe(4);
        StructOfArrays.setLenUnsafe(soa, 1);
        expect(soa.length).toBe(1);
      }),
    );
  });
});
