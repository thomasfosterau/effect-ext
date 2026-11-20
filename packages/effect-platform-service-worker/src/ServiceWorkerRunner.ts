/**
 * The runner side of `effect/workers` in a service worker: a
 * `WorkerRunnerPlatform` whose clients are pages, each connected over a
 * `MessagePort` of its own, so `RpcServer.layerProtocolWorkerRunner` (or
 * any other `effect/workers` protocol) serves them as it serves a
 * dedicated or shared worker's.
 *
 * A page connects by posting {@link CONNECT} to the worker
 * (`navigator.serviceWorker.controller.postMessage(CONNECT, [port2])`) with
 * one port of a `MessageChannel`, and hands the other to
 * `@effect/platform-browser`'s `BrowserWorker.layer(() => port1)`; the
 * package README has the whole page side.
 *
 * A message on a port is no event to the worker, so nothing about it
 * keeps the worker running; instead the `message` event that connected
 * the page is held open (`waitUntil`) until the page disconnects. Browsers
 * cap how long one event may run (about five minutes in Chrome), after
 * which the worker may stop and the page's requests go unanswered: a page
 * that stays open longer reconnects.
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { constVoid } from "effect/Function";
import * as Layer from "effect/Layer";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import { WorkerError, WorkerSpawnError } from "effect/workers/WorkerError";
import * as WorkerRunner from "effect/workers/WorkerRunner";
import { isInstanceOfGlobal } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";

/**
 * The message a page posts to the worker, with a `MessagePort` as its one
 * transferable, to connect that port to the runner.
 *
 * @since 0.1.0
 * @category constants
 */
export const CONNECT = "@thomasfosterau/effect-platform-service-worker/ServiceWorkerRunner/connect";

/**
 * The part of a `MessagePort` the runner uses.
 *
 * @since 0.1.0
 * @category models
 */
export interface RunnerPortLike {
  postMessage(message: unknown, transfer: ReadonlyArray<unknown>): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  start?(): void;
  close(): void;
}

/**
 * The part of a `ServiceWorkerGlobalScope` the runner uses: the target of
 * the `message` events pages connect with.
 *
 * @since 0.1.0
 * @category models
 */
export interface RunnerScopeLike {
  addEventListener(type: "message", listener: (event: unknown) => void): void;
  removeEventListener(type: "message", listener: (event: unknown) => void): void;
}

const isPort = (value: unknown): value is RunnerPortLike =>
  P.hasProperty(value, "postMessage") &&
  P.isFunction(value.postMessage) &&
  P.hasProperty(value, "addEventListener") &&
  P.isFunction(value.addEventListener) &&
  P.hasProperty(value, "close") &&
  P.isFunction(value.close);

const isExtendable = (event: unknown): event is { waitUntil(promise: Promise<unknown>): void } =>
  P.hasProperty(event, "waitUntil") && P.isFunction(event.waitUntil);

/** The port and the `waitUntil` of a connect event; `None` for any other message. */
const connection = (
  event: unknown,
): Option.Option<{
  readonly port: RunnerPortLike;
  readonly waitUntil: (promise: Promise<unknown>) => void;
}> => {
  if (
    !P.hasProperty(event, "data") ||
    event.data !== CONNECT ||
    !P.hasProperty(event, "ports") ||
    !Array.isArray(event.ports)
  ) {
    return Option.none();
  }
  const port: unknown = event.ports[0];
  if (!isPort(port)) return Option.none();
  const waitUntil = isExtendable(event)
    ? (promise: Promise<unknown>) => event.waitUntil(promise)
    : constVoid;
  return Option.some({ port, waitUntil });
};

/**
 * A port message event: `[0, request]` or `[1]` (the page closed). The request
 * is the handler's input as the page's protocol encoded it: the runner
 * protocol above this one decodes it.
 */
const isPortMessage = <I>(
  event: unknown,
): event is { readonly data: WorkerRunner.PlatformMessage<I> } =>
  P.hasProperty(event, "data") &&
  Array.isArray(event.data) &&
  (event.data[0] === 0 || event.data[0] === 1);

