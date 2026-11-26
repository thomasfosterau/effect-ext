/**
 * Server-sent events over the platform's `EventSource`, in a window and in
 * dedicated and shared workers, as a `Stream` of `effect/encoding/Sse`
 * events. The browser reconnects by itself, sending `Last-Event-ID`, and
 * the stream carries on through it.
 *
 * {@link EventSourceClient} is a context reference that defaults, on first
 * read, to the ambient `EventSource`; a test provides one built by
 * {@link make}.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Sse from "effect/encoding/Sse";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

/**
 * The slice of an `EventSource` this module calls. `readyState` is `0`
 * while connecting (or reconnecting), `1` while open and `2` once closed for
 * good.
 *
 * @since 0.1.0
 * @category models
 */
export interface EventSourceLike extends Stream.EventListener<EventLike> {
  readonly readyState: number;
  close(): void;
}

/**
 * What an `EventSource` listener receives: a `MessageEvent` for an event the
 * server sent (its `data`, and the `lastEventId` the browser will send on
 * reconnecting), a plain `Event` for `error`.
 *
 * @since 0.1.0
 * @category models
 */
export interface EventLike {
  readonly type: string;
  readonly data?: unknown;
  readonly lastEventId?: string;
}

/**
 * The `EventSource` constructor.
 *
 * @since 0.1.0
 * @category models
 */
export interface EventSourceConstructorLike {
  new (url: string | URL, init?: { readonly withCredentials?: boolean }): EventSourceLike;
}

/**
 * What {@link connect} takes: `withCredentials` (default `false`) sends
 * cookies on a cross-origin request; `events` (default `["message"]`) names
 * the event types to listen for. An event the server sends without an
 * `event:` line is a `"message"`, so list it beside the named ones to
 * receive both.
 *
 * @since 0.1.0
 * @category models
 */
export interface ConnectOptions {
  readonly withCredentials?: boolean;
  readonly events?: ReadonlyArray<string>;
}

/**
 * Why a connection failed: `Unsupported` (no `EventSource`), `InvalidUrl`
 * (a URL the constructor rejects), `Closed` (the `readyState` was `CLOSED`
 * after an `error`: the server answered with something other than a `200`
 * `text/event-stream`, a `204` among them, so the browser will not
 * reconnect), `Failed` (anything else the constructor threw, such as a
 * content security policy refusal).
 *
 * @since 0.1.0
 * @category models
 */
export type EventSourceErrorReason = "Unsupported" | "InvalidUrl" | "Closed" | "Failed";

/**
 * A server-sent event stream failed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/EventSource"
 *
 * Effect.runPromise(Effect.flip(Stream.runDrain(make().connect("/events")))).then((error) =>
 *   console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class EventSourceError extends Schema.TaggedError<
  EventSourceError,
  { readonly brand: unique symbol }
>()("EventSourceError", {
  reason: Schema.Literals(["Unsupported", "InvalidUrl", "Closed", "Failed"]),
  url: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

/**
 * The operations an {@link EventSourceClient} offers.
 *
 * @since 0.1.0
 * @category models
 */
export interface EventSourceService {
  /** Whether the agent has `EventSource`. */
  readonly supported: boolean;
  /**
   * Opens a connection to `url` and emits each event of the listed types.
   * Closing the stream's scope closes the connection.
   */
  readonly connect: (
    url: string | URL,
    options?: ConnectOptions,
  ) => Stream.Stream<Sse.Event, EventSourceError>;
}

const CLOSED = 2;

const failure = (url: string, reason: EventSourceErrorReason, cause: unknown): EventSourceError =>
  new EventSourceError({ url, reason, cause, message: `EventSource ${url}: ${reason}` });

/** A `MessageEvent` as the event `effect/encoding/Sse` decodes; no id is `""` on the platform. */
const toEvent = (event: EventLike): Sse.Event => ({
  _tag: "Event",
  event: event.type,
  id: event.lastEventId === "" ? undefined : event.lastEventId,
  data: P.isString(event.data) ? event.data : "",
});

const offerTo =
  (queue: Queue.Queue<Sse.Event, EventSourceError | Cause.Done>) =>
  (event: EventLike): void => {
    Queue.offerUnsafe(queue, toEvent(event));
  };

