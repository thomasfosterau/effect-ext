/**
 * Cron expressions (`30 9 * * MON-FRI`, `@daily`) parsed to Effect's
 * `Cron` values, with errors that point at the field and the column that
 * is wrong, as a parser, a decoder, a printer and a `Schema`.
 *
 * @since 0.1.0
 */
import * as Ascii from "@thomasfosterau/effect-parse/Ascii";
import type * as ParseError from "@thomasfosterau/effect-parse/ParseError";
import * as Parser from "@thomasfosterau/effect-parse/Parser";
import * as ParserSchema from "@thomasfosterau/effect-parse/ParserSchema";
import * as Token from "@thomasfosterau/effect-parse/Token";
import * as Arr from "effect/Array";
import * as Cron from "effect/Cron";
import type * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Record from "effect/Record";

interface FieldKind {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly aliases: Record.ReadonlyRecord<string, number>;
}

const second: FieldKind = { name: "second", min: 0, max: 59, aliases: {} };
const minute: FieldKind = { name: "minute", min: 0, max: 59, aliases: {} };
const hour: FieldKind = { name: "hour", min: 0, max: 23, aliases: {} };
const day: FieldKind = { name: "day of month", min: 1, max: 31, aliases: {} };
const month: FieldKind = {
  name: "month",
  min: 1,
  max: 12,
  aliases: {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  },
};
// 0 and 7 are both Sunday; `Cron.make` folds 7 into 0.
const weekday: FieldKind = {
  name: "day of week",
  min: 0,
  max: 7,
  aliases: { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 },
};

const isAlpha = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isBlank = (c: string): boolean => c === " " || c === "\t";

const blanks = Token.takeWhile(isBlank, { min: 1 });

// One value of a field: a number in range, or a name (case-insensitive).
const value = (kind: FieldKind): Parser.Parser<number> => {
  const names = Record.keys(kind.aliases);
  const label = Arr.isReadonlyArrayEmpty(names)
    ? `${kind.name} (${kind.min}-${kind.max})`
    : `${kind.name} (${kind.min}-${kind.max} or ${Arr.join(names, ", ")})`;
  return Parser.alt(
    Ascii.digit1.pipe(
      Parser.map(Number),
      Parser.filter((n) => n >= kind.min && n <= kind.max),
    ),
    Token.takeWhile(isAlpha, { min: 1 }).pipe(
      Parser.filterMap((name) => Record.get(kind.aliases, name.toLowerCase())),
    ),
  ).pipe(Parser.expected(label));
};

// `*`, `a` or `a-b`: the bounds it covers and whether it was `*`.
const base = (kind: FieldKind) =>
  Parser.alt(
    Token.literal("*").pipe(Parser.as({ from: kind.min, to: kind.max, star: true, single: false })),
    Parser.gen(function* () {
      const from = yield* value(kind);
      const to = yield* Parser.opt(
        Parser.preceded(
          Token.literal("-"),
          Parser.cut(
            value(kind).pipe(
              Parser.filter((n) => n >= from),
              Parser.expected(`end of the ${kind.name} range (${from}-${kind.max})`),
            ),
          ),
        ),
      );
      return Option.match(to, {
        onNone: () => ({ from, to: from, star: false, single: true }),
        onSome: (end) => ({ from, to: end, star: false, single: false }),
      });
    }),
  );

const step = (kind: FieldKind): Parser.Parser<number> =>
  Parser.preceded(
    Token.literal("/"),
    Parser.cut(
      Ascii.digit1.pipe(
        Parser.map(Number),
        Parser.filter((n) => n >= 1 && n <= kind.max),
        Parser.expected(`step (1-${kind.max})`),
      ),
    ),
  );

interface Item {
  readonly values: ReadonlyArray<number>;
  // A bare `*` (or `*/1`): every value, which `Cron` writes as an empty set.
  readonly every: boolean;
  readonly star: boolean;
}

// `a/s` runs from `a` to the field's maximum, as in Vixie cron.
const item = (kind: FieldKind): Parser.Parser<Item> =>
  Parser.gen(function* () {
    const { from, to, star, single } = yield* base(kind);
    const by = yield* Parser.opt(step(kind));
    const stride = Option.getOrElse(by, () => 1);
    const end = single && Option.isSome(by) ? kind.max : to;
    return {
      values: Arr.filter(Arr.range(from, end), (n) => (n - from) % stride === 0),
      every: star && stride === 1,
      star,
    };
  });

interface Field {
  readonly values: ReadonlyArray<number>;
  // The field starts with `*`: Vixie cron then ANDs day of month and day
  // of week instead of ORing them.
  readonly star: boolean;
}

