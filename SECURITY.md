# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately via GitHub's [**Report a vulnerability**](https://github.com/thomasfosterau/effect-ext/security/advisories/new) button (Security → Advisories), **not** through public issues.

You can expect an initial response within a few days. Please include a description, reproduction steps, and the affected package and version.

## Credentials

An AI provider client takes its API key only as a `Redacted` value you pass, or one its `layerConfig` loads through `Config.Redacted`; the only implicit read is `@thomasfosterau/effect-ai-gateway`'s `…FromUrl` variants, which load `CF_AIG_TOKEN` through `Config`. The gateway's BYOK routes take no provider key at all. A way for a key to leak into a log line, a span attribute, an error message, or a request to a host other than the configured `apiUrl` is in scope.

## Supply-chain hardening

These packages are published with a hardened, automated pipeline designed to resist supply-chain attacks (e.g. self-propagating npm worms that steal credentials and publish trojanized versions):

- **No long-lived npm token.** Releases use npm [**OIDC Trusted Publishing**](https://docs.npmjs.com/trusted-publishers): GitHub Actions proves its identity to npm with a short-lived, workflow-bound OIDC token. There is no `NPM_TOKEN` secret to steal from CI. The publish step uses the npm CLI directly (`npm publish` of a `pnpm pack` tarball), pinned to an exact npm version in the release job (npm >= 11.5.1 is needed for OIDC, newer than the npm Node 22 bundles) rather than `npm@latest`, which would put whatever the registry serves that day into the job holding `id-token: write`. pnpm 11's `pnpm publish` also performs the OIDC exchange natively; the npm CLI path is kept for now.
- **Provenance.** npm attaches [provenance](https://docs.npmjs.com/generating-provenance-statements) — the statement cryptographically linking an artifact to its source commit and workflow — automatically under trusted publishing when the source repository and the package are both public, as this repository is. Nothing requests it explicitly: do not add `--provenance` or `NPM_CONFIG_PROVENANCE=true`, which would fail the publish if the repository were ever made private.
- **Install scripts disabled in the release job.** The release workflow installs dependencies with `pnpm install --frozen-lockfile --ignore-scripts`, and turns off pnpm 11's `verify-deps-before-run` for that job (`pnpm_config_verify_deps_before_run: "false"`) so a later `pnpm run` / `pnpm exec` cannot silently re-install with scripts (pnpm 11 reads only the `pnpm_config_*` spelling), and `scripts/release.sh` packs with `pnpm pack --config.ignore-scripts=true` (`pnpm pack` has no `--ignore-scripts` flag); a compromised (transitive) dependency cannot execute install hooks in the privileged publish job. CI installs with scripts because the type gate needs the Effect-patched `tsc` that `prepare` produces; `allowBuilds` in `pnpm-workspace.yaml` names the only packages whose install scripts may run.
- **Pinned actions.** All GitHub Actions are pinned to full commit SHAs, so a hijacked tag cannot inject malicious workflow code.
- **Least privilege.** Workflows default to `permissions: {}`; each job opts into only the scopes it needs. CI checks out with `persist-credentials: false`. Outside the Release job, the only write permission is `issues: write` on the scheduled `dependabot-failures` job, which tracks failing Dependabot PRs as issues: it runs from the default branch with the repository's own `GITHUB_TOKEN`, never on a pull-request or Dependabot event, reads check runs and statuses by commit SHA without checking out or running PR code, and passes PR text to the API only as JSON built by `jq`, never through a shell expansion.
- **Manual approval gate.** Publishing runs in a protected `release` environment that requires manual approval.
- **Locked dependencies.** Installs use `pnpm install --frozen-lockfile` against the committed `pnpm-lock.yaml`; Dependabot proposes updates for review. pnpm's `minimumReleaseAge` holds a newly published version for 8 hours before it installs, and Dependabot's `cooldown` waits a day. CI also runs `pnpm audit --audit-level high`.

## Invariant ids

Doc comments, tests and READMEs cite rules from the source applications' specs by id. The table restates the ones effect-utilities' web modules cite (they came with them from thomasfosterau/effect-web), as they apply to those modules; "enforced by" names the export that carries the rule and the test that pins it. A rule enforced by review has no test.

| ID | Rule | Enforced by |
| --- | --- | --- |
| `CACHE-AUTH-003` | A response that resolved a viewer is stamped `Cache-Control: private, no-store` before any shared cache sees it, and a response with no declared `Cache-Control` defaults to `private, no-store`, so heuristic freshness can't cache it. | `cacheControlForViewer`, `ensureCacheControl` (`Web`); `packages/effect-utilities/tests/web/cache-control.test.ts` |
| `CANON-001` | Canonical URLs (every sitemap `<loc>`, feed item `id` / `url`) are absolute on the production origin, never the request origin. | `renderSitemap`, `sitemapStream`, `buildJsonFeed` take `base` (`Sitemap`); `renderRss`, `renderRssItem` (`RssFeed`), `renderAtom`, `renderAtomEntry` (`AtomFeed`), `buildJsonFeed`, `buildJsonFeedItem` (`JsonFeed`) take `base`; `packages/effect-utilities/tests/sitemap/sitemap.test.ts`, `feed.test.ts`, `packages/effect-utilities/tests/{rss,atom,json}-feed/index.test.ts` |
| `CANON-003` | Every response from a non-indexable stage carries `X-Robots-Tag: noindex`. | `stageNoindex` (`Web`); `packages/effect-utilities/tests/web/headers.test.ts` |
| `DISC-009` | Public pages may be served as Markdown from the same URL by content negotiation. | `negotiateRepresentation`, `makeMarkdownPathMatcher` (`Negotiate`); `packages/effect-utilities/tests/web/negotiate.test.ts` |
| `DISC-010` | The change-discovery feed is bounded to the latest changes, not a corpus listing. | `FEED_ITEM_LIMIT` (`Sitemap`); `packages/effect-utilities/tests/sitemap/feed.test.ts` |
| `DISC-011` | Detail-page URLs are stable; the sitemap and feed emit the canonical path the application gives them. | review (`Sitemap` takes paths as given) |
| `JSONAPI-NEG-001`, `-002` | The JSON:API surface is selected by its media type, and the §6 rules answer 406 / 415 for disallowed media-type parameters. | `negotiateRepresentation` over effect-jsonapi's `Middleware` (`Negotiate`); `packages/effect-utilities/tests/web/negotiate.test.ts` |
| `OG-IMG-001` | Share images stay edge-cacheable: they are locale-invariant, so they carry no locale `Vary`. | `isOpenGraphCard`, `LOCALE_INVARIANT_ASSET_PATHS` (`Web`); `packages/effect-utilities/tests/web/headers.test.ts` |
| `PERF-CACHE-001` | Locale- and cookie-invariant asset routes carry no `Vary: Cookie` / `Accept-Language`; an `Accept`-negotiated asset varies on `Accept` alone. | `responseVary`, `classifyRoute` (`Web`); `packages/effect-utilities/tests/web/headers.test.ts` |
| `PERF-CACHE-002` | Low-churn public documents (`robots.txt`, `sitemap.xml`, `feed.json`, `rss.xml`, `atom.xml`) declare an explicit edge TTL and are purged by `Cache-Tag` on mutation. | `LOW_CHURN_CACHE_CONTROL` (`Robots`, `Sitemap`, `RssFeed`, `AtomFeed`, `JsonFeed`), `purgeCacheTags`; `packages/effect-utilities/tests/robots/serving.test.ts`, `packages/effect-utilities/tests/{rss,atom,json}-feed/index.test.ts` |
| `PERF-CACHE-003` | A request with no credential skips session resolution; the skip is reported as `skipped`. | `deriveAuthOutcome` (`Observability`); `packages/effect-utilities/tests/web/observability.test.ts` |
| `PERF-CACHE-005` | A URL shared by HTML and Markdown is cached by a normalized representation token, never the raw `Accept` header. | `Negotiation.representation` (`Negotiate`); `packages/effect-utilities/tests/web/negotiate.test.ts` |
| `ROBOTS-002` … `-004` | The production `robots.txt` opens the site to every crawler, disallows the non-content URL spaces the application lists, and declares an absolute sitemap URL. | `productionBody` (`Robots`); `packages/effect-utilities/tests/robots/serving.test.ts` |
| `ROBOTS-005` | Every non-production stage serves a full-disallow `robots.txt`. | `robotsBody`, `NON_PRODUCTION_BODY` (`Robots`); `packages/effect-utilities/tests/robots/serving.test.ts` |
| `SEC-CSRF-001` | A mutating request dispatched to the JSON:API surface is refused when its `Origin` is present and not the server's own. | `isCrossOriginRejected`, `crossOriginMutationRejection` (`Web`); `packages/effect-utilities/tests/web/cross-origin.test.ts` |
| `SEC-HDR-001` | Every response carries the baseline security headers, each set only when the route didn't. | `securityHeaders` (`Web`); `packages/effect-utilities/tests/web/headers.test.ts` |
| `SEC-SSRF-003` | An outbound fetch re-validates the host and scheme on every redirect hop and on the final URL. | `checkUrl`, `followRedirects`, `fetchFollowingRedirects` (`Net`); `packages/effect-utilities/tests/web/net.test.ts` |
| `SEC-SSRF-005` | A client-supplied `x-forwarded-for` is never trusted as the client IP. | `resolveClientIp` (`Web`); `packages/effect-utilities/tests/web/client-ip.test.ts` |

## Release pipeline

The publishing pipeline and its one-time maintainer setup (trusted publisher, protected `release` environment, branch protection) are documented in [PUBLISHING.md](./PUBLISHING.md).
