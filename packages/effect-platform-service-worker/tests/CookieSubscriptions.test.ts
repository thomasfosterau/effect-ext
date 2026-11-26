import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  cookieChangeListener,
  type CookieChangeEventLike,
  type CookieStoreManagerLike,
  CookieSubscriptions,
  memoryCookieSubscriptions,
  subscribe,
  subscriptions,
  unsubscribe,
} from "@thomasfosterau/effect-platform-service-worker/CookieSubscriptions";
import type { CookieChange } from "@thomasfosterau/effect-platform-worker-shared/CookieStore";
import { domError } from "./helpers.ts";

/** A `waitUntil` that records what it was handed, and a way to settle them all. */
const extendable = () => {
  const pending: Array<Promise<unknown>> = [];
  return {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    settled: Effect.tryPromise({ try: () => Promise.allSettled(pending), catch: String }),
  };
};

/** A manager whose every call rejects with `cause`. */
const rejecting = (cause: unknown): CookieStoreManagerLike => ({
  subscribe: () => Promise.reject(cause),
  unsubscribe: () => Promise.reject(cause),
  getSubscriptions: () => Promise.reject(cause),
});

describe("CookieSubscriptions", () => {
  it.effect("subscribes once per subscription, lists them and unsubscribes", () =>
    Effect.gen(function* () {
      yield* subscribe([{ name: "session", url: "/" }, { url: "/app/" }, { url: "/app/" }]);
      yield* subscribe([
        { name: "session", url: "/" },
        { name: "theme", url: "/" },
      ]);
      expect(yield* subscriptions).toEqual([
        { name: Option.some("session"), url: "/" },
        { name: Option.none(), url: "/app/" },
        { name: Option.some("theme"), url: "/" },
      ]);
      yield* unsubscribe([{ name: "session", url: "/" }, { url: "/missing" }]);
      expect(yield* subscriptions).toEqual([
        { name: Option.none(), url: "/app/" },
        { name: Option.some("theme"), url: "/" },
      ]);
    }).pipe(Effect.provideService(CookieSubscriptions, Option.some(memoryCookieSubscriptions()))),
  );

  it.effect("reads a subscription the platform reports without a url as an empty url", () =>
    Effect.gen(function* () {
      const sparse: CookieStoreManagerLike = {
        ...memoryCookieSubscriptions(),
        getSubscriptions: () => Promise.resolve([{ name: "session" }]),
      };
      const read = yield* subscriptions.pipe(
        Effect.provideService(CookieSubscriptions, Option.some(sparse)),
      );
      expect(read).toEqual([{ name: Option.some("session"), url: "" }]);
    }),
  );

  it.effect("fails Unsupported without a manager, and maps rejections", () =>
    Effect.gen(function* () {
      const unsupported = yield* Effect.flip(subscriptions);
      expect([unsupported.operation, unsupported.reason]).toEqual(["subscriptions", "Unsupported"]);
      expect(unsupported.message).toBe("service-worker: cookie subscriptions: Unsupported");
      const invalid = yield* Effect.flip(
        subscribe([{ url: "https://elsewhere.example/" }]).pipe(
          Effect.provideService(
            CookieSubscriptions,
            Option.some(rejecting(new TypeError("outside the scope"))),
          ),
        ),
      );
      expect([invalid.operation, invalid.reason]).toEqual(["subscribe", "InvalidSubscription"]);
      const failed = yield* Effect.flip(
        unsubscribe([{ url: "/" }]).pipe(
          Effect.provideService(
            CookieSubscriptions,
            Option.some(rejecting(domError("AbortError"))),
          ),
        ),
      );
      expect([failed.operation, failed.reason]).toEqual(["unsubscribe", "Failed"]);
    }),
  );
});

describe("cookieChangeListener", () => {
  it.effect("hands each change to the handler inside waitUntil", () =>
    Effect.gen(function* () {
      const seen: Array<CookieChange> = [];
      const listener = yield* cookieChangeListener((change) =>
        Effect.sync(() => seen.push(change)),
      );
      const { waitUntil, settled } = extendable();
      const events: ReadonlyArray<CookieChangeEventLike> = [
        { changed: [{ name: "session", value: "abc" }], deleted: [{ name: "theme" }], waitUntil },
        { changed: [{}], waitUntil },
        { waitUntil },
      ];
      Arr.forEach(events, listener);
      const outcomes = yield* settled;
      expect(Arr.map(outcomes, (outcome) => outcome.status)).toEqual([
        "fulfilled",
        "fulfilled",
        "fulfilled",
      ]);
      expect(seen).toEqual([
        { changed: [{ name: "session", value: "abc" }], deleted: [{ name: "theme", value: "" }] },
        { changed: [{ name: "", value: "" }], deleted: [] },
        { changed: [], deleted: [] },
      ]);
    }),
  );

  it.effect("rejects waitUntil when the handler fails", () =>
    Effect.gen(function* () {
      const listener = yield* cookieChangeListener(() => Effect.fail("boom"));
      const { waitUntil, settled } = extendable();
      listener({ waitUntil });
      const outcomes = yield* settled;
      expect(Arr.map(outcomes, (outcome) => outcome.status)).toEqual(["rejected"]);
    }),
  );
});
