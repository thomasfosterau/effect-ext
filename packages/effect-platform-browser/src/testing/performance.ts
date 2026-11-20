/**
 * A controllable performance timeline for tests of code that uses
 * `Performance` (from `@thomasfosterau/effect-platform-worker-shared`) or
 * `WebVitals`: {@link layer} provides the real adapter over an in-memory
 * `performance` and `PerformanceObserver` whose clock only moves when the
 * test advances it, plus {@link Control} to record entries the browser
 * would (paints, layout shifts, event timings) and read the timeline back.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import {
  type EntryLike,
  type EntryListLike,
  type MarkOptions,
  type MeasureOptions,
  Performance,
  type PerformanceObserverConstructorLike,
  type PerformanceObserverLike,
  type PerformanceService,
  make as makePerformance,
} from "@thomasfosterau/effect-platform-worker-shared/Performance";

/**
 * The entry types a Chromium window records, the double's default.
 *
 * @since 0.1.0
 * @category constants
 */
export const chromiumEntryTypes: ReadonlyArray<string> = [
  "element",
  "event",
  "first-input",
  "largest-contentful-paint",
  "layout-shift",
  "long-animation-frame",
  "longtask",
  "mark",
  "measure",
  "navigation",
  "paint",
  "resource",
  "visibility-state",
];

/**
 * The in-memory timeline's starting state: `supported` (default `true`)
 * builds the service with no `performance` at all when `false`; `observer`
 * (default `true`) leaves out `PerformanceObserver` when `false`;
 * `entryTypes` (default {@link chromiumEntryTypes}) is what the observer
 * records; `timeOrigin` (default `0`) and `now` (default `0`) set the
 * clock.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
  readonly observer?: boolean;
  readonly entryTypes?: ReadonlyArray<string>;
  readonly timeOrigin?: number;
  readonly now?: number;
}

/**
 * Drives the in-memory timeline: `advance` moves the clock; `record` adds
 * entries to the timeline and delivers each to the observers of its
 * `entryType`, as the browser does when it paints, shifts layout or times
 * an event; `entries` is the whole timeline, marks and measures included;
 * `observing` lists the entry type of each connected observer.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly advance: (milliseconds: number) => Effect.Effect<void>;
    readonly record: (entries: ReadonlyArray<EntryLike>) => Effect.Effect<void>;
    readonly entries: Effect.Effect<ReadonlyArray<EntryLike>>;
    readonly observing: Effect.Effect<ReadonlyArray<string>>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/PerformanceControl") {}

/**
 * What {@link make} builds: the `Performance` service over the in-memory
 * timeline, and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly performance: PerformanceService;
  readonly control: Control["Service"];
}

/** A user-timing entry: the base fields plus its `detail`. */
interface UserTiming extends EntryLike {
  readonly detail: unknown;
}

interface Registration {
  readonly type: string;
  readonly deliver: (entries: ReadonlyArray<EntryLike>) => void;
}

/** The thrown failures the platform raises, built outside any `Effect.gen`. */
const syntaxError = (message: string): DOMException => new DOMException(message, "SyntaxError");

