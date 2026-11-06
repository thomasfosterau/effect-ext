# @thomasfosterau/effect-utilities

Extensions to the [Effect](https://effect.website) standard library, in two families:

- **Binary data** — an `Allocator` service, binary `Layout`s, `BufferStruct`s, `Vec`, `StructOfArrays`, and Rust-style UTF-8 `String` / `Str`.
- **Schema** — URLs whose scheme, host, port, credentials and path are part of their type, the update tri-state reader, Schema issue → RFC 6901 JSON Pointer walk, bounded pagination and id-list codecs, branded UUID ids and slugs, exact literal-union tuples, and AST / decode-probe introspection. No JSON:API, Drizzle or application vocabulary: the prefixes, caps and reserved words an application needs are parameters, never defaults.

> **Status:** experimental. APIs may change between minor versions until 1.0.

## Install

```sh
pnpm add @thomasfosterau/effect-utilities effect
```

Peer: `effect` `>=4.0.0`. Node.js 22 or later (the binary-data modules use `ArrayBuffer.prototype.transfer`). ESM only, `"sideEffects": false`; every module is also its own entry point:

```ts
import { Vec, TriState } from "@thomasfosterau/effect-utilities";
// or
import * as Vec from "@thomasfosterau/effect-utilities/Vec";
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

## Allocator

`Allocator.Allocator` is a `Context.Reference`, so it never needs to be provided — it defaults to the heap allocator (one `ArrayBuffer` per block). Swap it out for a whole program or a single region:

```ts
import { Effect } from "effect";
import { Allocator, Layout, Vec } from "@thomasfosterau/effect-utilities";

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
import { BufferStruct, Layout } from "@thomasfosterau/effect-utilities";

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
import { Layout, Vec } from "@thomasfosterau/effect-utilities";

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
import { Layout, StructOfArrays } from "@thomasfosterau/effect-utilities";

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
import { Str, String } from "@thomasfosterau/effect-utilities";

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
import { TriState } from "@thomasfosterau/effect-utilities";

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
- `Issues.leaves(issue)` — a `SchemaIssue` tree flattened to `{ path, issue }` leaves: `Pointer` extends the path, `Composite` and a non-empty `AnyOf` fan out, `Filter` / `Encoding` unwrap, anything else (and an empty `AnyOf`) is a leaf.
- `Issues.pointers(issue, { prefix })` — each leaf as `{ pointer, tag, message, issue }`. `message` is Effect's default formatting; a built-in check's failure (`isMinLength(3)`) keeps its expectation ("Expected a value with a length of at least 3").

```ts
import { Effect, Option, Schema } from "effect";
import { Issues } from "@thomasfosterau/effect-utilities";

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
import { Bounded } from "@thomasfosterau/effect-utilities";

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
import { LiteralExact } from "@thomasfosterau/effect-utilities";

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
import { Url } from "@thomasfosterau/effect-utilities";

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

## License

MIT
