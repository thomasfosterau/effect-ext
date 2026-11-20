/**
 * The page side of a service worker (`navigator.serviceWorker`): register
 * one, wait for it, follow its updates and its control of the page, and
 * talk to the controller through a schema-typed endpoint.
 *
 * {@link Container} defaults to `navigator.serviceWorker`, read on first
 * use and never at import; it is `Option.none()` where the browser has
 * none (an insecure origin, some private modes, Node), and every call then
 * fails `Unsupported`.
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
import * as WorkerMessaging from "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging";
import { reasonOf } from "./internal/dom.ts";

/**
 * A service worker's lifecycle state.
 *
 * @since 0.1.0
 * @category models
 */
export type ServiceWorkerState =
  | "parsed"
  | "installing"
  | "installed"
  | "activating"
  | "activated"
  | "redundant";

/**
 * The structural slice of a `ServiceWorker` (the page's handle on one).
 *
 * @since 0.1.0
 * @category models
 */
export interface ServiceWorkerLike extends Stream.EventListener, WorkerMessaging.PostTargetLike {
  readonly scriptURL: string;
  readonly state: ServiceWorkerState;
}

/**
 * The structural slice of a `ServiceWorkerRegistration` this module uses.
 * The `T | null` members are the platform's spelling; this module reads
 * them as `Option`.
 *
 * @since 0.1.0
 * @category models
 */
export interface RegistrationLike extends Stream.EventListener {
  readonly scope: string;
  readonly installing: ServiceWorkerLike | null;
  readonly waiting: ServiceWorkerLike | null;
  readonly active: ServiceWorkerLike | null;
  update(): Promise<void>;
  unregister(): Promise<boolean>;
}

/**
 * The structural slice of a `ServiceWorkerContainer` this module uses.
 *
 * @since 0.1.0
 * @category models
 */
export interface ServiceWorkerContainerLike extends Stream.EventListener {
  readonly controller: ServiceWorkerLike | null;
  readonly ready: Promise<RegistrationLike>;
  register(url: string, options?: RegistrationOptions): Promise<RegistrationLike>;
  getRegistration(clientURL?: string): Promise<RegistrationLike | undefined>;
  startMessages?(): void;
}

/**
 * What {@link register} passes on: the registration's `scope`, the
 * script's `type` (`"module"` for an ES module worker) and how its imports
 * are revalidated (`updateViaCache`).
 *
 * @since 0.1.0
 * @category models
 */
export interface RegistrationOptions {
  readonly scope?: string;
  readonly type?: "classic" | "module";
  readonly updateViaCache?: "imports" | "all" | "none";
}

/**
 * Which call failed.
 *
 * @since 0.1.0
 * @category models
 */
export type ContainerOperation =
  | "register"
  | "ready"
  | "getRegistration"
  | "update"
  | "unregister"
  | "controller";

/**
 * Why a call failed.
 *
 * - `Unsupported` — the context has no `navigator.serviceWorker`.
 * - `Security` — the origin may not register (`SecurityError`): an
 *   insecure origin, a script on another origin, a scope above the
 *   script's path without `Service-Worker-Allowed`.
 * - `InvalidScript` — the script failed to fetch or evaluate (`TypeError`).
 * - `InvalidState` — the registration was already unregistered.
 * - `NoController` — the page is not controlled (its first load, or a hard
 *   reload).
 * - `Failed` — anything else; `cause` carries it.
 *
 * @since 0.1.0
 * @category models
 */
export type ContainerErrorReason =
  | "Unsupported"
  | "Security"
  | "InvalidScript"
  | "InvalidState"
  | "NoController"
  | "Failed";

