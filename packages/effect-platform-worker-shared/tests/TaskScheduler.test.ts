import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Scheduler from "effect/Scheduler";
import * as TaskScheduler from "@thomasfosterau/effect-platform-worker-shared/TaskScheduler";

interface Posted {
  readonly priority: string;
  readonly aborted: () => boolean;
}

const record = (init?: { readonly priority?: string; readonly signal?: AbortSignal }): Posted => ({
  priority: init?.priority ?? "none",
  aborted: () => init?.signal?.aborted === true,
});

/** A `scheduler` that runs each posted task on a timer, recording its options. */
const stubPostTask = (options?: {
  readonly withYield?: boolean;
  readonly rejectYield?: boolean;
}) => {
  const posted: Array<Posted> = [];
  const yields = { count: 0 };
  const postTask: TaskScheduler.PostTaskSchedulerLike["postTask"] = (callback, init) => {
    posted.push(record(init));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        callback();
        resolve();
      }, 0);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  };
  const scheduler: TaskScheduler.PostTaskSchedulerLike =
    options?.withYield === true
      ? {
          postTask,
          yield: () => {
            yields.count += 1;
            return options.rejectYield === true
              ? Promise.reject(new DOMException("aborted", "AbortError"))
              : Promise.resolve();
          },
        }
      : { postTask };
  return { scheduler, posted, yields };
};

/** A `MessageChannel` whose messages arrive on a timer, recording `ref` / `unref`. */
const stubChannel = (options?: { readonly refable?: boolean }) => {
  const calls: Array<string> = [];
  const channels: Array<FakeChannel> = [];
  class FakePort {
    readonly listeners: Array<() => void> = [];
    other = Option.none<FakePort>();
    started = false;
    addEventListener(_type: "message", listener: () => void): void {
      this.listeners.push(listener);
    }
    postMessage(_message: undefined): void {
      const target = this.other;
      setTimeout(() => {
        Option.map(
          Option.filter(target, (port) => port.started),
          (port) => Arr.forEach(port.listeners, (listener) => listener()),
        );
      }, 0);
    }
    start(): void {
      this.started = true;
    }
  }
  class RefablePort extends FakePort {
    ref(): void {
      calls.push("ref");
    }
    unref(): void {
      calls.push("unref");
    }
  }
  class FakeChannel {
    readonly port1: FakePort;
    readonly port2: FakePort;
    constructor() {
      const Port = options?.refable === true ? RefablePort : FakePort;
      this.port1 = new Port();
      this.port2 = new Port();
      this.port2.other = Option.some(this.port1);
      channels.push(this);
    }
  }
  return { MessageChannel: FakeChannel, calls, channels };
};

/** Runs `task` through the scheduler's macrotask, resolving once it has run. */
const macrotask = (scheduler: TaskScheduler.TaskScheduler) =>
  Effect.callback<string>((resume) => {
    scheduler.setImmediate(() => resume(Effect.succeed("ran")));
  });

const busyWork = Effect.forEach(Arr.range(1, 5_000), (n) => Effect.succeed(n * 2), {
  concurrency: 1,
});

const provideScheduler =
  (scheduler: Scheduler.Scheduler) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.provideService(self, Scheduler.Scheduler, scheduler);

describe("TaskScheduler over postTask", () => {
  it.live("posts every batch at its priority, and withPriority moves it", () =>
    Effect.gen(function* () {
      const { scheduler, posted } = stubPostTask();
      const tasks = TaskScheduler.make({ environment: { scheduler } });
      expect([tasks.backend, tasks.priority]).toEqual(["postTask", "user-visible"]);
      expect(tasks.withPriority("user-visible")).toBe(tasks);
      const result = yield* Effect.all(
        [
          busyWork,
          TaskScheduler.withPriority("background")(Effect.andThen(Effect.yieldNow, busyWork)),
        ],
        { concurrency: "unbounded" },
      ).pipe(provideScheduler(tasks));
      expect(Arr.map(result, (xs) => xs.length)).toEqual([5_000, 5_000]);
      const priorities = Arr.dedupe(Arr.map(posted, (task) => task.priority));
      expect(Arr.sort(priorities, Order.String)).toEqual(["background", "user-visible"]);
    }),
  );

  it.live("aborts a cancelled task, and swallows that rejection", () =>
    Effect.gen(function* () {
      const { scheduler, posted } = stubPostTask();
      const tasks = TaskScheduler.make({ priority: "user-blocking", environment: { scheduler } });
      const ran = { count: 0 };
      const cancel = tasks.setImmediate(() => {
        ran.count += 1;
      });
      cancel();
      expect(yield* macrotask(tasks)).toBe("ran");
      expect([ran.count, posted[0]?.aborted(), posted[0]?.priority]).toEqual([
        0,
        true,
        "user-blocking",
      ]);
    }),
  );

  it.live("rethrows a task's own failure, outside the promise", () =>
    Effect.gen(function* () {
      const boom = { boom: true };
      const scheduler: TaskScheduler.PostTaskSchedulerLike = {
        postTask: () => Promise.reject(boom),
      };
      const rethrown = yield* Effect.callback<() => void>((resume) => {
        const original = globalThis.queueMicrotask;
        globalThis.queueMicrotask = (callback) => {
          globalThis.queueMicrotask = original;
          resume(Effect.succeed(callback));
        };
        TaskScheduler.make({ environment: { scheduler } }).setImmediate(() => undefined);
      });
      const thrown = yield* Effect.flip(
        Effect.try({ try: rethrown, catch: (cause) => ({ cause }) }),
      );
      expect(thrown.cause).toBe(boom);
    }),
  );
});

