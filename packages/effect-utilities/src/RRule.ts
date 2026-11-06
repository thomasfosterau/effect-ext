/**
 * iCalendar recurrence rules (`FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10`): the
 * `recur` value type of RFC 5545 §3.3.10, the value of an `RRULE`
 * property, as a parser, a decoder, a printer and a `Schema`.
 *
 * @since 0.1.0
 */
import * as Ascii from "@thomasfosterau/effect-parse/Ascii";
import type * as ParseError from "@thomasfosterau/effect-parse/ParseError";
import * as Parser from "@thomasfosterau/effect-parse/Parser";
import * as ParserSchema from "@thomasfosterau/effect-parse/ParserSchema";
import * as Token from "@thomasfosterau/effect-parse/Token";
import * as Arr from "effect/Array";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import { daysInMonth } from "./internal/calendar.ts";

/**
 * How often a rule repeats (`FREQ`).
 *
 * @category models
 * @since 0.1.0
 */
export type Frequency =
  | "SECONDLY"
  | "MINUTELY"
  | "HOURLY"
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "YEARLY";

/**
 * A day of the week, as RFC 5545 writes it.
 *
 * @category models
 * @since 0.1.0
 */
export type Weekday = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";

/**
 * One `BYDAY` entry: a weekday, with an ordinal for the nth (`2MO`, 1–53)
 * or nth-from-last (`-1FR`) of it within the month or year.
 *
 * @category models
 * @since 0.1.0
 */
export interface WeekdayNum {
  readonly ordinal: Option.Option<number>;
  readonly weekday: Weekday;
}

/**
 * The time of an `UNTIL` date-time: `utc` when it ends in `Z`; otherwise a
 * floating local time, which RFC 5545 allows only when the rule's start is
 * floating too.
 *
 * @category models
 * @since 0.1.0
 */
export interface UntilTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly utc: boolean;
}

/**
 * The last instance a rule may produce (`UNTIL`), as written: a date
 * (`20261231`) or a date-time (`20261231T235959Z`), kept as its fields
 * because a floating time has no instant until the rule's start gives it a
 * time zone.
 *
 * @category models
 * @since 0.1.0
 */
export interface Until {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly time: Option.Option<UntilTime>;
}

/**
 * A parsed recurrence rule. Every `BY…` list is empty when its part is
 * absent; `interval` defaults to 1 and `weekStart` (`WKST`) to `"MO"`.
 *
 * - `bySecond` holds 0–60, `byMinute` 0–59, `byHour` 0–23 and `byMonth`
 *   1–12.
 * - `byMonthDay` holds ±1–31, `byYearDay` ±1–366, `byWeekNo` ±1–53 and
 *   `bySetPos` ±1–366; a negative value counts from the end.
 *
 * @category models
 * @since 0.1.0
 */
export interface RRule {
  readonly freq: Frequency;
  readonly until: Option.Option<Until>;
  readonly count: Option.Option<number>;
  readonly interval: number;
  readonly bySecond: ReadonlyArray<number>;
  readonly byMinute: ReadonlyArray<number>;
  readonly byHour: ReadonlyArray<number>;
  readonly byDay: ReadonlyArray<WeekdayNum>;
  readonly byMonthDay: ReadonlyArray<number>;
  readonly byYearDay: ReadonlyArray<number>;
  readonly byWeekNo: ReadonlyArray<number>;
  readonly byMonth: ReadonlyArray<number>;
  readonly bySetPos: ReadonlyArray<number>;
  readonly weekStart: Weekday;
}

const frequencies: ReadonlyArray<Frequency> = [
  "SECONDLY",
  "MINUTELY",
  "HOURLY",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
];
const weekdays: ReadonlyArray<Weekday> = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const isAlpha = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

const word = <A extends string>(choices: ReadonlyArray<A>, label: string): Parser.Parser<A> =>
  Token.takeWhile(isAlpha, { min: 1 }).pipe(
    Parser.filterMap((w) => Arr.findFirst(choices, (c) => c === w.toUpperCase())),
    Parser.expected(label),
  );

