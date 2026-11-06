---
"@thomasfosterau/effect-ext": minor
---

Initial release of `@thomasfosterau/effect-ext`: extensions to the Effect standard library, merging the unreleased `effect-ext` and `@thomasfosterau/effect-schema-ext` packages into one (14 modules). Peer: `effect` PEER_RANGE. Every module is its own entry point and a namespace on `.`.

Binary data, Allocator-backed:

- `Allocator` — an `Allocator` service (a `Context.Reference` defaulting to the heap) handing out `ArrayBuffer` blocks, with heap, arena and tracked allocators, layers and a typed `AllocationError`.
- `Layout` — binary layouts (`u8` … `f64`, `bool`, structs, fixed arrays) with C-like alignment.
- `BufferStruct` — structs whose fields live in an `ArrayBuffer`, exposed as ordinary properties.
- `Vec` — a growable, `ArrayBuffer`-backed array, like Rust's `Vec<T>`.
- `StructOfArrays` — a growable struct-of-arrays container with typed-array columns.
- `String` — a growable, Allocator-backed UTF-8 string, like Rust's `String` (byte offsets and lengths).
- `Str` — an immutable UTF-8 string slice with Rust's `str` API; usable as a `HashMap` key.

Schema helpers, with no JSON:API, Drizzle or application vocabulary:

- `TriState` — the update tri-state (absent = carry forward, `null` = clear, value = set) in both encodings: `clearable` (`optionalKey(OptionFromNullOr(X))`) and `clearableNullOr` (`optional(NullOr(X))`); the separating readers `read` / `readNullOr` / `match` / `toNullOr` / `toNullOrFields` for write paths; the folding readers `suppliedValue` / `suppliedNullOr` for side effects.
- `Issues` — `pathToJsonPointer` (RFC 6901), `leaves` (a `SchemaIssue` tree flattened with its paths) and `pointers` (each leaf as a pointer, tag and formatted message, under a caller-chosen prefix).
- `Bounded` — `NonNegative`, `pageLimit` / `PageOffset`, the `pagination` / `requiredPagination` fields (explicit `maxLimit`; defaulted, or both keys required), and `idList` / `IdList` (comma-separated or repeated-key UUIDs, bounded as sent, optionally de-duplicated). The exports shared with effect-jsonapi's `FlatQuery` keep its names, defaults and messages; their option objects take `Option`-valued members.
- `Ids` — `Uuid`, branded ids (`make`, `refine` for stacked brands), and slugs (`SLUG_PATTERN`, `Slug`, `slug`: 1–200 characters by default, optional reserved segments, as effect-jsonapi's `FlatQuery`).
- `LiteralExact` — `tuple` / `literals`: literal tuples checked at compile time to name every member of a union and nothing else.
- `Ast` — field traits by decode probe through the JSON codec (`acceptsNull`, `isArray`, `isDate`) and by AST (`isOptionalKey`), and `fieldTraits` over a struct's fields.
- `Url` — absolute URLs whose scheme, hostname (or domain), port, credentials and path are part of their type. `Url.schema(spec)` decodes, serialises and checks a string, and its type records what was checked, so `Url<{ scheme: "https"; hostname: "api.example.com" }>` is assignable where a `Url<{ scheme: "http" | "https" }>` or a URL in the `example.com` domain is expected, and not the other way round. Also `is`, `satisfies`, `parse`, `resolve` (keeps the base's authority, refuses a reference that leaves it), `toURL` and `components`.
