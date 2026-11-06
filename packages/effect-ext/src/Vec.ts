/**
 * A growable array backed by `ArrayBuffer` memory, like Rust's `Vec<T>`.
 *
 * Elements are described by a {@link Layout.Layout} and stored contiguously
 * at a stride of `layout.size` bytes. Memory comes from the current
 * {@link Allocator.Allocator} and grows geometrically.
 *
 * Operations that may allocate (`push`, `reserve`, `insert`, …) return an
 * `Effect` that can fail with an `AllocationError`; everything else is
 * synchronous.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const program = Effect.gen(function* () {
 *   const v = yield* Vec.make(Layout.f64)
 *   yield* Vec.push(v, 1.5)
 *   yield* Vec.extend(v, [2.5, 3.5])
 *   return Vec.typedArray(v) // Float64Array [1.5, 2.5, 3.5]
 * })
 * ```
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { format } from "effect/Formatter";
import { dual } from "effect/Function";
import { NodeInspectSymbol } from "effect/Inspectable";
import * as Option from "effect/Option";
import { pipeArguments, type Pipeable } from "effect/Pipeable";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import type * as Scope from "effect/Scope";
import * as Allocator from "./Allocator.ts";
import * as BufferStruct from "./BufferStruct.ts";
import { indexed } from "./internal/iterator.ts";
import type * as Layout from "./Layout.ts";

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId = "~effect-ext/Vec" as const;

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId;

/**
 * @since 0.1.0
 * @category models
 */
export interface Vec<A, L extends Layout.Layout<A> = Layout.Layout<A>>
  extends Iterable<A>, Pipeable {
  readonly [TypeId]: TypeId;
  /** The element layout. */
  readonly layout: L;
  /** The allocator that owns this vector's memory. */
  readonly allocator: Allocator.Allocator;
  /** The number of elements. */
  readonly length: number;
  /** The number of elements that fit without reallocating. */
  readonly capacity: number;
  toJSON(): { readonly _id: "Vec"; readonly layout: string; readonly values: Array<A> };
  toString(): string;
}

/**
 * The element type of a `Vec`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type Element<V> = V extends Vec<infer A, any> ? A : never;

const MIN_CAPACITY = 4;

const emptyView = new DataView(new ArrayBuffer(0));

class VecImpl<A, L extends Layout.Layout<A>> implements Vec<A, L> {
  readonly [TypeId] = TypeId;
  block: Option.Option<Allocator.Block> = Option.none();
  view: DataView = emptyView;
  len = 0;
  readonly stride: number;
  readonly layout: L;
  readonly allocator: Allocator.Allocator;

  constructor(layout: L, allocator: Allocator.Allocator) {
    this.layout = layout;
    this.allocator = allocator;
    this.stride = layout.size;
  }

  get length(): number {
    return this.len;
  }

  get capacity(): number {
    return Option.isSome(this.block) ? this.block.value.byteLength / this.stride : 0;
  }

  resize(capacity: number): Result.Result<void, Allocator.AllocationError> {
    const size = capacity * this.stride;
    const result = Option.isSome(this.block)
      ? this.allocator.reallocate(this.block.value, size, this.layout.align)
      : this.allocator.allocate(size, this.layout.align);
    if (Result.isFailure(result)) return Result.fail(result.failure);
    this.block = Option.some(result.success);
    this.view = Allocator.dataView(result.success);
    return Result.void;
  }

  reserve(additional: number): Result.Result<void, Allocator.AllocationError> {
    const required = this.len + additional;
    const capacity = this.capacity;
    if (required <= capacity) return Result.void;
    return this.resize(Math.max(required, capacity * 2, MIN_CAPACITY));
  }

  read(index: number): A {
    return this.layout.read(this.view, index * this.stride);
  }

  write(index: number, value: A): void {
    this.layout.write(this.view, index * this.stride, value);
  }

  bytes(): Uint8Array {
    return Option.isSome(this.block) ? Allocator.bytes(this.block.value) : new Uint8Array(0);
  }

  [Symbol.iterator](): Iterator<A> {
    return indexed(
      () => this.len,
      (i) => this.read(i),
    );
  }

  pipe() {
    return pipeArguments(this, arguments);
  }

  toJSON() {
    return { _id: "Vec" as const, layout: this.layout._tag, values: Array.from(this) };
  }

  toString() {
    return format(this.toJSON());
  }

  [NodeInspectSymbol]() {
    return this.toJSON();
  }
}

const impl = <A, L extends Layout.Layout<A>>(self: Vec<A, L>): VecImpl<A, L> => {
  if (self instanceof VecImpl) return self;
  throw new TypeError("Vec: expected a Vec created by this module");
};

const checkLayout = (layout: Layout.Any) => {
  if (layout.size === 0) {
    throw new RangeError("Vec: zero-sized layouts are not supported");
  }
};

const checkIndex = (self: VecImpl<any, any>, index: number) => {
  if (!Number.isSafeInteger(index) || index < 0 || index >= self.len) {
    throw new RangeError(`Vec: index ${index} out of bounds (length ${self.len})`);
  }
};

const isIndex = (self: VecImpl<any, any>, index: number) =>
  Number.isSafeInteger(index) && index >= 0 && index < self.len;

/**
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.make(Layout.u8))
 * console.log(Vec.isVec(v), Vec.isVec([1, 2, 3]))
 * // → true false
 * ```
 *
 * @since 0.1.0
 * @category guards
 */
