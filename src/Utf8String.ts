/**
 * An immutable UTF-8 string backed by a `Uint8Array`, like Rust's `str`.
 *
 * A `Utf8String` always holds valid UTF-8. Indices are byte offsets, and
 * slicing is zero-copy: slices share memory with the string they came from.
 * Equality, hashing and ordering are defined on the bytes, so a
 * `Utf8String` can be used as a key in Effect's `HashMap` and `HashSet`.
 * Byte-wise ordering coincides with ordering by Unicode code point.
 *
 * @example
 * ```ts
 * import { Equal } from "effect"
 * import * as Utf8String from "effect-ext/Utf8String"
 *
 * const s = Utf8String.fromString("héllo wörld")
 * Utf8String.byteLength(s) // 13
 * Utf8String.length(s) // 11
 * Utf8String.split(s, " ").map(String) // ["héllo", "wörld"]
 * Equal.equals(s, Utf8String.fromString("héllo wörld")) // true
 * ```
 *
 * @since 0.1.0
 */
import * as Data from "effect/Data"
import * as Equal from "effect/Equal"
import * as Equivalence_ from "effect/Equivalence"
import { dual } from "effect/Function"
import * as Hash from "effect/Hash"
import { NodeInspectSymbol } from "effect/Inspectable"
import * as Option from "effect/Option"
import * as Order_ from "effect/Order"
import { pipeArguments, type Pipeable } from "effect/Pipeable"
import { hasProperty } from "effect/Predicate"
import * as Result from "effect/Result"

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId = "~effect-ext/Utf8String" as const

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 0.1.0
 * @category models
 */
export interface Utf8String extends Equal.Equal, Pipeable, Iterable<string> {
  readonly [TypeId]: TypeId
  /**
   * The UTF-8 bytes. Must not be mutated: strings are immutable and slices
   * share memory.
   */
  readonly bytes: Uint8Array
  /** Decodes the string into a JavaScript string. */
  toString(): string
  toJSON(): unknown
}

/**
 * Raised when bytes are not valid UTF-8.
 *
 * @since 0.1.0
 * @category errors
 */
export class Utf8Error extends Data.TaggedError("Utf8Error")<{
  /** The length of the longest valid UTF-8 prefix. */
  readonly validUpTo: number
}> {
  override get message(): string {
    return `Invalid UTF-8 sequence at byte ${this.validUpTo}`
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { ignoreBOM: true })

class Utf8StringImpl implements Utf8String {
  readonly [TypeId] = TypeId
  private decoded: string | undefined
  private hashCode: number | undefined

  constructor(
    readonly bytes: Uint8Array,
    decoded?: string,
  ) {
    this.decoded = decoded
  }

  toString(): string {
    return (this.decoded ??= decoder.decode(this.bytes))
  }

  [Equal.symbol](that: Equal.Equal): boolean {
    return isUtf8String(that) && bytesEqual(this.bytes, that.bytes)
  }

  [Hash.symbol](): number {
    return (this.hashCode ??= hashBytes(this.bytes))
  }

  *[Symbol.iterator](): Iterator<string> {
    yield* this.toString()
  }

  pipe() {
    return pipeArguments(this, arguments)
  }

  toJSON() {
    return { _id: "Utf8String", value: this.toString() }
  }

  [NodeInspectSymbol]() {
    return this.toJSON()
  }
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a === b) return true
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// FNV-1a, 32-bit.
const hashBytes = (bytes: Uint8Array): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.byteLength; i++) {
    h ^= bytes[i]!
    h = Math.imul(h, 0x01000193)
  }
  return Hash.optimize(h)
}

/**
 * Returns the length of the longest valid UTF-8 prefix of `bytes`; equal to
 * `bytes.byteLength` if and only if the bytes are valid UTF-8.
 *
 * Rejects overlong encodings, surrogate code points and code points above
 * U+10FFFF, as required by the Unicode standard.
 *
 * @since 0.1.0
 * @category validation
 */
