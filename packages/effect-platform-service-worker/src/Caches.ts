/**
 * The Cache Storage API as typed effects: open, match, put and delete, the
 * activate-time sweep of old caches, and an in-memory `CacheStorage` for
 * tests.
 *
 * Nothing here touches a global at import: {@link Caches} is a context
 * reference defaulting to `globalThis.caches` on first use, so a worker
 * needs no layer and a test provides {@link memoryCacheStorage}.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";

/**
 * Which Cache Storage call failed.
 *
 * @since 0.1.0
 * @category models
 */
export type CacheOperation = "open" | "delete-cache" | "keys" | "match" | "put" | "delete";

/**
 * A Cache Storage call rejected: a `QuotaExceededError` on `put`, a
 * `SecurityError` where storage is unavailable (an opaque origin, some
 * private modes), or a `TypeError` for a request `put` refuses. `cacheName`
 * is the cache the call addressed; `""` for the storage-wide `keys`.
 *
 * @since 0.1.0
 * @category errors
 */
export class CacheError extends Schema.TaggedError<CacheError, { readonly brand: unique symbol }>()(
  "CacheError",
  {
    operation: Schema.Literals(["open", "delete-cache", "keys", "match", "put", "delete"]),
    cacheName: Schema.String,
    cause: Schema.Unknown,
  },
) {}

/**
 * The `CacheStorage` every cache operation here opens caches from. Defaults
 * to `globalThis.caches`, read on first use, never at import; provide a
 * stub (`Effect.provideService(Caches, memoryCacheStorage())`) in a test.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, cacheNames, memoryCacheStorage, openCache } from "@thomasfosterau/effect-platform-service-worker/Caches"
 *
 * const names = await Effect.runPromise(
 *   openCache("v1").pipe(
 *     Effect.andThen(cacheNames),
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *   ),
 * )
 * names // ["v1"]
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const Caches: Context.Reference<CacheStorage> = /*#__PURE__*/ Context.Reference(
  "@thomasfosterau/effect-platform-service-worker/Caches/Caches",
  { defaultValue: () => globalThis.caches },
);

/**
 * One named cache, its calls as effects. `match` is `None` on a miss
 * (`Cache.match` resolves `undefined`).
 *
 * @since 0.1.0
 * @category models
 */
export interface CacheHandle {
  readonly name: string;
  readonly match: (
    request: RequestInfo | URL,
    options?: CacheQueryOptions,
  ) => Effect.Effect<Option.Option<Response>, CacheError>;
  readonly put: (request: RequestInfo | URL, response: Response) => Effect.Effect<void, CacheError>;
  readonly delete: (
    request: RequestInfo | URL,
    options?: CacheQueryOptions,
  ) => Effect.Effect<boolean, CacheError>;
  readonly keys: Effect.Effect<ReadonlyArray<Request>, CacheError>;
}

const cacheCall = <A>(
  operation: CacheOperation,
  cacheName: string,
  call: () => Promise<A>,
): Effect.Effect<A, CacheError> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => new CacheError({ operation, cacheName, cause }),
  });

const cacheHandle = (name: string, cache: Cache): CacheHandle => ({
  name,
  match: (request, options) =>
    Effect.map(
      cacheCall("match", name, () => cache.match(request, options)),
      Option.fromUndefinedOr,
    ),
  put: (request, response) => cacheCall("put", name, () => cache.put(request, response)),
  delete: (request, options) => cacheCall("delete", name, () => cache.delete(request, options)),
  keys: cacheCall("keys", name, () => cache.keys()),
});

/**
 * Opens (creating if absent) the cache called `name` in {@link Caches}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Caches, memoryCacheStorage, openCache } from "@thomasfosterau/effect-platform-service-worker/Caches"
 *
 * const program = Effect.gen(function* () {
 *   const cache = yield* openCache("v1")
 *   yield* cache.put("https://example.com/a", new Response("a"))
 *   const hit = yield* cache.match("https://example.com/a")
 *   return Option.isSome(hit)
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provideService(Caches, memoryCacheStorage()))) // true
 * ```
 *
 * @since 0.1.0
 * @category cache storage
 */
export const openCache = (name: string): Effect.Effect<CacheHandle, CacheError> =>
  Caches.use((storage) =>
    Effect.map(
      cacheCall("open", name, () => storage.open(name)),
      (cache) => cacheHandle(name, cache),
    ),
  );

