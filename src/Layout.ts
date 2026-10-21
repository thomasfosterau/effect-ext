/**
 * Binary layouts describe how a value is laid out in memory: its size, its
 * alignment, and how to read and write it through a `DataView`.
 *
 * Layouts are the building blocks for every ArrayBuffer-backed data structure
 * in this package (`BufferStruct`, `Vec`, `StructOfArrays`). All multi-byte
 * values are stored little-endian, regardless of the host platform.
 *
 * @since 0.1.0
 */
import { pipeArguments, type Pipeable } from "effect/Pipeable"
import * as P from "effect/Predicate"
import * as R from "effect/Record"

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId = "~effect-ext/Layout" as const

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * A description of how values of type `A` are stored in memory.
 *
 * Invariants:
 * - `align` is a power of two.
 * - `size` is a multiple of `align`, so consecutive values can be stored at a
 *   stride of `size` bytes.
 *
 * @since 0.1.0
 * @category models
 */
export interface Layout<A> extends Pipeable {
  readonly [TypeId]: TypeId
  readonly _tag: string
  /** The size of a value in bytes. */
  readonly size: number
  /** The required alignment of a value in bytes. */
  readonly align: number
  /** Reads a value at `byteOffset` (relative to the start of `view`). */
  read(view: DataView, byteOffset: number): A
  /** Writes `value` at `byteOffset` (relative to the start of `view`). */
  write(view: DataView, byteOffset: number, value: A): void
}

/**
 * Any layout.
 *
 * @since 0.1.0
 * @category models
 */
export type Any = Layout<any>

/**
 * Extracts the value type of a layout.
 *
 * @since 0.1.0
 * @category type-level
 */
export type Type<L> = L extends Layout<infer A> ? A : never

/**
 * The typed array constructors that primitive layouts map onto.
 *
 * @since 0.1.0
 * @category models
 */
export interface TypedArrayConstructor<T> {
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): T
  readonly BYTES_PER_ELEMENT: number
}

/**
 * A layout for a single number, bigint or boolean that maps directly onto a
 * typed array, which allows contiguous runs of it to be viewed as one.
 *
 * @since 0.1.0
 * @category models
 */
export interface Primitive<A, Tag extends string, T> extends Layout<A> {
  readonly _tag: Tag
  readonly TypedArray: TypedArrayConstructor<T>
}

/**
 * @since 0.1.0
 * @category models
 */
export type AnyPrimitive = Primitive<any, string, any>

/**
 * Extracts the typed array type a primitive layout maps onto.
 *
 * @since 0.1.0
 * @category type-level
 */
export type TypedArrayOf<L> = L extends Primitive<any, string, infer T> ? T : never

const Proto: Pipeable = {
  pipe() {
    return pipeArguments(this, arguments)
  },
}

const primitive = <A, Tag extends string, T>(
  tag: Tag,
  TypedArray: TypedArrayConstructor<T>,
  read: (view: DataView, byteOffset: number) => A,
  write: (view: DataView, byteOffset: number, value: A) => void,
): Primitive<A, Tag, T> => {
  const self = Object.create(Proto)
  self[TypeId] = TypeId
  self._tag = tag
  self.size = TypedArray.BYTES_PER_ELEMENT
  self.align = TypedArray.BYTES_PER_ELEMENT
  self.TypedArray = TypedArray
  self.read = read
  self.write = write
  return self
}

/**
 * @since 0.1.0
 * @category primitives
 */
export const u8: Primitive<number, "u8", Uint8Array> = primitive(
  "u8",
  Uint8Array,
  (view, offset) => view.getUint8(offset),
  (view, offset, value) => view.setUint8(offset, value),
)

/**
 * @since 0.1.0
 * @category primitives
 */
export const i8: Primitive<number, "i8", Int8Array> = primitive(
  "i8",
  Int8Array,
  (view, offset) => view.getInt8(offset),
  (view, offset, value) => view.setInt8(offset, value),
)

/**
 * @since 0.1.0
 * @category primitives
 */
