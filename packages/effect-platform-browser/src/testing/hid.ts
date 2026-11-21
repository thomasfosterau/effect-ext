/**
 * In-memory HID devices for tests of code that uses `Hid` (from
 * `@thomasfosterau/effect-platform-worker-shared`): {@link layer} provides
 * the real adapter over an in-memory `navigator.hid`, plus {@link Control},
 * which plugs devices in and out and answers the picker; each
 * {@link TestHidDevice} fires input reports, answers feature-report reads
 * and records the reports sent to it.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  type CollectionInfo,
  Hid,
  type HidDeviceLike,
  type HidLike,
  type HidService,
  make as makeHid,
  type RequestOptions,
} from "@thomasfosterau/effect-platform-worker-shared/Hid";

/**
 * The in-memory API's setup: `supported` (default `true`) builds the
 * service without WebHID when `false`; `picker` (default `true`) leaves out
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
 * What a device reports about itself.
 *
 * @since 0.1.0
 * @category models
 */
export interface DeviceInfo {
  readonly vendorId?: number;
  readonly productId?: number;
  readonly productName?: string;
  readonly collections?: ReadonlyArray<CollectionInfo>;
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
 * A report sent to the device: an output or a feature report, its id and
 * its bytes.
 *
 * @since 0.1.0
 * @category models
 */
export interface SentReport {
  readonly kind: "output" | "feature";
  readonly reportId: number;
  readonly data: Uint8Array;
}

type InputListener = (event: { readonly reportId: number; readonly data: DataView }) => void;

/** A listener on the in-memory `navigator.hid`. */
type Listener = (event: { readonly target: HidDeviceLike | null }) => void;

const rejection = (name: string, message: string): Promise<never> =>
  Promise.reject(new DOMException(message, name));

/**
 * An in-memory device, following the platform: it opens once (again is
 * `InvalidStateError`), reports flow only while it is open, and an
 * unplugged one fails with `NetworkError`.
 *
 * @since 0.1.0
 * @category models
 */
export class TestHidDevice implements HidDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: ReadonlyArray<CollectionInfo>;
  readonly #listeners: Array<InputListener> = [];
  readonly #sent: Array<SentReport> = [];
  readonly #features: Array<{ readonly reportId: number; readonly data: Uint8Array }> = [];
  #connected = true;
  #opened = false;

  constructor(info: DeviceInfo) {
    this.vendorId = info.vendorId ?? 0;
    this.productId = info.productId ?? 0;
    this.productName = info.productName ?? "";
    this.collections = info.collections ?? [];
  }

  get opened(): boolean {
    return this.#opened;
  }
  /** Every output and feature report sent, in order. */
  get sent(): ReadonlyArray<SentReport> {
    return this.#sent;
  }

  open(): Promise<void> {
    if (!this.#connected) return rejection("NetworkError", "the device is gone");
    if (this.#opened) return rejection("InvalidStateError", "the device is already open");
    this.#opened = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.#opened = false;
    return Promise.resolve();
  }

  sendReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
    return this.#send("output", reportId, data);
  }

  sendFeatureReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
    return this.#send("feature", reportId, data);
  }

  receiveFeatureReport(reportId: number): Promise<DataView> {
    return this.#ready(() =>
      Option.match(
        Arr.findFirst(this.#features, (feature) => feature.reportId === reportId),
        {
          onNone: () => rejection("NotAllowedError", `no feature report ${reportId}`),
          onSome: (feature) => Promise.resolve(new DataView(feature.data.slice().buffer)),
        },
      ),
    );
  }

  addEventListener(_type: "inputreport", listener: InputListener): void {
    this.#listeners.push(listener);
  }

