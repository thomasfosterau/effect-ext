/**
 * Cookies through the Cookie Store API, in a window and in a service
 * worker, with a `document.cookie` fallback where a window lacks it:
 * `get`, `getAll`, `set` and `delete`, a stream of changes, and
 * {@link cookie}, one cookie read and written through a schema.
 *
 * {@link CookieStore} is a context reference that defaults, on first read,
 * to the ambient `cookieStore`, else the ambient `document`; a test
 * provides one built by {@link make}.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Cookies from "effect/http/Cookies";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";

/**
 * A cookie as the platform reports one: its name and value. The Cookie
 * Store API's current spelling, and all `document.cookie` can tell.
 *
 * @since 0.1.0
 * @category models
 */
export interface Cookie {
  readonly name: string;
  readonly value: string;
}

/**
 * A cookie to write: `expires` (default: a session cookie), `domain`
 * (default: this host only), `path` (default `"/"`), `sameSite` (default
 * `"strict"`) and `partitioned` (default `false`), the Cookie Store API's
 * own defaults, which the `document.cookie` fallback writes too.
 *
 * @since 0.1.0
 * @category models
 */
export interface CookieInit extends Cookie {
  readonly expires?: DateTime.DateTime;
  readonly domain?: string;
  readonly path?: string;
  readonly sameSite?: "strict" | "lax" | "none";
  readonly partitioned?: boolean;
}

/**
 * Which cookie {@link CookieStoreService.delete} removes: the `domain` and
 * `path` it was set with (`path` defaults to `"/"`), and whether it was
 * `partitioned`.
 *
 * @since 0.1.0
 * @category models
 */
export interface DeleteOptions {
  readonly domain?: string;
  readonly path?: string;
  readonly partitioned?: boolean;
}

/**
 * What {@link CookieStoreService.getAll} matches: every cookie named `name`
 * (default: every cookie), visible at `url` (default: this page's, the only
 * one a window may ask for; a service worker may ask for any URL in its
 * scope). The `document.cookie` fallback ignores `url`.
 *
 * @since 0.1.0
 * @category models
 */
export interface GetAllOptions {
  readonly name?: string;
  readonly url?: string;
}

/**
 * One change to the cookies: those set (`changed`) and those removed or
 * expired (`deleted`).
 *
 * @since 0.1.0
 * @category models
 */
export interface CookieChange {
  readonly changed: ReadonlyArray<Cookie>;
  readonly deleted: ReadonlyArray<Cookie>;
}

/**
 * A cookie as the platform hands one over; either field may be missing.
 *
 * @since 0.1.0
 * @category models
 */
export interface CookieListItemLike {
  readonly name?: string;
  readonly value?: string;
}

/**
 * What a `change` listener receives: a `CookieChangeEvent`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ChangeEventLike {
  readonly type: string;
  readonly changed?: ReadonlyArray<CookieListItemLike>;
  readonly deleted?: ReadonlyArray<CookieListItemLike>;
}

/**
 * The slice of `cookieStore` this module calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface CookieStoreLike extends Stream.EventListener<ChangeEventLike> {
  get(name: string): Promise<CookieListItemLike | null | undefined>;
  getAll(options?: GetAllOptions): Promise<ReadonlyArray<CookieListItemLike>>;
  set(init: {
    readonly name: string;
    readonly value: string;
    readonly expires?: number;
    readonly domain?: string;
    readonly path?: string;
    readonly sameSite?: "strict" | "lax" | "none";
    readonly partitioned?: boolean;
  }): Promise<void>;
  delete(options: {
    readonly name: string;
    readonly domain?: string;
    readonly path?: string;
    readonly partitioned?: boolean;
  }): Promise<void>;
}

/**
 * The slice of `document` the fallback calls: `cookie`, which reads every
 * cookie as a `Cookie` header and writes one as a `Set-Cookie` header.
 *
 * @since 0.1.0
 * @category models
 */
export interface DocumentCookieLike {
  cookie: string;
}

/**
 * The platform objects {@link make} builds over: `cookieStore` where the
 * agent has it, else `document` for the fallback. Neither is the
 * unsupported service.
 *
 * @since 0.1.0
 * @category models
 */
export interface CookieStoreEnvironment {
  readonly cookieStore?: CookieStoreLike | undefined;
  readonly document?: DocumentCookieLike | undefined;
}

/**
 * Why a call failed: `Unsupported` (no cookie API, or `changes` over
 * `document.cookie`, which reports none), `InvalidCookie` (a name, value,
 * domain or path the platform rejects), `Security` (an opaque origin, such
 * as a sandboxed frame), `Failed` (anything else).
 *
 * @since 0.1.0
 * @category models
 */
export type CookieStoreErrorReason = "Unsupported" | "InvalidCookie" | "Security" | "Failed";

