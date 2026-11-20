/**
 * A shared worker's own global (`SharedWorkerGlobalScope`): its name,
 * closing it, and each page that connects as a port or a schema-typed
 * endpoint.
 *
 * A `connect` event is dispatched once the script has evaluated, so a
 * {@link connections} stream started from the worker's main program (run
 * synchronously by `WorkerRuntime.runMain`) sees the first page. For
 * request / response work, prefer `effect/workers` with
 * `@effect/platform-browser`'s `BrowserWorkerRunner`, which handles
 * `connect` itself.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { namedScopeAccessors } from "./internal/scope.ts";
import * as WorkerMessaging from "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging";
import {
  isInstanceOfGlobal,
  type WorkerGlobalScopeLike,
} from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";

/**
 * The structural slice of a `SharedWorkerGlobalScope` this module uses.
 *
 * @since 0.1.0
 * @category models
 */
export interface SharedWorkerGlobalScopeLike extends WorkerGlobalScopeLike {
  readonly name: string;
  close(): void;
}

/**
 * A connected page's port: a `MessagePort`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ConnectionPort extends WorkerMessaging.PortLike {
  close(): void;
}

/**
 * The context is not a shared worker.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { name } from "@thomasfosterau/effect-platform-worker/SharedWorker"
 *
 * Effect.runPromise(Effect.flip(name)).then((error) => console.log(error._tag))
 * // "NotASharedWorker" under Node
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class NotASharedWorker extends Schema.TaggedError<NotASharedWorker>()(
  "NotASharedWorker",
  {},
) {
  override get message(): string {
    return "not running in a shared worker";
  }
}

const isSharedWorkerGlobalScope = (value: unknown): value is SharedWorkerGlobalScopeLike =>
  isInstanceOfGlobal(value, "SharedWorkerGlobalScope");

const ambient = (): Option.Option<SharedWorkerGlobalScopeLike> => {
  const self: unknown = globalThis;
  return isSharedWorkerGlobalScope(self) ? Option.some(self) : Option.none();
};

/**
 * The shared worker's global. Defaults to `globalThis` when it is a
 * `SharedWorkerGlobalScope`, else `Option.none()`, read on first use;
 * provide `Option.some(stub)` in a test.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { SharedWorkerScope, name } from "@thomasfosterau/effect-platform-worker/SharedWorker"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   name: "sync",
 *   location: { href: "https://example.com/shared.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 *   close: () => {},
 * })
 * const program = name.pipe(Effect.provideService(SharedWorkerScope, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // "sync"
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const SharedWorkerScope: Context.Reference<Option.Option<SharedWorkerGlobalScopeLike>> =
  /*#__PURE__*/ Context.Reference("@thomasfosterau/effect-platform-worker/SharedWorkerScope", {
    defaultValue: ambient,
  });

const accessors = /*#__PURE__*/ namedScopeAccessors(
  SharedWorkerScope,
  () => new NotASharedWorker(),
);

/**
 * The shared worker's global, failing outside one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { scope } from "@thomasfosterau/effect-platform-worker/SharedWorker"
 *
 * Effect.runPromise(Effect.flip(scope)).then((error) => console.log(error._tag))
 * // "NotASharedWorker" under Node
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const scope: Effect.Effect<SharedWorkerGlobalScopeLike, NotASharedWorker> = accessors.scope;

/**
 * The name pages share the worker under (`new SharedWorker(url, name)`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { SharedWorkerScope, name } from "@thomasfosterau/effect-platform-worker/SharedWorker"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   name: "sync",
 *   location: { href: "https://example.com/shared.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 *   close: () => {},
 * })
 * const program = name.pipe(Effect.provideService(SharedWorkerScope, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // "sync"
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const name: Effect.Effect<string, NotASharedWorker> = accessors.name;

/**
 * Closes the worker for every connected page.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { SharedWorkerScope, close } from "@thomasfosterau/effect-platform-worker/SharedWorker"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   name: "",
 *   location: { href: "https://example.com/shared.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 *   close: () => console.log("closed"),
 * })
 * Effect.runPromise(close.pipe(Effect.provideService(SharedWorkerScope, Option.some(stub))))
 * // logs "closed"
 * ```
 *
 * @since 0.1.0
 * @category lifecycle
 */
