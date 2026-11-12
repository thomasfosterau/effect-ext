# @thomasfosterau/effect-ext

Experimental extensions to the [Effect](https://effect.website) standard library and its AI module, in one package with one subpath per module: Allocator-backed binary data, pure Schema helpers, web-platform modules (headers, feeds, CSS, encodings, MIME), Rust-style numeric types, time-format parsers, the provider-neutral AI services `effect/ai` lacks, and an LLM evaluation toolkit with the `effect-evals` CLI.

> **Status:** experimental. APIs may change between minor versions until 1.0.

## Install

```sh
pnpm add @thomasfosterau/effect-ext effect
```

`effect` (`^4.0.0`) is a peer dependency: it must be a single copy across your app. Optional peers, each needed only by the subpaths that import it (those subpaths are not on the root barrel, so importing it never needs a peer you did not install):

- `@effect/platform-browser` `^4.0.0`: `Browser`, `BrowserTesting`.
- `@thomasfosterau/effect-parse` `^0.4.1 || ^0.5.0`: `Robots` and the eight time modules.
- `@effect/platform-node` `^4.0.0`: the `effect-evals` CLI only.

Node.js 22 or later for the library; the CLI needs 22.18 or later. ESM only, `"sideEffects": false`.

## Example

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layout from "@thomasfosterau/effect-ext/Layout";
import * as Vec from "@thomasfosterau/effect-ext/Vec";

const Vec2 = Layout.struct({ x: Layout.f32, y: Layout.f32 });

const program = Effect.gen(function* () {
  const points = yield* Vec.make(Vec2, { capacity: 1024 });
  yield* Vec.push(points, { x: 1, y: 2 });
  return Option.getOrThrow(Vec.at(points, 0)); // a BufferStruct view of element 0
});
```

Every module is also on the root barrel as a namespace (`import { Vec } from "@thomasfosterau/effect-ext"`), except the ones that need an optional peer and the evals toolkit.

## Entry points

Every subpath is `@thomasfosterau/effect-ext/<Module>`. Per-export detail is in each module's doc comments ([`src/`](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ext/src)); each family's guide carries the narrative and worked examples.

### Binary data

Guide: [binary-data](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/binary-data.md).

| Subpath | What it is |
| --- | --- |
| `Allocator` | An `Allocator` service handing out `ArrayBuffer` blocks: heap, arena and tracked. |
| `Layout` | Binary layouts (`u8` ... `f64`, `bool`, structs, fixed arrays) with C-like alignment. |
| `BufferStruct` | Structs whose fields live in an `ArrayBuffer`, exposed as ordinary properties. |
| `Vec` | A growable, `ArrayBuffer`-backed array, like Rust's `Vec<T>`. |
| `StructOfArrays` | A growable struct-of-arrays container with typed-array columns. |
| `String` | A growable, Allocator-backed UTF-8 string, like Rust's `String`. |
| `Str` | An immutable UTF-8 string slice, like Rust's `str`; usable as a `HashMap` key. |

### Schema

Guide: [schema](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/schema.md).

| Subpath | What it is |
| --- | --- |
| `TriState` | Partial-update fields that keep "absent" and "cleared" apart, and their readers. |
| `Issues` | `SchemaIssue` trees to RFC 6901 JSON Pointers. |
| `Bounded` | Bounded pagination and id-list codecs. |
| `Ids` | UUIDs, branded UUID ids and slugs. |
| `LiteralExact` | Literal tuples checked to cover a union exactly. |
| `Ast` | Schema field introspection by AST and decode probe. |
| `Url` | An absolute URL whose scheme, host, port, credentials and path are part of its type. |
| `OptionalKey` | Optional keys for object construction under `exactOptionalPropertyTypes`. |

### Web platform

Guide: [web](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/web.md).

| Subpath | What it is |
| --- | --- |
| `Web` | Response-header policies, the cross-origin mutation guard, the trusted client address, the canonical site base, the JSON:API guard responses and the Fetch adapters. |
| `Net` | The SSRF host block list, the URL safety check and the redirect-revalidating fetch. |
| `Observability` | The structured JSON-line sink, the allow-listed span tracer, the `logEvent` trio, `describeError`, the auth-outcome signal and per-request metrics. |
| `Negotiate` | The content-negotiation verdict over the representations you declare. |
| `ServiceWorker` | Cache Storage as typed effects, the five caching strategies, a route table that becomes a `fetch` listener, and lifecycle listeners. |
| `Browser` | Browser platform APIs as Effect services, and one `layer` with every live service. Needs `@effect/platform-browser`. |
| `BrowserTesting` | In-memory doubles for every `Browser` service, each with a `Control`; `observe`. Needs `@effect/platform-browser`. |
| `Robots` | The Robots Exclusion Protocol (RFC 9309): the library, the crawler side and the serving side. Needs `@thomasfosterau/effect-parse`. |

### Sitemaps and feeds

Guide: [feeds](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/feeds.md).

| Subpath | What it is |
| --- | --- |
| `Sitemap` | `sitemap.xml` (whole or streamed), the sitemap index, the `feed.json` adapter and the `Cache-Tag` purge. |
| `RssFeed` | An RSS 2.0 feed, rendered and served. |
| `AtomFeed` | An Atom (RFC 4287) feed, rendered and served. |
| `JsonFeed` | A JSON Feed 1.1 document, rendered and served, and a lenient reader. |

### Text formats

Guide: [text-formats](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/text-formats.md).

| Subpath | What it is |
| --- | --- |
| `UriTemplate` | URI Templates (RFC 6570), `Link` headers (RFC 8288) and well-known URIs (RFC 8615). |
| `Langtag` | BCP 47 language tags, language-range matching, `Accept-Language` and `negotiateLanguage`. |
| `LangtagRegistry` | Validity and canonical form against the IANA Language Subtag Registry (~45 KB, so a separate subpath). |
| `Css` | CSS Syntax 3 parsing, `An+B`, CSS Color 4 / 5, lengths, the box shorthands, fonts, text values and serialisation. |
| `Encoding` | The WHATWG Encoding Standard: labels, BOM sniffing, fatal decoding and encoding. |
| `EncodingJapanese`, `EncodingGb18030`, `EncodingBig5`, `EncodingEucKr` | The opt-in CJK indexes for `Encoding`. |
| `Mime` | MIME types, MIME sniffing and `data:` URLs. |

### Numeric

Guide: [numeric](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/numeric.md).

| Subpath | What it is |
| --- | --- |
| `I8`, `I16`, `I32`, `I64`, `I128`, `U8`, `U16`, `U32`, `U64`, `U128` | The standard fixed-width integers, like Rust's `i8` ... `u128`, with strict, checked, wrapping, saturating and overflowing arithmetic. |
| `FixedInt` | The `FixedInt` model and `make` / `makeBig` for integers of any width. |
| `Wrapping`, `Saturating`, `Checked`, `Overflowing` | The arithmetic strategies as type classes, with an instance per standard integer type. |
| `Clamped` | Numbers constrained to `[min, max]` at the type level. |
| `Float`, `F32` | The `Float` type class, `F64`, IEEE 754 total ordering, `NotNaN` / `Finite`; single precision floats. |
| `Ratio` | Exact rationals over `bigint`. |
| `Complex` | Complex numbers over doubles. |
| `Num` | `num-traits` style type classes, generic `sum` / `product` / `pow`, and instances. |
| `Integer` | `num-integer` algorithms: `gcd`, `lcm`, floored division, roots, `binomial`, `modPow`, `isPrime`. |
| `Range` | `num-iter` ranges: `range`, `rangeInclusive`, `rangeStep`, `linspace`. |
| `ArithmeticError` | The tagged errors of fallible numeric operations. |

### Time

All eight need `@thomasfosterau/effect-parse`. Guide: [time](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/time.md).

| Subpath | What it is |
| --- | --- |
| `Rfc3339` | RFC 3339 date-times parsed to and printed from `DateTime`. |
| `Rfc9557` | RFC 9557 (IXDTF) date-times with time zone and annotation suffixes. |
| `IsoDuration` | ISO 8601 durations parsed to and printed from the amounts `DateTime.add` takes. |
| `PosixTz` | POSIX TZ strings (`EST5EDT,M3.2.0,M11.1.0`). |
| `CronExpression` | Cron expressions parsed to Effect's `Cron`, with errors that name the field and column. |
| `RRule` | iCalendar recurrence rules (RFC 5545 `recur`). |
| `IanaTimeZone` | IANA time zone names checked against the runtime's tz data. |
| `Tzif` | Compiled TZif zone files (RFC 8536). |

### AI service abstractions

Guide: [ai](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/ai.md).

| Subpath | What it is |
| --- | --- |
| `RerankerModel`, `ClassifierModel`, `SpeechModel`, `TranscriptionModel`, `ImageModel`, `ModerationModel`, `VoiceConversionModel` | The provider-neutral AI service abstractions `effect/ai` lacks, each shaped like its `EmbeddingModel`. |

### Evals

Guide: [evals](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/evals.md).

| Subpath | What it is |
| --- | --- |
| `evals` and `evals/<Module>` | The LLM evaluation toolkit: `./evals` is its barrel, and each module is also `./evals/<Module>` (`./evals/Runner`, `./evals/metrics/Ranking`, `./evals/scorers/ExactMatch`, ...). Not on the root barrel. The `effect-evals` bin runs `*.eval.ts` suites. |

## Links

- Guides: [binary-data](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/binary-data.md), [schema](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/schema.md), [web](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/web.md), [feeds](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/feeds.md), [text-formats](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/text-formats.md), [numeric](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/numeric.md), [time](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/time.md), [ai](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/ai.md), [evals](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/evals.md)
- [Moving from effect-web](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/web.md#moving-from-effect-web) (the old package names and their subpaths here)
- [Source and API doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ext/src)
- [Repository README](https://github.com/thomasfosterau/effect-ext/blob/trunk/README.md)
- [Contributing](https://github.com/thomasfosterau/effect-ext/blob/trunk/CONTRIBUTING.md)
- [Security and invariant ids](https://github.com/thomasfosterau/effect-ext/blob/trunk/SECURITY.md)
- [Changelog](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/CHANGELOG.md)

## License

MIT
