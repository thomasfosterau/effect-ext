/**
 * `@thomasfosterau/effect-ext/JsonFeed` — a JSON Feed 1.1 document
 * (`feed.json`) built from a feed description and its entries, and served
 * as an `HttpServerResponse` behind the low-churn edge cache.
 *
 * Everything takes a site-root-relative `path` and resolves it on the
 * canonical origin; mapping a resource to its route stays in the
 * application. An absent member is an omitted key, never `null` or
 * `undefined`, so the document a consumer holds is the document it serves.
 *
 * Reading is the other half: `parseJsonFeed` / `decodeJsonFeed` take a
 * JSON Feed 1.0 or 1.1 document as found in the wild into the same
 * {@link JsonFeed} shape, leniently, with a diagnostic for everything they
 * dropped or repaired.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import { compact } from "./internal/json-feed/compact.ts";

// ── The document ───────────────────────────────────────────────────────

/**
 * The `version` every JSON Feed 1.1 document declares.
 *
 * @since 0.1.0
 * @category constants
 */
export const JSON_FEED_VERSION = "https://jsonfeed.org/version/1.1";

/**
 * A JSON Feed author object. JSON Feed requires at least one of `name`,
 * `url` and `avatar`; the type rejects an author with none. On input,
 * `url` and `avatar` may be site-root-relative paths; the built document
 * carries them absolute.
 *
 * @since 0.1.0
 * @category models
 */
export type JsonFeedAuthor =
  | {
      readonly name: string;
      readonly url?: string;
      readonly avatar?: string;
    }
  | {
      readonly name?: string;
      readonly url: string;
      readonly avatar?: string;
    }
  | {
      readonly name?: string;
      readonly url?: string;
      readonly avatar: string;
    };

/**
 * A JSON Feed attachment (an enclosure: a podcast episode's audio, say).
 * `url` and `mime_type` are required; on input to {@link buildJsonFeedItem}
 * `url` may be a site-root-relative path, and the built item carries it
 * absolute.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeedAttachment {
  readonly url: string;
  readonly mime_type: string;
  readonly title?: string;
  readonly size_in_bytes?: number;
  readonly duration_in_seconds?: number;
}

/**
 * A JSON Feed 1.1 item, as {@link buildJsonFeed} emits it: member names are
 * the spec's, every URL is absolute, every date RFC 3339 in UTC.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeedItem {
  readonly id: string;
  readonly url?: string;
  readonly external_url?: string;
  readonly title?: string;
  readonly content_html?: string;
  readonly content_text?: string;
  readonly summary?: string;
  readonly image?: string;
  readonly banner_image?: string;
  readonly date_published?: string;
  readonly date_modified?: string;
  readonly authors?: ReadonlyArray<JsonFeedAuthor>;
  readonly tags?: ReadonlyArray<string>;
  readonly language?: string;
  readonly attachments?: ReadonlyArray<JsonFeedAttachment>;
}

/**
 * A JSON Feed 1.1 document, as {@link buildJsonFeed} emits it.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeed {
  readonly version: typeof JSON_FEED_VERSION;
  readonly title: string;
  readonly home_page_url?: string;
  readonly feed_url?: string;
  readonly description?: string;
  readonly user_comment?: string;
  readonly next_url?: string;
  readonly icon?: string;
  readonly favicon?: string;
  readonly authors?: ReadonlyArray<JsonFeedAuthor>;
  readonly language?: string;
  readonly expired?: boolean;
  readonly items: ReadonlyArray<JsonFeedItem>;
}

// ── Input ──────────────────────────────────────────────────────────────

/**
 * What describes the feed as a whole. Every path-valued member takes a
 * site-root-relative path or an absolute URL and is emitted absolute on
 * `base`.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeedOptions {
  /** The canonical origin every URL is resolved on, never the request origin. */
  readonly base: string;
  readonly title: string;
  readonly description?: string;
  /** The page the feed describes, `home_page_url`. Defaults to `/`. */
  readonly homePath?: string;
  /** The feed's own path, `feed_url`. Defaults to `/feed.json`. */
  readonly feedPath?: string;
  /** The next page of a paginated feed, `next_url`. */
  readonly nextPath?: string;
  /** A note to a human who opens the document, `user_comment`. */
  readonly userComment?: string;
  /** A 512 × 512 image. */
  readonly icon?: string;
  /** A 64 × 64 image. */
  readonly favicon?: string;
  readonly authors?: ReadonlyArray<JsonFeedAuthor>;
  /** A language tag (`en-AU`). */
  readonly language?: string;
  /** `true` when the feed will never update again. */
  readonly expired?: boolean;
}

/**
 * One feed entry: a site-root-relative `path` and what the feed shows of
 * it. JSON Feed requires `content_html` or `content_text` on every item;
 * the type rejects an entry with neither.
 *
 * @since 0.1.0
 * @category models
 */