const field = (kind: FieldKind): Parser.Parser<Field> =>
  Parser.separated(item(kind), Token.literal(","), { min: 1 }).pipe(
    Parser.map((items): Field => ({
      values: Arr.some(items, (i) => i.every) ? [] : Arr.flatMap(items, (i: Item) => i.values),
      star: Arr.headNonEmpty(items).star,
    })),
  );

const macros: Record.ReadonlyRecord<string, string> = {
  yearly: "0 0 1 1 *",
  annually: "0 0 1 1 *",
  monthly: "0 0 1 * *",
  weekly: "0 0 * * 0",
  daily: "0 0 * * *",
  midnight: "0 0 * * *",
  hourly: "0 * * * *",
};

// The fields of a `Cron`, as `Cron.parse` builds them.
const build = (
  fields: {
    readonly seconds: Field;
    readonly minutes: Field;
    readonly hours: Field;
    readonly days: Field;
    readonly months: Field;
    readonly weekdays: Field;
  },
  timeZone: Option.Option<DateTime.TimeZone>,
): Cron.Cron =>
  Cron.make({
    ...Option.match(timeZone, { onNone: () => ({}), onSome: (tz) => ({ tz }) }),
    seconds: fields.seconds.values,
    minutes: fields.minutes.values,
    hours: fields.hours.values,
    days: fields.days.values,
    months: fields.months.values,
    weekdays: fields.weekdays.values,
    and:
      (fields.days.star || fields.weekdays.star) &&
      Arr.isReadonlyArrayNonEmpty(fields.days.values) &&
      Arr.isReadonlyArrayNonEmpty(fields.weekdays.values),
  });

const fieldsParser = (count: 5 | 6) =>
  Parser.gen(function* () {
    const seconds =
      count === 6 ? yield* Parser.terminated(field(second), blanks) : { values: [0], star: false };
    const minutes = yield* field(minute);
    yield* blanks;
    const hours = yield* field(hour);
    yield* blanks;
    const days = yield* field(day);
    yield* blanks;
    const months = yield* field(month);
    yield* blanks;
    const weekdays = yield* field(weekday);
    return { seconds, minutes, hours, days, months, weekdays };
  });

// How many blank-separated fields the input has, without consuming it.
const fieldCount = Parser.peek(
  Parser.separated(
    Token.takeWhile((c: string) => !isBlank(c), { min: 1 }),
    blanks,
    { min: 1 },
  ),
).pipe(Parser.map((fields) => fields.length));

const fieldsOf = Parser.gen(function* () {
  const count = yield* fieldCount;
  return count === 5 || count === 6
    ? yield* Parser.cut(fieldsParser(count))
    : yield* Parser.cut(Parser.failMessage(`a cron expression has 5 or 6 fields, found ${count}`));
});

const macro = Parser.preceded(
  Token.literal("@"),
  Parser.cut(
    Token.takeWhile(isAlpha, { min: 1 }).pipe(
      Parser.filterMap((name) => Record.get(macros, name.toLowerCase())),
      Parser.expected("@yearly, @annually, @monthly, @weekly, @daily, @midnight or @hourly"),
    ),
  ),
).pipe(Parser.map((expansion) => Parser.parseSync(fieldsParser(5), expansion)));

const cronParser = (timeZone: Option.Option<DateTime.TimeZone>): Parser.Parser<Cron.Cron> =>
  Parser.alt(macro, fieldsOf).pipe(
    Parser.map((fields) => build(fields, timeZone)),
    Parser.context("cron expression"),
  );

/**
 * The cron grammar as an effect-parse `Parser` producing a `Cron` in the
 * given time zone, for embedding a schedule in a larger grammar such as a crontab line.
 *
 * See {@link parser} for the grammar.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { Cron, DateTime } from "effect"
 * import { CronExpression } from "@thomasfosterau/effect-time"
 *
 * const sydney = DateTime.zoneMakeNamedUnsafe("Australia/Sydney")
 * const cron = Parser.parseSync(CronExpression.parserIn(sydney), "0 9 * * MON-FRI")
 *
 * console.log(Cron.next(cron, DateTime.makeUnsafe("2026-10-24T00:00:00Z")).toISOString()) // "2026-10-25T22:00:00.000Z"
 * ```
 *
 * @category parsers
 * @since 0.1.0
 */
export const parserIn = (timeZone: DateTime.TimeZone): Parser.Parser<Cron.Cron> =>
  cronParser(Option.some(timeZone));