export const validUpTo = (bytes: Uint8Array): number => {
  const n = bytes.byteLength
  let i = 0
  while (i < n) {
    const b0 = bytes[i]!
    if (b0 < 0x80) {
      i++
      continue
    }
    let width: number
    let lo = 0x80
    let hi = 0xbf
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      width = 2
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      width = 3
      if (b0 === 0xe0) lo = 0xa0 // overlong
      else if (b0 === 0xed) hi = 0x9f // surrogates
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      width = 4
      if (b0 === 0xf0) lo = 0x90 // overlong
      else if (b0 === 0xf4) hi = 0x8f // > U+10FFFF
    } else {
      return i
    }
    if (i + width > n) return i
    const b1 = bytes[i + 1]!
    if (b1 < lo || b1 > hi) return i
    for (let k = 2; k < width; k++) {
      const b = bytes[i + k]!
      if (b < 0x80 || b > 0xbf) return i
    }
    i += width
  }
  return n
}

/**
 * Checks whether `bytes` are valid UTF-8.
 *
 * @since 0.1.0
 * @category validation
 */
export const isValid = (bytes: Uint8Array): boolean => validUpTo(bytes) === bytes.byteLength

/**
 * @since 0.1.0
 * @category guards
 */
export const isUtf8String = (u: unknown): u is Utf8String => hasProperty(u, TypeId)

/**
 * The empty string.
 *
 * @since 0.1.0
 * @category constructors
 */
export const empty: Utf8String = new Utf8StringImpl(new Uint8Array(0), "")

/**
 * Encodes a JavaScript string. Lone surrogates are replaced with U+FFFD.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromString = (s: string): Utf8String => {
  const bytes = encoder.encode(s)
  return new Utf8StringImpl(bytes, s.isWellFormed() ? s : undefined)
}

/**
 * Validates and copies bytes into a new string.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromBytes = (bytes: Uint8Array): Result.Result<Utf8String, Utf8Error> => {
  const valid = validUpTo(bytes)
  return valid === bytes.byteLength
    ? Result.succeed(new Utf8StringImpl(bytes.slice()))
    : Result.fail(new Utf8Error({ validUpTo: valid }))
}

/**
 * Decodes bytes, replacing invalid sequences with U+FFFD.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromBytesLossy = (bytes: Uint8Array): Utf8String =>
  isValid(bytes) ? new Utf8StringImpl(bytes.slice()) : fromString(decoder.decode(bytes))

/**
 * Wraps bytes without validating or copying them. The caller must guarantee
 * that the bytes are valid UTF-8 and are never mutated.
 *
 * @since 0.1.0
 * @category unsafe
 */
export const fromBytesUnsafe = (bytes: Uint8Array): Utf8String => new Utf8StringImpl(bytes)

/**
 * The UTF-8 bytes of a string. Must not be mutated.
 *
 * @since 0.1.0
 * @category getters
 */
export const toBytes = (self: Utf8String): Uint8Array => self.bytes

/**
 * The length of a string in bytes.
 *
 * @since 0.1.0
 * @category getters
 */
export const byteLength = (self: Utf8String): number => self.bytes.byteLength

/**
 * The number of Unicode code points in a string.
 *
 * @since 0.1.0
 * @category getters
 */
export const length = (self: Utf8String): number => {
  const bytes = self.bytes
  let count = 0
  for (let i = 0; i < bytes.byteLength; i++) {
    if ((bytes[i]! & 0xc0) !== 0x80) count++
  }
  return count
}

/**
 * @since 0.1.0
 * @category getters
 */
export const isEmpty = (self: Utf8String): boolean => self.bytes.byteLength === 0

/**
 * @since 0.1.0
 * @category getters
 */
export const isNonEmpty = (self: Utf8String): boolean => self.bytes.byteLength > 0

/**
 * Checks whether byte offset `index` falls on a code point boundary. The start
 * and end of the string are boundaries.
 *
 * @since 0.1.0
 * @category getters
 */
export const isCharBoundary: {
  (index: number): (self: Utf8String) => boolean
  (self: Utf8String, index: number): boolean
} = dual(2, (self: Utf8String, index: number): boolean => {
  const bytes = self.bytes
  if (!Number.isSafeInteger(index) || index < 0 || index > bytes.byteLength) return false
  return index === bytes.byteLength || (bytes[index]! & 0xc0) !== 0x80
})

/**
 * Iterates over the code points of a string.
 *
 * @since 0.1.0
 * @category getters
 */
