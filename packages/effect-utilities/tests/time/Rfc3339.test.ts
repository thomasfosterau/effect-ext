/**
 * RFC 3339 date-times: the grammar, the calendar and clock ranges, the
 * offset → `Utc` / `Zoned` mapping, and the `Schema` round trip.
 */

import { assert, describe, expect, it } from "vite-plus/test";
import { Effect, Result, Schema } from "effect";
import { Parser } from "@thomasfosterau/effect-parse";
import { DateTime, Rfc3339 } from "@thomasfosterau/effect-time";

const parse = (input: string) => Parser.parse(Rfc3339.parser, input);

const iso = (input: string): string => DateTime.formatIso(Parser.parseSync(Rfc3339.parser, input));

// An unexpected success gives "", which no expectation below contains.
const failure = (input: string): string =>
  Result.match(parse(input), { onSuccess: () => "", onFailure: (error) => error.message });

describe("Rfc3339.parser", () => {
  it.each([
    ["1985-04-12T23:20:50.52Z", "1985-04-12T23:20:50.520Z"],
    ["1996-12-19T16:39:57-08:00", "1996-12-20T00:39:57.000Z"],
    ["1990-12-31T15:59:59-08:00", "1990-12-31T23:59:59.000Z"],
    ["1937-01-01T12:00:27.87+00:20", "1937-01-01T11:40:27.870Z"],
    ["2026-10-22t09:30:00z", "2026-10-22T09:30:00.000Z"],
    ["2026-10-22 09:30:00Z", "2026-10-22T09:30:00.000Z"],
    ["2026-10-22T09:30:00.123456789Z", "2026-10-22T09:30:00.123Z"],
    ["2026-10-22T09:30:00.9999Z", "2026-10-22T09:30:00.999Z"],
    ["0001-01-01T00:00:00Z", "0001-01-01T00:00:00.000Z"],
    ["0050-06-15T00:00:00Z", "0050-06-15T00:00:00.000Z"],
    ["9999-12-31T23:59:59.999Z", "9999-12-31T23:59:59.999Z"],
    ["2028-02-29T00:00:00Z", "2028-02-29T00:00:00.000Z"],
    ["2000-02-29T00:00:00Z", "2000-02-29T00:00:00.000Z"],
  ])("parses %s as the instant %s", (input, expected) => {
    expect(iso(input)).toBe(expected);
  });

  it("gives a Utc for Z and -00:00, a Zoned in a fixed offset otherwise", () => {
    const utc = Parser.parseSync(Rfc3339.parser, "2026-10-22T09:30:00Z");
    const unknownOffset = Parser.parseSync(Rfc3339.parser, "2026-10-22T09:30:00-00:00");
    const zeroOffset = Parser.parseSync(Rfc3339.parser, "2026-10-22T09:30:00+00:00");
    const zoned = Parser.parseSync(Rfc3339.parser, "2026-10-22T09:30:00+10:00");

    expect(DateTime.isUtc(utc)).toBe(true);
    expect(DateTime.isUtc(unknownOffset)).toBe(true);
    expect(DateTime.isZoned(zeroOffset)).toBe(true);
    expect(DateTime.isZoned(zoned)).toBe(true);
    assert(DateTime.isZoned(zoned));
    expect(zoned.zone).toEqual(DateTime.zoneMakeOffset(10 * 60 * 60 * 1000));
  });

  it.each([
    ["2026-13-01T00:00:00Z", "month (01-12)"],
    ["2026-00-01T00:00:00Z", "month (01-12)"],
    ["2026-02-29T00:00:00Z", "day of month (01-28)"],
    ["1900-02-29T00:00:00Z", "day of month (01-28)"],
    ["2026-04-31T00:00:00Z", "day of month (01-30)"],
    ["2026-10-32T00:00:00Z", "day of month (01-31)"],
    ["2026-10-22T24:00:00Z", "hour (00-23)"],
    ["2026-10-22T09:60:00Z", "minute (00-59)"],
    ["2026-12-31T23:59:60Z", "second (00-59)"],
    ["2026-10-22T09:30:00+24:00", "offset hours (00-23)"],
    ["2026-10-22T09:30:00+10:60", "offset minutes (00-59)"],
    ["2026-10-22T09:30:00", 'offset ("Z" or ±hh:mm)'],
    ["2026-10-22T09:30:00+1000", "offset hours (00-23)"],
    ["2026-10-22T9:30:00Z", "hour (00-23)"],
    ["2026-10-22X09:30:00Z", '"T"'],
    ["26-10-22T09:30:00Z", "year (4 digits)"],
    ["2026-10-22T09:30Z", '":"'],
    ["2026-10-22T09:30:00.Z", "digit"],
    ["2026-10-22T09:30:00Z trailing", "end of input"],
    ["", "year (4 digits)"],
  ])("rejects %s, expecting %s", (input, expected) => {
    expect(failure(input)).toContain(expected);
  });

  it("points the error at the field out of range", () => {
    const result = parse("2026-02-30T00:00:00Z");
    expect(Result.isFailure(result) && result.failure.offset).toBe(8);
  });
});

