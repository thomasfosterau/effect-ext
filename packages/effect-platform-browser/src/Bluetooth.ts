/**
 * Web Bluetooth (`navigator.bluetooth`) as an Effect service: the device
 * picker, the devices the page may reconnect to, the adapter's availability,
 * and a scoped GATT connection to read, write and subscribe to a device's
 * characteristics.
 *
 * Only Chromium has it, and only in a window (no worker), so this is its own
 * service here rather than in `effect-platform-worker-shared`.
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { reasonOf } from "./internal/dom.ts";
import { ambientBluetooth } from "./internal/globals.ts";

/**
 * A service or characteristic UUID: a full 128-bit UUID string, a 16- or
 * 32-bit alias as a number (`0x180f`), or a name the agent knows
 * (`"battery_service"`).
 *
 * @since 0.1.0
 * @category models
 */
export type Uuid = string | number;

/**
 * A 16- or 32-bit alias as its full 128-bit UUID, on the Bluetooth base UUID,
 * as `BluetoothUUID.canonicalUUID` does; a string, lowercased.
 *
 * @example
 * ```ts
 * import { Bluetooth } from "@thomasfosterau/effect-platform-browser"
 *
 * console.log(Bluetooth.canonicalUuid(0x180f)) // "0000180f-0000-1000-8000-00805f9b34fb"
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export const canonicalUuid = (uuid: Uuid): string =>
  P.isNumber(uuid)
    ? `${(uuid >>> 0).toString(16).padStart(8, "0")}-0000-1000-8000-00805f9b34fb`
    : uuid.toLowerCase();

/**
 * Data a device advertises that a filter matches on: the bytes must start
 * with `dataPrefix`, compared under `mask` where one is given.
 *
 * @since 0.1.0
 * @category models
 */
export interface DataFilter {
  readonly dataPrefix?: Uint8Array<ArrayBuffer>;
  readonly mask?: Uint8Array<ArrayBuffer>;
}

/**
 * A device the picker offers: one that matches every member given.
 *
 * @since 0.1.0
 * @category models
 */
export interface ScanFilter {
  readonly services?: ReadonlyArray<Uuid>;
  readonly name?: string;
  readonly namePrefix?: string;
  readonly manufacturerData?: ReadonlyArray<DataFilter & { readonly companyIdentifier: number }>;
  readonly serviceData?: ReadonlyArray<DataFilter & { readonly service: Uuid }>;
}

/**
 * What the picker offers: devices matching any of `filters` (less any
 * matching `exclusionFilters`), or every device in range with
 * `acceptAllDevices`. A connection reaches only the services named in a
 * filter or in `optionalServices`.
 *
 * @since 0.1.0
 * @category models
 */
export type RequestOptions = {
  readonly optionalServices?: ReadonlyArray<Uuid>;
  readonly optionalManufacturerData?: ReadonlyArray<number>;
} & (
  | {
      readonly filters: ReadonlyArray<ScanFilter>;
      readonly exclusionFilters?: ReadonlyArray<ScanFilter>;
    }
  | { readonly acceptAllDevices: true }
);

/**
 * The structural slice of a `BluetoothRemoteGATTCharacteristic` this module
 * calls; it fires `characteristicvaluechanged` with the new `value`.
 *
 * @since 0.1.0
 * @category models
 */
export interface CharacteristicLike extends Stream.EventListener {
  readonly uuid: string;
  readonly value?: DataView | undefined;
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: Uint8Array<ArrayBuffer>): Promise<void>;
  writeValueWithoutResponse(value: Uint8Array<ArrayBuffer>): Promise<void>;
  startNotifications(): Promise<CharacteristicLike>;
  stopNotifications(): Promise<CharacteristicLike>;
}

/**
 * The structural slice of a `BluetoothRemoteGATTService` this module calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface ServiceLike {
  readonly uuid: string;
  getCharacteristic(characteristic: Uuid): Promise<CharacteristicLike>;
}

/**
 * The structural slice of a `BluetoothRemoteGATTServer` this module calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface GattServerLike {
  readonly connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
  getPrimaryService(service: Uuid): Promise<ServiceLike>;
}

/**
 * The structural slice of a `BluetoothDevice` this module reads; it fires
 * `gattserverdisconnected` when its link drops. `gatt` is missing where the
 * page may not reach the device's GATT server.
 *
 * @since 0.1.0
 * @category models
 */
