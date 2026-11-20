import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Logger from "effect/Logger";
import type * as Runtime from "effect/Runtime";
import * as WorkerRuntime from "@thomasfosterau/effect-platform-worker-shared/WorkerRuntime";
import { event } from "./helpers.ts";

/** A teardown that completes `done` with the main fiber's exit. */
const recordExit =
  (done: Deferred.Deferred<Exit.Exit<unknown, unknown>>): Runtime.Teardown =>
  (exit, onExit) => {
    Deferred.doneUnsafe(done, Exit.succeed(exit));
    onExit(0);
  };

describe("WorkerRuntime", () => {
  it.live("logs uncaught errors through the main fiber, then detaches", () =>
    Effect.gen(function* () {
      const self = new EventTarget();
      const lines: Array<unknown> = [];
      const logger = Logger.make(({ message }) => {
        lines.push(message);
      });
      const gate = yield* Deferred.make<void>();
      const done = yield* Deferred.make<Exit.Exit<unknown, unknown>>();
      WorkerRuntime.make(self)(Deferred.await(gate).pipe(Effect.provide(Logger.layer([logger]))), {
        teardown: recordExit(done),
      });
      self.dispatchEvent(event("error", { message: "bad", error: "e" }));
      self.dispatchEvent(event("unhandledrejection", { reason: "r" }));
      self.dispatchEvent(event("unhandledrejection", {}));
      yield* Effect.sleep("10 millis");
      yield* Deferred.succeed(gate, undefined);
      expect(Exit.isSuccess(yield* Deferred.await(done))).toBe(true);
      self.dispatchEvent(event("error", { message: "after", error: "x" }));
      yield* Effect.sleep("10 millis");
      expect(lines).toEqual([
        ["worker: uncaught exception", "bad", "e"],
        ["worker: unhandled rejection", "r"],
      ]);
    }),
  );

  it("closeOnExit closes the worker after the default teardown", () => {
    const codes: Array<number> = [];
    let closed = 0;
    const self = Object.assign(new EventTarget(), {
      close: () => {
        closed += 1;
      },
    });
    WorkerRuntime.closeOnExit(self)(Exit.void, (code) => codes.push(code));
    expect(codes).toEqual([0]);
    expect(closed).toBe(1);
  });

  it.live("runMain reads globalThis when called", () =>
    Effect.gen(function* () {
      const done = yield* Deferred.make<Exit.Exit<unknown, unknown>>();
      WorkerRuntime.runMain(Effect.succeed(1), { teardown: recordExit(done) });
      expect(yield* Deferred.await(done)).toEqual(Exit.succeed(1));
    }),
  );
});