export const u16: Primitive<number, "u16", Uint16Array> = primitive(
  "u16",
  Uint16Array,
  (view, offset) => view.getUint16(offset, true),
  (view, offset, value) => view.setUint16(offset, value, true),
)

/**
 * @since 0.1.0
 * @category primitives
 */
export const i16: Primitive<number, "i16", Int16Array> = primitive(
  "i16",
  Int16Array,
  (view, offset) => view.getInt16(offset, true),
  (view, offset, value) => view.setInt16(offset, value, true),
)

/**
 * @since 0.1.0
 * @category primitives
 */
export const u32: Primitive<number, "u32", Uint32Array> = primitive(
  "u32",
  Uint32Array,
  (view, offset) => view.getUint32(offset, true),
  (view, offset, value) => view.setUint32(offset, value, true),
)

/**
 * @since 0.1.0
 * @category primitives
 */
export const i32: Primitive<number, "i32", Int32Array> = primitive(
  "i32",
  Int32Array,
  (view, offset) => view.getInt32(offset, true),
  (view, offset, value) => view.setInt32(offset, value, true),
)

/**
 * @since 0.1.0
 * @category primitives
 */
export const u64: Primitive<bigint, "u64", BigUint64Array> = primitive(
  "u64",
  BigUint64Array,
  (view, offset) => view.getBigUint64(offset, true),
  (view, offset, value) => view.setBigUint64(offset, value, true),
)

/**
 * @since 0.1.0
 * @category primitives
 */
export const i64: Primitive<bigint, "i64", BigInt64Array> = primitive(
  "i64",
  BigInt64Array,
  (view, offset) => view.getBigInt64(offset, true),
  (view, offset, value) => view.setBigInt64(offset, value, true),
)

/**
 * @since 0.1.0
 * @category primitives
 */
export const f32: Primitive<number, "f32", Float32Array> = primitive(
  "f32",
  Float32Array,
  (view, offset) => view.getFloat32(offset, true),
  (view, offset, value) => view.setFloat32(offset, value, true),
)

/**
 * @since 0.1.0
 * @category primitives
 */
export const f64: Primitive<number, "f64", Float64Array> = primitive(
  "f64",
  Float64Array,
  (view, offset) => view.getFloat64(offset, true),
  (view, offset, value) => view.setFloat64(offset, value, true),
)

/**
 * A boolean stored as a single byte (`0` or `1`). When viewed as a typed
 * array it appears as a `Uint8Array`.
 *
 * @since 0.1.0
 * @category primitives
 */
export const bool: Primitive<boolean, "bool", Uint8Array> = primitive(
  "bool",
  Uint8Array,
  (view, offset) => view.getUint8(offset) !== 0,
  (view, offset, value) => view.setUint8(offset, value ? 1 : 0),
)

/**
 * The fields of a struct layout.
 *
 * @since 0.1.0
 * @category models
 */
export type Fields = { readonly [key: string]: Any }

/**
 * The plain object type described by a set of fields.
 *
 * @since 0.1.0
 * @category type-level
 */
export type StructType<F extends Fields> = { -readonly [K in keyof F]: Type<F[K]> }

/**
 * A C-like struct layout. Fields are stored in declaration order, each at an
 * offset aligned to its own alignment, and the total size is padded to a
 * multiple of the struct's alignment (the largest field alignment).
 *
 * @since 0.1.0
 * @category models
 */
export interface Struct<F extends Fields> extends Layout<StructType<F>> {
  readonly _tag: "Struct"
  readonly fields: F
  readonly offsets: { readonly [K in keyof F]: number }
  readonly packed: boolean
}

/**
 * @since 0.1.0
 * @category models
 */
export type AnyStruct = Struct<any>

/**
 * Rounds `n` up to the next multiple of `align` (which must be a power of two).
 *
 * @since 0.1.0
 * @category utils
 */
export const alignUp = (n: number, align: number): number => (n + align - 1) & ~(align - 1)

