/**
 * The content-negotiation **verdict** a web front door makes for a URL space
 * shared between several representations (rendered pages, a JSON API, an
 * alternate Markdown form): which of the representations the server can
 * produce a request selects, decided from the request line and headers alone,
 * and nowhere else.
 *
 * The caller describes what it can serve as {@link Representation}s: a media
 * type, optionally the paths it is served at and the media-type parameters
 * it accepts. Nothing about any particular media type is built in, so a
 * profile such as JSON:API's (only `ext` / `profile` parameters, declared
 * `ext` URIs) is a caller's `acceptsParameters`, not a default here.
 * {@link negotiateRepresentation} answers with a {@link Negotiation}:
 * `Selected` (serve that representation), `Fallback` (serve the default,
 * typically HTML), or a refusal (`NotAcceptable` for a read,
 * `UnsupportedMediaType` for a write) when the client named a served media
 * type but every instance carried parameters the representation rejects.
 *
 * Reads (`GET` / `HEAD`) negotiate on `Accept`, trying `options.accept` in
 * priority order: a representation is selected when an acceptable (`q > 0`)
 * instance of its media type outranks (≥) every other media type the client
 * offered. Writes (`POST` / `PUT` / `PATCH` / `DELETE`) negotiate on
 * `Content-Type` against `options.contentType`. Anything else is `Fallback`.
 *
 * Media types are compared as WHATWG MIME types (MIME Sniffing §4), by
 * `@thomasfosterau/effect-ext/Mime`'s `MimeType`: an `Accept` instance or a
 * `Content-Type` is parsed and matched on its essence (`type/subtype`, ASCII
 * lower-cased), so case and HTTP whitespace never decide a verdict, and a
 * `Content-Type` that is not a MIME type at all carries no media type. The
 * parameters handed to `acceptsParameters` are those before `q` (RFC 9110
 * §12.4.2: `q` ends the media type's parameter list, so what follows it is
 * an accept-extension, never a media-type parameter).
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Headers from "effect/http/Headers";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { MimeType } from "./Mime.ts";
import { isMutatingMethod } from "./web/jsonapi-error.ts";

/**
 * The media type of the Markdown representation served to agents on
 * `Accept: text/markdown`.
 *
 * @since 0.1.0
 * @category constants
 */
export const MARKDOWN_MEDIA_TYPE = "text/markdown";

/**
 * One representation the server can produce for a URL: a media type, where
 * it is served and which media-type parameters it accepts. A caller's own
 * value (for instance a Markdown form, or a JSON API with its parameter
 * rules); the verdict only ever returns the very value it was given.
 *
 * @since 0.1.0
 * @category models
 */
export interface Representation {
  /** Its media type's essence, lower-case `type/subtype` (e.g. `"text/markdown"`). */
  readonly mediaType: string;
  /** Whether this representation is served at a request path. Omitted → every path. */
  readonly servesPath?: (pathname: string) => boolean;
  /**
   * Whether a requested instance of this media type, with its media-type
   * parameters (those before `q`, RFC 9110 §12.4.2), is acceptable. Omitted →
   * any parameters.
   */
  readonly acceptsParameters?: (mediaType: MimeType.MimeType) => boolean;
}

/**
 * What the verdict needs to know about the application: the representations
 * a read may select on `Accept` and those a write may select on
 * `Content-Type`.
 *
 * @since 0.1.0
 * @category models
 */
export interface NegotiationOptions {
  /** Representations a read (`GET` / `HEAD`) may select on `Accept`, in priority order. */
  readonly accept: ReadonlyArray<Representation>;
  /** Representations a write (`POST` / `PUT` / `PATCH` / `DELETE`) may select on `Content-Type`. Omitted → none. */
  readonly contentType?: ReadonlyArray<Representation>;
}

/**
 * The outcome of negotiating one request.
 *
 * - `Selected` — serve this representation.
 * - `Fallback` — no representation applies; serve the default (e.g. HTML).
 * - `NotAcceptable` — a read: the client asked for this media type at a path
 *   it is served on, but every instance carried rejected parameters.
 * - `UnsupportedMediaType` — a write: the `Content-Type` is this media type
 *   at a served path, with rejected parameters.
 *
 * @since 0.1.0
 * @category models
 */
