/**
 * The Badging API: a count, or a plain dot, on an installed web app's icon,
 * set from a window or from the app's service worker (to show unread items
 * from a push). A page that is not installed has the API in Chromium, but
 * the badge shows nowhere.
 *
 * {@link AppBadge} is a context reference that defaults, on first read, to
 * the ambient `navigator`; a test provides one built by {@link make}.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";

/**
 * The slice of a `navigator` (a window's, or a worker's) this module calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface BadgeNavigatorLike {
  setAppBadge(contents?: number): Promise<void>;
  clearAppBadge(): Promise<void>;
}

/**
 * Why a badge call failed: `Unsupported` (no Badging API: Firefox, or a
 * dedicated worker in some agents), `InvalidCount` (a count that is not a
 * whole number from 0 up), `NotAllowed` (the agent refused, such as a
 * sandboxed frame or a page without notification permission in Safari),
 * `Failed` (anything else).
 *
 * @since 0.1.0
 * @category models
 */
export type AppBadgeErrorReason = "Unsupported" | "InvalidCount" | "NotAllowed" | "Failed";

/**
 * A badge call failed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/AppBadge"
 *
 * Effect.runPromise(Effect.flip(make().set(3))).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class AppBadgeError extends Schema.TaggedError<
  AppBadgeError,
  { readonly brand: unique symbol }
>()("AppBadgeError", {
  reason: Schema.Literals(["Unsupported", "InvalidCount", "NotAllowed", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

/**
 * The operations an {@link AppBadge} offers.
 *
 * @since 0.1.0
 * @category models
 */
export interface AppBadgeService {
  /** Whether the agent has the Badging API. */
  readonly supported: boolean;
  /** Shows `count` on the icon, or a plain dot without one; a count of `0` clears it. */
  readonly set: (count?: number) => Effect.Effect<void, AppBadgeError>;
  /** Clears the badge. */
  readonly clear: Effect.Effect<void, AppBadgeError>;
}

const failure = (reason: AppBadgeErrorReason, cause: unknown): AppBadgeError =>
  new AppBadgeError({ reason, cause, message: `app badge: ${reason}` });

const reasonOf = (cause: unknown): AppBadgeErrorReason => {
  const name = P.hasProperty(cause, "name") && P.isString(cause.name) ? cause.name : "";
  if (name === "TypeError") return "InvalidCount";
  return name === "NotAllowedError" || name === "SecurityError" ? "NotAllowed" : "Failed";
};

const attempt = (call: () => PromiseLike<void>): Effect.Effect<void, AppBadgeError> =>
  Effect.tryPromise({ try: call, catch: (cause) => failure(reasonOf(cause), cause) });

const isCount = (count: number): boolean => Number.isSafeInteger(count) && count >= 0;

/**
 * Builds an {@link AppBadgeService} over a `navigator`; without one, the
 * unsupported service. A count is checked before the call, so a negative or
 * fractional one fails `InvalidCount` in every agent.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/AppBadge"
 *
 * const badge = make({
 *   setAppBadge: (contents) => Promise.resolve(console.log("badge", contents)),
 *   clearAppBadge: () => Promise.resolve(console.log("cleared")),
 * })
 * Effect.runPromise(badge.set(3)) // badge 3
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (navigator?: BadgeNavigatorLike): AppBadgeService =>
  Option.match(Option.fromUndefinedOr(navigator), {
    onNone: () => ({
      supported: false,
      set: () => Effect.fail(failure("Unsupported", undefined)),
      clear: Effect.fail(failure("Unsupported", undefined)),
    }),
    onSome: (self) => ({
      supported: true,
      set: (count) =>
        count === undefined
          ? attempt(() => self.setAppBadge())
          : isCount(count)
            ? attempt(() => self.setAppBadge(count))
            : Effect.fail(failure("InvalidCount", count)),
      clear: attempt(() => self.clearAppBadge()),
    }),
  });

/** The ambient `navigator`, where it has the Badging API; it is called as a method, keeping `this`. */
const ambient = (): AppBadgeService => {
  const scope: Partial<Pick<typeof globalThis, "navigator">> = globalThis;
  return make(
    Option.getOrUndefined(
      Option.filter(Option.fromUndefinedOr(scope.navigator), (navigator) => {
        const badging: Partial<BadgeNavigatorLike> = navigator;
        return P.isFunction(badging.setAppBadge) && P.isFunction(badging.clearAppBadge);
      }),
    ),
  );
};

/**
 * The app badge. Defaults to the ambient `navigator`'s Badging API (a
 * window's or a worker's), read on first use; provide one built by
 * {@link make} to replace it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { AppBadge } from "@thomasfosterau/effect-platform-worker-shared/AppBadge"
 *
 * const program = AppBadge.use((badge) => Effect.succeed(badge.supported))
 * Effect.runPromise(program).then(console.log) // true in Chromium and Safari
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const AppBadge: Context.Reference<AppBadgeService> = /*#__PURE__*/ Context.Reference(
  "@thomasfosterau/effect-platform-worker-shared/AppBadge",
  { defaultValue: ambient },
);

/**
 * Shows `count` on the app's icon, or a plain dot without one; `0` clears
 * it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { set } from "@thomasfosterau/effect-platform-worker-shared/AppBadge"
 *
 * Effect.runPromise(Effect.ignore(set(5)))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const set = (count?: number): Effect.Effect<void, AppBadgeError> =>
  AppBadge.use((self) => self.set(count));

/**
 * Clears the app's badge.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { clear } from "@thomasfosterau/effect-platform-worker-shared/AppBadge"
 *
 * Effect.runPromise(Effect.ignore(clear))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const clear: Effect.Effect<void, AppBadgeError> = AppBadge.use((self) => self.clear);
