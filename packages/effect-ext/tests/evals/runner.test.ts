/**
 * Unit tests for `Runner.runSuite`: end-to-end execution against a stubbed
 * task/scorer, N-trial aggregation, retry-on-retryable-`AiError`,
 * content-hash caching (zero model calls on a repeat run), and the
 * ignore-vs-fail metric-error semantics.
 *
 * @module tests/runner
 */

import { describe, expect, it, layer } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { AiError } from "effect/ai";
import {
  Cache,
  Dataset,
  Metric,
  Result,
  Runner,
  Scorer,
  Threshold,
} from "../../src/evals/index.ts";

class TaskError {
  readonly _tag = "TaskError";
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

/** One statistic of a metric's summary, `NaN` when the metric has none (so an assertion on it fails). */
const statOf = (stat: "mean" | "min" | "max", metric?: Result.MetricAggregate): number =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(metric), (found) =>
      Option.map(found.summary, (spread) => spread[stat]),
    ),
    () => Number.NaN,
  );

/** Immediate retries (no delay) so retry tests stay fast. */
const fastSchedule = Schedule.recurs(5);

const exactMatchMetric = Metric.makeMetric({
  name: "exact-match",
  scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
    name: "exact-match",
    evaluate: (evalCase) => Effect.succeed({ score: evalCase.golden === evalCase.output ? 1 : 0 }),
  }),
  threshold: Threshold.strict,
});

const echoTask = Runner.makeTask<string, string>({
  id: "echo@v1",
  run: (golden) => Effect.succeed(golden),
});

layer(Cache.layerMemory, { buildPerTest: true })("Runner.runSuite — end to end", (t) => {
  t.effect("runs every golden through the task and every metric, bounded concurrency", () =>
    Effect.gen(function* () {
      const suite = Runner.makeSuite({
        name: "greetings",
        dataset: Dataset.fromArray("greetings", ["Bonjour", "Ciao"]),
        task: echoTask,
        metrics: [exactMatchMetric],
      });

      const result = yield* Runner.runSuite(suite);

      expect(result.suite).toBe("greetings");
      expect(result.passed).toBe(true);
      expect(result.cases).toHaveLength(2);
      expect(statOf("mean", result.cases[0]?.metrics[0])).toBe(1);
      expect(result.cases[0]?.metrics[0]?.passed).toBe(true);
    }),
  );

  t.effect("fails the case when the metric's score misses its threshold", () =>
    Effect.gen(function* () {
      const suite = Runner.makeSuite({
        name: "mismatches",
        dataset: Dataset.fromArray("mismatches", ["Bonjour"]),
        task: Runner.makeTask<string, string>({
          id: "shout@v1",
          run: (g) => Effect.succeed(g.toUpperCase()),
        }),
        metrics: [exactMatchMetric],
      });

      const result = yield* Runner.runSuite(suite);

      expect(result.passed).toBe(false);
      expect(result.cases[0]?.metrics[0]?.passed).toBe(false);
      expect(statOf("mean", result.cases[0]?.metrics[0])).toBe(0);
    }),
  );

  t.effect("propagates a dataset failure rather than swallowing it", () =>
    Effect.gen(function* () {
      class DatasetError {
        readonly _tag = "DatasetError";
      }
      const suite = Runner.makeSuite({
        name: "broken",
        dataset: Dataset.makeDataset<string, DatasetError>({
          name: "broken",
          goldens: Effect.fail(new DatasetError()),
        }),
        task: echoTask,
        metrics: [exactMatchMetric],
      });

      expect(yield* Effect.flip(Runner.runSuite(suite))).toBeInstanceOf(DatasetError);
    }),
  );
});