export type Negotiation = Data.TaggedEnum<{
  Selected: { readonly representation: Representation };
  Fallback: object;
  NotAcceptable: { readonly representation: Representation };
  UnsupportedMediaType: { readonly representation: Representation };
}>;

/**
 * Constructors, `$is` guards and `$match` for {@link Negotiation}.
 *
 * @example
 * ```ts
 * import { Negotiation } from "@thomasfosterau/effect-ext/Negotiate"
 *
 * const markdown = { mediaType: "text/markdown" }
 * const verdict = Negotiation.Selected({ representation: markdown })
 * Negotiation.$is("Selected")(verdict) // true
 * Negotiation.$match(verdict, {
 *   Selected: ({ representation }) => representation.mediaType,
 *   Fallback: () => "text/html",
 *   NotAcceptable: () => "406",
 *   UnsupportedMediaType: () => "415",
 * }) // "text/markdown"
 * ```
 *
 * @since 0.3.0
 * @category constructors
 */
export const Negotiation = /* @__PURE__ */ Data.taggedEnum<Negotiation>();

// ── Known-endpoint path matching ────────────────────────────────────

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compile one HttpApi endpoint path (`/posts/:id`, `/posts/`, …) into a
 * matcher: `:param` segments become a single-segment wildcard and a
 * trailing slash is optional. `None` for a root (`/`) path, which would
 * over-match every URL.
 */
const routePatternToRegExp = (path: string): Option.Option<RegExp> => {
  const segments = path
    .replace(/\/+$/, "")
    .split("/")
    .filter((segment) => segment !== "");
  if (Arr.isReadonlyArrayEmpty(segments)) return Option.none();
  const body = segments
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : escapeRegExp(segment)))
    .join("/");
  return Option.some(new RegExp(`^/${body}/?$`));
};

/**
 * Builds a path predicate (a representation's `servesPath`) from the api's endpoint paths (`/posts`,
 * `/posts/:id`, `/lists/:id/items`, …): a request path matches when it
 * matches any of them, so adding an endpoint updates the predicate with no
 * second list of paths to maintain. Derive the list from the served `HttpApi`
 * itself (see {@link endpointPaths}): a group that is served but unmatched
 * 404s every browser-issued request for it at the front door while the
 * server-side path keeps working.
 *
 * @example
 * ```ts
 * import { makeApiPathMatcher } from "@thomasfosterau/effect-ext/Negotiate"
 *
 * const isApiPath = makeApiPathMatcher(["/posts", "/posts/:id", "/"])
 * isApiPath("/posts/") // true
 * isApiPath("/posts/42") // true
 * isApiPath("/posts/42/edit") // false
 * isApiPath("/") // false — a root path would over-match and is ignored
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeApiPathMatcher = (paths: Iterable<string>): ((pathname: string) => boolean) => {
  const patterns = Arr.getSomes(Arr.map(Arr.fromIterable(paths), routePatternToRegExp));
  return (pathname) => patterns.some((pattern) => pattern.test(pathname));
};

/**
 * The endpoint paths of a set of `HttpApiGroup`s, read structurally
 * (`group.endpoints[name].path`) so the matcher always tracks the served
 * surface.
 *
 * @example
 * ```ts
 * import { endpointPaths, makeApiPathMatcher } from "@thomasfosterau/effect-ext/Negotiate"
 *
 * const groups = [{ endpoints: { list: { path: "/posts" }, get: { path: "/posts/:id" } } }]
 * endpointPaths(groups) // ["/posts", "/posts/:id"]
 * makeApiPathMatcher(endpointPaths(groups))("/posts/1") // true
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const endpointPaths = (
  groups: Iterable<{ readonly endpoints: Readonly<Record<string, { readonly path: string }>> }>,
): ReadonlyArray<string> =>
  Arr.flatMap(Arr.fromIterable(groups), (group) =>
    Record.values(group.endpoints).map((endpoint) => endpoint.path),
  );

/**
 * Builds a path predicate (a representation's `servesPath`) from the content **route** segments
 * that serve a Markdown representation: a single `<segment>/<id>` path whose
 * segment is in the list, so the Markdown is served from the page's own URL
 * (DISC-009). An empty list matches nothing, so `text/markdown` always falls
 * through to HTML.
 *
 * @example
 * ```ts
 * import { makeMarkdownPathMatcher } from "@thomasfosterau/effect-ext/Negotiate"
 *
 * const isMarkdownPath = makeMarkdownPathMatcher(["posts", "notes"])
 * isMarkdownPath("/posts/42") // true
 * isMarkdownPath("/posts/42/") // true
 * isMarkdownPath("/posts") // false
 * isMarkdownPath("/about") // false
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeMarkdownPathMatcher = (
  segments: Iterable<string>,
): ((pathname: string) => boolean) => {
  const list = Arr.fromIterable(segments).map(escapeRegExp);
  if (Arr.isReadonlyArrayEmpty(list)) return () => false;
  const pattern = new RegExp(`^/(?:${list.join("|")})/[^/]+/?$`);
  return (pathname) => pattern.test(pathname);
};

// ── Accept ranking ──────────────────────────────────────────────────

/**
 * One `Accept` instance: its media range's essence (`None` when the range is
 * not a MIME type: it then matches no representation, but still competes as
 * another media type), its media type with the parameters before `q` (parsed
 * as a MIME type) and its weight.
 */
