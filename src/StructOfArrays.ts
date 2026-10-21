/**
 * A growable struct-of-arrays container backed by `ArrayBuffer` memory.
 *
 * Where a `Vec` of structs stores each record contiguously
 * (`x y z x y z …`), a `StructOfArrays` stores each field in its own column
 * (`x x … y y … z z …`). Columns of primitive fields can be viewed directly
 * as typed arrays, which makes per-field loops cache-friendly and easy to
 * hand to WebGL, WebGPU, WASM or workers.
 *
 * All columns live in a single block from the current
 * {@link Allocator.Allocator}, ordered by decreasing alignment so no padding
 * is needed between them.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as Layout from "effect-ext/Layout"
 * import * as StructOfArrays from "effect-ext/StructOfArrays"
 *
 * const program = Effect.gen(function* () {
 *   const particles = yield* StructOfArrays.make({ x: Layout.f32, y: Layout.f32, id: Layout.u32 })
 *   yield* StructOfArrays.push(particles, { x: 1, y: 2, id: 0 })
 *   yield* StructOfArrays.push(particles, { x: 3, y: 4, id: 1 })
 *   const xs: Float32Array = StructOfArrays.column(particles, "x") // [1, 3]
 * })
 * ```
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { format } from "effect/Formatter"
import { dual } from "effect/Function"
import { NodeInspectSymbol } from "effect/Inspectable"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import { pipeArguments, type Pipeable } from "effect/Pipeable"
import * as P from "effect/Predicate"
import * as R from "effect/Record"
import * as Result from "effect/Result"
import type * as Scope from "effect/Scope"
import * as Allocator from "./Allocator.ts"
import * as Layout from "./Layout.ts"

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId = "~effect-ext/StructOfArrays" as const

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 0.1.0
 * @category models
 */
export interface StructOfArrays<F extends Layout.Fields>
  extends Iterable<Layout.StructType<F>>, Pipeable {
  readonly [TypeId]: TypeId
  /** The field layouts. */
  readonly fields: F
  /** The allocator that owns this container's memory. */
  readonly allocator: Allocator.Allocator
  /** The number of records. */
  readonly length: number
  /** The number of records that fit without reallocating. */
  readonly capacity: number
  toJSON(): { readonly _id: "StructOfArrays"; readonly values: Array<Layout.StructType<F>> }
  toString(): string
}

/**
 * The keys of fields with primitive layouts (those that can be viewed as a
 * typed array column).
 *
 * @since 0.1.0
 * @category type-level
 */
export type PrimitiveKeys<F extends Layout.Fields> = {
  [K in keyof F]: F[K] extends Layout.AnyPrimitive ? K : never
}[keyof F] &
  string

/**
 * The value type of any field in `F`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type FieldValue<F extends Layout.Fields> = Layout.Type<F[keyof F]>

const MIN_CAPACITY = 4

const emptyView = new DataView(new ArrayBuffer(0))

interface Column {
  readonly key: string
  readonly layout: Layout.Any
  readonly size: number
  /** Byte offset of the column inside the block, for the current capacity. */
  offset: number
}

/** Columns with the largest alignment first, so no padding is needed between them. */
const ColumnOrder: Order.Order<Column> = Order.flip(
  Order.mapInput(Order.Number, (column: Column) => column.layout.align),
)

const columnOffsets = (columns: ReadonlyArray<Column>, capacity: number): Array<number> => {
  const offsets: Array<number> = []
  let offset = 0
  for (const column of columns) {
    offsets.push(offset)
    offset += column.size * capacity
  }
  return offsets
}

class StructOfArraysImpl<F extends Layout.Fields> implements StructOfArrays<F> {
  readonly [TypeId] = TypeId
  readonly columns: ReadonlyArray<Column>
  readonly byKey: Record<string, Column>
  readonly keys: ReadonlyArray<string>
  readonly recordSize: number
  readonly align: number
  block: Allocator.Block | undefined = undefined
  view: DataView = emptyView
  cap = 0
  len = 0

  constructor(
    readonly fields: F,
    readonly allocator: Allocator.Allocator,
  ) {
    this.keys = R.keys(fields)
    this.columns = Arr.sort(
      this.keys.map((key): Column => ({
        key,
        layout: fields[key],
        size: fields[key].size,
        offset: 0,
      })),
      ColumnOrder,
    )
    this.byKey = R.fromEntries(this.columns.map((column) => [column.key, column]))
    this.recordSize = this.columns.reduce((n, column) => n + column.size, 0)
    this.align = this.columns.reduce((n, column) => Math.max(n, column.layout.align), 1)
  }

