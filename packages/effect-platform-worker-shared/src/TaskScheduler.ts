/**
 * An `effect/Scheduler` that dispatches the runtime's work as prioritised
 * tasks through the Prioritized Task Scheduling API (`scheduler.postTask`),
 * in a window and in every worker scope, so a long Effect program yields to
 * input and rendering between batches instead of queueing behind
 * `setTimeout`'s clamp. Where `postTask` is missing (Safari, Node) it posts
 * through a `MessageChannel`, and without one keeps Effect's default.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scheduler from "effect/Scheduler";

/**
 * A `postTask` priority: `"user-blocking"` for work the user is waiting on,
 * `"user-visible"` (the platform's default) for work they will see,
 * `"background"` for work they will not.
 *
 * @since 0.1.0
 * @category models
 */
export type TaskPriority = "user-blocking" | "user-visible" | "background";

/**
 * The slice of the global `scheduler` this module calls. `yield` is newer
 * than `postTask`; an agent may have one without the other.
 *
 * @since 0.1.0
 * @category models
 */
export interface PostTaskSchedulerLike {
  postTask(
    callback: () => void,
    options?: { readonly priority?: TaskPriority; readonly signal?: AbortSignal },
  ): Promise<void>;
  yield?(): Promise<void>;
}

/**
 * The slice of a `MessagePort` this module calls. `ref` and `unref` are
 * Node's: a port with a listener keeps a Node process alive, so it is held
 * only while a task is pending.
 *
 * @since 0.1.0
 * @category models
 */
export interface MessagePortLike {
  addEventListener(type: "message", listener: () => void): void;
  postMessage(message: undefined): void;
  start(): void;
  ref?(): void;
  unref?(): void;
}

/**
 * The `MessageChannel` constructor.
 *
 * @since 0.1.0
 * @category models
 */
export interface MessageChannelConstructorLike {
  new (): { readonly port1: MessagePortLike; readonly port2: MessagePortLike };
}

/**
 * What a {@link TaskScheduler} dispatches through: the global `scheduler`,
 * else a `MessageChannel`. Neither means Effect's default macrotask.
 *
 * @since 0.1.0
 * @category models
 */
export interface SchedulingEnvironment {
  readonly scheduler?: PostTaskSchedulerLike;
  readonly MessageChannel?: MessageChannelConstructorLike;
}

/**
 * What {@link make} takes: the `priority` (default `"user-visible"`) every
 * task is posted at, and the `environment` to post through (default the
 * ambient one).
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly priority?: TaskPriority;
  readonly environment?: SchedulingEnvironment;
}

/**
 * Which API a {@link TaskScheduler} posts through.
 *
 * @since 0.1.0
 * @category models
 */
export type Backend = "postTask" | "MessageChannel" | "default";

type Macrotask = (task: () => void) => () => void;

/** Posts at `priority`, aborting on cancel; an abort's rejection is expected, any other is rethrown. */
const viaPostTask =
  (scheduler: PostTaskSchedulerLike, priority: TaskPriority): Macrotask =>
  (task) => {
    const controller = new AbortController();
    scheduler.postTask(task, { priority, signal: controller.signal }).catch((cause: unknown) => {
      if (!controller.signal.aborted) queueMicrotask(() => rethrow(cause));
    });
    return () => controller.abort();
  };

const rethrow = (cause: unknown): never => {
  throw cause;
};

type Channel = InstanceType<MessageChannelConstructorLike>;

interface Pending {
  readonly task: () => void;
  cancelled: boolean;
}

/** One channel, opened on the first task: each message runs the oldest pending task. */
const viaMessageChannel = (Channel: MessageChannelConstructorLike): Macrotask => {
  const pending: Array<Pending> = [];
  const state = { channel: Option.none<Channel>() };
  const run = (): void => {
    const next = pending.shift();
    if (Arr.isReadonlyArrayEmpty(pending))
      Option.map(state.channel, ({ port1 }) => port1.unref?.());
    if (next !== undefined && !next.cancelled) next.task();
  };
  const open = (): Channel =>
    Option.getOrElse(state.channel, () => {
      const channel = new Channel();
      channel.port1.addEventListener("message", run);
      channel.port1.start();
      state.channel = Option.some(channel);
      return channel;
    });
  return (task) => {
    const entry: Pending = { task, cancelled: false };
    const channel = open();
    if (Arr.isReadonlyArrayEmpty(pending)) channel.port1.ref?.();
    pending.push(entry);
    channel.port2.postMessage(undefined);
    return () => {
      entry.cancelled = true;
    };
  };
};

const backendOf = (environment: SchedulingEnvironment): Backend =>
  environment.scheduler === undefined
    ? environment.MessageChannel === undefined
      ? "default"
      : "MessageChannel"
    : "postTask";

const macrotaskFor = (
  environment: SchedulingEnvironment,
  priority: TaskPriority,
): Option.Option<Macrotask> =>
  environment.scheduler === undefined
    ? Option.map(Option.fromUndefinedOr(environment.MessageChannel), viaMessageChannel)
    : Option.some(viaPostTask(environment.scheduler, priority));