export interface BluetoothDeviceLike extends Stream.EventListener {
  readonly id: string;
  readonly name?: string | undefined;
  readonly gatt?: GattServerLike | undefined;
}

/**
 * The structural slice of `navigator.bluetooth` this module calls; it fires
 * `availabilitychanged` with the new `value`. `getDevices` is missing where
 * the agent has no persistent permissions.
 *
 * @since 0.1.0
 * @category models
 */
export interface BluetoothLike extends Stream.EventListener {
  getAvailability(): Promise<boolean>;
  requestDevice(options: RequestOptions): Promise<BluetoothDeviceLike>;
  readonly getDevices?: () => Promise<ReadonlyArray<BluetoothDeviceLike>>;
}

/**
 * Why a Bluetooth call failed.
 *
 * - `Unsupported` — the agent has no Web Bluetooth, or no `getDevices`.
 * - `NotFound` — the user closed the picker, or the device has no such
 *   service or characteristic.
 * - `NotAllowed` — no user gesture, a blocked UUID, a service not named in
 *   the request, or a permissions policy.
 * - `NotSupported` — the characteristic does not allow the operation.
 * - `InvalidState` — the device refused it in its current state.
 * - `Disconnected` — the device's link dropped.
 * - `Closed` — the connection's scope has closed.
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.1.0
 * @category errors
 */
export type BluetoothErrorReason =
  | "Unsupported"
  | "NotFound"
  | "NotAllowed"
  | "NotSupported"
  | "InvalidState"
  | "Disconnected"
  | "Closed"
  | "Failed";

/**
 * A Bluetooth call failed. `operation` names it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Bluetooth } from "@thomasfosterau/effect-platform-browser"
 *
 * Effect.runPromise(Effect.flip(Bluetooth.make().devices)).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class BluetoothError extends Schema.TaggedError<
  BluetoothError,
  { readonly brand: unique symbol }
>()("BluetoothError", {
  operation: Schema.Literals([
    "request",
    "devices",
    "connect",
    "service",
    "characteristic",
    "read",
    "write",
    "notifications",
  ]),
  reason: Schema.Literals([
    "Unsupported",
    "NotFound",
    "NotAllowed",
    "NotSupported",
    "InvalidState",
    "Disconnected",
    "Closed",
    "Failed",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

type Operation = BluetoothError["operation"];

const REASONS = {
  NotFoundError: "NotFound",
  SecurityError: "NotAllowed",
  NotAllowedError: "NotAllowed",
  NotSupportedError: "NotSupported",
  InvalidStateError: "InvalidState",
  NetworkError: "Disconnected",
} satisfies Readonly<Record<string, BluetoothErrorReason>>;

const failure = (
  operation: Operation,
  reason: BluetoothErrorReason,
  cause: unknown,
): BluetoothError =>
  new BluetoothError({ operation, reason, cause, message: `bluetooth ${operation}: ${reason}` });

const attempt = <A>(
  operation: Operation,
  call: () => Promise<A>,
): Effect.Effect<A, BluetoothError> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => failure(operation, reasonOf(cause, REASONS, "Failed"), cause),
  });

const bytesOf = (view: DataView): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));

/**
 * A characteristic of a connected device:
 *
 * - `read` — reads its value.
 * - `write(data, { response })` — writes a value, waiting for the device's
 *   acknowledgement unless `response` is `false`.
 * - `notifications` — each value the device notifies or indicates, from when
 *   the stream starts; ending the stream stops notifications. Run one such
 *   stream per characteristic: stopping is the characteristic's, not the
 *   stream's. It fails `Disconnected` when the link drops and ends when the
 *   connection's scope closes.
 *
 * @since 0.1.0
 * @category models
 */
export interface Characteristic {
  readonly uuid: string;
  readonly read: Effect.Effect<Uint8Array<ArrayBuffer>, BluetoothError>;
  readonly write: (
    data: Uint8Array<ArrayBuffer>,
    options?: { readonly response?: boolean },
  ) => Effect.Effect<void, BluetoothError>;
  readonly notifications: Stream.Stream<Uint8Array<ArrayBuffer>, BluetoothError>;
}

/**
 * A primary service of a connected device; `characteristic(uuid)` finds one
 * of its characteristics.
 *
 * @since 0.1.0
 * @category models
 */
