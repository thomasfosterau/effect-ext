/**
 * The worker's global scope (`self` in a dedicated, shared or service
 * worker) as a context reference, and the readings and events every kind of
 * worker shares.
 *
 * Nothing here reads a global at import. {@link WorkerScope} defaults to
 * `globalThis` when it is a `WorkerGlobalScope`, read on first use; a test
 * provides a stub, and a page sees `Option.none()`.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

/**
 * The structural slice of a `WorkerGlobalScope` this package uses. The
 * `webworker` lib's `WorkerGlobalScope` satisfies it, so does a test's
 * `EventTarget`.
 *
 * @since 0.1.0
 * @category models
 */
export interface WorkerGlobalScopeLike extends Stream.EventListener {
  readonly location: { readonly href: string };
  readonly isSecureContext: boolean;
  readonly crossOriginIsolated: boolean;
}

/**
 * The part of an `ErrorEvent` an uncaught exception arrives as.
 *
 * @since 0.1.0
 * @category models
 */
export interface ErrorEventLike {
  readonly message: string;
  readonly filename: string;
  readonly lineno: number;
  readonly colno: number;
  readonly error: unknown;
}

/**
 * The part of a `PromiseRejectionEvent` an unhandled rejection arrives as.
 *
 * @since 0.1.0
 * @category models
 */
export interface PromiseRejectionEventLike {
  readonly reason: unknown;
}

/**
 * Something escaped every handler in the worker: an uncaught exception
 * (`error`) or a rejected promise nobody awaited (`unhandledrejection`).
 *
 * @since 0.1.0
 * @category models
 */
export type Uncaught = Data.TaggedEnum<{
  Error: { readonly message: string; readonly error: unknown };
  UnhandledRejection: { readonly reason: unknown };
}>;

/**
 * Constructors and matchers for {@link Uncaught}.
 *
 * @example
 * ```ts
 * import { Uncaught } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope"
 *
 * const describe = Uncaught.$match({
 *   Error: ({ message }) => `threw: ${message}`,
 *   UnhandledRejection: () => "rejected",
 * })
 * console.log(describe(Uncaught.Error({ message: "boom", error: undefined }))) // "threw: boom"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const Uncaught = /*#__PURE__*/ Data.taggedEnum<Uncaught>();

/**
 * The context is not a worker: there is no `WorkerGlobalScope` to read.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { location } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope"
 *
 * // Under Node there is no worker scope.
 * Effect.runPromise(Effect.flip(location)).then((error) => console.log(error._tag))
 * // "WorkerScopeUnavailable"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class WorkerScopeUnavailable extends Schema.TaggedError<
  WorkerScopeUnavailable,
  { readonly brand: unique symbol }
>()("WorkerScopeUnavailable", {}) {
  override get message(): string {
    return "not running in a worker: no WorkerGlobalScope";
  }
}

/**
 * Whether `value` is a `WorkerGlobalScope` of this realm. Read structurally
 * from the realm's own constructor, so a page (which has none) answers
 * `false`.
 */
/**
 * Whether `value` is an instance of the global constructor `name` in this
 * realm (`"WorkerGlobalScope"`, `"DedicatedWorkerGlobalScope"`, …): `false`
 * where the realm has no such constructor, so a page or Node answers
 * `false` for every worker scope.
 *
 * @example
 * ```ts
 * import { isInstanceOfGlobal } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope"
 *
 * console.log(isInstanceOfGlobal(globalThis, "WorkerGlobalScope")) // false under Node
 * console.log(isInstanceOfGlobal(new URL("https://example.com"), "URL")) // true
 * ```
 *
 * @since 0.1.0
 * @category guards
 */
export const isInstanceOfGlobal = (value: unknown, name: string): boolean => {
  const realm: object = globalThis;
  return P.hasProperty(realm, name) && P.isFunction(realm[name]) && value instanceof realm[name];
};

const isWorkerGlobalScope = (value: unknown): value is WorkerGlobalScopeLike =>
  isInstanceOfGlobal(value, "WorkerGlobalScope");

const ambientScope = (): Option.Option<WorkerGlobalScopeLike> => {
  const self: unknown = globalThis;
  return isWorkerGlobalScope(self) ? Option.some(self) : Option.none();
};

/**
 * The worker's global scope. Defaults to `globalThis` when it is a
 * `WorkerGlobalScope`, else `Option.none()`; provide
 * `Option.some(stub)` in a test.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { WorkerScope, location } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   location: { href: "https://example.com/worker.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 * })
 * const program = location.pipe(Effect.provideService(WorkerScope, Option.some(stub)))
 * Effect.runPromise(program).then((url) => console.log(url.pathname)) // "/worker.js"
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const WorkerScope: Context.Reference<Option.Option<WorkerGlobalScopeLike>> =
  /*#__PURE__*/ Context.Reference("@thomasfosterau/effect-platform-worker-shared/WorkerScope", {
    defaultValue: ambientScope,
  });

