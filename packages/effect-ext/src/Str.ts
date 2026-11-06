/**
 * An immutable UTF-8 string slice backed by a `Uint8Array`, like Rust's `str`.
 *
 * A `Str` always holds valid UTF-8. As in Rust, indices are byte offsets and
 * lengths are in bytes; `chars` iterates the characters (Unicode scalar
 * values, each as a one-code-point JavaScript string). Slicing, trimming and
 * splitting are zero-copy: the results share memory with the original.
 *
 * Equality, hashing and ordering are defined on the bytes, so a `Str` can be
 * used as a key in Effect's `HashMap` and `HashSet`. Byte-wise ordering
 * coincides with ordering by code point.
 *
 * Operations that search take a {@link Pattern}, like Rust's string pattern
 * API: a string (or `Str`) to match literally, or a predicate on single
 * characters. An empty string pattern matches at every character boundary.
 *
 * For a growable, mutable string, see `String`.
 *
 * @example
 * ```ts
 * import { Equal, Option } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("  héllo wörld  ")
 * console.log(Str.len(s))
 * // → 17
 * const t = Str.trim(s)
 * console.log(Str.split(t, " ").map(String))
 * // → [ 'héllo', 'wörld' ]
 * console.log(Option.getOrUndefined(Str.find(t, (c) => c === "w")))
 * // → 7
 * console.log(Equal.equals(t, Str.fromString("héllo wörld")))
 * // → true
 * ```
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Eq from "effect/Equal";
import * as Equivalence_ from "effect/Equivalence";
import { dual } from "effect/Function";
import * as Hash from "effect/Hash";
import { NodeInspectSymbol } from "effect/Inspectable";
import * as Option from "effect/Option";
import type * as Order_ from "effect/Order";
import { pipeArguments, type Pipeable } from "effect/Pipeable";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Utf8 from "./internal/utf8.ts";

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId = "~effect-ext/Str" as const;

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId;

/**
 * @since 0.1.0
 * @category models
 */
export interface Str extends Eq.Equal, Pipeable, Iterable<string> {
  readonly [TypeId]: TypeId;
  /** Decodes the string into a JavaScript string. */
  toString(): string;
  toJSON(): { readonly _id: "Str"; readonly value: string };
}

/**
 * What to search for: a literal string, or a predicate on single characters.
 *
 * @since 0.1.0
 * @category models
 */
export type Pattern = Str | string | ((char: string) => boolean);

/**
 * Raised when bytes are not valid UTF-8, like Rust's `Utf8Error`.
 *
 * @example
 * ```ts
 * import { Result } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const result = Str.fromUtf8(new Uint8Array([0, 159, 146, 150]))
 * if (Result.isFailure(result)) console.log(result.failure._tag, result.failure.validUpTo)
 * // → Utf8Error 1
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class Utf8Error extends Schema.TaggedError<Utf8Error, { readonly brand: unique symbol }>()(
  "Utf8Error",
  {
    /** The length of the longest valid UTF-8 prefix. */
    validUpTo: Schema.Finite,
  },
) {
  override get message(): string {
    return `Invalid UTF-8 sequence at byte ${this.validUpTo}`;
  }
}

class StrImpl implements Str {
  readonly [TypeId] = TypeId;
  private hashCode: Option.Option<number> = Option.none();
  readonly bytes: Uint8Array;
  private decoded: Option.Option<string>;

  constructor(bytes: Uint8Array, decoded: Option.Option<string> = Option.none()) {
    this.bytes = bytes;
    this.decoded = decoded;
  }

  toString(): string {
    if (Option.isSome(this.decoded)) return this.decoded.value;
    const decoded = Utf8.decoder.decode(this.bytes);
    this.decoded = Option.some(decoded);
    return decoded;
  }

  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof StrImpl && Utf8.bytesEqual(this.bytes, that.bytes);
  }

  [Hash.symbol](): number {
    if (Option.isSome(this.hashCode)) return this.hashCode.value;
    const hash = hashBytes(this.bytes);
    this.hashCode = Option.some(hash);
    return hash;
  }

  [Symbol.iterator](): Iterator<string> {
    return this.toString()[Symbol.iterator]();
  }

  pipe() {
    return pipeArguments(this, arguments);
  }

  toJSON() {
    return { _id: "Str" as const, value: this.toString() };
  }

  [NodeInspectSymbol]() {
    return this.toJSON();
  }
}

// FNV-1a, 32-bit.
const hashBytes = (bytes: Uint8Array): number =>
  Hash.optimize(bytes.reduce((h, byte) => Math.imul(h ^ byte, 0x01000193), 0x811c9dc5));

const impl = (self: Str): StrImpl => {
  if (self instanceof StrImpl) return self;
  throw new TypeError("Str: expected a Str created by this module");
};

const bytesOf = (self: Str): Uint8Array => impl(self).bytes;

const sub = (self: Str, [start, end]: Utf8.Range): Str => {
  const bytes = bytesOf(self);
  return start === 0 && end === bytes.byteLength ? self : new StrImpl(bytes.subarray(start, end));
};

const toMatcher = (pattern: Pattern): Utf8.Matcher =>
  P.isString(pattern)
    ? Utf8.needle(Utf8.encoder.encode(pattern))
    : P.isFunction(pattern)
      ? Utf8.predicate(pattern)
      : Utf8.needle(bytesOf(pattern));

