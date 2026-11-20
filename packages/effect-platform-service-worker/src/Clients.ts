/**
 * A service worker's clients (`self.clients`): the pages, workers and
 * frames it controls or could, as typed effects. Finding, focusing and
 * opening windows, claiming uncontrolled pages, and posting schema-typed
 * messages to one client or all of them.
 *
 * `openWindow` and `focus` need a user gesture: call them from a
 * `notificationclick` handler, or the browser refuses with `NotAllowed`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as WorkerMessaging from "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging";
import { isInstanceOfGlobal } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";
import { reasonOf } from "./internal/dom.ts";

/**
 * The structural slice of a `Client` this module uses.
 *
 * @since 0.1.0
 * @category models
 */
export interface ClientLike extends WorkerMessaging.PostTargetLike {
  readonly id: string;
  readonly type: string;
  readonly url: string;
}

/**
 * The structural slice of a `WindowClient`: a client that is a browsing
 * context, which can be focused and navigated.
 *
 * @since 0.1.0
 * @category models
 */
export interface WindowClientLike extends ClientLike {
  readonly focused: boolean;
  readonly visibilityState: string;
  focus(): Promise<WindowClientLike>;
  navigate(url: string): Promise<WindowClientLike | null>;
}

/**
 * Which clients {@link matchAll} returns: `type` defaults to `"window"`
 * (the platform's default), and `includeUncontrolled` to `false`.
 *
 * @since 0.1.0
 * @category models
 */
export interface MatchOptions {
  readonly type?: "window" | "worker" | "sharedworker" | "all";
  readonly includeUncontrolled?: boolean;
}

/**
 * The structural slice of a `Clients` object this module uses.
 *
 * @since 0.1.0
 * @category models
 */
export interface ClientsLike {
  get(id: string): Promise<ClientLike | undefined>;
  matchAll(options?: MatchOptions): Promise<ReadonlyArray<ClientLike>>;
  openWindow(url: string): Promise<WindowClientLike | null>;
  claim(): Promise<void>;
}

/**
 * Which call failed.
 *
 * @since 0.1.0
 * @category models
 */
export type ClientsOperation = "get" | "matchAll" | "openWindow" | "claim" | "focus" | "navigate";

/**
 * Why a call failed.
 *
 * - `Unsupported` — not running in a service worker.
 * - `NotAllowed` — `openWindow` or `focus` without a user gesture
 *   (`InvalidAccessError`), or a client that is not active.
 * - `InvalidUrl` — a URL that does not parse or is not same-origin where
 *   the platform requires it (`TypeError`).
 * - `Failed` — anything else; `cause` carries it.
 *
 * @since 0.1.0
 * @category models
 */
export type ClientsErrorReason = "Unsupported" | "NotAllowed" | "InvalidUrl" | "Failed";

/**
 * A clients call failed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { claim } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * Effect.runPromise(Effect.flip(claim)).then((error) => console.log(error.reason))
 * // "Unsupported" under Node
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class ClientsError extends Schema.TaggedError<ClientsError>()("ClientsError", {
  operation: Schema.Literals(["get", "matchAll", "openWindow", "claim", "focus", "navigate"]),
  reason: Schema.Literals(["Unsupported", "NotAllowed", "InvalidUrl", "Failed"]),
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `clients.${this.operation}: ${this.reason}`;
  }
}

const REJECTIONS = {
  InvalidAccessError: "NotAllowed",
  InvalidStateError: "NotAllowed",
  TypeError: "InvalidUrl",
} satisfies Readonly<Record<string, ClientsErrorReason>>;

const ambient = (): Option.Option<ClientsLike> => {
  const self: unknown = globalThis;
  return isInstanceOfGlobal(self, "ServiceWorkerGlobalScope") &&
    P.hasProperty(self, "clients") &&
    isClients(self.clients)
    ? Option.some(self.clients)
    : Option.none();
};

const isClients = (value: unknown): value is ClientsLike =>
  P.hasProperty(value, "matchAll") && P.isFunction(value.matchAll);

/**
 * The worker's `Clients`. Defaults to `self.clients` in a service worker,
 * else `Option.none()`, read on first use; provide `Option.some(stub)` in
 * a test.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Clients, matchAll } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const stub = {
 *   get: async () => undefined,
 *   matchAll: async () => [{ id: "a", type: "window", url: "https://example.com/", postMessage: () => {} }],
 *   openWindow: async () => null,
 *   claim: async () => {},
 * }
 * const program = matchAll().pipe(Effect.provideService(Clients, Option.some(stub)))
 * Effect.runPromise(program).then((clients) => console.log(clients.length)) // 1
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const Clients: Context.Reference<Option.Option<ClientsLike>> =
  /*#__PURE__*/ Context.Reference("@thomasfosterau/effect-platform-service-worker/Clients", {
    defaultValue: ambient,
  });

const call = <A>(
  operation: ClientsOperation,
  run: () => Promise<A>,
): Effect.Effect<A, ClientsError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new ClientsError({ operation, reason: reasonOf(cause, REJECTIONS, "Failed"), cause }),
  });

