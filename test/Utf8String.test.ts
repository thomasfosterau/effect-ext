import { describe, expect, it } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Eq from "effect/Equal"
import * as Hash from "effect/Hash"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Utf8String from "../src/Utf8String.ts"

const s = Utf8String.fromString

describe("Utf8String", () => {
  it("round-trips JavaScript strings", () => {
    ;["", "hello", "héllo wörld", "日本語", "🦀 crab", "a\u0000b"].forEach((text) => {
      expect(s(text).toString()).toBe(text)
      expect(String(s(text))).toBe(text)
    })
  })

  it("byteLength and length", () => {
    const str = s("héllo 🦀")
    expect(Utf8String.byteLength(str)).toBe(11)
    expect(Utf8String.length(str)).toBe(7)
    expect([...str]).toEqual(["h", "é", "l", "l", "o", " ", "🦀"])
    expect([...Utf8String.codePoints(str)]).toEqual([...str].map((c) => c.codePointAt(0)))
  })

  it("validates bytes", () => {
    const ok = Utf8String.fromBytes(new Uint8Array([0x68, 0xc3, 0xa9]))
    expect(Result.isSuccess(ok) && ok.success.toString()).toBe("hé")
    const cases: Array<[Array<number>, number]> = [
      [[0x61, 0x80], 1], // lone continuation byte
      [[0xc0, 0xaf], 0], // overlong
      [[0xe0, 0x80, 0xaf], 0], // overlong
      [[0xed, 0xa0, 0x80], 0], // surrogate
      [[0xf4, 0x90, 0x80, 0x80], 0], // > U+10FFFF
      [[0x61, 0xe6, 0x97], 1], // truncated
      [[0xff], 0],
      [[0x61, 0xf0, 0x9f, 0xa6], 1], // truncated 4-byte sequence
      [[0xe6, 0x41], 0], // lead byte followed by ASCII
    ]
    cases.forEach(([bytes, validUpTo]) => {
      const result = Utf8String.fromBytes(new Uint8Array(bytes))
      expect(Result.isFailure(result) && result.failure.validUpTo).toBe(validUpTo)
    })
    expect(Utf8String.fromBytesLossy(new Uint8Array([0x61, 0xff])).toString()).toBe("a�")
  })

  it("Utf8Error reports where the invalid sequence starts", () => {
    const result = Utf8String.fromBytes(new Uint8Array([0x61, 0xff]))
    expect(Result.isFailure(result) && result.failure.message).toBe(
      "Invalid UTF-8 sequence at byte 1",
    )
  })

  it("validUpTo agrees with a fatal TextDecoder", () => {
    // Deterministic pseudo-random bytes, biased towards UTF-8 lead and
    // continuation bytes so that multi-byte sequences are well covered.
    const fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    const isValidUtf8 = (bytes: Uint8Array) =>
      Result.isSuccess(Result.try(() => fatal.decode(bytes)))
    let seed = 0x2545f491
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      return seed >>> 16
    }
    const pool = [
      0x00, 0x41, 0x7f, 0x80, 0x9f, 0xa0, 0xbf, 0xc0, 0xc2, 0xdf, 0xe0, 0xed, 0xef, 0xf0, 0xf4,
      0xf5, 0xff,
    ]
    Array.from({ length: 5000 }, () =>
      Uint8Array.from({ length: next() % 8 }, () =>
        next() % 3 === 0 ? next() & 0xff : pool[next() % pool.length],
      ),
    ).forEach((bytes) => {
      const valid = Utf8String.validUpTo(bytes)
      expect(Utf8String.isValid(bytes)).toBe(isValidUtf8(bytes))
      expect(isValidUtf8(bytes.subarray(0, valid))).toBe(true)
    })
  })

  it.effect("fromBytes copies its input", () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([0x61, 0x62])
      const str = yield* Effect.fromResult(Utf8String.fromBytes(bytes))
      bytes[0] = 0x7a
      expect(str.toString()).toBe("ab")
    }),
  )

  it("equality and hashing", () => {
    expect(Eq.equals(s("abc"), s("abc"))).toBe(true)
    expect(Eq.equals(s("abc"), s("abd"))).toBe(false)
    expect(Hash.hash(s("abc"))).toBe(Hash.hash(s("abc")))
    const set = HashSet.make(s("a"), s("b"), s("a"))
    expect(HashSet.size(set)).toBe(2)
    expect(HashSet.has(set, s("b"))).toBe(true)
  })

  it("orders by code point", () => {
    // In UTF-16, U+FF61 sorts after U+1F600 (a surrogate pair starting 0xD83D).
    const sorted = Arr.sort([s("\u{ff61}"), s("\u{1f600}"), s("a")], Utf8String.Order)
    expect(sorted.map(String)).toEqual(["a", "\u{ff61}", "\u{1f600}"])
    expect(Utf8String.Order(s("ab"), s("abc"))).toBe(-1)
    expect(Utf8String.Order(s("abd"), s("abc"))).toBe(1)
    expect(Utf8String.Order(s("abc"), s("abc"))).toBe(0)
    expect(Utf8String.Equivalence(s("x"), s("x"))).toBe(true)
  })

  it("slices on char boundaries only", () => {
    const str = s("héllo")
    expect(Utf8String.isCharBoundary(str, 2)).toBe(false)
    expect(Utf8String.slice(str, 0, 2)).toEqual(Option.none())
    expect(Option.map(Utf8String.slice(str, 0, 3), String)).toEqual(Option.some("hé"))
    expect(Utf8String.sliceUnsafe(str, 3).toString()).toBe("llo")
    expect(str.pipe(Utf8String.sliceUnsafe(1, 3)).toString()).toBe("é")
    expect(() => Utf8String.sliceUnsafe(str, 2)).toThrow(RangeError)
    // slices share memory
    expect(Utf8String.sliceUnsafe(str, 1).bytes.buffer).toBe(str.bytes.buffer)
  })

  it("searching", () => {
    const str = s("the quick brown 🦊")
    expect(Utf8String.indexOf(str, "quick")).toEqual(Option.some(4))
    expect(Utf8String.indexOf(str, "slow")).toEqual(Option.none())
    expect(Utf8String.includes(str, s("🦊"))).toBe(true)
    expect(Utf8String.startsWith(str, "the")).toBe(true)
    expect(Utf8String.endsWith(str, "🦊")).toBe(true)
    expect(Utf8String.endsWith(str, "fox")).toBe(false)
  })

  it("concat, join, split and trimAscii", () => {
    expect(Utf8String.concat(s("ab"), s("ç")).toString()).toBe("abç")
    expect(Utf8String.join([s("a"), s("b"), s("c")], ", ").toString()).toBe("a, b, c")
    expect(Utf8String.join([]).toString()).toBe("")
    expect(Utf8String.split(s("a,b,,c"), ",").map(String)).toEqual(["a", "b", "", "c"])
    expect(Utf8String.split(s("hé🦀"), "").map(String)).toEqual(["h", "é", "🦀"])
    expect(Utf8String.trimAscii(s("  hi \n")).toString()).toBe("hi")
    expect(Utf8String.trimAscii(s(" \t ")).toString()).toBe("")
    expect(Utf8String.split(s("a,"), ",").map(String)).toEqual(["a", ""])
    expect(Utf8String.split(s(""), ",").map(String)).toEqual([""])
    expect(Utf8String.split(s(""), "")).toEqual([])
    expect(Utf8String.isEmpty(Utf8String.empty)).toBe(true)
  })

  it("is inspectable", () => {
    expect(s("hi").toJSON()).toEqual({ _id: "Utf8String", value: "hi" })
  })
})
