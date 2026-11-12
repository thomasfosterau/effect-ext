# Time

Parsers and printers for the strings and files time travels in, producing Effect's own `DateTime`, `Duration` amounts and `Cron`: RFC 3339 and RFC 9557 date-times, ISO 8601 durations, POSIX TZ strings, cron expressions, RFC 5545 recurrence rules, IANA time zone names and TZif files. These were `@thomasfosterau/effect-time`. Each needs the optional peer `@thomasfosterau/effect-parse`.

Parsers and printers for the strings and files time travels in (merged in from thomasfosterau/effect-time, which was never published). Each produces and consumes Effect's own values (`DateTime`, the amounts `DateTime.add` takes, `Cron`) and comes as a parser to compose, an effectful decoder, a printer and a `Schema`, with errors that point at the offending field. They are built on [`@thomasfosterau/effect-parse`](https://www.npmjs.com/package/@thomasfosterau/effect-parse), an optional peer, so these eight modules are subpaths only.

effect-time also re-exported `effect/Clock` and `effect/DateTime` unchanged; those re-exports are not carried, because Effect already provides them: import `Clock` and `DateTime` from `effect`, as the examples below do.

## `Rfc3339`

```ts
import { Effect, Schema } from "effect";
import * as DateTime from "effect/DateTime";
import * as Rfc3339 from "@thomasfosterau/effect-ext/Rfc3339";

// An effect that fails with effect-parse's ParseError.
const program = Effect.map(Rfc3339.parse("2026-10-22T09:30:00+10:00"), DateTime.formatIso);
// "2026-10-21T23:30:00.000Z"

// A Schema<DateTime, string>; a failure's issue carries the ParseError message.
const Event = Schema.Struct({ at: Rfc3339.FromString });
```

The grammar is RFC 3339's `date-time`. The separator may be `T`, `t` or a space, and the offset `Z`, `z` or `±hh:mm`. It checks the calendar (`2026-02-29` fails) and the clock ranges, and the error names the field that is out of range:

```text
Parse error at line 1, column 9:
1 | 2026-02-30T00:00:00Z
  |         ^
while parsing RFC 3339 date-time
expected day of month (01-28), found "3"
```

`Z` and `-00:00` (UTC, local offset unknown) give a `DateTime.Utc`. Any other offset gives a `DateTime.Zoned` in that fixed offset, so `Rfc3339.format` prints it back unchanged. Fractional seconds are truncated to milliseconds. A leap second (`:60`) is rejected because `DateTime` cannot hold it. `Rfc3339.parser` is the effect-parse `Parser`, for embedding a timestamp in a larger grammar.

## `Rfc9557`

```ts
import { Effect } from "effect";
import * as Rfc3339 from "@thomasfosterau/effect-ext/Rfc3339";
import * as Rfc9557 from "@thomasfosterau/effect-ext/Rfc9557";

const program = Effect.map(
  Rfc9557.parse("2026-10-22T00:00:00Z[Australia/Sydney][u-ca=gregory]"),
  (ixdtf) => Rfc3339.format(Rfc9557.toDateTime(ixdtf)),
);
// "2026-10-22T11:00:00.000+11:00"
```

The grammar is RFC 9557's `date-time-ext`: an RFC 3339 date-time (read by `Rfc3339.parser`), then at most one time zone suffix (`[Europe/Paris]`, `[+05:30]`), then any number of annotations (`[u-ca=hebrew]`, `[_x-key=a-b]`). A suffix starting with `!` is critical. The result is an `Ixdtf`: the instant as the written offset fixes it, the time zone suffix (`Option`) and the annotations, as written. `Rfc9557.toDateTime` views the instant in the suffixed time zone when `DateTime` knows it.

Following RFC 9557 §3.4, a critical time zone that `DateTime` does not know, or whose offset at the instant differs from a numeric written offset, fails the parse; an elective one is kept as written. Critical annotations are reported with `critical: true` and never acted on: an application must reject the critical keys it does not understand itself. `Rfc9557.format` prints an `Ixdtf` back, and `Rfc9557.FromString` is the `Schema` from the string.

## `PosixTz`