  get length(): number {
    return this.len
  }

  get capacity(): number {
    return this.cap
  }

  bytes(): Uint8Array {
    return this.block === undefined ? new Uint8Array(0) : Allocator.bytes(this.block)
  }

  resize(capacity: number): Result.Result<void, Allocator.AllocationError> {
    const columns = this.columns
    const next = columnOffsets(columns, capacity)
    const size = capacity * this.recordSize
    if (this.block === undefined) {
      const result = this.allocator.allocate(size, this.align)
      if (Result.isFailure(result)) return Result.fail(result.failure)
      this.block = result.success
    } else if (capacity > this.cap) {
      // Grow, then move columns towards the end of the block (last first, so
      // nothing is overwritten before it has been moved).
      const result = this.allocator.reallocate(this.block, size, this.align)
      if (Result.isFailure(result)) return Result.fail(result.failure)
      this.block = result.success
      const bytes = Allocator.bytes(this.block)
      for (let i = columns.length - 1; i >= 0; i--) {
        const column = columns[i]
        bytes.copyWithin(next[i], column.offset, column.offset + this.len * column.size)
      }
    } else {
      // Shrink: move columns towards the start (first first), then reallocate.
      const bytes = Allocator.bytes(this.block)
      for (let i = 0; i < columns.length; i++) {
        const column = columns[i]
        bytes.copyWithin(next[i], column.offset, column.offset + this.len * column.size)
      }
      const result = this.allocator.reallocate(this.block, size, this.align)
      if (Result.isFailure(result)) return Result.fail(result.failure)
      this.block = result.success
    }
    for (let i = 0; i < columns.length; i++) {
      columns[i].offset = next[i]
    }
    this.cap = capacity
    this.view = Allocator.dataView(this.block)
    return Result.void
  }

  reserve(additional: number): Result.Result<void, Allocator.AllocationError> {
    const required = this.len + additional
    if (required <= this.cap) return Result.void
    return this.resize(Math.max(required, this.cap * 2, MIN_CAPACITY))
  }

  readField(column: Column, index: number): FieldValue<F> {
    return column.layout.read(this.view, column.offset + index * column.size)
  }

  writeField(column: Column, index: number, value: FieldValue<F>): void {
    column.layout.write(this.view, column.offset + index * column.size, value)
  }

  read(index: number): Layout.StructType<F> {
    const out: Record<string, FieldValue<F>> = {}
    for (const key of this.keys) {
      out[key] = this.readField(this.byKey[key], index)
    }
    // SAFETY: the loop above assigned every key of `fields` from its column.
    return out as Layout.StructType<F>
  }

  write(index: number, value: Layout.StructType<F>): void {
    for (const column of this.columns) {
      this.writeField(column, index, value[column.key])
    }
  }

  move(to: number, from: number): void {
    const bytes = this.bytes()
    for (const column of this.columns) {
      const src = column.offset + from * column.size
      bytes.copyWithin(column.offset + to * column.size, src, src + column.size)
    }
  }

  *[Symbol.iterator](): Iterator<Layout.StructType<F>> {
    for (let i = 0; i < this.len; i++) {
      yield this.read(i)
    }
  }

  pipe() {
    return pipeArguments(this, arguments)
  }

  toJSON() {
    return { _id: "StructOfArrays" as const, values: Array.from(this) }
  }

  toString() {
    return format(this.toJSON())
  }

  [NodeInspectSymbol]() {
    return this.toJSON()
  }
}

const impl = <F extends Layout.Fields>(self: StructOfArrays<F>): StructOfArraysImpl<F> =>
  // SAFETY: `StructOfArraysImpl` is the only implementation; every constructor returns one.
  self as StructOfArraysImpl<F>

const isIndex = (self: StructOfArraysImpl<any>, index: number) =>
  Number.isSafeInteger(index) && index >= 0 && index < self.len

const checkIndex = (self: StructOfArraysImpl<any>, index: number) => {
  if (!isIndex(self, index)) {
    throw new RangeError(`StructOfArrays: index ${index} out of bounds (length ${self.len})`)
  }
}

/**
 * @since 0.1.0
 * @category guards
 */
export const isStructOfArrays = (u: unknown): u is StructOfArrays<Layout.Fields> =>
  P.hasProperty(u, TypeId)

