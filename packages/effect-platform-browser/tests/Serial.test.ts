import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Stream from "effect/Stream";
import { Serial } from "@thomasfosterau/effect-platform-worker-shared";
import { TestSerial } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const bytes = (text: string) => new TextEncoder().encode(text);
/** The name a platform call rejects with, or `"resolved"`. */
const outcome = <A>(call: () => Promise<A>): Effect.Effect<string> =>
  Effect.match(
    Effect.tryPromise({
      try: call,
      catch: (cause) => (P.hasProperty(cause, "name") ? String(cause.name) : "unnamed"),
    }),
    { onFailure: (name) => name, onSuccess: () => "resolved" },
  );
const decode = (chunks: ReadonlyArray<Uint8Array>) =>
  chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");

describe("TestSerial", () => {
  it.effect("grants a picked port, and closes the picker when nothing is picked", () =>
    Effect.gen(function* () {
      const control = yield* TestSerial.Control;
      const port = yield* control.plug({ info: { usbVendorId: 0x2341 }, granted: false });
      expect(yield* Serial.ports).toEqual([]);
      yield* control.pick(port);
      expect(yield* Serial.request({ filters: [{ usbVendorId: 0x2341 }] })).toBe(port);
      yield* control.pick(port);
      expect(yield* Serial.request()).toBe(port);
      expect(yield* Serial.ports).toEqual([port]);
      expect((yield* Effect.flip(Serial.request())).reason).toBe("NotFound");
      expect(yield* control.requests).toEqual([
        Option.some({ filters: [{ usbVendorId: 0x2341 }] }),
        Option.none(),
        Option.none(),
      ]);
    }).pipe(Effect.provide(TestSerial.layer())),
  );

  it.effect("fires connect and disconnect for granted ports only", () =>
    Effect.gen(function* () {
      const control = yield* TestSerial.Control;
      const events = yield* Effect.forkChild(Stream.runCollect(Stream.take(Serial.connections, 2)));
      yield* Effect.yieldNow;
      const hidden = yield* control.plug({ granted: false });
      const port = yield* control.plug();
      yield* control.unplug(hidden);
      yield* control.unplug(port);
      expect(
        (yield* Fiber.join(events)).map((event) => [event.type, event.device === port]),
      ).toEqual([
        ["connect", true],
        ["disconnect", true],
      ]);
      expect(
        (yield* Effect.flip(Effect.scoped(Serial.open(port, { baudRate: 9600 })))).reason,
      ).toBe("Network");
    }).pipe(Effect.provide(TestSerial.layer())),
  );

  it.effect("delivers bytes, recovers from a read error, and fails the read when unplugged", () =>
    Effect.gen(function* () {
      const control = yield* TestSerial.Control;
      const port = yield* control.plug();
      const connection = yield* Serial.open(port, { baudRate: 115200, parity: "even" });
      expect(port.options).toEqual(Option.some({ baudRate: 115200, parity: "even" }));
      expect(
        (yield* Effect.flip(Effect.scoped(Serial.open(port, { baudRate: 9600 })))).reason,
      ).toBe("InvalidState");

      const first = yield* Effect.forkChild(Effect.flip(Stream.runDrain(connection.read)));
      yield* Effect.yieldNow;
      port.fail("ParityError");
      expect((yield* Fiber.join(first)).reason).toBe("Parity");

      const second = yield* Effect.forkChild(Stream.runCollect(Stream.take(connection.read, 1)));
      yield* Effect.yieldNow;
      port.send(bytes("ready"));
      expect(decode(yield* Fiber.join(second))).toBe("ready");

      yield* connection.setSignals({ requestToSend: true });
      yield* connection.setSignals({ break: false });
      expect(port.signals).toEqual({ requestToSend: true, break: false });
      expect((yield* connection.signals).clearToSend).toBe(true);
      yield* connection.write(bytes("go"));
      expect(decode(port.written)).toBe("go");

      const third = yield* Effect.forkChild(Effect.flip(Stream.runDrain(connection.read)));
      yield* Effect.yieldNow;
      yield* control.unplug(port);
      expect((yield* Fiber.join(third)).reason).toBe("Network");
      expect((yield* Effect.flip(connection.write(bytes("x")))).reason).toBe("Network");
    }).pipe(Effect.scoped, Effect.provide(TestSerial.layer())),
  );

  it.effect("closes the port with its scope, while a read runs", () =>
    Effect.gen(function* () {
      const control = yield* TestSerial.Control;
      const port = yield* control.plug();
      const reading = yield* Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* Serial.open(port, { baudRate: 9600 });
          const fiber = yield* Effect.forkDetach(Stream.runDrain(connection.read));
          yield* Effect.yieldNow;
          return fiber;
        }),
      );
      yield* Fiber.join(reading);
      expect([port.readable, port.writable, port.options]).toEqual([null, null, Option.none()]);
      port.send(bytes("after close"));
      port.fail("BreakError");
    }).pipe(Effect.provide(TestSerial.layer())),
  );

  it.effect("refuses signals on a closed port, and closing one with a locked stream", () =>
    Effect.gen(function* () {
      const port = yield* Effect.flatMap(TestSerial.Control, (control) => control.plug());
      expect(yield* outcome(() => port.setSignals({}))).toBe("InvalidStateError");
      expect(yield* outcome(() => port.getSignals())).toBe("InvalidStateError");
      expect(yield* outcome(() => port.open({ baudRate: 9600 }))).toBe("resolved");
      const reader = port.readable?.getReader();
      expect(yield* outcome(() => port.close())).toBe("TypeError");
      reader?.releaseLock();
      expect(yield* outcome(() => port.close())).toBe("resolved");
    }).pipe(Effect.provide(TestSerial.layer())),
  );

  it.effect("leaves out the picker, or the whole API", () =>
    Effect.sync(() => {
      const worker = TestSerial.make({ picker: false });
      expect(worker.serial.supported).toEqual({ serial: true, request: false });
      expect(TestSerial.make({ supported: false }).serial.supported.serial).toBe(false);
    }),
  );
});
