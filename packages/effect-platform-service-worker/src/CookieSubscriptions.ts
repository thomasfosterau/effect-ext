/**
 * Cookie changes inside a service worker: subscribe through the
 * registration's `CookieStoreManager` (`self.registration.cookies`), and
 * hear them as `cookiechange` events with {@link cookieChangeListener}.
 * A window hears changes through `CookieStore.changes` in
 * effect-platform-worker-shared instead; `get`, `set` and the rest work
 * the same in both.
 *
 * Nothing here touches a global at import: {@link CookieSubscriptions} is
 * a context reference defaulting to `self.registration.cookies` when the
 * realm is a `ServiceWorkerGlobalScope`, read on first use; a test
 * provides {@link memoryCookieSubscriptions}.
 *
 * @since 0.2.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import type {
  Cookie,
  CookieChange,
  CookieListItemLike,
} from "@thomasfosterau/effect-platform-worker-shared/CookieStore";
import { isInstanceOfGlobal } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";
import { reasonOf } from "./internal/dom.ts";
import * as internal from "./internal/events.ts";

/**
 * Which cookie changes to hear: those to cookies visible at `url` (an
 * absolute URL, or one relative to the worker's scope, which it must be
 * inside), named `name` (default: every name).
 *
 * @since 0.2.0
 * @category models
 */
export interface CookieSubscription {
  readonly name?: string;
  readonly url: string;
}

/**
 * A subscription as the registration reports it.
 *
 * @since 0.2.0
 * @category models
 */
export interface ActiveCookieSubscription {
  readonly name: Option.Option<string>;
  readonly url: string;
}

/**
 * The slice of a `CookieStoreManager` this module calls.
 *
 * @since 0.2.0
 * @category models
 */
export interface CookieStoreManagerLike {
  subscribe(subscriptions: ReadonlyArray<CookieSubscription>): Promise<void>;
  unsubscribe(subscriptions: ReadonlyArray<CookieSubscription>): Promise<void>;
  getSubscriptions(): Promise<ReadonlyArray<{ readonly name?: string; readonly url?: string }>>;
}

/**
 * Which call failed.
 *
 * @since 0.2.0
 * @category models
 */
export type CookieSubscriptionOperation = "subscribe" | "unsubscribe" | "subscriptions";

/**
 * Why it failed.
 *
 * - `Unsupported` — no `CookieStoreManager` here (not a service worker, a
 *   browser without the Cookie Store API, and none provided).
 * - `InvalidSubscription` — refused with `TypeError`: a `url` outside the
 *   worker's scope, or one that does not parse.
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.2.0
 * @category models
 */
export type CookieSubscriptionErrorReason = "Unsupported" | "InvalidSubscription" | "Failed";

/**
 * A cookie subscription call that failed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { subscribe } from "@thomasfosterau/effect-platform-service-worker/CookieSubscriptions"
 *
 * Effect.runPromise(Effect.flip(subscribe([{ url: "/" }]))).then((error) =>
 *   console.log(error.reason), // "Unsupported" under Node
 * )
 * ```
 *
 * @since 0.2.0
 * @category errors
 */
export class CookieSubscriptionError extends Schema.TaggedError<CookieSubscriptionError>()(
  "CookieSubscriptionError",
  {
    operation: Schema.Literals(["subscribe", "unsubscribe", "subscriptions"]),
    reason: Schema.Literals(["Unsupported", "InvalidSubscription", "Failed"]),
    cause: Schema.Unknown,
  },
) {
  override get message(): string {
    return `service-worker: cookie ${this.operation}: ${this.reason}`;
  }
}

const isManager = (value: unknown): value is CookieStoreManagerLike =>
  P.hasProperty(value, "subscribe") &&
  P.isFunction(value.subscribe) &&
  P.hasProperty(value, "getSubscriptions") &&
  P.isFunction(value.getSubscriptions);

/** `self.registration.cookies` in a service worker; `None` anywhere else. */
const ambient = (): Option.Option<CookieStoreManagerLike> => {
  const self: unknown = globalThis;
  return isInstanceOfGlobal(self, "ServiceWorkerGlobalScope") &&
    P.hasProperty(self, "registration") &&
    P.hasProperty(self.registration, "cookies") &&
    isManager(self.registration.cookies)
    ? Option.some(self.registration.cookies)
    : Option.none();
};

