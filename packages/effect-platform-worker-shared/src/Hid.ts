/**
 * WebHID (Chromium, in a window or a dedicated worker): a HID device —
 * a gamepad, a macro pad, a sensor — opened for a `Scope`, its input
 * reports as a `Stream`, and its output and feature reports as effects.
 * The picker (`request`) needs a window and a user gesture; a worker lists
 * the devices a page already granted.
 *
 * {@link Hid} is a context reference that defaults, on first read, to the
 * ambient `navigator.hid`; a test provides one built by {@link make}.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
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
  readonly usagePage?: number;
  readonly usage?: number;
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
 * A report a collection declares, by id (absent when the device uses none).
 *
 * @since 0.1.0
 * @category models
 */
export interface ReportInfo {
  readonly reportId?: number;
}

/**
 * A top-level or nested collection of the device's report descriptor.
 *
 * @since 0.1.0
 * @category models
 */
export interface CollectionInfo {
  readonly usagePage?: number;
  readonly usage?: number;
  readonly type?: number;
  readonly children?: ReadonlyArray<CollectionInfo>;
  readonly inputReports?: ReadonlyArray<ReportInfo>;
  readonly outputReports?: ReadonlyArray<ReportInfo>;
  readonly featureReports?: ReadonlyArray<ReportInfo>;
}

/** An `inputreport` event, as far as this module reads it. */
interface InputReportEventLike {
  readonly reportId: number;
  readonly data: DataView;
}

/**
 * The slice of a `HIDDevice` this module calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface HidDeviceLike {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: ReadonlyArray<CollectionInfo>;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void>;
  sendFeatureReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
  addEventListener(type: "inputreport", listener: (event: InputReportEventLike) => void): void;
  removeEventListener(type: "inputreport", listener: (event: InputReportEventLike) => void): void;
}

/**
 * The slice of `navigator.hid` this module calls: `requestDevice` is
 * missing in a worker.
 *
 * @since 0.1.0
 * @category models
 */
export interface HidLike extends DeviceManagerLike<HidDeviceLike> {
  readonly getDevices: () => Promise<ReadonlyArray<HidDeviceLike>>;
  readonly requestDevice?: (options: RequestOptions) => Promise<ReadonlyArray<HidDeviceLike>>;
}

/**
 * A device plugged in (or granted) or unplugged.
 *
 * @since 0.1.0
 * @category models
 */
export type ConnectionEvent = DeviceEvent<HidDeviceLike>;

/**
 * An input report: its id (`0` when the device uses none) and its bytes.
 *
 * @since 0.1.0
 * @category models
 */
export interface InputReport {
  readonly reportId: number;
  readonly data: Uint8Array<ArrayBuffer>;
}

/**
 * Why a HID call failed:
 *
 * - `Unsupported` — no WebHID, or no picker (a worker).
 * - `NotFound` — no such device.
 * - `NotAllowed` — refused by policy, a blocklisted device or report, or
 *   not from a user gesture.
 * - `InvalidState` — the device is already open, or not open.
 * - `Network` — the device is gone (unplugged), or could not be opened.
 * - `Aborted` — the call was cut short.
 * - `Closed` — the handle's scope closed.
 * - `Failed` — anything else, such as a report the device refused.
 *
 * @since 0.1.0
 * @category models
 */
export type HidErrorReason =
  | "Unsupported"
  | "NotFound"
  | "NotAllowed"
  | "InvalidState"
  | "Network"
  | "Aborted"
  | "Closed"
  | "Failed";

/**
 * A HID call failed. `operation` names it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/Hid"
 *
 * Effect.runPromise(Effect.flip(make().devices)).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class HidError extends Schema.TaggedError<HidError>()("HidError", {
  operation: Schema.Literals(["request", "devices", "open", "send", "receive"]),
  reason: Schema.Literals([
    "Unsupported",
    "NotFound",
    "NotAllowed",
    "InvalidState",
    "Network",
    "Aborted",
    "Closed",
    "Failed",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

type Operation = HidError["operation"];

const failure = (operation: Operation, reason: HidErrorReason, cause: unknown): HidError =>
  new HidError({ operation, reason, cause, message: `hid ${operation}: ${reason}` });

const attempt = <A>(operation: Operation, call: () => Promise<A>): Effect.Effect<A, HidError> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => failure(operation, reasonOf(cause, COMMON_REASONS, "Failed"), cause),
  });

const bytesOf = (view: DataView): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));

/**
 * An open device, for as long as its scope:
 *
 * - `inputReports` — each input report from when the stream starts, in
 *   order; when the scope closes, it ends after the reports it holds.
 * - `sendReport(reportId, data)` — an output report (`0` with no ids).
 * - `sendFeatureReport` and `receiveFeatureReport` — feature reports.
 *
 * @since 0.1.0
 * @category models
 */
