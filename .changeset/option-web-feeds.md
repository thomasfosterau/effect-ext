---
"@thomasfosterau/effect-ext": minor
---

Option for absent values in `JsonFeed`, `RssFeed`, `AtomFeed` and `Sitemap` (#17). The rendered bytes are unchanged, and an absent member is still an omitted key. Optional input members are now `x?: T` with no `| undefined` (the package builds with `exactOptionalPropertyTypes`): a caller holding `undefined` omits the key instead of passing it. This reaches `JsonFeedOptions`, `JsonFeedEntry`, `JsonFeedAuthor`, `JsonFeedAttachment`, `JsonFeedResponseOptions`, `RssChannel`, `RssItem`, `RssResponseOptions`, `AtomPerson`, `AtomFeedOptions`, `AtomEntry`, `AtomResponseOptions`, and `Sitemap`'s `SitemapUrl`, `DocumentCacheOptions`, `JsonFeedOptions` and `CachePurgeContext`. `FeedEntry.title` / `summary` stay `string | null` (the SQL wire shape) but are no longer `| undefined`. The `JsonFeed`, `JsonFeedItem` documents (built and read) keep their native optional members: they are the JSON Feed wire shape.

Changed signatures:

- `Sitemap.lastmodOf(value)`: `string | undefined` → `Option<string>`. Spread it into the entry, `...Option.match(lastmodOf(d), { onNone: () => ({}), onSome: (lastmod) => ({ lastmod }) })`, instead of `lastmod: lastmodOf(d)`.
- `Sitemap.purgeCacheTags(ctx, tags)` and `purgeCacheTagsPromise(ctx, tags)`: `ctx: CachePurgeContext | undefined` → `ctx: Option<CachePurgeContext>`. Pass `Option.fromUndefinedOr(ctx)`.
- `Sitemap.CachePurgeContext.cache`: `cache?: {...} | undefined` → `cache?: {...}`.