export const codePoints = function* (self: Utf8String): IterableIterator<number> {
  const bytes = self.bytes
  let i = 0
  while (i < bytes.byteLength) {
    const b0 = bytes[i]!
    if (b0 < 0x80) {
      yield b0
      i += 1
    } else if (b0 < 0xe0) {
      yield ((b0 & 0x1f) << 6) | (bytes[i + 1]! & 0x3f)
      i += 2
    } else if (b0 < 0xf0) {
      yield ((b0 & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f)
      i += 3
    } else {
      yield (
        ((b0 & 0x07) << 18) |
          ((bytes[i + 1]! & 0x3f) << 12) |
          ((bytes[i + 2]! & 0x3f) << 6) |
          (bytes[i + 3]! & 0x3f)
      )
      i += 4
    }
  }
}

/**
 * Returns the substring between byte offsets `start` (inclusive) and `end`
 * (exclusive, defaulting to the end of the string), sharing memory with the
 * original. Returns `None` if either offset is out of range or not on a code
 * point boundary.
 *
 * @since 0.1.0
 * @category combinators
 */
export const slice: {
  (start: number, end?: number): (self: Utf8String) => Option.Option<Utf8String>
  (self: Utf8String, start: number, end?: number): Option.Option<Utf8String>
} = dual(
  (args) => isUtf8String(args[0]),
  (self: Utf8String, start: number, end?: number): Option.Option<Utf8String> => {
    const stop = end ?? self.bytes.byteLength
    if (start > stop || !isCharBoundary(self, start) || !isCharBoundary(self, stop)) {
      return Option.none()
    }
    return Option.some(new Utf8StringImpl(self.bytes.subarray(start, stop)))
  },
)

/**
 * Like {@link slice}, but throws a `RangeError` instead of returning `None`.
 *
 * @since 0.1.0
 * @category unsafe
 */
export const sliceUnsafe: {
  (start: number, end?: number): (self: Utf8String) => Utf8String
  (self: Utf8String, start: number, end?: number): Utf8String
} = dual(
  (args) => isUtf8String(args[0]),
  (self: Utf8String, start: number, end?: number): Utf8String => {
    const result = slice(self, start, end)
    if (Option.isNone(result)) {
      throw new RangeError(
        `Utf8String: invalid slice [${start}, ${end ?? self.bytes.byteLength}) of ${self.bytes.byteLength} bytes`,
      )
    }
    return result.value
  },
)

/**
 * Concatenates two strings.
 *
 * @since 0.1.0
 * @category combinators
 */
export const concat: {
  (that: Utf8String): (self: Utf8String) => Utf8String
  (self: Utf8String, that: Utf8String): Utf8String
} = dual(2, (self: Utf8String, that: Utf8String): Utf8String => {
  if (self.bytes.byteLength === 0) return that
  if (that.bytes.byteLength === 0) return self
  const bytes = new Uint8Array(self.bytes.byteLength + that.bytes.byteLength)
  bytes.set(self.bytes, 0)
  bytes.set(that.bytes, self.bytes.byteLength)
  return new Utf8StringImpl(bytes)
})

/**
 * Concatenates many strings, optionally separated by `separator`.
 *
 * @since 0.1.0
 * @category combinators
 */
export const join = (
  strings: Iterable<Utf8String>,
  separator: Utf8String | string = empty,
): Utf8String => {
  const sep = typeof separator === "string" ? fromString(separator) : separator
  const parts = Array.from(strings)
  if (parts.length === 0) return empty
  let size = sep.bytes.byteLength * (parts.length - 1)
  for (const part of parts) size += part.bytes.byteLength
  const bytes = new Uint8Array(size)
  let offset = 0
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      bytes.set(sep.bytes, offset)
      offset += sep.bytes.byteLength
    }
    bytes.set(parts[i]!.bytes, offset)
    offset += parts[i]!.bytes.byteLength
  }
  return new Utf8StringImpl(bytes)
}

const toNeedle = (needle: Utf8String | string): Uint8Array =>
  typeof needle === "string" ? encoder.encode(needle) : needle.bytes

const matchesAt = (haystack: Uint8Array, needle: Uint8Array, at: number): boolean => {
  for (let j = 0; j < needle.byteLength; j++) {
    if (haystack[at + j] !== needle[j]) return false
  }
  return true
}

const findFrom = (haystack: Uint8Array, needle: Uint8Array, from: number): number => {
  const last = haystack.byteLength - needle.byteLength
  if (needle.byteLength === 0) return from <= haystack.byteLength ? from : -1
  const first = needle[0]!
  for (let i = from; i <= last; i++) {
    if (haystack[i] === first && matchesAt(haystack, needle, i)) return i
  }
  return -1
}

/**
 * Returns the byte offset of the first occurrence of `needle`.
 *
 * Because UTF-8 is self-synchronising, a match always starts and ends on a
 * code point boundary.
 *
 * @since 0.1.0
 * @category searching
 */
