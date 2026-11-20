/** `BrowserTesting`'s `TestPerformance`: the in-memory timeline behaves as the platform's does. */
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Stream from "effect/Stream";
import * as Performance from "@thomasfosterau/effect-platform-worker-shared/Performance";
import { TestPerformance } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const names = (entries: ReadonlyArray<Performance.EntryLike>) =>
  Arr.map(
    entries,
    (entry) => `${entry.entryType}:${entry.name}@${entry.startTime}+${entry.duration}`,
  );

describe("TestPerformance", () => {
  it.effect("keeps a manual clock and records user timing", () =>
    Effect.gen(function* () {
      const control = yield* TestPerformance.Control;
      const service = yield* Performance.Performance;
      expect(service.timeOrigin).toBe(1000);
      expect(yield* Performance.now).toBe(5);
      yield* Performance.mark("a", { detail: { step: 1 } });
      yield* control.advance(10);
      yield* Performance.mark("b");
      yield* Performance.mark("c", { startTime: 2 });
      yield* control.advance(10);
      yield* Performance.measure("a-to-b", { start: "a", end: "b" });
      yield* Performance.measure("since-origin");
      yield* Performance.measure("from-a", { start: "a" });
      yield* Performance.measure("to-b", { end: "b", duration: 3 });
      yield* Performance.measure("after-a", { start: "a", duration: 4 });
      yield* Performance.measure("before-now", { duration: 6 });
      yield* Performance.measure("numbers", { start: 1, end: 2 });
      const entries = yield* control.entries;
      expect(names(entries)).toStrictEqual([
        "mark:a@5+0",
        "mark:b@15+0",
        "mark:c@2+0",
        "measure:a-to-b@5+10",
        "measure:since-origin@0+25",
        "measure:from-a@5+20",
        "measure:to-b@12+3",
        "measure:after-a@5+4",
        "measure:before-now@19+6",
        "measure:numbers@1+1",
      ]);
      expect(entries[0]).toStrictEqual({
        name: "a",
        entryType: "mark",
        startTime: 5,
        duration: 0,
        detail: { step: 1 },
      });
    }).pipe(Effect.provide(TestPerformance.layer({ timeOrigin: 1000, now: 5 }))),
  );

  it.effect("throws as the platform does", () =>
    Effect.gen(function* () {
      const reasons = yield* Effect.forEach(
        [
          Performance.measure("m", { start: "missing" }),
          Performance.measure("m", { start: 0, end: 1, duration: 1 }),
          Performance.mark("m", { startTime: -1 }),
        ],
        (call) => Effect.map(Effect.flip(call), (error) => error.reason),
        { concurrency: 1 },
      );
      expect(reasons).toStrictEqual(["InvalidName", "InvalidOptions", "InvalidOptions"]);
    }).pipe(Effect.provide(TestPerformance.layer())),
  );

  it.effect("delivers recorded entries to the observers of their type", () =>
    Effect.gen(function* () {
      const control = yield* TestPerformance.Control;
      yield* control.record([{ name: "early", entryType: "paint", startTime: 1, duration: 0 }]);
      const unbuffered = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(Performance.observe("paint", { buffered: false }), 1)),
      );
      const buffered = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(Performance.observe("paint"), 2)),
      );
      const marks = yield* Effect.forkChild(Stream.runHead(Performance.observe("mark")));
      yield* Effect.repeat(control.observing, { until: (types) => types.length === 3 });
      expect(Arr.sort(yield* control.observing, Order.String)).toStrictEqual([
        "mark",
        "paint",
        "paint",
      ]);
      yield* control.record([
        { name: "late", entryType: "paint", startTime: 2, duration: 0 },
        { name: "shift", entryType: "layout-shift", startTime: 2, duration: 0 },
      ]);
      yield* Performance.mark("m");
      expect(names(yield* Fiber.join(unbuffered))).toStrictEqual(["paint:late@2+0"]);
      expect(names(yield* Fiber.join(buffered))).toStrictEqual([
        "paint:early@1+0",
        "paint:late@2+0",
      ]);
      expect(Option.map(yield* Fiber.join(marks), (entry) => entry.name)).toStrictEqual(
        Option.some("m"),
      );
      expect(yield* control.observing).toStrictEqual([]);
    }).pipe(Effect.provide(TestPerformance.layer())),
  );

  it("builds the unsupported service on request", () => {
    const none = TestPerformance.make({ supported: false }).performance;
    const timingOnly = TestPerformance.make({ observer: false }).performance;
    const custom = TestPerformance.make({ entryTypes: ["mark"] }).performance;
    expect([none.supported, timingOnly.supported, custom.supported]).toStrictEqual([
      { timing: false, observer: false, entryTypes: [] },
      { timing: true, observer: false, entryTypes: [] },
      { timing: true, observer: true, entryTypes: ["mark"] },
    ]);
    expect(TestPerformance.make().performance.supported.entryTypes).toStrictEqual(
      TestPerformance.chromiumEntryTypes,
    );
  });
});
