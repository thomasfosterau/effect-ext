/**
 * ISO 8601 durations: the grammar and its profile, `format` and its `None`
 * cases, the round trip, and the `Schema`.
 */

import { describe, expect, it } from "vite-plus/test";
import { Effect, Option, Result, Schema } from "effect";
import { Parser } from "@thomasfosterau/effect-parse";
import { DateTime, IsoDuration } from "@thomasfosterau/effect-time";

const parse = (input: string) => Parser.parse(IsoDuration.parser, input);

// An unexpected success gives "", which no expectation below contains.
const failure = (input: string): string =>
  Result.match(parse(input), { onSuccess: () => "", onFailure: (error) => error.message });

describe("IsoDuration.parser", () => {
  it.each<[string, Partial<IsoDuration.IsoDuration>]>([
    ["P1Y2M3DT4H5M6S", { years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6 }],
    ["P2W", { weeks: 2 }],
    ["P1M", { months: 1 }],
    ["PT1M", { minutes: 1 }],
    ["P1D", { days: 1 }],
    ["PT36H", { hours: 36 }],
    ["PT90M", { minutes: 90 }],
    ["P0D", {}],
    ["PT0S", {}],
    ["PT1.5S", { seconds: 1, milliseconds: 500 }],
    ["PT1,25S", { seconds: 1, milliseconds: 250 }],
    ["PT0.0019S", { milliseconds: 1 }],
    ["P1DT12H", { days: 1, hours: 12 }],
    ["p1y2m3dt4h5m6s", { years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6 }],
    ["+P1D", { days: 1 }],
    ["-P1DT1.5S", { days: -1, seconds: -1, milliseconds: -500 }],
    ["-P3W", { weeks: -3 }],
  ])("parses %s", (input, expected) => {
    expect(Parser.parseSync(IsoDuration.parser, input)).toEqual({
      ...IsoDuration.zero,
      ...expected,
    });
  });

  it("never yields -0", () => {
    const duration = Parser.parseSync(IsoDuration.parser, "-P1D");
    expect(Object.is(duration.hours, 0)).toBe(true);
  });

  it.each([
    ["", '"P"'],
    ["1D", '"P"'],
    ["P", "duration amount"],
    ["PT", "number"],
    ["P1DT", "number"],
    ["P1W2D", "end of input"],
    ["P1D1Y", "end of input"],
    ["PT1H1D", '"S"'],
    ["P1.5D", '"W"'],
    ["PT1.5M", '"S"'],
    ["PT1.S", "digit"],
    ["P1X", '"W"'],
    ["P99999999999999999999D", "duration amount"],
  ])("rejects %s, expecting %s", (input, expected) => {
    expect(failure(input)).toContain(expected);
  });
});

describe("IsoDuration.parse", () => {
  it("succeeds with amounts DateTime.add applies", () =>
    Effect.runPromise(IsoDuration.parse("P1M")).then((duration) => {
      const next = DateTime.add(DateTime.makeUnsafe("2026-01-31T00:00:00Z"), duration);
      expect(DateTime.formatIso(next)).toBe("2026-02-28T00:00:00.000Z");
    }));

  it("fails with the ParseError", () =>
    Effect.runPromise(Effect.flip(IsoDuration.parse("P"))).then((error) => {
      expect(error._tag).toBe("ParseError");
    }));
});

describe("IsoDuration.format", () => {
  it.each<[Partial<IsoDuration.IsoDuration>, string]>([
    [{}, "PT0S"],
    [{ weeks: 2 }, "P2W"],
    [{ weeks: -2 }, "-P2W"],
    [{ weeks: 1, days: 2 }, "P9D"],
    [{ years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6 }, "P1Y2M3DT4H5M6S"],
    [{ hours: 1 }, "PT1H"],
    [{ milliseconds: 500 }, "PT0.5S"],
    [{ milliseconds: 1 }, "PT0.001S"],
    [{ seconds: 1, milliseconds: 1500 }, "PT2.5S"],
    [{ days: -1, hours: -2 }, "-P1DT2H"],
  ])("prints %o as %s", (duration, expected) => {
    expect(IsoDuration.format(duration)).toEqual(Option.some(expected));
  });

  it.each<[string, Partial<IsoDuration.IsoDuration>]>([
    ["mixed signs", { days: 1, hours: -1 }],
    ["a fraction", { hours: 1.5 }],
    ["an infinity", { days: Number.POSITIVE_INFINITY }],
    ["NaN", { seconds: Number.NaN }],
  ])("gives None for %s", (_, duration) => {
    expect(IsoDuration.format(duration)).toEqual(Option.none());
  });

  it.each(["P1Y2M3DT4H5M6.789S", "P2W", "-P1DT0.5S", "PT0S", "P1M", "PT1M"])(
    "round-trips %s",
    (input) => {
      expect(IsoDuration.format(Parser.parseSync(IsoDuration.parser, input))).toEqual(
        Option.some(input),
      );
    },
  );
});

describe("IsoDuration.FromString", () => {
  it("decodes a string to amounts", () => {
    expect(Schema.decodeSync(IsoDuration.FromString)("PT30S")).toEqual({
      ...IsoDuration.zero,
      seconds: 30,
    });
  });

  it("encodes amounts to a string", () => {
    expect(Schema.encodeSync(IsoDuration.FromString)({ ...IsoDuration.zero, days: 3 })).toBe("P3D");
  });

  it("reports the ParseError message as the issue", () => {
    expect(() => Schema.decodeSync(IsoDuration.FromString)("P1W2D")).toThrow(/end of input/);
  });

  it("fails to encode mixed signs", () => {
    expect(() =>
      Schema.encodeSync(IsoDuration.FromString)({ ...IsoDuration.zero, days: 1, hours: -1 }),
    ).toThrow(/mixed signs/);
  });
});
