/**
 * RFC 9557 Internet Extended Date/Time Format (IXDTF): an RFC 3339 date-time
 * followed by suffixes in brackets, a time zone (`[Europe/Paris]`) and tagged
 * annotations (`[u-ca=hebrew]`), as a parser, a decoder, a printer and a
 * `Schema`.
 *
 * @since 0.1.0
 */
import * as Ascii from "@thomasfosterau/effect-parse/Ascii";
import type * as ParseError from "@thomasfosterau/effect-parse/ParseError";
import * as Parser from "@thomasfosterau/effect-parse/Parser";
import * as ParserSchema from "@thomasfosterau/effect-parse/ParserSchema";
import * as Token from "@thomasfosterau/effect-parse/Token";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Rfc3339 from "./Rfc3339.ts";

/**
 * The time zone suffix of an IXDTF string: the name as written (an IANA
 * time zone name such as `Europe/Paris`, or a numeric offset such as
 * `+05:30`) and whether it carries the critical flag `!`.
 *
 * @category models
 * @since 0.1.0
 */
export interface TimeZoneSuffix {
  readonly name: string;
  readonly critical: boolean;
}

/**
 * A tagged suffix of an IXDTF string (`[u-ca=hebrew]`): its key, its values
 * (the `-`-separated parts after `=`) and whether it carries the critical
 * flag `!`.
 *
 * @category models
 * @since 0.1.0
 */
export interface Annotation {
  readonly key: string;
  readonly values: Arr.NonEmptyReadonlyArray<string>;
  readonly critical: boolean;
}

/**
 * A parsed IXDTF string: the instant, as {@link Rfc3339.parser} reads the
 * RFC 3339 part, then the optional time zone suffix and the tagged
 * annotations in the order they were written.
 *
 * @category models
 * @since 0.1.0
 */
export interface Ixdtf {
  readonly dateTime: DateTime.DateTime;
  readonly timeZone: Option.Option<TimeZoneSuffix>;
  readonly annotations: ReadonlyArray<Annotation>;
}

const isLowerAlpha = (c: string): boolean => c >= "a" && c <= "z";
const isAlpha = (c: string): boolean => isLowerAlpha(c) || (c >= "A" && c <= "Z");
const isDigit = (c: string): boolean => c >= "0" && c <= "9";

// `[`, an optional critical flag, the body, `]`.
const suffix = <A>(
  body: Parser.Parser<A>,
): Parser.Parser<{ readonly critical: boolean; readonly value: A }> =>
  Parser.delimited(
    Token.literal("["),
    Parser.struct({
      critical: Parser.opt(Token.literal("!")).pipe(Parser.map(Option.isSome)),
      value: body,
    }),
    Token.literal("]"),
  );

// time-zone-part = time-zone-initial *time-zone-char, but not "." or "..".
const isZoneInitial = (c: string): boolean => isAlpha(c) || c === "." || c === "_";
const zonePart = Parser.taken(
  Parser.seq(
    Token.satisfy(isZoneInitial),
    Token.takeWhile((c: string) => isZoneInitial(c) || isDigit(c) || c === "-" || c === "+"),
  ),
).pipe(
  Parser.filter((part) => part !== "." && part !== ".."),
  Parser.expected("time zone name part"),
);

const zoneName = Parser.taken(Parser.separated(zonePart, Token.literal("/"), { min: 1 }));

