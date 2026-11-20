/**
 * A service worker's extendable events: listeners whose work runs as an
 * `Effect` inside `event.waitUntil` (`install`, `activate`, a schema-checked
 * `message`), and {@link EventLifetime}, where work that outlives a
 * response goes.
 *
 * A listener is built by running an effect once, synchronously, while the
 * worker script evaluates: the browser only dispatches events to listeners
 * added during that first evaluation. Event types are structural, so this
 * entry compiles under the `dom` lib; the `webworker` lib's events satisfy
 * them.
 *
 * @since 0.1.0
 */
import type * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as internal from "./internal/events.ts";

/**
 * The part of an `ExtendableEvent` (`install`, `activate`, and the base of
 * `fetch` / `message` / `notificationclick`) this package uses: the
 * lifetime extension.
 *
 * @since 0.1.0
 * @category models
 */
export type ExtendableEventLike = internal.ExtendableEventLike;

/**
 * The part of an `ExtendableMessageEvent` (a `message` event in a service
 * worker) this entry uses.
 *
 * @since 0.1.0
 * @category models
 */
export interface ExtendableMessageEventLike extends ExtendableEventLike {
  readonly data: unknown;
}

/**
 * How background work outlives the effect that started it: inside a
 * listener built here, each call registers the work with the event's
 * `waitUntil`, so the browser keeps the worker alive until it settles.
 * `extend` starts the effect on a detached fiber and returns at once; a
 * failure is logged at `Warning` and never reaches the caller.
 *
 * @since 0.1.0
 * @category models
 */
export type EventLifetimeService = internal.EventLifetimeService;

/**
 * The current event's lifetime. The listeners in this package provide one
 * bound to the event they handle; outside a listener (a test) the default
 * forks the work detached with nothing to keep it alive.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { EventLifetime } from "@thomasfosterau/effect-platform-service-worker/Events"
 *
 * const program = Effect.gen(function* () {
 *   const lifetime = yield* EventLifetime
 *   yield* lifetime.extend(Effect.log("after the response"))
 *   return "response"
 * })
 *
 * await Effect.runPromise(program) // "response"
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const EventLifetime: Context.Reference<EventLifetimeService> = internal.EventLifetime;

/**
 * Turns `handle` into a listener for an extendable event (`install`,
 * `activate`, or any other whose work belongs in `waitUntil`): the effect's
 * promise goes to `event.waitUntil`, so a failure rejects it. For `install`
 * that fails the installation, leaving the previous worker in charge; for
 * `activate` the browser logs it and activates anyway.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, deleteCachesExcept, memoryCacheStorage, openCache } from "@thomasfosterau/effect-platform-service-worker/Caches"
 * import { extendableListener } from "@thomasfosterau/effect-platform-service-worker/Events"
 *
 * const storage = memoryCacheStorage()
 * await Effect.runPromise(openCache("static-v1").pipe(Effect.provideService(Caches, storage)))
 *
 * // In a worker: `self.addEventListener("activate", onActivate)`.
 * const onActivate = Effect.runSync(
 *   extendableListener(() => deleteCachesExcept(["static-v2"])).pipe(
 *     Effect.provideService(Caches, storage),
 *   ),
 * )
 *
 * const pending: Array<Promise<unknown>> = []
 * onActivate({ waitUntil: (promise) => { pending.push(promise) } })
 * await Promise.all(pending) // [["static-v1"]]
 * ```
 *
 * @since 0.1.0
 * @category listeners
 */
export const extendableListener: <Event extends ExtendableEventLike, E, R>(
  handle: (event: Event) => Effect.Effect<unknown, E, R>,
) => Effect.Effect<(event: Event) => void, never, R> = internal.extendableListener;

/**
 * Turns `handle` into a `message` listener that decodes `event.data` with
 * `schema` first: a client's `postMessage` arrives as `unknown`, and this
 * is its boundary. A message that fails to decode is logged at `Warning`
 * and dropped (the listener's promise still resolves); a decoded one runs
 * `handle` inside `waitUntil`, as {@link extendableListener} does.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { messageListener } from "@thomasfosterau/effect-platform-service-worker/Events"
 *
 * const SkipWaiting = Schema.Struct({ type: Schema.Literal("SKIP_WAITING") })
 * const seen: Array<string> = []
 *
 * // In a worker, `handle` would call `self.skipWaiting()`.
 * const onMessage = Effect.runSync(
 *   messageListener(SkipWaiting, (message) => Effect.sync(() => seen.push(message.type))),
 * )
 *
 * const pending: Array<Promise<unknown>> = []
 * const waitUntil = (promise: Promise<unknown>) => { pending.push(promise) }
 * onMessage({ data: { type: "SKIP_WAITING" }, waitUntil })
 * onMessage({ data: "not a message", waitUntil })
 * await Promise.all(pending)
 * seen // ["SKIP_WAITING"]
 * ```
 *
 * @since 0.1.0
 * @category listeners
 */
export const messageListener = <
  S extends Schema.Constraint,
  Event extends ExtendableMessageEventLike,
  E,
  R,
>(
  schema: S,
  handle: (message: S["Type"], event: Event) => Effect.Effect<unknown, E, R>,
): Effect.Effect<(event: Event) => void, never, R | S["DecodingServices"]> =>
  internal.decodedListener(
    schema,
    (event: Event) => event.data,
    "service-worker: message dropped",
    handle,
  );
