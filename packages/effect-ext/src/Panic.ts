/**
 * The tagged panics of the binary-data modules (`Vec`, `StructOfArrays`,
 * `Str`, `StringBuf`, `Layout`, `BufferStruct`): misuse that Rust would
 * answer with a panic. The `*Unsafe` forms throw them, and the `Effect` forms
 * die with them, so a defect can be matched by `_tag` and read by field
 * (`Cause.findDefect`, `Effect.catchDefect`). The numeric modules' panics are
 * `ArithmeticError`'s `DomainError` and `DivisionByZeroError`.
 *
 * @since 0.5.0
 */
import * as Schema from "effect/Schema";

/**
 * An index outside `[0, length)` (or `[0, length]` where the operation
 * inserts).
 *
 * @example
 * ```ts
 * import { Panic } from "@thomasfosterau/effect-ext"
 *
 * new Panic.IndexOutOfBoundsError({ type: "Vec", index: 4, length: 3 }).message
 * // → "Vec: index 4 out of bounds (length 3)"
 * ```
 *
 * @category errors
 * @since 0.5.0
 */
export class IndexOutOfBoundsError extends Schema.TaggedError<
  IndexOutOfBoundsError,
  { readonly brand: unique symbol }
>()("IndexOutOfBoundsError", {
  /** The module whose value was indexed, e.g. `"Vec"`. */
  type: Schema.String,
  /** The rejected index (any value: it may not be a number at all, or `NaN`). */
  index: Schema.Unknown,
  /** The value's length when it was indexed. */
  length: Schema.Finite,
}) {
  /** `"<type>: index <index> out of bounds (length <length>)"`. */
  override get message(): string {
    return `${this.type}: index ${String(this.index)} out of bounds (length ${this.length})`;
  }
}

/**
 * A length beyond a value's capacity: a `pushUnsafe` into a full value, or a
 * `setLenUnsafe` past the capacity (or to a length that is not a whole number).
 *
 * @example
 * ```ts
 * import { Panic } from "@thomasfosterau/effect-ext"
 *
 * new Panic.CapacityError({ type: "Vec", length: 5, capacity: 4 }).message
 * // → "Vec: length 5 out of bounds (capacity 4)"
 * ```
 *
 * @category errors
 * @since 0.5.0
 */
export class CapacityError extends Schema.TaggedError<
  CapacityError,
  { readonly brand: unique symbol }
>()("CapacityError", {
  /** The module whose value was resized, e.g. `"Vec"`. */
  type: Schema.String,
  /** The length asked for (any value: it may be fractional or `NaN`). */
  length: Schema.Unknown,
  /** The value's capacity. */
  capacity: Schema.Finite,
}) {
  /** `"<type>: length <length> out of bounds (capacity <capacity>)"`. */
  override get message(): string {
    return `${this.type}: length ${String(this.length)} out of bounds (capacity ${this.capacity})`;
  }
}

/**
 * A byte offset into a UTF-8 string that is not on a character boundary (or
 * lies past its end).
 *
 * @example
 * ```ts
 * import { Panic } from "@thomasfosterau/effect-ext"
 *
 * new Panic.CharBoundaryError({ type: "Str", index: 1, length: 4 }).message
 * // → "Str: 1 is not a character boundary of a 4-byte string"
 * ```
 *
 * @category errors
 * @since 0.5.0
 */
export class CharBoundaryError extends Schema.TaggedError<
  CharBoundaryError,
  { readonly brand: unique symbol }
>()("CharBoundaryError", {
  /** The module whose string was indexed, e.g. `"Str"`. */
  type: Schema.String,
  /** The rejected byte offset (any value: it may be fractional or `NaN`). */
  index: Schema.Unknown,
  /** The string's length in bytes. */
  length: Schema.Finite,
}) {
  /** `"<type>: <index> is not a character boundary of a <length>-byte string"`. */
  override get message(): string {
    return `${this.type}: ${String(this.index)} is not a character boundary of a ${this.length}-byte string`;
  }
}

/**
 * Any other argument a binary-data operation cannot accept: a value from
 * another module, a malformed layout, a range whose ends are reversed or off
 * a character boundary.
 *
 * @example
 * ```ts
 * import { Panic } from "@thomasfosterau/effect-ext"
 *
 * new Panic.InvalidArgumentError({ operation: "Str.repeat", reason: "invalid repeat count -1" })
 *   .message
 * // → "Str.repeat: invalid repeat count -1"
 * ```
 *
 * @category errors
 * @since 0.5.0
 */
export class InvalidArgumentError extends Schema.TaggedError<
  InvalidArgumentError,
  { readonly brand: unique symbol }
>()("InvalidArgumentError", {
  /** The operation, e.g. `"Layout.array"`. */
  operation: Schema.String,
  /** What is wrong with the argument. */
  reason: Schema.String,
}) {
  /** `"<operation>: <reason>"`. */
  override get message(): string {
    return `${this.operation}: ${this.reason}`;
  }
}

/**
 * Any panic defined in this module.
 *
 * @category models
 * @since 0.5.0
 */
export type Panic =
  | IndexOutOfBoundsError
  | CapacityError
  | CharBoundaryError
  | InvalidArgumentError;

/**
 * Whether a value is one of this module's panics, for reading a defect.
 *
 * @example
 * ```ts
 * import { Panic } from "@thomasfosterau/effect-ext"
 *
 * Panic.isPanic(new Panic.CapacityError({ type: "Vec", length: 1, capacity: 0 })) // → true
 * Panic.isPanic(new RangeError("x")) // → false
 * ```
 *
 * @category guards
 * @since 0.5.0
 */
export const isPanic = (u: unknown): u is Panic =>
  u instanceof IndexOutOfBoundsError ||
  u instanceof CapacityError ||
  u instanceof CharBoundaryError ||
  u instanceof InvalidArgumentError;
