import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as Performance from "@thomasfosterau/effect-platform-worker-shared/Performance";
import { WebVitals } from "@thomasfosterau/effect-platform-browser";
import { TestPerformance } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const shift = (startTime: number, value: number, hadRecentInput = false) => ({
  name: "",
  entryType: "layout-shift",
  startTime,
  duration: 0,
  value,
  hadRecentInput,
});

const event = (interactionId: number, duration: number) => ({
  name: "click",
  entryType: "event",
  startTime: 0,
  duration,
  interactionId,
});

const paint = (name: string, startTime: number) => ({
  name,
  entryType: "paint",
  startTime,
  duration: 0,
});

const lcp = (startTime: number) => ({
  name: "",
  entryType: "largest-contentful-paint",
  startTime,
  duration: 0,
});

const navigation = (fields: Readonly<Record<string, number>>) => ({
  name: "https://example.com/",
  entryType: "navigation",
  startTime: 0,
  duration: 3000,
  ...fields,
});

/** An observer the agent refuses to start (a permissions policy). */
class RefusingObserver {
  static readonly supportedEntryTypes = ["paint"];
  observe(): void {
    throw new DOMException("refused", "SecurityError");
  }
  disconnect(): void {}
}

const valueOf = <S>(metric: WebVitals.Fold<S>, entries: ReadonlyArray<Performance.EntryLike>) =>
  Option.map(WebVitals.fold(metric, entries), (reading) => reading.value);

describe("WebVitals.rate", () => {
  it("rates each side of the thresholds", () => {
    expect([
      WebVitals.rate("LCP", 2500),
      WebVitals.rate("LCP", 2501),
      WebVitals.rate("LCP", 4000),
      WebVitals.rate("LCP", 4001),
      WebVitals.rate("CLS", 0.1),
      WebVitals.rate("CLS", 0.3),
    ]).toStrictEqual(["good", "needs-improvement", "needs-improvement", "poor", "good", "poor"]);
  });
});

describe("WebVitals folds", () => {
  it("FCP is the first-contentful-paint entry, once", () => {
    expect(
      valueOf(WebVitals.firstContentfulPaint, [
        paint("first-paint", 400),
        paint("first-contentful-paint", 700),
        paint("first-contentful-paint", 900),
      ]),
    ).toStrictEqual(Option.some(700));
    expect(valueOf(WebVitals.firstContentfulPaint, [paint("first-paint", 400)])).toStrictEqual(
      Option.none(),
    );
  });

  it("LCP is the latest candidate", () => {
    expect(
      valueOf(WebVitals.largestContentfulPaint, [lcp(1200), lcp(2600), lcp(2000)]),
    ).toStrictEqual(Option.some(2600));
    expect(WebVitals.fold(WebVitals.largestContentfulPaint, [])).toStrictEqual(Option.none());
  });

  it("TTFB is the response start, less a prerendered page's activation", () => {
    expect(valueOf(WebVitals.timeToFirstByte, [navigation({ responseStart: 320 })])).toStrictEqual(
      Option.some(320),
    );
    expect(
      valueOf(WebVitals.timeToFirstByte, [
        navigation({ responseStart: 320, activationStart: 1000 }),
      ]),
    ).toStrictEqual(Option.some(0));
    expect(
      valueOf(WebVitals.timeToFirstByte, [
        navigation({ responseStart: 900, activationStart: 100 }),
        navigation({ responseStart: 50 }),
      ]),
    ).toStrictEqual(Option.some(800));
    expect(valueOf(WebVitals.timeToFirstByte, [navigation({})])).toStrictEqual(Option.none());
  });

  it("CLS is the largest session window", () => {
    expect(
      valueOf(WebVitals.cumulativeLayoutShift, [
        // One window: each shift within 1s of the last.
        shift(0, 0.05),
        shift(800, 0.05),
        // A 1s gap opens a second, larger window.
        shift(2000, 0.1),
        shift(2500, 0.1),
        // Shifts after input do not count.
        shift(2600, 0.5, true),
      ]),
    ).toStrictEqual(Option.some(0.2));
  });

  it("CLS closes a window once it spans 5s", () => {
    const steady = Arr.map(Arr.range(0, 5), (step) => shift(step * 900, 0.02));
    // 0–4500ms fit one window (six shifts); the seventh, at 5400ms, starts another.
    const value = valueOf(WebVitals.cumulativeLayoutShift, [...steady, shift(5400, 0.02)]);
    expect(Option.map(value, (sum) => Number(sum.toFixed(2)))).toStrictEqual(Option.some(0.12));
    const shortened = valueOf(WebVitals.cumulativeLayoutShift, [
      ...steady,
      shift(5400, 0.02),
      shift(6000, 0.5),
    ]);
    expect(Option.map(shortened, (sum) => Number(sum.toFixed(2)))).toStrictEqual(Option.some(0.52));
  });

  it("CLS ignores what is not a layout shift, and is None without one", () => {
    expect(
      valueOf(WebVitals.cumulativeLayoutShift, [paint("first-paint", 0), shift(0, 0.3, true)]),
    ).toStrictEqual(Option.none());
  });

  it("INP is the slowest interaction, less one outlier per 50", () => {
    // Each interaction's longest event counts; non-interactions do not.
    expect(
      valueOf(WebVitals.interactionToNextPaint, [
        event(1, 80),
        event(1, 120),
        event(2, 90),
        event(0, 900),
      ]),
    ).toStrictEqual(Option.some(120));
    const many = Arr.map(Arr.range(1, 60), (id) => event(id, id === 60 ? 1000 : id * 5));
    expect(valueOf(WebVitals.interactionToNextPaint, many)).toStrictEqual(Option.some(295));
    expect(valueOf(WebVitals.interactionToNextPaint, [event(0, 300)])).toStrictEqual(Option.none());
  });
});

