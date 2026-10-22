/**
 * A growable, mutable UTF-8 string, like Rust's `String`.
 *
 * A `String` owns a buffer from the current {@link Allocator.Allocator} and
 * always holds valid UTF-8. As in Rust, indices are byte offsets, lengths are
 * in bytes, and a character is one Unicode scalar value (here, a JavaScript
 * string holding one code point).
 *
 * Operations that may allocate (`push`, `pushStr`, `insert`, `reserve`, …)
 * return an `Effect` that can fail with an `AllocationError`; everything else
 * is synchronous. Invalid indices (out of range, or not on a character
 * boundary) are defects, as they are panics in Rust.
 *
 * Rust's `String` dereferences to `str`. Here, {@link toStr} takes an
 * immutable `Str` snapshot (a copy) for the full `Str` API, and the most
 * common read-only queries are also available directly. Functions that would
 * return a `&str` into the string return a `Str` copy instead, so later
 * mutation can never invalidate them.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as String from "effect-ext/String"
 *
 * const program = Effect.gen(function* () {
 *   const s = yield* String.from("héllo")
 *   yield* String.pushStr(s, " wörld")
 *   yield* String.push(s, "!")
 *   String.len(s) // 14 (bytes)
 *   String.pop(s) // Option.some("!")
 *   return s.toString() // "héllo wörld"
 * })
 * ```
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import { NodeInspectSymbol } from "effect/Inspectable"
import * as Option from "effect/Option"
import { pipeArguments, type Pipeable } from "effect/Pipeable"
import * as P from "effect/Predicate"
import * as Result from "effect/Result"
import type * as Scope from "effect/Scope"
import * as Allocator from "./Allocator.ts"
import { ByteBuffer } from "./internal/bytes.ts"
import * as Utf8 from "./internal/utf8.ts"
import * as Str from "./Str.ts"

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId = "~effect-ext/String" as const

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 0.1.0
 * @category models
 */
export interface String extends Pipeable, Iterable<string> {
  readonly [TypeId]: TypeId
  /** The allocator that owns this string's memory. */
  readonly allocator: Allocator.Allocator
  /** Decodes the string into a JavaScript string. */
  toString(): string
  toJSON(): { readonly _id: "String"; readonly value: string }
}

class StringImpl implements String {
  readonly [TypeId] = TypeId
  readonly buffer: ByteBuffer

  constructor(readonly allocator: Allocator.Allocator) {
    this.buffer = new ByteBuffer(allocator)
  }

  bytes(): Uint8Array {
    return this.buffer.bytes()
  }

  toString(): string {
    return Utf8.decoder.decode(this.buffer.bytes())
  }

  [Symbol.iterator](): Iterator<string> {
    return Utf8.chars(() => this.buffer.bytes())
  }

  pipe() {
    return pipeArguments(this, arguments)
  }

  toJSON() {
    return { _id: "String" as const, value: this.toString() }
  }

  [NodeInspectSymbol]() {
    return this.toJSON()
  }
}

const impl = (self: String): StringImpl => {
  if (self instanceof StringImpl) return self
  throw new TypeError("String: expected a String created by this module")
}

const toBytes = (s: Str.Str | string): Uint8Array =>
  P.isString(s) ? Utf8.encoder.encode(s) : Str.asBytes(s)

const toMatcher = (pattern: Str.Pattern): Utf8.Matcher =>
  P.isString(pattern)
    ? Utf8.needle(Utf8.encoder.encode(pattern))
    : P.isFunction(pattern)
      ? Utf8.predicate(pattern)
      : Utf8.needle(Str.asBytes(pattern))

/** A copy of `bytes` as a `Str`, so it is unaffected by later mutation. */
const snapshot = (bytes: Uint8Array): Str.Str => Str.fromUtf8Unsafe(bytes.slice())

const isChar = (char: string) => char.isWellFormed() && Array.from(char).length === 1

const invalidIndex = (self: StringImpl, index: number) =>
  new RangeError(`String: ${index} is not a character boundary of a ${self.buffer.len}-byte string`)

const invalidRange = (self: StringImpl, start: number, end: number) =>
  new RangeError(
    `String: [${start}, ${end}) is not a valid range of a ${self.buffer.len}-byte string`,
  )

