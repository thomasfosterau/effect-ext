/**
 * `@thomasfosterau/effect-ext/Web` — framework-neutral web request/response
 * utilities on `effect/http`: response-header policies
 * (security baseline, stage `noindex`, `Vary` discipline, the
 * `Cache-Control` safety net), the cross-origin mutation guard, the trusted
 * client address, the degraded-session report, the canonical site base and
 * the JSON:API guard responses a front door emits at its seam.
 *
 * Everything here is written over `Headers`, `HttpServerRequest` and
 * `HttpServerResponse`; `HttpServerRequest.fromWeb`, `HttpServerResponse.toWeb`
 * and the `*Web` adapters in this entry bridge to the Fetch types a
 * SvelteKit hook or a Worker `fetch` export deals in.
 *
 * The other entries: `Net` (the SSRF guard and redirect-following fetch),
 * `Observability` (structured log, allow-listed span tracer, event trio,
 * auth-outcome signal), `Negotiate` (the content-negotiation verdict over
 * the representations a server can produce).
 *
 * @since 0.1.0
 */
export * from "./web/client-ip.ts";
export * from "./web/cross-origin.ts";
export * from "./web/headers.ts";
export * from "./web/jsonapi-error.ts";
export * from "./web/session.ts";
export * from "./web/site-base.ts";
export * from "./web/web.ts";
