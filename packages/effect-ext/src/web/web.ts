/**
 * The Fetch-API adapter: applies a `Headers`-level policy from `./headers`
 * to a Web `Response` — the shape a SvelteKit `Handle` or a Worker `fetch`
 * export deals in. Everything else in this package is written over
 * `effect/http` types; `HttpServerRequest.fromWeb` /
 * `HttpServerResponse.toWeb` are the request and whole-response adapters,
 * and this module is the header-only one.
 *
 * `fetch()`-sourced responses (service bindings included) have immutable
 * headers in the Workers runtime, so a stamp clones the response only when
 * the policy actually changed something.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Headers from "effect/http/Headers";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Str from "effect/String";

/**
 * The spellings Title-Case gets wrong, keyed by lower-cased name.
 */
const IRREGULAR_HEADER_NAMES: R.ReadonlyRecord<string, string> = {
  dnt: "DNT",
  etag: "ETag",
  te: "TE",
  "content-md5": "Content-MD5",
  "www-authenticate": "WWW-Authenticate",
  "x-xss-protection": "X-XSS-Protection",
};

/**
 * The canonical spelling of a header name: `effect/http` `Headers` key by
 * lower-cased name, but a runtime may send a name outside its own table
 * exactly as it was set (workerd does on HTTP/1.1), so the adapters write
 * `X-Frame-Options`, not `x-frame-options`. Title-Case per `-` segment,
 * with the few irregular names spelled as their specifications do.
 */
const canonicalHeaderName = (name: string): string => {
  const lower = Str.toLowerCase(name);
  return pipe(
    R.get(IRREGULAR_HEADER_NAMES, lower),
    Option.getOrElse(() => pipe(Str.split(lower, "-"), Arr.map(Str.capitalize), Arr.join("-"))),
  );
};

/** A header's name (lower-case, as `Headers` keys it) and value. */
const entriesOf = (
  headers: Headers.Headers,
): ReadonlyArray<readonly [name: string, value: string]> =>
  // oxlint-disable-next-line effect/avoid-native-object-helpers -- `Headers` carries a symbol-keyed `TypeId` member alongside its string keys; `Record.toEntries` types the values as the union of both, while `Object.entries` (which never yields symbol keys) keeps them `string`.
  Object.entries(headers);

/**
 * What a policy did to the headers: `set` for each header `next` adds or
 * gives a different value, in its canonical spelling, and `remove` for each
 * header of `previous` that `next` no longer has (#93: a policy may strip an
 * upstream header, `Vary` say, and the removal must reach the target too).
 */
interface HeaderChanges {
  readonly set: ReadonlyArray<readonly [name: string, value: string]>;
  readonly remove: ReadonlyArray<string>;
}

const headerChanges = (previous: Headers.Headers, next: Headers.Headers): HeaderChanges => ({
  set: entriesOf(next)
    .filter(([name, value]) => previous[name] !== value)
    .map(([name, value]) => [canonicalHeaderName(name), value] as const),
  remove: entriesOf(previous)
    .filter(([name]) => !Headers.has(next, name))
    .map(([name]) => name),
});

/** Writes `changes` to a mutable Web `Headers`. */
const applyChanges = (target: globalThis.Headers, changes: HeaderChanges): void => {
  changes.set.forEach(([name, value]) => target.set(name, value));
  changes.remove.forEach((name) => target.delete(name));
};

/**
 * Applies a header policy to a Web `Response`. Returns the same instance
 * when the policy changed nothing; otherwise a clone (same status, same
 * body stream) carrying the policy's headers — a `fetch()`-sourced
 * response's headers are immutable, so mutation in place is never assumed.
 * Each header the policy adds or changes is written under its canonical
 * spelling (`X-Frame-Options`), since some runtimes send a name as written,
 * and each header it removes is removed.
 *
 * @example
 * ```ts
 * import { ensureCacheControl, securityHeaders, updateWebHeaders } from "@thomasfosterau/effect-ext/Web"
 *
 * const response = updateWebHeaders(new Response("hi"), (headers) => ensureCacheControl(securityHeaders(headers)))
 * response.headers.get("cache-control") // "private, no-store"
 * response.headers.get("x-content-type-options") // "nosniff"
 *
 * const declared = new Response("hi", { headers: { "cache-control": "no-store" } })
 * updateWebHeaders(declared, ensureCacheControl) === declared // true — nothing to stamp, no clone
 * ```
 *
 * @since 0.1.0
 * @category adapters
 */
export const updateWebHeaders = (
  response: Response,
  policy: (headers: Headers.Headers) => Headers.Headers,
): Response => {
  const previous = Headers.fromInput(response.headers);
  const changes = headerChanges(previous, policy(previous));
  if (Arr.isReadonlyArrayEmpty(changes.set) && Arr.isReadonlyArrayEmpty(changes.remove)) {
    return response;
  }
  const stamped = new Response(response.body, response);
  applyChanges(stamped.headers, changes);
  return stamped;
};

/**
 * Applies a header policy in place to a mutable Web `Headers` — a
 * SvelteKit `resolve()` response's headers, which a hook mutates directly.
 * Each header the policy adds or changes is written under its canonical
 * spelling (`Referrer-Policy`), since some runtimes send a name as written,
 * and each header it removes is deleted.
 *
 * @example
 * ```ts
 * import { securityHeaders, applyToWebHeaders } from "@thomasfosterau/effect-ext/Web"
 *
 * const headers = new Headers({ "x-frame-options": "SAMEORIGIN" })
 * applyToWebHeaders(headers, securityHeaders)
 * headers.get("x-frame-options") // "SAMEORIGIN"
 * headers.get("referrer-policy") // "strict-origin-when-cross-origin"
 * ```
 *
 * @since 0.1.0
 * @category adapters
 */
export const applyToWebHeaders = (
  target: globalThis.Headers,
  policy: (headers: Headers.Headers) => Headers.Headers,
): void => {
  const previous = Headers.fromInput(target);
  applyChanges(target, headerChanges(previous, policy(previous)));
};
