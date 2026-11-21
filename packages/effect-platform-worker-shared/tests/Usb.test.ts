import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Usb from "@thomasfosterau/effect-platform-worker-shared/Usb";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const view = (data: Uint8Array<ArrayBuffer>) => new DataView(data.buffer);

/** A device that records each call and answers from `results`. */
class StubDevice implements Usb.UsbDeviceLike {
  readonly vendorId = 0x2341;
  readonly productId = 0x43;
  readonly calls: Array<string> = [];
  /** The next IN results, in order; then an empty `ok`. */
  readonly results: Array<Usb.InTransferResultLike> = [];
  outStatus: Usb.TransferStatus = "ok";
  failOn?: { readonly call: string; readonly name: string };
  #record(call: string): Promise<void> {
    this.calls.push(call);
    return this.failOn?.call === call
      ? Promise.reject(new DOMException("no", this.failOn.name))
      : Promise.resolve();
  }
  open() {
    return this.#record("open");
  }
  close() {
    return this.#record("close");
  }
  selectConfiguration(value: number) {
    return this.#record(`configuration ${value}`);
  }
  claimInterface(number: number) {
    return this.#record(`claim ${number}`);
  }
  releaseInterface(number: number) {
    return this.#record(`release ${number}`);
  }
  selectAlternateInterface(number: number, alternate: number) {
    return this.#record(`alternate ${number} ${alternate}`);
  }
  #in(call: string): Promise<Usb.InTransferResultLike> {
    return this.#record(call).then(() => this.results.shift() ?? { status: "ok" });
  }
  transferIn(endpoint: number, length: number) {
    return this.#in(`in ${endpoint} ${length}`);
  }
  controlTransferIn(setup: Usb.ControlTransferSetup, length: number) {
    return this.#in(`control-in ${setup.request} ${length}`);
  }
  #out(call: string, data: Uint8Array | undefined): Promise<Usb.OutTransferResultLike> {
    return this.#record(call).then(() => ({
      bytesWritten: data?.length ?? 0,
      status: this.outStatus,
    }));
  }
  transferOut(endpoint: number, data: Uint8Array<ArrayBuffer>) {
    return this.#out(`out ${endpoint} ${text(data)}`, data);
  }
  controlTransferOut(setup: Usb.ControlTransferSetup, data?: Uint8Array<ArrayBuffer>) {
    return this.#out(`control-out ${setup.request} ${data === undefined ? "-" : text(data)}`, data);
  }
  clearHalt(direction: "in" | "out", endpoint: number) {
    return this.#record(`clear ${direction} ${endpoint}`);
  }
}

const setup = (request: number): Usb.ControlTransferSetup => ({
  requestType: "vendor",
  recipient: "device",
  request,
  value: 0,
  index: 0,
});

/** A `navigator.usb` over `devices`, with listeners the test fires. */
const stubUsb = (devices: Array<Usb.UsbDeviceLike>, picker = true) => {
  type Listener = (event: { readonly target: Usb.UsbDeviceLike | null }) => void;
  const attached: Array<{ readonly type: string; readonly listener: Listener }> = [];
  const fire = (type: string, target: Usb.UsbDeviceLike | null) =>
    attached.filter((entry) => entry.type === type).forEach((entry) => entry.listener({ target }));
  const calls: Array<unknown> = [];
  const base: Usb.UsbLike = {
    getDevices: () => Promise.resolve(devices),
    addEventListener: (type, listener) => {
      attached.push({ type, listener });
    },
    removeEventListener: (type, listener) => {
      const index = attached.findIndex(
        (entry) => entry.type === type && entry.listener === listener,
      );
      if (index >= 0) attached.splice(index, 1);
    },
  };
  const usb: Usb.UsbLike = picker
    ? {
        ...base,
        requestDevice(this: unknown, options: Usb.RequestOptions) {
          calls.push({ self: this === usb, options });
          return devices[0] === undefined
            ? Promise.reject(new DOMException("closed", "NotFoundError"))
            : Promise.resolve(devices[0]);
        },
      }
    : base;
  return { usb, fire, calls, attached };
};

describe("Usb.make", () => {
  it.effect("requests, lists and follows devices", () =>
    Effect.gen(function* () {
      const device = new StubDevice();
      const { usb, fire, calls, attached } = stubUsb([device]);
      const service = Usb.make(usb);
      expect(service.supported).toEqual({ usb: true, request: true });
      expect(yield* service.request({ filters: [{ vendorId: 0x2341 }] })).toBe(device);
      expect(calls).toEqual([{ self: true, options: { filters: [{ vendorId: 0x2341 }] } }]);
      expect(yield* service.devices).toEqual([device]);

      const events = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(service.connections, 2)),
      );
      yield* Effect.yieldNow;
      fire("connect", null);
      fire("connect", device);
      fire("disconnect", device);
      expect(yield* Fiber.join(events)).toEqual([
        { type: "connect", device },
        { type: "disconnect", device },
      ]);
      expect(attached).toEqual([]);

      const closed = Usb.make(stubUsb([]).usb);
      expect((yield* Effect.flip(closed.request({ filters: [] }))).reason).toBe("NotFound");
    }),
  );

  it.effect("has no picker in a worker, and nothing without WebUSB", () =>
    Effect.gen(function* () {
      const worker = Usb.make(stubUsb([], false).usb);
      expect(worker.supported).toEqual({ usb: true, request: false });
      expect((yield* Effect.flip(worker.request({ filters: [] }))).reason).toBe("Unsupported");

      const none = Usb.make();
      expect(none.supported).toEqual({ usb: false, request: false });
      expect((yield* Effect.flip(none.devices)).reason).toBe("Unsupported");
      expect((yield* Effect.flip(none.request({ filters: [] }))).reason).toBe("Unsupported");
      expect((yield* Effect.flip(Stream.runDrain(none.connections))).reason).toBe("Unsupported");
      expect(
        (yield* Effect.flip(
          Effect.scoped(none.open(new StubDevice(), { configuration: 1, interface: 0 })),
        )).reason,
      ).toBe("Unsupported");
      expect((yield* Effect.flip(Usb.devices)).reason).toBe("Unsupported");
    }),
  );
});