interface AcceptInstance {
  readonly mediaType: Option.Option<MimeType.MimeType>;
  readonly weight: number;
}

/** Whether an `Accept` instance's media range is exactly `mediaType`. */
const isEssence =
  (mediaType: string) =>
  (instance: AcceptInstance): boolean =>
    Option.contains(Option.map(instance.mediaType, MimeType.essence), mediaType);

const paramName = (param: string): string => (param.split("=")[0] ?? "").trim().toLowerCase();

const isQ = (param: string): boolean => paramName(param) === "q";

/**
 * The weight of an `Accept` instance: its first `q`, which defaults to `1`
 * when absent AND when unparsable. This module's choice, pinned by its tests:
 * a client that mangles its `q` still ties rather than being read as
 * refusing, because a malformed weight is a client bug, not a statement that
 * the representation is unacceptable.
 */
const weightOf = (params: ReadonlyArray<string>): number =>
  Option.match(Arr.findFirst(params, isQ), {
    onNone: () => 1,
    onSome: (param) => {
      const value = Number.parseFloat(param.split("=")[1] ?? "");
      return Number.isFinite(value) ? value : 1;
    },
  });

/**
 * Splits an `Accept` header into its instances. Each part is trimmed and
 * empty `;` parts (a trailing `;`) are dropped first, so a stray separator is
 * harmless. The media type is the prefix before the first `q` parameter
 * (RFC 9110 §12.4.2: what follows `q` is an accept-extension, never a
 * media-type parameter); the weight is the first `q`.
 */
const parseAccept = (header: Option.Option<string>): ReadonlyArray<AcceptInstance> =>
  Option.match(header, {
    onNone: () => [],
    onSome: (value) =>
      Arr.getSomes(
        value.split(",").map((raw) => {
          const parts = raw
            .split(";")
            .map((part) => part.trim())
            .filter((part) => part !== "");
          const [type, ...params] = parts;
          if (type === undefined) return Option.none();
          const qIndex = params.findIndex(isQ);
          const mediaParams = qIndex === -1 ? params : params.slice(0, qIndex);
          return Option.some({
            mediaType: MimeType.parse([type, ...mediaParams].join(";")),
            weight: weightOf(params),
          });
        }),
      ),
  });

const maxWeight = (instances: ReadonlyArray<AcceptInstance>): Option.Option<number> =>
  Arr.match(instances, {
    onEmpty: () => Option.none(),
    onNonEmpty: (nonEmpty) => Option.some(Math.max(...nonEmpty.map((instance) => instance.weight))),
  });

/**
 * Whether the instances `predicate` selects are the client's **winning**
 * media type: at least one acceptable (`q > 0`) instance appears and outranks
 * (≥) every other media type. A browser's `text/html,…` `Accept` has no
 * matching instance and so never wins; a client that names the type (or
 * ranks it top) does.
 */
const winsAccept = (
  instances: ReadonlyArray<AcceptInstance>,
  predicate: (instance: AcceptInstance) => boolean,
): boolean => {
  const targets = instances.filter((instance) => predicate(instance) && instance.weight > 0);
  const others = instances.filter((instance) => !predicate(instance));
  return Option.match(maxWeight(targets), {
    onNone: () => false,
    onSome: (target) => target >= Option.getOrElse(maxWeight(others), () => 0),
  });
};

