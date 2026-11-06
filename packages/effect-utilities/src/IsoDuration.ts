/**
 * ISO 8601 durations (`P1Y2M3DT4H5M6.5S`, `P2W`): a parser, a decoder, a
 * printer and a `Schema`, with the amounts `DateTime.add` takes on the other
 * side.
 *
 * @since 0.1.0
 */
import * as Ascii from "@thomasfosterau/effect-parse/Ascii";
import type * as ParseError from "@thomasfosterau/effect-parse/ParseError";
import * as Parser from "@thomasfosterau/effect-parse/Parser";
import * as Token from "@thomasfosterau/effect-parse/Token";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

/**
 * A parsed duration: every `DateTime.add` amount, each a safe integer and all
 * of one sign, with fractional seconds in `milliseconds`.
 *
 * It is exactly `DateTime.add`'s argument, so `DateTime.add(dt, duration)`
 * applies it: calendar units (`years`, `months`, `weeks`, `days`) move the
 * wall clock in the value's zone, time units move the instant.
 *
 * @example
 * ```ts
 * import { DateTime, IsoDuration } from "@thomasfosterau/effect-time"
 *
 * const duration: IsoDuration.IsoDuration = { ...IsoDuration.zero, months: 1 }
 *
 * console.log(DateTime.formatIso(DateTime.add(DateTime.makeUnsafe("2026-01-31T00:00:00Z"), duration)))
 * // "2026-02-28T00:00:00.000Z"
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export type IsoDuration = DateTime.DateTime.PartsForMath;

/**
 * The empty duration, every amount `0`; prints as `PT0S`.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import { IsoDuration } from "@thomasfosterau/effect-time"
 *
 * console.log(Option.getOrThrow(IsoDuration.format(IsoDuration.zero))) // "PT0S"
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const zero: IsoDuration = {
  years: 0,
  months: 0,
  weeks: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  milliseconds: 0,
};

const amount: Parser.Parser<number> = Ascii.digit1.pipe(
  Parser.map(Number),
  Parser.filter(Number.isSafeInteger),
  Parser.expected("number"),
);

// A designator in either case, named by its upper-case letter in errors.
const designator = (letter: string) =>
  Token.oneOf(`${letter}${letter.toLowerCase()}`).pipe(Parser.expected(`"${letter}"`));

const unit = (letter: string): Parser.Parser<Option.Option<number>> =>
  Parser.opt(Parser.terminated(amount, designator(letter)));

// Only the seconds take a fraction (ISO 8601 allows `.` or `,`); digits past
// the third are dropped, as `DateTime` holds milliseconds.
const fraction = Parser.preceded(
  Token.oneOf(".,").pipe(Parser.expected('"." or ","')),
  Ascii.digit1.pipe(Parser.map((digits) => Number(digits.slice(0, 3).padEnd(3, "0")))),
);

const seconds = Parser.opt(
  Parser.terminated(Parser.seq(amount, Parser.opt(fraction)), designator("S")),
);

const orZero = Option.getOrElse(() => 0);

const timePart = Parser.preceded(
  designator("T"),
  Parser.struct({ hours: unit("H"), minutes: unit("M"), seconds }),
).pipe(
  Parser.filter(
    (time) =>
      Option.isSome(time.hours) || Option.isSome(time.minutes) || Option.isSome(time.seconds),
  ),
  Parser.expected('"T" and an hour, minute or second amount'),
  Parser.map((time) => ({
    hours: orZero(time.hours),
    minutes: orZero(time.minutes),
    seconds: orZero(Option.map(time.seconds, ([whole]) => whole)),
    milliseconds: orZero(Option.flatMap(time.seconds, ([, millis]) => millis)),
  })),
);

const weeksForm: Parser.Parser<IsoDuration> = Parser.terminated(amount, designator("W")).pipe(
  Parser.map((weeks) => ({ ...zero, weeks })),
);

const calendarForm: Parser.Parser<IsoDuration> = Parser.seq(
  Parser.struct({ years: unit("Y"), months: unit("M"), days: unit("D") }),
  Parser.opt(timePart),
).pipe(
  Parser.filter(
    ([date, time]) =>
      Option.isSome(time) ||
      Option.isSome(date.years) ||
      Option.isSome(date.months) ||
      Option.isSome(date.days),
  ),
  Parser.map(([date, time]) => ({
    ...zero,
    ...Option.getOrUndefined(time),
    years: orZero(date.years),
    months: orZero(date.months),
    days: orZero(date.days),
  })),
);

const neg = (n: number): number => (n === 0 ? 0 : -n);

const negate = (d: IsoDuration): IsoDuration => ({
  years: neg(d.years),
  months: neg(d.months),
  weeks: neg(d.weeks),
  days: neg(d.days),
  hours: neg(d.hours),
  minutes: neg(d.minutes),
  seconds: neg(d.seconds),
  milliseconds: neg(d.milliseconds),
});

/**
 * The ISO 8601 duration grammar as an effect-parse `Parser`, for embedding a
 * duration in a larger grammar.
 *
 * It reads `P` followed by either `nW` alone, or `[nY][nM][nD][T[nH][nM][nS]]`
 * with at least one amount (and at least one after a `T`), the RFC 3339
 * Appendix A profile. Beyond that profile it takes a leading `+` or `-`
 * (negating every amount), a fraction on the seconds (`PT1.5S`, `PT1,5S`,
 * truncated to milliseconds) and lower-case designators. Amounts are not
 * normalised: `PT90M` is `{ minutes: 90 }`.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { IsoDuration } from "@thomasfosterau/effect-time"
 *
 * console.log(Parser.parseSync(IsoDuration.parser, "PT1H30M").minutes) // 30
 * ```
 *
 * @category parsers
 * @since 0.1.0
 */