export const indexOf: {
  (needle: Utf8String | string): (self: Utf8String) => Option.Option<number>
  (self: Utf8String, needle: Utf8String | string): Option.Option<number>
} = dual(2, (self: Utf8String, needle: Utf8String | string): Option.Option<number> => {
  const i = findFrom(self.bytes, toNeedle(needle), 0)
  return i === -1 ? Option.none() : Option.some(i)
})

/**
 * @since 0.1.0
 * @category searching
 */
export const includes: {
  (needle: Utf8String | string): (self: Utf8String) => boolean
  (self: Utf8String, needle: Utf8String | string): boolean
} = dual(
  2,
  (self: Utf8String, needle: Utf8String | string): boolean =>
    findFrom(self.bytes, toNeedle(needle), 0) !== -1,
)

/**
 * @since 0.1.0
 * @category searching
 */
export const startsWith: {
  (prefix: Utf8String | string): (self: Utf8String) => boolean
  (self: Utf8String, prefix: Utf8String | string): boolean
} = dual(2, (self: Utf8String, prefix: Utf8String | string): boolean => {
  const p = toNeedle(prefix)
  return p.byteLength <= self.bytes.byteLength && matchesAt(self.bytes, p, 0)
})

/**
 * @since 0.1.0
 * @category searching
 */
export const endsWith: {
  (suffix: Utf8String | string): (self: Utf8String) => boolean
  (self: Utf8String, suffix: Utf8String | string): boolean
} = dual(2, (self: Utf8String, suffix: Utf8String | string): boolean => {
  const s = toNeedle(suffix)
  const at = self.bytes.byteLength - s.byteLength
  return at >= 0 && matchesAt(self.bytes, s, at)
})

/**
 * Splits a string on every occurrence of `separator`. The parts share memory
 * with the original string. An empty separator splits into code points.
 *
 * @since 0.1.0
 * @category combinators
 */
export const split: {
  (separator: Utf8String | string): (self: Utf8String) => Array<Utf8String>
  (self: Utf8String, separator: Utf8String | string): Array<Utf8String>
} = dual(2, (self: Utf8String, separator: Utf8String | string): Array<Utf8String> => {
  const bytes = self.bytes
  const sep = toNeedle(separator)
  const out: Array<Utf8String> = []
  if (sep.byteLength === 0) {
    let start = 0
    for (let i = 1; i <= bytes.byteLength; i++) {
      if (i === bytes.byteLength || (bytes[i]! & 0xc0) !== 0x80) {
        out.push(new Utf8StringImpl(bytes.subarray(start, i)))
        start = i
      }
    }
    return out
  }
  let start = 0
  let i: number
  while ((i = findFrom(bytes, sep, start)) !== -1) {
    out.push(new Utf8StringImpl(bytes.subarray(start, i)))
    start = i + sep.byteLength
  }
  out.push(new Utf8StringImpl(bytes.subarray(start)))
  return out
})

const isAsciiWhitespace = (b: number) =>
  b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0b || b === 0x0c || b === 0x0d

/**
 * Removes leading and trailing ASCII whitespace, sharing memory with the
 * original.
 *
 * @since 0.1.0
 * @category combinators
 */
export const trimAscii = (self: Utf8String): Utf8String => {
  const bytes = self.bytes
  let start = 0
  let end = bytes.byteLength
  while (start < end && isAsciiWhitespace(bytes[start]!)) start++
  while (end > start && isAsciiWhitespace(bytes[end - 1]!)) end--
  return start === 0 && end === bytes.byteLength
    ? self
    : new Utf8StringImpl(bytes.subarray(start, end))
}

/**
 * Compares two strings byte-wise, which is equivalent to comparing them by
 * Unicode code point (unlike JavaScript's `<`, which compares UTF-16 code
 * units).
 *
 * @since 0.1.0
 * @category instances
 */
export const Order: Order_.Order<Utf8String> = (self, that) => {
  const a = self.bytes
  const b = that.bytes
  const n = Math.min(a.byteLength, b.byteLength)
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return a.byteLength < b.byteLength ? -1 : a.byteLength > b.byteLength ? 1 : 0
}

/**
 * @since 0.1.0
 * @category instances
 */
export const Equivalence: Equivalence_.Equivalence<Utf8String> = Equivalence_.make((self, that) =>
  bytesEqual(self.bytes, that.bytes),
)