/**
 * A cookie call failed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/CookieStore"
 *
 * Effect.runPromise(Effect.flip(make({}).get("session"))).then((error) =>
 *   console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class CookieStoreError extends Schema.TaggedError<CookieStoreError>()("CookieStoreError", {
  operation: Schema.Literals(["get", "getAll", "set", "delete", "changes"]),
  reason: Schema.Literals(["Unsupported", "InvalidCookie", "Security", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

/**
 * The operations a {@link CookieStore} offers.
 *
 * @since 0.1.0
 * @category models
 */
export interface CookieStoreService {
  /** Which API backs the service: the Cookie Store API, `document.cookie`, or neither. */
  readonly backend: "cookieStore" | "document" | "none";
  /** The first cookie named `name`. */
  readonly get: (name: string) => Effect.Effect<Option.Option<Cookie>, CookieStoreError>;
  /** Every cookie that matches `options`. */
  readonly getAll: (
    options?: GetAllOptions,
  ) => Effect.Effect<ReadonlyArray<Cookie>, CookieStoreError>;
  /** Writes a cookie. */
  readonly set: (cookie: CookieInit) => Effect.Effect<void, CookieStoreError>;
  /** Removes a cookie, by expiring it. */
  readonly delete: (name: string, options?: DeleteOptions) => Effect.Effect<void, CookieStoreError>;
  /** Each change to the cookies, from now on; `Unsupported` over `document.cookie`. */
  readonly changes: Stream.Stream<CookieChange, CookieStoreError>;
}

type Operation = CookieStoreError["operation"];

const failure = (
  operation: Operation,
  reason: CookieStoreErrorReason,
  cause: unknown,
): CookieStoreError =>
  new CookieStoreError({ operation, reason, cause, message: `cookies ${operation}: ${reason}` });

const reasonOf = (cause: unknown): CookieStoreErrorReason => {
  const name = P.hasProperty(cause, "name") && P.isString(cause.name) ? cause.name : "";
  if (name === "TypeError") return "InvalidCookie";
  return name === "SecurityError" ? "Security" : "Failed";
};

const attempt = <A>(operation: Operation, call: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: call, catch: (cause) => failure(operation, reasonOf(cause), cause) });

const toCookie = (item: CookieListItemLike): Cookie => ({
  name: item.name ?? "",
  value: item.value ?? "",
});

/** What `cookieStore.set` takes: the API's defaults, and only the attributes given. */
const storeInit = (cookie: CookieInit): Types.Mutable<Parameters<CookieStoreLike["set"]>[0]> => {
  const init: Types.Mutable<Parameters<CookieStoreLike["set"]>[0]> = {
    name: cookie.name,
    value: cookie.value,
    path: cookie.path ?? "/",
    sameSite: cookie.sameSite ?? "strict",
    partitioned: cookie.partitioned ?? false,
  };
  if (cookie.expires !== undefined) init.expires = DateTime.toEpochMillis(cookie.expires);
  if (cookie.domain !== undefined) init.domain = cookie.domain;
  return init;
};

/** What `cookieStore.delete` takes. */
const storeTarget = (
  name: string,
  options?: DeleteOptions,
): Types.Mutable<Parameters<CookieStoreLike["delete"]>[0]> => {
  const target: Types.Mutable<Parameters<CookieStoreLike["delete"]>[0]> = {
    name,
    path: options?.path ?? "/",
    partitioned: options?.partitioned ?? false,
  };
  if (options?.domain !== undefined) target.domain = options.domain;
  return target;
};

const offerChange =
  (queue: Queue.Queue<CookieChange, Cause.Done>) =>
  (event: ChangeEventLike): void => {
    Queue.offerUnsafe(queue, {
      changed: Arr.map(event.changed ?? [], toCookie),
      deleted: Arr.map(event.deleted ?? [], toCookie),
    });
  };

const overStore = (store: CookieStoreLike): CookieStoreService => ({
  backend: "cookieStore",
  get: (name) =>
    Effect.map(
      attempt("get", () => store.get(name)),
      (item) => Option.map(Option.fromNullishOr(item), toCookie),
    ),
  getAll: (options) =>
    Effect.map(
      attempt("getAll", () => store.getAll(options ?? {})),
      Arr.map(toCookie),
    ),
  set: (cookie) => attempt("set", () => store.set(storeInit(cookie))),
  delete: (name, options) => attempt("delete", () => store.delete(storeTarget(name, options))),
  changes: Stream.callback<CookieChange>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const onChange = offerChange(queue);
        store.addEventListener("change", onChange);
        return onChange;
      }),
      (onChange) => Effect.sync(() => store.removeEventListener("change", onChange)),
    ),
  ),
});

/** The Unix epoch: an `expires` in the past deletes a cookie. */
const EPOCH = /*#__PURE__*/ DateTime.makeUnsafe(0);

