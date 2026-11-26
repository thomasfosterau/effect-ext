/**
 * High-resolution time, user timing and the performance timeline, the same
 * in a window and in every worker scope.
 *
 * {@link Performance} is a context reference that defaults, on first read,
 * to the ambient `performance` and `PerformanceObserver`; a test provides
 * one built by {@link make}.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";

/**
 * The fields every performance entry carries. A `PerformanceEntry`
 * satisfies it; the entry types add their own fields (`value` on a layout
 * shift, `interactionId` on an event timing, …), which a consumer reads
 * structurally.
 *
 * @since 0.1.0
 * @category models
 */
export interface EntryLike {
  readonly name: string;
  readonly entryType: string;
  readonly startTime: number;
  readonly duration: number;
}

/**
 * What `performance.mark` takes: a `detail` to attach, and a `startTime`
 * other than now.
 *
 * @since 0.1.0
 * @category models
 */
export interface MarkOptions {
  readonly detail?: unknown;
  readonly startTime?: number;
}

/**
 * What `performance.measure` takes: each end a mark name or a timestamp
 * (`start` defaults to the time origin, `end` to now), or a `duration`
 * from one of them.
 *
 * @since 0.1.0
 * @category models
 */
export interface MeasureOptions {
  readonly start?: string | number;
  readonly end?: string | number;
  readonly duration?: number;
  readonly detail?: unknown;
}

/**
 * What {@link observe} takes: `buffered` (default `true`) replays the
 * entries recorded before the observer started; `durationThreshold` is the
 * shortest `event` timing to report, in milliseconds (the platform's
 * default is 104, its floor 16).
 *
 * @since 0.1.0
 * @category models
 */
export interface ObserveOptions {
  readonly buffered?: boolean;
  readonly durationThreshold?: number;
}

/**
 * The slice of `performance` this module calls. `mark` and `measure` return
 * the recorded entry (or nothing, in browsers that predate that).
 *
 * @since 0.1.0
 * @category models
 */
export interface PerformanceLike {
  readonly timeOrigin: number;
  now(): number;
  mark(name: string, options?: MarkOptions): EntryLike | undefined;
  measure(name: string, options?: MeasureOptions): EntryLike | undefined;
}

/**
 * The entries a `PerformanceObserver` callback receives.
 *
 * @since 0.1.0
 * @category models
 */
export interface EntryListLike {
  getEntries(): ReadonlyArray<EntryLike>;
}

/**
 * The slice of a `PerformanceObserver` this module calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface PerformanceObserverLike {
  observe(options: {
    readonly type: string;
    readonly buffered: boolean;
    readonly durationThreshold: number;
  }): void;
  disconnect(): void;
}

/**
 * The `PerformanceObserver` constructor, with the entry types this agent
 * records.
 *
 * @since 0.1.0
 * @category models
 */
export interface PerformanceObserverConstructorLike {
  new (callback: (list: EntryListLike) => void): PerformanceObserverLike;
  readonly supportedEntryTypes: ReadonlyArray<string>;
}

/**
 * The platform objects {@link make} builds over. A missing member is an
 * unsupported API.
 *
 * @since 0.1.0
 * @category models
 */
export interface PerformanceEnvironment {
  readonly performance?: PerformanceLike | undefined;
  readonly observer?: PerformanceObserverConstructorLike | undefined;
}

/**
 * Why a call failed: `Unsupported` (no `performance`, no observer, or an
 * entry type this agent does not record), `InvalidName` (`measure` named a
 * mark that does not exist, or `mark` a reserved name), `InvalidOptions`
 * (options the platform rejects), `Failed` (anything else).
 *
 * @since 0.1.0
 * @category models
 */
export type PerformanceErrorReason = "Unsupported" | "InvalidName" | "InvalidOptions" | "Failed";

/**
 * A user-timing call or an observer failed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/Performance"
 *
 * Effect.runPromise(Effect.flip(make({}).mark("start"))).then((error) =>
 *   console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class PerformanceError extends Schema.TaggedError<PerformanceError>()("PerformanceError", {
  operation: Schema.Literals(["mark", "measure", "observe"]),
  reason: Schema.Literals(["Unsupported", "InvalidName", "InvalidOptions", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

/**
 * The operations a {@link Performance} offers.
 *
 * @since 0.1.0
 * @category models
 */
