/**
 * The Core Web Vitals and their diagnostics (LCP, CLS, INP, FCP, TTFB) as
 * streams over the performance timeline, each a pure fold over entries so a
 * test can compute one from fixtures.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import {
  type EntryLike,
  type PerformanceError,
  observe as observePerformance,
} from "@thomasfosterau/effect-platform-worker-shared/Performance";

/**
 * A metric's short name.
 *
 * @since 0.1.0
 * @category models
 */
export type Name = "LCP" | "CLS" | "INP" | "FCP" | "TTFB";

/**
 * Where a value falls against the metric's published thresholds.
 *
 * @since 0.1.0
 * @category models
 */
export type Rating = "good" | "needs-improvement" | "poor";

/**
 * One reading of a metric: milliseconds, except CLS, which is unitless.
 *
 * @since 0.1.0
 * @category models
 */
export interface Metric {
  readonly name: Name;
  readonly value: number;
  readonly rating: Rating;
}

/**
 * Each metric's thresholds: at most the first is `good`, at most the
 * second `needs-improvement`, above it `poor`.
 *
 * @since 0.1.0
 * @category constants
 */
export const thresholds = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
} as const satisfies { readonly [K in Name]: readonly [number, number] };

/**
 * Rates a value of `name` against its {@link thresholds}.
 *
 * @example
 * ```ts
 * import { WebVitals } from "@thomasfosterau/effect-platform-browser"
 *
 * console.log(WebVitals.rate("LCP", 3100)) // "needs-improvement"
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export const rate = (name: Name, value: number): Rating => {
  const [good, poor] = thresholds[name];
  if (value <= good) return "good";
  return value <= poor ? "needs-improvement" : "poor";
};

/**
 * How a metric reads the timeline: the `entryType` it observes, a `step`
 * that folds each entry into its state, and the metric's `value` in a
 * state (`None` before there is one).
 *
 * @since 0.1.0
 * @category models
 */
export interface Fold<S> {
  readonly name: Name;
  readonly entryType: string;
  readonly durationThreshold?: number;
  readonly initial: S;
  readonly step: (state: S, entry: EntryLike) => S;
  readonly value: (state: S) => Option.Option<number>;
}

const numberField = (entry: EntryLike, field: string): Option.Option<number> =>
  P.hasProperty(entry, field) && P.isNumber(entry[field])
    ? Option.some(entry[field])
    : Option.none();

const keepFirst = (state: Option.Option<number>, next: number): Option.Option<number> =>
  Option.orElse(state, () => Option.some(next));

/**
 * First Contentful Paint: when the first text or image painted, from the
 * `paint` entry named `first-contentful-paint`.
 *
 * @since 0.1.0
 * @category folds
 */
export const firstContentfulPaint: Fold<Option.Option<number>> = {
  name: "FCP",
  entryType: "paint",
  initial: Option.none(),
  step: (state, entry) =>
    entry.name === "first-contentful-paint" ? keepFirst(state, entry.startTime) : state,
  value: (state) => state,
};

/**
 * Largest Contentful Paint: when the largest element in the viewport
 * painted. The browser reports a new candidate each time a larger one
 * paints, and stops at the first input; the value is the latest.
 *
 * @since 0.1.0
 * @category folds
 */
export const largestContentfulPaint: Fold<Option.Option<number>> = {
  name: "LCP",
  entryType: "largest-contentful-paint",
  initial: Option.none(),
  step: (state, entry) =>
    Option.some(
      Option.match(state, {
        onNone: () => entry.startTime,
        onSome: (latest) => Math.max(latest, entry.startTime),
      }),
    ),
  value: (state) => state,
};

/**
 * Time to First Byte: from the navigation (or, for a prerendered page, its
 * activation) to the first byte of the response, from the `navigation`
 * entry.
 *
 * @since 0.1.0
 * @category folds
 */
export const timeToFirstByte: Fold<Option.Option<number>> = {
  name: "TTFB",
  entryType: "navigation",
  initial: Option.none(),
  step: (state, entry) =>
    Option.match(numberField(entry, "responseStart"), {
      onNone: () => state,
      onSome: (responseStart) => {
        const activation = Option.getOrElse(numberField(entry, "activationStart"), () => 0);
        return keepFirst(state, Math.max(responseStart - activation, 0));
      },
    }),
  value: (state) => state,
};

/**
 * The running state of {@link cumulativeLayoutShift}: the current session
 * window's sum, start and last shift, and the largest window so far.
 *
 * @since 0.1.0
 * @category models
 */
export interface LayoutShiftState {
  readonly largest: Option.Option<number>;
  readonly window: number;
  readonly windowStart: number;
  readonly lastShift: number;
}

/**
 * Cumulative Layout Shift: the largest burst of unexpected layout shifts.
 * Shifts within 500ms of input do not count; a session window closes after
 * a 1s gap or once it spans 5s.
 *
 * @since 0.1.0
 * @category folds
 */
export const cumulativeLayoutShift: Fold<LayoutShiftState> = {
  name: "CLS",
  entryType: "layout-shift",
  initial: { largest: Option.none(), window: 0, windowStart: 0, lastShift: 0 },
  step: (state, entry) => {
    const recentInput = P.hasProperty(entry, "hadRecentInput") && entry.hadRecentInput === true;
    return Option.match(numberField(entry, "value"), {
      onNone: () => state,
      onSome: (value) => {
        if (recentInput) return state;
        const continues =
          Option.isSome(state.largest) &&
          entry.startTime - state.lastShift < 1000 &&
          entry.startTime - state.windowStart < 5000;
        const window = continues ? state.window + value : value;
        return {
          largest: Option.some(
            Math.max(
              window,
              Option.getOrElse(state.largest, () => 0),
            ),
          ),
          window,
          windowStart: continues ? state.windowStart : entry.startTime,
          lastShift: entry.startTime,
        };
      },
    });
  },
  value: (state) => state.largest,
};

