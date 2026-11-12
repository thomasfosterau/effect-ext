# Sitemaps and feeds

`Sitemap` (sitemaps, the sitemap index, the `feed.json` adapter and the `Cache-Tag` purge), `RssFeed`, `AtomFeed` and `JsonFeed`. They were `@thomasfosterau/effect-sitemap`, `-rss-feed`, `-atom-feed` and `-json-feed`; see "Moving from effect-web" in the [web guide](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/web.md).

## Sitemap

Sitemap, sitemap index and JSON Feed 1.1 builders for Effect web applications (rendered or streamed), the low-churn edge cache policy they share, and the `Cache-Tag` purge-on-mutation seam.

Invariant ids in doc comments and below (`CANON-001`, `PERF-CACHE-002`, …) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-ext/blob/main/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

### Usage

#### Sitemaps

```ts
import * as Option from "effect/Option";
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
    ...rows.map((row) => ({
      path: `/people/${row.id}`,
      ...Option.match(lastmodOf(row.updatedAt), {
        onNone: () => ({}),
        onSome: (lastmod) => ({ lastmod }),
      }),
    })),
  ]);

// Streamed, one chunk per entry, for a large one (run the enumeration before building the response):
const streamedSitemap = (base: string, entries: ReadonlyArray<SitemapUrl>) =>
  sitemapResponse(base, Stream.fromIterable(entries), { cacheTag: SITEMAP_CACHE_TAG });
```

| Export | What it is |
| --- | --- |
| `SitemapUrl` | `{ path, lastmod?: "YYYY-MM-DD" }`. |
| `lastmodOf(value)` | `Option<string>`: the day of a `Date` or an ISO string; `None` otherwise (leave `lastmod` off the `SitemapUrl` and `<lastmod>` is omitted). A parse, never a clock read. |
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
import * as Option from "effect/Option";
import {
  makePurgeTagsForResourceType,
  purgeCacheTags,
  type CachePurgeContext,
} from "@thomasfosterau/effect-ext/Sitemap";

// The resource types the sitemap and feed enumerate.
const purgeTagsForResourceType = makePurgeTagsForResourceType(["posts", "people"]);

// After a mutation to a resource of `type` (and after the response has gone out):
const purgeAfterMutation = (ctx: CachePurgeContext, type: string) =>
  purgeCacheTags(Option.some(ctx), purgeTagsForResourceType(type));
```

| Export | What it is |
| --- | --- |
| `FEED_CACHE_TAG` (`feed`), `SITEMAP_CACHE_TAG` (`sitemap`) | The tags the responses carry and the purge names. |
| `makePurgeTagsForResourceType(eligibleTypes, tags?)` | `(type) => tags`: both tags for a type the documents enumerate, none otherwise — decided from the type alone, no visibility check (a wasted purge over a missed one). |
| `CachePurgeContext` | The `{ cache?: { purge({ tags }) } }` subset of a Workers `ExecutionContext`; `cache` is absent in local dev. |
| `purgeCacheTags(ctx, tags)` | `ctx` is an `Option<CachePurgeContext>` (`Option.fromUndefinedOr(ctx)` for a platform handle that may be absent). `Effect<void>`: a no-op for no tags or no `cache`; a logged `cache-purge.rejected` (`success: false`) or `cache-purge.failed` (rejection), never a failure — the mutation never sees a dropped purge. The purge half of PERF-CACHE-002. |
| `purgeCacheTagsPromise(ctx, tags)` | The same (`ctx` an `Option`) as a `Promise`, for `ctx.waitUntil`. |
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