export const parser: Parser.Parser<IsoDuration> = Parser.seq(
  Parser.optional(Token.oneOf("+-").pipe(Parser.expected('"+" or "-"'))),
  Parser.preceded(
    designator("P"),
    Parser.alt(weeksForm, calendarForm).pipe(Parser.expected("a duration amount")),
  ),
).pipe(
  Parser.map(([sign, duration]) => (sign === "-" ? negate(duration) : duration)),
  Parser.context("ISO 8601 duration"),
);

/**
 * Parses a whole string as an ISO 8601 duration; see {@link parser} for the
 * grammar.
 *
 * Fails with the effect-parse `ParseError`, whose `message` shows the column
 * and what was expected there.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { DateTime, IsoDuration } from "@thomasfosterau/effect-time"
 *
 * const program = Effect.gen(function*() {
 *   const duration = yield* IsoDuration.parse("P1DT12H")
 *   return DateTime.formatIso(DateTime.add(DateTime.makeUnsafe("2026-10-22T00:00:00Z"), duration))
 * })
 *
 * Effect.runPromise(program).then(console.log) // "2026-10-23T12:00:00.000Z"
 * ```
 *
 * @category parsing
 * @since 0.1.0
 */
export const parse = (input: string): Effect.Effect<IsoDuration, ParseError.ParseError> =>
  Parser.parseEffect(parser, input);

const KEYS = [
  "years",
  "months",
  "weeks",
  "days",
  "hours",
  "minutes",
  "seconds",
  "milliseconds",
] as const;

const printSeconds = (millis: number): string => {
  const whole = Math.trunc(millis / 1000);
  const remainder = millis % 1000;
  return remainder === 0
    ? `${whole}`
    : `${whole}.${String(remainder).padStart(3, "0").replace(/0+$/, "")}`;
};

const designated = (value: number, letter: string): string =>
  value === 0 ? "" : `${value}${letter}`;