// ── The negotiator ──────────────────────────────────────────────────

const pathnameOf = (request: HttpServerRequest.HttpServerRequest): string =>
  // `url` is the request path (plus query) — never absolute for a request
  // built by `HttpServerRequest.fromWeb` or an Effect server — so the base
  // only satisfies the parser and is never observable.
  new URL(request.url, "http://localhost").pathname;

const servesPath = (representation: Representation, pathname: string): boolean =>
  representation.servesPath?.(pathname) ?? true;

const acceptsParameters = (representation: Representation, mediaType: MimeType.MimeType): boolean =>
  representation.acceptsParameters?.(mediaType) ?? true;

/** Negotiate a read (`GET` / `HEAD`) on `Accept`. */
const negotiateRead = (
  request: HttpServerRequest.HttpServerRequest,
  options: NegotiationOptions,
): Negotiation => {
  const path = pathnameOf(request);
  const accept = parseAccept(Headers.get(request.headers, "accept"));
  // The first representation, in priority order, that decides the verdict.
  const verdict = Arr.findFirst(options.accept, (representation): Option.Option<Negotiation> => {
    if (!servesPath(representation, path)) return Option.none();
    const instances = accept.filter(isEssence(representation.mediaType));
    if (Arr.isReadonlyArrayEmpty(instances)) return Option.none();
    // An instance is clean iff its media-type parameters are accepted.
    const isClean = (instance: AcceptInstance): boolean =>
      Option.exists(instance.mediaType, (mediaType) =>
        acceptsParameters(representation, mediaType),
      );
    if (!instances.some(isClean)) return Option.some(Negotiation.NotAcceptable({ representation }));
    // A clean, acceptable (q > 0) instance must outrank every other media
    // type; a `q=0` clean instance is an explicit refusal, not a
    // parameterisation.
    return winsAccept(
      accept,
      (instance) => isEssence(representation.mediaType)(instance) && isClean(instance),
    )
      ? Option.some(Negotiation.Selected({ representation }))
      : Option.none();
  });
  return Option.getOrElse(verdict, () => Negotiation.Fallback());
};

/** Negotiate a write (`POST` / `PUT` / `PATCH` / `DELETE`) on `Content-Type`. */
const negotiateWrite = (
  request: HttpServerRequest.HttpServerRequest,
  options: NegotiationOptions,
): Negotiation => {
  const path = pathnameOf(request);
  const contentType = Option.flatMap(Headers.get(request.headers, "content-type"), MimeType.parse);
  return Option.match(contentType, {
    onNone: () => Negotiation.Fallback(),
    onSome: (mediaType) =>
      Option.match(
        Arr.findFirst(
          options.contentType ?? [],
          (representation) =>
            representation.mediaType === MimeType.essence(mediaType) &&
            servesPath(representation, path),
        ),
        {
          onNone: () => Negotiation.Fallback(),
          onSome: (representation) =>
            acceptsParameters(representation, mediaType)
              ? Negotiation.Selected({ representation })
              : Negotiation.UnsupportedMediaType({ representation }),
        },
      ),
  });
};

/**
 * Negotiates a single request into a {@link Negotiation}. Pure and
 * dependency-free beyond `options` (it reads only the request line and
 * headers), so a cache handle and a dispatch handle can share one verdict.
 * Reads (`GET` / `HEAD`) negotiate on `Accept` against `options.accept`, in
 * priority order; mutating methods negotiate on `Content-Type` against
 * `options.contentType`; anything else (`OPTIONS`, …) is `Fallback`.
 *
 * @example
 * ```ts
 * import * as HttpServerRequest from "effect/http/HttpServerRequest"
 * import { MARKDOWN_MEDIA_TYPE, Negotiation, negotiateRepresentation } from "@thomasfosterau/effect-ext/Negotiate"
 *
 * const markdown = { mediaType: MARKDOWN_MEDIA_TYPE, servesPath: (path: string) => path.startsWith("/posts/") }
 * const options = { accept: [markdown] }
 * const request = (path: string, accept: string) =>
 *   HttpServerRequest.fromWeb(new Request(`https://example.com${path}`, { headers: { accept } }))
 *
 * negotiateRepresentation(request("/posts/1", "text/markdown"), options)._tag // "Selected"
 * negotiateRepresentation(request("/posts/1", "text/html,*\/*;q=0.8"), options)._tag // "Fallback"
 * negotiateRepresentation(request("/about", "text/markdown"), options)._tag // "Fallback"
 * ```
 *
 * @since 0.1.0
 * @category negotiation
 */