export type JsonFeedEntry = {
  readonly path: string;
  /** The item's permanent `id`. Defaults to its absolute URL. */
  readonly id?: string;
  /** The URL of the page the item is about, when that is elsewhere. */
  readonly externalUrl?: string;
  readonly title?: string;
  /** Plain text. */
  readonly summary?: string;
  /** The item's main image: a site-root-relative path or an absolute URL. */
  readonly image?: string;
  /** A banner image: a site-root-relative path or an absolute URL. */
  readonly bannerImage?: string;
  /** When the item was first available, `date_published`. */
  readonly publishedAt?: DateTime.DateTime;
  /** When the item last changed, `date_modified`. */
  readonly updatedAt?: DateTime.DateTime;
  /** The item's own authors; absent, it inherits the feed's. */
  readonly authors?: ReadonlyArray<JsonFeedAuthor>;
  readonly tags?: ReadonlyArray<string>;
  readonly language?: string;
  /** Related resources (enclosures); each `url` a site-root-relative path or an absolute URL. */
  readonly attachments?: ReadonlyArray<JsonFeedAttachment>;
} & (
  | { readonly contentHtml: string; readonly contentText?: string }
  | { readonly contentHtml?: string; readonly contentText: string }
);

// ── Building ───────────────────────────────────────────────────────────

const absolute = (base: string, path: string): string => new URL(path, base).toString();

const optionalUrl = (base: string, path?: string): Option.Option<string> =>
  Option.map(Option.fromUndefinedOr(path), (value) => absolute(base, value));

const optionalDate = (date?: DateTime.DateTime): Option.Option<string> =>
  Option.map(Option.fromUndefinedOr(date), DateTime.formatIso);

const authors = (
  base: string,
  people?: ReadonlyArray<JsonFeedAuthor>,
): Option.Option<ReadonlyArray<JsonFeedAuthor>> =>
  Option.map(Option.fromUndefinedOr(people), (list) =>
    Arr.map(list, (person) =>
      compact<JsonFeedAuthor>({
        name: Option.fromUndefinedOr(person.name),
        url: optionalUrl(base, person.url),
        avatar: optionalUrl(base, person.avatar),
      }),
    ),
  );

/**
 * One item on `base` (the canonical origin, never the request origin): its
 * `url` is the absolute URL of `path` (CANON-001), which is also its `id`
 * unless the entry names its own. Dates are RFC 3339 in UTC; absent members
 * are omitted.
 *
 * @example
 * ```ts
 * import * as DateTime from "effect/DateTime"
 * import { buildJsonFeedItem } from "@thomasfosterau/effect-ext/JsonFeed"
 *
 * buildJsonFeedItem("https://example.com", {
 *   path: "/posts/1",
 *   title: "Hello",
 *   contentText: "Hello, world.",
 *   publishedAt: DateTime.makeUnsafe("2026-03-04T05:06:07Z"),
 * })
 * // { id: "https://example.com/posts/1", url: "https://example.com/posts/1", title: "Hello", content_text: "Hello, world.", date_published: "2026-03-04T05:06:07.000Z" }
 * ```
 *
 * @since 0.1.0
 * @category building
 */
export const buildJsonFeedItem = (base: string, entry: JsonFeedEntry): JsonFeedItem => {
  const url = absolute(base, entry.path);
  return compact<JsonFeedItem>({
    id: entry.id ?? url,
    url,
    external_url: optionalUrl(base, entry.externalUrl),
    title: Option.fromUndefinedOr(entry.title),
    content_html: Option.fromUndefinedOr(entry.contentHtml),
    content_text: Option.fromUndefinedOr(entry.contentText),
    summary: Option.fromUndefinedOr(entry.summary),
    image: optionalUrl(base, entry.image),
    banner_image: optionalUrl(base, entry.bannerImage),
    date_published: optionalDate(entry.publishedAt),
    date_modified: optionalDate(entry.updatedAt),
    authors: authors(base, entry.authors),
    tags: Option.fromUndefinedOr(entry.tags),
    language: Option.fromUndefinedOr(entry.language),
    attachments: Option.map(Option.fromUndefinedOr(entry.attachments), (list) =>
      Arr.map(list, (attachment) =>
        compact<JsonFeedAttachment>({
          url: absolute(base, attachment.url),
          mime_type: attachment.mime_type,
          title: Option.fromUndefinedOr(attachment.title),
          size_in_bytes: Option.fromUndefinedOr(attachment.size_in_bytes),
          duration_in_seconds: Option.fromUndefinedOr(attachment.duration_in_seconds),
        }),
      ),
    ),
  });
};