/**
 * Deletes the cache called `name`; `true` when it existed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, deleteCache, memoryCacheStorage, openCache } from "@thomasfosterau/effect-platform-service-worker/Caches"
 *
 * const deleted = await Effect.runPromise(
 *   openCache("v1").pipe(
 *     Effect.andThen(deleteCache("v1")),
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *   ),
 * )
 * deleted // true
 * ```
 *
 * @since 0.1.0
 * @category cache storage
 */
export const deleteCache = (name: string): Effect.Effect<boolean, CacheError> =>
  Caches.use((storage) => cacheCall("delete-cache", name, () => storage.delete(name)));

/**
 * The names of every cache in {@link Caches}, in creation order.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, cacheNames, memoryCacheStorage } from "@thomasfosterau/effect-platform-service-worker/Caches"
 *
 * await Effect.runPromise(cacheNames.pipe(Effect.provideService(Caches, memoryCacheStorage()))) // []
 * ```
 *
 * @since 0.1.0
 * @category cache storage
 */
export const cacheNames: Effect.Effect<
  ReadonlyArray<string>,
  CacheError
> = /*#__PURE__*/ Caches.use((storage) => cacheCall("keys", "", () => storage.keys()));

/**
 * Deletes every cache whose name `keep` rejects, returning the names
 * deleted: the `activate`-time sweep of caches an earlier worker version
 * left behind. `keep` is the list of current names or a predicate (to keep
 * another library's caches, match its prefix).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, deleteCachesExcept, memoryCacheStorage, openCache } from "@thomasfosterau/effect-platform-service-worker/Caches"
 *
 * const program = Effect.gen(function* () {
 *   yield* openCache("static-v1")
 *   yield* openCache("static-v2")
 *   return yield* deleteCachesExcept(["static-v2"])
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provideService(Caches, memoryCacheStorage()))) // ["static-v1"]
 * ```
 *
 * @since 0.1.0
 * @category cache storage
 */
export const deleteCachesExcept = (
  keep: ReadonlyArray<string> | ((name: string) => boolean),
): Effect.Effect<ReadonlyArray<string>, CacheError> => {
  const kept = P.isFunction(keep) ? keep : (name: string) => keep.includes(name);
  return Effect.flatMap(cacheNames, (names) =>
    Effect.filter(
      names.filter((name) => !kept(name)),
      (name) => deleteCache(name),
    ),
  );
};

/** The cache key of a request: its URL, with or without the query. */
const cacheKey = (request: Request, options?: CacheQueryOptions): string => {
  if (options?.ignoreSearch !== true) return request.url;
  const url = new URL(request.url);
  url.search = "";
  return url.href;
};

const toRequest = (request: RequestInfo | URL): Request =>
  request instanceof Request ? request : new Request(request);

/** Whether `request` can be matched at all: a `GET` / `HEAD`, or any method under `ignoreMethod`. */
const matchable = (request: Request, options?: CacheQueryOptions): boolean =>
  options?.ignoreMethod === true || request.method === "GET" || request.method === "HEAD";

/**
 * Replaces the entry `name` names in place, or appends one: the insertion
 * order a `Map` keeps, which `match` (first hit) and `keys` expose.
 */
const upsert = <A>(
  entries: ReadonlyArray<readonly [string, A]>,
  name: string,
  value: A,
): ReadonlyArray<readonly [string, A]> =>
  Arr.some(entries, ([key]) => key === name)
    ? Arr.map(entries, (entry) => (entry[0] === name ? ([name, value] as const) : entry))
    : Arr.append(entries, [name, value] as const);

/** Runs `f` over `items` one after another, as an awaited `for … of` would. */
const sequentially = <A>(items: ReadonlyArray<A>, f: (item: A) => Promise<void>): Promise<void> =>
  Arr.reduce(items, Promise.resolve(), (previous, item) => previous.then(() => f(item)));

