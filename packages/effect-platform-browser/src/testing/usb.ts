/**
 * In-memory USB devices for tests of code that uses `Usb` (from
 * `@thomasfosterau/effect-platform-worker-shared`): {@link layer} provides
 * the real adapter over an in-memory `navigator.usb`, plus {@link Control},
 * which plugs devices in and out and answers the picker; each
 * {@link TestUsbDevice} sends data on its IN endpoints, stalls them and
 * records what was written.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  type ControlTransferSetup,
  type InTransferResultLike,
  make as makeUsb,
  type OutTransferResultLike,
  type RequestOptions,
  Usb,
  type UsbDeviceLike,
  type UsbLike,
  type UsbService,
} from "@thomasfosterau/effect-platform-worker-shared/Usb";

/**
 * The in-memory API's setup: `supported` (default `true`) builds the
 * service without WebUSB when `false`; `picker` (default `true`) leaves out
 * `requestDevice`, as in a worker, when `false`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
  readonly picker?: boolean;
}

/**
 * A configuration a device offers, and its interface numbers.
 *
 * @since 0.1.0
 * @category models
 */
export interface Configuration {
  readonly configurationValue: number;
  readonly interfaces: ReadonlyArray<number>;
}

/**
 * What a device reports about itself, and its configurations (default one,
 * `1`, with interface `0`).
 *
 * @since 0.1.0
 * @category models
 */
export interface DeviceInfo {
  readonly vendorId?: number;
  readonly productId?: number;
  readonly productName?: string;
  readonly manufacturerName?: string;
  readonly serialNumber?: string;
  readonly configurations?: ReadonlyArray<Configuration>;
}

/**
 * Plugs a device in: its `info`, and whether the page has been granted it
 * already (`granted`, default `true`).
 *
 * @since 0.1.0
 * @category models
 */
export interface PlugOptions extends DeviceInfo {
  readonly granted?: boolean;
}

/**
 * A control transfer the device received: its setup, direction, and the
 * data of an OUT transfer.
 *
 * @since 0.1.0
 * @category models
 */
export interface ControlRecord {
  readonly setup: ControlTransferSetup;
  readonly direction: "in" | "out";
  readonly data: Option.Option<Uint8Array>;
}

/** A listener on the in-memory `navigator.usb`. */
type Listener = (event: { readonly target: UsbDeviceLike | null }) => void;

interface PendingIn {
  readonly endpoint: number;
  readonly length: number;
  readonly resolve: (result: InTransferResultLike) => void;
  readonly reject: (cause: DOMException) => void;
}

const rejection = (name: string, message: string): Promise<never> =>
  Promise.reject(new DOMException(message, name));

/** An IN result of `data`, cut to `length` and flagged `babble` when it did not fit. */
const delivered = (data: Uint8Array, length: number): InTransferResultLike => ({
  status: data.length > length ? "babble" : "ok",
  data: new DataView(data.slice(0, length).buffer),
});

/**
 * An in-memory device, following the platform's order: `open`, then
 * `selectConfiguration`, then `claimInterface`, before a bulk or interrupt
 * transfer; the control endpoint needs only `open`. A `transferIn` waits
 * for data `send` puts on its endpoint; `stall` halts an endpoint until
 * `clearHalt`; `close` aborts a waiting transfer and unplugging fails it
 * with `NetworkError`.
 *
 * @since 0.1.0
 * @category models
 */
