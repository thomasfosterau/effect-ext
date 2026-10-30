/**
 * Byte-level UTF-8 algorithms shared by `Str` and `String`.
 *
 * Everything here works on `Uint8Array`s that are known to hold valid UTF-8
 * (except {@link validUpTo}, which checks that). Indices are byte offsets and
 * ranges are half-open `[start, end)`.
 *
 * @internal
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"

export const encoder = new TextEncoder()
export const decoder = new TextDecoder("utf-8", { ignoreBOM: true })

/** A half-open byte range. A `start` of -1 means "no match". */
export type Range = readonly [start: number, end: number]

const range = (start: number, end: number): Range => [start, end]

const noMatch: Range = range(-1, -1)

/** Unfold state for splitting: `[piece boundary, search position, pieces produced]`. */
type SplitState = readonly [number, number, number]

export const isContinuation = (byte: number) => (byte & 0xc0) === 0x80

/**
 * The length of the longest valid UTF-8 prefix of `bytes`; equal to
 * `bytes.byteLength` if and only if the bytes are valid UTF-8.
 */
export const validUpTo = (bytes: Uint8Array): number => {
  // A single pass over the bytes. `start` is where the current sequence began,
  // `pending` how many continuation bytes it still needs, and `lo`/`hi` the
  // range allowed for the next one (narrower than 0x80..0xbf right after some
  // lead bytes, to reject overlong forms, surrogates and code points above
  // U+10FFFF).
  let start = 0
  let pending = 0
  let lo = 0x80
  let hi = 0xbf
  const invalid = bytes.findIndex((byte, i) => {
    if (pending > 0) {
      if (byte < lo || byte > hi) return true
      pending--
      lo = 0x80
      hi = 0xbf
      return false
    }
    start = i
    if (byte < 0x80) return false
    if (byte >= 0xc2 && byte <= 0xdf) {
      pending = 1
    } else if (byte >= 0xe0 && byte <= 0xef) {
      pending = 2
      if (byte === 0xe0) lo = 0xa0 // overlong
      else if (byte === 0xed) hi = 0x9f // surrogates
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      pending = 3
      if (byte === 0xf0) lo = 0x90 // overlong
      else if (byte === 0xf4) hi = 0x8f // > U+10FFFF
    } else {
      return true
    }
    return false
  })
  return invalid !== -1 || pending > 0 ? start : bytes.byteLength
}

/** The width in bytes of the UTF-8 sequence that starts with `lead`. */
export const widthOf = (lead: number): number =>
  lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4