layer(Cache.layerMemory, { buildPerTest: true })("Runner.runSuite — trials", (t) => {
  t.effect("aggregates mean/variance/min/max and exposes every per-trial score", () =>
    Effect.gen(function* () {
      const scores = [0.6, 0.8, 1];
      let call = 0;
      const varyingMetric = Metric.makeMetric({
        name: "varying",
        scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
          name: "varying",
          evaluate: () => Effect.sync(() => ({ score: scores[call++] ?? 1 })),
        }),
        threshold: Threshold.minScore(0.5),
      });

      const suite = Runner.makeSuite({
        name: "trials",
        dataset: Dataset.fromArray("trials", ["Bonjour"]),
        task: echoTask,
        metrics: [varyingMetric],
      });

      const result = yield* Runner.runSuite(suite, { trials: 3 });

      const metric = result.cases[0]?.metrics[0];
      expect(metric?.trials).toHaveLength(3);
      expect(statOf("mean", metric)).toBeCloseTo(0.8);
      expect(statOf("min", metric)).toBe(0.6);
      expect(statOf("max", metric)).toBe(1);
      expect(metric?.passed).toBe(true);
    }),
  );

  t.effect("keeps every trial's task output and duration beside its scores", () =>
    Effect.gen(function* () {
      const suite = Runner.makeSuite({
        name: "outputs",
        dataset: Dataset.fromArray("outputs", ["Bonjour"]),
        task: echoTask,
        metrics: [exactMatchMetric],
      });

      const result = yield* Runner.runSuite(suite, { trials: 2, bypassCache: true });

      const outputs = result.cases[0]?.taskOutputs ?? [];
      expect(outputs.map((output) => output.trial)).toEqual([1, 2]);
      expect(outputs.every((output) => output.output === result.cases[0]?.golden)).toBe(true);
      expect(outputs.every((output) => output.durationMillis >= 0 && !output.cached)).toBe(true);
    }),
  );

  t.effect("clamps a non-positive trials option to 1 instead of running zero trials", () =>
    Effect.gen(function* () {
      let taskCalls = 0;
      const suite = Runner.makeSuite({
        name: "clamped",
        dataset: Dataset.fromArray("clamped", ["Bonjour"]),
        task: Runner.makeTask<string, string>({
          id: "counting@v1",
          run: (golden) =>
            Effect.sync(() => {
              taskCalls++;
              return golden;
            }),
        }),
        metrics: [exactMatchMetric],
      });

      const result = yield* Runner.runSuite(suite, { trials: 0 });

      // trials: 0 doesn't mean "skip the case" — it's clamped to the minimum
      // meaningful value (1), and the reported trial count matches what ran.
      expect(taskCalls).toBe(1);
      expect(result.cases[0]?.trials).toBe(1);
      expect(result.cases[0]?.metrics[0]?.trials).toHaveLength(1);
    }),
  );
});

layer(Cache.layerMemory, { buildPerTest: true })("Runner.runSuite — retry", (t) => {
  t.effect("retries a retryable AiError and eventually succeeds", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const flakyMetric = Metric.makeMetric({
        name: "flaky",
        scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>, AiError.AiError>({
          name: "flaky",
          evaluate: () =>
            Effect.gen(function* () {
              attempts++;
              if (attempts < 3) {
                return yield* AiError.make({
                  module: "test",
                  method: "flaky",
                  reason: new AiError.RateLimitError({}),
                });
              }
              return { score: 1 };
            }),
        }),
        threshold: Threshold.strict,
      });

      const suite = Runner.makeSuite({
        name: "retry",
        dataset: Dataset.fromArray("retry", ["Bonjour"]),
        task: echoTask,
        metrics: [flakyMetric],
      });

      const result = yield* Runner.runSuite(suite, { metricRetrySchedule: fastSchedule });

      expect(attempts).toBe(3);
      expect(result.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ _tag: "Scored" });
      expect(result.cases[0]?.metrics[0]?.passed).toBe(true);
    }),
  );

  t.effect("does not retry a non-retryable AiError, surfacing it as an Errored trial", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const authFailingMetric = Metric.makeMetric({
        name: "auth-failing",
        scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>, AiError.AiError>({
          name: "auth-failing",
          evaluate: () =>
            Effect.gen(function* () {
              attempts++;
              return yield* AiError.make({
                module: "test",
                method: "authFailing",
                reason: new AiError.AuthenticationError({ kind: "InvalidKey" }),
              });
            }),
        }),
        threshold: Threshold.strict,
      });

      const suite = Runner.makeSuite({
        name: "no-retry",
        dataset: Dataset.fromArray("no-retry", ["Bonjour"]),
        task: echoTask,
        metrics: [authFailingMetric],
      });

      const result = yield* Runner.runSuite(suite, { metricRetrySchedule: fastSchedule });

      expect(attempts).toBe(1);
      expect(result.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ _tag: "Errored" });
      expect(result.cases[0]?.metrics[0]?.errorCount).toBe(1);
    }),
  );

  t.effect("does not retry the task when its error is not an AiError", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const suite = Runner.makeSuite({
        name: "task-error",
        dataset: Dataset.fromArray("task-error", ["Bonjour"]),
        task: Runner.makeTask<string, string, TaskError>({
          id: "always-fails@v1",
          run: () =>
            Effect.sync(() => {
              attempts++;
            }).pipe(Effect.flatMap(() => Effect.fail(new TaskError("boom")))),
        }),
        metrics: [exactMatchMetric],
      });

      const result = yield* Runner.runSuite(suite, { taskRetrySchedule: fastSchedule });

      expect(attempts).toBe(1);
      expect(result.cases[0]?.taskFailures).toHaveLength(1);
      expect(result.cases[0]?.taskOutputs).toEqual([]);
      expect(result.cases[0]?.metrics[0]?.trials).toHaveLength(0);
      expect(result.cases[0]?.passed).toBe(false);
    }),
  );
});

