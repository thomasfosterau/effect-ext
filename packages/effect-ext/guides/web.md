# Web platform

Framework-neutral request / response policies, an SSRF-guarded fetch, structured logging and span tracing, content negotiation and robots.txt. The browser platform services that were here (`Browser`, `BrowserTesting`) are now [`@thomasfosterau/effect-platform-browser`](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-platform-browser). No SvelteKit, Alchemy or Cloudflare dependency. These modules were `@thomasfosterau/effect-web` and its sibling packages; the import map is at the end ("Moving from effect-web"). Feeds and sitemaps are in [feeds](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/feeds.md); URI templates, language tags, CSS, encodings and MIME types are in [text-formats](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/text-formats.md).

## Web, Net, Observability, Negotiate

Framework-neutral web request/response utilities on `effect/http`: cache-control and security headers, Vary, the cross-origin guard, client IP, an SSRF-guarded fetch, structured logging and an allow-listed span tracer, with no SvelteKit, Alchemy or Cloudflare dependency, so it serves a SvelteKit hook, an `HttpApi` middleware or a bare Worker equally.

Invariant ids in doc comments and below (`CACHE-AUTH-003`, `SEC-SSRF-003`, …) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-ext/blob/trunk/docs/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

### Usage

#### A SvelteKit hook