/** Decodes the code point starting at `i`. */
export const codePointAt = (bytes: Uint8Array, i: number): number => {
  const b0 = bytes[i]
  if (b0 < 0x80) return b0
  if (b0 < 0xe0) return ((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f)
  if (b0 < 0xf0) return ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
  return (
    ((b0 & 0x07) << 18) |
    ((bytes[i + 1] & 0x3f) << 12) |
    ((bytes[i + 2] & 0x3f) << 6) |
    (bytes[i + 3] & 0x3f)
  )
}

/** The character (one code point, as a JavaScript string) starting at `i`. */
export const charAt = (bytes: Uint8Array, i: number): string =>
  globalThis.String.fromCodePoint(codePointAt(bytes, i))

export const isCharBoundary = (bytes: Uint8Array, index: number): boolean =>
  Number.isSafeInteger(index) &&
  index >= 0 &&
  index <= bytes.byteLength &&
  (index === bytes.byteLength || !isContinuation(bytes[index]))

/** The closest character boundary at or before `index`. */
export const floorCharBoundary = (bytes: Uint8Array, index: number): number =>
  index >= bytes.byteLength
    ? bytes.byteLength
    : Math.max(
        0,
        bytes.subarray(0, Math.max(0, index) + 1).findLastIndex((b) => !isContinuation(b)),
      )

/** The closest character boundary at or after `index`. */
export const ceilCharBoundary = (bytes: Uint8Array, index: number): number => {
  if (index >= bytes.byteLength) return bytes.byteLength
  const from = Math.max(0, index)
  const found = bytes.subarray(from).findIndex((b) => !isContinuation(b))
  return found === -1 ? bytes.byteLength : from + found
}

/** The start of the character that ends at boundary `index` (which must be > 0). */
const previousBoundary = (bytes: Uint8Array, index: number): number =>
  bytes.subarray(0, index).findLastIndex((b) => !isContinuation(b))

export const countChars = (bytes: Uint8Array): number =>
  bytes.reduce((count, byte) => (isContinuation(byte) ? count : count + 1), 0)

const iterate = <A>(next: () => Option.Option<A>): IterableIterator<A> => {
  const iterator: IterableIterator<A> = {
    next: (): IteratorResult<A, undefined> => {
      const value = next()
      return Option.isSome(value)
        ? { done: false, value: value.value }
        : { done: true, value: undefined }
    },
    [Symbol.iterator]: () => iterator,
  }
  return iterator
}

/** Iterates `[byteIndex, char]` pairs. `bytes()` is re-read on each step. */
export const charIndices = (
  bytes: () => Uint8Array,
): IterableIterator<readonly [number, string]> => {
  let i = 0
  return iterate(() => {
    const current = bytes()
    if (i >= current.byteLength) return Option.none()
    const index = i
    i += widthOf(current[i])
    return Option.some([index, charAt(current, index)] as const)
  })
}

/** Iterates the characters. `bytes()` is re-read on each step. */
export const chars = (bytes: () => Uint8Array): IterableIterator<string> => {
  const pairs = charIndices(bytes)
  return iterate(() => {
    const next = pairs.next()
    return next.done === true ? Option.none() : Option.some(next.value[1])
  })
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Finds matches of a pattern in one haystack, in the style of Rust's
 * `Searcher`. Matches never overlap and always start and end on character
 * boundaries.
 */
export interface Searcher {
  /** The first match starting at or after `from`. */
  readonly next: (from: number) => Range
  /** The last match ending at or before `before`. */
  readonly prev: (before: number) => Range
  /** The match starting exactly at `at`. */
  readonly matchAt: (at: number) => Range
  /** The match ending exactly at `at`. */
  readonly matchEndingAt: (at: number) => Range
}

/** A compiled pattern: given a haystack, returns a searcher over it. */
export type Matcher = (haystack: Uint8Array) => Searcher

const matchesAt = (haystack: Uint8Array, needle: Uint8Array, at: number): boolean =>
  at >= 0 &&
  at + needle.byteLength <= haystack.byteLength &&
  needle.every((byte, j) => haystack[at + j] === byte)

/** Matches a literal byte sequence. An empty needle matches at every character boundary. */
export const needle =
  (bytes: Uint8Array): Matcher =>
  (haystack) => {
    const n = bytes.byteLength
    const len = haystack.byteLength
    if (n === 0) {
      const at = (i: number): Range => (isCharBoundary(haystack, i) ? [i, i] : noMatch)
      return {
        next: (from) => (from > len ? noMatch : at(ceilCharBoundary(haystack, from))),
        prev: (before) => (before < 0 ? noMatch : at(floorCharBoundary(haystack, before))),
        matchAt: at,
        matchEndingAt: at,
      }
    }
    const first = bytes[0]
    return {
      next: (from) => {
        const start = Math.max(0, from)
        const last = len - n
        if (start > last) return noMatch
        const found = haystack
          .subarray(start, last + 1)
          .findIndex((byte, k) => byte === first && matchesAt(haystack, bytes, start + k))
        return found === -1 ? noMatch : [start + found, start + found + n]
      },
      prev: (before) => {
        const end = Math.min(len, before)
        if (end - n < 0) return noMatch
        const found = haystack
          .subarray(0, end - n + 1)
          .findLastIndex((byte, i) => byte === first && matchesAt(haystack, bytes, i))
        return found === -1 ? noMatch : [found, found + n]
      },
      matchAt: (at) => (matchesAt(haystack, bytes, at) ? [at, at + n] : noMatch),
      matchEndingAt: (at) => (matchesAt(haystack, bytes, at - n) ? [at - n, at] : noMatch),
    }
  }

/** Matches any single character satisfying `predicate`. */
export const predicate =
  (test: (char: string) => boolean): Matcher =>
  (haystack) => {
    const len = haystack.byteLength
    const matches = (i: number) => !isContinuation(haystack[i]) && test(charAt(haystack, i))
    const charRange = (i: number): Range => [i, i + widthOf(haystack[i])]
    return {
      next: (from) => {
        const start = Math.max(0, from)
        if (start >= len) return noMatch
        const found = haystack.subarray(start).findIndex((_, k) => matches(start + k))
        return found === -1 ? noMatch : charRange(start + found)
      },
      prev: (before) => {
        const end = Math.min(len, before)
        if (end <= 0) return noMatch
        const found = haystack.subarray(0, end).findLastIndex((_, i) => matches(i))
        return found === -1 || found + widthOf(haystack[found]) > end ? noMatch : charRange(found)
      },
      matchAt: (at) => (at >= 0 && at < len && matches(at) ? charRange(at) : noMatch),
      matchEndingAt: (at) => {
        if (at <= 0 || at > len || !isCharBoundary(haystack, at)) return noMatch
        const start = previousBoundary(haystack, at)
        return matches(start) ? [start, at] : noMatch
      },
    }
  }

/** Every match, left to right. After an empty match the search resumes one character later. */
export const matchRanges = (haystack: Uint8Array, matcher: Matcher): Array<Range> => {
  const searcher = matcher(haystack)
  return Arr.unfold(0, (from) => {
    if (from > haystack.byteLength) return Option.none()
    const found = searcher.next(from)
    if (found[0] === -1) return Option.none()
    return Option.some([found, advance(haystack, found)] as const)
  })
}

/** Where to resume searching after `found`, so that empty matches make progress. */
const advance = (haystack: Uint8Array, found: Range): number =>
  found[1] > found[0]
    ? found[1]
    : found[1] >= haystack.byteLength
      ? haystack.byteLength + 1
      : found[1] + widthOf(haystack[found[1]])

/** Where to resume a backwards search before `found`, so that empty matches make progress. */
const retreat = (haystack: Uint8Array, found: Range): number =>
  found[1] > found[0] ? found[0] : found[0] <= 0 ? -1 : previousBoundary(haystack, found[0])

/**
 * The pieces between matches, left to right, like Rust's `split` / `splitn`.
 * At most `limit` pieces are produced; the last one holds the remainder.
 */
export const splitRanges = (
  haystack: Uint8Array,
  matcher: Matcher,
  limit = Number.POSITIVE_INFINITY,
): Array<Range> => {
  const searcher = matcher(haystack)
  const len = haystack.byteLength
  const initial: SplitState = [0, 0, 0]
  return Arr.unfold<SplitState, Range>(initial, ([start, from, count]) => {
    if (start < 0 || count >= limit) return Option.none()
    const found = count + 1 === limit || from > len ? noMatch : searcher.next(from)
    if (found[0] === -1) {
      return Option.some([range(start, len), [-1, 0, count + 1]] as const)
    }
    return Option.some([
      range(start, found[0]),
      [found[1], advance(haystack, found), count + 1],
    ] as const)
  })
}

/**
 * The pieces between matches, right to left, like Rust's `rsplit` / `rsplitn`.
 * At most `limit` pieces are produced; the last one holds the remainder.
 */
export const rsplitRanges = (
  haystack: Uint8Array,
  matcher: Matcher,
  limit = Number.POSITIVE_INFINITY,
): Array<Range> => {
  const searcher = matcher(haystack)
  const len = haystack.byteLength
  const initial: SplitState = [len, len, 0]
  return Arr.unfold<SplitState, Range>(initial, ([end, before, count]) => {
    if (end < 0 || count >= limit) return Option.none()
    const found = count + 1 === limit || before < 0 ? noMatch : searcher.prev(before)
    if (found[0] === -1) {
      return Option.some([range(0, end), [-1, 0, count + 1]] as const)
    }
    return Option.some([
      range(found[1], end),
      [found[0], retreat(haystack, found), count + 1],
    ] as const)
  })
}

/** The offset after stripping every leading match. */
export const trimStartOffset = (haystack: Uint8Array, matcher: Matcher): number => {
  const searcher = matcher(haystack)
  const ends = Arr.unfold(0, (at) => {
    const found = searcher.matchAt(at)
    return found[0] === -1 || found[1] === found[0]
      ? Option.none()
      : Option.some([found[1], found[1]] as const)
  })
  return Arr.isReadonlyArrayNonEmpty(ends) ? Arr.lastNonEmpty(ends) : 0
}

/** The offset after stripping every trailing match (never before `floor`). */
export const trimEndOffset = (haystack: Uint8Array, matcher: Matcher, floor = 0): number => {
  const searcher = matcher(haystack)
  const starts = Arr.unfold(haystack.byteLength, (at) => {
    if (at <= floor) return Option.none()
    const found = searcher.matchEndingAt(at)
    return found[0] === -1 || found[1] === found[0] || found[0] < floor
      ? Option.none()
      : Option.some([found[0], found[0]] as const)
  })
  return Arr.isReadonlyArrayNonEmpty(starts) ? Arr.lastNonEmpty(starts) : haystack.byteLength
}

/** Unicode `White_Space`, as used by Rust's `char::is_whitespace`. */
const whitespace = /^\p{White_Space}$/u

export const isWhitespace = (char: string): boolean => whitespace.test(char)

/** Rust's `u8::is_ascii_whitespace`: space, tab, line feed, form feed and carriage return. */
export const isAsciiWhitespaceByte = (byte: number): boolean =>
  byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d

export const isAsciiWhitespace = (char: string): boolean =>
  char.length === 1 && isAsciiWhitespaceByte(char.charCodeAt(0))

export const whitespaceMatcher: Matcher = predicate(isWhitespace)

export const asciiWhitespaceMatcher: Matcher = predicate(isAsciiWhitespace)

/** Joins byte strings into a new buffer, with `separator` between them. */
export const joinBytes = (parts: ReadonlyArray<Uint8Array>, separator: Uint8Array): Uint8Array => {
  if (!Arr.isReadonlyArrayNonEmpty(parts)) return new Uint8Array(0)
  const size = parts.reduce(
    (n, part) => n + part.byteLength,
    separator.byteLength * (parts.length - 1),
  )
  const out = new Uint8Array(size)
  let offset = 0
  parts.forEach((part, i) => {
    if (i > 0) {
      out.set(separator, offset)
      offset += separator.byteLength
    }
    out.set(part, offset)
    offset += part.byteLength
  })
  return out
}

/** Replaces the first `limit` matches of `matcher` with `to`. */
export const replaceBytes = (
  haystack: Uint8Array,
  matcher: Matcher,
  to: Uint8Array,
  limit = Number.POSITIVE_INFINITY,
): Uint8Array => {
  const matches = matchRanges(haystack, matcher).slice(0, limit)
  if (!Arr.isReadonlyArrayNonEmpty(matches)) return haystack.slice()
  const pieces = matches.reduce<Array<Uint8Array>>((acc, [start], i) => {
    const previousEnd = i === 0 ? 0 : matches[i - 1][1]
    acc.push(haystack.subarray(previousEnd, start), to)
    return acc
  }, [])
  pieces.push(haystack.subarray(Arr.lastNonEmpty(matches)[1]))
  return joinBytes(pieces, new Uint8Array(0))
}

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a === b || (a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]))

export const compareBytes = (a: Uint8Array, b: Uint8Array): -1 | 0 | 1 => {
  const n = Math.min(a.byteLength, b.byteLength)
  const i = a.subarray(0, n).findIndex((byte, k) => byte !== b[k])
  if (i !== -1) return a[i] < b[i] ? -1 : 1
  return a.byteLength < b.byteLength ? -1 : a.byteLength > b.byteLength ? 1 : 0
}

const asciiLowerToUpper = (byte: number) => (byte >= 0x61 && byte <= 0x7a ? byte - 0x20 : byte)
const asciiUpperToLower = (byte: number) => (byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte)

export const toAsciiUppercaseByte = asciiLowerToUpper
export const toAsciiLowercaseByte = asciiUpperToLower

export const eqIgnoreAsciiCase = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength &&
  a.every((byte, i) => asciiUpperToLower(byte) === asciiUpperToLower(b[i]))