const isRange = (bytes: Uint8Array, start: number, end: number) =>
  start <= end && Utf8.isCharBoundary(bytes, start) && Utf8.isCharBoundary(bytes, end)

const fromResult = (
  result: Result.Result<void, Allocator.AllocationError>,
): Effect.Effect<void, Allocator.AllocationError> =>
  Result.isFailure(result) ? Effect.fail(result.failure) : Effect.void

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * @since 0.1.0
 * @category guards
 */
export const isString = (u: unknown): u is String => P.hasProperty(u, TypeId)

/**
 * Creates an empty string using the current allocator, like Rust's
 * `String::new`. No memory is allocated until something is pushed.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (): Effect.Effect<String> =>
  Effect.map(Effect.service(Allocator.Allocator), (allocator) => new StringImpl(allocator))

/**
 * Creates an empty string with room for at least `capacity` bytes, like
 * Rust's `String::with_capacity`.
 *
 * @since 0.1.0
 * @category constructors
 */
export const withCapacity = (capacity: number): Effect.Effect<String, Allocator.AllocationError> =>
  Effect.flatMap(make(), (self) => Effect.as(reserve(self, capacity), self))

/**
 * Like {@link make}, but frees the string when the surrounding scope closes.
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeScoped = (): Effect.Effect<String, never, Scope.Scope> =>
  Effect.acquireRelease(make(), free)

/**
 * Creates a string holding a copy of `s`, like Rust's `String::from`.
 *
 * @since 0.1.0
 * @category constructors
 */
export const from = (s: Str.Str | string): Effect.Effect<String, Allocator.AllocationError> =>
  Effect.flatMap(make(), (self) => Effect.as(pushStr(self, s), self))

/**
 * Creates a string from the concatenation of an iterable of strings or
 * characters, like Rust's `String::from_iter`.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromIterable = (
  strings: Iterable<Str.Str | string>,
): Effect.Effect<String, Allocator.AllocationError> =>
  Effect.flatMap(make(), (self) => Effect.as(extend(self, strings), self))

/**
 * Validates and copies bytes into a new string, like Rust's
 * `String::from_utf8`.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromUtf8 = (
  bytes: Uint8Array,
): Effect.Effect<String, Str.Utf8Error | Allocator.AllocationError> =>
  Effect.flatMap(Effect.fromResult(Str.fromUtf8(bytes)), from)

/**
 * Decodes bytes into a new string, replacing invalid sequences with U+FFFD,
 * like Rust's `String::from_utf8_lossy`.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromUtf8Lossy = (
  bytes: Uint8Array,
): Effect.Effect<String, Allocator.AllocationError> => from(Str.fromUtf8Lossy(bytes))

/**
 * Returns the string's memory to its allocator. The string is left empty with
 * zero capacity and can still be used afterwards.
 *
 * @since 0.1.0
 * @category destructors
 */
export const free = (self: String): Effect.Effect<void> =>
  Effect.sync(() => impl(self).buffer.free())

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

/**
 * The length in bytes, like Rust's `String::len`.
 *
 * @since 0.1.0
 * @category getters
 */
export const len = (self: String): number => impl(self).buffer.len

/**
 * The number of bytes the string can hold without reallocating, like Rust's
 * `String::capacity`.
 *
 * @since 0.1.0
 * @category getters
 */
export const capacity = (self: String): number => impl(self).buffer.capacity

/**
 * @since 0.1.0
 * @category getters
 */
export const isEmpty = (self: String): boolean => impl(self).buffer.len === 0

/**
 * The UTF-8 bytes, like Rust's `String::as_bytes`. This is a view into the
 * string's buffer: it reflects in-place changes and is invalidated when the
 * string reallocates. Must not be mutated.
 *
 * @since 0.1.0
 * @category getters
 */
export const asBytes = (self: String): Uint8Array => impl(self).bytes()

/**
 * An immutable `Str` copy of the current contents — the counterpart of
 * Rust's `String::as_str`, for the rest of the `Str` API.
 *
 * @since 0.1.0
 * @category getters
 */
export const toStr = (self: String): Str.Str => snapshot(impl(self).bytes())

/**
 * Iterates over the characters, like Rust's `str::chars`.
 *
 * @since 0.1.0
 * @category getters
 */
