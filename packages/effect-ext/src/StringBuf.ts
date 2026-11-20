/**
 * A growable, mutable UTF-8 string, like Rust's `String`.
 *
 * A `StringBuf` owns a buffer from the current {@link Allocator.Allocator} and
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
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const program = Effect.gen(function* () {
 *   const s = yield* StringBuf.from("héllo")
 *   yield* StringBuf.pushStr(s, " wörld")
 *   yield* StringBuf.push(s, "!")
 *   StringBuf.len(s) // 14 (bytes)
 *   StringBuf.pop(s) // Option.some("!")
 *   return s.toString() // "héllo wörld"
 * })
 * ```
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import { NodeInspectSymbol } from "effect/Inspectable";
import * as Option from "effect/Option";
import { pipeArguments, type Pipeable } from "effect/Pipeable";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import type * as Scope from "effect/Scope";
import * as Allocator from "./Allocator.ts";
import { ByteBuffer } from "./internal/bytes.ts";
import * as Utf8 from "./internal/utf8.ts";
import * as Str from "./Str.ts";

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId = "~effect-ext/StringBuf" as const;

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId;

/**
 * @since 0.1.0
 * @category models
 */
export interface StringBuf extends Pipeable, Iterable<string> {
  readonly [TypeId]: TypeId;
  /** The allocator that owns this string's memory. */
  readonly allocator: Allocator.Allocator;
  /** Decodes the string into a JavaScript string. */
  toString(): string;
  toJSON(): { readonly _id: "StringBuf"; readonly value: string };
}

class StringBufImpl implements StringBuf {
  readonly [TypeId] = TypeId;
  readonly allocator: Allocator.Allocator;
  readonly buffer: ByteBuffer;

  constructor(allocator: Allocator.Allocator) {
    this.allocator = allocator;
    this.buffer = new ByteBuffer(allocator);
  }

  bytes(): Uint8Array {
    return this.buffer.bytes();
  }

  toString(): string {
    return Utf8.decode(this.buffer.bytes());
  }

  [Symbol.iterator](): Iterator<string> {
    return Utf8.chars(() => this.buffer.bytes());
  }

  pipe() {
    return pipeArguments(this, arguments);
  }

  toJSON() {
    return { _id: "StringBuf" as const, value: this.toString() };
  }

  [NodeInspectSymbol]() {
    return this.toJSON();
  }
}

const impl = (self: StringBuf): StringBufImpl => {
  if (self instanceof StringBufImpl) return self;
  throw new TypeError("StringBuf: expected a StringBuf created by this module");
};

const toBytes = (s: Str.Str | string): Uint8Array =>
  P.isString(s) ? Utf8.encoder.encode(s) : Str.asBytes(s);

const toMatcher = (pattern: Str.Pattern): Utf8.Matcher =>
  P.isString(pattern)
    ? Utf8.needle(Utf8.encoder.encode(pattern))
    : P.isFunction(pattern)
      ? Utf8.predicate(pattern)
      : Utf8.needle(Str.asBytes(pattern));

/** A copy of `bytes` as a `Str`, so it is unaffected by later mutation. */
const snapshot = (bytes: Uint8Array): Str.Str => Str.fromUtf8Unsafe(bytes.slice());

const isChar = (char: string) => char.isWellFormed() && Array.from(char).length === 1;

const invalidIndex = (self: StringBufImpl, index: number) =>
  new RangeError(
    `StringBuf: ${index} is not a character boundary of a ${self.buffer.len}-byte string`,
  );

const invalidRange = (self: StringBufImpl, start: number, end: number) =>
  new RangeError(
    `StringBuf: [${start}, ${end}) is not a valid range of a ${self.buffer.len}-byte string`,
  );

const isRange = (bytes: Uint8Array, start: number, end: number) =>
  start <= end && Utf8.isCharBoundary(bytes, start) && Utf8.isCharBoundary(bytes, end);