const toBytes = (s: Str | string): Uint8Array =>
  P.isString(s) ? Utf8.encoder.encode(s) : bytesOf(s);

/** Unwraps an index from a searcher result. */
const found = ([start]: Utf8.Range): Option.Option<number> =>
  start === -1 ? Option.none() : Option.some(start);

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.isStr(Str.fromString("ß")), Str.isStr("ß"))
 * // → true false
 * ```
 *
 * @since 0.1.0
 * @category guards
 */
export const isStr = (u: unknown): u is Str => P.hasProperty(u, TypeId);

/**
 * The empty string.
 *
 * @since 0.1.0
 * @category constructors
 */
export const empty: Str = new StrImpl(new Uint8Array(0), Option.some(""));

/**
 * Encodes a JavaScript string. Lone surrogates are replaced with U+FFFD.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("Grüße")
 * console.log(String(s), Str.len(s))
 * // → Grüße 7
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromString = (s: string): Str =>
  new StrImpl(Utf8.encoder.encode(s), s.isWellFormed() ? Option.some(s) : Option.none());

/**
 * Validates and copies bytes, like Rust's `str::from_utf8`.
 *
 * @example
 * ```ts
 * import { Result } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const sparkleHeart = Str.fromUtf8(new Uint8Array([240, 159, 146, 150]))
 * console.log(Result.isSuccess(sparkleHeart) ? String(sparkleHeart.success) : "invalid")
 * // → 💖
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromUtf8 = (bytes: Uint8Array): Result.Result<Str, Utf8Error> => {
  const validUpTo = Utf8.validUpTo(bytes);
  return validUpTo === bytes.byteLength
    ? Result.succeed(new StrImpl(bytes.slice()))
    : Result.fail(new Utf8Error({ validUpTo }));
};

/**
 * Decodes bytes, replacing invalid sequences with U+FFFD, like Rust's
 * `String::from_utf8_lossy`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const input = new Uint8Array([72, 101, 108, 108, 111, 32, 0xf0, 0x90, 0x80, 87, 111, 114, 108, 100])
 * console.log(String(Str.fromUtf8Lossy(input)))
 * // → Hello �World
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromUtf8Lossy = (bytes: Uint8Array): Str =>
  Utf8.validUpTo(bytes) === bytes.byteLength
    ? new StrImpl(bytes.slice())
    : fromString(Utf8.decoder.decode(bytes));

/**
 * Wraps bytes without validating or copying them, like Rust's
 * `str::from_utf8_unchecked`. The caller must guarantee that the bytes are
 * valid UTF-8 and are never mutated.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const sparkleHeart = Str.fromUtf8Unsafe(new Uint8Array([240, 159, 146, 150]))
 * console.log(String(sparkleHeart), Str.len(sparkleHeart))
 * // → 💖 4
 * ```
 *
 * @since 0.1.0
 * @category unsafe
 */
export const fromUtf8Unsafe = (bytes: Uint8Array): Str => new StrImpl(bytes);

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