const makeFlakyOnceMetric = () => {
  let call = 0;
  return Metric.makeMetric({
    name: "flaky-once",
    scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>, TaskError>({
      name: "flaky-once",
      evaluate: () =>
        Effect.gen(function* () {
          call++;
          if (call === 1) return yield* Effect.fail(new TaskError("first trial fails"));
          return { score: 1 };
        }),
    }),
    threshold: Threshold.strict,
  });
};

layer(Cache.layerMemory, { buildPerTest: true })(
  "Runner.runSuite — ignore vs fail metric errors",
  (t) => {
    t.effect("fails the case on any metric error by default (ignoreErrors: false)", () =>
      Effect.gen(function* () {
        const suite = Runner.makeSuite({
          name: "strict-errors",
          dataset: Dataset.fromArray("strict-errors", ["Bonjour"]),
          task: echoTask,
          metrics: [makeFlakyOnceMetric()],
        });

        const result = yield* Runner.runSuite(suite, { trials: 3 });

        expect(result.cases[0]?.metrics[0]?.errorCount).toBe(1);
        expect(result.cases[0]?.metrics[0]?.passed).toBe(false);
        expect(result.cases[0]?.passed).toBe(false);
      }),
    );

    t.effect("excludes errored trials from the aggregate when ignoreErrors: true", () =>
      Effect.gen(function* () {
        const suite = Runner.makeSuite({
          name: "ignored-errors",
          dataset: Dataset.fromArray("ignored-errors", ["Bonjour"]),
          task: echoTask,
          metrics: [makeFlakyOnceMetric()],
        });

        const result = yield* Runner.runSuite(suite, { trials: 3, ignoreErrors: true });

        const metric = result.cases[0]?.metrics[0];
        expect(metric?.errorCount).toBe(1);
        expect(statOf("mean", metric)).toBe(1);
        expect(metric?.passed).toBe(true);
        expect(result.cases[0]?.passed).toBe(true);
      }),
    );
  },
);

const storeFailure = (method: string) =>
  Effect.fail(new Cache.KeyValueStore.KeyValueStoreError({ message: "store down", method }));

