/**
 * @since 0.1.0
 */

/**
 * The `Allocator` service hands out blocks of `ArrayBuffer` memory.
 *
 * @since 0.1.0
 */
export * as Allocator from "./Allocator.ts"

/**
 * Structs backed by `ArrayBuffer` memory.
 *
 * @since 0.1.0
 */
export * as BufferStruct from "./BufferStruct.ts"

/**
 * Binary layouts: how values are laid out in memory.
 *
 * @since 0.1.0
 */
export * as Layout from "./Layout.ts"

/**
 * A growable struct-of-arrays container backed by `ArrayBuffer` memory.
 *
 * @since 0.1.0
 */
export * as StructOfArrays from "./StructOfArrays.ts"

/**
 * An immutable UTF-8 string slice, like Rust's `str`.
 *
 * @since 0.1.0
 */
export * as Str from "./Str.ts"

/**
 * A growable, mutable UTF-8 string, like Rust's `String`.
 *
 * @since 0.1.0
 */
export * as String from "./String.ts"

/**
 * A growable array backed by `ArrayBuffer` memory, like Rust's `Vec<T>`.
 *
 * @since 0.1.0
 */
export * as Vec from "./Vec.ts"
