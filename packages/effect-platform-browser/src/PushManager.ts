/**
 * Web Push subscriptions from the page (`registration.pushManager`):
 * subscribe with the server's VAPID key, read or drop the current
 * subscription, and turn one into the JSON a server stores.
 *
 * A registration without a `pushManager` (Safari before 16, some embedded
 * browsers) fails every call `Unsupported`. Receiving a push happens in the
 * service worker, not here.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { reasonOf } from "./internal/dom.ts";

/**
 * The structural slice of a `PushSubscription` this module uses.
 *
 * @since 0.1.0
 * @category models
 */
export interface PushSubscriptionLike {
  readonly endpoint: string;
  toJSON(): PushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
}

/**
 * What {@link subscribe} passes on: `userVisibleOnly` (every browser
 * requires `true`) and the application server's public key, as bytes or
 * a base64url string.
 *
 * @since 0.1.0
 * @category models
 */
export interface SubscribeOptionsLike {
  readonly userVisibleOnly: boolean;
  readonly applicationServerKey: string | Uint8Array<ArrayBuffer>;
}

/**
 * The structural slice of a `PushManager` this module uses. The
 * `T | null` member is the platform's spelling; this module reads it as
 * `Option`.
 *
 * @since 0.1.0
 * @category models
 */
export interface PushManagerLike {
  subscribe(options: SubscribeOptionsLike): Promise<PushSubscriptionLike>;
  getSubscription(): Promise<PushSubscriptionLike | null>;
  permissionState(options: SubscribeOptionsLike): Promise<PermissionState>;
}

/**
 * The part of a service worker registration this module reads. A
 * `ServiceWorkerContainer.RegistrationLike` from a real browser has it.
 *
 * @since 0.1.0
 * @category models
 */
export interface PushRegistrationLike {
  readonly pushManager?: PushManagerLike | undefined;
}

/**
 * What {@link subscribe} and {@link permissionState} take. `userVisibleOnly`
 * defaults to `true`, the only value browsers accept.
 *
 * @since 0.1.0
 * @category models
 */
export interface SubscribeOptions {
  readonly applicationServerKey: string | Uint8Array<ArrayBuffer>;
  readonly userVisibleOnly?: true;
}

/**
 * Which call failed.
 *
 * @since 0.1.0
 * @category models
 */
export type PushOperation =
  | "subscribe"
  | "getSubscription"
  | "unsubscribe"
  | "permissionState"
  | "toJSON";

/**
 * Why a call failed.
 *
 * - `Unsupported` — the registration has no `pushManager`.
 * - `NotAllowed` — the user denied notification permission
 *   (`NotAllowedError`).
 * - `InvalidState` — there is no active worker yet, or a subscription
 *   with another key exists (`InvalidStateError`).
 * - `InvalidKey` — the application server key is malformed or missing
 *   (`InvalidAccessError`, `InvalidCharacterError`, `NotSupportedError`).
 * - `PushService` — the push service could not be reached (`AbortError`).
 * - `InvalidSubscription` — `toJSON` gave something without an endpoint
 *   and both keys.
 * - `Failed` — anything else; `cause` carries it.
 *
 * @since 0.1.0
 * @category models
 */
export type PushErrorReason =
  | "Unsupported"
  | "NotAllowed"
  | "InvalidState"
  | "InvalidKey"
  | "PushService"
  | "InvalidSubscription"
  | "Failed";

/**
 * A push call failed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { getSubscription } from "@thomasfosterau/effect-platform-browser/PushManager"
 *
 * Effect.runPromise(Effect.flip(getSubscription({}))).then((error) => console.log(error.reason))
 * // "Unsupported": the registration has no pushManager
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class PushError extends Schema.TaggedError<PushError, { readonly brand: unique symbol }>()(
  "PushError",
  {
    operation: Schema.Literals([
      "subscribe",
      "getSubscription",
      "unsubscribe",
      "permissionState",
      "toJSON",
    ]),
    reason: Schema.Literals([
      "Unsupported",
      "NotAllowed",
      "InvalidState",
      "InvalidKey",
      "PushService",
      "InvalidSubscription",
      "Failed",
    ]),
    cause: Schema.Unknown,
  },
) {
  override get message(): string {
    return `pushManager.${this.operation}: ${this.reason}`;
  }
}

/**
 * A push subscription as `PushSubscription.toJSON()` gives it and a
 * server stores it: the push service `endpoint`, its expiry in epoch
 * milliseconds (`null` for none) and the `p256dh` / `auth` keys, base64url.
 * Decode it on the server to check what a page sent.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { SubscriptionJson } from "@thomasfosterau/effect-platform-browser/PushManager"
 *
 * const stored = Schema.decodeUnknownSync(SubscriptionJson)({
 *   endpoint: "https://push.example/abc",
 *   expirationTime: null,
 *   keys: { p256dh: "BNc...", auth: "tBH..." },
 * })
 * console.log(stored.endpoint) // "https://push.example/abc"
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const SubscriptionJson = Schema.Struct({
  endpoint: Schema.String,
  expirationTime: Schema.optional(Schema.NullOr(Schema.Finite)),
  keys: Schema.Struct({ p256dh: Schema.String, auth: Schema.String }),
});

/**
 * The decoded form of {@link SubscriptionJson}.
 *
 * @since 0.1.0
 * @category models
 */
export type SubscriptionJson = typeof SubscriptionJson.Type;

const REJECTIONS = {
  NotAllowedError: "NotAllowed",
  InvalidStateError: "InvalidState",
  InvalidAccessError: "InvalidKey",
  InvalidCharacterError: "InvalidKey",
  NotSupportedError: "InvalidKey",
  AbortError: "PushService",
} satisfies Readonly<Record<string, PushErrorReason>>;

