/**
 * Web Serial (Chromium, in a window or a dedicated worker): serial ports as
 * a byte `Stream` and a byte `Sink`, opened for a `Scope`. The picker
 * (`request`) needs a window and a user gesture; a worker lists the ports
 * a page already granted.
 *
 * {@link Serial} is a context reference that defaults, on first read, to the
 * ambient `navigator.serial`; a test provides one built by {@link make}.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import {
  COMMON_REASONS,
  connections as connectionsOf,
  type DeviceEvent,
  type DeviceManagerLike,
  reasonOf,
} from "./internal/device.ts";

/**
 * What a port reports about itself: the USB ids of a USB adapter, or the
 * service class of a Bluetooth RFCOMM port.
 *
 * @since 0.1.0
 * @category models
 */
export interface SerialPortInfo {
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
  readonly bluetoothServiceClassId?: number | string;
}

/**
 * How to open a port. `baudRate` is required; the rest default to the
 * platform's 8 data bits, 1 stop bit, no parity, a 255-byte buffer and no
 * flow control.
 *
 * @since 0.1.0
 * @category models
 */
export interface SerialOptions {
  readonly baudRate: number;
  readonly dataBits?: 7 | 8;
  readonly stopBits?: 1 | 2;
  readonly parity?: "none" | "even" | "odd";
  readonly bufferSize?: number;
  readonly flowControl?: "none" | "hardware";
}

/**
 * The control lines a page sets.
 *
 * @since 0.1.0
 * @category models
 */
export interface OutputSignals {
  readonly dataTerminalReady?: boolean;
  readonly requestToSend?: boolean;
  readonly break?: boolean;
}

/**
 * The control lines the device sets.
 *
 * @since 0.1.0
 * @category models
 */
export interface InputSignals {
  readonly dataCarrierDetect: boolean;
  readonly clearToSend: boolean;
  readonly ringIndicator: boolean;
  readonly dataSetReady: boolean;
}

/**
 * The slice of a `SerialPort` this module calls. `readable` and `writable`
 * are `null` while the port is closed, and `readable` after a fatal read
 * error.
 *
 * @since 0.1.0
 * @category models
 */
export interface SerialPortLike {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: OutputSignals): Promise<void>;
  getSignals(): Promise<InputSignals>;
}

/**
 * Which ports the picker offers: those matching any filter (all, without
 * one), and the Bluetooth services a page may use.
 *
 * @since 0.1.0
 * @category models
 */
export interface RequestOptions {
  readonly filters?: ReadonlyArray<SerialPortInfo>;
  readonly allowedBluetoothServiceClassIds?: ReadonlyArray<number | string>;
}

/**
 * The slice of `navigator.serial` this module calls: `requestPort` is
 * missing in a worker.
 *
 * @since 0.1.0
 * @category models
 */
export interface SerialLike extends DeviceManagerLike<SerialPortLike> {
  readonly getPorts: () => Promise<ReadonlyArray<SerialPortLike>>;
  readonly requestPort?: (options?: RequestOptions) => Promise<SerialPortLike>;
}

/**
 * A port plugged in (or granted) or unplugged.
 *
 * @since 0.1.0
 * @category models
 */
export type ConnectionEvent = DeviceEvent<SerialPortLike>;

/**
 * Why a serial call failed:
 *
 * - `Unsupported` — no Web Serial, or no picker (a worker).
 * - `NotFound` — the user closed the picker.
 * - `NotAllowed` — refused by policy, or not from a user gesture.
 * - `InvalidState` — the port is already open, or another `read` is running.
 * - `Network` — the port is gone (unplugged) or could not be opened.
 * - `Closed` — the connection's scope closed.
 * - `Break`, `Framing`, `Parity`, `BufferOverrun` — a read error the port
 *   recovers from: `read` again.
 * - `Failed` — anything else.
 *
 * @since 0.1.0
 * @category models
 */
export type SerialErrorReason =
  | "Unsupported"
  | "NotFound"
  | "NotAllowed"
  | "InvalidState"
  | "Network"
  | "Aborted"
  | "Closed"
  | "Break"
  | "Framing"
  | "Parity"
  | "BufferOverrun"
  | "Failed";

