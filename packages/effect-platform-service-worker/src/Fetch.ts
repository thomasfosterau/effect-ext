/**
 * The `fetch` event: the five standard caching strategies, `precache` for
 * `install`, and a synchronous route table that becomes a `fetch`
 * listener.
 *
 * Every network step calls `FetchHttpClient.Fetch` from
 * `effect/http/FetchHttpClient` (default `globalThis.fetch`), the same
 * reference Effect's own fetch client reads, so a test stubs it there. A
 * strategy hands its cache write to `Events.EventLifetime`, so the page
 * never waits on it.
 *
 * @since 0.1.0
 */
import type * as Duration from "effect/Duration";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { type CacheError, type CacheHandle, openCache } from "./Caches.ts";
import { EventLifetime, eventLifetime, type ExtendableEventLike } from "./internal/events.ts";

/**
 * A `fetch` the worker made rejected: the network was unreachable, the
 * request was refused (CORS, a blocked scheme) or it was aborted.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { fetchRequest } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * const offline: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"))
 * const error = await Effect.runPromise(
 *   Effect.flip(fetchRequest(new Request("https://example.com/"))).pipe(
 *     Effect.provideService(FetchHttpClient.Fetch, offline),
 *   ),
 * )
 * error._tag // "FetchFailed"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class FetchFailed extends Schema.TaggedError<
  FetchFailed,
  { readonly brand: unique symbol }
>()("FetchFailed", {
  url: Schema.String,
  cause: Schema.Unknown,
}) {}

/**
 * The part of a `FetchEvent` this entry uses.
 *
 * @since 0.1.0
 * @category models
 */
export interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  readonly respondWith: (response: Response | PromiseLike<Response>) => void;
  /**
   * The navigation preload response: a `Response` once the preload is in,
   * `undefined` without one. Absent where the browser has no navigation
   * preload.
   */
  readonly preloadResponse?: Promise<unknown>;
}

/**
 * {@link cacheOnly} found nothing for the request.
 *
 * @since 0.1.0
 * @category errors
 */
export class CacheMiss extends Schema.TaggedError<CacheMiss, { readonly brand: unique symbol }>()(
  "CacheMiss",
  {
    cacheName: Schema.String,
    url: Schema.String,
  },
) {}

/**
 * {@link precache} fetched a URL and got something it will not install: any
 * response but a `200` (an opaque, redirected-to-error or partial response
 * included). Nothing is written when any URL fails.
 *
 * @since 0.1.0
 * @category errors
 */
export class PrecacheRejected extends Schema.TaggedError<
  PrecacheRejected,
  { readonly brand: unique symbol }
>()("PrecacheRejected", {
  url: Schema.String,
  status: Schema.Int,
}) {}

/**
 * Fetches `request` through `FetchHttpClient.Fetch`, keeping the native
 * `Response` (streaming body, `type`, `redirected`) that `respondWith`
 * needs, which Effect's `HttpClient` does not expose. Interruption aborts
 * the request.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { fetchRequest } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * const stub: typeof fetch = async () => new Response("hello")
 * const response = await Effect.runPromise(
 *   fetchRequest(new Request("https://example.com/")).pipe(
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *   ),
 * )
 * await response.text() // "hello"
 * ```
 *
 * @since 0.1.0
 * @category network
 */
export const fetchRequest = (request: Request): Effect.Effect<Response, FetchFailed> =>
  FetchHttpClient.Fetch.use((fetchImpl) =>
    Effect.tryPromise({
      try: (signal) => fetchImpl(request, { signal }),
      catch: (cause) => new FetchFailed({ url: request.url, cause }),
    }),
  );

/** `Cache-Control` directive `no-store`, matched as a whole token. */
const NO_STORE = /(?:^|,)\s*no-store\s*(?:[,=]|$)/i;

