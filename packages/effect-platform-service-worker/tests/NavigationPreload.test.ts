import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  disable,
  enable,
  NavigationPreload,
  type NavigationPreloadManagerLike,
  setHeaderValue,
  state,
} from "@thomasfosterau/effect-platform-service-worker/NavigationPreload";
import {
  type FetchEventLike,
  fetchListener,
  isNavigationRequest,
  networkOnly,
  PreloadResponse,
  route,
  withNavigationPreload,
} from "@thomasfosterau/effect-platform-service-worker/Fetch";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { domError } from "./helpers.ts";

/** An in-memory manager; `reject` makes every call reject with it. */
const manager = (reject?: unknown) => {
  const current = { enabled: false, headerValue: "true" };
  const settle = <A>(value: () => A): Promise<A> =>
    reject === undefined ? Promise.resolve(value()) : Promise.reject(reject);
  const self: NavigationPreloadManagerLike & { readonly current: typeof current } = {
    current,
    enable: () => settle(() => void (current.enabled = true)),
    disable: () => settle(() => void (current.enabled = false)),
    setHeaderValue: (value) => settle(() => void (current.headerValue = value)),
    getState: () => settle(() => ({ ...current })),
  };
  return self;
};

describe("NavigationPreload", () => {
  it.effect("enables, sets the header, reads the state and disables", () => {
    const stub = manager();
    return Effect.gen(function* () {
      yield* enable;
      yield* setHeaderValue("shell-v3");
      expect(yield* state).toEqual({ enabled: true, headerValue: "shell-v3" });
      yield* disable;
      expect(stub.current.enabled).toBe(false);
    }).pipe(Effect.provideService(NavigationPreload, Option.some(stub)));
  });

  it.effect("fills in the platform's defaults for a sparse state", () =>
    Effect.gen(function* () {
      const sparse: NavigationPreloadManagerLike = {
        ...manager(),
        getState: () => Promise.resolve({}),
      };
      const read = yield* state.pipe(Effect.provideService(NavigationPreload, Option.some(sparse)));
      expect(read).toEqual({ enabled: false, headerValue: "true" });
    }),
  );

  it.effect("fails Unsupported without a manager, and maps rejections", () =>
    Effect.gen(function* () {
      const unsupported = yield* Effect.flip(enable);
      expect([unsupported.operation, unsupported.reason]).toEqual(["enable", "Unsupported"]);
      expect(unsupported.message).toBe("service-worker: navigation preload enable: Unsupported");
      const invalid = yield* Effect.flip(
        enable.pipe(
          Effect.provideService(
            NavigationPreload,
            Option.some(manager(domError("InvalidStateError"))),
          ),
        ),
      );
      expect(invalid.reason).toBe("InvalidState");
      const failed = yield* Effect.flip(
        state.pipe(Effect.provideService(NavigationPreload, Option.some(manager("boom")))),
      );
      expect([failed.operation, failed.reason, failed.cause]).toEqual([
        "getState",
        "Failed",
        "boom",
      ]);
    }),
  );
});

const navigation = (url = "https://example.com/") =>
  Object.defineProperty(new Request(url), "mode", { value: "navigate" });

/** A fetch event, with a preload when one is given, and what the listener did with it. */
const preloadEvent = (preloadResponse: Option.Option<Promise<unknown>>) => {
  const extended: Array<Promise<unknown>> = [];
  let answer: Option.Option<PromiseLike<Response> | Response> = Option.none();
  const event: FetchEventLike = {
    request: navigation(),
    waitUntil: (promise) => {
      extended.push(promise);
    },
    respondWith: (response) => {
      answer = Option.some(response);
    },
  };
  const withPreload: FetchEventLike = Option.match(preloadResponse, {
    onNone: () => event,
    onSome: (preload) => Object.assign(event, { preloadResponse: preload }),
  });
  const text = Effect.flatMap(
    Effect.suspend(() => Effect.fromOption(answer)),
    (response) =>
      Effect.tryPromise({
        try: () => Promise.resolve(response).then((settled) => settled.text()),
        catch: String,
      }),
  );
  return { event: withPreload, extended, text };
};

const network: typeof fetch = () => Promise.resolve(new Response("network"));

const preloadingListener = fetchListener([
  route(isNavigationRequest, withNavigationPreload(networkOnly)),
]).pipe(Effect.provideService(FetchHttpClient.Fetch, network));

describe("withNavigationPreload", () => {
  it.effect("answers with the preload, and keeps the worker alive until it settles", () =>
    Effect.gen(function* () {
      const listener = yield* preloadingListener;
      const fake = preloadEvent(Option.some(Promise.resolve(new Response("preloaded"))));
      listener(fake.event);
      expect(yield* fake.text).toBe("preloaded");
      expect(fake.extended).toHaveLength(1);
    }),
  );

  it.effect(
    "falls back to the strategy without a preload, with an empty one, or a failed one",
    () =>
      Effect.gen(function* () {
        const listener = yield* preloadingListener;
        const preloads = [
          Option.none(),
          Option.some(Promise.resolve(undefined)),
          Option.some(Promise.reject(new TypeError("offline"))),
        ];
        const answers = yield* Effect.forEach(
          preloads,
          (preload) => {
            const fake = preloadEvent(preload);
            listener(fake.event);
            return fake.text;
          },
          { concurrency: 1 },
        );
        expect(answers).toEqual(["network", "network", "network"]);
      }),
  );

  it.effect("sees no preload outside a listener", () =>
    Effect.gen(function* () {
      const preload = yield* PreloadResponse;
      expect(Option.isNone(yield* preload)).toBe(true);
    }),
  );
});