/**
 * The registration's `CookieStoreManager`. Defaults to
 * `self.registration.cookies` in a service worker that has one, else
 * `Option.none()`, read on first use; provide
 * `Option.some(memoryCookieSubscriptions())` in a test.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { CookieSubscriptions, memoryCookieSubscriptions, subscribe, subscriptions } from "@thomasfosterau/effect-platform-service-worker/CookieSubscriptions"
 *
 * const program = Effect.andThen(subscribe([{ name: "session", url: "/" }]), subscriptions).pipe(
 *   Effect.provideService(CookieSubscriptions, Option.some(memoryCookieSubscriptions())),
 * )
 * Effect.runPromise(program).then(console.log) // [{ name: Some("session"), url: "/" }]
 * ```
 *
 * @since 0.2.0
 * @category context
 */
export const CookieSubscriptions: Context.Reference<Option.Option<CookieStoreManagerLike>> =
  /*#__PURE__*/ Context.Reference(
    "@thomasfosterau/effect-platform-service-worker/CookieSubscriptions/CookieSubscriptions",
    { defaultValue: ambient },
  );

const REJECTIONS = {
  TypeError: "InvalidSubscription",
} satisfies Readonly<Record<string, CookieSubscriptionErrorReason>>;

const call = <A>(
  operation: CookieSubscriptionOperation,
  f: (manager: CookieStoreManagerLike) => Promise<A>,
): Effect.Effect<A, CookieSubscriptionError> =>
  CookieSubscriptions.use((manager) =>
    Option.match(manager, {
      onNone: () =>
        Effect.fail(
          new CookieSubscriptionError({ operation, reason: "Unsupported", cause: undefined }),
        ),
      onSome: (present) =>
        Effect.tryPromise({
          try: () => f(present),
          catch: (cause) =>
            new CookieSubscriptionError({
              operation,
              reason: reasonOf(cause, REJECTIONS, "Failed"),
              cause,
            }),
        }),
    }),
  );

/**
 * Subscribes the registration to changes to the cookies `subscriptions`
 * name. A subscription persists across worker restarts until it is
 * removed, so subscribing again is harmless; `install` or `activate` is
 * the usual place (see `Events.extendableListener`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { CookieSubscriptions, memoryCookieSubscriptions, subscribe } from "@thomasfosterau/effect-platform-service-worker/CookieSubscriptions"
 *
 * const manager = memoryCookieSubscriptions()
 * await Effect.runPromise(
 *   subscribe([{ name: "session", url: "/" }]).pipe(
 *     Effect.provideService(CookieSubscriptions, Option.some(manager)),
 *   ),
 * )
 * ```
 *
 * @since 0.2.0
 * @category subscriptions
 */
export const subscribe = (
  subscriptions: ReadonlyArray<CookieSubscription>,
): Effect.Effect<void, CookieSubscriptionError> =>
  call("subscribe", (manager) => manager.subscribe(subscriptions));

/**
 * Removes the given subscriptions; one that does not exist is ignored.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { CookieSubscriptions, memoryCookieSubscriptions, subscribe, subscriptions, unsubscribe } from "@thomasfosterau/effect-platform-service-worker/CookieSubscriptions"
 *
 * const program = Effect.gen(function* () {
 *   yield* subscribe([{ url: "/" }])
 *   yield* unsubscribe([{ url: "/" }])
 *   return yield* subscriptions
 * }).pipe(Effect.provideService(CookieSubscriptions, Option.some(memoryCookieSubscriptions())))
 * Effect.runPromise(program).then(console.log) // []
 * ```
 *
 * @since 0.2.0
 * @category subscriptions
 */
export const unsubscribe = (
  subscriptions: ReadonlyArray<CookieSubscription>,
): Effect.Effect<void, CookieSubscriptionError> =>
  call("unsubscribe", (manager) => manager.unsubscribe(subscriptions));

