/**
 * RFC 9557 (IXDTF): the suffix grammar, the critical-flag rules of §3.4, the
 * resolution of the time zone suffix, and the `Schema` round trip.
 */

import { describe, expect, it } from "vite-plus/test";
import { Effect, Option, Result, Schema } from "effect";
import { Parser } from "@thomasfosterau/effect-parse";
import { DateTime, Rfc3339, Rfc9557 } from "@thomasfosterau/effect-time";

const parse = (input: string) => Parser.parse(Rfc9557.parser, input);

const parseSync = (input: string): Rfc9557.Ixdtf => Parser.parseSync(Rfc9557.parser, input);

// An unexpected success gives "", which no expectation below contains.
const failure = (input: string): string =>
  Result.match(parse(input), { onSuccess: () => "", onFailure: (error) => error.message });

describe("Rfc9557.parser", () => {
  it("reads a plain RFC 3339 date-time with no suffixes", () => {
    const ixdtf = parseSync("2026-10-22T09:30:00Z");
    expect(DateTime.formatIso(ixdtf.dateTime)).toBe("2026-10-22T09:30:00.000Z");
    expect(Option.isNone(ixdtf.timeZone)).toBe(true);
    expect(ixdtf.annotations).toEqual([]);
  });

  it("reads the RFC 9557 examples", () => {
    const paris = parseSync("1996-12-19T16:39:57-08:00[America/Los_Angeles]");
    expect(paris.timeZone).toEqual(Option.some({ name: "America/Los_Angeles", critical: false }));
    expect(DateTime.formatIso(paris.dateTime)).toBe("1996-12-20T00:39:57.000Z");

    const hebrew = parseSync("1996-12-19T16:39:57-08:00[America/Los_Angeles][u-ca=hebrew]");
    expect(hebrew.annotations).toEqual([{ key: "u-ca", values: ["hebrew"], critical: false }]);

    const experimental = parseSync("1996-12-19T16:39:57-08:00[_foo=bar][_baz=bat]");
    expect(Option.isNone(experimental.timeZone)).toBe(true);
    expect(experimental.annotations).toEqual([
      { key: "_foo", values: ["bar"], critical: false },
      { key: "_baz", values: ["bat"], critical: false },
    ]);
  });

  it("reads critical flags, offset time zones and multi-part values", () => {
    const ixdtf = parseSync("2026-10-22T09:30:00+05:30[!+05:30][!u-ca=islamic-umalqura]");
    expect(ixdtf.timeZone).toEqual(Option.some({ name: "+05:30", critical: true }));
    expect(ixdtf.annotations).toEqual([
      { key: "u-ca", values: ["islamic", "umalqura"], critical: true },
    ]);
  });

  it("keeps an elective time zone that is unknown or inconsistent", () => {
    expect(parseSync("2026-10-22T09:30:00Z[Mars/Olympus_Mons]").timeZone).toEqual(
      Option.some({ name: "Mars/Olympus_Mons", critical: false }),
    );
    // Sydney is +11:00 on that date, not +10:00.
    const inconsistent = parseSync("2026-10-22T09:30:00+10:00[Australia/Sydney]");
    expect(DateTime.formatIso(inconsistent.dateTime)).toBe("2026-10-21T23:30:00.000Z");
  });

  it("accepts a critical time zone that agrees with the offset, or after Z", () => {
    expect(Result.isSuccess(parse("2026-10-22T09:30:00+11:00[!Australia/Sydney]"))).toBe(true);
    expect(Result.isSuccess(parse("2026-10-22T09:30:00Z[!Australia/Sydney]"))).toBe(true);
    expect(Result.isSuccess(parse("2026-10-22T09:30:00-00:00[!Australia/Sydney]"))).toBe(true);
  });

  it.each([
    ["2026-10-22T09:30:00+10:00[!Australia/Sydney]", "inconsistent with the critical time zone"],
    ["2026-10-22T09:30:00Z[!Mars/Olympus_Mons]", 'unknown time zone "Mars/Olympus_Mons"'],
    ["2026-10-22T09:30:00Z[+25:00]", "time zone offset (±hh:mm)"],
    ["2026-10-22T09:30:00Z[+05:60]", "time zone offset (±hh:mm)"],
    [
      "2026-10-22T09:30:00Z[u-ca=hebrew][Europe/Paris]",
      'expected "!" or annotation key, found "E"',
    ],
    [
      "2026-10-22T09:30:00Z[Europe/Paris][Europe/Rome]",
      'expected "!" or annotation key, found "E"',
    ],
    ["2026-10-22T09:30:00Z[U-CA=hebrew]", 'expected "/" or "]", found "="'],
    ["2026-10-22T09:30:00Z[u-ca=]", "annotation value"],
    ["2026-10-22T09:30:00Z[u-ca=a--b]", "annotation value"],
    ["2026-10-22T09:30:00Z[Europe/.]", "time zone name part"],
    ["2026-10-22T09:30:00Z[]", 'expected "!" or annotation key, found "]"'],
    ["2026-10-22T09:30:00Z[Europe/Paris", "end of input"],
    ["2026-02-30T09:30:00Z[Europe/Paris]", "day of month (01-28)"],
  ])("rejects %s, expecting %s", (input, expected) => {
    expect(failure(input)).toContain(expected);
  });
});

