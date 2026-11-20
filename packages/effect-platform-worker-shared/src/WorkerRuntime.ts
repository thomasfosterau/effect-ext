/**
 * Running a worker's main program: Effect's `Runtime.makeRunMain` with the
 * worker's own lifecycle. Uncaught exceptions and unhandled rejections are
 * logged through the main fiber's logger while it runs, and a teardown can
 * close the worker when the program ends.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import { constVoid } from "effect/Function";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Runtime from "effect/Runtime";
import { toUncaught, Uncaught, type WorkerGlobalScopeLike } from "./WorkerScope.ts";

/**
 * The scope {@link make} attaches to: the shared slice of every worker
 * global, plus `close` where the worker can end itself (a dedicated or
 * shared worker; a service worker cannot).
 *
 * @since 0.1.0
 * @category models
 */
export interface RunScope extends Pick<
  WorkerGlobalScopeLike,
  "addEventListener" | "removeEventListener"
> {
  readonly close?: () => void;
}

/**
 * The options every `runMain` takes, as `Runtime.makeRunMain` defines them.
 *
 * @since 0.1.0
 * @category models
 */
export interface RunMainOptions {
  readonly disableErrorReporting?: boolean;
  readonly teardown?: Runtime.Teardown;
}

/**
 * A `runMain` function: data-first or data-last.
 *
 * @since 0.1.0
 * @category models
 */
export interface RunMain {
  (options?: RunMainOptions): <E, A>(effect: Effect.Effect<A, E>) => void;
  <E, A>(effect: Effect.Effect<A, E>, options?: RunMainOptions): void;
}

const UNCAUGHT_TYPES = ["error", "unhandledrejection"] as const;

const logUncaught = Uncaught.$match({
  Error: ({ message, error }) => Effect.logError("worker: uncaught exception", message, error),
  UnhandledRejection: ({ reason }) => Effect.logError("worker: unhandled rejection", reason),
});

/**
 * Builds a `runMain` over `self` (the worker's global, or a stub in a
 * test). While the main fiber runs, every `error` and `unhandledrejection`
 * event on `self` is logged at `Error` level with the fiber's own services,
 * so a logger the program provides at its root sees them. When the fiber
 * ends the listeners come off and the teardown runs; pass
 * {@link closeOnExit} as the teardown to end the worker with its program.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/WorkerRuntime"
 *
 * const self = new EventTarget()
 * make(self)(Effect.log("worker started"))
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (self: RunScope): RunMain => Runtime.makeRunMain(attach(() => self));

/** The setup `Runtime.makeRunMain` runs, over the scope `self()` returns. */
const attach =
  (self: () => RunScope) =>
  <E, A>({
    fiber,
    teardown,
  }: {
    readonly fiber: Fiber.Fiber<A, E>;
    readonly teardown: Runtime.Teardown;
  }) => {
    const target = self();
    // A host with no event target as its global (Node) has nothing to watch.
    const listeners = !P.isFunction(target.addEventListener)
      ? []
      : Arr.map(UNCAUGHT_TYPES, (type) => {
          const listener = (event: unknown): void => {
            Option.map(toUncaught(type, event), (uncaught) =>
              Effect.runForkWith(fiber.context)(logUncaught(uncaught)),
            );
          };
          target.addEventListener(type, listener);
          return [type, listener] as const;
        });
    fiber.addObserver((exit) => {
      Arr.forEach(listeners, ([type, listener]) => target.removeEventListener(type, listener));
      // A worker has no exit code to report.
      teardown(exit, constVoid);
    });
  };

/**
 * Builds a teardown that runs `Runtime.defaultTeardown` and then closes
 * `self`: a dedicated or shared worker whose program has ended has nothing
 * left to do. A worker serving `effect/workers` requests should not use it:
 * its program runs until the page terminates it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { closeOnExit, make } from "@thomasfosterau/effect-platform-worker-shared/WorkerRuntime"
 *
 * const self = Object.assign(new EventTarget(), { close: () => console.log("closed") })
 * make(self)(Effect.void, { teardown: closeOnExit(self) }) // logs "closed"
 * ```
 *
 * @since 0.1.0
 * @category teardown
 */
export const closeOnExit =
  (self: RunScope): Runtime.Teardown =>
  (exit, onExit) =>
    Runtime.defaultTeardown(exit, (code) => {
      onExit(code);
      self.close?.();
    });

/**
 * Runs a worker's main program over the ambient `globalThis` (read when it
 * is called, never at import). See {@link make}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { runMain } from "@thomasfosterau/effect-platform-worker-shared/WorkerRuntime"
 *
 * runMain(Effect.log("worker started"))
 * ```
 *
 * @since 0.1.0
 * @category running
 */
export const runMain: RunMain = /*#__PURE__*/ Runtime.makeRunMain(attach(() => globalThis));
