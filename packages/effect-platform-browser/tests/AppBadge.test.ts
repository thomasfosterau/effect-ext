import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AppBadge } from "@thomasfosterau/effect-platform-worker-shared";
import { TestAppBadge } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

describe("TestAppBadge", () => {
  it.effect("shows a count or a dot, clears on zero, and fails the next call on demand", () =>
    Effect.gen(function* () {
      const control = yield* TestAppBadge.Control;
      yield* AppBadge.set(3);
      expect(yield* control.badge).toEqual(Option.some(3));
      yield* AppBadge.set();
      expect(yield* control.badge).toEqual(Option.some("dot"));
      yield* AppBadge.set(0);
      expect(yield* control.badge).toEqual(Option.none());
      yield* AppBadge.set(1);
      yield* AppBadge.clear;
      expect(yield* control.badge).toEqual(Option.none());

      yield* control.failNext("NotAllowedError");
      expect((yield* Effect.flip(AppBadge.set(2))).reason).toBe("NotAllowed");
      yield* AppBadge.set(2);
      expect(yield* control.badge).toEqual(Option.some(2));
    }).pipe(Effect.provide(TestAppBadge.layer())),
  );

  it.effect("builds the unsupported service when asked", () =>
    Effect.gen(function* () {
      expect((yield* Effect.flip(AppBadge.clear)).reason).toBe("Unsupported");
    }).pipe(Effect.provide(TestAppBadge.layer({ supported: false }))),
  );
});