/**
 * The worker's global scope, failing outside a worker.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { scope } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope"
 *
 * Effect.runPromise(Effect.flip(scope)).then((error) => console.log(error._tag))
 * // "WorkerScopeUnavailable" under Node
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const scope: Effect.Effect<WorkerGlobalScopeLike, WorkerScopeUnavailable> = WorkerScope.use(
  (self) => Effect.mapError(Effect.fromOption(self), () => new WorkerScopeUnavailable()),
);

/**
 * The URL the worker script was loaded from (`self.location`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { WorkerScope, location } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   location: { href: "https://example.com/sw.js?v=2" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 * })
 * const program = location.pipe(Effect.provideService(WorkerScope, Option.some(stub)))
 * Effect.runPromise(program).then((url) => console.log(url.searchParams.get("v"))) // "2"
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const location: Effect.Effect<URL, WorkerScopeUnavailable> = Effect.map(
  scope,
  (self) => new URL(self.location.href),
);

/**
 * Whether the worker runs in a secure context, which gates Cache Storage,
 * Web Crypto's `subtle`, Web Locks and service workers themselves.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { WorkerScope, isSecureContext } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   location: { href: "http://localhost/worker.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 * })
 * const program = isSecureContext.pipe(Effect.provideService(WorkerScope, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // true
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const isSecureContext: Effect.Effect<boolean, WorkerScopeUnavailable> = Effect.map(
  scope,
  (self) => self.isSecureContext,
);

/**
 * Whether the worker is cross-origin isolated, which `SharedArrayBuffer`
 * and high-resolution timers require.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { WorkerScope, crossOriginIsolated } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   location: { href: "https://example.com/worker.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: true,
 * })
 * const program = crossOriginIsolated.pipe(Effect.provideService(WorkerScope, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // true
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const crossOriginIsolated: Effect.Effect<boolean, WorkerScopeUnavailable> = Effect.map(
  scope,
  (self) => self.crossOriginIsolated,
);

/**
 * Reads an `error` or `unhandledrejection` event as an {@link Uncaught}.
 * Anything else is `None`.
 *
 * @example
 * ```ts
 * import { toUncaught } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope"
 *
 * console.log(toUncaught("unhandledrejection", { reason: "boom" }))
 * // Some({ _tag: "UnhandledRejection", reason: "boom" })
 * ```
 *
 * @since 0.1.0
 * @category conversions
 */
export const toUncaught = (type: string, event: unknown): Option.Option<Uncaught> => {
  if (type === "unhandledrejection" && P.hasProperty(event, "reason")) {
    return Option.some(Uncaught.UnhandledRejection({ reason: event.reason }));
  }
  if (type === "error" && P.hasProperty(event, "message")) {
    return Option.some(
      Uncaught.Error({
        message: P.isString(event.message) ? event.message : "",
        error: P.hasProperty(event, "error") ? event.error : undefined,
      }),
    );
  }
  return Option.none();
};

/**
 * Every uncaught exception and unhandled rejection in the worker, from the
 * moment the stream runs. Observing does not mark them handled: the
 * browser still reports each to the console.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import * as Option from "effect/Option"
 * import * as Stream from "effect/Stream"
 * import { WorkerScope, uncaught } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   location: { href: "https://example.com/worker.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 * })
 * const program = Effect.gen(function* () {
 *   const fiber = yield* Effect.forkChild(Stream.runHead(uncaught))
 *   yield* Effect.sleep("10 millis")
 *   stub.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "boom" }))
 *   return yield* Fiber.join(fiber)
 * }).pipe(Effect.provideService(WorkerScope, Option.some(stub)))
 * Effect.runPromise(program).then(console.log)
 * // Some({ _tag: "UnhandledRejection", reason: "boom" })
 * ```
 *
 * @since 0.1.0
 * @category streams
 */
export const uncaught: Stream.Stream<Uncaught, WorkerScopeUnavailable> = Stream.unwrap(
  Effect.map(scope, (self) =>
    Stream.merge(
      Stream.fromEventListener(self, "error"),
      Stream.map(Stream.fromEventListener(self, "unhandledrejection"), (event) => ({
        rejection: event,
      })),
    ).pipe(
      Stream.filterMap((event) =>
        Result.fromOption(
          P.hasProperty(event, "rejection")
            ? toUncaught("unhandledrejection", event.rejection)
            : toUncaught("error", event),
          () => event,
        ),
      ),
    ),
  ),
);
