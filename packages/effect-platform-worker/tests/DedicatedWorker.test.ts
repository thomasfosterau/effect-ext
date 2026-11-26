import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { DedicatedWorker } from "@thomasfosterau/effect-platform-worker";
import { dedicatedStub, fire } from "./helpers.ts";

const Job = Schema.Struct({ id: Schema.Finite });

describe("DedicatedWorker", () => {
  it.effect("fails outside a dedicated worker", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(DedicatedWorker.close);
      expect(error._tag).toBe("NotADedicatedWorker");
      expect(error.message).toBe("not running in a dedicated worker");
    }),
  );

  it.effect("reads the name and closes", () => {
    const self = dedicatedStub("resize");
    return Effect.gen(function* () {
      expect(yield* DedicatedWorker.name).toBe("resize");
      yield* DedicatedWorker.close;
      expect(self.closed).toBe(1);
    }).pipe(Effect.provideService(DedicatedWorker.DedicatedWorkerScope, Option.some(self)));
  });

  it.effect("parent sends encoded and receives decoded", () => {
    const self = dedicatedStub();
    return Effect.gen(function* () {
      const page = yield* DedicatedWorker.parent({ send: Job, receive: Job });
      yield* page.send({ id: 1 });
      expect(self.posted).toEqual([{ id: 1 }]);
      const fiber = yield* Effect.forkChild(Stream.runHead(page.messages));
      yield* Effect.repeat(Effect.yieldNow, { times: 10 });
      fire(self, "message", { data: { id: 2 } });
      expect(yield* Fiber.join(fiber)).toEqual(Option.some({ id: 2 }));
    }).pipe(Effect.provideService(DedicatedWorker.DedicatedWorkerScope, Option.some(self)));
  });
});