/**
 * A service worker container call failed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { register } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * Effect.runPromise(Effect.flip(register("/sw.js"))).then((error) => console.log(error.reason))
 * // "Unsupported" under Node
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class ContainerError extends Schema.TaggedError<ContainerError>()("ContainerError", {
  operation: Schema.Literals([
    "register",
    "ready",
    "getRegistration",
    "update",
    "unregister",
    "controller",
  ]),
  reason: Schema.Literals([
    "Unsupported",
    "Security",
    "InvalidScript",
    "InvalidState",
    "NoController",
    "Failed",
  ]),
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `serviceWorker.${this.operation}: ${this.reason}`;
  }
}

const REJECTIONS = {
  SecurityError: "Security",
  TypeError: "InvalidScript",
  InvalidStateError: "InvalidState",
} satisfies Readonly<Record<string, ContainerErrorReason>>;

const isContainer = (value: unknown): value is ServiceWorkerContainerLike =>
  P.hasProperty(value, "register") && P.isFunction(value.register);

const ambient = (): Option.Option<ServiceWorkerContainerLike> => {
  const realm: object = globalThis;
  return P.hasProperty(realm, "navigator") &&
    P.hasProperty(realm.navigator, "serviceWorker") &&
    isContainer(realm.navigator.serviceWorker)
    ? Option.some(realm.navigator.serviceWorker)
    : Option.none();
};

/**
 * The page's `ServiceWorkerContainer`. Defaults to
 * `navigator.serviceWorker` where it exists, else `Option.none()`, read on
 * first use; provide `Option.some(stub)` in a test.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Container, controller } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   controller: null,
 *   ready: new Promise<never>(() => {}),
 *   register: () => Promise.reject(new Error("unused")),
 *   getRegistration: async () => undefined,
 * })
 * const program = controller.pipe(Effect.provideService(Container, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // None: the page is not controlled
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const Container: Context.Reference<Option.Option<ServiceWorkerContainerLike>> =
  /*#__PURE__*/ Context.Reference(
    "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer/Container",
    {
      defaultValue: ambient,
    },
  );

const containerError = (
  operation: ContainerOperation,
  reason: ContainerErrorReason,
  cause: unknown,
) => new ContainerError({ operation, reason, cause });

const call = <A>(operation: ContainerOperation, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => containerError(operation, reasonOf(cause, REJECTIONS, "Failed"), cause),
  });

const withContainer = <A, E>(
  operation: ContainerOperation,
  use: (container: ServiceWorkerContainerLike) => Effect.Effect<A, E>,
): Effect.Effect<A, E | ContainerError> =>
  Container.use((container): Effect.Effect<A, E | ContainerError> =>
    Option.match(container, {
      onNone: () => Effect.fail(containerError(operation, "Unsupported", undefined)),
      onSome: use,
    }),
  );

/**
 * Registers the service worker at `url` (or returns the existing
 * registration for the same script and scope).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Container, register } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * const registration = Object.assign(new EventTarget(), {
 *   scope: "https://example.com/", installing: null, waiting: null, active: null,
 *   update: async () => {}, unregister: async () => true,
 * })
 * const stub = Object.assign(new EventTarget(), {
 *   controller: null,
 *   ready: Promise.resolve(registration),
 *   register: async (url: string, options?: { readonly type?: string }) => {
 *     console.log(url, options?.type) // "/sw.js" "module"
 *     return registration
 *   },
 *   getRegistration: async () => registration,
 * })
 * const program = register("/sw.js", { type: "module" }).pipe(
 *   Effect.provideService(Container, Option.some(stub)),
 * )
 * Effect.runPromise(program).then((found) => console.log(found.scope)) // "https://example.com/"
 * ```
 *
 * @since 0.1.0
 * @category registration
 */
export const register = (
  url: string,
  options?: RegistrationOptions,
): Effect.Effect<RegistrationLike, ContainerError> =>
  withContainer("register", (container) =>
    call("register", () => container.register(url, options)),
  );

/**
 * The registration for this page once it has an active worker: waits
 * (without bound) until one activates.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Container, ready } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * const registration = Object.assign(new EventTarget(), {
 *   scope: "https://example.com/", installing: null, waiting: null, active: null,
 *   update: async () => {}, unregister: async () => true,
 * })
 * const stub = Object.assign(new EventTarget(), {
 *   controller: null,
 *   ready: Promise.resolve(registration),
 *   register: async () => registration,
 *   getRegistration: async () => registration,
 * })
 * Effect.runPromise(ready.pipe(Effect.provideService(Container, Option.some(stub)))).then((found) =>
 *   console.log(found.scope), // "https://example.com/"
 * )
 * ```
 *
 * @since 0.1.0
 * @category registration
 */
export const ready: Effect.Effect<RegistrationLike, ContainerError> = withContainer(
  "ready",
  (container) => call("ready", () => container.ready),
);

