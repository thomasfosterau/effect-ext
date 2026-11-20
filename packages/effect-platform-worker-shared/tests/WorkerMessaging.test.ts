import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Transferable from "effect/workers/Transferable";
import * as WorkerMessaging from "@thomasfosterau/effect-platform-worker-shared/WorkerMessaging";

const Ping = Schema.Struct({ n: Schema.Number });

describe("WorkerMessaging", () => {
  it.effect("raw round-trips over a channel", () =>
    Effect.gen(function* () {
      const [a, b] = yield* WorkerMessaging.channel;
      const inbox = yield* WorkerMessaging.raw(b).subscribe;
      yield* WorkerMessaging.raw(a).send({ x: 1 });
      expect(yield* Stream.runHead(inbox)).toEqual(Option.some({ x: 1 }));
    }).pipe(Effect.scoped),
  );

  it.effect("a clone failure is DataClone", () =>
    Effect.gen(function* () {
      const [a] = yield* WorkerMessaging.channel;
      const error = yield* Effect.flip(WorkerMessaging.raw(a).send(() => 1));
      expect(error.reason).toBe("DataClone");
      expect(error.message).toBe("postMessage failed: DataClone");
    }).pipe(Effect.scoped),
  );

  it.effect("any other throw is Failed", () => {
    const port = Object.assign(new EventTarget(), {
      postMessage: () => {
        throw new TypeError("nope");
      },
    });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(WorkerMessaging.raw(port).send(1));
      expect(error.reason).toBe("Failed");
    });
  });

  it.effect("sendTransfer moves the buffer", () =>
    Effect.gen(function* () {
      const [a, b] = yield* WorkerMessaging.channel;
      const inbox = yield* WorkerMessaging.raw(b).subscribe;
      const buffer = new ArrayBuffer(8);
      yield* WorkerMessaging.raw(a).sendTransfer(buffer, [buffer]);
      expect(buffer.byteLength).toBe(0);
      const received = yield* Stream.runHead(inbox);
      expect(
        Option.map(received, (value) => (value instanceof ArrayBuffer ? value.byteLength : -1)),
      ).toEqual(Option.some(8));
    }).pipe(Effect.scoped),
  );

  it.effect("endpoint decodes, and drops what does not decode", () =>
    Effect.gen(function* () {
      const [a, b] = yield* WorkerMessaging.channel;
      const inbox = yield* WorkerMessaging.endpoint(b, { send: Ping, receive: Ping }).subscribe;
      yield* WorkerMessaging.raw(a).send({ n: "not a number" });
      yield* WorkerMessaging.endpoint(a, { send: Ping, receive: Ping }).send({ n: 2 });
      expect(yield* Stream.runHead(inbox)).toEqual(Option.some({ n: 2 }));
    }).pipe(Effect.scoped),
  );

  it.effect("endpoint transfers what the schema collects", () =>
    Effect.gen(function* () {
      const Bytes = Schema.Struct({ bytes: Transferable.Uint8Array });
      const [a, b] = yield* WorkerMessaging.channel;
      const inbox = yield* WorkerMessaging.endpoint(b, { send: Bytes, receive: Bytes }).subscribe;
      const bytes = new Uint8Array([1, 2, 3]);
      yield* WorkerMessaging.endpoint(a, { send: Bytes, receive: Bytes }).send({ bytes });
      expect(bytes.byteLength).toBe(0);
      const received = yield* Stream.runHead(inbox);
      expect(Option.map(received, (value) => Array.from(value.bytes))).toEqual(
        Option.some([1, 2, 3]),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("messages listens per run, and messageerror is dropped", () =>
    Effect.gen(function* () {
      const port = Object.assign(new EventTarget(), { postMessage: () => {} });
      const fiber = yield* Effect.forkChild(
        Stream.runHead(WorkerMessaging.endpoint(port, { send: Ping, receive: Ping }).messages),
      );
      yield* Effect.yieldNow;
      port.dispatchEvent(new Event("messageerror"));
      port.dispatchEvent(new Event("message"));
      port.dispatchEvent(Object.assign(new Event("message"), { data: { n: 7 } }));
      expect(yield* Fiber.join(fiber)).toEqual(Option.some({ n: 7 }));
    }),
  );

  it.effect("the stream ends when the scope closes", () =>
    Effect.gen(function* () {
      const port = Object.assign(new EventTarget(), { postMessage: () => {} });
      const inbox = yield* Effect.scoped(WorkerMessaging.raw(port).subscribe);
      expect(yield* Stream.runHead(inbox)).toEqual(Option.none());
    }),
  );
});
