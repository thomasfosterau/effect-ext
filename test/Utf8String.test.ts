import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Equal, Hash, HashSet, Option, Result } from "effect"
import * as Utf8String from "../src/Utf8String.ts"

const s = Utf8String.fromString

describe("Utf8String", () => {
  it("round-trips JavaScript strings", () => {
    for (const text of ["", "hello", "héllo wörld", "日本語", "🦀 crab", "a\u0000b"]) {
      expect(s(text).toString()).toBe(text)
      expect(String(s(text))).toBe(text)
    }
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
    ]
    for (const [bytes, validUpTo] of cases) {
      const result = Utf8String.fromBytes(new Uint8Array(bytes))
      expect(Result.isFailure(result) && result.failure.validUpTo).toBe(validUpTo)
    }
    expect(Utf8String.fromBytesLossy(new Uint8Array([0x61, 0xff])).toString()).toBe("a�")
  })

  it("fromBytes copies its input", () => {
    const bytes = new Uint8Array([0x61, 0x62])
    const str = Result.getOrThrow(Utf8String.fromBytes(bytes))
    bytes[0] = 0x7a
    expect(str.toString()).toBe("ab")
  })

  it("equality and hashing", () => {
    expect(Equal.equals(s("abc"), s("abc"))).toBe(true)
    expect(Equal.equals(s("abc"), s("abd"))).toBe(false)
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
    expect(Utf8String.isEmpty(Utf8String.empty)).toBe(true)
  })

  it("is inspectable", () => {
    expect(s("hi").toJSON()).toEqual({ _id: "Utf8String", value: "hi" })
  })
})
