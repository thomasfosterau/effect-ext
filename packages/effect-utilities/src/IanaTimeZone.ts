/**
 * IANA time zone names (`Europe/Paris`, `America/Argentina/Buenos_Aires`):
 * the tz database's naming rules as a parser, checked against the time
 * zones the JavaScript runtime knows, with no bundled data.
 *
 * Which names are known is the runtime's ICU build's answer, not this
 * package's: Node, Deno, Bun and browsers each ship their own copy of the
 * tz database, at their own version, and may spell a canonical name
 * differently (`Asia/Kolkata` or `Asia/Calcutta`).
 *
 * @since 0.1.0
 */
import type * as ParseError from "@thomasfosterau/effect-parse/ParseError";
import * as Parser from "@thomasfosterau/effect-parse/Parser";
import * as ParserSchema from "@thomasfosterau/effect-parse/ParserSchema";
import * as Token from "@thomasfosterau/effect-parse/Token";
import * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const isNameChar = (c: string): boolean =>
  (c >= "a" && c <= "z") ||
  (c >= "A" && c <= "Z") ||
  (c >= "0" && c <= "9") ||
  c === "." ||
  c === "_" ||
  c === "-" ||
  c === "+";

// tz database theory: a component is 1-14 characters, not "." or "..", and
// does not start with "-".
const component = Token.takeWhile(isNameChar, { min: 1 }).pipe(
  Parser.filter(
    (part) => part.length <= 14 && part !== "." && part !== ".." && !part.startsWith("-"),
  ),
  Parser.expected("time zone name component (1-14 of A-Z, a-z, 0-9, '.', '_', '-', '+')"),
);

// A "/" commits to another component, so a bad one is reported where it is.
const name = Parser.taken(
  Parser.seq(component, Parser.repeat(Parser.preceded(Token.literal("/"), Parser.cut(component)))),
);

/**
 * The time zone names the runtime lists, from
 * `Intl.supportedValuesOf("timeZone")`: its ICU build's canonical names, in
 * that build's spelling.
 *
 * The list is not every name the runtime accepts: V8 (Node, Chrome, Deno)
 * leaves out `UTC`, the `Etc/GMT±n` zones and every alias (`US/Eastern`),
 * all of which {@link parser} accepts. Use it to offer a choice of zone,
 * and {@link parser} or {@link isKnown} to check one.
 *
 * @example
 * ```ts
 * import { IanaTimeZone } from "@thomasfosterau/effect-time"
 *
 * console.log(IanaTimeZone.supported().includes("Europe/Paris")) // true
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const supported = (): ReadonlyArray<string> => Intl.supportedValuesOf("timeZone");

/**
 * The runtime's time zone for a name, when it knows one: a
 * `DateTime.TimeZone.Named` whose `id` is the runtime's canonical spelling
 * (`US/Eastern` gives `America/New_York`).
 *
 * The runtime's `Intl.DateTimeFormat` decides, so aliases, `UTC` and the
 * `Etc/GMT±n` zones are known, and names are matched without regard to
 * case. This is `DateTime.zoneMakeNamed`, named for this module.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import { IanaTimeZone } from "@thomasfosterau/effect-time"
 *
 * console.log(Option.map(IanaTimeZone.known("US/Eastern"), (zone) => zone.id)) // Option.some("America/New_York")
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const known = (zoneName: string): Option.Option<DateTime.TimeZone.Named> =>
  DateTime.zoneMakeNamed(zoneName);

/**
 * Whether the runtime knows a time zone name; see {@link known}.
 *
 * @example
 * ```ts
 * import { IanaTimeZone } from "@thomasfosterau/effect-time"
 *
 * console.log(IanaTimeZone.isKnown("Australia/Sydney"), IanaTimeZone.isKnown("Mars/Olympus_Mons")) // true false
 * ```
 *
 * @category predicates
 * @since 0.1.0
 */
export const isKnown = (zoneName: string): boolean => Option.isSome(known(zoneName));

/**
 * The time zone name grammar as an effect-parse `Parser`, for embedding a
 * zone in a larger grammar: `/`-separated components of 1–14 letters,
 * digits, `.`, `_`, `-` and `+` (no component `.` or `..`, none starting
 * with `-`), as the tz database names zones, that the runtime also knows
 * (see {@link known}).
 *
 * The result is the runtime's `DateTime.TimeZone.Named`, ready for
 * `DateTime.setZone`; a well-formed name the runtime does not know fails
 * after it, saying so.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { IanaTimeZone } from "@thomasfosterau/effect-time"
 *
 * console.log(Parser.parseSync(IanaTimeZone.parser, "Europe/Paris").id) // "Europe/Paris"
 * ```
 *
 * @category parsers
 * @since 0.1.0
 */
export const parser: Parser.Parser<DateTime.TimeZone.Named> = name.pipe(
  Parser.flatMap((zoneName) =>
    Option.match(known(zoneName), {
      onNone: () =>
        Parser.cut(Parser.failMessage(`"${zoneName}" is not a time zone the runtime knows`)),
      onSome: (zone) => Parser.succeed(zone),
    }),
  ),
  Parser.context("IANA time zone name"),
);

/**
 * Parses a whole string as a time zone name the runtime knows; see
 * {@link parser}.
 *
 * Fails with the effect-parse `ParseError`, whose `message` shows the
 * column and what was expected there.
 *
 * @example
 * ```ts
 * import { DateTime, Effect } from "effect"
 * import { IanaTimeZone } from "@thomasfosterau/effect-time"
 *
 * const program = Effect.map(IanaTimeZone.parse("Asia/Tokyo"), (zone) =>
 *   DateTime.formatIsoZoned(DateTime.setZone(DateTime.makeUnsafe("2026-10-22T00:00:00Z"), zone))
 * )
 *
 * Effect.runPromise(program).then(console.log) // "2026-10-22T09:00:00.000+09:00[Asia/Tokyo]"
 * ```
 *
 * @category parsing
 * @since 0.1.0
 */
export const parse = (
  input: string,
): Effect.Effect<DateTime.TimeZone.Named, ParseError.ParseError> =>
  Parser.parseEffect(parser, input);

/**
 * A `Schema` from a time zone name to the runtime's
 * `DateTime.TimeZone.Named`: decoding runs {@link parser} and reports a
 * failure as an issue carrying the `ParseError` message; encoding gives the
 * zone's `id`, the runtime's canonical spelling, so an alias does not round
 * trip as written.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { IanaTimeZone } from "@thomasfosterau/effect-time"
 *
 * const User = Schema.Struct({ timeZone: IanaTimeZone.FromString })
 *
 * const user = Schema.decodeUnknownSync(User)({ timeZone: "Australia/Sydney" })
 *
 * console.log(user.timeZone.id) // "Australia/Sydney"
 * ```
 *
 * @category schemas
 * @since 0.1.0
 */
export const FromString: ParserSchema.ParserSchema<DateTime.TimeZone.Named> = ParserSchema.make(
  parser,
  {
    encode: (zone) => zone.id,
    description: "an IANA time zone name",
  },
);
