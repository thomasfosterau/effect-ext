/**
 * Navigation preload: the browser starts a navigation's network request
 * while the worker boots, and the worker answers with it (`Fetch`'s
 * `withNavigationPreload`). Turn it on during `activate`, and set the
 * header the server sees on preload requests.
 *
 * Nothing here touches a global at import: {@link NavigationPreload} is a
 * context reference defaulting to `self.registration.navigationPreload`
 * when the realm is a `ServiceWorkerGlobalScope`, read on first use.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import { isInstanceOfGlobal } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";
import { reasonOf } from "./internal/dom.ts";

/**
 * The part of a `NavigationPreloadManager` this module calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface NavigationPreloadManagerLike {
  enable(): Promise<void>;
  disable(): Promise<void>;
  setHeaderValue(value: string): Promise<void>;
  getState(): Promise<{ readonly enabled?: boolean; readonly headerValue?: string }>;
}

/**
 * Whether navigation preload is on, and the `Service-Worker-Navigation-Preload`
 * header value the server sees (`"true"` unless one was set).
 *
 * @since 0.1.0
 * @category models
 */
export interface NavigationPreloadState {
  readonly enabled: boolean;
  readonly headerValue: string;
}

/**
 * Which call failed.
 *
 * @since 0.1.0
 * @category models
 */
export type NavigationPreloadOperation = "enable" | "disable" | "setHeaderValue" | "getState";

/**
 * Why it failed.
 *
 * - `Unsupported` — no navigation preload here (not a service worker, a
 *   browser without it, and none provided).
 * - `InvalidState` — refused with `InvalidStateError`: the registration has
 *   no active worker yet (call it from `activate` or later).
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.1.0
 * @category errors
 */
export type NavigationPreloadErrorReason = "Unsupported" | "InvalidState" | "Failed";

/**
 * A navigation preload call that failed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { enable } from "@thomasfosterau/effect-platform-service-worker/NavigationPreload"
 *
 * Effect.runPromise(Effect.flip(enable)).then((error) => console.log(error.reason))
 * // "Unsupported" under Node
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class NavigationPreloadError extends Schema.TaggedError<
  NavigationPreloadError,
  { readonly brand: unique symbol }
>()("NavigationPreloadError", {
  operation: Schema.Literals(["enable", "disable", "setHeaderValue", "getState"]),
  reason: Schema.Literals(["Unsupported", "InvalidState", "Failed"]),
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `service-worker: navigation preload ${this.operation}: ${this.reason}`;
  }
}

const isManager = (value: unknown): value is NavigationPreloadManagerLike =>
  P.hasProperty(value, "enable") &&
  P.isFunction(value.enable) &&
  P.hasProperty(value, "getState") &&
  P.isFunction(value.getState);

/** `self.registration.navigationPreload` in a service worker; `None` anywhere else. */
const ambient = (): Option.Option<NavigationPreloadManagerLike> => {
  const self: unknown = globalThis;
  return isInstanceOfGlobal(self, "ServiceWorkerGlobalScope") &&
    P.hasProperty(self, "registration") &&
    P.hasProperty(self.registration, "navigationPreload") &&
    isManager(self.registration.navigationPreload)
    ? Option.some(self.registration.navigationPreload)
    : Option.none();
};

/**
 * The registration's `NavigationPreloadManager`. Defaults to
 * `self.registration.navigationPreload` in a service worker that has one,
 * else `Option.none()`, read on first use; provide `Option.some(stub)` in a
 * test.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { NavigationPreload, enable, state } from "@thomasfosterau/effect-platform-service-worker/NavigationPreload"
 *
 * let enabled = false
 * const manager = {
 *   enable: async () => { enabled = true },
 *   disable: async () => { enabled = false },
 *   setHeaderValue: async () => {},
 *   getState: async () => ({ enabled }),
 * }
 * const program = Effect.andThen(enable, state).pipe(
 *   Effect.provideService(NavigationPreload, Option.some(manager)),
 * )
 * Effect.runPromise(program).then(console.log) // { enabled: true, headerValue: "true" }
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const NavigationPreload: Context.Reference<Option.Option<NavigationPreloadManagerLike>> =
  /*#__PURE__*/ Context.Reference(
    "@thomasfosterau/effect-platform-service-worker/NavigationPreload/NavigationPreload",
    { defaultValue: ambient },
  );