const fromResult = (
  result: Result.Result<void, Allocator.AllocationError>,
): Effect.Effect<void, Allocator.AllocationError> =>
  Result.isFailure(result) ? Effect.fail(result.failure) : Effect.void;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("héllo"))
 * console.log(StringBuf.isStringBuf(s), StringBuf.isStringBuf("héllo"))
 * // → true false
 * ```
 *
 * @since 0.1.0
 * @category guards
 */
export const isStringBuf = (u: unknown): u is StringBuf => P.hasProperty(u, TypeId);

/**
 * Creates an empty string using the current allocator, like Rust's
 * `String::new`. No memory is allocated until something is pushed.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.make())
 * console.log(StringBuf.len(s), StringBuf.capacity(s), StringBuf.isEmpty(s))
 * // → 0 0 true
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (): Effect.Effect<StringBuf> =>
  Effect.map(Effect.service(Allocator.Allocator), (allocator) => new StringBufImpl(allocator));

/**
 * Creates an empty string with room for at least `capacity` bytes, like
 * Rust's `String::with_capacity`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.withCapacity(10))
 * const capacity = StringBuf.capacity(s)
 * console.log(StringBuf.len(s), capacity >= 10)
 * // → 0 true
 *
 * // These are all done without reallocating...
 * Effect.runSync(StringBuf.pushStr(s, "abcdefghij"))
 * console.log(StringBuf.len(s), StringBuf.capacity(s) === capacity)
 * // → 10 true
 *
 * // ...but this may make the string reallocate
 * Effect.runSync(StringBuf.push(s, "é"))
 * console.log(StringBuf.len(s))
 * // → 12
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const withCapacity = (
  capacity: number,
): Effect.Effect<StringBuf, Allocator.AllocationError> =>
  Effect.tap(make(), (self) => reserve(self, capacity));

/**
 * Like {@link make}, but frees the string when the surrounding scope closes.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const s = yield* StringBuf.makeScoped()
 *     yield* StringBuf.pushStr(s, "héllo")
 *     return s.toString()
 *   }),
 * )
 * console.log(Effect.runSync(program))
 * // → héllo
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeScoped = (): Effect.Effect<StringBuf, never, Scope.Scope> =>
  Effect.acquireRelease(make(), free);

/**
 * Creates a string holding a copy of `s`, like Rust's `String::from`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("héllo"))
 * console.log(s.toString(), StringBuf.len(s))
 * // → héllo 6
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const from = (s: Str.Str | string): Effect.Effect<StringBuf, Allocator.AllocationError> =>
  Effect.tap(make(), (self) => pushStr(self, s));

/**
 * Creates a string from the concatenation of an iterable of strings or
 * characters, like Rust's `String::from_iter`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.fromIterable(["h", "é", "llo", " ", "wörld"]))
 * console.log(s.toString(), StringBuf.len(s))
 * // → héllo wörld 13
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromIterable = (
  strings: Iterable<Str.Str | string>,
): Effect.Effect<StringBuf, Allocator.AllocationError> =>
  Effect.tap(make(), (self) => extend(self, strings));

/**
 * Validates and copies bytes into a new string, like Rust's
 * `String::from_utf8`.
 *
 * @example
 * ```ts
 * import { Effect, Result } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * // some bytes, in a Uint8Array
 * const sparkleHeart = Effect.runSync(StringBuf.fromUtf8(new Uint8Array([240, 159, 146, 150])))
 * console.log(sparkleHeart.toString(), StringBuf.len(sparkleHeart))
 * // → 💖 4
 *
 * // some invalid bytes
 * const invalid = Effect.runSync(Effect.result(StringBuf.fromUtf8(new Uint8Array([0, 159, 146, 150]))))
 * console.log(Result.isFailure(invalid))
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromUtf8 = (
  bytes: Uint8Array,
): Effect.Effect<StringBuf, Str.Utf8Error | Allocator.AllocationError> =>
  Effect.flatMap(Effect.fromResult(Str.fromUtf8(bytes)), from);

/**
 * Decodes bytes into a new string, replacing invalid sequences with U+FFFD,
 * like Rust's `String::from_utf8_lossy`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * // some invalid bytes: "Hello " + a truncated 4-byte sequence + "World"
 * const input = new Uint8Array([72, 101, 108, 108, 111, 32, 0xf0, 0x90, 0x80, 87, 111, 114, 108, 100])
 * const s = Effect.runSync(StringBuf.fromUtf8Lossy(input))
 * console.log(s.toString())
 * // → Hello �World
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromUtf8Lossy = (
  bytes: Uint8Array,
): Effect.Effect<StringBuf, Allocator.AllocationError> => from(Str.fromUtf8Lossy(bytes));

/**
 * Returns the string's memory to its allocator. The string is left empty with
 * zero capacity and can still be used afterwards.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("héllo"))
 * Effect.runSync(StringBuf.free(s))
 * console.log(StringBuf.len(s), StringBuf.capacity(s))
 * // → 0 0
 * ```
 *
 * @since 0.1.0
 * @category destructors
 */
export const free = (self: StringBuf): Effect.Effect<void> =>
  Effect.sync(() => impl(self).buffer.free());

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

