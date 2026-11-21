/**
 * WebUSB (Chromium, in a window or a dedicated worker): a USB device opened
 * for a `Scope`, with an interface claimed, moving bytes over its bulk,
 * interrupt and control endpoints. The picker (`request`) needs a window
 * and a user gesture; a worker lists the devices a page already granted.
 *
 * {@link Usb} is a context reference that defaults, on first read, to the
 * ambient `navigator.usb`; a test provides one built by {@link make}.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  COMMON_REASONS,
  connections as connectionsOf,
  type DeviceEvent,
  type DeviceManagerLike,
  reasonOf,
} from "./internal/device.ts";

/**
 * Which devices the picker offers: those matching any filter, on each
 * member given.
 *
 * @since 0.1.0
 * @category models
 */
export interface DeviceFilter {
  readonly vendorId?: number;
  readonly productId?: number;
  readonly classCode?: number;
  readonly subclassCode?: number;
  readonly protocolCode?: number;
  readonly serialNumber?: string;
}

/**
 * The picker's filters (required by the platform; an empty list offers
 * every device), and the devices it leaves out.
 *
 * @since 0.1.0
 * @category models
 */
export interface RequestOptions {
  readonly filters: ReadonlyArray<DeviceFilter>;
  readonly exclusionFilters?: ReadonlyArray<DeviceFilter>;
}

/**
 * How a transfer ended: `ok`, the endpoint stalled (`stall`), or the device
 * sent more than was asked for (`babble`).
 *
 * @since 0.1.0
 * @category models
 */
export type TransferStatus = "ok" | "stall" | "babble";

/**
 * A finished IN transfer. `data` is `null` or absent when nothing came back.
 *
 * @since 0.1.0
 * @category models
 */
export interface InTransferResultLike {
  readonly data?: DataView | null;
  readonly status: TransferStatus;
}

/**
 * A finished OUT transfer.
 *
 * @since 0.1.0
 * @category models
 */
export interface OutTransferResultLike {
  readonly bytesWritten: number;
  readonly status: TransferStatus;
}

/**
 * A control transfer's setup packet.
 *
 * @since 0.1.0
 * @category models
 */
export interface ControlTransferSetup {
  readonly requestType: "standard" | "class" | "vendor";
  readonly recipient: "device" | "interface" | "endpoint" | "other";
  readonly request: number;
  readonly value: number;
  readonly index: number;
}

/**
 * The slice of a `USBDevice` this module calls. The string descriptors are
 * `null` or absent where the device has none.
 *
 * @since 0.1.0
 * @category models
 */
export interface UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string | null | undefined;
  readonly manufacturerName?: string | null | undefined;
  readonly serialNumber?: string | null | undefined;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
  transferIn(endpointNumber: number, length: number): Promise<InTransferResultLike>;
  transferOut(
    endpointNumber: number,
    data: Uint8Array<ArrayBuffer>,
  ): Promise<OutTransferResultLike>;
  controlTransferIn(setup: ControlTransferSetup, length: number): Promise<InTransferResultLike>;
  controlTransferOut(
    setup: ControlTransferSetup,
    data?: Uint8Array<ArrayBuffer>,
  ): Promise<OutTransferResultLike>;
  clearHalt(direction: "in" | "out", endpointNumber: number): Promise<void>;
}

/**
 * The slice of `navigator.usb` this module calls: `requestDevice` is
 * missing in a worker.
 *
 * @since 0.1.0
 * @category models
 */
export interface UsbLike extends DeviceManagerLike<UsbDeviceLike> {
  readonly getDevices: () => Promise<ReadonlyArray<UsbDeviceLike>>;
  readonly requestDevice?: (options: RequestOptions) => Promise<UsbDeviceLike>;
}

/**
 * A device plugged in (or granted) or unplugged.
 *
 * @since 0.1.0
 * @category models
 */
export type ConnectionEvent = DeviceEvent<UsbDeviceLike>;