/**
 * Interaction to Next Paint: close to the slowest interaction, ignoring
 * one outlier for every 50 interactions. Each interaction is the longest
 * `event` timing that shares its `interactionId`.
 *
 * @since 0.1.0
 * @category folds
 */
export const interactionToNextPaint: Fold<HashMap.HashMap<number, number>> = {
  name: "INP",
  entryType: "event",
  durationThreshold: 40,
  initial: HashMap.empty(),
  step: (state, entry) =>
    Option.match(
      Option.filter(numberField(entry, "interactionId"), (id) => id > 0),
      {
        onNone: () => state,
        onSome: (id) =>
          HashMap.set(
            state,
            id,
            Math.max(
              entry.duration,
              Option.getOrElse(HashMap.get(state, id), () => 0),
            ),
          ),
      },
    ),
  value: (state) => {
    const slowest = Arr.sort(Arr.fromIterable(HashMap.values(state)), Order.flip(Order.Number));
    return Arr.get(slowest, Math.min(Math.floor(slowest.length / 50), slowest.length - 1));
  },
};

const toMetric = (name: Name, value: number): Metric => ({
  name,
  value,
  rating: rate(name, value),
});

/**
 * Folds `entries` into the metric `fold` computes: `None` when none of
 * them bears on it.
 *
 * @example
 * ```ts
 * import { WebVitals } from "@thomasfosterau/effect-platform-browser"
 *
 * const shifts = [
 *   { name: "", entryType: "layout-shift", startTime: 100, duration: 0, value: 0.05, hadRecentInput: false },
 *   { name: "", entryType: "layout-shift", startTime: 400, duration: 0, value: 0.08, hadRecentInput: false },
 * ]
 * console.log(WebVitals.fold(WebVitals.cumulativeLayoutShift, shifts))
 * // Some({ name: "CLS", value: 0.13, rating: "needs-improvement" })
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export const fold = <S>(metric: Fold<S>, entries: Iterable<EntryLike>): Option.Option<Metric> =>
  Option.map(
    metric.value(Arr.reduce(Arr.fromIterable(entries), metric.initial, metric.step)),
    (value) => toMetric(metric.name, value),
  );

const observeEntries = <S>(metric: Fold<S>) =>
  metric.durationThreshold === undefined
    ? observePerformance(metric.entryType)
    : observePerformance(metric.entryType, { durationThreshold: metric.durationThreshold });

/**
 * The metric `fold` computes, from the entries already buffered and then
 * each new one, emitted each time its value changes. Ends at once, empty,
 * where the browser does not record the metric's entry type (Firefox and
 * Safari have no `layout-shift`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { WebVitals } from "@thomasfosterau/effect-platform-browser"
 * import { TestPerformance } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestPerformance.Control
 *   yield* control.record([
 *     { name: "first-contentful-paint", entryType: "paint", startTime: 900, duration: 0 },
 *   ])
 *   return yield* Stream.runHead(WebVitals.observe(WebVitals.firstContentfulPaint))
 * })
 * Effect.runPromise(Effect.provide(program, TestPerformance.layer())).then(console.log)
 * // Some({ name: "FCP", value: 900, rating: "good" })
 * ```
 *
 * @since 0.1.0
 * @category streams
 */
export const observe = <S>(metric: Fold<S>): Stream.Stream<Metric, PerformanceError> =>
  observeEntries(metric).pipe(
    Stream.scan(() => metric.initial, metric.step),
    Stream.filterMap((state) => Result.fromOption(metric.value(state), () => state)),
    Stream.changes,
    Stream.map((value) => toMetric(metric.name, value)),
    Stream.catch((error) =>
      error.reason === "Unsupported" && error.operation === "observe"
        ? Stream.empty
        : Stream.fail(error),
    ),
  );

/**
 * Every metric this module computes, merged, each emitted as it changes.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { WebVitals } from "@thomasfosterau/effect-platform-browser"
 *
 * const report = WebVitals.all.pipe(
 *   Stream.runForEach((metric) => Effect.log(`${metric.name} ${metric.value} ${metric.rating}`)),
 * )
 * ```
 *
 * @since 0.1.0
 * @category streams
 */
export const all: Stream.Stream<Metric, PerformanceError> = /*#__PURE__*/ Stream.mergeAll(
  [
    observe(timeToFirstByte),
    observe(firstContentfulPaint),
    observe(largestContentfulPaint),
    observe(cumulativeLayoutShift),
    observe(interactionToNextPaint),
  ],
  { concurrency: "unbounded" },
);

/**
 * Runs `f` on each metric as it changes, for as long as the page lives:
 * the usual way to report vitals to an analytics endpoint.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { WebVitals } from "@thomasfosterau/effect-platform-browser"
 *
 * const reporting = WebVitals.report((metric) => Effect.log(metric.name, metric.value))
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const report = <E, R>(
  f: (metric: Metric) => Effect.Effect<void, E, R>,
): Effect.Effect<void, E | PerformanceError, R> => Stream.runForEach(all, f);
