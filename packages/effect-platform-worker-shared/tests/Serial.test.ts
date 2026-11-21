import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Serial from "@thomasfosterau/effect-platform-worker-shared/Serial";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (chunks: ReadonlyArray<Uint8Array>) =>
  chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");

/** A port the test feeds; `close` rejects while a stream is locked, as Chromium's does. */
class StubPort implements Serial.SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  readonly written: Array<string> = [];
  readonly closes: Array<string> = [];
  signals: Serial.OutputSignals = {};
  controller?: ReadableStreamDefaultController<Uint8Array>;
  failOpen?: string;
  getInfo() {
    return { usbVendorId: 1 };
  }
  open(_options: Serial.SerialOptions) {
    if (this.failOpen !== undefined) return Promise.reject(new DOMException("no", this.failOpen));
    this.fresh();
    this.writable = new WritableStream({
      write: (chunk) => {
        this.written.push(text([chunk]));
      },
    });
    return Promise.resolve();
  }
  fresh() {
    this.readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }
  close() {
    if (this.readable?.locked === true || this.writable?.locked === true) {
      this.closes.push("locked");
      return Promise.reject(new TypeError("locked"));
    }
    this.closes.push("closed");
    this.readable = null;
    this.writable = null;
    return Promise.resolve();
  }
  setSignals(signals: Serial.OutputSignals) {
    this.signals = signals;
    return Promise.resolve();
  }
  getSignals() {
    return Promise.resolve({
      dataCarrierDetect: true,
      clearToSend: true,
      ringIndicator: false,
      dataSetReady: true,
    });
  }
}

/** A `navigator.serial` over `ports`, with listeners the test fires. */
const stubSerial = (ports: Array<Serial.SerialPortLike>, picker = true) => {
  type Listener = (event: { readonly target: Serial.SerialPortLike | null }) => void;
  const attached: Array<{ readonly type: string; readonly listener: Listener }> = [];
  const listeners = {
    fire: (type: string, target: Serial.SerialPortLike | null) =>
      attached
        .filter((entry) => entry.type === type)
        .forEach((entry) => entry.listener({ target })),
    size: () => attached.length,
  };
  const calls: Array<unknown> = [];
  const base: Serial.SerialLike = {
    getPorts: () => Promise.resolve(ports),
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
  const serial: Serial.SerialLike = picker
    ? {
        ...base,
        requestPort(this: unknown, options?: Serial.RequestOptions) {
          calls.push({ self: this === serial, options });
          return ports[0] === undefined
            ? Promise.reject(new DOMException("closed", "NotFoundError"))
            : Promise.resolve(ports[0]);
        },
      }
    : base;
  return { serial, listeners, calls };
};

describe("Serial.make", () => {
  it.effect("requests, lists and follows ports", () =>
    Effect.gen(function* () {
      const port = new StubPort();
      const { serial, listeners, calls } = stubSerial([port]);
      const service = Serial.make(serial);
      expect(service.supported).toEqual({ serial: true, request: true });
      expect(yield* service.request()).toBe(port);
      expect(yield* service.request({ filters: [{ usbVendorId: 1 }] })).toBe(port);
      expect(calls).toEqual([
        { self: true, options: undefined },
        { self: true, options: { filters: [{ usbVendorId: 1 }] } },
      ]);
      expect(yield* service.ports).toEqual([port]);

      const events = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(service.connections, 2)),
      );
      yield* Effect.yieldNow;
      listeners.fire("connect", null);
      listeners.fire("connect", port);
      listeners.fire("disconnect", port);
      expect(yield* Fiber.join(events)).toEqual([
        { type: "connect", device: port },
        { type: "disconnect", device: port },
      ]);
      expect(listeners.size()).toBe(0);

      const closed = Serial.make(stubSerial([]).serial);
      expect((yield* Effect.flip(closed.request())).reason).toBe("NotFound");
    }),
  );

  it.effect("has no picker in a worker, and nothing without Web Serial", () =>
    Effect.gen(function* () {
      const worker = Serial.make(stubSerial([], false).serial);
      expect(worker.supported).toEqual({ serial: true, request: false });
      expect((yield* Effect.flip(worker.request())).reason).toBe("Unsupported");

      const none = Serial.make();
      expect(none.supported).toEqual({ serial: false, request: false });
      expect((yield* Effect.flip(none.ports)).reason).toBe("Unsupported");
      expect((yield* Effect.flip(none.request())).reason).toBe("Unsupported");
      expect((yield* Effect.flip(Stream.runDrain(none.connections))).reason).toBe("Unsupported");
      expect(
        (yield* Effect.flip(Effect.scoped(none.open(new StubPort(), { baudRate: 9600 })))).reason,
      ).toBe("Unsupported");
      expect((yield* Effect.flip(Serial.ports)).reason).toBe("Unsupported");
    }),
  );
});

