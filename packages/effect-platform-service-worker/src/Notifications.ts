/**
 * Persistent notifications, shown through the worker's registration, and
 * the `notificationclick` / `notificationclose` listeners their events
 * reach. To focus or open a window from a click, see `Clients`.
 *
 * Nothing here touches a global at import: {@link Registration} is a
 * context reference defaulting to `self.registration` when the realm is a
 * `ServiceWorkerGlobalScope`, read on first use.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import { isInstanceOfGlobal } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";
import { reasonOf } from "./internal/dom.ts";
import { decodedListener, type ExtendableEventLike } from "./internal/events.ts";

/**
 * The part of a persistent `Notification` (one shown through a
 * registration) this entry reads: what it was shown with, and `close`.
 *
 * @since 0.1.0
 * @category models
 */
export interface PersistentNotificationLike {
  readonly title: string;
  readonly tag: string;
  readonly body: string;
  readonly data: unknown;
  close(): void;
}

/**
 * The part of a `ServiceWorkerRegistration` (`self.registration`) this
 * entry calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface ServiceWorkerRegistrationLike {
  showNotification(title: string, options?: NotificationOptions): Promise<void>;
  getNotifications(
    filter?: GetNotificationOptions,
  ): Promise<ReadonlyArray<PersistentNotificationLike>>;
}

/**
 * The part of a `NotificationEvent` (`notificationclick`,
 * `notificationclose`) this entry uses: the notification, and which action
 * button was pressed (`""` for the notification itself).
 *
 * @since 0.1.0
 * @category models
 */
export interface NotificationEventLike extends ExtendableEventLike {
  readonly notification: PersistentNotificationLike;
  readonly action?: string;
}

/**
 * Why a registration notification call failed.
 *
 * - `Unsupported` — no registration to call (not a service worker, and
 *   none provided).
 * - `NotAllowed` — refused with `NotAllowedError` / `SecurityError`.
 * - `InvalidData` — refused with a `TypeError` or `DataCloneError`: invalid
 *   options, or `data` that cannot be structured-cloned. Chromium also
 *   rejects with a `TypeError` when the origin has no notification
 *   permission, which reads as this too; check the permission first.
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.1.0
 * @category errors
 */
export type ShowNotificationErrorReason = "Unsupported" | "NotAllowed" | "InvalidData" | "Failed";

/**
 * A registration notification call that failed: `operation` names it.
 * Distinct from effect-ext `Browser`'s `NotificationError` (a page's own
 * notifications), so a `catchTag` for one never swallows the other.
 *
 * @since 0.1.0
 * @category errors
 */
export class ShowNotificationError extends Schema.TaggedError<
  ShowNotificationError,
  { readonly brand: unique symbol }
