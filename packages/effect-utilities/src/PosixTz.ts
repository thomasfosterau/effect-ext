/**
 * POSIX TZ strings (`EST5EDT,M3.2.0,M11.1.0`, `<+1030>-10:30<+11>-11,M10.1.0,M4.1.0`):
 * the `TZ` environment variable format of POSIX.1-2017 §8.3, which is also
 * the footer of a TZif file (RFC 8536 §3.3), as a parser, a decoder, a
 * printer and a `Schema`.
 *
 * @since 0.1.0
 */
import * as Ascii from "@thomasfosterau/effect-parse/Ascii";
import type * as ParseError from "@thomasfosterau/effect-parse/ParseError";
import * as Parser from "@thomasfosterau/effect-parse/Parser";
import * as ParserSchema from "@thomasfosterau/effect-parse/ParserSchema";
import * as Token from "@thomasfosterau/effect-parse/Token";
import type * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

/**
 * A time zone designation: its abbreviation (`EST`, or `+1030` for one
 * written in angle brackets, without the brackets) and its offset from UTC
 * in seconds, **positive east of Greenwich** (`EST` is `-18000`).
 *
 * POSIX writes the offset with the opposite sign (`EST5` is five hours
 * *behind* UTC); the parser and {@link format} convert, so `utcOffset` is
 * what to add to UTC to get local time, as in ISO 8601 and `DateTime`.
 *
 * @category models
 * @since 0.1.0
 */
export interface Designation {
  readonly name: string;
  readonly utcOffset: number;
}

/**
 * The day of the year a transition happens on:
 *
 * - `JulianNoLeap` (`Jn`): `day` 1–365, never counting February 29, so day 60
 *   is always March 1.
 * - `Julian` (`n`): `day` 0–365, counting February 29 in leap years.
 * - `MonthWeekDay` (`Mm.w.d`): `weekday` (0 = Sunday … 6 = Saturday) of
 *   `week` 1–4 of `month` 1–12, where `week` 5 means the last such weekday of
 *   the month.
 *
 * @category models
 * @since 0.1.0
 */
export type DateRule =
  | { readonly _tag: "JulianNoLeap"; readonly day: number }
  | { readonly _tag: "Julian"; readonly day: number }
  | {
      readonly _tag: "MonthWeekDay";
      readonly month: number;
      readonly week: number;
      readonly weekday: number;
    };

/**
 * One transition of a rule: its {@link DateRule} and the local time it
 * happens at, in seconds after local midnight (default `7200`, 02:00).
 *
 * The time may be negative or past 24 hours, from -167 to 167 hours, as
 * RFC 8536 §3.3.1 allows for TZif footers (`<-03>3<-02>,M3.5.0/-2,M10.5.0/-1`).
 *
 * @category models
 * @since 0.1.0
 */
export interface Transition {
  readonly date: DateRule;
  readonly time: number;
}

/**
 * When daylight saving time starts and ends, each in the local time in
 * force just before it (standard time for `start`, daylight time for `end`).
 *
 * @category models
 * @since 0.1.0
 */
export interface Rule {
  readonly start: Transition;
  readonly end: Transition;
}

/**
 * A parsed POSIX TZ string: the standard time designation, then, for a zone
 * with daylight saving time, its designation and the rule for when it
 * applies.
 *
 * - `dst` is `None` for a zone with no daylight saving time (`JST-9`).
 * - A daylight designation with no written offset is one hour ahead of
 *   standard time, as POSIX specifies.
 * - `rule` is `None` when the string names a daylight designation but no
 *   rule (`EST5EDT`), whose rule POSIX leaves to the implementation; it is
 *   always `None` when `dst` is.
 *
 * @category models
 * @since 0.1.0
 */
export interface PosixTz {
  readonly std: Designation;
  readonly dst: Option.Option<Designation>;
  readonly rule: Option.Option<Rule>;
}

const HOUR = 3600;
const MINUTE = 60;
const DEFAULT_TRANSITION_TIME = 2 * HOUR;

const isAlpha = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isQuotedChar = (c: string): boolean => isAlpha(c) || isDigit(c) || c === "+" || c === "-";

// `std` / `dst`: three or more letters, or three or more letters, digits,
// `+` and `-` between angle brackets.
// The length is checked on the whole run, so a short one fails at its start.
const name: Parser.Parser<string> = Parser.alt(
  Token.takeWhile(isAlpha).pipe(Parser.filter((run) => run.length >= 3)),
  Parser.delimited(
    Token.literal("<"),
    Parser.cut(
      Token.takeWhile(isQuotedChar).pipe(
        Parser.filter((run) => run.length >= 3),
        Parser.expected("at least three letters, digits, '+' or '-'"),
      ),
    ),
    Parser.cut(Token.literal(">")),
  ),
).pipe(Parser.expected("time zone abbreviation (three or more letters, or <...>)"));

const digitRun = (min: number, max: number): Parser.Parser<number> =>
  Ascii.digit1.pipe(
    Parser.filter((run) => run.length >= min && run.length <= max),
    Parser.map(Number),
  );

