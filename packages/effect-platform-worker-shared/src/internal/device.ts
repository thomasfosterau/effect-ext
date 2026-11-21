/**
 * What the device APIs (Web Serial, WebUSB, WebHID, Web Bluetooth) share: a
 * manager that fires `connect` and `disconnect` with the device as the
 * event's `target`, a picker and a list of granted devices that reject with
 * `DOMException`s, mapped onto reasons by name.
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/**
 * A device plugged in (or newly granted) or unplugged.
 *
 * @since 0.1.0
 * @category models
 */
export interface DeviceEvent<Device> {
  readonly type: "connect" | "disconnect";
  readonly device: Device;
}

/** A device API's manager (`navigator.serial`, …), as far as its connection events go. */
export interface DeviceManagerLike<Device> {
  addEventListener(
    type: string,
    listener: (event: { readonly target: Device | null }) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: { readonly target: Device | null }) => void,
  ): void;
}

/** Each `connect` and `disconnect` the manager fires, from when the stream starts. */
export const connections = <Device>(
  manager: DeviceManagerLike<Device>,
): Stream.Stream<DeviceEvent<Device>> =>
  Stream.callback<DeviceEvent<Device>>((queue) => {
    const on =
      (type: DeviceEvent<Device>["type"]) =>
      (event: { readonly target: Device | null }): void => {
        Option.map(Option.fromNullishOr(event.target), (device) =>
          Queue.offerUnsafe(queue, { type, device }),
        );
      };
    return Effect.acquireRelease(
      Effect.sync(() => {
        const listeners = { connect: on("connect"), disconnect: on("disconnect") };
        manager.addEventListener("connect", listeners.connect);
        manager.addEventListener("disconnect", listeners.disconnect);
        return listeners;
      }),
      (listeners) =>
        Effect.sync(() => {
          manager.removeEventListener("connect", listeners.connect);
          manager.removeEventListener("disconnect", listeners.disconnect);
        }),
    );
  });

/** The `DOMException` names every device API rejects with, onto the reasons they share. */
export const COMMON_REASONS = {
  NotFoundError: "NotFound",
  SecurityError: "NotAllowed",
  NotAllowedError: "NotAllowed",
  InvalidStateError: "InvalidState",
  NetworkError: "Network",
  AbortError: "Aborted",
} as const;

/** The reason `table` gives a rejection's `name`, read structurally; `fallback` for anything else. */
export const reasonOf = <Reason extends string>(
  cause: unknown,
  table: Readonly<Partial<Record<string, Reason>>>,
  fallback: Reason,
): Reason =>
  P.hasProperty(cause, "name") && P.isString(cause.name)
    ? (table[cause.name] ?? fallback)
    : fallback;
