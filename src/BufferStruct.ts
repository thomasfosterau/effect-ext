/**
 * Structs backed by `ArrayBuffer` memory.
 *
 * A `BufferStruct` is a view over a {@link Layout.Struct}-shaped region of
 * memory. Each field is exposed as a property whose getter and setter read
 * and write the underlying bytes directly, so a `BufferStruct` behaves like a
 * plain object while its storage lives in an `ArrayBuffer`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as BufferStruct from "effect-ext/BufferStruct"
 * import * as Layout from "effect-ext/Layout"
 *
 * const Point = Layout.struct({ x: Layout.f64, y: Layout.f64 })
 *
 * const program = Effect.gen(function* () {
 *   const p = yield* BufferStruct.make(Point, { x: 1, y: 2 })
 *   p.x += 10
 *   return BufferStruct.toObject(p) // { x: 11, y: 2 }
 * })
 * ```
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import { format } from "effect/Formatter"
import * as HashSet from "effect/HashSet"
import { NodeInspectSymbol } from "effect/Inspectable"
import * as Option from "effect/Option"
import { pipeArguments, type Pipeable } from "effect/Pipeable"
import * as P from "effect/Predicate"
import * as R from "effect/Record"
import type * as Scope from "effect/Scope"
import * as Allocator from "./Allocator.ts"
import * as Layout from "./Layout.ts"

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId = "~effect-ext/BufferStruct" as const

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId

const LayoutKey = Symbol.for("effect-ext/BufferStruct/layout")
const ViewKey = Symbol.for("effect-ext/BufferStruct/view")
const OffsetKey = Symbol.for("effect-ext/BufferStruct/offset")
const OwnerKey = Symbol.for("effect-ext/BufferStruct/owner")

interface Owner {
  readonly allocator: Allocator.Allocator
  readonly block: Allocator.Block
}

/**
 * The property type of a field: nested structs are exposed as views,
 * everything else as its plain value.
 *
 * @since 0.1.0
 * @category type-level
 */
export type FieldType<L> = L extends Layout.Struct<infer F> ? BufferStruct<F> : Layout.Type<L>

/**
 * @since 0.1.0
 * @category models
 */
export interface Proto<F extends Layout.Fields> extends Pipeable {
  readonly [TypeId]: TypeId
  readonly [LayoutKey]: Layout.Struct<F>
  readonly [ViewKey]: DataView
  readonly [OffsetKey]: number
  /** @internal Cleared by {@link free}. */
  [OwnerKey]: Option.Option<Owner>
  toJSON(): { readonly _id: "BufferStruct" } & Layout.StructType<F>
  toString(): string
}

/**
 * A struct whose fields live in an `ArrayBuffer`.
 *
 * Nested struct fields are themselves `BufferStruct` views over the same
 * memory. To overwrite a nested struct with a plain object, use {@link set}.
 *
 * @since 0.1.0
 * @category models
 */
export type BufferStruct<F extends Layout.Fields> = Proto<F> & {
  -readonly [K in keyof F]: FieldType<F[K]>
}

const reserved = /* @__PURE__ */ HashSet.make("pipe", "toJSON", "toString", "constructor")

const BaseProto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
  toJSON(this: BufferStruct<Layout.Fields>) {
    return { _id: "BufferStruct", ...toObject(this) }
  },
  toString(this: BufferStruct<Layout.Fields>) {
    return format(this.toJSON())
  },
  [NodeInspectSymbol](this: BufferStruct<Layout.Fields>) {
    return this.toJSON()
  },
}

const prototypes = new WeakMap<Layout.AnyStruct, object>()

