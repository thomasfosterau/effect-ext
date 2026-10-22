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
 * import * as Equal from "effect/Equal"
 * import * as Str from "effect-ext/Str"
 *
 * const s = Str.fromString("  héllo wörld  ")
 * Str.len(s) // 17 (bytes)
 * const t = Str.trim(s)
 * Str.split(t, " ").map((part) => part.toString()) // ["héllo", "wörld"]
 * Str.find(t, (c) => c === "w") // Option.some(7)
 * Equal.equals(t, Str.fromString("héllo wörld")) // true
 * ```
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import * as Eq from "effect/Equal"
import * as Equivalence_ from "effect/Equivalence"
import { dual } from "effect/Function"
import * as Hash from "effect/Hash"
import { NodeInspectSymbol } from "effect/Inspectable"
import * as Option from "effect/Option"
import type * as Order_ from "effect/Order"
import { pipeArguments, type Pipeable } from "effect/Pipeable"
import * as P from "effect/Predicate"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Utf8 from "./internal/utf8.ts"

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId = "~effect-ext/Str" as const

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 0.1.0
 * @category models
 */
export interface Str extends Eq.Equal, Pipeable, Iterable<string> {
  readonly [TypeId]: TypeId
  /** Decodes the string into a JavaScript string. */
  toString(): string
  toJSON(): { readonly _id: "Str"; readonly value: string }
}

/**
 * What to search for: a literal string, or a predicate on single characters.
 *
 * @since 0.1.0
 * @category models
 */
export type Pattern = Str | string | ((char: string) => boolean)

/**
 * Raised when bytes are not valid UTF-8, like Rust's `Utf8Error`.
 *
 * @since 0.1.0
 * @category errors
 */
export class Utf8Error extends Schema.TaggedError<Utf8Error>()("Utf8Error", {
  /** The length of the longest valid UTF-8 prefix. */
  validUpTo: Schema.Number,
}) {
  override get message(): string {
    return `Invalid UTF-8 sequence at byte ${this.validUpTo}`
  }
}

class StrImpl implements Str {
  readonly [TypeId] = TypeId
  private hashCode: Option.Option<number> = Option.none()

  constructor(
    readonly bytes: Uint8Array,
    private decoded: Option.Option<string> = Option.none(),
  ) {}

  toString(): string {
    if (Option.isSome(this.decoded)) return this.decoded.value
    const decoded = Utf8.decoder.decode(this.bytes)
    this.decoded = Option.some(decoded)
    return decoded
  }

  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof StrImpl && Utf8.bytesEqual(this.bytes, that.bytes)
  }

  [Hash.symbol](): number {
    if (Option.isSome(this.hashCode)) return this.hashCode.value
    const hash = hashBytes(this.bytes)
    this.hashCode = Option.some(hash)
    return hash
  }

  [Symbol.iterator](): Iterator<string> {
    return this.toString()[Symbol.iterator]()
  }

  pipe() {
    return pipeArguments(this, arguments)
  }

  toJSON() {
    return { _id: "Str" as const, value: this.toString() }
  }

  [NodeInspectSymbol]() {
    return this.toJSON()
  }
}

// FNV-1a, 32-bit.
const hashBytes = (bytes: Uint8Array): number =>
  Hash.optimize(bytes.reduce((h, byte) => Math.imul(h ^ byte, 0x01000193), 0x811c9dc5))

const impl = (self: Str): StrImpl => {
  if (self instanceof StrImpl) return self
  throw new TypeError("Str: expected a Str created by this module")
}

const bytesOf = (self: Str): Uint8Array => impl(self).bytes

const sub = (self: Str, [start, end]: Utf8.Range): Str => {
  const bytes = bytesOf(self)
  return start === 0 && end === bytes.byteLength ? self : new StrImpl(bytes.subarray(start, end))
}

const toMatcher = (pattern: Pattern): Utf8.Matcher =>
  P.isString(pattern)
    ? Utf8.needle(Utf8.encoder.encode(pattern))
    : P.isFunction(pattern)
      ? Utf8.predicate(pattern)
      : Utf8.needle(bytesOf(pattern))

const toBytes = (s: Str | string): Uint8Array =>
  P.isString(s) ? Utf8.encoder.encode(s) : bytesOf(s)

/** Unwraps an index from a searcher result. */
const found = ([start]: Utf8.Range): Option.Option<number> =>
  start === -1 ? Option.none() : Option.some(start)

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * @since 0.1.0
 * @category guards
 */
export const isStr = (u: unknown): u is Str => P.hasProperty(u, TypeId)

/**
 * The empty string.
 *
 * @since 0.1.0
 * @category constructors
 */
export const empty: Str = new StrImpl(new Uint8Array(0), Option.some(""))

/**
 * Encodes a JavaScript string. Lone surrogates are replaced with U+FFFD.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromString = (s: string): Str =>
  new StrImpl(Utf8.encoder.encode(s), s.isWellFormed() ? Option.some(s) : Option.none())

/**
 * Validates and copies bytes, like Rust's `str::from_utf8`.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromUtf8 = (bytes: Uint8Array): Result.Result<Str, Utf8Error> => {
  const validUpTo = Utf8.validUpTo(bytes)
  return validUpTo === bytes.byteLength
    ? Result.succeed(new StrImpl(bytes.slice()))
    : Result.fail(new Utf8Error({ validUpTo }))
}

/**
 * Decodes bytes, replacing invalid sequences with U+FFFD, like Rust's
 * `String::from_utf8_lossy`.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromUtf8Lossy = (bytes: Uint8Array): Str =>
  Utf8.validUpTo(bytes) === bytes.byteLength
    ? new StrImpl(bytes.slice())
    : fromString(Utf8.decoder.decode(bytes))

/**
 * Wraps bytes without validating or copying them, like Rust's
 * `str::from_utf8_unchecked`. The caller must guarantee that the bytes are
 * valid UTF-8 and are never mutated.
 *
 * @since 0.1.0
 * @category unsafe
 */
export const fromUtf8Unsafe = (bytes: Uint8Array): Str => new StrImpl(bytes)

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

/**
 * The length in bytes, like Rust's `str::len`. For the number of characters,
 * use {@link charCount}.
 *
 * @since 0.1.0
 * @category getters
 */
export const len = (self: Str): number => bytesOf(self).byteLength

/**
 * The number of characters (Unicode scalar values), like Rust's
 * `s.chars().count()`.
 *
 * @since 0.1.0
 * @category getters
 */
export const charCount = (self: Str): number => Utf8.countChars(bytesOf(self))

/**
 * @since 0.1.0
 * @category getters
 */
export const isEmpty = (self: Str): boolean => bytesOf(self).byteLength === 0

/**
 * Whether every character is ASCII.
 *
 * @since 0.1.0
 * @category getters
 */
export const isAscii = (self: Str): boolean => bytesOf(self).every((byte) => byte < 0x80)

/**
 * The UTF-8 bytes, like Rust's `str::as_bytes`. Must not be mutated: `Str`s
 * are immutable and slices share memory.
 *
 * @since 0.1.0
 * @category getters
 */
export const asBytes = (self: Str): Uint8Array => bytesOf(self)

/**
 * Iterates over the bytes, like Rust's `str::bytes`.
 *
 * @since 0.1.0
 * @category getters
 */
export const bytes = (self: Str): IterableIterator<number> => bytesOf(self).values()

/**
 * Iterates over the characters, like Rust's `str::chars`. Each character is a
 * JavaScript string holding one code point.
 *
 * @since 0.1.0
 * @category getters
 */
export const chars = (self: Str): IterableIterator<string> => {
  const b = bytesOf(self)
  return Utf8.chars(() => b)
}

/**
 * Iterates over `[byteIndex, char]` pairs, like Rust's `str::char_indices`.
 *
 * @since 0.1.0
 * @category getters
 */
export const charIndices = (self: Str): IterableIterator<readonly [number, string]> => {
  const b = bytesOf(self)
  return Utf8.charIndices(() => b)
}

/**
 * Whether byte offset `index` is the start of a character (or the end of the
 * string), like Rust's `str::is_char_boundary`.
 *
 * @since 0.1.0
 * @category getters
 */
export const isCharBoundary: {
  (index: number): (self: Str) => boolean
  (self: Str, index: number): boolean
} = dual(2, (self: Str, index: number): boolean => Utf8.isCharBoundary(bytesOf(self), index))

/**
 * The closest character boundary at or before `index`, like Rust's
 * `str::floor_char_boundary`.
 *
 * @since 0.1.0
 * @category getters
 */
export const floorCharBoundary: {
  (index: number): (self: Str) => number
  (self: Str, index: number): number
} = dual(2, (self: Str, index: number): number => Utf8.floorCharBoundary(bytesOf(self), index))

/**
 * The closest character boundary at or after `index`, like Rust's
 * `str::ceil_char_boundary`.
 *
 * @since 0.1.0
 * @category getters
 */
export const ceilCharBoundary: {
  (index: number): (self: Str) => number
  (self: Str, index: number): number
} = dual(2, (self: Str, index: number): number => Utf8.ceilCharBoundary(bytesOf(self), index))

// ---------------------------------------------------------------------------
// Slicing
// ---------------------------------------------------------------------------

/**
 * The substring `[start, end)` (`end` defaults to the end of the string),
 * like Rust's `str::get(start..end)`. Returns `None` if either offset is out
 * of range or not on a character boundary. Shares memory with `self`.
 *
 * @since 0.1.0
 * @category slicing
 */
export const get: {
  (start: number, end?: number): (self: Str) => Option.Option<Str>
  (self: Str, start: number, end?: number): Option.Option<Str>
} = dual(
  (args) => isStr(args[0]),
  (self: Str, start: number, end?: number): Option.Option<Str> => {
    const b = bytesOf(self)
    const stop = end ?? b.byteLength
    return start <= stop && Utf8.isCharBoundary(b, start) && Utf8.isCharBoundary(b, stop)
      ? Option.some(sub(self, [start, stop]))
      : Option.none()
  },
)

/**
 * Like {@link get}, but throws a `RangeError` instead of returning `None`
 * (like indexing a Rust `str` with a range).
 *
 * @since 0.1.0
 * @category unsafe
 */
export const getUnsafe: {
  (start: number, end?: number): (self: Str) => Str
  (self: Str, start: number, end?: number): Str
} = dual(
  (args) => isStr(args[0]),
  (self: Str, start: number, end?: number): Str =>
    Option.getOrElse(get(self, start, end), () => {
      throw new RangeError(
        `Str: invalid range [${start}, ${end ?? len(self)}) of a ${len(self)}-byte string`,
      )
    }),
)

/**
 * Splits at byte offset `mid`, like Rust's `str::split_at_checked`. Returns
 * `None` if `mid` is out of range or not on a character boundary.
 *
 * @since 0.1.0
 * @category slicing
 */
export const splitAt: {
  (mid: number): (self: Str) => Option.Option<readonly [Str, Str]>
  (self: Str, mid: number): Option.Option<readonly [Str, Str]>
} = dual(2, (self: Str, mid: number): Option.Option<readonly [Str, Str]> =>
  Utf8.isCharBoundary(bytesOf(self), mid)
    ? Option.some([sub(self, [0, mid]), sub(self, [mid, len(self)])] as const)
    : Option.none(),
)

/**
 * Like {@link splitAt}, but throws a `RangeError` instead of returning `None`
 * (like Rust's `str::split_at`).
 *
 * @since 0.1.0
 * @category unsafe
 */
export const splitAtUnsafe: {
  (mid: number): (self: Str) => readonly [Str, Str]
  (self: Str, mid: number): readonly [Str, Str]
} = dual(2, (self: Str, mid: number): readonly [Str, Str] =>
  Option.getOrElse(splitAt(self, mid), () => {
    throw new RangeError(`Str: ${mid} is not a character boundary of a ${len(self)}-byte string`)
  }),
)

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/**
 * Whether the pattern matches anywhere, like Rust's `str::contains`.
 *
 * @since 0.1.0
 * @category searching
 */
export const contains: {
  (pattern: Pattern): (self: Str) => boolean
  (self: Str, pattern: Pattern): boolean
} = dual(2, (self: Str, pattern: Pattern): boolean =>
  Option.isSome(found(toMatcher(pattern)(bytesOf(self)).next(0))),
)

/**
 * Whether the pattern matches a prefix, like Rust's `str::starts_with`.
 *
 * @since 0.1.0
 * @category searching
 */
export const startsWith: {
  (pattern: Pattern): (self: Str) => boolean
  (self: Str, pattern: Pattern): boolean
} = dual(2, (self: Str, pattern: Pattern): boolean =>
  Option.isSome(found(toMatcher(pattern)(bytesOf(self)).matchAt(0))),
)

/**
 * Whether the pattern matches a suffix, like Rust's `str::ends_with`.
 *
 * @since 0.1.0
 * @category searching
 */
export const endsWith: {
  (pattern: Pattern): (self: Str) => boolean
  (self: Str, pattern: Pattern): boolean
} = dual(2, (self: Str, pattern: Pattern): boolean => {
  const b = bytesOf(self)
  return Option.isSome(found(toMatcher(pattern)(b).matchEndingAt(b.byteLength)))
})

/**
 * The byte offset of the first match, like Rust's `str::find`.
 *
 * @since 0.1.0
 * @category searching
 */
export const find: {
  (pattern: Pattern): (self: Str) => Option.Option<number>
  (self: Str, pattern: Pattern): Option.Option<number>
} = dual(2, (self: Str, pattern: Pattern): Option.Option<number> =>
  found(toMatcher(pattern)(bytesOf(self)).next(0)),
)

/**
 * The byte offset of the last match, like Rust's `str::rfind`.
 *
 * @since 0.1.0
 * @category searching
 */
export const rfind: {
  (pattern: Pattern): (self: Str) => Option.Option<number>
  (self: Str, pattern: Pattern): Option.Option<number>
} = dual(2, (self: Str, pattern: Pattern): Option.Option<number> => {
  const b = bytesOf(self)
  return found(toMatcher(pattern)(b).prev(b.byteLength))
})

/**
 * Every (non-overlapping) match, like Rust's `str::matches`.
 *
 * @since 0.1.0
 * @category searching
 */
export const matches: {
  (pattern: Pattern): (self: Str) => Array<Str>
  (self: Str, pattern: Pattern): Array<Str>
} = dual(2, (self: Str, pattern: Pattern): Array<Str> =>
  Utf8.matchRanges(bytesOf(self), toMatcher(pattern)).map((range) => sub(self, range)),
)

/**
 * Every (non-overlapping) match with its byte offset, like Rust's
 * `str::match_indices`.
 *
 * @since 0.1.0
 * @category searching
 */
export const matchIndices: {
  (pattern: Pattern): (self: Str) => Array<readonly [number, Str]>
  (self: Str, pattern: Pattern): Array<readonly [number, Str]>
} = dual(2, (self: Str, pattern: Pattern): Array<readonly [number, Str]> =>
  Utf8.matchRanges(bytesOf(self), toMatcher(pattern)).map(
    (range) => [range[0], sub(self, range)] as const,
  ),
)

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/**
 * The substrings separated by the pattern, like Rust's `str::split`.
 *
 * @example
 * ```ts
 * import * as Str from "effect-ext/Str"
 *
 * Str.split(Str.fromString("a,b,,c"), ",") // ["a", "b", "", "c"]
 * Str.split(Str.fromString("abc"), "") // ["", "a", "b", "c", ""]
 * ```
 *
 * @since 0.1.0
 * @category splitting
 */
export const split: {
  (pattern: Pattern): (self: Str) => Array<Str>
  (self: Str, pattern: Pattern): Array<Str>
} = dual(2, (self: Str, pattern: Pattern): Array<Str> =>
  Utf8.splitRanges(bytesOf(self), toMatcher(pattern)).map((range) => sub(self, range)),
)

/**
 * Like {@link split}, but from the end of the string, like Rust's
 * `str::rsplit`.
 *
 * @since 0.1.0
 * @category splitting
 */
export const rsplit: {
  (pattern: Pattern): (self: Str) => Array<Str>
  (self: Str, pattern: Pattern): Array<Str>
} = dual(2, (self: Str, pattern: Pattern): Array<Str> =>
  Utf8.rsplitRanges(bytesOf(self), toMatcher(pattern)).map((range) => sub(self, range)),
)

/**
 * Like {@link split}, but returns at most `n` substrings; the last holds the
 * rest of the string. Like Rust's `str::splitn`.
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitn: {
  (n: number, pattern: Pattern): (self: Str) => Array<Str>
  (self: Str, n: number, pattern: Pattern): Array<Str>
} = dual(3, (self: Str, n: number, pattern: Pattern): Array<Str> =>
  Utf8.splitRanges(bytesOf(self), toMatcher(pattern), n).map((range) => sub(self, range)),
)

/**
 * Like {@link splitn}, but from the end of the string, like Rust's
 * `str::rsplitn`.
 *
 * @since 0.1.0
 * @category splitting
 */
export const rsplitn: {
  (n: number, pattern: Pattern): (self: Str) => Array<Str>
  (self: Str, n: number, pattern: Pattern): Array<Str>
} = dual(3, (self: Str, n: number, pattern: Pattern): Array<Str> =>
  Utf8.rsplitRanges(bytesOf(self), toMatcher(pattern), n).map((range) => sub(self, range)),
)

/**
 * Like {@link split}, but a trailing empty substring is skipped, like Rust's
 * `str::split_terminator`.
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitTerminator: {
  (pattern: Pattern): (self: Str) => Array<Str>
  (self: Str, pattern: Pattern): Array<Str>
} = dual(2, (self: Str, pattern: Pattern): Array<Str> => {
  const pieces = split(self, pattern)
  return Arr.isReadonlyArrayNonEmpty(pieces) && isEmpty(Arr.lastNonEmpty(pieces))
    ? pieces.slice(0, -1)
    : pieces
})

/**
 * Like {@link split}, but each substring keeps the match that terminates it,
 * like Rust's `str::split_inclusive`. A trailing empty substring is skipped.
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitInclusive: {
  (pattern: Pattern): (self: Str) => Array<Str>
  (self: Str, pattern: Pattern): Array<Str>
} = dual(2, (self: Str, pattern: Pattern): Array<Str> => {
  const b = bytesOf(self)
  const ends = Utf8.matchRanges(b, toMatcher(pattern)).map(([, end]) => end)
  const starts = [0, ...ends]
  const pieces = ends.map((end, i): Utf8.Range => [starts[i], end])
  const rest = starts[ends.length]
  if (rest < b.byteLength) pieces.push([rest, b.byteLength])
  return pieces.map((range) => sub(self, range))
})

/**
 * Splits at the first match, like Rust's `str::split_once`.
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitOnce: {
  (pattern: Pattern): (self: Str) => Option.Option<readonly [Str, Str]>
  (self: Str, pattern: Pattern): Option.Option<readonly [Str, Str]>
} = dual(2, (self: Str, pattern: Pattern): Option.Option<readonly [Str, Str]> => {
  const b = bytesOf(self)
  const [start, end] = toMatcher(pattern)(b).next(0)
  return start === -1
    ? Option.none()
    : Option.some([sub(self, [0, start]), sub(self, [end, b.byteLength])] as const)
})

/**
 * Splits at the last match, like Rust's `str::rsplit_once`.
 *
 * @since 0.1.0
 * @category splitting
 */
export const rsplitOnce: {
  (pattern: Pattern): (self: Str) => Option.Option<readonly [Str, Str]>
  (self: Str, pattern: Pattern): Option.Option<readonly [Str, Str]>
} = dual(2, (self: Str, pattern: Pattern): Option.Option<readonly [Str, Str]> => {
  const b = bytesOf(self)
  const [start, end] = toMatcher(pattern)(b).prev(b.byteLength)
  return start === -1
    ? Option.none()
    : Option.some([sub(self, [0, start]), sub(self, [end, b.byteLength])] as const)
})

/**
 * The non-empty substrings separated by Unicode whitespace, like Rust's
 * `str::split_whitespace`.
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitWhitespace = (self: Str): Array<Str> =>
  Utf8.splitRanges(bytesOf(self), Utf8.whitespaceMatcher)
    .filter(([start, end]) => end > start)
    .map((range) => sub(self, range))

/**
 * The non-empty substrings separated by ASCII whitespace, like Rust's
 * `str::split_ascii_whitespace`.
 *
 * @since 0.1.0
 * @category splitting
 */
export const splitAsciiWhitespace = (self: Str): Array<Str> =>
  Utf8.splitRanges(bytesOf(self), Utf8.asciiWhitespaceMatcher)
    .filter(([start, end]) => end > start)
    .map((range) => sub(self, range))

/**
 * The lines of a string, like Rust's `str::lines`. Lines end with `\n` or
 * `\r\n`, which are not included; the final line ending is optional.
 *
 * @since 0.1.0
 * @category splitting
 */
export const lines = (self: Str): Array<Str> => {
  const b = bytesOf(self)
  const pieces = Utf8.splitRanges(b, Utf8.needle(new Uint8Array([0x0a])))
  const last = pieces.length - 1
  return pieces
    .filter(([start, end], i) => i < last || end > start)
    .map(([start, end], i): Utf8.Range =>
      // Only lines that were terminated by "\n" lose a trailing "\r".
      i < last && end > start && b[end - 1] === 0x0d ? [start, end - 1] : [start, end],
    )
    .map((range) => sub(self, range))
}

// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------

/**
 * Removes leading and trailing Unicode whitespace, like Rust's `str::trim`.
 *
 * @since 0.1.0
 * @category trimming
 */
export const trim = (self: Str): Str => trimMatches(self, Utf8.isWhitespace)

/**
 * Removes leading Unicode whitespace, like Rust's `str::trim_start`.
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimStart = (self: Str): Str => trimStartMatches(self, Utf8.isWhitespace)

/**
 * Removes trailing Unicode whitespace, like Rust's `str::trim_end`.
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimEnd = (self: Str): Str => trimEndMatches(self, Utf8.isWhitespace)

/**
 * Removes leading and trailing ASCII whitespace, like Rust's `str::trim_ascii`.
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimAscii = (self: Str): Str => trimMatches(self, Utf8.isAsciiWhitespace)

/**
 * Removes leading ASCII whitespace, like Rust's `str::trim_ascii_start`.
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimAsciiStart = (self: Str): Str => trimStartMatches(self, Utf8.isAsciiWhitespace)

/**
 * Removes trailing ASCII whitespace, like Rust's `str::trim_ascii_end`.
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimAsciiEnd = (self: Str): Str => trimEndMatches(self, Utf8.isAsciiWhitespace)

/**
 * Repeatedly removes matches of the pattern from both ends, like Rust's
 * `str::trim_matches`.
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimMatches: {
  (pattern: Pattern): (self: Str) => Str
  (self: Str, pattern: Pattern): Str
} = dual(2, (self: Str, pattern: Pattern): Str => {
  const b = bytesOf(self)
  const matcher = toMatcher(pattern)
  const start = Utf8.trimStartOffset(b, matcher)
  return sub(self, [start, Utf8.trimEndOffset(b, matcher, start)])
})

/**
 * Repeatedly removes matches of the pattern from the start, like Rust's
 * `str::trim_start_matches`.
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimStartMatches: {
  (pattern: Pattern): (self: Str) => Str
  (self: Str, pattern: Pattern): Str
} = dual(2, (self: Str, pattern: Pattern): Str => {
  const b = bytesOf(self)
  return sub(self, [Utf8.trimStartOffset(b, toMatcher(pattern)), b.byteLength])
})

/**
 * Repeatedly removes matches of the pattern from the end, like Rust's
 * `str::trim_end_matches`.
 *
 * @since 0.1.0
 * @category trimming
 */
export const trimEndMatches: {
  (pattern: Pattern): (self: Str) => Str
  (self: Str, pattern: Pattern): Str
} = dual(2, (self: Str, pattern: Pattern): Str =>
  sub(self, [0, Utf8.trimEndOffset(bytesOf(self), toMatcher(pattern))]),
)

/**
 * Removes one match of the pattern from the start, like Rust's
 * `str::strip_prefix`. Returns `None` if the string does not start with it.
 *
 * @since 0.1.0
 * @category trimming
 */
export const stripPrefix: {
  (pattern: Pattern): (self: Str) => Option.Option<Str>
  (self: Str, pattern: Pattern): Option.Option<Str>
} = dual(2, (self: Str, pattern: Pattern): Option.Option<Str> => {
  const b = bytesOf(self)
  const [start, end] = toMatcher(pattern)(b).matchAt(0)
  return start === -1 ? Option.none() : Option.some(sub(self, [end, b.byteLength]))
})

/**
 * Removes one match of the pattern from the end, like Rust's
 * `str::strip_suffix`. Returns `None` if the string does not end with it.
 *
 * @since 0.1.0
 * @category trimming
 */
export const stripSuffix: {
  (pattern: Pattern): (self: Str) => Option.Option<Str>
  (self: Str, pattern: Pattern): Option.Option<Str>
} = dual(2, (self: Str, pattern: Pattern): Option.Option<Str> => {
  const b = bytesOf(self)
  const [start] = toMatcher(pattern)(b).matchEndingAt(b.byteLength)
  return start === -1 ? Option.none() : Option.some(sub(self, [0, start]))
})

// ---------------------------------------------------------------------------
// Transforming
// ---------------------------------------------------------------------------

/**
 * Replaces every match of the pattern, like Rust's `str::replace`.
 *
 * @since 0.1.0
 * @category transforming
 */
export const replace: {
  (from: Pattern, to: Str | string): (self: Str) => Str
  (self: Str, from: Pattern, to: Str | string): Str
} = dual(
  3,
  (self: Str, from: Pattern, to: Str | string): Str =>
    new StrImpl(Utf8.replaceBytes(bytesOf(self), toMatcher(from), toBytes(to))),
)

/**
 * Replaces the first `count` matches of the pattern, like Rust's
 * `str::replacen`.
 *
 * @since 0.1.0
 * @category transforming
 */
export const replacen: {
  (from: Pattern, to: Str | string, count: number): (self: Str) => Str
  (self: Str, from: Pattern, to: Str | string, count: number): Str
} = dual(
  4,
  (self: Str, from: Pattern, to: Str | string, count: number): Str =>
    new StrImpl(Utf8.replaceBytes(bytesOf(self), toMatcher(from), toBytes(to), count)),
)

/**
 * The string repeated `n` times, like Rust's `str::repeat`.
 *
 * @since 0.1.0
 * @category transforming
 */
export const repeat: {
  (n: number): (self: Str) => Str
  (self: Str, n: number): Str
} = dual(2, (self: Str, n: number): Str => {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Str: invalid repeat count ${n}`)
  const b = bytesOf(self)
  return new StrImpl(
    Utf8.joinBytes(
      Array.from({ length: n }, () => b),
      new Uint8Array(0),
    ),
  )
})