/**
 * Whether `response` to `request` may be written to a cache: the default
 * `cacheable` of every strategy here.
 *
 * Requires a `GET` (`Cache.put` rejects any other method), status `200`
 * (which excludes an opaque cross-origin response, status `0`, whose
 * failure status cannot be read, and a `206` partial, which `Cache.put`
 * rejects), no `Vary: *` (also rejected by `Cache.put`) and no
 * `Cache-Control: no-store` (the origin asked for the bytes never to be
 * kept; the Cache API itself ignores `Cache-Control`).
 *
 * @example
 * ```ts
 * import { isCacheable } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * const get = new Request("https://example.com/app.js")
 * isCacheable(get, new Response("ok")) // true
 * isCacheable(get, new Response("", { status: 404 })) // false
 * isCacheable(get, new Response("ok", { headers: { "cache-control": "private, no-store" } })) // false
 * isCacheable(new Request("https://example.com/", { method: "POST" }), new Response("ok")) // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isCacheable = (request: Request, response: Response): boolean =>
  request.method === "GET" &&
  response.status === 200 &&
  response.headers.get("vary")?.trim() !== "*" &&
  !NO_STORE.test(response.headers.get("cache-control") ?? "");

/**
 * A caching strategy: how one request is answered. Every strategy here is a
 * `Strategy`, and so is any `(request) => Effect<Response, E>` a caller
 * writes, so a route can name either.
 *
 * @since 0.1.0
 * @category models
 */
export type Strategy<E = never, R = never> = (request: Request) => Effect.Effect<Response, E, R>;

/**
 * What every caching strategy here takes.
 *
 * @since 0.1.0
 * @category models
 */
export interface StrategyOptions {
  /** The cache read from and written to. */
  readonly cacheName: string;
  /** Which network responses are written back; default {@link isCacheable}. */
  readonly cacheable?: (request: Request, response: Response) => boolean;
  /** Passed to `Cache.match` (`ignoreSearch`, `ignoreVary`, `ignoreMethod`). */
  readonly matchOptions?: CacheQueryOptions;
}

/** Opens the strategy's cache and looks `request` up in it. */
const lookupEntry = (
  options: Pick<StrategyOptions, "cacheName" | "matchOptions">,
  request: Request,
): Effect.Effect<
  { readonly cache: CacheHandle; readonly hit: Option.Option<Response> },
  CacheError
> =>
  Effect.flatMap(openCache(options.cacheName), (cache) =>
    Effect.map(cache.match(request, options.matchOptions), (hit) => ({ cache, hit })),
  );

/**
 * Fetches, then writes a cacheable response's clone back in the
 * background, so the page gets the response without waiting on the write.
 */
const fetchAndCache = (
  cache: CacheHandle,
  request: Request,
  options: StrategyOptions,
): Effect.Effect<Response, FetchFailed> =>
  Effect.gen(function* () {
    const response = yield* fetchRequest(request);
    if ((options.cacheable ?? isCacheable)(request, response)) {
      // Cloned here, before the caller can consume the original body.
      const copy = response.clone();
      const lifetime = yield* EventLifetime;
      yield* lifetime.extend(cache.put(request, copy));
    }
    return response;
  });

/**
 * Answers from the cache; on a miss, from the network, writing a cacheable
 * response back. For content-hashed assets that never change under one URL.
 * A failure is the cache's (`Caches.CacheError`) or, on a miss, the
 * network's ({@link FetchFailed}).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { Caches, memoryCacheStorage } from "@thomasfosterau/effect-platform-service-worker/Caches"
 * import { EventLifetime } from "@thomasfosterau/effect-platform-service-worker/Events"
 * import { cacheFirst } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * let fetches = 0
 * const stub: typeof fetch = async () => (fetches++, new Response("asset"))
 * const strategy = cacheFirst({ cacheName: "assets" })
 * const request = () => new Request("https://example.com/app.3f2a.js")
 *
 * const program = Effect.gen(function* () {
 *   yield* strategy(request())
 *   const second = yield* strategy(request())
 *   return yield* Effect.promise(() => second.text())
 * })
 *
 * await Effect.runPromise(
 *   program.pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *     // Run the background cache write inline, so the next read sees it.
 *     Effect.provideService(EventLifetime, { extend: Effect.ignore }),
 *   ),
 * ) // "asset"
 * fetches // 1
 * ```
 *
 * @since 0.1.0
 * @category strategies
 */