// Prints non-negative amounts: weeks alone as `PnW`, otherwise weeks folded
// into days and milliseconds into the seconds.
const printUnsigned = (d: IsoDuration): string => {
  if (d.weeks !== 0 && KEYS.every((key) => key === "weeks" || d[key] === 0)) return `P${d.weeks}W`;
  const millis = d.seconds * 1000 + d.milliseconds;
  const date =
    designated(d.years, "Y") + designated(d.months, "M") + designated(d.weeks * 7 + d.days, "D");
  const time =
    designated(d.hours, "H") +
    designated(d.minutes, "M") +
    (millis === 0 ? "" : `${printSeconds(millis)}S`);
  if (date === "" && time === "") return "PT0S";
  return time === "" ? `P${date}` : `P${date}T${time}`;
};

/**
 * Prints amounts as an ISO 8601 duration, or `None` when no duration string
 * can say the same thing.
 *
 * Takes any `DateTime.add` argument; a missing amount is `0`. Every amount
 * must be a safe integer and all must share a sign (a negative duration
 * prints with a leading `-`); otherwise the result is `None`. Weeks alone
 * print as `PnW`; next to other amounts they fold into days (a week is seven
 * days to `DateTime.add` too), and milliseconds fold into the seconds as a
 * fraction. All-zero prints as `PT0S`. The inverse of {@link parse} on what
 * it parses.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import { IsoDuration } from "@thomasfosterau/effect-time"
 *
 * console.log(Option.getOrThrow(IsoDuration.format({ days: 1, milliseconds: 1500 }))) // "P1DT1.5S"
 * console.log(Option.isNone(IsoDuration.format({ days: 1, hours: -1 }))) // true
 * ```
 *
 * @category formatting
 * @since 0.1.0
 */
export const format = (duration: Partial<IsoDuration>): Option.Option<string> => {
  const amounts = { ...zero, ...duration };
  const values = KEYS.map((key) => amounts[key]);
  if (!values.every(Number.isSafeInteger)) return Option.none();
  const negative = values.some((value) => value < 0);
  if (negative && values.some((value) => value > 0)) return Option.none();
  return Option.some(negative ? `-${printUnsigned(negate(amounts))}` : printUnsigned(amounts));
};

const Amounts = Schema.Struct({
  years: Schema.Int,
  months: Schema.Int,
  weeks: Schema.Int,
  days: Schema.Int,
  hours: Schema.Int,
  minutes: Schema.Int,
  seconds: Schema.Int,
  milliseconds: Schema.Int,
});

/**
 * A `Schema` from an ISO 8601 duration string to an {@link IsoDuration}:
 * decoding runs {@link parser} and reports a failure as an issue carrying the
 * `ParseError` message; encoding runs {@link format} and fails where it gives
 * `None` (mixed signs).
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { IsoDuration } from "@thomasfosterau/effect-time"
 *
 * const Job = Schema.Struct({ timeout: IsoDuration.FromString })
 *
 * console.log(Schema.decodeUnknownSync(Job)({ timeout: "PT30S" }).timeout.seconds) // 30
 * ```
 *
 * @category schemas
 * @since 0.1.0
 */
export const FromString: Schema.decodeTo<typeof Amounts, Schema.String> = Schema.String.pipe(
  Schema.decodeTo(
    Amounts,
    SchemaTransformation.transformEffect<IsoDuration, string>({
      decode: (input, options) => {
        const result = Parser.parse(parser, input);
        return Result.isSuccess(result)
          ? Effect.succeed(result.success)
          : Effect.fail(
              new SchemaIssue.InvalidValue({ message: result.failure.message }, input, options),
            );
      },
      encode: (duration, options) =>
        Effect.fromOption(format(duration)).pipe(
          Effect.mapError(
            () =>
              new SchemaIssue.InvalidValue(
                { message: "a duration with mixed signs has no ISO 8601 form" },
                duration,
                options,
              ),
          ),
        ),
    }),
  ),
);

/**
 * The decoded type of {@link FromString}: an {@link IsoDuration}.
 *
 * @example
 * ```ts
 * import { IsoDuration } from "@thomasfosterau/effect-time"
 *
 * const timeout: IsoDuration.FromString = { ...IsoDuration.zero, seconds: 30 }
 *
 * console.log(timeout.seconds) // 30
 * ```
 *
 * @category schemas
 * @since 0.1.0
 */
export type FromString = typeof FromString.Type;
