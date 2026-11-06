/**
 * RFC 3339 date-times: the `date-time` production of RFC 3339 §5.6 as a
 * parser, a decoder and a `Schema`, with `DateTime` values on the other side.
 *
 * @since 0.1.0
 */
import * as Ascii from "@thomasfosterau/effect-parse/Ascii";
import type * as ParseError from "@thomasfosterau/effect-parse/ParseError";
import * as Parser from "@thomasfosterau/effect-parse/Parser";
import * as ParserSchema from "@thomasfosterau/effect-parse/ParserSchema";
import * as Token from "@thomasfosterau/effect-parse/Token";
import * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { daysInMonth } from "./internal/calendar.ts";

const MINUTE_MILLIS = 60_000;

// `digit1` and a length check rather than a fixed-width take, so a field of
// the wrong width fails at its start, under its own name.
const digits = (count: number): Parser.Parser<number> =>
  Ascii.digit1.pipe(
    Parser.filter((run) => run.length === count),
    Parser.map(Number),
  );

const bounded = (count: number, min: number, max: number, name: string): Parser.Parser<number> =>
  digits(count).pipe(
    Parser.filter((n) => n >= min && n <= max),
    Parser.expected(name),
  );

const fullDate = Parser.gen(function* () {
  const year = yield* digits(4).pipe(Parser.expected("year (4 digits)"));
  yield* Token.literal("-");
  const month = yield* bounded(2, 1, 12, "month (01-12)");
  yield* Token.literal("-");
  const last = daysInMonth(year, month);
  const day = yield* bounded(2, 1, last, `day of month (01-${last})`);
  return { year, month, day };
});

// Fractional seconds carry any number of digits; `DateTime` holds
// milliseconds, so the digits past the third are dropped (truncated, never
// rounded, so a value never moves into the next second).
const secondFraction = Parser.preceded(Token.literal("."), Ascii.digit1).pipe(
  Parser.map((fraction) => Number(fraction.slice(0, 3).padEnd(3, "0"))),
);

const partialTime = Parser.struct({
  hour: bounded(2, 0, 23, "hour (00-23)"),
  minute: Parser.preceded(Token.literal(":"), bounded(2, 0, 59, "minute (00-59)")),
  second: Parser.preceded(Token.literal(":"), bounded(2, 0, 59, "second (00-59)")),
  millisecond: Parser.optional(secondFraction),
});

// `Z` and `-00:00` (RFC 3339 §4.3: the time is UTC, the local offset is
// unknown) are `None`, a numeric offset its value in minutes.
const timeOffset: Parser.Parser<Option.Option<number>> = Parser.alt(
  Token.oneOf("Zz").pipe(Parser.as(Option.none())),
  Parser.seq(
    Token.oneOf("+-"),
    bounded(2, 0, 23, "offset hours (00-23)"),
    Parser.preceded(Token.literal(":"), bounded(2, 0, 59, "offset minutes (00-59)")),
  ).pipe(
    Parser.map(([sign, hours, minutes]) =>
      sign === "-" && hours === 0 && minutes === 0
        ? Option.none()
        : Option.some((sign === "-" ? -1 : 1) * (hours * 60 + minutes)),
    ),
  ),
).pipe(Parser.expected('offset ("Z" or ±hh:mm)'));

/**
 * The RFC 3339 `date-time` grammar as an effect-parse `Parser`, for embedding
 * a timestamp in a larger grammar.
 *
 * It reads `full-date "T" full-time`: the separator may be `T`, `t` or a
 * space (RFC 3339 §5.6 allows the last), and the offset `Z`, `z` or `±hh:mm`.
 * It checks the calendar (`2026-02-29` fails, `2028-02-29` parses) and the
 * clock ranges, and points a failure at the field that is out of range.
 *
 * - **Result:** `Z`, `z` and `-00:00` give a `DateTime.Utc`; any other offset
 *   a `DateTime.Zoned` in that fixed offset (`+00:00` included), so the
 *   offset survives a round trip through {@link format}.
 * - **Precision:** fractional seconds are truncated to milliseconds.
 * - **Leap seconds:** second `60` is rejected; `DateTime` cannot hold it.
 *
 * @example
 * ```ts
 * import { Parser, Token } from "@thomasfosterau/effect-parse"
 * import { DateTime, Rfc3339 } from "@thomasfosterau/effect-time"
 *
 * const logLine = Parser.separatedPair(Rfc3339.parser, Token.literal(" "), Token.rest)
 *
 * const [at, message] = Parser.parseSync(logLine, "2026-10-22T09:30:00Z started")
 *
 * console.log(DateTime.formatIso(at), message) // "2026-10-22T09:30:00.000Z" "started"
 * ```
 *
 * @category parsers
 * @since 0.1.0
 */