The helpers are written over `effect/http`'s `Headers`, `HttpServerRequest` and `HttpServerResponse`. Three adapters bridge to the Fetch types a SvelteKit `Handle` deals in: `HttpServerRequest.fromWeb` (Effect's own) for a request, `HttpServerResponse.toWeb` (Effect's own) for a whole response, and this package's `updateWebHeaders` / `applyToWebHeaders` for a header policy on a Fetch `Response`. The `*Web` functions (`crossOriginMutationRejectionWeb`, `jsonApiErrorResponseWeb`, `negotiateWebRequest`, `requestForRouterWeb`) are those adapters pre-applied.

```ts
// hooks.server.ts
import type { Handle, RequestEvent } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import * as Option from "effect/Option";
import {
  applyToWebHeaders,
  cacheControlForViewer,
  classifyRoute,
  crossOriginMutationRejectionWeb,
  ensureCacheControl,
  responseVary,
  securityHeaders,
  stageNoindex,
  updateWebHeaders,
} from "@thomasfosterau/effect-ext/Web";
import {
  chooseNegotiatedResponse,
  endpointPaths,
  makeApiPathMatcher,
  makeMarkdownPathMatcher,
  MARKDOWN_MEDIA_TYPE,
  Negotiation,
  negotiateWebRequest,
  type Representation,
} from "@thomasfosterau/effect-ext/Negotiate";

/** What the application supplies. */
interface App {
  readonly apiGroups: Parameters<typeof endpointPaths>[0]; // the served HttpApi groups
  readonly markdownSegments: ReadonlyArray<string>; // e.g. ["posts", "people"]
  readonly indexable: boolean; // true on the production stage only
  readonly authentication: Handle; // resolves `event.locals.user`
  readonly forwardJsonApi: (request: Request) => Promise<Response>;
  readonly renderMarkdown: (event: RequestEvent) => Promise<Option.Option<Response>>;
}

export const makeHandle = (app: App): Handle => {
  // What the server can produce, in priority order. Markdown is served from a
  // content page's own URL; the JSON API at its endpoints, for `ext` / `profile`
  // parameters only (a JSON:API library supplies its own representation).
  const markdown: Representation = {
    mediaType: MARKDOWN_MEDIA_TYPE,
    servesPath: makeMarkdownPathMatcher(app.markdownSegments),
  };
  const jsonApi: Representation = {
    mediaType: "application/vnd.api+json",
    servesPath: makeApiPathMatcher(endpointPaths(app.apiGroups)),
    acceptsParameters: (mediaType) =>
      mediaType.parameters.every(([name]) => name === "ext" || name === "profile"),
  };
  const options = { accept: [markdown, jsonApi], contentType: [jsonApi] };

  // Outermost: the post-`resolve` header stamp lands on the final response.
  const applyHeaders: Handle = async ({ event, resolve }) => {
    const response = await resolve(event);
    applyToWebHeaders(response.headers, (headers) =>
      responseVary(
        stageNoindex(securityHeaders(headers), { indexable: app.indexable }),
        classifyRoute(event.url.pathname),
      ),
    );
    return response;
  };

  // The JSON:API forward, outside the render middleware: a cross-origin
  // mutation is refused (already `private, no-store`); anything else gets the
  // CACHE-AUTH-003 safety net, since `cacheControl` below never sees it.
  const forward: Handle = async ({ event, resolve }) => {
    const verdict = negotiateWebRequest(event.request, options);
    if (verdict._tag === "NotAcceptable" || verdict._tag === "UnsupportedMediaType") {
      return verdict._tag === "NotAcceptable"
        ? new Response("Not Acceptable", { status: 406 })
        : new Response("Unsupported Media Type", { status: 415 });
    }
    if (!Negotiation.$is("Selected")(verdict) || verdict.representation !== jsonApi) {
      return resolve(event);
    }
    const rejected = crossOriginMutationRejectionWeb(event.request);
    if (Option.isSome(rejected)) return rejected.value;
    return updateWebHeaders(await app.forwardJsonApi(event.request), ensureCacheControl);
  };

  // After `authentication` (reads the resolved viewer), before `negotiate`
  // (stamps whichever representation is returned): CACHE-AUTH-003.
  const cacheControl: Handle = async ({ event, resolve }) =>
    updateWebHeaders(await resolve(event), (headers) =>
      cacheControlForViewer(headers, { viewerResolved: event.locals.user !== null }),
    );

  // Innermost: the Markdown representation, or SvelteKit's own render.
  const negotiate: Handle = async ({ event, resolve }) => {
    const verdict = negotiateWebRequest(event.request, options);
    if (Negotiation.$is("Selected")(verdict) && verdict.representation === markdown) {
      return chooseNegotiatedResponse(await app.renderMarkdown(event), () => resolve(event));
    }
    return resolve(event);
  };

  return sequence(applyHeaders, forward, app.authentication, cacheControl, negotiate);
};
```

A response that bypasses the middleware (an auth short-circuit) still gets the safety net: `updateWebHeaders(response, ensureCacheControl)`. A `NotAcceptable` / `UnsupportedMediaType` verdict is answered with the error document your API's library defines (the example uses bare 406 / 415 responses).

### API

#### `Web` — headers, guards, adapters

##### Header policies

Pure `(headers: Headers.Headers) => Headers.Headers` functions; compose them and apply once with `updateHeaders` (an `HttpServerResponse`), `updateWebHeaders` (a Fetch `Response`, cloned only when something changed) or `applyToWebHeaders` (a mutable Fetch `Headers`, in place).

- `securityHeaders(headers)` — the baseline (`SECURITY_HEADER_DEFAULTS`: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`), each only when the route did not set it (SEC-HDR-001).
- `stageNoindex(headers, { indexable })` — `X-Robots-Tag: noindex` on a non-indexable stage (CANON-003). The stage decision is yours; this package reads no environment.
- `appendVary(headers, names)` — idempotent, case-insensitive; the single place that mutates `Vary`.
- `responseVary(headers, routeClass)` / `VARY_BY_ROUTE_CLASS` / `RouteVaryClass` — no `Vary` for a `"locale-invariant"` asset, `Accept` alone for a `"format-negotiated"` one, `Cookie, Accept-Language, Accept` for the `"negotiated"` surface (PERF-CACHE-001).
- `classifyRoute(pathname, classifier?)` — narrowest class first, so a locale-invariant asset never gets a locale `Vary` (PERF-CACHE-001). `classifier.isLocaleInvariantAsset` defaults to `isLocaleInvariantAsset`; `classifier.isFormatNegotiatedAsset` is application-specific (for example `GET /images/<uuid>`) and defaults to none.
- `LOCALE_INVARIANT_ASSET_PATHS`, `isOpenGraphCard`, `isLocaleInvariantAsset`, `makeLocaleInvariantAssetMatcher(paths, ...predicates)` — the default set (icons, the default share card, the public edge-cached documents), the Open Graph card predicate, and the way to build your own matcher. The set and `isOpenGraphCard` keep share images free of a locale `Vary` (OG-IMG-001).
- `ensureCacheControl(headers)` — `Cache-Control: private, no-store` (`PRIVATE_NO_STORE`) when nothing declared one: the CACHE-AUTH-003 safety net for a response that bypasses the viewer-aware policy.
- `cacheControlForViewer(headers, { viewerResolved })` — the viewer-aware policy (CACHE-AUTH-003): a resolved viewer's response is always forced to `private, no-store` (Workers Caching runs ahead of the Worker on a hit, and `Set-Cookie` cannot be relied on as its bypass); an anonymous one falls back to `ensureCacheControl`.

##### Guards and resolvers

- `isCrossOrigin(origin: Option<string>, expectedOrigin)`, `isCrossOriginRejected(request, expectedOrigin)` — the predicate an API applies per route, one for every route (a CSRF guard that differs between routes can't be audited): a present `Origin` that is not the Worker's own is refused; absent passes (a server-to-server caller). `isCrossOriginRejected` is the SEC-CSRF-001 check over a request; `expectedOrigin` is explicit because an `HttpServerRequest`'s `url` is its path. `isCrossOriginRejectedWeb(request, expectedOrigin = new URL(request.url).origin)` is the same check over a Fetch `Request`; never cast a Fetch `Request` to `isCrossOriginRejected`, whose record-shaped `headers` read no `Origin` from a Fetch `Headers`.
- `crossOriginMutationRejection(request, expectedOrigin): Option<HttpServerResponse>` — the front door's SEC-CSRF-001 guard for a dispatched JSON:API request: `Some(403 CROSS_ORIGIN_REJECTED, already private, no-store)` for a cross-origin mutation, `None` to proceed. `crossOriginMutationRejectionWeb(request, expectedOrigin = new URL(request.url).origin)` over Fetch types.
- `resolveClientIp(getClientAddress): Option<string>` — the platform-resolved address or `None`, never the spoofable inbound `x-forwarded-for` (SEC-SSRF-005).
- `describeSessionDegraded(error)` / `SESSION_DEGRADED_LOG_MESSAGE` — what a fail-open session resolution reports: the fixed message plus the error for the Worker log, the error verbatim for the tracker.
- `isMutatingMethod(method)` — `POST` / `PUT` / `PATCH` / `DELETE`.
- `siteBase({ key, fallback }): Effect<string>` — the canonical site base every absolute URL about the site is built on (CANON-001): `key` (`PUBLIC_SITE_URL`) read through the ambient `ConfigProvider`, never the request origin, so a preview host still names production. Total (error channel `never`): a missing key or a provider error yields `fallback`, the application's own production origin; an invalid value yields it too, after a `site-base.invalid` warning. `normalizeSiteBase(value): Option<string>` is the check: an absolute `http(s)` URL with no credentials, path, query or fragment, returned as its origin (no trailing slash).

##### JSON:API seam errors

- `NegotiationError` (`{ status, code, title, detail }`), `CROSS_ORIGIN_REJECTED` (403 `auth.forbidden`), `SERVICE_UNAVAILABLE` (503 `unavailable`), `JSONAPI_MEDIA_TYPE`.
- `jsonApiErrorDocument(error)`, `jsonApiErrorResponse(error): HttpServerResponse`, `jsonApiErrorResponseWeb(error): Response` — the `{ errors: [...], jsonapi: { version: "1.1" } }` document.

#### `Net` — the SSRF guard

- `isBlockedHost(hostname)` — loopback / internal names (trailing root dot normalised), private / link-local / CGNAT IPv4, loopback / ULA / link-local IPv6, IPv4-mapped and NAT64 literals routed through the IPv4 list. A malformed dotted quad is blocked, never allowed.
- `checkUrl(url): Result<URL, UnsafeUrl>` — http(s) only, no embedded credentials, host not blocked (SEC-SSRF-003). `UnsafeUrl` is a tagged error with `reason: "invalid" | "scheme" | "credentials" | "blocked-host"` and fixed message wording, kept stable because callers' tests pin it. `assertAllowedUrl(url): URL` is the same check for plain callers: it throws a plain `Error` carrying the message, whose `cause` is the `UnsafeUrl`.
- `followRedirects(url, init, { maxHops?, fetch? }): Effect<FollowedResponse, UnsafeUrl | RedirectRejected | FetchFailed>` — fetches with `redirect: "manual"`, re-checking the initial URL, every `Location` hop and the final URL (SEC-SSRF-003). `maxHops: 0` refuses any redirect (the shape for a POST). Pass a shared `signal` in `init` so the chain shares one deadline. `fetchFollowingRedirects(url, init, maxHops?, fetch?): Promise<FollowedResponse>` is the same for plain callers, rejecting with a plain `Error` carrying the failure's message, whose `cause` is the tagged `UnsafeUrl` / `RedirectRejected` (a `fetch` failure rejects with the original `fetch` cause instead).

#### `Observability` — the read-path signals on `effect/Logger` and `effect/Tracer`

- `logStructured(payload)` — one flat JSON line through `effect/Logger`, envelope-free (`{"event":…}`, never Effect's logger envelope, so a dashboard query on the flat shape keeps working), unconditional whatever the ambient minimum log level. Safe to call from plain code: it never suspends.
- `spanTracer(trackedSpanNames): Tracer.Tracer` — logs `{ event: "span", name, durationMs, traceId, spanId, ok }` per completed span whose name is in the set, nothing for any other. **The allow-list is a required parameter, never a constant**: it replaces the tracer for the whole per-request layer, where `Effect.withSpan` has hundreds of call sites. Build it once at module scope.
- `logEvent` / `logWarningEvent` / `logErrorEvent(event, fields?)` — `Effect.logInfo` / `logWarning` / `logError` with `{ event, ...fields }` as log annotations. `describeError(error)` renders a failure as `Tag: message`, `Tag`, `message` or `String(error)`.
- `deriveAuthOutcome(facts): AuthOutcome` (`"skipped" | "resolved" | "anonymous" | "degraded"`; `"skipped"` is the credential-less fast path, PERF-CACHE-003) and `logAuthOutcome(durationMs, outcome)` — the `read-path.auth` line.
- `withRequestMetrics(fn, onSettle): Promise<A>` — runs `fn` in a fresh per-request metric scope (its own `Metric.Counter` and `MetricRegistry`, scoped through `AsyncLocalStorage`) and hands `{ count }` to `onSettle` once `fn` settles, resolved or rejected. `incrementRequestMetric(amount = 1)` adds to the active scope from any code, synchronously, and is a no-op outside one; `currentRequestMetrics(): Option<RequestMetrics>` reads it. `countingProxy(client, methodNames: Iterable<string>)` (an array, a `HashSet` or a `Set`, read once) counts each call of a named method on `client`, invoking it with the real client as `this` and returning its result untouched — the per-request query count, an N+1 / waterfall signal. Which methods begin a query is the caller's parameter. Emit the settled count as your own `logStructured` line (`{ event: "read-path.db", dbQueryCount: metrics.count, path }`). On Workers this needs `nodejs_compat` (it imports `node:async_hooks`).

#### `Negotiate` — the negotiation verdict

Nothing about any one media type is built in: you declare the `Representation`s the server can produce and `negotiateRepresentation` says which one a request selects. A JSON:API library supplies its own `Representation` (its `acceptsParameters` is the `ext` / `profile` rule); the 406 / 415 error documents are its too.

- `negotiateRepresentation(request: HttpServerRequest, options: NegotiationOptions): Negotiation` / `negotiateWebRequest(request: Request, options)` — reads (`GET` / `HEAD`) negotiate on `Accept`, trying `options.accept` in priority order; mutating methods on `Content-Type` against `options.contentType`; anything else is `Fallback`. Media types are matched on their WHATWG essence (`MimeType.parse` from `@thomasfosterau/effect-ext/Mime`), so case and whitespace never decide the verdict, and a `Content-Type` that is not a MIME type is `Fallback`.
- `Representation`: `mediaType` (lower-case `type/subtype`), `servesPath?(pathname)` (omitted → every path) and `acceptsParameters?(mediaType: MimeType)` (the instance's media-type parameters, those before `q`; omitted → any).
- `NegotiationOptions`: `accept: ReadonlyArray<Representation>` and `contentType?: ReadonlyArray<Representation>` (omitted → no write selects a representation).
- `Negotiation` (a `Data.TaggedEnum`, with constructors, `$is` and `$match` on the `Negotiation` value): `Selected` (serve `representation`), `Fallback` (serve the default, e.g. HTML), `NotAcceptable` (a read: the client asked for `representation`'s media type at a path it is served on, but every instance carried rejected parameters) and `UnsupportedMediaType` (a write: the `Content-Type` is that media type at a served path, with rejected parameters).
- Ranking: a read selects a representation when a clean (parameters accepted), `q > 0` instance of its media type outranks (≥) every other media type the client offered; ties win and an unparsable `q` reads as `1`. Otherwise the next representation is tried, and `Fallback` follows the last.
- `makeApiPathMatcher(paths)` / `endpointPaths(groups)` / `makeMarkdownPathMatcher(segments)` — build a `servesPath` from the served `HttpApi` groups (so the matcher never drifts from the surface) or from the Markdown route segments (a `<segment>/<id>` page, DISC-009).
- `requestForRouter(request)` / `requestForRouterWeb(request)` — relabels a dispatched write's `Content-Type` to `application/json` for a router that registers JSON payloads under the default encoding.
- `chooseNegotiatedResponse(markdown: Option<A>, onHtml: () => B)` — the Markdown response or the framework's render, which runs only on `None`.
- `MARKDOWN_MEDIA_TYPE`.

## Robots

The Robots Exclusion Protocol (RFC 9309) for Effect: parse, encode and match robots.txt, evaluate a crawl decision with the §2.3.1 failure posture over a pluggable cache, and build the robots.txt a site serves. At its core is the **library**, whose API and behaviour are held stable by its acceptance suite; on top of it sit the **crawler side** (fetch, cache and evaluate another site's robots.txt) and the **serving side** (the robots.txt your own site serves, by stage).

Invariant ids in doc comments and below (`ROBOTS-005`, `PERF-CACHE-002`, …) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-ext/blob/trunk/docs/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

### Usage

#### The library

```ts
import {
  encode,
  getCrawlDelay,
  getSitemaps,
  isAllowed,
  parse,
} from "@thomasfosterau/effect-ext/Robots";

const robotsTxt = parse(`
  User-agent: *
  Disallow: /admin
  Allow: /admin/public
  Crawl-delay: 10

  Sitemap: https://example.com/sitemap.xml
`);

isAllowed(robotsTxt, "MyBot", "/admin"); // false
isAllowed(robotsTxt, "MyBot", "/admin/public"); // true
getCrawlDelay(robotsTxt, "MyBot"); // Option.some(10)
getSitemaps(robotsTxt); // ["https://example.com/sitemap.xml"]
encode(robotsTxt); // the canonical text
```

| Export | What it is |
| --- | --- |
| `Rule`, `RobotGroup`, `RobotsTxt` | `Data.Class` values with structural equality. `RobotGroup.crawlDelay` is an `Option<number>` (required; `Option.none()` when the group has no `Crawl-delay`). |
| `RuleSchema`, `RobotGroupSchema`, `RobotsTxtSchema` | `Schema.instanceOf` of each class. |
| `RobotsTxtFromString` | `Schema.String` → `RobotsTxt`: the parser is the decode, the encoder the encode. `Schema.decodeUnknownEffect(RobotsTxtFromString)(text)` for the Effect form. |
| `parse(text)`, `encode(robotsTxt)` | The synchronous forms. `parse` never throws: unknown lines are ignored, rules before any `User-agent` are dropped, `#` starts a comment, LF, CRLF and a bare CR all end a line (RFC 9309 §2.2). |
| `isAllowed(robotsTxt, userAgent, path)` | Group selection by the longest matching product token (exact or prefix, case-insensitive; `*` matches everything, last); rule selection by the longest matching pattern, `Allow` winning a tie; `*` wildcards and `$` anchors; a query string or fragment on `path` is stripped. No group or no matching rule means allowed. |
| `getCrawlDelay`, `getSitemaps` | The selected group's `Crawl-delay` as an `Option<number>` (`None` when no group matches or it has none); every `Sitemap:` line. |

Group selection follows RFC 9309 §2.2.1: the **product token** matches exactly or as a prefix, never as a **substring** (`userAgent.includes(token)`). A `User-agent: Google` group binds `Googlebot`; a `User-agent: bot` group does not bind `Googlebot`. Both sides are compared by their product token, the leading run of letters, `_` and `-`, so a version or comment is ignored: `User-agent: ExampleBot/1.0` binds the `ExampleBot` crawler, and a crawler passing `ExampleBot/1.0 (+https://…)` finds its `User-agent: ExampleBot` group.

#### The crawler side

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { makeRobotsChecker, memoryRobotsCache } from "@thomasfosterau/effect-ext/Robots";

class CrawlSkipped extends Schema.TaggedError<CrawlSkipped>()("CrawlSkipped", {
  reason: Schema.String,
}) {}

const check = makeRobotsChecker({
  userAgent: "ExampleBot/1.0 (+https://example.com/bot)", // the request header
  userAgentToken: "ExampleBot", // the product token robots.txt names
  cache: memoryRobotsCache(), // or your own KV-backed adapter
});

// Effect<void, CrawlSkipped, HttpClient>
const crawl = (url: string) =>
  Effect.gen(function* () {
    const decision = yield* check(url);
    if (!decision.allowed) return yield* new CrawlSkipped({ reason: decision.reason });
    // … fetch the page, honouring decision.crawlDelaySeconds
  });
```

| Export | What it is |
| --- | --- |
| `fetchRobots(origin, { userAgent, timeout?, maxBytes?, isRefusal? })` | `GET <origin>/robots.txt` through `HttpClient`, with RFC 9309 §2.3.1's failure posture: a 2xx body (capped at `MAX_ROBOTS_BYTES`, §2.5), an empty string for 4xx / no file (`ROBOTS_NO_RESTRICTIONS` — crawl freely), and `ROBOTS_UNAVAILABLE_SENTINEL` for 5xx, a timeout or a transport error (treat as disallow). A failed request that `isRefusal(error)` identifies as the caller's own client refusing it (an SSRF guard, a DNS failure inside it) gives `ROBOTS_REFUSED_SENTINEL` instead: the origin was never asked. Never fails. |
| `RobotsCache<R>` | The per-origin cache seam: `get(origin): Effect<Option<string>, never, R>`, `put(origin, value, ttlSeconds)`. `noRobotsCache` fetches every time; `memoryRobotsCache()` is a `Map` for tests; a persistent adapter (for example Workers KV) lives in the consuming application. |
| `ROBOTS_CACHE_TTL_SECONDS` (24 h), `ROBOTS_UNAVAILABLE_TTL_SECONDS` (1 h) | Cache lifetimes: a body or "no restrictions" lives a day; an unavailable verdict is retried after an hour. |
| `evaluateRobots(robotsTxt, token, path, { maxCrawlDelaySeconds? })` | The crawl decision with the reasons: `{ allowed, matchedPattern: Option<string>, crawlDelaySeconds: Option<number> }`. The path is matched **with** its query string (a `?tab=` can be disallowed) and without its fragment; the crawl delay is capped at `MAX_CRAWL_DELAY_SECONDS` (30) and dropped when not positive. |
| `makeRobotsChecker(options)` | `(url) => Effect<RobotsDecision, never, HttpClient \| R>`: cache lookup → fetch on a miss → cache the body / the sentinel with the right TTL → evaluate. `RobotsDecision` is `{ allowed: true, crawlDelaySeconds }` or `{ allowed: false, reason }` (`ROBOTS_UNAVAILABLE_REASON`, `ROBOTS_REFUSED_REASON`, or `disallowed by robots.txt rule '<pattern>'`). A refusal is never cached, so the next check asks again. |

The checker runs one `HttpClient` request per origin per cache lifetime; that `HttpClient` should be the SSRF-guarded one (`@thomasfosterau/effect-ext/Net`) in an application that crawls user-supplied URLs.

#### The serving side

```ts
// routes/robots.txt/+server.ts
import { LOW_CHURN_CACHE_CONTROL, robotsBody } from "@thomasfosterau/effect-ext/Robots";
import { PUBLIC_SITE_URL, PUBLIC_STAGE } from "$env/static/public";

export const GET = () =>
  new Response(
    robotsBody(PUBLIC_STAGE === "production", {
      disallow: ["/api/", "/auth/"],
      sitemapUrl: `${PUBLIC_SITE_URL}/sitemap.xml`,
    }),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": LOW_CHURN_CACHE_CONTROL,
      },
    },
  );
