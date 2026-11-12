# @thomasfosterau/effect-ext

The published package: one subpath per module plus the `.` barrel. Peer: `effect` — two copies break `Context` / `Layer` / `Schema` identity, so the consumer owns the singleton — plus four optional peers, each needed only by the modules that import it: `@effect/platform-browser` (`Browser`, `BrowserTesting`), `@thomasfosterau/effect-jsonapi` (`Negotiate`), `@thomasfosterau/effect-parse` (`Robots` and the eight time modules) and `@effect/platform-node` (`src/evals/cli/main.ts` alone, the `effect-evals` bin's entry). Those twelve modules are subpaths only: the `.` barrel does not re-export them, so importing it never needs a peer the consumer did not install. The evals toolkit is not on the `.` barrel either: it has its own, `./evals`, and one subpath per module under `./evals/` (see [Evals](#evals)).

Seven families share the package; the AI abstractions and the evals toolkit, the last two, have their own sections ([AI service abstractions](#ai-service-abstractions), [Evals](#evals)). The binary-data and Schema modules are effect-ext's own; the web-platform modules came from `thomasfosterau/effect-web`, merged here with their history (#32); the numeric modules came from `thomasfosterau/effect-numeric` and the time modules from `thomasfosterau/effect-time`, both merged with their history and never published under their old names (`effect-numeric`, `@thomasfosterau/effect-time`). Each of effect-web's entry points became one subpath with the same contents (`@thomasfosterau/effect-web/net` → `Net`, `@thomasfosterau/effect-css` → `Css`, …), so a consumer's switch is an import change. They keep effect-web's conventions until #31 unifies them: `?: T | undefined` option members, full-name Effect imports, `SAFETY:`-commented assertions, and suites that run their programs with `Effect.runPromise` (the lint relaxations are `webModules` in the root `vite.config.ts`). In their comments, a bare `#NNN` written before the merge is effect-web's tracker (`effect-web#NNN`); an invariant id (`CACHE-AUTH-003`) names a rule from the apps' specs, listed in the root `SECURITY.md`. The numeric and time modules follow the conventions below except where their own sections say otherwise: their option members are `?: T | undefined` (#17), the time modules import Effect modules by their full names, and their suites are plain vitest (`Effect.runPromise` in the test body), not `@effect/vitest`. Their lint allowances are scoped by file in the root `vite.config.ts`.

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
| `Web` | web | Framework-neutral request / response utilities: header policies, cache control, `Vary`, cross-origin and client-IP checks, sessions, `siteBase`, the JSON:API error document and the Fetch adapters |
| `Net` | web | The lexical SSRF host block list and the redirect-revalidating fetch (SEC-SSRF-003) |
| `Observability` | web | The structured JSON-line sink, the allow-listed span logger, the event trio, the auth-outcome signal and per-request metrics |
| `Negotiate` | web | The content-negotiation dispatch verdict (HTML / JSON:API / Markdown) over effect-jsonapi's media-type rules |
| `ServiceWorker` | web | Caching strategies, precache, the route table and event plumbing for a service worker, on Effect |
| `Browser` | web | Browser platform APIs as services: `Locks`, `Navigator`, `PageVisibility`, `MediaQuery`, `WakeLock`, `Broadcast`, `PermissionStatus`, `Notifications`, `Fullscreen`, `ScreenOrientation`, `IdleDetection`, `Battery`, and one `layer` |
| `BrowserTesting` | web | An in-memory double, with its `Control`, for every `Browser` service and for `@effect/platform-browser`'s `Clipboard`, `Geolocation` and `Permissions`; `observe` |
| `Robots` | web | The Robots Exclusion Protocol (RFC 9309): parse / encode and match, the crawler side and the serving side |
| `Sitemap` | web | `sitemap.xml` (whole or streamed), the sitemap index, the `feed.json` adapter and the `Cache-Tag` purge |
| `RssFeed` | web | An RSS 2.0 feed, rendered and served |
| `AtomFeed` | web | An Atom (RFC 4287) feed, rendered and served |
| `JsonFeed` | web | A JSON Feed 1.1 document, rendered and served, and the lenient 1.0 / 1.1 reader |
| `UriTemplate` | web | `UriTemplate` (RFC 6570 parse, expand and match), `LinkHeader` (RFC 8288) and `WellKnown` (RFC 8615) |
| `Langtag` | web | BCP 47 language tags (RFC 5646), language ranges (RFC 4647), `Accept-Language` and `negotiateLanguage` |
| `LangtagRegistry` | web | Tag validity and canonicalisation against a snapshot of the IANA Language Subtag Registry |
| `Css` | web | CSS Syntax 3 parsing, `An+B`, tokens, CSS Color 4 / 5, lengths, the box shorthands, fonts, text values and serialisation |
| `Encoding` | web | The WHATWG Encoding Standard: labels, BOM sniffing, fatal decoding and encoding of bytes and streams |
| `EncodingJapanese`, `EncodingGb18030`, `EncodingBig5`, `EncodingEucKr` | web | The opt-in CJK indexes, provided through `Encoding.tablesLayer` |
| `Mime` | web | `MimeType`, `Sniff` (WHATWG MIME Sniffing), `Extension` and `DataUrl` |
| `I8` … `I128`, `U8` … `U128` | numeric | The standard fixed-width integers (Rust's `i8` … `u128`), each a `FixedInt` instance with strict, checked, wrapping, saturating and overflowing arithmetic |
| `FixedInt` | numeric | The fixed-width integer model and `make` / `makeBig` for any width |
| `Wrapping`, `Saturating`, `Checked`, `Overflowing` | numeric | The arithmetic strategies as type classes, with an instance per standard integer |
| `Clamped` | numeric | Numbers constrained to `[min, max]` at the type level |
| `Float`, `F32` | numeric | The `Float` type class, `F64`, IEEE 754 `totalOrder`, `NotNaN` / `Finite`; single precision floats |
| `Ratio`, `Complex` | numeric | Exact rationals over `bigint`; complex numbers over doubles |
| `Num`, `Integer`, `Range` | numeric | `num-traits` type classes and instances; `num-integer` algorithms; `num-iter` ranges |
| `ArithmeticError` | numeric | The tagged errors of fallible numeric operations |
| `Rfc3339`, `Rfc9557` | time | RFC 3339 date-times and RFC 9557 (IXDTF) extended date-times, to and from `DateTime` |
| `IsoDuration` | time | ISO 8601 durations, to and from the amounts `DateTime.add` takes |
| `PosixTz`, `Tzif`, `IanaTimeZone` | time | POSIX TZ strings; compiled TZif files (RFC 8536); IANA zone names checked against the runtime's tz data |
| `CronExpression`, `RRule` | time | Cron expressions to Effect's `Cron`; RFC 5545 recurrence rules |
| `RerankerModel`, `ClassifierModel`, `SpeechModel`, `TranscriptionModel`, `ImageModel`, `ModerationModel`, `VoiceConversionModel` | AI | The provider-neutral AI service abstractions `effect/ai` lacks, each shaped like its `EmbeddingModel` |
| `evals`, `evals/<Module>` | evals | The LLM evaluation toolkit: goldens, scorers, thresholds, metrics (G-Eval, RAG, retrieval ranking), the runner, the cache, reporters; `src/evals/cli/` is the `effect-evals` bin's CLI |

Shared internals live in `src/internal/`: `bytes.ts` (a growable byte buffer), `iterator.ts` (the `indexed` iterator), `utf8.ts` (the byte-level UTF-8 algorithms behind `String` and `Str`) and `xml.ts` (the escaping behind `RssFeed` and `AtomFeed`), plus one directory per web module family (`internal/css/`, `internal/encoding/`, …), `internal/numeric/` (the scalar kernels, the brand helpers and the `Value` base class) and `internal/time/` (`calendar.ts`, shared by `Rfc3339` and `RRule`). They are not entry points, and docgen skips them. A web module whose effect-web entry was a barrel of several modules keeps them in a public directory beside its subpath file (`src/Css.ts` re-exports `src/css/*.ts`; `Browser` → `src/browser/`, `BrowserTesting` → `src/browser-testing/`); docgen documents those files and skips the pure re-export barrels (`docgen.json`). Their tests live in `tests/<effect-web package>/` (`tests/css/`, `tests/web/`, …), with each suite's vendored fixtures beside it; the numeric and time suites live in `tests/numeric/` and `tests/time/`.

## Boundary

Imports nothing from this workspace (`.fallowrc.json` zone `effect-ext`, no outbound rule). Modules may import each other (`Bounded` → `Ids`, `Vec` → `Layout` → `Allocator`); `index.ts` only re-exports. The seven families do not import each other today. Within the web family: `Negotiate` imports `Mime` (it compares media types as `MimeType`s, effect-web#164) and `Web`'s JSON:API error document; `Sitemap` imports `Observability` (`logErrorEvent` / `describeError` for the purge outcome) and `JsonFeed` (its JSON Feed builder is an adapter over that one); `ServiceWorker` imports `Net` (its `FetchFailed`); `BrowserTesting` imports `Browser`'s modules (its doubles run the real adapters), and nothing outside `BrowserTesting` imports it. An optional peer is imported only by the modules named in the first paragraph, which keeps every other subpath, and the barrel, free of it; `Robots` and the time modules import effect-parse's subpaths (`/Parser`, `/Token`, `/ParserSchema`, `/Ascii`, `/Binary`, `/ParseError`), never its root barrel. Within the time family `Rfc9557` imports `Rfc3339`, `Tzif` imports `PosixTz`, and `Rfc3339` and `RRule` share `internal/time/calendar.ts`. Within the numeric family every integer module is a `FixedInt.make` / `makeBig` instance, and the strategy modules import the integer modules for their per-type instances.

## Binary-data invariants

- **`Allocator.Allocator` is a `Context.Reference`** defaulting to the heap: nothing ever has to provide it. Every allocating constructor reads it; every data structure has a `makeScoped` variant that returns its memory when the scope closes.
- **`String` and `Str` mirror Rust's `String` and `str`.** Rust's method names in camelCase (`splitOnce`, `trimStartMatches`, `charIndices`, …) and Rust's semantics: byte offsets and lengths, and Rust's pattern behaviour (an empty pattern matches at every character boundary). Functions on a `String` that would return `&str` in Rust return a `Str` copy. Test against, and base examples on, Rust's documentation where possible.
- **`Str.Order` is byte-wise**, which is Unicode code-point order (not JavaScript's UTF-16 order).

## Numeric invariants

Carried over from effect-numeric's guidance. There is no consuming application: Rust's documented semantics are the spec, and `tests/numeric/examples.test.ts` pins the README's Numeric examples.

- **Overflow semantics follow Rust exactly.** `wrapping*` is modulo 2^bits, `saturating*` clamps to `MIN` / `MAX`, `checked*` returns `None`, `overflowing*` returns `[wrapped, overflowed]`, and the unprefixed form returns `Result<A, ArithmeticError>`. `MIN / -1` and `MIN % -1` are the only overflowing division cases. When in doubt, check the Rust std docs for the same method and add a property test.
- **Representation is fixed by width.** Types of up to 32 bits are `number`, wider ones `bigint` (`FixedInt.make` vs `FixedInt.makeBig`). Number arithmetic normalises `-0` to `0` (the `+ 0` in `numberPrim`); keep it.
- **Every module-level value built by a call is `/* @__PURE__ */`** (`FixedInt.make(...)`, `buildFloat(...)`, `refined(...)`, the `Wrapping.*` / `Saturating.*` / `Checked.*` / `Overflowing.*` instances): `"sideEffects": false` depends on it, and a new one must be annotated too.
- **Fallible operations return `Result` / `Option`**, synchronously; there is no service or layer. **Type-class instances are total**: where an operation is undefined (integer division by zero) they throw a `DivisionByZeroError`, mirroring a Rust panic, and the concrete modules offer the `Result` / `Option` form.
- **Binary operations are dual**, built with `Num.operator` (`Function.dual(2, f)`); a new one is an `Operator<Self, That, Out>`.
- **Values are branded** (`number & Brand.Brand<"U8">`). Brand casts go only through `src/internal/numeric/brand.ts` (its lint allowances are scoped to that file). Value objects (`Ratio`, `Complex`) extend `internal/numeric/value.ts`'s `Value` and implement `Equal` / `Hash`; a `Ratio` is always reduced with a positive denominator.
- **Loops live only in `src/internal/numeric/`**: the scalar kernels (Euclid, Newton, square-and-multiply, Miller–Rabin, continued fractions, the lazy range generators), where `effect/imperative-loops` is off. Collection code elsewhere uses `Arr` combinators.
- **Arithmetic laws are fast-check properties** against a `bigint` reference.

## Numeric terms

- **Strategy** — what an operation does on overflow: strict (`Result`), checked (`Option`), wrapping, saturating or overflowing (`[value, overflowed]`); one prefix each.
- **Prim** — `FixedInt`'s primitive table for one representation (`numberPrim`, `bigintPrim`): the raw operations every width is built from.
- **Instance** — a type-class value (`Wrapping.U8`, `Num.bigint`, `Ratio.Field`) that generic code (`Num.sum`, `Integer.gcd`) takes as its first argument.

## Time invariants

Carried over from effect-time's guidance.

- **Effect's values in, Effect's values out.** Every module produces and consumes `DateTime`, the amounts `DateTime.add` takes, or `Cron`; nothing here wraps or copies them. effect-time's identity re-exports of `effect/Clock` and `effect/DateTime` were dropped at the merge: Effect provides them.
- **Time is never read here.** The parsers are pure (a consumer reads the time through `Clock`, never `Date.now()`); a test that needs a fixed time uses `TestClock`. `effect/Date` does not exist; `Date` interop is `DateTime.make(date)` / `DateTime.toDateUtc`.
- **Each module is a parser to compose, an effectful decoder, a printer and a `Schema`**, and a parse failure is effect-parse's `ParseError`, positioned at the offending field (a byte offset for `Tzif`).
- **Nothing is bundled.** `IanaTimeZone` asks the runtime's ICU build (`Intl`), so its answer depends on that runtime's tz data; `Tzif` reads bytes the caller supplies.
- **Each grammar is its specification's, and its departures are documented** in the module and the README (a leap second rejected by `Rfc3339`, fractions truncated to milliseconds, Quartz's `?` / `L` / `W` / `#` not read by `CronExpression`, `RSCALE` / `SKIP` not read by `RRule`).

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

## Web-platform modules

Carried over from each effect-web package's own guidance, with paths and names rewritten. Each heading names the modules it covers; "this package" in a section means those modules.

### Web, Net, Observability, Negotiate, ServiceWorker, Browser, BrowserTesting

**Invariants.**

- **No SvelteKit, Alchemy or Cloudflare dependency**, at the type level included. Anything that needs a Worker binding lives in the consuming application; anything that needs `$app/*` lives in `effect-svelte`.
- **Allow-lists and predicates are parameters**: no viewer or session shape beyond "a viewer was resolved", no route names, no span names. `spanTracer` takes its allow-list; it is never a constant.
- **The stage is the caller's**: nothing here reads an environment (`stageNoindex` takes `indexable`). The one configuration read is `siteBase`, through the caller's ambient `ConfigProvider`, under the key and with the fallback origin the caller names; it is total (a missing, unreadable or invalid value yields the fallback), and the package ships no default host.
- **`logStructured` keeps the flat line shape** (`{"event":…}`), never Effect's logger envelope: the line shape is a stable output contract that log dashboards and queries key on.
- **The `Accept` `q` split is effect-jsonapi's; the weight is local.** Each `Accept` entry, trimmed and with empty `;` parts dropped, goes to `Middleware.contentTypeIsAcceptable`, which ends the media type at the first `q` (RFC 9110 §12.4.2) from the `>=0.16.1` peer floor on. The weight (the first `q`) is read locally, because effect-jsonapi exports no per-entry weight and its `acceptIsAcceptable` reads an unparsable `q` as a refusal, where `Negotiate` reads it as `1` (a malformed weight is a client bug, not a refusal). The local weight goes once effect-jsonapi exports a per-entry weight, or under effect-web#58 (whether `Negotiate` defers to effect-jsonapi's `Negotiation`).
- **The plain-`Promise` / plain-`Error` forms** (`assertAllowedUrl`, `fetchFollowingRedirects`) keep fixed message wording (the `UnsafeUrl` and `RedirectRejected` messages), stable because callers' tests pin it; the tests here pin it too. The tagged `cause` they carry is readable in the same realm only.
- **One request-metric accumulator per request, never per process.** `withRequestMetrics` builds a fresh `Metric.Counter` and `MetricRegistry` per call (a `Metric` caches its registry hooks on the instance, so a shared counter pins every request to the first one's registry); the `AsyncLocalStorage` that scopes it is created on first use, never at import. `countingProxy` invokes a counted method with the real client as `this` and costs one `Set#has` per call, plus one `updateUnsafe` inside a scope.
- **`ServiceWorker` touches no global at import.** `caches`, `fetch` and `registration` are read through context references with global defaults (`Caches`, Effect's `FetchHttpClient.Fetch`, `Registration`), on first use; event types are structural so the entry compiles under `dom` without the `webworker` lib.
- **A route's `match` is synchronous.** `respondWith` must be called during dispatch, so whether a route answers can never wait on an effect; no match means no `respondWith`, and the browser fetches the request itself.
- **The page never waits on a cache write.** Strategies clone the response and hand the `put` to `EventLifetime`, which inside a listener is bound to the event's `waitUntil`; a background failure is logged, never served.
- **The ambient platform objects** (`navigator`, `document`, `matchMedia`, `BroadcastChannel`, `IdleDetector`, `screen.orientation`, `Notification`, `globalThis` as an event target) **are read in exactly one place**, `src/internal/web/globals.ts`, and only from inside a live `layer`'s build — never at import, never in `make`. Every `Browser` service has a `make` over a structural `*Like` interface (the slice of the platform object it calls), so a double, a worker's own global or a test object can stand in.
- **A missing API degrades; it never fails the layer.** `supported: false` plus an `Unsupported` failure for a call, `Option.none()` for a reading, a single-value (or, with no value to report, empty) stream for a change stream. One layer serves every browser, a worker and a server render.
- **Every change stream emits the current value first, after its listeners are attached** (`src/internal/web/dom.ts` `watch`), then each change, deduplicated, on a sliding buffer. `BrowserTesting`'s `observe` relies on this; so does every test that drives a `Control`.
- **A `Scope` holds a platform resource; closing it releases the resource and waits for the platform to report the release** (a lock is free for another context once `withLock` returns). A grant that races an interruption is released, never leaked.
- **The doubles in `BrowserTesting` run the real adapter** over an in-memory platform object, and drive it through the events the browser would fire. A double never re-implements a service's logic, and its getters read live state (`Object.assign` snapshots a getter: use a small `EventTarget` subclass).
- **`Browser` does not wrap what `@effect/platform-browser` already provides** (`Clipboard`, `Geolocation`, `Permissions`, `IndexedDb`, `KeyValueStore`, workers, sockets); it builds beside or on top of them, and `BrowserTesting` doubles them.

**Terms.**

- **Header policy** — a pure `(headers: Headers.Headers) => Headers.Headers`. Composed, then applied once: `updateHeaders` (an `HttpServerResponse`), `updateWebHeaders` (a Fetch `Response`, cloned only on change) or `applyToWebHeaders` (in place).
- **Fetch adapter** — the boundary to the Fetch types a SvelteKit hook deals in: Effect's own `HttpServerRequest.fromWeb` / `HttpServerResponse.toWeb`, this package's header adapters, and the `*Web` pre-applied forms.
- **Route class** — `"locale-invariant" | "format-negotiated" | "negotiated"`: what decides a response's `Vary`. Classification is injected; the locale-invariant set ships as the default.
- **Verdict** — a `Negotiation`: representation token, dispatch flag, Markdown flag, §6 error. Decided from the request line and headers alone.
- **Strategy** — `(request: Request) => Effect<Response, E, R>`: how one request is answered. The five standard ones are built from `StrategyOptions`; any function of that shape is one.
- **Event lifetime** — `EventLifetime`: where background work goes. Inside a listener it is the event's `waitUntil`; outside one, a detached fiber.
- **Ranking** — the one part of content negotiation that stays local: whether the JSON:API / Markdown instance outranks every other media type the client offered. The §5/§6 parameter rules are effect-jsonapi's.
- **`*Like` interface** — the structural slice of a platform object a `Browser` adapter calls (`LockManagerLike`, `NavigatorLike`, `DocumentLike`, …). The DOM object satisfies it; so does a double.
- **Double** — a `BrowserTesting` module: `make` (the real adapter over an in-memory platform object, plus its `Control`), `layer` (both, as a `Layer`).
- **Control** — the per-double service a test drives the platform through and reads recorded calls from.

### Robots

**Invariants.**

- **`parse` never throws because the line grammar is total** (every string parses: a line that is not `field: value` becomes `None`, never a parse failure), **and `encode(parse(x))` is canonical**: unknown lines dropped, orphan rules dropped, `#` comments, CRLF. `productionBody` renders through `encode` so a served document always round-trips.
- **`isAllowed` strips the query string; `evaluateRobots` matches it.** `isAllowed` keeps the library's documented behaviour, which the acceptance suite pins; the crawler decision matches the query as RFC 9309 §2.2.2 does, so a site can disallow a `?tab=` path. Both strip the fragment.
- **Every non-production stage serves `NON_PRODUCTION_BODY`** whatever the policy says (ROBOTS-005); `robotsBody` takes `production: boolean`, never reads an environment.
- **The 500 KiB cap (RFC 9309 §2.5), the 24 h / 1 h TTLs (a directive change honoured within a day; an unavailable origin not probed on every check) and the 30 s crawl-delay cap (a hostile value cannot stall a batch) are this package's defaults**, exported as constants so a consumer's tests can pin them.
- **The checker takes the request header, the token and the cache** as parameters: no crawl-job shape, KV binding or stage name lives here.

**Terms.**

- **Product token** — the `User-agent:` name a group binds (`ExampleBot`), distinct from the **request header** (`ExampleBot/1.0 (+https://…)`). `makeRobotsChecker` takes both: `userAgentToken` selects the group, `userAgent` is sent.
- **Group selection** — RFC 9309 §2.2.1: the group whose token matches the crawler's exactly or as a prefix (case-insensitive), longest wins; `*` matches everything and loses to any named group. Both sides are reduced to their product token first (the leading `[A-Za-z_-]` run), so a version or comment on either side (`ExampleBot/1.0`) does not stop the match; a line with no token matches nothing. Never a substring match (`userAgent.includes(token)`): that would let `User-agent: bot` bind `Googlebot`. The README says so.
- **Failure posture** — RFC 9309 §2.3.1: 4xx / no file → no restrictions (`""`); 5xx, timeout, transport fault → unavailable (`ROBOTS_UNAVAILABLE_SENTINEL`, treated as disallow). `fetchRobots` never fails; it returns one of the three.
- **Cache seam** — `RobotsCache<R>`: per-origin `get` / `put` with a TTL, generic over its requirements. Persistent adapters (a Workers KV one, say) live in the consuming application, never here.

### Sitemap

**Invariants.**

- **The rendered bytes are a stable contract.** `renderSitemap` joins with `""` after the XML declaration; `jsonFeedResponse` pretty-prints with two spaces; an absent `title` / `summary` is an omitted key, never `null`. The cached copies at the edge are those bytes, so a change here is a visible change in every consumer.
- **The JSON Feed is `JsonFeed`'s.** `buildJsonFeed` / `jsonFeedResponse` are an adapter: they map a `FeedEntry` (the SQL wire shape) to `JsonFeed`'s entry and build and serve with its functions, never a second serialiser. Every item carries `content_text` (the `summary`, else the `title`, else `""`), as JSON Feed 1.1 requires.
- **No XML escaping on `<loc>`**: every location is the canonical origin plus a path derived from validated ids or a hand-written list. `escapeXml` exists for authored text a consumer emits; nothing here emits any.
- **`lastmodOf` is a parse, never a clock read**; `undefined` means omit the element.
- **`purgeCacheTags` never fails**: a rejection or a `success: false` is one error-level event (`cache-purge.failed` / `cache-purge.rejected`), and the mutation that triggered it completes.
- **The stream form never materialises the enumeration**: `sitemapStream` maps the source stream one entry per chunk; the caller runs any database enumeration before the response is built, never inside the body stream.

**Terms.**

- **Entry** — a `SitemapUrl` / `FeedEntry`: a site-root-relative `path` plus what the document needs of the row. The map from a resource type to its route segment is the application's; nothing here knows a `posts` from a `people`.
- **Canonical origin** — the `base` every URL is resolved on: `PUBLIC_SITE_URL`, never the request origin (CANON-001 / DISC-011).
- **Low-churn document** — one the edge caches an hour (`LOW_CHURN_CACHE_CONTROL`, PERF-CACHE-002) and a mutation purges by `Cache-Tag`, rather than one regenerated per request.
- **Eligible type** — a resource type the documents enumerate; a write to one purges both tags whatever the row's visibility (a wasted purge over a missed one).

### RssFeed

**Invariants.**

- **Every piece of authored text and every URL is escaped** (`src/internal/xml.ts`), and characters XML 1.0 forbids (C0 controls other than tab/LF/CR, U+FFFE/U+FFFF, lone surrogates) are dropped: one stray control character must not make the document unparseable. `src/internal/xml.ts` is shared by `RssFeed` and `AtomFeed`.
- **The rendered bytes are a stable contract.** Elements are joined with `""` after the XML declaration, in a fixed order; an absent optional is an omitted element. Cached edge copies are those bytes.
- **Dates are values the caller passes (`DateTime.DateTime`), never a clock read.**
- **An item has a `title` or a `description`** (RSS 2.0 §item); `RssItem` is a union so an item with neither does not compile (`tests/rss-feed/index.types.ts`).
- **The `atom` and `content` namespaces are always declared**, so the opening bytes never depend on the items.

**Terms.**

- **Entry** — a site-root-relative `path` plus what the document shows of the row. The map from a resource type to its route segment is the application's.
- **Canonical origin** — the `base` every URL is resolved on: the configured production origin, never the request origin (CANON-001).
- **Low-churn document** — one the edge caches an hour (`LOW_CHURN_CACHE_CONTROL`, PERF-CACHE-002) and a mutation purges by `Cache-Tag` (the purge itself is `Sitemap`'s `purgeCacheTags`).

### AtomFeed

**Invariants.**

- **Every piece of authored text and every URL is escaped** (`src/internal/xml.ts`), and characters XML 1.0 forbids (C0 controls other than tab/LF/CR, U+FFFE/U+FFFF, lone surrogates) are dropped: one stray control character must not make the document unparseable. `src/internal/xml.ts` is shared by `RssFeed` and `AtomFeed`.
- **The rendered bytes are a stable contract.** Elements are joined with `""` after the XML declaration, in a fixed order; an absent optional is an omitted element. Cached edge copies are those bytes.
- **Dates are values the caller passes (`DateTime.DateTime`), never a clock read.**
- **Timestamps are RFC 3339 in UTC** (`DateTime.formatIso`), whatever zone the `DateTime` carries.
- **The feed's `updated` is required input**, never derived from the entries or a clock. An entry's `<id>` defaults to its absolute URL, so it is only as permanent as the path.

**Terms.**

- **Entry** — a site-root-relative `path` plus what the document shows of the row. The map from a resource type to its route segment is the application's.
- **Canonical origin** — the `base` every URL is resolved on: the configured production origin, never the request origin (CANON-001).
- **Low-churn document** — one the edge caches an hour (`LOW_CHURN_CACHE_CONTROL`, PERF-CACHE-002) and a mutation purges by `Cache-Tag` (the purge itself is `Sitemap`'s `purgeCacheTags`).

### JsonFeed

**Invariants.**

- **An absent member is an omitted key**, never `null` or `undefined`-valued: `compact` drops them, and its mapped parameter type makes the builder name every member of the output type once.
- **An item has `content_html` or `content_text`**, an author at least one of `name` / `url` / `avatar` (JSON Feed 1.1); the input types are unions so the invalid shapes do not compile (`tests/json-feed/index.types.ts`).
- **The reader is lenient and says so.** Only input that is not a JSON Feed at all (`InvalidJson`, `NotAnObject`, `NotAJsonFeed`) fails; everything it drops or repairs is a `JsonFeedDiagnostic`. A decoded item may lack both contents (reported, kept), so the content invariant above holds for built feeds, not parsed ones. A built feed decodes back to itself with no diagnostics (`tests/json-feed/parse.test.ts`).
- **The served bytes are 2-space pretty-printed**; changing the indent changes every cached copy.
- **Dates are values the caller passes (`DateTime.DateTime`), never a clock read**, emitted RFC 3339 in UTC.

**Terms.**

- **Entry** — a site-root-relative `path` plus what the document shows of the row. The map from a resource type to its route segment is the application's.
- **Canonical origin** — the `base` every URL is resolved on: the configured production origin, never the request origin (CANON-001).
- **Low-churn document** — one the edge caches an hour (`LOW_CHURN_CACHE_CONTROL`, PERF-CACHE-002) and a mutation purges by `Cache-Tag` (the purge itself is `Sitemap`'s `purgeCacheTags`).

### UriTemplate

**Invariants.**

- **The uritemplate-test suite is the acceptance test** (`tests/uri-template/fixtures/uritemplate-test`, Apache-2.0, vendored at a recorded commit; its `README.md` records the provenance). A failing case is a bug here. The one deliberate departure from the RFC 6570 ABNF, a `'` allowed in literals, is the suite's.
- **Parsing and expansion are total and synchronous**: `parse` and `expand` return `Result`s, never throw, never run an effect. `PrefixOnComposite` is the only expansion failure.
- **Expansion follows RFC 6570 Appendix A literally**: the operator table (`first`, `sep`, `named`, `ifemp`, `allow`), `null` / `undefined` / `[]` / `{}` as undefined, and prefixes counted in code points before encoding. An associative array expands in insertion order (JavaScript's, so integer-like keys come first).
- **Matching refuses at compile time, never guesses at match time.** `matcher` fails `Unmatchable` (with the expression's position) for every template outside the subset its doc comment lists; `match` only ever misses. The contract is the round trip: for a URL the template expanded, `expand(template, match(url))` reproduces it, checked over every uritemplate-test case inside the subset (`tests/uri-template/uri-template-match.test.ts`). `src/internal/uri-template/match.ts` holds the compiler.
- **`LinkHeader.parse` never fails** (RFC 8288 Appendix B): a malformed link-value is skipped; `rel`, `anchor`, `type`, `media`, `title` and `title*` keep their first occurrence; `hreflang` keeps every one. A target and an anchor are resolved only when a base is passed.
- **Registered relation types compare case-insensitively, extension types (URIs) exactly**: `rel` stores registered types lowercased.
- **No module-scope work**: the package is `"sideEffects": false`, so regular expressions are literals and the `TextEncoder` is made per call.

**Terms.**

- **Expression** — a `{…}` in a template: an operator and one or more variable specs.
- **Variable spec** — a variable name as written (pct-encoded octets included) and its modifier: prefix (`:n`) or explode (`*`).
- **Link-value** — one `<target>; params` element of a `Link` header.
- **Well-known suffix** — the path segment after `/.well-known/`, an RFC 3986 `segment-nz`.

### Langtag, LangtagRegistry

**Invariants.**

- **The root entry is well-formed, not valid; validity lives in `LangtagRegistry`.** `parse` checks the RFC 5646 §2.1 ABNF only: no registry lookup, no `Preferred-Value` mapping (`iw` stays `iw`), no duplicate-variant or duplicate-singleton check. `LangtagRegistry`'s `isValid` (§2.2.9) and `canonicalize` (§4.5) are the only places that consult the IANA Language Subtag Registry, so a consumer that never imports `LangtagRegistry` never bundles its ~45 KB snapshot.
- **The registry snapshot is generated, never hand-edited.** `src/internal/langtag/registry-data.ts` comes from `scripts/generate-language-subtag-registry.mjs` (from IANA, or a copy with its provenance passed as `--source`); its header records the source and `File-Date`, which `registryDate` exports. The data is space-delimited string literals, pure declarations under `"sideEffects": false`, looked up by substring (no `Set` built at import).
- **A `LanguageTag` is canonical-case by construction**, so tag equality is `===`. The `LanguageTag` schema rejects a well-formed tag in the wrong case; only `LanguageTagFromString` (and `parse`) canonicalise.
- **Grandfathered tags are matched before the `langtag` production** (§2.1): `zh-min-nan` is grandfathered even though it also parses as language + extlangs, and has no parts.
- **Matching works on the caller's strings and returns the caller's values**, case-insensitively, without parsing them: a branded or literal-typed tag comes back as the same type.
- **Lookup truncates the range, never the tag** (RFC 4647 §3.4): `de` does not reach an available `de-DE`. A fallback chain such as CSL's `de-AT` → `de-DE` is the consumer's policy, built on `lookup`.
- **A malformed `q` reads as `1`** in `AcceptLanguage.parse`, as in `Web`'s `Negotiate`: a malformed weight is a client bug, not a refusal. A `q=0` range refuses every tag it basic-matches in `negotiateLanguage`.

**Terms.**

- **Language tag** — a BCP 47 tag (`en-GB`, `zh-Hant-TW`, `x-private`, `i-klingon`).
- **Language range** — a pattern in a user's priority list: basic (`de-CH`, `*`) or extended (`de-*-DE`, RFC 4647 §2.2).
- **Priority list** — ranges in preference order; for `Accept-Language`, ordered by `q`, ties in header order.
- **Canonical case** — RFC 5646 §2.1.1: lowercase, region uppercase, script title-case, everything after a singleton lowercase.

### Css

**Invariants.**

- **The css-parsing-tests suite is the behavioural spec.** `tests/css/fixtures/css-parsing-tests/` vendors it (CC0, commit pinned in its README); every syntax and colour vector must pass through the converters in `tests/css/syntax.test.ts` and `tests/css/color.test.ts`. It pins the edition the parser follows: the 2021 Syntax 3 candidate recommendation, plus the 2014 `unicode-range`, attribute-matcher and `||` tokens.
- **The tokenizer and parser are transcriptions.** `src/internal/css/tokenizer.ts` and `src/css/syntax.ts` follow the specification's consume-* algorithms step for step over a cursor; the imperative loops are the algorithm as written (file-level lint disables say so). Restructure them only with the suite green.
- **Errors are recovered from and reported in place**: a list parse yields `SyntaxError` items (`empty`, `invalid`, `extra-input`) with the code-point offset in the preprocessed input; an unterminated string or URL token is flagged `unterminated`. Nothing throws.
- **WPT `color-mix()` vectors** (`tests/css/fixtures/wpt-color-mix.json`, recorded from `css/css-color/parsing`: valid, invalid and computed) run in `tests/css/color-mix.test.ts`; only the `calc()` / `var()` ones are set aside, and the counts left are pinned. `Color.resolve` computes a mix through `src/internal/css/mix.ts` (interpolation) and `src/internal/css/spaces.ts` (every interpolation space to and from XYZ D65; inverse matrices as literals).
- **Colour serialisation is today's CSS Color 4 / 5** (the owner's decision on effect-web#166, option B): named colours print their name; hex, `rgb()`, `hsl()` and `hwb()` print `rgb(r, g, b)` / `rgba(…)` with integer channels, except that a `none` channel keeps `color(srgb …)` (from `rgb()`) or `hsl()` / `hwb()`; `lab()`-family lightness is clamped at parse time; Lab-family and `color()` keep their space; numbers print with at most six decimals. The WPT vectors pin it (`tests/css/color-valid.test.ts`, `tests/css/color-mix.test.ts`), with each file's pass count pinned; only `calc()` / `var()` vectors are set aside. The css-parsing-tests colour vectors pin the 2021 edition, so `tests/css/color.test.ts` checks them for parsing only: each input must parse to the same colour as its expected serialisation. `toSrgb` does not gamut-map.
- **Serialisation round-trips**: parsing `Serialize.componentValues` output gives back the component values it was given, less comments and whitespace runs; `tests/css/serialize.test.ts` checks it over every suite input.
- **Nothing runs at import** (`"sideEffects": false`): tables and matrices are literals.

**Terms.**

- **Component value** — a preserved token, a function or a simple block (§5).
- **Preprocessed input** — the input after §3.3 (CR, FF and CRLF to LF; NUL and lone surrogates to U+FFFD); `SyntaxError` offsets count its code points.

### Encoding and its CJK indexes

**Invariants.**

- **The label table and the bundled index are generated data, never edited by hand.** `src/internal/encoding/labels.ts` is the Encoding Standard's `encodings.json`; `src/internal/encoding/single-byte.ts` its `index-<name>.txt` files (each entry names its file and identifier). The label test checks every entry against the runtime's own `TextDecoder`; `tests/encoding/encode.test.ts` checks the tables against the web-platform-tests single-byte vectors, on this runtime and on one whose `TextDecoder` knows only UTF-8.
- **A single-byte encoding always decodes from its bundled index, never the runtime's `TextDecoder`**: Node's ICU disagrees with the standard on five of them (`IBM866`, `KOI8-U`, `windows-874`, `windows-1253`, `windows-1255`).
- **Decoding is fatal by default.** Malformed input fails with `DecodeError`, never U+FFFD, unless the caller passes `fatal: false`.
- **A `DecodeError`'s offset is exact for every encoding.** A fatal decoder runs a shadow backend in lockstep, fed only accepted input; on a failure the shadow is fed the failing chunk a byte at a time. Only fatal decoding pays for the shadow, and only the failing chunk is fed byte-wise. Offsets count from the start of the input, a BOM included; a sequence cut short by the end of input reports the input's length.
- **`"sniff"` is the standard's "decode"**: a BOM overrides the requested encoding and is removed by the decoder here (the backend is built with `ignoreBOM: true`), so a second BOM survives as U+FEFF. `"strip"` leaves the requested encoding's own BOM to `TextDecoder`.
- **Encoding is fatal by default** (`EncodeError { encoding, offset, codePoint }`, the offset in UTF-16 code units); `errorMode: "html"` writes `&#N;`. A lone surrogate encodes as U+FFFD; a stream keeps a trailing high surrogate for the next chunk. `replacement` and UTF-16 have no encoder (the standard's `getOutputEncoding` maps them to UTF-8).
- **Each stream run gets its own decoder or encoder** (`Stream.unwrap`), so a `decodeStream` or `encodeStream` can be run twice.
- **The CJK tables never reach the main entry.** `src/Encoding<Name>.ts` holds each opt-in index as generated literal data (`index-<name>.txt`, identifier in a comment); the main entry imports only their type. A provided table set wins over the runtime's `TextDecoder`, as the single-byte tables do. An encoder builds its reverse index (an `Int32Array` over the Basic Multilingual Plane) once per `encode` call or stream run.
- **Nothing runs at import** (`"sideEffects": false`): the bundled tables are string literals, and backends are built on first use.

**Terms.**

- **Label** — any of the 228 strings that name an encoding (`latin1`, `utf8`, `sjis`).
- **Encoding name** — one of the 40 canonical names (`windows-1252`, `UTF-8`, `Shift_JIS`).
- **Backend** — one encoding's chunk decoder: a bundled single-byte table, the runtime's `TextDecoder`, or `replacement`.
- **Error mode** — what an encoder does with an unmappable code point: `fatal` or `html` (§4.1).

### Mime

**Invariants.**

- **The specifications' algorithms are transcribed, and the web-platform-tests vectors pin them.** `tests/mime/fixtures/` vendors `mimesniff/mime-types/resources/*.json`, `fetch/data-urls/resources/*.json` and the `mimesniff/media/` and `mimesniff/sniffing/` resources (BSD-3-Clause, provenance in its README); every vector must pass. Where the specification's text is self-evidently wrong (§6.2.3's MP3 frame-size tables keyed on `version & 1`, its `s - length`), the code follows what the algorithm describes, says so beside it, and a vector pins it. Refresh them by fetching, never by editing.
- **A parsed `MimeType` is normalised**: type, subtype and parameter names lower-case, parameters in first-appearance order and unique (first value wins). Values keep their case; `serialize` quotes a value that is empty or not a token.
- **The sniffing tables are literals**, so nothing is built at import (`"sideEffects": false`). Each row's `name` is its row in the specification.
- **Custom signatures never override a specific standard pattern**: `sniff` tries them only where the standard found nothing specific — over a generic container match (`GENERIC_CONTAINERS`: `application/zip`) and before the text-or-binary fallback — so a format library refines `application/zip` or `text/plain` without shadowing what the standard already identifies.
- **The extension table is curated, not mime-db.** Add an entry only for a format a consumer here needs; `extend` is the hook for the rest. The first extension listed for a type is the one `extensionFor` returns.

**Terms.**

- **Essence** — `type/subtype`, without parameters.
- **Supplied type** — the type a resource arrived with (a `Content-Type`); **computed type** — what `sniff` decides.
- **Signature** — `(bytes) => Option<string>`: a custom detector for an unknown resource.
- **Scriptable** — HTML, XML and PDF, which `sniff` detects in an unknown resource only while `scriptable` is not `false` (the specification's sniff-scriptable flag).

## AI service abstractions

Merged in from `@thomasfosterau/effect-ai-ext` (published to 0.5.1, then deprecated). They keep the AI conventions in the root AGENTS.md ("The AI packages": full-name Effect imports, extensionless relative imports, the scoped lint relaxations in the root `vite.config.ts`) until someone unifies them with the rest of the package, but not its option members, which follow the package rule (#17): options-object settings are `x?: T`, and `ProviderResponse` fields and response-model fields a provider may not report are `Option.Option<T>` (`Schema.OptionFromOptionalKey` in the `Schema.Class` models), required, never optional; their exports carry `@since 0.1.0`, the effect-ext release they first ship in. Their tests are `tests/ai/`.

The provider-neutral half of the AI family: the AI service abstractions `effect/ai` lacks (`RerankerModel`, `ClassifierModel`, `SpeechModel`, `TranscriptionModel`, `ImageModel`, `ModerationModel`, `VoiceConversionModel`), each written as if it could merge into `effect/ai`. No HTTP, no provider code.

### Boundary

The seven `src/<Module>.ts` files (`aiModules` in `vite.config.ts`, `aiModuleFiles` in the root one). They import `effect` only, never another effect-ext module; the provider packages (`effect-ai-cohere`, `-voyage`, `-elevenlabs`) and `effect-ai-cloudflare` import them by subpath. Each is a subpath export and a namespace on the `.` barrel. A new module adds its `exports` entry, its name to `aiModules` (and the root `aiModuleFiles`, the coverage glob and `.fallowrc.json`'s `ignoreExports` list), its barrel line and a section in the README table.

### Invariants

- **Every module mirrors `effect/ai`'s `EmbeddingModel`**: a `Context.Service` tag keyed `@thomasfosterau/effect-ext/<Module>`, a `Service` interface, caller `*Options` vs normalised `ProviderOptions` / `ProviderResponse`, `Schema.Class` response and usage models, and a `make(...)` that validates the provider's result and wraps each operation in `Effect.withSpan("<Module>.<operation>")`. `RerankerModel.ts` is the reference.
- **Operations fail only with `AiError`.** A provider result that breaks the contract (an out-of-range or duplicate rerank index, a missing classification, a label outside the caller's set, a moderation score outside `[0, 1]`, empty audio, a segment with `end < start`) fails with an `AiError` whose reason is `InvalidOutputError`, never a defect.
- **Empty input never reaches the provider**: `rerank` with no documents, `classify` / `moderate` with no inputs return an empty response without calling it.
- **`fromLanguageModel` adapters reuse `make`.** `ClassifierModel.fromLanguageModel` and `ModerationModel.fromLanguageModel` prompt through `LanguageModel.generateObject` and feed the decoded value through the same `make` validation as a native provider.
- **No upstream re-export.** `@thomasfosterau/effect-ai-ext`'s barrel re-exported `effect/ai`; effect-ext's does not, and `tests/ai/barrel.test.ts` pins that no abstraction's name exists upstream. One that ever does is the signal to adopt upstream and drop the local module.

## Evals

Merged in from `@thomasfosterau/effect-evals` (published to 0.5.1, then deprecated). It keeps the AI conventions in the root AGENTS.md until someone unifies them, as the AI abstractions do, except the option members (#17): `x?: T` in options objects, `Option.Option<T>` in results (`Result.MetricAggregate.summary`, `ExtractThenClassify.Verdict.reason`). Types that mirror a wire schema's decoded type (`GEvalCase`, `RagCase`) are `Pick`s of it rather than hand-written `| undefined` members; its exports carry `@since 0.1.0`. Its tests are `tests/evals/`.

The Effect-native LLM evaluation toolkit: goldens, eval cases, scorers, thresholds and metrics; a runner with trials, bounded concurrency, retry and a content-hashed cache; reporters; ranking, G-Eval and RAG metrics; and the `effect-evals` CLI that discovers and runs `*.eval.ts` files.

### Boundary

Everything under `src/evals/` (one subpath per module under `./evals/`, listed in `evalsModules` in `vite.config.ts`, plus the `./evals` barrel `src/evals/index.ts`) and the bin `bin/effect-evals.js`. Imports `effect` only, and nothing from the rest of effect-ext; `@effect/platform-node` is imported by `src/evals/cli/main.ts` alone. Builds `dist/evals/cli/main.js` beside the subpaths (not exported). `src/evals/cli/` and `src/evals/index.ts` are excluded from docgen.

### Invariants

- **Node type-strips a consumer's `*.eval.ts` files**, and the toolkit's relative imports carry `.ts`, as the rest of effect-ext's do (`erasableSyntaxOnly` is on workspace-wide).
- **The bin is a flagless launcher with exactly one hop**: `bin/effect-evals.js` re-execs `node --disable-warning=ExperimentalWarning --import <loader.mjs> dist/evals/cli/main.js …argv`, flags as literal argv, never `NODE_OPTIONS` or tsx. The CLI runs as built JavaScript because Node refuses to type-strip under `node_modules`; only the consumer's own `*.eval.ts` files are type-stripped. Never `--no-warnings` (it hides every warning, #81). `bin/**` and `src/evals/cli/loader.mjs` (shipped in `files`) run before any Effect runtime exists, hence their lint override.
- **Credential gating**: an eval file whose `layer` fails with a `Config.ConfigError` is reported as skipped, never failed (`Runner.isConfigError`). The CLI sets `process.exitCode = 1` only when an executed suite misses its threshold.
- **Retry only a retryable `AiError`** (`isRetryable`); any other failure is a typed trial error. A metric that fails is `Errored`, distinct from a `Scored` miss; `ignoreErrors` decides whether it drops out of the aggregate or fails the case.
- **The cache key is data, never code**: a SHA-256 (`crypto.subtle`) of the canonicalised golden, task `id`, metric name, `judgeModelId` and trial. Changing a task's or metric's behaviour means bumping its `id` / name.
- **A reporter never fails the run**: `terminal` and `json` catch their own errors and log a warning.
- **A failed retrieval query is not a zero**: it lands in `taskFailures` and is excluded from every mean; `runRetrievalSuite` is sequential by default and truncates an over-returning port to `k`.

### Terms

- **Golden** — the static, hand-authored case: input, optional expected output, context. **Eval case** — a golden plus the actuals a run produced (`output`, `retrievedContext`, `toolCalls`, `usage`); scorers read eval cases, never bare goldens.
- **Metric** — `{ name, scorer, threshold }`, the unit the runner executes; a **trial** is one end-to-end run of the task and every metric for a case.
- **Eval file** — a `*.eval.ts` default-exporting `{ suites, layer, options? }` (`EvalFile.EvalFile`).
- **Retrieval port** — the consumer-supplied `{ id, retrieve(query, { limit, golden }) }` a retrieval suite measures; its `id` is part of the cache key, and `golden` is the case (a `RetrievalGolden` or a richer golden extending it) for per-case narrowing.