/**
 * The length in bytes, like Rust's `str::len`. For the number of characters,
 * use {@link charCount}.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.len(Str.fromString("foo")), Str.len(Str.fromString("ƒoo")))
 * // → 3 4
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const len = (self: Str): number => bytesOf(self).byteLength;

/**
 * The number of characters (Unicode scalar values), like Rust's
 * `s.chars().count()`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("Löwe 老虎")
 * console.log(Str.charCount(s), Str.len(s))
 * // → 7 12
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const charCount = (self: Str): number => Utf8.countChars(bytesOf(self));

/**
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.isEmpty(Str.fromString("")), Str.isEmpty(Str.fromString("not empty")))
 * // → true false
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const isEmpty = (self: Str): boolean => bytesOf(self).byteLength === 0;

/**
 * Whether every character is ASCII.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.isAscii(Str.fromString("hello!\n")), Str.isAscii(Str.fromString("Grüße, Jürgen ❤")))
 * // → true false
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const isAscii = (self: Str): boolean => bytesOf(self).every((byte) => byte < 0x80);

/**
 * The UTF-8 bytes, like Rust's `str::as_bytes`. Must not be mutated: `Str`s
 * are immutable and slices share memory.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.asBytes(Str.fromString("bors")), Str.asBytes(Str.fromString("é")))
 * // → Uint8Array(4) [ 98, 111, 114, 115 ] Uint8Array(2) [ 195, 169 ]
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const asBytes = (self: Str): Uint8Array => bytesOf(self);

/**
 * Iterates over the bytes, like Rust's `str::bytes`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log([...Str.bytes(Str.fromString("bör"))])
 * // → [ 98, 195, 182, 114 ]
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const bytes = (self: Str): IterableIterator<number> => bytesOf(self).values();

/**
 * Iterates over the characters, like Rust's `str::chars`. Each character is a
 * JavaScript string holding one code point.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log([...Str.chars(Str.fromString("y̆es"))])
 * // → [ 'y', '̆', 'e', 's' ]
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const chars = (self: Str): IterableIterator<string> => {
  const b = bytesOf(self);
  return Utf8.chars(() => b);
};

/**
 * Iterates over `[byteIndex, char]` pairs, like Rust's `str::char_indices`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log([...Str.charIndices(Str.fromString("Löwe"))])
 * // → [ [ 0, 'L' ], [ 1, 'ö' ], [ 3, 'w' ], [ 4, 'e' ] ]
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const charIndices = (self: Str): IterableIterator<readonly [number, string]> => {
  const b = bytesOf(self);
  return Utf8.charIndices(() => b);
};

/**
 * Whether byte offset `index` is the start of a character (or the end of the
 * string), like Rust's `str::is_char_boundary`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("Löwe 老虎 Léopard")
 * console.log(Str.isCharBoundary(s, 0), Str.isCharBoundary(s, 6), Str.isCharBoundary(s, Str.len(s)))
 * // → true true true
 * console.log(Str.isCharBoundary(s, 2), Str.isCharBoundary(s, 8))
 * // → false false
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const isCharBoundary: {
  (index: number): (self: Str) => boolean;
  (self: Str, index: number): boolean;
} = dual(2, (self: Str, index: number): boolean => Utf8.isCharBoundary(bytesOf(self), index));

/**
 * The closest character boundary at or before `index`, like Rust's
 * `str::floor_char_boundary`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("❤️🧡💛💚💙💜")
 * console.log(Str.isCharBoundary(s, 13), Str.floorCharBoundary(s, 13))
 * // → false 10
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const floorCharBoundary: {
  (index: number): (self: Str) => number;
  (self: Str, index: number): number;
} = dual(2, (self: Str, index: number): number => Utf8.floorCharBoundary(bytesOf(self), index));

/**
 * The closest character boundary at or after `index`, like Rust's
 * `str::ceil_char_boundary`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("❤️🧡💛💚💙💜")
 * console.log(Str.isCharBoundary(s, 13), Str.ceilCharBoundary(s, 13))
 * // → false 14
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const ceilCharBoundary: {
  (index: number): (self: Str) => number;
  (self: Str, index: number): number;
} = dual(2, (self: Str, index: number): number => Utf8.ceilCharBoundary(bytesOf(self), index));

// ---------------------------------------------------------------------------
// Slicing
// ---------------------------------------------------------------------------

/**
 * The substring `[start, end)` (`end` defaults to the end of the string),
 * like Rust's `str::get(start..end)`. Returns `None` if either offset is out
 * of range or not on a character boundary. Shares memory with `self`.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const v = Str.fromString("🗻∈🌏")
 * console.log(Option.getOrUndefined(Str.get(v, 0, 4))?.toString())
 * // → 🗻
 * console.log(Option.isNone(Str.get(v, 1)), Option.isNone(Str.get(v, 0, 8)), Option.isNone(Str.get(v, 0, 42)))
 * // → true true true
 * ```
 *
 * @since 0.1.0
 * @category slicing
 */
export const get: {
  (start: number, end?: number): (self: Str) => Option.Option<Str>;
  (self: Str, start: number, end?: number): Option.Option<Str>;
} = dual(
  (args) => isStr(args[0]),
  (self: Str, start: number, end?: number): Option.Option<Str> => {
    const b = bytesOf(self);
    const stop = end ?? b.byteLength;
    return start <= stop && Utf8.isCharBoundary(b, start) && Utf8.isCharBoundary(b, stop)
      ? Option.some(sub(self, [start, stop]))
      : Option.none();
  },
);

/**
 * Like {@link get}, but throws a `RangeError` instead of returning `None`
 * (like indexing a Rust `str` with a range).
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("Löwe 老虎 Léopard")
 * console.log(String(Str.getUnsafe(s, 6, 12)), String(Str.getUnsafe(s, 13)))
 * // → 老虎 Léopard
 * ```
 *
 * @since 0.1.0
 * @category unsafe
 */
export const getUnsafe: {
  (start: number, end?: number): (self: Str) => Str;
  (self: Str, start: number, end?: number): Str;
} = dual(
  (args) => isStr(args[0]),
  (self: Str, start: number, end?: number): Str =>
    Option.getOrElse(get(self, start, end), () => {
      throw new RangeError(
        `Str: invalid range [${start}, ${end ?? len(self)}) of a ${len(self)}-byte string`,
      );
    }),
);

/**
 * Splits at byte offset `mid`, like Rust's `str::split_at_checked`. Returns
 * `None` if `mid` is out of range or not on a character boundary.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("Per Martin-Löf")
 * console.log(Option.getOrUndefined(Str.splitAt(s, 3))?.map(String))
 * // → [ 'Per', ' Martin-Löf' ]
 * console.log(Option.isNone(Str.splitAt(s, 13)), Option.isNone(Str.splitAt(s, 16)))
 * // → true true
 * ```
 *
 * @since 0.1.0
 * @category slicing
 */
export const splitAt: {
  (mid: number): (self: Str) => Option.Option<readonly [Str, Str]>;
  (self: Str, mid: number): Option.Option<readonly [Str, Str]>;
} = dual(2, (self: Str, mid: number): Option.Option<readonly [Str, Str]> =>
  Utf8.isCharBoundary(bytesOf(self), mid)
    ? Option.some([sub(self, [0, mid]), sub(self, [mid, len(self)])] as const)
    : Option.none(),
);