export interface Service {
  readonly uuid: string;
  readonly characteristic: (uuid: Uuid) => Effect.Effect<Characteristic, BluetoothError>;
}

/**
 * A GATT connection, for as long as its scope:
 *
 * - `connected` — whether the link is up.
 * - `service(uuid)` — finds a primary service the request allowed.
 *
 * Every call fails `Disconnected` once the link drops (the device's
 * `gattserverdisconnected`), and `Closed` once the scope has closed;
 * closing it disconnects the device, for every connection to it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Connection {
  readonly device: BluetoothDeviceLike;
  readonly connected: Effect.Effect<boolean>;
  readonly service: (uuid: Uuid) => Effect.Effect<Service, BluetoothError>;
}

/**
 * The Web Bluetooth service. Provide {@link layer} in a page, or
 * `TestBluetooth.layer` from `@thomasfosterau/effect-platform-browser/BrowserTesting` in tests.
 *
 * - `supported` — whether the agent has Web Bluetooth, and `getDevices`.
 * - `request(options)` — shows the picker (from a user gesture) and returns
 *   the device the user chose; `NotFound` when they close it.
 * - `devices` — the devices the page may reconnect to without the picker.
 * - `availability` — whether the agent has a Bluetooth adapter now, then
 *   each change; `false` alone where the API is missing.
 * - `connect(device)` — a {@link Connection} for the scope.
 *
 * @since 0.1.0
 * @category services
 */
export class Bluetooth extends Context.Service<
  Bluetooth,
  {
    readonly supported: { readonly bluetooth: boolean; readonly devices: boolean };
    readonly request: (
      options: RequestOptions,
    ) => Effect.Effect<BluetoothDeviceLike, BluetoothError>;
    readonly devices: Effect.Effect<ReadonlyArray<BluetoothDeviceLike>, BluetoothError>;
    readonly availability: Stream.Stream<boolean>;
    readonly connect: (
      device: BluetoothDeviceLike,
    ) => Effect.Effect<Connection, BluetoothError, Scope.Scope>;
  }
>()("@thomasfosterau/effect-platform-browser/Bluetooth") {}

/** An `availabilitychanged` event's `value`. */
const availableIn = (event: unknown): boolean =>
  P.hasProperty(event, "value") && event.value === true;

/** The adapter's availability now, then each `availabilitychanged`. */
const availabilityOf = (bluetooth: BluetoothLike): Stream.Stream<boolean> =>
  Stream.callback<boolean>(
    (queue) => {
      // An event that lands before `getAvailability()` settles is newer than its answer.
      const state = { changed: false };
      const onChange = (event: unknown): void => {
        state.changed = true;
        Queue.offerUnsafe(queue, availableIn(event));
      };
      return Effect.andThen(
        Effect.acquireRelease(
          Effect.sync(() => bluetooth.addEventListener("availabilitychanged", onChange)),
          () => Effect.sync(() => bluetooth.removeEventListener("availabilitychanged", onChange)),
        ),
        Effect.match(
          Effect.tryPromise({ try: () => bluetooth.getAvailability(), catch: () => false }),
          {
            onFailure: () => false,
            onSuccess: (available) => available,
          },
        ).pipe(
          Effect.map((available) => {
            if (!state.changed) Queue.offerUnsafe(queue, available);
          }),
        ),
      );
    },
    { bufferSize: 16, strategy: "sliding" },
  ).pipe(Stream.changes);

interface ConnectionState {
  closed: boolean;
  lost: boolean;
}

const guard = <A>(
  state: ConnectionState,
  operation: Operation,
  run: () => Promise<A>,
): Effect.Effect<A, BluetoothError> =>
  Effect.suspend(() =>
    state.closed
      ? Effect.fail(failure(operation, "Closed", undefined))
      : state.lost
        ? Effect.fail(failure(operation, "Disconnected", undefined))
        : attempt(operation, run),
  );

/**
 * Each value `characteristic` notifies, from when the stream starts: it
 * fails `Disconnected` when `device`'s link drops, and ends once `closing`
 * completes.
 */