```

| Export | What it is |
| --- | --- |
| `NON_PRODUCTION_BODY` | `User-agent: *` / `Disallow: /` — every non-production stage is invisible to crawlers, whatever the policy says (ROBOTS-005). |
| `productionBody({ disallow, sitemapUrl, comments? })` | The production document: the comment lines, a `User-agent: *` group with each `disallow` prefix, the `Sitemap:` line. Rendered through `encode`, so it round-trips through `parse`. Open to every crawler, the listed prefixes disallowed, an absolute sitemap URL (ROBOTS-002 … -004). |
| `robotsBody(production, policy)` | The stage switch: `productionBody(policy)` in production, `NON_PRODUCTION_BODY` on every other stage (ROBOTS-005). |
| `LOW_CHURN_CACHE_CONTROL` | `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400` — the edge caches the document an hour (PERF-CACHE-002). |
| `isRobotsBody(value)` | A refinement for a test or a handler. |

## Har

HTTP Archive (HAR 1.2) documents, as browsers' developer tools export them.

### Usage

Read one, and replay it as an `HttpClient` in a test:

```ts
import * as Effect from "effect/Effect";
import { Har } from "@thomasfosterau/effect-ext";

const program = (text: string) =>
  Effect.gen(function* () {
    const har = yield* Har.parse(text);
    const client = Har.replayClient(har);
    const response = yield* client.get("https://example.com/api/items");
    return yield* response.json;
  });