/**
 * Like {@link splitAt}, but throws a `RangeError` instead of returning `None`
 * (like Rust's `str::split_at`).
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const [first, last] = Str.splitAtUnsafe(Str.fromString("Per Martin-Löf"), 3)
 * console.log(String(first), String(last))
 * // → Per  Martin-Löf
 * ```
 *
 * @since 0.1.0
 * @category unsafe
 */
export const splitAtUnsafe: {
  (mid: number): (self: Str) => readonly [Str, Str];
  (self: Str, mid: number): readonly [Str, Str];
} = dual(2, (self: Str, mid: number): readonly [Str, Str] =>
  Option.getOrElse(splitAt(self, mid), () => {
    throw new RangeError(`Str: ${mid} is not a character boundary of a ${len(self)}-byte string`);
  }),
);

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/**
 * Whether the pattern matches anywhere, like Rust's `str::contains`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const bananas = Str.fromString("bañanas")
 * console.log(Str.contains(bananas, "ñana"), Str.contains(bananas, "apples"), Str.contains(bananas, (c) => c === "ñ"))
 * // → true false true
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const contains: {
  (pattern: Pattern): (self: Str) => boolean;
  (self: Str, pattern: Pattern): boolean;
} = dual(2, (self: Str, pattern: Pattern): boolean =>
  Option.isSome(found(toMatcher(pattern)(bytesOf(self)).next(0))),
);

/**
 * Whether the pattern matches a prefix, like Rust's `str::starts_with`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const bananas = Str.fromString("bañanas")
 * console.log(Str.startsWith(bananas, "bañ"), Str.startsWith(bananas, "nana"), Str.startsWith(bananas, ""))
 * // → true false true
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const startsWith: {
  (pattern: Pattern): (self: Str) => boolean;
  (self: Str, pattern: Pattern): boolean;
} = dual(2, (self: Str, pattern: Pattern): boolean =>
  Option.isSome(found(toMatcher(pattern)(bytesOf(self)).matchAt(0))),
);

/**
 * Whether the pattern matches a suffix, like Rust's `str::ends_with`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const bananas = Str.fromString("bañanas")
 * console.log(Str.endsWith(bananas, "anas"), Str.endsWith(bananas, "nana"))
 * // → true false
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const endsWith: {
  (pattern: Pattern): (self: Str) => boolean;
  (self: Str, pattern: Pattern): boolean;
} = dual(2, (self: Str, pattern: Pattern): boolean => {
  const b = bytesOf(self);
  return Option.isSome(found(toMatcher(pattern)(b).matchEndingAt(b.byteLength)));
});

/**
 * The byte offset of the first match, like Rust's `str::find`.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("Löwe 老虎 Léopard")
 * console.log(Option.getOrUndefined(Str.find(s, "L")), Option.getOrUndefined(Str.find(s, "é")), Option.getOrUndefined(Str.find(s, "pard")))
 * // → 0 14 17
 * console.log(Option.getOrUndefined(Str.find(s, (c) => c === "老")), Option.isNone(Str.find(s, "1")))
 * // → 6 true
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const find: {
  (pattern: Pattern): (self: Str) => Option.Option<number>;
  (self: Str, pattern: Pattern): Option.Option<number>;
} = dual(2, (self: Str, pattern: Pattern): Option.Option<number> =>
  found(toMatcher(pattern)(bytesOf(self)).next(0)),
);

/**
 * The byte offset of the last match, like Rust's `str::rfind`.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("Löwe 老虎 Léopard")
 * console.log(Option.getOrUndefined(Str.rfind(s, "L")), Option.getOrUndefined(Str.rfind(s, "é")), Option.getOrUndefined(Str.rfind(s, "pard")))
 * // → 13 14 17
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const rfind: {
  (pattern: Pattern): (self: Str) => Option.Option<number>;
  (self: Str, pattern: Pattern): Option.Option<number>;
} = dual(2, (self: Str, pattern: Pattern): Option.Option<number> => {
  const b = bytesOf(self);
  return found(toMatcher(pattern)(b).prev(b.byteLength));
});

/**
 * Every (non-overlapping) match, like Rust's `str::matches`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.matches(Str.fromString("abcXXXabcYYYabc"), "abc").map(String))
 * // → [ 'abc', 'abc', 'abc' ]
 * console.log(Str.matches(Str.fromString("1abc2abc3"), (c) => c >= "0" && c <= "9").map(String))
 * // → [ '1', '2', '3' ]
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const matches: {
  (pattern: Pattern): (self: Str) => Array<Str>;
  (self: Str, pattern: Pattern): Array<Str>;
} = dual(2, (self: Str, pattern: Pattern): Array<Str> =>
  Utf8.matchRanges(bytesOf(self), toMatcher(pattern)).map((range) => sub(self, range)),
);

/**
 * Every (non-overlapping) match with its byte offset, like Rust's
 * `str::match_indices`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const s = Str.fromString("ä,ö,ü")
 * console.log(Str.matchIndices(s, ",").map(([i, m]) => [i, String(m)]))
 * // → [ [ 2, ',' ], [ 5, ',' ] ]
 * ```
 *
 * @since 0.1.0
 * @category searching
 */