const frequency = word(frequencies, `frequency (${Arr.join(frequencies, ", ")})`);
const weekday = word(weekdays, "weekday (SU, MO, TU, WE, TH, FR or SA)");

const isDigit = (c: string): boolean => c >= "0" && c <= "9";

// Exactly `count` digits: `UNTIL`'s fields run together (`20261231`).
const digits = (count: number): Parser.Parser<number> =>
  Token.takeWhile(isDigit, { min: count, max: count }).pipe(Parser.map(Number));

const inRange = (count: number, min: number, max: number, label: string): Parser.Parser<number> =>
  digits(count).pipe(
    Parser.filter((n) => n >= min && n <= max),
    Parser.expected(label),
  );

const untilTime: Parser.Parser<UntilTime> = Parser.preceded(
  Token.literal("T"),
  Parser.cut(
    Parser.struct({
      hour: inRange(2, 0, 23, "hour (00-23)"),
      minute: inRange(2, 0, 59, "minute (00-59)"),
      // RFC 5545 allows a leap second
      second: inRange(2, 0, 60, "second (00-60)"),
      utc: Parser.opt(Token.literal("Z")).pipe(Parser.map(Option.isSome)),
    }),
  ),
);

const until: Parser.Parser<Until> = Parser.gen(function* () {
  const year = yield* digits(4).pipe(Parser.expected("year (4 digits)"));
  const month = yield* inRange(2, 1, 12, "month (01-12)");
  const last = daysInMonth(year, month);
  const day = yield* inRange(2, 1, last, `day of month (01-${last})`);
  const time = yield* Parser.opt(untilTime);
  return { year, month, day, time };
});

const positive = (label: string): Parser.Parser<number> =>
  Ascii.digit1.pipe(
    Parser.map(Number),
    Parser.filter((n) => n >= 1),
    Parser.expected(label),
  );

// A comma-separated list of numbers in `min`–`max`, or of ±1–`max` when
// `signed`.
const numbers = (min: number, max: number, signed: boolean, label: string) => {
  const one = Parser.gen(function* () {
    const sign = signed ? yield* Parser.opt(Token.oneOf("+-")) : Option.none<string>();
    const n = yield* Ascii.digit1.pipe(Parser.map(Number));
    return Option.contains(sign, "-") ? -n : n;
  }).pipe(
    Parser.filter((n) => (signed ? n !== 0 && Math.abs(n) <= max : n >= min && n <= max)),
    Parser.expected(label),
  );
  return Parser.separated(one, Token.literal(","), { min: 1 });
};

const weekdayNum: Parser.Parser<WeekdayNum> = Parser.struct({
  ordinal: Parser.opt(
    Parser.gen(function* () {
      const sign = yield* Parser.opt(Token.oneOf("+-"));
      const n = yield* Ascii.digit1.pipe(
        Parser.map(Number),
        Parser.filter((v) => v >= 1 && v <= 53),
        Parser.expected("week ordinal (1-53)"),
      );
      return Option.contains(sign, "-") ? -n : n;
    }),
  ),
  weekday,
});

// Each part sets one field; the fields the rule's parts left out take their
// defaults when the parts are merged.
type Fragment = Partial<{
  -readonly [K in keyof RRule]: RRule[K] extends Option.Option<infer A> ? A : RRule[K];
}>;

const field =
  <K extends keyof Fragment>(key: K) =>
  (value: NonNullable<Fragment[K]>): Fragment => ({ [key]: value });

