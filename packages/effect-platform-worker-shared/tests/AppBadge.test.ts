import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as AppBadge from "@thomasfosterau/effect-platform-worker-shared/AppBadge";

/** A navigator that records each badge call, rejecting with `refusal` when one is set. */
const stubNavigator = () => {
  const calls: Array<string> = [];
  const refusal = { next: Array.of<unknown>() };
  const answer = (call: string): Promise<void> => {
    calls.push(call);
    const [cause, ...rest] = refusal.next;
    refusal.next = rest;
    return cause === undefined ? Promise.resolve() : Promise.reject(cause);
  };
  const navigator: AppBadge.BadgeNavigatorLike = {
    setAppBadge: (contents) => answer(`set ${contents}`),
    clearAppBadge: () => answer("clear"),
  };
  return { service: AppBadge.make(navigator), calls, refusal };
};

describe("AppBadge", () => {
  it.effect("sets a count or a dot, and clears it", () =>
    Effect.gen(function* () {
      const { service, calls } = stubNavigator();
      expect(service.supported).toBe(true);
      yield* service.set(3);
      yield* service.set();
      yield* service.set(0);
      yield* service.clear;
      expect(calls).toEqual(["set 3", "set undefined", "set 0", "clear"]);
    }),
  );

  it.effect("checks the count before the call, and maps rejections by name", () =>
    Effect.gen(function* () {
      const { service, calls, refusal } = stubNavigator();
      const invalid = yield* Effect.forEach(
        [-1, 1.5, Number.NaN],
        (count) => Effect.map(Effect.flip(service.set(count)), (error) => error.reason),
        { concurrency: 1 },
      );
      expect([invalid, calls]).toEqual([["InvalidCount", "InvalidCount", "InvalidCount"], []]);
      refusal.next = [
        new TypeError("bad"),
        new DOMException("no", "NotAllowedError"),
        new DOMException("no", "SecurityError"),
        "boom",
      ];
      const reasons = yield* Effect.forEach(
        [1, 2, 3],
        (count) => Effect.map(Effect.flip(service.set(count)), (error) => error.reason),
        { concurrency: 1 },
      );
      const cleared = yield* Effect.flip(service.clear);
      expect([...reasons, cleared.reason]).toEqual([
        "InvalidCount",
        "NotAllowed",
        "NotAllowed",
        "Failed",
      ]);
    }),
  );

  it.effect("is unsupported without the API, as under Node's own navigator", () =>
    Effect.gen(function* () {
      expect(AppBadge.make().supported).toBe(false);
      expect((yield* AppBadge.AppBadge).supported).toBe(false);
      const failures = yield* Effect.all(
        [Effect.flip(AppBadge.set(1)), Effect.flip(AppBadge.clear)],
        {
          concurrency: 1,
        },
      );
      expect(failures.map((error) => error.reason)).toEqual(["Unsupported", "Unsupported"]);
    }),
  );
});