const field = (count: number, max: number, label: string): Parser.Parser<number> =>
  digitRun(count, count).pipe(
    Parser.filter((n) => n <= max),
    Parser.expected(label),
  );

// `[+|-]hh[:mm[:ss]]`, in seconds with POSIX's sign, `hours` capped at
// `maxHours` (24 for an offset, 167 for an RFC 8536 transition time).
const signedTime = (maxHours: number, hourDigits: number): Parser.Parser<number> =>
  Parser.gen(function* () {
    const sign = yield* Parser.opt(Token.oneOf("+-"));
    const hours = yield* digitRun(1, hourDigits).pipe(
      Parser.filter((h) => h <= maxHours),
      Parser.expected(`hours (0-${maxHours})`),
    );
    const minutes = yield* Parser.opt(
      Parser.preceded(Token.literal(":"), Parser.cut(field(2, 59, "minutes (00-59)"))),
    );
    const seconds = Option.isSome(minutes)
      ? yield* Parser.opt(
          Parser.preceded(Token.literal(":"), Parser.cut(field(2, 59, "seconds (00-59)"))),
        )
      : Option.none<number>();
    const total =
      hours * HOUR +
      Option.getOrElse(minutes, () => 0) * MINUTE +
      Option.getOrElse(seconds, () => 0);
    return Option.contains(sign, "-") ? -total : total;
  });

// POSIX offsets are positive west of Greenwich; store them east-positive
// (`0 - posix`, not `-posix`, so a zero offset is 0 rather than -0).
const offset: Parser.Parser<number> = signedTime(24, 2).pipe(
  Parser.map((posix) => 0 - posix),
  Parser.expected("UTC offset ([+|-]hh[:mm[:ss]])"),
);

const transitionTime: Parser.Parser<number> = signedTime(167, 3).pipe(
  Parser.expected("transition time ([+|-]hh[:mm[:ss]], hours -167 to 167)"),
);

const bounded = (min: number, max: number, label: string): Parser.Parser<number> =>
  Ascii.digit1.pipe(
    Parser.map(Number),
    Parser.filter((n) => n >= min && n <= max),
    Parser.expected(label),
  );

const dateRule: Parser.Parser<DateRule> = Parser.alt(
  Parser.preceded(Token.literal("J"), Parser.cut(bounded(1, 365, "Julian day (1-365)"))).pipe(
    Parser.map((day): DateRule => ({ _tag: "JulianNoLeap", day })),
  ),
  Parser.preceded(
    Token.literal("M"),
    Parser.cut(
      Parser.struct({
        month: bounded(1, 12, "month (1-12)"),
        week: Parser.preceded(Token.literal("."), bounded(1, 5, "week (1-5)")),
        weekday: Parser.preceded(Token.literal("."), bounded(0, 6, "weekday (0-6)")),
      }),
    ),
  ).pipe(
    Parser.map(({ month, week, weekday }): DateRule => ({
      _tag: "MonthWeekDay",
      month,
      week,
      weekday,
    })),
  ),
  bounded(0, 365, "day of the year (0-365)").pipe(
    Parser.map((day): DateRule => ({ _tag: "Julian", day })),
  ),
).pipe(Parser.expected("transition date (Jn, n or Mm.w.d)"));

const transition: Parser.Parser<Transition> = Parser.struct({
  date: dateRule,
  time: Parser.opt(Parser.preceded(Token.literal("/"), Parser.cut(transitionTime))).pipe(
    Parser.map(Option.getOrElse(() => DEFAULT_TRANSITION_TIME)),
  ),
});

const rule: Parser.Parser<Rule> = Parser.preceded(
  Token.literal(","),
  Parser.cut(
    Parser.struct({
      start: transition,
      end: Parser.preceded(Token.literal(","), transition),
    }),
  ),
);

/**
 * The POSIX TZ string grammar as an effect-parse `Parser`, for embedding in
 * a larger grammar (a TZif footer, a configuration file).
 *
 * It reads `std offset [dst [offset] [,start[/time],end[/time]]]`:
 *
 * - **Designations:** three or more letters (`AEST`), or three or more
 *   letters, digits, `+` and `-` in angle brackets (`<+1030>`).
 * - **Offsets:** `[+|-]hh[:mm[:ss]]`, hours 0–24, positive *west* of
 *   Greenwich as POSIX writes them; {@link Designation} stores them
 *   east-positive.
 * - **Rule dates:** `Jn`, `n` or `Mm.w.d` (see {@link DateRule}), each with
 *   an optional `/time` from -167 to 167 hours (RFC 8536 §3.3.1); the time
 *   defaults to 02:00.
 *
 * The implementation-defined form that starts with `:` (`:Europe/Paris`)
 * is not read: it names a zone rather than describing one.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { Option } from "effect"
 * import { PosixTz } from "@thomasfosterau/effect-time"
 *
 * const tz = Parser.parseSync(PosixTz.parser, "AEST-10AEDT,M10.1.0,M4.1.0/3")
 *
 * console.log(tz.std.utcOffset) // 36000
 * console.log(Option.match(tz.dst, { onNone: () => "none", onSome: (dst) => dst.utcOffset })) // 39600
 * ```
 *
 * @category parsers
 * @since 0.1.0
 */