describe("WebVitals.observe", () => {
  it.effect("emits from the buffered entries, then on each change", () =>
    Effect.gen(function* () {
      const control = yield* TestPerformance.Control;
      yield* control.record([lcp(1200)]);
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(WebVitals.observe(WebVitals.largestContentfulPaint), 2)),
      );
      yield* Effect.repeat(control.observing, { until: Arr.isReadonlyArrayNonEmpty });
      // An earlier candidate changes nothing; a later one is the new value.
      yield* control.record([lcp(900)]);
      yield* control.record([lcp(4200)]);
      expect(yield* Fiber.join(fiber)).toStrictEqual([
        { name: "LCP", value: 1200, rating: "good" },
        { name: "LCP", value: 4200, rating: "poor" },
      ]);
      expect(yield* control.observing).toStrictEqual([]);
    }).pipe(Effect.provide(TestPerformance.layer())),
  );

  it.effect("observes event timings from 40ms", () =>
    Effect.gen(function* () {
      const control = yield* TestPerformance.Control;
      yield* control.record([event(1, 240)]);
      const head = yield* Stream.runHead(WebVitals.observe(WebVitals.interactionToNextPaint));
      expect(head).toStrictEqual(
        Option.some({ name: "INP", value: 240, rating: "needs-improvement" }),
      );
    }).pipe(Effect.provide(TestPerformance.layer())),
  );

  it.effect("ends empty where the browser does not record the entry type", () =>
    Effect.gen(function* () {
      const seen = yield* Stream.runCollect(WebVitals.observe(WebVitals.cumulativeLayoutShift));
      expect(seen).toStrictEqual([]);
    }).pipe(Effect.provide(TestPerformance.layer({ entryTypes: ["paint", "navigation"] }))),
  );

  it.effect("fails over anything else", () =>
    Effect.gen(function* () {
      const refusing = Performance.make({ observer: RefusingObserver });
      const error = yield* Effect.flip(
        Stream.runCollect(WebVitals.observe(WebVitals.firstContentfulPaint)).pipe(
          Effect.provideService(Performance.Performance, refusing),
        ),
      );
      expect([error.operation, error.reason]).toStrictEqual(["observe", "Failed"]);
    }),
  );
});

describe("WebVitals.all and report", () => {
  it.effect("report runs on every metric the timeline holds", () =>
    Effect.gen(function* () {
      const control = yield* TestPerformance.Control;
      yield* control.record([
        navigation({ responseStart: 150 }),
        paint("first-contentful-paint", 600),
        lcp(1100),
        shift(700, 0.04),
        event(1, 64),
      ]);
      const seen = yield* Ref.make<ReadonlyArray<string>>([]);
      const fiber = yield* Effect.forkChild(
        WebVitals.report((metric) =>
          Ref.update(seen, (names) => [...names, `${metric.name}=${metric.value}`]),
        ),
      );
      const names = yield* Effect.repeat(Ref.get(seen), { until: (all) => all.length === 5 });
      yield* Fiber.interrupt(fiber);
      expect(Arr.sort(names, Order.String)).toStrictEqual([
        "CLS=0.04",
        "FCP=600",
        "INP=64",
        "LCP=1100",
        "TTFB=150",
      ]);
    }).pipe(Effect.provide(TestPerformance.layer())),
  );
});