  removeEventListener(_type: "inputreport", listener: InputListener): void {
    Option.map(
      Arr.findFirstIndex(this.#listeners, (entry) => entry === listener),
      (index) => this.#listeners.splice(index, 1),
    );
  }

  /** An input report from the device, to the listeners while it is open. */
  input(reportId: number, data: Uint8Array): void {
    if (!this.#opened) return;
    const view = new DataView(data.slice().buffer);
    Arr.forEach([...this.#listeners], (listener) => listener({ reportId, data: view }));
  }

  /** What `receiveFeatureReport(reportId)` answers from now on. */
  feature(reportId: number, data: Uint8Array): void {
    this.#features.unshift({ reportId, data });
  }

  /** Unplugs the device: it closes and can no longer open. */
  unplug(): void {
    this.#connected = false;
    this.#opened = false;
  }

  #send(kind: SentReport["kind"], reportId: number, data: Uint8Array): Promise<void> {
    return this.#ready(() => {
      this.#sent.push({ kind, reportId, data: data.slice() });
      return Promise.resolve();
    });
  }

  #ready<A>(run: () => Promise<A>): Promise<A> {
    if (!this.#connected) return rejection("NetworkError", "the device is gone");
    if (!this.#opened) return rejection("InvalidStateError", "the device is not open");
    return run();
  }
}

/**
 * Drives the in-memory API:
 *
 * - `plug(options?)` plugs a device in and returns it; a granted one fires
 *   `connect`.
 * - `unplug(device)` unplugs it and fires `disconnect`.
 * - `pick(devices)` is what the user chooses in the next picker; with
 *   nothing picked, the picker is closed and returns no devices. Choosing
 *   grants them.
 * - `requests` lists the options each picker was opened with.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly plug: (options?: PlugOptions) => Effect.Effect<TestHidDevice>;
    readonly unplug: (device: TestHidDevice) => Effect.Effect<void>;
    readonly pick: (devices: ReadonlyArray<TestHidDevice>) => Effect.Effect<void>;
    readonly requests: Effect.Effect<ReadonlyArray<RequestOptions>>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/HidControl") {}

/**
 * What {@link make} builds: the `Hid` service over the in-memory API, and
 * the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly hid: HidService;
  readonly control: Control["Service"];
}

/**
 * Builds an in-memory `navigator.hid`: the `Hid` service over it, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestHid } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { hid, control } = TestHid.make()
 * const program = Effect.gen(function* () {
 *   yield* control.plug({ productName: "Macro pad" })
 *   return (yield* hid.devices).map((device) => device.productName)
 * })
 * Effect.runPromise(program).then(console.log) // ["Macro pad"]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const granted: Array<TestHidDevice> = [];
  const picks: Array<ReadonlyArray<TestHidDevice>> = [];
  const requests: Array<RequestOptions> = [];
  const listeners: Array<{ readonly type: string; readonly listener: Listener }> = [];
  const dispatch = (type: string, device: TestHidDevice): void =>
    Arr.forEach(
      listeners.filter((entry) => entry.type === type),
      (entry) => entry.listener({ target: device }),
    );
  const grant = (device: TestHidDevice): void => {
    if (!granted.includes(device)) granted.push(device);
  };

  const base: HidLike = {
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
  const withPicker: HidLike = {
    ...base,
    requestDevice: (request) => {
      requests.push(request);
      const chosen = picks.shift() ?? [];
      Arr.forEach(chosen, grant);
      return Promise.resolve(chosen);
    },
  };

  return {
    hid: makeHid(
      (options?.supported ?? true) ? ((options?.picker ?? true) ? withPicker : base) : undefined,
    ),
    control: Control.of({
      plug: (plug) =>
        Effect.sync(() => {
          const device = new TestHidDevice(plug ?? {});
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
      pick: (devices) =>
        Effect.sync(() => {
          picks.push(devices);
        }),
      requests: Effect.sync(() => [...requests]),
    }),
  };
};

/**
 * Provides `Hid` over a fresh in-memory `navigator.hid`, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Hid } from "@thomasfosterau/effect-platform-worker-shared"
 * import { TestHid } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestHid.Control
 *   const device = yield* control.plug()
 *   const handle = yield* Hid.open(device)
 *   yield* handle.sendReport(0, new Uint8Array([1, 2]))
 *   return device.sent.length
 * })
 * Effect.runPromise(Effect.provide(Effect.scoped(program), TestHid.layer())).then(console.log) // 1
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Control> =>
  Layer.syncContext(() => {
    const { hid, control } = make(options);
    return Context.make(Hid, hid).pipe(Context.add(Control, control));
  });