/**
 * Defines a struct layout.
 *
 * Pass `{ packed: true }` to remove all padding (every field is then aligned
 * to 1 byte). Packed structs use less memory but their fields can never be
 * viewed through typed arrays.
 *
 * @example
 * ```ts
 * import * as Layout from "effect-ext/Layout"
 *
 * const Particle = Layout.struct({
 *   position: Layout.struct({ x: Layout.f32, y: Layout.f32 }),
 *   mass: Layout.f64,
 *   alive: Layout.bool,
 * })
 *
 * Particle.size // 24
 * Particle.offsets.mass // 8
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const struct = <const F extends Fields>(
  fields: F,
  options?: { readonly packed?: boolean | undefined },
): Struct<F> => {
  const packed = options?.packed ?? false
  const keys = R.keys(fields)
  const offsets: Record<string, number> = {}
  let offset = 0
  let align = 1
  for (const key of keys) {
    const field = fields[key]
    const fieldAlign = packed ? 1 : field.align
    offset = alignUp(offset, fieldAlign)
    offsets[key] = offset
    offset += field.size
    align = Math.max(align, fieldAlign)
  }
  const self = Object.create(Proto)
  self[TypeId] = TypeId
  self._tag = "Struct"
  self.fields = fields
  self.offsets = offsets
  self.packed = packed
  self.align = align
  self.size = alignUp(offset, align)
  self.read = (view: DataView, byteOffset: number): StructType<F> => {
    const out: Record<string, Type<F[keyof F]>> = {}
    for (const key of keys) {
      out[key] = fields[key].read(view, byteOffset + offsets[key])
    }
    // SAFETY: the loop above assigned every key of `fields` from its layout.
    return out as StructType<F>
  }
  self.write = (view: DataView, byteOffset: number, value: StructType<F>) => {
    for (const key of keys) {
      fields[key].write(view, byteOffset + offsets[key], value[key])
    }
  }
  return self
}

/**
 * A fixed-length array layout, like `[T; N]` in Rust.
 *
 * @since 0.1.0
 * @category models
 */
export interface FixedArray<L extends Any, N extends number> extends Layout<Array<Type<L>>> {
  readonly _tag: "FixedArray"
  readonly element: L
  readonly length: N
}

/**
 * Defines a fixed-length array layout of `length` consecutive `element`s.
 *
 * Reading produces a fresh JavaScript array; writing requires an array of
 * exactly `length` elements.
 *
 * @since 0.1.0
 * @category constructors
 */
export const array = <L extends Any, const N extends number>(
  element: L,
  length: N,
): FixedArray<L, N> => {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(`Layout.array: invalid length ${length}`)
  }
  const stride = element.size
  const self = Object.create(Proto)
  self[TypeId] = TypeId
  self._tag = "FixedArray"
  self.element = element
  self.length = length
  self.align = element.align
  self.size = stride * length
  self.read = (view: DataView, byteOffset: number) => {
    const out: Array<unknown> = []
    for (let i = 0; i < length; i++) {
      out.push(element.read(view, byteOffset + i * stride))
    }
    return out
  }
  self.write = (view: DataView, byteOffset: number, value: ReadonlyArray<unknown>) => {
    if (value.length !== length) {
      throw new RangeError(`Layout.array: expected ${length} elements, received ${value.length}`)
    }
    for (let i = 0; i < length; i++) {
      element.write(view, byteOffset + i * stride, value[i])
    }
  }
  return self
}

/**
 * @since 0.1.0
 * @category guards
 */
export const isLayout = (u: unknown): u is Any => P.hasProperty(u, TypeId)

/**
 * @since 0.1.0
 * @category guards
 */
export const isPrimitive = (u: unknown): u is AnyPrimitive =>
  isLayout(u) && P.hasProperty(u, "TypedArray") && P.isFunction(u.TypedArray)

/**
 * @since 0.1.0
 * @category guards
 */
export const isStruct = (u: unknown): u is AnyStruct => isLayout(u) && P.isTagged(u, "Struct")