/**
 * Effect's own `MixedScheduler` (the same batching by priority and the same
 * yield budget, `Scheduler.MaxOpsBeforeYield`), posting each batch as a
 * task of the platform's instead of through `setTimeout`.
 *
 * @example
 * ```ts
 * import { TaskScheduler } from "@thomasfosterau/effect-platform-worker-shared"
 *
 * const scheduler = TaskScheduler.make({ priority: "background", environment: {} })
 * console.log(scheduler.backend, scheduler.priority) // "default" "background"
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export class TaskScheduler extends Scheduler.MixedScheduler {
  /** Which API the tasks are posted through. */
  readonly backend: Backend;
  /** The priority every task is posted at (moot unless `backend` is `"postTask"`). */
  readonly priority: TaskPriority;
  /** What the tasks are posted through. */
  readonly environment: SchedulingEnvironment;

  constructor(environment: SchedulingEnvironment, priority: TaskPriority) {
    super("async", Option.getOrUndefined(macrotaskFor(environment, priority)));
    this.backend = backendOf(environment);
    this.priority = priority;
    this.environment = environment;
  }

  /**
   * This scheduler at another priority, over the same environment. Only a
   * `postTask` scheduler has priorities; any other returns itself.
   */
  withPriority(priority: TaskPriority): TaskScheduler {
    return this.backend !== "postTask" || priority === this.priority
      ? this
      : new TaskScheduler(this.environment, priority);
  }
}

const ambientEnvironment = (): SchedulingEnvironment => {
  const scope: Partial<Pick<typeof globalThis, "scheduler" | "MessageChannel">> = globalThis;
  return scope;
};

/**
 * Builds a {@link TaskScheduler}. Without an `environment` it reads the
 * ambient `scheduler` and `MessageChannel`, when called.
 *
 * @example
 * ```ts
 * import { TaskScheduler } from "@thomasfosterau/effect-platform-worker-shared"
 *
 * console.log(TaskScheduler.make().backend) // "postTask" in Chromium or Firefox, "MessageChannel" in Safari or Node
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): TaskScheduler =>
  new TaskScheduler(
    options?.environment ?? ambientEnvironment(),
    options?.priority ?? "user-visible",
  );

/**
 * Runs everything it is provided to on a {@link TaskScheduler} over the
 * ambient environment, read when the layer builds. Provide it at the root
 * of a program (`Effect.provide`, or `WorkerRuntime.runMain`'s layer), so
 * every fiber inherits it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TaskScheduler } from "@thomasfosterau/effect-platform-worker-shared"
 *
 * const program = Effect.forEach(Array.from({ length: 10_000 }, (_, i) => i), (i) => Effect.succeed(i * 2))
 * Effect.runPromise(Effect.provide(program, TaskScheduler.layer())).then((xs) => console.log(xs.length)) // 10000
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Omit<Options, "environment">): Layer.Layer<never> =>
  Layer.sync(Scheduler.Scheduler, () => make(options));

const ambientByPriority: Partial<Record<TaskPriority, TaskScheduler>> = {};

/** The current scheduler at `priority`: itself if it is a TaskScheduler, else one over the ambient environment (one per priority). */
const atPriority = (current: Scheduler.Scheduler, priority: TaskPriority): TaskScheduler => {
  if (current instanceof TaskScheduler) return current.withPriority(priority);
  const cached = ambientByPriority[priority] ?? make({ priority });
  ambientByPriority[priority] = cached;
  return cached;
};

/**
 * Runs `self`, and every fiber it forks, on tasks posted at `priority`:
 * `"background"` for a bulk import that should never delay input,
 * `"user-blocking"` for the response to a click. Under a
 * {@link TaskScheduler} it keeps that scheduler's environment; otherwise it
 * posts through the ambient one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TaskScheduler } from "@thomasfosterau/effect-platform-worker-shared"
 *
 * const reindex = Effect.forEach([1, 2, 3], (n) => Effect.succeed(n), { concurrency: 2 })
 * Effect.runPromise(TaskScheduler.withPriority("background")(reindex)).then(console.log) // [1, 2, 3]
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const withPriority =
  (priority: TaskPriority) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Scheduler.Scheduler.use((current) =>
      Effect.provideService(self, Scheduler.Scheduler, atPriority(current, priority)),
    );

/**
 * Yields to the event loop, so input, rendering and other tasks run before
 * the fiber resumes: `scheduler.yield()` where the agent has it (the
 * continuation keeps its priority, ahead of newly posted tasks), else a
 * task posted as the current {@link TaskScheduler} posts one. Unlike
 * `Effect.yieldNow`, this always leaves the current task, whatever the
 * scheduler.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TaskScheduler } from "@thomasfosterau/effect-platform-worker-shared"
 *
 * const chunked = Effect.forEach([1, 2, 3], (chunk) =>
 *   Effect.andThen(TaskScheduler.yieldToMain, Effect.succeed(chunk * 10)),
 * )
 * Effect.runPromise(chunked).then(console.log) // [10, 20, 30]
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const yieldToMain: Effect.Effect<void> = Scheduler.Scheduler.use((current) => {
  const scheduler = atPriority(
    current,
    current instanceof TaskScheduler ? current.priority : "user-visible",
  );
  const platform = scheduler.environment.scheduler;
  return Effect.callback<void>((resume) => {
    if (platform?.yield !== undefined) {
      // It rejects only when aborted, and this passes no signal.
      void platform.yield().then(
        () => resume(Effect.void),
        () => resume(Effect.void),
      );
      return Effect.void;
    }
    const cancel = scheduler.setImmediate(() => resume(Effect.void));
    return Effect.sync(cancel);
  });
});