describe("TaskScheduler over MessageChannel", () => {
  it.live("opens one channel on the first task, holding it only while tasks are pending", () =>
    Effect.gen(function* () {
      const { MessageChannel, calls, channels } = stubChannel({ refable: true });
      const tasks = TaskScheduler.make({ environment: { MessageChannel } });
      expect(channels).toHaveLength(0);
      expect(tasks.backend).toBe("MessageChannel");
      expect(tasks.withPriority("background")).toBe(tasks);
      expect((yield* busyWork.pipe(provideScheduler(tasks))).length).toBe(5_000);
      expect(channels).toHaveLength(1);
      expect(Arr.dedupe(Arr.map(Arr.chunksOf(calls, 2), (pair) => pair.join(",")))).toEqual([
        "ref,unref",
      ]);
    }),
  );

  it.live("skips a cancelled task and a stray message", () =>
    Effect.gen(function* () {
      const { MessageChannel, channels } = stubChannel();
      const tasks = TaskScheduler.make({ environment: { MessageChannel } });
      const ran = { count: 0 };
      tasks.setImmediate(() => {
        ran.count += 1;
      })();
      channels[0]?.port2.postMessage(undefined);
      expect(yield* macrotask(tasks)).toBe("ran");
      expect(ran.count).toBe(0);
    }),
  );
});

describe("TaskScheduler without either API", () => {
  it.live("keeps Effect's default macrotask", () =>
    Effect.gen(function* () {
      const tasks = TaskScheduler.make({ environment: {} });
      expect([tasks.backend, tasks.withPriority("background")]).toEqual(["default", tasks]);
      expect((yield* busyWork.pipe(provideScheduler(tasks))).length).toBe(5_000);
    }),
  );
});

describe("TaskScheduler.yieldToMain", () => {
  it.live("uses scheduler.yield where the agent has it, resuming even on a rejection", () =>
    Effect.gen(function* () {
      const kept = stubPostTask({ withYield: true });
      yield* TaskScheduler.yieldToMain.pipe(
        provideScheduler(TaskScheduler.make({ environment: { scheduler: kept.scheduler } })),
      );
      const rejected = stubPostTask({ withYield: true, rejectYield: true });
      yield* TaskScheduler.yieldToMain.pipe(
        provideScheduler(TaskScheduler.make({ environment: { scheduler: rejected.scheduler } })),
      );
      expect([kept.yields.count, rejected.yields.count]).toEqual([1, 1]);
    }),
  );

  it.live("otherwise posts a task at the current priority, aborted on interruption", () =>
    Effect.gen(function* () {
      const { scheduler, posted } = stubPostTask();
      const tasks = TaskScheduler.make({ priority: "background", environment: { scheduler } });
      yield* TaskScheduler.yieldToMain.pipe(provideScheduler(tasks));
      expect(Arr.some(posted, (task) => task.priority === "background")).toBe(true);

      const never: TaskScheduler.PostTaskSchedulerLike = {
        postTask: (_callback, init) => {
          posted.push(record(init));
          return new Promise<void>(() => undefined);
        },
      };
      const before = posted.length;
      const fiber = yield* Effect.forkChild(
        TaskScheduler.yieldToMain.pipe(
          provideScheduler(TaskScheduler.make({ environment: { scheduler: never } })),
        ),
      );
      yield* Effect.sleep("5 millis");
      yield* Fiber.interrupt(fiber);
      expect(Arr.some(posted.slice(before), (task) => task.aborted())).toBe(true);
    }),
  );
});

describe("TaskScheduler's ambient environment", () => {
  it.live("is Node's MessageChannel here, and lets the process idle", () =>
    Effect.gen(function* () {
      expect(TaskScheduler.make().backend).toBe("MessageChannel");
      const layered = yield* Effect.provide(
        Scheduler.Scheduler.use((current) => Effect.succeed(current)),
        TaskScheduler.layer({ priority: "background" }),
      );
      expect(layered).toBeInstanceOf(TaskScheduler.TaskScheduler);
      expect((yield* Effect.provide(busyWork, TaskScheduler.layer())).length).toBe(5_000);
      const twice = yield* Effect.all(
        [
          TaskScheduler.withPriority("background")(
            Effect.andThen(TaskScheduler.yieldToMain, busyWork),
          ),
          TaskScheduler.withPriority("background")(busyWork),
        ],
        { concurrency: "unbounded" },
      );
      expect(twice.length).toBe(2);
      yield* TaskScheduler.yieldToMain;
    }),
  );
});
