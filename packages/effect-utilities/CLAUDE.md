# @thomasfosterau/effect-utilities

The published package: one subpath per module plus the `.` barrel. Peer: `effect` only — two copies break `Context` / `Layer` / `Schema` identity, so the consumer owns the singleton.

| Module | Family | What it is |
| --- | --- | --- |
| `Allocator` | binary data | An `Allocator` service (a `Context.Reference`) handing out `ArrayBuffer` blocks: heap, arena and tracked |
| `Layout` | binary data | Binary layouts (`u8` … `f64`, `bool`, structs, fixed arrays) with C-like alignment |
| `BufferStruct` | binary data | Structs whose fields live in an `ArrayBuffer`, exposed as ordinary properties |
| `Vec` | binary data | A growable, `ArrayBuffer`-backed array, like Rust's `Vec<T>` |
| `StructOfArrays` | binary data | A growable struct-of-arrays container with typed-array columns |
| `String` | binary data | A growable, Allocator-backed UTF-8 string, like Rust's `String` |
| `Str` | binary data | An immutable UTF-8 string slice, like Rust's `str`; usable as a `HashMap` key |
| `TriState` | Schema | The update tri-state: field schemas and readers |
| `Issues` | Schema | Schema issue trees → RFC 6901 JSON Pointers |
| `Bounded` | Schema | Bounded pagination and id-list codecs |
| `Ids` | Schema | UUID, branded-UUID ids and slugs |
| `LiteralExact` | Schema | Literal tuples checked to cover a union exactly |
| `Ast` | Schema | Schema introspection by AST and behavioural decode probe |
| `Url` | Schema | Absolute URLs (WHATWG serialisation) branded with the components they were checked against: scheme, hostname / domain, port, credentials, path |

Shared internals live in `src/internal/`: `bytes.ts` (a growable byte buffer), `iterator.ts` (the `indexed` iterator) and `utf8.ts` (the byte-level UTF-8 algorithms behind `String` and `Str`). They are not entry points, and docgen skips them.

## Boundary

Imports nothing from this workspace (`.fallowrc.json` zone `effect-utilities`, no outbound rule). Modules may import each other (`Bounded` → `Ids`, `Vec` → `Layout` → `Allocator`); `index.ts` only re-exports. The two families do not import each other today.

## Binary-data invariants

- **`Allocator.Allocator` is a `Context.Reference`** defaulting to the heap: nothing ever has to provide it. Every allocating constructor reads it; every data structure has a `makeScoped` variant that returns its memory when the scope closes.
- **`String` and `Str` mirror Rust's `String` and `str`.** Rust's method names in camelCase (`splitOnce`, `trimStartMatches`, `charIndices`, …) and Rust's semantics: byte offsets and lengths, and Rust's pattern behaviour (an empty pattern matches at every character boundary). Functions on a `String` that would return `&str` in Rust return a `Str` copy. Test against, and base examples on, Rust's documentation where possible.
- **`Str.Order` is byte-wise**, which is Unicode code-point order (not JavaScript's UTF-16 order).

## Schema invariants

- **No JSON:API, Drizzle or application vocabulary.** The `data/attributes` pointer prefix, a JSON:API error object, a `dbColumn` annotation, a reserved-route list or a page cap are the caller's; they are parameters here, never defaults. An app-shaped special case is a constructor parameter with the app's value in the README.
- **A separating reader never folds.** `read(undefined)` is `CarryForward`, never `Clear`; `toNullOr(undefined)` is `undefined`, never `null`. The tests pin both directions. A new reader states whether it separates or folds.
- **The wire is unchanged by the field schemas.** Encoding a decoded tri-state payload reproduces the JSON it came from: an absent key stays absent, `null` stays `null`.
- **FlatQuery parity.** `PageOffset`, `pageLimit`, `pagination` (+ `DefaultedPagination`, `RequiredPagination`), `idList` / `IdList` / `DEFAULT_MAX_ID_LIST`, `Uuid`, `SLUG_PATTERN`, `slug` / `Slug`, `suppliedValue` and `Issues.pathToJsonPointer` keep effect-jsonapi's names, defaults and messages (`FlatQuery.*`, plus `ServerErrors.pathToJsonPointer`, both backed today by its `src/FlatQuery.ts` and `src/internal/schemaExt.ts`): its switch to this package (#15) is an import change plus one accepted break (owner, effect-schema-ext#79): the option objects (`PaginationOptions`, `IdListOptions`, `SlugOptions`) take `Option`-valued optional members, and `defaultLimit: false` is `requiredPagination`, so those call sites are rewritten. Additions are fine (`idList`'s `dedupe` option, off by default; `requiredPagination`); a changed default or message is a break for that move. The `FlatQuery parity` test blocks pin it.
- **Bounds apply to input as sent.** `IdList` counts ids before de-duplication, so repeats cannot pad a request past the bound; the decoded side keeps the bound too.
- **Probes decode through `Schema.toCodecJson`**, the wire reading (`Schema.Date`'s own decoder accepts only a `Date` instance on effect rc.115 and later).
- **Every export has a one-line summary, `@since` and `@category`; every exported function and schema also has a runnable `@example`** (docgen executes it). Types and plain constants need no example.

## Schema terms

- **Tri-state** — the three things a partial-update field can say: absent (carry the stored value forward), `null` (clear), a value (set). Two encodings: the **`Option` encoding** (`TriState.clearable`, `optionalKey(OptionFromNullOr(X))`: absent / `none` / `some`) that website and gardeneria use, and the **nullable encoding** (`TriState.clearableNullOr`, `optional(NullOr(X))`: absent / `null` / value) that preferenceflow and a SQL `SET` map use.
- **Reader** — a function over one tri-state field. A **separating** reader (`read`, `readNullOr`, `toNullOr`, and `toNullOrFields` over a whole input) keeps the three states apart and is for write paths; a **folding** reader (`suppliedValue`, `suppliedNullOr`) merges "absent" and "clear" into `Option.none()` and is for side effects only. The nullable-encoding readers refuse an `Option` at compile time.
- **Leaf** — a terminal `SchemaIssue` with the path that reaches it; **pointed issue** — a leaf rendered as an RFC 6901 pointer (under a caller-chosen prefix), its tag and its formatted message.
- **Probe** — a decode of a fixed input (`null`, `[]`, an ISO timestamp) through a schema's JSON codec, used to read a field's traits without unpicking its AST.