export const matchIndices: {
  (pattern: Pattern): (self: Str) => Array<readonly [number, Str]>;
  (self: Str, pattern: Pattern): Array<readonly [number, Str]>;
} = dual(2, (self: Str, pattern: Pattern): Array<readonly [number, Str]> =>
  Utf8.matchRanges(bytesOf(self), toMatcher(pattern)).map(
    (range) => [range[0], sub(self, range)] as const,
  ),
);

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/**
 * The substrings separated by the pattern, like Rust's `str::split`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.split(Str.fromString("a,b,,c"), ",").map(String))
 * // → [ 'a', 'b', '', 'c' ]
 * console.log(Str.split(Str.fromString("ñé"), "").map(String))
 * // → [ '', 'ñ', 'é', '' ]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const split: {
  (pattern: Pattern): (self: Str) => Array<Str>;
  (self: Str, pattern: Pattern): Array<Str>;
} = dual(2, (self: Str, pattern: Pattern): Array<Str> =>
  Utf8.splitRanges(bytesOf(self), toMatcher(pattern)).map((range) => sub(self, range)),
);

/**
 * Like {@link split}, but from the end of the string, like Rust's
 * `str::rsplit`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.rsplit(Str.fromString("Mary had a little lamb"), " ").map(String))
 * // → [ 'lamb', 'little', 'a', 'had', 'Mary' ]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const rsplit: {
  (pattern: Pattern): (self: Str) => Array<Str>;
  (self: Str, pattern: Pattern): Array<Str>;
} = dual(2, (self: Str, pattern: Pattern): Array<Str> =>
  Utf8.rsplitRanges(bytesOf(self), toMatcher(pattern)).map((range) => sub(self, range)),
);

/**
 * Like {@link split}, but returns at most `n` substrings; the last holds the
 * rest of the string. Like Rust's `str::splitn`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.splitn(Str.fromString("Mary had a little lambda"), 3, " ").map(String))
 * // → [ 'Mary', 'had', 'a little lambda' ]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitn: {
  (n: number, pattern: Pattern): (self: Str) => Array<Str>;
  (self: Str, n: number, pattern: Pattern): Array<Str>;
} = dual(3, (self: Str, n: number, pattern: Pattern): Array<Str> =>
  Utf8.splitRanges(bytesOf(self), toMatcher(pattern), n).map((range) => sub(self, range)),
);

/**
 * Like {@link splitn}, but from the end of the string, like Rust's
 * `str::rsplitn`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.rsplitn(Str.fromString("Mary had a little lamb"), 3, " ").map(String))
 * // → [ 'lamb', 'little', 'Mary had a' ]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const rsplitn: {
  (n: number, pattern: Pattern): (self: Str) => Array<Str>;
  (self: Str, n: number, pattern: Pattern): Array<Str>;
} = dual(3, (self: Str, n: number, pattern: Pattern): Array<Str> =>
  Utf8.rsplitRanges(bytesOf(self), toMatcher(pattern), n).map((range) => sub(self, range)),
);

/**
 * Like {@link split}, but a trailing empty substring is skipped, like Rust's
 * `str::split_terminator`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.splitTerminator(Str.fromString("A.B."), ".").map(String))
 * // → [ 'A', 'B' ]
 * console.log(Str.splitTerminator(Str.fromString("A..B.."), ".").map(String))
 * // → [ 'A', '', 'B', '' ]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitTerminator: {
  (pattern: Pattern): (self: Str) => Array<Str>;
  (self: Str, pattern: Pattern): Array<Str>;
} = dual(2, (self: Str, pattern: Pattern): Array<Str> => {
  const pieces = split(self, pattern);
  return Arr.isReadonlyArrayNonEmpty(pieces) && isEmpty(Arr.lastNonEmpty(pieces))
    ? pieces.slice(0, -1)
    : pieces;
});

/**
 * Like {@link split}, but each substring keeps the match that terminates it,
 * like Rust's `str::split_inclusive`. A trailing empty substring is skipped.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.splitInclusive(Str.fromString("Mary had\na little\nlamb"), "\n").map(String))
 * // → [ 'Mary had\n', 'a little\n', 'lamb' ]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitInclusive: {
  (pattern: Pattern): (self: Str) => Array<Str>;
  (self: Str, pattern: Pattern): Array<Str>;
} = dual(2, (self: Str, pattern: Pattern): Array<Str> => {
  const b = bytesOf(self);
  const ends = Utf8.matchRanges(b, toMatcher(pattern)).map(([, end]) => end);
  const starts = [0, ...ends];
  const pieces = ends.map((end, i): Utf8.Range => [starts[i], end]);
  const rest = starts[ends.length];
  if (rest < b.byteLength) pieces.push([rest, b.byteLength]);
  return pieces.map((range) => sub(self, range));
});

/**
 * Splits at the first match, like Rust's `str::split_once`.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const pair = Str.splitOnce(Str.fromString("cfg=foo=bar"), "=")
 * console.log(Option.getOrUndefined(pair)?.map(String))
 * // → [ 'cfg', 'foo=bar' ]
 * console.log(Option.isNone(Str.splitOnce(Str.fromString("cfg"), "=")))
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitOnce: {
  (pattern: Pattern): (self: Str) => Option.Option<readonly [Str, Str]>;
  (self: Str, pattern: Pattern): Option.Option<readonly [Str, Str]>;
} = dual(2, (self: Str, pattern: Pattern): Option.Option<readonly [Str, Str]> => {
  const b = bytesOf(self);
  const [start, end] = toMatcher(pattern)(b).next(0);
  return start === -1
    ? Option.none()
    : Option.some([sub(self, [0, start]), sub(self, [end, b.byteLength])] as const);
});

/**
 * Splits at the last match, like Rust's `str::rsplit_once`.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * const pair = Str.rsplitOnce(Str.fromString("cfg=foo=bar"), "=")
 * console.log(Option.getOrUndefined(pair)?.map(String))
 * // → [ 'cfg=foo', 'bar' ]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const rsplitOnce: {
  (pattern: Pattern): (self: Str) => Option.Option<readonly [Str, Str]>;
  (self: Str, pattern: Pattern): Option.Option<readonly [Str, Str]>;
} = dual(2, (self: Str, pattern: Pattern): Option.Option<readonly [Str, Str]> => {
  const b = bytesOf(self);
  const [start, end] = toMatcher(pattern)(b).prev(b.byteLength);
  return start === -1
    ? Option.none()
    : Option.some([sub(self, [0, start]), sub(self, [end, b.byteLength])] as const);
});

/**
 * The non-empty substrings separated by Unicode whitespace, like Rust's
 * `str::split_whitespace`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.splitWhitespace(Str.fromString(" Mary   had\ta\u2009little  \n\t lamb")).map(String))
 * // → [ 'Mary', 'had', 'a', 'little', 'lamb' ]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitWhitespace = (self: Str): Array<Str> =>
  Utf8.splitRanges(bytesOf(self), Utf8.whitespaceMatcher)
    .filter(([start, end]) => end > start)
    .map((range) => sub(self, range));

/**
 * The non-empty substrings separated by ASCII whitespace, like Rust's
 * `str::split_ascii_whitespace`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.splitAsciiWhitespace(Str.fromString(" Mary   had\ta little  \n\t lamb")).map(String))
 * // → [ 'Mary', 'had', 'a', 'little', 'lamb' ]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitAsciiWhitespace = (self: Str): Array<Str> =>
  Utf8.splitRanges(bytesOf(self), Utf8.asciiWhitespaceMatcher)
    .filter(([start, end]) => end > start)
    .map((range) => sub(self, range));

/**
 * The lines of a string, like Rust's `str::lines`. Lines end with `\n` or
 * `\r\n`, which are not included; the final line ending is optional.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.lines(Str.fromString("foo\r\nbar\n\nbaz\r")).map(String))
 * // → [ 'foo', 'bar', '', 'baz\r' ]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const lines = (self: Str): Array<Str> => {
  const b = bytesOf(self);
  const pieces = Utf8.splitRanges(b, Utf8.needle(new Uint8Array([0x0a])));
  const last = pieces.length - 1;
  return pieces
    .filter(([start, end], i) => i < last || end > start)
    .map(([start, end], i): Utf8.Range =>
      // Only lines that were terminated by "\n" lose a trailing "\r".
      i < last && end > start && b[end - 1] === 0x0d ? [start, end - 1] : [start, end],
    )
    .map((range) => sub(self, range));
};

// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------

/**
 * Removes leading and trailing Unicode whitespace, like Rust's `str::trim`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(JSON.stringify(String(Str.trim(Str.fromString("\n Hello\tworld\t\n")))))
 * // → "Hello\tworld"
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const trim = (self: Str): Str => trimMatches(self, Utf8.isWhitespace);

/**
 * Removes leading Unicode whitespace, like Rust's `str::trim_start`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(JSON.stringify(String(Str.trimStart(Str.fromString("\n Hello\tworld\t\n")))))
 * // → "Hello\tworld\t\n"
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimStart = (self: Str): Str => trimStartMatches(self, Utf8.isWhitespace);

/**
 * Removes trailing Unicode whitespace, like Rust's `str::trim_end`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(JSON.stringify(String(Str.trimEnd(Str.fromString("\n Hello\tworld\t\n")))))
 * // → "\n Hello\tworld"
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimEnd = (self: Str): Str => trimEndMatches(self, Utf8.isWhitespace);

/**
 * Removes leading and trailing ASCII whitespace, like Rust's `str::trim_ascii`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(JSON.stringify(String(Str.trimAscii(Str.fromString(" \t hello world\n")))))
 * // → "hello world"
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimAscii = (self: Str): Str => trimMatches(self, Utf8.isAsciiWhitespace);

/**
 * Removes leading ASCII whitespace, like Rust's `str::trim_ascii_start`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(JSON.stringify(String(Str.trimAsciiStart(Str.fromString(" \t hello world\n")))))
 * // → "hello world\n"
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimAsciiStart = (self: Str): Str => trimStartMatches(self, Utf8.isAsciiWhitespace);

/**
 * Removes trailing ASCII whitespace, like Rust's `str::trim_ascii_end`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(JSON.stringify(String(Str.trimAsciiEnd(Str.fromString("\r hello world\n ")))))
 * // → "\r hello world"
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimAsciiEnd = (self: Str): Str => trimEndMatches(self, Utf8.isAsciiWhitespace);

/**
 * Repeatedly removes matches of the pattern from both ends, like Rust's
 * `str::trim_matches`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.trimMatches(Str.fromString("11foo1bar11"), "1")))
 * // → foo1bar
 * console.log(String(Str.trimMatches(Str.fromString("123foo1bar123"), (c) => c >= "0" && c <= "9")))
 * // → foo1bar
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimMatches: {
  (pattern: Pattern): (self: Str) => Str;
  (self: Str, pattern: Pattern): Str;
} = dual(2, (self: Str, pattern: Pattern): Str => {
  const b = bytesOf(self);
  const matcher = toMatcher(pattern);
  const start = Utf8.trimStartOffset(b, matcher);
  return sub(self, [start, Utf8.trimEndOffset(b, matcher, start)]);
});

/**
 * Repeatedly removes matches of the pattern from the start, like Rust's
 * `str::trim_start_matches`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.trimStartMatches(Str.fromString("foofoobar"), "foo")))
 * // → bar
 * console.log(String(Str.trimStartMatches(Str.fromString("123foo1bar123"), (c) => c >= "0" && c <= "9")))
 * // → foo1bar123
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimStartMatches: {
  (pattern: Pattern): (self: Str) => Str;
  (self: Str, pattern: Pattern): Str;
} = dual(2, (self: Str, pattern: Pattern): Str => {
  const b = bytesOf(self);
  return sub(self, [Utf8.trimStartOffset(b, toMatcher(pattern)), b.byteLength]);
});

/**
 * Repeatedly removes matches of the pattern from the end, like Rust's
 * `str::trim_end_matches`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.trimEndMatches(Str.fromString("barfoofoo"), "foo")))
 * // → bar
 * console.log(String(Str.trimEndMatches(Str.fromString("123foo1bar123"), (c) => c >= "0" && c <= "9")))
 * // → 123foo1bar
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimEndMatches: {
  (pattern: Pattern): (self: Str) => Str;
  (self: Str, pattern: Pattern): Str;
} = dual(2, (self: Str, pattern: Pattern): Str =>
  sub(self, [0, Utf8.trimEndOffset(bytesOf(self), toMatcher(pattern))]),
);

/**
 * Removes one match of the pattern from the start, like Rust's
 * `str::strip_prefix`. Returns `None` if the string does not start with it.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Option.getOrUndefined(Str.stripPrefix(Str.fromString("foo:bar"), "foo:"))?.toString())
 * // → bar
 * console.log(Option.getOrUndefined(Str.stripPrefix(Str.fromString("foofoo"), "foo"))?.toString())
 * // → foo
 * console.log(Option.isNone(Str.stripPrefix(Str.fromString("foo:bar"), "bar")))
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const stripPrefix: {
  (pattern: Pattern): (self: Str) => Option.Option<Str>;
  (self: Str, pattern: Pattern): Option.Option<Str>;
} = dual(2, (self: Str, pattern: Pattern): Option.Option<Str> => {
  const b = bytesOf(self);
  const [start, end] = toMatcher(pattern)(b).matchAt(0);
  return start === -1 ? Option.none() : Option.some(sub(self, [end, b.byteLength]));
});

/**
 * Removes one match of the pattern from the end, like Rust's
 * `str::strip_suffix`. Returns `None` if the string does not end with it.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Option.getOrUndefined(Str.stripSuffix(Str.fromString("bar:foo"), ":foo"))?.toString())
 * // → bar
 * console.log(Option.getOrUndefined(Str.stripSuffix(Str.fromString("foofoo"), "foo"))?.toString())
 * // → foo
 * console.log(Option.isNone(Str.stripSuffix(Str.fromString("bar:foo"), "bar")))
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category trimming
 */