/**
 * Converts to upper case using Unicode's default case mapping, like Rust's
 * `str::to_uppercase`.
 *
 * @since 0.1.0
 * @category transforming
 */
export const toUppercase = (self: Str): Str => fromString(self.toString().toUpperCase())

/**
 * Converts to lower case using Unicode's default case mapping, like Rust's
 * `str::to_lowercase`.
 *
 * @since 0.1.0
 * @category transforming
 */
export const toLowercase = (self: Str): Str => fromString(self.toString().toLowerCase())

/**
 * Converts ASCII letters to upper case, leaving everything else unchanged,
 * like Rust's `str::to_ascii_uppercase`.
 *
 * @since 0.1.0
 * @category transforming
 */
export const toAsciiUppercase = (self: Str): Str =>
  new StrImpl(bytesOf(self).map(Utf8.toAsciiUppercaseByte))

/**
 * Converts ASCII letters to lower case, leaving everything else unchanged,
 * like Rust's `str::to_ascii_lowercase`.
 *
 * @since 0.1.0
 * @category transforming
 */
export const toAsciiLowercase = (self: Str): Str =>
  new StrImpl(bytesOf(self).map(Utf8.toAsciiLowercaseByte))

/**
 * Whether two strings are equal ignoring ASCII case, like Rust's
 * `str::eq_ignore_ascii_case`.
 *
 * @since 0.1.0
 * @category predicates
 */