const write = (
  document: DocumentCookieLike,
  operation: Operation,
  made: Result.Result<Cookies.Cookie, Cookies.CookiesError>,
): Effect.Effect<void, CookieStoreError> =>
  Result.match(made, {
    onFailure: (error) => Effect.fail(failure(operation, "InvalidCookie", error)),
    onSuccess: (cookie) =>
      Effect.sync(() => {
        document.cookie = Cookies.serializeCookie(cookie);
      }),
  });

const overDocument = (document: DocumentCookieLike): CookieStoreService => {
  const all = Effect.sync(() =>
    Arr.map(R.toEntries(Cookies.parseHeader(document.cookie)), ([name, value]) => ({
      name,
      value,
    })),
  );
  return {
    backend: "document",
    get: (name) =>
      Effect.map(
        all,
        Arr.findFirst((cookie) => cookie.name === name),
      ),
    getAll: (options) =>
      Option.match(Option.fromUndefinedOr(options?.name), {
        onNone: () => all,
        onSome: (name) =>
          Effect.map(
            all,
            Arr.filter((cookie) => cookie.name === name),
          ),
      }),
    set: (cookie) =>
      write(
        document,
        "set",
        Cookies.makeCookie(cookie.name, cookie.value, {
          path: cookie.path ?? "/",
          sameSite: cookie.sameSite ?? "strict",
          partitioned: cookie.partitioned,
          secure: cookie.partitioned,
          expires: Option.getOrUndefined(
            Option.map(Option.fromUndefinedOr(cookie.expires), DateTime.toDate),
          ),
          domain: cookie.domain,
        }),
      ),
    delete: (name, options) =>
      write(
        document,
        "delete",
        Cookies.makeCookie(name, "", {
          path: options?.path ?? "/",
          expires: DateTime.toDate(EPOCH),
          partitioned: options?.partitioned,
          secure: options?.partitioned,
          domain: options?.domain,
        }),
      ),
    changes: Stream.fail(failure("changes", "Unsupported", undefined)),
  };
};

const unsupported = (operation: Operation) =>
  Effect.fail(failure(operation, "Unsupported", undefined));

/**
 * Builds a {@link CookieStoreService} over `cookieStore` when given one,
 * else over `document.cookie`, else the unsupported service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/CookieStore"
 *
 * const page = { cookie: "theme=dark; lang=en" }
 * Effect.runPromise(make({ document: page }).get("theme")).then(console.log)
 * // Some({ name: "theme", value: "dark" })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (environment: CookieStoreEnvironment): CookieStoreService => {
  if (environment.cookieStore !== undefined) return overStore(environment.cookieStore);
  if (environment.document !== undefined) return overDocument(environment.document);
  return {
    backend: "none",
    get: () => unsupported("get"),
    getAll: () => unsupported("getAll"),
    set: () => unsupported("set"),
    delete: () => unsupported("delete"),
    changes: Stream.fail(failure("changes", "Unsupported", undefined)),
  };
};

const ambient = (): CookieStoreService => {
  const scope: Partial<Pick<typeof globalThis, "cookieStore" | "document">> = globalThis;
  return make({ cookieStore: scope.cookieStore, document: scope.document });
};

/**
 * The cookies. Defaults to the ambient `cookieStore` (a window's or a
 * service worker's), else a window's `document.cookie`, read on first use;
 * provide one built by {@link make} to replace them.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { CookieStore, get, make } from "@thomasfosterau/effect-platform-worker-shared/CookieStore"
 *
 * const program = get("session").pipe(
 *   Effect.provideService(CookieStore, make({ document: { cookie: "session=abc" } })),
 * )
 * Effect.runPromise(program).then(console.log) // Some({ name: "session", value: "abc" })
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const CookieStore: Context.Reference<CookieStoreService> = /*#__PURE__*/ Context.Reference(
  "@thomasfosterau/effect-platform-worker-shared/CookieStore",
  { defaultValue: ambient },
);