export interface Handle {
  readonly device: HidDeviceLike;
  readonly inputReports: Stream.Stream<InputReport, HidError>;
  readonly sendReport: (
    reportId: number,
    data: Uint8Array<ArrayBuffer>,
  ) => Effect.Effect<void, HidError>;
  readonly sendFeatureReport: (
    reportId: number,
    data: Uint8Array<ArrayBuffer>,
  ) => Effect.Effect<void, HidError>;
  readonly receiveFeatureReport: (
    reportId: number,
  ) => Effect.Effect<Uint8Array<ArrayBuffer>, HidError>;
}

/**
 * The operations a {@link Hid} offers.
 *
 * @since 0.1.0
 * @category models
 */
export interface HidService {
  /** Whether the agent has WebHID, and whether this context has its picker. */
  readonly supported: { readonly hid: boolean; readonly request: boolean };
  /**
   * Shows the picker (from a user gesture) and returns the devices the user
   * chose: none when they closed it.
   */
  readonly request: (
    options: RequestOptions,
  ) => Effect.Effect<ReadonlyArray<HidDeviceLike>, HidError>;
  /** The devices the page has been granted. */
  readonly devices: Effect.Effect<ReadonlyArray<HidDeviceLike>, HidError>;
  /** Each device plugged in (or granted) or unplugged, from when the stream starts. */
  readonly connections: Stream.Stream<ConnectionEvent, HidError>;
  /** Opens `device` for the scope; closing the scope ends `inputReports` and closes it. */
  readonly open: (device: HidDeviceLike) => Effect.Effect<Handle, HidError, Scope.Scope>;
}

/**
 * Each input report `device` fires, from when the stream starts; once
 * `closing` completes, the reports already received, then the end.
 */
const reportsOf = (
  device: HidDeviceLike,
  closing: Deferred.Deferred<void>,
): Stream.Stream<InputReport> =>
  Stream.callback<InputReport>((queue) => {
    const listener = (event: InputReportEventLike): void => {
      Queue.offerUnsafe(queue, { reportId: event.reportId, data: bytesOf(event.data) });
    };
    return Effect.andThen(
      Effect.acquireRelease(
        Effect.sync(() => device.addEventListener("inputreport", listener)),
        () => Effect.sync(() => device.removeEventListener("inputreport", listener)),
      ),
      Effect.forkScoped(Effect.andThen(Deferred.await(closing), Queue.end(queue))),
    );
  });

const openDevice = (device: HidDeviceLike): Effect.Effect<Handle, HidError, Scope.Scope> =>
  Effect.gen(function* () {
    const closing = yield* Deferred.make<void>();
    const state = { closed: false };
    yield* Effect.acquireRelease(
      attempt("open", () => device.open()),
      () =>
        Effect.andThen(
          Effect.andThen(
            Effect.sync(() => {
              state.closed = true;
            }),
            Deferred.succeed(closing, undefined),
          ),
          Effect.ignore(attempt("open", () => device.close())),
        ),
    );
    const call = <A>(operation: Operation, run: () => Promise<A>): Effect.Effect<A, HidError> =>
      Effect.suspend(() =>
        state.closed
          ? Effect.fail(failure(operation, "Closed", undefined))
          : attempt(operation, run),
      );
    return {
      device,
      inputReports: Stream.unwrap(
        Effect.sync(() =>
          state.closed
            ? Stream.fail(failure("receive", "Closed", undefined))
            : reportsOf(device, closing),
        ),
      ),
      sendReport: (reportId, data) => call("send", () => device.sendReport(reportId, data)),
      sendFeatureReport: (reportId, data) =>
        call("send", () => device.sendFeatureReport(reportId, data)),
      receiveFeatureReport: (reportId) =>
        Effect.map(
          call("receive", () => device.receiveFeatureReport(reportId)),
          bytesOf,
        ),
    } satisfies Handle;
  });

