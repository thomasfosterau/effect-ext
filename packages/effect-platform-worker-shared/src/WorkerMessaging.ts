/**
 * Schema-typed messaging over a `postMessage` endpoint: a `MessagePort`, a
 * dedicated worker's `self`, a `Worker` seen from the page, or a service
 * worker client.
 *
 * Every message received is untrusted input (another build of the page, a
 * different script holding the port), so {@link endpoint} decodes each
 * against its schema and drops, with a warning log, one that does not
 * decode, rather than failing a long-lived stream. Encoding runs with
 * `effect/workers/Transferable`'s `Collector` in context, so a schema built
 * from `Transferable.schema` (`Transferable.Uint8Array`,
 * `Transferable.MessagePort`) moves its buffers instead of copying them.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Transferable from "effect/workers/Transferable";

/**
 * The structural slice of a `postMessage` endpoint this module uses.
 * `MessagePort`, `Worker`, `DedicatedWorkerGlobalScope` and a service
 * worker's `Client` satisfy it. `start` is called, when present, once a
 * listener is attached (a `MessagePort` delivers nothing until started).
 *
 * @since 0.1.0
 * @category models
 */
export interface PortLike extends Stream.EventListener, PostTargetLike {
  start?(): void;
}

/**
 * Anything that can be posted to, listening or not: a {@link PortLike}, or a
 * service worker's `Client`, whose replies arrive elsewhere.
 *
 * @since 0.1.0
 * @category models
 */
export interface PostTargetLike {
  postMessage(message: unknown, transfer: Array<globalThis.Transferable>): void;
}

/**
 * Why a send failed.
 *
 * - `DataClone` — the encoded message cannot be structured-cloned, or a
 *   transferable was already transferred.
 * - `Failed` — any other failure; `cause` carries it.
 *
 * @since 0.1.0
 * @category errors
 */
export type MessagingErrorReason = "DataClone" | "Failed";

/**
 * `postMessage` threw.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { raw } from "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging"
 *
 * const { port1 } = new MessageChannel()
 * const program = raw(port1).send(() => {}) // a function cannot be cloned
 * Effect.runPromise(Effect.flip(program)).then((error) => {
 *   console.log(error.reason) // "DataClone"
 *   port1.close()
 * })
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class MessagingError extends Schema.TaggedError<
  MessagingError,
  { readonly brand: unique symbol }
>()("MessagingError", {
  reason: Schema.Literals(["DataClone", "Failed"]),
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `postMessage failed: ${this.reason}`;
  }
}

const isDataCloneError = (cause: unknown): boolean =>
  P.hasProperty(cause, "name") && cause.name === "DataCloneError";

/**
 * One side of a conversation: what it sends and what it receives.
 *
 * - `send` — posts a message, transferring what the schema collected.
 * - `subscribe` — starts listening now and returns every message from then
 *   on (buffered until consumed), for as long as the scope is open: the
 *   race-free form.
 * - `messages` — the same stream, listening from the moment it runs.
 *
 * A message that cannot be deserialised (`messageerror`) is dropped with a
 * warning.
 *
 * @since 0.1.0
 * @category models
 */
export interface Endpoint<Send, Receive> {
  readonly send: (message: Send) => Effect.Effect<void, MessagingError | Schema.SchemaError>;
  readonly subscribe: Effect.Effect<Stream.Stream<Receive>, never, Scope.Scope>;
  readonly messages: Stream.Stream<Receive>;
}

const post = (
  port: PostTargetLike,
  message: unknown,
  transfer: Array<globalThis.Transferable>,
): Effect.Effect<void, MessagingError> =>
  Effect.try({
    try: () => port.postMessage(message, transfer),
    catch: (cause) =>
      new MessagingError({ reason: isDataCloneError(cause) ? "DataClone" : "Failed", cause }),
  });

/** A `message` listener that offers each event's `data` to `queue`. */
const forwardData =
  (queue: Queue.Queue<unknown, Cause.Done>) =>
  (event: unknown): void => {
    Queue.offerUnsafe(queue, P.hasProperty(event, "data") ? event.data : undefined);
  };

/** A `messageerror` listener that offers the marker the stream drops. */
const forwardMarker = (queue: Queue.Queue<unknown, Cause.Done>) => (): void => {
  Queue.offerUnsafe(queue, messageErrorMarker);
};

const listen = Effect.fnUntraced(function* (port: PortLike) {
  const queue = yield* Queue.unbounded<unknown, Cause.Done>();
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const onMessage = forwardData(queue);
      const onMessageError = forwardMarker(queue);
      port.addEventListener("message", onMessage);
      port.addEventListener("messageerror", onMessageError);
      port.start?.();
      return { onMessage, onMessageError };
    }),
    // Ending the queue ends the stream, so a consumer outliving the scope
    // completes instead of waiting forever.
    ({ onMessage, onMessageError }) =>
      Effect.sync(() => {
        port.removeEventListener("message", onMessage);
        port.removeEventListener("messageerror", onMessageError);
        Queue.endUnsafe(queue);
      }),
  );
  return Stream.fromQueue(queue).pipe(
    Stream.tap((message) =>
      message === messageErrorMarker
        ? Effect.logWarning("worker messaging: dropped a message that could not be deserialised")
        : Effect.void,
    ),
    Stream.filter((message) => message !== messageErrorMarker),
  );
});

const messageErrorMarker: unique symbol = Symbol.for(
  "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging/messageerror",
);