/**
 * Creates an empty container using the current allocator. Accepts either a
 * record of field layouts or a {@link Layout.Struct} (whose fields are used;
 * its offsets and padding are irrelevant here).
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <F extends Layout.Fields>(
  fields: F | Layout.Struct<F>,
  options?: { readonly capacity?: number | undefined },
): Effect.Effect<StructOfArrays<F>, Allocator.AllocationError> =>
  Effect.flatMap(Effect.service(Allocator.Allocator), (allocator) =>
    Effect.suspend(() => {
      const self = new StructOfArraysImpl<F>(
        // SAFETY: the signature only admits `F` or `Layout.Struct<F>`, and `isStruct`
        // distinguishes them, so each branch holds an `F`.
        Layout.isStruct(fields) ? (fields.fields as F) : (fields as F),
        allocator,
      )
      const capacity = options?.capacity ?? 0
      if (capacity > 0) {
        const result = self.resize(capacity)
        if (Result.isFailure(result)) return Effect.fail(result.failure)
      }
      return Effect.succeed(self)
    }),
  )

/**
 * Like {@link make}, but frees the container when the surrounding scope
 * closes.
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeScoped = <F extends Layout.Fields>(
  fields: F | Layout.Struct<F>,
  options?: { readonly capacity?: number | undefined },
): Effect.Effect<StructOfArrays<F>, Allocator.AllocationError, Scope.Scope> =>
  Effect.acquireRelease(make(fields, options), free)

/**
 * Creates a container holding the records of an iterable.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromIterable = <F extends Layout.Fields>(
  fields: F | Layout.Struct<F>,
  records: Iterable<Layout.StructType<F>>,
): Effect.Effect<StructOfArrays<F>, Allocator.AllocationError> =>
  Effect.flatMap(make(fields, { capacity: Array.isArray(records) ? records.length : 0 }), (self) =>
    Effect.as(extend(self, records), self),
  )

/**
 * Releases the container's memory. It is left empty with zero capacity and
 * can still be used afterwards.
 *
 * @since 0.1.0
 * @category destructors
 */
export const free = <F extends Layout.Fields>(self: StructOfArrays<F>): Effect.Effect<void> =>
  Effect.sync(() => {
    const s = impl(self)
    if (s.block !== undefined) {
      s.allocator.deallocate(s.block)
      s.block = undefined
      s.view = emptyView
    }
    for (const column of s.columns) column.offset = 0
    s.cap = 0
    s.len = 0
  })

/**
 * @since 0.1.0
 * @category getters
 */
export const length = <F extends Layout.Fields>(self: StructOfArrays<F>): number => impl(self).len

/**
 * @since 0.1.0
 * @category getters
 */
export const capacity = <F extends Layout.Fields>(self: StructOfArrays<F>): number => impl(self).cap

/**
 * @since 0.1.0
 * @category getters
 */
export const isEmpty = <F extends Layout.Fields>(self: StructOfArrays<F>): boolean =>
  impl(self).len === 0

/**
 * Reads the record at `index` into a plain object.
 *
 * @since 0.1.0
 * @category getters
 */
export const get: {
  (
    index: number,
  ): <F extends Layout.Fields>(self: StructOfArrays<F>) => Option.Option<Layout.StructType<F>>
  <F extends Layout.Fields>(
    self: StructOfArrays<F>,
    index: number,
  ): Option.Option<Layout.StructType<F>>
} = dual(2, <F extends Layout.Fields>(self: StructOfArrays<F>, index: number) => {
  const s = impl(self)
  return isIndex(s, index) ? Option.some(s.read(index)) : Option.none()
})

/**
 * Reads the record at `index`, throwing a `RangeError` if it is out of bounds.
 *
 * @since 0.1.0
 * @category unsafe
 */
export const getUnsafe: {
  (index: number): <F extends Layout.Fields>(self: StructOfArrays<F>) => Layout.StructType<F>
  <F extends Layout.Fields>(self: StructOfArrays<F>, index: number): Layout.StructType<F>
} = dual(2, <F extends Layout.Fields>(self: StructOfArrays<F>, index: number) => {
  const s = impl(self)
  checkIndex(s, index)
  return s.read(index)
})

/**
 * Overwrites the record at `index`. Returns `false` (and does nothing) if
 * `index` is out of bounds.
 *
 * @since 0.1.0
 * @category setters
 */
export const set: {
  <F extends Layout.Fields>(
    index: number,
    value: Layout.StructType<F>,
  ): (self: StructOfArrays<F>) => boolean
  <F extends Layout.Fields>(
    self: StructOfArrays<F>,
    index: number,
    value: Layout.StructType<F>,
  ): boolean
} = dual(
  3,
  <F extends Layout.Fields>(
    self: StructOfArrays<F>,
    index: number,
    value: Layout.StructType<F>,
  ) => {
    const s = impl(self)
    if (!isIndex(s, index)) return false
    s.write(index, value)
    return true
  },
)