```ts
import { Effect, Option } from "effect";
import * as PosixTz from "@thomasfosterau/effect-ext/PosixTz";

const program = Effect.map(PosixTz.parse("AEST-10AEDT,M10.1.0,M4.1.0/3"), (tz) => ({
  standard: tz.std.utcOffset, // 36000: ten hours east of UTC
  daylight: Option.map(tz.dst, (dst) => dst.utcOffset), // Option.some(39600)
}));
```

The grammar is POSIX.1-2017 §8.3's `std offset [dst [offset] [,start[/time],end[/time]]]`, the `TZ` environment variable format and the footer of a TZif file. A designation is three or more letters (`AEST`) or three or more letters, digits, `+` and `-` in angle brackets (`<+1030>`). POSIX writes offsets positive _west_ of Greenwich (`EST5`); a parsed `Designation` stores `utcOffset` in seconds positive _east_, as ISO 8601 and `DateTime` do. A daylight designation without an offset is one hour ahead of standard time. Rule dates are `Jn` (1–365, never counting February 29), `n` (0–365) or `Mm.w.d` (week 5 is the last), each with an optional `/time` from -167 to 167 hours (the RFC 8536 extension), defaulting to 02:00. A string with a daylight designation but no rule (`EST5EDT`) gives `rule: Option.none()`, since POSIX leaves that rule to the implementation, and the implementation-defined `:name` form is not read. `PosixTz.format` prints a `PosixTz` back, leaving out the defaults, and `PosixTz.FromString` is the `Schema` from the string.

## `CronExpression`

```ts
import { Cron, DateTime, Effect } from "effect";
import * as CronExpression from "@thomasfosterau/effect-ext/CronExpression";

const nextRun = Effect.map(
  CronExpression.parseIn("0 9 * * MON-FRI", DateTime.zoneMakeNamedUnsafe("Australia/Sydney")),
  (cron) => Cron.next(cron, DateTime.makeUnsafe("2026-10-24T00:00:00Z")),
);
// 2026-10-25T22:00:00.000Z, 9:00 on Monday in Sydney
```

The result is Effect's own `Cron`, so `Cron.next`, `Cron.match` and `Cron.sequence` work on it, and for a valid expression it equals what `Cron.parse` gives. What this module adds is the error: a value out of range, a range that runs backwards, a zero step or a wrong field count fails at its column and names the field, as an effect-parse `ParseError`. The grammar is Vixie cron's: five fields (minute, hour, day of month, month, day of week) or six with a leading second, each a comma-separated list of `*`, `n` or `a-b` with an optional `/step`, month and weekday names in any case, Sunday as 0 or 7, and the macros `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight` and `@hourly`. When both day fields are restricted a time matches either, unless one starts with `*`. Quartz's `?`, `L`, `W` and `#` are not read. `CronExpression.parseIn` and `CronExpression.parserIn` take a time zone, `CronExpression.format` prints with `Cron.format`, and `CronExpression.FromString` is the `Schema` from the string.

## `RRule`

```ts
import { Effect } from "effect";
import * as RRule from "@thomasfosterau/effect-ext/RRule";

const program = Effect.map(RRule.parse("FREQ=MONTHLY;BYDAY=-1FR;COUNT=6"), (rule) => rule.byDay);
// [{ ordinal: Option.some(-1), weekday: "FR" }]: the last Friday of each month
```

The grammar is RFC 5545 §3.3.10's `recur`, the value of an `RRULE` property (the text after `RRULE:`): `NAME=value` parts separated by `;`, in any order and any case, each at most once, `FREQ` required. A parsed `RRule` has `freq`, `until` and `count` (`Option`s), `interval` (default 1), the `BY…` lists (empty when absent), and `weekStart` (`WKST`, default `"MO"`). `UNTIL` is kept as written, a date or a date-time with or without `Z`, because a floating time has no instant until the rule's start gives it a zone. Every value is range-checked, and RFC 5545's cross-part restrictions fail the parse: `UNTIL` with `COUNT`, `BYDAY` ordinals outside `MONTHLY` and `YEARLY`, `BYMONTHDAY` with `WEEKLY`, `BYYEARDAY` with `DAILY`, `WEEKLY` or `MONTHLY`, `BYWEEKNO` outside `YEARLY`, and `BYSETPOS` alone. RFC 7529's `RSCALE` and `SKIP` are not read, and the rule is parsed, not expanded into occurrences. `RRule.format` prints a rule back in RFC 5545's part order, and `RRule.FromString` is the `Schema` from the string.

