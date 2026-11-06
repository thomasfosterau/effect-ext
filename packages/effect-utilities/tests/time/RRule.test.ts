/**
 * RFC 5545 recurrence rules: the parts and their defaults, RFC 5545's
 * examples, the range checks, the cross-part restrictions, duplicate parts,
 * and the `Schema` and `format` round trip.
 */

import { describe, expect, it } from "vite-plus/test";
import { Effect, Option, Result, Schema } from "effect";
import { Parser } from "@thomasfosterau/effect-parse";
import { RRule } from "@thomasfosterau/effect-time";

const parseSync = (input: string): RRule.RRule => Parser.parseSync(RRule.parser, input);

// An unexpected success gives "", which no expectation below contains.
const failure = (input: string): string =>
  Result.match(Parser.parse(RRule.parser, input), {
    onSuccess: () => "",
    onFailure: (error) => error.message,
  });

describe("RRule.parser", () => {
  it("fills in the defaults", () => {
    expect(parseSync("FREQ=DAILY")).toEqual({
      freq: "DAILY",
      until: Option.none(),
      count: Option.none(),
      interval: 1,
      bySecond: [],
      byMinute: [],
      byHour: [],
      byDay: [],
      byMonthDay: [],
      byYearDay: [],
      byWeekNo: [],
      byMonth: [],
      bySetPos: [],
      weekStart: "MO",
    });
  });

  it("reads every part", () => {
    const rule = parseSync(
      "FREQ=YEARLY;INTERVAL=2;COUNT=10;BYSECOND=0,60;BYMINUTE=30;BYHOUR=8,9;BYDAY=MO,-1SU,+2TU;BYMONTHDAY=1,-1;BYYEARDAY=1,-366;BYMONTH=1,12;BYSETPOS=-1;WKST=SU",
    );
    expect(rule.interval).toBe(2);
    expect(rule.count).toEqual(Option.some(10));
    expect(rule.bySecond).toEqual([0, 60]);
    expect(rule.byDay).toEqual([
      { ordinal: Option.none(), weekday: "MO" },
      { ordinal: Option.some(-1), weekday: "SU" },
      { ordinal: Option.some(2), weekday: "TU" },
    ]);
    expect(rule.byMonthDay).toEqual([1, -1]);
    expect(rule.byYearDay).toEqual([1, -366]);
    expect(rule.byMonth).toEqual([1, 12]);
    expect(rule.bySetPos).toEqual([-1]);
    expect(rule.weekStart).toBe("SU");
  });

  it("reads the UNTIL forms", () => {
    expect(parseSync("FREQ=DAILY;UNTIL=20261231").until).toEqual(
      Option.some({ year: 2026, month: 12, day: 31, time: Option.none() }),
    );
    expect(parseSync("FREQ=DAILY;UNTIL=20261231T235960Z").until).toEqual(
      Option.some({
        year: 2026,
        month: 12,
        day: 31,
        time: Option.some({ hour: 23, minute: 59, second: 60, utc: true }),
      }),
    );
    expect(
      Option.flatMap(parseSync("FREQ=DAILY;UNTIL=20240229T090000").until, (u) => u.time),
    ).toEqual(Option.some({ hour: 9, minute: 0, second: 0, utc: false }));
  });

  it.each([
    "FREQ=DAILY;COUNT=10",
    "FREQ=DAILY;UNTIL=19971224T000000Z",
    "FREQ=DAILY;INTERVAL=10;COUNT=5",
    "FREQ=YEARLY;UNTIL=20000131T140000Z;BYMONTH=1;BYDAY=SU,MO,TU,WE,TH,FR,SA",
    "FREQ=WEEKLY;UNTIL=19971007T000000Z;WKST=SU;BYDAY=TU,TH",
    "FREQ=MONTHLY;COUNT=10;BYDAY=1FR",
    "FREQ=MONTHLY;INTERVAL=2;COUNT=10;BYDAY=1SU,-1SU",
    "FREQ=MONTHLY;BYMONTHDAY=-3",
    "FREQ=YEARLY;BYDAY=20MO",
    "FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO",
    "FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13",
    "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2",
    "FREQ=HOURLY;INTERVAL=3;UNTIL=19970902T170000Z",
    "FREQ=MINUTELY;INTERVAL=20;BYHOUR=9,10,11,12,13,14,15,16",
    "FREQ=YEARLY;INTERVAL=4;BYMONTH=11;BYDAY=TU;BYMONTHDAY=2,3,4,5,6,7,8",
  ])("reads RFC 5545's example %s", (input) => {
    expect(Result.isSuccess(Parser.parse(RRule.parser, input))).toBe(true);
  });

  it("reads names and keywords in any case", () => {
    const rule = parseSync("freq=weekly;byday=mo,fr;wkst=su");
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.byDay.map((d) => d.weekday)).toEqual(["MO", "FR"]);
    expect(rule.weekStart).toBe("SU");
  });

  it("checks every value", () => {
    expect(failure("FREQ=FORTNIGHTLY")).toContain("frequency (SECONDLY");
    expect(failure("FREQ=DAILY;COUNT=0")).toContain("count (1 or more)");
    expect(failure("FREQ=DAILY;INTERVAL=0")).toContain("interval (1 or more)");
    expect(failure("FREQ=DAILY;UNTIL=20260230")).toContain("day of month (01-28)");
    expect(failure("FREQ=DAILY;UNTIL=20261301")).toContain("month (01-12)");
    expect(failure("FREQ=DAILY;UNTIL=20261231T240000Z")).toContain("hour (00-23)");
    expect(failure("FREQ=DAILY;BYSECOND=61")).toContain("second (0-60)");
    expect(failure("FREQ=DAILY;BYMINUTE=60")).toContain("minute (0-59)");
    expect(failure("FREQ=DAILY;BYHOUR=24")).toContain("hour (0-23)");
    expect(failure("FREQ=MONTHLY;BYMONTHDAY=0")).toContain("day of month (±1-31)");
    expect(failure("FREQ=MONTHLY;BYMONTHDAY=-32")).toContain("day of month (±1-31)");
    expect(failure("FREQ=YEARLY;BYYEARDAY=367")).toContain("day of year (±1-366)");
    expect(failure("FREQ=YEARLY;BYWEEKNO=54")).toContain("week number (±1-53)");
    expect(failure("FREQ=YEARLY;BYMONTH=13")).toContain("month (1-12)");
    expect(failure("FREQ=YEARLY;BYMONTH=1;BYSETPOS=0")).toContain("set position (±1-366)");
    expect(failure("FREQ=MONTHLY;BYDAY=54MO")).toContain("week ordinal (1-53)");
    expect(failure("FREQ=MONTHLY;BYDAY=XX")).toContain("weekday (SU");
    expect(failure("FREQ=DAILY;WKST=XX")).toContain("weekday (SU");
    expect(failure("FREQ=DAILY;FOO=1")).toContain("rule part (");
    expect(failure("FREQ=DAILY;")).toContain("rule part (");
  });

  it("rejects a repeated part where its value starts", () => {
    const message = failure("FREQ=DAILY;COUNT=2;COUNT=3");
    expect(message).toContain("COUNT appears more than once");
    expect(message).toContain("column 26");
  });

  it("enforces RFC 5545's cross-part restrictions", () => {
    expect(failure("COUNT=3")).toContain("FREQ is required");
    expect(failure("FREQ=DAILY;COUNT=3;UNTIL=20261231")).toContain(
      "UNTIL and COUNT cannot both be given",
    );
    expect(failure("FREQ=WEEKLY;BYDAY=1MO")).toContain("BYDAY ordinals");
    expect(failure("FREQ=YEARLY;BYWEEKNO=1;BYDAY=1MO")).toContain("BYDAY ordinals");
    expect(failure("FREQ=WEEKLY;BYMONTHDAY=1")).toContain(
      "BYMONTHDAY cannot be used with FREQ=WEEKLY",
    );
    expect(failure("FREQ=MONTHLY;BYYEARDAY=1")).toContain("BYYEARDAY cannot be used");
    expect(failure("FREQ=MONTHLY;BYWEEKNO=1")).toContain("BYWEEKNO needs FREQ=YEARLY");
    expect(failure("FREQ=MONTHLY;BYSETPOS=1")).toContain("BYSETPOS needs another BY… part");
  });
});