/**
 * The first cookie named `name`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { get } from "@thomasfosterau/effect-platform-worker-shared/CookieStore"
 *
 * Effect.runPromise(Effect.option(get("session"))).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const get = (name: string): Effect.Effect<Option.Option<Cookie>, CookieStoreError> =>
  CookieStore.use((self) => self.get(name));

/**
 * Every cookie that matches `options`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { getAll } from "@thomasfosterau/effect-platform-worker-shared/CookieStore"
 *
 * Effect.runPromise(Effect.option(getAll())).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const getAll = (
  options?: GetAllOptions,
): Effect.Effect<ReadonlyArray<Cookie>, CookieStoreError> =>
  CookieStore.use((self) => self.getAll(options));

/**
 * Writes a cookie.
 *
 * @example
 * ```ts
 * import * as DateTime from "effect/DateTime"
 * import * as Effect from "effect/Effect"
 * import { set } from "@thomasfosterau/effect-platform-worker-shared/CookieStore"
 *
 * const program = Effect.flatMap(DateTime.now, (now) =>
 *   set({ name: "theme", value: "dark", expires: DateTime.add(now, { days: 30 }) }),
 * )
 * Effect.runPromise(Effect.option(program)).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const set = (cookie: CookieInit): Effect.Effect<void, CookieStoreError> =>
  CookieStore.use((self) => self.set(cookie));

/**
 * Removes a cookie, by expiring it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { remove } from "@thomasfosterau/effect-platform-worker-shared/CookieStore"
 *
 * Effect.runPromise(Effect.option(remove("session"))).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const remove = (
  name: string,
  options?: DeleteOptions,
): Effect.Effect<void, CookieStoreError> => CookieStore.use((self) => self.delete(name, options));

/**
 * Each change to the cookies, from now on. Over `document.cookie`, which
 * reports none, it fails `Unsupported`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { changes } from "@thomasfosterau/effect-platform-worker-shared/CookieStore"
 *
 * const program = Stream.runForEach(changes, (change) =>
 *   Effect.log(`${change.changed.length} set, ${change.deleted.length} removed`),
 * )
 * Effect.runFork(Effect.ignore(program))
 * ```
 *
 * @since 0.1.0
 * @category streams
 */
export const changes: Stream.Stream<CookieChange, CookieStoreError> = /*#__PURE__*/ Stream.unwrap(
  CookieStore.use((self) => Effect.succeed(self.changes)),
);

/**
 * One cookie, read and written through `schema`, whose encoded side is the
 * cookie's value: {@link cookie} returns it.
 *
 * @since 0.1.0
 * @category models
 */
export interface TypedCookie<A, RD, RE> {
  /** The cookie's value, decoded; `None` when it is not set. */
  readonly get: Effect.Effect<Option.Option<A>, CookieStoreError | Schema.SchemaError, RD>;
  /** Encodes `value` and writes it, with the other attributes from `init`. */
  readonly set: (
    value: A,
    init?: Omit<CookieInit, "name" | "value">,
  ) => Effect.Effect<void, CookieStoreError | Schema.SchemaError, RE>;
  /** Removes the cookie. */
  readonly remove: (options?: DeleteOptions) => Effect.Effect<void, CookieStoreError>;
  /**
   * Each change to the cookie: `Some` of its new value, `None` once it is
   * removed. A value that does not decode is dropped with a warning log.
   */
  readonly changes: Stream.Stream<Option.Option<A>, CookieStoreError, RD>;
}

/**
 * One cookie, read and written through `schema`: a value that does not
 * decode fails `get` with the `SchemaError`, and is dropped from `changes`
 * with a warning log, since another tab or the server may write anything.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { CookieStore, cookie, make } from "@thomasfosterau/effect-platform-worker-shared/CookieStore"
 *
 * const visits = cookie("visits", Schema.FiniteFromString)
 * const page = { cookie: "" }
 * const program = Effect.andThen(visits.set(3), visits.get).pipe(
 *   Effect.provideService(CookieStore, make({ document: page })),
 * )
 * Effect.runPromise(program).then(console.log) // Some(3)
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const cookie = <S extends Schema.Top & { readonly Encoded: string }>(
  name: string,
  schema: S,
): TypedCookie<S["Type"], S["DecodingServices"], S["EncodingServices"]> => {
  const decode = Schema.decodeUnknownEffect(schema);
  const encode = Schema.encodeEffect(schema);
  const values = (cookies: ReadonlyArray<Cookie>) =>
    Arr.filter(cookies, (item) => item.name === name);
  return {
    get: Effect.flatMap(get(name), (found) =>
      Option.match(found, {
        onNone: () => Effect.succeedNone,
        onSome: (item) => Effect.asSome(decode(item.value)),
      }),
    ),
    set: (value, init) =>
      Effect.flatMap(encode(value), (encoded) => set({ ...init, name, value: encoded })),
    remove: (options) => remove(name, options),
    changes: changes.pipe(
      Stream.flatMap((change) =>
        Stream.fromIterable([
          ...Arr.map(values(change.changed), (item) => Option.some(item.value)),
          ...Arr.map(values(change.deleted), () => Option.none<string>()),
        ]),
      ),
      Stream.filterMapEffect((value) =>
        Option.match(value, {
          onNone: () => Effect.succeed(Result.succeed(Option.none<S["Type"]>())),
          onSome: (encoded) =>
            decode(encoded).pipe(
              Effect.map((decoded) => Result.succeed(Option.some(decoded))),
              Effect.catch((error) =>
                Effect.as(
                  Effect.logWarning(`cookie ${name}: dropped a value`, error.message),
                  Result.failVoid,
                ),
              ),
            ),
        }),
      ),
    ),
  };
};