export const cacheFirst =
  (options: StrategyOptions): Strategy<CacheError | FetchFailed> =>
  (request) =>
    Effect.gen(function* () {
      const { cache, hit } = yield* lookupEntry(options, request);
      if (Option.isSome(hit)) return hit.value;
      return yield* fetchAndCache(cache, request, options);
    });

/**
 * Options for {@link networkFirst}.
 *
 * @since 0.1.0
 * @category models
 */
export interface NetworkFirstOptions extends StrategyOptions {
  /**
   * How long the network has before a cached response is served instead.
   * Unset (the default), the cache is consulted only once the network
   * fails. When it elapses and the cache misses, the network keeps its
   * chance; when the cache hits, the network request is aborted, so a
   * timed-out response never refreshes the cache.
   */
  readonly timeout?: Duration.Input;
}

/**
 * Answers from the network, writing a cacheable response back; when the
 * network fails (or `timeout` elapses with a cached copy to hand), from the
 * cache. For pages and API reads that should be fresh online and still
 * load offline. When the network fails and the cache misses, the failure is
 * the network's {@link FetchFailed}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { Caches, memoryCacheStorage } from "@thomasfosterau/effect-platform-service-worker/Caches"
 * import { EventLifetime } from "@thomasfosterau/effect-platform-service-worker/Events"
 * import { networkFirst } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * let online = true
 * const stub: typeof fetch = async () => {
 *   if (!online) throw new TypeError("Failed to fetch")
 *   return new Response("fresh")
 * }
 * const strategy = networkFirst({ cacheName: "pages", timeout: "3 seconds" })
 * const request = () => new Request("https://example.com/")
 *
 * const program = Effect.gen(function* () {
 *   yield* strategy(request())
 *   online = false
 *   const offline = yield* strategy(request())
 *   return yield* Effect.promise(() => offline.text())
 * })
 *
 * await Effect.runPromise(
 *   program.pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *     // Run the background cache write inline, so the next read sees it.
 *     Effect.provideService(EventLifetime, { extend: Effect.ignore }),
 *   ),
 * ) // "fresh"
 * ```
 *
 * @since 0.1.0
 * @category strategies
 */
export const networkFirst =
  (options: NetworkFirstOptions): Strategy<CacheError | FetchFailed> =>
  (request) =>
    Effect.gen(function* () {
      const cache = yield* openCache(options.cacheName);
      const cached = cache.match(request, options.matchOptions);
      const network = fetchAndCache(cache, request, options).pipe(
        Effect.catchTag("FetchFailed", (failure) =>
          Effect.flatMap(cached, Option.match({ onNone: () => failure, onSome: Effect.succeed })),
        ),
      );
      if (options.timeout === undefined) return yield* network;
      // The first arm to complete wins. The timer arm only completes on a
      // cache hit, so a miss after the timeout leaves the network to finish
      // (or fail) on its own.
      const timer = Effect.sleep(options.timeout).pipe(
        Effect.andThen(cached),
        Effect.flatMap(Option.match({ onNone: () => Effect.never, onSome: Effect.succeed })),
      );
      return yield* Effect.raceFirst(network, timer);
    });