describe("RRule.parse", () => {
  it("fails with a ParseError", () =>
    Effect.runPromise(Effect.flip(RRule.parse("FREQ=DAILY;COUNT=x"))).then((error) => {
      expect(error._tag).toBe("ParseError");
    }));
});

describe("RRule.format", () => {
  it.each([
    "FREQ=DAILY",
    "FREQ=DAILY;UNTIL=19971224T000000Z",
    "FREQ=DAILY;UNTIL=20240229",
    "FREQ=DAILY;UNTIL=20240229T090000",
    "FREQ=WEEKLY;COUNT=10;INTERVAL=2;BYDAY=TU,TH;WKST=SU",
    "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2",
    "FREQ=YEARLY;BYSECOND=0;BYMINUTE=0;BYHOUR=9;BYDAY=-1SU;BYMONTHDAY=1;BYYEARDAY=-1;BYMONTH=3;BYSETPOS=1",
  ])("prints %s back as it was written", (input) => {
    expect(RRule.format(parseSync(input))).toBe(input);
  });

  it("puts FREQ first and leaves out defaults, case and +", () => {
    expect(RRule.format(parseSync("count=3;byday=+1mo;freq=monthly;interval=1;wkst=MO"))).toBe(
      "FREQ=MONTHLY;COUNT=3;BYDAY=1MO",
    );
  });
});

describe("RRule.FromString", () => {
  it("decodes and encodes", () => {
    const rule = Schema.decodeSync(RRule.FromString)("FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU");
    expect(rule.byMonth).toEqual([3]);
    expect(Schema.encodeSync(RRule.FromString)(rule)).toBe("FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3");
  });

  it("reports the parse error as an issue", () => {
    expect(() => Schema.decodeSync(RRule.FromString)("FREQ=DAILY;COUNT=1;UNTIL=20260101")).toThrow(
      /UNTIL and COUNT/,
    );
  });
});