```

Record what a client does, then write the document:

```ts
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import { Har } from "@thomasfosterau/effect-ext";

const recorded = Effect.gen(function* () {
  const client = yield* Har.recordClient(yield* HttpClient.HttpClient);
  yield* client.get("https://example.com/");
  const recorder = yield* Har.Recorder;
  return Har.stringify(yield* recorder.har({ name: "my-app", version: "1.0" }));
}).pipe(Effect.provide([Har.layerRecorder, FetchHttpClient.layer]));
```

`recordServer` is the server side: middleware over an `HttpServerResponse` handler that records each request it serves.

### API

| Export | What it does |
| --- | --- |
| `Har`, `Entry`, `Request`, `Response`, `Content`, `PostData`, `Timings`, `Page`, `Creator`, `Cookie`, `NameValue` | The HAR 1.2 schemas. Optional members are optional keys; the `_` custom fields browsers add are dropped on decode. |
| `parse(text)` | Reads a document; fails `HarError` with `reason` `InvalidJson` or `NotAHar`. |
| `stringify(har)` | Two-space JSON. |
| `make({ creator, entries, pages? })` | A version 1.2 document. |
| `Recorder`, `makeRecorder`, `layerRecorder` | Collects entries: `add`, `entries`, `clear`, `har(creator)`. |
| `RedactedQueryNames` | The query parameter names a recording redacts (a `Context.Reference`). |
| `recordClient(client)` | The client, recording each exchange. The response body is buffered to record it; a stream or form-data request body is noted, not recorded. |
| `recordServer` | Server middleware recording each exchange. The request body is not read (the handler needs it); a stream or form-data response body is noted, not recorded. |
| `replayClient(har)` | A client answering from the first entry with the same method and URL, query included; anything else fails with a `TransportError`. |

Recorded headers named in `Headers.CurrentRedactedNames` (by default `authorization`, `cookie`, `set-cookie` and the like) and query parameters named in `RedactedQueryNames` (by default Effect's signed-URL names: `Signature`, `sig`, …) are written as `"<redacted>"`, so a recording can be shared. Text-like bodies (`text/*`, JSON, XML, form-encoded) are recorded as text, anything else as base64. Timings are the whole exchange in `wait`: an `HttpClient` exposes no finer phases.

## Warc

Web ARChive (WARC 1.0 / 1.1, ISO 28500) files, as crawlers and web archives write them.

### Usage

Read a file's records as they arrive, without holding the file:

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Warc } from "@thomasfosterau/effect-ext";

const targets = (bytes: Stream.Stream<Uint8Array>) =>
  Warc.decodeStream(bytes).pipe(
    Stream.filter((record) => Option.contains(Warc.field(record, "WARC-Type"), "response")),
    Stream.map((record) => Warc.field(record, "WARC-Target-URI")),
    Stream.runCollect,
  );
```

Record what a client does, then write the file:

```ts
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import { Warc } from "@thomasfosterau/effect-ext";

const recorded = Effect.gen(function* () {
  const recorder = yield* Warc.Recorder;
  yield* recorder.add([yield* Warc.warcinfo({ fields: [["software", "my-app/1.0"]] })]);
  const client = yield* Warc.recordClient(yield* HttpClient.HttpClient);
  yield* client.get("https://example.com/");
  return yield* recorder.bytes;
}).pipe(Effect.provide([Warc.layerRecorder, FetchHttpClient.layer]));
```

`recordServer` is the server side, as `Har`'s is.

### API

| Export | What it does |
| --- | --- |
| `WarcRecord` | `{ version, fields, block }`: the fields in order, with their case kept. |
| `field(record, name)` | The first value of a field, compared without case, as an `Option`. |
| `parse(bytes)` | Every record of an uncompressed file; fails `WarcError` with a `reason` and the byte `offset` of the record. |
| `decodeStream(bytes)` | The same, from a byte stream, a record at a time. |
| `encode(record)`, `encodeAll(records)` | One record, or a file. `Content-Length` is always the block's length. `Stream.map(Warc.encode)` writes a stream of records. |
| `makeRecord({ type, block, fields?, contentType?, version?, date?, id? })` | A record with `WARC-Type`, a fresh `WARC-Record-ID`, `WARC-Date` (from `Clock`) and `Content-Length`. |
| `warcinfo({ fields, filename?, version? })` | The `warcinfo` record a file opens with. |
| `Recorder`, `makeRecorder`, `layerRecorder` | Collects records: `add`, `records`, `clear`, `bytes`. |
| `RedactedQueryNames` | The query parameter names a recording redacts; the same reference as `Har`'s. |
| `recordClient(client, { version? })`, `recordServer` | Record each exchange as a `response` record and a `request` record joined by `WARC-Concurrent-To`. |

Files are read and written uncompressed: for a `.warc.gz`, pipe each record through a `CompressionStream("gzip")` (one member per record) or the file through a `DecompressionStream`. Digests (`WARC-Block-Digest`, `WARC-Payload-Digest`) are not computed; pass them in `fields`. A recorded HTTP block holds the body as the client saw it, decoded where `fetch` decoded it, so `Content-Encoding` and `Transfer-Encoding` are dropped and `Content-Length` rewritten to match; a body that was not recorded (a stream, form data, or a server request body the handler owns) is marked `WARC-Truncated: unspecified`. Headers and query parameters are redacted as in `Har`.

## Moving from effect-web

Each `@thomasfosterau/effect-web` entry point, and each of its sibling packages, is now one subpath here with the same exports, so a move is an import change:

| Was | Now |
| --- | --- |
| `@thomasfosterau/effect-web` | `@thomasfosterau/effect-ext/Web` |
| `@thomasfosterau/effect-web/net` | `@thomasfosterau/effect-ext/Net` |
| `@thomasfosterau/effect-web/observability` | `@thomasfosterau/effect-ext/Observability` |
| `@thomasfosterau/effect-web/negotiate` | `@thomasfosterau/effect-ext/Negotiate` |
| `@thomasfosterau/effect-web/service-worker` | `@thomasfosterau/effect-platform-service-worker` (`Caches`, `Events`, `Fetch`, `Notifications`) |
| `@thomasfosterau/effect-web/browser` | `@thomasfosterau/effect-platform-browser` (one namespace per service; `layer` is `Browser.layer`) |
| `@thomasfosterau/effect-web/testing` | `@thomasfosterau/effect-platform-browser/BrowserTesting` |
| `@thomasfosterau/effect-robots` | `@thomasfosterau/effect-ext/Robots` |
| `@thomasfosterau/effect-sitemap` | `@thomasfosterau/effect-ext/Sitemap` |
| `@thomasfosterau/effect-rss-feed` | `@thomasfosterau/effect-ext/RssFeed` |
| `@thomasfosterau/effect-atom-feed` | `@thomasfosterau/effect-ext/AtomFeed` |
| `@thomasfosterau/effect-json-feed` | `@thomasfosterau/effect-ext/JsonFeed` |
| `@thomasfosterau/effect-uri-template` | `@thomasfosterau/effect-ext/UriTemplate` |
| `@thomasfosterau/effect-langtag` | `@thomasfosterau/effect-ext/Langtag` |
| `@thomasfosterau/effect-langtag/registry` | `@thomasfosterau/effect-ext/LangtagRegistry` |
| `@thomasfosterau/effect-css` | `@thomasfosterau/effect-ext/Css` |
| `@thomasfosterau/effect-encoding` | `@thomasfosterau/effect-ext/Encoding` |
| `@thomasfosterau/effect-encoding/{japanese,gb18030,big5,euc-kr}` | `@thomasfosterau/effect-ext/Encoding{Japanese,Gb18030,Big5,EucKr}` |
| `@thomasfosterau/effect-mime` | `@thomasfosterau/effect-ext/Mime` |

Two things change beyond the path: the `effect` peer range is `^4.0.0` (effect-web's was `>=4.0.0-rc.118`), and each service's `Context` key moved with it (`@thomasfosterau/effect-web/browser/Locks` is now `@thomasfosterau/effect-platform-browser/Locks`), so a layer built from the old package does not satisfy a service from the new one. Move every import at once.