/**
 * Answers from the cache when it can and revalidates in the background
 * (the network response, if cacheable, replaces the cached one for the next
 * request); on a miss, from the network. For content where a slightly stale
 * copy now beats a fresh one later: avatars, fonts, non-critical JSON. A
 * background revalidation failure is logged, never served.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { Caches, memoryCacheStorage } from "@thomasfosterau/effect-platform-service-worker/Caches"
 * import { EventLifetime } from "@thomasfosterau/effect-platform-service-worker/Events"
 * import { staleWhileRevalidate } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * let version = 0
 * const stub: typeof fetch = async () => new Response(`v${++version}`)
 * const strategy = staleWhileRevalidate({ cacheName: "avatars" })
 * const read = Effect.fnUntraced(function* () {
 *   const response = yield* strategy(new Request("https://example.com/me.png"))
 *   return yield* Effect.promise(() => response.text())
 * })
 *
 * const program = Effect.all([read(), read(), read()])
 *
 * await Effect.runPromise(
 *   program.pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *     // Run the background cache write inline, so the next read sees it.
 *     Effect.provideService(EventLifetime, { extend: Effect.ignore }),
 *   ),
 * ) // ["v1", "v1", "v2"]
 * ```
 *
 * @since 0.1.0
 * @category strategies
 */
export const staleWhileRevalidate =
  (options: StrategyOptions): Strategy<CacheError | FetchFailed> =>
  (request) =>
    Effect.gen(function* () {
      const { cache, hit } = yield* lookupEntry(options, request);
      if (Option.isNone(hit)) return yield* fetchAndCache(cache, request, options);
      const lifetime = yield* EventLifetime;
      // The page may consume the request's body; revalidate with a copy.
      yield* lifetime.extend(fetchAndCache(cache, request.clone(), options));
      return hit.value;
    });

/**
 * Answers from the cache only, failing with {@link CacheMiss} on a miss:
 * for what {@link precache} installed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, memoryCacheStorage } from "@thomasfosterau/effect-platform-service-worker/Caches"
 * import { cacheOnly } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * const miss = await Effect.runPromise(
 *   Effect.flip(cacheOnly({ cacheName: "shell" })(new Request("https://example.com/"))).pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *   ),
 * )
 * miss._tag // "CacheMiss"
 * ```
 *
 * @since 0.1.0
 * @category strategies
 */
export const cacheOnly =
  (options: Omit<StrategyOptions, "cacheable">): Strategy<CacheError | CacheMiss> =>
  (request) =>
    Effect.gen(function* () {
      const { hit } = yield* lookupEntry(options, request);
      if (Option.isSome(hit)) return hit.value;
      return yield* new CacheMiss({ cacheName: options.cacheName, url: request.url });
    });

const noPreload: Effect.Effect<Option.Option<Response>> = Effect.succeedNone;

/**
 * The navigation preload response for the request being answered: inside
 * {@link fetchListener}, the event's `preloadResponse`, `None` when the
 * browser sent no preload (it was not enabled, or this is not a navigation)
 * or the preload failed. Outside a listener it is always `None`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { PreloadResponse } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * const program = Effect.gen(function* () {
 *   const preload = yield* PreloadResponse
 *   return yield* preload
 * })
 * Effect.runPromise(program).then((response) => console.log(Option.isNone(response))) // true
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const PreloadResponse: Context.Reference<Effect.Effect<Option.Option<Response>>> =
  /*#__PURE__*/ Context.Reference(
    "@thomasfosterau/effect-platform-service-worker/Fetch/PreloadResponse",
    { defaultValue: () => noPreload },
  );

/** Reads an event's preload as an effect: a `Response`, or `None` for anything else. */
const preloadOf = (preload: Promise<unknown>): Effect.Effect<Option.Option<Response>> =>
  Effect.tryPromise({ try: () => preload, catch: Option.none }).pipe(
    Effect.match({
      // A failed preload is a failed network request: the fallback retries it.
      onFailure: Option.none,
      onSuccess: (value) => (value instanceof Response ? Option.some(value) : Option.none()),
    }),
  );

