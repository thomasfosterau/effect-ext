import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ServiceWorkerContainer as SWC } from "@thomasfosterau/effect-platform-service-worker";
import { domError } from "./helpers.ts";

const worker = (state: SWC.ServiceWorkerState) => {
  const posted: Array<unknown> = [];
  return Object.assign(new EventTarget(), {
    scriptURL: "https://example.com/sw.js",
    state,
    posted,
    postMessage: (message: unknown) => {
      posted.push(message);
    },
  });
};

type Worker = ReturnType<typeof worker>;

const registration = (fields: { installing?: Worker; waiting?: Worker } = {}) =>
  Object.assign(new EventTarget(), {
    scope: "https://example.com/",
    installing: fields.installing ?? null,
    waiting: fields.waiting ?? null,
    active: null,
    update: async (): Promise<void> => {},
    unregister: async (): Promise<boolean> => true,
  });

const container = (fields: { controller?: Worker; reject?: Error } = {}) => {
  const reg = registration();
  return Object.assign(new EventTarget(), {
    controller: fields.controller ?? null,
    started: 0,
    ready: Promise.resolve(reg),
    register: async () => {
      if (fields.reject !== undefined) throw fields.reject;
      return reg;
    },
    getRegistration: async (url?: string) => (url === "https://other.example/" ? undefined : reg),
    startMessages() {
      this.started += 1;
    },
  });
};

const within = (stub: SWC.ServiceWorkerContainerLike) =>
  Effect.provideService(SWC.Container, Option.some(stub));

const settle = Effect.repeat(Effect.yieldNow, { times: 20 });

describe("ServiceWorkerContainer", () => {
  it.effect("fails Unsupported without a container", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(SWC.ready);
      expect(error.reason).toBe("Unsupported");
      expect(error.message).toBe("serviceWorker.ready: Unsupported");
    }),
  );

  it.effect("register, ready and getRegistration", () =>
    Effect.gen(function* () {
      expect((yield* SWC.register("/sw.js")).scope).toBe("https://example.com/");
      expect((yield* SWC.ready).scope).toBe("https://example.com/");
      expect(Option.isSome(yield* SWC.getRegistration())).toBe(true);
      expect(yield* SWC.getRegistration("https://other.example/")).toEqual(Option.none());
    }).pipe(within(container())),
  );

  it.effect("maps register rejections", () =>
    Effect.gen(function* () {
      const security = yield* Effect.flip(
        SWC.register("/sw.js").pipe(within(container({ reject: domError("SecurityError") }))),
      );
      expect(security.reason).toBe("Security");
      const script = yield* Effect.flip(
        SWC.register("/sw.js").pipe(within(container({ reject: new TypeError("404") }))),
      );
      expect(script.reason).toBe("InvalidScript");
    }),
  );

  it.effect("update and unregister call through", () => {
    const reg = registration();
    return Effect.gen(function* () {
      yield* SWC.update(reg);
      expect(yield* SWC.unregister(reg)).toBe(true);
      const failing = Object.assign(registration(), {
        unregister: () => Promise.reject(domError("InvalidStateError")),
      });
      expect((yield* Effect.flip(SWC.unregister(failing))).reason).toBe("InvalidState");
    });
  });

  it.effect("controllerChanges emits the current controller, then each change", () => {
    const stub = container();
    const next = worker("activated");
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(SWC.controllerChanges, 2)),
      );
      yield* settle;
      stub.controller = next;
      stub.dispatchEvent(new Event("controllerchange"));
      expect(yield* Fiber.join(fiber)).toEqual([Option.none(), Option.some(next)]);
      expect(yield* SWC.controller).toEqual(Option.some(next));
    }).pipe(within(stub));
  });

  it.effect("waitingWorker returns a worker already waiting", () => {
    const waiting = worker("installed");
    return Effect.map(SWC.waitingWorker(registration({ waiting })), (found) => {
      expect(found).toBe(waiting);
    });
  });

  it.effect("waitingWorker follows an update to installed, skipping a redundant one", () => {
    const reg = registration();
    const broken = worker("installing");
    const good = worker("installing");
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(SWC.waitingWorker(reg));
      yield* settle;
      reg.installing = broken;
      reg.dispatchEvent(new Event("updatefound"));
      yield* settle;
      broken.state = "redundant";
      broken.dispatchEvent(new Event("statechange"));
      yield* settle;
      reg.installing = good;
      reg.dispatchEvent(new Event("updatefound"));
      yield* settle;
      good.state = "installed";
      good.dispatchEvent(new Event("statechange"));
      expect(yield* Fiber.join(fiber)).toBe(good);
    });
  });

  it.effect("controllerEndpoint posts to the controller and hears the container", () => {
    const active = worker("activated");
    const stub = container({ controller: active });
    const Msg = Schema.Struct({ type: Schema.String });
    return Effect.gen(function* () {
      const sw = yield* SWC.controllerEndpoint({ send: Msg, receive: Msg });
      yield* sw.send({ type: "ping" });
      expect(active.posted).toEqual([{ type: "ping" }]);
      const inbox = yield* sw.subscribe;
      expect(stub.started).toBe(1);
      stub.dispatchEvent(Object.assign(new Event("message"), { data: { type: "pong" } }));
      expect(yield* Stream.runHead(inbox)).toEqual(Option.some({ type: "pong" }));
    }).pipe(Effect.scoped, within(stub));
  });

  it.effect("controllerEndpoint fails NoController on an uncontrolled page", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        SWC.controllerEndpoint({ send: Schema.String, receive: Schema.String }),
      );
      expect(error.reason).toBe("NoController");
    }).pipe(within(container())),
  );
});