/**
 * Builds a `WorkerRunnerPlatform` over `self` (the worker's global, or a
 * stub in a test). Each page that connects gets a port id; the runner
 * answers it on its own port, and a page's close, or an undecodable
 * message on its port, ends only that page's requests (its id is offered
 * to `disconnects`). The run itself lasts until it is interrupted: a
 * service worker keeps serving the pages that connect later.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { CONNECT, make } from "@thomasfosterau/effect-platform-service-worker/ServiceWorkerRunner"
 *
 * const self = new EventTarget()
 * const program = Effect.gen(function* () {
 *   const runner = yield* make(self).start<string, string>()
 *   yield* Effect.forkChild(
 *     runner.run((portId, request) => runner.send(portId, request.toUpperCase())),
 *   )
 *   yield* Effect.sleep("10 millis")
 *   const { port1, port2 } = new MessageChannel()
 *   port1.onmessage = (event) => console.log(event.data)
 *   self.dispatchEvent(Object.assign(new Event("message"), { data: CONNECT, ports: [port2] }))
 *   yield* Effect.sleep("10 millis")
 *   port1.postMessage([0, "hello"])
 *   yield* Effect.sleep("10 millis")
 *   port1.close()
 * })
 * Effect.runPromise(Effect.scoped(program)) // logs [0], then [1, "HELLO"]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (self: RunnerScopeLike): WorkerRunner.WorkerRunnerPlatform["Service"] => ({
  start: <O = unknown, I = unknown>() =>
    Effect.map(Queue.make<number>(), (disconnects): WorkerRunner.WorkerRunner<O, I> => {
      const ports = MutableHashMap.empty<number, RunnerPortLike>();
      let nextPortId = 0;

      const sendUnsafe = (portId: number, message: O, transfer?: ReadonlyArray<unknown>): void => {
        Option.map(MutableHashMap.get(ports, portId), (port) =>
          port.postMessage([1, message], transfer ?? []),
        );
      };
      const send = (portId: number, message: O, transfer?: ReadonlyArray<unknown>) =>
        Effect.sync(() => sendUnsafe(portId, message, transfer));

      const run = <A, E, R>(
        handler: (portId: number, message: I) => Effect.Effect<A, E, R> | void,
      ) =>
        Effect.scopedWith((scope) =>
          Effect.gen(function* () {
            const services = yield* Effect.context<R>();
            const runFork = Effect.runForkWith(services);
            const runSync = Effect.runSyncWith(services);
            const onExit = (exit: Exit.Exit<A, E>): void => {
              if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
                runFork(Effect.logError("service-worker: unhandled error in runner", exit.cause));
              }
            };

            const connect = (
              port: RunnerPortLike,
              waitUntil: (promise: Promise<unknown>) => void,
            ): void => {
              const portScope = Scope.forkUnsafe(scope);
              const portId = nextPortId++;
              const track = Fiber.runIn(portScope);
              MutableHashMap.set(ports, portId, port);
              // Closing the port's scope removes these listeners, so this
              // runs once per page.
              const disconnect = (): void => {
                MutableHashMap.remove(ports, portId);
                Queue.offerUnsafe(disconnects, portId);
                runFork(Scope.close(portScope, Exit.void));
              };
              const onMessage = (event: unknown): void => {
                if (!isPortMessage<I>(event)) return;
                const data = event.data;
                if (data[0] === 1) return disconnect();
                const result = handler(portId, data[1]);
                if (Effect.isEffect(result)) {
                  const fiber = runFork(result);
                  fiber.addObserver(onExit);
                  track(fiber);
                }
              };
              const onMessageError = (event: unknown): void => {
                runFork(Effect.logWarning("service-worker: runner port messageerror", event));
                disconnect();
              };
              port.addEventListener("message", onMessage);
              port.addEventListener("messageerror", onMessageError);
              port.start?.();
              // Hold the connecting event open while the page is connected.
              waitUntil(
                new Promise<void>((resolve) => {
                  runSync(
                    Scope.addFinalizer(
                      portScope,
                      Effect.sync(() => {
                        port.removeEventListener("message", onMessage);
                        port.removeEventListener("messageerror", onMessageError);
                        port.close();
                        resolve();
                      }),
                    ),
                  );
                }),
              );
              port.postMessage([0], []);
            };

            const onConnect = (event: unknown): void => {
              Option.map(connection(event), ({ port, waitUntil }) => connect(port, waitUntil));
            };
            self.addEventListener("message", onConnect);
            yield* Scope.addFinalizer(
              scope,
              Effect.sync(() => {
                self.removeEventListener("message", onConnect);
                MutableHashMap.clear(ports);
              }),
            );
            // A service worker serves pages until it is stopped.
            return yield* Deferred.await(Deferred.makeUnsafe<void, WorkerError>());
          }),
        );

      return { run, send, sendUnsafe, disconnects };
    }),
});

const isRunnerScope = (value: unknown): value is RunnerScopeLike =>
  isInstanceOfGlobal(value, "ServiceWorkerGlobalScope") &&
  P.hasProperty(value, "addEventListener") &&
  P.isFunction(value.addEventListener);

/**
 * The `WorkerRunnerPlatform` over the worker's own global, read when the
 * layer is built; outside a service worker the layer fails with a
 * `WorkerError` (`WorkerSpawnError`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as WorkerRunner from "effect/workers/WorkerRunner"
 * import { layer } from "@thomasfosterau/effect-platform-service-worker/ServiceWorkerRunner"
 *
 * Effect.runPromise(Effect.flip(Effect.provide(Effect.service(WorkerRunner.WorkerRunnerPlatform), layer)))
 *   .then((error) => console.log(error.reason._tag)) // "WorkerSpawnError" under Node
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<WorkerRunner.WorkerRunnerPlatform, WorkerError> = Layer.effect(
  WorkerRunner.WorkerRunnerPlatform,
)(
  Effect.suspend(() => {
    const self: unknown = globalThis;
    return isRunnerScope(self)
      ? Effect.succeed(make(self))
      : Effect.fail(
          new WorkerError({
            reason: new WorkerSpawnError({ message: "not running in a service worker" }),
          }),
        );
  }),
);