/**
 * Answers a navigation with its preload response (see
 * `NavigationPreload.enable`), falling back to `strategy` when there is
 * none. The preload is the network request the browser starts while the
 * worker boots, so it saves the boot time on a cold navigation; it is not
 * written to any cache.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { fetchListener, isNavigationRequest, networkOnly, route, withNavigationPreload } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * const onFetch = Effect.runSync(
 *   fetchListener([route(isNavigationRequest, withNavigationPreload(networkOnly))]),
 * )
 *
 * // In a worker the browser dispatches this event, with the preload in flight.
 * const navigation = Object.defineProperty(new Request("https://example.com/"), "mode", { value: "navigate" })
 * const answers: Array<Response | PromiseLike<Response>> = []
 * onFetch({
 *   request: navigation,
 *   preloadResponse: Promise.resolve(new Response("preloaded")),
 *   respondWith: (response) => { answers.push(response) },
 *   waitUntil: () => {},
 * })
 * Promise.resolve(answers[0]).then((response) => response?.text()).then(console.log) // "preloaded"
 * ```
 *
 * @since 0.1.0
 * @category strategies
 */
export const withNavigationPreload =
  <E, R>(strategy: Strategy<E, R>): Strategy<E, R> =>
  (request) =>
    PreloadResponse.use((preload) =>
      Effect.flatMap(preload, (response) =>
        Option.match(response, {
          onNone: () => strategy(request),
          onSome: Effect.succeed,
        }),
      ),
    );

/**
 * Answers from the network only, writing nothing: {@link fetchRequest} as a
 * {@link Strategy}, for a route that must never be served stale.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { networkOnly } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * const stub: typeof fetch = async () => new Response(null, { status: 204 })
 * const response = await Effect.runPromise(
 *   networkOnly(new Request("https://example.com/api/ping")).pipe(
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *   ),
 * )
 * response.status // 204
 * ```
 *
 * @since 0.1.0
 * @category strategies
 */
export const networkOnly: Strategy<FetchFailed> = fetchRequest;

/**
 * Fetches every URL, bypassing the HTTP cache (`cache: "reload"`, so a
 * stale intermediary copy is never installed), and writes them into
 * `cacheName` only once all of them returned `200`: an `install` handler's
 * app-shell step. Any non-`200` fails with {@link PrecacheRejected} and any
 * network failure with {@link FetchFailed}, before anything is written; a
 * failed `install` leaves the previous worker in charge, which is the point.
 *
 * Writes run after every fetch, so a `Caches.CacheError` mid-write can leave
 * some entries behind; the next `install` overwrites them.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { Caches, memoryCacheStorage, openCache } from "@thomasfosterau/effect-platform-service-worker/Caches"
 * import { precache } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * const stub: typeof fetch = async (input) => new Response(String(input))
 * const program = Effect.gen(function* () {
 *   yield* precache("shell-v1", ["https://example.com/", "https://example.com/app.css"])
 *   const cache = yield* openCache("shell-v1")
 *   return (yield* cache.keys).length
 * })
 *
 * await Effect.runPromise(
 *   program.pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *   ),
 * ) // 2
 * ```
 *
 * @since 0.1.0
 * @category install
 */
export const precache = (
  cacheName: string,
  urls: Iterable<string | URL>,
): Effect.Effect<void, CacheError | FetchFailed | PrecacheRejected> =>
  Effect.gen(function* () {
    const fetched = yield* Effect.forEach(
      urls,
      (url) =>
        Effect.gen(function* () {
          const request = new Request(url, { cache: "reload" });
          const response = yield* fetchRequest(request);
          if (response.status !== 200) {
            return yield* new PrecacheRejected({ url: request.url, status: response.status });
          }
          return [request, response] as const;
        }),
      { concurrency: "unbounded" },
    );
    const cache = yield* openCache(cacheName);
    yield* Effect.forEach(fetched, ([request, response]) => cache.put(request, response), {
      concurrency: 1,
      discard: true,
    });
  });

/**
 * One entry of a {@link fetchListener} route table: a synchronous `match`
 * and the effect that answers a matched request.
 *
 * @since 0.1.0
 * @category models
 */
export interface Route<E = never, R = never> {
  /**
   * Decides, during dispatch, whether this route answers. It must be
   * synchronous: `respondWith` has to be called before the event handler
   * returns, so the choice to answer cannot wait on an effect.
   */
  readonly match: (request: Request) => boolean;
  readonly handle: Strategy<E, R>;
}