/**
 * The length in bytes, like Rust's `String::len`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const a = Effect.runSync(StringBuf.from("foo"))
 * const fancyF = Effect.runSync(StringBuf.from("ƒoo"))
 * console.log(StringBuf.len(a), StringBuf.len(fancyF), Array.from(StringBuf.chars(fancyF)).length)
 * // → 3 4 3
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const len = (self: StringBuf): number => impl(self).buffer.len;

/**
 * The number of bytes the string can hold without reallocating, like Rust's
 * `String::capacity`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.withCapacity(10))
 * console.log(StringBuf.capacity(s) >= 10)
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const capacity = (self: StringBuf): number => impl(self).buffer.capacity;

/**
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.make())
 * console.log(StringBuf.isEmpty(s))
 * // → true
 *
 * Effect.runSync(StringBuf.push(s, "é"))
 * console.log(StringBuf.isEmpty(s))
 * // → false
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const isEmpty = (self: StringBuf): boolean => impl(self).buffer.len === 0;

/**
 * The UTF-8 bytes, like Rust's `String::as_bytes`. This is a view into the
 * string's buffer: it reflects in-place changes and is invalidated when the
 * string reallocates. Must not be mutated.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("héllo"))
 * console.log(Array.from(StringBuf.asBytes(s)).join(" "))
 * // → 104 195 169 108 108 111
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const asBytes = (self: StringBuf): Uint8Array => impl(self).bytes();

/**
 * An immutable `Str` copy of the current contents — the counterpart of
 * Rust's `String::as_str`, for the rest of the `Str` API.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Effect.runSync(StringBuf.from("héllo"))
 * const snapshot = StringBuf.toStr(s)
 * Effect.runSync(StringBuf.pushStr(s, " wörld"))
 * console.log(snapshot.toString(), Str.len(snapshot), Str.toUppercase(snapshot).toString())
 * // → héllo 6 HÉLLO
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const toStr = (self: StringBuf): Str.Str => snapshot(impl(self).bytes());

/**
 * Iterates over the characters, like Rust's `str::chars`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("héllo"))
 * console.log(Array.from(StringBuf.chars(s)).join(","))
 * // → h,é,l,l,o
 *
 * // a character is a code point, so a combining mark is a character of its own
 * const yes = Effect.runSync(StringBuf.from("y̆es"))
 * console.log(Array.from(StringBuf.chars(yes)).length, StringBuf.len(yes))
 * // → 4 5
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const chars = (self: StringBuf): IterableIterator<string> => {
  const s = impl(self);
  return Utf8.chars(() => s.bytes());
};

/**
 * Iterates over `[byteIndex, char]` pairs, like Rust's `str::char_indices`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("héllo"))
 * console.log(Array.from(StringBuf.charIndices(s), ([index, char]) => `${index}:${char}`).join(" "))
 * // → 0:h 1:é 3:l 4:l 5:o
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const charIndices = (self: StringBuf): IterableIterator<readonly [number, string]> => {
  const s = impl(self);
  return Utf8.charIndices(() => s.bytes());
};

/**
 * Whether byte offset `index` is the start of a character (or the end of the
 * string), like Rust's `str::is_char_boundary`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("Löwe 老虎 Léopard"))
 * console.log(StringBuf.isCharBoundary(s, 0), StringBuf.isCharBoundary(s, 6), StringBuf.isCharBoundary(s, StringBuf.len(s)))
 * // → true true true
 *
 * // second byte of `ö`, and third byte of `老`
 * console.log(StringBuf.isCharBoundary(s, 2), StringBuf.isCharBoundary(s, 8))
 * // → false false
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const isCharBoundary: {
  (index: number): (self: StringBuf) => boolean;
  (self: StringBuf, index: number): boolean;
} = dual(2, (self: StringBuf, index: number): boolean =>
  Utf8.isCharBoundary(impl(self).bytes(), index),
);

/**
 * A `Str` copy of `[start, end)` (`end` defaults to the end of the string),
 * like Rust's `str::get(start..end)`. Returns `None` if either offset is out
 * of range or not on a character boundary.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("🗻∈🌏"))
 * const show = (o: Option.Option<{ toString(): string }>) => Option.match(o, { onNone: () => "None", onSome: (t) => t.toString() })
 *
 * console.log(show(StringBuf.get(s, 0, 4)), show(StringBuf.get(s, 4)))
 * // → 🗻 ∈🌏
 *
 * // indices not on a character boundary, and out of range
 * console.log(show(StringBuf.get(s, 1)), show(StringBuf.get(s, 0, 100)))
 * // → None None
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const get: {
  (start: number, end?: number): (self: StringBuf) => Option.Option<Str.Str>;
  (self: StringBuf, start: number, end?: number): Option.Option<Str.Str>;
} = dual(
  (args) => isStringBuf(args[0]),
  (self: StringBuf, start: number, end?: number): Option.Option<Str.Str> => {
    const bytes = impl(self).bytes();
    const stop = end ?? bytes.byteLength;
    return isRange(bytes, start, stop)
      ? Option.some(snapshot(bytes.subarray(start, stop)))
      : Option.none();
  },
);

/**
 * Whether the pattern matches anywhere, like Rust's `str::contains`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const bananas = Effect.runSync(StringBuf.from("bänänas"))
 * console.log(StringBuf.contains(bananas, "nän"), StringBuf.contains(bananas, "apples"))
 * // → true false
 *
 * console.log(StringBuf.contains(bananas, (c) => c === "ä"))
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const contains: {
  (pattern: Str.Pattern): (self: StringBuf) => boolean;
  (self: StringBuf, pattern: Str.Pattern): boolean;
} = dual(
  2,
  (self: StringBuf, pattern: Str.Pattern): boolean =>
    toMatcher(pattern)(impl(self).bytes()).next(0)[0] !== -1,
);

/**
 * Whether the pattern matches a prefix, like Rust's `str::starts_with`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const bananas = Effect.runSync(StringBuf.from("bänänas"))
 * console.log(StringBuf.startsWith(bananas, "bä"), StringBuf.startsWith(bananas, "nän"))
 * // → true false
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const startsWith: {
  (pattern: Str.Pattern): (self: StringBuf) => boolean;
  (self: StringBuf, pattern: Str.Pattern): boolean;
} = dual(
  2,
  (self: StringBuf, pattern: Str.Pattern): boolean =>
    toMatcher(pattern)(impl(self).bytes()).matchAt(0)[0] !== -1,
);

/**
 * Whether the pattern matches a suffix, like Rust's `str::ends_with`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const bananas = Effect.runSync(StringBuf.from("bänänas"))
 * console.log(StringBuf.endsWith(bananas, "änas"), StringBuf.endsWith(bananas, "nän"))
 * // → true false
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const endsWith: {
  (pattern: Str.Pattern): (self: StringBuf) => boolean;
  (self: StringBuf, pattern: Str.Pattern): boolean;
} = dual(2, (self: StringBuf, pattern: Str.Pattern): boolean => {
  const bytes = impl(self).bytes();
  return toMatcher(pattern)(bytes).matchEndingAt(bytes.byteLength)[0] !== -1;
});

/**
 * The byte offset of the first match, like Rust's `str::find`.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("Löwe 老虎 Léopard"))
 * const at = (o: Option.Option<number>) => Option.getOrElse(o, () => -1)
 *
 * console.log(at(StringBuf.find(s, "L")), at(StringBuf.find(s, "é")), at(StringBuf.find(s, "pard")))
 * // → 0 14 17
 *
 * console.log(at(StringBuf.find(s, (c) => c === " ")), Option.isNone(StringBuf.find(s, "1")))
 * // → 5 true
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const find: {
  (pattern: Str.Pattern): (self: StringBuf) => Option.Option<number>;
  (self: StringBuf, pattern: Str.Pattern): Option.Option<number>;
} = dual(2, (self: StringBuf, pattern: Str.Pattern): Option.Option<number> => {
  const [start] = toMatcher(pattern)(impl(self).bytes()).next(0);
  return start === -1 ? Option.none() : Option.some(start);
});

/**
 * The byte offset of the last match, like Rust's `str::rfind`.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("Löwe 老虎 Léopard Gepardi"))
 * const at = (o: Option.Option<number>) => Option.getOrElse(o, () => -1)
 *
 * console.log(at(StringBuf.rfind(s, "L")), at(StringBuf.rfind(s, "é")), at(StringBuf.rfind(s, "pard")))
 * // → 13 14 24
 *
 * console.log(at(StringBuf.rfind(s, (c) => c === " ")), Option.isNone(StringBuf.rfind(s, "1")))
 * // → 21 true
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const rfind: {
  (pattern: Str.Pattern): (self: StringBuf) => Option.Option<number>;
  (self: StringBuf, pattern: Str.Pattern): Option.Option<number>;
} = dual(2, (self: StringBuf, pattern: Str.Pattern): Option.Option<number> => {
  const bytes = impl(self).bytes();
  const [start] = toMatcher(pattern)(bytes).prev(bytes.byteLength);
  return start === -1 ? Option.none() : Option.some(start);
});

/**
 * Whether the contents equal `that`, like comparing a Rust `String` with
 * `==`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Effect.runSync(StringBuf.from("héllo"))
 * console.log(StringBuf.equals(s, "héllo"), StringBuf.equals(s, Str.fromString("hello")))
 * // → true false
 *
 * console.log(StringBuf.equals(s, Effect.runSync(StringBuf.from("héllo"))))
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const equals: {
  (that: StringBuf | Str.Str | string): (self: StringBuf) => boolean;
  (self: StringBuf, that: StringBuf | Str.Str | string): boolean;
} = dual(2, (self: StringBuf, that: StringBuf | Str.Str | string): boolean =>
  Utf8.bytesEqual(
    impl(self).bytes(),
    P.isString(that) ? toBytes(that) : TypeId in that ? impl(that).bytes() : Str.asBytes(that),
  ),
);

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * Reserves capacity for at least `additional` more bytes, like Rust's
 * `String::reserve`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.make())
 * Effect.runSync(StringBuf.reserve(s, 10))
 * console.log(StringBuf.len(s), StringBuf.capacity(s) >= 10)
 * // → 0 true
 * ```
 *
 * @since 0.1.0
 * @category capacity
 */