export interface PerformanceService {
  /** Which parts the agent supports, and the entry types it records. */
  readonly supported: {
    readonly timing: boolean;
    readonly observer: boolean;
    readonly entryTypes: ReadonlyArray<string>;
  };
  /** The time origin, in milliseconds since the epoch (`0` without `performance`). */
  readonly timeOrigin: number;
  /** Milliseconds since the time origin (the `Clock`'s epoch milliseconds without `performance`). */
  readonly now: Effect.Effect<number>;
  /** Records a user-timing mark. */
  readonly mark: (
    name: string,
    options?: MarkOptions,
  ) => Effect.Effect<Option.Option<EntryLike>, PerformanceError>;
  /** Records a user-timing measure between two marks or timestamps. */
  readonly measure: (
    name: string,
    options?: MeasureOptions,
  ) => Effect.Effect<Option.Option<EntryLike>, PerformanceError>;
  /** Every entry of `type`, buffered ones first, until the stream ends. */
  readonly observe: (
    type: string,
    options?: ObserveOptions,
  ) => Stream.Stream<EntryLike, PerformanceError>;
}

const reasonOf = (cause: unknown): PerformanceErrorReason => {
  const name = P.hasProperty(cause, "name") && P.isString(cause.name) ? cause.name : "";
  if (name === "SyntaxError") return "InvalidName";
  return name === "TypeError" || name === "RangeError" ? "InvalidOptions" : "Failed";
};

const failure = (
  operation: PerformanceError["operation"],
  reason: PerformanceErrorReason,
  cause: unknown,
): PerformanceError =>
  new PerformanceError({
    operation,
    reason,
    cause,
    message: `performance ${operation}: ${reason}`,
  });

const record = (
  operation: "mark" | "measure",
  performance: Option.Option<PerformanceLike>,
  call: (performance: PerformanceLike) => EntryLike | undefined,
): Effect.Effect<Option.Option<EntryLike>, PerformanceError> =>
  Option.match(performance, {
    onNone: () => Effect.fail(failure(operation, "Unsupported", undefined)),
    onSome: (self) =>
      Effect.try({
        try: () => Option.fromUndefinedOr(call(self)),
        catch: (cause) => failure(operation, reasonOf(cause), cause),
      }),
  });

/** The platform's own default, passed explicitly; types other than `event` ignore it. */
const DEFAULT_DURATION_THRESHOLD = 104;

const observeWith = (
  Observer: PerformanceObserverConstructorLike,
  type: string,
  options?: ObserveOptions,
): Stream.Stream<EntryLike, PerformanceError> =>
  Stream.callback<EntryLike, PerformanceError>((queue) =>
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          const observer = new Observer((list) => {
            Queue.offerAllUnsafe(queue, list.getEntries());
          });
          observer.observe({
            type,
            buffered: options?.buffered ?? true,
            durationThreshold: options?.durationThreshold ?? DEFAULT_DURATION_THRESHOLD,
          });
          return observer;
        },
        catch: (cause) => failure("observe", reasonOf(cause), cause),
      }),
      (observer) => Effect.sync(() => observer.disconnect()),
    ).pipe(Effect.catch((error) => Queue.fail(queue, error))),
  );

/**
 * Builds a {@link PerformanceService} over the given platform objects.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/Performance"
 *
 * const service = make({ performance: globalThis.performance })
 * Effect.runPromise(service.now).then((ms) => console.log(ms >= 0)) // true
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (environment: PerformanceEnvironment): PerformanceService => {
  const performance = Option.fromUndefinedOr(environment.performance);
  const Observer = Option.fromUndefinedOr(environment.observer);
  const entryTypes = Option.match(Observer, {
    onNone: () => [],
    onSome: (self) => Arr.fromIterable(self.supportedEntryTypes),
  });
  return {
    supported: {
      timing: Option.isSome(performance),
      observer: Option.isSome(Observer),
      entryTypes,
    },
    timeOrigin: Option.match(performance, { onNone: () => 0, onSome: (self) => self.timeOrigin }),
    now: Option.match(performance, {
      onNone: () => Clock.currentTimeMillis,
      onSome: (self) => Effect.sync(() => self.now()),
    }),
    mark: (name, options) => record("mark", performance, (self) => self.mark(name, options ?? {})),
    measure: (name, options) =>
      record("measure", performance, (self) => self.measure(name, options ?? {})),
    observe: (type, options) =>
      Option.match(
        Option.filter(Observer, () => Arr.contains(entryTypes, type)),
        {
          onNone: () => Stream.fail(failure("observe", "Unsupported", type)),
          onSome: (self) => observeWith(self, type, options),
        },
      ),
  };
};

const ambient = (): PerformanceService => {
  const scope: Partial<Pick<typeof globalThis, "performance" | "PerformanceObserver">> = globalThis;
  return make({ performance: scope.performance, observer: scope.PerformanceObserver });
};

/**
 * The performance timeline. Defaults to the ambient `performance` and
 * `PerformanceObserver` (a window's, a worker's or Node's), read on first
 * use; provide one built by {@link make} to replace them.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Performance, make, now } from "@thomasfosterau/effect-platform-worker-shared/Performance"
 *
 * const frozen = make({
 *   performance: { timeOrigin: 0, now: () => 42, mark: () => undefined, measure: () => undefined },
 * })
 * Effect.runPromise(now.pipe(Effect.provideService(Performance, frozen))).then(console.log) // 42
 * ```
 *
 * @since 0.1.0
 * @category context
 */
