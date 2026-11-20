/**
 * A controllable frame clock for tests of code that uses `Frames`:
 * {@link layer} provides the real adapter over an in-memory
 * `requestAnimationFrame` and `requestIdleCallback`, plus {@link Control},
 * which runs a frame or an idle period when the test says so.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Types from "effect/Types";
import {
  type AnimationFramesLike,
  Frames,
  type FramesEnvironment,
  type IdleCallbacksLike,
  type IdleDeadlineLike,
  make as makeFrames,
} from "../Frames.ts";

/**
 * The in-memory clock's setup: `animation` and `idle` (default `true`)
 * build the service without that API when `false`; `now` (default `0`)
 * starts the clock, and `frameDuration` (default `16`) is how far each
 * frame moves it, in milliseconds.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly animation?: boolean;
  readonly idle?: boolean;
  readonly now?: number;
  readonly frameDuration?: number;
}

/**
 * An idle period to run: `timeRemaining` (default `50`, the platform's
 * most) in milliseconds, and `didTimeout` (default `false`).
 *
 * @since 0.1.0
 * @category models
 */
export interface IdlePeriod {
  readonly timeRemaining?: number;
  readonly didTimeout?: boolean;
}

/**
 * Drives the in-memory clock. `frame` waits until a frame is requested,
 * then moves the clock on by one frame (or `milliseconds`) and runs every
 * callback requested before it, as the browser does; `idle` waits until an
 * idle callback is requested, then runs every one pending with that
 * period. `pending` lists what is waiting: how many frame callbacks, and
 * each idle callback's `timeout`.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly frame: (milliseconds?: number) => Effect.Effect<void>;
    readonly idle: (period?: IdlePeriod) => Effect.Effect<void>;
    readonly pending: Effect.Effect<{
      readonly frames: number;
      readonly idle: ReadonlyArray<Option.Option<number>>;
    }>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/FramesControl") {}

/**
 * What {@link make} builds: the `Frames` service over the in-memory clock,
 * and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly frames: Frames["Service"];
  readonly control: Control["Service"];
}

interface Callback<A> {
  readonly handle: number;
  readonly run: (argument: A) => void;
  readonly timeout: Option.Option<number>;
}

/** A list of callbacks by handle, and the waiters for the next one to be added. */
const registry = <A>() => {
  const callbacks: Array<Callback<A>> = [];
  const waiters: Array<() => void> = [];
  const counter = { next: 1 };
  /** Hands the pending callbacks to the oldest waiter, if there are both. */
  const wake = (): void => {
    if (Arr.isReadonlyArrayNonEmpty(callbacks))
      Option.map(Option.fromUndefinedOr(waiters.shift()), (resume) => resume());
  };
  return {
    callbacks,
    add: (run: (argument: A) => void, timeout: Option.Option<number>): number => {
      const handle = counter.next;
      counter.next += 1;
      callbacks.push({ handle, run, timeout });
      // On a microtask, as the browser never calls back inside the request:
      // the caller stores the handle first.
      queueMicrotask(wake);
      return handle;
    },
    remove: (handle: number): void => {
      Option.map(
        Arr.findFirstIndex(callbacks, (callback) => callback.handle === handle),
        (index) => callbacks.splice(index, 1),
      );
    },
    /** Takes every callback, once there is at least one. */
    take: Effect.callback<ReadonlyArray<Callback<A>>>((resume) => {
      const drain = () => resume(Effect.succeed(callbacks.splice(0)));
      if (Arr.isReadonlyArrayNonEmpty(callbacks)) drain();
      else waiters.push(drain);
    }),
  };
};

/**
 * Builds an in-memory frame clock: the `Frames` service over it, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import { TestFrames } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { frames, control } = TestFrames.make({ now: 1000 })
 * const program = Effect.gen(function* () {
 *   const frame = yield* Effect.forkChild(frames.next)
 *   yield* control.frame()
 *   return yield* Fiber.join(frame)
 * })
 * Effect.runPromise(program).then(console.log) // 1016
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const settings = { animation: true, idle: true, now: 0, frameDuration: 16, ...options };
  const clock = { now: settings.now };
  const frames = registry<number>();
  const idles = registry<IdleDeadlineLike>();

  const animation: AnimationFramesLike = {
    requestAnimationFrame: (callback) => frames.add(callback, Option.none()),
    cancelAnimationFrame: frames.remove,
  };
  const idle: IdleCallbacksLike = {
    requestIdleCallback: (callback, init) =>
      idles.add(callback, Option.fromUndefinedOr(init?.timeout)),
    cancelIdleCallback: idles.remove,
  };

  const environment: Types.Mutable<FramesEnvironment> = {};
  if (settings.animation) environment.animation = animation;
  if (settings.idle) environment.idle = idle;

  return {
    frames: makeFrames(environment),
    control: Control.of({
      frame: (milliseconds) =>
        Effect.map(frames.take, (due) => {
          clock.now += milliseconds ?? settings.frameDuration;
          Arr.forEach(due, (callback) => callback.run(clock.now));
        }),
      idle: (period) =>
        Effect.map(idles.take, (due) => {
          const deadline: IdleDeadlineLike = {
            didTimeout: period?.didTimeout ?? false,
            timeRemaining: () => period?.timeRemaining ?? 50,
          };
          Arr.forEach(due, (callback) => callback.run(deadline));
        }),
      pending: Effect.sync(() => ({
        frames: frames.callbacks.length,
        idle: Arr.map(idles.callbacks, (callback) => callback.timeout),
      })),
    }),
  };
};

/**
 * Provides `Frames` over a fresh in-memory frame clock, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import * as Stream from "effect/Stream"
 * import { Frames } from "@thomasfosterau/effect-platform-browser"
 * import { TestFrames } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestFrames.Control
 *   const two = yield* Effect.forkChild(Stream.runCollect(Stream.take(Frames.ticks, 2)))
 *   yield* control.frame()
 *   yield* control.frame(32)
 *   return yield* Fiber.join(two)
 * })
 * Effect.runPromise(Effect.provide(program, TestFrames.layer())).then(console.log)
 * // [{ time: 16, delta: Duration(0) }, { time: 48, delta: Duration(32ms) }]
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Frames | Control> =>
  Layer.syncContext(() => {
    const { frames, control } = make(options);
    return Context.make(Frames, frames).pipe(Context.add(Control, control));
  });