export const close: Effect.Effect<void, NotASharedWorker> = accessors.close;

const isConnectionPort = (value: unknown): value is ConnectionPort =>
  P.hasProperty(value, "postMessage") &&
  P.isFunction(value.postMessage) &&
  P.hasProperty(value, "addEventListener") &&
  P.isFunction(value.addEventListener);

/**
 * The port each `connect` event carries (`event.ports[0]`), from the moment
 * the stream runs. A connection is never announced twice; the port stays
 * open until the page goes away or the consumer closes it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import * as Option from "effect/Option"
 * import * as Stream from "effect/Stream"
 * import { SharedWorkerScope, connections } from "@thomasfosterau/effect-platform-worker/SharedWorker"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   name: "",
 *   location: { href: "https://example.com/shared.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 *   close: () => {},
 * })
 * const program = Effect.gen(function* () {
 *   const fiber = yield* Effect.forkChild(Stream.runHead(connections))
 *   yield* Effect.sleep("10 millis")
 *   const { port1, port2 } = new MessageChannel()
 *   stub.dispatchEvent(Object.assign(new Event("connect"), { ports: [port1] }))
 *   const port = yield* Fiber.join(fiber)
 *   port1.close()
 *   port2.close()
 *   return Option.isSome(port)
 * }).pipe(Effect.provideService(SharedWorkerScope, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // true
 * ```
 *
 * @since 0.1.0
 * @category streams
 */
export const connections: Stream.Stream<ConnectionPort, NotASharedWorker> = Stream.unwrap(
  Effect.map(scope, (self) =>
    Stream.fromEventListener(self, "connect").pipe(
      Stream.filterMap((event) => {
        const port: unknown =
          P.hasProperty(event, "ports") && Array.isArray(event.ports) ? event.ports[0] : undefined;
        return isConnectionPort(port) ? Result.succeed(port) : Result.fail(event);
      }),
    ),
  ),
);

/**
 * Each connecting page as an endpoint speaking `protocol` (see
 * `WorkerMessaging.endpoint`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import * as Option from "effect/Option"
 * import * as Schema from "effect/Schema"
 * import * as Stream from "effect/Stream"
 * import { SharedWorkerScope, endpoints } from "@thomasfosterau/effect-platform-worker/SharedWorker"
 *
 * const Hello = Schema.Struct({ hello: Schema.String })
 * const stub = Object.assign(new EventTarget(), {
 *   name: "",
 *   location: { href: "https://example.com/shared.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 *   close: () => {},
 * })
 * const program = Effect.gen(function* () {
 *   const fiber = yield* Effect.forkChild(Stream.runHead(endpoints({ send: Hello, receive: Hello })))
 *   yield* Effect.sleep("10 millis")
 *   const { port1, port2 } = new MessageChannel()
 *   stub.dispatchEvent(Object.assign(new Event("connect"), { ports: [port1] }))
 *   const page = yield* Effect.flatMap(Fiber.join(fiber), Effect.fromOption)
 *   port2.onmessage = (event) => console.log(event.data)
 *   yield* page.send({ hello: "page" })
 *   yield* Effect.sleep("10 millis")
 *   port1.close()
 *   port2.close()
 * }).pipe(Effect.provideService(SharedWorkerScope, Option.some(stub)))
 * Effect.runPromise(program) // logs { hello: "page" }
 * ```
 *
 * @since 0.1.0
 * @category streams
 */
export const endpoints = <Send, SendEncoded, Receive, ReceiveEncoded>(
  protocol: WorkerMessaging.Protocol<Send, SendEncoded, Receive, ReceiveEncoded>,
): Stream.Stream<WorkerMessaging.Endpoint<Send, Receive>, NotASharedWorker> =>
  Stream.map(connections, (port) => WorkerMessaging.endpoint(port, protocol));