export const chars = (self: String): IterableIterator<string> => {
  const s = impl(self)
  return Utf8.chars(() => s.bytes())
}

/**
 * Iterates over `[byteIndex, char]` pairs, like Rust's `str::char_indices`.
 *
 * @since 0.1.0
 * @category getters
 */
export const charIndices = (self: String): IterableIterator<readonly [number, string]> => {
  const s = impl(self)
  return Utf8.charIndices(() => s.bytes())
}

/**
 * Whether byte offset `index` is the start of a character (or the end of the
 * string), like Rust's `str::is_char_boundary`.
 *
 * @since 0.1.0
 * @category getters
 */
export const isCharBoundary: {
  (index: number): (self: String) => boolean
  (self: String, index: number): boolean
} = dual(2, (self: String, index: number): boolean =>
  Utf8.isCharBoundary(impl(self).bytes(), index),
)

/**
 * A `Str` copy of `[start, end)` (`end` defaults to the end of the string),
 * like Rust's `str::get(start..end)`. Returns `None` if either offset is out
 * of range or not on a character boundary.
 *
 * @since 0.1.0
 * @category getters
 */
export const get: {
  (start: number, end?: number): (self: String) => Option.Option<Str.Str>
  (self: String, start: number, end?: number): Option.Option<Str.Str>
} = dual(
  (args) => isString(args[0]),
  (self: String, start: number, end?: number): Option.Option<Str.Str> => {
    const bytes = impl(self).bytes()
    const stop = end ?? bytes.byteLength
    return isRange(bytes, start, stop)
      ? Option.some(snapshot(bytes.subarray(start, stop)))
      : Option.none()
  },
)

/**
 * Whether the pattern matches anywhere, like Rust's `str::contains`.
 *
 * @since 0.1.0
 * @category searching
 */
export const contains: {
  (pattern: Str.Pattern): (self: String) => boolean
  (self: String, pattern: Str.Pattern): boolean
} = dual(
  2,
  (self: String, pattern: Str.Pattern): boolean =>
    toMatcher(pattern)(impl(self).bytes()).next(0)[0] !== -1,
)

/**
 * Whether the pattern matches a prefix, like Rust's `str::starts_with`.
 *
 * @since 0.1.0
 * @category searching
 */
export const startsWith: {
  (pattern: Str.Pattern): (self: String) => boolean
  (self: String, pattern: Str.Pattern): boolean
} = dual(
  2,
  (self: String, pattern: Str.Pattern): boolean =>
    toMatcher(pattern)(impl(self).bytes()).matchAt(0)[0] !== -1,
)

/**
 * Whether the pattern matches a suffix, like Rust's `str::ends_with`.
 *
 * @since 0.1.0
 * @category searching
 */
export const endsWith: {
  (pattern: Str.Pattern): (self: String) => boolean
  (self: String, pattern: Str.Pattern): boolean
} = dual(2, (self: String, pattern: Str.Pattern): boolean => {
  const bytes = impl(self).bytes()
  return toMatcher(pattern)(bytes).matchEndingAt(bytes.byteLength)[0] !== -1
})

/**
 * The byte offset of the first match, like Rust's `str::find`.
 *
 * @since 0.1.0
 * @category searching
 */
export const find: {
  (pattern: Str.Pattern): (self: String) => Option.Option<number>
  (self: String, pattern: Str.Pattern): Option.Option<number>
} = dual(2, (self: String, pattern: Str.Pattern): Option.Option<number> => {
  const [start] = toMatcher(pattern)(impl(self).bytes()).next(0)
  return start === -1 ? Option.none() : Option.some(start)
})

/**
 * The byte offset of the last match, like Rust's `str::rfind`.
 *
 * @since 0.1.0
 * @category searching
 */
export const rfind: {
  (pattern: Str.Pattern): (self: String) => Option.Option<number>
  (self: String, pattern: Str.Pattern): Option.Option<number>
} = dual(2, (self: String, pattern: Str.Pattern): Option.Option<number> => {
  const bytes = impl(self).bytes()
  const [start] = toMatcher(pattern)(bytes).prev(bytes.byteLength)
  return start === -1 ? Option.none() : Option.some(start)
})

