/**
 * In-memory Bluetooth devices for tests of code that uses `Bluetooth`:
 * {@link layer} provides the real adapter over an in-memory
 * `navigator.bluetooth`, plus {@link Control}, which adds devices, answers
 * the picker, drops links, pushes notifications and flips the adapter's
 * availability. Each {@link TestBluetoothDevice} carries a GATT tree whose
 * characteristics answer reads and record writes.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  Bluetooth,
  type BluetoothLike,
  canonicalUuid,
  type CharacteristicLike,
  type GattServerLike,
  make as makeBluetooth,
  type RequestOptions,
  type ServiceLike,
  type Uuid,
} from "../Bluetooth.ts";

/**
 * The in-memory API's setup: `supported` (default `true`) builds the
 * service without Web Bluetooth when `false`; `getDevices` (default `true`)
 * leaves it out when `false`; `available` (default `true`) is whether the
 * agent has an adapter.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
  readonly getDevices?: boolean;
  readonly available?: boolean;
}

/**
 * A characteristic in a device's GATT tree: its `uuid`, its starting
 * `value`, and which operations it allows (each default `true`).
 *
 * @since 0.1.0
 * @category models
 */
export interface CharacteristicInfo {
  readonly uuid: Uuid;
  readonly value?: Uint8Array;
  readonly read?: boolean;
  readonly write?: boolean;
  readonly notify?: boolean;
}

/**
 * A primary service in a device's GATT tree.
 *
 * @since 0.1.0
 * @category models
 */
export interface ServiceInfo {
  readonly uuid: Uuid;
  readonly characteristics?: ReadonlyArray<CharacteristicInfo>;
}

/**
 * Adds a device: its `id` (default a fresh one), `name`, GATT `services`,
 * and whether the page may reconnect to it already (`granted`, default
 * `true`).
 *
 * @since 0.1.0
 * @category models
 */
export interface DeviceOptions {
  readonly id?: string;
  readonly name?: string;
  readonly services?: ReadonlyArray<ServiceInfo>;
  readonly granted?: boolean;
}

/**
 * A value written to a characteristic, and whether the write asked for the
 * device's acknowledgement.
 *
 * @since 0.1.0
 * @category models
 */
export interface Written {
  readonly data: Uint8Array;
  readonly response: boolean;
}

const rejection = (name: string, message: string): Promise<never> =>
  Promise.reject(new DOMException(message, name));

/**
 * An in-memory characteristic: `readValue` answers its `value`, writes are
 * recorded in `written`, and {@link TestCharacteristic.notify} fires
 * `characteristicvaluechanged` while notifications are on. An operation it
 * does not allow rejects `NotSupportedError`; one while its device is
 * disconnected rejects `NetworkError`.
 *
 * @since 0.1.0
 * @category models
 */
export class TestCharacteristic extends EventTarget implements CharacteristicLike {
  readonly uuid: string;
  readonly #info: CharacteristicInfo;
  readonly #server: TestGattServer;
  readonly #written: Array<Written> = [];
  #value: Option.Option<DataView>;
  #notifying = false;

  constructor(info: CharacteristicInfo, server: TestGattServer) {
    super();
    this.uuid = canonicalUuid(info.uuid);
    this.#info = info;
    this.#server = server;
    this.#value = Option.map(Option.fromUndefinedOr(info.value), toView);
  }

  get value(): DataView | undefined {
    return Option.getOrUndefined(this.#value);
  }
  /** Whether notifications are on. */
  get notifying(): boolean {
    return this.#notifying;
  }
  /** Every value written, in order. */
  get written(): ReadonlyArray<Written> {
    return this.#written;
  }

  readValue(): Promise<DataView> {
    return this.#allowed(this.#info.read ?? true, () =>
      Promise.resolve(Option.getOrElse(this.#value, () => new DataView(new ArrayBuffer(0)))),
    );
  }

  writeValueWithResponse(value: Uint8Array<ArrayBuffer>): Promise<void> {
    return this.#write(value, true);
  }

  writeValueWithoutResponse(value: Uint8Array<ArrayBuffer>): Promise<void> {
    return this.#write(value, false);
  }

  startNotifications(): Promise<this> {
    return this.#allowed(this.#info.notify ?? true, () => {
      this.#notifying = true;
      return Promise.resolve(this);
    });
  }