export const stripSuffix: {
  (pattern: Pattern): (self: Str) => Option.Option<Str>;
  (self: Str, pattern: Pattern): Option.Option<Str>;
} = dual(2, (self: Str, pattern: Pattern): Option.Option<Str> => {
  const b = bytesOf(self);
  const [start] = toMatcher(pattern)(b).matchEndingAt(b.byteLength);
  return start === -1 ? Option.none() : Option.some(sub(self, [0, start]));
});

// ---------------------------------------------------------------------------
// Transforming
// ---------------------------------------------------------------------------

/**
 * Replaces every match of the pattern, like Rust's `str::replace`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.replace(Str.fromString("this is old"), "old", "new")))
 * // → this is new
 * console.log(String(Str.replace(Str.fromString("this is old"), "cookie monster", "little lamb")))
 * // → this is old
 * ```
 *
 * @since 0.1.0
 * @category transforming
 */
export const replace: {
  (from: Pattern, to: Str | string): (self: Str) => Str;
  (self: Str, from: Pattern, to: Str | string): Str;
} = dual(
  3,
  (self: Str, from: Pattern, to: Str | string): Str =>
    new StrImpl(Utf8.replaceBytes(bytesOf(self), toMatcher(from), toBytes(to))),
);

/**
 * Replaces the first `count` matches of the pattern, like Rust's
 * `str::replacen`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.replacen(Str.fromString("foo foo 123 foo"), "foo", "new", 2)))
 * // → new new 123 foo
 * console.log(String(Str.replacen(Str.fromString("fffdtfgdfd"), "f", "1", 4)))
 * // → 111dt1gdfd
 * ```
 *
 * @since 0.1.0
 * @category transforming
 */
