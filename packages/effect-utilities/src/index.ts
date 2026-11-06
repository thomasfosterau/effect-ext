/**
 * `@thomasfosterau/effect-utilities` — extensions to the Effect standard
 * library: Allocator-backed binary data (layouts, buffer structs, vectors,
 * struct-of-arrays, Rust-style UTF-8 strings), Schema helpers (the update
 * tri-state, issue → JSON Pointer, bounded codecs, ids, exact literal tuples,
 * introspection, typed URLs) and web-platform building blocks (request /
 * response policies, fetch safety, negotiation, service workers, browser
 * services, robots.txt, sitemaps and feeds, URI Templates, language tags,
 * CSS, encodings, MIME types). Each module is also its own entry point
 * (`@thomasfosterau/effect-utilities/Vec`, …); this barrel re-exports them as
 * namespaces, except the four modules that import an optional peer —
 * `Browser` and `BrowserTesting` (`@effect/platform-browser`), `Negotiate`
 * (`@thomasfosterau/effect-jsonapi`) and `Robots`
 * (`@thomasfosterau/effect-parse`) — which are subpaths only, so importing
 * the barrel never needs a peer the consumer did not install.
 *
 * @copyright Thomas Foster
 * @since 0.1.0
 */

/**
 * The `Allocator` service hands out blocks of `ArrayBuffer` memory.
 *
 * @since 0.1.0
 */
export * as Allocator from "./Allocator.ts";

/**
 * Schema introspection by AST and behavioural decode probe.
 *
 * @since 0.1.0
 */
export * as Ast from "./Ast.ts";

/**
 * An Atom (RFC 4287) feed, rendered and served.
 *
 * @since 0.1.0
 */
export * as AtomFeed from "./AtomFeed.ts";

/**
 * Bounded pagination and id-list schemas for list inputs.
 *
 * @since 0.1.0
 */
export * as Bounded from "./Bounded.ts";

/**
 * Structs backed by `ArrayBuffer` memory.
 *
 * @since 0.1.0
 */
export * as BufferStruct from "./BufferStruct.ts";

/**
 * CSS Syntax 3 parsing, CSS Color 4/5 colours, lengths, fonts, text and serialisation.
 *
 * @since 0.1.0
 */
export * as Css from "./Css.ts";

/**
 * The WHATWG Encoding Standard: labels, BOM sniffing, fatal decoding and encoding.
 *
 * @since 0.1.0
 */
export * as Encoding from "./Encoding.ts";

/**
 * The opt-in Big5 index for `Encoding`.
 *
 * @since 0.1.0
 */
export * as EncodingBig5 from "./EncodingBig5.ts";

/**
 * The opt-in EUC-KR index for `Encoding`.
 *
 * @since 0.1.0
 */
export * as EncodingEucKr from "./EncodingEucKr.ts";

/**
 * The opt-in gb18030 indexes for `Encoding`.
 *
 * @since 0.1.0
 */
export * as EncodingGb18030 from "./EncodingGb18030.ts";

/**
 * The opt-in Japanese indexes for `Encoding`.
 *
 * @since 0.1.0
 */
export * as EncodingJapanese from "./EncodingJapanese.ts";

/**
 * UUID, branded-UUID ids and slugs.
 *
 * @since 0.1.0
 */
export * as Ids from "./Ids.ts";

/**
 * Schema issue trees → RFC 6901 JSON Pointers.
 *
 * @since 0.1.0
 */
export * as Issues from "./Issues.ts";

/**
 * A JSON Feed 1.1 document, rendered, served and parsed.
 *
 * @since 0.1.0
 */
export * as JsonFeed from "./JsonFeed.ts";

/**
 * BCP 47 language tags and language-range matching.
 *
 * @since 0.1.0
 */
export * as Langtag from "./Langtag.ts";

/**
 * BCP 47 validity and canonicalisation against the IANA subtag registry.
 *
 * @since 0.1.0
 */
export * as LangtagRegistry from "./LangtagRegistry.ts";

/**
 * Binary layouts: how values are laid out in memory.
 *
 * @since 0.1.0
 */
export * as Layout from "./Layout.ts";

/**
 * Literal tuples checked to cover a union exactly.
 *
 * @since 0.1.0
 */
export * as LiteralExact from "./LiteralExact.ts";

/**
 * MIME types, MIME sniffing and `data:` URLs.
 *
 * @since 0.1.0
 */
export * as Mime from "./Mime.ts";

/**
 * The SSRF host block list and a redirect-revalidating fetch.
 *
 * @since 0.1.0
 */
export * as Net from "./Net.ts";

/**
 * Structured logging, span logging and request metrics on Effect's `Logger` and `Tracer`.
 *
 * @since 0.1.0
 */
export * as Observability from "./Observability.ts";

/**
 * An RSS 2.0 feed, rendered and served.
 *
 * @since 0.1.0
 */
export * as RssFeed from "./RssFeed.ts";

/**
 * Service-worker caching strategies, precaching and event plumbing on Effect.
 *
 * @since 0.1.0
 */
export * as ServiceWorker from "./ServiceWorker.ts";

/**
 * Sitemaps and sitemap indexes, the JSON Feed adapter and cache-tag purging.
 *
 * @since 0.1.0
 */
export * as Sitemap from "./Sitemap.ts";

/**
 * An immutable UTF-8 string slice, like Rust's `str`.
 *
 * @since 0.1.0
 */
export * as Str from "./Str.ts";

/**
 * A growable, mutable UTF-8 string, like Rust's `String`.
 *
 * @since 0.1.0
 */
export * as String from "./String.ts";

/**
 * A growable struct-of-arrays container backed by `ArrayBuffer` memory.
 *
 * @since 0.1.0
 */
export * as StructOfArrays from "./StructOfArrays.ts";

/**
 * The update tri-state: field schemas and readers.
 *
 * @since 0.1.0
 */
export * as TriState from "./TriState.ts";

/**
 * URI Templates (RFC 6570), the `Link` header and `/.well-known/` URIs.
 *
 * @since 0.1.0
 */
export * as UriTemplate from "./UriTemplate.ts";

/**
 * Absolute URLs whose scheme, host, port, credentials and path are part of
 * their type.
 *
 * @since 0.1.0
 */
export * as Url from "./Url.ts";

/**
 * A growable array backed by `ArrayBuffer` memory, like Rust's `Vec<T>`.
 *
 * @since 0.1.0
 */
export * as Vec from "./Vec.ts";

/**
 * Framework-neutral request / response policies: headers, cache control, cross-origin, client IP, sessions.
 *
 * @since 0.1.0
 */
export * as Web from "./Web.ts";
