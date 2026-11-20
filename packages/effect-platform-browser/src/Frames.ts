/**
 * Animation frames and idle callbacks as an Effect service: wait for the
 * next frame, stream every frame, or wait for the browser to be idle.
 *
 * Both are a window's. `requestAnimationFrame` pauses in a hidden tab, so
 * {@link ticks} stops with it (`PageVisibility` says when); Safari has no
 * `requestIdleCallback`, so {@link idle} fails `Unsupported` there and a
 * caller falls back as it sees fit. To keep long Effect work off the
 * critical path instead, run it on `effect-platform-worker-shared`'s
 * `TaskScheduler`.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import { ambientAnimationFrames, ambientIdleCallbacks } from "./internal/globals.ts";

/**
 * The window's `requestAnimationFrame` and `cancelAnimationFrame`.
 *
 * @since 0.1.0
 * @category models
 */
export interface AnimationFramesLike {
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

/**
 * The `IdleDeadline` an idle callback receives.
 *
 * @since 0.1.0
 * @category models
 */
export interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

/**
 * The window's `requestIdleCallback` and `cancelIdleCallback`.
 *
 * @since 0.1.0
 * @category models
 */
export interface IdleCallbacksLike {
  requestIdleCallback(
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { readonly timeout?: number },
  ): number;
  cancelIdleCallback(handle: number): void;
}

/**
 * What {@link make} builds over: either API may be missing.
 *
 * @since 0.1.0
 * @category models
 */
export interface FramesEnvironment {
  readonly animation?: AnimationFramesLike;
  readonly idle?: IdleCallbacksLike;
}

/**
 * One frame: its `time` (the frame's start, a `performance.now()`
 * timestamp in milliseconds) and the `delta` since the frame before it
 * (zero on the first).
 *
 * @since 0.1.0
 * @category models
 */
export interface FrameTick {
  readonly time: number;
  readonly delta: Duration.Duration;
}

/**
 * An idle period, as it stood when the browser called back: `didTimeout`
 * when the browser was never idle before the timeout, and the
 * `timeRemaining` it then gave the period (at most 50 milliseconds). The
 * fiber resumes in a later task, so spend the budget on work sized to fit
 * it rather than measuring it again.
 *
 * @since 0.1.0
 * @category models
 */
export interface IdleDeadlineInfo {
  readonly didTimeout: boolean;
  readonly timeRemaining: Duration.Duration;
}

/**
 * What {@link idle} takes: a `timeout` after which the browser calls back
 * even if it never became idle.
 *
 * @since 0.1.0
 * @category models
 */
export interface IdleOptions {
  readonly timeout?: Duration.Input;
}

/**
 * The API a frame or idle call needed and the agent lacks: `"animationFrame"`
 * (a worker, a server render) or `"idleCallback"` (Safari too).
 *
 * @since 0.1.0
 * @category models
 */
export type FramesApi = "animationFrame" | "idleCallback";

/**
 * The agent has no `requestAnimationFrame`, or no `requestIdleCallback`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Frames } from "@thomasfosterau/effect-platform-browser"
 *
 * Effect.runPromise(Effect.flip(Frames.make().next)).then((error) => console.log(error.api)) // "animationFrame"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class FramesError extends Schema.TaggedError<FramesError>()("FramesError", {
  reason: Schema.Literal("Unsupported"),
  api: Schema.Literals(["animationFrame", "idleCallback"]),
  message: Schema.String,
}) {}

const unsupported = (api: FramesApi): FramesError =>
  new FramesError({ reason: "Unsupported", api, message: `${api}: Unsupported` });

/**
 * The frames service. Provide {@link layer} in a page, or
 * `TestFrames.layer` from `@thomasfosterau/effect-platform-browser/BrowserTesting` in tests.
 *
 * - `supported` — which of the two APIs the agent has.
 * - `next` — the next frame's time.
 * - `ticks` — every frame until the stream's scope closes.
 * - `idle` — the next idle period.
 *
 * @since 0.1.0
 * @category services
 */
export class Frames extends Context.Service<
  Frames,
  {
    readonly supported: { readonly animation: boolean; readonly idle: boolean };
    readonly next: Effect.Effect<number, FramesError>;
    readonly ticks: Stream.Stream<FrameTick, FramesError>;
    readonly idle: (options?: IdleOptions) => Effect.Effect<IdleDeadlineInfo, FramesError>;
  }
>()("@thomasfosterau/effect-platform-browser/Frames") {}

const nextOver = (animation: AnimationFramesLike): Effect.Effect<number> =>
  Effect.callback<number>((resume) => {
    const handle = animation.requestAnimationFrame((time) => resume(Effect.succeed(time)));
    return Effect.sync(() => animation.cancelAnimationFrame(handle));
  });

const ticksOver = (animation: AnimationFramesLike): Stream.Stream<FrameTick> =>
  Stream.callback<FrameTick>(
    (queue) => {
      const state = { handle: 0, previous: Option.none<number>() };
      const onFrame = (time: number): void => {
        const delta = Option.match(state.previous, {
          onNone: () => Duration.zero,
          onSome: (previous) => Duration.millis(time - previous),
        });
        state.previous = Option.some(time);
        state.handle = animation.requestAnimationFrame(onFrame);
        Queue.offerUnsafe(queue, { time, delta });
      };
      return Effect.acquireRelease(
        Effect.sync(() => {
          state.handle = animation.requestAnimationFrame(onFrame);
        }),
        () => Effect.sync(() => animation.cancelAnimationFrame(state.handle)),
      );
    },
    { bufferSize: 8, strategy: "sliding" },
  );

const idleOver =
  (idle: IdleCallbacksLike) =>
  (options?: IdleOptions): Effect.Effect<IdleDeadlineInfo> =>
    Effect.callback<IdleDeadlineInfo>((resume) => {
      const onIdle = (deadline: IdleDeadlineLike): void =>
        resume(
          Effect.succeed({
            didTimeout: deadline.didTimeout,
            timeRemaining: Duration.millis(deadline.timeRemaining()),
          }),
        );
      const handle = Option.match(Option.fromUndefinedOr(options?.timeout), {
        onNone: () => idle.requestIdleCallback(onIdle),
        onSome: (timeout) =>
          idle.requestIdleCallback(onIdle, { timeout: Duration.toMillis(timeout) }),
      });
      return Effect.sync(() => idle.cancelIdleCallback(handle));
    });

/**
 * Builds the {@link Frames} service over the given APIs; each one missing
 * fails its calls `Unsupported`. {@link layer} passes the window's.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Frames } from "@thomasfosterau/effect-platform-browser"
 *
 * const frames = Frames.make({
 *   animation: {
 *     requestAnimationFrame: (callback) => {
 *       queueMicrotask(() => callback(16))
 *       return 1
 *     },
 *     cancelAnimationFrame: () => {},
 *   },
 * })
 * Effect.runPromise(frames.next).then(console.log) // 16
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (environment?: FramesEnvironment): Frames["Service"] => {
  const animation = Option.fromUndefinedOr(environment?.animation);
  const idle = Option.fromUndefinedOr(environment?.idle);
  return Frames.of({
    supported: { animation: Option.isSome(animation), idle: Option.isSome(idle) },
    next: Option.match(animation, {
      onNone: () => Effect.fail(unsupported("animationFrame")),
      onSome: nextOver,
    }),
    ticks: Option.match(animation, {
      onNone: () => Stream.fail(unsupported("animationFrame")),
      onSome: ticksOver,
    }),
    idle: Option.match(idle, {
      onNone: () => () => Effect.fail(unsupported("idleCallback")),
      onSome: idleOver,
    }),
  });
};

/**
 * The {@link Frames} service over the window's `requestAnimationFrame` and
 * `requestIdleCallback`; in a worker or a server render, `supported` is
 * `false` for both.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Frames } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.map(Frames.Frames, (frames) => frames.supported)
 * Effect.runPromise(Effect.provide(program, Frames.layer)).then(console.log)
 * // { animation: false, idle: false } under Node
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<Frames> = Layer.sync(Frames, () => {
  const environment: Types.Mutable<FramesEnvironment> = {};
  Option.map(ambientAnimationFrames(), (animation) => {
    environment.animation = animation;
  });
  Option.map(ambientIdleCallbacks(), (idle) => {
    environment.idle = idle;
  });
  return make(environment);
});

/**
 * The next frame's time, a `performance.now()` timestamp in milliseconds:
 * read layout or start an animation once the browser is about to paint.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import { Frames } from "@thomasfosterau/effect-platform-browser"
 * import { TestFrames } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestFrames.Control
 *   const frame = yield* Effect.forkChild(Frames.next)
 *   yield* control.frame()
 *   return yield* Fiber.join(frame)
 * })
 * Effect.runPromise(Effect.provide(program, TestFrames.layer())).then(console.log) // 16
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const next: Effect.Effect<number, FramesError, Frames> = Effect.flatMap(
  Frames,
  (frames) => frames.next,
);

/**
 * Every frame, each with the time since the one before, until the
 * stream's scope closes. A consumer slower than the frame rate sees the
 * latest eight frames, not a growing backlog; the paused frames of a hidden tab are
 * simply absent, so expect a long `delta` on return.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Frames } from "@thomasfosterau/effect-platform-browser"
 *
 * const spin = Frames.ticks.pipe(
 *   Stream.runForEach(({ delta }) => Effect.log(`rotate by ${delta}`)),
 * )
 * Effect.runFork(Effect.ignore(Effect.provide(spin, Frames.layer)))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const ticks: Stream.Stream<FrameTick, FramesError, Frames> = Stream.unwrap(
  Effect.map(Frames, (frames) => frames.ticks),
);

/**
 * The next idle period: when the browser has finished a frame's work with
 * time to spare, or after `timeout` if it never does.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import { Frames } from "@thomasfosterau/effect-platform-browser"
 * import { TestFrames } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestFrames.Control
 *   const period = yield* Effect.forkChild(Frames.idle({ timeout: "1 second" }))
 *   yield* control.idle()
 *   return yield* Fiber.join(period)
 * })
 * Effect.runPromise(Effect.provide(program, TestFrames.layer())).then(console.log)
 * // { didTimeout: false, timeRemaining: Duration(50ms) }
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const idle = (options?: IdleOptions): Effect.Effect<IdleDeadlineInfo, FramesError, Frames> =>
  Effect.flatMap(Frames, (frames) => frames.idle(options));
