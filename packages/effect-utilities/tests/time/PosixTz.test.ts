/**
 * POSIX TZ strings: designations, the offset sign convention, the defaults
 * POSIX specifies, the three rule date forms, RFC 8536's extended
 * transition times, the errors, and the `Schema` and `format` round trip.
 */

import { describe, expect, it } from "vite-plus/test";
import { Effect, Option, Result, Schema } from "effect";
import { Parser } from "@thomasfosterau/effect-parse";
import { PosixTz } from "@thomasfosterau/effect-time";

const parseSync = (input: string): PosixTz.PosixTz => Parser.parseSync(PosixTz.parser, input);

// An unexpected success gives "", which no expectation below contains.
const failure = (input: string): string =>
  Result.match(Parser.parse(PosixTz.parser, input), {
    onSuccess: () => "",
    onFailure: (error) => error.message,
  });

const HOUR = 3600;

describe("PosixTz.parser", () => {
  it("reads a zone without daylight saving time", () => {
    expect(parseSync("JST-9")).toEqual({
      std: { name: "JST", utcOffset: 9 * HOUR },
      dst: Option.none(),
      rule: Option.none(),
    });
  });

  it("stores offsets east-positive, the opposite of how POSIX writes them", () => {
    expect(parseSync("EST5").std.utcOffset).toBe(-5 * HOUR);
    expect(parseSync("EST+5").std.utcOffset).toBe(-5 * HOUR);
    expect(parseSync("IST-5:30").std.utcOffset).toBe(5 * HOUR + 30 * 60);
    expect(parseSync("XXX-1:02:03").std.utcOffset).toBe(HOUR + 2 * 60 + 3);
    expect(parseSync("UTC0").std.utcOffset).toBe(0);
  });

  it("reads US Eastern time with its rule", () => {
    expect(parseSync("EST5EDT,M3.2.0,M11.1.0")).toEqual({
      std: { name: "EST", utcOffset: -5 * HOUR },
      dst: Option.some({ name: "EDT", utcOffset: -4 * HOUR }),
      rule: Option.some({
        start: { date: { _tag: "MonthWeekDay", month: 3, week: 2, weekday: 0 }, time: 2 * HOUR },
        end: { date: { _tag: "MonthWeekDay", month: 11, week: 1, weekday: 0 }, time: 2 * HOUR },
      }),
    });
  });

  it("puts daylight time one hour ahead when its offset is left out", () => {
    const tz = parseSync("AEST-10AEDT,M10.1.0,M4.1.0/3");
    expect(tz.dst).toEqual(Option.some({ name: "AEDT", utcOffset: 11 * HOUR }));
    expect(Option.map(tz.rule, (r) => r.end.time)).toEqual(Option.some(3 * HOUR));
  });

  it("reads an explicit daylight offset", () => {
    const tz = parseSync("<+1030>-10:30<+11>-11,M10.1.0,M4.1.0");
    expect(tz.std).toEqual({ name: "+1030", utcOffset: 10.5 * HOUR });
    expect(tz.dst).toEqual(Option.some({ name: "+11", utcOffset: 11 * HOUR }));
  });

  it("leaves the rule to the caller when the string has none", () => {
    const tz = parseSync("EST5EDT");
    expect(Option.isSome(tz.dst)).toBe(true);
    expect(tz.rule).toEqual(Option.none());
  });

  it("reads the Julian date forms", () => {
    const tz = parseSync("ABC3DEF,J60/1:30,300/-1");
    expect(tz.rule).toEqual(
      Option.some({
        start: { date: { _tag: "JulianNoLeap", day: 60 }, time: HOUR + 30 * 60 },
        end: { date: { _tag: "Julian", day: 300 }, time: -HOUR },
      }),
    );
  });

  it("reads RFC 8536's extended transition times", () => {
    // RFC 8536 §3.3.1's examples
    const greenland = parseSync("<-03>3<-02>,M3.5.0/-2,M10.5.0/-1");
    expect(Option.map(greenland.rule, (r) => [r.start.time, r.end.time])).toEqual(
      Option.some([-2 * HOUR, -HOUR]),
    );
    const allYear = parseSync("EST5EDT,0/0,J365/25");
    expect(Option.map(allYear.rule, (r) => r.end.time)).toEqual(Option.some(25 * HOUR));
    expect(
      Option.map(parseSync("XXX3YYY,M3.5.0/167,M10.5.0/-167").rule, (r) => r.start.time),
    ).toEqual(Option.some(167 * HOUR));
  });

  it("rejects malformed strings with a positioned message", () => {
    expect(failure("ES5")).toContain("time zone abbreviation");
    expect(failure("EST")).toContain("UTC offset");
    expect(failure("EST25")).toContain("UTC offset");
    expect(failure("EST5:60")).toContain("minutes (00-59)");
    expect(failure("<AB>5")).toContain("at least three");
    expect(failure("EST5EDT,M13.1.0,M11.1.0")).toContain("month (1-12)");
    expect(failure("EST5EDT,M3.6.0,M11.1.0")).toContain("week (1-5)");
    expect(failure("EST5EDT,M3.2.7,M11.1.0")).toContain("weekday (0-6)");
    expect(failure("EST5EDT,J0,J365")).toContain("Julian day (1-365)");
    expect(failure("EST5EDT,366,0")).toContain("transition date");
    expect(failure("EST5EDT,M3.2.0/168,M11.1.0")).toContain("transition time");
    expect(failure("EST5EDT,M3.2.0")).toContain(`expected digit, "/" or ","`);
    expect(failure(":Europe/Paris")).toContain("time zone abbreviation");
  });
});

describe("PosixTz.parse", () => {
  it("fails with a ParseError on trailing input", () =>
    Effect.runPromise(Effect.flip(PosixTz.parse("JST-9 "))).then((error) => {
      expect(error._tag).toBe("ParseError");
    }));
});

describe("PosixTz.format", () => {
  it.each([
    "JST-9",
    "EST5",
    "EST5EDT",
    "EST5EDT,M3.2.0,M11.1.0",
    "AEST-10AEDT,M10.1.0,M4.1.0/3",
    "<+1030>-10:30<+11>-11,M10.1.0,M4.1.0",
    "<-03>3<-02>,M3.5.0/-2,M10.5.0/-1",
    "ABC3DEF,J60/1:30,300/-1",
    "XXX-1:02:03",
    "IST-5:30",
    "UTC0",
  ])("prints %s back as it was written", (input) => {
    expect(PosixTz.format(parseSync(input))).toBe(input);
  });

  it("leaves out defaults and an explicit + sign", () => {
    expect(PosixTz.format(parseSync("EST+05:00EDT+04,M3.2.0/02:00,M11.1.0/2"))).toBe(
      "EST5EDT,M3.2.0,M11.1.0",
    );
    expect(PosixTz.format(parseSync("<ABC>5"))).toBe("ABC5");
  });
});

describe("PosixTz.FromString", () => {
  it("decodes and encodes", () => {
    const decode = Schema.decodeSync(PosixTz.FromString);
    const tz = decode("CET-1CEST,M3.5.0,M10.5.0/3");
    expect(tz.std.utcOffset).toBe(HOUR);
    expect(Schema.encodeSync(PosixTz.FromString)(tz)).toBe("CET-1CEST,M3.5.0,M10.5.0/3");
  });

  it("reports the parse error as an issue", () => {
    expect(() => Schema.decodeSync(PosixTz.FromString)("EST")).toThrow(/UTC offset/);
  });
});