const REJECTIONS = {
  InvalidStateError: "InvalidState",
} satisfies Readonly<Record<string, NavigationPreloadErrorReason>>;

const call = <A>(
  operation: NavigationPreloadOperation,
  f: (manager: NavigationPreloadManagerLike) => Promise<A>,
): Effect.Effect<A, NavigationPreloadError> =>
  NavigationPreload.use((manager) =>
    Option.match(manager, {
      onNone: () =>
        Effect.fail(
          new NavigationPreloadError({ operation, reason: "Unsupported", cause: undefined }),
        ),
      onSome: (present) =>
        Effect.tryPromise({
          try: () => f(present),
          catch: (cause) =>
            new NavigationPreloadError({
              operation,
              reason: reasonOf(cause, REJECTIONS, "Failed"),
              cause,
            }),
        }),
    }),
  );

/**
 * Turns navigation preload on: from now on the browser preloads each
 * navigation this worker controls. Call it from `activate` (see
 * `Events.extendableListener`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { NavigationPreload, enable } from "@thomasfosterau/effect-platform-service-worker/NavigationPreload"
 *
 * const manager = {
 *   enable: async () => console.log("enabled"),
 *   disable: async () => {},
 *   setHeaderValue: async () => {},
 *   getState: async () => ({}),
 * }
 * Effect.runPromise(enable.pipe(Effect.provideService(NavigationPreload, Option.some(manager))))
 * // logs "enabled"
 * ```
 *
 * @since 0.1.0
 * @category lifecycle
 */
export const enable: Effect.Effect<void, NavigationPreloadError> = call("enable", (manager) =>
  manager.enable(),
);

/**
 * Turns navigation preload off.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { NavigationPreload, disable } from "@thomasfosterau/effect-platform-service-worker/NavigationPreload"
 *
 * const manager = {
 *   enable: async () => {},
 *   disable: async () => console.log("disabled"),
 *   setHeaderValue: async () => {},
 *   getState: async () => ({}),
 * }
 * Effect.runPromise(disable.pipe(Effect.provideService(NavigationPreload, Option.some(manager))))
 * // logs "disabled"
 * ```
 *
 * @since 0.1.0
 * @category lifecycle
 */
export const disable: Effect.Effect<void, NavigationPreloadError> = call("disable", (manager) =>
  manager.disable(),
);

/**
 * Sets the `Service-Worker-Navigation-Preload` header value preload
 * requests carry (`"true"` by default), so the server can send a lighter
 * response to a preload.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { NavigationPreload, setHeaderValue } from "@thomasfosterau/effect-platform-service-worker/NavigationPreload"
 *
 * const manager = {
 *   enable: async () => {},
 *   disable: async () => {},
 *   setHeaderValue: async (value: string) => console.log(value),
 *   getState: async () => ({}),
 * }
 * Effect.runPromise(
 *   setHeaderValue("shell-v3").pipe(Effect.provideService(NavigationPreload, Option.some(manager))),
 * ) // logs "shell-v3"
 * ```
 *
 * @since 0.1.0
 * @category lifecycle
 */
export const setHeaderValue = (value: string): Effect.Effect<void, NavigationPreloadError> =>
  call("setHeaderValue", (manager) => manager.setHeaderValue(value));

/**
 * Whether navigation preload is on, and its header value.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { NavigationPreload, state } from "@thomasfosterau/effect-platform-service-worker/NavigationPreload"
 *
 * const manager = {
 *   enable: async () => {},
 *   disable: async () => {},
 *   setHeaderValue: async () => {},
 *   getState: async () => ({ enabled: true, headerValue: "shell-v3" }),
 * }
 * Effect.runPromise(state.pipe(Effect.provideService(NavigationPreload, Option.some(manager))))
 *   .then(console.log) // { enabled: true, headerValue: "shell-v3" }
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const state: Effect.Effect<NavigationPreloadState, NavigationPreloadError> = Effect.map(
  call("getState", (manager) => manager.getState()),
  (raw) => ({ enabled: raw.enabled ?? false, headerValue: raw.headerValue ?? "true" }),
);