/**
 * Reads a single field of the record at `index`, throwing a `RangeError` if
 * the index is out of bounds.
 *
 * @since 0.1.0
 * @category getters
 */
export const getField: {
  <F extends Layout.Fields, K extends keyof F & string>(
    index: number,
    key: K,
  ): (self: StructOfArrays<F>) => Layout.Type<F[K]>
  <F extends Layout.Fields, K extends keyof F & string>(
    self: StructOfArrays<F>,
    index: number,
    key: K,
  ): Layout.Type<F[K]>
} = dual(
  3,
  <F extends Layout.Fields, K extends keyof F & string>(
    self: StructOfArrays<F>,
    index: number,
    key: K,
  ) => {
    const s = impl(self)
    checkIndex(s, index)
    return s.readField(s.byKey[key], index)
  },
)

/**
 * Writes a single field of the record at `index`, throwing a `RangeError` if
 * the index is out of bounds.
 *
 * @since 0.1.0
 * @category setters
 */
export const setField: {
  <F extends Layout.Fields, K extends keyof F & string>(
    index: number,
    key: K,
    value: Layout.Type<F[K]>,
  ): (self: StructOfArrays<F>) => void
  <F extends Layout.Fields, K extends keyof F & string>(
    self: StructOfArrays<F>,
    index: number,
    key: K,
    value: Layout.Type<F[K]>,
  ): void
} = dual(
  4,
  <F extends Layout.Fields, K extends keyof F & string>(
    self: StructOfArrays<F>,
    index: number,
    key: K,
    value: Layout.Type<F[K]>,
  ) => {
    const s = impl(self)
    checkIndex(s, index)
    s.writeField(s.byKey[key], index, value)
  },
)

/**
 * Views a primitive column as a typed array of `length` elements (a view, not
 * a copy). Invalidated when the container reallocates.
 *
 * @since 0.1.0
 * @category getters
 */
export const column: {
  <F extends Layout.Fields, K extends PrimitiveKeys<F>>(
    key: K,
  ): (self: StructOfArrays<F>) => Layout.TypedArrayOf<F[K]>
  <F extends Layout.Fields, K extends PrimitiveKeys<F>>(
    self: StructOfArrays<F>,
    key: K,
  ): Layout.TypedArrayOf<F[K]>
} = dual(
  2,
  <F extends Layout.Fields, K extends PrimitiveKeys<F>>(self: StructOfArrays<F>, key: K) => {
    const s = impl(self)
    const col = s.byKey[key]
    // SAFETY: `K` is constrained to `PrimitiveKeys<F>`, so this column's layout is primitive.
    const layout = col.layout as Layout.AnyPrimitive
    if (s.block === undefined) return new layout.TypedArray(new ArrayBuffer(0), 0, 0)
    return new layout.TypedArray(s.block.buffer, s.block.byteOffset + col.offset, s.len)
  },
)

/**
 * Iterates over the values of a single field (of any layout).
 *
 * @since 0.1.0
 * @category getters
 */
export const values: {
  <F extends Layout.Fields, K extends keyof F & string>(
    key: K,
  ): (self: StructOfArrays<F>) => IterableIterator<Layout.Type<F[K]>>
  <F extends Layout.Fields, K extends keyof F & string>(
    self: StructOfArrays<F>,
    key: K,
  ): IterableIterator<Layout.Type<F[K]>>
} = dual(2, function* <
  F extends Layout.Fields,
  K extends keyof F & string,
>(self: StructOfArrays<F>, key: K) {
  const s = impl(self)
  const col = s.byKey[key]
  for (let i = 0; i < s.len; i++) {
    yield s.readField(col, i)
  }
})

/**
 * Reserves capacity for at least `additional` more records.
 *
 * @since 0.1.0
 * @category mutations
 */
export const reserve: {
  (
    additional: number,
  ): <F extends Layout.Fields>(
    self: StructOfArrays<F>,
  ) => Effect.Effect<void, Allocator.AllocationError>
  <F extends Layout.Fields>(
    self: StructOfArrays<F>,
    additional: number,
  ): Effect.Effect<void, Allocator.AllocationError>
} = dual(2, <F extends Layout.Fields>(self: StructOfArrays<F>, additional: number) =>
  Effect.suspend(() => Effect.fromResult(impl(self).reserve(additional))),
)