describe("Runner.runSuite — caching", () => {
  layer(Cache.layerMemory, { buildPerTest: true })((t) => {
    t.effect("makes zero further scorer/task calls on a repeat run against the same cache", () =>
      Effect.gen(function* () {
        let taskCalls = 0;
        let metricCalls = 0;

        const countingTask = Runner.makeTask<string, string>({
          id: "counting@v1",
          run: (golden) =>
            Effect.sync(() => {
              taskCalls++;
              return golden;
            }),
        });
        const countingMetric = Metric.makeMetric({
          name: "counting",
          scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
            name: "counting",
            evaluate: () =>
              Effect.sync(() => {
                metricCalls++;
                return { score: 1 };
              }),
          }),
          threshold: Threshold.strict,
        });

        const suite = Runner.makeSuite({
          name: "cached",
          dataset: Dataset.fromArray("cached", ["Bonjour"]),
          task: countingTask,
          metrics: [countingMetric],
        });

        const [first, second] = yield* Effect.gen(function* () {
          const r1 = yield* Runner.runSuite(suite);
          const r2 = yield* Runner.runSuite(suite);
          return [r1, r2] as const;
        });

        expect(taskCalls).toBe(1);
        expect(metricCalls).toBe(1);
        expect(first?.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ cached: false });
        expect(second?.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ cached: true });
        expect(second?.passed).toBe(true);
      }),
    );

    t.effect("treats an unparseable cache entry as a miss, re-running the task and metric", () =>
      Effect.gen(function* () {
        let taskCalls = 0;
        let metricCalls = 0;

        const countingTask = Runner.makeTask<string, string>({
          id: "corrupt@v1",
          run: (golden) =>
            Effect.sync(() => {
              taskCalls++;
              return golden;
            }),
        });
        const countingMetric = Metric.makeMetric({
          name: "counting",
          scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
            name: "counting",
            evaluate: () =>
              Effect.sync(() => {
                metricCalls++;
                return { score: 1 };
              }),
          }),
          threshold: Threshold.strict,
        });
        const suite = Runner.makeSuite({
          name: "corrupt",
          dataset: Dataset.fromArray("corrupt", ["Bonjour"]),
          task: countingTask,
          metrics: [countingMetric],
        });

        const second = yield* Effect.gen(function* () {
          yield* Runner.runSuite(suite);
          const kv = yield* Cache.KeyValueStore.KeyValueStore;
          const taskKey = yield* Cache.hashKey({
            golden: "Bonjour",
            taskId: "corrupt@v1",
            trial: 1,
          });
          const metricKey = yield* Cache.hashKey({
            golden: "Bonjour",
            taskId: "corrupt@v1",
            metric: "counting",
            trial: 1,
          });
          yield* kv.set(taskKey, "{not valid json");
          yield* kv.set(metricKey, "{not valid json");
          return yield* Runner.runSuite(suite);
        });

        expect(taskCalls).toBe(2);
        expect(metricCalls).toBe(2);
        expect(second.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ cached: false });
        expect(second.passed).toBe(true);
      }),
    );
  });

  it.effect(
    "treats a failing cache store as a miss on read and a no-op on write, never failing the run",
    () =>
      Effect.gen(function* () {
        let taskCalls = 0;
        // Not an object literal at the call, so no excess-property check: effect
        // 4.1's store also lists `keys`, which 4.0 (the peer floor) does not know.
        const failingOptions = {
          get: () => storeFailure("get"),
          set: () => storeFailure("set"),
          remove: () => storeFailure("remove"),
          clear: storeFailure("clear"),
          size: storeFailure("size"),
          keys: storeFailure("keys"),
        };
        const failingStore = Cache.KeyValueStore.makeStringOnly(failingOptions);
        const countingTask = Runner.makeTask<string, string>({
          id: "store-down@v1",
          run: (golden) =>
            Effect.sync(() => {
              taskCalls++;
              return golden;
            }),
        });
        const suite = Runner.makeSuite({
          name: "store-down",
          dataset: Dataset.fromArray("store-down", ["Bonjour"]),
          task: countingTask,
          metrics: [exactMatchMetric],
        });

        const [first, second] = yield* Effect.gen(function* () {
          const firstRun = yield* Runner.runSuite(suite);
          const secondRun = yield* Runner.runSuite(suite);
          return [firstRun, secondRun] as const;
        }).pipe(Effect.provideService(Cache.KeyValueStore.KeyValueStore, failingStore));

        expect(taskCalls).toBe(2);
        expect(first.passed).toBe(true);
        expect(second.cases[0]?.metrics[0]?.trials[0]).toMatchObject({ cached: false });
      }),
  );

  layer(Cache.layerMemory, { buildPerTest: true })((t) => {
    t.effect("bypassCache: true skips the cache, making a fresh call on every run", () =>
      Effect.gen(function* () {
        let metricCalls = 0;
        const countingMetric = Metric.makeMetric({
          name: "counting",
          scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>>({
            name: "counting",
            evaluate: () =>
              Effect.sync(() => {
                metricCalls++;
                return { score: 1 };
              }),
          }),
          threshold: Threshold.strict,
        });

        const suite = Runner.makeSuite({
          name: "bypassed",
          dataset: Dataset.fromArray("bypassed", ["Bonjour"]),
          task: echoTask,
          metrics: [countingMetric],
        });

        yield* Effect.gen(function* () {
          yield* Runner.runSuite(suite, { bypassCache: true });
          yield* Runner.runSuite(suite, { bypassCache: true });
        });

        expect(metricCalls).toBe(2);
      }),
    );
  });
});