export const isVec = (u: unknown): u is Vec<unknown> => P.hasProperty(u, TypeId);

/**
 * Creates an empty vector using the current allocator. Memory is only
 * allocated once the vector has a non-zero capacity.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.make(Layout.f64, { capacity: 10 }))
 * console.log(Vec.length(v), Vec.capacity(v))
 * // → 0 10
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <L extends Layout.Any>(
  layout: L,
  options?: { readonly capacity?: number },
): Effect.Effect<Vec<Layout.Type<L>, L>, Allocator.AllocationError> =>
  Effect.flatMap(Effect.service(Allocator.Allocator), (allocator) =>
    Effect.suspend(() => {
      checkLayout(layout);
      const self = new VecImpl<Layout.Type<L>, L>(layout, allocator);
      const capacity = options?.capacity ?? 0;
      if (capacity > 0) {
        const result = self.resize(capacity);
        if (Result.isFailure(result)) return Effect.fail(result.failure);
      }
      return Effect.succeed(self);
    }),
  );

/**
 * Like {@link make}, but frees the vector when the surrounding scope closes.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const v = yield* Vec.makeScoped(Layout.u32)
 *     yield* Vec.extend(v, [1, 2, 3])
 *     return Vec.toArray(v)
 *   })
 * )
 * console.log(Effect.runSync(program))
 * // → [ 1, 2, 3 ]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeScoped = <L extends Layout.Any>(
  layout: L,
  options?: { readonly capacity?: number },
): Effect.Effect<Vec<Layout.Type<L>, L>, Allocator.AllocationError, Scope.Scope> =>
  Effect.acquireRelease(make(layout, options), free);

/**
 * Creates a vector containing the elements of an iterable.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.i16, [-1, 0, 1]))
 * console.log(Vec.toArray(v))
 * // → [ -1, 0, 1 ]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromIterable = <L extends Layout.Any>(
  layout: L,
  elements: Iterable<Layout.Type<L>>,
): Effect.Effect<Vec<Layout.Type<L>, L>, Allocator.AllocationError> =>
  Effect.tap(make(layout, { capacity: Array.isArray(elements) ? elements.length : 0 }), (self) =>
    extend(self, elements),
  );

/**
 * Releases the vector's memory. The vector is left empty with zero capacity
 * and can still be used afterwards.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2, 3]))
 * Effect.runSync(Vec.free(v))
 * console.log(Vec.length(v), Vec.capacity(v))
 * // → 0 0
 * ```
 *
 * @since 0.1.0
 * @category destructors
 */