const connectWith = (
  Source: EventSourceConstructorLike,
  url: string | URL,
  options?: ConnectOptions,
): Stream.Stream<Sse.Event, EventSourceError> =>
  Stream.callback<Sse.Event, EventSourceError>((queue) =>
    Effect.gen(function* () {
      const href = String(url);
      const context = yield* Effect.context();
      const source = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new Source(url, { withCredentials: options?.withCredentials ?? false }),
          catch: (cause) =>
            failure(
              href,
              P.hasProperty(cause, "name") && cause.name === "SyntaxError"
                ? "InvalidUrl"
                : "Failed",
              cause,
            ),
        }),
        (self) => Effect.sync(() => self.close()),
      );
      const types = options?.events ?? ["message"];
      const onMessage = offerTo(queue);
      const onError = (event: EventLike): void => {
        if (source.readyState === CLOSED) {
          Queue.failCauseUnsafe(queue, Cause.fail(failure(href, "Closed", event)));
        } else {
          Effect.runForkWith(context)(
            Effect.logWarning(`EventSource ${href}: connection lost, reconnecting`),
          );
        }
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          Arr.forEach(types, (type) => source.addEventListener(type, onMessage));
          source.addEventListener("error", onError);
        }),
        () =>
          Effect.sync(() => {
            Arr.forEach(types, (type) => source.removeEventListener(type, onMessage));
            source.removeEventListener("error", onError);
          }),
      );
    }),
  );

/**
 * Builds an {@link EventSourceService} over the given constructor; without
 * one, the unsupported service.
 *
 * @example
 * ```ts
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/EventSource"
 *
 * console.log(make().supported) // false
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (Source?: EventSourceConstructorLike): EventSourceService =>
  Option.match(Option.fromUndefinedOr(Source), {
    onNone: () => ({
      supported: false,
      connect: (url) => Stream.fail(failure(String(url), "Unsupported", undefined)),
    }),
    onSome: (self) => ({
      supported: true,
      connect: (url, options) => connectWith(self, url, options),
    }),
  });

const ambient = (): EventSourceService => {
  const scope: Partial<Pick<typeof globalThis, "EventSource">> = globalThis;
  return make(scope.EventSource);
};

/**
 * Server-sent events. Defaults to the ambient `EventSource` (a window's or a
 * dedicated or shared worker's), read on first use; provide one built by
 * {@link make} to replace it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { EventSourceClient } from "@thomasfosterau/effect-platform-worker-shared/EventSource"
 *
 * const program = EventSourceClient.use((client) => Effect.succeed(client.supported))
 * Effect.runPromise(program).then(console.log) // true in a browser, false in a service worker
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const EventSourceClient: Context.Reference<EventSourceService> =
  /*#__PURE__*/ Context.Reference("@thomasfosterau/effect-platform-worker-shared/EventSource", {
    defaultValue: ambient,
  });

/**
 * Each event of the listed types from `url`, in the shape
 * `effect/encoding/Sse` decodes from an `HttpClient` response body, so code
 * that consumes one takes the other. A dropped connection is logged and
 * retried by the browser; the stream fails only once the browser gives up.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { connect } from "@thomasfosterau/effect-platform-worker-shared/EventSource"
 *
 * const program = connect("/events", { events: ["message", "tick"] }).pipe(
 *   Stream.take(1),
 *   Stream.runForEach((event) => Effect.log(event.event, event.data)),
 * )
 * Effect.runFork(Effect.ignore(program))
 * ```
 *
 * @since 0.1.0
 * @category streams
 */
export const connect = (
  url: string | URL,
  options?: ConnectOptions,
): Stream.Stream<Sse.Event, EventSourceError> =>
  Stream.unwrap(EventSourceClient.use((self) => Effect.succeed(self.connect(url, options))));

/**
 * Each event's `data` from `url`, parsed as JSON and decoded with `schema`.
 * A received payload is untrusted: one that does not parse or decode is
 * dropped with a warning log, and the stream carries on.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import * as Stream from "effect/Stream"
 * import { events } from "@thomasfosterau/effect-platform-worker-shared/EventSource"
 *
 * const Price = Schema.Struct({ symbol: Schema.String, price: Schema.Number })
 * const program = events("/prices", Price).pipe(
 *   Stream.runForEach((quote) => Effect.log(quote.symbol, quote.price)),
 * )
 * Effect.runFork(Effect.ignore(program))
 * ```
 *
 * @since 0.1.0
 * @category streams
 */
export const events = <S extends Schema.Top>(
  url: string | URL,
  schema: S,
  options?: ConnectOptions,
): Stream.Stream<S["Type"], EventSourceError, S["DecodingServices"]> => {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema));
  return Stream.filterMapEffect(connect(url, options), (event) =>
    Effect.tap(Effect.result(decode(event.data)), (result) =>
      Result.isFailure(result)
        ? Effect.logWarning(`EventSource ${String(url)}: dropped an event`, result.failure.message)
        : Effect.void,
    ),
  );
};
