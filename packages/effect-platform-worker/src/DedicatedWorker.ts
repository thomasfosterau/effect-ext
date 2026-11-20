/**
 * A dedicated worker's own global (`DedicatedWorkerGlobalScope`): its name,
 * closing it, and the page that started it as a schema-typed endpoint.
 *
 * For request / response work between a page and a worker, prefer
 * `effect/workers` with `@effect/platform-browser`'s `BrowserWorkerRunner`;
 * {@link parent} is for a worker that streams events of its own.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { namedScopeAccessors } from "./internal/scope.ts";
import * as WorkerMessaging from "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging";
import {
  isInstanceOfGlobal,
  type WorkerGlobalScopeLike,
} from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";

/**
 * The structural slice of a `DedicatedWorkerGlobalScope` this module uses:
 * a worker global that is also the port to its parent.
 *
 * @since 0.1.0
 * @category models
 */
export interface DedicatedWorkerGlobalScopeLike
  extends WorkerGlobalScopeLike, WorkerMessaging.PortLike {
  readonly name: string;
  close(): void;
}

/**
 * The context is not a dedicated worker.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { name } from "@thomasfosterau/effect-platform-worker/DedicatedWorker"
 *
 * Effect.runPromise(Effect.flip(name)).then((error) => console.log(error._tag))
 * // "NotADedicatedWorker" under Node
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class NotADedicatedWorker extends Schema.TaggedError<NotADedicatedWorker>()(
  "NotADedicatedWorker",
  {},
) {
  override get message(): string {
    return "not running in a dedicated worker";
  }
}

const isDedicatedWorkerGlobalScope = (value: unknown): value is DedicatedWorkerGlobalScopeLike =>
  isInstanceOfGlobal(value, "DedicatedWorkerGlobalScope");

const ambient = (): Option.Option<DedicatedWorkerGlobalScopeLike> => {
  const self: unknown = globalThis;
  return isDedicatedWorkerGlobalScope(self) ? Option.some(self) : Option.none();
};

/**
 * The dedicated worker's global. Defaults to `globalThis` when it is a
 * `DedicatedWorkerGlobalScope`, else `Option.none()`, read on first use;
 * provide `Option.some(stub)` in a test.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { DedicatedWorkerScope, name } from "@thomasfosterau/effect-platform-worker/DedicatedWorker"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   name: "thumbnailer",
 *   location: { href: "https://example.com/worker.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 *   postMessage: () => {},
 *   close: () => {},
 * })
 * const program = name.pipe(Effect.provideService(DedicatedWorkerScope, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // "thumbnailer"
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const DedicatedWorkerScope: Context.Reference<
  Option.Option<DedicatedWorkerGlobalScopeLike>
> = /*#__PURE__*/ Context.Reference("@thomasfosterau/effect-platform-worker/DedicatedWorkerScope", {
  defaultValue: ambient,
});

const accessors = /*#__PURE__*/ namedScopeAccessors(
  DedicatedWorkerScope,
  () => new NotADedicatedWorker(),
);

/**
 * The dedicated worker's global, failing outside one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { scope } from "@thomasfosterau/effect-platform-worker/DedicatedWorker"
 *
 * Effect.runPromise(Effect.flip(scope)).then((error) => console.log(error._tag))
 * // "NotADedicatedWorker" under Node
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const scope: Effect.Effect<DedicatedWorkerGlobalScopeLike, NotADedicatedWorker> =
  accessors.scope;

/**
 * The name the page gave the worker (`new Worker(url, { name })`); `""`
 * when it gave none.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { DedicatedWorkerScope, name } from "@thomasfosterau/effect-platform-worker/DedicatedWorker"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   name: "",
 *   location: { href: "https://example.com/worker.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 *   postMessage: () => {},
 *   close: () => {},
 * })
 * const program = name.pipe(Effect.provideService(DedicatedWorkerScope, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // ""
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const name: Effect.Effect<string, NotADedicatedWorker> = accessors.name;

/**
 * Closes the worker: queued tasks are discarded and the page's `Worker`
 * receives nothing further. Effects after it in the same fiber may still
 * run until the event loop turn ends.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { DedicatedWorkerScope, close } from "@thomasfosterau/effect-platform-worker/DedicatedWorker"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   name: "",
 *   location: { href: "https://example.com/worker.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 *   postMessage: () => {},
 *   close: () => console.log("closed"),
 * })
 * Effect.runPromise(close.pipe(Effect.provideService(DedicatedWorkerScope, Option.some(stub))))
 * // logs "closed"
 * ```
 *
 * @since 0.1.0
 * @category lifecycle
 */
export const close: Effect.Effect<void, NotADedicatedWorker> = accessors.close;

/**
 * The page that started the worker, as an endpoint speaking `protocol`
 * (see `WorkerMessaging.endpoint`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import * as Schema from "effect/Schema"
 * import { DedicatedWorkerScope, parent } from "@thomasfosterau/effect-platform-worker/DedicatedWorker"
 *
 * const Progress = Schema.Struct({ done: Schema.Number })
 * const stub = Object.assign(new EventTarget(), {
 *   name: "",
 *   location: { href: "https://example.com/worker.js" },
 *   isSecureContext: true,
 *   crossOriginIsolated: false,
 *   postMessage: (message: unknown) => console.log(message),
 *   close: () => {},
 * })
 * const program = Effect.gen(function* () {
 *   const page = yield* parent({ send: Progress, receive: Schema.Never })
 *   yield* page.send({ done: 0.5 })
 * }).pipe(Effect.provideService(DedicatedWorkerScope, Option.some(stub)))
 * Effect.runPromise(program) // logs { done: 0.5 }
 * ```
 *
 * @since 0.1.0
 * @category messaging
 */
export const parent = <Send, SendEncoded, Receive, ReceiveEncoded>(
  protocol: WorkerMessaging.Protocol<Send, SendEncoded, Receive, ReceiveEncoded>,
): Effect.Effect<WorkerMessaging.Endpoint<Send, Receive>, NotADedicatedWorker> =>
  Effect.map(scope, (self) => WorkerMessaging.endpoint(self, protocol));