/**
 * Builds a {@link Route}.
 *
 * @example
 * ```ts
 * import { cacheFirst, route } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * const assets = route(
 *   (request) => new URL(request.url).pathname.startsWith("/assets/"),
 *   cacheFirst({ cacheName: "assets" }),
 * )
 * assets.match(new Request("https://example.com/assets/app.js")) // true
 * ```
 *
 * @since 0.1.0
 * @category listeners
 */
export const route = <E, R>(
  match: (request: Request) => boolean,
  handle: Strategy<E, R>,
): Route<E, R> => ({ match, handle });

/**
 * Whether `request` is a top-level navigation (`mode: "navigate"`): the
 * usual `match` of a page route.
 *
 * @example
 * ```ts
 * import { isNavigationRequest } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * isNavigationRequest(new Request("https://example.com/app.js")) // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isNavigationRequest = (request: Request): boolean => request.mode === "navigate";

/** The services a route table needs, the union across its routes. */
type RoutesServices<Routes extends ReadonlyArray<Route<unknown, unknown>>> =
  Routes[number] extends Route<unknown, infer R> ? R : never;

/**
 * Turns a route table into a `fetch` listener. The first route whose
 * `match` accepts the request answers it through `respondWith`; when none
 * does, the listener returns without calling `respondWith` and the browser
 * fetches the request itself, as if no worker were installed.
 *
 * The listener runs each answer with the services the building effect was
 * given, and with `Events.EventLifetime` bound to the event, so a strategy's
 * background writes keep the worker alive. A failed answer rejects the
 * `respondWith` promise, which the page sees as a network error: the same
 * thing it sees when an unhandled fetch fails. Recover first (`Effect.catch`
 * in `handle`) to serve a fallback instead.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { Caches, memoryCacheStorage } from "@thomasfosterau/effect-platform-service-worker/Caches"
 * import { cacheFirst, type FetchEventLike, fetchListener, networkFirst, isNavigationRequest, route } from "@thomasfosterau/effect-platform-service-worker/Fetch"
 *
 * const stub: typeof fetch = async () => new Response("from the network")
 *
 * // In a worker: `self.addEventListener("fetch", onFetch)`, with the
 * // effect run synchronously while the script evaluates.
 * const onFetch = Effect.runSync(
 *   fetchListener([
 *     route(isNavigationRequest, networkFirst({ cacheName: "pages" })),
 *     route((request) => request.url.endsWith(".js"), cacheFirst({ cacheName: "assets" })),
 *   ]).pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *   ),
 * )
 *
 * let answered: Promise<Response> | undefined
 * const event: FetchEventLike = {
 *   request: new Request("https://example.com/app.js"),
 *   respondWith: (response) => { answered = Promise.resolve(response) },
 *   waitUntil: () => {},
 * }
 * onFetch(event)
 * await answered?.then((response) => response.text()) // "from the network"
 * ```
 *
 * @since 0.1.0
 * @category listeners
 */
export const fetchListener = <const Routes extends ReadonlyArray<Route<unknown, any>>>(
  routes: Routes,
): Effect.Effect<(event: FetchEventLike) => void, never, RoutesServices<Routes>> =>
  Effect.map(Effect.context<RoutesServices<Routes>>(), (context) => {
    const run = Effect.runPromiseWith(context);
    return (event: FetchEventLike) => {
      const matched = routes.find((candidate) => candidate.match(event.request));
      if (matched === undefined) return;
      const preload = event.preloadResponse;
      if (preload !== undefined) {
        // Keeps the worker alive until the preload settles, used or not:
        // the browser cancels an unsettled one when the event ends.
        event.waitUntil(preload.then(constVoid, constVoid));
      }
      event.respondWith(
        run(
          matched
            .handle(event.request)
            .pipe(
              Effect.provideService(EventLifetime, eventLifetime(event)),
              Effect.provideService(
                PreloadResponse,
                preload === undefined ? noPreload : preloadOf(preload),
              ),
            ),
        ),
      );
    };
  });
