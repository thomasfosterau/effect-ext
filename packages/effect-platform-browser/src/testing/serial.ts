/**
 * In-memory serial ports for tests of code that uses `Serial` (from
 * `@thomasfosterau/effect-platform-worker-shared`): {@link layer} provides
 * the real adapter over an in-memory `navigator.serial`, plus
 * {@link Control}, which plugs ports in and out, answers the picker, sends
 * bytes from the device and reads back what was written.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  type InputSignals,
  make as makeSerial,
  type OutputSignals,
  type RequestOptions,
  Serial,
  type SerialLike,
  type SerialOptions,
  type SerialPortInfo,
  type SerialPortLike,
  type SerialService,
} from "@thomasfosterau/effect-platform-worker-shared/Serial";

/**
 * The in-memory API's setup: `supported` (default `true`) builds the
 * service without Web Serial when `false`; `picker` (default `true`) leaves
 * out `requestPort`, as in a worker, when `false`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
  readonly picker?: boolean;
}

/**
 * Plugs a port in: its `info` (default none), and whether the page has
 * been granted it already (`granted`, default `true`).
 *
 * @since 0.1.0
 * @category models
 */
export interface PlugOptions {
  readonly info?: SerialPortInfo;
  readonly granted?: boolean;
}

/** A listener on the in-memory `navigator.serial`. */
type Listener = (event: { readonly target: SerialPortLike | null }) => void;

/**
 * An in-memory port, following the spec's `readable`: while the port is
 * open, a new one is made when the last was cancelled or hit a read error,
 * until a fatal `NetworkError`. `send` pushes bytes the device sent, `fail`
 * errors the current `readable`, and `written` is every chunk written.
 *
 * @since 0.1.0
 * @category models
 */
export class TestSerialPort implements SerialPortLike {
  readonly #info: SerialPortInfo;
  readonly #written: Array<Uint8Array> = [];
  #connected = true;
  #fatal = false;
  #open = Option.none<SerialOptions>();
  #readable: ReadableStream<Uint8Array> | null = null;
  #writable: WritableStream<Uint8Array> | null = null;
  #controller = Option.none<ReadableStreamDefaultController<Uint8Array>>();
  #signals: OutputSignals = {};
  inputSignals: InputSignals = {
    dataCarrierDetect: false,
    clearToSend: true,
    ringIndicator: false,
    dataSetReady: true,
  };

  constructor(info: SerialPortInfo) {
    this.#info = info;
  }