const pushError = (operation: PushOperation, reason: PushErrorReason, cause: unknown) =>
  new PushError({ operation, reason, cause });

const call = <A>(operation: PushOperation, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => pushError(operation, reasonOf(cause, REJECTIONS, "Failed"), cause),
  });

const withManager = <A>(
  operation: PushOperation,
  registration: PushRegistrationLike,
  use: (manager: PushManagerLike) => Promise<A>,
): Effect.Effect<A, PushError> =>
  Option.match(Option.fromUndefinedOr(registration.pushManager), {
    onNone: () => Effect.fail(pushError(operation, "Unsupported", undefined)),
    onSome: (manager) => call(operation, () => use(manager)),
  });

const platformOptions = (options: SubscribeOptions): SubscribeOptionsLike => ({
  userVisibleOnly: true,
  applicationServerKey: options.applicationServerKey,
});

/**
 * Subscribes the registration to push (asking for notification permission
 * first if the user has not answered), or returns its existing
 * subscription for the same key. Needs an active worker: wait on
 * `ServiceWorkerContainer.ready` first.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { subscribe } from "@thomasfosterau/effect-platform-browser/PushManager"
 *
 * const subscription = {
 *   endpoint: "https://push.example/abc",
 *   toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } }),
 *   unsubscribe: async () => true,
 * }
 * const registration = {
 *   pushManager: {
 *     subscribe: async () => subscription,
 *     getSubscription: async () => null,
 *     permissionState: async () => "granted" as const,
 *   },
 * }
 * Effect.runPromise(subscribe(registration, { applicationServerKey: "BEl6..." })).then((found) =>
 *   console.log(found.endpoint), // "https://push.example/abc"
 * )
 * ```
 *
 * @since 0.1.0
 * @category subscriptions
 */
export const subscribe = (
  registration: PushRegistrationLike,
  options: SubscribeOptions,
): Effect.Effect<PushSubscriptionLike, PushError> =>
  withManager("subscribe", registration, (manager) => manager.subscribe(platformOptions(options)));

/**
 * The registration's current subscription, if it has one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { getSubscription } from "@thomasfosterau/effect-platform-browser/PushManager"
 *
 * const registration = {
 *   pushManager: {
 *     subscribe: () => Promise.reject(new Error("unused")),
 *     getSubscription: async () => null,
 *     permissionState: async () => "prompt" as const,
 *   },
 * }
 * Effect.runPromise(getSubscription(registration)).then(console.log) // None
 * ```
 *
 * @since 0.1.0
 * @category subscriptions
 */
export const getSubscription = (
  registration: PushRegistrationLike,
): Effect.Effect<Option.Option<PushSubscriptionLike>, PushError> =>
  Effect.map(
    withManager("getSubscription", registration, (manager) => manager.getSubscription()),
    Option.fromNullOr,
  );

/**
 * Cancels the subscription at the push service. `false` when it was
 * already gone.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { unsubscribe } from "@thomasfosterau/effect-platform-browser/PushManager"
 *
 * const subscription = {
 *   endpoint: "https://push.example/abc",
 *   toJSON: () => ({}),
 *   unsubscribe: async () => true,
 * }
 * Effect.runPromise(unsubscribe(subscription)).then(console.log) // true
 * ```
 *
 * @since 0.1.0
 * @category subscriptions
 */
export const unsubscribe = (
  subscription: PushSubscriptionLike,
): Effect.Effect<boolean, PushError> => call("unsubscribe", () => subscription.unsubscribe());

/**
 * Whether {@link subscribe} with these options would be allowed
 * (`"granted"`), would prompt (`"prompt"`), or is refused (`"denied"`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { permissionState } from "@thomasfosterau/effect-platform-browser/PushManager"
 *
 * const registration = {
 *   pushManager: {
 *     subscribe: () => Promise.reject(new Error("unused")),
 *     getSubscription: async () => null,
 *     permissionState: async () => "prompt" as const,
 *   },
 * }
 * Effect.runPromise(permissionState(registration, { applicationServerKey: "BEl6..." })).then(
 *   console.log, // "prompt"
 * )
 * ```
 *
 * @since 0.1.0
 * @category subscriptions
 */
export const permissionState = (
  registration: PushRegistrationLike,
  options: SubscribeOptions,
): Effect.Effect<PermissionState, PushError> =>
  withManager("permissionState", registration, (manager) =>
    manager.permissionState(platformOptions(options)),
  );

const decodeJson = Schema.decodeUnknownEffect(SubscriptionJson);

/**
 * The subscription as the JSON to send to the server, checked against
 * {@link SubscriptionJson}: fails `InvalidSubscription` if the browser
 * gave one without both keys.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { toJson } from "@thomasfosterau/effect-platform-browser/PushManager"
 *
 * const subscription = {
 *   endpoint: "https://push.example/abc",
 *   toJSON: () => ({
 *     endpoint: "https://push.example/abc",
 *     expirationTime: null,
 *     keys: { p256dh: "BNc...", auth: "tBH..." },
 *   }),
 *   unsubscribe: async () => true,
 * }
 * Effect.runPromise(toJson(subscription)).then((json) => console.log(json.keys.auth)) // "tBH..."
 * ```
 *
 * @since 0.1.0
 * @category subscriptions
 */
export const toJson = (
  subscription: PushSubscriptionLike,
): Effect.Effect<SubscriptionJson, PushError> =>
  Effect.try({
    try: () => subscription.toJSON(),
    catch: (cause) => pushError("toJSON", "Failed", cause),
  }).pipe(
    Effect.flatMap((json) =>
      Effect.mapError(decodeJson(json), (cause) =>
        pushError("toJSON", "InvalidSubscription", cause),
      ),
    ),
  );
