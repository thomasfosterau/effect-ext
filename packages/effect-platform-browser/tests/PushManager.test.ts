import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { PushManager } from "@thomasfosterau/effect-platform-browser";
import { domError } from "./helpers.ts";

const json = {
  endpoint: "https://push.example/abc",
  expirationTime: null,
  keys: { p256dh: "BNc", auth: "tBH" },
};

const subscription = (
  toJSON: () => PushSubscriptionJSON = () => json,
  unsubscribe = async () => true,
) => ({
  endpoint: json.endpoint,
  toJSON,
  unsubscribe,
});

const registration = (
  fields: { reject?: Error; current?: PushManager.PushSubscriptionLike } = {},
) => {
  const seen: Array<PushManager.SubscribeOptionsLike> = [];
  return {
    seen,
    pushManager: {
      subscribe: async (options: PushManager.SubscribeOptionsLike) => {
        seen.push(options);
        if (fields.reject !== undefined) throw fields.reject;
        return subscription();
      },
      getSubscription: async () => fields.current ?? null,
      permissionState: async (options: PushManager.SubscribeOptionsLike) => {
        seen.push(options);
        return "granted" as const;
      },
    },
  };
};

/** A `toJSON` that throws, as a detached subscription's might. */
function detached(): PushSubscriptionJSON {
  throw domError("InvalidStateError");
}

const key = { applicationServerKey: "BEl6" };

describe("PushManager", () => {
  it.effect("fails Unsupported without a pushManager", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(PushManager.subscribe({}, key));
      expect(error.reason).toBe("Unsupported");
      expect(error.message).toBe("pushManager.subscribe: Unsupported");
    }),
  );

  it.effect("subscribe always asks for user-visible pushes", () => {
    const reg = registration();
    return Effect.gen(function* () {
      expect((yield* PushManager.subscribe(reg, key)).endpoint).toBe(json.endpoint);
      expect(yield* PushManager.permissionState(reg, key)).toBe("granted");
      expect(reg.seen).toEqual([
        { userVisibleOnly: true, applicationServerKey: "BEl6" },
        { userVisibleOnly: true, applicationServerKey: "BEl6" },
      ]);
    });
  });

  it.effect("maps subscribe rejections", () =>
    Effect.gen(function* () {
      const reasons = yield* Effect.forEach(
        ["NotAllowedError", "InvalidStateError", "InvalidAccessError", "AbortError", "Weird"],
        (name) =>
          Effect.map(
            Effect.flip(PushManager.subscribe(registration({ reject: domError(name) }), key)),
            (error) => error.reason,
          ),
        { concurrency: 1 },
      );
      expect(reasons).toEqual([
        "NotAllowed",
        "InvalidState",
        "InvalidKey",
        "PushService",
        "Failed",
      ]);
    }),
  );

  it.effect("getSubscription reads null as None", () =>
    Effect.gen(function* () {
      expect(yield* PushManager.getSubscription(registration())).toEqual(Option.none());
      const current = subscription();
      expect(yield* PushManager.getSubscription(registration({ current }))).toEqual(
        Option.some(current),
      );
    }),
  );

  it.effect("unsubscribe calls through", () =>
    Effect.gen(function* () {
      expect(yield* PushManager.unsubscribe(subscription())).toBe(true);
      const failing = subscription(undefined, () => Promise.reject(domError("AbortError")));
      expect((yield* Effect.flip(PushManager.unsubscribe(failing))).reason).toBe("PushService");
      // A rejection without a `name` is `Failed`.
      const nameless = subscription(undefined, () => Promise.reject(Symbol.for("nameless")));
      expect((yield* Effect.flip(PushManager.unsubscribe(nameless))).reason).toBe("Failed");
    }),
  );

  it.effect("toJson checks the subscription's JSON", () =>
    Effect.gen(function* () {
      expect(yield* PushManager.toJson(subscription())).toEqual(json);
      const keyless = subscription(() => ({ endpoint: json.endpoint }));
      expect((yield* Effect.flip(PushManager.toJson(keyless))).reason).toBe("InvalidSubscription");
      const throwing = subscription(detached);
      expect((yield* Effect.flip(PushManager.toJson(throwing))).reason).toBe("Failed");
    }),
  );
});