export class TestUsbDevice implements UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string | undefined;
  readonly manufacturerName: string | undefined;
  readonly serialNumber: string | undefined;
  readonly #configurations: ReadonlyArray<Configuration>;
  readonly #written: Array<{ readonly endpoint: number; readonly data: Uint8Array }> = [];
  readonly #controls: Array<ControlRecord> = [];
  readonly #controlReplies: Array<Uint8Array> = [];
  readonly #queued: Array<{ readonly endpoint: number; readonly data: Uint8Array }> = [];
  readonly #halted: Array<number> = [];
  readonly #pending: Array<PendingIn> = [];
  #connected = true;
  #opened = false;
  #configuration = Option.none<Configuration>();
  #claimed: Array<number> = [];
  #alternates: Array<readonly [number, number]> = [];

  constructor(info: DeviceInfo) {
    this.vendorId = info.vendorId ?? 0;
    this.productId = info.productId ?? 0;
    this.productName = info.productName;
    this.manufacturerName = info.manufacturerName;
    this.serialNumber = info.serialNumber;
    this.#configurations = info.configurations ?? [{ configurationValue: 1, interfaces: [0] }];
  }

  /** Whether the device is open. */
  get opened(): boolean {
    return this.#opened;
  }
  /** The selected configuration's value, while one is. */
  get configuration(): Option.Option<number> {
    return Option.map(this.#configuration, (configuration) => configuration.configurationValue);
  }
  /** The claimed interfaces. */
  get claimed(): ReadonlyArray<number> {
    return this.#claimed;
  }
  /** Each alternate setting selected, as `[interface, alternate]`. */
  get alternates(): ReadonlyArray<readonly [number, number]> {
    return this.#alternates;
  }
  /** Every bulk or interrupt OUT transfer, in order. */
  get written(): ReadonlyArray<{ readonly endpoint: number; readonly data: Uint8Array }> {
    return this.#written;
  }
  /** Every control transfer, in order. */
  get controls(): ReadonlyArray<ControlRecord> {
    return this.#controls;
  }

  open(): Promise<void> {
    if (!this.#connected) return rejection("NetworkError", "the device is gone");
    this.#opened = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.#abort("AbortError");
    this.#opened = false;
    this.#configuration = Option.none();
    this.#claimed = [];
    return Promise.resolve();
  }

  selectConfiguration(configurationValue: number): Promise<void> {
    if (!this.#opened) return rejection("InvalidStateError", "the device is not open");
    return Option.match(
      Arr.findFirst(
        this.#configurations,
        (configuration) => configuration.configurationValue === configurationValue,
      ),
      {
        onNone: () => rejection("NotFoundError", `no configuration ${configurationValue}`),
        onSome: (configuration) => {
          this.#configuration = Option.some(configuration);
          this.#claimed = [];
          return Promise.resolve();
        },
      },
    );
  }

  claimInterface(interfaceNumber: number): Promise<void> {
    if (!this.#opened || Option.isNone(this.#configuration))
      return rejection("InvalidStateError", "no configuration is selected");
    if (!this.#configuration.value.interfaces.includes(interfaceNumber))
      return rejection("NotFoundError", `no interface ${interfaceNumber}`);
    if (!this.#claimed.includes(interfaceNumber)) this.#claimed.push(interfaceNumber);
    return Promise.resolve();
  }

  releaseInterface(interfaceNumber: number): Promise<void> {
    if (!this.#claimed.includes(interfaceNumber))
      return rejection("InvalidStateError", `interface ${interfaceNumber} is not claimed`);
    this.#claimed = this.#claimed.filter((claimed) => claimed !== interfaceNumber);
    return Promise.resolve();
  }

  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void> {
    if (!this.#claimed.includes(interfaceNumber))
      return rejection("InvalidStateError", `interface ${interfaceNumber} is not claimed`);
    this.#alternates.push([interfaceNumber, alternateSetting]);
    return Promise.resolve();
  }

  transferIn(endpointNumber: number, length: number): Promise<InTransferResultLike> {
    return this.#ready(true, () => {
      if (this.#halted.includes(endpointNumber)) return { status: "stall" as const };
      return Option.match(
        Arr.findFirst(this.#queued, (entry) => entry.endpoint === endpointNumber),
        {
          onNone: () =>
            new Promise<InTransferResultLike>((resolve, reject) => {
              this.#pending.push({ endpoint: endpointNumber, length, resolve, reject });
            }),
          onSome: (entry) => {
            this.#queued.splice(this.#queued.indexOf(entry), 1);
            return delivered(entry.data, length);
          },
        },
      );
    });
  }

  transferOut(
    endpointNumber: number,
    data: Uint8Array<ArrayBuffer>,
  ): Promise<OutTransferResultLike> {
    return this.#ready(true, () => {
      if (this.#halted.includes(endpointNumber))
        return { status: "stall" as const, bytesWritten: 0 };
      this.#written.push({ endpoint: endpointNumber, data: data.slice() });
      return { status: "ok" as const, bytesWritten: data.length };
    });
  }

  controlTransferIn(setup: ControlTransferSetup, length: number): Promise<InTransferResultLike> {
    return this.#ready(false, () => {
      this.#controls.push({ setup, direction: "in", data: Option.none() });
      return delivered(this.#controlReplies.shift() ?? new Uint8Array(0), length);
    });
  }

  controlTransferOut(
    setup: ControlTransferSetup,
    data?: Uint8Array<ArrayBuffer>,
  ): Promise<OutTransferResultLike> {
    return this.#ready(false, () => {
      const copy = Option.map(Option.fromUndefinedOr(data), (bytes) => bytes.slice());
      this.#controls.push({ setup, direction: "out", data: copy });
      return {
        status: "ok" as const,
        bytesWritten: Option.match(copy, { onNone: () => 0, onSome: (bytes) => bytes.length }),
      };
    });
  }

  clearHalt(_direction: "in" | "out", endpointNumber: number): Promise<void> {
    return this.#ready(true, () => {
      const index = this.#halted.indexOf(endpointNumber);
      if (index >= 0) this.#halted.splice(index, 1);
    });
  }

  /** Data from the device on IN endpoint `endpoint`, for the transfer waiting on it or the next. */
  send(endpoint: number, data: Uint8Array): void {
    Option.match(
      Arr.findFirstIndex(this.#pending, (pending) => pending.endpoint === endpoint),
      {
        onNone: () => {
          this.#queued.push({ endpoint, data });
        },
        onSome: (index) =>
          Arr.forEach(this.#pending.splice(index, 1), (pending) =>
            pending.resolve(delivered(data, pending.length)),
          ),
      },
    );
  }

  /** The reply to the next `controlTransferIn`. */
  reply(data: Uint8Array): void {
    this.#controlReplies.push(data);
  }

  /** Halts `endpoint`: its transfers end in `stall`, a waiting one too, until `clearHalt`. */
  stall(endpoint: number): void {
    if (!this.#halted.includes(endpoint)) this.#halted.push(endpoint);
    const stalled = this.#pending.filter((pending) => pending.endpoint === endpoint);
    const others = this.#pending.filter((pending) => pending.endpoint !== endpoint);
    this.#pending.splice(0, this.#pending.length, ...others);
    Arr.forEach(stalled, (pending) => pending.resolve({ status: "stall" }));
  }

  /** Unplugs the device: a waiting transfer fails with `NetworkError`, and it can no longer open. */
  unplug(): void {
    this.#connected = false;
    this.#abort("NetworkError");
    this.#opened = false;
    this.#configuration = Option.none();
    this.#claimed = [];
  }

  #abort(name: string): void {
    Arr.forEach(this.#pending.splice(0, this.#pending.length), (pending) =>
      pending.reject(new DOMException("the transfer was cut short", name)),
    );
  }

  /**
   * Runs a transfer, synchronously, once it may run: the device open, and
   * an interface claimed when `claimed`.
   */
  #ready<A>(claimed: boolean, run: () => A | Promise<A>): Promise<A> {
    if (!this.#connected) return rejection("NetworkError", "the device is gone");
    if (!this.#opened) return rejection("InvalidStateError", "the device is not open");
    if (claimed && Arr.isReadonlyArrayEmpty(this.#claimed))
      return rejection("InvalidStateError", "no interface is claimed");
    return Promise.resolve(run());
  }
}

/**
 * Drives the in-memory API:
 *
 * - `plug(options?)` plugs a device in and returns it; a granted one fires
 *   `connect`.
 * - `unplug(device)` unplugs it, failing its waiting transfer with
 *   `NetworkError`, and fires `disconnect`.
 * - `pick(device)` is what the user chooses in the next picker; with
 *   nothing picked, the picker is closed (`NotFoundError`). Choosing grants
 *   it.
 * - `requests` lists the options each picker was opened with.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly plug: (options?: PlugOptions) => Effect.Effect<TestUsbDevice>;
    readonly unplug: (device: TestUsbDevice) => Effect.Effect<void>;
    readonly pick: (device: TestUsbDevice) => Effect.Effect<void>;
    readonly requests: Effect.Effect<ReadonlyArray<RequestOptions>>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/UsbControl") {}

/**
 * What {@link make} builds: the `Usb` service over the in-memory API, and
 * the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly usb: UsbService;
  readonly control: Control["Service"];
}

/**
 * Builds an in-memory `navigator.usb`: the `Usb` service over it, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestUsb } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { usb, control } = TestUsb.make()
 * const program = Effect.gen(function* () {
 *   yield* control.plug({ vendorId: 0x2341, productName: "Uno" })
 *   return (yield* usb.devices).map((device) => device.productName)
 * })
 * Effect.runPromise(program).then(console.log) // ["Uno"]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const granted: Array<TestUsbDevice> = [];
  const picks: Array<TestUsbDevice> = [];
  const requests: Array<RequestOptions> = [];
  const listeners: Array<{ readonly type: string; readonly listener: Listener }> = [];
  const dispatch = (type: string, device: TestUsbDevice): void =>
    Arr.forEach(
      listeners.filter((entry) => entry.type === type),
      (entry) => entry.listener({ target: device }),
    );
  const grant = (device: TestUsbDevice): void => {
    if (!granted.includes(device)) granted.push(device);
  };

  const base: UsbLike = {
    getDevices: () => Promise.resolve([...granted]),
    addEventListener: (type, listener) => {
      listeners.push({ type, listener });
    },
    removeEventListener: (type, listener) => {
      Option.map(
        Arr.findFirstIndex(
          listeners,
          (entry) => entry.type === type && entry.listener === listener,
        ),
        (index) => listeners.splice(index, 1),
      );
    },
  };
  const withPicker: UsbLike = {
    ...base,
    requestDevice: (request) => {
      requests.push(request);
      return Option.match(Option.fromUndefinedOr(picks.shift()), {
        onNone: () => rejection("NotFoundError", "No device selected."),
        onSome: (device) => {
          grant(device);
          return Promise.resolve(device);
        },
      });
    },
  };

  return {
    usb: makeUsb(
      (options?.supported ?? true) ? ((options?.picker ?? true) ? withPicker : base) : undefined,
    ),
    control: Control.of({
      plug: (plug) =>
        Effect.sync(() => {
          const device = new TestUsbDevice(plug ?? {});
          if (plug?.granted ?? true) {
            grant(device);
            dispatch("connect", device);
          }
          return device;
        }),
      unplug: (device) =>
        Effect.sync(() => {
          device.unplug();
          if (granted.includes(device)) dispatch("disconnect", device);
        }),
      pick: (device) =>
        Effect.sync(() => {
          picks.push(device);
        }),
      requests: Effect.sync(() => [...requests]),
    }),
  };
};

/**
 * Provides `Usb` over a fresh in-memory `navigator.usb`, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Usb } from "@thomasfosterau/effect-platform-worker-shared"
 * import { TestUsb } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestUsb.Control
 *   const device = yield* control.plug()
 *   const handle = yield* Usb.open(device, { configuration: 1, interface: 0 })
 *   device.send(1, new TextEncoder().encode("hi"))
 *   return new TextDecoder().decode(yield* handle.transferIn(1, 64))
 * })
 * Effect.runPromise(Effect.provide(Effect.scoped(program), TestUsb.layer())).then(console.log) // "hi"
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Control> =>
  Layer.syncContext(() => {
    const { usb, control } = make(options);
    return Context.make(Usb, usb).pipe(Context.add(Control, control));
  });