// RFC 3339 `time-numoffset`: hours 00-23, minutes 00-59. A suffix that
// starts with a sign can only be an offset, so the rest is cut.
const isOffsetBody = (body: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(body);
const zoneOffset = Parser.seq(
  Token.oneOf("+-"),
  Parser.cut(
    Parser.taken(Parser.seq(Ascii.digit1, Token.literal(":"), Ascii.digit1)).pipe(
      Parser.filter(isOffsetBody),
      Parser.expected("time zone offset (±hh:mm)"),
    ),
  ),
).pipe(Parser.map(([sign, body]) => sign + body));

const timeZoneSuffix = suffix(
  Parser.alt(zoneOffset, zoneName).pipe(Parser.expected("time zone (a name or ±hh:mm)")),
);

// annotation-key = (lcalpha / "_") *(lcalpha / "_" / DIGIT / "-")
const isKeyInitial = (c: string): boolean => isLowerAlpha(c) || c === "_";
const annotationKey = Parser.taken(
  Parser.seq(
    Token.satisfy(isKeyInitial),
    Token.takeWhile((c: string) => isKeyInitial(c) || isDigit(c) || c === "-"),
  ),
).pipe(Parser.expected("annotation key"));

const annotationValue = Parser.separated(
  Token.takeWhile((c: string) => isAlpha(c) || isDigit(c), { min: 1 }).pipe(
    Parser.expected("annotation value"),
  ),
  Token.literal("-"),
  { min: 1 },
);

const annotation: Parser.Parser<Annotation> = suffix(
  Parser.separatedPair(annotationKey, Token.literal("="), annotationValue),
).pipe(Parser.map(({ critical, value: [key, values] }) => ({ key, values, critical })));

// The date-time as written, when its offset is numeric: `Z` and `-00:00`
// say the local offset is unknown, so they cannot disagree with a time zone.
const withWrittenOffset = (dateTime: DateTime.DateTime): Option.Option<DateTime.Zoned> =>
  DateTime.isZoned(dateTime) ? Option.some(dateTime) : Option.none();

// RFC 9557 §3.4: a critical time zone the recipient cannot use, or one whose
// offset at the instant differs from the written offset, is an error.
const checkCritical = (
  dateTime: DateTime.DateTime,
  timeZone: TimeZoneSuffix,
): Option.Option<string> =>
  Option.match(DateTime.zoneFromString(timeZone.name), {
    onNone: () => Option.some(`unknown time zone "${timeZone.name}" marked critical`),
    onSome: (zone) =>
      Option.flatMap(withWrittenOffset(dateTime), (written) => {
        const inZone = DateTime.setZone(written, zone);
        return DateTime.zonedOffset(inZone) === DateTime.zonedOffset(written)
          ? Option.none()
          : Option.some(
              `offset ${DateTime.zonedOffsetIso(written)} is inconsistent with the critical time zone "${timeZone.name}" (${DateTime.zonedOffsetIso(inZone)} at that instant)`,
            );
      }),
  });

const timeZoneFor = (dateTime: DateTime.DateTime): Parser.Parser<Option.Option<TimeZoneSuffix>> =>
  Parser.opt(timeZoneSuffix).pipe(
    Parser.map(Option.map(({ critical, value }): TimeZoneSuffix => ({ name: value, critical }))),
    Parser.flatMap((timeZone) =>
      Option.match(
        Option.flatMap(
          Option.filter(timeZone, (tz) => tz.critical),
          (tz) => checkCritical(dateTime, tz),
        ),
        {
          onNone: () => Parser.succeed(timeZone),
          onSome: (message) => Parser.cut(Parser.failMessage(message)),
        },
      ),
    ),
  );

/**
 * The RFC 9557 `date-time-ext` grammar as an effect-parse `Parser`, for
 * embedding an IXDTF timestamp in a larger grammar.
 *
 * It reads an RFC 3339 date-time (see {@link Rfc3339.parser}), then at most
 * one time zone suffix (`[Europe/Paris]`, `[+05:30]`), then any number of
 * tagged annotations (`[u-ca=hebrew]`, `[_x-foo=bar-baz]`); each suffix may
 * start with the critical flag `!`.
 *
 * - **Instant:** the written offset fixes the instant, so `dateTime` is
 *   exactly what {@link Rfc3339.parser} gives for the RFC 3339 part; use
 *   {@link toDateTime} to view it in the suffixed time zone.
 * - **Critical time zone:** a `!` time zone that `DateTime` does not know, or
 *   whose offset at the instant differs from a numeric written offset, fails
 *   the parse (RFC 9557 §3.4). Without `!` both are kept as written.
 * - **Critical annotations:** recorded with `critical: true`, never acted on:
 *   RFC 9557 requires an application to reject a critical annotation it does
 *   not understand, and only the application knows which keys it does.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { Rfc9557 } from "@thomasfosterau/effect-time"
 *
 * const ixdtf = Parser.parseSync(Rfc9557.parser, "2026-10-22T09:30:00+11:00[Australia/Sydney][u-ca=gregory]")
 *
 * console.log(ixdtf.annotations[0]?.key) // "u-ca"
 * ```
 *
 * @category parsers
 * @since 0.1.0
 */
export const parser: Parser.Parser<Ixdtf> = Parser.gen(function* () {
  const dateTime = yield* Rfc3339.parser;
  const timeZone = yield* timeZoneFor(dateTime);
  const annotations = yield* Parser.repeat(annotation);
  return { dateTime, timeZone, annotations };
}).pipe(Parser.context("RFC 9557 date-time"));

/**
 * Parses a whole string as an IXDTF date-time; see {@link parser} for the
 * grammar and the result.
 *
 * Fails with the effect-parse `ParseError`, whose `message` shows the line,
 * the column and what was expected there.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect"
 * import { Rfc9557 } from "@thomasfosterau/effect-time"
 *
 * const program = Effect.map(Rfc9557.parse("2026-10-22T09:30:00Z[!Europe/Paris]"), (ixdtf) =>
 *   Option.match(ixdtf.timeZone, { onNone: () => "none", onSome: (tz) => `${tz.name} (critical: ${tz.critical})` })
 * )
 *
 * Effect.runPromise(program).then(console.log) // "Europe/Paris (critical: true)"
 * ```
 *
 * @category parsing
 * @since 0.1.0
 */
export const parse = (input: string): Effect.Effect<Ixdtf, ParseError.ParseError> =>
  Parser.parseEffect(parser, input);

/**
 * The parsed instant in its suffixed time zone: a `DateTime.Zoned` in that
 * zone when `DateTime` knows it, the instant as written otherwise (no time
 * zone suffix, or an elective one `DateTime` does not know).
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { Rfc3339, Rfc9557 } from "@thomasfosterau/effect-time"
 *
 * const ixdtf = Parser.parseSync(Rfc9557.parser, "2026-10-22T00:00:00Z[Australia/Sydney]")
 *
 * console.log(Rfc3339.format(Rfc9557.toDateTime(ixdtf))) // "2026-10-22T11:00:00.000+11:00"
 * ```
 *
 * @category conversions
 * @since 0.1.0
 */
export const toDateTime = (self: Ixdtf): DateTime.DateTime =>
  Option.match(
    Option.flatMap(self.timeZone, (timeZone) => DateTime.zoneFromString(timeZone.name)),
    {
      onNone: () => self.dateTime,
      onSome: (zone) => DateTime.setZone(self.dateTime, zone),
    },
  );

const printSuffix = (critical: boolean, body: string): string => `[${critical ? "!" : ""}${body}]`;

/**
 * Prints an {@link Ixdtf}: the date-time with {@link Rfc3339.format}, then
 * the time zone suffix and the annotations as written.
 *
 * Total, and the inverse of {@link parse} on what it parses, up to
 * {@link Rfc3339.format}'s millisecond precision and `-00:00` printing as `Z`.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { Rfc9557 } from "@thomasfosterau/effect-time"
 *
 * const ixdtf = Parser.parseSync(Rfc9557.parser, "2026-10-22T09:30:00Z[Europe/Paris][!u-ca=iso8601]")
 *
 * console.log(Rfc9557.format(ixdtf)) // "2026-10-22T09:30:00.000Z[Europe/Paris][!u-ca=iso8601]"
 * ```
 *
 * @category formatting
 * @since 0.1.0
 */
export const format = (self: Ixdtf): string =>
  Rfc3339.format(self.dateTime) +
  Option.match(self.timeZone, {
    onNone: () => "",
    onSome: (timeZone) => printSuffix(timeZone.critical, timeZone.name),
  }) +
  Arr.join(
    Arr.map(self.annotations, (a) =>
      printSuffix(a.critical, `${a.key}=${Arr.join(a.values, "-")}`),
    ),
    "",
  );

/**
 * A `Schema` from an IXDTF string to an {@link Ixdtf}: decoding runs
 * {@link parser} and reports a failure as an issue carrying the `ParseError`
 * message; encoding runs {@link format}.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Rfc9557 } from "@thomasfosterau/effect-time"
 *
 * const Meeting = Schema.Struct({ at: Rfc9557.FromString })
 *
 * const meeting = Schema.decodeUnknownSync(Meeting)({ at: "2026-10-22T09:30:00+11:00[Australia/Sydney]" })
 *
 * console.log(Rfc9557.format(meeting.at)) // "2026-10-22T09:30:00.000+11:00[Australia/Sydney]"
 * ```
 *
 * @category schemas
 * @since 0.1.0
 */
export const FromString: ParserSchema.ParserSchema<Ixdtf> = ParserSchema.make(parser, {
  encode: format,
  description: "an RFC 9557 (IXDTF) date-time",
});