export const eqIgnoreAsciiCase: {
  (that: Str | string): (self: Str) => boolean
  (self: Str, that: Str | string): boolean
} = dual(2, (self: Str, that: Str | string): boolean =>
  Utf8.eqIgnoreAsciiCase(bytesOf(self), toBytes(that)),
)

/**
 * Concatenates two strings (Rust's `+` on strings).
 *
 * @since 0.1.0
 * @category transforming
 */
export const concat: {
  (that: Str | string): (self: Str) => Str
  (self: Str, that: Str | string): Str
} = dual(2, (self: Str, that: Str | string): Str => {
  const other = toBytes(that)
  if (other.byteLength === 0) return self
  return new StrImpl(Utf8.joinBytes([bytesOf(self), other], new Uint8Array(0)))
})

/**
 * Concatenates strings with `separator` between them, like Rust's
 * `[&str]::join`.
 *
 * @since 0.1.0
 * @category transforming
 */
export const join = (strings: Iterable<Str | string>, separator: Str | string = empty): Str =>
  new StrImpl(Utf8.joinBytes(Arr.fromIterable(strings).map(toBytes), toBytes(separator)))

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
  Utf8.compareBytes(bytesOf(self), bytesOf(that))

/**
 * @since 0.1.0
 * @category instances
 */
export const Equivalence: Equivalence_.Equivalence<Str> = Equivalence_.make((self, that) =>
  Utf8.bytesEqual(bytesOf(self), bytesOf(that)),
)