export const reserve: {
  (additional: number): (self: StringBuf) => Effect.Effect<void, Allocator.AllocationError>;
  (self: StringBuf, additional: number): Effect.Effect<void, Allocator.AllocationError>;
} = dual(2, (self: StringBuf, additional: number) =>
  Effect.suspend(() => fromResult(impl(self).buffer.reserve(additional))),
);

/**
 * Reserves capacity for exactly `additional` more bytes, like Rust's
 * `String::reserve_exact`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.make())
 * Effect.runSync(StringBuf.reserveExact(s, 10))
 * console.log(StringBuf.len(s), StringBuf.capacity(s) >= 10)
 * // → 0 true
 * ```
 *
 * @since 0.1.0
 * @category capacity
 */
export const reserveExact: {
  (additional: number): (self: StringBuf) => Effect.Effect<void, Allocator.AllocationError>;
  (self: StringBuf, additional: number): Effect.Effect<void, Allocator.AllocationError>;
} = dual(2, (self: StringBuf, additional: number) =>
  Effect.suspend(() => {
    const buffer = impl(self).buffer;
    const required = buffer.len + additional;
    return required <= buffer.capacity ? Effect.void : fromResult(buffer.reserveExact(required));
  }),
);

/**
 * Shrinks the capacity to match the length, like Rust's
 * `String::shrink_to_fit`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.withCapacity(100))
 * Effect.runSync(StringBuf.pushStr(s, "föo"))
 * console.log(StringBuf.capacity(s) >= 100)
 * // → true
 *
 * Effect.runSync(StringBuf.shrinkToFit(s))
 * console.log(StringBuf.capacity(s))
 * // → 4
 * ```
 *
 * @since 0.1.0
 * @category capacity
 */
