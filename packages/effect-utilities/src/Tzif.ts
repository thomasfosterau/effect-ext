/**
 * TZif files (RFC 8536), the compiled time zone files of the tz database
 * (`/usr/share/zoneinfo/Europe/Paris`): their transitions, local time
 * types, leap seconds and POSIX TZ footer, as a binary parser and an
 * effectful decoder.
 *
 * @since 0.1.0
 */
import * as Binary from "@thomasfosterau/effect-parse/Binary";
import type * as ParseError from "@thomasfosterau/effect-parse/ParseError";
import * as Parser from "@thomasfosterau/effect-parse/Parser";
import * as Token from "@thomasfosterau/effect-parse/Token";
import * as Arr from "effect/Array";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import * as PosixTz from "./PosixTz.ts";

/**
 * A local time type: its offset from UTC in seconds (positive east of
 * Greenwich), whether it is daylight saving time, its abbreviation
 * (`AEDT`), and the two indicators RFC 8536 attaches to it for POSIX TZ
 * rules without a footer: whether its transition times are standard time
 * (`standard`) and UT (`universal`) rather than wall-clock time.
 *
 * @category models
 * @since 0.1.0
 */
export interface LocalTimeType {
  readonly utcOffset: number;
  readonly isDst: boolean;
  readonly designation: string;
  readonly standard: boolean;
  readonly universal: boolean;
}

/**
 * A transition: from `time` (seconds since 1970-01-01T00:00:00Z, leap
 * seconds included when the file has any) the local time type at index
 * `type` of {@link Tzif.localTimeTypes} applies.
 *
 * @category models
 * @since 0.1.0
 */
export interface Transition {
  readonly time: number;
  readonly type: number;
}

/**
 * A leap second record: from `occurrence` (seconds since the epoch, leap
 * seconds included) the total correction is `correction` seconds.
 *
 * @category models
 * @since 0.1.0
 */
export interface LeapSecond {
  readonly occurrence: number;
  readonly correction: number;
}

/**
 * A parsed TZif file. For version 2 and later this is the 64-bit data
 * block, which supersedes the 32-bit one, and `footer` is the POSIX TZ
 * string for times after the last transition (`None` when the footer is
 * empty, and always for version 1).
 *
 * @category models
 * @since 0.1.0
 */
export interface Tzif {
  readonly version: 1 | 2 | 3 | 4;
  readonly transitions: ReadonlyArray<Transition>;
  readonly localTimeTypes: ReadonlyArray<LocalTimeType>;
  readonly leapSeconds: ReadonlyArray<LeapSecond>;
  readonly footer: Option.Option<PosixTz.PosixTz>;
}

interface Header {
  readonly version: 1 | 2 | 3 | 4;
  readonly isutcnt: number;
  readonly isstdcnt: number;
  readonly leapcnt: number;
  readonly timecnt: number;
  readonly typecnt: number;
  readonly charcnt: number;
}

// The version byte: NUL for version 1, then the ASCII digits '2' to '4'.
const versions = [
  [0, 1],
  [0x32, 2],
  [0x33, 3],
  [0x34, 4],
] as const;

const versionOf = (byte: number): Option.Option<1 | 2 | 3 | 4> =>
  Arr.findFirst(versions, ([b]) => b === byte).pipe(Option.map(([, version]) => version));

const failAt = <A>(message: string): Parser.Parser<A, never, never, Uint8Array> =>
  Parser.cut(Parser.failMessage(message));

const header: Parser.Parser<Header, never, never, Uint8Array> = Parser.gen(function* () {
  yield* Token.literal(new Uint8Array([0x54, 0x5a, 0x69, 0x66])).pipe(
    Parser.expected('the "TZif" magic number'),
  );
  const version = yield* Binary.u8.pipe(
    Parser.filterMap(versionOf),
    Parser.expected("version (0, '2', '3' or '4')"),
  );
  yield* Token.take<Uint8Array>(15);
  const { isutcnt, isstdcnt, leapcnt, timecnt, typecnt, charcnt } = yield* Parser.struct({
    isutcnt: Binary.beU32,
    isstdcnt: Binary.beU32,
    leapcnt: Binary.beU32,
    timecnt: Binary.beU32,
    typecnt: Binary.beU32,
    charcnt: Binary.beU32,
  });
  if (typecnt === 0)
    return yield* failAt<Header>("typecnt is 0: a TZif file needs a local time type");
  if (charcnt === 0) return yield* failAt<Header>("charcnt is 0: a TZif file needs a designation");
  if (isutcnt !== 0 && isutcnt !== typecnt)
    return yield* failAt<Header>("isutcnt is neither 0 nor typecnt");
  if (isstdcnt !== 0 && isstdcnt !== typecnt)
    return yield* failAt<Header>("isstdcnt is neither 0 nor typecnt");
  return { version, isutcnt, isstdcnt, leapcnt, timecnt, typecnt, charcnt };
});

