import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as WorkerRunner from "effect/workers/WorkerRunner";
import {
  CONNECT,
  layer,
  make,
} from "@thomasfosterau/effect-platform-service-worker/ServiceWorkerRunner";

const settle = Effect.repeat(Effect.yieldNow, { times: 20 });

/** A page: one end of a channel, recording what the worker sent it. */
const page = () => {
  const { port1, port2 } = new MessageChannel();
  const received: Array<unknown> = [];
  port1.addEventListener("message", (event) => {
    received.push(event.data);
  });
  port1.start();
  return { port: port1, workerEnd: port2, received };
};

/** A connect event carrying `port`, whose `waitUntil` promises are kept. */
const connectEvent = (port: unknown, data: unknown = CONNECT) => {
  const extended: Array<Promise<unknown>> = [];
  const event = Object.assign(new Event("message"), {
    data,
    ports: [port],
    waitUntil: (promise: Promise<unknown>) => {
      extended.push(promise);
    },
  });
  return { event, extended };
};

describe("ServiceWorkerRunner", () => {
  it.live("answers each connected page on its own port", () =>
    Effect.gen(function* () {
      const self = new EventTarget();
      const runner = yield* make(self).start<string, string>();
      const fiber = yield* Effect.forkChild(
        runner.run((portId, request) => runner.send(portId, `${portId}:${request}`)),
      );
      yield* settle;
      const first = page();
      const second = page();
      self.dispatchEvent(connectEvent(first.workerEnd).event);
      self.dispatchEvent(connectEvent(second.workerEnd).event);
      yield* Effect.sleep("20 millis");
      first.port.postMessage([0, "a"], []);
      second.port.postMessage([0, "b"], []);
      yield* Effect.sleep("20 millis");
      expect(first.received).toEqual([[0], [1, "0:a"]]);
      expect(second.received).toEqual([[0], [1, "1:b"]]);
      yield* Fiber.interrupt(fiber);
      first.port.close();
      second.port.close();
    }),
  );

  it.live("holds the connect event open until the page disconnects", () =>
    Effect.gen(function* () {
      const self = new EventTarget();
      const runner = yield* make(self).start<string, string>();
      const fiber = yield* Effect.forkChild(runner.run<never, never, never>(() => {}));
      yield* settle;
      const tab = page();
      const connected = connectEvent(tab.workerEnd);
      self.dispatchEvent(connected.event);
      yield* Effect.sleep("20 millis");
      let released = false;
      void connected.extended[0]?.then(() => (released = true));
      tab.port.postMessage([0, "ignored by a void handler"], []);
      yield* Effect.sleep("20 millis");
      expect(released).toBe(false);
      tab.port.postMessage([1], []);
      expect(yield* Queue.take(runner.disconnects ?? (yield* Queue.make<number>()))).toBe(0);
      yield* Effect.sleep("20 millis");
      expect(released).toBe(true);
      // A second close for the same page, or a message that is no request, is ignored.
      runner.sendUnsafe(0, "to nobody");
      yield* Fiber.interrupt(fiber);
      tab.port.close();
    }),
  );

  it.live("ignores messages that are not a connect, and logs a failed handler", () =>
    Effect.gen(function* () {
      const self = new EventTarget();
      const runner = yield* make(self).start<string, string>();
      const fiber = yield* Effect.forkChild(runner.run(() => Effect.fail("handler failed")));
      yield* settle;
      const tab = page();
      self.dispatchEvent(connectEvent(tab.workerEnd, "hello").event);
      self.dispatchEvent(connectEvent("not a port").event);
      self.dispatchEvent(new MessageEvent("message", { data: CONNECT }));
      yield* Effect.sleep("20 millis");
      expect(tab.received).toEqual([]);
      // A page whose connect event cannot be extended still connects.
      self.dispatchEvent(
        Object.assign(new Event("message"), { data: CONNECT, ports: [tab.workerEnd] }),
      );
      yield* Effect.sleep("20 millis");
      tab.port.postMessage("not a runner message", []);
      tab.port.postMessage([0, "fails"], []);
      yield* Effect.sleep("20 millis");
      expect(tab.received).toEqual([[0]]);
      tab.workerEnd.dispatchEvent(new MessageEvent("messageerror"));
      expect(yield* Queue.take(runner.disconnects ?? (yield* Queue.make<number>()))).toBe(0);
      yield* Fiber.interrupt(fiber);
      tab.port.close();
    }),
  );

  it.effect("fails to build outside a service worker", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.provide(Effect.service(WorkerRunner.WorkerRunnerPlatform), layer),
      );
      expect(error.reason._tag).toBe("WorkerSpawnError");
    }),
  );
});
