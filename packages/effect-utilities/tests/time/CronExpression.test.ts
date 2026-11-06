/**
 * Cron expressions: agreement with `Cron.parse` on valid input, the macros,
 * names, steps and the day-of-month / day-of-week rule, positioned errors,
 * the time zone, and the `Schema` round trip.
 */

import { describe, expect, it } from "vite-plus/test";
import { Cron, DateTime, Effect, Equal, Result, Schema } from "effect";
import { Parser } from "@thomasfosterau/effect-parse";
import { CronExpression } from "@thomasfosterau/effect-time";

const parseSync = (input: string): Cron.Cron => Parser.parseSync(CronExpression.parser, input);

// An unexpected success gives "", which no expectation below contains.
const failure = (input: string): string =>
  Result.match(Parser.parse(CronExpression.parser, input), {
    onSuccess: () => "",
    onFailure: (error) => error.message,
  });

describe("CronExpression.parser", () => {
  it.each([
    "* * * * *",
    "0 0 * * *",
    "30 9 * * 1-5",
    "*/15 9-17 * * mon-fri",
    "0 0 1,15 * *",
    "0 0 1 jan,jul *",
    "5 4 * * sun",
    "0 12 * * 7",
    "0 0 */2 * 1",
    "0 0 1-7 * 1",
    "0 0 13 * fri",
    "10-50/10 * * * *",
    "5/20 * * * *",
    "*/2,5 * * * *",
    "*,5 * * * *",
    "0 0 * DEC-dec SAT",
    "15 30 9 * * *",
    "*/10 * * * * *",
    "0\t0\t*  *  *",
  ])("agrees with Cron.parse on %s", (input) => {
    expect(Equal.equals(parseSync(input), Cron.parseUnsafe(input))).toBe(true);
  });

  it("matches either day field when both are restricted, both when one starts with *", () => {
    const either = parseSync("0 0 13 * 5");
    expect(Cron.match(either, DateTime.makeUnsafe("2026-11-13T00:00:00Z"))).toBe(true); // a Friday the 13th
    expect(Cron.match(either, DateTime.makeUnsafe("2026-11-06T00:00:00Z"))).toBe(true); // a Friday
    expect(Cron.match(either, DateTime.makeUnsafe("2026-12-13T00:00:00Z"))).toBe(true); // a Sunday the 13th
    const both = parseSync("0 0 */2 * 5");
    expect(Cron.match(both, DateTime.makeUnsafe("2026-11-13T00:00:00Z"))).toBe(true); // odd day, Friday
    expect(Cron.match(both, DateTime.makeUnsafe("2026-11-06T00:00:00Z"))).toBe(false); // even day, Friday
  });

  it("expands the macros", () => {
    const expand = [
      ["@yearly", "0 0 1 1 *"],
      ["@annually", "0 0 1 1 *"],
      ["@monthly", "0 0 1 * *"],
      ["@weekly", "0 0 * * 0"],
      ["@daily", "0 0 * * *"],
      ["@MIDNIGHT", "0 0 * * *"],
      ["@hourly", "0 * * * *"],
    ] as const;
    expand.forEach(([macro, fields]) => {
      expect(Equal.equals(parseSync(macro), Cron.parseUnsafe(fields))).toBe(true);
    });
  });

  it("points at what is wrong", () => {
    expect(failure("60 * * * *")).toContain("minute (0-59)");
    expect(failure("0 24 * * *")).toContain("hour (0-23)");
    expect(failure("0 0 0 * *")).toContain("day of month (1-31)");
    expect(failure("0 0 * 13 *")).toContain("month (1-12 or jan");
    expect(failure("0 0 * foo *")).toContain("month (1-12 or jan");
    expect(failure("0 0 * * 8")).toContain("day of week (0-7 or sun");
    expect(failure("0 0 * * 5-1")).toContain("end of the day of week range (5-7)");
    expect(failure("*/0 * * * *")).toContain("step (1-59)");
    expect(failure("0 0 * *")).toContain("5 or 6 fields, found 4");
    expect(failure("0 0 0 * * * *")).toContain("5 or 6 fields, found 7");
    expect(failure("@reboot")).toContain("@yearly");
    expect(failure("0 0 * * MON?")).toContain("end of input");
    expect(failure("0 0 L * *")).toContain("day of month");
  });

  it("reports the column of the field", () => {
    expect(failure("0 0 * 13 *")).toContain("column 7");
  });
});

describe("CronExpression.parse", () => {
  it("attaches the time zone", () =>
    Effect.runPromise(
      CronExpression.parseIn("0 9 * * MON-FRI", DateTime.zoneMakeNamedUnsafe("Australia/Sydney")),
    ).then((cron) => {
      expect(Cron.next(cron, DateTime.makeUnsafe("2026-10-24T00:00:00Z")).toISOString()).toBe(
        "2026-10-25T22:00:00.000Z",
      );
    }));

  it("fails with a ParseError", () =>
    Effect.runPromise(Effect.flip(CronExpression.parse("0 25 * * *"))).then((error) => {
      expect(error._tag).toBe("ParseError");
      expect(error.message).toContain("hour (0-23)");
    }));
});

describe("CronExpression.format", () => {
  it("prints with Cron.format", () => {
    expect(CronExpression.format(parseSync("*/15 9-17 * * mon-fri"))).toBe("0-45/15 9-17 * * 1-5");
    expect(CronExpression.format(parseSync("@weekly"))).toBe("0 0 * * 0");
    expect(CronExpression.format(parseSync("15 30 9 * * *"))).toBe("15 30 9 * * *");
  });
});

describe("CronExpression.FromString", () => {
  it("decodes and encodes", () => {
    const cron = Schema.decodeSync(CronExpression.FromString)("0 3 * * SUN");
    expect(Equal.equals(cron, Cron.parseUnsafe("0 3 * * 0"))).toBe(true);
    expect(Schema.encodeSync(CronExpression.FromString)(cron)).toBe("0 3 * * 0");
  });

  it("reports the parse error as an issue", () => {
    expect(() => Schema.decodeSync(CronExpression.FromString)("0 0 * * 8")).toThrow(/day of week/);
  });
});
