/**
 * Unit tests for `Browser`'s `WakeLock`, driven through `BrowserTesting`'s
 * `TestWakeLock` (and `TestPageVisibility` for the re-acquiring form).
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schedule from "effect/Schedule";
import { WakeLock } from "@thomasfosterau/effect-platform-browser";
import {
  TestPageVisibility,
  TestWakeLock,
} from "@thomasfosterau/effect-platform-browser/BrowserTesting";

/** Polls `read` until `done` holds (the browser settles wake locks asynchronously). */
const until = <A>(read: Effect.Effect<A>, done: (value: A) => boolean) =>
  read.pipe(
    Effect.repeat({ until: done, schedule: Schedule.spaced("1 millis") }),
    Effect.timeout("1 second"),
  );

describe("WakeLock.acquire", () => {
  it("holds a lock for the scope, and reports the browser releasing it", async () => {
    const { wakeLock, control } = TestWakeLock.make();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const during = yield* Effect.scoped(
          Effect.gen(function* () {
            const held = yield* wakeLock.acquire;
            const count = yield* control.held;
            const before = yield* held.isReleased;
            yield* control.releaseAll;
            yield* held.released;
            return { count, before, after: yield* held.isReleased };
          }),
        );
        return { during, heldAfterScope: yield* control.held, requests: yield* control.requests };
      }),
    );
    expect(result).toStrictEqual({
      during: { count: 1, before: false, after: true },
      heldAfterScope: 0,
      requests: 1,
    });
  });

  it("releases the lock when the scope closes", async () => {
    const { wakeLock, control } = TestWakeLock.make();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const held = yield* Effect.scoped(wakeLock.acquire);
        yield* held.released;
        return { held: yield* control.held, released: yield* held.isReleased };
      }),
    );
    expect(result).toStrictEqual({ held: 0, released: true });
  });

  it("fails NotAllowed when refused and Unsupported without the API", async () => {
    const denied = TestWakeLock.make({ deny: true });
    const refused = await Effect.runPromise(Effect.flip(Effect.scoped(denied.wakeLock.acquire)));
    expect(refused).toMatchObject({
      _tag: "WakeLockError",
      reason: "NotAllowed",
      message: "screen wake lock: NotAllowed",
    });
    const unsupported = TestWakeLock.make({ supported: false });
    expect(unsupported.wakeLock.supported).toBe(false);
    const missing = await Effect.runPromise(
      Effect.flip(Effect.scoped(unsupported.wakeLock.acquire)),
    );
    expect(missing.reason).toBe("Unsupported");
    const live = await Effect.runPromise(
      Effect.provide(
        Effect.map(WakeLock.WakeLock, (service) => service.supported),
        WakeLock.layer,
      ),
    );
    expect(live).toBe(false);
  });

  it("maps an unknown rejection to Failed", async () => {
    const wakeLock = WakeLock.make({
      request: () => Promise.reject(new DOMException("odd", "UnknownError")),
    });
    const error = await Effect.runPromise(Effect.flip(Effect.scoped(wakeLock.acquire)));
    expect(error.reason).toBe("Failed");
  });
});

describe("WakeLock over a sentinel released before it arrives", () => {
  it("reports the lock released at once", async () => {
    const sentinel = Object.assign(new EventTarget(), {
      released: true,
      release: () => Promise.resolve(),
    });
    const wakeLock = WakeLock.make({ request: () => Promise.resolve(sentinel) });
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const held = yield* wakeLock.acquire;
          yield* held.released;
          return yield* held.isReleased;
        }),
      ),
    );
    expect(result).toBe(true);
  });
});

describe("WakeLock.keepAwake", () => {
  it("holds a lock exactly while the effect runs", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestWakeLock.Control;
          const during = yield* WakeLock.keepAwake(control.held);
          return { during, after: yield* control.held };
        }),
        TestWakeLock.layer(),
      ),
    );
    expect(result).toStrictEqual({ during: 1, after: 0 });
  });

  it("does not run the effect when no lock is granted", async () => {
    const ran: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.provide(
        Effect.flip(WakeLock.keepAwake(Effect.sync(() => ran.push("ran")))),
        TestWakeLock.layer({ deny: true }),
      ),
    );
    expect(error.reason).toBe("NotAllowed");
    expect(ran).toStrictEqual([]);
  });
});

describe("WakeLock.keepAwakeWhileVisible", () => {
  it("re-acquires when the page returns, and releases when the effect ends", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const wakeLock = yield* TestWakeLock.Control;
          const visibility = yield* TestPageVisibility.Control;
          const fiber = yield* Effect.forkChild(WakeLock.keepAwakeWhileVisible(Effect.never));
          yield* until(wakeLock.held, (held) => held === 1);
          // The browser drops the lock when the page is hidden.
          yield* visibility.set("hidden");
          yield* wakeLock.releaseAll;
          yield* until(wakeLock.held, (held) => held === 0);
          yield* visibility.set("visible");
          yield* until(wakeLock.held, (held) => held === 1);
          const requests = yield* wakeLock.requests;
          yield* Fiber.interrupt(fiber);
          return { requests, after: yield* wakeLock.held };
        }),
        Layer.merge(TestWakeLock.layer(), TestPageVisibility.layer()),
      ),
    );
    expect(result).toStrictEqual({ requests: 2, after: 0 });
  });

  it("logs a refused lock, and tries again at the next return to visibility", async () => {
    const warnings: Array<unknown> = [];
    const capture = Logger.make(({ logLevel, message }) => {
      if (logLevel === "Warn") warnings.push(message);
    });
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const wakeLock = yield* TestWakeLock.Control;
          const visibility = yield* TestPageVisibility.Control;
          const fiber = yield* Effect.forkChild(WakeLock.keepAwakeWhileVisible(Effect.never));
          yield* until(
            Effect.sync(() => warnings.length),
            (count) => count === 1,
          );
          yield* wakeLock.setDenied(false);
          yield* visibility.set("hidden");
          yield* visibility.set("visible");
          yield* until(wakeLock.held, (held) => held === 1);
          const requests = yield* wakeLock.requests;
          yield* Fiber.interrupt(fiber);
          return { requests, warnings };
        }),
        Layer.mergeAll(
          TestWakeLock.layer({ deny: true }),
          TestPageVisibility.layer(),
          Logger.layer([capture]),
        ),
      ),
    );
    expect(result).toStrictEqual({
      requests: 1,
      warnings: [["screen wake lock not held", "NotAllowed"]],
    });
  });

  it("never fails the effect over a refused lock", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        WakeLock.keepAwakeWhileVisible(Effect.succeed("done")),
        Layer.merge(TestWakeLock.layer({ deny: true }), TestPageVisibility.layer()),
      ),
    );
    expect(result).toBe("done");
  });
});