/**
 * Shrinks the capacity to match the length.
 *
 * @since 0.1.0
 * @category mutations
 */
export const shrinkToFit = <F extends Layout.Fields>(
  self: StructOfArrays<F>,
): Effect.Effect<void, Allocator.AllocationError> =>
  Effect.suspend(() => {
    const s = impl(self)
    if (s.block === undefined || s.len === s.cap) return Effect.void
    if (s.len === 0) return free(self)
    return Effect.fromResult(s.resize(s.len))
  })

/**
 * Appends a record.
 *
 * @since 0.1.0
 * @category mutations
 */
export const push: {
  <F extends Layout.Fields>(
    value: Layout.StructType<F>,
  ): (self: StructOfArrays<F>) => Effect.Effect<void, Allocator.AllocationError>
  <F extends Layout.Fields>(
    self: StructOfArrays<F>,
    value: Layout.StructType<F>,
  ): Effect.Effect<void, Allocator.AllocationError>
} = dual(2, <F extends Layout.Fields>(self: StructOfArrays<F>, value: Layout.StructType<F>) =>
  Effect.suspend(() => {
    const s = impl(self)
    const result = s.reserve(1)
    if (Result.isFailure(result)) return Effect.fail(result.failure)
    s.write(s.len++, value)
    return Effect.void
  }),
)

/**
 * Appends every record of an iterable.
 *
 * @since 0.1.0
 * @category mutations
 */
export const extend: {
  <F extends Layout.Fields>(
    records: Iterable<Layout.StructType<F>>,
  ): (self: StructOfArrays<F>) => Effect.Effect<void, Allocator.AllocationError>
  <F extends Layout.Fields>(
    self: StructOfArrays<F>,
    records: Iterable<Layout.StructType<F>>,
  ): Effect.Effect<void, Allocator.AllocationError>
} = dual(
  2,
  <F extends Layout.Fields>(self: StructOfArrays<F>, records: Iterable<Layout.StructType<F>>) =>
    Effect.suspend(() => {
      const s = impl(self)
      if (Array.isArray(records)) {
        const result = s.reserve(records.length)
        if (Result.isFailure(result)) return Effect.fail(result.failure)
      }
      for (const value of records) {
        const result = s.reserve(1)
        if (Result.isFailure(result)) return Effect.fail(result.failure)
        s.write(s.len++, value)
      }
      return Effect.void
    }),
)

/**
 * Removes and returns the last record.
 *
 * @since 0.1.0
 * @category mutations
 */
export const pop = <F extends Layout.Fields>(
  self: StructOfArrays<F>,
): Option.Option<Layout.StructType<F>> => {
  const s = impl(self)
  if (s.len === 0) return Option.none()
  return Option.some(s.read(--s.len))
}

/**
 * Removes and returns the record at `index`, replacing it with the last
 * record. O(1), but does not preserve ordering.
 *
 * @since 0.1.0
 * @category mutations
 */
export const swapRemove: {
  (
    index: number,
  ): <F extends Layout.Fields>(self: StructOfArrays<F>) => Option.Option<Layout.StructType<F>>
  <F extends Layout.Fields>(
    self: StructOfArrays<F>,
    index: number,
  ): Option.Option<Layout.StructType<F>>
} = dual(2, <F extends Layout.Fields>(self: StructOfArrays<F>, index: number) => {
  const s = impl(self)
  if (!isIndex(s, index)) return Option.none()
  const value = s.read(index)
  const last = --s.len
  if (index !== last) s.move(index, last)
  return Option.some(value)
})

/**
 * Shortens the container to `length` records. Has no effect if it is already
 * shorter. Capacity is unchanged.
 *
 * @since 0.1.0
 * @category mutations
 */
export const truncate: {
  (length: number): <F extends Layout.Fields>(self: StructOfArrays<F>) => void
  <F extends Layout.Fields>(self: StructOfArrays<F>, length: number): void
} = dual(2, <F extends Layout.Fields>(self: StructOfArrays<F>, length: number) => {
  const s = impl(self)
  if (length < s.len) s.len = Math.max(0, Math.floor(length))
})

/**
 * Removes every record. Capacity is unchanged.
 *
 * @since 0.1.0
 * @category mutations
 */
export const clear = <F extends Layout.Fields>(self: StructOfArrays<F>): void => {
  impl(self).len = 0
}

/**
 * Copies the records into an array of plain objects.
 *
 * @since 0.1.0
 * @category converters
 */
export const toArray = <F extends Layout.Fields>(
  self: StructOfArrays<F>,
): Array<Layout.StructType<F>> => Array.from(self)