## `IanaTimeZone`

```ts
import { DateTime, Effect } from "effect";
import * as IanaTimeZone from "@thomasfosterau/effect-ext/IanaTimeZone";

const program = Effect.map(IanaTimeZone.parse("Asia/Tokyo"), (zone) =>
  DateTime.setZone(DateTime.makeUnsafe("2026-10-22T00:00:00Z"), zone),
);

IanaTimeZone.isKnown("Mars/Olympus_Mons"); // false
```

A name is read with the tz database's naming rules (`/`-separated components of 1–14 letters, digits, `.`, `_`, `-` and `+`) and then checked against the time zones the JavaScript runtime knows. Nothing is bundled: the answer comes from the runtime's ICU build, through `Intl.DateTimeFormat`, so it depends on that runtime and its tz data version. Aliases (`US/Eastern`), `UTC`, `Etc/GMT±n` and any letter case are accepted, and the result is the runtime's `DateTime.TimeZone.Named`, whose `id` is the runtime's canonical spelling. That spelling can differ between runtimes (`Asia/Kolkata` or `Asia/Calcutta`). `IanaTimeZone.supported()` is `Intl.supportedValuesOf("timeZone")`, the runtime's list of canonical names, for offering a choice. It is not the set of valid names, because V8 leaves `UTC`, `Etc/GMT±n` and every alias out of it. `IanaTimeZone.FromString` is the `Schema` from the name; it encodes the canonical `id`.

## `Tzif`

```ts
import { Effect, Option } from "effect";
import * as PosixTz from "@thomasfosterau/effect-ext/PosixTz";
import * as Tzif from "@thomasfosterau/effect-ext/Tzif";

// `bytes` holds the contents of /usr/share/zoneinfo/Australia/Sydney.
const program = (bytes: Uint8Array) =>
  Effect.map(Tzif.parse(bytes), (tzif) => Option.map(tzif.footer, PosixTz.format));
// Option.some("AEST-10AEDT,M10.1.0,M4.1.0/3")
```

`Tzif.parser` is an effect-parse binary parser over a `Uint8Array`, reading RFC 8536's TZif format, versions 1 to 4. For version 2 and later it reads the 64-bit data block and the footer, and skips the 32-bit block. A `Tzif` holds the transitions (a time in seconds since the epoch and an index into the local time types), the local time types (UTC offset in seconds east, DST flag, designation, and the standard/wall and UT/local indicators), the leap second records, and the footer parsed with `PosixTz.parser` (`Option.none()` when it is empty or the file is version 1). The parser enforces RFC 8536's structural requirements: the counts, ascending transition times, indices in range, 0/1 flags and a valid footer. A violation fails at its byte offset. Reading files is left to the caller, so the module works the same in a browser, a Worker or Node.

## `IsoDuration`

```ts
import { Effect, Option } from "effect";
import * as DateTime from "effect/DateTime";
import * as IsoDuration from "@thomasfosterau/effect-ext/IsoDuration";

const later = Effect.map(IsoDuration.parse("P1DT12H"), (duration) =>
  DateTime.add(DateTime.makeUnsafe("2026-10-22T00:00:00Z"), duration),
);

IsoDuration.format({ days: 1, milliseconds: 1500 }); // Option.some("P1DT1.5S")
IsoDuration.format({ days: 1, hours: -1 }); // Option.none(): mixed signs
```

A parsed duration is every amount `DateTime.add` takes (`years` through `milliseconds`), unnormalised: `PT90M` is 90 minutes. The grammar is `PnW`, or `PnYnMnDTnHnMnS` with any amounts left out (at least one, and at least one after a `T`). It also accepts a leading sign, a `.` or `,` fraction on the seconds (truncated to milliseconds) and lower-case letters. `IsoDuration.FromString` is the `Schema` from the string.