/**
 * Whether the contents equal `that`, like comparing a Rust `String` with
 * `==`.
 *
 * @since 0.1.0
 * @category predicates
 */
export const equals: {
  (that: String | Str.Str | string): (self: String) => boolean
  (self: String, that: String | Str.Str | string): boolean
} = dual(2, (self: String, that: String | Str.Str | string): boolean =>
  Utf8.bytesEqual(
    impl(self).bytes(),
    P.isString(that) ? toBytes(that) : TypeId in that ? impl(that).bytes() : Str.asBytes(that),
  ),
)

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * Reserves capacity for at least `additional` more bytes, like Rust's
 * `String::reserve`.
 *
 * @since 0.1.0
 * @category capacity
 */
export const reserve: {
  (additional: number): (self: String) => Effect.Effect<void, Allocator.AllocationError>
  (self: String, additional: number): Effect.Effect<void, Allocator.AllocationError>
} = dual(2, (self: String, additional: number) =>
  Effect.suspend(() => fromResult(impl(self).buffer.reserve(additional))),
)

/**
 * Reserves capacity for exactly `additional` more bytes, like Rust's
 * `String::reserve_exact`.
 *
 * @since 0.1.0
 * @category capacity
 */
export const reserveExact: {
  (additional: number): (self: String) => Effect.Effect<void, Allocator.AllocationError>
  (self: String, additional: number): Effect.Effect<void, Allocator.AllocationError>
} = dual(2, (self: String, additional: number) =>
  Effect.suspend(() => {
    const buffer = impl(self).buffer
    const required = buffer.len + additional
    return required <= buffer.capacity ? Effect.void : fromResult(buffer.reserveExact(required))
  }),
)

/**
 * Shrinks the capacity to match the length, like Rust's
 * `String::shrink_to_fit`.
 *
 * @since 0.1.0
 * @category capacity
 */
export const shrinkToFit = (self: String): Effect.Effect<void, Allocator.AllocationError> =>
  shrinkTo(self, 0)

/**
 * Shrinks the capacity to at most `max(len, minCapacity)`, like Rust's
 * `String::shrink_to`.
 *
 * @since 0.1.0
 * @category capacity
 */
export const shrinkTo: {
  (minCapacity: number): (self: String) => Effect.Effect<void, Allocator.AllocationError>
  (self: String, minCapacity: number): Effect.Effect<void, Allocator.AllocationError>
} = dual(2, (self: String, minCapacity: number) =>
  Effect.suspend(() => {
    const buffer = impl(self).buffer
    const target = Math.max(buffer.len, minCapacity)
    return target >= buffer.capacity ? Effect.void : fromResult(buffer.reserveExact(target))
  }),
)

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Appends one character, like Rust's `String::push`. `char` must hold exactly
 * one code point; anything else is a defect.
 *
 * @since 0.1.0
 * @category mutations
 */
export const push: {
  (char: string): (self: String) => Effect.Effect<void, Allocator.AllocationError>
  (self: String, char: string): Effect.Effect<void, Allocator.AllocationError>
} = dual(2, (self: String, char: string) =>
  Effect.suspend(() =>
    isChar(char)
      ? fromResult(impl(self).buffer.append(Utf8.encoder.encode(char)))
      : Effect.die(new RangeError(`String.push: expected a single character, received "${char}"`)),
  ),
)

/**
 * Appends a string, like Rust's `String::push_str`.
 *
 * @since 0.1.0
 * @category mutations
 */
export const pushStr: {
  (s: Str.Str | string): (self: String) => Effect.Effect<void, Allocator.AllocationError>
  (self: String, s: Str.Str | string): Effect.Effect<void, Allocator.AllocationError>
} = dual(2, (self: String, s: Str.Str | string) =>
  Effect.suspend(() => fromResult(impl(self).buffer.append(toBytes(s)))),
)

/**
 * Appends every string (or character) of an iterable, like Rust's
 * `String::extend`. Capacity for all of them is reserved up front, so either
 * everything is appended or, on allocation failure, nothing is.
 *
 * @since 0.1.0
 * @category mutations
 */
