# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately via GitHub's [**Report a vulnerability**](https://github.com/thomasfosterau/effect-ext/security/advisories/new) button (Security → Advisories), **not** through public issues.

You can expect an initial response within a few days. Please include a description, reproduction steps, and the affected package and version.

## Credentials

An AI provider client takes its API key only as a `Redacted` value you pass, or one its `layerConfig` loads through `Config.Redacted`; the only implicit read is `@thomasfosterau/effect-ai-cloudflare`'s `…FromUrl` variants, which load `CF_AIG_TOKEN` through `Config`. Its AI Gateway BYOK routes take no provider key at all. A way for a key to leak into a log line, a span attribute, an error message, or a request to a host other than the configured `apiUrl` is in scope.

## Supply-chain hardening

- **No npm token.** Releases use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) from a protected `release` environment that needs the owner's approval; npm attaches provenance itself. Don't force `--provenance`: it fails from a private repository.
- **No install scripts where it matters.** Release jobs install with `--frozen-lockfile --ignore-scripts`, with no cache, and set `pnpm_config_verify_deps_before_run: "false"` so a later `pnpm run` can't re-install with scripts; `scripts/release.sh` packs with scripts off. `allowBuilds` in `pnpm-workspace.yaml` names the only packages whose install scripts may run anywhere.
- **Pinned actions.** Workflows pin actions by exact tag, locked to commits by `.github/workflows/actions.lock`; the Lockfile workflow and the release's `verify-lockfile` job check it.
- **Least privilege.** Workflows default to `permissions: {}`; checkouts don't persist credentials; CI holds no secrets, so Dependabot PRs run it safely, and the release jobs never run for Dependabot.
- **Delayed updates.** pnpm's `minimumReleaseAge` holds a new version for 8 hours and Dependabot's cooldown for a day. CI runs `pnpm audit --audit-level high`.

## Invariant ids

Doc comments, tests and READMEs cite rules from the source applications' specs by id. The table states the ones effect-ext's web modules cite, as they apply to those modules; "enforced by" names the export that carries the rule and the test that pins it. A rule enforced by review has no test.

| ID | Rule | Enforced by |
| --- | --- | --- |
| `CACHE-AUTH-003` | A response that resolved a viewer is stamped `Cache-Control: private, no-store` before any shared cache sees it, and a response with no declared `Cache-Control` defaults to `private, no-store`, so heuristic freshness can't cache it. | `cacheControlForViewer`, `ensureCacheControl` (`Web`); `packages/effect-ext/tests/web/cache-control.test.ts` |
| `CANON-001` | Canonical URLs (every sitemap `<loc>`, feed item `id` / `url`) are absolute on the production origin, never the request origin. | `renderSitemap`, `sitemapStream`, `buildJsonFeed` take `base` (`Sitemap`); `renderRss`, `renderRssItem` (`RssFeed`), `renderAtom`, `renderAtomEntry` (`AtomFeed`), `buildJsonFeed`, `buildJsonFeedItem` (`JsonFeed`) take `base`; `packages/effect-ext/tests/sitemap/sitemap.test.ts`, `feed.test.ts`, `packages/effect-ext/tests/{rss,atom,json}-feed/index.test.ts` |
| `CANON-003` | Every response from a non-indexable stage carries `X-Robots-Tag: noindex`. | `stageNoindex` (`Web`); `packages/effect-ext/tests/web/headers.test.ts` |
| `DISC-009` | Public pages may be served as Markdown from the same URL by content negotiation. | `negotiateRepresentation`, `makeMarkdownPathMatcher` (`Negotiate`); `packages/effect-ext/tests/web/negotiate.test.ts` |
| `DISC-010` | The change-discovery feed is bounded to the latest changes, not a corpus listing. | `FEED_ITEM_LIMIT` (`Sitemap`); `packages/effect-ext/tests/sitemap/feed.test.ts` |
| `DISC-011` | Detail-page URLs are stable; the sitemap and feed emit the canonical path the application gives them. | review (`Sitemap` takes paths as given) |
| `JSONAPI-NEG-001`, `-002` | The JSON:API surface is selected by its media type, and the §6 rules answer 406 / 415 for disallowed media-type parameters. | `negotiateRepresentation` (`Negotiate`), with the JSON:API rule supplied by effect-jsonapi as a `Representation`; `packages/effect-ext/tests/web/negotiate.test.ts` |
| `OG-IMG-001` | Share images stay edge-cacheable: they are locale-invariant, so they carry no locale `Vary`. | `isOpenGraphCard`, `LOCALE_INVARIANT_ASSET_PATHS` (`Web`); `packages/effect-ext/tests/web/headers.test.ts` |
| `PERF-CACHE-001` | Locale- and cookie-invariant asset routes carry no `Vary: Cookie` / `Accept-Language`; an `Accept`-negotiated asset varies on `Accept` alone. | `responseVary`, `classifyRoute` (`Web`); `packages/effect-ext/tests/web/headers.test.ts` |
| `PERF-CACHE-002` | Low-churn public documents (`robots.txt`, `sitemap.xml`, `feed.json`, `rss.xml`, `atom.xml`) declare an explicit edge TTL and are purged by `Cache-Tag` on mutation. | `LOW_CHURN_CACHE_CONTROL` (`Robots`, `Sitemap`, `RssFeed`, `AtomFeed`, `JsonFeed`), `purgeCacheTags`; `packages/effect-ext/tests/robots/serving.test.ts`, `packages/effect-ext/tests/{rss,atom,json}-feed/index.test.ts` |
| `PERF-CACHE-003` | A request with no credential skips session resolution; the skip is reported as `skipped`. | `deriveAuthOutcome` (`Observability`); `packages/effect-ext/tests/web/observability.test.ts` |
| `PERF-CACHE-005` | A URL shared by HTML and Markdown is cached by a normalized representation token, never the raw `Accept` header. | `Negotiation.representation` (`Negotiate`); `packages/effect-ext/tests/web/negotiate.test.ts` |
| `ROBOTS-002` … `-004` | The production `robots.txt` opens the site to every crawler, disallows the non-content URL spaces the application lists, and declares an absolute sitemap URL. | `productionBody` (`Robots`); `packages/effect-ext/tests/robots/serving.test.ts` |
| `ROBOTS-005` | Every non-production stage serves a full-disallow `robots.txt`. | `robotsBody`, `NON_PRODUCTION_BODY` (`Robots`); `packages/effect-ext/tests/robots/serving.test.ts` |
| `SEC-CSRF-001` | A mutating request dispatched to the JSON:API surface is refused when its `Origin` is present and not the server's own. | `isCrossOriginRejected`, `crossOriginMutationRejection` (`Web`); `packages/effect-ext/tests/web/cross-origin.test.ts` |
| `SEC-HDR-001` | Every response carries the baseline security headers, each set only when the route didn't. | `securityHeaders` (`Web`); `packages/effect-ext/tests/web/headers.test.ts` |
| `SEC-SSRF-003` | An outbound fetch re-validates the host and scheme on every redirect hop and on the final URL. | `checkUrl`, `followRedirects`, `fetchFollowingRedirects` (`Net`); `packages/effect-ext/tests/web/net.test.ts` |
| `SEC-SSRF-005` | A client-supplied `x-forwarded-for` is never trusted as the client IP. | `resolveClientIp` (`Web`); `packages/effect-ext/tests/web/client-ip.test.ts` |

## Release pipeline

The publishing pipeline and its one-time maintainer setup (trusted publisher, protected `release` environment, branch protection) are in [PUBLISHING.md](PUBLISHING.md).