const fragmentParsers: Record.ReadonlyRecord<string, Parser.Parser<Fragment>> = {
  FREQ: frequency.pipe(Parser.map(field("freq"))),
  UNTIL: until.pipe(Parser.map(field("until"))),
  COUNT: positive("count (1 or more)").pipe(Parser.map(field("count"))),
  INTERVAL: positive("interval (1 or more)").pipe(Parser.map(field("interval"))),
  BYSECOND: numbers(0, 60, false, "second (0-60)").pipe(Parser.map(field("bySecond"))),
  BYMINUTE: numbers(0, 59, false, "minute (0-59)").pipe(Parser.map(field("byMinute"))),
  BYHOUR: numbers(0, 23, false, "hour (0-23)").pipe(Parser.map(field("byHour"))),
  BYDAY: Parser.separated(weekdayNum, Token.literal(","), { min: 1 }).pipe(
    Parser.map(field("byDay")),
  ),
  BYMONTHDAY: numbers(1, 31, true, "day of month (±1-31)").pipe(Parser.map(field("byMonthDay"))),
  BYYEARDAY: numbers(1, 366, true, "day of year (±1-366)").pipe(Parser.map(field("byYearDay"))),
  BYWEEKNO: numbers(1, 53, true, "week number (±1-53)").pipe(Parser.map(field("byWeekNo"))),
  BYMONTH: numbers(1, 12, false, "month (1-12)").pipe(Parser.map(field("byMonth"))),
  BYSETPOS: numbers(1, 366, true, "set position (±1-366)").pipe(Parser.map(field("bySetPos"))),
  WKST: weekday.pipe(Parser.map(field("weekStart"))),
};

const partNames = Record.keys(fragmentParsers);

// A part name and the parser for its value.
const partName = Token.takeWhile(isAlpha, { min: 1 }).pipe(
  Parser.filterMap((w) =>
    Option.map(Record.get(fragmentParsers, w.toUpperCase()), (value) => ({
      name: w.toUpperCase(),
      value,
    })),
  ),
  Parser.expected(`rule part (${Arr.join(partNames, ", ")})`),
);

// The parts, each at most once: a repeated name fails where its value starts.
const parts = (seen: ReadonlyArray<string>): Parser.Parser<Fragment> =>
  Parser.gen(function* () {
    const { name, value } = yield* partName;
    yield* Parser.cut(Token.literal("="));
    if (Arr.contains(seen, name)) {
      return yield* Parser.cut(Parser.failMessage(`${name} appears more than once`));
    }
    const fragment = yield* Parser.cut(value);
    const rest = yield* Parser.opt(
      Parser.preceded(
        Token.literal(";"),
        Parser.suspend(() => parts(Arr.append(seen, name))),
      ),
    );
    return { ...fragment, ...Option.getOrElse(rest, (): Fragment => ({})) };
  });

const restricted = (f: Frequency): boolean => f !== "MONTHLY" && f !== "YEARLY";

// RFC 5545 §3.3.10's MUST NOTs that span parts.
const violation = (rule: RRule): Option.Option<string> => {
  const checks: ReadonlyArray<readonly [boolean, string]> = [
    [
      Option.isSome(rule.until) && Option.isSome(rule.count),
      "UNTIL and COUNT cannot both be given",
    ],
    [
      Arr.some(rule.byDay, (d) => Option.isSome(d.ordinal)) &&
        (restricted(rule.freq) ||
          (rule.freq === "YEARLY" && Arr.isReadonlyArrayNonEmpty(rule.byWeekNo))),
      "BYDAY ordinals (2MO, -1FR) need FREQ=MONTHLY, or FREQ=YEARLY without BYWEEKNO",
    ],
    [
      Arr.isReadonlyArrayNonEmpty(rule.byMonthDay) && rule.freq === "WEEKLY",
      "BYMONTHDAY cannot be used with FREQ=WEEKLY",
    ],
    [
      Arr.isReadonlyArrayNonEmpty(rule.byYearDay) &&
        (rule.freq === "DAILY" || rule.freq === "WEEKLY" || rule.freq === "MONTHLY"),
      "BYYEARDAY cannot be used with FREQ=DAILY, WEEKLY or MONTHLY",
    ],
    [
      Arr.isReadonlyArrayNonEmpty(rule.byWeekNo) && rule.freq !== "YEARLY",
      "BYWEEKNO needs FREQ=YEARLY",
    ],
    [
      Arr.isReadonlyArrayNonEmpty(rule.bySetPos) &&
        !Arr.some(
          [
            rule.bySecond,
            rule.byMinute,
            rule.byHour,
            rule.byDay,
            rule.byMonthDay,
            rule.byYearDay,
            rule.byWeekNo,
            rule.byMonth,
          ],
          (list: ReadonlyArray<unknown>) => Arr.isReadonlyArrayNonEmpty(list),
        ),
      "BYSETPOS needs another BY… part",
    ],
  ];
  return Arr.findFirst(checks, ([failed]) => failed).pipe(Option.map(([, message]) => message));
};