export const extend: {
  (
    strings: Iterable<Str.Str | string>,
  ): (self: String) => Effect.Effect<void, Allocator.AllocationError>
  (
    self: String,
    strings: Iterable<Str.Str | string>,
  ): Effect.Effect<void, Allocator.AllocationError>
} = dual(2, (self: String, strings: Iterable<Str.Str | string>) =>
  Effect.suspend(() =>
    fromResult(
      impl(self).buffer.append(
        Utf8.joinBytes(Arr.fromIterable(strings).map(toBytes), new Uint8Array(0)),
      ),
    ),
  ),
)

/**
 * Inserts one character at byte offset `index`, like Rust's
 * `String::insert`. `index` must be a character boundary and `char` a single
 * character; anything else is a defect.
 *
 * @since 0.1.0
 * @category mutations
 */
export const insert: {
  (index: number, char: string): (self: String) => Effect.Effect<void, Allocator.AllocationError>
  (self: String, index: number, char: string): Effect.Effect<void, Allocator.AllocationError>
} = dual(3, (self: String, index: number, char: string) =>
  Effect.suspend(() =>
    isChar(char)
      ? insertStr(self, index, char)
      : Effect.die(
          new RangeError(`String.insert: expected a single character, received "${char}"`),
        ),
  ),
)

/**
 * Inserts a string at byte offset `index`, like Rust's `String::insert_str`.
 * `index` must be a character boundary; anything else is a defect.
 *
 * @since 0.1.0
 * @category mutations
 */
export const insertStr: {
  (
    index: number,
    s: Str.Str | string,
  ): (self: String) => Effect.Effect<void, Allocator.AllocationError>
  (self: String, index: number, s: Str.Str | string): Effect.Effect<void, Allocator.AllocationError>
} = dual(3, (self: String, index: number, s: Str.Str | string) =>
  Effect.suspend(() => {
    const string = impl(self)
    if (!Utf8.isCharBoundary(string.bytes(), index)) return Effect.die(invalidIndex(string, index))
    return fromResult(string.buffer.splice(index, index, toBytes(s)))
  }),
)

/**
 * Replaces the byte range `[start, end)` with `s`, like Rust's
 * `String::replace_range`. Both offsets must be character boundaries;
 * anything else is a defect.
 *
 * @since 0.1.0
 * @category mutations
 */
export const replaceRange: {
  (
    start: number,
    end: number,
    s: Str.Str | string,
  ): (self: String) => Effect.Effect<void, Allocator.AllocationError>
  (
    self: String,
    start: number,
    end: number,
    s: Str.Str | string,
  ): Effect.Effect<void, Allocator.AllocationError>
} = dual(4, (self: String, start: number, end: number, s: Str.Str | string) =>
  Effect.suspend(() => {
    const string = impl(self)
    if (!isRange(string.bytes(), start, end)) return Effect.die(invalidRange(string, start, end))
    return fromResult(string.buffer.splice(start, end, toBytes(s)))
  }),
)

/**
 * Splits the string in two at byte offset `at`, like Rust's
 * `String::split_off`: `self` keeps `[0, at)` and the returned string (from
 * the same allocator) holds `[at, len)`. `at` must be a character boundary;
 * anything else is a defect.
 *
 * @since 0.1.0
 * @category mutations
 */
export const splitOff: {
  (at: number): (self: String) => Effect.Effect<String, Allocator.AllocationError>
  (self: String, at: number): Effect.Effect<String, Allocator.AllocationError>
} = dual(2, (self: String, at: number): Effect.Effect<String, Allocator.AllocationError> =>
  Effect.suspend(() => {
    const string = impl(self)
    const bytes = string.bytes()
    if (!Utf8.isCharBoundary(bytes, at)) return Effect.die(invalidIndex(string, at))
    const rest = new StringImpl(string.allocator)
    const result = rest.buffer.append(bytes.subarray(at))
    if (Result.isFailure(result)) return Effect.fail(result.failure)
    string.buffer.len = at
    return Effect.succeed(rest)
  }),
)

/**
 * Removes and returns the last character, like Rust's `String::pop`.
 *
 * @since 0.1.0
 * @category mutations
 */
export const pop = (self: String): Option.Option<string> => {
  const buffer = impl(self).buffer
  if (buffer.len === 0) return Option.none()
  const bytes = buffer.bytes()
  const start = Utf8.floorCharBoundary(bytes, bytes.byteLength - 1)
  const char = Utf8.charAt(bytes, start)
  buffer.len = start
  return Option.some(char)
}

