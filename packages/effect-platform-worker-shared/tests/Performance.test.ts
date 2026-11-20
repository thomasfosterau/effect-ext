import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Performance from "@thomasfosterau/effect-platform-worker-shared/Performance";

type ObserveInit = Parameters<Performance.PerformanceObserverLike["observe"]>[0];

const entry = (name: string, entryType: string, startTime = 0): Performance.EntryLike => ({
  name,
  entryType,
  startTime,
  duration: 0,
});

/** A `performance` stub whose clock the test sets, recording its calls. */
const stubPerformance = (behaviour?: { readonly throws?: unknown; readonly returns?: boolean }) => {
  const calls: Array<{
    readonly method: string;
    readonly name: string;
    readonly options: unknown;
  }> = [];
  const clock = { now: 10 };
  const call = (method: string, name: string, options: unknown) => {
    calls.push({ method, name, options });
    if (behaviour?.throws !== undefined) throw behaviour.throws;
    return behaviour?.returns === false ? undefined : entry(name, method);
  };
  const performance: Performance.PerformanceLike = {
    timeOrigin: 1000,
    now: () => clock.now,
    mark: (name, options) => call("mark", name, options),
    measure: (name, options) => call("measure", name, options),
  };
  return { performance, calls, clock };
};

/** A `PerformanceObserver` stub: the test delivers entries to every live observer. */
const stubObserver = (options?: { readonly throws?: unknown }) => {
  const live: Array<{
    readonly callback: (list: Performance.EntryListLike) => void;
    init: Option.Option<ObserveInit>;
    disconnected: boolean;
  }> = [];
  class Observer implements Performance.PerformanceObserverLike {
    static readonly supportedEntryTypes = ["mark", "measure", "event"];
    readonly #record: (typeof live)[number];
    constructor(callback: (list: Performance.EntryListLike) => void) {
      this.#record = { callback, init: Option.none(), disconnected: false };
      live.push(this.#record);
    }
    observe(init: ObserveInit): void {
      if (options?.throws !== undefined) throw options.throws;
      this.#record.init = Option.some(init);
    }
    disconnect(): void {
      this.#record.disconnected = true;
    }
  }
  const deliver = (entries: ReadonlyArray<Performance.EntryLike>) =>
    Effect.sync(() =>
      Arr.forEach(
        Arr.filter(live, (record) => !record.disconnected),
        (record) => record.callback({ getEntries: () => entries }),
      ),
    );
  return { Observer, live, deliver };
};

const awaitObserving = (live: ReturnType<typeof stubObserver>["live"]) =>
  Effect.repeat(
    Effect.sync(() => live.length),
    { until: (count) => count > 0 },
  );

/** The reason a measure fails with when the platform throws `thrown`. */
const reasonFor = (thrown: unknown) =>
  Effect.map(
    Effect.flip(Performance.make(stubPerformance({ throws: thrown })).measure("m")),
    (error) => error.reason,
  );

describe("Performance.make", () => {
  it.effect("without performance is unsupported, and reads the clock", () =>
    Effect.gen(function* () {
      const service = Performance.make({});
      expect(service.supported).toStrictEqual({ timing: false, observer: false, entryTypes: [] });
      expect(service.timeOrigin).toBe(0);
      expect(yield* service.now).toBe(0);
      const failures = yield* Effect.all(
        [
          Effect.flip(service.mark("a")),
          Effect.flip(service.measure("b")),
          Effect.flip(Stream.runCollect(service.observe("mark"))),
        ],
        { concurrency: 1 },
      );
      expect(Arr.map(failures, (error) => [error.operation, error.reason])).toStrictEqual([
        ["mark", "Unsupported"],
        ["measure", "Unsupported"],
        ["observe", "Unsupported"],
      ]);
      expect(failures[0].message).toBe("performance mark: Unsupported");
    }),
  );

  it.effect("records marks and measures, passing options through", () =>
    Effect.gen(function* () {
      const { performance, calls, clock } = stubPerformance();
      const service = Performance.make({ performance });
      expect(service.supported.timing).toBe(true);
      expect(service.timeOrigin).toBe(1000);
      clock.now = 12.5;
      expect(yield* service.now).toBe(12.5);
      const marked = yield* service.mark("start", { detail: { step: 1 } });
      const measured = yield* service.measure("work", { start: "start", end: 20 });
      yield* service.mark("bare");
      expect(Option.map(marked, (value) => value.entryType)).toStrictEqual(Option.some("mark"));
      expect(Option.map(measured, (value) => value.name)).toStrictEqual(Option.some("work"));
      expect(calls).toStrictEqual([
        { method: "mark", name: "start", options: { detail: { step: 1 } } },
        { method: "measure", name: "work", options: { start: "start", end: 20 } },
        { method: "mark", name: "bare", options: {} },
      ]);
    }),
  );

  it.effect("is None where the agent returns no entry", () =>
    Effect.gen(function* () {
      const service = Performance.make(stubPerformance({ returns: false }));
      expect(yield* service.mark("a")).toStrictEqual(Option.none());
      expect(yield* service.measure("b")).toStrictEqual(Option.none());
    }),
  );

  it.effect("maps what the platform throws onto a reason", () =>
    Effect.gen(function* () {
      const reasons = yield* Effect.all(
        [
          reasonFor(new DOMException("no mark named start", "SyntaxError")),
          reasonFor(new TypeError("bad options")),
          reasonFor(new RangeError("negative duration")),
          reasonFor(new DOMException("aborted", "AbortError")),
          reasonFor("a string"),
        ],
        { concurrency: 1 },
      );
      expect(reasons).toStrictEqual([
        "InvalidName",
        "InvalidOptions",
        "InvalidOptions",
        "Failed",
        "Failed",
      ]);
    }),
  );
});

describe("Performance.observe", () => {
  it.effect("emits each delivered entry and disconnects when the stream ends", () =>
    Effect.gen(function* () {
      const { Observer, live, deliver } = stubObserver();
      const service = Performance.make({ observer: Observer });
      expect(service.supported).toStrictEqual({
        timing: false,
        observer: true,
        entryTypes: ["mark", "measure", "event"],
      });
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(service.observe("mark"), 3)),
      );
      yield* awaitObserving(live);
      yield* deliver([entry("a", "mark"), entry("b", "mark")]);
      yield* deliver([entry("c", "mark")]);
      const seen = yield* Fiber.join(fiber);
      expect(Arr.map(seen, (value) => value.name)).toStrictEqual(["a", "b", "c"]);
      expect(live[0]?.init).toStrictEqual(
        Option.some({ type: "mark", buffered: true, durationThreshold: 104 }),
      );
      expect(live[0]?.disconnected).toBe(true);
    }),
  );

  it.effect("passes buffered and durationThreshold through", () =>
    Effect.gen(function* () {
      const { Observer, live, deliver } = stubObserver();
      const fiber = yield* Effect.forkChild(
        Stream.runHead(
          Performance.make({ observer: Observer }).observe("event", {
            buffered: false,
            durationThreshold: 40,
          }),
        ),
      );
      yield* awaitObserving(live);
      yield* deliver([entry("click", "event")]);
      yield* Fiber.join(fiber);
      expect(live[0]?.init).toStrictEqual(
        Option.some({ type: "event", buffered: false, durationThreshold: 40 }),
      );
    }),
  );

  it.effect("fails Unsupported for an entry type the agent does not record", () =>
    Effect.gen(function* () {
      const { Observer, live } = stubObserver();
      const error = yield* Effect.flip(
        Stream.runCollect(Performance.make({ observer: Observer }).observe("layout-shift")),
      );
      expect([error.reason, error.cause]).toStrictEqual(["Unsupported", "layout-shift"]);
      expect(live).toStrictEqual([]);
    }),
  );

  it.effect("fails with the reason for what observe throws", () =>
    Effect.gen(function* () {
      const { Observer } = stubObserver({ throws: new TypeError("bad init") });
      const error = yield* Effect.flip(
        Stream.runCollect(Performance.make({ observer: Observer }).observe("mark")),
      );
      expect([error.operation, error.reason]).toStrictEqual(["observe", "InvalidOptions"]);
    }),
  );
});

