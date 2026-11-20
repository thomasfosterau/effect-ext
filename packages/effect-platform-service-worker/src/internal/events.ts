/**
 * The event-lifetime machinery `Events`, `Fetch` and `Notifications` share:
 * the `EventLifetime` reference, binding it to an event, and running a
 * listener's effect inside `waitUntil`.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** See `Events.ExtendableEventLike`. */
export interface ExtendableEventLike {
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

/** See `Events.EventLifetimeService`. */
export interface EventLifetimeService {
  /**
   * Starts `effect` on a detached fiber and returns at once. A failure is
   * logged at `Warning` and never reaches the caller: the response the
   * caller is serving has already been decided.
   */
  readonly extend: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<void, never, R>;
}

const logBackgroundFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.catchCause(effect, (cause) =>
    Effect.logWarning("service-worker: background work failed", cause),
  );

const detached: EventLifetimeService = {
  extend: (effect) => Effect.asVoid(Effect.forkDetach(logBackgroundFailure(effect))),
};

/**
 * Binds background work to `event`: the detached fiber's completion is
 * handed to `event.waitUntil`. It must be called while the event is still
 * extendable (before the `respondWith` / `waitUntil` promise the listener
 * registered settles), which holds for every call made from inside the
 * listener's effect.
 */
export const eventLifetime = (event: ExtendableEventLike): EventLifetimeService => ({
  extend: (effect) =>
    Effect.flatMap(Effect.forkDetach(logBackgroundFailure(effect)), (fiber) =>
      Effect.sync(() =>
        event.waitUntil(
          new Promise<void>((resolve) => {
            fiber.addObserver(() => resolve());
          }),
        ),
      ),
    ),
});

/** See `Events.EventLifetime`. */
export const EventLifetime: Context.Reference<EventLifetimeService> =
  /*#__PURE__*/ Context.Reference(
    "@thomasfosterau/effect-platform-service-worker/Events/EventLifetime",
    { defaultValue: () => detached },
  );

/** See `Events.extendableListener`. */
export const extendableListener = <Event extends ExtendableEventLike, E, R>(
  handle: (event: Event) => Effect.Effect<unknown, E, R>,
): Effect.Effect<(event: Event) => void, never, R> =>
  Effect.map(Effect.context<R>(), (context) => {
    const run = Effect.runPromiseWith(context);
    return (event: Event) =>
      event.waitUntil(
        run(handle(event).pipe(Effect.provideService(EventLifetime, eventLifetime(event)))),
      );
  });

/**
 * An {@link extendableListener} that decodes `read(event)` with `schema`
 * first: an undecodable payload is logged at `Warning` as `dropped` and
 * the handler is skipped.
 */
export const decodedListener = <
  S extends Schema.Constraint,
  Event extends ExtendableEventLike,
  E,
  R,
>(
  schema: S,
  read: (event: Event) => S["Encoded"],
  dropped: string,
  handle: (decoded: S["Type"], event: Event) => Effect.Effect<unknown, E, R>,
): Effect.Effect<(event: Event) => void, never, R | S["DecodingServices"]> => {
  const decode = Schema.decodeUnknownEffect(schema);
  return extendableListener((event: Event) =>
    decode(read(event)).pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.logWarning(dropped, error),
        onSuccess: (decoded) => handle(decoded, event),
      }),
    ),
  );
};