const notificationsOf = (
  device: BluetoothDeviceLike,
  characteristic: CharacteristicLike,
  state: ConnectionState,
  closing: Deferred.Deferred<void>,
): Stream.Stream<Uint8Array<ArrayBuffer>, BluetoothError> =>
  Stream.callback<Uint8Array<ArrayBuffer>, BluetoothError>((queue) => {
    const onValue = (): void => {
      Option.map(Option.fromUndefinedOr(characteristic.value), (value) =>
        Queue.offerUnsafe(queue, bytesOf(value)),
      );
    };
    // Closing the scope disconnects too: that ends the stream rather than failing it.
    const onLost = (): void => {
      if (state.closed) Queue.endUnsafe(queue);
      else
        Queue.failCauseUnsafe(
          queue,
          Cause.fail(failure("notifications", "Disconnected", undefined)),
        );
    };
    return Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          characteristic.addEventListener("characteristicvaluechanged", onValue);
          device.addEventListener("gattserverdisconnected", onLost);
        }),
        () =>
          Effect.sync(() => {
            characteristic.removeEventListener("characteristicvaluechanged", onValue);
            device.removeEventListener("gattserverdisconnected", onLost);
          }),
      );
      yield* Effect.acquireRelease(
        guard(state, "notifications", () => characteristic.startNotifications()),
        () =>
          state.closed || state.lost
            ? Effect.void
            : Effect.ignore(attempt("notifications", () => characteristic.stopNotifications())),
      );
      yield* Effect.forkScoped(Effect.andThen(Deferred.await(closing), Queue.end(queue)));
    });
  });

const characteristicOf = (
  device: BluetoothDeviceLike,
  characteristic: CharacteristicLike,
  state: ConnectionState,
  closing: Deferred.Deferred<void>,
): Characteristic => ({
  uuid: characteristic.uuid,
  read: Effect.map(
    guard(state, "read", () => characteristic.readValue()),
    bytesOf,
  ),
  write: (data, options) =>
    guard(state, "write", () =>
      (options?.response ?? true)
        ? characteristic.writeValueWithResponse(data)
        : characteristic.writeValueWithoutResponse(data),
    ),
  notifications: notificationsOf(device, characteristic, state, closing),
});

const connectDevice = Effect.fn("Bluetooth.connect")(function* (device: BluetoothDeviceLike) {
  const gatt = yield* Effect.mapError(Effect.fromOption(Option.fromUndefinedOr(device.gatt)), () =>
    failure("connect", "NotAllowed", undefined),
  );
  const closing = yield* Deferred.make<void>();
  const state: ConnectionState = { closed: false, lost: false };
  const onLost = (): void => {
    state.lost = true;
  };
  yield* Effect.acquireRelease(
    Effect.andThen(
      attempt("connect", () => gatt.connect()),
      Effect.sync(() => device.addEventListener("gattserverdisconnected", onLost)),
    ),
    () =>
      Effect.andThen(
        Effect.sync(() => {
          state.closed = true;
          device.removeEventListener("gattserverdisconnected", onLost);
        }),
        Effect.andThen(
          Deferred.succeed(closing, undefined),
          Effect.sync(() => gatt.disconnect()),
        ),
      ),
  );
  return {
    device,
    connected: Effect.sync(() => !state.closed && !state.lost && gatt.connected),
    service: (uuid) =>
      Effect.map(
        guard(state, "service", () => gatt.getPrimaryService(uuid)),
        (service): Service => ({
          uuid: service.uuid,
          characteristic: (characteristic) =>
            Effect.map(
              guard(state, "characteristic", () => service.getCharacteristic(characteristic)),
              (found) => characteristicOf(device, found, state, closing),
            ),
        }),
      ),
  } satisfies Connection;
});

