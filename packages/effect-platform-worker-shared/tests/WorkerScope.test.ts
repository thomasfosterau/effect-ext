import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as WorkerScope from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";
import { event, inScope, stubScope } from "./helpers.ts";

describe("WorkerScope", () => {
  it.effect("fails outside a worker", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(WorkerScope.location);
      expect(error._tag).toBe("WorkerScopeUnavailable");
      expect(error.message).toContain("WorkerGlobalScope");
    }),
  );

  it.effect("reads the stub's location and flags", () => {
    const self = stubScope("https://example.com/w.js?v=3");
    return Effect.gen(function* () {
      const url = yield* WorkerScope.location;
      expect(url.searchParams.get("v")).toBe("3");
      expect(yield* WorkerScope.isSecureContext).toBe(true);
      expect(yield* WorkerScope.crossOriginIsolated).toBe(false);
    }).pipe(inScope(self));
  });

  it("toUncaught reads both event kinds and ignores others", () => {
    expect(WorkerScope.toUncaught("error", { message: "m", error: 1 })).toEqual(
      Option.some({ _tag: "Error", message: "m", error: 1 }),
    );
    expect(WorkerScope.toUncaught("error", { message: 5 })).toEqual(
      Option.some({ _tag: "Error", message: "", error: undefined }),
    );
    expect(WorkerScope.toUncaught("unhandledrejection", { reason: "r" })).toEqual(
      Option.some({ _tag: "UnhandledRejection", reason: "r" }),
    );
    expect(WorkerScope.toUncaught("unhandledrejection", {})).toEqual(Option.none());
    expect(WorkerScope.toUncaught("message", { message: "m" })).toEqual(Option.none());
  });

  it.effect("uncaught streams errors and rejections in order", () => {
    const self = stubScope();
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(WorkerScope.uncaught, 2)),
      );
      yield* Effect.repeat(Effect.yieldNow, { times: 20 });
      self.dispatchEvent(new Event("error"));
      self.dispatchEvent(event("error", { message: "bad", error: "e" }));
      self.dispatchEvent(event("unhandledrejection", { reason: "r" }));
      const all = yield* Fiber.join(fiber);
      expect(all).toEqual([
        { _tag: "Error", message: "bad", error: "e" },
        { _tag: "UnhandledRejection", reason: "r" },
      ]);
    }).pipe(inScope(self));
  });
});