const memoryCache = (fetchImpl: typeof globalThis.fetch): Cache => {
  // Keyed by request URL, in insertion order.
  let entries: ReadonlyArray<readonly [string, readonly [Request, Response]]> = [];
  const find = (request: RequestInfo | URL, options?: CacheQueryOptions) => {
    const wanted = toRequest(request);
    if (!matchable(wanted, options)) return [];
    const key = cacheKey(wanted, options);
    return entries.filter(([, [stored]]) => cacheKey(stored, options) === key);
  };
  const put = async (request: RequestInfo | URL, response: Response): Promise<void> => {
    const stored = toRequest(request);
    if (stored.method !== "GET") throw new TypeError(`Cache.put: method ${stored.method}`);
    if (response.status === 206) throw new TypeError("Cache.put: partial response");
    if (response.headers.get("vary")?.trim() === "*") throw new TypeError("Cache.put: Vary: *");
    if (response.bodyUsed) throw new TypeError("Cache.put: body already used");
    // Buffer the body so every match can hand out an unread clone.
    const body = await response.arrayBuffer();
    entries = upsert(entries, stored.url, [
      stored,
      new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    ] as const);
  };
  const addAll = async (requests: Iterable<RequestInfo | URL>): Promise<void> => {
    const fetched = await Promise.all(
      Arr.map(Arr.fromIterable(requests), async (request) => {
        const response = await fetchImpl(request);
        if (!response.ok) throw new TypeError(`Cache.addAll: status ${response.status}`);
        return [request, response] as const;
      }),
    );
    await sequentially(fetched, ([request, response]) => put(request, response));
  };
  return {
    match: async (request, options) => find(request, options)[0]?.[1][1].clone(),
    matchAll: async (request, options) =>
      request === undefined
        ? entries.map(([, [, response]]) => response.clone())
        : find(request, options).map(([, [, response]]) => response.clone()),
    put,
    add: (request) => addAll([request]),
    addAll,
    delete: async (request, options) => {
      const found = find(request, options);
      entries = entries.filter((entry) => !Arr.contains(found, entry));
      return Arr.isReadonlyArrayNonEmpty(found);
    },
    keys: async (request, options) =>
      request === undefined
        ? entries.map(([, [stored]]) => stored)
        : find(request, options).map(([, [stored]]) => stored),
  };
};

/**
 * Options for {@link memoryCacheStorage}.
 *
 * @since 0.1.0
 * @category testing
 */
export interface MemoryCacheStorageOptions {
  /** The `fetch` that `Cache.add` / `Cache.addAll` call; defaults to the global. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * An in-memory `CacheStorage` for tests (and for running the strategies
 * outside a worker): provide it as {@link Caches}. Entries are keyed by URL
 * (`ignoreSearch` and `ignoreMethod` are honoured; `Vary` is not, as if
 * `ignoreVary` were always set), and `put` rejects what the browser's does
 * (a non-`GET`, a `206`, `Vary: *`, a used body) with a `TypeError`.
 * `add` / `addAll` fetch through `options.fetch` (default the global).
 *
 * @example
 * ```ts
 * import { memoryCacheStorage } from "@thomasfosterau/effect-platform-service-worker/Caches"
 *
 * const storage = memoryCacheStorage()
 * const cache = await storage.open("v1")
 * await cache.put("https://example.com/", new Response("hi"))
 * await (await storage.match("https://example.com/"))?.text() // "hi"
 * ```
 *
 * @since 0.1.0
 * @category testing
 */
export const memoryCacheStorage = (options: MemoryCacheStorageOptions = {}): CacheStorage => {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  // Keyed by cache name, in creation order (the order `keys` reports).
  let caches: ReadonlyArray<readonly [string, Cache]> = [];
  const lookup = (name: string): Option.Option<Cache> =>
    Option.map(
      Arr.findFirst(caches, ([key]) => key === name),
      ([, cache]) => cache,
    );
  const open = async (name: string): Promise<Cache> =>
    Option.getOrElse(lookup(name), () => {
      const created = memoryCache(fetchImpl);
      caches = upsert(caches, name, created);
      return created;
    });
  const miss: ReturnType<CacheStorage["match"]> = Promise.resolve(undefined);
  return {
    open,
    has: async (name) => Option.isSome(lookup(name)),
    delete: async (name) => {
      const present = Option.isSome(lookup(name));
      caches = caches.filter(([key]) => key !== name);
      return present;
    },
    keys: async () => caches.map(([name]) => name),
    // The first cache (in creation order) holding a match wins; later caches
    // are not consulted once one answers.
    match: (request, query) =>
      Arr.reduce(
        query?.cacheName === undefined ? caches.map(([name]) => name) : [query.cacheName],
        miss,
        (previous, name) =>
          previous.then((hit) =>
            hit !== undefined
              ? hit
              : Option.match(lookup(name), {
                  onNone: () => miss,
                  onSome: (cache) => cache.match(request, query),
                }),
          ),
      ),
  };
};