export const free = <A, L extends Layout.Layout<A>>(self: Vec<A, L>): Effect.Effect<void> =>
  Effect.sync(() => {
    const s = impl(self);
    if (Option.isSome(s.block)) {
      s.allocator.deallocate(s.block.value);
      s.block = Option.none();
      s.view = emptyView;
    }
    s.len = 0;
  });

/**
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2, 3]))
 * console.log(Vec.length(v))
 * // → 3
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const length = <A, L extends Layout.Layout<A>>(self: Vec<A, L>): number => impl(self).len;

/**
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.make(Layout.u8, { capacity: 10 }))
 * Effect.runSync(Vec.push(v, 1))
 * console.log(Vec.length(v), Vec.capacity(v))
 * // → 1 10
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const capacity = <A, L extends Layout.Layout<A>>(self: Vec<A, L>): number =>
  impl(self).capacity;

/**
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.make(Layout.u8))
 * console.log(Vec.isEmpty(v))
 * Effect.runSync(Vec.push(v, 1))
 * console.log(Vec.isEmpty(v))
 * // → true
 * // → false
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const isEmpty = <A, L extends Layout.Layout<A>>(self: Vec<A, L>): boolean =>
  impl(self).len === 0;

/**
 * Reads the element at `index`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [10, 40, 30]))
 * console.log(Vec.get(v, 1))
 * // → { _id: 'Option', _tag: 'Some', value: 40 }
 * console.log(Vec.get(v, 3))
 * // → { _id: 'Option', _tag: 'None' }
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const get: {
  (index: number): <A, L extends Layout.Layout<A>>(self: Vec<A, L>) => Option.Option<A>;
  <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number): Option.Option<A>;
} = dual(2, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number) => {
  const s = impl(self);
  return isIndex(s, index) ? Option.some(s.read(index)) : Option.none();
});

/**
 * Reads the element at `index`, throwing a `RangeError` if it is out of
 * bounds.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [10, 40, 30]))
 * console.log(Vec.getUnsafe(v, 1))
 * // → 40
 * ```
 *
 * @since 0.1.0
 * @category unsafe
 */
export const getUnsafe: {
  (index: number): <A, L extends Layout.Layout<A>>(self: Vec<A, L>) => A;
  <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number): A;
} = dual(2, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number) => {
  const s = impl(self);
  checkIndex(s, index);
  return s.read(index);
});

/**
 * Overwrites the element at `index`. Returns `false` (and does nothing) if
 * `index` is out of bounds.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2, 3]))
 * console.log(Vec.set(v, 1, 9), Vec.set(v, 5, 9))
 * console.log(Vec.toArray(v))
 * // → true false
 * // → [ 1, 9, 3 ]
 * ```
 *
 * @since 0.1.0
 * @category setters
 */
export const set: {
  <A>(index: number, value: A): <L extends Layout.Layout<A>>(self: Vec<A, L>) => boolean;
  <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number, value: A): boolean;
} = dual(3, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number, value: A) => {
  const s = impl(self);
  if (!isIndex(s, index)) return false;
  s.write(index, value);
  return true;
});

/**
 * Overwrites the element at `index`, throwing a `RangeError` if it is out of
 * bounds.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2, 3]))
 * Vec.setUnsafe(v, 0, 7)
 * console.log(Vec.toArray(v))
 * // → [ 7, 2, 3 ]
 * ```
 *
 * @since 0.1.0
 * @category unsafe
 */
export const setUnsafe: {
  <A>(index: number, value: A): <L extends Layout.Layout<A>>(self: Vec<A, L>) => void;
  <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number, value: A): void;
} = dual(3, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number, value: A) => {
  const s = impl(self);
  checkIndex(s, index);
  s.write(index, value);
});