  stopNotifications(): Promise<this> {
    return this.#allowed(this.#info.notify ?? true, () => {
      this.#notifying = false;
      return Promise.resolve(this);
    });
  }

  /** A new value from the device: what reads answer, and a notification while they are on. */
  notify(data: Uint8Array): void {
    this.#value = Option.some(toView(data));
    if (this.#notifying) this.dispatchEvent(new Event("characteristicvaluechanged"));
  }

  /** The link dropped: notifications are off. */
  reset(): void {
    this.#notifying = false;
  }

  #write(value: Uint8Array, response: boolean): Promise<void> {
    return this.#allowed(this.#info.write ?? true, () => {
      this.#written.push({ data: value.slice(), response });
      this.#value = Option.some(toView(value));
      return Promise.resolve();
    });
  }

  #allowed<A>(allowed: boolean, run: () => Promise<A>): Promise<A> {
    if (!this.#server.connected) return rejection("NetworkError", "the device is not connected");
    if (!allowed) return rejection("NotSupportedError", "not allowed by the device");
    return run();
  }
}

const toView = (data: Uint8Array): DataView => new DataView(data.slice().buffer);

/**
 * An in-memory primary service.
 *
 * @since 0.1.0
 * @category models
 */
export class TestService implements ServiceLike {
  readonly uuid: string;
  readonly characteristics: ReadonlyArray<TestCharacteristic>;
  readonly #server: TestGattServer;

  constructor(info: ServiceInfo, server: TestGattServer) {
    this.uuid = canonicalUuid(info.uuid);
    this.#server = server;
    this.characteristics = Arr.map(
      info.characteristics ?? [],
      (characteristic) => new TestCharacteristic(characteristic, server),
    );
  }

  getCharacteristic(characteristic: Uuid): Promise<CharacteristicLike> {
    if (!this.#server.connected) return rejection("NetworkError", "the device is not connected");
    const uuid = canonicalUuid(characteristic);
    return Option.match(
      Arr.findFirst(this.characteristics, (entry) => entry.uuid === uuid),
      {
        onNone: () => rejection("NotFoundError", `no characteristic ${uuid}`),
        onSome: (found) => Promise.resolve(found),
      },
    );
  }
}

/**
 * An in-memory GATT server: `connect` rejects `NetworkError` while the
 * device is out of range, and `disconnect` (or a dropped link) fires the
 * device's `gattserverdisconnected`.
 *
 * @since 0.1.0
 * @category models
 */
export class TestGattServer implements GattServerLike {
  readonly services: ReadonlyArray<TestService>;
  readonly #device: TestBluetoothDevice;
  #connected = false;
  #inRange = true;

  constructor(services: ReadonlyArray<ServiceInfo>, device: TestBluetoothDevice) {
    this.#device = device;
    this.services = Arr.map(services, (service) => new TestService(service, this));
  }

  get connected(): boolean {
    return this.#connected;
  }

