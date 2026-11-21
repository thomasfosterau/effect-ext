import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Hid from "@thomasfosterau/effect-platform-worker-shared/Hid";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

type ReportListener = (event: { readonly reportId: number; readonly data: DataView }) => void;

/** A device that records each call; the test fires its input reports. */
class StubDevice implements Hid.HidDeviceLike {
  readonly vendorId = 0x054c;
  readonly productId = 0x0ce6;
  readonly productName = "Pad";
  readonly collections = [{ usagePage: 1, usage: 5, inputReports: [{ reportId: 1 }] }];
  readonly calls: Array<string> = [];
  readonly listeners: Array<ReportListener> = [];
  opened = false;
  failOn?: { readonly call: string; readonly name: string };
  #record(call: string): Promise<void> {
    this.calls.push(call);
    return this.failOn?.call === call
      ? Promise.reject(new DOMException("no", this.failOn.name))
      : Promise.resolve();
  }
  open() {
    this.opened = true;
    return this.#record("open");
  }
  close() {
    this.opened = false;
    return this.#record("close");
  }
  sendReport(reportId: number, data: Uint8Array<ArrayBuffer>) {
    return this.#record(`report ${reportId} ${text(data)}`);
  }
  sendFeatureReport(reportId: number, data: Uint8Array<ArrayBuffer>) {
    return this.#record(`feature ${reportId} ${text(data)}`);
  }
  receiveFeatureReport(reportId: number) {
    return this.#record(`receive ${reportId}`).then(() => {
      const data = bytes(`f${reportId}`);
      return new DataView(data.buffer);
    });
  }
  addEventListener(_type: "inputreport", listener: ReportListener) {
    this.listeners.push(listener);
  }
  removeEventListener(_type: "inputreport", listener: ReportListener) {
    this.listeners.splice(this.listeners.indexOf(listener), 1);
  }
  report(reportId: number, data: string) {
    const encoded = bytes(`--${data}`);
    this.listeners
      .slice()
      .forEach((listener) => listener({ reportId, data: new DataView(encoded.buffer, 2) }));
  }
}

/** A `navigator.hid` over `devices`, with listeners the test fires. */
const stubHid = (devices: Array<Hid.HidDeviceLike>, picker = true) => {
  type Listener = (event: { readonly target: Hid.HidDeviceLike | null }) => void;
  const attached: Array<{ readonly type: string; readonly listener: Listener }> = [];
  const fire = (type: string, target: Hid.HidDeviceLike | null) =>
    attached.filter((entry) => entry.type === type).forEach((entry) => entry.listener({ target }));
  const calls: Array<unknown> = [];
  const base: Hid.HidLike = {
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
  const hid: Hid.HidLike = picker
    ? {
        ...base,
        requestDevice(this: unknown, options: Hid.RequestOptions) {
          calls.push({ self: this === hid, options });
          return Promise.resolve(devices);
        },
      }
    : base;
  return { hid, fire, calls, attached };
};

describe("Hid.make", () => {
  it.effect("requests, lists and follows devices", () =>
    Effect.gen(function* () {
      const device = new StubDevice();
      const { hid, fire, calls, attached } = stubHid([device]);
      const service = Hid.make(hid);
      expect(service.supported).toEqual({ hid: true, request: true });
      expect(yield* service.request({ filters: [{ usagePage: 1 }] })).toEqual([device]);
      expect(calls).toEqual([{ self: true, options: { filters: [{ usagePage: 1 }] } }]);
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
    }),
  );

  it.effect("has no picker in a worker, and nothing without WebHID", () =>
    Effect.gen(function* () {
      const worker = Hid.make(stubHid([], false).hid);
      expect(worker.supported).toEqual({ hid: true, request: false });
      expect((yield* Effect.flip(worker.request({ filters: [] }))).reason).toBe("Unsupported");

      const none = Hid.make();
      expect(none.supported).toEqual({ hid: false, request: false });
      expect((yield* Effect.flip(none.devices)).reason).toBe("Unsupported");
      expect((yield* Effect.flip(none.request({ filters: [] }))).reason).toBe("Unsupported");
      expect((yield* Effect.flip(Stream.runDrain(none.connections))).reason).toBe("Unsupported");
      expect((yield* Effect.flip(Effect.scoped(none.open(new StubDevice())))).reason).toBe(
        "Unsupported",
      );
      expect((yield* Effect.flip(Hid.devices)).reason).toBe("Unsupported");
    }),
  );
});

describe("Hid accessors", () => {
  it.effect("reach the provided service", () =>
    Effect.gen(function* () {
      const device = new StubDevice();
      const { hid, fire } = stubHid([device]);
      const program = Effect.fn("program")(function* () {
        expect(yield* Hid.request({ filters: [] })).toEqual([device]);
        expect(yield* Hid.devices).toEqual([device]);
        const events = yield* Effect.forkChild(Stream.runCollect(Stream.take(Hid.connections, 1)));
        yield* Effect.yieldNow;
        fire("connect", device);
        expect((yield* Hid.open(device)).device).toBe(device);
        return yield* Fiber.join(events);
      });
      expect(
        yield* Effect.scoped(Effect.provideService(program(), Hid.Hid, Hid.make(hid))),
      ).toEqual([{ type: "connect", device }]);
      expect(device.calls).toEqual(["open", "close"]);
    }),
  );
});

describe("Hid.open", () => {
  it.effect("streams input reports, sends reports, and ends with the scope", () =>
    Effect.gen(function* () {
      const device = new StubDevice();
      const scope = yield* Scope.make();
      const handle = yield* Scope.provide(Hid.make(stubHid([device]).hid).open(device), scope);
      const reports = yield* Effect.forkChild(Stream.runCollect(handle.inputReports));
      yield* Effect.yieldNow;
      device.report(1, "up");
      device.report(2, "down");

      yield* handle.sendReport(0, bytes("rumble"));
      yield* handle.sendFeatureReport(3, bytes("led"));
      expect(text(yield* handle.receiveFeatureReport(4))).toBe("f4");

      yield* Scope.close(scope, Exit.void);
      expect(
        (yield* Fiber.join(reports)).map((report) => [report.reportId, text(report.data)]),
      ).toEqual([
        [1, "up"],
        [2, "down"],
      ]);
      expect(device.listeners).toEqual([]);
      expect(device.calls).toEqual([
        "open",
        "report 0 rumble",
        "feature 3 led",
        "receive 4",
        "close",
      ]);

      expect((yield* Effect.flip(handle.sendReport(0, bytes("late")))).reason).toBe("Closed");
      expect((yield* Effect.flip(handle.receiveFeatureReport(1))).operation).toBe("receive");
      expect((yield* Effect.flip(Stream.runDrain(handle.inputReports))).reason).toBe("Closed");
    }),
  );

  it.effect("maps a failed open, and a refused report", () =>
    Effect.gen(function* () {
      const device = new StubDevice();
      const service = Hid.make(stubHid([device]).hid);
      device.failOn = { call: "open", name: "InvalidStateError" };
      const opened = yield* Effect.flip(Effect.scoped(service.open(device)));
      expect([opened.operation, opened.reason]).toEqual(["open", "InvalidState"]);

      device.failOn = { call: "report 9 x", name: "NotAllowedError" };
      const refused = yield* Effect.flip(
        Effect.scoped(
          Effect.flatMap(service.open(device), (handle) => handle.sendReport(9, bytes("x"))),
        ),
      );
      expect([refused.operation, refused.reason]).toEqual(["send", "NotAllowed"]);
    }),
  );
});
