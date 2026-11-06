---
"@thomasfosterau/effect-utilities": minor
---

The web-platform modules of `@thomasfosterau/effect-web` and its sibling packages join `@thomasfosterau/effect-utilities` (merged in from thomasfosterau/effect-web with their history). Each former entry point is one subpath with the same exports, so moving is an import change:

- `Web` (was `@thomasfosterau/effect-web`) — response-header policies, the cross-origin mutation guard, the trusted client address, the degraded-session report, `siteBase`, the JSON:API guard responses and the Fetch adapters.
- `Net` (`effect-web/net`) — the SSRF host block list and the redirect-revalidating fetch.
- `Observability` (`effect-web/observability`) — the structured JSON-line sink, the allow-listed span tracer, the `logEvent` trio, `describeError`, the auth-outcome signal and per-request metrics.
- `Negotiate` (`effect-web/negotiate`) — the HTML / JSON:API / Markdown dispatch verdict.
- `ServiceWorker` (`effect-web/service-worker`) — Cache Storage as effects, the caching strategies, the route table and lifecycle listeners.
- `Browser` and `BrowserTesting` (`effect-web/browser`, `effect-web/testing`) — browser platform APIs as services, and an in-memory double for each.
- `Robots` (`@thomasfosterau/effect-robots`), `Sitemap` (`effect-sitemap`), `RssFeed`, `AtomFeed` and `JsonFeed` (`effect-rss-feed`, `effect-atom-feed`, `effect-json-feed`).
- `UriTemplate` (`effect-uri-template`), `Langtag` and `LangtagRegistry` (`effect-langtag`, `effect-langtag/registry`), `Css` (`effect-css`), `Mime` (`effect-mime`), and `Encoding` with `EncodingJapanese`, `EncodingGb18030`, `EncodingBig5` and `EncodingEucKr` (`effect-encoding` and its CJK entries).

Three optional peers come with them, each needed only by the modules that import it: `@effect/platform-browser` `>=4.0.0` (`Browser`, `BrowserTesting`), `@thomasfosterau/effect-jsonapi` `>=0.16.1` (`Negotiate`) and `@thomasfosterau/effect-parse` `^0.4.1` (`Robots`). Those four modules are subpaths only; the `.` barrel re-exports the other 18 as namespaces.

Coming from effect-web, two things change besides the import path. The `effect` peer floor is `>=4.0.0` (effect-web's was `>=4.0.0-rc.118`). Each service's `Context` key moves too (`@thomasfosterau/effect-web/browser/Locks` becomes `@thomasfosterau/effect-utilities/Browser/Locks`), so a layer from the old package does not provide the new service.