/**
 * Why a USB call failed:
 *
 * - `Unsupported` — no WebUSB, or no picker (a worker).
 * - `NotFound` — the user closed the picker, or no such configuration,
 *   interface or endpoint.
 * - `NotAllowed` — refused by policy, a blocklisted device or interface, or
 *   not from a user gesture.
 * - `InvalidState` — the device is not open, or the interface not claimed.
 * - `Network` — the device is gone (unplugged), or another program holds
 *   the interface.
 * - `Aborted` — the transfer was cut short by a close or a reset.
 * - `Closed` — the handle's scope closed.
 * - `Stall` — the endpoint stalled: `clearHalt` it to go on.
 * - `Babble` — the device sent more than was asked for.
 * - `Failed` — anything else.
 *
 * @since 0.1.0
 * @category models
 */
export type UsbErrorReason =
  | "Unsupported"
  | "NotFound"
  | "NotAllowed"
  | "InvalidState"
  | "Network"
  | "Aborted"
  | "Closed"
  | "Stall"
  | "Babble"
  | "Failed";

/**
 * A USB call failed. `operation` names it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/Usb"
 *
 * Effect.runPromise(Effect.flip(make().devices)).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class UsbError extends Schema.TaggedError<UsbError>()("UsbError", {
  operation: Schema.Literals(["request", "devices", "open", "transfer", "control", "clearHalt"]),
  reason: Schema.Literals([
    "Unsupported",
    "NotFound",
    "NotAllowed",
    "InvalidState",
    "Network",
    "Aborted",
    "Closed",
    "Stall",
    "Babble",
    "Failed",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

type Operation = UsbError["operation"];

const failure = (operation: Operation, reason: UsbErrorReason, cause: unknown): UsbError =>
  new UsbError({ operation, reason, cause, message: `usb ${operation}: ${reason}` });

const attempt = <A>(operation: Operation, call: () => Promise<A>): Effect.Effect<A, UsbError> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => failure(operation, reasonOf(cause, COMMON_REASONS, "Failed"), cause),
  });

/** Fails a transfer that ended in a `stall` or `babble`. */
const settled = <R extends { readonly status: TransferStatus }>(
  operation: Operation,
  result: R,
): Effect.Effect<R, UsbError> =>
  result.status === "ok"
    ? Effect.succeed(result)
    : Effect.fail(
        failure(operation, result.status === "stall" ? "Stall" : "Babble", result.status),
      );

const bytesOf = (result: InTransferResultLike): Uint8Array<ArrayBuffer> =>
  Option.match(Option.fromNullishOr(result.data), {
    onNone: () => new Uint8Array(0),
    onSome: (view) =>
      Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
  });

/**
 * Which configuration and interface to open a device with, and the
 * interface's alternate setting (default the platform's, `0`).
 *
 * @since 0.1.0
 * @category models
 */
export interface OpenOptions {
  readonly configuration: number;
  readonly interface: number;
  readonly alternate?: number;
}

/**
 * An open device with its interface claimed, for as long as its scope:
 *
 * - `transferIn(endpoint, length)` — up to `length` bytes from a bulk or
 *   interrupt IN endpoint.
 * - `transferOut(endpoint, data)` — sends `data`; the bytes written.
 * - `inbound(endpoint, length)` — `transferIn` again and again, as a
 *   `Stream`: an interrupt endpoint's reports, or a bulk endpoint's reads.
 * - `controlTransferIn` and `controlTransferOut` — the control endpoint.
 * - `clearHalt(direction, endpoint)` — clears a `Stall`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Handle {
  readonly device: UsbDeviceLike;
  readonly transferIn: (
    endpoint: number,
    length: number,
  ) => Effect.Effect<Uint8Array<ArrayBuffer>, UsbError>;
  readonly transferOut: (
    endpoint: number,
    data: Uint8Array<ArrayBuffer>,
  ) => Effect.Effect<number, UsbError>;
  readonly inbound: (
    endpoint: number,
    length: number,
  ) => Stream.Stream<Uint8Array<ArrayBuffer>, UsbError>;
  readonly controlTransferIn: (
    setup: ControlTransferSetup,
    length: number,
  ) => Effect.Effect<Uint8Array<ArrayBuffer>, UsbError>;
  readonly controlTransferOut: (
    setup: ControlTransferSetup,
    data?: Uint8Array<ArrayBuffer>,
  ) => Effect.Effect<number, UsbError>;
  readonly clearHalt: (direction: "in" | "out", endpoint: number) => Effect.Effect<void, UsbError>;
}

/**
 * The operations a {@link Usb} offers.
 *
 * @since 0.1.0
 * @category models
 */