export const negotiateRepresentation = (
  request: HttpServerRequest.HttpServerRequest,
  options: NegotiationOptions,
): Negotiation => {
  if (request.method === "GET" || request.method === "HEAD") return negotiateRead(request, options);
  if (isMutatingMethod(request.method)) return negotiateWrite(request, options);
  return Negotiation.Fallback();
};

/**
 * {@link negotiateRepresentation} over a Web `Request` — the SvelteKit hook
 * form.
 *
 * @example
 * ```ts
 * import { negotiateWebRequest } from "@thomasfosterau/effect-ext/Negotiate"
 *
 * const options = { accept: [{ mediaType: "text/markdown" }] }
 * negotiateWebRequest(new Request("https://example.com/posts/1", { headers: { accept: "text/markdown" } }), options)._tag // "Selected"
 * ```
 *
 * @since 0.1.0
 * @category adapters
 */
export const negotiateWebRequest = (request: Request, options: NegotiationOptions): Negotiation =>
  negotiateRepresentation(HttpServerRequest.fromWeb(request), options);

/**
 * Prepares a dispatched request for an internal HttpApi router that
 * registers JSON payloads under the default `application/json` encoding
 * while the negotiated **external** contract carries the JSON:API media
 * type. The media-type discrimination and the §6 status rules are already
 * enforced by {@link negotiateRepresentation} at the seam; a write's
 * `Content-Type` is relabelled to `application/json` so the router decodes
 * the (already-JSON) body. Reads pass through unchanged.
 *
 * @example
 * ```ts
 * import * as Headers from "effect/http/Headers"
 * import * as HttpServerRequest from "effect/http/HttpServerRequest"
 * import { requestForRouter } from "@thomasfosterau/effect-ext/Negotiate"
 *
 * const write = HttpServerRequest.fromWeb(
 *   new Request("https://example.com/posts", { method: "POST", headers: { "content-type": "application/vnd.api+json" } }),
 * )
 * Headers.get(requestForRouter(write).headers, "content-type") // Option.some("application/json")
 * ```
 *
 * @since 0.1.0
 * @category negotiation
 */
export const requestForRouter = (
  request: HttpServerRequest.HttpServerRequest,
): HttpServerRequest.HttpServerRequest =>
  isMutatingMethod(request.method)
    ? request.modify({ headers: Headers.set(request.headers, "content-type", "application/json") })
    : request;

/**
 * {@link requestForRouter} over a Web `Request`.
 *
 * @example
 * ```ts
 * import { requestForRouterWeb } from "@thomasfosterau/effect-ext/Negotiate"
 *
 * const write = new Request("https://example.com/posts", { method: "POST", headers: { "content-type": "application/vnd.api+json" } })
 * requestForRouterWeb(write).headers.get("content-type") // "application/json"
 * const read = new Request("https://example.com/posts")
 * requestForRouterWeb(read) === read // true
 * ```
 *
 * @since 0.1.0
 * @category adapters
 */
export const requestForRouterWeb = (request: Request): Request => {
  if (!isMutatingMethod(request.method)) return request;
  const headers = new globalThis.Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(request, { headers });
};

/**
 * Picks the Markdown response when the renderer produced one (`Some`, a
 * Markdown-able content route), or falls through to `onHtml` when it did
 * not (`None`: a path with no Markdown renderer, which the framework resolves
 * as HTML, 404 included). `onHtml` is a thunk — the framework's own render —
 * which must run only on the `None` branch; invoking it unconditionally
 * would render the page twice and defeat the point of the Markdown
 * short-circuit.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { chooseNegotiatedResponse } from "@thomasfosterau/effect-ext/Negotiate"
 *
 * chooseNegotiatedResponse(Option.some("# Markdown"), () => "<html>") // "# Markdown"
 * chooseNegotiatedResponse(Option.none(), () => "<html>") // "<html>"
 * ```
 *
 * @since 0.1.0
 * @category negotiation
 */
export const chooseNegotiatedResponse = <A, B>(
  markdown: Option.Option<A>,
  onHtml: () => B,
): A | B => (Option.isSome(markdown) ? markdown.value : onHtml());