describe("Usb accessors", () => {
  it.effect("reach the provided service", () =>
    Effect.gen(function* () {
      const device = new StubDevice();
      const { usb, fire } = stubUsb([device]);
      const program = Effect.fn("program")(function* () {
        expect(yield* Usb.request({ filters: [] })).toBe(device);
        expect(yield* Usb.devices).toEqual([device]);
        const events = yield* Effect.forkChild(Stream.runCollect(Stream.take(Usb.connections, 1)));
        yield* Effect.yieldNow;
        fire("connect", device);
        const handle = yield* Usb.open(device, { configuration: 1, interface: 0 });
        expect(handle.device).toBe(device);
        return yield* Fiber.join(events);
      });
      expect(
        yield* Effect.scoped(Effect.provideService(program(), Usb.Usb, Usb.make(usb))),
      ).toEqual([{ type: "connect", device }]);
      expect(device.calls).toEqual(["open", "configuration 1", "claim 0", "release 0", "close"]);
    }),
  );
});

describe("Usb.open", () => {
  it.effect("claims, transfers, then releases and closes with the scope", () =>
    Effect.gen(function* () {
      const device = new StubDevice();
      const scope = yield* Scope.make();
      const handle = yield* Scope.provide(
        Usb.make(stubUsb([device]).usb).open(device, {
          configuration: 2,
          interface: 1,
          alternate: 3,
        }),
        scope,
      );
      device.results.push({ status: "ok", data: view(bytes("hello")) });
      expect(text(yield* handle.transferIn(0x81, 64))).toBe("hello");
      expect(yield* handle.transferIn(0x81, 64)).toEqual(new Uint8Array(0));
      expect(yield* handle.transferOut(2, bytes("ping"))).toBe(4);

      device.results.push({ status: "ok", data: view(bytes("a")) }, { status: "ok", data: null });
      expect(
        (yield* Stream.runCollect(Stream.take(handle.inbound(3, 8), 2))).map((data) => data.length),
      ).toEqual([1, 0]);

      device.results.push({ status: "ok", data: view(bytes("v1")) });
      expect(text(yield* handle.controlTransferIn(setup(6), 2))).toBe("v1");
      expect(yield* handle.controlTransferOut(setup(9), bytes("on"))).toBe(2);
      expect(yield* handle.controlTransferOut(setup(10))).toBe(0);
      yield* handle.clearHalt("in", 1);

      yield* Scope.close(scope, Exit.void);
      expect(device.calls).toEqual([
        "open",
        "configuration 2",
        "claim 1",
        "alternate 1 3",
        "in 129 64",
        "in 129 64",
        "out 2 ping",
        "in 3 8",
        "in 3 8",
        "control-in 6 2",
        "control-out 9 on",
        "control-out 10 -",
        "clear in 1",
        "release 1",
        "close",
      ]);
      expect((yield* Effect.flip(handle.transferIn(1, 1))).reason).toBe("Closed");
      expect((yield* Effect.flip(handle.controlTransferOut(setup(1)))).operation).toBe("control");
    }),
  );

  it.effect("fails a stalled or babbling transfer, and maps rejections", () =>
    Effect.gen(function* () {
      const device = new StubDevice();
      const handle = yield* Usb.make(stubUsb([device]).usb).open(device, {
        configuration: 1,
        interface: 0,
      });
      device.results.push({ status: "stall" }, { status: "babble" });
      expect((yield* Effect.flip(handle.transferIn(1, 8))).reason).toBe("Stall");
      expect((yield* Effect.flip(handle.controlTransferIn(setup(1), 8))).reason).toBe("Babble");
      device.outStatus = "stall";
      expect((yield* Effect.flip(handle.transferOut(1, bytes("x")))).reason).toBe("Stall");
      device.failOn = { call: "in 5 8", name: "NetworkError" };
      expect((yield* Effect.flip(Stream.runDrain(handle.inbound(5, 8)))).reason).toBe("Network");
      device.failOn = { call: "clear out 1", name: "UnknownError" };
      const odd = yield* Effect.flip(handle.clearHalt("out", 1));
      expect([odd.operation, odd.reason]).toEqual(["clearHalt", "Failed"]);
    }).pipe(Effect.scoped),
  );

  it.effect("closes the device when claiming the interface fails", () =>
    Effect.gen(function* () {
      const device = new StubDevice();
      device.failOn = { call: "claim 4", name: "NetworkError" };
      const error = yield* Effect.flip(
        Effect.scoped(
          Usb.make(stubUsb([device]).usb).open(device, { configuration: 1, interface: 4 }),
        ),
      );
      expect([error.operation, error.reason]).toEqual(["open", "Network"]);
      expect(device.calls).toEqual(["open", "configuration 1", "claim 4", "close"]);
    }),
  );
});