>()("ShowNotificationError", {
  operation: Schema.Literals(["show", "get"]),
  reason: Schema.Literals(["Unsupported", "NotAllowed", "InvalidData", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const NOTIFICATION_REJECTIONS = {
  NotAllowedError: "NotAllowed",
  SecurityError: "NotAllowed",
  TypeError: "InvalidData",
  DataCloneError: "InvalidData",
} satisfies Readonly<Record<string, ShowNotificationErrorReason>>;

const notificationError = (
  operation: "show" | "get",
  reason: ShowNotificationErrorReason,
  cause: unknown,
) =>
  new ShowNotificationError({
    operation,
    reason,
    cause,
    message: `service-worker: ${operation} notification: ${reason}`,
  });

const isRegistration = (value: unknown): value is ServiceWorkerRegistrationLike =>
  P.hasProperty(value, "showNotification") &&
  P.isFunction(value.showNotification) &&
  P.hasProperty(value, "getNotifications") &&
  P.isFunction(value.getNotifications);

/** The worker's own `self.registration`; `None` in any other realm. */
const ambientRegistration = (): Option.Option<ServiceWorkerRegistrationLike> => {
  const self: unknown = globalThis;
  return isInstanceOfGlobal(self, "ServiceWorkerGlobalScope") &&
    P.hasProperty(self, "registration") &&
    isRegistration(self.registration)
    ? Option.some(self.registration)
    : Option.none();
};

/**
 * The `ServiceWorkerRegistration` notifications are shown through. Defaults
 * to `self.registration` when the realm is a `ServiceWorkerGlobalScope`,
 * else `Option.none()`, read on first use, never at import; with none,
 * each call fails `Unsupported`. Provide `Option.some(stub)` in a test.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Registration, showNotification } from "@thomasfosterau/effect-platform-service-worker/Notifications"
 *
 * const shown: Array<string> = []
 * const registration = {
 *   showNotification: async (title: string) => { shown.push(title) },
 *   getNotifications: async () => [],
 * }
 * await Effect.runPromise(
 *   showNotification("Back online").pipe(Effect.provideService(Registration, Option.some(registration))),
 * )
 * shown // ["Back online"]
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const Registration: Context.Reference<Option.Option<ServiceWorkerRegistrationLike>> =
  /*#__PURE__*/ Context.Reference(
    "@thomasfosterau/effect-platform-service-worker/Notifications/Registration",
    {
      defaultValue: ambientRegistration,
    },
  );

const withRegistration = <A>(
  operation: "show" | "get",
  call: (registration: ServiceWorkerRegistrationLike) => Promise<A>,
): Effect.Effect<A, ShowNotificationError> =>
  Registration.use((registration) =>
    Option.match(registration, {
      onNone: () => Effect.fail(notificationError(operation, "Unsupported", undefined)),
      onSome: (present) =>
        Effect.tryPromise({
          try: () => call(present),
          catch: (cause) =>
            notificationError(operation, reasonOf(cause, NOTIFICATION_REJECTIONS, "Failed"), cause),
        }),
    }),
  );

/**
 * Shows a persistent notification through the {@link Registration}. It
 * outlives the page and the worker's current event; its clicks and closes
 * arrive as `notificationclick` / `notificationclose` events in the worker
 * (see {@link notificationClickListener}). Inside a listener built here,
 * keep the worker alive until it is shown by yielding it from the handler.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Registration, showNotification } from "@thomasfosterau/effect-platform-service-worker/Notifications"
 *
 * const program = Effect.flip(showNotification("x").pipe(Effect.provideService(Registration, Option.none())))
 * Effect.runPromise(program).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category notifications
 */
export const showNotification = (
  title: string,
  options?: NotificationOptions,
): Effect.Effect<void, ShowNotificationError> =>
  withRegistration("show", (registration) => registration.showNotification(title, options));

/**
 * The registration's notifications still showing, optionally only those
 * with `tag` — to close them, or to fold a new message into one already
 * on screen.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { getNotifications, Registration } from "@thomasfosterau/effect-platform-service-worker/Notifications"
 *
 * const registration = {
 *   showNotification: async () => {},
 *   getNotifications: async () => [{ title: "Hi", tag: "chat", body: "", data: null, close: () => {} }],
 * }
 * const titles = await Effect.runPromise(
 *   getNotifications({ tag: "chat" }).pipe(
 *     Effect.map((shown) => shown.map((notification) => notification.title)),
 *     Effect.provideService(Registration, Option.some(registration)),
 *   ),
 * )
 * titles // ["Hi"]
 * ```
 *
 * @since 0.1.0
 * @category notifications
 */
export const getNotifications = (filter?: {
  readonly tag?: string;
}): Effect.Effect<ReadonlyArray<PersistentNotificationLike>, ShowNotificationError> =>
  withRegistration("get", (registration) =>
    registration.getNotifications(filter?.tag === undefined ? undefined : { tag: filter.tag }),
  );

const notificationListener =
  (kind: string) =>
  <S extends Schema.Constraint, Event extends NotificationEventLike, E, R>(
    schema: S,
    handle: (data: S["Type"], event: Event) => Effect.Effect<unknown, E, R>,
  ): Effect.Effect<(event: Event) => void, never, R | S["DecodingServices"]> =>
    decodedListener(
      schema,
      (event: Event) => Effect.succeed(event.notification.data),
      `service-worker: ${kind} dropped`,
      handle,
    );

/**
 * Turns `handle` into a `notificationclick` listener that decodes the
 * notification's `data` with `schema` first (it is whatever was passed to
 * {@link showNotification}, structured-cloned). A notification whose data
 * fails to decode is logged at `Warning` and dropped; a decoded one runs
 * `handle` inside `waitUntil`, as `Events.extendableListener` does — the
 * place to focus or open a window. Pass `Schema.Unknown` to skip decoding.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { notificationClickListener } from "@thomasfosterau/effect-platform-service-worker/Notifications"
 *
 * const Chat = Schema.Struct({ room: Schema.String })
 * const opened: Array<string> = []
 *
 * // In a worker: `self.addEventListener("notificationclick", onClick)`, and
 * // `handle` would call `clients.openWindow`.
 * const onClick = Effect.runSync(
 *   notificationClickListener(Chat, (data, event) =>
 *     Effect.sync(() => {
 *       event.notification.close()
 *       opened.push(data.room)
 *     }),
 *   ),
 * )
 *
 * const pending: Array<Promise<unknown>> = []
 * onClick({
 *   notification: { title: "New message", tag: "", body: "", data: { room: "general" }, close: () => {} },
 *   action: "",
 *   waitUntil: (promise) => { pending.push(promise) },
 * })
 * await Promise.all(pending)
 * opened // ["general"]
 * ```
 *
 * @since 0.1.0
 * @category listeners
 */
export const notificationClickListener = notificationListener("notificationclick");

/**
 * Turns `handle` into a `notificationclose` listener (the user dismissed a
 * notification), decoding its `data` with `schema` as
 * {@link notificationClickListener} does.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { notificationCloseListener } from "@thomasfosterau/effect-platform-service-worker/Notifications"
 *
 * const dismissed: Array<unknown> = []
 * const onClose = Effect.runSync(
 *   notificationCloseListener(Schema.Unknown, (data) => Effect.sync(() => dismissed.push(data))),
 * )
 *
 * const pending: Array<Promise<unknown>> = []
 * onClose({
 *   notification: { title: "Reminder", tag: "", body: "", data: 7, close: () => {} },
 *   waitUntil: (promise) => { pending.push(promise) },
 * })
 * await Promise.all(pending)
 * dismissed // [7]
 * ```
 *
 * @since 0.1.0
 * @category listeners
 */
export const notificationCloseListener = notificationListener("notificationclose");