export const Performance: Context.Reference<PerformanceService> = /*#__PURE__*/ Context.Reference(
  "@thomasfosterau/effect-platform-worker-shared/Performance",
  { defaultValue: ambient },
);

/**
 * Milliseconds since the time origin, at sub-millisecond resolution where
 * the agent allows.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { now } from "@thomasfosterau/effect-platform-worker-shared/Performance"
 *
 * Effect.runPromise(now).then((ms) => console.log(ms > 0)) // true
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const now: Effect.Effect<number> = Performance.use((self) => self.now);

/**
 * Records a user-timing mark, which shows in the browser's performance
 * panel; `None` where the agent returns no entry.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { mark } from "@thomasfosterau/effect-platform-worker-shared/Performance"
 *
 * Effect.runPromise(mark("ready")).then((entry) =>
 *   console.log(Option.map(entry, (it) => it.entryType)), // Some("mark")
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const mark = (
  name: string,
  options?: MarkOptions,
): Effect.Effect<Option.Option<EntryLike>, PerformanceError> =>
  Performance.use((self) => self.mark(name, options));

/**
 * Records a user-timing measure; fails `InvalidName` when a named mark does
 * not exist.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { mark, measure } from "@thomasfosterau/effect-platform-worker-shared/Performance"
 *
 * const program = Effect.andThen(mark("start"), measure("work", { start: "start" }))
 * Effect.runPromise(program).then((entry) =>
 *   console.log(Option.map(entry, (it) => it.name)), // Some("work")
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const measure = (
  name: string,
  options?: MeasureOptions,
): Effect.Effect<Option.Option<EntryLike>, PerformanceError> =>
  Performance.use((self) => self.measure(name, options));

/**
 * Every entry of `type` (`"mark"`, `"resource"`, `"longtask"`, …), the
 * buffered ones first unless `buffered: false`. Fails `Unsupported` for a
 * type the agent does not record.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { mark, observe } from "@thomasfosterau/effect-platform-worker-shared/Performance"
 *
 * const program = Effect.andThen(mark("boot"), Stream.runHead(observe("mark")))
 * Effect.runPromise(program).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category streams
 */
export const observe = (
  type: string,
  options?: ObserveOptions,
): Stream.Stream<EntryLike, PerformanceError> =>
  Stream.unwrap(Performance.use((self) => Effect.succeed(self.observe(type, options))));

/**
 * Records how long `self` ran as a user-timing measure named `name`,
 * however it ends. A measure the agent refuses is dropped: timing never
 * fails the effect it wraps.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { timed } from "@thomasfosterau/effect-platform-worker-shared/Performance"
 *
 * const program = Effect.sleep("5 millis").pipe(timed("nap"))
 * Effect.runPromise(program).then(() => console.log(performance.getEntriesByName("nap").length)) // 1
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const timed: {
  (name: string): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  <A, E, R>(self: Effect.Effect<A, E, R>, name: string): Effect.Effect<A, E, R>;
} = dual(2, <A, E, R>(self: Effect.Effect<A, E, R>, name: string): Effect.Effect<A, E, R> =>
  Performance.use((performance) =>
    Effect.flatMap(performance.now, (start) =>
      Effect.ensuring(self, Effect.ignore(performance.measure(name, { start }))),
    ),
  ),
);

/**
 * What {@link layerTracer} takes: `spans`, which spans to measure (default
 * all), and `attributes` (default `false`), whether to attach a span's
 * attributes as the measure's `detail`. Only attributes whose value is a
 * string, number, boolean or bigint are attached, since `detail` must be
 * structured-cloneable.
 *
 * @since 0.2.0
 * @category models
 */
export interface TracerOptions {
  readonly spans?: (name: string) => boolean;
  readonly attributes?: boolean;
}

const NANOS_PER_MICRO = 1000n;

/** Epoch nanoseconds (Effect's span clock) as milliseconds since the time origin. */
const toTimeline = (nanos: bigint, timeOrigin: number): number =>
  Number(nanos / NANOS_PER_MICRO) / 1000 - timeOrigin;