/**
 * Builds a {@link HidService} over a `navigator.hid`; without one, the
 * unsupported service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/Hid"
 *
 * const hid = make({
 *   getDevices: () => Promise.resolve([]),
 *   addEventListener: () => {},
 *   removeEventListener: () => {},
 * })
 * Effect.runPromise(hid.devices).then(console.log) // []
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (hid?: HidLike): HidService =>
  Option.match(Option.fromUndefinedOr(hid), {
    onNone: (): HidService => ({
      supported: { hid: false, request: false },
      request: () => Effect.fail(failure("request", "Unsupported", undefined)),
      devices: Effect.fail(failure("devices", "Unsupported", undefined)),
      connections: Stream.fail(failure("devices", "Unsupported", undefined)),
      open: () => Effect.fail(failure("open", "Unsupported", undefined)),
    }),
    onSome: (self): HidService => ({
      supported: { hid: true, request: self.requestDevice !== undefined },
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

/** The ambient `navigator.hid` (a window's or a dedicated worker's), where it has one. */
const ambient = (): HidService => {
  // The `onLine` member only stops the annotation reading as a weak type.
  const scope: {
    readonly navigator?: { readonly hid?: HidLike } & Pick<Navigator, "onLine">;
  } = globalThis;
  return make(scope.navigator?.hid);
};

/**
 * WebHID. Defaults to the ambient `navigator.hid`, read on first use;
 * provide one built by {@link make} to replace it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Hid } from "@thomasfosterau/effect-platform-worker-shared/Hid"
 *
 * const program = Hid.use((hid) => Effect.succeed(hid.supported))
 * Effect.runPromise(program).then(console.log) // { hid: false, request: false } under Node
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const Hid: Context.Reference<HidService> = /*#__PURE__*/ Context.Reference(
  "@thomasfosterau/effect-platform-worker-shared/Hid",
  { defaultValue: ambient },
);

/**
 * Shows the device picker, from a user gesture, and returns the devices
 * the user chose: none when they closed it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { request } from "@thomasfosterau/effect-platform-worker-shared/Hid"
 *
 * const choose = request({ filters: [{ usagePage: 0x01, usage: 0x05 }] }) // gamepads
 * Effect.runPromise(Effect.flip(choose)).then((error) => console.log(error.reason)) // "Unsupported" under Node
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const request = (
  options: RequestOptions,
): Effect.Effect<ReadonlyArray<HidDeviceLike>, HidError> =>
  Hid.use((self) => self.request(options));

/**
 * The devices the page has been granted, in this context.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { devices } from "@thomasfosterau/effect-platform-worker-shared/Hid"
 *
 * Effect.runPromise(Effect.ignore(devices))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const devices: Effect.Effect<ReadonlyArray<HidDeviceLike>, HidError> = Hid.use(
  (self) => self.devices,
);

/**
 * Each granted device plugged in or unplugged.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { connections } from "@thomasfosterau/effect-platform-worker-shared/Hid"
 *
 * const log = connections.pipe(Stream.runForEach((event) => Effect.log(event.type, event.device.productName)))
 * Effect.runFork(Effect.ignore(log))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const connections: Stream.Stream<ConnectionEvent, HidError> = Stream.unwrap(
  Hid.use((self) => Effect.succeed(self.connections)),
);

/**
 * Opens `device` for the scope: read `inputReports`, send output and
 * feature reports; closing the scope closes it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { devices, open } from "@thomasfosterau/effect-platform-worker-shared/Hid"
 *
 * const firstReport = Effect.gen(function* () {
 *   const [device] = yield* devices
 *   if (device === undefined) return
 *   const handle = yield* open(device)
 *   return yield* Stream.runHead(handle.inputReports)
 * })
 * Effect.runPromise(Effect.ignore(Effect.scoped(firstReport)))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const open = (device: HidDeviceLike): Effect.Effect<Handle, HidError, Scope.Scope> =>
  Hid.use((self) => self.open(device));
