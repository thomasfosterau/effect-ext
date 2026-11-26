/**
 * The event-lifetime machinery `Events`, `Fetch` and `Notifications` share:
 * the `EventLifetime` reference, binding it to an event, and running a
 * listener's effect inside `waitUntil`.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as R from "effect/Record";
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

/** A payload a listener could not read (a push whose data is not JSON). */
export class UnreadablePayload extends Schema.TaggedError<
  UnreadablePayload,
  { readonly brand: unique symbol }
>()("UnreadablePayload", { cause: Schema.Unknown }) {}

/**
 * An {@link extendableListener} that reads a payload with `read` and
 * decodes it with `schema` first: a payload that cannot be read or does
 * not decode is logged at `Warning` as `dropped` and the handler is
 * skipped.
 */
export const decodedListener = <
  S extends Schema.Constraint,
  Event extends ExtendableEventLike,
  E,
  R,
>(
  schema: S,
  read: (event: Event) => Effect.Effect<unknown, UnreadablePayload>,
  dropped: string,
  handle: (decoded: S["Type"], event: Event) => Effect.Effect<unknown, E, R>,
): Effect.Effect<(event: Event) => void, never, R | S["DecodingServices"]> => {
  const decode = Schema.decodeUnknownEffect(schema);
  return extendableListener((event: Event) =>
    Effect.flatMap(read(event), decode).pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.logWarning(dropped, error),
        onSuccess: (decoded) => handle(decoded, event),
      }),
    ),
  );
};

/** The `tag` an event carries (`sync`, `periodicsync`). */
export interface TaggedEventLike extends ExtendableEventLike {
  readonly tag: string;
}

/** A tag's handler. Its services are read back by {@link HandlerServices}. */
export type TagHandler<Event> = (event: Event) => Effect.Effect<unknown, unknown, any>;

/** The services a handler table needs: the union across its handlers. */
export type HandlerServices<Handlers> = {
  readonly [K in keyof Handlers]: Handlers[K] extends (
    event: never,
  ) => Effect.Effect<unknown, unknown, infer R>
    ? R
    : never;
}[keyof Handlers];

/**
 * An {@link extendableListener} that runs the handler `handlers` names for
 * the event's `tag`; an event whose tag has none is logged at `Warning`
 * and left to settle at once.
 */
export const taggedListener =
  (kind: string) =>
  <
    Event extends TaggedEventLike,
    const Handlers extends Readonly<Record<string, TagHandler<Event>>>,
  >(
    handlers: Handlers,
  ): Effect.Effect<(event: Event) => void, never, HandlerServices<Handlers>> =>
    extendableListener<Event, unknown, HandlerServices<Handlers>>((event) =>
      Option.match(R.get(handlers, event.tag), {
        onNone: () => Effect.logWarning(`service-worker: ${kind} with no handler`, event.tag),
        onSome: (handle) => handle(event),
      }),
    );