  get readable(): ReadableStream<Uint8Array> | null {
    if (this.#readable === null && Option.isSome(this.#open) && !this.#fatal)
      this.#replaceReadable();
    return this.#readable;
  }
  get writable(): WritableStream<Uint8Array> | null {
    return this.#writable;
  }
  /** The options the port is open with, while it is. */
  get options(): Option.Option<SerialOptions> {
    return this.#open;
  }
  /** The control lines last set. */
  get signals(): OutputSignals {
    return this.#signals;
  }
  /** Every chunk written, in order. */
  get written(): ReadonlyArray<Uint8Array> {
    return this.#written;
  }

  getInfo(): SerialPortInfo {
    return this.#info;
  }

  open(options: SerialOptions): Promise<void> {
    if (!this.#connected)
      return Promise.reject(new DOMException("the device is gone", "NetworkError"));
    if (Option.isSome(this.#open))
      return Promise.reject(new DOMException("the port is already open", "InvalidStateError"));
    this.#open = Option.some(options);
    this.#fatal = false;
    this.#writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.#written.push(chunk);
      },
    });
    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this.#readable?.locked === true || this.#writable?.locked === true)
      return Promise.reject(new TypeError("cannot close a port with a locked stream"));
    this.#open = Option.none();
    this.#readable = null;
    this.#writable = null;
    this.#controller = Option.none();
    return Promise.resolve();
  }

  setSignals(signals: OutputSignals): Promise<void> {
    if (Option.isNone(this.#open))
      return Promise.reject(new DOMException("the port is closed", "InvalidStateError"));
    this.#signals = { ...this.#signals, ...signals };
    return Promise.resolve();
  }

  getSignals(): Promise<InputSignals> {
    return Option.isNone(this.#open)
      ? Promise.reject(new DOMException("the port is closed", "InvalidStateError"))
      : Promise.resolve(this.inputSignals);
  }

  /** Bytes from the device, delivered to the current `readable`. */
  send(bytes: Uint8Array): void {
    Option.map(this.#controller, (controller) => controller.enqueue(bytes));
  }

  /** Errors the current `readable` with a `DOMException` called `name`. */
  fail(name: string): void {
    Option.map(this.#controller, (controller) =>
      controller.error(new DOMException(`serial ${name}`, name)),
    );
    this.#fatal = name === "NetworkError";
    this.#readable = null;
    this.#controller = Option.none();
  }

  /** Unplugs the device: a fatal read error, and the port can no longer open. */
  unplug(): void {
    this.#connected = false;
    if (Option.isSome(this.#open)) this.fail("NetworkError");
    this.#writable = null;
  }

  #replaceReadable(): void {
    this.#readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#controller = Option.some(controller);
      },
      // A stream that errored is never cancelled, so this is still the current one.
      cancel: () => {
        this.#readable = null;
        this.#controller = Option.none();
      },
    });
  }
}

/**
 * Drives the in-memory API:
 *
 * - `plug(options?)` plugs a port in and returns it; a granted one fires
 *   `connect`.
 * - `unplug(port)` unplugs it, failing its read with `NetworkError`, and
 *   fires `disconnect`.
 * - `pick(port)` is what the user chooses in the next picker; with nothing
 *   picked, the picker is closed (`NotFoundError`). Choosing grants it.
 * - `requests` lists the options each picker was opened with.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly plug: (options?: PlugOptions) => Effect.Effect<TestSerialPort>;
    readonly unplug: (port: TestSerialPort) => Effect.Effect<void>;
    readonly pick: (port: TestSerialPort) => Effect.Effect<void>;
    readonly requests: Effect.Effect<ReadonlyArray<Option.Option<RequestOptions>>>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/SerialControl") {}

/**
 * What {@link make} builds: the `Serial` service over the in-memory API,
 * and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly serial: SerialService;
  readonly control: Control["Service"];
}

/**
 * Builds an in-memory `navigator.serial`: the `Serial` service over it, and
 * its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestSerial } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { serial, control } = TestSerial.make()
 * const program = Effect.gen(function* () {
 *   yield* control.plug({ info: { usbVendorId: 0x2341 } })
 *   return (yield* serial.ports).map((port) => port.getInfo().usbVendorId)
 * })
 * Effect.runPromise(program).then(console.log) // [9025]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const granted: Array<TestSerialPort> = [];
  const picks: Array<TestSerialPort> = [];
  const requests: Array<Option.Option<RequestOptions>> = [];
  const listeners: Array<{ readonly type: string; readonly listener: Listener }> = [];
  const dispatch = (type: string, port: TestSerialPort): void =>
    Arr.forEach(
      listeners.filter((entry) => entry.type === type),
      (entry) => entry.listener({ target: port }),
    );
  const grant = (port: TestSerialPort): void => {
    if (!granted.includes(port)) granted.push(port);
  };

  const base: SerialLike = {
    getPorts: () => Promise.resolve([...granted]),
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
  const withPicker: SerialLike = {
    ...base,
    requestPort: (request) => {
      requests.push(Option.fromUndefinedOr(request));
      return Option.match(Option.fromUndefinedOr(picks.shift()), {
        onNone: () =>
          Promise.reject(new DOMException("No port selected by the user.", "NotFoundError")),
        onSome: (port) => {
          grant(port);
          return Promise.resolve(port);
        },
      });
    },
  };

  return {
    serial: makeSerial(
      (options?.supported ?? true) ? ((options?.picker ?? true) ? withPicker : base) : undefined,
    ),
    control: Control.of({
      plug: (plug) =>
        Effect.sync(() => {
          const port = new TestSerialPort(plug?.info ?? {});
          if (plug?.granted ?? true) {
            grant(port);
            dispatch("connect", port);
          }
          return port;
        }),
      unplug: (port) =>
        Effect.sync(() => {
          port.unplug();
          if (granted.includes(port)) dispatch("disconnect", port);
        }),
      pick: (port) =>
        Effect.sync(() => {
          picks.push(port);
        }),
      requests: Effect.sync(() => [...requests]),
    }),
  };
};

/**
 * Provides `Serial` over a fresh in-memory `navigator.serial`, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Serial } from "@thomasfosterau/effect-platform-worker-shared"
 * import { TestSerial } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestSerial.Control
 *   const port = yield* control.plug()
 *   const connection = yield* Serial.open(port, { baudRate: 9600 })
 *   yield* connection.write(new TextEncoder().encode("AT\r"))
 *   return port.written.length
 * })
 * Effect.runPromise(Effect.provide(Effect.scoped(program), TestSerial.layer())).then(console.log) // 1
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Control> =>
  Layer.syncContext(() => {
    const { serial, control } = make(options);
    return Context.make(Serial, serial).pipe(Context.add(Control, control));
  });