const empty: ReadonlyArray<never> = [];

/**
 * The RFC 5545 `recur` grammar as an effect-parse `Parser`, for embedding
 * in a larger grammar such as an iCalendar content line (the text after
 * `RRULE:`).
 *
 * - **Parts:** `NAME=value` separated by `;`, in any order, each at most
 *   once, `FREQ` required. Names and keywords are read in any case.
 * - **Values:** `UNTIL` is a date (`20261231`) or a date-time
 *   (`20261231T120000`, `…Z` for UTC); `COUNT` and `INTERVAL` are positive;
 *   `BY…` parts are comma-separated lists, range-checked per part
 *   (see {@link RRule}); `BYDAY` entries take an optional ordinal (`-1SU`).
 * - **Cross-part rules:** RFC 5545's restrictions are enforced: not both
 *   `UNTIL` and `COUNT`, `BYDAY` ordinals only with `MONTHLY` or `YEARLY`,
 *   no `BYMONTHDAY` with `WEEKLY`, no `BYYEARDAY` with `DAILY`, `WEEKLY` or
 *   `MONTHLY`, `BYWEEKNO` only with `YEARLY`, and `BYSETPOS` only beside
 *   another `BY…` part.
 *
 * RFC 7529's `RSCALE` and `SKIP` and unknown `X-` parts are not read.
 * The rule is parsed, not expanded into occurrences.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { RRule } from "@thomasfosterau/effect-time"
 *
 * const rule = Parser.parseSync(RRule.parser, "FREQ=MONTHLY;BYDAY=-1FR;COUNT=6")
 *
 * console.log(rule.freq, rule.byDay[0]?.weekday) // MONTHLY FR
 * ```
 *
 * @category parsers
 * @since 0.1.0
 */
export const parser: Parser.Parser<RRule> = Parser.gen(function* () {
  const parsed = yield* parts([]);
  const freq = Option.fromUndefinedOr(parsed.freq);
  if (Option.isNone(freq)) {
    return yield* Parser.cut(Parser.failMessage("FREQ is required"));
  }
  const rule: RRule = {
    freq: freq.value,
    until: Option.fromUndefinedOr(parsed.until),
    count: Option.fromUndefinedOr(parsed.count),
    interval: parsed.interval ?? 1,
    bySecond: parsed.bySecond ?? empty,
    byMinute: parsed.byMinute ?? empty,
    byHour: parsed.byHour ?? empty,
    byDay: parsed.byDay ?? empty,
    byMonthDay: parsed.byMonthDay ?? empty,
    byYearDay: parsed.byYearDay ?? empty,
    byWeekNo: parsed.byWeekNo ?? empty,
    byMonth: parsed.byMonth ?? empty,
    bySetPos: parsed.bySetPos ?? empty,
    weekStart: parsed.weekStart ?? "MO",
  };
  return yield* Option.match(violation(rule), {
    onNone: () => Parser.succeed(rule),
    onSome: (message) => Parser.cut(Parser.failMessage(message)),
  });
}).pipe(Parser.context("recurrence rule"));