const withClients = <A>(
  operation: ClientsOperation,
  run: (clients: ClientsLike) => Promise<A>,
): Effect.Effect<A, ClientsError> =>
  Clients.use((clients) =>
    Option.match(clients, {
      onNone: () =>
        Effect.fail(new ClientsError({ operation, reason: "Unsupported", cause: undefined })),
      onSome: (present) => call(operation, () => run(present)),
    }),
  );

/**
 * Whether `client` is a `WindowClient` (it can be focused and navigated).
 *
 * @example
 * ```ts
 * import { isWindowClient } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * console.log(isWindowClient({ id: "a", type: "worker", url: "", postMessage: () => {} })) // false
 * ```
 *
 * @since 0.1.0
 * @category guards
 */
export const isWindowClient = (client: ClientLike): client is WindowClientLike =>
  client.type === "window" && P.hasProperty(client, "focus") && P.isFunction(client.focus);

/**
 * The client with `id` (a `FetchEvent`'s `clientId`, a message's
 * `source.id`), if it still exists.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Clients, get } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const stub = {
 *   get: async () => undefined,
 *   matchAll: async () => [],
 *   openWindow: async () => null,
 *   claim: async () => {},
 * }
 * const program = get("gone").pipe(Effect.provideService(Clients, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // None
 * ```
 *
 * @since 0.1.0
 * @category clients
 */
export const get = (id: string): Effect.Effect<Option.Option<ClientLike>, ClientsError> =>
  Effect.map(
    withClients("get", (clients) => clients.get(id)),
    Option.fromUndefinedOr,
  );

/**
 * The clients matching `options`, most recently focused window first.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Clients, matchAll } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const stub = {
 *   get: async () => undefined,
 *   matchAll: async (options?: { readonly type?: string }) => {
 *     console.log(options) // { type: "all", includeUncontrolled: true }
 *     return []
 *   },
 *   openWindow: async () => null,
 *   claim: async () => {},
 * }
 * const program = matchAll({ type: "all", includeUncontrolled: true }).pipe(
 *   Effect.provideService(Clients, Option.some(stub)),
 * )
 * Effect.runPromise(program)
 * ```
 *
 * @since 0.1.0
 * @category clients
 */
export const matchAll = (
  options: MatchOptions = {},
): Effect.Effect<ReadonlyArray<ClientLike>, ClientsError> =>
  withClients("matchAll", (clients) => clients.matchAll(options));

/**
 * The window clients, controlled or not.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Clients, windows } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const window = {
 *   id: "a", type: "window", url: "https://example.com/", postMessage: () => {},
 *   focused: true, visibilityState: "visible",
 *   focus: async () => window, navigate: async () => window,
 * }
 * const stub = {
 *   get: async () => undefined,
 *   matchAll: async () => [window],
 *   openWindow: async () => null,
 *   claim: async () => {},
 * }
 * const program = windows.pipe(Effect.provideService(Clients, Option.some(stub)))
 * Effect.runPromise(program).then((found) => console.log(found[0]?.focused)) // true
 * ```
 *
 * @since 0.1.0
 * @category clients
 */
export const windows: Effect.Effect<ReadonlyArray<WindowClientLike>, ClientsError> = Effect.map(
  matchAll({ type: "window", includeUncontrolled: true }),
  Arr.filter(isWindowClient),
);

/**
 * Makes this worker the controller of every client in its scope that it
 * does not yet control, typically from `activate` after `skipWaiting`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Clients, claim } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const stub = {
 *   get: async () => undefined,
 *   matchAll: async () => [],
 *   openWindow: async () => null,
 *   claim: async () => console.log("claimed"),
 * }
 * Effect.runPromise(claim.pipe(Effect.provideService(Clients, Option.some(stub)))) // logs "claimed"
 * ```
 *
 * @since 0.1.0
 * @category lifecycle
 */
export const claim: Effect.Effect<void, ClientsError> = withClients("claim", (clients) =>
  clients.claim(),
);

/**
 * Opens `url` in a new window. `None` when the browser opened it in a
 * window this worker cannot see (another origin).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Clients, openWindow } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const stub = {
 *   get: async () => undefined,
 *   matchAll: async () => [],
 *   openWindow: async () => {
 *     throw Object.assign(new Error("no gesture"), { name: "InvalidAccessError" })
 *   },
 *   claim: async () => {},
 * }
 * const program = openWindow("/inbox").pipe(Effect.provideService(Clients, Option.some(stub)))
 * Effect.runPromise(Effect.flip(program)).then((error) => console.log(error.reason)) // "NotAllowed"
 * ```
 *
 * @since 0.1.0
 * @category windows
 */
export const openWindow = (
  url: string,
): Effect.Effect<Option.Option<WindowClientLike>, ClientsError> =>
  Effect.map(
    withClients("openWindow", (clients) => clients.openWindow(url)),
    Option.fromNullOr,
  );

