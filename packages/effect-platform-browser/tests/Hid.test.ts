import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as P from "effect/Predicate";
import * as Stream from "effect/Stream";
import { Hid } from "@thomasfosterau/effect-platform-worker-shared";
import { TestHid } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const listener = () => {};

/** The name a platform call rejects with, or `"resolved"`. */
const outcome = <A>(call: () => Promise<A>): Effect.Effect<string> =>
  Effect.match(
    Effect.tryPromise({
      try: call,
      catch: (cause) => (P.hasProperty(cause, "name") ? String(cause.name) : "unnamed"),
    }),
    { onFailure: (name) => name, onSuccess: () => "resolved" },
  );

describe("TestHid", () => {
  it.effect("grants picked devices, and returns none when nothing is picked", () =>
    Effect.gen(function* () {
      const control = yield* TestHid.Control;
      const pad = yield* control.plug({
        vendorId: 0x054c,
        productId: 0x0ce6,
        productName: "Pad",
        collections: [{ usagePage: 1, usage: 5 }],
        granted: false,
      });
      expect(yield* Hid.devices).toEqual([]);
      yield* control.pick([pad, pad]);
      expect(yield* Hid.request({ filters: [{ usagePage: 1, usage: 5 }] })).toEqual([pad, pad]);
      expect(yield* Hid.devices).toEqual([pad]);
      expect(yield* Hid.request({ filters: [] })).toEqual([]);
      expect(yield* control.requests).toEqual([
        { filters: [{ usagePage: 1, usage: 5 }] },
        { filters: [] },
      ]);
      expect([pad.vendorId, pad.productId, pad.productName, pad.collections]).toEqual([
        0x054c,
        0x0ce6,
        "Pad",
        [{ usagePage: 1, usage: 5 }],
      ]);
    }).pipe(Effect.provide(TestHid.layer())),
  );

  it.effect("fires connect and disconnect for granted devices only", () =>
    Effect.gen(function* () {
      const control = yield* TestHid.Control;
      const events = yield* Effect.forkChild(Stream.runCollect(Stream.take(Hid.connections, 2)));
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
      expect((yield* Effect.flip(Effect.scoped(Hid.open(device)))).reason).toBe("Network");
    }).pipe(Effect.provide(TestHid.layer())),
  );

  it.effect("delivers input reports while open, answers feature reads, records sends", () =>
    Effect.gen(function* () {
      const control = yield* TestHid.Control;
      const device = yield* control.plug();
      device.input(1, bytes("before open"));
      const handle = yield* Hid.open(device);
      expect(device.opened).toBe(true);
      expect((yield* Effect.flip(Effect.scoped(Hid.open(device)))).reason).toBe("InvalidState");

      const reports = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(handle.inputReports, 2)),
      );
      yield* Effect.yieldNow;
      device.input(1, bytes("a"));
      device.input(2, bytes("b"));
      expect(
        (yield* Fiber.join(reports)).map((report) => [report.reportId, text(report.data)]),
      ).toEqual([
        [1, "a"],
        [2, "b"],
      ]);

      device.feature(3, bytes("old"));
      device.feature(3, bytes("v1"));
      expect(text(yield* handle.receiveFeatureReport(3))).toBe("v1");
      expect((yield* Effect.flip(handle.receiveFeatureReport(4))).reason).toBe("NotAllowed");
      yield* handle.sendReport(0, bytes("rumble"));
      yield* handle.sendFeatureReport(3, bytes("led"));
      expect(device.sent.map((sent) => [sent.kind, sent.reportId, text(sent.data)])).toEqual([
        ["output", 0, "rumble"],
        ["feature", 3, "led"],
      ]);

      yield* control.unplug(device);
      expect((yield* Effect.flip(handle.sendReport(0, bytes("x")))).reason).toBe("Network");
    }).pipe(Effect.scoped, Effect.provide(TestHid.layer())),
  );

  it.effect("closes with its scope, and refuses reports on a closed device", () =>
    Effect.gen(function* () {
      const device = yield* Effect.flatMap(TestHid.Control, (control) => control.plug());
      yield* Effect.scoped(Hid.open(device));
      expect(device.opened).toBe(false);
      expect(yield* outcome(() => device.sendReport(0, bytes("x")))).toBe("InvalidStateError");
      expect(yield* outcome(() => device.receiveFeatureReport(0))).toBe("InvalidStateError");
      device.addEventListener("inputreport", listener);
      device.removeEventListener("inputreport", listener);
      device.removeEventListener("inputreport", listener);
    }).pipe(Effect.provide(TestHid.layer())),
  );

  it.effect("leaves out the picker, or the whole API", () =>
    Effect.sync(() => {
      expect(TestHid.make({ picker: false }).hid.supported).toEqual({ hid: true, request: false });
      expect(TestHid.make({ supported: false }).hid.supported.hid).toBe(false);
      const bare = new TestHid.TestHidDevice({});
      expect([bare.vendorId, bare.productId, bare.productName, bare.collections]).toEqual([
        0,
        0,
        "",
        [],
      ]);
    }),
  );
});