/**
 * The longest footer accepted, in bytes. RFC 8536 sets no limit; the
 * tz database's footers are under 100 bytes, so this leaves room while
 * bounding what a hostile file can make the parser hold.
 */
const MAX_FOOTER = 255;

/**
 * The longest designation accepted, in bytes. RFC 8536 recommends 3 to 6
 * characters; the reference implementation's limit (`TZ_MAX_CHARS`) is 50
 * for all of them together.
 */
const MAX_DESIGNATION = 32;

const isPrintableAscii = (b: number): boolean => b >= 0x20 && b <= 0x7e;

// Byte by byte, so the input's size never reaches the call stack; only
// ever called on bounded, printable ASCII.
const ascii = (bytes: Uint8Array): string =>
  Arr.join(
    Arr.map(Array.from(bytes), (b) => String.fromCharCode(b)),
    "",
  );

// The NUL-terminated designation starting at `index`, or why it is not one.
const designationAt = (chars: Uint8Array, index: number): Result.Result<string, string> => {
  const end = chars.indexOf(0, index);
  if (end === -1) return Result.fail(`the designation at index ${index} is not NUL-terminated`);
  const bytes = chars.subarray(index, end);
  if (bytes.length > MAX_DESIGNATION) {
    return Result.fail(`the designation at index ${index} is longer than ${MAX_DESIGNATION} bytes`);
  }
  if (!bytes.every(isPrintableAscii)) {
    return Result.fail(`the designation at index ${index} is not printable ASCII`);
  }
  return Result.succeed(ascii(bytes));
};

const isAscending = (times: ReadonlyArray<number>): boolean =>
  Arr.every(Arr.drop(times, 1), (t, i) => t > (times[i] ?? Number.NEGATIVE_INFINITY));

// The data block: 32-bit times for `width` 4 (version 1), 64-bit for 8.
const dataBlock = (h: Header, width: 4 | 8) =>
  Parser.gen(function* () {
    const time =
      width === 4 ? Binary.beI32 : Binary.beI64.pipe(Parser.map((t: bigint) => Number(t)));
    const times = yield* Parser.repeat(time, h.timecnt);
    if (!isAscending(times))
      return yield* failAt<never>("transition times are not in ascending order");
    const types = yield* Parser.repeat(
      Binary.u8.pipe(
        Parser.filter((t) => t < h.typecnt),
        Parser.expected(`local time type index (0-${h.typecnt - 1})`),
      ),
      h.timecnt,
    );
    const infos = yield* Parser.repeat(
      Parser.struct({
        utcOffset: Binary.beI32.pipe(
          Parser.filter((o) => o !== -(2 ** 31)),
          Parser.expected("UT offset (not -2^31)"),
        ),
        isDst: Binary.u8.pipe(
          Parser.filter((b) => b <= 1),
          Parser.map((b) => b === 1),
          Parser.expected("DST indicator (0 or 1)"),
        ),
        designationIndex: Binary.u8.pipe(
          Parser.filter((i) => i < h.charcnt),
          Parser.expected(`designation index (0-${h.charcnt - 1})`),
        ),
      }),
      h.typecnt,
    );
    const chars = yield* Token.take<Uint8Array>(h.charcnt);
    const leapSeconds = yield* Parser.repeat(
      Parser.struct({ occurrence: time, correction: Binary.beI32 }),
      h.leapcnt,
    );
    const indicator = Binary.u8.pipe(
      Parser.filter((b) => b <= 1),
      Parser.map((b) => b === 1),
      Parser.expected("indicator (0 or 1)"),
    );
    const standard = yield* Parser.repeat(indicator, h.isstdcnt);
    const universal = yield* Parser.repeat(indicator, h.isutcnt);
    if (Arr.some(universal, (ut, i) => ut && !(standard[i] ?? false))) {
      return yield* failAt<never>("a UT indicator is set without its standard/wall indicator");
    }
    const designations = Result.all(
      Arr.map(infos, (info) => designationAt(chars, info.designationIndex)),
    );
    if (Result.isFailure(designations)) return yield* failAt<never>(designations.failure);
    const localTimeTypes = Arr.map(infos, (info, i): LocalTimeType => ({
      utcOffset: info.utcOffset,
      isDst: info.isDst,
      designation: designations.success[i] ?? "",
      standard: standard[i] ?? false,
      universal: universal[i] ?? false,
    }));
    const transitions = Arr.zipWith(times, types, (t, type): Transition => ({ time: t, type }));
    return { transitions, localTimeTypes, leapSeconds };
  });