export const parser: Parser.Parser<PosixTz> = Parser.gen(function* () {
  const stdName = yield* name;
  const stdOffset = yield* offset;
  const std: Designation = { name: stdName, utcOffset: stdOffset };
  const dstName = yield* Parser.opt(name);
  if (Option.isNone(dstName)) {
    return { std, dst: Option.none(), rule: Option.none() };
  }
  const dstOffset = yield* Parser.opt(offset);
  const dst: Designation = {
    name: dstName.value,
    utcOffset: Option.getOrElse(dstOffset, () => stdOffset + HOUR),
  };
  const dstRule = yield* Parser.opt(rule);
  return { std, dst: Option.some(dst), rule: dstRule };
}).pipe(Parser.context("POSIX TZ string"));

/**
 * Parses a whole string as a POSIX TZ string; see {@link parser} for the
 * grammar and the result.
 *
 * Fails with the effect-parse `ParseError`, whose `message` shows the
 * column and what was expected there.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { PosixTz } from "@thomasfosterau/effect-time"
 *
 * Effect.runPromise(PosixTz.parse("JST-9")).then((tz) =>
 *   console.log(tz.std) // { name: 'JST', utcOffset: 32400 }
 * )
 * ```
 *
 * @category parsing
 * @since 0.1.0
 */
export const parse = (input: string): Effect.Effect<PosixTz, ParseError.ParseError> =>
  Parser.parseEffect(parser, input);

const printName = (designation: string): string =>
  /^[A-Za-z]+$/.test(designation) ? designation : `<${designation}>`;

const pad = (n: number): string => String(n).padStart(2, "0");

// The shortest `[-]h[:mm[:ss]]` for a number of seconds, with its own sign.
const printTime = (seconds: number): string => {
  const total = Math.abs(seconds);
  const hours = Math.floor(total / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);
  const secs = total % MINUTE;
  const tail =
    secs !== 0 ? `:${pad(minutes)}:${pad(secs)}` : minutes !== 0 ? `:${pad(minutes)}` : "";
  return `${seconds < 0 ? "-" : ""}${hours}${tail}`;
};

const printDate = (date: DateRule): string =>
  Match.valueTags(date, {
    JulianNoLeap: ({ day }) => `J${day}`,
    Julian: ({ day }) => String(day),
    MonthWeekDay: ({ month, week, weekday }) => `M${month}.${week}.${weekday}`,
  });

const printTransition = (t: Transition): string =>
  printDate(t.date) + (t.time === DEFAULT_TRANSITION_TIME ? "" : `/${printTime(t.time)}`);

/**
 * Prints a {@link PosixTz} as a POSIX TZ string, leaving out what the
 * grammar defaults: a daylight offset one hour ahead of standard time, and
 * a transition time of 02:00.
 *
 * A designation that is not all letters is printed in angle brackets.
 * Total, and the inverse of {@link parse} on what it parses, up to those
 * defaults, the shortest spelling of each time (`5`, not `05:00`) and an
 * explicit `+` sign, which it never prints.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { PosixTz } from "@thomasfosterau/effect-time"
 *
 * const tz = Parser.parseSync(PosixTz.parser, "<+0530>-05:30")
 *
 * console.log(PosixTz.format(tz)) // "<+0530>-5:30"
 * ```
 *
 * @category formatting
 * @since 0.1.0
 */
export const format = (self: PosixTz): string => {
  const std = printName(self.std.name) + printTime(-self.std.utcOffset);
  const dst = Option.match(self.dst, {
    onNone: () => "",
    onSome: (d) =>
      printName(d.name) +
      (d.utcOffset === self.std.utcOffset + HOUR ? "" : printTime(-d.utcOffset)),
  });
  const ruleText = Option.match(self.rule, {
    onNone: () => "",
    onSome: (r) => `,${printTransition(r.start)},${printTransition(r.end)}`,
  });
  return std + dst + ruleText;
};

/**
 * A `Schema` from a POSIX TZ string to a {@link PosixTz}: decoding runs
 * {@link parser} and reports a failure as an issue carrying the
 * `ParseError` message; encoding runs {@link format}.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { PosixTz } from "@thomasfosterau/effect-time"
 *
 * const Config = Schema.Struct({ tz: PosixTz.FromString })
 *
 * const config = Schema.decodeUnknownSync(Config)({ tz: "CET-1CEST,M3.5.0,M10.5.0/3" })
 *
 * console.log(PosixTz.format(config.tz)) // "CET-1CEST,M3.5.0,M10.5.0/3"
 * ```
 *
 * @category schemas
 * @since 0.1.0
 */
export const FromString: ParserSchema.ParserSchema<PosixTz> = ParserSchema.make(parser, {
  encode: format,
  description: "a POSIX TZ string",
});