  connect(): Promise<this> {
    if (!this.#inRange) return rejection("NetworkError", "the device is out of range");
    this.#connected = true;
    return Promise.resolve(this);
  }

  disconnect(): void {
    if (!this.#connected) return;
    this.#connected = false;
    Arr.forEach(this.services, (service) =>
      Arr.forEach(service.characteristics, (characteristic) => characteristic.reset()),
    );
    this.#device.dispatchEvent(new Event("gattserverdisconnected"));
  }

  getPrimaryService(service: Uuid): Promise<ServiceLike> {
    if (!this.#connected) return rejection("NetworkError", "the device is not connected");
    const uuid = canonicalUuid(service);
    return Option.match(
      Arr.findFirst(this.services, (entry) => entry.uuid === uuid),
      {
        onNone: () => rejection("NotFoundError", `no service ${uuid}`),
        onSome: (found) => Promise.resolve(found),
      },
    );
  }

  /** Moves the device in or out of range; out of range drops the link. */
  setInRange(inRange: boolean): void {
    this.#inRange = inRange;
    if (!inRange) this.disconnect();
  }
}

/**
 * An in-memory device and its GATT tree.
 *
 * @since 0.1.0
 * @category models
 */
export class TestBluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name: string | undefined;
  readonly gatt: TestGattServer;

  constructor(id: string, options: DeviceOptions) {
    super();
    this.id = id;
    this.name = options.name;
    this.gatt = new TestGattServer(options.services ?? [], this);
  }

  /** The characteristic `characteristic` of the service `service`, where the tree has it. */
  characteristic(service: Uuid, characteristic: Uuid): Option.Option<TestCharacteristic> {
    return Option.flatMap(
      Arr.findFirst(this.gatt.services, (entry) => entry.uuid === canonicalUuid(service)),
      (found) =>
        Arr.findFirst(
          found.characteristics,
          (entry) => entry.uuid === canonicalUuid(characteristic),
        ),
    );
  }
}

/**
 * Drives the in-memory API:
 *
 * - `add(options?)` adds a device in range and returns it.
 * - `pick(device)` is what the user chooses in the next picker; with
 *   nothing picked, the picker is closed (`NotFoundError`). Choosing grants
 *   it.
 * - `requests` lists the options each picker was opened with.
 * - `setInRange(device, inRange)` moves a device out of range (dropping its
 *   link: `gattserverdisconnected`) or back.
 * - `notify(device, service, characteristic, data)` pushes a value from the
 *   device.
 * - `setAvailable(available)` adds or removes the adapter
 *   (`availabilitychanged`).
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly add: (options?: DeviceOptions) => Effect.Effect<TestBluetoothDevice>;
    readonly pick: (device: TestBluetoothDevice) => Effect.Effect<void>;
    readonly requests: Effect.Effect<ReadonlyArray<RequestOptions>>;
    readonly setInRange: (device: TestBluetoothDevice, inRange: boolean) => Effect.Effect<void>;
    readonly notify: (
      device: TestBluetoothDevice,
      service: Uuid,
      characteristic: Uuid,
      data: Uint8Array,
    ) => Effect.Effect<void>;
    readonly setAvailable: (available: boolean) => Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/BluetoothControl") {}

/**
 * What {@link make} builds: the `Bluetooth` service over the in-memory API,
 * and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly bluetooth: Bluetooth["Service"];
  readonly control: Control["Service"];
}

class TestBluetoothApi extends EventTarget {
  available: boolean;
  constructor(available: boolean) {
    super();
    this.available = available;
  }
  setAvailable(available: boolean): void {
    if (available === this.available) return;
    this.available = available;
    this.dispatchEvent(Object.assign(new Event("availabilitychanged"), { value: available }));
  }
}

/**
 * Builds an in-memory `navigator.bluetooth`: the `Bluetooth` service over
 * it, and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestBluetooth } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { bluetooth, control } = TestBluetooth.make()
 * const program = Effect.gen(function* () {
 *   yield* control.add({ name: "Thermometer" })
 *   return (yield* bluetooth.devices).map((device) => device.name)
 * })
 * Effect.runPromise(program).then(console.log) // ["Thermometer"]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const granted: Array<TestBluetoothDevice> = [];
  const picks: Array<TestBluetoothDevice> = [];
  const requests: Array<RequestOptions> = [];
  const api = new TestBluetoothApi(options?.available ?? true);
  const state = { next: 0 };
  const grant = (device: TestBluetoothDevice): void => {
    if (!granted.includes(device)) granted.push(device);
  };

  const base: BluetoothLike = {
    addEventListener: (type, listener) => api.addEventListener(type, listener),
    removeEventListener: (type, listener) => api.removeEventListener(type, listener),
    getAvailability: () => Promise.resolve(api.available),
    requestDevice: (request) => {
      requests.push(request);
      return Option.match(Option.fromUndefinedOr(picks.shift()), {
        onNone: () => rejection("NotFoundError", "the user closed the picker"),
        onSome: (device) => {
          grant(device);
          return Promise.resolve(device);
        },
      });
    },
  };
  const withDevices: BluetoothLike = {
    ...base,
    getDevices: () => Promise.resolve([...granted]),
  };

  return {
    bluetooth: makeBluetooth(
      (options?.supported ?? true)
        ? (options?.getDevices ?? true)
          ? withDevices
          : base
        : undefined,
    ),
    control: Control.of({
      add: (add) =>
        Effect.sync(() => {
          state.next += 1;
          const device = new TestBluetoothDevice(add?.id ?? `device-${state.next}`, add ?? {});
          if (add?.granted ?? true) grant(device);
          return device;
        }),
      pick: (device) =>
        Effect.sync(() => {
          picks.push(device);
        }),
      requests: Effect.sync(() => [...requests]),
      setInRange: (device, inRange) => Effect.sync(() => device.gatt.setInRange(inRange)),
      notify: (device, service, characteristic, data) =>
        Effect.sync(() =>
          Option.map(device.characteristic(service, characteristic), (found) => found.notify(data)),
        ),
      setAvailable: (available) => Effect.sync(() => api.setAvailable(available)),
    }),
  };
};

/**
 * Provides `Bluetooth` over a fresh in-memory `navigator.bluetooth`, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Bluetooth } from "@thomasfosterau/effect-platform-browser"
 * import { TestBluetooth } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestBluetooth.Control
 *   const device = yield* control.add({
 *     services: [{ uuid: 0x1815, characteristics: [{ uuid: 0x2a56 }] }],
 *   })
 *   const connection = yield* Bluetooth.connect(device)
 *   const output = yield* Effect.flatMap(connection.service(0x1815), (service) =>
 *     service.characteristic(0x2a56),
 *   )
 *   yield* output.write(new Uint8Array([1]))
 *   return Option.map(device.characteristic(0x1815, 0x2a56), (found) => found.written.length)
 * })
 * Effect.runPromise(Effect.provide(Effect.scoped(program), TestBluetooth.layer())).then(console.log)
 * // { _id: "Option", _tag: "Some", value: 1 }
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Bluetooth | Control> =>
  Layer.syncContext(() => {
    const { bluetooth, control } = make(options);
    return Context.make(Bluetooth, bluetooth).pipe(Context.add(Control, control));
  });