/**
 * A serial call failed. `operation` names it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/Serial"
 *
 * Effect.runPromise(Effect.flip(make().ports)).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class SerialError extends Schema.TaggedError<
  SerialError,
  { readonly brand: unique symbol }
>()("SerialError", {
  operation: Schema.Literals(["request", "ports", "open", "read", "write", "signals"]),
  reason: Schema.Literals([
    "Unsupported",
    "NotFound",
    "NotAllowed",
    "InvalidState",
    "Network",
    "Aborted",
    "Closed",
    "Break",
    "Framing",
    "Parity",
    "BufferOverrun",
    "Failed",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

type Operation = SerialError["operation"];

const REASONS = {
  ...COMMON_REASONS,
  BreakError: "Break",
  FramingError: "Framing",
  ParityError: "Parity",
  BufferOverrunError: "BufferOverrun",
} satisfies Readonly<Record<string, SerialErrorReason>>;

const failure = (operation: Operation, reason: SerialErrorReason, cause: unknown): SerialError =>
  new SerialError({ operation, reason, cause, message: `serial ${operation}: ${reason}` });

const attempt = <A>(operation: Operation, call: () => Promise<A>): Effect.Effect<A, SerialError> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => failure(operation, reasonOf(cause, REASONS, "Failed"), cause),
  });

/**
 * An open port, for as long as its scope:
 *
 * - `read` — the bytes the device sends, as they arrive. One `read` runs at
 *   a time; a read error fails it, and running it again reads on.
 * - `write` — sends bytes, once the previous write is done.
 * - `writer` — `write` as a `Sink`, for piping a stream to the device.
 * - `setSignals` and `signals` — the control lines.
 *
 * @since 0.1.0
 * @category models
 */
export interface Connection {
  readonly port: SerialPortLike;
  readonly info: SerialPortInfo;
  readonly read: Stream.Stream<Uint8Array, SerialError>;
  readonly write: (data: Uint8Array) => Effect.Effect<void, SerialError>;
  readonly writer: Sink.Sink<void, Uint8Array, never, SerialError>;
  readonly setSignals: (signals: OutputSignals) => Effect.Effect<void, SerialError>;
  readonly signals: Effect.Effect<InputSignals, SerialError>;
}

/**
 * The operations a {@link Serial} offers.
 *
 * @since 0.1.0
 * @category models
 */
export interface SerialService {
  /** Whether the agent has Web Serial, and whether this context has its picker. */
  readonly supported: { readonly serial: boolean; readonly request: boolean };
  /** Shows the picker (from a user gesture) and returns the port the user chose. */
  readonly request: (options?: RequestOptions) => Effect.Effect<SerialPortLike, SerialError>;
  /** The ports the page has been granted. */
  readonly ports: Effect.Effect<ReadonlyArray<SerialPortLike>, SerialError>;
  /** Each port plugged in (or granted) or unplugged, from when the stream starts. */
  readonly connections: Stream.Stream<ConnectionEvent, SerialError>;
  /**
   * Opens `port` for the scope. Closing the scope ends a running `read`,
   * waits for the write in flight, and closes the port.
   */
  readonly open: (
    port: SerialPortLike,
    options: SerialOptions,
  ) => Effect.Effect<Connection, SerialError, Scope.Scope>;
}

/** Holds the read permit for the stream's scope, or fails: the platform allows one reader. */
const readPermit = (permit: Semaphore.Semaphore): Effect.Effect<void, SerialError, Scope.Scope> =>
  Effect.acquireRelease(Semaphore.takeIfAvailable(permit, 1), (taken) =>
    taken ? Semaphore.release(permit, 1) : Effect.void,
  ).pipe(
    Effect.filterOrFail(
      (taken) => taken,
      () => failure("read", "InvalidState", "another read is running"),
    ),
    Effect.asVoid,
  );

const openPort = (
  port: SerialPortLike,
  options: SerialOptions,
): Effect.Effect<Connection, SerialError, Scope.Scope> =>
  Effect.gen(function* () {
    const reading = yield* Semaphore.make(1);
    const writing = yield* Semaphore.make(1);
    const closing = yield* Deferred.make<void>();
    const state = { closed: false };
    yield* Effect.acquireRelease(
      attempt("open", () => port.open(options)),
      () =>
        Effect.gen(function* () {
          state.closed = true;
          yield* Deferred.succeed(closing, undefined);
          yield* Semaphore.withPermit(
            reading,
            Semaphore.withPermit(writing, Effect.ignore(attempt("open", () => port.close()))),
          );
        }),
    );
    const live = <A>(operation: Operation, read: () => A | null): Effect.Effect<A, SerialError> =>
      Effect.suspend(() =>
        state.closed
          ? Effect.fail(failure(operation, "Closed", undefined))
          : Effect.mapError(Effect.fromOption(Option.fromNullishOr(read())), () =>
              failure(operation, "Network", "the port is gone"),
            ),
      );
    const write = (data: Uint8Array): Effect.Effect<void, SerialError> =>
      Semaphore.withPermit(
        writing,
        Effect.flatMap(
          live("write", () => port.writable),
          (writable) =>
            Effect.acquireUseRelease(
              Effect.sync(() => writable.getWriter()),
              (writer) => attempt("write", () => writer.write(data)),
              (writer) => Effect.sync(() => writer.releaseLock()),
            ),
        ),
      );
    return {
      port,
      info: port.getInfo(),
      read: Stream.unwrap(
        Effect.gen(function* () {
          yield* readPermit(reading);
          const readable = yield* live("read", () => port.readable);
          return Stream.fromReadableStream({
            evaluate: () => readable,
            onError: (cause) => failure("read", reasonOf(cause, REASONS, "Failed"), cause),
          }).pipe(Stream.interruptWhen(Deferred.await(closing)));
        }),
      ),
      write,
      writer: Sink.forEach(write),
      setSignals: (signals) =>
        Effect.andThen(
          live("signals", () => port),
          (self) => attempt("signals", () => self.setSignals(signals)),
        ),
      signals: Effect.andThen(
        live("signals", () => port),
        (self) => attempt("signals", () => self.getSignals()),
      ),
    };
  });

