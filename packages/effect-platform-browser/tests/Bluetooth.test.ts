import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { Bluetooth } from "@thomasfosterau/effect-platform-browser";
import { observe, TestBluetooth } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

/** The name a platform call rejects with, or `"resolved"`. */
const outcome = <A>(call: () => Promise<A>): Effect.Effect<string> =>
  Effect.match(
    Effect.tryPromise({
      try: call,
      catch: (cause) => (P.hasProperty(cause, "name") ? String(cause.name) : "unnamed"),
    }),
    { onFailure: (name) => name, onSuccess: () => "resolved" },
  );

/** A platform call that should resolve. */
const platform = <A>(call: () => Promise<A>) =>
  Effect.tryPromise({ try: call, catch: () => "rejected" as const });

/** The double's characteristic, failing the test where the tree has none. */
const fakeOf = (
  device: TestBluetooth.TestBluetoothDevice,
  service: number,
  characteristic: number,
) => Effect.fromOption(device.characteristic(service, characteristic));

const HEART_RATE = 0x180d;
const MEASUREMENT = 0x2a37;
const CONTROL_POINT = 0x2a39;

const sensor = {
  name: "Strap",
  services: [
    {
      uuid: HEART_RATE,
      characteristics: [
        { uuid: MEASUREMENT, value: bytes("60"), write: false },
        { uuid: CONTROL_POINT, read: false, notify: false },
      ],
    },
  ],
};

describe("Bluetooth.canonicalUuid", () => {
  it("expands an alias and lowercases a UUID", () => {
    expect(Bluetooth.canonicalUuid(0x2a37)).toBe("00002a37-0000-1000-8000-00805f9b34fb");
    expect(Bluetooth.canonicalUuid(0xfeedbeef)).toBe("feedbeef-0000-1000-8000-00805f9b34fb");
    expect(Bluetooth.canonicalUuid("ABCD-EF")).toBe("abcd-ef");
  });
});

describe("Bluetooth.make", () => {
  it.effect("without Web Bluetooth, fails each call and is unavailable", () =>
    Effect.gen(function* () {
      const none = Bluetooth.make();
      expect(none.supported).toEqual({ bluetooth: false, devices: false });
      expect((yield* Effect.flip(none.request({ acceptAllDevices: true }))).reason).toBe(
        "Unsupported",
      );
      expect((yield* Effect.flip(none.devices)).reason).toBe("Unsupported");
      expect(yield* Stream.runCollect(none.availability)).toEqual([false]);
      const device = yield* Effect.flatMap(TestBluetooth.Control, (control) => control.add());
      expect((yield* Effect.flip(Effect.scoped(none.connect(device)))).reason).toBe("Unsupported");
    }).pipe(Effect.provide(TestBluetooth.layer())),
  );

  it.effect("maps an unnamed rejection to Failed, and calls getDevices on the API", () =>
    Effect.gen(function* () {
      const calls: Array<boolean> = [];
      const api: Bluetooth.BluetoothLike = {
        addEventListener: () => {},
        removeEventListener: () => {},
        getAvailability: () => Promise.reject({ message: "no adapter" }),
        requestDevice: () => Promise.reject({ message: "broken" }),
        getDevices(this: unknown) {
          calls.push(this === api);
          return Promise.resolve([]);
        },
      };
      const service = Bluetooth.make(api);
      const failed = yield* Effect.flip(service.request({ filters: [{ namePrefix: "x" }] }));
      expect([failed.operation, failed.reason]).toEqual(["request", "Failed"]);
      expect(yield* service.devices).toEqual([]);
      expect(calls).toEqual([true]);
      expect(yield* Stream.runCollect(Stream.take(service.availability, 1))).toEqual([false]);
    }),
  );

  it.effect("drops an availability answer a change overtook", () =>
    Effect.gen(function* () {
      const target = new EventTarget();
      const answer = { resolve: (_available: boolean): void => {} };
      const service = Bluetooth.make({
        addEventListener: (type, listener) => target.addEventListener(type, listener),
        removeEventListener: (type, listener) => target.removeEventListener(type, listener),
        getAvailability: () =>
          new Promise<boolean>((resolve) => {
            answer.resolve = resolve;
          }),
        requestDevice: () => Promise.reject(new DOMException("closed", "NotFoundError")),
      });
      const seen = yield* Effect.forkChild(Stream.runCollect(Stream.take(service.availability, 2)));
      yield* Effect.yieldNow;
      target.dispatchEvent(Object.assign(new Event("availabilitychanged"), { value: false }));
      answer.resolve(true);
      yield* Effect.yieldNow;
      target.dispatchEvent(Object.assign(new Event("availabilitychanged"), { value: true }));
      expect(yield* Fiber.join(seen)).toEqual([false, true]);
    }),
  );
});