/**
 * Builds the {@link Bluetooth} service over a `navigator.bluetooth`;
 * `undefined` builds the unsupported service. {@link layer} passes the
 * ambient one.
 *
 * @example
 * ```ts
 * import * as Stream from "effect/Stream"
 * import * as Effect from "effect/Effect"
 * import { Bluetooth } from "@thomasfosterau/effect-platform-browser"
 *
 * const bluetooth = Bluetooth.make()
 * Effect.runPromise(Stream.runCollect(bluetooth.availability)).then(console.log) // [false]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (bluetooth?: BluetoothLike): Bluetooth["Service"] =>
  Option.match(Option.fromUndefinedOr(bluetooth), {
    onNone: () =>
      Bluetooth.of({
        supported: { bluetooth: false, devices: false },
        request: () => Effect.fail(failure("request", "Unsupported", undefined)),
        devices: Effect.fail(failure("devices", "Unsupported", undefined)),
        availability: Stream.make(false),
        connect: () => Effect.fail(failure("connect", "Unsupported", undefined)),
      }),
    onSome: (self) =>
      Bluetooth.of({
        supported: { bluetooth: true, devices: self.getDevices !== undefined },
        request: (options) => attempt("request", () => self.requestDevice(options)),
        devices: Option.match(Option.fromUndefinedOr(self.getDevices), {
          onNone: () => Effect.fail(failure("devices", "Unsupported", undefined)),
          onSome: (getDevices) => attempt("devices", () => getDevices.call(self)),
        }),
        availability: availabilityOf(self),
        connect: connectDevice,
      }),
  });

/**
 * The {@link Bluetooth} service over the ambient `navigator.bluetooth`;
 * reports `supported: false` where there is none — Firefox, Safari, a
 * worker, Node.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Bluetooth } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.map(Bluetooth.Bluetooth, (bluetooth) => bluetooth.supported)
 * Effect.runPromise(Effect.provide(program, Bluetooth.layer)).then(console.log)
 * // { bluetooth: false, devices: false } under Node
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<Bluetooth> = Layer.sync(Bluetooth, () =>
  make(Option.getOrUndefined(ambientBluetooth())),
);

/**
 * Shows the device picker, from a user gesture, and returns the device the
 * user chose; fails `NotFound` when they close it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Bluetooth } from "@thomasfosterau/effect-platform-browser"
 * import { TestBluetooth } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestBluetooth.Control
 *   yield* control.pick(yield* control.add({ name: "Heart rate" }))
 *   const device = yield* Bluetooth.request({ filters: [{ services: [0x180d] }] })
 *   return device.name
 * })
 * Effect.runPromise(Effect.provide(program, TestBluetooth.layer())).then(console.log) // "Heart rate"
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const request = (
  options: RequestOptions,
): Effect.Effect<BluetoothDeviceLike, BluetoothError, Bluetooth> =>
  Effect.flatMap(Bluetooth, (bluetooth) => bluetooth.request(options));

/**
 * The devices the page may reconnect to without the picker.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Bluetooth } from "@thomasfosterau/effect-platform-browser"
 * import { TestBluetooth } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestBluetooth.Control
 *   yield* control.add({ name: "Scale" })
 *   return (yield* Bluetooth.devices).map((device) => device.name)
 * })
 * Effect.runPromise(Effect.provide(program, TestBluetooth.layer())).then(console.log) // ["Scale"]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const devices: Effect.Effect<
  ReadonlyArray<BluetoothDeviceLike>,
  BluetoothError,
  Bluetooth
> = Effect.flatMap(Bluetooth, (bluetooth) => bluetooth.devices);

/**
 * Whether the agent has a Bluetooth adapter now, then each change.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Bluetooth } from "@thomasfosterau/effect-platform-browser"
 * import { TestBluetooth } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Stream.runCollect(Stream.take(Bluetooth.availability, 1))
 * Effect.runPromise(Effect.provide(program, TestBluetooth.layer())).then(console.log) // [true]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const availability: Stream.Stream<boolean, never, Bluetooth> = Stream.unwrap(
  Effect.map(Bluetooth, (bluetooth) => bluetooth.availability),
);

/**
 * Connects to `device`'s GATT server for the scope; closing the scope
 * disconnects it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Bluetooth } from "@thomasfosterau/effect-platform-browser"
 * import { TestBluetooth } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestBluetooth.Control
 *   const device = yield* control.add({
 *     services: [{ uuid: 0x180f, characteristics: [{ uuid: 0x2a19, value: new Uint8Array([87]) }] }],
 *   })
 *   const connection = yield* Bluetooth.connect(device)
 *   const battery = yield* connection.service(0x180f)
 *   const level = yield* battery.characteristic(0x2a19)
 *   return (yield* level.read)[0]
 * })
 * Effect.runPromise(Effect.provide(Effect.scoped(program), TestBluetooth.layer())).then(console.log) // 87
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const connect = (
  device: BluetoothDeviceLike,
): Effect.Effect<Connection, BluetoothError, Bluetooth | Scope.Scope> =>
  Effect.flatMap(Bluetooth, (bluetooth) => bluetooth.connect(device));