export const shrinkToFit = (self: StringBuf): Effect.Effect<void, Allocator.AllocationError> =>
  shrinkTo(self, 0);

/**
 * Shrinks the capacity to at most `max(len, minCapacity)`, like Rust's
 * `String::shrink_to`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.withCapacity(100))
 * Effect.runSync(StringBuf.pushStr(s, "föo"))
 *
 * Effect.runSync(StringBuf.shrinkTo(s, 10))
 * console.log(StringBuf.capacity(s) >= 10)
 * // → true
 *
 * // the capacity never drops below the length
 * Effect.runSync(StringBuf.shrinkTo(s, 0))
 * console.log(StringBuf.capacity(s) >= 4)
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category capacity
 */
export const shrinkTo: {
  (minCapacity: number): (self: StringBuf) => Effect.Effect<void, Allocator.AllocationError>;
  (self: StringBuf, minCapacity: number): Effect.Effect<void, Allocator.AllocationError>;
} = dual(2, (self: StringBuf, minCapacity: number) =>
  Effect.suspend(() => {
    const buffer = impl(self).buffer;
    const target = Math.max(buffer.len, minCapacity);
    return target >= buffer.capacity ? Effect.void : fromResult(buffer.reserveExact(target));
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Appends one character, like Rust's `String::push`. `char` must hold exactly
 * one code point; anything else is a defect.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("abc"))
 * Effect.runSync(StringBuf.push(s, "1"))
 * Effect.runSync(StringBuf.push(s, "é"))
 * Effect.runSync(StringBuf.push(s, "💖"))
 * console.log(s.toString(), StringBuf.len(s))
 * // → abc1é💖 10
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const push: {
  (char: string): (self: StringBuf) => Effect.Effect<void, Allocator.AllocationError>;
  (self: StringBuf, char: string): Effect.Effect<void, Allocator.AllocationError>;
} = dual(2, (self: StringBuf, char: string) =>
  Effect.suspend(() =>
    isChar(char)
      ? fromResult(impl(self).buffer.append(Utf8.encoder.encode(char)))
      : Effect.die(
          new RangeError(`StringBuf.push: expected a single character, received "${char}"`),
        ),
  ),
);

/**
 * Appends a string, like Rust's `String::push_str`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("föo"))
 * Effect.runSync(StringBuf.pushStr(s, "bär"))
 * console.log(s.toString(), StringBuf.len(s))
 * // → föobär 8
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const pushStr: {
  (s: Str.Str | string): (self: StringBuf) => Effect.Effect<void, Allocator.AllocationError>;
  (self: StringBuf, s: Str.Str | string): Effect.Effect<void, Allocator.AllocationError>;
} = dual(2, (self: StringBuf, s: Str.Str | string) =>
  Effect.suspend(() => fromResult(impl(self).buffer.append(toBytes(s)))),
);

/**
 * Appends every string (or character) of an iterable, like Rust's
 * `String::extend`. Capacity for all of them is reserved up front, so either
 * everything is appended or, on allocation failure, nothing is.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Effect.runSync(StringBuf.from("a"))
 * Effect.runSync(StringBuf.extend(s, ["b", "ç", Str.fromString("dé")]))
 * console.log(s.toString(), StringBuf.len(s))
 * // → abçdé 7
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const extend: {
  (
    strings: Iterable<Str.Str | string>,
  ): (self: StringBuf) => Effect.Effect<void, Allocator.AllocationError>;
  (
    self: StringBuf,
    strings: Iterable<Str.Str | string>,
  ): Effect.Effect<void, Allocator.AllocationError>;
} = dual(2, (self: StringBuf, strings: Iterable<Str.Str | string>) =>
  Effect.suspend(() =>
    fromResult(
      impl(self).buffer.append(
        Utf8.joinBytes(Arr.fromIterable(strings).map(toBytes), new Uint8Array(0)),
      ),
    ),
  ),
);

/**
 * Inserts one character at byte offset `index`, like Rust's
 * `String::insert`. `index` must be a character boundary and `char` a single
 * character; anything else is a defect.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.withCapacity(3))
 * Effect.runSync(StringBuf.insert(s, 0, "f"))
 * Effect.runSync(StringBuf.insert(s, 1, "o"))
 * Effect.runSync(StringBuf.insert(s, 2, "o"))
 * console.log(s.toString())
 * // → foo
 *
 * // `é` is two bytes, so the boundary after it is byte 2
 * const t = Effect.runSync(StringBuf.from("éa"))
 * Effect.runSync(StringBuf.insert(t, 2, "ü"))
 * console.log(t.toString())
 * // → éüa
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const insert: {
  (
    index: number,
    char: string,
  ): (self: StringBuf) => Effect.Effect<void, Allocator.AllocationError>;
  (self: StringBuf, index: number, char: string): Effect.Effect<void, Allocator.AllocationError>;
} = dual(3, (self: StringBuf, index: number, char: string) =>
  Effect.suspend(() =>
    isChar(char)
      ? insertStr(self, index, char)
      : Effect.die(
          new RangeError(`StringBuf.insert: expected a single character, received "${char}"`),
        ),
  ),
);

/**
 * Inserts a string at byte offset `index`, like Rust's `String::insert_str`.
 * `index` must be a character boundary; anything else is a defect.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("bär"))
 * Effect.runSync(StringBuf.insertStr(s, 0, "föo"))
 * console.log(s.toString())
 * // → föobär
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const insertStr: {
  (
    index: number,
    s: Str.Str | string,
  ): (self: StringBuf) => Effect.Effect<void, Allocator.AllocationError>;
  (
    self: StringBuf,
    index: number,
    s: Str.Str | string,
  ): Effect.Effect<void, Allocator.AllocationError>;
} = dual(3, (self: StringBuf, index: number, s: Str.Str | string) =>
  Effect.suspend(() => {
    const string = impl(self);
    if (!Utf8.isCharBoundary(string.bytes(), index)) return Effect.die(invalidIndex(string, index));
    return fromResult(string.buffer.splice(index, index, toBytes(s)));
  }),
);

/**
 * Replaces the byte range `[start, end)` with `s`, like Rust's
 * `String::replace_range`. Both offsets must be character boundaries;
 * anything else is a defect.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("α is alpha, β is beta"))
 * const betaOffset = Option.getOrElse(StringBuf.find(s, "β"), () => StringBuf.len(s))
 *
 * // Replace the range up until the β from the string
 * Effect.runSync(StringBuf.replaceRange(s, 0, betaOffset, "Α is capital alpha; "))
 * console.log(s.toString())
 * // → Α is capital alpha; β is beta
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const replaceRange: {
  (
    start: number,
    end: number,
    s: Str.Str | string,
  ): (self: StringBuf) => Effect.Effect<void, Allocator.AllocationError>;
  (
    self: StringBuf,
    start: number,
    end: number,
    s: Str.Str | string,
  ): Effect.Effect<void, Allocator.AllocationError>;
} = dual(4, (self: StringBuf, start: number, end: number, s: Str.Str | string) =>
  Effect.suspend(() => {
    const string = impl(self);
    if (!isRange(string.bytes(), start, end)) return Effect.die(invalidRange(string, start, end));
    return fromResult(string.buffer.splice(start, end, toBytes(s)));
  }),
);

/**
 * Splits the string in two at byte offset `at`, like Rust's
 * `String::split_off`: `self` keeps `[0, at)` and the returned string (from
 * the same allocator) holds `[at, len)`. `at` must be a character boundary;
 * anything else is a defect.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const hello = Effect.runSync(StringBuf.from("Héllo, Wörld!"))
 * const world = Effect.runSync(StringBuf.splitOff(hello, 8))
 * console.log(JSON.stringify(hello.toString()), JSON.stringify(world.toString()))
 * // → "Héllo, " "Wörld!"
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const splitOff: {
  (at: number): (self: StringBuf) => Effect.Effect<StringBuf, Allocator.AllocationError>;
  (self: StringBuf, at: number): Effect.Effect<StringBuf, Allocator.AllocationError>;
} = dual(2, (self: StringBuf, at: number): Effect.Effect<StringBuf, Allocator.AllocationError> =>
  Effect.suspend(() => {
    const string = impl(self);
    const bytes = string.bytes();
    if (!Utf8.isCharBoundary(bytes, at)) return Effect.die(invalidIndex(string, at));
    const rest = new StringBufImpl(string.allocator);
    const result = rest.buffer.append(bytes.subarray(at));
    if (Result.isFailure(result)) return Effect.fail(result.failure);
    string.buffer.len = at;
    return Effect.succeed(rest);
  }),
);

/**
 * Removes and returns the last character, like Rust's `String::pop`.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("abč"))
 * const show = (o: Option.Option<string>) => Option.getOrElse(o, () => "None")
 * console.log(show(StringBuf.pop(s)), show(StringBuf.pop(s)), show(StringBuf.pop(s)), show(StringBuf.pop(s)))
 * // → č b a None
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const pop = (self: StringBuf): Option.Option<string> => {
  const buffer = impl(self).buffer;
  if (buffer.len === 0) return Option.none();
  const bytes = buffer.bytes();
  const start = Utf8.floorCharBoundary(bytes, bytes.byteLength - 1);
  const char = Utf8.charAt(bytes, start);
  buffer.len = start;
  return Option.some(char);
};

/**
 * Removes and returns the character at byte offset `index`, like Rust's
 * `String::remove`. Returns `None` if `index` is not the start of a
 * character.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("abç"))
 * const show = (o: Option.Option<string>) => Option.getOrElse(o, () => "None")
 * console.log(show(StringBuf.remove(s, 0)), show(StringBuf.remove(s, 1)), show(StringBuf.remove(s, 0)))
 * // → a ç b
 *
 * // not the start of a character
 * const t = Effect.runSync(StringBuf.from("ç"))
 * console.log(show(StringBuf.remove(t, 1)), t.toString())
 * // → None ç
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const remove: {
  (index: number): (self: StringBuf) => Option.Option<string>;
  (self: StringBuf, index: number): Option.Option<string>;
} = dual(2, (self: StringBuf, index: number): Option.Option<string> => {
  const buffer = impl(self).buffer;
  const bytes = buffer.bytes();
  if (index >= bytes.byteLength || !Utf8.isCharBoundary(bytes, index)) return Option.none();
  const char = Utf8.charAt(bytes, index);
  // Removing never grows the buffer, so this cannot fail.
  buffer.splice(index, index + Utf8.widthOf(bytes[index]), new Uint8Array(0));
  return Option.some(char);
});

/**
 * Removes the byte range `[start, end)` (`end` defaults to the end of the
 * string) and returns it as a `Str`, like Rust's `String::drain`. Returns
 * `None`, leaving the string unchanged, if either offset is out of range or
 * not on a character boundary.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("α is alpha, β is beta"))
 * const betaOffset = Option.getOrElse(StringBuf.find(s, "β"), () => StringBuf.len(s))
 * const show = (o: Option.Option<{ toString(): string }>) => Option.match(o, { onNone: () => "None", onSome: (t) => t.toString() })
 *
 * // Remove the range up until the β from the string
 * const t = StringBuf.drain(s, 0, betaOffset)
 * console.log(JSON.stringify(show(t)), JSON.stringify(s.toString()))
 * // → "α is alpha, " "β is beta"
 *
 * // Not a character boundary: nothing is removed
 * console.log(show(StringBuf.drain(s, 1)), s.toString())
 * // → None β is beta
 *
 * // A full range clears the string, like `clear()` does
 * StringBuf.drain(s, 0)
 * console.log(JSON.stringify(s.toString()))
 * // → ""
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const drain: {
  (start: number, end?: number): (self: StringBuf) => Option.Option<Str.Str>;
  (self: StringBuf, start: number, end?: number): Option.Option<Str.Str>;
} = dual(
  (args) => isStringBuf(args[0]),
  (self: StringBuf, start: number, end?: number): Option.Option<Str.Str> => {
    const buffer = impl(self).buffer;
    const bytes = buffer.bytes();
    const stop = end ?? bytes.byteLength;
    if (!isRange(bytes, start, stop)) return Option.none();
    const drained = snapshot(bytes.subarray(start, stop));
    buffer.splice(start, stop, new Uint8Array(0));
    return Option.some(drained);
  },
);

/**
 * Keeps only the characters for which `predicate` returns `true`, like Rust's
 * `String::retain`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("f_ö_ob_ar_"))
 * StringBuf.retain(s, (c) => c !== "_")
 * console.log(s.toString())
 * // → föobar
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const retain: {
  (predicate: (char: string) => boolean): (self: StringBuf) => void;
  (self: StringBuf, predicate: (char: string) => boolean): void;
} = dual(2, (self: StringBuf, predicate: (char: string) => boolean): void => {
  const buffer = impl(self).buffer;
  const bytes = buffer.bytes();
  // Compact the kept characters towards the start; this never grows.
  const kept = Arr.fromIterable(Utf8.charIndices(() => bytes)).reduce((written, [index, char]) => {
    if (!predicate(char)) return written;
    const width = Utf8.widthOf(bytes[index]);
    bytes.copyWithin(written, index, index + width);
    return written + width;
  }, 0);
  buffer.len = kept;
});

/**
 * Shortens the string to `newLen` bytes, like Rust's `String::truncate`. Has
 * no effect if the string is already shorter. Returns `false` (leaving the
 * string unchanged) if `newLen` is not a character boundary.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("héllo"))
 * console.log(StringBuf.truncate(s, 3), s.toString())
 * // → true hé
 *
 * // byte 2 is inside `é`
 * console.log(StringBuf.truncate(s, 2), s.toString())
 * // → false hé
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const truncate: {
  (newLen: number): (self: StringBuf) => boolean;
  (self: StringBuf, newLen: number): boolean;
} = dual(2, (self: StringBuf, newLen: number): boolean => {
  const buffer = impl(self).buffer;
  if (newLen >= buffer.len) return true;
  if (!Utf8.isCharBoundary(buffer.bytes(), newLen)) return false;
  buffer.len = newLen;
  return true;
});

/**
 * Removes all contents, keeping the capacity, like Rust's `String::clear`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("föo"))
 * const capacity = StringBuf.capacity(s)
 * StringBuf.clear(s)
 * console.log(StringBuf.isEmpty(s), StringBuf.len(s), StringBuf.capacity(s) === capacity)
 * // → true 0 true
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const clear = (self: StringBuf): void => {
  impl(self).buffer.len = 0;
};

/**
 * Converts ASCII letters to upper case in place, like Rust's
 * `str::make_ascii_uppercase`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("Grüße, Jürgen ❤"))
 * StringBuf.makeAsciiUppercase(s)
 * console.log(s.toString())
 * // → GRüßE, JüRGEN ❤
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const makeAsciiUppercase = (self: StringBuf): void => {
  const bytes = impl(self).bytes();
  bytes.set(bytes.map(Utf8.toAsciiUppercaseByte));
};

/**
 * Converts ASCII letters to lower case in place, like Rust's
 * `str::make_ascii_lowercase`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf"
 *
 * const s = Effect.runSync(StringBuf.from("GRÜßE, JÜRGEN ❤"))
 * StringBuf.makeAsciiLowercase(s)
 * console.log(s.toString())
 * // → grÜße, jÜrgen ❤
 * ```
 *
 * @since 0.1.0
 * @category mutations
 */
export const makeAsciiLowercase = (self: StringBuf): void => {
  const bytes = impl(self).bytes();
  bytes.set(bytes.map(Utf8.toAsciiLowercaseByte));
};