describe("Runner.makeSuite — heterogeneous metrics", () => {
  class ErrorA {
    readonly _tag = "ErrorA";
  }
  class ErrorB {
    readonly _tag = "ErrorB";
  }
  class ServiceA extends Context.Service<
    ServiceA,
    { readonly rate: () => Effect.Effect<number, ErrorA> }
  >()("tests/Runner/ServiceA") {}
  class ServiceB extends Context.Service<
    ServiceB,
    { readonly rate: () => Effect.Effect<number, ErrorB> }
  >()("tests/Runner/ServiceB") {}

  const metricA = Metric.makeMetric({
    name: "metric-a",
    scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>, ErrorA, ServiceA>({
      name: "metric-a",
      evaluate: () =>
        Effect.gen(function* () {
          const service = yield* ServiceA;
          return { score: yield* service.rate() };
        }),
    }),
    threshold: Threshold.strict,
  });

  const metricB = Metric.makeMetric({
    name: "metric-b",
    scorer: Scorer.makeScorer<Runner.EvaluatedCase<string, string>, ErrorB, ServiceB>({
      name: "metric-b",
      evaluate: () =>
        Effect.gen(function* () {
          const service = yield* ServiceB;
          return { score: yield* service.rate() };
        }),
    }),
    threshold: Threshold.strict,
  });

  layer(Cache.layerMemory, { buildPerTest: true })((t) => {
    t.effect(
      "infers the union of E/R across metrics with different E/R, no explicit array annotation",
      () =>
        Effect.gen(function* () {
          // No explicit `ReadonlyArray<Metric.Metric<..., ErrorA | ErrorB, ServiceA | ServiceB>>` annotation
          // here — `makeSuite`'s `const Metrics` type parameter infers the tuple and unions MetricE/MetricR
          // from `metricA`/`metricB` directly; a regression here would fail `vp run check`, not this assertion.
          const suite = Runner.makeSuite({
            name: "heterogeneous",
            dataset: Dataset.fromArray("heterogeneous", ["Bonjour"]),
            task: echoTask,
            metrics: [metricA, metricB],
          });

          const result = yield* Runner.runSuite(suite).pipe(
            Effect.provideService(ServiceA, { rate: () => Effect.succeed(1) }),
            Effect.provideService(ServiceB, { rate: () => Effect.succeed(1) }),
          );

          expect(result.passed).toBe(true);
          expect(
            Arr.sort(result.cases[0]?.metrics.map((metric) => metric.metric) ?? [], Order.String),
          ).toEqual(["metric-a", "metric-b"]);
        }),
    );
  });
});

layer(Cache.layerMemory, { buildPerTest: true })("Runner.runSuite — reporters", (t) => {
  t.effect("invokes every reporter exactly once with the final result", () =>
    Effect.gen(function* () {
      const reports: Array<string> = [];
      const suite = Runner.makeSuite({
        name: "reported",
        dataset: Dataset.fromArray("reported", ["Bonjour"]),
        task: echoTask,
        metrics: [exactMatchMetric],
      });

      yield* Runner.runSuite(suite, {
        reporters: [
          {
            name: "spy-a",
            report: (result) => Effect.sync(() => void reports.push(`a:${result.suite}`)),
          },
          {
            name: "spy-b",
            report: (result) => Effect.sync(() => void reports.push(`b:${result.suite}`)),
          },
        ],
      });

      expect(Arr.sort(reports, Order.String)).toEqual(["a:reported", "b:reported"]);
    }),
  );
});

describe("Runner.isConfigError", () => {
  it.effect("identifies a real Config.ConfigError", () =>
    Effect.gen(function* () {
      const error = yield* Config.String("EFFECT_EVALS_RUNNER_TEST_MISSING_CONFIG").pipe(
        Effect.flip,
      );
      expect(Runner.isConfigError(error)).toBe(true);
    }),
  );

  it("rejects errors that aren't a Config.ConfigError", () => {
    expect(Runner.isConfigError(new Cause.NoSuchElementError("boom"))).toBe(false);
    expect(Runner.isConfigError("boom")).toBe(false);
    expect(Runner.isConfigError(undefined)).toBe(false);
  });
});