/**
 * Parses a whole string as a recurrence rule; see {@link parser} for the
 * grammar and the result.
 *
 * Fails with the effect-parse `ParseError`, whose `message` shows the
 * column and what was expected there.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { RRule } from "@thomasfosterau/effect-time"
 *
 * Effect.runPromise(RRule.parse("FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10")).then((rule) =>
 *   console.log(rule.byDay.map((d) => d.weekday)) // [ 'MO', 'WE', 'FR' ]
 * )
 * ```
 *
 * @category parsing
 * @since 0.1.0
 */
export const parse = (input: string): Effect.Effect<RRule, ParseError.ParseError> =>
  Parser.parseEffect(parser, input);

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

const printUntil = (u: Until): string =>
  `${pad(u.year, 4)}${pad(u.month, 2)}${pad(u.day, 2)}` +
  Option.match(u.time, {
    onNone: () => "",
    onSome: (t) => `T${pad(t.hour, 2)}${pad(t.minute, 2)}${pad(t.second, 2)}${t.utc ? "Z" : ""}`,
  });

const printList = (name: string, values: ReadonlyArray<string | number>): ReadonlyArray<string> =>
  Arr.isReadonlyArrayEmpty(values) ? [] : [`${name}=${Arr.join(Arr.map(values, String), ",")}`];

/**
 * Prints an {@link RRule} as an RFC 5545 `recur` value: `FREQ` first, then
 * the other parts in the order RFC 5545 lists them, leaving out the
 * defaults (`INTERVAL=1`, `WKST=MO`) and empty `BY…` lists.
 *
 * Total, and the inverse of {@link parse} up to part order, the case of
 * keywords, an explicit `+` and the defaults.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { RRule } from "@thomasfosterau/effect-time"
 *
 * const rule = Parser.parseSync(RRule.parser, "count=3;byday=+1mo;freq=monthly;interval=1")
 *
 * console.log(RRule.format(rule)) // "FREQ=MONTHLY;COUNT=3;BYDAY=1MO"
 * ```
 *
 * @category formatting
 * @since 0.1.0
 */
export const format = (self: RRule): string =>
  Arr.join(
    [
      `FREQ=${self.freq}`,
      ...Arr.fromOption(Option.map(self.until, (u) => `UNTIL=${printUntil(u)}`)),
      ...Arr.fromOption(Option.map(self.count, (n) => `COUNT=${n}`)),
      ...(self.interval === 1 ? [] : [`INTERVAL=${self.interval}`]),
      ...printList("BYSECOND", self.bySecond),
      ...printList("BYMINUTE", self.byMinute),
      ...printList("BYHOUR", self.byHour),
      ...printList(
        "BYDAY",
        Arr.map(
          self.byDay,
          (d) => `${Option.match(d.ordinal, { onNone: () => "", onSome: String })}${d.weekday}`,
        ),
      ),
      ...printList("BYMONTHDAY", self.byMonthDay),
      ...printList("BYYEARDAY", self.byYearDay),
      ...printList("BYWEEKNO", self.byWeekNo),
      ...printList("BYMONTH", self.byMonth),
      ...printList("BYSETPOS", self.bySetPos),
      ...(self.weekStart === "MO" ? [] : [`WKST=${self.weekStart}`]),
    ],
    ";",
  );

/**
 * A `Schema` from an RFC 5545 `recur` string to an {@link RRule}: decoding
 * runs {@link parser} and reports a failure as an issue carrying the
 * `ParseError` message; encoding runs {@link format}.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { RRule } from "@thomasfosterau/effect-time"
 *
 * const Event = Schema.Struct({ rrule: RRule.FromString })
 *
 * const event = Schema.decodeUnknownSync(Event)({ rrule: "FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU" })
 *
 * console.log(RRule.format(event.rrule)) // "FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3"
 * ```
 *
 * @category schemas
 * @since 0.1.0
 */
export const FromString: ParserSchema.ParserSchema<RRule> = ParserSchema.make(parser, {
  encode: format,
  description: "an RFC 5545 recurrence rule",
});