/**
 * Builds a {@link SerialService} over a `navigator.serial`; without one, the
 * unsupported service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/Serial"
 *
 * const serial = make({
 *   getPorts: () => Promise.resolve([]),
 *   addEventListener: () => {},
 *   removeEventListener: () => {},
 * })
 * Effect.runPromise(serial.ports).then(console.log) // []
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (serial?: SerialLike): SerialService =>
  Option.match(Option.fromUndefinedOr(serial), {
    onNone: (): SerialService => ({
      supported: { serial: false, request: false },
      request: () => Effect.fail(failure("request", "Unsupported", undefined)),
      ports: Effect.fail(failure("ports", "Unsupported", undefined)),
      connections: Stream.fail(failure("ports", "Unsupported", undefined)),
      open: () => Effect.fail(failure("open", "Unsupported", undefined)),
    }),
    onSome: (self): SerialService => ({
      supported: { serial: true, request: self.requestPort !== undefined },
      request: (options) =>
        Option.match(Option.fromUndefinedOr(self.requestPort), {
          onNone: () => Effect.fail(failure("request", "Unsupported", undefined)),
          onSome: (requestPort) =>
            attempt("request", () =>
              options === undefined ? requestPort.call(self) : requestPort.call(self, options),
            ),
        }),
      ports: attempt("ports", () => self.getPorts()),
      connections: connectionsOf(self),
      open: openPort,
    }),
  });

/** The ambient `navigator.serial` (a window's or a dedicated worker's), where it has one. */
const ambient = (): SerialService => {
  // The `onLine` member only stops the annotation reading as a weak type.
  const scope: {
    readonly navigator?: { readonly serial?: SerialLike } & Pick<Navigator, "onLine">;
  } = globalThis;
  return make(scope.navigator?.serial);
};

/**
 * Web Serial. Defaults to the ambient `navigator.serial`, read on first
 * use; provide one built by {@link make} to replace it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Serial } from "@thomasfosterau/effect-platform-worker-shared/Serial"
 *
 * const program = Serial.use((serial) => Effect.succeed(serial.supported))
 * Effect.runPromise(program).then(console.log) // { serial: false, request: false } under Node
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const Serial: Context.Reference<SerialService> = /*#__PURE__*/ Context.Reference(
  "@thomasfosterau/effect-platform-worker-shared/Serial",
  { defaultValue: ambient },
);

/**
 * Shows the port picker, from a user gesture, and returns the port the user
 * chose; `NotFound` when they close it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { request } from "@thomasfosterau/effect-platform-worker-shared/Serial"
 *
 * const choose = request({ filters: [{ usbVendorId: 0x2341 }] }) // Arduino boards
 * Effect.runPromise(Effect.flip(choose)).then((error) => console.log(error.reason)) // "Unsupported" under Node
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const request = (options?: RequestOptions): Effect.Effect<SerialPortLike, SerialError> =>
  Serial.use((self) => self.request(options));

/**
 * The ports the page has been granted, in this context.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { ports } from "@thomasfosterau/effect-platform-worker-shared/Serial"
 *
 * Effect.runPromise(Effect.ignore(ports))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const ports: Effect.Effect<ReadonlyArray<SerialPortLike>, SerialError> = Serial.use(
  (self) => self.ports,
);

/**
 * Each granted port plugged in or unplugged.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { connections } from "@thomasfosterau/effect-platform-worker-shared/Serial"
 *
 * const log = connections.pipe(Stream.runForEach((event) => Effect.log(event.type, event.device.getInfo())))
 * Effect.runFork(Effect.ignore(log))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const connections: Stream.Stream<ConnectionEvent, SerialError> = Stream.unwrap(
  Serial.use((self) => Effect.succeed(self.connections)),
);

/**
 * Opens `port` for the scope: read with `read`, write with `write` or
 * `writer`; closing the scope closes the port.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { open, ports } from "@thomasfosterau/effect-platform-worker-shared/Serial"
 *
 * const echo = Effect.gen(function* () {
 *   const [port] = yield* ports
 *   if (port === undefined) return
 *   const connection = yield* open(port, { baudRate: 115200 })
 *   yield* Stream.run(connection.read, connection.writer)
 * })
 * Effect.runPromise(Effect.ignore(Effect.scoped(echo)))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const open = (
  port: SerialPortLike,
  options: SerialOptions,
): Effect.Effect<Connection, SerialError, Scope.Scope> =>
  Serial.use((self) => self.open(port, options));
