/**
 * `@thomasfosterau/effect-utilities` — extensions to the Effect standard
 * library: Allocator-backed binary data (layouts, buffer structs, vectors,
 * struct-of-arrays, Rust-style UTF-8 strings) and Schema helpers (the update
 * tri-state, issue → JSON Pointer, bounded codecs, ids, exact literal tuples,
 * introspection). Each module is also its own entry point
 * (`@thomasfosterau/effect-utilities/Vec`, …); this barrel re-exports them as
 * namespaces.
 *
 * @copyright Thomas Foster
 * @since 0.1.0
 */

/**
 * The `Allocator` service hands out blocks of `ArrayBuffer` memory.
 *
 * @since 0.1.0
 */
export * as Allocator from "./Allocator.ts";

/**
 * Schema introspection by AST and behavioural decode probe.
 *
 * @since 0.1.0
 */
export * as Ast from "./Ast.ts";

/**
 * Bounded pagination and id-list schemas for list inputs.
 *
 * @since 0.1.0
 */
export * as Bounded from "./Bounded.ts";

/**
 * Structs backed by `ArrayBuffer` memory.
 *
 * @since 0.1.0
 */
export * as BufferStruct from "./BufferStruct.ts";

/**
 * UUID, branded-UUID ids and slugs.
 *
 * @since 0.1.0
 */
export * as Ids from "./Ids.ts";

/**
 * Schema issue trees → RFC 6901 JSON Pointers.
 *
 * @since 0.1.0
 */
export * as Issues from "./Issues.ts";

/**
 * Binary layouts: how values are laid out in memory.
 *
 * @since 0.1.0
 */
export * as Layout from "./Layout.ts";

/**
 * Literal tuples checked to cover a union exactly.
 *
 * @since 0.1.0
 */
export * as LiteralExact from "./LiteralExact.ts";

/**
 * An immutable UTF-8 string slice, like Rust's `str`.
 *
 * @since 0.1.0
 */
export * as Str from "./Str.ts";

/**
 * A growable, mutable UTF-8 string, like Rust's `String`.
 *
 * @since 0.1.0
 */
export * as String from "./String.ts";

/**
 * A growable struct-of-arrays container backed by `ArrayBuffer` memory.
 *
 * @since 0.1.0
 */
export * as StructOfArrays from "./StructOfArrays.ts";

/**
 * The update tri-state: field schemas and readers.
 *
 * @since 0.1.0
 */
export * as TriState from "./TriState.ts";

/**
 * Absolute URLs whose scheme, host, port, credentials and path are part of
 * their type.
 *
 * @since 0.1.0
 */
export * as Url from "./Url.ts";

/**
 * A growable array backed by `ArrayBuffer` memory, like Rust's `Vec<T>`.
 *
 * @since 0.1.0
 */
export * as Vec from "./Vec.ts";