const prototypeFor = (layout: Layout.AnyStruct): object => {
  const cached = prototypes.get(layout)
  if (cached !== undefined) return cached
  const proto: object = Object.create(BaseProto)
  R.keys(layout.fields).forEach((key) => {
    if (HashSet.has(reserved, key)) {
      throw new TypeError(`BufferStruct: field name "${key}" is reserved`)
    }
    const field: Layout.Any = layout.fields[key]
    const offset: number = layout.offsets[key]
    if (Layout.isStruct(field)) {
      Object.defineProperty(proto, key, {
        enumerable: true,
        get(this: Proto<any>) {
          return viewAt(field, this[ViewKey], this[OffsetKey] + offset, Option.none())
        },
        set(this: Proto<any>, value: Layout.StructType<any>) {
          field.write(this[ViewKey], this[OffsetKey] + offset, value)
        },
      })
    } else {
      Object.defineProperty(proto, key, {
        enumerable: true,
        get(this: Proto<any>) {
          return field.read(this[ViewKey], this[OffsetKey] + offset)
        },
        set(this: Proto<any>, value: Layout.Type<Layout.Any>) {
          field.write(this[ViewKey], this[OffsetKey] + offset, value)
        },
      })
    }
  })
  prototypes.set(layout, proto)
  return proto
}

const viewAt = <F extends Layout.Fields>(
  layout: Layout.Struct<F>,
  view: DataView,
  byteOffset: number,
  owner: Option.Option<Owner>,
): BufferStruct<F> => {
  const self = Object.create(prototypeFor(layout))
  self[LayoutKey] = layout
  self[ViewKey] = view
  self[OffsetKey] = byteOffset
  self[OwnerKey] = owner
  return self
}

/**
 * @since 0.1.0
 * @category guards
 */
export const isBufferStruct = (u: unknown): u is BufferStruct<Layout.Fields> =>
  P.hasProperty(u, TypeId)

/**
 * Creates a view over existing memory. No memory is allocated or copied, and
 * the view is not owned: {@link free} is a no-op for it.
 *
 * @since 0.1.0
 * @category constructors
 */
export const view = <F extends Layout.Fields>(
  layout: Layout.Struct<F>,
  memory: ArrayBuffer | DataView | Allocator.Block,
  byteOffset = 0,
): BufferStruct<F> => {
  const dataView =
    memory instanceof DataView
      ? memory
      : memory instanceof ArrayBuffer
        ? new DataView(memory)
        : Allocator.dataView(memory)
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
    throw new RangeError(`BufferStruct.view: invalid byte offset ${byteOffset}`)
  }
  if (byteOffset + layout.size > dataView.byteLength) {
    throw new RangeError(
      `BufferStruct.view: struct of ${layout.size} bytes at offset ${byteOffset} exceeds ${dataView.byteLength} bytes`,
    )
  }
  return viewAt(layout, dataView, byteOffset, Option.none())
}

/**
 * Allocates a struct with the current allocator and initialises it with
 * `init` (or zeroes if omitted).
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <F extends Layout.Fields>(
  layout: Layout.Struct<F>,
  init?: Layout.StructType<F>,
): Effect.Effect<BufferStruct<F>, Allocator.AllocationError> =>
  Effect.flatMap(Effect.service(Allocator.Allocator), (allocator) =>
    Effect.map(Effect.fromResult(allocator.allocate(layout.size, layout.align)), (block) => {
      const self = viewAt(layout, Allocator.dataView(block), 0, Option.some({ allocator, block }))
      if (init !== undefined) layout.write(self[ViewKey], 0, init)
      return self
    }),
  )

/**
 * Like {@link make}, but frees the struct when the surrounding scope closes.
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeScoped = <F extends Layout.Fields>(
  layout: Layout.Struct<F>,
  init?: Layout.StructType<F>,
): Effect.Effect<BufferStruct<F>, Allocator.AllocationError, Scope.Scope> =>
  Effect.acquireRelease(make(layout, init), free)

/**
 * Returns the memory of a struct created by {@link make} to the allocator it
 * came from. Views created by {@link view}, or nested in another struct, are
 * not owned and are left untouched.
 *
 * @since 0.1.0
 * @category destructors
 */