/**
 * Returns a {@link BufferStruct.BufferStruct} view of the element at `index`,
 * for vectors of struct layouts. Writing through the view modifies the
 * vector in place.
 *
 * The view is invalidated when the vector reallocates; with the default heap
 * allocator, using an invalidated view throws.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const Point = Layout.struct({ x: Layout.f64, y: Layout.f64 })
 * const v = Effect.runSync(Vec.fromIterable(Point, [{ x: 1, y: 2 }, { x: 3, y: 4 }]))
 * Option.map(Vec.at(v, 1), (p) => {
 *   p.x = 10
 * })
 * console.log(Vec.toArray(v))
 * // → [ { x: 1, y: 2 }, { x: 10, y: 4 } ]
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const at: {
  (
    index: number,
  ): <F extends Layout.Fields>(
    self: Vec<Layout.StructType<F>, Layout.Struct<F>>,
  ) => Option.Option<BufferStruct.BufferStruct<F>>;
  <F extends Layout.Fields>(
    self: Vec<Layout.StructType<F>, Layout.Struct<F>>,
    index: number,
  ): Option.Option<BufferStruct.BufferStruct<F>>;
} = dual(
  2,
  <F extends Layout.Fields>(self: Vec<Layout.StructType<F>, Layout.Struct<F>>, index: number) => {
    const s = impl(self);
    return isIndex(s, index)
      ? Option.some(BufferStruct.view(s.layout, s.view, index * s.stride))
      : Option.none();
  },
);

/**
 * Reserves capacity for at least `additional` more elements.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1]))
 * Effect.runSync(Vec.reserve(v, 10))
 * console.log(Vec.capacity(v) >= 11)
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const reserve: {
  (
    additional: number,
  ): <A, L extends Layout.Layout<A>>(
    self: Vec<A, L>,
  ) => Effect.Effect<void, Allocator.AllocationError>;
  <A, L extends Layout.Layout<A>>(
    self: Vec<A, L>,
    additional: number,
  ): Effect.Effect<void, Allocator.AllocationError>;
} = dual(2, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, additional: number) =>
  Effect.suspend(() => Effect.fromResult(impl(self).reserve(additional))),
);

/**
 * Shrinks the capacity to match the length.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.make(Layout.u8, { capacity: 10 }))
 * Effect.runSync(Vec.extend(v, [1, 2, 3]))
 * console.log(Vec.capacity(v))
 * Effect.runSync(Vec.shrinkToFit(v))
 * console.log(Vec.capacity(v))
 * // → 10
 * // → 3
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const shrinkToFit = <A, L extends Layout.Layout<A>>(
  self: Vec<A, L>,
): Effect.Effect<void, Allocator.AllocationError> =>
  Effect.suspend(() => {
    const s = impl(self);
    if (Option.isNone(s.block) || s.len === s.capacity) return Effect.void;
    if (s.len === 0) return free(self);
    return Effect.fromResult(s.resize(s.len));
  });

/**
 * Appends an element.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2]))
 * Effect.runSync(Vec.push(v, 3))
 * console.log(Vec.toArray(v))
 * // → [ 1, 2, 3 ]
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const push: {
  <A>(
    value: A,
  ): <L extends Layout.Layout<A>>(
    self: Vec<A, L>,
  ) => Effect.Effect<void, Allocator.AllocationError>;
  <A, L extends Layout.Layout<A>>(
    self: Vec<A, L>,
    value: A,
  ): Effect.Effect<void, Allocator.AllocationError>;
} = dual(2, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, value: A) =>
  Effect.suspend(() => {
    const s = impl(self);
    const result = s.reserve(1);
    if (Result.isFailure(result)) return Effect.fail(result.failure);
    s.write(s.len++, value);
    return Effect.void;
  }),
);

/**
 * Appends every element of an iterable. Capacity for all of them is reserved
 * up front, so either every element is appended or, on allocation failure,
 * none are.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1]))
 * Effect.runSync(v.pipe(Vec.extend([2, 3, 4])))
 * console.log(Vec.toArray(v))
 * // → [ 1, 2, 3, 4 ]
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const extend: {
  <A>(
    elements: Iterable<A>,
  ): <L extends Layout.Layout<A>>(
    self: Vec<A, L>,
  ) => Effect.Effect<void, Allocator.AllocationError>;
  <A, L extends Layout.Layout<A>>(
    self: Vec<A, L>,
    elements: Iterable<A>,
  ): Effect.Effect<void, Allocator.AllocationError>;
} = dual(2, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, elements: Iterable<A>) =>
  Effect.suspend(() => {
    const s = impl(self);
    const values = Arr.fromIterable(elements);
    const result = s.reserve(values.length);
    if (Result.isFailure(result)) return Effect.fail(result.failure);
    values.forEach((value) => s.write(s.len++, value));
    return Effect.void;
  }),
);

/**
 * Inserts an element at `index`, shifting later elements up. Fails with a
 * `RangeError` defect if `index > length`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2, 3]))
 * Effect.runSync(Vec.insert(v, 1, 4))
 * console.log(Vec.toArray(v))
 * Effect.runSync(Vec.insert(v, 4, 5))
 * console.log(Vec.toArray(v))
 * // → [ 1, 4, 2, 3 ]
 * // → [ 1, 4, 2, 3, 5 ]
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const insert: {
  <A>(
    index: number,
    value: A,
  ): <L extends Layout.Layout<A>>(
    self: Vec<A, L>,
  ) => Effect.Effect<void, Allocator.AllocationError>;
  <A, L extends Layout.Layout<A>>(
    self: Vec<A, L>,
    index: number,
    value: A,
  ): Effect.Effect<void, Allocator.AllocationError>;
} = dual(3, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number, value: A) =>
  Effect.suspend(() => {
    const s = impl(self);
    if (!Number.isSafeInteger(index) || index < 0 || index > s.len) {
      return Effect.die(
        new RangeError(`Vec: insert index ${index} out of bounds (length ${s.len})`),
      );
    }
    const result = s.reserve(1);
    if (Result.isFailure(result)) return Effect.fail(result.failure);
    s.bytes().copyWithin((index + 1) * s.stride, index * s.stride, s.len * s.stride);
    s.write(index, value);
    s.len++;
    return Effect.void;
  }),
);

/**
 * Removes and returns the last element.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2, 3]))
 * console.log(Vec.pop(v))
 * console.log(Vec.toArray(v))
 * // → { _id: 'Option', _tag: 'Some', value: 3 }
 * // → [ 1, 2 ]
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const pop = <A, L extends Layout.Layout<A>>(self: Vec<A, L>): Option.Option<A> => {
  const s = impl(self);
  if (s.len === 0) return Option.none();
  return Option.some(s.read(--s.len));
};

/**
 * Removes and returns the element at `index`, shifting later elements down.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2, 3]))
 * console.log(Vec.remove(v, 1))
 * console.log(Vec.toArray(v))
 * // → { _id: 'Option', _tag: 'Some', value: 2 }
 * // → [ 1, 3 ]
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const remove: {
  (index: number): <A, L extends Layout.Layout<A>>(self: Vec<A, L>) => Option.Option<A>;
  <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number): Option.Option<A>;
} = dual(2, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number) => {
  const s = impl(self);
  if (!isIndex(s, index)) return Option.none();
  const value = s.read(index);
  s.bytes().copyWithin(index * s.stride, (index + 1) * s.stride, s.len * s.stride);
  s.len--;
  return Option.some(value);
});

/**
 * Removes and returns the element at `index`, replacing it with the last
 * element. O(1), but does not preserve ordering.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2, 3, 4]))
 * console.log(Vec.swapRemove(v, 1))
 * console.log(Vec.toArray(v))
 * console.log(Vec.swapRemove(v, 0))
 * console.log(Vec.toArray(v))
 * // → { _id: 'Option', _tag: 'Some', value: 2 }
 * // → [ 1, 4, 3 ]
 * // → { _id: 'Option', _tag: 'Some', value: 1 }
 * // → [ 3, 4 ]
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const swapRemove: {
  (index: number): <A, L extends Layout.Layout<A>>(self: Vec<A, L>) => Option.Option<A>;
  <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number): Option.Option<A>;
} = dual(2, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, index: number) => {
  const s = impl(self);
  if (!isIndex(s, index)) return Option.none();
  const value = s.read(index);
  const last = --s.len;
  if (index !== last) {
    s.bytes().copyWithin(index * s.stride, last * s.stride, (last + 1) * s.stride);
  }
  return Option.some(value);
});

/**
 * Shortens the vector to `length` elements. Has no effect if the vector is
 * already shorter. Capacity is unchanged.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2, 3, 4, 5]))
 * Vec.truncate(v, 2)
 * console.log(Vec.toArray(v), Vec.capacity(v))
 * // → [ 1, 2 ] 5
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const truncate: {
  (length: number): <A, L extends Layout.Layout<A>>(self: Vec<A, L>) => void;
  <A, L extends Layout.Layout<A>>(self: Vec<A, L>, length: number): void;
} = dual(2, <A, L extends Layout.Layout<A>>(self: Vec<A, L>, newLength: number) => {
  const s = impl(self);
  if (newLength < s.len) s.len = Math.max(0, Math.floor(newLength));
});

/**
 * Removes every element. Capacity is unchanged.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u8, [1, 2, 3]))
 * Vec.clear(v)
 * console.log(Vec.isEmpty(v), Vec.capacity(v))
 * // → true 3
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const clear = <A, L extends Layout.Layout<A>>(self: Vec<A, L>): void => {
  impl(self).len = 0;
};

/**
 * Copies the elements into a JavaScript array.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.bool, [true, false]))
 * console.log(Vec.toArray(v))
 * // → [ true, false ]
 * ```
 *
 * @since 0.1.0
 * @category converters
 */
