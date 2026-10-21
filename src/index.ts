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
 * An immutable UTF-8 string backed by a `Uint8Array`.
 *
 * @since 0.1.0
 */
export * as Utf8String from "./Utf8String.ts"

/**
 * A growable array backed by `ArrayBuffer` memory, like Rust's `Vec<T>`.
 *
 * @since 0.1.0
 */
export * as Vec from "./Vec.ts"
