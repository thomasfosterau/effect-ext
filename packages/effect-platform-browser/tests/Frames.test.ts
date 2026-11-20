import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Frames } from "@thomasfosterau/effect-platform-browser";
import { TestFrames } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

/** Waits until the clock has what `check` asks for: a fiber registers its callback on a later tick. */
const until = (
  control: TestFrames.Control["Service"],
  check: (pending: { readonly frames: number; readonly idle: ReadonlyArray<unknown> }) => boolean,
  tries = 100,
): Effect.Effect<void> =>
  Effect.flatMap(control.pending, (pending) =>
    check(pending) || tries === 0
      ? Effect.void
      : Effect.andThen(Effect.yieldNow, until(control, check, tries - 1)),
  );

describe("Frames.next", () => {
  it.effect("is the next frame's time, and cancels its frame on interruption", () =>
    Effect.gen(function* () {
      const control = yield* TestFrames.Control;
      const first = yield* Effect.forkChild(Frames.next);
      yield* control.frame();
      expect(yield* Fiber.join(first)).toBe(1016);

      const abandoned = yield* Effect.forkChild(Frames.next);
      yield* until(control, (pending) => pending.frames === 1);
      yield* Fiber.interrupt(abandoned);
      expect((yield* control.pending).frames).toBe(0);
    }).pipe(Effect.provide(TestFrames.layer({ now: 1000 }))),
  );
});

describe("Frames.ticks", () => {
  it.effect(
    "emits each frame with the time since the last, and stops requesting when it ends",
    () =>
      Effect.gen(function* () {
        const control = yield* TestFrames.Control;
        const three = yield* Effect.forkChild(Stream.runCollect(Stream.take(Frames.ticks, 3)));
        yield* control.frame();
        yield* control.frame(32);
        yield* control.frame(8);
        const ticks = yield* Fiber.join(three);
        expect(ticks.map(({ time, delta }) => [time, Duration.toMillis(delta)])).toEqual([
          [16, 0],
          [48, 32],
          [56, 8],
        ]);
        expect((yield* control.pending).frames).toBe(0);
      }).pipe(Effect.provide(TestFrames.layer())),
  );
});

describe("Frames.idle", () => {
  it.effect("reports the period the browser gave, passing the timeout through", () =>
    Effect.gen(function* () {
      const control = yield* TestFrames.Control;
      const bounded = yield* Effect.forkChild(Frames.idle({ timeout: "2 seconds" }));
      const open = yield* Effect.forkChild(Frames.idle());
      yield* until(control, (pending) => pending.idle.length === 2);
      expect((yield* control.pending).idle).toEqual([Option.some(2000), Option.none()]);
      yield* control.idle({ timeRemaining: 12, didTimeout: true });
      const [timedOut, plain] = [yield* Fiber.join(bounded), yield* Fiber.join(open)];
      expect([timedOut.didTimeout, Duration.toMillis(timedOut.timeRemaining)]).toEqual([true, 12]);
      expect(plain.didTimeout).toBe(true);

      const defaults = yield* Effect.forkChild(Frames.idle());
      yield* control.idle();
      const period = yield* Fiber.join(defaults);
      expect([period.didTimeout, Duration.toMillis(period.timeRemaining)]).toEqual([false, 50]);

      const abandoned = yield* Effect.forkChild(Frames.idle());
      yield* until(control, (pending) => pending.idle.length === 1);
      yield* Fiber.interrupt(abandoned);
      expect((yield* control.pending).idle).toEqual([]);
    }).pipe(Effect.provide(TestFrames.layer())),
  );
});

describe("Frames without the APIs", () => {
  it.effect("fails each call Unsupported, naming the API", () =>
    Effect.gen(function* () {
      const frames = yield* Frames.Frames;
      expect(frames.supported).toEqual({ animation: false, idle: false });
      const failures = yield* Effect.all(
        [
          Effect.flip(Frames.next),
          Effect.flip(Stream.runDrain(Frames.ticks)),
          Effect.flip(Frames.idle()),
        ],
        { concurrency: 1 },
      );
      expect(failures.map((error) => [error.reason, error.api])).toEqual([
        ["Unsupported", "animationFrame"],
        ["Unsupported", "animationFrame"],
        ["Unsupported", "idleCallback"],
      ]);
    }).pipe(Effect.provide(TestFrames.layer({ animation: false, idle: false }))),
  );

  it("keeps animation frames where only idle callbacks are missing, as in Safari", () => {
    const { frames } = TestFrames.make({ idle: false });
    expect(frames.supported).toEqual({ animation: true, idle: false });
  });
});