export interface UsbService {
  /** Whether the agent has WebUSB, and whether this context has its picker. */
  readonly supported: { readonly usb: boolean; readonly request: boolean };
  /** Shows the picker (from a user gesture) and returns the device the user chose. */
  readonly request: (options: RequestOptions) => Effect.Effect<UsbDeviceLike, UsbError>;
  /** The devices the page has been granted. */
  readonly devices: Effect.Effect<ReadonlyArray<UsbDeviceLike>, UsbError>;
  /** Each device plugged in (or granted) or unplugged, from when the stream starts. */
  readonly connections: Stream.Stream<ConnectionEvent, UsbError>;
  /**
   * Opens `device` for the scope, selects the configuration and claims the
   * interface; closing the scope releases the interface and closes the
   * device, which aborts a transfer in flight.
   */
  readonly open: (
    device: UsbDeviceLike,
    options: OpenOptions,
  ) => Effect.Effect<Handle, UsbError, Scope.Scope>;
}

const openDevice = (
  device: UsbDeviceLike,
  options: OpenOptions,
): Effect.Effect<Handle, UsbError, Scope.Scope> =>
  Effect.gen(function* () {
    const state = { closed: false };
    yield* Effect.acquireRelease(
      attempt("open", () => device.open()),
      () => Effect.ignore(attempt("open", () => device.close())),
    );
    yield* attempt("open", () => device.selectConfiguration(options.configuration));
    yield* Effect.acquireRelease(
      attempt("open", () => device.claimInterface(options.interface)),
      () =>
        Effect.andThen(
          Effect.sync(() => {
            state.closed = true;
          }),
          Effect.ignore(attempt("open", () => device.releaseInterface(options.interface))),
        ),
    );
    yield* Option.match(Option.fromUndefinedOr(options.alternate), {
      onNone: () => Effect.void,
      onSome: (alternate) =>
        attempt("open", () => device.selectAlternateInterface(options.interface, alternate)),
    });
    const call = <A>(operation: Operation, run: () => Promise<A>): Effect.Effect<A, UsbError> =>
      Effect.suspend(() =>
        state.closed
          ? Effect.fail(failure(operation, "Closed", undefined))
          : attempt(operation, run),
      );
    const transferIn = (endpoint: number, length: number) =>
      call("transfer", () => device.transferIn(endpoint, length)).pipe(
        Effect.flatMap((result) => settled("transfer", result)),
        Effect.map(bytesOf),
      );
    return {
      device,
      transferIn,
      transferOut: (endpoint, data) =>
        call("transfer", () => device.transferOut(endpoint, data)).pipe(
          Effect.flatMap((result) => settled("transfer", result)),
          Effect.map((result) => result.bytesWritten),
        ),
      inbound: (endpoint, length) => Stream.fromEffectRepeat(transferIn(endpoint, length)),
      controlTransferIn: (setup, length) =>
        call("control", () => device.controlTransferIn(setup, length)).pipe(
          Effect.flatMap((result) => settled("control", result)),
          Effect.map(bytesOf),
        ),
      controlTransferOut: (setup, data) =>
        call("control", () =>
          data === undefined
            ? device.controlTransferOut(setup)
            : device.controlTransferOut(setup, data),
        ).pipe(
          Effect.flatMap((result) => settled("control", result)),
          Effect.map((result) => result.bytesWritten),
        ),
      clearHalt: (direction, endpoint) =>
        call("clearHalt", () => device.clearHalt(direction, endpoint)),
    } satisfies Handle;
  });