/**
 * The registration whose scope covers `clientURL` (the page's own URL by
 * default), if any.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Container, getRegistration } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   controller: null,
 *   ready: new Promise<never>(() => {}),
 *   register: () => Promise.reject(new Error("unused")),
 *   getRegistration: async () => undefined,
 * })
 * const program = getRegistration().pipe(Effect.provideService(Container, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // None
 * ```
 *
 * @since 0.1.0
 * @category registration
 */
export const getRegistration = (
  clientURL?: string,
): Effect.Effect<Option.Option<RegistrationLike>, ContainerError> =>
  withContainer("getRegistration", (container) =>
    Effect.map(
      call("getRegistration", () =>
        clientURL === undefined
          ? container.getRegistration()
          : container.getRegistration(clientURL),
      ),
      Option.fromUndefinedOr,
    ),
  );

/**
 * Checks the server for a newer script now, rather than at the browser's
 * next navigation or 24-hour check.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { update } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * const registration = Object.assign(new EventTarget(), {
 *   scope: "https://example.com/", installing: null, waiting: null, active: null,
 *   update: async () => console.log("checked"), unregister: async () => true,
 * })
 * Effect.runPromise(update(registration)) // logs "checked"
 * ```
 *
 * @since 0.1.0
 * @category registration
 */
export const update = (registration: RegistrationLike): Effect.Effect<void, ContainerError> =>
  Effect.asVoid(call("update", () => registration.update()));

/**
 * Unregisters: the worker keeps controlling open pages until they close.
 * `false` when there was nothing to unregister.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { unregister } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * const registration = Object.assign(new EventTarget(), {
 *   scope: "https://example.com/", installing: null, waiting: null, active: null,
 *   update: async () => {}, unregister: async () => true,
 * })
 * Effect.runPromise(unregister(registration)).then(console.log) // true
 * ```
 *
 * @since 0.1.0
 * @category registration
 */
export const unregister = (
  registration: RegistrationLike,
): Effect.Effect<boolean, ContainerError> => call("unregister", () => registration.unregister());

/**
 * The worker controlling this page now; `None` on a first load or a hard
 * reload.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { controller } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * Effect.runPromise(Effect.flip(controller)).then((error) => console.log(error.reason))
 * // "Unsupported" under Node
 * ```
 *
 * @since 0.1.0
 * @category control
 */
export const controller: Effect.Effect<
  Option.Option<ServiceWorkerLike>,
  ContainerError
> = withContainer("controller", (container) =>
  Effect.sync(() => Option.fromNullOr(container.controller)),
);

/**
 * The page's controller: the current one first, then each change
 * (`controllerchange`), when a new worker claims the page or one that
 * called `skipWaiting` activates. Reload on a change to run the new code.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import * as Stream from "effect/Stream"
 * import { Container, controllerChanges } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * const stub = Object.assign(new EventTarget(), {
 *   controller: null,
 *   ready: new Promise<never>(() => {}),
 *   register: () => Promise.reject(new Error("unused")),
 *   getRegistration: async () => undefined,
 * })
 * const program = Stream.runHead(controllerChanges).pipe(
 *   Effect.provideService(Container, Option.some(stub)),
 * )
 * Effect.runPromise(program).then(console.log) // Some(None)
 * ```
 *
 * @since 0.1.0
 * @category control
 */
export const controllerChanges: Stream.Stream<
  Option.Option<ServiceWorkerLike>,
  ContainerError
> = Stream.unwrap(
  withContainer("controller", (container) => {
    const read = () => Option.fromNullOr(container.controller);
    return Effect.succeed(
      Stream.concat(
        Stream.sync(read),
        Stream.map(Stream.fromEventListener(container, "controllerchange"), read),
      ),
    );
  }),
);

/**
 * The installed worker waiting to take over, once there is one: the
 * registration's `waiting` worker if it has one already, else the
 * installing worker of the next update once it reaches `installed`. A
 * worker that fails to install (`redundant`) is skipped. This is "a new
 * version is ready": prompt, then tell it to `skipWaiting`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { waitingWorker } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * const next = Object.assign(new EventTarget(), {
 *   scriptURL: "https://example.com/sw.js", state: "installed" as const, postMessage: () => {},
 * })
 * const registration = Object.assign(new EventTarget(), {
 *   scope: "https://example.com/", installing: null, waiting: next, active: null,
 *   update: async () => {}, unregister: async () => true,
 * })
 * Effect.runPromise(waitingWorker(registration)).then((worker) => console.log(worker.state)) // "installed"
 * ```
 *
 * @since 0.1.0
 * @category updates
 */