/**
 * Builds an in-memory performance timeline: the `Performance` service over
 * it, and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestPerformance } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { performance, control } = TestPerformance.make()
 * Effect.runPromise(Effect.andThen(control.advance(250), performance.now)).then(console.log) // 250
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const clock = { now: options?.now ?? 0 };
  const timeline: Array<EntryLike> = [];
  const registrations: Array<Registration> = [];
  const entryTypes = options?.entryTypes ?? chromiumEntryTypes;

  const add = (entries: ReadonlyArray<EntryLike>): void => {
    timeline.push(...entries);
    Arr.forEach([...registrations], (registration) => {
      const matching = Arr.filter(entries, (entry) => entry.entryType === registration.type);
      if (Arr.isReadonlyArrayNonEmpty(matching)) registration.deliver(matching);
    });
  };

  const timestampOf = (endpoint: string | number): number => {
    if (P.isNumber(endpoint)) return endpoint;
    const found = Arr.findLast(
      timeline,
      (entry) => entry.entryType === "mark" && entry.name === endpoint,
    );
    if (Option.isNone(found)) throw syntaxError(`no mark named ${endpoint}`);
    return found.value.startTime;
  };

  const performance = {
    timeOrigin: options?.timeOrigin ?? 0,
    now: () => clock.now,
    mark: (name: string, markOptions?: MarkOptions): EntryLike => {
      const startTime = markOptions?.startTime ?? clock.now;
      if (startTime < 0) throw new TypeError("a mark's startTime cannot be negative");
      const entry: UserTiming = {
        name,
        entryType: "mark",
        startTime,
        duration: 0,
        detail: markOptions?.detail ?? null,
      };
      add([entry]);
      return entry;
    },
    measure: (name: string, measureOptions: MeasureOptions): EntryLike => {
      const { start, end, duration } = measureOptions;
      if (start !== undefined && end !== undefined && duration !== undefined) {
        throw new TypeError("a measure takes at most two of start, end and duration");
      }
      const endTime =
        end === undefined
          ? duration !== undefined && start !== undefined
            ? timestampOf(start) + duration
            : clock.now
          : timestampOf(end);
      const startTime =
        start === undefined
          ? duration === undefined
            ? 0
            : endTime - duration
          : timestampOf(start);
      const entry: UserTiming = {
        name,
        entryType: "measure",
        startTime,
        duration: endTime - startTime,
        detail: measureOptions.detail ?? null,
      };
      add([entry]);
      return entry;
    },
  };

  class TestPerformanceObserver implements PerformanceObserverLike {
    static readonly supportedEntryTypes = entryTypes;
    readonly #callback: (list: EntryListLike) => void;
    #registration: Option.Option<Registration> = Option.none();
    constructor(callback: (list: EntryListLike) => void) {
      this.#callback = callback;
    }
    observe(init: { readonly type: string; readonly buffered: boolean }): void {
      const deliver = (entries: ReadonlyArray<EntryLike>) =>
        this.#callback({ getEntries: () => entries });
      const registration: Registration = { type: init.type, deliver };
      this.#registration = Option.some(registration);
      registrations.push(registration);
      const buffered = Arr.filter(timeline, (entry) => entry.entryType === init.type);
      if (init.buffered && Arr.isReadonlyArrayNonEmpty(buffered)) deliver(buffered);
    }
    disconnect(): void {
      Option.map(this.#registration, (registration) => {
        const index = registrations.indexOf(registration);
        registrations.splice(index, 1);
      });
      this.#registration = Option.none();
    }
  }
  const Observer: PerformanceObserverConstructorLike = TestPerformanceObserver;

  return {
    performance: makePerformance(
      options?.supported === false
        ? {}
        : options?.observer === false
          ? { performance }
          : { performance, observer: Observer },
    ),
    control: Control.of({
      advance: (milliseconds) =>
        Effect.sync(() => {
          clock.now += milliseconds;
        }),
      record: (entries) => Effect.sync(() => add(entries)),
      entries: Effect.sync(() => [...timeline]),
      observing: Effect.sync(() => Arr.map(registrations, (registration) => registration.type)),
    }),
  };
};

/**
 * Provides `Performance` over a fresh in-memory timeline, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Performance } from "@thomasfosterau/effect-platform-worker-shared"
 * import { TestPerformance } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestPerformance.Control
 *   yield* Performance.mark("start")
 *   yield* control.advance(40)
 *   return yield* Performance.measure("work", { start: "start" })
 * })
 * Effect.runPromise(Effect.provide(program, TestPerformance.layer())).then(console.log)
 * // Some({ name: "work", entryType: "measure", startTime: 0, duration: 40, detail: null })
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Control> =>
  Layer.syncContext(() => {
    const { performance, control } = make(options);
    return Context.make(Performance, performance).pipe(Context.add(Control, control));
  });