/**
 * Focuses a window client.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { focus } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const window = {
 *   id: "a", type: "window", url: "https://example.com/", postMessage: () => {},
 *   focused: false, visibilityState: "hidden",
 *   focus: async () => ({ ...window, focused: true }), navigate: async () => window,
 * }
 * Effect.runPromise(focus(window)).then((focused) => console.log(focused.focused)) // true
 * ```
 *
 * @since 0.1.0
 * @category windows
 */
export const focus = (client: WindowClientLike): Effect.Effect<WindowClientLike, ClientsError> =>
  call("focus", () => client.focus());

/**
 * Navigates a window client this worker controls to `url`. `None` when
 * the new page is on another origin.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { navigate } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const window = {
 *   id: "a", type: "window", url: "https://example.com/", postMessage: () => {},
 *   focused: true, visibilityState: "visible",
 *   focus: async () => window, navigate: async () => null,
 * }
 * Effect.runPromise(navigate(window, "https://elsewhere.example/")).then(console.log) // None
 * ```
 *
 * @since 0.1.0
 * @category windows
 */
export const navigate = (
  client: WindowClientLike,
  url: string,
): Effect.Effect<Option.Option<WindowClientLike>, ClientsError> =>
  Effect.map(
    call("navigate", () => client.navigate(url)),
    Option.fromNullOr,
  );

/**
 * Focuses the first window already showing `url` (compared without its
 * fragment), or opens one: what a `notificationclick` handler usually
 * wants. `url` is resolved against `base` (the worker's location) when it
 * is relative.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Clients, focusOrOpen } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const window = {
 *   id: "a", type: "window", url: "https://example.com/inbox#top", postMessage: () => {},
 *   focused: false, visibilityState: "hidden",
 *   focus: async () => { console.log("focused"); return window },
 *   navigate: async () => window,
 * }
 * const stub = {
 *   get: async () => undefined,
 *   matchAll: async () => [window],
 *   openWindow: async () => null,
 *   claim: async () => {},
 * }
 * const program = focusOrOpen("/inbox", "https://example.com/sw.js").pipe(
 *   Effect.provideService(Clients, Option.some(stub)),
 * )
 * Effect.runPromise(program) // logs "focused"
 * ```
 *
 * @since 0.1.0
 * @category windows
 */
export const focusOrOpen = (
  url: string,
  base: string,
): Effect.Effect<Option.Option<WindowClientLike>, ClientsError> => {
  const target = withoutFragment(new URL(url, base).href);
  return Effect.flatMap(windows, (found) =>
    Option.match(
      Arr.findFirst(found, (client) => withoutFragment(client.url) === target),
      {
        onNone: () => openWindow(target),
        onSome: (client) => Effect.map(focus(client), Option.some),
      },
    ),
  );
};

const withoutFragment = (href: string): string => {
  const url = new URL(href);
  url.hash = "";
  return url.href;
};

/**
 * Builds a function that encodes a message with `schema` and posts it to
 * one client (see `WorkerMessaging.sender`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { postTo } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const Updated = Schema.Struct({ type: Schema.Literal("updated") })
 * const client = { id: "a", type: "window", url: "", postMessage: (message: unknown) => console.log(message) }
 * Effect.runPromise(postTo(Updated)(client, { type: "updated" })) // logs { type: "updated" }
 * ```
 *
 * @since 0.1.0
 * @category messaging
 */
export const postTo: <A, I>(
  schema: Schema.Codec<A, I>,
) => (
  client: ClientLike,
  message: A,
) => Effect.Effect<void, WorkerMessaging.MessagingError | Schema.SchemaError> =
  WorkerMessaging.sender;

/**
 * Builds a function that posts a message to every client matching
 * `options` (every window, controlled or not, by default), encoding it
 * once per client. Returns how many clients it reached.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import * as Schema from "effect/Schema"
 * import { Clients, broadcast } from "@thomasfosterau/effect-platform-service-worker/Clients"
 *
 * const client = { id: "a", type: "window", url: "", postMessage: (message: unknown) => console.log(message) }
 * const stub = {
 *   get: async () => undefined,
 *   matchAll: async () => [client, client],
 *   openWindow: async () => null,
 *   claim: async () => {},
 * }
 * const program = broadcast(Schema.String)("refresh").pipe(Effect.provideService(Clients, Option.some(stub)))
 * Effect.runPromise(program).then(console.log) // logs "refresh" twice, then 2
 * ```
 *
 * @since 0.1.0
 * @category messaging
 */
export const broadcast = <A, I>(schema: Schema.Codec<A, I>, options?: MatchOptions) => {
  const send = WorkerMessaging.sender(schema);
  return (
    message: A,
  ): Effect.Effect<number, ClientsError | WorkerMessaging.MessagingError | Schema.SchemaError> =>
    Effect.flatMap(matchAll(options ?? { type: "window", includeUncontrolled: true }), (clients) =>
      Effect.as(
        Effect.forEach(clients, (client) => send(client, message), {
          concurrency: 1,
          discard: true,
        }),
        clients.length,
      ),
    );
};