export const toArray = <A, L extends Layout.Layout<A>>(self: Vec<A, L>): Array<A> =>
  Array.from(self);

/**
 * The raw bytes of the elements (a view, not a copy). Invalidated when the
 * vector reallocates.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u16, [1, 258]))
 * console.log(Vec.bytes(v))
 * // → Uint8Array(4) [ 1, 0, 2, 1 ]
 * ```
 *
 * @since 0.1.0
 * @category converters
 */
export const bytes = <A, L extends Layout.Layout<A>>(self: Vec<A, L>): Uint8Array => {
  const s = impl(self);
  return s.bytes().subarray(0, s.len * s.stride);
};

/**
 * Views the elements of a vector of primitives as a typed array (a view, not
 * a copy). Invalidated when the vector reallocates.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "@thomasfosterau/effect-ext/Layout"
 * import * as Vec from "@thomasfosterau/effect-ext/Vec"
 *
 * const v = Effect.runSync(Vec.fromIterable(Layout.u32, [1, 2, 3]))
 * const array: Uint32Array = Vec.typedArray(v)
 * console.log(array)
 * // → Uint32Array(3) [ 1, 2, 3 ]
 * ```
 *
 * @since 0.1.0
 * @category converters
 */
export const typedArray = <L extends Layout.AnyPrimitive>(
  self: Vec<Layout.Type<L>, L>,
): Layout.TypedArrayOf<L> => {
  const s = impl(self);
  return Option.match(s.block, {
    onNone: () => new s.layout.TypedArray(new ArrayBuffer(0), 0, 0),
    onSome: (block) => new s.layout.TypedArray(block.buffer, block.byteOffset, s.len),
  });
};