export const waitingWorker = (registration: RegistrationLike): Effect.Effect<ServiceWorkerLike> =>
  Option.match(Option.fromNullOr(registration.waiting), {
    onSome: Effect.succeed,
    onNone: () =>
      Stream.fromEventListener(registration, "updatefound").pipe(
        Stream.map(() => Option.fromNullOr(registration.installing)),
        Stream.prepend([Option.fromNullOr(registration.installing)]),
        Stream.filterMap((installing) => Result.fromOption(installing, () => installing)),
        Stream.mapEffect(installedOrRedundant),
        Stream.filterMap((worker) => Result.fromOption(worker, () => worker)),
        Stream.runHead,
        // The registration's events never end, so a head always arrives.
        Effect.flatMap(Effect.fromOption),
        Effect.orDie,
      ),
  });

/** Waits for `worker` to finish installing: `Some` once installed, `None` if it became redundant. */
const installedOrRedundant = (
  worker: ServiceWorkerLike,
): Effect.Effect<Option.Option<ServiceWorkerLike>> =>
  Stream.fromEventListener(worker, "statechange").pipe(
    Stream.map(() => worker.state),
    Stream.prepend([worker.state]),
    Stream.filter((state) => state !== "parsed" && state !== "installing"),
    Stream.runHead,
    Effect.map((state) =>
      Option.filter(state, (reached) => reached !== "redundant").pipe(Option.as(worker)),
    ),
  );

/**
 * The page's controller as an endpoint speaking `protocol`: what it sends
 * goes to the controller, what it receives is every message a worker
 * posts to this page (`navigator.serviceWorker`'s `message` events). Fails
 * `NoController` when the page is not controlled; follow
 * {@link controllerChanges} to reconnect after an update.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import * as Schema from "effect/Schema"
 * import { Container, controllerEndpoint } from "@thomasfosterau/effect-platform-browser/ServiceWorkerContainer"
 *
 * const SkipWaiting = Schema.Struct({ type: Schema.Literal("SKIP_WAITING") })
 * const worker = Object.assign(new EventTarget(), {
 *   scriptURL: "https://example.com/sw.js", state: "activated" as const,
 *   postMessage: (message: unknown) => console.log(message),
 * })
 * const stub = Object.assign(new EventTarget(), {
 *   controller: worker,
 *   ready: new Promise<never>(() => {}),
 *   register: () => Promise.reject(new Error("unused")),
 *   getRegistration: async () => undefined,
 * })
 * const program = Effect.gen(function* () {
 *   const sw = yield* controllerEndpoint({ send: SkipWaiting, receive: Schema.Never })
 *   yield* sw.send({ type: "SKIP_WAITING" })
 * }).pipe(Effect.provideService(Container, Option.some(stub)))
 * Effect.runPromise(program) // logs { type: "SKIP_WAITING" }
 * ```
 *
 * @since 0.1.0
 * @category messaging
 */
export const controllerEndpoint = <Send, SendEncoded, Receive, ReceiveEncoded>(
  protocol: WorkerMessaging.Protocol<Send, SendEncoded, Receive, ReceiveEncoded>,
): Effect.Effect<WorkerMessaging.Endpoint<Send, Receive>, ContainerError> =>
  withContainer("controller", (container) =>
    Option.match(Option.fromNullOr(container.controller), {
      onNone: () => Effect.fail(containerError("controller", "NoController", undefined)),
      onSome: (worker) => {
        const port: WorkerMessaging.PortLike = {
          addEventListener: (type, listener, options) =>
            container.addEventListener(type, listener, options),
          removeEventListener: (type, listener, options) =>
            container.removeEventListener(type, listener, options),
          postMessage: (message, transfer) => worker.postMessage(message, transfer),
          // Messages queue until the page starts them (or its first
          // `onmessage` assignment, which an endpoint never makes).
          start: () => container.startMessages?.(),
        };
        return Effect.succeed(WorkerMessaging.endpoint(port, protocol));
      },
    }),
  );