describe("Rfc3339.parse", () => {
  it("succeeds with the DateTime", () =>
    Effect.runPromise(Rfc3339.parse("2026-10-22T09:30:00+10:00")).then((dt) => {
      expect(DateTime.formatIso(dt)).toBe("2026-10-21T23:30:00.000Z");
    }));

  it("fails with the ParseError", () =>
    Effect.runPromise(Effect.flip(Rfc3339.parse("2026-02-30T00:00:00Z"))).then((error) => {
      expect(error._tag).toBe("ParseError");
      expect(error.message).toContain("day of month (01-28)");
    }));
});

describe("Rfc3339.format", () => {
  it("prints Z for a Utc", () => {
    expect(Rfc3339.format(DateTime.makeUnsafe("2026-10-22T09:30:00Z"))).toBe(
      "2026-10-22T09:30:00.000Z",
    );
  });

  it("prints the offset of a Zoned, named zones included", () => {
    const sydney = DateTime.makeZonedUnsafe("2026-10-22T00:00:00Z", {
      timeZone: "Australia/Sydney",
    });
    expect(Rfc3339.format(sydney)).toBe("2026-10-22T11:00:00.000+11:00");
  });

  it.each([
    "2026-10-22T09:30:00.000Z",
    "2026-10-22T09:30:00.000+10:00",
    "2026-10-22T09:30:00.000-03:30",
    "2026-10-22T09:30:00.000+00:00",
  ])("round-trips %s", (input) => {
    expect(Rfc3339.format(Parser.parseSync(Rfc3339.parser, input))).toBe(input);
  });
});

describe("Rfc3339.FromString", () => {
  it("decodes a string to a DateTime", () => {
    const dt = Schema.decodeSync(Rfc3339.FromString)("2026-10-22T09:30:00+10:00");
    expect(DateTime.formatIso(dt)).toBe("2026-10-21T23:30:00.000Z");
  });

  it("encodes a DateTime to a string", () => {
    const dt = DateTime.makeZonedUnsafe("2026-10-22T09:30:00Z", { timeZone: 10 * 60 * 60 * 1000 });
    expect(Schema.encodeSync(Rfc3339.FromString)(dt)).toBe("2026-10-22T19:30:00.000+10:00");
  });

  it("reports the ParseError message as the issue", () => {
    expect(() => Schema.decodeSync(Rfc3339.FromString)("2026-02-30T00:00:00Z")).toThrow(
      /day of month \(01-28\)/,
    );
  });

  it("rejects a non-string", () => {
    expect(() => Schema.decodeUnknownSync(Rfc3339.FromString)(1_700_000_000_000)).toThrow(
      /Expected string/,
    );
  });
});