describe("Rfc9557.parse", () => {
  it("succeeds with the Ixdtf", () =>
    Effect.runPromise(Rfc9557.parse("2026-10-22T09:30:00Z[!Europe/Paris]")).then((ixdtf) => {
      expect(ixdtf.timeZone).toEqual(Option.some({ name: "Europe/Paris", critical: true }));
    }));

  it("fails with the ParseError", () =>
    Effect.runPromise(
      Effect.flip(Rfc9557.parse("2026-10-22T09:30:00+10:00[!Australia/Sydney]")),
    ).then((error) => {
      expect(error._tag).toBe("ParseError");
      expect(error.message).toContain(
        'offset +10:00 is inconsistent with the critical time zone "Australia/Sydney" (+11:00 at that instant)',
      );
    }));
});

describe("Rfc9557.toDateTime", () => {
  it("views the instant in a named time zone", () => {
    const dt = Rfc9557.toDateTime(parseSync("2026-10-22T00:00:00Z[Australia/Sydney]"));
    expect(Rfc3339.format(dt)).toBe("2026-10-22T11:00:00.000+11:00");
    expect(DateTime.isZoned(dt) && DateTime.zoneToString(dt.zone)).toBe("Australia/Sydney");
  });

  it("views the instant in an offset time zone", () => {
    const dt = Rfc9557.toDateTime(parseSync("2026-10-22T00:00:00Z[+05:30]"));
    expect(Rfc3339.format(dt)).toBe("2026-10-22T05:30:00.000+05:30");
  });

  it("keeps the instant as written without a known time zone", () => {
    expect(Rfc3339.format(Rfc9557.toDateTime(parseSync("2026-10-22T00:00:00+10:00")))).toBe(
      "2026-10-22T00:00:00.000+10:00",
    );
    expect(
      Rfc3339.format(Rfc9557.toDateTime(parseSync("2026-10-22T00:00:00+10:00[Mars/Olympus_Mons]"))),
    ).toBe("2026-10-22T00:00:00.000+10:00");
  });
});

describe("Rfc9557.format", () => {
  it.each([
    "2026-10-22T09:30:00.000Z",
    "2026-10-22T09:30:00.000Z[Europe/Paris]",
    "2026-10-22T09:30:00.000+11:00[!Australia/Sydney][u-ca=gregory]",
    "2026-10-22T09:30:00.000+05:30[+05:30][!_x-key=a-b-c][u-ca=hebrew]",
  ])("round-trips %s", (input) => {
    expect(Rfc9557.format(parseSync(input))).toBe(input);
  });
});

describe("Rfc9557.FromString", () => {
  it("decodes and encodes", () => {
    const input = "2026-10-22T09:30:00.000+11:00[Australia/Sydney][u-ca=gregory]";
    const ixdtf = Schema.decodeSync(Rfc9557.FromString)(input);
    expect(ixdtf.annotations).toEqual([{ key: "u-ca", values: ["gregory"], critical: false }]);
    expect(Schema.encodeSync(Rfc9557.FromString)(ixdtf)).toBe(input);
  });

  it("reports a parse failure as a decoding issue", () => {
    expect(() => Schema.decodeSync(Rfc9557.FromString)("2026-10-22T09:30:00Z[!Nowhere]")).toThrow(
      'unknown time zone "Nowhere"',
    );
  });
});
