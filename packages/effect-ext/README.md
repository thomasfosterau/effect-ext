# @thomasfosterau/effect-ext

Extensions to the [Effect](https://effect.website) standard library and to its AI module, in seven families:

- **Binary data** — an `Allocator` service, binary `Layout`s, `BufferStruct`s, `Vec`, `StructOfArrays`, and Rust-style UTF-8 `String` / `Str`.
- **Schema** — URLs whose scheme, host, port, credentials and path are part of their type, the update tri-state reader, Schema issue → RFC 6901 JSON Pointer walk, bounded pagination and id-list codecs, branded UUID ids and slugs, exact literal-union tuples, and AST / decode-probe introspection. No JSON:API, Drizzle or application vocabulary: the prefixes, caps and reserved words an application needs are parameters, never defaults.
- **Web platform** — framework-neutral request / response policies (security and cache headers, `Vary`, the cross-origin guard, client IP), an SSRF-guarded fetch, structured logging and span tracing, content negotiation, service-worker caching strategies, browser APIs as Effect services with in-memory test doubles, robots.txt, sitemaps, RSS / Atom / JSON Feed, URI Templates and `Link` headers, BCP 47 language tags, CSS parsing, the WHATWG Encoding Standard and MIME types. No SvelteKit, Alchemy or Cloudflare dependency. These modules were `@thomasfosterau/effect-web` and its sibling packages; see [Moving from effect-web](#moving-from-effect-web).
- **Numeric** — Rust-style numeric types, modelled on Rust's primitive integers and the [`num`](https://github.com/rust-num/num) crates: fixed-width integers `I8` … `I128`, `U8` … `U128` (and any width you define) with strict, checked, wrapping, saturating and overflowing arithmetic, clamped ranges, floats with IEEE 754 total ordering, exact rationals, complex numbers and `num-traits` style type classes. These were `effect-numeric`; see [Numeric](#numeric).
- **Time** — parsers and printers for the strings and files time travels in, producing Effect's own `DateTime`, `Duration` amounts and `Cron`: RFC 3339 and RFC 9557 date-times, ISO 8601 durations, POSIX TZ strings, cron expressions, RFC 5545 recurrence rules, IANA time zone names and TZif files. These were `@thomasfosterau/effect-time`; see [Time](#time).
- **AI service abstractions** — the provider-neutral services `effect/ai` lacks (reranking, classification, text-to-speech, speech-to-text, image generation, moderation, voice conversion), each shaped like `effect/ai`'s own `EmbeddingModel`. These were `@thomasfosterau/effect-ai-ext`; see [AI service abstractions](#ai-service-abstractions).
- **Evals** — an Effect-native LLM evaluation toolkit: goldens, scorers, thresholds, G-Eval, RAG and retrieval-ranking metrics, a caching runner, reporters and the `effect-evals` CLI, under `./evals`. These were `@thomasfosterau/effect-evals`; see [Evals](#evals).

> **Status:** experimental. APIs may change between minor versions until 1.0.

## Install

```sh
pnpm add @thomasfosterau/effect-ext effect
```

Peer: `effect` `^4.0.0`. Two optional peers, each needed only by the modules that import it — install it when you use them: `@effect/platform-browser` `^4.0.0` (`Browser`, `BrowserTesting`) and `@thomasfosterau/effect-parse` `^0.4.1 || ^0.5.0` (`Robots` and the eight time modules). Those modules are subpaths only; the barrel does not re-export them, so it never needs a peer you did not install. A third optional peer, `@effect/platform-node` `^4.0.0`, is needed only by the `effect-evals` CLI (see [CLI](#cli)). Node.js 22 or later for the library; the `effect-evals` CLI needs 22.18 or later (it type-strips `*.eval.ts` files, on by default from 22.18) and says so when started on an older Node. ESM only, `"sideEffects": false`; every module is also its own entry point:

```ts
import { Vec, TriState } from "@thomasfosterau/effect-ext";
// or
import * as Vec from "@thomasfosterau/effect-ext/Vec";
```

| Module | Description |
| --- | --- |
| `Allocator` | An `Allocator` service handing out `ArrayBuffer` blocks: heap, arena and tracked. |
| `Layout` | Binary layouts (`u8` … `f64`, `bool`, structs, fixed arrays) with C-like alignment. |
| `BufferStruct` | Structs whose fields live in an `ArrayBuffer`, exposed as ordinary properties. |
| `Vec` | A growable, `ArrayBuffer`-backed array, like Rust's `Vec<T>`. |
| `StructOfArrays` | A growable struct-of-arrays container with typed-array columns. |
| `String` | A growable, Allocator-backed UTF-8 string, like Rust's `String`. |
| `Str` | An immutable UTF-8 string slice, like Rust's `str`; usable as a `HashMap` key. |
| `TriState` | Partial-update fields that keep "absent" and "cleared" apart, and their readers. |
| `Issues` | `SchemaIssue` trees → RFC 6901 JSON Pointers. |
| `Bounded` | Bounded pagination and id-list codecs. |
| `Ids` | UUIDs, branded UUID ids and slugs. |
| `LiteralExact` | Literal tuples checked to cover a union exactly. |
| `Ast` | Schema field introspection by AST and decode probe. |
| `Url` | An absolute URL whose scheme, host, port, credentials and path are part of its type. |
| `OptionalKey` | Optional keys for object construction under `exactOptionalPropertyTypes`. |
| `Web` | Response-header policies, the cross-origin mutation guard, the trusted client address, the degraded-session report, the canonical site base, the JSON:API guard responses and the Fetch adapters. |
| `Net` | The SSRF host block list, the URL safety check and the redirect-revalidating fetch. |
| `Observability` | The structured JSON-line sink, the allow-listed span tracer, the `logEvent` trio, `describeError`, the auth-outcome signal and per-request metrics. |
| `Negotiate` | The content-negotiation verdict over the representations you declare (media type, served paths, accepted parameters). |
| `ServiceWorker` | Cache Storage as typed effects, the five caching strategies, a route table that becomes a `fetch` listener, and lifecycle listeners whose work runs inside `waitUntil`. |
| `Browser` | Browser platform APIs as Effect services, and one `layer` with every live service. Needs `@effect/platform-browser`. |
| `BrowserTesting` | In-memory doubles for every `Browser` service, each with a `Control`; `observe`. Needs `@effect/platform-browser`. |
| `Robots` | The Robots Exclusion Protocol (RFC 9309): the library, the crawler side and the serving side. Needs `@thomasfosterau/effect-parse`. |
| `Sitemap` | `sitemap.xml` (whole or streamed), the sitemap index, the `feed.json` adapter and the `Cache-Tag` purge. |
| `RssFeed` | An RSS 2.0 feed, rendered and served. |
| `AtomFeed` | An Atom (RFC 4287) feed, rendered and served. |
| `JsonFeed` | A JSON Feed 1.1 document, rendered and served, and a lenient reader. |
| `UriTemplate` | URI Templates (RFC 6570), `Link` headers (RFC 8288) and well-known URIs (RFC 8615). |
| `Langtag` | BCP 47 language tags, language-range matching, `Accept-Language` and `negotiateLanguage`. |
| `LangtagRegistry` | Validity and canonical form against the IANA Language Subtag Registry (~45 KB, so a separate subpath). |
| `Css` | CSS Syntax 3 parsing, `An+B`, CSS Color 4 / 5, lengths, the box shorthands, fonts, text values and serialisation. |
| `Encoding` | The WHATWG Encoding Standard: labels, BOM sniffing, fatal decoding and encoding. |
| `EncodingJapanese`, `EncodingGb18030`, `EncodingBig5`, `EncodingEucKr` | The opt-in CJK indexes for `Encoding`. |
| `Mime` | MIME types, MIME sniffing and `data:` URLs. |
| `I8`, `I16`, `I32`, `I64`, `I128`, `U8`, `U16`, `U32`, `U64`, `U128` | The standard fixed-width integers, like Rust's `i8` … `u128`, with strict, checked, wrapping, saturating and overflowing arithmetic. |
| `FixedInt` | The `FixedInt` model and `make` / `makeBig` for integers of any width. |
| `Wrapping`, `Saturating`, `Checked`, `Overflowing` | The arithmetic strategies as type classes, with an instance per standard integer type. |
| `Clamped` | Numbers constrained to `[min, max]` at the type level, with saturating arithmetic, wrapping and rescaling. |
| `Float`, `F32` | The `Float` type class, `F64`, IEEE 754 total ordering, the `NotNaN` / `Finite` refinements; single precision floats. |
| `Ratio` | Exact rationals over `bigint`. |
| `Complex` | Complex numbers over doubles. |
| `Num` | `num-traits` style type classes, generic `sum` / `product` / `pow`, and instances. |
| `Integer` | `num-integer` algorithms: `gcd`, `lcm`, floored division, roots, `binomial`, `modPow`, `isPrime`, … |
| `Range` | `num-iter` ranges: `range`, `rangeInclusive`, `rangeStep`, `linspace`. |
| `ArithmeticError` | The tagged errors of fallible numeric operations. |
| `Rfc3339` | RFC 3339 date-times parsed to and printed from `DateTime`. Needs `@thomasfosterau/effect-parse`. |
| `Rfc9557` | RFC 9557 (IXDTF) date-times with time zone and annotation suffixes. Needs `@thomasfosterau/effect-parse`. |
| `IsoDuration` | ISO 8601 durations parsed to and printed from the amounts `DateTime.add` takes. Needs `@thomasfosterau/effect-parse`. |
| `PosixTz` | POSIX TZ strings (`EST5EDT,M3.2.0,M11.1.0`). Needs `@thomasfosterau/effect-parse`. |
| `CronExpression` | Cron expressions parsed to Effect's `Cron`, with errors that name the field and column. Needs `@thomasfosterau/effect-parse`. |
| `RRule` | iCalendar recurrence rules (RFC 5545 `recur`). Needs `@thomasfosterau/effect-parse`. |
| `IanaTimeZone` | IANA time zone names checked against the runtime's tz data. Needs `@thomasfosterau/effect-parse`. |
| `Tzif` | Compiled TZif zone files (RFC 8536). Needs `@thomasfosterau/effect-parse`. |
| `RerankerModel`, `ClassifierModel`, `SpeechModel`, `TranscriptionModel`, `ImageModel`, `ModerationModel`, `VoiceConversionModel` | The provider-neutral AI service abstractions `effect/ai` lacks. |
| `evals` and `evals/<Module>` | The LLM evaluation toolkit: `./evals` is its barrel, and each of its modules is also `./evals/<Module>` (`./evals/Runner`, `./evals/metrics/Ranking`, `./evals/scorers/ExactMatch`, …). Not on the root barrel. |

## Allocator

`Allocator.Allocator` is a `Context.Reference`, so it never needs to be provided — it defaults to the heap allocator (one `ArrayBuffer` per block). Swap it out for a whole program or a single region:

```ts
import { Effect } from "effect";
import { Allocator, Layout, Vec } from "@thomasfosterau/effect-ext";

const program = Effect.gen(function* () {
  const v = yield* Vec.make(Layout.u32);
  yield* Vec.extend(v, [1, 2, 3]);
});

// One 1 MiB bump arena for everything allocated by `program`
program.pipe(Effect.provide(Allocator.layerArena(1024 * 1024)));
```

Allocation failures surface as a typed `AllocationError`. Every data structure has a `makeScoped` variant that returns its memory to the allocator when the scope closes.

## BufferStruct

```ts
import { Effect } from "effect";
import { BufferStruct, Layout } from "@thomasfosterau/effect-ext";

const Vec2 = Layout.struct({ x: Layout.f32, y: Layout.f32 });
const Body = Layout.struct({ position: Vec2, mass: Layout.f64, alive: Layout.bool });

Effect.gen(function* () {
  const body = yield* BufferStruct.make(Body, { position: { x: 0, y: 0 }, mass: 1, alive: true });
  body.position.x += 5; // nested structs are live views into the same memory
  BufferStruct.bytes(body); // Uint8Array(24)
});
```

`BufferStruct.view(layout, buffer, offset)` overlays a struct on memory you already have.

## Vec

```ts
import { Effect, Option } from "effect";
import { Layout, Vec } from "@thomasfosterau/effect-ext";

const Vec2 = Layout.struct({ x: Layout.f32, y: Layout.f32 });

Effect.gen(function* () {
  const xs = yield* Vec.fromIterable(Layout.f64, [1, 2, 3]);
  yield* Vec.push(xs, 4);
  const array: Float64Array = Vec.typedArray(xs); // zero-copy view

  const points = yield* Vec.make(Vec2, { capacity: 1024 });
  yield* Vec.push(points, { x: 1, y: 2 });
  const p = Option.getOrThrow(Vec.at(points, 0)); // BufferStruct view of element 0
});
```

## StructOfArrays

```ts
import { Effect } from "effect";
import { Layout, StructOfArrays } from "@thomasfosterau/effect-ext";

Effect.gen(function* () {
  const particles = yield* StructOfArrays.make({ x: Layout.f32, y: Layout.f32, id: Layout.u32 });
  yield* StructOfArrays.push(particles, { x: 1, y: 2, id: 0 });
  const xs: Float32Array = StructOfArrays.column(particles, "x"); // zero-copy column
});
```

## String and Str

These mirror Rust's `String` and `str`. Both hold valid UTF-8, and as in Rust, indices are byte offsets and lengths are in bytes. A `String` is growable and mutable, and its memory comes from the current `Allocator`. A `Str` is an immutable, zero-copy string slice with Rust's `str` API, and works as a key in Effect's `HashMap` and `HashSet`.

```ts
import * as Effect from "effect/Effect";
import { Str, String } from "@thomasfosterau/effect-ext";

Effect.gen(function* () {
  const s = yield* String.from("héllo");
  yield* String.pushStr(s, " wörld");
  yield* String.push(s, "!");
  String.pop(s); // Option.some("!")
  String.len(s); // 13 (bytes)

  // For the full `str` API, take an immutable snapshot (a copy that later
  // mutation cannot affect):
  const words = Str.split(String.toStr(s), " "); // [Str("héllo"), Str("wörld")]
});

const line = Str.fromString("  key = value  ");
Str.splitOnce(Str.trim(line), " = "); // Option.some([Str("key"), Str("value")])
Str.find(line, (c) => c === "="); // Option.some(6) — patterns can be strings or char predicates
Str.split(Str.fromString("abc"), ""); // ["", "a", "b", "c", ""], as in Rust
```

`Str.Order` compares strings byte-wise, which matches Unicode code point order (unlike JavaScript's UTF-16 comparison).

## TriState

A partial-update field says one of three things: **absent** (carry the stored value forward), **`null`** (clear it), **a value** (set it). Folding the first two together — `col: input.col ?? null` — is silent data loss.

| Field schema | Decoded: absent | `null` | value |
| --- | --- | --- | --- |
| `TriState.clearable(X)` = `optionalKey(OptionFromNullOr(X))` | key absent | `Option.none()` | `Option.some(v)` |
| `TriState.clearableNullOr(X)` = `optional(NullOr(X))` | key absent | `null` | `v` |

Never use `Schema.OptionFromOptionalNullOr` for an update field: it decodes absent and `null` alike, so every omitted field becomes a clear.

**Separating readers** — for write paths:

- `TriState.read(field)` / `TriState.readNullOr(field)` → a `TriState<A>`: `CarryForward` | `Clear` | `Assign<A>`; fold it with `TriState.match({ onCarryForward, onClear, onAssign })`.
- `TriState.toNullOr(field)` converts the `Option` encoding to the nullable one (`undefined` / `null` / value); `TriState.toNullOrFields(input)` does it for every `Option`-valued field of a decoded update input at once, keeping absent keys absent — so an `Option`-encoded input feeds a SQL `SET` map built from its own keys in one call: `updateSetMap(TriState.toNullOrFields(input), writable)` (effect-drizzle-ext's `./update`).

```ts
import { Option, Schema } from "effect";
import { TriState } from "@thomasfosterau/effect-ext";

const UpdateNote = Schema.Struct({ id: Schema.String, summary: TriState.clearable(Schema.String) });
const input = Schema.decodeUnknownSync(UpdateNote)({ id: "n1", summary: null });

TriState.read(input.summary); // { _tag: "Clear" }
TriState.toNullOr(input.summary); // null  — a clear, not a carry-forward
```

**Folding readers** — for side effects only (insert a document only when one is _set_, re-check a slug only when it changes):

- `TriState.suppliedValue(field: Option<A> | undefined): Option<A>` — the `Option` encoding.
- `TriState.suppliedNullOr(field: A | null | undefined): Option<A>` — the nullable encoding.

Both map "absent" and "clear" to `Option.none()`. Never use them to compute a column value.

`readNullOr` and `suppliedNullOr` refuse an `Option` at compile time: an `Option`-encoded field read as a nullable one would turn a clear into an assignment.

## Issues

- `Issues.pathToJsonPointer(path)` — an RFC 6901 pointer (`~` → `~0`, `/` → `~1`; `[]` → `""`).
- `Issues.leaves(issue)` — a `SchemaIssue` tree flattened to `{ path, issue }` leaves: `Pointer` extends the path, `Composite` and a non-empty `AnyOf` fan out, `Filter` / `Encoding` unwrap, anything else (and an empty `AnyOf`) is a leaf. Each leaf also carries `describedBy`: for a message-less `InvalidValue`, the nearest enclosing `Filter` when it wraps the leaf directly (a built-in check) or states a `message` of its own (a struct-level check that points its failure at a field, `{ path: ["b"], issue }`); `Option.none()` otherwise.
- `Issues.message(leaf)` — the leaf's message from Effect's default formatter, formatted from `describedBy` when present, so the check's expectation or `message` survives.
- `Issues.pointers(issue, { prefix })` — each leaf as `{ pointer, tag, message, issue }`, with `message` from `Issues.message`: a built-in check's failure (`isMinLength(3)`) keeps its expectation ("Expected a value with a length of at least 3"), and a struct-level check pointed at a field keeps its `message`.

```ts
import { Effect, Option, Schema } from "effect";
import { Issues } from "@thomasfosterau/effect-ext";

const failure = Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.String }))({}).pipe(
  Effect.flip,
  Effect.runSync,
);
Issues.pointers(failure.issue, { prefix: Option.some(["data", "attributes"]) });
// [{ pointer: "/data/attributes/name", tag: "MissingKey", message: "Missing key", issue }]
```

The envelope is yours: a JSON:API error object is `{ status, code: tag, detail: message, source: { pointer } }` (omit `source` when `pointer` is `""`).

## Bounded

The cap is always yours: there is no default page cap. Optional option members take an `Option` (`maxLength: Option.some(3)`); omit the key for the default. The exports shared with effect-jsonapi's `FlatQuery` (`PageOffset`, `pageLimit`, `pagination`, `DefaultedPagination`, `RequiredPagination`, `idList`, `IdList`, `DEFAULT_MAX_ID_LIST`) keep its names, defaults and messages. Its option objects differ: optional members are `Option`-valued here, and the required window is `requiredPagination` rather than `defaultLimit: false`.

- `Bounded.NonNegative` — a finite number `>= 0`.
- `Bounded.pageLimit(maxLimit)` — a positive integer `<= maxLimit`; `Bounded.PageOffset` — a non-negative integer.
- `Bounded.pagination({ maxLimit, defaultLimit? })` — the `{ offset, limit }` fields, both optional on the wire and decoded to `0` / `defaultLimit` (`DEFAULT_PAGE_LIMIT`, 50, when omitted). `Bounded.requiredPagination({ maxLimit })` — the same window with both keys required. website and gardeneria: `requiredPagination({ maxLimit: 1000 })` (their `ListInput`) or `pagination({ maxLimit: 1000 })` (their `PaginationInput`); preferenceflow: `pagination({ maxLimit: 100 })`.
- `Bounded.idList({ maxLength?, dedupe? })`, `Bounded.IdList` — a comma-separated list of UUIDs (or the repeated-key array `UrlParams.toRecord` produces), non-empty, at most `DEFAULT_MAX_ID_LIST` (100) as sent. Repeats are kept unless `dedupe: Option.some(true)`.

```ts
import { Schema } from "effect";
import { Bounded } from "@thomasfosterau/effect-ext";

const ListPeople = Schema.Struct({
  ...Bounded.pagination({ maxLimit: 100 }),
  ids: Schema.optional(Bounded.IdList),
});
Schema.decodeUnknownSync(ListPeople)({}); // { offset: 0, limit: 50 }
```

## Ids

- `Ids.Uuid` — a string that parses as a UUID.
- `Ids.make(brand)` — `Uuid.pipe(Schema.brand(brand))`; `Ids.refine(parent, brand)` stacks a child brand (a `PersonId` is an `EntityId`, not the other way round). Brands are `Type`-side only; the wire stays `string`.
- `Ids.SLUG_PATTERN` — lowercase kebab-case. `Ids.slug({ maxLength?, reserved? })` — 1 to `maxLength` (default 200) characters of it, not a reserved path segment; `Ids.Slug` is `slug()`. `Uuid`, `SLUG_PATTERN`, `slug` and `Slug` match effect-jsonapi's `FlatQuery`, messages included; `slug`'s options are `Option`-valued here. website / gardeneria's node slug is `Ids.slug({ reserved: Option.some(["create", "edit", "search", "new", "delete"]) })`.

## LiteralExact

- `LiteralExact.tuple<U>()(values)` — compiles only when `values` names every member of `U` and nothing else; returns `values` typed as the literal tuple.
- `LiteralExact.literals<U>()(values)` — the same check, returning `Schema.Literals(values)`.
- `LiteralExact.Missing<U, T>` — the members of `U` a tuple `T` omits.

```ts
import { LiteralExact } from "@thomasfosterau/effect-ext";

type Status = "draft" | "published" | "archived";
export const STATUSES = LiteralExact.tuple<Status>()(["draft", "published", "archived"]);
// LiteralExact.tuple<Status>()(["draft"]) — compile error naming "published" | "archived"
```

Use it wherever one vocabulary lives in two places that must agree — a TypeScript union and a database enum's values, a `Schema.Literals` and a lookup map's keys.

## Ast

Field traits by behavioural decode probe (through each schema's JSON codec) and, for optionality, the struct key's AST:

- `Ast.isOptionalKey(schema)`, `Ast.acceptsNull(schema)`, `Ast.isArray(schema)`, `Ast.isDate(schema)`.
- `Ast.fieldTraits(struct.fields)` → `{ key, optional, nullable, array, date }[]` in declaration order.

Build the result once at start-up; each probe builds a decoder.

## Url

A `Url` is a string in WHATWG serialisation, branded with what it was checked against. A spec restricts the scheme, hostname (exactly, or within a `domain` at a label boundary), port, path (exactly, or by `{ prefix }`) and credentials, and the same literals become the type. The brand is a covariant record of the constrained components, so a narrower URL is assignable wherever a wider one is expected, and a plain `string` never is:

```ts
import { Schema } from "effect";
import { Url } from "@thomasfosterau/effect-ext";

const ApiUrl = Url.schema({ scheme: "https", domain: "example.com", credentials: false });
// Url<{ scheme: "https"; hostname: "example.com" | `${string}.example.com`; username: ""; password: "" }>

const url = Schema.decodeSync(ApiUrl)("HTTPS://API.Example.com/v1"); // "https://api.example.com/v1"
Schema.is(ApiUrl)("https://example.com.evil.test/"); // false

const fetchSecure = (target: Url.Url<{ scheme: "https" }>) => fetch(target);
fetchSecure(url); // ok
fetchSecure("https://example.com/"); // type error

Url.resolve(url, "/v2"); // Option.some("https://api.example.com/v2"), keeping the authority's types
Url.resolve(url, "//evil.test/"); // Option.none()
```

## Moving from effect-web

Each `@thomasfosterau/effect-web` entry point, and each of its sibling packages, is now one subpath here with the same exports, so a move is an import change:

| Was | Now |
| --- | --- |
| `@thomasfosterau/effect-web` | `@thomasfosterau/effect-ext/Web` |
| `@thomasfosterau/effect-web/net` | `@thomasfosterau/effect-ext/Net` |
| `@thomasfosterau/effect-web/observability` | `@thomasfosterau/effect-ext/Observability` |
| `@thomasfosterau/effect-web/negotiate` | `@thomasfosterau/effect-ext/Negotiate` |
| `@thomasfosterau/effect-web/service-worker` | `@thomasfosterau/effect-ext/ServiceWorker` |
| `@thomasfosterau/effect-web/browser` | `@thomasfosterau/effect-ext/Browser` |
| `@thomasfosterau/effect-web/testing` | `@thomasfosterau/effect-ext/BrowserTesting` |
| `@thomasfosterau/effect-robots` | `@thomasfosterau/effect-ext/Robots` |
| `@thomasfosterau/effect-sitemap` | `@thomasfosterau/effect-ext/Sitemap` |
| `@thomasfosterau/effect-rss-feed` | `@thomasfosterau/effect-ext/RssFeed` |
| `@thomasfosterau/effect-atom-feed` | `@thomasfosterau/effect-ext/AtomFeed` |
| `@thomasfosterau/effect-json-feed` | `@thomasfosterau/effect-ext/JsonFeed` |
| `@thomasfosterau/effect-uri-template` | `@thomasfosterau/effect-ext/UriTemplate` |
| `@thomasfosterau/effect-langtag` | `@thomasfosterau/effect-ext/Langtag` |
| `@thomasfosterau/effect-langtag/registry` | `@thomasfosterau/effect-ext/LangtagRegistry` |
| `@thomasfosterau/effect-css` | `@thomasfosterau/effect-ext/Css` |
| `@thomasfosterau/effect-encoding` | `@thomasfosterau/effect-ext/Encoding` |
| `@thomasfosterau/effect-encoding/{japanese,gb18030,big5,euc-kr}` | `@thomasfosterau/effect-ext/Encoding{Japanese,Gb18030,Big5,EucKr}` |
| `@thomasfosterau/effect-mime` | `@thomasfosterau/effect-ext/Mime` |

Two things change beyond the path: the `effect` peer range is `^4.0.0` (effect-web's was `>=4.0.0-rc.118`), and each service's `Context` key moved with it (`@thomasfosterau/effect-web/browser/Locks` is now `@thomasfosterau/effect-ext/Browser/Locks`), so a layer built from the old package does not satisfy a service from the new one. Move every import at once.

## OptionalKey

Under `exactOptionalPropertyTypes` an absent optional key must be omitted, not set to `undefined`. Spread `optionalKey(key, value)` instead of `...(value !== undefined ? { key: value } : {})`:

```ts
import * as Option from "effect/Option";
import { fields, fromOption, optionalKey } from "@thomasfosterau/effect-ext/OptionalKey";

const options = { limit: 10, ...optionalKey("cursor", cursor), ...fromOption("filter", filter) };
const forwarded = { collection, ...fields({ limit, cursor }) };
```

- `optionalKey(key, value?)` — `{ [key]: value }` unless `value` is `undefined`. `null`, `""`, `0` and `false` keep their key; pass `x ?? undefined` to drop a `null`.
- `fromOption(key, option)` — the same over an `Option`: the key for `Some`, none for `None`.
- `fields(input)` — the whole-object form: copies the members of `input` that are not `undefined`. Its type, `Defined<T>`, makes each member that admits `undefined` optional and keeps the rest required.
- An absent key from `optionalKey` or `fromOption` allocates nothing: every such result is one shared, frozen empty object.

## Web, Net, Observability, Negotiate, ServiceWorker, Browser, BrowserTesting

Framework-neutral web request/response utilities on `effect/http`: cache-control and security headers, Vary, the cross-origin guard, client IP, an SSRF-guarded fetch, structured logging and an allow-listed span tracer, with no SvelteKit, Alchemy or Cloudflare dependency, so it serves a SvelteKit hook, an `HttpApi` middleware or a bare Worker equally. On the client side, browser platform APIs (Web Locks, `navigator`, page visibility, media queries, the screen wake lock, `BroadcastChannel`, permission state) as Effect services, alongside `@effect/platform-browser`, with in-memory test doubles for every one.

Invariant ids in doc comments and below (`CACHE-AUTH-003`, `SEC-SSRF-003`, …) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-ext/blob/main/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

### Usage

#### A SvelteKit hook

The helpers are written over `effect/http`'s `Headers`, `HttpServerRequest` and `HttpServerResponse`. Three adapters bridge to the Fetch types a SvelteKit `Handle` deals in: `HttpServerRequest.fromWeb` (Effect's own) for a request, `HttpServerResponse.toWeb` (Effect's own) for a whole response, and this package's `updateWebHeaders` / `applyToWebHeaders` for a header policy on a Fetch `Response`. The `*Web` functions (`crossOriginMutationRejectionWeb`, `jsonApiErrorResponseWeb`, `negotiateWebRequest`, `requestForRouterWeb`) are those adapters pre-applied.

```ts
// hooks.server.ts
import type { Handle, RequestEvent } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import * as Option from "effect/Option";
import {
  applyToWebHeaders,
  cacheControlForViewer,
  classifyRoute,
  crossOriginMutationRejectionWeb,
  ensureCacheControl,
  responseVary,
  securityHeaders,
  stageNoindex,
  updateWebHeaders,
} from "@thomasfosterau/effect-ext/Web";
import {
  chooseNegotiatedResponse,
  endpointPaths,
  makeApiPathMatcher,
  makeMarkdownPathMatcher,
  MARKDOWN_MEDIA_TYPE,
  Negotiation,
  negotiateWebRequest,
  type Representation,
} from "@thomasfosterau/effect-ext/Negotiate";

/** What the application supplies. */
interface App {
  readonly apiGroups: Parameters<typeof endpointPaths>[0]; // the served HttpApi groups
  readonly markdownSegments: ReadonlyArray<string>; // e.g. ["posts", "people"]
  readonly indexable: boolean; // true on the production stage only
  readonly authentication: Handle; // resolves `event.locals.user`
  readonly forwardJsonApi: (request: Request) => Promise<Response>;
  readonly renderMarkdown: (event: RequestEvent) => Promise<Option.Option<Response>>;
}

export const makeHandle = (app: App): Handle => {
  // What the server can produce, in priority order. Markdown is served from a
  // content page's own URL; the JSON API at its endpoints, for `ext` / `profile`
  // parameters only (a JSON:API library supplies its own representation).
  const markdown: Representation = {
    mediaType: MARKDOWN_MEDIA_TYPE,
    servesPath: makeMarkdownPathMatcher(app.markdownSegments),
  };
  const jsonApi: Representation = {
    mediaType: "application/vnd.api+json",
    servesPath: makeApiPathMatcher(endpointPaths(app.apiGroups)),
    acceptsParameters: (mediaType) =>
      mediaType.parameters.every(([name]) => name === "ext" || name === "profile"),
  };
  const options = { accept: [markdown, jsonApi], contentType: [jsonApi] };

  // Outermost: the post-`resolve` header stamp lands on the final response.
  const applyHeaders: Handle = async ({ event, resolve }) => {
    const response = await resolve(event);
    applyToWebHeaders(response.headers, (headers) =>
      responseVary(
        stageNoindex(securityHeaders(headers), { indexable: app.indexable }),
        classifyRoute(event.url.pathname),
      ),
    );
    return response;
  };

  // The JSON:API forward, outside the render middleware: a cross-origin
  // mutation is refused (already `private, no-store`); anything else gets the
  // CACHE-AUTH-003 safety net, since `cacheControl` below never sees it.
  const forward: Handle = async ({ event, resolve }) => {
    const verdict = negotiateWebRequest(event.request, options);
    if (verdict._tag === "NotAcceptable" || verdict._tag === "UnsupportedMediaType") {
      return verdict._tag === "NotAcceptable"
        ? new Response("Not Acceptable", { status: 406 })
        : new Response("Unsupported Media Type", { status: 415 });
    }
    if (!Negotiation.$is("Selected")(verdict) || verdict.representation !== jsonApi) {
      return resolve(event);
    }
    const rejected = crossOriginMutationRejectionWeb(event.request);
    if (Option.isSome(rejected)) return rejected.value;
    return updateWebHeaders(await app.forwardJsonApi(event.request), ensureCacheControl);
  };

  // After `authentication` (reads the resolved viewer), before `negotiate`
  // (stamps whichever representation is returned): CACHE-AUTH-003.
  const cacheControl: Handle = async ({ event, resolve }) =>
    updateWebHeaders(await resolve(event), (headers) =>
      cacheControlForViewer(headers, { viewerResolved: event.locals.user !== null }),
    );

  // Innermost: the Markdown representation, or SvelteKit's own render.
  const negotiate: Handle = async ({ event, resolve }) => {
    const verdict = negotiateWebRequest(event.request, options);
    if (Negotiation.$is("Selected")(verdict) && verdict.representation === markdown) {
      return chooseNegotiatedResponse(await app.renderMarkdown(event), () => resolve(event));
    }
    return resolve(event);
  };

  return sequence(applyHeaders, forward, app.authentication, cacheControl, negotiate);
};
```

A response that bypasses the middleware (an auth short-circuit) still gets the safety net: `updateWebHeaders(response, ensureCacheControl)`. A `NotAcceptable` / `UnsupportedMediaType` verdict is answered with the error document your API's library defines (the example uses bare 406 / 415 responses).

#### In a browser

Every `Browser` module has the same shape: a `Context.Service` tag, a `make` over a structural `*Like` slice of the platform object, a live `layer` that reads the ambient global when it is built (never at import), a tagged error whose `reason` maps the platform's `DOMException` names, and accessors. A live layer builds in any context — a missing API degrades (`supported: false`, an `Unsupported` failure, `Option.none()`) rather than failing the layer — so one layer serves every browser, a worker and a server render.

```ts
import * as Effect from "effect/Effect";
import { Locks, Navigator, PageVisibility, layer } from "@thomasfosterau/effect-ext/Browser";

// One tab refreshes the session on behalf of every tab of the origin.
const refresh = Effect.gen(function* () {
  yield* Navigator.awaitOnLine;
  return yield* fetchFreshToken; // your effect
}).pipe(Locks.withLock("auth-refresh"));

// Poll only while somebody can see the page.
const poll = PageVisibility.whileVisible(syncInbox.pipe(Effect.repeat(everyMinute)));

Effect.runFork(Effect.provide(Effect.all([refresh, poll], { concurrency: 2 }), layer));
```

#### Testing browser code

`BrowserTesting`'s doubles run the **real** `Browser` adapter over an in-memory platform object, so a test exercises the code that runs in the browser. Each module's `layer` provides the service and its `Control`; drive the platform through the `Control` (the double fires the events the browser would), and read back what the code under test asked of it.

```ts
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { Navigator } from "@thomasfosterau/effect-ext/Browser";
import { TestNavigator, observe } from "@thomasfosterau/effect-ext/BrowserTesting";

const program = Effect.gen(function* () {
  const control = yield* TestNavigator.Control;
  // Subscribe first: `observe` returns once the stream has emitted its current value.
  const seen = yield* observe(Navigator.onLineChanges, 2);
  yield* control.setOnLine(false);
  return yield* Fiber.join(seen); // [true, false]
});

Effect.runPromise(Effect.provide(program, TestNavigator.layer()));
```

Fork-then-sleep is a race (the child may not have subscribed yet); `observe` is the sync point. `TestLocks.makeLockManager()` is one origin: build several `Locks` services over it (`Locks.make(manager.forClient("tab-b"))`) to test contention between tabs.

### API

#### `Web` — headers, guards, adapters

##### Header policies

Pure `(headers: Headers.Headers) => Headers.Headers` functions; compose them and apply once with `updateHeaders` (an `HttpServerResponse`), `updateWebHeaders` (a Fetch `Response`, cloned only when something changed) or `applyToWebHeaders` (a mutable Fetch `Headers`, in place).

- `securityHeaders(headers)` — the baseline (`SECURITY_HEADER_DEFAULTS`: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`), each only when the route did not set it (SEC-HDR-001).
- `stageNoindex(headers, { indexable })` — `X-Robots-Tag: noindex` on a non-indexable stage (CANON-003). The stage decision is yours; this package reads no environment.
- `appendVary(headers, names)` — idempotent, case-insensitive; the single place that mutates `Vary`.
- `responseVary(headers, routeClass)` / `VARY_BY_ROUTE_CLASS` / `RouteVaryClass` — no `Vary` for a `"locale-invariant"` asset, `Accept` alone for a `"format-negotiated"` one, `Cookie, Accept-Language, Accept` for the `"negotiated"` surface (PERF-CACHE-001).
- `classifyRoute(pathname, classifier?)` — narrowest class first, so a locale-invariant asset never gets a locale `Vary` (PERF-CACHE-001). `classifier.isLocaleInvariantAsset` defaults to `isLocaleInvariantAsset`; `classifier.isFormatNegotiatedAsset` is application-specific (for example `GET /images/<uuid>`) and defaults to none.
- `LOCALE_INVARIANT_ASSET_PATHS`, `isOpenGraphCard`, `isLocaleInvariantAsset`, `makeLocaleInvariantAssetMatcher(paths, ...predicates)` — the default set (icons, the default share card, the public edge-cached documents), the Open Graph card predicate, and the way to build your own matcher. The set and `isOpenGraphCard` keep share images free of a locale `Vary` (OG-IMG-001).
- `ensureCacheControl(headers)` — `Cache-Control: private, no-store` (`PRIVATE_NO_STORE`) when nothing declared one: the CACHE-AUTH-003 safety net for a response that bypasses the viewer-aware policy.
- `cacheControlForViewer(headers, { viewerResolved })` — the viewer-aware policy (CACHE-AUTH-003): a resolved viewer's response is always forced to `private, no-store` (Workers Caching runs ahead of the Worker on a hit, and `Set-Cookie` cannot be relied on as its bypass); an anonymous one falls back to `ensureCacheControl`.

##### Guards and resolvers

- `isCrossOrigin(origin: Option<string>, expectedOrigin)`, `isCrossOriginRejected(request, expectedOrigin)` — the predicate an API applies per route, one for every route (a CSRF guard that differs between routes can't be audited): a present `Origin` that is not the Worker's own is refused; absent passes (a server-to-server caller). `isCrossOriginRejected` is the SEC-CSRF-001 check over a request; `expectedOrigin` is explicit because an `HttpServerRequest`'s `url` is its path. `isCrossOriginRejectedWeb(request, expectedOrigin = new URL(request.url).origin)` is the same check over a Fetch `Request`; never cast a Fetch `Request` to `isCrossOriginRejected`, whose record-shaped `headers` read no `Origin` from a Fetch `Headers`.
- `crossOriginMutationRejection(request, expectedOrigin): Option<HttpServerResponse>` — the front door's SEC-CSRF-001 guard for a dispatched JSON:API request: `Some(403 CROSS_ORIGIN_REJECTED, already private, no-store)` for a cross-origin mutation, `None` to proceed. `crossOriginMutationRejectionWeb(request, expectedOrigin = new URL(request.url).origin)` over Fetch types.
- `resolveClientIp(getClientAddress): Option<string>` — the platform-resolved address or `None`, never the spoofable inbound `x-forwarded-for` (SEC-SSRF-005).
- `describeSessionDegraded(error)` / `SESSION_DEGRADED_LOG_MESSAGE` — what a fail-open session resolution reports: the fixed message plus the error for the Worker log, the error verbatim for the tracker.
- `isMutatingMethod(method)` — `POST` / `PUT` / `PATCH` / `DELETE`.
- `siteBase({ key, fallback }): Effect<string>` — the canonical site base every absolute URL about the site is built on (CANON-001): `key` (`PUBLIC_SITE_URL`) read through the ambient `ConfigProvider`, never the request origin, so a preview host still names production. Total (error channel `never`): a missing key or a provider error yields `fallback`, the application's own production origin; an invalid value yields it too, after a `site-base.invalid` warning. `normalizeSiteBase(value): Option<string>` is the check: an absolute `http(s)` URL with no credentials, path, query or fragment, returned as its origin (no trailing slash).

##### JSON:API seam errors

- `NegotiationError` (`{ status, code, title, detail }`), `CROSS_ORIGIN_REJECTED` (403 `auth.forbidden`), `SERVICE_UNAVAILABLE` (503 `unavailable`), `JSONAPI_MEDIA_TYPE`.
- `jsonApiErrorDocument(error)`, `jsonApiErrorResponse(error): HttpServerResponse`, `jsonApiErrorResponseWeb(error): Response` — the `{ errors: [...], jsonapi: { version: "1.1" } }` document.

#### `Net` — the SSRF guard

- `isBlockedHost(hostname)` — loopback / internal names (trailing root dot normalised), private / link-local / CGNAT IPv4, loopback / ULA / link-local IPv6, IPv4-mapped and NAT64 literals routed through the IPv4 list. A malformed dotted quad is blocked, never allowed.
- `checkUrl(url): Result<URL, UnsafeUrl>` — http(s) only, no embedded credentials, host not blocked (SEC-SSRF-003). `UnsafeUrl` is a tagged error with `reason: "invalid" | "scheme" | "credentials" | "blocked-host"` and fixed message wording, kept stable because callers' tests pin it. `assertAllowedUrl(url): URL` is the same check for plain callers: it throws a plain `Error` carrying the message, whose `cause` is the `UnsafeUrl`.
- `followRedirects(url, init, { maxHops?, fetch? }): Effect<FollowedResponse, UnsafeUrl | RedirectRejected | FetchFailed>` — fetches with `redirect: "manual"`, re-checking the initial URL, every `Location` hop and the final URL (SEC-SSRF-003). `maxHops: 0` refuses any redirect (the shape for a POST). Pass a shared `signal` in `init` so the chain shares one deadline. `fetchFollowingRedirects(url, init, maxHops?, fetch?): Promise<FollowedResponse>` is the same for plain callers, rejecting with a plain `Error` carrying the failure's message, whose `cause` is the tagged `UnsafeUrl` / `RedirectRejected` (a `fetch` failure rejects with the original `fetch` cause instead).

#### `Observability` — the read-path signals on `effect/Logger` and `effect/Tracer`

- `logStructured(payload)` — one flat JSON line through `effect/Logger`, envelope-free (`{"event":…}`, never Effect's logger envelope, so a dashboard query on the flat shape keeps working), unconditional whatever the ambient minimum log level. Safe to call from plain code: it never suspends.
- `spanTracer(trackedSpanNames): Tracer.Tracer` — logs `{ event: "span", name, durationMs, traceId, spanId, ok }` per completed span whose name is in the set, nothing for any other. **The allow-list is a required parameter, never a constant**: it replaces the tracer for the whole per-request layer, where `Effect.withSpan` has hundreds of call sites. Build it once at module scope.
- `logEvent` / `logWarningEvent` / `logErrorEvent(event, fields?)` — `Effect.logInfo` / `logWarning` / `logError` with `{ event, ...fields }` as log annotations. `describeError(error)` renders a failure as `Tag: message`, `Tag`, `message` or `String(error)`.
- `deriveAuthOutcome(facts): AuthOutcome` (`"skipped" | "resolved" | "anonymous" | "degraded"`; `"skipped"` is the credential-less fast path, PERF-CACHE-003) and `logAuthOutcome(durationMs, outcome)` — the `read-path.auth` line.
- `withRequestMetrics(fn, onSettle): Promise<A>` — runs `fn` in a fresh per-request metric scope (its own `Metric.Counter` and `MetricRegistry`, scoped through `AsyncLocalStorage`) and hands `{ count }` to `onSettle` once `fn` settles, resolved or rejected. `incrementRequestMetric(amount = 1)` adds to the active scope from any code, synchronously, and is a no-op outside one; `currentRequestMetrics(): Option<RequestMetrics>` reads it. `countingProxy(client, methodNames: Iterable<string>)` (an array, a `HashSet` or a `Set`, read once) counts each call of a named method on `client`, invoking it with the real client as `this` and returning its result untouched — the per-request query count, an N+1 / waterfall signal. Which methods begin a query is the caller's parameter. Emit the settled count as your own `logStructured` line (`{ event: "read-path.db", dbQueryCount: metrics.count, path }`). On Workers this needs `nodejs_compat` (it imports `node:async_hooks`).

#### `Negotiate` — the negotiation verdict

Nothing about any one media type is built in: you declare the `Representation`s the server can produce and `negotiateRepresentation` says which one a request selects. A JSON:API library supplies its own `Representation` (its `acceptsParameters` is the `ext` / `profile` rule); the 406 / 415 error documents are its too.

- `negotiateRepresentation(request: HttpServerRequest, options: NegotiationOptions): Negotiation` / `negotiateWebRequest(request: Request, options)` — reads (`GET` / `HEAD`) negotiate on `Accept`, trying `options.accept` in priority order; mutating methods on `Content-Type` against `options.contentType`; anything else is `Fallback`. Media types are matched on their WHATWG essence (`MimeType.parse` from `@thomasfosterau/effect-ext/Mime`), so case and whitespace never decide the verdict, and a `Content-Type` that is not a MIME type is `Fallback`.
- `Representation`: `mediaType` (lower-case `type/subtype`), `servesPath?(pathname)` (omitted → every path) and `acceptsParameters?(mediaType: MimeType)` (the instance's media-type parameters, those before `q`; omitted → any).
- `NegotiationOptions`: `accept: ReadonlyArray<Representation>` and `contentType?: ReadonlyArray<Representation>` (omitted → no write selects a representation).
- `Negotiation` (a `Data.TaggedEnum`, with constructors, `$is` and `$match` on the `Negotiation` value): `Selected` (serve `representation`), `Fallback` (serve the default, e.g. HTML), `NotAcceptable` (a read: the client asked for `representation`'s media type at a path it is served on, but every instance carried rejected parameters) and `UnsupportedMediaType` (a write: the `Content-Type` is that media type at a served path, with rejected parameters).
- Ranking: a read selects a representation when a clean (parameters accepted), `q > 0` instance of its media type outranks (≥) every other media type the client offered; ties win and an unparsable `q` reads as `1`. Otherwise the next representation is tried, and `Fallback` follows the last.
- `makeApiPathMatcher(paths)` / `endpointPaths(groups)` / `makeMarkdownPathMatcher(segments)` — build a `servesPath` from the served `HttpApi` groups (so the matcher never drifts from the surface) or from the Markdown route segments (a `<segment>/<id>` page, DISC-009).
- `requestForRouter(request)` / `requestForRouterWeb(request)` — relabels a dispatched write's `Content-Type` to `application/json` for a router that registers JSON payloads under the default encoding.
- `chooseNegotiatedResponse(markdown: Option<A>, onHtml: () => B)` — the Markdown response or the framework's render, which runs only on `None`.
- `MARKDOWN_MEDIA_TYPE`.

#### `ServiceWorker` — caching strategies and event listeners

The two globals a worker talks to are context references with global defaults, so a worker provides nothing and a test swaps each: `Caches` (the `CacheStorage`, default `globalThis.caches`) and Effect's own `FetchHttpClient.Fetch` (default `globalThis.fetch`). Event types are structural (`FetchEventLike`, `ExtendableEventLike`, `ExtendableMessageEventLike`), so the entry compiles under the `dom` lib and the `webworker` lib's events satisfy them.

```ts
/// <reference lib="webworker" />
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  cacheFirst,
  deleteCachesExcept,
  extendableListener,
  fetchListener,
  isNavigationRequest,
  messageListener,
  networkFirst,
  precache,
  route,
  staleWhileRevalidate,
} from "@thomasfosterau/effect-ext/ServiceWorker";

declare const self: ServiceWorkerGlobalScope;
const SHELL = "shell-v3";
const CACHES = [SHELL, "pages", "assets", "images"];

// Listeners must be added while the script first evaluates, so the effects
// that build them run synchronously.
const listeners = Effect.gen(function* () {
  const onInstall = yield* extendableListener(() => precache(SHELL, ["/", "/offline", "/app.css"]));
  const onActivate = yield* extendableListener(() => deleteCachesExcept(CACHES));
  const onFetch = yield* fetchListener([
    route(isNavigationRequest, networkFirst({ cacheName: "pages", timeout: "3 seconds" })),
    route(
      (r) => new URL(r.url).pathname.startsWith("/_app/immutable/"),
      cacheFirst({ cacheName: "assets" }),
    ),
    route((r) => r.destination === "image", staleWhileRevalidate({ cacheName: "images" })),
  ]);
  const onMessage = yield* messageListener(
    Schema.Struct({ type: Schema.Literal("SKIP_WAITING") }),
    () => Effect.promise(() => self.skipWaiting()),
  );
  return { onInstall, onActivate, onFetch, onMessage };
});

const { onInstall, onActivate, onFetch, onMessage } = Effect.runSync(listeners);
self.addEventListener("install", onInstall);
self.addEventListener("activate", onActivate);
self.addEventListener("fetch", onFetch);
self.addEventListener("message", onMessage);
```

- `openCache(name): Effect<CacheHandle, CacheError>` — the cache's `match` (an `Option`), `put`, `delete`, `keys` as effects. `deleteCache(name)`, `cacheNames`, and `deleteCachesExcept(keep)` (a list or a predicate; returns the names deleted) for the `activate` sweep. Every Cache Storage rejection is a `CacheError` naming the `operation` and `cacheName`.
- `fetchRequest(request): Effect<Response, FetchFailed>` — through `FetchHttpClient.Fetch`, keeping the native `Response` that `respondWith` needs; interruption aborts. `FetchFailed` is `Net`'s class.
- `isCacheable(request, response)` — the default write-back filter: a `GET`, status `200` (so never an opaque `0` or a partial `206`), no `Vary: *`, no `Cache-Control: no-store`.
- Strategies, each `(options) => (request) => Effect<Response, …>`: `cacheFirst`, `networkFirst` (optional `timeout`: on a cache hit after it elapses the network is aborted; on a miss the network keeps its chance), `staleWhileRevalidate`, `cacheOnly` (fails with `CacheMiss`), `networkOnly`. `StrategyOptions`: `cacheName`, `cacheable?`, `matchOptions?`. Write-backs run in the background through `EventLifetime`, so the page never waits on `Cache.put`.
- `precache(cacheName, urls)` — fetches every URL with `cache: "reload"`, writes only once all are `200` (`PrecacheRejected` otherwise), so a failed `install` leaves the previous worker in charge.
- `route(match, handle)`, `fetchListener(routes)` — `match` is synchronous because `respondWith` must be called during dispatch; the first match answers, and no match leaves the request to the browser. A failed answer rejects `respondWith` (a network error to the page).
- `extendableListener(handle)` — `install` / `activate`: the effect's promise goes to `waitUntil`, so a failure fails the install. `messageListener(schema, handle)` — decodes `event.data` first; an undecodable message is logged and dropped.
- `EventLifetime` — how background work outlives a response: bound to the event's `waitUntil` inside a listener, detached outside one. Background failures are logged at `Warning`.
- Persistent notifications, shown through the worker's registration (effect-web#108 decided they live here, not in `Browser`: they outlive the page, and their events reach the worker). `Registration` is a context reference holding an `Option` of the registration, defaulting to `self.registration` (`Option.none()` where there is none; a page provides `Option.some(await navigator.serviceWorker.ready)`); `showNotification(title, options?)` and `getNotifications({ tag? })` fail with `ShowNotificationError` (`operation`, `reason`: `Unsupported`, `NotAllowed`, `InvalidData`, `Failed`). `notificationClickListener(schema, handle)` / `notificationCloseListener(schema, handle)` decode `notification.data` first, as `messageListener` does, and run `handle` inside `waitUntil`.
- `memoryCacheStorage({ fetch? })` — an in-memory `CacheStorage` for tests, rejecting what the browser's `put` rejects.

#### `Browser` — platform services

Each module is a namespace: `import { Locks } from "@thomasfosterau/effect-ext/Browser"`, then `Locks.Locks` (the tag), `Locks.layer`, `Locks.make`, `Locks.withLock`, ….

- `Locks` — Web Locks. `acquire(name, { mode?, steal? }): Effect<HeldLock, LockError, Scope>` holds an origin-wide lock until the scope closes; waiting is interruptible (the request is withdrawn), and closing the scope waits for the browser to report the release. `tryAcquire` is `ifAvailable` (`None` instead of queueing). `withLock(name, options?)` runs an effect under the lock and, if another context steals it, interrupts the effect and fails `Stolen`; `withLockIfAvailable` runs it only when the lock is free (leader election). `query` is a diagnostic snapshot. `LockError.reason`: `Unsupported`, `Stolen`, `InvalidRequest`, `NotAllowed`, `InvalidState`, `Failed`.
- `Navigator` — `info` (user agent, languages, `hardwareConcurrency`, `deviceMemoryGiB`, touch points, cookies, `webdriver`, Global Privacy Control); `onLine` / `onLineChanges` / `awaitOnLine`; `languages` / `languageChanges`; `connection` / `connectionChanges` (Network Information, `None` where missing); `userActivation`; `canShare` / `share`; `sendBeacon`; `vibrate`; `storage.estimate` / `persisted` / `persist`. `NavigatorError` carries the `operation` and a `reason` (`Unsupported`, `NotAllowed`, `Aborted` — the user dismissed the share sheet, `InvalidData`, `InvalidState`, `Rejected` — the beacon was not queued, `Failed`).
- `PageVisibility` — `state`, `changes`, `awaitVisible`, and `whileVisible(effect)`: started whenever the page becomes visible, interrupted whenever it is hidden.
- `MediaQuery` — `matches(query)`, `changes(query)`, and the preference streams `colorScheme`, `reducedMotion`, `moreContrast`, `reducedData`.
- `WakeLock` — the Screen Wake Lock. `acquire` is scoped; `keepAwake(effect)` holds one lock for the effect and fails `WakeLockError` without one; `keepAwakeWhileVisible(effect)` re-acquires each time the page returns (the browser drops the lock on hide) and never fails the effect over a lock it could not get.
- `IdleDetection` — `IdleDetector` (Chromium-only, behind a permission: treat it as optional; `supported: false` is the common case). `requestPermission` (from a user gesture) returns `"granted" | "denied"`; `watch({ threshold })` is a `Stream<IdleState, IdleError>` of `{ user: "active" | "idle", screen: "locked" | "unlocked" }`, current state first, and its detector is aborted when the stream ends. `threshold` is a `Duration.Input` of at least `minimumThreshold` (one minute). `IdleError.reason`: `Unsupported`, `NotAllowed` (permission not granted, or no activation to ask with), `InvalidRequest` (threshold under a minute), `Failed`.
- `Battery` — `navigator.getBattery()` (Chromium-only; Firefox and Safari removed it). Its own service, not part of `Navigator`, because the manager is promise-acquired (once, on the first reading). `status` is an `Option<BatteryState>` — `{ charging, level (0–1), chargingTime, dischargingTime }`, the times `Option<Duration>` with the API's `Infinity` (unknown) as `None` — and `changes` follows the four change events; `None` / empty where the API is missing or `getBattery()` rejects.
- `Fullscreen` — `enter(element, options?): Effect<void, FullscreenError, Scope>` shows an element fullscreen; closing the scope calls `exitFullscreen()` only if that element is still the fullscreen one. `withFullscreen(element, options?)` is the combinator form (the user leaving with Esc does not interrupt it). `element` (`Option`) and `changes` follow `fullscreenchange`. Unprefixed API only; Safari on iPhone reads as unsupported. `FullscreenError.reason`: `Unsupported` (no API, or `fullscreenEnabled` is `false`), `NotAllowed` (no user activation, a permissions policy), `Failed`.
- `ScreenOrientation` — `type`, `angle` (`Option`), `current`, and `changes` (follows `change`; empty where missing). `lock(orientation)` is scoped and unlocks when the scope closes; `withLock(orientation)` is the combinator form, and composes inside `Fullscreen.withFullscreen`, where browsers allow a lock. `OrientationError.reason`: `Unsupported` (no API or no `lock`, or a `NotSupportedError` refusal), `NotAllowed` (`SecurityError`), `Aborted` (a newer lock superseded it), `Failed`.
- `Notifications` — the page's own `Notification`s. `permission` (`None` where unsupported); `requestPermission` returns the user's answer and fails `NotAllowed` without transient user activation; `show(title, options?): Effect<ShownNotification, NotificationError, Scope>` closes the notification when the scope closes, and its `clicks` / `closes` streams replay from when it was shown, end once it closes and fail `Failed` on the browser's `error` event; `permissionChanges` follows `PermissionStatus.changes("notifications")`. `NotificationError.reason`: `Unsupported`, `NotAllowed` (not yet granted, or no activation), `Denied`, `InvalidData`, `Failed`. Service-worker-registration notifications (`registration.showNotification`, `notificationclick`) are not here: they outlive the page and their events reach the worker, so they belong with `ServiceWorker`.
- `Broadcast` — `BroadcastChannel`. `channel(name, schema)` opens a scoped channel whose `publish` encodes and whose messages are decoded through the schema (an undecodable message from another tab — an older deploy — is dropped with a warning log). `subscribe` starts listening when it runs, so nothing posted before the stream is consumed is lost; `messages` listens from when it runs. `open(name)` is the undecoded form.
- `PermissionStatus` — over `@effect/platform-browser`'s `Permissions`: `state(name)`, `changes(name)` (follows the status's `change` event), `awaitGranted(name)`.
- `layer` — every live service above plus `@effect/platform-browser`'s `Clipboard`, `Geolocation` and `Permissions`. Prefer the per-service layers where bundle size matters.

#### `BrowserTesting` — doubles

- `TestLocks` — `makeLockManager({ clientId? })`, an in-memory lock manager following the Web Locks request algorithm (FIFO per name, shared/exclusive, `ifAvailable`, `steal`, `signal`, `query`), with `forClient(id)` views for other tabs; `layer(manager?)`.
- `TestNavigator` — `layer(options?)` / `make(options?)` with `Control`: `setOnLine`, `setLanguages`, `setConnection`, `setUserActivation`, and the recorded `shares`, `beacons`, `vibrations`. Options choose how `share` (`succeed` / `abort` / `deny` / `unsupported`) and `sendBeacon` (`queue` / `reject` / `unsupported`) answer.
- `TestPageVisibility`, `TestMediaQuery`, `TestWakeLock` (`held`, `requests`, `releaseAll`, `setDenied`), `TestBroadcast` (an in-memory hub with structured-clone semantics; `posted`, `deliver` a message from "another context").
- `TestIdleDetection` — `Control`: `setUser`, `setScreen` (fire `change` on running detectors), `setPermission`, `setAnswer`, `running`, `thresholds`. `TestBattery` — `Control`: `set({ charging?, level?, chargingTime?, dischargingTime? })` (fires the matching events), `requests`; options set the readings, `supported` and `reject`.
- `TestFullscreen` — `Control`: `element(id)`, `setAllowed`, `exit` (the user pressing Esc), `requests`. `TestScreenOrientation` — `Control`: `rotate(type, angle?)`, `locked`, `setRefusal`; options choose the starting orientation and whether `lock` exists.
- `TestNotifications` — `layer(options?)` / `make(options?)` with `Control`: `setPermission`, `setAnswer` (what a prompt resolves to), `setUserActivation`, `click` / `dismiss` / `fail` the `index`th notification, and the recorded `shown` and `requests`.
- `TestPermissions`, `TestClipboard`, `TestGeolocation` — doubles for the `@effect/platform-browser` services.
- `layer` — every double and every `Control` at once. `observe(stream, count)` — forks the first `count` elements and returns once the first is out.

## Robots

The Robots Exclusion Protocol (RFC 9309) for Effect: parse, encode and match robots.txt, evaluate a crawl decision with the §2.3.1 failure posture over a pluggable cache, and build the robots.txt a site serves. At its core is the **library**, whose API and behaviour are held stable by its acceptance suite; on top of it sit the **crawler side** (fetch, cache and evaluate another site's robots.txt) and the **serving side** (the robots.txt your own site serves, by stage).

Invariant ids in doc comments and below (`ROBOTS-005`, `PERF-CACHE-002`, …) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-ext/blob/main/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

### Usage

#### The library

```ts
import {
  encode,
  getCrawlDelay,
  getSitemaps,
  isAllowed,
  parse,
} from "@thomasfosterau/effect-ext/Robots";

const robotsTxt = parse(`
  User-agent: *
  Disallow: /admin
  Allow: /admin/public
  Crawl-delay: 10

  Sitemap: https://example.com/sitemap.xml
`);

isAllowed(robotsTxt, "MyBot", "/admin"); // false
isAllowed(robotsTxt, "MyBot", "/admin/public"); // true
getCrawlDelay(robotsTxt, "MyBot"); // Option.some(10)
getSitemaps(robotsTxt); // ["https://example.com/sitemap.xml"]
encode(robotsTxt); // the canonical text
```

| Export | What it is |
| --- | --- |
| `Rule`, `RobotGroup`, `RobotsTxt` | `Data.Class` values with structural equality. `RobotGroup.crawlDelay` is an `Option<number>` (required; `Option.none()` when the group has no `Crawl-delay`). |
| `RuleSchema`, `RobotGroupSchema`, `RobotsTxtSchema` | `Schema.instanceOf` of each class. |
| `RobotsTxtFromString` | `Schema.String` → `RobotsTxt`: the parser is the decode, the encoder the encode. `Schema.decodeUnknownEffect(RobotsTxtFromString)(text)` for the Effect form. |
| `parse(text)`, `encode(robotsTxt)` | The synchronous forms. `parse` never throws: unknown lines are ignored, rules before any `User-agent` are dropped, `#` starts a comment, LF, CRLF and a bare CR all end a line (RFC 9309 §2.2). |
| `isAllowed(robotsTxt, userAgent, path)` | Group selection by the longest matching product token (exact or prefix, case-insensitive; `*` matches everything, last); rule selection by the longest matching pattern, `Allow` winning a tie; `*` wildcards and `$` anchors; a query string or fragment on `path` is stripped. No group or no matching rule means allowed. |
| `getCrawlDelay`, `getSitemaps` | The selected group's `Crawl-delay` as an `Option<number>` (`None` when no group matches or it has none); every `Sitemap:` line. |

Group selection follows RFC 9309 §2.2.1: the **product token** matches exactly or as a prefix, never as a **substring** (`userAgent.includes(token)`). A `User-agent: Google` group binds `Googlebot`; a `User-agent: bot` group does not bind `Googlebot`. Both sides are compared by their product token, the leading run of letters, `_` and `-`, so a version or comment is ignored: `User-agent: ExampleBot/1.0` binds the `ExampleBot` crawler, and a crawler passing `ExampleBot/1.0 (+https://…)` finds its `User-agent: ExampleBot` group.

#### The crawler side

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { makeRobotsChecker, memoryRobotsCache } from "@thomasfosterau/effect-ext/Robots";

class CrawlSkipped extends Schema.TaggedError<CrawlSkipped>()("CrawlSkipped", {
  reason: Schema.String,
}) {}

const check = makeRobotsChecker({
  userAgent: "ExampleBot/1.0 (+https://example.com/bot)", // the request header
  userAgentToken: "ExampleBot", // the product token robots.txt names
  cache: memoryRobotsCache(), // or your own KV-backed adapter
});

// Effect<void, CrawlSkipped, HttpClient>
const crawl = (url: string) =>
  Effect.gen(function* () {
    const decision = yield* check(url);
    if (!decision.allowed) return yield* new CrawlSkipped({ reason: decision.reason });
    // … fetch the page, honouring decision.crawlDelaySeconds
  });
```

| Export | What it is |
| --- | --- |
| `fetchRobots(origin, { userAgent, timeout?, maxBytes?, isRefusal? })` | `GET <origin>/robots.txt` through `HttpClient`, with RFC 9309 §2.3.1's failure posture: a 2xx body (capped at `MAX_ROBOTS_BYTES`, §2.5), an empty string for 4xx / no file (`ROBOTS_NO_RESTRICTIONS` — crawl freely), and `ROBOTS_UNAVAILABLE_SENTINEL` for 5xx, a timeout or a transport error (treat as disallow). A failed request that `isRefusal(error)` identifies as the caller's own client refusing it (an SSRF guard, a DNS failure inside it) gives `ROBOTS_REFUSED_SENTINEL` instead: the origin was never asked. Never fails. |
| `RobotsCache<R>` | The per-origin cache seam: `get(origin): Effect<Option<string>, never, R>`, `put(origin, value, ttlSeconds)`. `noRobotsCache` fetches every time; `memoryRobotsCache()` is a `Map` for tests; a persistent adapter (for example Workers KV) lives in the consuming application. |
| `ROBOTS_CACHE_TTL_SECONDS` (24 h), `ROBOTS_UNAVAILABLE_TTL_SECONDS` (1 h) | Cache lifetimes: a body or "no restrictions" lives a day; an unavailable verdict is retried after an hour. |
| `evaluateRobots(robotsTxt, token, path, { maxCrawlDelaySeconds? })` | The crawl decision with the reasons: `{ allowed, matchedPattern: Option<string>, crawlDelaySeconds: Option<number> }`. The path is matched **with** its query string (a `?tab=` can be disallowed) and without its fragment; the crawl delay is capped at `MAX_CRAWL_DELAY_SECONDS` (30) and dropped when not positive. |
| `makeRobotsChecker(options)` | `(url) => Effect<RobotsDecision, never, HttpClient \| R>`: cache lookup → fetch on a miss → cache the body / the sentinel with the right TTL → evaluate. `RobotsDecision` is `{ allowed: true, crawlDelaySeconds }` or `{ allowed: false, reason }` (`ROBOTS_UNAVAILABLE_REASON`, `ROBOTS_REFUSED_REASON`, or `disallowed by robots.txt rule '<pattern>'`). A refusal is never cached, so the next check asks again. |

The checker runs one `HttpClient` request per origin per cache lifetime; that `HttpClient` should be the SSRF-guarded one (`@thomasfosterau/effect-ext/Net`) in an application that crawls user-supplied URLs.

#### The serving side

```ts
// routes/robots.txt/+server.ts
import { LOW_CHURN_CACHE_CONTROL, robotsBody } from "@thomasfosterau/effect-ext/Robots";
import { PUBLIC_SITE_URL, PUBLIC_STAGE } from "$env/static/public";

export const GET = () =>
  new Response(
    robotsBody(PUBLIC_STAGE === "production", {
      disallow: ["/api/", "/auth/"],
      sitemapUrl: `${PUBLIC_SITE_URL}/sitemap.xml`,
    }),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": LOW_CHURN_CACHE_CONTROL,
      },
    },
  );
```

| Export | What it is |
| --- | --- |
| `NON_PRODUCTION_BODY` | `User-agent: *` / `Disallow: /` — every non-production stage is invisible to crawlers, whatever the policy says (ROBOTS-005). |
| `productionBody({ disallow, sitemapUrl, comments? })` | The production document: the comment lines, a `User-agent: *` group with each `disallow` prefix, the `Sitemap:` line. Rendered through `encode`, so it round-trips through `parse`. Open to every crawler, the listed prefixes disallowed, an absolute sitemap URL (ROBOTS-002 … -004). |
| `robotsBody(production, policy)` | The stage switch: `productionBody(policy)` in production, `NON_PRODUCTION_BODY` on every other stage (ROBOTS-005). |
| `LOW_CHURN_CACHE_CONTROL` | `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400` — the edge caches the document an hour (PERF-CACHE-002). |
| `isRobotsBody(value)` | A refinement for a test or a handler. |

## Sitemap

Sitemap, sitemap index and JSON Feed 1.1 builders for Effect web applications (rendered or streamed), the low-churn edge cache policy they share, and the `Cache-Tag` purge-on-mutation seam.

Invariant ids in doc comments and below (`CANON-001`, `PERF-CACHE-002`, …) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-ext/blob/main/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

### Usage

#### Sitemaps

```ts
import * as Stream from "effect/Stream";
import {
  lastmodOf,
  renderSitemap,
  SITEMAP_CACHE_TAG,
  sitemapResponse,
  type SitemapUrl,
} from "@thomasfosterau/effect-ext/Sitemap";

// `base` is the canonical origin (the configured production origin); the rows are the application's.
const STATIC_PAGES: ReadonlyArray<SitemapUrl> = [{ path: "/" }, { path: "/about" }];

// Whole, for a bounded set:
const wholeSitemap = (base: string, rows: ReadonlyArray<{ id: string; updatedAt: Date }>) =>
  renderSitemap(base, [
    ...STATIC_PAGES,
    ...rows.map((row) => ({ path: `/people/${row.id}`, lastmod: lastmodOf(row.updatedAt) })),
  ]);

// Streamed, one chunk per entry, for a large one (run the enumeration before building the response):
const streamedSitemap = (base: string, entries: ReadonlyArray<SitemapUrl>) =>
  sitemapResponse(base, Stream.fromIterable(entries), { cacheTag: SITEMAP_CACHE_TAG });
```

| Export | What it is |
| --- | --- |
| `SitemapUrl` | `{ path, lastmod?: "YYYY-MM-DD" }`. |
| `lastmodOf(value)` | The day of a `Date` or an ISO string; `undefined` (omit `<lastmod>`) otherwise. A parse, never a clock read. |
| `renderUrl(base, entry)` | One `<url>`, its `<loc>` absolute on `base`. |
| `renderSitemap(base, entries)` | The whole `<urlset>` with the XML declaration, every `<loc>` absolute on `base` (CANON-001). |
| `sitemapStream(base, Stream<SitemapUrl>)` | The document as a `Stream<string>`: opening, one chunk per entry, closing — never materialised in the isolate. Every `<loc>` is absolute on `base` (CANON-001). |
| `sitemapResponse(base, stream, { cacheTag?, cacheControl? })` | The stream as an `HttpServerResponse`: `application/xml`, `LOW_CHURN_CACHE_CONTROL`, the `Cache-Tag`. |
| `chunkSitemap(entries, size = SITEMAP_MAX_URLS)`, `renderSitemapIndex(base, sitemaps)` | Past 50,000 URLs: split into files and index them. |
| `URLSET_OPEN`, `URLSET_CLOSE`, `escapeXml` | The pieces, and the escaper for any authored text a consumer decides to emit. Nothing here emits any: `<loc>` is not escaped, because every location is the canonical origin plus a path built from validated ids or a hand-written list. |

#### JSON Feed 1.1

```ts
import {
  buildJsonFeed,
  FEED_CACHE_TAG,
  FEED_ITEM_LIMIT,
  jsonFeedResponse,
  type FeedEntry,
} from "@thomasfosterau/effect-ext/Sitemap";

// `rows` are the newest FEED_ITEM_LIMIT changes, newest first.
const feedResponse = (base: string, rows: ReadonlyArray<FeedEntry>) =>
  jsonFeedResponse(
    buildJsonFeed(
      {
        base,
        title: "Example — Latest changes",
        description: `The ${FEED_ITEM_LIMIT} most recent changes.`,
      },
      rows,
    ),
    { cacheTag: FEED_CACHE_TAG },
  );
```

| Export | What it is |
| --- | --- |
| `FeedEntry` | `{ path, publishedAt, updatedAt, title?: string \| null, summary?: string \| null }` — the SQL wire shape, `null` for an absent text; the timestamps are ISO 8601 strings (no zone reads as UTC). |
| `buildJsonFeed({ base, title, description, feedPath? = "/feed.json", homePath? = "/" }, entries)` | The document. Item `id` and `url` are the canonical URL on `base`, never the request origin (CANON-001); `title` / `summary` are omitted, never `null`-valued; `content_text` (which JSON Feed 1.1 requires) is the `summary`, else the `title`, else `""`; dates are RFC 3339 in UTC, an unparsable one omitted; order is the caller's (newest-first). Built with [`JsonFeed`](#jsonfeed)'s `buildJsonFeed`; use that module directly for a feed with item bodies, authors or images. |
| `FEED_ITEM_LIMIT` (50) | The item bound: a change-discovery feed, not a corpus listing (DISC-010). |
| `jsonFeedResponse(feed, { cacheTag?, cacheControl? })` | 2-space pretty-printed `application/feed+json` with the cache headers. The indent is part of the bytes on the wire and in every cached copy. |
| `JsonFeed`, `JsonFeedItem`, `JSON_FEED_CONTENT_TYPE` | The shapes and the media type: effect-json-feed's. |

#### Cache-Tag purge on mutation

```ts
import {
  makePurgeTagsForResourceType,
  purgeCacheTags,
  type CachePurgeContext,
} from "@thomasfosterau/effect-ext/Sitemap";

// The resource types the sitemap and feed enumerate.
const purgeTagsForResourceType = makePurgeTagsForResourceType(["posts", "people"]);

// After a mutation to a resource of `type` (and after the response has gone out):
const purgeAfterMutation = (ctx: CachePurgeContext, type: string) =>
  purgeCacheTags(ctx, purgeTagsForResourceType(type));
```

| Export | What it is |
| --- | --- |
| `FEED_CACHE_TAG` (`feed`), `SITEMAP_CACHE_TAG` (`sitemap`) | The tags the responses carry and the purge names. |
| `makePurgeTagsForResourceType(eligibleTypes, tags?)` | `(type) => tags`: both tags for a type the documents enumerate, none otherwise — decided from the type alone, no visibility check (a wasted purge over a missed one). |
| `CachePurgeContext` | The `{ cache?: { purge({ tags }) } }` subset of a Workers `ExecutionContext`; `cache` is absent in local dev. |
| `purgeCacheTags(ctx, tags)` | `Effect<void>`: a no-op for no tags or no `cache`; a logged `cache-purge.rejected` (`success: false`) or `cache-purge.failed` (rejection), never a failure — the mutation never sees a dropped purge. The purge half of PERF-CACHE-002. |
| `purgeCacheTagsPromise(ctx, tags)` | The same as a `Promise`, for `ctx.waitUntil`. |
| `LOW_CHURN_CACHE_CONTROL` | The document `Cache-Control` (an hour at the edge, a day stale-while-revalidate): the explicit edge TTL of PERF-CACHE-002. |

## RssFeed

An RSS 2.0 feed builder for Effect web applications: the channel and item renderer, with escaped authored text and canonical absolute URLs, and the served `HttpServerResponse`.

Invariant ids in doc comments and below (`CANON-001`, `PERF-CACHE-002`) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-ext/blob/main/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

### Usage

```ts
import * as DateTime from "effect/DateTime";
import { rssResponse, type RssItem } from "@thomasfosterau/effect-ext/RssFeed";

// `rows` are the newest changes, newest first, already bounded.
const feed = (
  base: string,
  rows: ReadonlyArray<{ id: string; title: string; summary: string; publishedAt: string }>,
) =>
  rssResponse(
    { base, title: "Example — Latest changes", description: "The 50 most recent changes." },
    rows.map((row): RssItem => ({
      path: `/posts/${row.id}`,
      title: row.title,
      description: row.summary,
      publishedAt: DateTime.makeUnsafe(row.publishedAt),
    })),
    { cacheTag: "feed" },
  );
```

| Export | What it is |
| --- | --- |
| `RssChannel` | `{ base, title, description, homePath? = "/", feedPath? = "/rss.xml", language?, copyright?, lastBuildDate?, ttl? }`. |
| `RssItem` | `{ path, title?, description?, content?, author?, categories?, guid?, publishedAt? }` — at least one of `title` / `description` (a compile error otherwise). `content` is HTML, emitted as `content:encoded`. |
| `renderRss(channel, items)` | The whole document: the XML declaration, `<channel>` with its `atom:link rel="self"`, one `<item>` per entry in order. |
| `renderRssItem(base, item)` | One `<item>`; its `<link>` (and permalink `<guid>`, unless the item names its own) is the absolute URL of `path`. |
| `rssResponse(channel, items, { cacheTag?, cacheControl? })` | The document as an `HttpServerResponse`: `application/rss+xml`, `LOW_CHURN_CACHE_CONTROL` (PERF-CACHE-002), the `Cache-Tag`. |
| `RSS_CONTENT_TYPE`, `LOW_CHURN_CACHE_CONTROL` | `application/rss+xml`; `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`. |

Every piece of authored text and every URL is XML-escaped, and characters XML 1.0 forbids (stray control characters, lone surrogates) are dropped, so one bad title cannot make the feed unparseable. To purge the cached feed on a mutation, use `purgeCacheTags` from [`@thomasfosterau/effect-ext/Sitemap`](https://www.npmjs.com/package/@thomasfosterau/effect-ext/Sitemap) with the same tag.

## AtomFeed

An Atom (RFC 4287) feed builder for Effect web applications: the feed and entry renderer, with escaped authored text and canonical absolute URLs, and the served `HttpServerResponse`.

Invariant ids in doc comments and below (`CANON-001`, `PERF-CACHE-002`) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-ext/blob/main/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

### Usage

```ts
import * as DateTime from "effect/DateTime";
import { atomResponse, type AtomEntry } from "@thomasfosterau/effect-ext/AtomFeed";

// `rows` are the newest changes, newest first, already bounded.
const feed = (
  base: string,
  rows: ReadonlyArray<{ id: string; title: string; summary: string; updatedAt: string }>,
) => {
  const entries = rows.map((row): AtomEntry => ({
    path: `/posts/${row.id}`,
    title: row.title,
    summary: row.summary,
    updated: DateTime.makeUnsafe(row.updatedAt),
  }));
  return atomResponse(
    {
      base,
      title: "Example — Latest changes",
      // The newest entry's `updated`, or a fixed value for an empty feed.
      updated: entries[0]?.updated ?? DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
      authors: [{ name: "Example" }],
    },
    entries,
    { cacheTag: "feed" },
  );
};
```

| Export | What it is |
| --- | --- |
| `AtomFeedOptions` | `{ base, title, updated, subtitle?, id? (= feed URL), homePath? = "/", feedPath? = "/atom.xml", language?, authors?, rights?, icon?, logo? }`. RFC 4287 needs an author on every entry: give the feed `authors` unless every entry has its own. |
| `AtomEntry` | `{ path, title, updated, published?, id? (= absolute URL), summary?, content?, authors?, categories? }`. `summary` is text; `content` is HTML, emitted as `<content type="html">`. |
| `AtomPerson` | `{ name, email?, uri? }`. |
| `renderAtom(options, entries)` | The whole document: the XML declaration, the `<feed>` metadata with its `alternate` and `self` links, one `<entry>` per entry in order. |
| `renderAtomEntry(base, entry)` | One `<entry>`; its `alternate` link (and `<id>`, unless the entry names its own) is the absolute URL of `path`. |
| `atomResponse(options, entries, { cacheTag?, cacheControl? })` | The document as an `HttpServerResponse`: `application/atom+xml`, `LOW_CHURN_CACHE_CONTROL` (PERF-CACHE-002), the `Cache-Tag`. |
| `ATOM_CONTENT_TYPE`, `LOW_CHURN_CACHE_CONTROL` | `application/atom+xml`; `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`. |

Every piece of authored text and every URL is XML-escaped, and characters XML 1.0 forbids (stray control characters, lone surrogates) are dropped, so one bad title cannot make the feed unparseable. To purge the cached feed on a mutation, use `purgeCacheTags` from [`@thomasfosterau/effect-ext/Sitemap`](https://www.npmjs.com/package/@thomasfosterau/effect-ext/Sitemap) with the same tag.

## JsonFeed

A JSON Feed 1.1 builder and reader for Effect web applications: the typed feed document, with canonical absolute URLs and omitted absent members, the served `HttpServerResponse`, and a lenient reader for JSON Feed 1.0 and 1.1 documents as real feeds publish them.

Invariant ids in doc comments and below (`CANON-001`, `PERF-CACHE-002`) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-ext/blob/main/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

### Usage

```ts
import * as DateTime from "effect/DateTime";
import {
  buildJsonFeed,
  jsonFeedResponse,
  type JsonFeedEntry,
} from "@thomasfosterau/effect-ext/JsonFeed";

// `rows` are the newest changes, newest first, already bounded.
const feed = (
  base: string,
  rows: ReadonlyArray<{ id: string; title: string; body: string; updatedAt: string }>,
) =>
  jsonFeedResponse(
    buildJsonFeed(
      { base, title: "Example — Latest changes", description: "The 50 most recent changes." },
      rows.map((row): JsonFeedEntry => ({
        path: `/posts/${row.id}`,
        title: row.title,
        contentHtml: row.body,
        updatedAt: DateTime.makeUnsafe(row.updatedAt),
      })),
    ),
    { cacheTag: "feed" },
  );
```

| Export | What it is |
| --- | --- |
| `JsonFeedOptions` | `{ base, title, description?, homePath? = "/", feedPath? = "/feed.json", nextPath?, userComment?, icon?, favicon?, authors?, language?, expired? }`. |
| `JsonFeedEntry` | `{ path, id? (= absolute URL), externalUrl?, title?, summary?, contentHtml?, contentText?, image?, bannerImage?, publishedAt?, updatedAt?, authors?, tags?, language?, attachments? }` — at least one of `contentHtml` / `contentText` (a compile error otherwise). |
| `JsonFeedAuthor` | `{ name?, url?, avatar? }` — at least one. |
| `JsonFeedAttachment` | `{ url, mime_type, title?, size_in_bytes?, duration_in_seconds? }` — an enclosure; `url` may be a path on input. |
| `buildJsonFeed(options, entries)` | The `JsonFeed` document (spec member names), one item per entry in order. Pure. |
| `buildJsonFeedItem(base, entry)` | One `JsonFeedItem`; its `url` (and `id`, unless the entry names its own) is the absolute URL of `path`. |
| `jsonFeedResponse(feed, { cacheTag?, cacheControl? })` | The document as an `HttpServerResponse`: 2-space pretty-printed, `application/feed+json`, `LOW_CHURN_CACHE_CONTROL` (PERF-CACHE-002), the `Cache-Tag`. |
| `JSON_FEED_VERSION`, `JSON_FEED_CONTENT_TYPE`, `LOW_CHURN_CACHE_CONTROL` | `https://jsonfeed.org/version/1.1`; `application/feed+json`; `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`. |

Every path-valued member (`icon`, `image`, an author's `url` / `avatar`, …) takes a site-root-relative path or an absolute URL and is emitted absolute. An absent member is an omitted key, never `null`. To purge the cached feed on a mutation, use `purgeCacheTags` from [`@thomasfosterau/effect-ext/Sitemap`](https://www.npmjs.com/package/@thomasfosterau/effect-ext/Sitemap) with the same tag.

`@thomasfosterau/effect-ext/Sitemap` also ships a narrower JSON Feed builder over its own `FeedEntry` shape; this package is the complete JSON Feed 1.1 surface.

### Reading a feed

```ts
import * as Effect from "effect/Effect";
import { parseJsonFeed } from "@thomasfosterau/effect-ext/JsonFeed";

const read = (body: string) =>
  Effect.map(parseJsonFeed(body), ({ feed, version, diagnostics }) => ({
    titles: feed.items.map((item) => item.title ?? item.id),
    version, // the version URL the document declared
    diagnostics, // [{ path: "$.items[3].id", message: "a number; read as its string" }, …]
  }));
```

| Export | What it is |
| --- | --- |
| `parseJsonFeed(text)` | `Effect<ParsedJsonFeed, JsonFeedParseError>`: `JSON.parse`, then `decodeJsonFeed`. |
| `decodeJsonFeed(value)` | `Result<ParsedJsonFeed, JsonFeedParseError>` over an already-parsed value. |
| `ParsedJsonFeed` | `{ feed: JsonFeed, version, diagnostics }`: the document in the 1.1 shape (a 1.0 `author` becomes `authors`), the `version` URL it declared, and what was repaired or dropped. |
| `JsonFeedDiagnostic` | `{ path, message }`, `path` a JSON path (`$.items[2].id`). |
| `JsonFeedParseError` | `reason`: `InvalidJson`, `NotAnObject`, or `NotAJsonFeed` (no `https://jsonfeed.org/version/…` `version`). |

Reading is lenient, as real feeds need: a member of the wrong type is dropped, a numeric `id` becomes its string, an item with no usable `id` falls back to its `url` (or is dropped), an author with no `name` / `url` / `avatar` or an attachment without `url` and `mime_type` is dropped, `null` reads as absent, a missing `title` as `""` and missing `items` as none — each with a diagnostic. An item with neither `content_html` nor `content_text` is kept and reported. Dates and URLs are kept exactly as the document wrote them; `_`-prefixed extensions and `hubs` are not read.

## UriTemplate

URI Templates ([RFC 6570](https://www.rfc-editor.org/rfc/rfc6570)), Web Linking ([RFC 8288](https://www.rfc-editor.org/rfc/rfc8288)) and well-known URIs ([RFC 8615](https://www.rfc-editor.org/rfc/rfc8615)) for [Effect](https://effect.website).

```sh
pnpm add @thomasfosterau/effect-ext/UriTemplate effect
```

### `UriTemplate`

```ts
import * as Result from "effect/Result";
import { UriTemplate } from "@thomasfosterau/effect-ext/UriTemplate";

const template = UriTemplate.parse("https://api.example/users{/id}{?fields*}");
Result.flatMap(template, (t) => UriTemplate.expand(t, { id: "42", fields: ["name", "email"] }));
// Success("https://api.example/users/42?fields=name&fields=email")
```

- `parse(source): Result<UriTemplate, TemplateError>`. The error carries a `reason` (`UnmatchedBrace`, `InvalidLiteral`, `ReservedOperator`, `InvalidVariable`) and the 0-based `position` of the fault.
- `expand(template, variables): Result<string, TemplateError>` covers all four levels: simple, `+` reserved, `#` fragment, `.` label, `/` path segment, `;` path-style parameter, `?` query and `&` continuation, prefix `:n` and explode `*`, with lists and associative arrays. A value is a string, number or boolean, a list of them, or a flat record of them. `null`, `undefined`, `[]` and `{}` count as undefined. The only failure is `PrefixOnComposite` (a prefix on a list or record).
- `variables(template)` lists each variable name once, in order.
- `matcher(template): Result<Matcher, TemplateError>` and `match(matcher, url): Option<Matched>` are the inverse, for routing: the variables a URL was expanded from. RFC 6570 warns the inverse is ambiguous, so only an unambiguous subset compiles; anything else fails `Unmatchable` with the expression's position (prefix modifiers, several variables in one unnamed expression, explode outside `/` `.` `?` `&`, two expressions with nothing between them that could tell them apart, a query expression before another part, a variable used twice). `U` values are percent-decoded and a raw `,` splits a list; `+` / `#` values are kept as written; query variables are read by name in any order, and an exploded one with no parameter of its own name takes the unclaimed parameters as a record. For a URL the template produced, `expand(template, match(url))` reproduces it.
- `UriTemplateFromString` is the same as a `Schema` codec.

Conformance is checked against the [uritemplate-test](https://github.com/uri-templates/uritemplate-test) suite: the RFC's examples, the extended tests and the negative tests.

### `LinkHeader`

```ts
import { LinkHeader } from "@thomasfosterau/effect-ext/UriTemplate";

const links = LinkHeader.parse(response.headers.get("link") ?? "", response.url);
LinkHeader.findRel(links, "describedby"); // Option<Link>
LinkHeader.serialize([LinkHeader.make("/items?page=3", { rel: "next" })]); // "</items?page=3>; rel=next"
```

- `parse(header, base?)` returns `Link`s, each with `target`, a `rel` set, `anchor`, `type`, `media`, `title`, `titleStar` (RFC 8187, decoded with its language), `hreflang` and the remaining `params`. Targets and anchors are resolved against `base` when one is given. It never fails: malformed link-values are skipped, as RFC 8288 Appendix B describes.
- `serialize(links)` produces one header value. Values are quoted where needed, and `title*` is written as UTF-8.
- `make(target, options)` builds a link. `hasRel`, `findRel` and `filterRel` query by relation type: registered types are compared ignoring case, extension URIs exactly.
- `LinkHeaderFromString` is the header value as a `Schema` codec.

### `WellKnown`

```ts
import { WellKnown } from "@thomasfosterau/effect-ext/UriTemplate";

WellKnown.url("https://example.org/tables/1.csv", "csvm"); // Success(URL "https://example.org/.well-known/csvm")
WellKnown.suffixOf("https://example.org/.well-known/acme-challenge/x"); // Some("acme-challenge")
```

- `url(origin, suffix): Result<URL, WellKnownError>` builds the URL at the root of the origin. It fails with `InvalidSuffix` (not a path segment, or `.` / `..`) or `InvalidOrigin` (a scheme other than `http`, `https`, `ws` or `wss`).
- `suffixOf(url)` returns the suffix a well-known URL addresses. `isValidSuffix` checks suffix syntax.
- `RegisteredSuffix` / `registeredSuffixes` list suffixes in common use (`csvm`, `security.txt`, `change-password`, `openid-configuration`, …).

## Langtag and LangtagRegistry

BCP 47 language tags ([RFC 5646](https://www.rfc-editor.org/rfc/rfc5646)) and language-range matching ([RFC 4647](https://www.rfc-editor.org/rfc/rfc4647)) for [Effect](https://effect.website).

`Intl.Locale` canonicalises tags but rejects some well-formed ones (grandfathered and private-use forms), and there is no built-in RFC 4647 matching. This package parses every well-formed tag, matches the way RFC 4647 specifies, and negotiates a language from `Accept-Language`.

```sh
pnpm add @thomasfosterau/effect-ext/Langtag effect
```

### `LanguageTag`

```ts
import * as Option from "effect/Option";
import { LanguageTag } from "@thomasfosterau/effect-ext/Langtag";

LanguageTag.parse("zh-hant-tw"); // Some("zh-Hant-TW")
LanguageTag.parse("de-419-DE"); // None: two regions

const tag = Option.getOrThrow(LanguageTag.parse("ar-EG"));
LanguageTag.primaryLanguage(tag); // Some("ar")
LanguageTag.region(tag); // Some("EG")
LanguageTag.direction(tag); // "rtl"
```

- `parse(string): Option<LanguageTag>` — any case in, canonical case out (`en-us` → `en-US`, `ZH-HANT` → `zh-Hant`, `I-KLINGON` → `i-klingon`). A `LanguageTag` is a branded string, so two tags are equal exactly when they are `===`.
- `LanguageTagFromString` — the same as a `Schema` codec (string → `LanguageTag`); `LanguageTag` is the schema of the branded, canonical-case value itself.
- `isWellFormed(string)` — the RFC 5646 §2.1 ABNF: language, extlangs, script, region, variants, extensions, private use, and the grandfathered tags.
- `subtags(tag)` — `{ kind, language, extlangs, script, region, variants, extensions, privateUse }`, with `Option` for the single subtags.
- `primaryLanguage`, `script`, `region` — the single subtags as `Option`s.
- `direction(tag)` — `"rtl"` or `"ltr"`, a hint for an HTML `dir`: from the script where there is one (`az-Arab`), else from the language (`ar`, `he`, `fa`, `ur`, `yi`, …).

**Well-formed, not valid.** The root entry never consults the IANA Language Subtag Registry: `qq-Zzzz` parses, `iw` is not mapped to `he`, and a repeated singleton (`ar-a-aaa-b-bbb-a-ccc`) is not rejected. Validity and canonical form are the `LangtagRegistry` entry's.

### `LangtagRegistry` — validity and canonical form

```ts
import * as Option from "effect/Option";
import { LanguageTag } from "@thomasfosterau/effect-ext/Langtag";
import { canonicalize, isValid } from "@thomasfosterau/effect-ext/LangtagRegistry";

const tag = Option.getOrThrow(LanguageTag.parse("iw-IL"));
isValid(tag); // true: `iw` is registered (deprecated)
canonicalize(tag); // "he-IL"
```

- `isValid(tag)` — RFC 5646 §2.2.9: grandfathered and private-use tags, or every language, extlang, script, region and variant subtag registered, with no variant and no extension singleton repeated.
- `canonicalize(tag, { suppressScript? })` — RFC 5646 §4.5: grandfathered and redundant tags and deprecated subtags replaced by their `Preferred-Value` (`i-klingon` → `tlh`, `zh-guoyu` → `cmn`, `in` → `id`, region `BU` → `MM`), an extlang by the language it is (`zh-yue-HK` → `yue-HK`), extensions sorted by singleton; `suppressScript: true` also drops a script the language implies (`en-Latn-US` → `en-US`).
- `suppressScript(language)` — the registry's `Suppress-Script` (`en` → `Latn`).
- `registryDate` — the snapshot's `File-Date`.

It is a separate entry so its ~45 KB registry snapshot is bundled only by code that imports it. The snapshot is generated by `scripts/generate-language-subtag-registry.mjs`.

### `LanguageRange`

```ts
import { LanguageRange } from "@thomasfosterau/effect-ext/Langtag";

LanguageRange.filterBasic(["de-CH", "en"], ["en-US", "de", "de-CH-1996"]); // ["de-CH-1996", "en-US"]
LanguageRange.filterExtended(["*-CH"], ["de-CH", "fr-CH", "de-DE"]); // ["de-CH", "fr-CH"]
LanguageRange.lookup(["de-CH-1996", "fr"], ["fr-FR", "de"]); // Some("de")
```

- `matchesBasic` / `filterBasic` — RFC 4647 §3.3.1: a range matches a tag equal to it or starting with it and a `-`; `*` matches everything.
- `matchesExtended` / `filterExtended` — §3.3.2: subtags match in order, skipping tag subtags (never past a singleton), `*` matching any subtag.
- `lookup` / `fallbacks` — §3.4: each range, truncated from the end (`de-CH-1996` → `de-CH` → `de`), against the available tags; `None` for the caller's default. Lookup truncates the _range_: `de` does not select an available `de-DE`.
- `isBasic`, `isExtended` — range syntax.

Every function compares case-insensitively and returns the caller's own values.

### `AcceptLanguage` and `negotiateLanguage`

```ts
import { AcceptLanguage, negotiateLanguage } from "@thomasfosterau/effect-ext/Langtag";

AcceptLanguage.parse("fr-CH, fr;q=0.9, en;q=0.8"); // [{ range: "fr-CH", quality: 1 }, …]
negotiateLanguage(["en", "de", "fr"], request.headers.get("accept-language") ?? undefined);
```

- `AcceptLanguage.parse(header)` — `{ range, quality }` entries, highest quality first, ties in header order. Bad ranges are dropped; a malformed `q` reads as `1`; `q=0` entries are kept.
- `negotiateLanguage(available, header)` — lookup over the positive-quality ranges in order, never choosing a tag a `q=0` range matches; `*` takes the first remaining available tag. `None` when nothing is acceptable.

## Css

CSS for [Effect](https://effect.website): the [CSS Syntax Level 3](https://www.w3.org/TR/css-syntax-3/) tokenizer and parser (a `style` attribute's declarations, stylesheets, rules, component values) with error recovery, typed [CSS Color 4](https://www.w3.org/TR/css-color-4/) colours with conversion to sRGB, and [CSS Values 4](https://www.w3.org/TR/css-values-4/) lengths. Checked against the [css-parsing-tests](https://github.com/SimonSapin/css-parsing-tests) suite.

```sh
pnpm add @thomasfosterau/effect-ext/Css effect
```

```ts
import * as Option from "effect/Option";
import { Color, Length, Syntax } from "@thomasfosterau/effect-ext/Css";

for (const item of Syntax.parseDeclarationList(
  "color: oklch(70% 0.1 200); margin-left: 12pt !important",
)) {
  if (item._tag !== "Declaration") continue; // a SyntaxError: { kind, offset }
  const [value] = item.value.filter((component) => component._tag !== "Whitespace");
  if (value === undefined) continue;
  if (item.name === "color") Color.parse(value).pipe(Option.flatMap(Color.toSrgb)); // Option.some({ red, green, blue, alpha })
  if (item.name === "margin-left") Length.parse(value).pipe(Option.flatMap(Length.toPixels)); // Option.some(16)
}
```

### `Syntax`

| Export | Specification entry point |
| --- | --- |
| `parseDeclarationList(css)` | Parse a list of declarations (a `style` attribute): `Declaration`s and `AtRule`s, with `SyntaxError` items for what was skipped. |
| `parseStylesheet(css)`, `parseRuleList(css)` | A stylesheet (CDO / CDC skipped at the top level) or a list of rules: `QualifiedRule`s and `AtRule`s, block contents as component values. |
| `parseRule(css)`, `parseDeclaration(css)`, `parseComponentValue(css)` | Exactly one, or a `SyntaxError` (`empty`, `invalid`, `extra-input`). |
| `parseBlockContents(css)` | A block's contents with CSS nesting (the editor's draft's "parse a block's contents"): `Declaration`s, `AtRule`s and nested `QualifiedRule`s in order; something like `a:hover {…}` that is not a declaration is a rule. |
| `parseComponentValueList(css)` | The input as component values: tokens, `Func`s and `Block`s. |

A `SyntaxError` carries `offset`, the code-point offset in the preprocessed input (CRLF counted as one). The token and component-value types are in `Token`.

The parsers take text, not bytes. To parse a stylesheet fetched as bytes, decode it first, for example with [`@thomasfosterau/effect-ext/Encoding`](https://www.npmjs.com/package/@thomasfosterau/effect-ext/Encoding). Pass it the encoding Syntax 3 §3.2 would pick: the protocol's `charset`, then an `@charset` rule, then the referring document's encoding, then UTF-8. A byte-order mark overrides that encoding, which is the decoder's default BOM sniff.

```ts
import * as Effect from "effect/Effect";
import { Encoding } from "@thomasfosterau/effect-ext/Encoding";
import { Syntax } from "@thomasfosterau/effect-ext/Css";

const bytes = new Uint8Array([
  0x70, 0x20, 0x7b, 0x20, 0x63, 0x6f, 0x6c, 0x6f, 0x72, 0x3a, 0x20, 0x72, 0x65, 0x64, 0x20, 0x7d,
]);
const rules = await Effect.runPromise(
  Effect.map(Encoding.decode(bytes, { encoding: "UTF-8" }), Syntax.parseStylesheet),
);
```

### `AnPlusB`

`AnPlusB.parse(cssOrComponentValues)` reads the `An+B` microsyntax (Syntax 3 §6) of `:nth-child()` and its relatives into `[a, b]`: `odd`, `even`, an integer, or `An` with an optional `+ B` / `- B` (`2n+1`, `-n + 3`, `+N-2`), case-insensitive, whitespace allowed around the sign but not inside `+n` or a number.

### `Color`

`Color.parse(cssOrComponentValue)` takes named colours, `transparent`, `currentcolor`, hex (3, 4, 6, 8 digits), `rgb()` / `rgba()` / `hsl()` / `hsla()` in both comma and space syntaxes, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` and `color()` in the predefined spaces (`srgb`, `srgb-linear`, `display-p3`, `display-p3-linear`, `a98-rgb`, `prophoto-rgb`, `rec2020`, `xyz`, `xyz-d50`, `xyz-d65`), with `none` and angle units. The result is a tagged `Color` (a named colour is `Named`, keeping its name; `hsl()` and `hwb()` keep their own channels, `none` included, as `Hsl` and `Hwb`); `Color.serialize` prints its specified value as today's CSS Color 4 does: a named colour as its name, hex, `rgb()`, `hsl()` and `hwb()` as `rgb()` / `rgba()` with integer channels, except that a `none` channel stays (`rgb()` as `color(srgb …)`, `hsl()` and `hwb()` as themselves), and `lab()`-family lightness clamped, and `Color.toSrgb` converts it to sRGB (0 to 1, not gamut-mapped). From [CSS Color 5](https://www.w3.org/TR/css-color-5/): `device-cmyk()` (space and legacy comma syntaxes, channels clamped to [0, 1], serialised as `color(device-cmyk …)`, converted to sRGB naively), `color()` in a custom `--name` space (channels kept as written, no sRGB without its `@color-profile`) `light-dark()` (both colours kept; no sRGB, since which applies depends on the used colour scheme) and `color-mix()` (an optional `in <space> [<method> hue]`, `oklab` by default, then one or more colours with optional percentages from 0% to 100%; kept as written and serialised as its specified value, with the default method left out and the percentages filled in, or left out when all equal and summing to 100%). `Color.resolve` computes a mix (CSS Color 5 §3.2): each colour converted to the interpolation space, a missing component carried forward to its analogue and an achromatic colour's hue treated as missing, then interpolated with premultiplied alpha and the hue method, two colours at a time, with alpha scaled when the percentages sum to under 100%. The result is in the interpolation space (`color(srgb …)` for `srgb`, `hsl` and `hwb`), and `toSrgb` goes through it). Web-platform-tests' `css/css-color/parsing` vectors run in `tests/color-valid.test.ts`, `tests/color-invalid.test.ts` and `tests/color-mix.test.ts`. Every one passes except those that use `calc()` or `var()`.

### `Length`

`Length.parse` takes a dimension in a length unit (absolute `px cm mm q in pt pc`, and the font- and viewport-relative ones), a percentage, or a unitless `0`; `toPixels` and `convert` handle the absolute units (1in = 96px = 72pt), `serialize` prints it back. `parse` also takes a `calc()` that simplifies to one unit (`calc(1in + 10px)` is `106px`); `parseSum` returns any `calc()` of lengths and percentages simplified to one term per unit (CSS Values 4 §10: `+` and `-` with whitespace around them, `*` by a number, `/` by a non-zero number, nested parentheses), with the absolute units folded into `px`, and `serializeSum` writes it back (`calc(50% - 1em)`).

### `Shorthand`

`Shorthand.expand(declaration)` expands a box shorthand into its longhands, keeping `!important`: `margin`, `padding` and `inset` by the 1 to 4 values rule, `border-width` / `-style` / `-color` likewise, and `border` / `border-top` (and the other sides) into each side's `-width`, `-style` and `-color`, in any order, with an omitted part at its initial value (`medium`, `none`, `currentcolor`). A CSS-wide keyword goes to every longhand. `None` for an invalid value or one holding `var()`. `Shorthand.isShorthand(name)` says whether a property is one of these.

### `Font`

`Font.parse` reads the `font` shorthand (CSS Fonts 4 §2.8): optional style (an oblique angle included), `small-caps`, weight and width keywords in any order, each at most once and `normal` standing for any of them, then the size, an optional `/ line-height` and the family list; or a system font keyword (`caption`, `menu`, …) alone. What it leaves out takes its initial value. `parseFamily`, `parseWeight` (`normal` is 400, `bold` 700, or 1 to 1000, `bolder`, `lighter`), `parseStyle`, `parseSize` and `parseLineHeight` read the longhands. A family name made of identifiers may not start with a generic or CSS-wide keyword; quote it.

```ts
import * as Option from "effect/Option";
import { Font } from "@thomasfosterau/effect-ext/Css";

const font = Font.parse('italic bold 12px/1.5 "Fira Sans", serif');
// Option.some({ _tag: "Font", style: { _tag: "Italic" }, weight: 700, lineHeight: { _tag: "Number", value: 1.5 }, … })
```

### `Text`

`Text.parseAlign` (`text-align`), `parseVerticalAlign` (a keyword, or a length or percentage), and `text-decoration`: `parseDecoration` reads the shorthand (a line, a style, a colour and a thickness, each at most once and in any order, with `currentcolor` as `None`), and `parseDecorationLine`, `parseDecorationStyle` and `parseDecorationThickness` the longhands.

### `Serialize`

Writes parsed CSS back as text. `identifier`, `string` and `url` follow CSSOM's rules (`Serialize.identifier("1st")` is `\31 st`); `componentValues` follows CSS Syntax 3 §9, keeping each number's written form and putting `/**/` between two tokens that would otherwise tokenize as one; `declaration` and `declarationList` write a `style` attribute the way CSSOM does (`color: red; margin: 0 auto !important;`). Parsing the output gives back the same component values, less comments and whitespace runs; the round trip is tested over every css-parsing-tests input.

```ts
import { Serialize, Syntax } from "@thomasfosterau/effect-ext/Css";

Serialize.declarationList(Syntax.parseDeclarationList("color:red;;margin : 0 auto"));
// "color: red; margin: 0 auto;"
```

### Not yet

The other math functions (`min()`, `max()`, `clamp()`, …).

## Encoding

The [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) on [Effect](https://effect.website): resolve an encoding label, sniff a byte-order mark, decode bytes or a byte stream, and encode text to UTF-8 or a legacy single-byte encoding. Both directions are fatal by default: malformed input fails with a typed `DecodeError` that says which byte went wrong, and an unmappable character with an `EncodeError` that says which character, never a silent U+FFFD or `?`.

```sh
pnpm add @thomasfosterau/effect-ext/Encoding effect
```

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Encoding } from "@thomasfosterau/effect-ext/Encoding";

const encoding = Option.getOrElse(Encoding.getEncoding("latin1"), () => "UTF-8" as const); // "windows-1252"
const text = await Effect.runPromise(
  Encoding.decode(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), { encoding }),
); // "café"

const decoded = Stream.make(new Uint8Array([0xe2, 0x82]), new Uint8Array([0xac])).pipe(
  Encoding.decodeStream(),
  Stream.runCollect,
); // ["€"]

const csv = await Effect.runPromise(Encoding.encode("Café;5 €", { encoding: "windows-1252" })); // Uint8Array [0x43, 0x61, 0x66, 0xe9, …]
```

### API

| Export | What it does |
| --- | --- |
| `ENCODING_NAMES`, `EncodingName` | The standard's 40 encodings (`UTF-8`, `windows-1252`, `Shift_JIS`, …), as a literal union. |
| `getEncoding(label)` | A label to its encoding (§4.2): ASCII whitespace trimmed, ASCII case-insensitive, against the standard's 228 labels. `Option.none()` for an unknown label. |
| `sniffBom(bytes)` | The BOM sniff (§6): `Option<{ encoding: "UTF-8" \| "UTF-16LE" \| "UTF-16BE", length }>`, a standalone step for hosts that layer their own detection on top (XML Appendix F, HTML `<meta charset>`). |
| `decode(bytes, options?)` | Bytes to a string. `Effect<string, DecodeError \| UnsupportedEncodingError>`. |
| `decodeStream(stream, options?)` / `stream.pipe(decodeStream(options?))` | A `Stream<Uint8Array>` to a `Stream<string>`, with sequences split across chunks handled. Offsets count from the start of the stream. |
| `isSupported(encoding, tables?)` | Whether this runtime (or the given tables) can decode the encoding. |
| `DecodeError` | `{ encoding, offset, message }`: the byte offset the error was detected at (the input's length for a sequence cut short by the end of input). |
| `encode(text, options?)` | Text to bytes (§4.3). `Effect<Uint8Array, EncodeError \| UnsupportedEncodingError>`. A lone surrogate is encoded as U+FFFD. |
| `encodeStream(stream, options?)` / `stream.pipe(encodeStream(options?))` | A `Stream<string>` to a `Stream<Uint8Array>`, with surrogate pairs split across chunks handled. Offsets count from the start of the stream. |
| `canEncode(encoding, tables?)` | Whether there is an encoder: UTF-8, every single-byte encoding and `x-user-defined`, and a CJK encoding when `tables` hold its index. |
| `tablesLayer(...tables)`, `EncodingTables`, `Tables` | Provide the CJK indexes from the opt-in entries (`EncodingJapanese`, `EncodingGb18030`, `EncodingBig5`, `EncodingEucKr`) to `encode` / `decode` and their stream forms. |
| `getOutputEncoding(encoding)` | §4.3's "get an output encoding": `replacement`, `UTF-16BE` and `UTF-16LE` (which have no encoder) become `UTF-8`. |
| `EncodeError` | `{ encoding, offset, codePoint, message }`: the unmappable code point and its UTF-16 code-unit offset (a string index). |
| `UnsupportedEncodingError` | `{ encoding, message }`: the runtime's `TextDecoder` lacks the encoding and no table for it is bundled, or there is no encoder for it. |

`DecodeOptions`:

- `encoding` — defaults to `UTF-8`.
- `fatal` — defaults to `true`; `false` decodes malformed input to U+FFFD.
- `bomHandling` — `"sniff"` (default: the standard's "decode", where a BOM overrides `encoding` and is removed), `"strip"` (the requested encoding stands, its own BOM removed) or `"keep"` (a BOM decodes as U+FEFF).

`EncodeOptions`:

- `encoding` — defaults to `UTF-8`.
- `errorMode` — `"fatal"` (default) fails on an unmappable code point; `"html"` writes `&#N;`, as an HTML form does (which silently loses the difference from text that already read `&#N;`).

### Runtime support

The single-byte encodings and `x-user-defined` are decoded and encoded from the standard's indexes, bundled here (about 25 KB of source), whatever the runtime has: some runtimes ship a `TextDecoder` without the legacy encodings (small-ICU Node builds, some edge runtimes), full-ICU Node lacks `ISO-8859-16` and `x-user-defined`, and Node's ICU decodes `IBM866`, `KOI8-U`, `windows-874`, `windows-1253` and `windows-1255` differently from the standard. UTF-8, UTF-16 and the CJK encodings are decoded with the runtime's `TextDecoder`; a CJK encoding it lacks fails with `UnsupportedEncodingError` (check with `isSupported` first if you need to choose).

The CJK encodings (Shift_JIS, EUC-JP, ISO-2022-JP, GBK / gb18030, Big5, EUC-KR) encode, and decode by the standard's own algorithms, once their indexes are provided. The indexes are opt-in entries, so a bundle that never meets them never loads them (each is 70 to 95 KB of source):

```ts
import * as Effect from "effect/Effect";
import { Encoding } from "@thomasfosterau/effect-ext/Encoding";
import * as Japanese from "@thomasfosterau/effect-ext/EncodingJapanese"; // Shift_JIS, EUC-JP, ISO-2022-JP
import * as Gb18030 from "@thomasfosterau/effect-ext/EncodingGb18030"; // gb18030, GBK
import * as Big5 from "@thomasfosterau/effect-ext/EncodingBig5";
import * as EucKr from "@thomasfosterau/effect-ext/EncodingEucKr";

const sjis = await Effect.runPromise(
  Encoding.encode("日本語", { encoding: "Shift_JIS" }).pipe(
    Effect.provide(Encoding.tablesLayer(Japanese.tables)),
  ),
);
```

Without them, a CJK encoding decodes through the runtime's `TextDecoder` (a small-ICU runtime lacks it: `UnsupportedEncodingError`) and does not encode (`UnsupportedEncodingError`).

## Mime

MIME types for [Effect](https://effect.website), after the [WHATWG MIME Sniffing](https://mimesniff.spec.whatwg.org/) and [Fetch](https://fetch.spec.whatwg.org/#data-urls) standards: parse and serialise `type/subtype;name=value`, decide what a resource is from its leading bytes, map file extensions, and process `data:` URLs. Checked against the web-platform-tests vectors for MIME type parsing and `data:` URLs, and against the `mimesniff/` media and sniffing resources.

```sh
pnpm add @thomasfosterau/effect-ext/Mime effect
```

```ts
import * as Option from "effect/Option";
import { DataUrl, Extension, MimeType, Sniff } from "@thomasfosterau/effect-ext/Mime";

MimeType.parse('Text/HTML; Charset="utf-8"').pipe(Option.map(MimeType.serialize)); // Option.some("text/html;charset=utf-8")

const bytes = new TextEncoder().encode("%PDF-1.7\n");
MimeType.essence(Sniff.sniff(bytes)); // "application/pdf"

Extension.mimeTypeFor("Report.DOCX"); // Option.some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")

DataUrl.process("data:,Hello%2C%20World").pipe(
  Option.map(({ body }) => new TextDecoder().decode(body)),
); // Option.some("Hello, World")
```

### `MimeType`

| Export | What it does |
| --- | --- |
| `parse(string)` | §4.4: `Option<MimeType>`, `None` without a valid `type/subtype`. Type, subtype and parameter names lower-cased; parameters ordered, first value of a repeated name wins; a malformed parameter skipped. |
| `serialize(mimeType)` | §4.5: `type/subtype;name=value`, quoting a value that is empty or not a token. |
| `essence`, `parameter(mimeType, name)`, `isXml` | `type/subtype`; a parameter by case-insensitive name; whether it is an XML MIME type (`+xml`, `text/xml`, `application/xml`). |
| `MimeType`, `MimeTypeFromString` | The record's `Schema` (`{ type, subtype, parameters: ReadonlyArray<[name, value]> }`) and the string codec (decode by `parse`, encode by `serialize`). |

### `Sniff`

| Export | What it does |
| --- | --- |
| `sniff(bytes, { supplied?, noSniff?, scriptable? = true, signatures?, checkForApacheBug? = false })` | §7's computed MIME type, from the first 1445 bytes: an unknown type is identified (HTML / XML / PDF while `scriptable`, PostScript, BOM-led text, images, audio and video, archives, your `signatures`, then text or binary; your `signatures` also refine a generic `application/zip` match; HTML / XML / PDF are not detected under `noSniff`); a supplied image, audio or video type (`application/ogg` included) is corrected from the bytes; under `checkForApacheBug`, a supplied type that is byte-for-byte one of old Apache's `text/plain` values becomes `text/plain` or `application/octet-stream` from the bytes, never a scriptable type (set it when `supplied` is an HTTP `Content-Type`); anything else (or `noSniff`) keeps the supplied type, and a supplied `text/html` is never sniffed as a feed (the specification dropped those rules). |
| `matchImage`, `matchAudioOrVideo`, `matchFont`, `matchArchive` | The §6 pattern matchers, each a `Signature`: `(bytes) => Option<string>`. Audio / video includes the MP4, WebM and MP3-without-ID3 (two consecutive Layer III frames) signatures. |
| `Signature` | Your own detector: register OOXML / ODF (zip inspection), CFB, RTF and the like through `signatures`: tried over a generic `application/zip` match and after every other standard pattern. |

### `Extension`

`DEFAULT_EXTENSIONS` is a curated table of web formats, images, audio and video, fonts, documents (PDF, RTF, EPUB, OOXML, ODF) and archives, not a mime-db copy. `mimeTypeFor(nameOrExtension, table?)`, `extensionFor(mimeType, table?)` (the preferred extension: `jpg` for `image/jpeg`) and `extend(entries, base?)` for custom entries.

### `DataUrl`

`process(url)` is Fetch's `data:` URL processor: `Option<{ mimeType, body: Uint8Array }>`, percent-decoding the body or forgiving-base64-decoding it under `;base64`, with `text/plain;charset=US-ASCII` for a missing or malformed type. `forgivingBase64Decode` is exported on its own.

## Numeric

Numeric types modelled on Rust's primitive integers and its [`num`](https://github.com/rust-num/num) crates (merged in from thomasfosterau/effect-numeric, which was never published). Rust's documented semantics are the spec. Everything is Effect-native: values are `Brand`ed, failures are `Schema.TaggedError`s carried in `Result` / `Option` (lift them with `Effect.fromResult`), every type ships a `Schema`, `Order` and `Equivalence`, value objects implement `Equal` / `Hash`, and every binary operation is dual. The barrel re-exports each integer module and `F32` as its one value (`import { U8 } from "@thomasfosterau/effect-ext"`) and the rest as namespaces; each is also its own subpath (`@thomasfosterau/effect-ext/U8`, `@thomasfosterau/effect-ext/Ratio`, …).

### Fixed-width integers

```ts
import { Effect, Option, pipe } from "effect";
import { I8 } from "@thomasfosterau/effect-ext/I8";
import { U8 } from "@thomasfosterau/effect-ext/U8";
import { U64 } from "@thomasfosterau/effect-ext/U64";

const a = U8.make(200); // U8 (throws OutOfRangeError if out of range)
const b = U8.make(100);

U8.add(a, b); // Result.fail(OverflowError) — strict
U8.checkedAdd(a, b); // Option.none()
U8.wrappingAdd(a, b); // 44
U8.saturatingAdd(a, b); // 255
U8.overflowingAdd(a, b); // [44, true]

pipe(a, U8.saturatingSub(b)); // 100 — every binary op is dual

U8.from(256); // Option.none() — Rust's TryFrom
U8.wrappingFrom(-1); // 255 — Rust's `as` between integers
U8.saturatingFrom(1e9); // 255 — Rust's `as` from a float

I8.checkedDiv(I8.MIN, I8.make(-1)); // Option.none()
I8.remEuclid(I8.make(-7), I8.make(3)); // Result.succeed(2)

U64.wrappingMul(U64.MAX, U64.MAX); // 1n
```

Strict operations return a `Result`, which lifts straight into an `Effect` with typed, tagged errors:

```ts
const program = Effect.gen(function* () {
  const total = yield* Effect.fromResult(U8.add(a, b));
  return total;
}).pipe(Effect.catchTag("OverflowError", (e) => Effect.succeed(U8.MAX)));
```

| Prefix        | On overflow / invalid input    | Returns                      |
| ------------- | ------------------------------ | ---------------------------- |
| _(none)_      | fails with a tagged error      | `Result<A, ArithmeticError>` |
| `checked`     | returns `None`                 | `Option<A>`                  |
| `wrapping`    | wraps modulo 2^bits            | `A`                          |
| `saturating`  | clamps to `MIN` / `MAX`        | `A`                          |
| `overflowing` | wraps and reports the overflow | `readonly [A, boolean]`      |

Each module also provides `pow`, shifts, `divEuclid` / `remEuclid`, `abs`, `signum`, `isqrt`, `ilog2` / `ilog10` / `ilog`, `midpoint`, `absDiff`, `isPowerOfTwo`, `checkedNextPowerOfTwo`, bit operations (`countOnes`, `leadingZeros`, `trailingZeros`, `rotateLeft`, `reverseBits`, `swapBytes`, …), byte conversions (`toBeBytes`, `fromLeBytes`, …), `parse` / `toString` in any radix, ranges, `Order`, `Equivalence`, and two schemas:

```ts
import { Schema } from "effect";

Schema.decodeSync(U8.schema)(42); // 42 as U8
Schema.decodeSync(U64.schemaFromString)("18446744073709551615"); // U64.MAX
```

Types of up to 32 bits are represented by `number`, wider types by `bigint`.

#### Custom widths

```ts
import type { Brand } from "effect";
import * as FixedInt from "@thomasfosterau/effect-ext/FixedInt";

type U4 = number & Brand.Brand<"U4">;
const U4 = FixedInt.make<U4>({ name: "U4", bits: 4, signed: false });

type I256 = bigint & Brand.Brand<"I256">;
const I256 = FixedInt.makeBig<I256>({ name: "I256", bits: 256, signed: true });
```

### Wrapping, Saturating, Checked, Overflowing

Rust's `Wrapping<T>` and `Saturating<T>` change what `+` means for a type. Here they are type class instances you pick once and then use everywhere — including in generic algorithms:

```ts
import * as Checked from "@thomasfosterau/effect-ext/Checked";
import { I8 } from "@thomasfosterau/effect-ext/I8";
import { I64 } from "@thomasfosterau/effect-ext/I64";
import * as Integer from "@thomasfosterau/effect-ext/Integer";
import * as Num from "@thomasfosterau/effect-ext/Num";
import * as Overflowing from "@thomasfosterau/effect-ext/Overflowing";
import * as Saturating from "@thomasfosterau/effect-ext/Saturating";
import { U8 } from "@thomasfosterau/effect-ext/U8";
import * as Wrapping from "@thomasfosterau/effect-ext/Wrapping";

const W = Wrapping.U8; // Integral<U8> & Signed<U8> & Bounded<U8>
W.add(U8.make(250), U8.make(10)); // 4
Num.sum(Wrapping.U8)([U8.make(200), U8.make(100)]); // 44

Saturating.I8.mul(I8.make(-100), I8.make(2)); // -128
Checked.U8.sum([U8.make(100), U8.make(200)]); // Option.none()
Overflowing.U8.add(U8.MAX, U8.one); // [0, true]

Integer.gcd(Wrapping.I64)(I64.make(-12n), I64.make(18n)); // 6n
```

### Clamped types

```ts
import * as Clamped from "@thomasfosterau/effect-ext/Clamped";

const Volume = Clamped.int({ min: 0, max: 11 });
type Volume = Clamped.ValueOf<typeof Volume>; // ClampedInt<0, 11>

Volume.make(42); // 11 — clamps
Volume.from(42); // Option.none() — validates
Volume.add(Volume.make(10), 5); // 11 — saturating arithmetic

const Hue = Clamped.make({ min: 0, max: 360 });
Hue.wrap(370); // 10
Hue.rescale(Clamped.Percentage)(Hue.make(90)); // 25

Clamped.UnitInterval.make(1.5); // 1
```

Bounds are tracked in the type, so a `Clamped<0, 1>` can't be passed where a `Clamped<0, 100>` is expected. Each clamped type has a strict `schema` and a lenient `schemaClamping`.

### Floats

```ts
import { Array } from "effect";
import { F32 } from "@thomasfosterau/effect-ext/F32";
import * as Float from "@thomasfosterau/effect-ext/Float";

Array.sort([3, NaN, -0, 0, -1], Float.F64.Order); // [-1, -0, 0, 3, NaN] — IEEE totalOrder
Float.F64.roundTiesEven(2.5); // 2
Float.F64.nextUp(1); // 1.0000000000000002

F32.add(F32.from(0.1), F32.from(0.2)); // single precision arithmetic

Float.Finite.mul(Float.Finite(1e300), Float.Finite(1e300)); // Option.none()
Float.NotNaN.option(NaN); // Option.none()
```

### Ratio and Complex

```ts
import { Equal, pipe } from "effect";
import * as Complex from "@thomasfosterau/effect-ext/Complex";
import * as Ratio from "@thomasfosterau/effect-ext/Ratio";

const third = Ratio.make(1, 3);
pipe(third, Ratio.add(Ratio.make(1, 6)), Ratio.toString); // "1/2"
Equal.equals(Ratio.make(2, 4), Ratio.make(1, 2)); // true
Ratio.approximate(Math.PI, 1000n); // Option.some(355/113)
Ratio.fromNumber(0.1); // Option.some(3602879701896397/36028797018963968), the double's exact value
Ratio.toFixed(Ratio.make(2, 3), 4); // "0.6667"

const z = Complex.make(3, 4);
Complex.abs(z); // 5
Complex.toString(Complex.mul(z, Complex.i)); // "-4+3i"
```

### Type classes and generic code

| Type class                   | Rust equivalent                       |
| ---------------------------- | ------------------------------------- |
| `Zero`, `One`, `Bounded`     | `num_traits::{Zero, One, Bounded}`    |
| `Num`, `OrderedNum`          | `num_traits::Num`                     |
| `Signed`                     | `num_traits::Signed`                  |
| `Integral`                   | `num_integer::Integer`                |
| `Fractional`                 | field operations                      |
| `Float.Float`                | `num_traits::Float`                   |
| `Checked.CheckedOps`         | `CheckedAdd`, `CheckedMul`, …         |
| `Wrapping.WrappingOps`       | `WrappingAdd`, `WrappingMul`, …       |
| `Saturating.SaturatingOps`   | `SaturatingAdd`, `SaturatingMul`, …   |
| `Overflowing.OverflowingOps` | `OverflowingAdd`, `OverflowingMul`, … |

Instances: `Num.number`, `Num.bigint`, `Wrapping.*`, `Saturating.*`, `Float.F64`, `F32`, `Ratio.Field`, `Complex.Field`. Every `FixedInt` module implements the `*Ops` type classes directly.

```ts
import * as Integer from "@thomasfosterau/effect-ext/Integer";
import * as Num from "@thomasfosterau/effect-ext/Num";
import * as Range from "@thomasfosterau/effect-ext/Range";
import * as Ratio from "@thomasfosterau/effect-ext/Ratio";

const mean =
  <A>(N: Num.Fractional<A>, fromCount: (n: number) => A) =>
  (xs: ReadonlyArray<A>) =>
    N.div(Num.sum(N)(xs), fromCount(xs.length));

mean(Ratio.Field, Ratio.fromInteger)([Ratio.make(1), Ratio.make(2)]); // 3/2

Integer.extendedGcd(Num.bigint)(240n, 46n); // { gcd: 2n, x: -9n, y: 47n }
Integer.divFloor(Num.bigint)(-7n, 2n); // -4n
Integer.isPrime(2n ** 61n - 1n); // true
Integer.modPow(4n, 13n, 497n); // 445n

Array.from(Range.rangeStep(Num.bigint)(10n, 0n, -3n)); // [10n, 7n, 4n, 1n]
```

Type class instances are total: where an operation is undefined (integer division by zero), instances throw a `DivisionByZeroError`, mirroring a Rust panic. Use the `Result` / `Option` returning functions on the concrete modules to handle those cases as values.

## Time

Parsers and printers for the strings and files time travels in (merged in from thomasfosterau/effect-time, which was never published). Each produces and consumes Effect's own values (`DateTime`, the amounts `DateTime.add` takes, `Cron`) and comes as a parser to compose, an effectful decoder, a printer and a `Schema`, with errors that point at the offending field. They are built on [`@thomasfosterau/effect-parse`](https://www.npmjs.com/package/@thomasfosterau/effect-parse), an optional peer, so these eight modules are subpaths only.

effect-time also re-exported `effect/Clock` and `effect/DateTime` unchanged; those re-exports are not carried, because Effect already provides them: import `Clock` and `DateTime` from `effect`, as the examples below do.

### `Rfc3339`

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

### `Rfc9557`

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

### `PosixTz`

```ts
import { Effect, Option } from "effect";
import * as PosixTz from "@thomasfosterau/effect-ext/PosixTz";

const program = Effect.map(PosixTz.parse("AEST-10AEDT,M10.1.0,M4.1.0/3"), (tz) => ({
  standard: tz.std.utcOffset, // 36000: ten hours east of UTC
  daylight: Option.map(tz.dst, (dst) => dst.utcOffset), // Option.some(39600)
}));
```

The grammar is POSIX.1-2017 §8.3's `std offset [dst [offset] [,start[/time],end[/time]]]`, the `TZ` environment variable format and the footer of a TZif file. A designation is three or more letters (`AEST`) or three or more letters, digits, `+` and `-` in angle brackets (`<+1030>`). POSIX writes offsets positive _west_ of Greenwich (`EST5`); a parsed `Designation` stores `utcOffset` in seconds positive _east_, as ISO 8601 and `DateTime` do. A daylight designation without an offset is one hour ahead of standard time. Rule dates are `Jn` (1–365, never counting February 29), `n` (0–365) or `Mm.w.d` (week 5 is the last), each with an optional `/time` from -167 to 167 hours (the RFC 8536 extension), defaulting to 02:00. A string with a daylight designation but no rule (`EST5EDT`) gives `rule: Option.none()`, since POSIX leaves that rule to the implementation, and the implementation-defined `:name` form is not read. `PosixTz.format` prints a `PosixTz` back, leaving out the defaults, and `PosixTz.FromString` is the `Schema` from the string.

### `CronExpression`

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

### `RRule`

```ts
import { Effect } from "effect";
import * as RRule from "@thomasfosterau/effect-ext/RRule";

const program = Effect.map(RRule.parse("FREQ=MONTHLY;BYDAY=-1FR;COUNT=6"), (rule) => rule.byDay);
// [{ ordinal: Option.some(-1), weekday: "FR" }]: the last Friday of each month
```

The grammar is RFC 5545 §3.3.10's `recur`, the value of an `RRULE` property (the text after `RRULE:`): `NAME=value` parts separated by `;`, in any order and any case, each at most once, `FREQ` required. A parsed `RRule` has `freq`, `until` and `count` (`Option`s), `interval` (default 1), the `BY…` lists (empty when absent), and `weekStart` (`WKST`, default `"MO"`). `UNTIL` is kept as written, a date or a date-time with or without `Z`, because a floating time has no instant until the rule's start gives it a zone. Every value is range-checked, and RFC 5545's cross-part restrictions fail the parse: `UNTIL` with `COUNT`, `BYDAY` ordinals outside `MONTHLY` and `YEARLY`, `BYMONTHDAY` with `WEEKLY`, `BYYEARDAY` with `DAILY`, `WEEKLY` or `MONTHLY`, `BYWEEKNO` outside `YEARLY`, and `BYSETPOS` alone. RFC 7529's `RSCALE` and `SKIP` are not read, and the rule is parsed, not expanded into occurrences. `RRule.format` prints a rule back in RFC 5545's part order, and `RRule.FromString` is the `Schema` from the string.

### `IanaTimeZone`

```ts
import { DateTime, Effect } from "effect";
import * as IanaTimeZone from "@thomasfosterau/effect-ext/IanaTimeZone";

const program = Effect.map(IanaTimeZone.parse("Asia/Tokyo"), (zone) =>
  DateTime.setZone(DateTime.makeUnsafe("2026-10-22T00:00:00Z"), zone),
);

IanaTimeZone.isKnown("Mars/Olympus_Mons"); // false
```

A name is read with the tz database's naming rules (`/`-separated components of 1–14 letters, digits, `.`, `_`, `-` and `+`) and then checked against the time zones the JavaScript runtime knows. Nothing is bundled: the answer comes from the runtime's ICU build, through `Intl.DateTimeFormat`, so it depends on that runtime and its tz data version. Aliases (`US/Eastern`), `UTC`, `Etc/GMT±n` and any letter case are accepted, and the result is the runtime's `DateTime.TimeZone.Named`, whose `id` is the runtime's canonical spelling. That spelling can differ between runtimes (`Asia/Kolkata` or `Asia/Calcutta`). `IanaTimeZone.supported()` is `Intl.supportedValuesOf("timeZone")`, the runtime's list of canonical names, for offering a choice. It is not the set of valid names, because V8 leaves `UTC`, `Etc/GMT±n` and every alias out of it. `IanaTimeZone.FromString` is the `Schema` from the name; it encodes the canonical `id`.

### `Tzif`

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

### `IsoDuration`

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

## AI service abstractions

These modules were `@thomasfosterau/effect-ai-ext` (0.5.1, now deprecated): the move is an import change, `@thomasfosterau/effect-ai-ext/<Module>` → `@thomasfosterau/effect-ext/<Module>`. Each service's `Context` key moves with it (`@thomasfosterau/effect-ai-ext/RerankerModel` becomes `@thomasfosterau/effect-ext/RerankerModel`), so a layer built against the old package does not provide the new service.

Provider-neutral AI service **abstractions** that upstream Effect (`effect/ai`) does not yet ship. `effect/ai` gives you `LanguageModel`, `EmbeddingModel`, `Tokenizer`, `Tool`/`Toolkit`, `Chat`, `Prompt`/`Response`, `Model`, `AiError`, and `Telemetry` — and nothing for reranking, classification, speech, transcription, image generation, moderation, or voice conversion.

These modules fill that gap in upstream's own idiom. Every module is written **as if it could merge into `effect/ai` itself** — the same shape as `EmbeddingModel`:

- a `Context.Service` tag (`@thomasfosterau/effect-ext/<Module>`),
- `Schema.Class` response/usage models,
- caller `Options` vs normalised `ProviderOptions`/`ProviderResponse` contracts,
- a `Service` interface whose operations fail only through `AiError`,
- a `make(...)` constructor that **validates** provider results before handing them back, wrapping each operation in `Effect.withSpan`.

No provider code, no HTTP — abstractions only. First-party provider packages (Cohere, Voyage, ElevenLabs, …) implement these services the same way `effect-ai-mistral` implements `LanguageModel`.

### Not a superset of `effect/ai`

`@thomasfosterau/effect-ai-ext`'s barrel re-exported every upstream `effect/ai` module beside the abstractions. The `@thomasfosterau/effect-ext` barrel does not: import upstream modules (`LanguageModel`, `EmbeddingModel`, `AiError`, …) from `effect/ai`, and the abstractions from here.

### Modules

Each module is also available as a per-module subpath (mirroring how `effect` itself ships), e.g. `@thomasfosterau/effect-ext/RerankerModel`, and a namespace on the root barrel. Every module exports the same set of names: the service tag (`RerankerModel.RerankerModel`, …), its `Service` interface, the caller options, the normalised `ProviderOptions` / `ProviderResponse` a provider implements, the `Schema.Class` response and usage models, and `make`.

| Module | Operation(s) | Caller options | Response | `make` validates |
| --- | --- | --- | --- | --- |
| `RerankerModel` | `rerank` | `RerankOptions`: `query`, `documents`, `topN?` | `RerankResponse`: `results` (`RerankedDocument`: `index`, `relevanceScore`), sorted by descending score; `usage.inputTokens` | every `index` names an input document, indices are unique, count ≤ `topN` (or the document count); no documents → empty response, provider not called |
| `ClassifierModel` | `classify` | `ClassifyOptions`: `inputs`, `labels?`, `multiLabel?`, `examples?` (`ClassifyExample`: `text`, `label`) | `ClassifyResponse`: one `Classification` (`classes`: `ClassScore` `label` / `score`) per input; `usage.inputTokens` | one classification per input, finite scores, labels within `labels` when given; no inputs → empty response |
| `SpeechModel` | `generate`, `stream` | `SpeechOptions`: `text`, `voice?`, `format?`, `sampleRate?` | `SpeechResponse`: `audio` (`Uint8Array`), `mediaType`, `usage.inputCharacters`; `stream` yields `Uint8Array` chunks | non-empty audio (`generate`); `stream` passes through, traced |
| `TranscriptionModel` | `transcribe` | `TranscriptionOptions`: `audio` (`Uint8Array` or `Stream<Uint8Array>`), `mediaType?`, `language?` | `TranscriptionResponse`: `text`, `segments?` (`TranscriptionSegment`: `text`, `start`, `end`), `language?`, `usage.durationSeconds` | segment timestamps finite with `end >= start` |
| `ImageModel` | `generate` | `ImageOptions`: `prompt`, `size?`, `format?`, `count?` | `ImageResponse`: `images` (`ImagePart`: `data` as bytes or base64 string, `mediaType`), `usage.inputTokens` | at least one image, at most `count` |
| `ModerationModel` | `moderate` | `ModerationOptions`: `inputs` (each a string, or an array of `effect/ai` `Prompt.UserMessagePartEncoded` text / file parts screened as one input) | `ModerationResponse`: one `ModerationResult` (`isFlagged`, `categories`: category → score, `flags?`: the provider's category → fired) per input; `modelId?` (the model that served the call); `usage.inputTokens` | one result per input, scores finite in `[0, 1]`; no inputs → empty response; an empty part list → `InvalidUserInputError` |
| `VoiceConversionModel` | `convert` | `VoiceConversionOptions`: `audio` (`Uint8Array` or `Stream<Uint8Array>`), `targetVoice`, `format?` | `VoiceConversionResponse`: `audio`, `mediaType`, `usage.durationSeconds` | non-empty audio |

A result that fails validation fails the call with an `AiError` whose reason is `InvalidOutputError`. Every operation is wrapped in `Effect.withSpan("<Module>.<operation>")`.

`ClassifierModel` and `ModerationModel` additionally export `fromLanguageModel`, an `Effect<Service, never, LanguageModel>` that backs the abstraction with **any** `LanguageModel` via structured-output prompting (`LanguageModel.generateObject`), running the model's output back through the same `make` validation path.

Were they to merge upstream, each module would become `effect/ai/<Module>`, the sibling of `EmbeddingModel`.

### Example

```ts
import { Effect } from "effect";
import { RerankerModel } from "@thomasfosterau/effect-ext";

// Consumers depend on the tag; a provider layer supplies it.
const program = Effect.gen(function* () {
  const reranker = yield* RerankerModel.RerankerModel;
  const response = yield* reranker.rerank({
    query: "best editor",
    documents: ["vim", "emacs", "nano"],
    topN: 2,
  });
  return response.results; // sorted by descending relevanceScore
});
```

Implementing the service in a provider: `make` takes the provider hook and returns the validated service.

```ts
import { Effect, Layer } from "effect";
import * as RerankerModel from "@thomasfosterau/effect-ext/RerankerModel";

const KeywordReranker = Layer.effect(
  RerankerModel.RerankerModel,
  RerankerModel.make({
    rerank: ({ query, documents }) =>
      Effect.succeed({
        results: documents.map((document, index) => ({
          index,
          relevanceScore: document.includes(query) ? 1 : 0,
        })),
        usage: { inputTokens: undefined },
      }),
  }),
);
```

Backing a classifier with a language model:

```ts
import { Effect, Layer } from "effect";
import { LanguageModel } from "effect/ai";
import { ClassifierModel } from "@thomasfosterau/effect-ext";

declare const SomeLanguageModelLayer: Layer.Layer<LanguageModel.LanguageModel>;

const ClassifierLayer = Layer.effect(
  ClassifierModel.ClassifierModel,
  ClassifierModel.fromLanguageModel,
).pipe(Layer.provide(SomeLanguageModelLayer));
```

### `RerankerModel` moved

`RerankerModel` previously lived in `@thomasfosterau/effect-ai-gateway` (since renamed `@thomasfosterau/effect-ai-cloudflare`) — a reranker abstraction never belonged in a routing package. It lives here now: import it from `@thomasfosterau/effect-ext/RerankerModel` (it was `@thomasfosterau/effect-ai-ext/RerankerModel` until the two packages merged). The gateway kept a deprecated re-export through 0.4.x and removed it in 0.5.0, and `@thomasfosterau/effect-ai-cloudflare` exports no `RerankerModel` name; its Cohere reranker (`makeCohereReranker`) returns this module's `Service`.

## Evals

These modules were `@thomasfosterau/effect-evals` (0.5.1, now deprecated). Its barrel is now `@thomasfosterau/effect-ext/evals` (`import { Runner, Ranking } from "@thomasfosterau/effect-ext/evals"`), each module is also its own subpath (`@thomasfosterau/effect-ext/evals/Runner`, `…/evals/metrics/Ranking`, `…/evals/scorers/ExactMatch`), and the `effect-evals` bin ships with `@thomasfosterau/effect-ext`. They sit under `./evals` rather than at the top level because several of their names (`Result`, `Cache`, `Metric`, `Score`, `Runner`) are generic, and three are Effect's own module names: a root-barrel `Result` beside `effect`'s would invite the wrong import.

Effect-native LLM evaluation: goldens, scorers, thresholds, and a runner with trials, bounded concurrency, retry, and caching — expressed as plain Effect values instead of a bolted-on async framework. The core (the `./evals` barrel and its modules) depends on `effect` only.

#### Requirements

The CLI requires Node `>=22.18` (the library itself needs only Node 22, its `engines.node` floor; the bin checks the version at start-up and exits with a message below 22.18): it loads `*.eval.ts` files with Node's type stripping, on by default from 22.18.0, and its resolution hook uses `module.registerHooks()` (22.15+). `effect` (`^4.0.0`) is a peer dependency. The package also ships the `effect-evals` CLI for discovering and running `*.eval.ts` suites — see [CLI](#cli) below. The CLI additionally needs the **optional** peer `@effect/platform-node` (`^4.0.0`): install it at the same version as `effect`, and pin `@effect/platform-node-shared` to that version too (a direct dependency or an `overrides` entry). Upstream's `^` range otherwise floats it to the newest rc, whose own `effect` peer rejects an older `effect`.

```sh
pnpm add @effect/platform-node@<your effect version> @effect/platform-node-shared@<your effect version>
```

### Core model

- **`Golden` / `ConversationalGolden`** — the static, hand-authored description of one case: an input, an optional expected output, and whatever context a scorer needs to judge a run.
- **`EvalCase`** — a golden enriched with the actuals a run produced (`output`, `retrievedContext`, `toolCalls`, `usage`). Scorers read an `EvalCase`, never a bare `Golden` (DeepEval's golden/test-case split).
- **`Score`** — a scorer's `0..1` verdict, plus an optional `reason` and free-form `metadata`.
- **`Scorer`** — a named, Effect-returning function from an `EvalCase` to a `Score`. Judge/embedding dependencies live in `R`; failures are typed in `E`. `Scorer.contramap(scorer, from)` adapts a scorer built for one case shape to a differently-shaped case, reusing its name/`E`/`R` unchanged — exactly the variance `Scorer`'s `Case` type parameter is already declared with (`in Case`).
- **`Threshold` / `Metric`** — the pass/fail policy (`minScore` / `maxScore` / `strict`) and the `{ name, scorer, threshold }` unit a runner executes. `Metric.contramap(metric, from)` is `Scorer.contramap`'s counterpart for a metric (scorer + threshold together) — reuse a package metric like `GEval.gEval` or `EmbeddingSimilarity.embeddingSimilarity` against a case shape it wasn't written for.
- **`Dataset`** — a named, effectfully-produced source of goldens.

### Runner

`Runner.runSuite` is the Effect program every execution surface sits on:

```ts
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { NodeFileSystem } from "@effect/platform-node";
import {
  Cache,
  Dataset,
  Metric,
  Reporter,
  Runner,
  Scorer,
  Threshold,
} from "@thomasfosterau/effect-ext/evals";

// The system under test: any Effect from a golden's input to an output.
declare const translate: (source: string) => Effect.Effect<string>;

const suite = Runner.makeSuite({
  name: "translation-quality",
  dataset: Dataset.fromArray("greetings", [{ input: "Bonjour", expected: "Hello" }]),
  task: Runner.makeTask({
    id: "translate@v1",
    run: (golden: { readonly input: string; readonly expected: string }) => translate(golden.input),
  }),
  metrics: [
    Metric.makeMetric({
      name: "exact-match",
      scorer: Scorer.makeScorer({
        name: "exact-match",
        evaluate: (evalCase: {
          readonly golden: { readonly expected: string };
          readonly output: string;
        }) => Effect.succeed({ score: evalCase.golden.expected === evalCase.output ? 1 : 0 }),
      }),
      threshold: Threshold.strict,
    }),
  ],
});

// `Reporter.json` writes through `FileSystem`; `Cache.layerMemory` keeps the cache in memory.
const program = Runner.runSuite(suite, {
  trials: 3,
  reporters: [Reporter.terminal, Reporter.json("./results.json")],
}).pipe(Effect.provide(Layer.mergeAll(Cache.layerMemory, NodeFileSystem.layer)));
```

- **Heterogeneous `metrics`.** `makeSuite`'s `metrics` array can freely mix metrics with different `E`/`R` — a G-Eval judge (`GEvalError`/`LanguageModel`) alongside an `embeddingSimilarity` metric (`AiError`/`EmbeddingModel`), say — with no explicit array type annotation at the call site: the `metrics` array literal is inferred as a literal tuple (a `const` type parameter) and `MetricE`/`MetricR` are unioned across its elements, rather than fixed from the first one.
- **Concurrency** is bounded independently at the case level (`caseConcurrency`, default `5`) and the metric level (`metricConcurrency`, default `5`) via `Effect.forEach({ concurrency })`.
- **Trials**: each case runs `trials` times (default `1`) end to end — task and every metric. A metric's aggregate reports `mean`/`variance`/`stddev`/`min`/`max` across its trials, with every per-trial score kept so flakiness is visible; pass/fail applies the metric's `Threshold` to the mean.
- **Retries**: the task and each metric evaluation are retried independently (`taskRetrySchedule` / `metricRetrySchedule`, default a jittered exponential backoff capped at 3 attempts) — but only when the failure is an `AiError` (`effect/ai`) with `isRetryable`. Any other failure, or a non-retryable `AiError`, surfaces immediately as a typed trial error.
- **Errors vs failing scores**: a metric whose Effect fails is recorded as `Errored`, distinct from a `Scored` result that simply misses its threshold. `ignoreErrors` (default `false`) controls whether an error excludes that trial from the metric's aggregate (and doesn't affect pass/fail) or forces the metric — and the case — to fail. This mirrors DeepEval's `ignore_errors`.
- **Caching** (`evals/Cache`) is content-hash keyed (a full SHA-256 digest, via `crypto.subtle`) on the golden, the task's `id`, the metric name, `judgeModelId`, and the trial number, stored behind `effect`'s own `KeyValueStore` (`effect/persistence`). A cache hit skips both the task call and the metric's judge call for that trial. `Cache.layerMemory` is a zero-dependency in-memory store (tests, or runs with no persistence); `Cache.layerFileSystem(directory)` persists under a directory (default `Cache.defaultDirectory`, `.effect-evals/cache/`, gitignored) and requires `FileSystem`/`Path` in scope — provided by the caller (the CLI provides them), never bundled into the core. `bypassCache: true` skips cache reads and writes entirely. Invalidation is **manual, by identifier** — a task's `run` closure and a metric's `scorer`/`threshold` aren't hashed (they're code, not data), so bump `task.id` (e.g. `"translate@v1"` → `"translate@v2"`) or a metric's name/`judgeModelId` after changing its behavior, the same convention a cache-busting query string uses.

### Reporters

`Reporter` is a named sink for a completed `Result.SuiteResult`; a reporter never fails the run — `terminal` and `json` both catch their own errors and log a warning instead.

- **`Reporter.terminal`** — a plain-text table to stdout: one row per case per metric (`pass/fail`, mean/spread, the last reason).
- **`Reporter.json(path)`** — the full result model as JSON, written via `effect`'s `FileSystem` service (so it's testable with `FileSystem.layerNoop`, no real disk needed).

#### JSON schema

```json
{
  "suite": "string",
  "passed": true,
  "durationMillis": 1234,
  "cases": [
    {
      "golden": "<the golden, as-is>",
      "trials": 3,
      "passed": true,
      "taskOutputs": [
        { "trial": 1, "output": "<the task's output>", "durationMillis": 412, "cached": false }
      ],
      "taskFailures": [{ "trial": 2, "error": "<the task's typed error>" }],
      "metrics": [
        {
          "metric": "exact-match",
          "passed": true,
          "errorCount": 0,
          "summary": { "mean": 0.8, "variance": 0.01, "stddev": 0.1, "min": 0.7, "max": 0.9 },
          "trials": [
            {
              "_tag": "Scored",
              "trial": 1,
              "cached": false,
              "score": { "score": 0.8, "reason": "..." }
            },
            {
              "_tag": "Errored",
              "trial": 2,
              "cached": false,
              "error": "<the metric's typed error>"
            }
          ]
        }
      ]
    }
  ]
}
```

`summary` is `null` when every trial for that metric errored (no scores to summarize). `taskOutputs` holds, per trial whose task produced an output, that output and the task's wall-clock duration (retries included); a trial served from the cache is `cached: true` with a `durationMillis` of `0`, so leave it out of a latency figure. `taskFailures` is empty unless the task itself failed for some trial, in which case that trial contributes to no metric's `trials` array at all (there was no output to score).

### Retrieval ranking metrics

`Ranking` scores a **ranked list of document handles** against a **graded relevance map** — nDCG@k, recall@k, MRR@k and precision@k — as deterministic, judge-free scorers. Grades are positive numbers (`1`–`3` by convention: `3` is the answer, `2` would satisfy, `1` is better than nothing); a handle absent from the map is non-relevant. nDCG uses exponential gain (`2^grade − 1`) and normalises against the case's own relevant set, so a case with two relevant documents and `k = 20` can still score 1; precision divides by `k`, not by how many rows came back; MRR and recall are bounded by the page. Every scorer re-applies `k` itself, and its name carries the cutoff (`ndcg@10`, never `ndcg`) because `ndcg@10` and `ndcg@20` are different measurements.

```ts
import { Ranking, Threshold } from "@thomasfosterau/effect-ext/evals";

// The pure functions, over { ranked, relevant, k }:
Ranking.ndcg({ ranked: ["b", "a"], relevant: { a: 3, b: 1 }, k: 5 }); // 0.7098…
Ranking.scoreCase({ ranked: ["b", "a"], relevant: { a: 3, b: 1 }, k: 10 }); // { "ndcg@10": …, "recall@10": …, "mrr@10": …, "precision@10": … }

// As Scorers / Metrics over a RankingCase ({ golden: { relevant }, output: ranked }):
Ranking.ndcgAtK(10); // Scorer named "ndcg@10"
Ranking.metricsAtK(10, { thresholds: { ndcg: Threshold.minScore(0.8) } }); // all four, one gated
```

#### `Runner.runRetrievalSuite`

The retrieval counterpart of `runSuite`: a dataset of `RetrievalGolden`s (`{ query, relevant, name? }`, or a richer golden extending it), a one-method `RetrievalPort` the consumer supplies, and a cutoff `k`. The port is the seam — the thing being measured (a search operation, a reranker chain) lives in the consumer, the suite hands it each query, the page size and the case's golden, and reads back handles best-first. That is also what makes an offline mode the same code path as a credentialed one: a unit suite hands in an in-memory port over fixed orderings, an operator hands in one closing over a live search, and the runner cannot tell.

```ts
import * as Effect from "effect/Effect";
import { Cache, Dataset, Reporter, Runner, Threshold } from "@thomasfosterau/effect-ext/evals";

// The consumer's search operation, returning document handles best first.
declare const search: (options: {
  readonly query: string;
  readonly limit: number;
  readonly locale: string | undefined;
}) => Effect.Effect<ReadonlyArray<{ readonly id: string }>, Error>;

// A golden may carry per-case narrowing; the port receives the whole golden.
interface SearchGolden extends Runner.RetrievalGolden {
  readonly locale?: string | undefined;
}

const port: Runner.RetrievalPort<Error, never, SearchGolden> = {
  id: "search@rerank-v3.5", // the configuration under test; part of the cache key
  retrieve: (query, { limit, golden }) =>
    search({ query, limit, locale: golden.locale }).pipe(
      Effect.map((rows) => rows.map((row) => row.id)),
    ),
};

const program = Runner.runRetrievalSuite(
  {
    name: "search-ranking-smoke",
    dataset: Dataset.fromArray<SearchGolden>("search-ranking-smoke", [
      {
        name: "interruption",
        query: "how do I interrupt a fiber",
        relevant: { "doc:interruption": 3, "doc:fibers": 1 },
      },
    ]),
    port,
    k: 20,
    metrics: { thresholds: { ndcg: Threshold.minScore(0.8) } }, // optional; all four metrics, never failing, by default
  },
  { reporters: [Reporter.terminal] },
).pipe(Effect.provide(Cache.layerMemory));

// result.aggregate.metrics["ndcg@20"] — { mean, cases } across the queries that scored
// result.cases[0]?.metrics — the ordinary per-case, per-metric result model
// result.cases[0]?.taskOutputs[0] — { output: the ranked page, durationMillis, cached }
```

- **Built on `runSuite`**, so trials, retry on retryable `AiError`s, caching (keyed on the port's `id` and `k` — bump `id` when the port's behaviour changes) and reporters all apply, and the result is the ordinary `Result.SuiteResult` plus `aggregate: Result.aggregate(result)` — per-metric means across the queries that scored, with `totalCases` / `successfulCases` / `failedCases`.
- **A failed query is not a zero.** A retrieval failure lands in that case's `taskFailures`, is excluded from every mean, and is counted in `aggregate.failedCases`; a suite in which every query failed has an empty `aggregate.metrics` and `passed: false`, never a page of noughts.
- **Sequential by default** (`caseConcurrency: 1`): a retrieval suite usually runs against a live search plane, and measuring it under a load pattern no user produces makes any latency the port records meaningless. Pass `caseConcurrency` to change it.
- **Over-returning ports are truncated** to `k` before scoring, and every metric re-applies `k` — a retrieval that returns more than it was asked for cannot inflate recall.
- **Per-case narrowing reaches the port.** `retrieve` receives the case's golden beside its query, so a type filter or locale on the golden needs no lookup keyed on the query string; the cache key hashes the whole golden, so two cases that share a query but differ in narrowing never share a cached page.
- **Each case keeps its ranked page and latency.** `taskOutputs` holds, per trial, the page the port returned (truncated to `k`), how long the retrieval took, and whether it came from the cache.
- **What stays with the consumer:** dataset validation and content digests (which runs are comparable), persistence, and the run-to-run diff. `Result.aggregate` and `Result.SuiteResult` are plain values a consumer can persist or diff as it likes.

### G-Eval judge metric

`GEval.gEval` builds a `Metric` that scores a case against an arbitrary natural-language criterion using an LLM judge (DeepEval's G-Eval), covering anything from translation quality to a bespoke house style — without writing a new metric per criterion. `GEval.gEvalConversational` is the multi-turn variant: the judge reads the full rendered turn history and scores the exchange holistically.

```ts
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { LanguageModel } from "effect/ai";
import { EvalCase, GEval, Golden, Metric, Threshold } from "@thomasfosterau/effect-ext/evals";

const TranslationGolden = Golden.Golden(Schema.String, Schema.String);
const TranslationCase = EvalCase.EvalCase(TranslationGolden, Schema.String);

const translationQuality = GEval.gEval<typeof TranslationCase.Type>({
  name: "translation-quality",
  criteria: "Is this a faithful, fluent translation of the source?",
  evaluationParams: ["input", "output"],
  threshold: Threshold.minScore(0.7),
});

// The judge LanguageModel is provided the same way any other service is —
// Effect.provide at the call site, swappable per metric or per environment.
declare const judgeLayer: Layer.Layer<LanguageModel.LanguageModel>;
const evalCase: typeof TranslationCase.Type = {
  golden: { input: "Bonjour", expected: "Hello" },
  output: "Hello",
};

const program = Metric.evaluate(translationQuality, evalCase).pipe(Effect.provide(judgeLayer));
```

`gEval` accepts `criteria` **or** `evaluationSteps`, never both:

- `criteria` — a natural-language description; the judge derives its own evaluation steps per run (convenient) and reports them back, so the steps actually used still land in `Score.metadata.evaluationSteps` even though they weren't authored ahead of time.
- `evaluationSteps` — an explicit, ordered list you write yourself. No derivation call: the judge is told exactly what to check.

`evaluationParams` names which fields of the case the judge is shown (`"input" | "output" | "expected" | "context" | "retrievedContext"`); asking for a field a given case doesn't have fails with the typed `GEval.MissingEvaluationParamError` rather than throwing or silently skipping it. `GEval.gEvalConversational` takes the same `criteria`/`evaluationSteps` shape over `"scenario" | "expectedOutcome" | "context"` (the turn history itself is always shown).

An optional `rubric` (`GEval.makeRubric`) constrains the judge to non-overlapping score bands on whatever scale you write them in (DeepEval's convention is `0..10`); `gEval` clamps the judge's raw score to the rubric's range and normalises it to `Score`'s `0..1`. An overlapping or malformed rubric (or a definition with both or neither of `criteria` and `evaluationSteps`) throws a `GEval.InvalidGEvalDefinitionError` immediately at construction — it's a mistake in the metric definition, not a per-case condition.

`template` overrides the judge's system/user prompt wording (see `GEval.defaultTemplate`) without forking the metric.

#### Determinism levers

An LLM judge is inherently noisy; DeepEval and this package both lean on the same three levers rather than log-prob weighting (`generateObject` doesn't expose token log-probabilities, so that avenue is closed regardless):

1. **Explicit `evaluationSteps`.** Skips the criteria-to-steps derivation call, so every run judges against literally the same instructions instead of a fresh (and possibly inconsistent) derivation each time.
2. **A `rubric`.** Non-overlapping bands with descriptions narrow the judge's scoring range to discrete, justified buckets instead of an unconstrained continuous guess.
3. **Trials.** Running a metric several times per case and aggregating (mean/variance, flakiness surfacing) is the runner's job (above), not this metric — `gEval` and `gEvalConversational` score a single run; the runner is what repeats that run and aggregates the results.

Combine all three for the most reproducible signal: explicit steps and a rubric pin down _what_ is being judged, and trials reveal _how consistently_ the judge applies them.

### CLI

The `effect-evals` bin discovers and runs `*.eval.ts` suites standalone — no test framework involved. It's the surface CI invokes. An `*.eval.ts` file default-exports the `EvalFile` contract ([`EvalFile`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/EvalFile.ts)) — the plain `{ suites, layer, options? }` object — which the CLI dynamically `import()`s. Credential gating applies: a file whose `layer` fails to build with a `Config.ConfigError` is skipped, not failed, so an eval file referencing a real provider is safe to leave in the tree in a credential-less checkout.

```sh
# Anywhere in a workspace that has @thomasfosterau/effect-ext installed:
pnpm effect-evals run                                    # default glob: **/evals/**/*.eval.ts
pnpm effect-evals run packages/my-pkg/evals                # explicit glob(s)
pnpm effect-evals run --trials 3 --filter translation     # flags before positional globs
pnpm effect-evals run --reporter terminal                 # terminal only (default: both terminal and json)
pnpm effect-evals run --force --out ./tmp/results.json    # bypass the cache, write elsewhere
pnpm effect-evals --help                                  # full flag reference
```

| Flag | Effect |
| --- | --- |
| `[globs...]` (positional) | Glob patterns to match `*.eval.ts` files. Default: `**/evals/**/*.eval.ts` from cwd. |
| `--trials <n>` | Overrides every matched suite's `trials` (and the eval file's own `options.trials`). |
| `--concurrency <n>` | Overrides both `caseConcurrency` and `metricConcurrency`. |
| `--force` | Bypasses the result cache for this run. |
| `--reporter json\|terminal` | Repeatable. Which reporter(s) to produce; both run when omitted. |
| `--filter <substring>` | Only runs suites whose name contains this substring. |
| `--out <path>` | Where the JSON reporter writes its combined report. Default `.effect-evals/results.json`. |

**Exit code** is non-zero iff any _executed_ suite misses its threshold — a suite skipped for missing credentials never fails the run, but is listed in both the terminal output (a `SKIP` line) and the JSON report's `skipped` array.

**Loading strategy.** Eval files are plain TypeScript, loaded via Node's own dynamic `import()` (type stripping is on by default from Node 22.18; eval files must be erasable-syntax-only) plus this package's own extensionless-import resolution hook ([`src/evals/cli/loader.mjs`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/cli/loader.mjs), installed in-thread with `module.registerHooks()`) — never tsx and never `NODE_OPTIONS`, because the Node flags must be literal argv on the one `node` hop. `bin/effect-evals.js` is a small, flagless launcher that re-execs `node` with those flags as literal argv pointed at the built CLI, `dist/evals/cli/main.js` (Node refuses to type-strip under `node_modules`, so only your own `*.eval.ts` files are type-stripped, never the package) — the only hop, so no intermediate launcher can drop them.

### What's in the box

| Module | Purpose |
| --- | --- |
| [`Golden`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Golden.ts) | `Golden` / `ConversationalGolden` — the static case shape. |
| [`EvalCase`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/EvalCase.ts) | `EvalCase` — a golden enriched with run actuals; `ToolCall` / `Usage`. |
| [`Score`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Score.ts) | `Score` — a scorer's `0..1` verdict + reason + metadata. |
| [`Scorer`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Scorer.ts) | `Scorer`, `makeScorer`, `contramap`. |
| [`Threshold`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Threshold.ts) | `minScore` / `maxScore` / `strict`, `passes`, `describe`. |
| [`Metric`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Metric.ts) | `Metric`, `makeMetric`, `evaluate`, `contramap`; `MetricResult`. |
| [`Dataset`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Dataset.ts) | `Dataset`, `makeDataset`, `fromArray`. |
| [`EvalFile`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/EvalFile.ts) | The `*.eval.ts` contract shared by every execution surface: `EvalFile`, `AnySuite`. |
| [`Runner`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Runner.ts) | `Suite`, `makeSuite`, `TaskDefinition`, `makeTask`, `runSuite`, `RunnerOptions`; `RetrievalPort`, `RetrievalGolden`, `RetrievalSuite`, `runRetrievalSuite`; `isConfigError` (the credential-gating test). |
| [`Result`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Result.ts) | The typed suite → case → trial → metric result model; `summarize`, `aggregate`, `lastReason`, `formatSpread`. |
| [`Cache`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Cache.ts) | `layerMemory` / `layerFileSystem`, `hashKey`. |
| [`Reporter`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Reporter.ts) | `Reporter`, `makeReporter`, `terminal`, `json`, `formatTerminalTable`. |
| [`Ranking`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/metrics/Ranking.ts) | `ndcg` / `recall` / `mrr` / `precision`, `scoreCase`, `metricKey`; `ndcgAtK` / `recallAtK` / `mrrAtK` / `precisionAtK` (or `scorerAtK`) as scorers, `metricAtK` / `metricsAtK`. |
| [`GEval`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/metrics/GEval.ts) | `gEval`, `gEvalConversational`, `makeRubric`, `defaultTemplate`, `judge`, `renderValue` / `renderTurns`; `MissingEvaluationParamError`, `InvalidGEvalDefinitionError`. |
| [`RagCase`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/metrics/rag/RagCase.ts) | `RagCase` — the case shape the RAG metrics read (`input`, `output`, `expected`, `retrievedContext`); `require…` field lookups, `renderContext`. |
| [`ExtractThenClassify`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/metrics/rag/ExtractThenClassify.ts) | The extract → classify → ratio judge primitive the RAG metrics share: `extractStatements`, `classifyStatements`, `extractThenClassifyRatio`, `summarizeVerdicts`, `ratioScore`; `VerdictCountMismatchError`. |
| [`Faithfulness`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/metrics/rag/Faithfulness.ts) / [`AnswerRelevancy`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/metrics/rag/AnswerRelevancy.ts) / [`ContextualPrecision`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/metrics/rag/ContextualPrecision.ts) / [`ContextualRecall`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/metrics/rag/ContextualRecall.ts) / [`ContextualRelevancy`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/metrics/rag/ContextualRelevancy.ts) | Judge-based RAG metrics over `RagCase`: `faithfulness`, `answerRelevancy`, `contextualPrecision` (and its `weightedCumulativePrecision`), `contextualRecall`, `contextualRelevancy`. |
| [`ExactMatch`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/scorers/ExactMatch.ts) / [`Levenshtein`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/scorers/Levenshtein.ts) / [`JsonValidity`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/scorers/JsonValidity.ts) / [`SchemaMatch`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/scorers/SchemaMatch.ts) | Deterministic scorers: `exactMatch` / `normalizedMatch`, `levenshtein` / `levenshteinSimilarity`, `jsonValidity`, `schemaMatch` / `schemaMatchValue`. |
| [`ToolCallCorrectness`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/scorers/ToolCallCorrectness.ts) | `toolCallCorrectness` — a case's actual tool calls against its golden's `expectedTools`. |
| [`EmbeddingSimilarity`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/scorers/EmbeddingSimilarity.ts) | `embeddingSimilarity` — cosine similarity of `output` and `expected` through the ambient `EmbeddingModel`. |
| [`Metadata`](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/src/evals/Metadata.ts) | `Metadata` — the free-form record a golden, scorer or score carries. |
| [`cli`](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ext/src/evals/cli) | The `effect-evals` bin — see [CLI](#cli) above. |

## License

MIT