/**
 * Builds a {@link UsbService} over a `navigator.usb`; without one, the
 * unsupported service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/Usb"
 *
 * const usb = make({
 *   getDevices: () => Promise.resolve([]),
 *   addEventListener: () => {},
 *   removeEventListener: () => {},
 * })
 * Effect.runPromise(usb.devices).then(console.log) // []
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (usb?: UsbLike): UsbService =>
  Option.match(Option.fromUndefinedOr(usb), {
    onNone: (): UsbService => ({
      supported: { usb: false, request: false },
      request: () => Effect.fail(failure("request", "Unsupported", undefined)),
      devices: Effect.fail(failure("devices", "Unsupported", undefined)),
      connections: Stream.fail(failure("devices", "Unsupported", undefined)),
      open: () => Effect.fail(failure("open", "Unsupported", undefined)),
    }),
    onSome: (self): UsbService => ({
      supported: { usb: true, request: self.requestDevice !== undefined },
      request: (options) =>
        Option.match(Option.fromUndefinedOr(self.requestDevice), {
          onNone: () => Effect.fail(failure("request", "Unsupported", undefined)),
          onSome: (requestDevice) => attempt("request", () => requestDevice.call(self, options)),
        }),
      devices: attempt("devices", () => self.getDevices()),
      connections: connectionsOf(self),
      open: openDevice,
    }),
  });

/** The ambient `navigator.usb` (a window's or a dedicated worker's), where it has one. */
const ambient = (): UsbService => {
  // The `onLine` member only stops the annotation reading as a weak type.
  const scope: {
    readonly navigator?: { readonly usb?: UsbLike } & Pick<Navigator, "onLine">;
  } = globalThis;
  return make(scope.navigator?.usb);
};

/**
 * WebUSB. Defaults to the ambient `navigator.usb`, read on first use;
 * provide one built by {@link make} to replace it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Usb } from "@thomasfosterau/effect-platform-worker-shared/Usb"
 *
 * const program = Usb.use((usb) => Effect.succeed(usb.supported))
 * Effect.runPromise(program).then(console.log) // { usb: false, request: false } under Node
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const Usb: Context.Reference<UsbService> = /*#__PURE__*/ Context.Reference(
  "@thomasfosterau/effect-platform-worker-shared/Usb",
  { defaultValue: ambient },
);

/**
 * Shows the device picker, from a user gesture, and returns the device the
 * user chose; `NotFound` when they close it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { request } from "@thomasfosterau/effect-platform-worker-shared/Usb"
 *
 * const choose = request({ filters: [{ vendorId: 0x2341 }] }) // Arduino boards
 * Effect.runPromise(Effect.flip(choose)).then((error) => console.log(error.reason)) // "Unsupported" under Node
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const request = (options: RequestOptions): Effect.Effect<UsbDeviceLike, UsbError> =>
  Usb.use((self) => self.request(options));

/**
 * The devices the page has been granted, in this context.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { devices } from "@thomasfosterau/effect-platform-worker-shared/Usb"
 *
 * Effect.runPromise(Effect.ignore(devices))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const devices: Effect.Effect<ReadonlyArray<UsbDeviceLike>, UsbError> = Usb.use(
  (self) => self.devices,
);

/**
 * Each granted device plugged in or unplugged.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { connections } from "@thomasfosterau/effect-platform-worker-shared/Usb"
 *
 * const log = connections.pipe(Stream.runForEach((event) => Effect.log(event.type, event.device.productName)))
 * Effect.runFork(Effect.ignore(log))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const connections: Stream.Stream<ConnectionEvent, UsbError> = Stream.unwrap(
  Usb.use((self) => Effect.succeed(self.connections)),
);

/**
 * Opens `device` for the scope with `configuration` selected and
 * `interface` claimed; closing the scope releases and closes it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { devices, open } from "@thomasfosterau/effect-platform-worker-shared/Usb"
 *
 * const ping = Effect.gen(function* () {
 *   const [device] = yield* devices
 *   if (device === undefined) return
 *   const handle = yield* open(device, { configuration: 1, interface: 0 })
 *   yield* handle.transferOut(1, new TextEncoder().encode("ping"))
 *   return yield* handle.transferIn(2, 64)
 * })
 * Effect.runPromise(Effect.ignore(Effect.scoped(ping)))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const open = (
  device: UsbDeviceLike,
  options: OpenOptions,
): Effect.Effect<Handle, UsbError, Scope.Scope> => Usb.use((self) => self.open(device, options));