/**
 * The cron grammar as an effect-parse `Parser` producing an Effect `Cron`
 * with no time zone, so `Cron.next` and `Cron.match` work on it directly.
 *
 * It reads five fields, minute, hour, day of month, month and day of week,
 * or six with a leading second, separated by spaces or tabs; or a macro.
 *
 * - **Fields:** a comma-separated list of `*`, `n` or `a-b`, each with an
 *   optional `/step`; `a/step` runs from `a` to the field's maximum.
 *   Months take `JAN`–`DEC` and days of the week `SUN`–`SAT`, in any case;
 *   Sunday is 0 or 7.
 * - **Day of month and day of week:** when both are restricted, a time
 *   matches either one, unless one of them starts with a `*` (a stepped
 *   `*`, say), when it must match both: Vixie cron's rule, which
 *   `Cron.parse` follows too.
 * - **Macros:** `@yearly` (`@annually`), `@monthly`, `@weekly`, `@daily`
 *   (`@midnight`) and `@hourly`. `@reboot` is not a schedule and is
 *   rejected.
 * - **Errors:** a value out of range, a range whose end is before its
 *   start, a step of 0 or a wrong number of fields fails at that point,
 *   naming the field. Quartz's `?`, `L`, `W` and `#` are not read.
 *
 * For a valid expression the result equals `Cron.parse`'s.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { Cron } from "effect"
 * import { CronExpression } from "@thomasfosterau/effect-time"
 *
 * const cron = Parser.parseSync(CronExpression.parser, "0,30 9-17 * * mon-fri")
 *
 * console.log(Cron.format(cron)) // "0,30 9-17 * * 1-5"
 * ```
 *
 * @category parsers
 * @since 0.1.0
 */
export const parser: Parser.Parser<Cron.Cron> = cronParser(Option.none());

/**
 * Parses a whole string as a cron expression with no time zone; see
 * {@link parser} for the grammar, and {@link parseIn} for one in a time
 * zone.
 *
 * Fails with the effect-parse `ParseError`, whose `message` shows the
 * column and what was expected there, where `Cron.parse` only names the
 * kind of mistake.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { CronExpression } from "@thomasfosterau/effect-time"
 *
 * Effect.runPromise(Effect.flip(CronExpression.parse("0 25 * * *"))).then((error) =>
 *   console.log(error.message.includes("hour (0-23)")) // true
 * )
 * ```
 *
 * @category parsing
 * @since 0.1.0
 */
export const parse = (input: string): Effect.Effect<Cron.Cron, ParseError.ParseError> =>
  Parser.parseEffect(parser, input);

/**
 * Parses a whole string as a cron expression in a time zone, so `Cron.next`
 * and `Cron.match` read its fields as that zone's wall-clock time; fails as
 * {@link parse} does.
 *
 * @example
 * ```ts
 * import { Cron, DateTime, Effect } from "effect"
 * import { CronExpression } from "@thomasfosterau/effect-time"
 *
 * const sydney = DateTime.zoneMakeNamedUnsafe("Australia/Sydney")
 *
 * Effect.runPromise(CronExpression.parseIn("0 9 * * MON-FRI", sydney)).then((cron) =>
 *   console.log(Cron.next(cron, DateTime.makeUnsafe("2026-10-24T00:00:00Z")).toISOString()) // "2026-10-25T22:00:00.000Z"
 * )
 * ```
 *
 * @category parsing
 * @since 0.1.0
 */
export const parseIn = (
  input: string,
  timeZone: DateTime.TimeZone,
): Effect.Effect<Cron.Cron, ParseError.ParseError> => Parser.parseEffect(parserIn(timeZone), input);

/**
 * Prints a `Cron` as a five-field expression (six when its seconds are not
 * just 0), with `Cron.format`: numbers rather than names, and runs written
 * as ranges and steps.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { CronExpression } from "@thomasfosterau/effect-time"
 *
 * console.log(CronExpression.format(Parser.parseSync(CronExpression.parser, "@weekly"))) // "0 0 * * 0"
 * ```
 *
 * @category formatting
 * @since 0.1.0
 */
export const format = (cron: Cron.Cron): string => Cron.format(cron);

/**
 * A `Schema` from a cron expression to an Effect `Cron` with no time zone:
 * decoding runs {@link parser} and reports a failure as an issue carrying
 * the `ParseError` message; encoding runs {@link format}.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { CronExpression } from "@thomasfosterau/effect-time"
 *
 * const Job = Schema.Struct({ schedule: CronExpression.FromString })
 *
 * const job = Schema.decodeUnknownSync(Job)({ schedule: "0 3 * * SUN" })
 *
 * console.log(CronExpression.format(job.schedule)) // "0 3 * * 0"
 * ```
 *
 * @category schemas
 * @since 0.1.0
 */
export const FromString: ParserSchema.ParserSchema<Cron.Cron> = ParserSchema.make(parser, {
  encode: format,
  description: "a cron expression",
});
