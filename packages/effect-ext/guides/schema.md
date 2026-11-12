# Schema

URLs whose scheme, host, port, credentials and path are part of their type, the update tri-state reader, Schema issue to RFC 6901 JSON Pointer walk, bounded pagination and id-list codecs, branded UUID ids and slugs, exact literal-union tuples, and AST / decode-probe introspection. No JSON:API, Drizzle or application vocabulary: the prefixes, caps and reserved words an application needs are parameters, never defaults. `OptionalKey` (optional keys under `exactOptionalPropertyTypes`) is here too.

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

- `TriState.suppliedValue(field?: Option<A>): Option<A>` — the `Option` encoding.
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
- `presentFields(input)` — like `fields`, but drops `null` too, for the row-to-resource boundary (a nullable column becomes an optional key). Its type, `Present<T>`, makes each member that admits `null` or `undefined` optional without them. Keep `fields` for a tri-state update input, where `null` means "clear".
- An absent key from `optionalKey` or `fromOption` allocates nothing: every such result is one shared, frozen empty object.