describe("Serial accessors", () => {
  it.effect("reach the provided service, and keep an unnamed rejection as Failed", () =>
    Effect.gen(function* () {
      const port = new StubPort();
      const { serial, listeners } = stubSerial([port]);
      const program = Effect.fn("program")(function* () {
        expect(yield* Serial.request()).toBe(port);
        const events = yield* Effect.forkChild(
          Stream.runCollect(Stream.take(Serial.connections, 1)),
        );
        yield* Effect.yieldNow;
        listeners.fire("connect", port);
        return yield* Fiber.join(events);
      });
      expect(yield* Effect.provideService(program(), Serial.Serial, Serial.make(serial))).toEqual([
        { type: "connect", device: port },
      ]);

      const broken = Serial.make({ ...serial, getPorts: () => Promise.reject("gone") });
      expect((yield* Effect.flip(broken.ports)).reason).toBe("Failed");
      const odd = Serial.make({
        ...serial,
        getPorts: () => Promise.reject(new DOMException("odd", "UnknownError")),
      });
      expect((yield* Effect.flip(odd.ports)).reason).toBe("Failed");
    }),
  );
});

describe("Serial.open", () => {
  it.effect("reads, writes and sets signals, then closes once the read has ended", () =>
    Effect.gen(function* () {
      const port = new StubPort();
      const scope = yield* Scope.make();
      const connection = yield* Scope.provide(
        Serial.make(stubSerial([port]).serial).open(port, { baudRate: 9600 }),
        scope,
      );
      expect(connection.info).toEqual({ usbVendorId: 1 });
      const reading = yield* Effect.forkChild(Stream.runCollect(connection.read));
      yield* Effect.yieldNow;
      expect((yield* Effect.flip(Stream.runDrain(connection.read))).reason).toBe("InvalidState");
      port.controller?.enqueue(bytes("OK\r\n"));

      yield* connection.write(bytes("AT"));
      yield* Stream.run(Stream.make(bytes("+"), bytes("GMR")), connection.writer);
      yield* connection.setSignals({ dataTerminalReady: true });
      expect(port.signals).toEqual({ dataTerminalReady: true });
      expect((yield* connection.signals).dataCarrierDetect).toBe(true);
      expect(port.written).toEqual(["AT", "+", "GMR"]);

      yield* Effect.yieldNow;
      yield* Scope.close(scope, Exit.void);
      expect(text(yield* Fiber.join(reading))).toBe("OK\r\n");
      expect(port.closes).toEqual(["closed"]);

      expect((yield* Effect.flip(connection.write(bytes("late")))).reason).toBe("Closed");
      expect((yield* Effect.flip(Stream.runDrain(connection.read))).reason).toBe("Closed");
      expect((yield* Effect.flip(connection.signals)).reason).toBe("Closed");
    }),
  );

  it.effect("fails a read with the platform's reason, and reads on afterwards", () =>
    Effect.gen(function* () {
      const port = new StubPort();
      const connection = yield* Serial.open(port, { baudRate: 9600 }).pipe(
        Effect.provideService(Serial.Serial, Serial.make(stubSerial([port]).serial)),
      );
      const first = yield* Effect.forkChild(Effect.flip(Stream.runDrain(connection.read)));
      yield* Effect.yieldNow;
      port.controller?.error(new DOMException("framing", "FramingError"));
      port.fresh();
      expect((yield* Fiber.join(first)).reason).toBe("Framing");

      const second = yield* Effect.forkChild(Stream.runCollect(Stream.take(connection.read, 1)));
      yield* Effect.yieldNow;
      port.controller?.enqueue(bytes("again"));
      expect(text(yield* Fiber.join(second))).toBe("again");

      port.readable = null;
      expect((yield* Effect.flip(Stream.runDrain(connection.read))).reason).toBe("Network");
    }).pipe(Effect.scoped),
  );

  it.effect("maps a failed open", () =>
    Effect.gen(function* () {
      const port = new StubPort();
      port.failOpen = "InvalidStateError";
      const error = yield* Effect.flip(
        Effect.scoped(Serial.make(stubSerial([port]).serial).open(port, { baudRate: 9600 })),
      );
      expect([error.operation, error.reason]).toEqual(["open", "InvalidState"]);
    }),
  );
});
