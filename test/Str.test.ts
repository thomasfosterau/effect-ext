import { describe, expect, it } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Eq from "effect/Equal"
import * as Hash from "effect/Hash"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Str from "../src/Str.ts"

const s = Str.fromString
const text = (strs: ReadonlyArray<Str.Str>) => strs.map((part) => part.toString())
const isNumeric = (c: string) => /^\p{N}$/u.test(c)

describe("Str", () => {
  describe("construction and conversion", () => {
    it("round-trips JavaScript strings", () => {
      ;["", "hello", "héllo wörld", "日本語", "🦀 crab", "a\u0000b"].forEach((t) => {
        expect(s(t).toString()).toBe(t)
      })
    })

    it("validates bytes like str::from_utf8", () => {
      const ok = Str.fromUtf8(new Uint8Array([0x68, 0xc3, 0xa9]))
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
        const result = Str.fromUtf8(new Uint8Array(bytes))
        expect(Result.isFailure(result) && result.failure.validUpTo).toBe(validUpTo)
      })
      expect(Str.fromUtf8Lossy(new Uint8Array([0x61, 0xff])).toString()).toBe("a�")
    })

    it("Utf8Error reports where the invalid sequence starts", () => {
      const result = Str.fromUtf8(new Uint8Array([0x61, 0xff]))
      expect(Result.isFailure(result) && result.failure.message).toBe(
        "Invalid UTF-8 sequence at byte 1",
      )
    })

    it("validation agrees with a fatal TextDecoder", () => {
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
        const result = Str.fromUtf8(bytes)
        expect(Result.isSuccess(result)).toBe(isValidUtf8(bytes))
        const validUpTo = Result.isFailure(result) ? result.failure.validUpTo : bytes.byteLength
        expect(isValidUtf8(bytes.subarray(0, validUpTo))).toBe(true)
      })
    })

    it.effect("fromUtf8 copies its input", () =>
      Effect.gen(function* () {
        const bytes = new Uint8Array([0x61, 0x62])
        const str = yield* Effect.fromResult(Str.fromUtf8(bytes))
        bytes[0] = 0x7a
        expect(str.toString()).toBe("ab")
      }),
    )
  })

  describe("lengths and iteration", () => {
    it("len counts bytes; charCount counts characters", () => {
      const str = s("héllo 🦀")
      expect(Str.len(str)).toBe(11)
      expect(Str.charCount(str)).toBe(7)
      expect(Str.isEmpty(Str.empty)).toBe(true)
      expect(Str.isAscii(s("hello"))).toBe(true)
      expect(Str.isAscii(str)).toBe(false)
    })

    it("chars, charIndices and bytes", () => {
      expect([...Str.chars(s("héllo 🦀"))]).toEqual(["h", "é", "l", "l", "o", " ", "🦀"])
      expect([...Str.charIndices(s("y̆es"))]).toEqual([
        [0, "y"],
        [1, "̆"],
        [3, "e"],
        [4, "s"],
      ])
      expect([...Str.bytes(s("bör"))]).toEqual([0x62, 0xc3, 0xb6, 0x72])
      expect([...s("hé")]).toEqual(["h", "é"])
    })

    it("char boundaries", () => {
      const str = s("Löwe 老虎 Léopard")
      expect(Str.isCharBoundary(str, 0)).toBe(true)
      expect(Str.isCharBoundary(str, 6)).toBe(true)
      expect(Str.isCharBoundary(str, Str.len(str))).toBe(true)
      expect(Str.isCharBoundary(str, 2)).toBe(false)
      expect(Str.isCharBoundary(str, 8)).toBe(false)
      const hearts = s("❤️🧡💛💚💙💜")
      expect(Str.floorCharBoundary(hearts, 13)).toBe(10)
      expect(Str.ceilCharBoundary(hearts, 13)).toBe(14)
      expect(Str.floorCharBoundary(hearts, 100)).toBe(Str.len(hearts))
    })
  })

  describe("slicing", () => {
    it("get only accepts ranges on character boundaries", () => {
      const str = s("🗻∈🌏")
      expect(Option.map(Str.get(str, 0, 4), (x) => x.toString())).toEqual(Option.some("🗻"))
      expect(Str.get(str, 1)).toEqual(Option.none())
      expect(Option.map(Str.get(str, 0, 7), (x) => x.toString())).toEqual(Option.some("🗻∈"))
      expect(Str.get(str, 0, 42)).toEqual(Option.none())
      expect(str.pipe(Str.getUnsafe(4, 7)).toString()).toBe("∈")
      expect(() => Str.getUnsafe(str, 1)).toThrow(RangeError)
    })

    it("slices share memory", () => {
      const str = s("héllo")
      expect(Str.asBytes(Str.getUnsafe(str, 1)).buffer).toBe(Str.asBytes(str).buffer)
    })

    it("splitAt", () => {
      const str = s("Per Martin-Löf")
      expect(Option.map(Str.splitAt(str, 3), text)).toEqual(Option.some(["Per", " Martin-Löf"]))
      expect(Str.splitAt(str, 13)).toEqual(Option.none())
      expect(() => Str.splitAtUnsafe(str, 13)).toThrow(RangeError)
    })
  })

  describe("searching", () => {
    const str = s("Löwe 老虎 Léopard Gepardi")

    it("find and rfind with strings and predicates", () => {
      expect(Str.find(str, "L")).toEqual(Option.some(0))
      expect(Str.find(str, "é")).toEqual(Option.some(14))
      expect(Str.find(str, "pard")).toEqual(Option.some(17))
      expect(Str.find(str, (c) => /^\s$/u.test(c))).toEqual(Option.some(5))
      expect(Str.find(str, (c) => /^\p{Ll}$/u.test(c))).toEqual(Option.some(1))
      expect(Str.find(str, "X")).toEqual(Option.none())
      expect(Str.rfind(str, "L")).toEqual(Option.some(13))
      expect(Str.rfind(str, "pard")).toEqual(Option.some(24))
      expect(Str.rfind(str, (c) => /^\s$/u.test(c))).toEqual(Option.some(21))
    })

    it("contains, startsWith and endsWith", () => {
      expect(Str.contains(str, "老虎")).toBe(true)
      expect(Str.contains(str, s("tiger"))).toBe(false)
      expect(Str.startsWith(str, "Löwe")).toBe(true)
      expect(Str.startsWith(str, (c) => c === "L")).toBe(true)
      expect(Str.endsWith(str, "ardi")).toBe(true)
      expect(Str.endsWith(str, (c) => c === "x")).toBe(false)
      expect(Str.startsWith(str, "")).toBe(true)
    })

    it("matches and matchIndices", () => {
      expect(text(Str.matches(s("abcXXXabcYYYabc"), "abc"))).toEqual(["abc", "abc", "abc"])
      expect(text(Str.matches(s("1abc2abc3"), isNumeric))).toEqual(["1", "2", "3"])
      const indices = (str: Str.Str, p: Str.Pattern) =>
        Str.matchIndices(str, p).map(([i, m]) => [i, m.toString()])
      expect(indices(s("abcXXXabcYYYabc"), "abc")).toEqual([
        [0, "abc"],
        [6, "abc"],
        [12, "abc"],
      ])
      expect(indices(s("1abcabc2"), "abc")).toEqual([
        [1, "abc"],
        [4, "abc"],
      ])
      expect(indices(s("ababa"), "aba")).toEqual([[0, "aba"]])
    })
  })

  describe("splitting", () => {
    it("split", () => {
      expect(text(Str.split(s("Mary had a little lamb"), " "))).toEqual([
        "Mary",
        "had",
        "a",
        "little",
        "lamb",
      ])
      expect(text(Str.split(s(""), "X"))).toEqual([""])
      expect(text(Str.split(s("lionXXtigerXleopard"), "X"))).toEqual([
        "lion",
        "",
        "tiger",
        "leopard",
      ])
      expect(text(Str.split(s("abc1defXghi"), (c) => c === "1" || c === "X"))).toEqual([
        "abc",
        "def",
        "ghi",
      ])
      expect(text(Str.split(s("abc"), ""))).toEqual(["", "a", "b", "c", ""])
      expect(text(Str.split(s("hé🦀"), ""))).toEqual(["", "h", "é", "🦀", ""])
    })

    it("rsplit", () => {
      expect(text(Str.rsplit(s("Mary had a little lamb"), " "))).toEqual([
        "lamb",
        "little",
        "a",
        "had",
        "Mary",
      ])
      expect(text(Str.rsplit(s("lionXXtigerXleopard"), "X"))).toEqual([
        "leopard",
        "tiger",
        "",
        "lion",
      ])
      expect(text(Str.rsplit(s("abc"), ""))).toEqual(["", "c", "b", "a", ""])
    })

    it("splitn and rsplitn", () => {
      expect(text(Str.splitn(s("Mary had a little lambda"), 3, " "))).toEqual([
        "Mary",
        "had",
        "a little lambda",
      ])
      expect(text(Str.splitn(s("lionXXtigerXleopard"), 3, "X"))).toEqual([
        "lion",
        "",
        "tigerXleopard",
      ])
      expect(text(Str.splitn(s("abcXdef"), 1, "X"))).toEqual(["abcXdef"])
      expect(text(Str.splitn(s(""), 1, "X"))).toEqual([""])
      expect(text(Str.splitn(s("a,b"), 0, ","))).toEqual([])
      expect(text(Str.rsplitn(s("Mary had a little lamb"), 3, " "))).toEqual([
        "lamb",
        "little",
        "Mary had a",
      ])
      expect(text(Str.rsplitn(s("lionXXtigerXleopard"), 3, "X"))).toEqual([
        "leopard",
        "tiger",
        "lionX",
      ])
    })

    it("splitTerminator and splitInclusive", () => {
      expect(text(Str.splitTerminator(s("A.B."), "."))).toEqual(["A", "B"])
      expect(text(Str.splitTerminator(s("A..B.."), "."))).toEqual(["A", "", "B", ""])
      expect(text(Str.splitTerminator(s(""), "."))).toEqual([])
      expect(
        text(Str.splitInclusive(s("Mary had a little lamb\nlittle lamb\nlittle lamb.\n"), "\n")),
      ).toEqual(["Mary had a little lamb\n", "little lamb\n", "little lamb.\n"])
      expect(text(Str.splitInclusive(s("a\n\nb"), "\n"))).toEqual(["a\n", "\n", "b"])
      expect(text(Str.splitInclusive(s(""), "\n"))).toEqual([])
    })

    it("splitOnce and rsplitOnce", () => {
      expect(Option.map(Str.splitOnce(s("cfg=foo=bar"), "="), text)).toEqual(
        Option.some(["cfg", "foo=bar"]),
      )
      expect(Option.map(Str.rsplitOnce(s("cfg=foo=bar"), "="), text)).toEqual(
        Option.some(["cfg=foo", "bar"]),
      )
      expect(Str.splitOnce(s("cfg"), "=")).toEqual(Option.none())
    })

    it("splitWhitespace and splitAsciiWhitespace", () => {
      const str = s(" Mary   had\ta little  \n\t lamb")
      expect(text(Str.splitWhitespace(str))).toEqual(["Mary", "had", "a", "little", "lamb"])
      expect(text(Str.splitAsciiWhitespace(str))).toEqual(["Mary", "had", "a little", "lamb"])
      expect(text(Str.splitWhitespace(s("   ")))).toEqual([])
      expect(text(Str.splitWhitespace(s("")))).toEqual([])
    })

    it("lines", () => {
      expect(text(Str.lines(s("foo\r\nbar\n\nbaz\r")))).toEqual(["foo", "bar", "", "baz\r"])
      expect(text(Str.lines(s("foo\nbar\n\r\nbaz\n")))).toEqual(["foo", "bar", "", "baz"])
      expect(text(Str.lines(s("")))).toEqual([])
      expect(text(Str.lines(s("\n")))).toEqual([""])
    })
  })

  describe("trimming", () => {
    it("trim, trimStart and trimEnd use Unicode whitespace", () => {
      const str = s("　 Hello\tworld\t\n")
      expect(Str.trim(str).toString()).toBe("Hello\tworld")
      expect(Str.trimStart(str).toString()).toBe("Hello\tworld\t\n")
      expect(Str.trimEnd(str).toString()).toBe("　 Hello\tworld")
      expect(Str.trim(s(" \t ")).toString()).toBe("")
    })

    it("trimAscii only trims ASCII whitespace", () => {
      expect(Str.trimAscii(s("　 hi \n")).toString()).toBe("　 hi")
      expect(Str.trimAsciiStart(s("  hi  ")).toString()).toBe("hi  ")
      expect(Str.trimAsciiEnd(s("  hi  ")).toString()).toBe("  hi")
      // Like Rust, vertical tab is not ASCII whitespace.
      expect(Str.trimAscii(s("\u000bhi")).toString()).toBe("\u000bhi")
    })

    it("trimMatches, trimStartMatches and trimEndMatches", () => {
      expect(Str.trimMatches(s("11foo1bar11"), "1").toString()).toBe("foo1bar")
      expect(Str.trimMatches(s("123foo1bar123"), isNumeric).toString()).toBe("foo1bar")
      expect(Str.trimMatches(s("1foo1barXX"), (c) => c === "1" || c === "X").toString()).toBe(
        "foo1bar",
      )
      expect(Str.trimStartMatches(s("11foo1bar11"), "1").toString()).toBe("foo1bar11")
      expect(Str.trimStartMatches(s("123foo1bar123"), isNumeric).toString()).toBe("foo1bar123")
      expect(Str.trimEndMatches(s("11foo1bar11"), "1").toString()).toBe("11foo1bar")
      expect(Str.trimEndMatches(s("123foo1bar123"), isNumeric).toString()).toBe("123foo1bar")
      expect(Str.trimMatches(s("ababab"), "ab").toString()).toBe("")
      expect(Str.trimMatches(s("abc"), "").toString()).toBe("abc")
    })

    it("stripPrefix and stripSuffix", () => {
      const strip = (o: Option.Option<Str.Str>) => Option.map(o, (x) => x.toString())
      expect(strip(Str.stripPrefix(s("foo:bar"), "foo:"))).toEqual(Option.some("bar"))
      expect(strip(Str.stripPrefix(s("foo:bar"), "bar"))).toEqual(Option.none())
      expect(strip(Str.stripPrefix(s("foofoo"), "foo"))).toEqual(Option.some("foo"))
      expect(strip(Str.stripPrefix(s("é!"), (c) => c === "é"))).toEqual(Option.some("!"))
      expect(strip(Str.stripSuffix(s("bar:foo"), ":foo"))).toEqual(Option.some("bar"))
      expect(strip(Str.stripSuffix(s("bar:foo"), "bar"))).toEqual(Option.none())
      expect(strip(Str.stripSuffix(s("foofoo"), "foo"))).toEqual(Option.some("foo"))
    })
  })

  describe("transforming", () => {
    it("replace and replacen", () => {
      expect(Str.replace(s("this is old"), "old", "new").toString()).toBe("this is new")
      expect(Str.replace(s("this is old"), " ", "").toString()).toBe("thisisold")
      expect(Str.replace(s("abc"), "", "-").toString()).toBe("-a-b-c-")
      expect(Str.replacen(s("foo foo 123 foo"), "foo", "new", 2).toString()).toBe("new new 123 foo")
      expect(Str.replacen(s("foo foo 123 foo"), isNumeric, "new", 1).toString()).toBe(
        "foo foo new23 foo",
      )
    })

    it("repeat", () => {
      expect(Str.repeat(s("abc"), 4).toString()).toBe("abcabcabcabc")
      expect(Str.repeat(s("abc"), 0).toString()).toBe("")
      expect(() => Str.repeat(s("abc"), -1)).toThrow(RangeError)
    })

    it("case conversion", () => {
      expect(Str.toUppercase(s("tschüß")).toString()).toBe("TSCHÜSS")
      expect(Str.toLowercase(s("ὈΔΥΣΣΕΎΣ")).toString()).toBe("ὀδυσσεύς")
      expect(Str.toAsciiUppercase(s("Grüße, Jürgen ❤")).toString()).toBe("GRüßE, JüRGEN ❤")
      expect(Str.toAsciiLowercase(s("GRÜßE")).toString()).toBe("grÜße")
      expect(Str.eqIgnoreAsciiCase(s("Ferris"), "FERRIS")).toBe(true)
      expect(Str.eqIgnoreAsciiCase(s("Ferrös"), "FERRöS")).toBe(true)
      expect(Str.eqIgnoreAsciiCase(s("Ferrös"), "FERRÖS")).toBe(false)
    })

    it("concat and join", () => {
      expect(Str.concat(s("ab"), "ç").toString()).toBe("abç")
      expect(Str.join([s("a"), "b", s("c")], ", ").toString()).toBe("a, b, c")
      expect(Str.join([]).toString()).toBe("")
    })
  })

  describe("instances", () => {
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
      const sorted = Arr.sort([s("\u{ff61}"), s("\u{1f600}"), s("a")], Str.Order)
      expect(text(sorted)).toEqual(["a", "\u{ff61}", "\u{1f600}"])
      expect(Str.Order(s("ab"), s("abc"))).toBe(-1)
      expect(Str.Order(s("abd"), s("abc"))).toBe(1)
      expect(Str.Order(s("abc"), s("abc"))).toBe(0)
      expect(Str.Equivalence(s("x"), s("x"))).toBe(true)
    })

    it("is inspectable", () => {
      expect(s("hi").toJSON()).toEqual({ _id: "Str", value: "hi" })
    })
  })
})