export const free = <F extends Layout.Fields>(self: BufferStruct<F>): Effect.Effect<void> =>
  Effect.sync(() => {
    const owner = self[OwnerKey]
    if (Option.isSome(owner)) {
      self[OwnerKey] = Option.none()
      owner.value.allocator.deallocate(owner.value.block)
    }
  })

/**
 * The layout of a struct.
 *
 * @since 0.1.0
 * @category getters
 */
export const layout = <F extends Layout.Fields>(self: BufferStruct<F>): Layout.Struct<F> =>
  self[LayoutKey]

/**
 * The bytes backing a struct (a view, not a copy).
 *
 * @since 0.1.0
 * @category getters
 */
export const bytes = <F extends Layout.Fields>(self: BufferStruct<F>): Uint8Array => {
  const v = self[ViewKey]
  return new Uint8Array(v.buffer, v.byteOffset + self[OffsetKey], self[LayoutKey].size)
}

/**
 * Reads a single field. Nested structs are returned as plain objects.
 *
 * @since 0.1.0
 * @category getters
 */
export const get: {
  <F extends Layout.Fields, K extends keyof F & string>(
    key: K,
  ): (self: BufferStruct<F>) => Layout.Type<F[K]>
  <F extends Layout.Fields, K extends keyof F & string>(
    self: BufferStruct<F>,
    key: K,
  ): Layout.Type<F[K]>
} = dual(2, <F extends Layout.Fields>(self: BufferStruct<F>, key: keyof F & string) => {
  const l = self[LayoutKey]
  return l.fields[key].read(self[ViewKey], self[OffsetKey] + l.offsets[key])
})

/**
 * Writes a single field. Nested structs can be written from plain objects.
 *
 * @since 0.1.0
 * @category setters
 */
export const set: {
  <F extends Layout.Fields, K extends keyof F & string>(
    key: K,
    value: Layout.Type<F[K]>,
  ): (self: BufferStruct<F>) => BufferStruct<F>
  <F extends Layout.Fields, K extends keyof F & string>(
    self: BufferStruct<F>,
    key: K,
    value: Layout.Type<F[K]>,
  ): BufferStruct<F>
} = dual(
  3,
  <F extends Layout.Fields, K extends keyof F & string>(
    self: BufferStruct<F>,
    key: K,
    value: Layout.Type<F[K]>,
  ) => {
    const l = self[LayoutKey]
    l.fields[key].write(self[ViewKey], self[OffsetKey] + l.offsets[key], value)
    return self
  },
)

/**
 * Overwrites every field from a plain object.
 *
 * @since 0.1.0
 * @category setters
 */
export const assign: {
  <F extends Layout.Fields>(value: Layout.StructType<F>): (self: BufferStruct<F>) => BufferStruct<F>
  <F extends Layout.Fields>(self: BufferStruct<F>, value: Layout.StructType<F>): BufferStruct<F>
} = dual(2, <F extends Layout.Fields>(self: BufferStruct<F>, value: Layout.StructType<F>) => {
  self[LayoutKey].write(self[ViewKey], self[OffsetKey], value)
  return self
})

/**
 * Copies every field into a fresh plain object.
 *
 * @since 0.1.0
 * @category converters
 */
export const toObject = <F extends Layout.Fields>(self: BufferStruct<F>): Layout.StructType<F> =>
  self[LayoutKey].read(self[ViewKey], self[OffsetKey])

/**
 * Allocates a new struct with the same contents.
 *
 * @since 0.1.0
 * @category constructors
 */
export const clone = <F extends Layout.Fields>(
  self: BufferStruct<F>,
): Effect.Effect<BufferStruct<F>, Allocator.AllocationError> =>
  Effect.map(make(self[LayoutKey]), (copy) => {
    bytes(copy).set(bytes(self))
    return copy
  })