describe("Bluetooth picker and devices", () => {
  it.effect("returns the picked device, granting it, and fails NotFound when closed", () =>
    Effect.gen(function* () {
      const control = yield* TestBluetooth.Control;
      const hidden = yield* control.add({ id: "strap", ...sensor, granted: false });
      const shown = yield* control.add();
      expect(yield* Bluetooth.devices).toEqual([shown]);

      const closed = yield* Effect.flip(Bluetooth.request({ acceptAllDevices: true }));
      expect([closed.operation, closed.reason]).toEqual(["request", "NotFound"]);
      yield* control.pick(hidden);
      const options = {
        filters: [{ services: [HEART_RATE] }],
        optionalServices: ["battery_service"],
      };
      const picked = yield* Bluetooth.request(options);
      expect([picked.id, picked.name]).toEqual(["strap", "Strap"]);
      expect(yield* Bluetooth.devices).toEqual([shown, hidden]);
      yield* control.pick(shown);
      expect(yield* Bluetooth.request({ acceptAllDevices: true })).toBe(shown);
      expect(yield* Bluetooth.devices).toEqual([shown, hidden]);
      expect(yield* control.requests).toEqual([
        { acceptAllDevices: true },
        options,
        { acceptAllDevices: true },
      ]);
      expect([shown.id, shown.name]).toEqual(["device-2", undefined]);
    }).pipe(Effect.provide(TestBluetooth.layer())),
  );

  it.effect("leaves out getDevices, or the whole API", () =>
    Effect.gen(function* () {
      const bare = TestBluetooth.make({ getDevices: false }).bluetooth;
      expect(bare.supported).toEqual({ bluetooth: true, devices: false });
      expect((yield* Effect.flip(bare.devices)).reason).toBe("Unsupported");
      expect(TestBluetooth.make({ supported: false }).bluetooth.supported.bluetooth).toBe(false);
    }),
  );

  it.effect("follows the adapter's availability", () =>
    Effect.gen(function* () {
      const control = yield* TestBluetooth.Control;
      const seen = yield* observe(Bluetooth.availability, 3);
      yield* control.setAvailable(true);
      yield* control.setAvailable(false);
      yield* control.setAvailable(true);
      expect(yield* Fiber.join(seen)).toEqual([true, false, true]);
    }).pipe(Effect.provide(TestBluetooth.layer())),
  );
});