const newline = Token.literal(new Uint8Array([0x0a])).pipe(Parser.expected("newline"));

const footerEnd = newline.pipe(
  Parser.expected(`newline ending the footer (at most ${MAX_FOOTER} printable ASCII bytes)`),
);

// `\n`, a POSIX TZ string (possibly empty), `\n`.
const footer: Parser.Parser<Option.Option<PosixTz.PosixTz>, never, never, Uint8Array> = Parser.gen(
  function* () {
    yield* newline;
    // Printable ASCII and at most MAX_FOOTER bytes: anything else fails at
    // the offending byte, expecting the closing newline.
    const text = yield* Parser.taken(
      Binary.u8.pipe(Parser.filter(isPrintableAscii), Parser.repeat({ min: 0, max: MAX_FOOTER })),
    );
    yield* Parser.cut(footerEnd);
    const footerText = ascii(text);
    if (Str.isEmpty(footerText)) return Option.none<PosixTz.PosixTz>();
    const posix = Parser.parse(PosixTz.parser, footerText);
    return yield* Result.match(posix, {
      onSuccess: (tz) => Parser.succeed(Option.some(tz)),
      onFailure: (error) =>
        failAt<Option.Option<PosixTz.PosixTz>>(`invalid footer: ${error.message}`),
    });
  },
);

/**
 * The TZif format as an effect-parse binary `Parser` over a `Uint8Array`.
 *
 * It reads the header and, for version 1, the 32-bit data block; for
 * version 2 and later it skips that block and reads the second header,
 * the 64-bit data block and the footer. RFC 8536's requirements are
 * checked: the counts (`typecnt` and `charcnt` non-zero, `isutcnt` and
 * `isstdcnt` 0 or `typecnt`), ascending transition times, type and
 * designation indices in range, 0/1 indicators, no UT indicator without its
 * standard one, NUL-terminated designations of at most 32 printable ASCII
 * bytes, and a footer of at most 255 printable ASCII bytes that is a valid
 * POSIX TZ string (see {@link PosixTz.parser}). The bounds keep a hostile
 * file from making the parser hold or build arbitrarily large strings.
 *
 * 64-bit times are converted to numbers: exact for any time within
 * ±2^53 seconds, and for the -2^59 "big bang" transition the tz database
 * writes.
 *
 * @example
 * ```ts
 * import { Parser } from "@thomasfosterau/effect-parse"
 * import { Tzif } from "@thomasfosterau/effect-time"
 *
 * // A version 1 file with one local time type, UTC, and no transitions
 * const utc = new Uint8Array([
 *   0x54, 0x5a, 0x69, 0x66, 0, ...new Array(15).fill(0),
 *   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 4,
 *   0, 0, 0, 0, 0, 0, 0x55, 0x54, 0x43, 0
 * ])
 *
 * console.log(Parser.parseSync(Tzif.parser, utc).localTimeTypes[0]?.designation) // "UTC"
 * ```
 *
 * @category parsers
 * @since 0.1.0
 */
export const parser: Parser.Parser<Tzif, never, never, Uint8Array> = Parser.gen(function* () {
  const first = yield* header;
  if (first.version === 1) {
    const data = yield* dataBlock(first, 4);
    return { version: 1 as const, ...data, footer: Option.none<PosixTz.PosixTz>() };
  }
  // Skip the version 1 data block, which version 2+ readers ignore.
  yield* Token.take<Uint8Array>(
    first.timecnt * 5 +
      first.typecnt * 6 +
      first.charcnt +
      first.leapcnt * 8 +
      first.isstdcnt +
      first.isutcnt,
  );
  const second = yield* header;
  const data = yield* dataBlock(second, 8);
  const tz = yield* footer;
  return { version: second.version, ...data, footer: tz };
}).pipe(Parser.context("TZif file"));

/**
 * Parses a whole TZif file; see {@link parser} for what is read and
 * checked.
 *
 * Fails with the effect-parse `ParseError`, whose `message` gives the byte
 * offset and what was expected there.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Tzif } from "@thomasfosterau/effect-time"
 *
 * Effect.runPromise(Effect.flip(Tzif.parse(new Uint8Array([0x50, 0x4b])))).then((error) =>
 *   console.log(error._tag) // "ParseError"
 * )
 * ```
 *
 * @category parsing
 * @since 0.1.0
 */
export const parse = (input: Uint8Array): Effect.Effect<Tzif, ParseError.ParseError> =>
  Parser.parseEffect(parser, input);