/**
 * The registration's current subscriptions.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { CookieSubscriptions, memoryCookieSubscriptions, subscriptions } from "@thomasfosterau/effect-platform-service-worker/CookieSubscriptions"
 *
 * const program = subscriptions.pipe(
 *   Effect.provideService(CookieSubscriptions, Option.some(memoryCookieSubscriptions())),
 * )
 * Effect.runPromise(program).then(console.log) // []
 * ```
 *
 * @since 0.2.0
 * @category subscriptions
 */
export const subscriptions: Effect.Effect<
  ReadonlyArray<ActiveCookieSubscription>,
  CookieSubscriptionError
> = Effect.map(
  call("subscriptions", (manager) => manager.getSubscriptions()),
  Arr.map((subscription) => ({
    name: Option.fromUndefinedOr(subscription.name),
    url: subscription.url ?? "",
  })),
);

/**
 * The part of an `ExtendableCookieChangeEvent` (`cookiechange` in a
 * service worker) this module reads: the cookies set and those removed.
 *
 * @since 0.2.0
 * @category models
 */
export interface CookieChangeEventLike extends internal.ExtendableEventLike {
  readonly changed?: ReadonlyArray<CookieListItemLike>;
  readonly deleted?: ReadonlyArray<CookieListItemLike>;
}

const toCookie = (item: CookieListItemLike): Cookie => ({
  name: item.name ?? "",
  value: item.value ?? "",
});

/**
 * Turns `handle` into a `cookiechange` listener: each event arrives as a
 * `CookieStore.CookieChange` and runs `handle` inside `waitUntil`, as
 * `Events.extendableListener` does. The browser dispatches only changes
 * the registration {@link subscribe}d to, and only to listeners added
 * while the script first evaluates, so build it then.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { cookieChangeListener } from "@thomasfosterau/effect-platform-service-worker/CookieSubscriptions"
 *
 * const seen: Array<string> = []
 *
 * // In a worker: `self.addEventListener("cookiechange", onCookieChange)`.
 * const onCookieChange = Effect.runSync(
 *   cookieChangeListener((change) =>
 *     Effect.sync(() => seen.push(...change.deleted.map((cookie) => cookie.name))),
 *   ),
 * )
 *
 * const pending: Array<Promise<unknown>> = []
 * onCookieChange({ deleted: [{ name: "session" }], waitUntil: (promise) => { pending.push(promise) } })
 * await Promise.all(pending)
 * seen // ["session"]
 * ```
 *
 * @since 0.2.0
 * @category listeners
 */
export const cookieChangeListener = <Event extends CookieChangeEventLike, E, R>(
  handle: (change: CookieChange, event: Event) => Effect.Effect<unknown, E, R>,
): Effect.Effect<(event: Event) => void, never, R> =>
  internal.extendableListener((event: Event) =>
    handle(
      {
        changed: Arr.map(event.changed ?? [], toCookie),
        deleted: Arr.map(event.deleted ?? [], toCookie),
      },
      event,
    ),
  );

const sameSubscription = (a: CookieSubscription, b: CookieSubscription): boolean =>
  a.url === b.url && a.name === b.name;

/**
 * An in-memory `CookieStoreManager` for tests: subscriptions are kept in
 * order, without duplicates, and nothing is checked against a scope.
 *
 * @example
 * ```ts
 * import { memoryCookieSubscriptions } from "@thomasfosterau/effect-platform-service-worker/CookieSubscriptions"
 *
 * const manager = memoryCookieSubscriptions()
 * await manager.subscribe([{ url: "/" }, { url: "/" }])
 * console.log(await manager.getSubscriptions()) // [{ url: "/" }]
 * ```
 *
 * @since 0.2.0
 * @category testing
 */
export const memoryCookieSubscriptions = (): CookieStoreManagerLike => {
  let current: ReadonlyArray<CookieSubscription> = [];
  return {
    subscribe: (added) => {
      current = Arr.appendAll(
        current,
        Arr.dedupeWith(
          Arr.filter(added, (one) => !Arr.some(current, (it) => sameSubscription(it, one))),
          sameSubscription,
        ),
      );
      return Promise.resolve();
    },
    unsubscribe: (removed) => {
      current = Arr.filter(current, (it) => !Arr.some(removed, (one) => sameSubscription(it, one)));
      return Promise.resolve();
    },
    getSubscriptions: () => Promise.resolve(current),
  };
};