/**
 * The whole JSON Feed 1.1 document: the feed's members and one item per
 * entry in the order given (the caller sorts newest first and bounds the
 * count). Pure. Every URL is absolute on `options.base`, the canonical
 * origin (CANON-001); absent members are omitted.
 *
 * @example
 * ```ts
 * import { buildJsonFeed } from "@thomasfosterau/effect-ext/JsonFeed"
 *
 * const feed = buildJsonFeed(
 *   { base: "https://example.com", title: "Example" },
 *   [{ path: "/posts/1", contentHtml: "<p>Hello</p>" }],
 * )
 * feed.feed_url // "https://example.com/feed.json"
 * feed.items[0]?.id // "https://example.com/posts/1"
 * "description" in feed // false
 * ```
 *
 * @since 0.1.0
 * @category building
 */
export const buildJsonFeed = (
  options: JsonFeedOptions,
  entries: Iterable<JsonFeedEntry>,
): JsonFeed => {
  const { base } = options;
  return compact<JsonFeed>({
    version: JSON_FEED_VERSION,
    title: options.title,
    home_page_url: absolute(base, options.homePath ?? "/"),
    feed_url: absolute(base, options.feedPath ?? "/feed.json"),
    description: Option.fromUndefinedOr(options.description),
    user_comment: Option.fromUndefinedOr(options.userComment),
    next_url: optionalUrl(base, options.nextPath),
    icon: optionalUrl(base, options.icon),
    favicon: optionalUrl(base, options.favicon),
    authors: authors(base, options.authors),
    language: Option.fromUndefinedOr(options.language),
    expired: Option.fromUndefinedOr(options.expired),
    items: Arr.map(Arr.fromIterable(entries), (entry) => buildJsonFeedItem(base, entry)),
  });
};

// ── Serving ────────────────────────────────────────────────────────────

/**
 * The `Content-Type` a JSON Feed is served with.
 *
 * @since 0.1.0
 * @category constants
 */
export const JSON_FEED_CONTENT_TYPE = "application/feed+json";

/**
 * The `Cache-Control` the feed is served with by default: the edge caches
 * the whole document for an hour, so any enumeration behind it runs at most
 * once per hour per edge, and a mutation purges its `Cache-Tag` rather than
 * waiting out the TTL (PERF-CACHE-002). The same value as
 * `@thomasfosterau/effect-ext/Sitemap`'s.
 *
 * @since 0.1.0
 * @category constants
 */
export const LOW_CHURN_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

/**
 * What the served feed is cached under.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeedResponseOptions {
  /** The `Cache-Tag` a mutation purges; absent means untagged. */
  readonly cacheTag?: string;
  /** Defaults to {@link LOW_CHURN_CACHE_CONTROL}. */
  readonly cacheControl?: string;
}

/**
 * A JSON Feed as an `HttpServerResponse`: 2-space pretty-printed (a
 * hand-readable discovery document; changing the indent changes the bytes
 * on the wire and in every cached copy), {@link JSON_FEED_CONTENT_TYPE},
 * {@link LOW_CHURN_CACHE_CONTROL} unless overridden and, when given, the
 * `Cache-Tag`.
 *
 * @example
 * ```ts
 * import * as HttpServerResponse from "effect/http/HttpServerResponse"
 * import { buildJsonFeed, jsonFeedResponse } from "@thomasfosterau/effect-ext/JsonFeed"
 *
 * const feed = buildJsonFeed({ base: "https://example.com", title: "Example" }, [])
 * const response = jsonFeedResponse(feed, { cacheTag: "feed" })
 * response.headers["cache-tag"] // "feed"
 * const text = await HttpServerResponse.toWeb(response).text()
 * text.startsWith('{\n  "version": "https://jsonfeed.org/version/1.1"') // true
 * ```
 *
 * @since 0.1.0
 * @category serving
 */
export const jsonFeedResponse = (
  feed: JsonFeed,
  options: JsonFeedResponseOptions = {},
): HttpServerResponse.HttpServerResponse => {
  const cacheControl = options.cacheControl ?? LOW_CHURN_CACHE_CONTROL;
  // oxlint-disable-next-line effect/avoid-direct-json -- the served document is deliberately 2-space pretty-printed; `Schema.fromJsonString` emits compact JSON with no indent option.
  return HttpServerResponse.text(JSON.stringify(feed, null, 2), {
    contentType: JSON_FEED_CONTENT_TYPE,
    headers:
      options.cacheTag === undefined
        ? { "cache-control": cacheControl }
        : { "cache-control": cacheControl, "cache-tag": options.cacheTag },
  });
};

// ── Reading ────────────────────────────────────────────────────────────

/**
 * Reading a JSON Feed 1.0 or 1.1 document: {@link parseJsonFeed},
 * {@link decodeJsonFeed} and their result and error types.
 *
 * @since 0.1.0
 */
export * from "./json-feed/parse.ts";