const isCloneable = (value: unknown): value is string | number | boolean | bigint =>
  P.isString(value) || P.isNumber(value) || P.isBoolean(value) || P.isBigInt(value);

const cloneableDetail = (
  attributes: ReadonlyMap<string, unknown>,
): Record<string, string | number | boolean | bigint> =>
  R.fromEntries(
    Arr.filterMap(Arr.fromIterable(attributes), ([key, value]) =>
      isCloneable(value) ? Result.succeed([key, value] as const) : Result.failVoid,
    ),
  );

/** `span`, with a measure recorded once its `end` has run. */
const measuredSpan = (span: Tracer.Span, onEnd: (span: Tracer.Span) => void): Tracer.Span => ({
  _tag: "Span",
  get name() {
    return span.name;
  },
  get spanId() {
    return span.spanId;
  },
  get traceId() {
    return span.traceId;
  },
  get parent() {
    return span.parent;
  },
  get annotations() {
    return span.annotations;
  },
  get status() {
    return span.status;
  },
  get attributes() {
    return span.attributes;
  },
  get links() {
    return span.links;
  },
  get sampled() {
    return span.sampled;
  },
  get kind() {
    return span.kind;
  },
  end: (endTime, exit) => {
    span.end(endTime, exit);
    onEnd(span);
  },
  attribute: (key, value) => span.attribute(key, value),
  event: (name, startTime, attributes) => span.event(name, startTime, attributes),
  addLinks: (links) => span.addLinks(links),
});

/**
 * Wraps `tracer` so that every sampled span it creates is also recorded as
 * a user-timing measure on `performance` when it ends, named after the
 * span. `tracer` still creates and receives every span; a measure the
 * agent refuses is dropped, so tracing never fails the traced effect. A
 * span whose timing is disabled (`Effect.withTracerTiming(false)`) is not
 * measured.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Tracer from "effect/Tracer"
 * import { make, measuredTracer } from "@thomasfosterau/effect-platform-worker-shared/Performance"
 *
 * const tracer = measuredTracer(Tracer.nativeTracer, make({ performance: globalThis.performance }))
 * const program = Effect.sleep("5 millis").pipe(Effect.withSpan("nap"))
 * Effect.runPromise(Effect.withTracer(program, tracer)).then(() =>
 *   console.log(performance.getEntriesByName("nap").length), // 1
 * )
 * ```
 *
 * @since 0.2.0
 * @category tracing
 */
export const measuredTracer = (
  tracer: Tracer.Tracer,
  performance: PerformanceService,
  options?: TracerOptions,
): Tracer.Tracer => {
  const include = options?.spans ?? (() => true);
  const attach = options?.attributes === true;
  const measureEnded = (span: Tracer.Span): void => {
    if (span.status._tag !== "Ended" || span.status.startTime === 0n) return;
    const timing: MeasureOptions = {
      start: toTimeline(span.status.startTime, performance.timeOrigin),
      end: toTimeline(span.status.endTime, performance.timeOrigin),
    };
    const measureOptions = attach
      ? { ...timing, detail: cloneableDetail(span.attributes) }
      : timing;
    Effect.runSync(Effect.ignore(performance.measure(span.name, measureOptions)));
  };
  const span: Tracer.Tracer["span"] = (spanOptions) => {
    const created = tracer.span(spanOptions);
    return created.sampled && include(created.name) ? measuredSpan(created, measureEnded) : created;
  };
  return Tracer.make(tracer.context === undefined ? { span } : { span, context: tracer.context });
};

/**
 * A layer that replaces the current `Tracer` with one that wraps it (see
 * {@link measuredTracer}), so every Effect span also shows as a measure in
 * the browser's performance panel. Provide it after the tracer it should
 * wrap, an exporter's for example.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { layerTracer } from "@thomasfosterau/effect-platform-worker-shared/Performance"
 *
 * const program = Effect.sleep("5 millis").pipe(Effect.withSpan("load"))
 * Effect.runPromise(program.pipe(Effect.provide(layerTracer()))).then(() =>
 *   console.log(performance.getEntriesByName("load").length), // 1
 * )
 * ```
 *
 * @since 0.2.0
 * @category tracing
 */
export const layerTracer = (options?: TracerOptions): Layer.Layer<never> =>
  Layer.effect(
    Tracer.Tracer,
    Effect.map(
      Effect.all([Tracer.Tracer, Performance], { concurrency: 1 }),
      ([tracer, performance]) => measuredTracer(tracer, performance, options),
    ),
  );