export const replacen: {
  (from: Pattern, to: Str | string, count: number): (self: Str) => Str;
  (self: Str, from: Pattern, to: Str | string, count: number): Str;
} = dual(
  4,
  (self: Str, from: Pattern, to: Str | string, count: number): Str =>
    new StrImpl(Utf8.replaceBytes(bytesOf(self), toMatcher(from), toBytes(to), count)),
);

/**
 * The string repeated `n` times, like Rust's `str::repeat`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.repeat(Str.fromString("abc"), 4)))
 * // → abcabcabcabc
 * ```
 *
 * @since 0.1.0
 * @category transforming
 */
export const repeat: {
  (n: number): (self: Str) => Str;
  (self: Str, n: number): Str;
} = dual(2, (self: Str, n: number): Str => {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Str: invalid repeat count ${n}`);
  const b = bytesOf(self);
  return new StrImpl(
    Utf8.joinBytes(
      Array.from({ length: n }, () => b),
      new Uint8Array(0),
    ),
  );
});

/**
 * Converts to upper case using Unicode's default case mapping, like Rust's
 * `str::to_uppercase`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.toUppercase(Str.fromString("hello"))), String(Str.toUppercase(Str.fromString("tschüß"))))
 * // → HELLO TSCHÜSS
 * ```
 *
 * @since 0.1.0
 * @category transforming
 */
export const toUppercase = (self: Str): Str => fromString(self.toString().toUpperCase());

/**
 * Converts to lower case using Unicode's default case mapping, like Rust's
 * `str::to_lowercase`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.toLowercase(Str.fromString("HELLO"))), String(Str.toLowercase(Str.fromString("ὈΔΥΣΣΕΎΣ"))))
 * // → hello ὀδυσσεύς
 * ```
 *
 * @since 0.1.0
 * @category transforming
 */
export const toLowercase = (self: Str): Str => fromString(self.toString().toLowerCase());

/**
 * Converts ASCII letters to upper case, leaving everything else unchanged,
 * like Rust's `str::to_ascii_uppercase`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.toAsciiUppercase(Str.fromString("Grüße, Jürgen ❤"))))
 * // → GRüßE, JüRGEN ❤
 * ```
 *
 * @since 0.1.0
 * @category transforming
 */
export const toAsciiUppercase = (self: Str): Str =>
  new StrImpl(bytesOf(self).map(Utf8.toAsciiUppercaseByte));

/**
 * Converts ASCII letters to lower case, leaving everything else unchanged,
 * like Rust's `str::to_ascii_lowercase`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.toAsciiLowercase(Str.fromString("Grüße, Jürgen ❤"))))
 * // → grüße, jürgen ❤
 * ```
 *
 * @since 0.1.0
 * @category transforming
 */
export const toAsciiLowercase = (self: Str): Str =>
  new StrImpl(bytesOf(self).map(Utf8.toAsciiLowercaseByte));

/**
 * Whether two strings are equal ignoring ASCII case, like Rust's
 * `str::eq_ignore_ascii_case`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(Str.eqIgnoreAsciiCase(Str.fromString("Ferris"), "FERRIS"))
 * // → true
 * console.log(Str.eqIgnoreAsciiCase(Str.fromString("Ferrös"), "FERRÖS"))
 * // → false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const eqIgnoreAsciiCase: {
  (that: Str | string): (self: Str) => boolean;
  (self: Str, that: Str | string): boolean;
} = dual(2, (self: Str, that: Str | string): boolean =>
  Utf8.eqIgnoreAsciiCase(bytesOf(self), toBytes(that)),
);

/**
 * Concatenates two strings (Rust's `+` on strings).
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.concat(Str.fromString("Grüße, "), "Jürgen")))
 * // → Grüße, Jürgen
 * ```
 *
 * @since 0.1.0
 * @category transforming
 */
export const concat: {
  (that: Str | string): (self: Str) => Str;
  (self: Str, that: Str | string): Str;
} = dual(2, (self: Str, that: Str | string): Str => {
  const other = toBytes(that);
  if (other.byteLength === 0) return self;
  return new StrImpl(Utf8.joinBytes([bytesOf(self), other], new Uint8Array(0)));
});

/**
 * Concatenates strings with `separator` between them, like Rust's
 * `[&str]::join`.
 *
 * @example
 * ```ts
 * import * as Str from "@thomasfosterau/effect-ext/Str"
 *
 * console.log(String(Str.join(["hello", Str.fromString("wörld")], " ")))
 * // → hello wörld
 * console.log(String(Str.join(["a", "b", "c"])))
 * // → abc
 * ```
 *
 * @since 0.1.0
 * @category transforming
 */
export const join = (strings: Iterable<Str | string>, separator: Str | string = empty): Str =>
  new StrImpl(Utf8.joinBytes(Arr.fromIterable(strings).map(toBytes), toBytes(separator)));

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

/**
 * Compares strings byte-wise, which is the same as comparing them by code
 * point (unlike JavaScript's `<`, which compares UTF-16 code units).
 *
 * @since 0.1.0
 * @category instances
 */
export const Order: Order_.Order<Str> = (self, that) =>
  Utf8.compareBytes(bytesOf(self), bytesOf(that));

/**
 * @since 0.1.0
 * @category instances
 */
export const Equivalence: Equivalence_.Equivalence<Str> = Equivalence_.make((self, that) =>
  Utf8.bytesEqual(bytesOf(self), bytesOf(that)),
);