describe("Performance accessors", () => {
  it.effect("read the provided service", () =>
    Effect.gen(function* () {
      const { performance, calls, clock } = stubPerformance();
      const { Observer, live, deliver } = stubObserver();
      const program = Effect.fn("program")(function* () {
        clock.now = 3;
        expect(yield* Performance.now).toBe(3);
        yield* Performance.mark("a");
        yield* Performance.measure("b", { start: "a" });
        const fiber = yield* Effect.forkChild(Stream.runHead(Performance.observe("measure")));
        yield* awaitObserving(live);
        yield* deliver([entry("b", "measure")]);
        return yield* Fiber.join(fiber);
      });
      const head = yield* Effect.provideService(
        program(),
        Performance.Performance,
        Performance.make({ performance, observer: Observer }),
      );
      expect(Option.map(head, (value) => value.name)).toStrictEqual(Option.some("b"));
      expect(Arr.map(calls, (value) => value.name)).toStrictEqual(["a", "b"]);
    }),
  );

  it.effect("timed measures from the start however the effect ends", () =>
    Effect.gen(function* () {
      const { performance, calls, clock } = stubPerformance();
      const service = Performance.make({ performance });
      clock.now = 5;
      const ok = yield* Effect.succeed("done").pipe(
        Performance.timed("ok"),
        Effect.provideService(Performance.Performance, service),
      );
      const failed = yield* Performance.timed(Effect.fail("boom"), "failed").pipe(
        Effect.provideService(Performance.Performance, service),
        Effect.exit,
      );
      expect(ok).toBe("done");
      expect(failed).toStrictEqual(Exit.fail("boom"));
      expect(calls).toStrictEqual([
        { method: "measure", name: "ok", options: { start: 5 } },
        { method: "measure", name: "failed", options: { start: 5 } },
      ]);
    }),
  );

  it.effect("timed never fails over a measure the agent refuses", () =>
    Effect.gen(function* () {
      const service = Performance.make(stubPerformance({ throws: new TypeError("nope") }));
      const result = yield* Effect.succeed(1).pipe(
        Performance.timed("x"),
        Effect.provideService(Performance.Performance, service),
      );
      expect(result).toBe(1);
    }),
  );
});

describe("Performance's ambient default", () => {
  it.effect("is the runtime's own performance timeline", () =>
    Effect.gen(function* () {
      const service = yield* Performance.Performance;
      expect(service.supported.timing).toBe(true);
      expect(service.supported.entryTypes).toContain("mark");
      expect(yield* Performance.now).toBeGreaterThan(0);
      yield* Performance.mark("ambient-start");
      const head = yield* Stream.runHead(Performance.observe("mark"));
      expect(Option.map(head, (value) => value.entryType)).toStrictEqual(Option.some("mark"));
      const measured = yield* Performance.measure("ambient", { start: "ambient-start" });
      expect(Option.map(measured, (value) => value.name)).toStrictEqual(Option.some("ambient"));
    }),
  );
});
