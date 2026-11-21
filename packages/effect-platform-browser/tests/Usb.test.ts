import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Stream from "effect/Stream";
import { Usb } from "@thomasfosterau/effect-platform-worker-shared";
import { TestUsb } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const setup = (request: number): Usb.ControlTransferSetup => ({
  requestType: "class",
  recipient: "interface",
  request,
  value: 0,
  index: 0,
});

/** The name a platform call rejects with, or `"resolved"`. */
const outcome = <A>(call: () => Promise<A>): Effect.Effect<string> =>
  Effect.match(
    Effect.tryPromise({
      try: call,
      catch: (cause) => (P.hasProperty(cause, "name") ? String(cause.name) : "unnamed"),
    }),
    { onFailure: (name) => name, onSuccess: () => "resolved" },
  );

describe("TestUsb", () => {
  it.effect("grants a picked device, and closes the picker when nothing is picked", () =>
    Effect.gen(function* () {
      const control = yield* TestUsb.Control;
      const device = yield* control.plug({
        vendorId: 0x2341,
        productId: 0x43,
        productName: "Uno",
        manufacturerName: "Arduino",
        serialNumber: "A1",
        granted: false,
      });
      expect(yield* Usb.devices).toEqual([]);
      yield* control.pick(device);
      expect(yield* Usb.request({ filters: [{ vendorId: 0x2341 }] })).toBe(device);
      yield* control.pick(device);
      expect(yield* Usb.request({ filters: [] })).toBe(device);
      expect(yield* Usb.devices).toEqual([device]);
      expect((yield* Effect.flip(Usb.request({ filters: [] }))).reason).toBe("NotFound");
      expect(yield* control.requests).toEqual([
        { filters: [{ vendorId: 0x2341 }] },
        { filters: [] },
        { filters: [] },
      ]);
      expect([device.productName, device.manufacturerName, device.serialNumber]).toEqual([
        "Uno",
        "Arduino",
        "A1",
      ]);
    }).pipe(Effect.provide(TestUsb.layer())),
  );

  it.effect("fires connect and disconnect for granted devices only", () =>
    Effect.gen(function* () {
      const control = yield* TestUsb.Control;
      const events = yield* Effect.forkChild(Stream.runCollect(Stream.take(Usb.connections, 2)));
      yield* Effect.yieldNow;
      const hidden = yield* control.plug({ granted: false });
      const device = yield* control.plug();
      yield* control.unplug(hidden);
      yield* control.unplug(device);
      expect(
        (yield* Fiber.join(events)).map((event) => [event.type, event.device === device]),
      ).toEqual([
        ["connect", true],
        ["disconnect", true],
      ]);
      expect(
        (yield* Effect.flip(Effect.scoped(Usb.open(device, { configuration: 1, interface: 0 }))))
          .reason,
      ).toBe("Network");
    }).pipe(Effect.provide(TestUsb.layer())),
  );

  it.effect("moves data, stalls and clears an endpoint, and fails when unplugged", () =>
    Effect.gen(function* () {
      const control = yield* TestUsb.Control;
      const device = yield* control.plug({
        configurations: [{ configurationValue: 2, interfaces: [0, 1] }],
      });
      const handle = yield* Usb.open(device, { configuration: 2, interface: 1, alternate: 1 });
      expect([device.opened, device.configuration, device.claimed, device.alternates]).toEqual([
        true,
        Option.some(2),
        [1],
        [[1, 1]],
      ]);

      device.send(1, bytes("queued"));
      expect(text(yield* handle.transferIn(1, 64))).toBe("queued");
      const waiting = yield* Effect.forkChild(handle.transferIn(1, 64));
      yield* Effect.yieldNow;
      device.send(2, bytes("other endpoint"));
      device.send(1, bytes("later"));
      expect(text(yield* Fiber.join(waiting))).toBe("later");
      expect(text(yield* handle.transferIn(2, 64))).toBe("other endpoint");
      device.send(1, bytes("too long"));
      expect((yield* Effect.flip(handle.transferIn(1, 3))).reason).toBe("Babble");

      expect(yield* handle.transferOut(3, bytes("ping"))).toBe(4);
      expect(device.written.map((entry) => [entry.endpoint, text(entry.data)])).toEqual([
        [3, "ping"],
      ]);

      const stalled = yield* Effect.forkChild(Effect.flip(handle.transferIn(1, 8)));
      const other = yield* Effect.forkChild(handle.transferIn(2, 8));
      yield* Effect.yieldNow;
      device.stall(1);
      device.stall(1);
      expect((yield* Fiber.join(stalled)).reason).toBe("Stall");
      expect((yield* Effect.flip(handle.transferOut(1, bytes("x")))).reason).toBe("Stall");
      expect((yield* Effect.flip(handle.transferIn(1, 8))).reason).toBe("Stall");
      yield* handle.clearHalt("in", 1);
      yield* handle.clearHalt("in", 1);
      device.send(1, bytes("back"));
      expect(text(yield* handle.transferIn(1, 8))).toBe("back");
      device.send(2, bytes("b"));
      expect(text(yield* Fiber.join(other))).toBe("b");

      device.reply(bytes("v2"));
      expect(text(yield* handle.controlTransferIn(setup(1), 8))).toBe("v2");
      expect(yield* handle.controlTransferIn(setup(2), 8)).toEqual(new Uint8Array(0));
      expect(yield* handle.controlTransferOut(setup(3), bytes("on"))).toBe(2);
      expect(yield* handle.controlTransferOut(setup(4))).toBe(0);
      expect(
        device.controls.map((record) => [
          record.setup.request,
          record.direction,
          Option.map(record.data, text),
        ]),
      ).toEqual([
        [1, "in", Option.none()],
        [2, "in", Option.none()],
        [3, "out", Option.some("on")],
        [4, "out", Option.none()],
      ]);

      const reports = yield* Effect.forkChild(Effect.flip(Stream.runDrain(handle.inbound(1, 8))));
      yield* Effect.yieldNow;
      yield* control.unplug(device);
      expect((yield* Fiber.join(reports)).reason).toBe("Network");
      expect((yield* Effect.flip(handle.transferOut(3, bytes("x")))).reason).toBe("Network");
    }).pipe(Effect.scoped, Effect.provide(TestUsb.layer())),
  );

  it.effect("aborts a waiting transfer when its scope closes", () =>
    Effect.gen(function* () {
      const device = yield* Effect.flatMap(TestUsb.Control, (control) => control.plug());
      const reading = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* Usb.open(device, { configuration: 1, interface: 0 });
          const fiber = yield* Effect.forkDetach(Effect.flip(handle.transferIn(1, 8)));
          yield* Effect.yieldNow;
          return fiber;
        }),
      );
      expect((yield* Fiber.join(reading)).reason).toBe("Aborted");
      expect([device.opened, device.configuration, device.claimed]).toEqual([
        false,
        Option.none(),
        [],
      ]);
    }).pipe(Effect.provide(TestUsb.layer())),
  );

  it.effect("follows the platform's order of open, configuration and claim", () =>
    Effect.gen(function* () {
      const device = yield* Effect.flatMap(TestUsb.Control, (control) => control.plug());
      expect(yield* outcome(() => device.selectConfiguration(1))).toBe("InvalidStateError");
      expect(yield* outcome(() => device.controlTransferIn(setup(1), 1))).toBe("InvalidStateError");
      expect(yield* outcome(() => device.open())).toBe("resolved");
      expect(yield* outcome(() => device.claimInterface(0))).toBe("InvalidStateError");
      expect(yield* outcome(() => device.transferIn(1, 1))).toBe("InvalidStateError");
      expect(yield* outcome(() => device.selectConfiguration(9))).toBe("NotFoundError");
      expect(yield* outcome(() => device.selectConfiguration(1))).toBe("resolved");
      expect(yield* outcome(() => device.claimInterface(5))).toBe("NotFoundError");
      expect(yield* outcome(() => device.selectAlternateInterface(0, 1))).toBe("InvalidStateError");
      expect(yield* outcome(() => device.releaseInterface(0))).toBe("InvalidStateError");
      expect(yield* outcome(() => device.claimInterface(0))).toBe("resolved");
      expect(yield* outcome(() => device.claimInterface(0))).toBe("resolved");
      expect(device.claimed).toEqual([0]);
      expect(yield* outcome(() => device.close())).toBe("resolved");
    }).pipe(Effect.provide(TestUsb.layer())),
  );

  it.effect("leaves out the picker, or the whole API", () =>
    Effect.sync(() => {
      const worker = TestUsb.make({ picker: false });
      expect(worker.usb.supported).toEqual({ usb: true, request: false });
      expect(TestUsb.make({ supported: false }).usb.supported.usb).toBe(false);
      expect([
        new TestUsb.TestUsbDevice({}).vendorId,
        new TestUsb.TestUsbDevice({}).productId,
      ]).toEqual([0, 0]);
    }),
  );
});