export const parser: Parser.Parser<DateTime.DateTime> = Parser.gen(function* () {
  const date = yield* fullDate;
  yield* Token.oneOf("Tt ").pipe(Parser.expected('"T"'));
  const time = yield* partialTime;
  const offset = yield* timeOffset;
  const local = DateTime.makeUnsafe({
    ...date,
    ...time,
    millisecond: time.millisecond ?? 0,
  });
  if (Option.isNone(offset)) return local;
  const offsetMillis = offset.value * MINUTE_MILLIS;
  return DateTime.makeZonedUnsafe(DateTime.toEpochMillis(local) - offsetMillis, {
    timeZone: DateTime.zoneMakeOffset(offsetMillis),
  });
}).pipe(Parser.context("RFC 3339 date-time"));

/**
 * Parses a whole string as an RFC 3339 date-time; see {@link parser} for the
 * grammar and the result.
 *
 * Fails with the effect-parse `ParseError`, whose `message` shows the line,
 * the column and what was expected there.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { DateTime, Rfc3339 } from "@thomasfosterau/effect-time"
 *
 * const program = Effect.gen(function*() {
 *   const dt = yield* Rfc3339.parse("2026-10-22T09:30:00+10:00")
 *   return DateTime.formatIso(dt)
 * })
 *
 * Effect.runPromise(program).then(console.log) // "2026-10-21T23:30:00.000Z"
 * ```
 *
 * @category parsing
 * @since 0.1.0
 */
export const parse = (input: string): Effect.Effect<DateTime.DateTime, ParseError.ParseError> =>
  Parser.parseEffect(parser, input);

/**
 * Prints a `DateTime` as an RFC 3339 date-time with millisecond precision:
 * `Z` for a `DateTime.Utc`, the zone's current offset as `±hh:mm` for a
 * `DateTime.Zoned`.
 *
 * Total, and the inverse of {@link parse} on what it parses. A year outside
 * 0000-9999 prints in the ISO 8601 extended form (`+010000-…`), which is not
 * RFC 3339.
 *
 * @example
 * ```ts
 * import { DateTime, Rfc3339 } from "@thomasfosterau/effect-time"
 *
 * const dt = DateTime.makeZonedUnsafe("2026-10-22T00:00:00Z", { timeZone: "Australia/Sydney" })
 *
 * console.log(Rfc3339.format(dt)) // "2026-10-22T11:00:00.000+11:00"
 * ```
 *
 * @category formatting
 * @since 0.1.0
 */
export const format: (self: DateTime.DateTime) => string = DateTime.formatIsoOffset;

/**
 * A `Schema` from an RFC 3339 string to a `DateTime`: decoding runs
 * {@link parser} and reports a failure as an issue carrying the `ParseError`
 * message; encoding runs {@link format}.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { DateTime, Rfc3339 } from "@thomasfosterau/effect-time"
 *
 * const Event = Schema.Struct({ at: Rfc3339.FromString })
 *
 * const event = Schema.decodeUnknownSync(Event)({ at: "2026-10-22T09:30:00Z" })
 *
 * console.log(DateTime.formatIso(event.at)) // "2026-10-22T09:30:00.000Z"
 * ```
 *
 * @category schemas
 * @since 0.1.0
 */
export const FromString: ParserSchema.ParserSchema<DateTime.DateTime> = ParserSchema.make(parser, {
  encode: format,
  description: "an RFC 3339 date-time",
});