/**
 * Removes and returns the character at byte offset `index`, like Rust's
 * `String::remove`. Returns `None` if `index` is not the start of a
 * character.
 *
 * @since 0.1.0
 * @category mutations
 */
export const remove: {
  (index: number): (self: String) => Option.Option<string>
  (self: String, index: number): Option.Option<string>
} = dual(2, (self: String, index: number): Option.Option<string> => {
  const buffer = impl(self).buffer
  const bytes = buffer.bytes()
  if (index >= bytes.byteLength || !Utf8.isCharBoundary(bytes, index)) return Option.none()
  const char = Utf8.charAt(bytes, index)
  // Removing never grows the buffer, so this cannot fail.
  buffer.splice(index, index + Utf8.widthOf(bytes[index]), new Uint8Array(0))
  return Option.some(char)
})

/**
 * Removes the byte range `[start, end)` (`end` defaults to the end of the
 * string) and returns it as a `Str`, like Rust's `String::drain`. Returns
 * `None`, leaving the string unchanged, if either offset is out of range or
 * not on a character boundary.
 *
 * @since 0.1.0
 * @category mutations
 */
export const drain: {
  (start: number, end?: number): (self: String) => Option.Option<Str.Str>
  (self: String, start: number, end?: number): Option.Option<Str.Str>
} = dual(
  (args) => isString(args[0]),
  (self: String, start: number, end?: number): Option.Option<Str.Str> => {
    const buffer = impl(self).buffer
    const bytes = buffer.bytes()
    const stop = end ?? bytes.byteLength
    if (!isRange(bytes, start, stop)) return Option.none()
    const drained = snapshot(bytes.subarray(start, stop))
    buffer.splice(start, stop, new Uint8Array(0))
    return Option.some(drained)
  },
)

/**
 * Keeps only the characters for which `predicate` returns `true`, like Rust's
 * `String::retain`.
 *
 * @since 0.1.0
 * @category mutations
 */
export const retain: {
  (predicate: (char: string) => boolean): (self: String) => void
  (self: String, predicate: (char: string) => boolean): void
} = dual(2, (self: String, predicate: (char: string) => boolean): void => {
  const buffer = impl(self).buffer
  const bytes = buffer.bytes()
  // Compact the kept characters towards the start; this never grows.
  const kept = Arr.fromIterable(Utf8.charIndices(() => bytes)).reduce((written, [index, char]) => {
    if (!predicate(char)) return written
    const width = Utf8.widthOf(bytes[index])
    bytes.copyWithin(written, index, index + width)
    return written + width
  }, 0)
  buffer.len = kept
})

/**
 * Shortens the string to `newLen` bytes, like Rust's `String::truncate`. Has
 * no effect if the string is already shorter. Returns `false` (leaving the
 * string unchanged) if `newLen` is not a character boundary.
 *
 * @since 0.1.0
 * @category mutations
 */
export const truncate: {
  (newLen: number): (self: String) => boolean
  (self: String, newLen: number): boolean
} = dual(2, (self: String, newLen: number): boolean => {
  const buffer = impl(self).buffer
  if (newLen >= buffer.len) return true
  if (!Utf8.isCharBoundary(buffer.bytes(), newLen)) return false
  buffer.len = newLen
  return true
})

/**
 * Removes all contents, keeping the capacity, like Rust's `String::clear`.
 *
 * @since 0.1.0
 * @category mutations
 */
export const clear = (self: String): void => {
  impl(self).buffer.len = 0
}

/**
 * Converts ASCII letters to upper case in place, like Rust's
 * `str::make_ascii_uppercase`.
 *
 * @since 0.1.0
 * @category mutations
 */
export const makeAsciiUppercase = (self: String): void => {
  const bytes = impl(self).bytes()
  bytes.set(bytes.map(Utf8.toAsciiUppercaseByte))
}

/**
 * Converts ASCII letters to lower case in place, like Rust's
 * `str::make_ascii_lowercase`.
 *
 * @since 0.1.0
 * @category mutations
 */
export const makeAsciiLowercase = (self: String): void => {
  const bytes = impl(self).bytes()
  bytes.set(bytes.map(Utf8.toAsciiLowercaseByte))
}