describe("Bluetooth.connect", () => {
  it.effect("reads, writes and finds services and characteristics", () =>
    Effect.gen(function* () {
      const control = yield* TestBluetooth.Control;
      const device = yield* control.add(sensor);
      const connection = yield* Bluetooth.connect(device);
      expect(connection.device).toBe(device);
      expect(yield* connection.connected).toBe(true);

      const service = yield* connection.service(HEART_RATE);
      expect(service.uuid).toBe(Bluetooth.canonicalUuid(HEART_RATE));
      const measurement = yield* service.characteristic(MEASUREMENT);
      expect(measurement.uuid).toBe(Bluetooth.canonicalUuid(MEASUREMENT));
      expect(text(yield* measurement.read)).toBe("60");
      const refused = yield* Effect.flip(measurement.write(bytes("x")));
      expect([refused.operation, refused.reason]).toEqual(["write", "NotSupported"]);

      const point = yield* service.characteristic(CONTROL_POINT);
      yield* point.write(bytes("reset"));
      yield* point.write(bytes("quiet"), { response: false });
      expect((yield* Effect.flip(point.read)).reason).toBe("NotSupported");
      expect((yield* Effect.flip(Stream.runDrain(point.notifications))).reason).toBe(
        "NotSupported",
      );
      const { written } = yield* fakeOf(device, HEART_RATE, CONTROL_POINT);
      expect(written.map((entry) => [text(entry.data), entry.response])).toEqual([
        ["reset", true],
        ["quiet", false],
      ]);

      const noService = yield* Effect.flip(connection.service(0x180f));
      expect([noService.operation, noService.reason]).toEqual(["service", "NotFound"]);
      const noCharacteristic = yield* Effect.flip(service.characteristic(0x2a00));
      expect([noCharacteristic.operation, noCharacteristic.reason]).toEqual([
        "characteristic",
        "NotFound",
      ]);
    }).pipe(Effect.scoped, Effect.provide(TestBluetooth.layer())),
  );

  it.effect("streams notifications while they are on, and stops them with the stream", () =>
    Effect.gen(function* () {
      const control = yield* TestBluetooth.Control;
      const device = yield* control.add(sensor);
      const measurement = yield* Bluetooth.connect(device).pipe(
        Effect.flatMap((connection) => connection.service(HEART_RATE)),
        Effect.flatMap((service) => service.characteristic(MEASUREMENT)),
      );
      const fake = yield* fakeOf(device, HEART_RATE, MEASUREMENT);
      yield* control.notify(device, HEART_RATE, MEASUREMENT, bytes("before"));
      const seen = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(measurement.notifications, 2)),
      );
      yield* Effect.yieldNow;
      expect(fake.notifying).toBe(true);
      yield* control.notify(device, HEART_RATE, MEASUREMENT, bytes("61"));
      yield* control.notify(device, HEART_RATE, 0x2a00, bytes("nowhere"));
      yield* control.notify(device, HEART_RATE, MEASUREMENT, bytes("62"));
      expect((yield* Fiber.join(seen)).map(text)).toEqual(["61", "62"]);
      expect(fake.notifying).toBe(false);
      expect(text(yield* measurement.read)).toBe("62");
    }).pipe(Effect.scoped, Effect.provide(TestBluetooth.layer())),
  );

  it.effect("fails work once the link drops, and reconnects when back in range", () =>
    Effect.gen(function* () {
      const control = yield* TestBluetooth.Control;
      const device = yield* control.add(sensor);
      const scope = yield* Scope.make();
      const connection = yield* Scope.provide(Bluetooth.connect(device), scope);
      const measurement = yield* Effect.flatMap(connection.service(HEART_RATE), (service) =>
        service.characteristic(MEASUREMENT),
      );
      const seen = yield* Effect.forkChild(Stream.runCollect(measurement.notifications));
      yield* Effect.yieldNow;

      yield* control.setInRange(device, false);
      const lost = yield* Effect.flip(Fiber.join(seen));
      expect([lost.operation, lost.reason]).toEqual(["notifications", "Disconnected"]);
      expect(yield* connection.connected).toBe(false);
      expect((yield* Effect.flip(measurement.read)).reason).toBe("Disconnected");
      expect((yield* Effect.flip(connection.service(HEART_RATE))).reason).toBe("Disconnected");
      expect((yield* Effect.flip(Effect.scoped(Bluetooth.connect(device)))).reason).toBe(
        "Disconnected",
      );
      yield* Scope.close(scope, Exit.void);

      yield* control.setInRange(device, true);
      const again = yield* Bluetooth.connect(device);
      expect(yield* again.connected).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(TestBluetooth.layer())),
  );

  it.effect("disconnects with its scope, ending notifications and refusing calls", () =>
    Effect.gen(function* () {
      const control = yield* TestBluetooth.Control;
      const device = yield* control.add(sensor);
      const scope = yield* Scope.make();
      const connection = yield* Scope.provide(Bluetooth.connect(device), scope);
      const service = yield* connection.service(HEART_RATE);
      const measurement = yield* service.characteristic(MEASUREMENT);
      const seen = yield* Effect.forkChild(Stream.runCollect(measurement.notifications));
      yield* Effect.yieldNow;
      yield* control.notify(device, HEART_RATE, MEASUREMENT, bytes("70"));

      yield* Scope.close(scope, Exit.void);
      expect((yield* Fiber.join(seen)).map(text)).toEqual(["70"]);
      expect(device.gatt.connected).toBe(false);
      expect(yield* connection.connected).toBe(false);
      const closed = yield* Effect.flip(measurement.read);
      expect([closed.operation, closed.reason]).toEqual(["read", "Closed"]);
      expect((yield* Effect.flip(service.characteristic(MEASUREMENT))).reason).toBe("Closed");
      expect((yield* Effect.flip(Stream.runDrain(measurement.notifications))).reason).toBe(
        "Closed",
      );
    }).pipe(Effect.provide(TestBluetooth.layer())),
  );

  it.effect("refuses a device whose GATT server the page may not reach", () =>
    Effect.gen(function* () {
      const device = Object.assign(new EventTarget(), { id: "x" });
      const refused = yield* Effect.flip(Effect.scoped(Bluetooth.connect(device)));
      expect([refused.operation, refused.reason]).toEqual(["connect", "NotAllowed"]);
    }).pipe(Effect.provide(TestBluetooth.layer())),
  );
});

describe("TestBluetooth", () => {
  it.effect("follows the platform while disconnected", () =>
    Effect.gen(function* () {
      const device = yield* Effect.flatMap(TestBluetooth.Control, (control) =>
        control.add({
          services: [{ uuid: 1, characteristics: [{ uuid: 2, notify: false }] }, { uuid: 3 }],
        }),
      );
      const characteristic = yield* fakeOf(device, 1, 2);
      expect(characteristic.value).toBeUndefined();
      expect(Option.isNone(device.characteristic(3, 2))).toBe(true);
      expect(Option.isNone(device.characteristic(4, 2))).toBe(true);
      expect(yield* outcome(() => device.gatt.getPrimaryService(1))).toBe("NetworkError");
      expect(yield* outcome(() => characteristic.readValue())).toBe("NetworkError");

      yield* platform(() => device.gatt.connect());
      const service = yield* platform(() => device.gatt.getPrimaryService(1));
      expect((yield* platform(() => characteristic.readValue())).byteLength).toBe(0);
      expect(yield* outcome(() => characteristic.stopNotifications())).toBe("NotSupportedError");
      device.gatt.disconnect();
      device.gatt.disconnect();
      expect(yield* outcome(() => service.getCharacteristic(2))).toBe("NetworkError");
    }).pipe(Effect.provide(TestBluetooth.layer())),
  );
});
