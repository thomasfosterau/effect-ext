import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { SharedWorker } from "@thomasfosterau/effect-platform-worker";
import { fire, sharedStub } from "./helpers.ts";

const Hello = Schema.Struct({ hello: Schema.String });

describe("SharedWorker", () => {
  it.effect("fails outside a shared worker", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(SharedWorker.name);
      expect(error._tag).toBe("NotASharedWorker");
      expect(error.message).toBe("not running in a shared worker");
    }),
  );

  it.effect("reads the name and closes", () => {
    const self = sharedStub("sync");
    return Effect.gen(function* () {
      expect(yield* SharedWorker.name).toBe("sync");
      yield* SharedWorker.close;
      expect(self.closed).toBe(1);
    }).pipe(Effect.provideService(SharedWorker.SharedWorkerScope, Option.some(self)));
  });

  it.effect("connections skips a connect event with no port", () => {
    const self = sharedStub();
    return Effect.gen(function* () {
      const { port1, port2 } = new MessageChannel();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          port1.close();
          port2.close();
        }),
      );
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(SharedWorker.connections, 1)),
      );
      yield* Effect.repeat(Effect.yieldNow, { times: 10 });
      fire(self, "connect", { ports: [] });
      fire(self, "connect", {});
      fire(self, "connect", { ports: [port1] });
      expect(yield* Fiber.join(fiber)).toEqual([port1]);
    }).pipe(
      Effect.scoped,
      Effect.provideService(SharedWorker.SharedWorkerScope, Option.some(self)),
    );
  });

  it.effect("endpoints speak the protocol with each page", () => {
    const self = sharedStub();
    return Effect.gen(function* () {
      const { port1, port2 } = new MessageChannel();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          port1.close();
          port2.close();
        }),
      );
      const fiber = yield* Effect.forkChild(
        Stream.runHead(SharedWorker.endpoints({ send: Hello, receive: Hello })),
      );
      yield* Effect.repeat(Effect.yieldNow, { times: 10 });
      fire(self, "connect", { ports: [port1] });
      const page = yield* Effect.flatMap(Fiber.join(fiber), Effect.fromOption);
      const inbox = yield* page.subscribe;
      port2.postMessage({ hello: "worker" });
      expect(yield* Stream.runHead(inbox)).toEqual(Option.some({ hello: "worker" }));
    }).pipe(
      Effect.scoped,
      Effect.provideService(SharedWorker.SharedWorkerScope, Option.some(self)),
    );
  });
});