/**
 * An endpoint carrying values as they are: nothing is encoded, so sending
 * fails only with {@link MessagingError}, and `sendTransfer` names the
 * transfer list itself.
 *
 * @since 0.1.0
 * @category models
 */
export interface RawEndpoint {
  readonly send: (message: unknown) => Effect.Effect<void, MessagingError>;
  readonly sendTransfer: (
    message: unknown,
    transfer: Iterable<globalThis.Transferable>,
  ) => Effect.Effect<void, MessagingError>;
  readonly subscribe: Effect.Effect<Stream.Stream<unknown>, never, Scope.Scope>;
  readonly messages: Stream.Stream<unknown>;
}

/**
 * A {@link RawEndpoint} over `port`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { raw } from "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging"
 *
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const { port1, port2 } = new MessageChannel()
 *     yield* Effect.addFinalizer(() => Effect.sync(() => port1.close()))
 *     const inbox = yield* raw(port2).subscribe
 *     yield* raw(port1).send({ hello: "worker" })
 *     return yield* Stream.runHead(inbox)
 *   }),
 * )
 * Effect.runPromise(program).then(console.log) // Some({ hello: "worker" })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const raw = (port: PortLike): RawEndpoint => ({
  send: (message) => post(port, message, []),
  sendTransfer: (message, transfer) => post(port, message, Arr.fromIterable(transfer)),
  subscribe: listen(port),
  messages: Stream.unwrap(listen(port)),
});

/**
 * The schemas an {@link endpoint} speaks: what it sends and what it
 * receives. Their encoded forms cross the boundary, so they must be
 * structured-cloneable.
 *
 * @since 0.1.0
 * @category models
 */
export interface Protocol<Send, SendEncoded, Receive, ReceiveEncoded> {
  readonly send: Schema.Codec<Send, SendEncoded>;
  readonly receive: Schema.Codec<Receive, ReceiveEncoded>;
}

/**
 * An {@link Endpoint} over `port` speaking `protocol`: each sent value is
 * encoded (collecting its transferables), each received one decoded, and
 * one that does not decode is dropped with a warning log.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import * as Stream from "effect/Stream"
 * import { endpoint } from "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging"
 *
 * const Ping = Schema.Struct({ n: Schema.Number })
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const { port1, port2 } = new MessageChannel()
 *     yield* Effect.addFinalizer(() => Effect.sync(() => port1.close()))
 *     const page = endpoint(port1, { send: Ping, receive: Ping })
 *     const worker = endpoint(port2, { send: Ping, receive: Ping })
 *     const inbox = yield* worker.subscribe
 *     yield* page.send({ n: 1 })
 *     return yield* Stream.runHead(inbox)
 *   }),
 * )
 * Effect.runPromise(program).then(console.log) // Some({ n: 1 })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const endpoint = <Send, SendEncoded, Receive, ReceiveEncoded>(
  port: PortLike,
  protocol: Protocol<Send, SendEncoded, Receive, ReceiveEncoded>,
): Endpoint<Send, Receive> => {
  const send = sender(protocol.send);
  const decode = Schema.decodeUnknownEffect(protocol.receive);
  const decoded = (messages: Stream.Stream<unknown>): Stream.Stream<Receive> =>
    messages.pipe(
      Stream.mapEffect((message) =>
        decode(message).pipe(
          Effect.asSome,
          Effect.catchTag("SchemaError", (error) =>
            Effect.as(
              Effect.logWarning("worker messaging: dropped a message", error.message),
              Option.none<Receive>(),
            ),
          ),
        ),
      ),
      Stream.filterMap((received) => Result.fromOption(received, () => received)),
    );
  return {
    send: (message) => send(port, message),
    subscribe: Effect.map(listen(port), decoded),
    messages: decoded(Stream.unwrap(listen(port))),
  };
};

/**
 * Encodes with `schema` (collecting its transferables) and posts the result
 * to `target`, transferring what was collected.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { sender } from "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging"
 *
 * const target = { postMessage: (message: unknown) => console.log(message) }
 * const send = sender(Schema.Struct({ n: Schema.NumberFromString }))
 * Effect.runPromise(send(target, { n: 1 })) // logs { n: "1" }
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const sender = <A, I>(
  schema: Schema.Codec<A, I>,
): ((
  target: PostTargetLike,
  message: A,
) => Effect.Effect<void, MessagingError | Schema.SchemaError>) => {
  const encode = Schema.encodeEffect(schema);
  return (target, message) =>
    Effect.gen(function* () {
      const collector = Transferable.makeCollectorUnsafe();
      const encoded = yield* encode(message).pipe(
        Effect.provideService(Transferable.Collector, collector),
      );
      yield* post(target, encoded, collector.clearUnsafe());
    });
};

/**
 * A new `MessageChannel` whose ports are closed when the scope closes: hand
 * one port to a worker (transferring it) and keep the other.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { channel, raw } from "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging"
 *
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const [mine, theirs] = yield* channel
 *     const inbox = yield* raw(theirs).subscribe
 *     yield* raw(mine).send("hi")
 *     return yield* Stream.runHead(inbox)
 *   }),
 * )
 * Effect.runPromise(program).then(console.log) // Some("hi")
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const channel: Effect.Effect<readonly [MessagePort, MessagePort], never, Scope.Scope> =
  Effect.acquireRelease(
    Effect.sync(() => {
      const { port1, port2 } = new MessageChannel();
      return [port1, port2] as const;
    }),
    ([port1, port2]) =>
      Effect.sync(() => {
        port1.close();
        port2.close();
      }),
  );
